/**
 * Phase 2 — Inline Assist IPC.
 *
 * Persistence only: an inline thread is stored as one entry in the encrypted
 * session payload's `subConversations[]`. Generation reuses the existing agent
 * chunk channel so we do not fork a second streaming path that could disagree
 * with Plan/Build gating, route locking, or the Safe Edit Review Gate.
 *
 * The thread shape here is deliberately loose — Zod validates the IPC envelope
 * and the unified store's payload schema enforces the on-disk shape. A
 * decryption failure yields `[]` from `listThreads`, which the widget treats
 * as "no prior inline history" (correct UX for a locked session).
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  INLINE_ASSIST_CHANNELS,
  SaveThreadRequestSchema,
  LoadThreadRequestSchema,
  ListThreadsRequestSchema,
  DeleteThreadRequestSchema,
  type InlineThread
} from '../../shared/types/inline-assist-channels';
import { unifiedSessionStore } from '../services/session/unified-session-store';
import type { SessionPayload } from '../../shared/types/session-envelope';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface HandlerDeps {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  getWorkspacePath: () => string | null;
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
    return { success: false, error: `${label}: ${err instanceof Error ? err.message : String(err)}` } as IpcResponse<T>;
  }
}

type SubConversation = NonNullable<SessionPayload['subConversations']>[number];

function threadToSub(t: InlineThread): SubConversation {
  return {
    id: t.threadId,
    anchorFilePath: t.anchor.filePath,
    anchorRange: {
      startLineNumber: t.anchor.startLine,
      startColumn: t.anchor.startColumn,
      endLineNumber: t.anchor.endLine,
      endColumn: t.anchor.endColumn
    },
    objective: t.turns[0]?.objective ?? '',
    messages: t.turns.map((turn) => ({
      role: 'user',
      content: turn.objective,
      createdAt: turn.createdAt,
      proposal: turn.proposal,
      accepted: turn.accepted
    })),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

function subToThread(v: SubConversation, sessionId: string): InlineThread {
  const turns = v.messages.map((m, i) => ({
    id: `${v.id}_${i}`,
    objective: typeof m.objective === 'string' ? m.objective : String(m.content ?? ''),
    proposal: typeof m.proposal === 'string' ? m.proposal : undefined,
    accepted: typeof m.accepted === 'boolean' ? m.accepted : undefined,
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : v.createdAt
  }));
  return {
    threadId: v.id,
    sessionId,
    anchor: {
      filePath: v.anchorFilePath,
      startLine: v.anchorRange?.startLineNumber ?? 0,
      startColumn: v.anchorRange?.startColumn ?? 0,
      endLine: v.anchorRange?.endLineNumber ?? 0,
      endColumn: v.anchorRange?.endColumn ?? 0
    },
    lockedRouteId: null,
    turns: turns.length > 0 ? turns : [{ id: `${v.id}_0`, objective: v.objective, createdAt: v.createdAt }],
    createdAt: v.createdAt,
    updatedAt: v.updatedAt
  };
}

function requireWorkspace(input: { workspaceRoot: string }): string | null {
  const trimmed = input.workspaceRoot?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerInlineAssistHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    INLINE_ASSIST_CHANNELS.saveThread,
    async (event, payload: unknown): Promise<IpcResponse<true>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SaveThreadRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`inlineAssist:saveThread: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('inlineAssist:saveThread: workspaceRoot required');
      const { thread } = parsed.data;
      return guardJson('saving inline thread failed', async () => {
        await unifiedSessionStore.patchSession(
          wsRoot,
          thread.sessionId,
          (p) => {
            const list = p.subConversations ?? [];
            const sub = threadToSub(thread);
            const idx = list.findIndex((t) => t.id === sub.id);
            if (idx >= 0) list[idx] = sub;
            else list.push(sub);
            p.subConversations = list;
          }
        );
        return true as const;
      });
    }
  );

  ipcMain.handle(
    INLINE_ASSIST_CHANNELS.loadThread,
    async (event, payload: unknown): Promise<IpcResponse<InlineThread | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = LoadThreadRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`inlineAssist:loadThread: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('inlineAssist:loadThread: workspaceRoot required');
      return guardJson('loading inline thread failed', async () => {
        const list = await unifiedSessionStore.listSidecars(wsRoot);
        for (const sidecar of list) {
          const opened = await unifiedSessionStore.secureOpen(wsRoot, sidecar.sessionId);
          if (!opened || opened.locked) continue;
          const found = opened.payload.subConversations?.find((t) => t.id === parsed.data.threadId);
          if (found) return subToThread(found, sidecar.sessionId);
        }
        return null;
      });
    }
  );

  ipcMain.handle(
    INLINE_ASSIST_CHANNELS.listThreads,
    async (event, payload: unknown): Promise<IpcResponse<InlineThread[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = ListThreadsRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`inlineAssist:listThreads: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('inlineAssist:listThreads: workspaceRoot required');
      return guardJson('listing inline threads failed', async () => {
        const opened = await unifiedSessionStore.secureOpen(wsRoot, parsed.data.sessionId);
        if (!opened || opened.locked) return [];
        return (opened.payload.subConversations ?? []).map((t) => subToThread(t, parsed.data.sessionId));
      });
    }
  );

  ipcMain.handle(
    INLINE_ASSIST_CHANNELS.deleteThread,
    async (event, payload: unknown): Promise<IpcResponse<true>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = DeleteThreadRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`inlineAssist:deleteThread: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wsRoot = requireWorkspace(parsed.data);
      if (!wsRoot) return fail('inlineAssist:deleteThread: workspaceRoot required');
      return guardJson('deleting inline thread failed', async () => {
        const list = await unifiedSessionStore.listSidecars(wsRoot);
        for (const sidecar of list) {
          const opened = await unifiedSessionStore.secureOpen(wsRoot, sidecar.sessionId);
          if (!opened || opened.locked) continue;
          const has = opened.payload.subConversations?.some((t) => t.id === parsed.data.threadId);
          if (!has) continue;
          await unifiedSessionStore.patchSession(wsRoot, sidecar.sessionId, (p) => {
            p.subConversations = (p.subConversations ?? []).filter((t) => t.id !== parsed.data.threadId);
          });
          return true as const;
        }
        return true as const;
      });
    }
  );
}
