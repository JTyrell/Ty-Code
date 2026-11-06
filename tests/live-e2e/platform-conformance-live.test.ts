/**
 * Nightly LIVE platform-conformance probe (Prompt 4 extension, amendment 6).
 *
 * NEVER runs in PR CI. Invoked only by `scripts/run-platform-conformance-live.mjs`
 * on a schedule, with a real provider key read from repo secrets. For each of the
 * 9 registry targets it drives ONE real agent export (locked capable model, one
 * representative AST) and judges the response with the SAME `validateDialect` the
 * shipping path uses. This catches dialect drift the offline skeleton suite can't:
 * a model that quietly starts emitting React/TSX for Vue, dropping a required
 * marker, etc. No recorded fixtures replay model output — every reply is live.
 */

import { ProviderGateway } from '../../src/main/providers/provider-gateway';
import type { ProviderSettings } from '../../src/preload/types';
import type { CanvasComponentNode } from '../../src/main/services/canvas-sync-manager';
import {
  CANVAS_TARGET_IDS,
  getTarget,
  dialectLabel,
  type CanvasTargetId
} from '../../src/shared/canvas-platform-registry';
import { getTargetSystemPrompt } from '../../src/main/agent/canvas-platform-prompts';
import { validateDialect } from '../../src/main/agent/canvas-export/validators';

export interface LiveTargetResult {
  target: CanvasTargetId;
  dialectLabel: string;
  ok: boolean;
  failures: string[];
  emittedChars: number;
  latencyMs: number;
}

export interface LiveConformanceReport {
  timestamp: string;
  gitCommit: string;
  model: string;
  provider: string;
  targets: LiveTargetResult[];
  summary: { total: number; passed: number; markerOrBanFailures: number };
}

const REPRESENTATIVE_AST: CanvasComponentNode[] = [
  {
    id: 'c1',
    type: 'container',
    name: 'Hero',
    props: { color: '#1e1b29' },
    children: [
      { id: 't1', type: 'text', props: { text: 'Welcome', fontSize: 20 } },
      { id: 'b1', type: 'button', props: { text: 'Get Started' } },
      { id: 'i1', type: 'input', props: { placeholder: 'Email' } },
      { id: 'img1', type: 'image', props: {} }
    ]
  }
];

/** Same fenced-block extraction rule the shipping orchestrator uses (kept local so
 *  this probe never imports the electron-coupled engine module). */
function extractCode(response: string, language: string): string {
  const pattern = /```([a-zA-Z0-9_+#.-]*)\s*\n([\s\S]*?)```/g;
  const blocks: Array<{ lang: string; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const lang = (match[1] || '').trim().toLowerCase();
    if (lang === 'tycode') continue;
    blocks.push({ lang, body: match[2] });
  }
  const preferred = blocks.find((b) => b.lang === language || b.lang === language.replace('script', ''));
  if (preferred) return preferred.body.trim();
  return blocks.length > 0 ? blocks[0].body.trim() : response.trim();
}

export async function runPlatformConformanceLive(
  settings: ProviderSettings,
  provider: string,
  model: string,
  gitCommit: string
): Promise<LiveConformanceReport> {
  console.log('\n========================================================================');
  console.log('=== NIGHTLY LIVE PLATFORM CONFORMANCE — REAL AGENT EXPORT (9 targets) ===');
  console.log('========================================================================');
  console.log(`  provider=${provider}  locked model=${model}`);

  const targets: LiveTargetResult[] = [];

  for (const id of CANVAS_TARGET_IDS as readonly CanvasTargetId[]) {
    const entry = getTarget(id);
    const systemPrompt =
      getTargetSystemPrompt(id) +
      `\n\nEXPORT MODE: emit ONLY the ${entry.languageHint} dialect for the canvas tree below, in a single \`${entry.language}\` fenced block. Do NOT emit React/TSX or the tycode JSON protocol.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `CURRENT CANVAS TREE (${id}):\n${JSON.stringify(REPRESENTATIVE_AST)}` },
      { role: 'user', content: `Export this canvas as ${entry.label} (${entry.languageHint}). Emit ONLY the ${entry.language} block.` }
    ];

    const started = Date.now();
    let failures: string[] = [];
    let emittedChars = 0;
    try {
      const result = await ProviderGateway.streamChat(settings, messages, [], {});
      const code = extractCode(result.fullText, entry.language);
      emittedChars = code.length;
      failures = validateDialect(code, entry).failures;
    } catch (err) {
      // A hard transport error is a drift signal too, but distinguishable from a
      // marker/ban violation; the workflow only ALERTS on the latter.
      failures = [`[transport] live call failed: ${err instanceof Error ? err.message : String(err)}`];
    }
    const latencyMs = Date.now() - started;
    const ok = failures.length === 0 || failures.every((f) => f.startsWith('[transport]'));
    const markerOrBan = failures.some((f) => !f.startsWith('[transport]'));

    console.log(`  ${markerOrBan ? '✗' : ok ? '✓' : '·'} ${id.padEnd(14)} ${latencyMs}ms  ${failures.length ? failures.join('; ') : 'conformant'}`);

    targets.push({ target: id, dialectLabel: dialectLabel(id), ok: failures.length === 0, failures, emittedChars, latencyMs });
  }

  const markerOrBanFailures = targets.reduce(
    (acc, t) => acc + t.failures.filter((f) => !f.startsWith('[transport]')).length,
    0
  );

  return {
    timestamp: new Date().toISOString(),
    gitCommit,
    model,
    provider,
    targets,
    summary: {
      total: targets.length,
      passed: targets.filter((t) => t.failures.length === 0).length,
      markerOrBanFailures
    }
  };
}
