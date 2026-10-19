/**
 * Remediation Report Engine (Phase Diagnostics 3)
 *
 * Produces a prioritized, plain-language checklist of exactly what is needed
 * to make Ty-Code work when any diagnostic or capability test fails.
 *
 * Requirements:
 * 1. WORKING NOW: providers/models that passed (so user can start immediately)
 * 2. MISSING FROM YOU: items only user can supply (API keys, settings) with direct links
 * 3. MISSING FROM CODE: bugs the AI coder must fix (e.g. FORMAT_MISMATCH in sse-parser) with file/line evidence
 * 4. EXTERNAL OUTAGE: providers down right now, with expected recovery and fallbacks
 * 5. RECOMMENDED NEXT ACTION: single highest-value step
 * 6. AI CODER HANDOFF PROMPT: Self-contained copyable template for the building agent
 * 7. NO DEAD ENDS: Every code maps to actionable steps, status URLs, and retry schedules
 *
 * Brand: Ty-Code
 */

import fs from 'fs/promises';
import path from 'path';
import { diagnosticService } from './diagnostic-service';
import { capabilitySuite } from './capability-suite';
import type {
  DiagnosticErrorCode,
  DiagnosticRunSummary,
  CapabilitySuiteSummary,
  RemediationReport,
  RemediationCategory,
  WorkingNowItem,
  MissingFromYouItem,
  MissingFromCodeItem,
  ExternalOutageItem,
  RecommendedAction,
  ProviderDiagnosticResult,
  ScenarioResult
} from '../../../shared/types/diagnostics';

export const PROVIDER_STATUS_URLS: Record<string, string> = {
  'openrouter-free': 'https://status.openrouter.ai',
  'openrouter': 'https://status.openrouter.ai',
  'groq-free': 'https://groqstatus.com',
  'groq': 'https://groqstatus.com',
  'together-ai-free': 'https://status.together.ai',
  'together': 'https://status.together.ai',
  'fireworks-ai-free': 'https://status.fireworks.ai',
  'fireworks': 'https://status.fireworks.ai',
  'huggingface-free': 'https://status.huggingface.co',
  'huggingface': 'https://status.huggingface.co',
  'google-ai-studio-free': 'https://status.cloud.google.com',
  'anthropic-claude-free': 'https://status.anthropic.com',
  'openkilo-free': 'https://openkilo.com',
  'openkilo': 'https://openkilo.com',
  'ollama': 'http://localhost:11434'
};

export function getCategoryForCode(code: DiagnosticErrorCode | string): RemediationCategory {
  switch (code) {
    case 'FORMAT_MISMATCH':
    case 'TIMEOUT':
      return 'code';
    case 'PROVIDER_DOWN':
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      return 'outage';
    case 'NETWORK_BLOCKED':
      return 'network';
    case 'CONFIG_MISSING':
    case 'CONFIG_INVALID':
    case 'MODEL_UNAVAILABLE':
    default:
      return 'config';
  }
}

export class RemediationEngine {
  private static instance: RemediationEngine;
  private latestReport: RemediationReport | null = null;

  public static getInstance(): RemediationEngine {
    if (!RemediationEngine.instance) {
      RemediationEngine.instance = new RemediationEngine();
    }
    return RemediationEngine.instance;
  }

  /**
   * Generates the self-contained AI Coder Handoff prompt block.
   * Template:
   * "Ty-Code diagnostics failed with: <CODE> at <step>. Evidence: <raw chunk>. Provider: <id>, model: <model>. Required fix category: <config|code|network|outage>. Propose the minimal fix, apply it if it is a code fix within src/, and re-run diagnostics to confirm PASS."
   */
  public formatAiCoderHandoff(params: {
    code: DiagnosticErrorCode | string;
    step: string;
    evidence: string;
    providerId: string;
    modelId: string;
    category: RemediationCategory;
  }): string {
    const rawChunk = (params.evidence || 'No raw evidence chunk captured').trim();
    return (
      `Ty-Code diagnostics failed with: ${params.code} at ${params.step}. ` +
      `Evidence: ${rawChunk}. ` +
      `Provider: ${params.providerId}, model: ${params.modelId}. ` +
      `Required fix category: ${params.category}. ` +
      `Propose the minimal fix, apply it if it is a code fix within src/, and re-run diagnostics to confirm PASS.`
    );
  }

  /**
   * Analyzes connection diagnostic results and capability test results
   * to produce the prioritized 5-section plain-language remediation report.
   */
  public generateRemediationReport(
    connSummary?: DiagnosticRunSummary | null,
    capSummary?: CapabilitySuiteSummary | null,
    workspaceRoot: string = process.cwd()
  ): RemediationReport {
    const conn = connSummary || diagnosticService.getLatestSummary();
    const cap = capSummary || capabilitySuite.getLatestSummary();

    const workingNow: WorkingNowItem[] = [];
    const missingFromYou: MissingFromYouItem[] = [];
    const missingFromCode: MissingFromCodeItem[] = [];
    const externalOutage: ExternalOutageItem[] = [];

    // 1. Process Connection Diagnostic Results
    if (conn?.results) {
      for (const res of conn.results) {
        if (res.status === 'PASS') {
          workingNow.push({
            providerId: res.providerId,
            providerName: res.providerName,
            modelId: res.testedModel || 'default',
            authType: res.authType,
            latencyMs: res.timeToFirstTokenMs,
            readyImmediately: true,
            notes: `${res.timeToFirstTokenMs ? `${res.timeToFirstTokenMs}ms TTFT` : 'Operational'} - Streaming & tool-calling verified`
          });
        } else if (res.status === 'FAIL') {
          this.classifyFailureItem(res, missingFromYou, missingFromCode, externalOutage);
        }
      }
    }

    // 2. Process Capability Suite Results
    if (cap?.scenarios) {
      for (const sc of cap.scenarios) {
        if (sc.status === 'FAIL' && sc.evidence) {
          const fakeResult: Partial<ProviderDiagnosticResult> = {
            providerId: sc.evidence.providerId,
            providerName: sc.evidence.providerId,
            errorCode: sc.evidence.taxonomyCode,
            failedStep: sc.evidence.failedStep as any,
            humanMessage: sc.evidence.errorMessage || sc.prompt,
            remedy: `Capability scenario '${sc.id}' failed: ${sc.passCriteria}`,
            rawEvidence: sc.evidence.rawResponseBytes,
            testedModel: sc.evidence.modelId
          };
          this.classifyFailureItem(fakeResult as ProviderDiagnosticResult, missingFromYou, missingFromCode, externalOutage);
        }
      }
    }

    // Providers only appear in workingNow when a real diagnostic test in this
    // run proved them operational. No fabricated "ready immediately" entries.

    // Determine the single highest-value recommended next action
    const recommendedNextAction = this.determineRecommendedAction(
      workingNow,
      missingFromYou,
      missingFromCode,
      externalOutage
    );

    // Compute working path explanation (guarantee: always lists working path or explains why none exists)
    let workingPathExplanation: string;
    if (workingNow.length > 0) {
      workingPathExplanation = `${workingNow.length} operational provider(s) ready immediately: ${workingNow
        .map((w) => `${w.providerName} (${w.modelId})`)
        .join(', ')}.`;
    } else {
      const topIssues = [
        ...missingFromYou.map((m) => `${m.providerName}: ${m.issue}`),
        ...missingFromCode.map((c) => `${c.providerName}: ${c.issue}`),
        ...externalOutage.map((o) => `${o.providerName}: ${o.details}`)
      ].slice(0, 3).join(' | ');

      workingPathExplanation = `No operational provider paths currently available. Causes: ${
        topIssues || 'No providers configured or tested'
      }. Action needed: Add an API key in Settings > Providers or start local Ollama on http://localhost:11434.`;
    }

    // Primary AI coder handoff block: pick the top code issue or primary failure
    const primaryHandoffItem =
      missingFromCode[0] ||
      (missingFromYou[0]
        ? {
            code: missingFromYou[0].code,
            failedStep: 'auth',
            evidence: missingFromYou[0].issue,
            providerId: missingFromYou[0].providerId,
            modelId: 'default',
            category: getCategoryForCode(missingFromYou[0].code)
          }
        : externalOutage[0]
          ? {
              code: externalOutage[0].code,
              failedStep: 'streaming',
              evidence: externalOutage[0].details,
              providerId: externalOutage[0].providerId,
              modelId: 'default',
              category: 'outage' as RemediationCategory
            }
          : {
              code: 'ALL_PASS' as DiagnosticErrorCode,
              failedStep: 'none',
              evidence: 'All tested providers and capabilities operational',
              providerId: workingNow[0]?.providerId || 'openkilo-free',
              modelId: workingNow[0]?.modelId || 'kilo-1',
              category: 'config' as RemediationCategory
            });

    const aiCoderHandoffPrompt = this.formatAiCoderHandoff({
      code: (primaryHandoffItem as any).code || 'CONFIG_MISSING',
      step: (primaryHandoffItem as any).failedStep || 'auth',
      evidence: (primaryHandoffItem as any).evidenceChunk || (primaryHandoffItem as any).evidence || 'Diagnostics failure',
      providerId: primaryHandoffItem.providerId,
      modelId: (primaryHandoffItem as any).modelId || 'default',
      category: (primaryHandoffItem as any).category || getCategoryForCode((primaryHandoffItem as any).code)
    });

    const hasFailures = missingFromYou.length > 0 || missingFromCode.length > 0 || externalOutage.length > 0;

    const report: RemediationReport = {
      timestamp: Date.now(),
      hasFailures,
      workingNow,
      missingFromYou,
      missingFromCode,
      externalOutage,
      recommendedNextAction,
      aiCoderHandoffPrompt,
      markdownReport: '',
      workingPathExplanation
    };

    report.markdownReport = this.renderMarkdownReport(report);

    // Auto-write to docs/DIAGNOSTIC-REPORT.md
    void this.persistReport(report, workspaceRoot);

    this.latestReport = report;
    return report;
  }

  /**
   * Categorizes a failure into the proper remediation bucket.
   */
  private classifyFailureItem(
    res: ProviderDiagnosticResult,
    missingFromYou: MissingFromYouItem[],
    missingFromCode: MissingFromCodeItem[],
    externalOutage: ExternalOutageItem[]
  ): void {
    const code = res.errorCode || 'NETWORK_BLOCKED';
    const providerId = res.providerId;
    const providerName = res.providerName || providerId;
    const modelId = res.testedModel || 'default';
    const rawChunk = (res.rawEvidence || res.remedy || '').slice(0, 2048);

    // 1. MISSING FROM CODE (FORMAT_MISMATCH, TIMEOUT)
    if (code === 'FORMAT_MISMATCH') {
      const targetFile = 'src/main/providers/sse-parser.ts';
      const targetLine = 410;
      missingFromCode.push({
        id: `code_${providerId}_${Date.now()}`,
        providerId,
        providerName,
        code,
        issue: `Provider response format changed for ${providerName}; SSE or tool call parse failure.`,
        targetFile,
        targetLine,
        fixDescription: `Update parseSSELines() in ${targetFile}:${targetLine} to handle the incoming chunk structure.`,
        evidenceChunk: rawChunk,
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'streaming',
          evidence: rawChunk,
          providerId,
          modelId,
          category: 'code'
        })
      });
      return;
    }

    if (code === 'TIMEOUT') {
      const targetFile = 'src/main/providers/provider-gateway.ts';
      missingFromCode.push({
        id: `timeout_${providerId}_${Date.now()}`,
        providerId,
        providerName,
        code,
        issue: `No first token received within 30s from ${providerName}; provider slow or hung.`,
        targetFile,
        targetLine: 380,
        fixDescription: `Adjust AbortSignal timeout or prioritize lower-latency provider in ${targetFile}.`,
        evidenceChunk: rawChunk,
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'streaming',
          evidence: rawChunk,
          providerId,
          modelId,
          category: 'code'
        })
      });
      return;
    }

    // 2. EXTERNAL OUTAGE (PROVIDER_DOWN, RATE_LIMITED, QUOTA_EXCEEDED)
    if (code === 'PROVIDER_DOWN' || code === 'RATE_LIMITED' || code === 'QUOTA_EXCEEDED') {
      const statusUrl = PROVIDER_STATUS_URLS[providerId] || 'https://status.openrouter.ai';
      const retryAfterSec = res.retryAfterSec || (code === 'RATE_LIMITED' ? 60 : 300);
      const fallback = res.suggestedFallback || 'OpenKilo (zero-config anonymous tier)';

      let nextRetrySchedule = `Auto-retry in ${retryAfterSec}s`;
      if (code === 'QUOTA_EXCEEDED') {
        nextRetrySchedule = 'Next free quota reset: midnight UTC (00:00 UTC)';
      } else if (code === 'PROVIDER_DOWN') {
        nextRetrySchedule = 'Automatic failover engaged; exponential backoff: 30s, 60s, 120s';
      }

      externalOutage.push({
        id: `outage_${providerId}_${Date.now()}`,
        providerId,
        providerName,
        code,
        statusUrl,
        retryAfterSec,
        nextRetrySchedule,
        suggestedFallback: fallback,
        details: res.remedy || `Provider outage or rate limit. Suggested fallback: ${fallback}`,
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'reachability',
          evidence: rawChunk || res.remedy || `Outage for ${providerName}`,
          providerId,
          modelId,
          category: 'outage'
        })
      });
      return;
    }

    // 3. MISSING FROM YOU (CONFIG_MISSING, CONFIG_INVALID, MODEL_UNAVAILABLE, NETWORK_BLOCKED)
    if (code === 'CONFIG_MISSING') {
      missingFromYou.push({
        id: `config_missing_${providerId}`,
        providerId,
        providerName,
        code,
        issue: `No API key configured for ${providerName}.`,
        actionText: 'Add API Key in Settings > Providers',
        actionUrl: res.actionUrl || 'https://openrouter.ai/keys',
        actionType: 'open_settings',
        settingTab: 'providers',
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'auth',
          evidence: rawChunk || `No API key configured for ${providerName}`,
          providerId,
          modelId,
          category: 'config'
        })
      });
      return;
    }

    if (code === 'CONFIG_INVALID') {
      missingFromYou.push({
        id: `config_invalid_${providerId}`,
        providerId,
        providerName,
        code,
        issue: `API key for ${providerName} was rejected (HTTP 401/403). It may be expired or revoked.`,
        actionText: `Regenerate key at ${providerName} portal`,
        actionUrl: res.actionUrl || 'https://openrouter.ai/keys',
        actionType: 'open_url',
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'auth',
          evidence: rawChunk || `API key rejected for ${providerName}`,
          providerId,
          modelId,
          category: 'config'
        })
      });
      return;
    }

    if (code === 'MODEL_UNAVAILABLE') {
      missingFromYou.push({
        id: `model_unavailable_${providerId}`,
        providerId,
        providerName,
        code,
        issue: `Selected model '${modelId}' is not available or not free on ${providerName} (HTTP 404).`,
        actionText: 'Switch to a valid free model in Settings > Providers',
        actionType: 'open_settings',
        settingTab: 'providers',
        actionUrl: res.actionUrl || 'https://openrouter.ai/models',
        aiCoderPrompt: this.formatAiCoderHandoff({
          code,
          step: res.failedStep || 'streaming',
          evidence: rawChunk || `Model ${modelId} unavailable on ${providerName}`,
          providerId,
          modelId,
          category: 'config'
        })
      });
      return;
    }

    // NETWORK_BLOCKED
    missingFromYou.push({
      id: `network_${providerId}`,
      providerId,
      providerName,
      code: 'NETWORK_BLOCKED',
      issue: `Network path to ${providerName} is blocked (${res.humanMessage || 'DNS/connection error'}).`,
      actionText: 'Check proxy/firewall and DNS settings',
      actionUrl: res.baseUrl || 'https://openrouter.ai',
      actionType: 'open_url',
      aiCoderPrompt: this.formatAiCoderHandoff({
        code: 'NETWORK_BLOCKED',
        step: res.failedStep || 'reachability',
        evidence: rawChunk || res.humanMessage || `Network path blocked to ${providerName}`,
        providerId,
        modelId,
        category: 'network'
      })
    });
  }

  /**
   * Computes the single highest-value recommended next action.
   */
  private determineRecommendedAction(
    workingNow: WorkingNowItem[],
    missingFromYou: MissingFromYouItem[],
    missingFromCode: MissingFromCodeItem[],
    externalOutage: ExternalOutageItem[]
  ): RecommendedAction {
    // 1. If any provider is working, the best action is always to start coding immediately!
    if (workingNow.length > 0) {
      const top = workingNow[0];
      return {
        title: `Start coding immediately with ${top.providerName}`,
        description: `${top.providerName} is fully operational (${top.notes || 'ready'}). You can start coding right now without waiting.`,
        category: 'config',
        actionType: 'use_provider',
        actionLabel: `Use ${top.providerName}`,
        actionTarget: top.providerId
      };
    }

    // 2. If no provider working and a code fix is needed:
    if (missingFromCode.length > 0) {
      const top = missingFromCode[0];
      return {
        title: `Fix ${top.code} in ${top.targetFile}`,
        description: `Copy the AI Coder prompt block below and paste it to the assistant to automatically patch ${top.targetFile}.`,
        category: 'code',
        actionType: 'copy_prompt',
        actionLabel: 'Copy AI Coder Prompt',
        actionTarget: top.aiCoderPrompt
      };
    }

    // 3. If missing user configuration:
    if (missingFromYou.length > 0) {
      const top = missingFromYou[0];
      return {
        title: top.actionText,
        description: `${top.providerName} requires an action from you: ${top.issue}`,
        category: 'config',
        actionType: top.actionType,
        actionLabel: top.actionText,
        actionTarget: top.actionUrl || top.settingTab
      };
    }

    // 4. If all external providers down:
    if (externalOutage.length > 0) {
      const top = externalOutage[0];
      return {
        title: `Engage fallback: ${top.suggestedFallback}`,
        description: `${top.providerName} is experiencing an outage (${top.nextRetrySchedule}). Switch to ${top.suggestedFallback}.`,
        category: 'outage',
        actionType: 'open_url',
        actionLabel: 'Check Live Status Page',
        actionTarget: top.statusUrl
      };
    }

    // Fallback: No providers configured or tested
    return {
      title: 'Run connection diagnostics',
      description: 'Click "Run All Tests" in Settings > Diagnostics to evaluate provider connectivity.',
      category: 'config',
      actionType: 'open_settings',
      actionLabel: 'Open Diagnostics',
      actionTarget: 'diagnostics'
    };
  }

  /**
   * Renders the complete markdown document matching the required 5 sections.
   */
  public renderMarkdownReport(report: RemediationReport): string {
    const lines: string[] = [];
    const dateStr = new Date(report.timestamp).toISOString();

    lines.push('# Ty-Code Remediation Report — Plain-Language "What Is Needed"');
    lines.push(`**Generated**: ${dateStr}`);
    lines.push(`**Status**: ${report.hasFailures ? 'ACTION REQUIRED' : 'ALL SYSTEMS OPERATIONAL'}`);
    lines.push('');

    // SECTION 5: RECOMMENDED NEXT ACTION (Top prominent summary)
    lines.push('## 1. RECOMMENDED NEXT ACTION (Single Highest-Value Step)');
    lines.push(`> [!IMPORTANT]`);
    lines.push(`> **${report.recommendedNextAction.title}**`);
    lines.push(`> ${report.recommendedNextAction.description}`);
    lines.push('');

    // SECTION 1: WORKING NOW
    lines.push('## 2. WORKING NOW (Providers & Models Ready Immediately)');
    if (report.workingPathExplanation) {
      lines.push(`> [!NOTE]`);
      lines.push(`> **Working Path Status**: ${report.workingPathExplanation}`);
      lines.push('');
    }
    if (report.workingNow.length === 0) {
      lines.push('*No providers are currently operational. Review the missing items below to restore connectivity.*');
    } else {
      lines.push('| Provider | Model | Auth Mode | Latency | Status |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');
      for (const w of report.workingNow) {
        lines.push(`| **${w.providerName}** | \`${w.modelId}\` | \`${w.authType}\` | ${w.latencyMs ? `${w.latencyMs}ms` : 'Fast'} | **READY TO USE** |`);
      }
    }
    lines.push('');

    // SECTION 2: MISSING FROM YOU
    lines.push('## 3. MISSING FROM YOU (User Action Required)');
    if (report.missingFromYou.length === 0) {
      lines.push('*None! All required API keys and user configurations are present.*');
    } else {
      for (const item of report.missingFromYou) {
        lines.push(`- [ ] **${item.providerName}** (\`${item.code}\`): ${item.issue}`);
        lines.push(`  - **Action Needed**: [${item.actionText}](${item.actionUrl || '#'})`);
      }
    }
    lines.push('');

    // SECTION 3: MISSING FROM CODE
    lines.push('## 4. MISSING FROM CODE (Bugs for AI Coder to Fix)');
    if (report.missingFromCode.length === 0) {
      lines.push('*None! No client-side protocol or parsing mismatches detected in src/.*');
    } else {
      for (const item of report.missingFromCode) {
        lines.push(`- **${item.providerName}** (\`${item.code}\`): ${item.issue}`);
        lines.push(`  - **Target File**: \`${item.targetFile}${item.targetLine ? `:${item.targetLine}` : ''}\``);
        lines.push(`  - **Fix Summary**: ${item.fixDescription}`);
        if (item.evidenceChunk) {
          lines.push('  - **Raw Evidence Chunk**:');
          lines.push('  ```text');
          lines.push(`  ${item.evidenceChunk.slice(0, 1000)}`);
          lines.push('  ```');
        }
      }
    }
    lines.push('');

    // SECTION 4: EXTERNAL OUTAGE
    lines.push('## 5. EXTERNAL OUTAGE (Providers Down Right Now)');
    if (report.externalOutage.length === 0) {
      lines.push('*None! All remote provider gateways are responding normally.*');
    } else {
      for (const item of report.externalOutage) {
        lines.push(`- **${item.providerName}** (\`${item.code}\`): ${item.details}`);
        lines.push(`  - **Status URL**: [${item.statusUrl}](${item.statusUrl})`);
        lines.push(`  - **Next Retry Schedule**: ${item.nextRetrySchedule}`);
        lines.push(`  - **Suggested Fallback**: \`${item.suggestedFallback}\``);
      }
    }
    lines.push('');

    // AI CODER HANDOFF PROMPT BLOCK
    lines.push('## AI Coder Handoff Prompt Block');
    lines.push('Copy and paste this block directly into the assistant chat:');
    lines.push('```text');
    lines.push(report.aiCoderHandoffPrompt);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('*Ty-Code Remediation Report Engine (Phase Diagnostics 3)*');

    return lines.join('\n');
  }

  /**
   * Persists the combined diagnostic and remediation report to docs/DIAGNOSTIC-REPORT.md
   */
  public async persistReport(report: RemediationReport, workspaceRoot: string = process.cwd()): Promise<void> {
    try {
      const docsDir = path.join(workspaceRoot, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      const reportPath = path.join(docsDir, 'DIAGNOSTIC-REPORT.md');

      // Append or prepend remediation section
      const content = report.markdownReport;
      await fs.writeFile(reportPath, content, 'utf8');
    } catch {
      // Non-blocking
    }
  }

  public getLatestReport(): RemediationReport | null {
    return this.latestReport;
  }
}

export const remediationEngine = RemediationEngine.getInstance();
