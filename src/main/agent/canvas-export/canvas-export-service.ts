/**
 * Canvas dialect-export orchestrator (Prompt 4 extension).
 *
 * Turn the current canvas AST into a target platform's dialect for "Export to
 * project". Runs entirely in the main process so it is offline-testable and
 * reused by the pipeline routing tests. It NEVER touches disk — the renderer
 * routes the returned code through the Safe Edit Review Gate.
 *
 * Path (three-tier testability, amendment 3):
 *   agent (if a route is available) -> validateDialect -> ONE retry that feeds
 *   the failures[] list back to the model -> skeleton emitter fallback -> return.
 * So a keyless/offline export always yields a labeled "baseline dialect", and an
 * aborted export throws a cancellation sentinel (never a skeleton fallback).
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { getTarget, dialectLabel, type CanvasTargetId } from '../../../shared/canvas-platform-registry';
import { getTargetSystemPrompt } from '../canvas-platform-prompts';
import { skeletonFor } from '../canvas-skeleton';
import { validateDialect, formatFailuresForRetry } from './validators';
import { buildCanvasProjectDesignPrompt } from '../canvas-agent-engine';
import type { CanvasExportDialectRequest, CanvasExportDialectResult } from '../../../shared/types/canvas-export';

/** Thrown when an export is cancelled (target switch / canvas close / new export). */
export class CanvasExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'CanvasExportCancelled';
  }
}

// requestId -> controller. Populated for the duration of an in-flight export so
// the renderer can cancel it (amendment 4, 5d abort hardening).
const inFlight = new Map<string, AbortController>();

/** Cancel an in-flight export by requestId. Safe to call for unknown ids. */
export function cancelCanvasExport(requestId: string): void {
  inFlight.get(requestId)?.abort();
}

/** Resolve the active provider/model, mirroring the canvas chat engine. */
async function resolveRoute(): Promise<{ provider: string; model: string }> {
  let provider = 'openrouter';
  let model = 'google/gemma-4-26b-a4b-it:free';
  try {
    const { ProviderGateway } = await import('../../providers/provider-gateway');
    const active = typeof ProviderGateway.getActiveModel === 'function' ? ProviderGateway.getActiveModel() : null;
    if (active && (active.isAutoMode || (active.providerId && active.modelId))) {
      provider = active.isAutoMode ? 'auto' : active.providerId;
      model = active.isAutoMode ? 'Auto' : active.modelId;
    } else {
      const { settingsManager } = await import('../../services/settings-manager');
      const settings = await settingsManager.getEffectiveSettings();
      provider = (settings?.activeProvider as string) || provider;
      model = settings?.activeModel ? String(settings.activeModel) : model;
    }
    if (provider === 'openkilo' && !(model.endsWith(':free') || model.endsWith('/free'))) {
      model = 'kilo-auto/free';
    }
  } catch {
    // Defaults hold; the gateway call still fails gracefully to skeleton.
  }
  return { provider, model };
}

async function callGateway(
  provider: string,
  model: string,
  messages: Array<Record<string, string>>,
  signal: AbortSignal
): Promise<string> {
  const { ProviderGateway } = await import('../../providers/provider-gateway');
  return ProviderGateway.sendChatRequest(
    provider,
    model,
    messages,
    true,
    undefined,
    undefined,
    0,
    signal,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'canvas'
  );
}

// Fenced-block extraction for a target language (never the tycode JSON protocol).
const LANGUAGE_ALIASES: Record<string, string[]> = {
  tsx: ['tsx', 'jsx', 'ts', 'typescriptreact', 'javascriptreact', 'js'],
  html: ['html'],
  vue: ['vue', 'html'],
  svelte: ['svelte'],
  kotlin: ['kotlin'],
  dart: ['dart'],
  swift: ['swift'],
  typescript: ['typescript', 'ts', 'angular']
};

function extractDialectCode(response: string, language: string): string {
  const pattern = /```([a-zA-Z0-9_+#.-]*)\s*\n([\s\S]*?)```/g;
  const aliases = LANGUAGE_ALIASES[language] ?? [language];
  const blocks: Array<{ lang: string; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const lang = (match[1] || '').trim().toLowerCase();
    if (lang === 'tycode') continue;
    blocks.push({ lang, body: match[2] });
  }
  const preferred = blocks.find((b) => aliases.includes(b.lang));
  if (preferred) return preferred.body.trim();
  if (blocks.length > 0) return blocks[0].body.trim();
  // No fences: treat the whole response as code (validators will reject leaks).
  return response.trim();
}

export async function exportCanvasToDialect(req: CanvasExportDialectRequest): Promise<CanvasExportDialectResult> {
  const entry = getTarget(req.targetId as CanvasTargetId);
  const label = dialectLabel(req.targetId as CanvasTargetId);

  // Baseline is always computable, offline and keyless.
  const skeletonCode = skeletonFor(req.targetId as CanvasTargetId, req.nodes as unknown as CanvasComponentNode[], req.componentName);
  const skeletonResult: CanvasExportDialectResult = {
    code: skeletonCode,
    language: entry.language,
    dialectLabel: label,
    source: 'skeleton',
    note: 'baseline dialect (offline)'
  };

  const controller = new AbortController();
  inFlight.set(req.requestId, controller);
  const signal = controller.signal;

  try {
    if (signal.aborted) throw new CanvasExportCancelled();

    const designBlock = await buildCanvasProjectDesignPrompt(req.workspaceRoot);
    const systemPrompt = `${getTargetSystemPrompt(req.targetId as CanvasTargetId)}${designBlock}\n\nEXPORT MODE: emit ONLY the ${entry.languageHint} dialect for the canvas tree below, in a single \`${entry.language}\` fenced block. Do NOT emit React/TSX or the tycode JSON protocol.`;

    const treeJson = JSON.stringify(req.nodes);
    const baseMessages: Array<Record<string, string>> = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `CURRENT CANVAS TREE (${req.targetId}, ${req.nodes.length} root node(s)):\n${treeJson}` },
      { role: 'user', content: `Export this canvas as ${entry.label} (${entry.languageHint}). Emit ONLY the ${entry.language} block.` }
    ];

    const { provider, model } = await resolveRoute();

    let response: string;
    try {
      response = await callGateway(provider, model, baseMessages, signal);
    } catch (err) {
      if (signal.aborted) throw new CanvasExportCancelled();
      // Route unavailable / keyless / network error -> baseline dialect.
      return skeletonResult;
    }

    let code = extractDialectCode(response, entry.language);
    let validation = validateDialect(code, entry);

    // ONE retry that appends the failures list (invalid_arguments self-correction).
    if (!validation.ok) {
      const retryMessages: Array<Record<string, string>> = [
        ...baseMessages,
        { role: 'assistant', content: code },
        {
          role: 'user',
          content:
            `Your previous output violated:\n${formatFailuresForRetry(validation.failures)}\n` +
            `Regenerate satisfying all markers. Emit ONLY the ${entry.language} block.`
        }
      ];
      try {
        response = await callGateway(provider, model, retryMessages, signal);
      } catch {
        if (signal.aborted) throw new CanvasExportCancelled();
        return skeletonResult;
      }
      code = extractDialectCode(response, entry.language);
      validation = validateDialect(code, entry);
    }

    if (validation.ok && code !== skeletonCode) {
      return { code, language: entry.language, dialectLabel: label, source: 'agent' };
    }
    // Agent output still invalid (or empty) -> guaranteed baseline dialect.
    return skeletonResult;
  } finally {
    inFlight.delete(req.requestId);
  }
}
