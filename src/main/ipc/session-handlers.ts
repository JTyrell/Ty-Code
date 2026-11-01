/**
 * Session IPC — the wiring half of the unified encrypted session store.
 *
 * The store (`unified-session-store.ts`) and the bus (`chat-session-bus.ts`) are
 * free of `ipcMain`, so they run under plain Node in tests. This module supplies
 * the only three things main can: the frame trust gate, Zod validation of every
 * inbound payload BEFORE disk is touched, and the cross-window broadcast that
 * keeps the active chat session id in sync across windows.
 *
 * No-echo contract (load-bearing): `session:switch` records the active id on the
 * bus and then broadcasts `chat-session:changed` to every window EXCEPT the one
 * that asked. The sender already knows — it just made the change — so re-notifying
 * it would round-trip the event back into its own store and loop. Excluding the
 * sender is what lets a rename/switch in window A land in window B without
 * bouncing home.
 *
 * A decrypt failure is never an error: `session:open` returns a `locked` record
 * (sidecar + reason) so the history browser can paint a "Locked" badge instead of
 * crashing or falling back to plaintext.
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { IpcResponse } from '../../preload/types';
import type { OpenedSession, SessionPayload, SessionSidecar } from '../../shared/types/session-envelope';
import {
  SESSION_CHANNELS,
  SessionActiveGetRequestSchema,
  SessionCreateRequestSchema,
  SessionDeleteRequestSchema,
  SessionForkRequestSchema,
  SessionListRequestSchema,
  SessionOpenRequestSchema,
  SessionRenameRequestSchema,
  SessionSaveRequestSchema,
  SessionSearchRequestSchema,
  SessionSwitchRequestSchema
} from '../../shared/types/session-channels';
import { unifiedSessionStore } from '../services/session/unified-session-store';
import { getChatSessionBus } from '../services/session/chat-session-bus';

export interface SessionHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
}

/** Anything the renderers need to mirror an active-session change. */
interface ChatSessionChangedEvent {
  workspaceRoot: string;
  sessionId: string | null;
}

function fail(message: string): IpcResponse<never> {
  return { success: false, error: message };
}

function untrusted(): IpcResponse<never> {
  return fail('Untrusted renderer frame.');
}

/** Run an async store operation, mapping throws to a structured failure. */
async function guard<T>(context: string, op: () => Promise<T>): Promise<IpcResponse<T>> {
  try {
    return { success: true, data: await op() };
  } catch (err: unknown) {
    return fail(`${context}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Broadcast to every window except `exclude` (the originating WebContents). This
 * is the entire no-echo mechanism — the sender is skipped because it already
 * applied the change locally before invoking us.
 */
function broadcastExcludingSender(channel: string, payload: unknown, exclude: WebContents): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    if (win.webContents === exclude) continue;
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* Window raced shutdown; the next change reaches it or it is gone. */
    }
  }
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
  const bus = getChatSessionBus();

  // session:list — sidecars only, never decrypts.
  ipcMain.handle(
    SESSION_CHANNELS.list,
    async (event, payload: unknown): Promise<IpcResponse<SessionSidecar[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:list: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return guard('listing sessions failed', () => unifiedSessionStore.listSidecars(parsed.data.workspaceRoot));
    }
  );

  // session:open — decrypt once; a locked result is data, not an error.
  ipcMain.handle(
    SESSION_CHANNELS.open,
    async (event, payload: unknown): Promise<IpcResponse<OpenedSession | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionOpenRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:open: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return guard('opening session failed', () =>
        unifiedSessionStore.secureOpen(parsed.data.workspaceRoot, parsed.data.sessionId)
      );
    }
  );

  // session:create — new encrypted session; does not auto-switch (renderer decides).
  ipcMain.handle(
    SESSION_CHANNELS.create,
    async (event, payload: unknown): Promise<IpcResponse<{ sessionId: string }>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionCreateRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:create: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return guard('creating session failed', async () => {
        const created = await unifiedSessionStore.createSession(parsed.data.workspaceRoot, {
          title: parsed.data.title,
          agentMode: parsed.data.agentMode,
          contextLimit: parsed.data.contextLimit,
          lockRouteId: parsed.data.lockRouteId
        });
        return { sessionId: created.sessionId };
      });
    }
  );

  // session:switch — set active on the bus, then broadcast to OTHER windows.
  ipcMain.handle(
    SESSION_CHANNELS.switch,
    async (event, payload: unknown): Promise<IpcResponse<boolean>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionSwitchRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:switch: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      const changed = bus.setActive(parsed.data.workspaceRoot, parsed.data.sessionId);
      if (changed) {
        const announcement: ChatSessionChangedEvent = {
          workspaceRoot: parsed.data.workspaceRoot,
          sessionId: parsed.data.sessionId
        };
        broadcastExcludingSender(SESSION_CHANNELS.changedEvent, announcement, event.sender);
      }
      return { success: true, data: changed };
    }
  );

  // session:rename — rewrite the envelope, then notify peers of the fresh sidecar.
  ipcMain.handle(
    SESSION_CHANNELS.rename,
    async (event, payload: unknown): Promise<IpcResponse<SessionPayload | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionRenameRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:rename: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      const result = await guard('renaming session failed', () =>
        unifiedSessionStore.renameSession(parsed.data.workspaceRoot, parsed.data.sessionId, parsed.data.title)
      );
      if (result.success && result.data) {
        // Peers refresh their tab title; the sender repaints from its own store.
        broadcastExcludingSender(SESSION_CHANNELS.changedEvent, {
          workspaceRoot: parsed.data.workspaceRoot,
          sessionId: parsed.data.sessionId,
          renamed: true
        } satisfies ChatSessionChangedEvent & { renamed: boolean }, event.sender);
      }
      return result;
    }
  );

  // session:delete — remove files + clear active if it was the deleted one.
  ipcMain.handle(
    SESSION_CHANNELS.delete,
    async (event, payload: unknown): Promise<IpcResponse<boolean>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionDeleteRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:delete: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      const result = await guard('deleting session failed', () =>
        unifiedSessionStore.deleteSession(parsed.data.workspaceRoot, parsed.data.sessionId)
      );
      if (result.success && bus.getActive(parsed.data.workspaceRoot) === parsed.data.sessionId) {
        bus.setActive(parsed.data.workspaceRoot, null);
        broadcastExcludingSender(SESSION_CHANNELS.changedEvent, {
          workspaceRoot: parsed.data.workspaceRoot,
          sessionId: null
        } satisfies ChatSessionChangedEvent, event.sender);
      }
      return result;
    }
  );

  // session:fork — branch at a message boundary; returns the new id.
  ipcMain.handle(
    SESSION_CHANNELS.fork,
    async (event, payload: unknown): Promise<IpcResponse<{ sessionId: string } | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionForkRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:fork: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return guard('forking session failed', async () => {
        const forked = await unifiedSessionStore.forkFromMessage(
          parsed.data.workspaceRoot,
          parsed.data.sessionId,
          parsed.data.uptoMessageId
        );
        return forked ? { sessionId: forked.sessionId } : null;
      });
    }
  );

  // session:search — sidecar title/id search, never decrypts.
  ipcMain.handle(
    SESSION_CHANNELS.search,
    async (event, payload: unknown): Promise<IpcResponse<SessionSidecar[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionSearchRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:search: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return guard('searching sessions failed', () => unifiedSessionStore.search(parsed.data.workspaceRoot, parsed.data.query));
    }
  );

  // session:save — debounced encrypted rewrite off the streaming path.
  ipcMain.handle(
    SESSION_CHANNELS.save,
    async (event, payload: unknown): Promise<IpcResponse<true>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionSaveRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:save: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      try {
        unifiedSessionStore.saveSession(parsed.data.workspaceRoot, parsed.data.payload);
        return { success: true, data: true };
      } catch (err: unknown) {
        return fail(`saving session failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // session:active:get — read the bus's current active id for a workspace.
  ipcMain.handle(
    SESSION_CHANNELS.activeGet,
    async (event, payload: unknown): Promise<IpcResponse<string | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SessionActiveGetRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`session:active:get: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return { success: true, data: bus.getActive(parsed.data.workspaceRoot) };
    }
  );

  // session:flush — force pending writes to disk (window close).
  ipcMain.handle(
    SESSION_CHANNELS.flush,
    async (event): Promise<IpcResponse<true>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      try {
        await unifiedSessionStore.flushOnExit();
        return { success: true, data: true };
      } catch (err: unknown) {
        return fail(`flushing sessions failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
