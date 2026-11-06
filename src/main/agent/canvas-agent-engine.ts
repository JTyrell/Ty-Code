/**
 * Canvas Agent Engine (M3E Canvas overhaul)
 *
 * The UI-generation agent behind the Canvas window's shared chat. It intercepts
 * prompts originating from the Canvas chat, builds a platform-specific system
 * prompt (React/Tailwind, React Native, Flutter, SwiftUI), runs the request
 * through the multi-provider gateway with the current canvas tree as context,
 * parses the response into CanvasNode JSON (with raw-code fallback for the
 * Code Preview tab) and pushes the result to every window via the
 * CanvasSyncManager (renderer-push equivalent of 'canvas:update-state' /
 * 'main:sync-message', which are ipcMain.handle channels).
 */

import { canvasSyncManager, type CanvasComponentNode } from '../services/canvas-sync-manager';
import type { CanvasPlatform } from '../services/canvas-sync-manager';
import { settingsManager } from '../services/settings-manager';
import { extractDesignSystem, type DesignProfile } from '../services/context-engine/design-system-extractor';
import { getOrScanWorkspaceProfile } from '../services/context-engine/workspace-scanner';
import type { WorkspaceProfile } from '../services/context-engine/types';
import { onCorrectionAdded, computeWorkspaceHash, type CorrectionEvent, getCorrections } from '../services/context-engine/correction-memory';
import { workspaceCache, workspaceCacheKey, WORKSPACE_CACHE_TTL_MS } from '../services/workspace-cache-service';
import { CANVAS_TARGET_PROMPTS } from './canvas-platform-prompts';

const liveCanvasCorrections = new Map<string, Set<string>>();

export function getCanvasLiveCorrections(workspacePathOrHash: string): string[] {
  const hash = computeWorkspaceHash(workspacePathOrHash);
  return Array.from(liveCanvasCorrections.get(hash) || []);
}

// Global Correction Hook: Live sync across all surfaces
onCorrectionAdded((event: CorrectionEvent) => {
  const { workspaceHash, rule, surface } = event;
  console.log(`[CanvasAgentEngine] Live learned rule registered (${surface}): "${rule}"`);
  let set = liveCanvasCorrections.get(workspaceHash);
  if (!set) {
    set = new Set<string>();
    liveCanvasCorrections.set(workspaceHash, set);
  }
  set.add(rule);
});

// ---------------------------------------------------------------------------
// EXACT system prompt templates per target platform
// ---------------------------------------------------------------------------

// Prompt templates are sourced from a single file — `canvas-platform-prompts.ts`
// — shared by the chat and the export orchestrator. These legacy tables preserve
// the EXACT prior `CANVAS_SYSTEM_PROMPTS` / `CANVAS_LANGUAGE_FOR_PLATFORM`
// behavior (web/other -> React web, react -> React Native) so existing chat output
// and every prompt contract string stay byte-identical (golden-tested in CI).
export const CANVAS_SYSTEM_PROMPTS: Record<CanvasPlatform, string> = {
  web: CANVAS_TARGET_PROMPTS['react-web'],
  react: CANVAS_TARGET_PROMPTS['react-native'],
  flutter: CANVAS_TARGET_PROMPTS.flutter,
  swiftui: CANVAS_TARGET_PROMPTS.swiftui,
  other: CANVAS_TARGET_PROMPTS['react-web']
};

export const CANVAS_LANGUAGE_FOR_PLATFORM: Record<CanvasPlatform, string> = {
  web: 'tsx',
  react: 'tsx',
  flutter: 'dart',
  swiftui: 'swift',
  other: 'tsx'
};

/**
 * Builds project-native design system and framework rules constraints
 * for injection into the Canvas AI system prompt.
 */
export function buildProjectDesignPrompt(
  designProfile: DesignProfile | null,
  workspaceProfile: WorkspaceProfile | null,
  learnedRules: string[] = []
): string {
  const colorStrings =
    designProfile && Object.keys(designProfile.colors).length > 0
      ? Object.entries(designProfile.colors)
          .map(([name, hex]) => `${name}: ${hex}`)
          .join(', ')
      : 'primary: #a855f7, secondary: #6366f1, background: #0f172a, foreground: #f8fafc, accent: #10b981';

  const uiLibrary = designProfile?.uiLibrary || 'shadcn/ui';
  const componentList =
    designProfile?.components && designProfile.components.length > 0
      ? designProfile.components.map((c) => c.name).join(', ')
      : 'Button, Card, Input, Badge, Dialog';

  const framework =
    designProfile?.framework ||
    (workspaceProfile?.frameworks && workspaceProfile.frameworks.length > 0
      ? workspaceProfile.frameworks[0]
      : 'React');

  const routerType =
    designProfile?.routerType ||
    (workspaceProfile?.architecture?.toLowerCase().includes('monorepo') ? 'app-router' : workspaceProfile?.architecture || 'app-router');

  const isAppRouter =
    routerType.toLowerCase().includes('app') ||
    framework.toLowerCase().includes('next') ||
    (workspaceProfile?.frameworks || []).some((f) => f.toLowerCase().includes('next'));

  const directiveNote = isAppRouter
    ? " Ensure all generated components include the correct directives (e.g., 'use client' for Next.js App Router interactive components)."
    : '';

  let rulesBlock = '';
  if (learnedRules.length > 0) {
    const formattedRules = learnedRules.map((rule) => {
      let r = rule;
      const lower = rule.toLowerCase();
      if (lower.includes('lucide-react') && (lower.includes('icons') || lower.includes('react-icons'))) {
        r = 'Always use `lucide-react` for icons; NEVER import or generate `react-icons`.';
      }
      return `- ${r}`;
    }).join('\n');
    rulesBlock = `\n\n[UNIVERSAL LEARNED WORKSPACE RULES (MANDATORY)]\n${formattedRules}\nYou MUST strictly adhere to all learned rules above. For example, if a rule specifies 'Always use lucide-react for icons', you MUST NEVER import or use 'react-icons' or any other icon library.`;
  }

  return (
    `\n\n[PROJECT DESIGN SYSTEM]\n` +
    `You MUST use the following Tailwind theme colors: ${colorStrings}.\n` +
    `You MUST use the following base components from ${uiLibrary}: ${componentList}.\n` +
    `Do NOT invent new CSS classes if a Tailwind utility or base component exists.\n\n` +
    `[FRAMEWORK RULES]\n` +
    `This project uses ${framework} (${routerType}).${directiveNote}` +
    rulesBlock
  );
}

// ---------------------------------------------------------------------------
// Response parsing (exact code, strict requirement #4)
// ---------------------------------------------------------------------------

const CANVAS_NODE_TYPES = new Set([
  'container', 'card', 'button', 'text', 'input', 'image', 'checkbox', 'switch', 'progress', 'divider', 'avatar'
]);

const DEFAULT_NODE_SIZE: Record<string, { width: number; height: number }> = {
  button: { width: 128, height: 38 },
  input: { width: 220, height: 38 },
  text: { width: 140, height: 24 },
  image: { width: 180, height: 130 },
  card: { width: 260, height: 170 },
  container: { width: 320, height: 220 },
  divider: { width: 220, height: 3 },
  avatar: { width: 44, height: 44 },
  switch: { width: 46, height: 26 },
  checkbox: { width: 22, height: 22 },
  progress: { width: 210, height: 8 }
};

const autoPlaceSlot = (index: number): { x: number; y: number } => ({
  x: 24 + (index % 3) * 200,
  y: 24 + Math.floor(index / 3) * 140
});

/** Runnable code may exist via protocol even if tree parse failed. */
export interface ExtractedCode {
  language: string;
  code: string;
}

interface FencedBlock {
  language: string | null;
  body: string;
}

function extractFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const pattern = /```([a-zA-Z0-9_+#.-]*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push({ language: match[1] ? match[1].trim().toLowerCase() : null, body: match[2] });
  }
  return blocks;
}

/** Picks the runnable code block (tsx/dart/swift) matching the platform. */
export function extractRunnableCode(text: string, platform: CanvasPlatform): ExtractedCode {
  const wanted = CANVAS_LANGUAGE_FOR_PLATFORM[platform] ?? 'tsx';
  const aliases: Record<string, string[]> = {
    tsx: ['tsx', 'jsx', 'typescriptreact', 'javascriptreact', 'ts', 'js'],
    dart: ['dart'],
    swift: ['swift']
  };
  const blocks = extractFencedBlocks(text);
  const runnableAliases = aliases[wanted] ?? ['tsx', 'jsx'];
  for (const block of blocks) {
    if (block.language && runnableAliases.includes(block.language)) {
      return { language: block.language, code: block.body.trim() };
    }
  }
  const firstNonTycode = blocks.find((block) => block.language !== 'tycode') ?? blocks[0];
  if (firstNonTycode) return { language: firstNonTycode.language || wanted, code: firstNonTycode.body.trim() };
  return { language: wanted, code: text.replace(/```[a-zA-Z0-9_+#.-]*\s*\n([\s\S]*?)```/g, '$1').trim() };
}

/** Reads the protocol JSON block ("tycode" fence, or JSON with canvas/tycode/node-array keys). */
export function extractCanvasProtocol(text: string): unknown {
  const blocks = extractFencedBlocks(text);
  const candidates = blocks.filter((block) => block.language === 'tycode' || !block.language);
  for (const block of candidates) {
    const parsed = safeJsonParse(block.body.trim());
    if (parsed === undefined) continue;
    for (const candidate of [parsed, (asRecord(parsed)).canvas, (asRecord(parsed)).tycode, (asRecord(parsed)).nodes]) {
      if (Array.isArray(candidate)) return candidate;
    }
  }
  for (const raw of text.match(/"canvas"\s*:\s*(\[[\s\S]*?\])\s*\}/g) ?? []) {
    const parsed = safeJsonParse(raw.replace(/"canvas"\s*:\s*/, '').replace(/\}\s*$/, ''));
    if (Array.isArray(parsed)) return parsed;
  }
  return undefined;
}

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Protocol JSON -> CanvasNode[] (exact conversion the frontend renders). */
export function coerceCanvasNodesFromJson(raw: unknown): CanvasComponentNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: CanvasComponentNode[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const rawType = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    const type = CANVAS_NODE_TYPES.has(rawType) ? rawType : 'container';
    const propsRaw = asRecord(record.props);
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(propsRaw)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        props[key] = typeof value === 'string' && value.length > 400 ? value.slice(0, 400) : value;
      }
    }
    const size = DEFAULT_NODE_SIZE[type] ?? DEFAULT_NODE_SIZE.container;
    const slot = autoPlaceSlot(index);
    nodes.push({
      id: `node_${globalThis.crypto.randomUUID()}`,
      type,
      props: {
        x: slot.x,
        y: slot.y,
        width: typeof props.width === 'number' ? props.width : size.width,
        height: typeof props.height === 'number' ? props.height : size.height,
        ...props
      },
      children: coerceCanvasNodesFromJson(record.children)
    });
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Heuristic fallback: pull nodes straight out of runnable code
// ---------------------------------------------------------------------------

interface ElementMatch {
  type: string;
  props: Record<string, unknown>;
}

const TAILWIND_COLORS: Record<string, string> = {
  purple: '#a855f7', violet: '#8b5cf6', indigo: '#6366f1', blue: '#3b82f6',
  emerald: '#10b981', green: '#22c55e', amber: '#f59e0b', orange: '#f97316',
  red: '#ef4444', pink: '#ec4899', cyan: '#22d3ee', teal: '#14b8a6'
};

const FLUTTER_COLORS: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ef4444', green: '#22c55e',
  blue: '#3b82f6', purple: '#a855f7', deepPurple: '#673ab7', indigo: '#6366f1',
  amber: '#f59e0b', orange: '#f97316', teal: '#14b8a6', grey: '#6b7280',
  transparent: '#1e1b29'
};

const SNAKE_TO_LABEL = (input: string): string =>
  input.replace(/[_-]/g, ' ').trim() || 'Sample';

const hexFromSources = (sources: string[]): string | undefined => {
  for (const source of sources) {
    const hex = source.match(/#([0-9a-fA-F]{6})\b/);
    if (hex) return `#${hex[1].toLowerCase()}`;
    const colorName = source.match(/Colors\.([a-zA-Z]+)/);
    if (colorName && FLUTTER_COLORS[colorName[1]]) return FLUTTER_COLORS[colorName[1]];
    const tailwind = source.match(/(?:bg|text)-(?:\[([^\]]+)\]|([a-z]+)(?:-\d+)?)/);
    if (tailwind && (tailwind[1] || TAILWIND_COLORS[tailwind[2]])) {
      return tailwind[1] ?? TAILWIND_COLORS[tailwind[2]];
    }
  }
  return undefined;
};

/** Fallback JSX/dart tag parser (exact code, strict requirement #4). */
export function parseCodeToCanvasNodes(code: string, platform: CanvasPlatform): CanvasComponentNode[] {
  const elements: ElementMatch[] = [];
  const push = (type: string, props: Record<string, unknown>): void => {
    const size = DEFAULT_NODE_SIZE[type] ?? DEFAULT_NODE_SIZE.container;
    const slot = autoPlaceSlot(elements.length);
    elements.push({
      type,
      props: { x: slot.x, y: slot.y, width: size.width, height: size.height, ...props }
    });
  };

  const tagPattern = /<(div|section|button|input|img|p|span|h1|h2|h3|Text|TextInput|Image|View|TextBox|ElevatedButton|FilledButton|TextButton|Container|TextField)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagPattern.exec(code)) !== null) {
    const rawTag = tag[1];
    const attributes = tag[2] ?? '';
    const inner = tag[3] ?? '';
    switch (rawTag.toLowerCase()) {
      case 'button':
      case 'elevatedbutton':
      case 'filledbutton':
      case 'textbutton':
        push('button', {
          text: inner.replace(/<[^>]+>/g, '').trim() || SNAKE_TO_LABEL(rawTag),
          color: hexFromSources([attributes, inner]),
          textColor: hexFromSources([inner.match(/text-\[?([^\s"\]\)]+)/)?.[0] ?? ''])
        });
        break;
      case 'input':
      case 'textinput':
      case 'textfield':
        push('input', { text: attributes.match(/placeholder="([^"]*)"/)?.[1] ?? 'Placeholder…' });
        break;
      case 'img':
      case 'image':
        push('image', {});
        break;
      case 'p':
      case 'span':
      case 'h1':
      case 'h2':
      case 'h3':
        push('text', { text: inner.replace(/<[^>]+>/g, '').trim() });
        break;
      case 'text':
        push('text', { text: inner.trim() });
        break;
      case 'div':
      case 'section':
      case 'view':
      case 'container':
        push('container', { color: hexFromSources([attributes]) });
        break;
      default:
        break;
    }
  }

  // Dart-only pull-ins (the tag pattern misses Text('...') calls with quotes).
  const dartText = platform === 'flutter' ? /Text\(\s*'([^']{1,120})'/.exec(code) ?? /Text\(\s*"([^"]{1,120})"/.exec(code) : null;
  if (dartText && !elements.some((element) => element.type === 'text')) {
    push('text', { text: dartText[1] });
  }

  const nodes: CanvasComponentNode[] = elements.map((element) => ({
    id: `node_${globalThis.crypto.randomUUID()}`,
    type: element.type,
    props: { ...element.props },
    children: []
  }));

  // First container becomes the root wrapper hosting the rest (visual tree).
  if (nodes.length > 1) {
    const [root, ...rest] = nodes;
    if (root.type === 'container') {
      root.children = rest.map((node) => ({ ...node, props: { ...node.props } }));
      return [root];
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface CanvasAgentGenerationResult {
  ok: boolean;
  platform: CanvasPlatform;
  code?: string;
  language?: string;
  nodesPushed?: number;
  replaced?: boolean;
  summary?: string;
  error?: string;
}

export interface CanvasAgentRunOptions {
  runId?: string;
  onToken?: (content: string) => void;
  abortSignal?: AbortSignal;
  workspaceRoot?: string;
}

/** Deterministic action label for the main-chat canvas-update notification. */
export const deriveCanvasAction = (prompt: string): string => {
  const p = prompt.toLowerCase();
  if (/\b(blue|red|green|purple|color|colou?r|gradient|palette|theme)\b/.test(p) && /\bbutton\b/.test(p)) {
    return 'updated_button_color';
  }
  if (/\b(button|cta)\b/.test(p)) return 'updated_button';
  if (/\b(larger|bigger|smaller|size|padding|spacing|layout|grid|row|column)\b/.test(p)) return 'updated_layout';
  if (/\b(text|label|title|heading|copy)\b/.test(p)) return 'updated_text';
  if (/\bscreen\b|\bpage\b/.test(p)) return 'generated_screen';
  return 'updated_ui';
};

export const isModifyIntent = (prompt: string): boolean =>
  /\b(modify|update|change|edit|adjust|restyle|restyle|rework|redesign|improve|existing|current|this|that|layout|button|screen|page|component)\b/i.test(prompt);

export class CanvasAgentEngine {
  /** Entry point invoked by the Canvas window chat via 'canvas:chat-send'. */
  async generate(
    prompt: string,
    options: CanvasAgentRunOptions | AbortSignal | undefined = {}
  ): Promise<CanvasAgentGenerationResult> {
    const opts: CanvasAgentRunOptions =
      options instanceof AbortSignal ? { abortSignal: options } : options ?? {};
    const { onToken } = opts;
    const snapshot = canvasSyncManager.getSnapshot();
    const platform: CanvasPlatform = snapshot.activePlatform;

    if (!prompt.trim()) {
      return { ok: false, platform, error: 'Empty canvas prompt.' };
    }

    let provider = 'openrouter';
    let model = 'google/gemma-4-26b-a4b-it:free';
    try {
      const { ProviderGateway } = await import('../providers/provider-gateway');
      const active = typeof ProviderGateway.getActiveModel === 'function' ? ProviderGateway.getActiveModel() : null;
      if (active && (active.isAutoMode || (active.providerId && active.modelId))) {
        provider = active.isAutoMode ? 'auto' : active.providerId;
        model = active.isAutoMode ? 'Auto' : active.modelId;
      } else {
        const settings = await settingsManager.getEffectiveSettings();
        provider = (settings?.activeProvider as string) || provider;
        model = settings?.activeModel ? String(settings.activeModel) : model;
      }
      if (provider === 'openkilo' && !(model.endsWith(':free') || model.endsWith('/free'))) {
        model = 'kilo-auto/free';
      }
    } catch {
      // Defaults hold.
    }

    // Stage 7a: the expensive design-system + workspace extraction and
    // persistent-rule load are memoized per root through the shared workspace
    // cache singleton (same instance the Debugger uses in 6b), so a restyle on a
    // warm workspace skips re-scanning. Reused verbatim by the export
    // orchestrator so an export never triggers a fresh FS walk on a warm cache
    // (Prompt 4 extension, amendment 2).
    const projectDesignPrompt = await buildCanvasProjectDesignPrompt(opts.workspaceRoot || process.cwd());

    const basePrompt = CANVAS_SYSTEM_PROMPTS[platform] ?? CANVAS_TARGET_PROMPTS['react-web'];
    const systemPrompt = platform === 'web' || platform === 'other'
      ? `${basePrompt}${projectDesignPrompt}`
      : basePrompt;

    const currentTree = snapshot.canvasComponents;
    const modify = isModifyIntent(prompt) || currentTree.length > 0;

    const messages: Array<Record<string, string>> = [
      { role: 'system', content: systemPrompt }
    ];
    if (currentTree.length > 0) {
      messages.push({
        role: 'system',
        content:
          `CURRENT CANVAS TREE (${platform}, ${currentTree.length} nodes):\n` +
          JSON.stringify(currentTree) +
          (modify ? '\nThe user asks to restyle/modify this UI — return the COMPLETE updated tree.' : '')
      });
    }
    messages.push({ role: 'user', content: prompt });

    let response: string;
    try {
      response = await this.callGateway(provider, model, messages, onToken, opts.abortSignal);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[CANVAS] Model ${provider}/${model} failed (${error}); falling back to free tier.`);
      const isUnavailable = /KEY_MISSING_ERROR|key required|unavailable|429|500|502|503/i.test(error);
      if (isUnavailable) {
        if (onToken) {
          try {
            onToken(`\n*(Notice: ${provider}/${model} unavailable; falling back to Ty-Code Free)*\n\n`);
          } catch {}
        }
        // Stage 7b: emit the fallback notice once. When a streaming relay is
        // present the token notice above already surfaced it in-chat, so skip
        // the separate pushMessage to avoid a double-emit.
        if (!onToken) {
          canvasSyncManager.pushMessage({
            id: `canvas_fallback_${globalThis.crypto.randomUUID()}`,
            role: 'assistant',
            content: `⚠️ Model \`${provider}/${model}\` is unavailable. Falling back to Ty-Code Free.`,
            timestamp: Date.now(),
            origin: 'canvas'
          });
        }
        try {
          response = await this.callGateway('ty-code-free', 'google/gemma-4-26b-a4b-it:free', messages, onToken, opts.abortSignal);
        } catch (fallbackErr: unknown) {
          const fbError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          return { ok: false, platform, error: `Canvas generation failed: ${fbError}` };
        }
      } else {
        return { ok: false, platform, error: `Canvas generation failed: ${error}` };
      }
    }

    const runnable = extractRunnableCode(response, platform);
    const protocolNodes = coerceCanvasNodesFromJson(extractCanvasProtocol(response));

    const hasProtocolTree = protocolNodes.length > 0;
    const nodes = hasProtocolTree ? protocolNodes : parseCodeToCanvasNodes(runnable.code, platform);

    let nodesHaveBeenPushed = 0;
    let summary: string;

    if (nodes.length > 0) {
      canvasSyncManager.pushStateUpdate({
        canvasComponents: nodes,
        activePlatform: platform,
        reason: 'canvas-agent-generation'
      });
      nodesHaveBeenPushed = nodes.length;
    }

    if (nodes.length > 0) {
      summary =
        `🎨 Canvas updated for ${platform} — ${nodesHaveBeenPushed} component${nodesHaveBeenPushed === 1 ? '' : 's'} generated ` +
        `(replaced ${currentTree.length} previous node${currentTree.length === 1 ? '' : 's'}). ` +
        'Code is available in the Code Preview tab.';
      // Notify the MAIN window chat (bidirectional sync, collapsible message).
      canvasSyncManager.pushMainChatUpdate({
        action: deriveCanvasAction(prompt),
        codeSnippet: runnable.code,
        platform,
        updatedAt: Date.now()
      });
    } else {
      summary =
        `🧩 Generated ${platform} code but could not map it to visual canvas nodes ` +
        '(model skipped the tycode JSON protocol). Raw code is in the Code Preview tab — the canvas keeps your current layout.';
    }

    const summaryMessage = {
      id: `canvas_agent_${globalThis.crypto.randomUUID()}`,
      role: 'assistant' as const,
      content: summary,
      timestamp: Date.now(),
      origin: 'canvas' as const
    };
    canvasSyncManager.pushMessage(summaryMessage);

    return {
      ok: true,
      platform,
      code: runnable.code,
      language: runnable.language,
      nodesPushed: nodesHaveBeenPushed,
      replaced: nodesHaveBeenPushed > 0,
      summary
    };
  }

  private async callGateway(
    provider: string,
    model: string,
    messages: Array<Record<string, string>>,
    onToken?: (content: string) => void,
    abortSignal?: AbortSignal
  ): Promise<string> {
    // Larger context windows: the full canvas tree JSON lives inside the
    // messages array, passed verbatim (no truncation) to sendChatRequest.
    // Streaming keeps the Canvas chat UI live as tokens arrive.
    const { ProviderGateway } = await import('../providers/provider-gateway');
    return ProviderGateway.sendChatRequest(
      provider,
      model,
      messages,
      true,
      undefined,
      onToken
        ? (chunk: string) => {
            try {
              onToken(chunk);
            } catch {
              // UI update failures must never break the generation run.
            }
          }
        : undefined,
      0,
      abortSignal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'canvas'
    );
  }
}

export const canvasAgentEngine = new CanvasAgentEngine();

/**
 * Build the project design-system + learned-rules block for a workspace,
 * memoized through the shared `workspaceCache` singleton (Stages 6b/7a). Live,
 * in-session corrections are still layered fresh on top of the cached base.
 * Shared by `generate()` and the export orchestrator (amendment 2).
 */
export async function buildCanvasProjectDesignPrompt(workspaceRoot: string): Promise<string> {
  try {
    const hash = computeWorkspaceHash(workspaceRoot);
    const extracted = await workspaceCache.getOrCompute(
      workspaceCacheKey(workspaceRoot, 'canvas-design-prompt'),
      WORKSPACE_CACHE_TTL_MS,
      async () => {
        const [designProfile, workspaceProfile, persistentRules] = await Promise.all([
          extractDesignSystem(workspaceRoot).catch(() => null),
          getOrScanWorkspaceProfile(workspaceRoot).catch(() => null),
          getCorrections(workspaceRoot).catch(() => [] as string[])
        ]);
        return { designProfile, workspaceProfile, persistentRules };
      }
    );
    const liveRules = Array.from(liveCanvasCorrections.get(hash) || []);
    const allRules = Array.from(new Set([...extracted.persistentRules, ...liveRules]));
    return buildProjectDesignPrompt(extracted.designProfile, extracted.workspaceProfile, allRules);
  } catch {
    return '';
  }
}
