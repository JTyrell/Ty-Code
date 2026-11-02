/**
 * Prompt B — Quest Mode IPC channels.
 *
 * Zod-guarded handlers for the quest lifecycle: draft, revise, approve (the
 * hard spec gate), cancel, discard, merge review (fileDiff / acceptFiles /
 * finish) plus a subscribe channel that captures the renderer's WebContents
 * for the pushed quest event stream. Listener registrations are disposable:
 * each subscribing window gets its sink removed when it is destroyed.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  QUEST_CHANNELS,
  AcceptQuestFilesRequestSchema,
  DraftQuestRequestSchema,
  FinishQuestRequestSchema,
  QuestFileDiffRequestSchema,
  QuestIdRequestSchema,
  QuestListRequestSchema,
  ReviseQuestRequestSchema,
  type QuestEvent,
  type QuestFileDiff,
  type QuestMeta,
  type QuestStateSnapshot
} from '../../shared/types/quest';
import { questService } from '../services/quest/quest-service';

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
    return { success: true, data: await fn() } as IpcResponse<T>;
  } catch (err) {
    return { success: false, error: `${label}: ${err instanceof Error ? err.message : String(err)}` } as IpcResponse<T>;
  }
}

function okSync<T>(data: T): IpcResponse<T> {
  return { success: true, data };
}

export function registerQuestHandlers(deps: HandlerDeps): void {
  // Event stream: one sink per subscribed window, disposed when the window dies.
  const sinks = new Map<WebContents, () => void>();

  ipcMain.handle(
    QUEST_CHANNELS.subscribe,
    (event, payload: unknown): IpcResponse<QuestStateSnapshot> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:subscribe: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wc = event.sender;
      if (!sinks.has(wc)) {
        const sink = (questEvent: QuestEvent): void => {
          if (wc.isDestroyed()) return;
          try {
            wc.send(QUEST_CHANNELS.events, questEvent);
          } catch {
            // Window torn down mid-send; the destroyed handler cleans up.
          }
        };
        const dispose = questService.onEvent(sink);
        sinks.set(wc, dispose);
        wc.once('destroyed', () => {
          const stored = sinks.get(wc);
          if (stored) {
            stored();
            sinks.delete(wc);
          }
        });
      }
      return okSync(questService.snapshot(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.list,
    (event, payload: unknown): IpcResponse<QuestMeta[]> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:list: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return okSync(questService.list(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.detail,
    (event, payload: unknown): IpcResponse<{ quest: QuestMeta; log: import('../../shared/types/quest').QuestLogLine[] } | null> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestIdRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:detail: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return okSync(questService.detail(parsed.data.questId));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.draft,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = DraftQuestRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:draft: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('quest drafting failed', () =>
        questService.draft(parsed.data.workspaceRoot, parsed.data.objective, parsed.data.originSessionId || '')
      );
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.revise,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = ReviseQuestRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:revise: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('quest spec revision failed', () => questService.revise(parsed.data.questId, parsed.data.feedback));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.approve,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestIdRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:approve: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('quest approval failed', () => questService.approve(parsed.data.questId));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.cancel,
    (event, payload: unknown): IpcResponse<QuestMeta> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestIdRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:cancel: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      try {
        return okSync(questService.cancel(parsed.data.questId));
      } catch (err) {
        return fail(`quest cancel failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.discard,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestIdRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:discard: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('quest discard failed', () => questService.discard(parsed.data.questId));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.fileDiff,
    async (event, payload: unknown): Promise<IpcResponse<QuestFileDiff>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = QuestFileDiffRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:file-diff: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading quest file diff failed', () => questService.fileDiff(parsed.data.questId, parsed.data.path));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.acceptFiles,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = AcceptQuestFilesRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:accept-files: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('accepting quest files failed', () => questService.acceptFiles(parsed.data.questId, parsed.data.paths));
    }
  );

  ipcMain.handle(
    QUEST_CHANNELS.finish,
    async (event, payload: unknown): Promise<IpcResponse<QuestMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = FinishQuestRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`quest:finish: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('finishing quest merge failed', () => questService.finish(parsed.data.questId, parsed.data.mode));
    }
  );
}
