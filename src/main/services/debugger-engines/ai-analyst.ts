/**
 * Omni-Debugger AI Analyst
 *
 * Pipes aggregated engine findings (static AST analysis, sandboxed dynamic
 * execution, architectural graph) into the ProviderGateway so each persona —
 * Staff Engineer (dev), Lead QA (qa), or Technical Product Manager (pm) —
 * receives a role-specific, human-readable interpretation.
 *
 * Contract notes:
 * - Uses the EXACT ProviderGateway.sendChatRequest signature from
 *   src/main/providers/provider-gateway.ts:
 *     sendChatRequest(providerId, modelId, messages, stream, apiKey,
 *       onToken, handoffCount, abortSignal, onHandoff, onReasoning,
 *       tools, onToolCalls)
 * - Streaming is first-class: raw tokens are relayed to the caller while the
 *   model is still thinking so the renderer never blocks on the AI.
 * - The system prompt enforces a STRICT JSON array schema; markdown/plain
 *   text responses are tolerated via a fallback parser so partial model
 *   compliance cannot crash the pipeline.
 */

import { ProviderGateway, type ChatCompletionMessage } from '../../providers/provider-gateway';
import { settingsManager } from '../settings-manager';
import type { AnalysisResult, AnalysisRole } from '../../windows/debugger-window';
import type { ArchProjectReport } from './arch-engine';

export interface RoleReportIssue {
  title: string;
  filePath?: string;
  line?: number;
  detail?: string;
  fix?: string;
}

export interface RoleReportCategory {
  area: string;
  risk: string;
  actions: string[];
}

export interface RoleReportBlocker {
  headline: string;
  businessImpact: string;
  refactoringTime?: string;
  blocksSprint?: boolean;
  recommendation?: string;
}

export interface RoleReportContextOptions {
  /** Aggregated engine findings (already deduped/sorted by the orchestrator). */
  rawResults: AnalysisResult[];
  /** Target file of the sweep, when the run was file-scoped. */
  targetFile?: string | null;
  /** Full architectural report from the arch engine (feed for the PM persona). */
  arch?: ArchProjectReport;
  /** Streaming token callback (raw chunks, exactly like canvas-agent-engine). */
  onToken?: (chunk: string) => void;
  abortSignal?: AbortSignal;
  /** Optional model configuration override from the debugger model router. */
  modelConfig?: { providerId: string; modelId: string };
}

export interface RoleReportResult {
  role: AnalysisRole;
  provider: string;
  model: string;
  durationMs: number;
  /** 'json' if the strict schema held, 'markdown' for the fallback parse, 'raw' for an unparsed blob. */
  parseMode: 'json' | 'markdown' | 'raw';
  /** Structured info-severity items to append to analysisResults (role-tagged). */
  results: AnalysisResult[];
  rawText: string;
}

export const ROLE_PROMPTS: Record<AnalysisRole, string> = {
  dev: 'You are a Staff Engineer. Analyze these static and dynamic errors. Provide the exact line number, the root cause, and a 3-line code fix. Focus on memory leaks, race conditions, and security flaws.',
  qa: 'You are a Lead QA. Analyze the process flow and dynamic execution traces. Identify missing edge cases, unhandled user inputs, and test coverage gaps. Suggest 3 specific test cases to write.',
  pm: 'You are a Technical Product Manager. Ignore syntax errors. Analyze the architectural graph and technical debt score. Explain the business risk, estimated refactoring time, and if this blocks the current sprint. Use non-technical language.'
};

const MAX_FINDINGS_IN_CONTEXT = 80;
const MAX_ITEM_TEXT_CHARS = 200;
const MAX_MODEL_INPUT_CHARS = 12_000;
const MAX_AI_RESULTS = 12;
const AI_NOTE_RULE_PREFIX = 'ai-insight';

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

/**
 * Resolves provider/model exactly like background-agent-orchestrator.ts:
 * settings-driven with graceful openkilo/groq/qwen fallbacks.
 */
async function resolveProviderModel(): Promise<{ provider: string; model: string }> {
  try {
    const active = typeof ProviderGateway.getActiveModel === 'function' ? ProviderGateway.getActiveModel() : null;
    if (active && (active.isAutoMode || (active.providerId && active.modelId))) {
      return {
        provider: active.isAutoMode ? 'auto' : active.providerId,
        model: active.isAutoMode ? 'Auto' : active.modelId
      };
    }
  } catch {
    // fall through
  }
  const settings = await settingsManager.getEffectiveSettings();
  const rawActiveProvider = settings.activeProvider || '';
  const provider = !rawActiveProvider || rawActiveProvider === 'auto' ? 'openkilo' : rawActiveProvider;
  let model = settings.activeModel || '';
  if (!model || (provider === 'openkilo' && !model.endsWith(':free') && !model.endsWith('/free'))) {
    if (provider === 'openkilo') model = 'kilo-auto/free';
    else if (provider === 'groq') model = 'openai/gpt-oss-120b';
    else model = 'google/gemma-4-31b-it:free';
  }
  return { provider, model };
}

/**
 * Summarizes the raw findings so they fit the model context window:
 * severity-ordered, deduplicated, individually truncated. Secrets were
 * already masked by the static engine before they got here.
 */
export function summarizeForContext(
  rawResults: AnalysisResult[],
  options?: { targetFile?: string | null; arch?: ArchProjectReport }
): string {
  const deduped = new Map<string, AnalysisResult>();
  for (const entry of rawResults) {
    const key = `${entry.ruleId ?? ''}|${entry.filePath ?? ''}|${entry.line ?? ''}|${entry.message}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  }
  const ordered = [...deduped.values()].sort((left, right) => {
    const severityDelta = (SEVERITY_RANK[right.severity] ?? 0) - (SEVERITY_RANK[left.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    return (left.line ?? 0) - (right.line ?? 0);
  });

  const clipped = ordered.slice(0, MAX_FINDINGS_IN_CONTEXT).map((entry, index) => ({
    n: index + 1,
    engine: entry.engine,
    severity: entry.severity,
    rule: entry.ruleId,
    message: clip(entry.message, MAX_ITEM_TEXT_CHARS),
    filePath: entry.filePath ? clip(entry.filePath, 120) : undefined,
    line: entry.line,
    suggestedFix: entry.suggestedFix ? clip(entry.suggestedFix, MAX_ITEM_TEXT_CHARS) : undefined
  }));

  const payload: Record<string, unknown> = {
    targetFile: options?.targetFile ? options.targetFile : null,
    findingCount: ordered.length,
    findingsShown: clipped.length,
    findings: clipped
  };

  if (options?.arch) {
    const arch = options.arch;
    payload.architecture = {
      projectRoot: arch.projectRoot,
      debtScore: arch.debtScore,
      cycles: arch.cycles.map((cycle) => cycle.nodes.join(' -> ')).slice(0, 8),
      godFiles: arch.graph.nodes
        .filter((node) => node.isGodFile)
        .sort((left, right) => right.loc - left.loc)
        .slice(0, 10)
        .map((node) => ({ id: node.id, loc: node.loc, importsout: node.importsOut }))
    };
  }

  return JSON.stringify(shrinkPayload(payload));
}

/**
 * Hard-trims the serialized user turn to the model input budget by halving
 * the findings list when the JSON blob would exceed MAX_MODEL_INPUT_CHARS.
 */
function shrinkPayload(input: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(input).length <= MAX_MODEL_INPUT_CHARS) return input;
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const halved = [...findings].slice(0, Math.max(1, Math.floor(MAX_FINDINGS_IN_CONTEXT / 2)));
  return { ...input, findings: halved, findingsShown: halved.length };
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function buildRoleSchemaPrompt(role: AnalysisRole): string {
  const common =
    'OUTPUT FORMAT (mandatory, no exceptions): respond with ONLY a JSON array — no markdown fences, no commentary before or after. ' +
    'Every element must be an object with string values (numbers where stated), matching one of these shapes EXACTLY as listed in "items". ' +
    'Write all human-facing text in the language of the target audience for this role.';

  if (role === 'dev') {
    return [
      ROLE_PROMPTS.dev,
      common,
      'SCHEMA: items is an array of { "title": string, "filePath": string, "line": number, "rootCause": string, "fix": string }. ' +
        '"fix" is the code fix in at most 3 lines joined with \\n. "filePath" and "line" must come from the findings (never invent file paths). ' +
        'If no meaningful issue exists, return [].'
    ].join('\n\n');
  }
  if (role === 'qa') {
    return [
      ROLE_PROMPTS.qa,
      common,
      'SCHEMA: items is an array of { "featureArea": string, "risk": string, "testCases": string[] }. ' +
        '"testCases" contains exactly 3 concrete test case descriptions. Derive areas/risks from the real findings, do not fabricate files. ' +
        'If no meaningful gap exists, return [].'
    ].join('\n\n');
  }
  return [
    ROLE_PROMPTS.pm,
    common,
    'SCHEMA: items is an array of { "headline": string, "businessImpact": string, "refactoringTime": string, "blocksSprint": boolean, "recommendation": string }. ' +
      '"refactoringTime" is an estimate in business days or a descriptive range (non-technical language). "blocksSprint" answers whether this debt endangers the current sprint. ' +
      'Base your analysis on the "architecture" block (debt score, cycles, god files) when present; never mention code line numbers or syntax errors.'
  ].join('\n\n');
}

function extractJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates: string[] = [];
  if (fence?.[1]) candidates.push(fence[1].trim());
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(trimmed.slice(firstBracket, lastBracket + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed;
      const parsedItems = (parsed as { items?: unknown }).items;
      if (Array.isArray(parsedItems)) return parsedItems;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function aiResultBase(role: AnalysisRole): Omit<AnalysisResult, 'id' | 'message' | 'severity' | 'timestamp'> {
  return {
    engine: 'ai',
    role,
    ruleId: `${AI_NOTE_RULE_PREFIX}-${role}`
  };
}

function issueToResult(role: AnalysisRole, index: number, entry: unknown): AnalysisResult | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : undefined;
  const line = typeof record.line === 'number' && Number.isFinite(record.line) ? Math.round(record.line) : undefined;
  const rootCause = typeof record.rootCause === 'string' ? record.rootCause.trim() : '';
  const fix = typeof record.fix === 'string' ? record.fix.trim() : '';
  const testCases = Array.isArray(record.testCases) ? record.testCases.filter((value): value is string => typeof value === 'string') : [];
  const area = typeof record.featureArea === 'string' ? record.featureArea.trim() : '';
  const risk = typeof record.risk === 'string' ? record.risk.trim() : '';
  const headline = typeof record.headline === 'string' ? record.headline.trim() : '';
  const businessImpact = typeof record.businessImpact === 'string' ? record.businessImpact.trim() : '';
  const refactoringTime = typeof record.refactoringTime === 'string' ? record.refactoringTime.trim() : '';
  const blocksSprint = typeof record.blocksSprint === 'boolean' ? record.blocksSprint : undefined;
  const recommendation = typeof record.recommendation === 'string' ? record.recommendation.trim() : '';

  const base = aiResultBase(role);

  if (title || rootCause) {
    return {
      ...base,
      id: `ai:${role}:issue:${index}`,
      severity: 'info',
      message: `${title}${rootCause ? ` — ${rootCause}` : ''}`.slice(0, 400),
      filePath,
      line,
      codeSnippet: fix ? fix.slice(0, 800) : undefined,
      suggestedFix: fix ? `Apply the shown fix in ${filePath ?? 'the target file'}.` : undefined,
      timestamp: Date.now()
    };
  }
  if (area || risk) {
    return {
      ...base,
      id: `ai:${role}:qa:${index}`,
      severity: 'info',
      message: `${area ? `${area}: ` : ''}${risk || 'coverage gap'}`.slice(0, 400),
      codeSnippet: testCases.length ? testCases.map((testCase, i) => `${i + 1}. ${clip(testCase, 200)}`).join('\n') : undefined,
      suggestedFix: testCases.length ? 'Write the three listed test cases before the next release cut.' : undefined,
      timestamp: Date.now()
    };
  }
  if (headline || businessImpact) {
    return {
      ...base,
      id: `ai:${role}:pm:${index}`,
      severity: 'info',
      message: `${headline || 'Risk summary'}${businessImpact ? ` — ${businessImpact}` : ''}`.slice(0, 400),
      codeSnippet:
        [refactoringTime ? `Estimated refactoring time: ${refactoringTime}` : '',
         typeof blocksSprint === 'boolean' ? `Blocks current sprint: ${blocksSprint ? 'yes' : 'no'}` : '',
         recommendation ? `Recommended action: ${recommendation}` : ''].filter(Boolean).join('\n') || undefined,
      suggestedFix: recommendation || undefined,
      filePath,
      timestamp: Date.now()
    };
  }
  return null;
}

function markdownToResults(role: AnalysisRole, text: string): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  const base = aiResultBase(role);
  const lines = text.split('\n');
  const buffer: string[] = [];

  const flush = (): void => {
    if (results.length >= MAX_AI_RESULTS) return;
    const chunk = buffer.join('\n').trim();
    buffer.length = 0;
    if (!chunk) return;
    results.push({
      ...base,
      id: `ai:${role}:note:${results.length}`,
      severity: 'info',
      // Markdown headers/bullets collapse into plain narrative lines; the
      // renderer renders codeSnippet as preformatted text.
      message: chunk.replace(/^#{1,4}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '• ').slice(0, 1200),
      timestamp: Date.now()
    });
  };

  for (const line of lines) {
    const isBoundary = /^[#>\-*]|\d+\./.test(line.trim());
    if (isBoundary && buffer.length > 0) flush();
    buffer.push(line);
  }
  flush();

  if (results.length === 0 && text.trim()) {
    results.push({
      ...base,
      id: `ai:${role}:raw:0`,
      severity: 'info',
      message: clip(text.trim().replace(/\s+/g, ' '), 1200),
      timestamp: Date.now()
    });
  }
  return results;
}

function parseFallback(role: AnalysisRole, text: string): { results: AnalysisResult[]; parseMode: RoleReportResult['parseMode'] } {
  const parsed = extractJsonArray(text);
  if (parsed) {
    const results: AnalysisResult[] = [];
    for (const [index, entry] of parsed.entries()) {
      if (results.length >= MAX_AI_RESULTS) break;
      const mapped = issueToResult(role, index, entry);
      if (mapped) results.push(mapped);
    }
    if (results.length > 0) return { results, parseMode: 'json' };
  }
  return { results: markdownToResults(role, text), parseMode: 'markdown' };
}

async function reportGenerationFailure(
  role: AnalysisRole,
  provider: string,
  model: string,
  context: Pick<RoleReportContextOptions, 'targetFile'>,
  error: unknown
): Promise<RoleReportResult> {
  const message = error instanceof Error ? error.message : String(error);
  const finding: AnalysisResult = {
    id: `ai:${role}:unavailable:0`,
    severity: 'medium',
    engine: 'ai',
    role,
    message: `AI analyst unavailable (${role} report): ${clip(message, 220)}`,
    filePath: context.targetFile ?? undefined,
    ruleId: `${AI_NOTE_RULE_PREFIX}-${role}-unavailable`,
    suggestedFix: 'Configure a provider/model in Settings → Providers, then re-run the sweep to get role-based insights.',
    timestamp: Date.now()
  };
  // Surface the same explanation on stderr-adjacent tooling (main console)
  // without leaking request payloads.
  console.warn(`[AI-ANALYST] ${role} report failed via ${provider}/${model}: ${message}`);
  return {
    role,
    provider,
    model,
    durationMs: 0,
    parseMode: 'raw',
    results: [finding],
    rawText: message
  };
}

/**
 * Generates the role-based report. Streams model tokens through
 * options.onToken in real time (wrapped exactly like
 * canvas-agent-engine.callGateway), then parses the completed answer into
 * role-tagged AnalysisResult items with 'info' severity.
 */
export async function generateRoleBasedReport(
  rawResultsIn: AnalysisResult[],
  role: AnalysisRole,
  options?: Omit<RoleReportContextOptions, 'rawResults'>
): Promise<RoleReportResult> {
  const rawResults = rawResultsIn ?? [];
  const startedAt = Date.now();
  const { provider, model } = options?.modelConfig
    ? { provider: options.modelConfig.providerId, model: options.modelConfig.modelId }
    : await resolveProviderModel();

  try {
    const systemPrompt = buildRoleSchemaPrompt(role);
    const contextPayload = summarizeForContext(rawResults, {
      targetFile: options?.targetFile,
      arch: options?.arch
    });

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `DEBUGGER FINDINGS (JSON):\n${contextPayload}` }
    ];

    const onToken = options?.onToken
      ? (chunk: string) => {
          try {
            options?.onToken?.(chunk);
          } catch {
            // UI update failures must never break the generation run.
          }
        }
      : undefined;

    let activeProvider = provider;
    let activeModel = model;
    let responseText: string;

    try {
      responseText = await ProviderGateway.sendChatRequest(
        activeProvider,
        activeModel,
        messages,
        true,
        undefined,
        onToken,
        0,
        options?.abortSignal,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'debugger'
      );
    } catch (initialErr) {
      const errMessage = initialErr instanceof Error ? initialErr.message : String(initialErr);
      const isUnavailable = /KEY_MISSING_ERROR|key required|unavailable|429|500|502|503/i.test(errMessage);
      if (isUnavailable) {
        console.warn(`[AI-ANALYST] Model ${activeProvider}/${activeModel} unavailable (${errMessage}). Falling back to best available free model.`);
        if (options?.onToken) {
          try {
            options.onToken(`\n*(Notice: ${activeProvider}/${activeModel} unavailable. Falling back to Ty-Code Free)*\n\n`);
          } catch {}
        }
        activeProvider = 'ty-code-free';
        activeModel = 'google/gemma-4-31b-it:free';
        responseText = await ProviderGateway.sendChatRequest(
          activeProvider,
          activeModel,
          messages,
          true,
          undefined,
          onToken,
          0,
          options?.abortSignal,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'debugger'
        );
      } else {
        throw initialErr;
      }
    }

    const completedAt = Date.now();
    const rawText = (responseText || '').trim();

    if (!rawText) throw new Error('model returned an empty response');

    const { results, parseMode } = parseFallback(role, rawText);
    return { role, provider: activeProvider, model: activeModel, durationMs: completedAt - startedAt, parseMode, results, rawText };
  } catch (error) {
    const failure = await reportGenerationFailure(role, provider, model, options ?? {}, error);
    failure.durationMs = Date.now() - startedAt;
    return failure;
  }
}

export const aiAnalyst = { generateRoleBasedReport, summarizeForContext };
