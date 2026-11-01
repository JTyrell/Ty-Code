/**
 * Phase 4 Step 3 — Context Meter IPC.
 *
 * Two channels:
 *  - `contextMeter:getState`   — decrypts the session once, estimates tokens
 *    against the *persisted* transcript (never a stale in-memory copy), and
 *    returns the ratio + band the footer renders.
 *  - `contextMeter:compactNow` — runs the same compaction the agent uses at
 *    `agent-engine.ts:914`, but against the unified store's payload, writes the
 *    compacted transcript back through `patchSession` (the ONE encrypted
 *    writer), and emits a `contextMeter:compacted` event to the caller.
 *
 * Honesty note: summary generation uses `buildFallbackSummary`, the same
 * deterministic path the agent falls back to when a live summarization call is
 * unavailable. We deliberately do NOT fabricate an LLM summary here — the
 * fallback produces a real, token-reducing compaction from the transcript's
 * goal + tool activity, which is what the meter's action promises.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  CONTEXT_METER_CHANNELS,
  CompactNowRequestSchema,
  GetMeterStateRequestSchema,
  bandForRatio,
  type MeterState,
  type CompactedEvent
} from '../../shared/types/context-meter';
import { unifiedSessionStore } from '../services/session/unified-session-store';
import {
  estimateContextTokens,
  compactMessages,
  buildFallbackSummary,
  MODEL_CONTEXT_LIMIT,
  type Message
} from '../agent/context-compactor';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface HandlerDeps {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

function untrusted<T = unknown>(): IpcResponse<T> {
  return { success: false, error: 'untrusted sender' };
}

function fail<T = unknown>(error: string): IpcResponse<T> {
  return { success: false, error };
}

async function guardJson<T>(label: string, fn: () => Promise<T>): Promise<IpcResponse<T>> {
  try {
    const data = await fn();
    return { success: true, data } as IpcResponse<T>;
  } catch (err) {
    return {
      success: false,
      error: `${label}: ${err instanceof Error ? err.message : String(err)}`
    } as IpcResponse<T>;
  }
}

function requireWorkspace(input: { workspaceRoot: string }): string | null {
  const trimmed = input.workspaceRoot?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** Cast the loosely-typed payload messages to the compactor's Message[]. */
function asMessages(raw: Array<Record<string, unknown>>): Message[] {
  return raw as unknown as Message[];
}

function buildMeterState(messages: Message[], payloadLimit: number, compacted: boolean, compactCount: number): MeterState {
  const limit = payloadLimit > 0 ? payloadLimit : MODEL_CONTEXT_LIMIT;
  const currentTokens = estimateContextTokens(messages);
  const ratio = Math.min(4, currentTokens / limit);
  return {
    currentTokens,
    limit,
    ratio,
    band: bandForRatio(ratio),
    compacted,
    compactCount
  };
}

export function registerContextMeterHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    CONTEXT_METER_CHANNELS.getState,
    async (event, payload: unknown): Promise<IpcResponse<MeterState>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = GetMeterStateRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`contextMeter:getState: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('contextMeter:getState: workspaceRoot required');
      return guardJson('reading meter state failed', async () => {
        const opened = await unifiedSessionStore.secureOpen(wsRoot, parsed.data.sessionId);
        if (!opened || opened.locked) {
          // A locked session: report an empty meter rather than decrypt-crashing.
          return buildMeterState([], 0, false, 0);
        }
        return buildMeterState(
          asMessages(opened.payload.messages),
          opened.payload.contextLimit,
          opened.payload.compacted,
          opened.payload.compactCount
        );
      });
    }
  );

  ipcMain.handle(
    CONTEXT_METER_CHANNELS.compactNow,
    async (event, payload: unknown): Promise<IpcResponse<CompactedEvent>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = CompactNowRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`contextMeter:compactNow: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('contextMeter:compactNow: workspaceRoot required');
      return guardJson('compacting context failed', async () => {
        const opened = await unifiedSessionStore.secureOpen(wsRoot, parsed.data.sessionId);
        if (!opened || opened.locked) {
          throw new Error('session locked or not found');
        }
        const messages = asMessages(opened.payload.messages);
        const tokensBefore = estimateContextTokens(messages);
        const summary = buildFallbackSummary(messages, opened.payload.title || '');
        const compactedMessages = compactMessages(messages, summary);
        const tokensAfter = estimateContextTokens(compactedMessages);

        await unifiedSessionStore.patchSession(wsRoot, parsed.data.sessionId, (p) => {
          p.messages = compactedMessages as unknown as Array<Record<string, unknown>>;
          p.compacted = true;
          p.compactCount = (p.compactCount ?? 0) + 1;
          p.totalTokensUsed = tokensAfter;
        });

        const result: CompactedEvent = {
          workspaceRoot: wsRoot,
          sessionId: parsed.data.sessionId,
          summary,
          tokensBefore,
          tokensAfter
        };
        // Echo the compaction back to the requesting window only; other windows
        // refresh via the existing session-changed broadcast on next open.
        try {
          event.sender.send(CONTEXT_METER_CHANNELS.compactedEvent, result);
        } catch {
          /* sender gone mid-compaction — the persisted result still stands */
        }
        return result;
      });
    }
  );
}
