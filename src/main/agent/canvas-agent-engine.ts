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

// ---------------------------------------------------------------------------
// EXACT system prompt templates per target platform
// ---------------------------------------------------------------------------

const CANVAS_OUTPUT_PROTOCOL = `

OUTPUT PROTOCOL (mandatory):
After the code block, append ONE more fenced block: a JSON object of the EXACT UI tree you rendered:
\`\`\`tycode
{ "canvas": [
  { "type": "container",  "props": { "width": 320, "height": 220, "color": "#1e1b29" } },
  { "type": "button",     "props": { "text": "Get Started" } },
  { "type": "text",       "props": { "text": "Welcome", "fontSize": 20, "color": "#e7eaf6" } }
] }
\`\`\`
Allowed types: container, card, button, text, input, image, checkbox, switch, progress, divider, avatar.
Allowed props: width, height, text (label/placeholder), color (background), textColor, fontSize, fontWeight, borderRadius, padding, checked (checkbox/switch), value (progress 0-100). Coordinates are auto-laid-out — do NOT include x/y.
The JSON tree drives the live visual canvas — every element in your code MUST appear in it.`;

const REACT_WEB_SYSTEM_PROMPT = `You are the Ty-Code M3E Canvas generation agent for WEB (React + Tailwind CSS).
Generate a single React functional component for a Material-3-Expressive web page.

STRICT RULES:
1. Output ONLY one fenced \`\`\`tsx block with one default-export functional component. No prose before or after.
2. Styling: Tailwind CSS utility classes ONLY (no .css files, no <style>, no external UI kit imports).
3. Elements must stay simple and composable: div, section, button, input, img, p, span, h1-h6.
4. Colors: use hex values like bg-[#a855f7] / text-[#e7eaf6], or standard palette names
   (purple-500 #a855f7, purple-600 #9333ea, indigo-500 #6366f1, emerald-500 #10b981, slate-900 #0f172a).
5. Rounded, expressive surfaces (rounded-xl / rounded-2xl), generous spacing, subtle shadows.
6. No runtime dependencies: hooks from 'react' only.

Examples of correct style:
\`\`\`tsx
export default function HeroCard() {
  return (
    <div className="bg-[#1e1b29] rounded-2xl p-6 text-[#e7eaf6]">
      <button className="bg-[#a855f7] text-white rounded-xl px-4 py-2">Get Started</button>
    </div>
  );
}
\`\`\`${CANVAS_OUTPUT_PROTOCOL}`;

const REACT_NATIVE_SYSTEM_PROMPT = `You are the Ty-Code M3E Canvas generation agent for MOBILE (React Native).
Generate a single React Native functional component for a Material-3-Expressive mobile screen.

STRICT RULES:
1. Output ONLY one fenced \`\`\`tsx block with one default-export functional component. No prose before or after.
2. Imports ONLY from 'react' and 'react-native' (View, Text, TextInput, TouchableOpacity, Image, Switch, ScrollView, StyleSheet).
3. Styling via StyleSheet with flex layout and hex colors (\`backgroundColor: '#a855f7'\`); platform-safe for iOS and Android.
4. All interactive controls live inside TouchableOpacity wrappers; text ONLY inside <Text>.
5. Fonts/typography: system defaults (fontWeight/fontSize in StyleSheet), no font imports.
6. The screen must fit a phone frame (390x844) using flex column layout with padding 24.

Examples of correct style:
\`\`\`tsx
export default function HomeScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#121316', padding: 24 }}>
      <TouchableOpacity style={{ backgroundColor: '#a855f7', borderRadius: 14, paddingVertical: 12 }}>
        <Text style={{ color: '#ffffff', fontWeight: '600' }}>Get Started</Text>
      </TouchableOpacity>
    </View>
  );
}
\`\`\`${CANVAS_OUTPUT_PROTOCOL}`;

const FLUTTER_SYSTEM_PROMPT = `You are the Ty-Code M3E Canvas generation agent for MOBILE (Flutter).
Generate valid Dart code for a Material-3-Expressive Flutter screen.

STRICT RULES:
1. Output ONLY one fenced \`\`\`dart block containing a single StatefulWidget + its State class (plus minimal imports: package:flutter/material.dart). No prose before or after.
2. Only Flutter SDK widgets: Column, Row, Container, Padding, SizedBox, Card, Text, TextField, ElevatedButton, TextButton, FilledButton, Image.asset/network, Switch, Checkbox, LinearProgressIndicator, ListView.
3. Colors via Color(0xFFa855f7) hex literals or Material palette constants.
4. Expressive shapes: BorderRadius.circular(14) or .all(Radius.circular(14)); rounded surfaces.
5. No packages beyond flutter/material.dart; no generated code.

Examples of correct style:
\`\`\`dart
class HomeScreen extends StatefulWidget { const HomeScreen({super.key}); @override State<HomeScreen> createState() => _HomeScreenState(); }
class _HomeScreenState extends State<HomeScreen> {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Color(0xFF121316),
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Color(0xFFa855f7)),
            onPressed: () {},
            child: const Text('Get Started'),
          ),
        ],
      ),
    );
  }
}
\`\`\`${CANVAS_OUTPUT_PROTOCOL}`;

const SWIFTUI_SYSTEM_PROMPT = `You are the Ty-Code M3E Canvas generation agent for DESKTOP (SwiftUI).
Generate a single SwiftUI View for a Material-3-Expressive desktop window.

STRICT RULES:
1. Output ONLY one fenced \`\`\`swift block with one struct conforming to View (body: some View). No prose before or after.
2. SwiftUI SDK only: VStack, HStack, ZStack, Text, TextField, Button, Image, Toggle, ProgressView, Divider, Color.
3. Styling with modifiers (.background(Color(hex:...)), .cornerRadius(14), .padding(24)); define a hex Color extension inline if needed.
4. macOS desktop layout with clear vertical rhythm and spacing helpers.
5. No third-party imports; @State allowed.

Examples of correct style:
\`\`\`swift
struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            Button("Get Started") {}
                .buttonStyle(.borderedProminent)
        }
        .padding(24)
        .background(Color(red: 0.07, green: 0.07, blue: 0.09))
    }
}
\`\`\`${CANVAS_OUTPUT_PROTOCOL}`;

export const CANVAS_SYSTEM_PROMPTS: Record<CanvasPlatform, string> = {
  web: REACT_WEB_SYSTEM_PROMPT,
  react: REACT_NATIVE_SYSTEM_PROMPT,
  flutter: FLUTTER_SYSTEM_PROMPT,
  swiftui: SWIFTUI_SYSTEM_PROMPT,
  other: REACT_WEB_SYSTEM_PROMPT
};

export const CANVAS_LANGUAGE_FOR_PLATFORM: Record<CanvasPlatform, string> = {
  web: 'tsx',
  react: 'tsx',
  flutter: 'dart',
  swiftui: 'swift',
  other: 'tsx'
};

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
    let model = 'qwen/qwen-2.5-coder-32b-instruct:free';
    try {
      const settings = await settingsManager.getEffectiveSettings();
      provider = (settings?.activeProvider as string) || provider;
      model = settings?.activeModel ? String(settings.activeModel) : model;
      if (provider === 'openkilo' && !(model.endsWith(':free') || model.endsWith('/free'))) {
        model = 'kilo-auto/free';
      }
    } catch {
      // Defaults hold.
    }

    const systemPrompt = CANVAS_SYSTEM_PROMPTS[platform] ?? REACT_WEB_SYSTEM_PROMPT;
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
      return { ok: false, platform, error: `Canvas generation failed: ${error}` };
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
      abortSignal
    );
  }
}

export const canvasAgentEngine = new CanvasAgentEngine();
