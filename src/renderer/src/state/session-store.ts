/**
 * Multi-session renderer store (Phase 1).
 *
 * Wraps `window.tycode.session` (see `src/preload/index.ts`) with the same
 * optimistic-then-reconcile pattern used by `workspace-session-store.ts`. The
 * invariant we preserve through the UI is the one the CI guard enforces on
 * disk: the *listing* is plaintext sidecar metadata only, and decryption
 * happens exclusively on `open`. Never call `open` from a list render path.
 */

import { create } from 'zustand';
import type { SessionSidecar, SessionPayload, OpenedSession } from '../../../shared/types/session-envelope';

type SessionBridge = NonNullable<Window extends { electronAPI?: infer E } ? E : never>['session'];

type Bridge = {
  list: (workspaceRoot: string) => Promise<{ success: boolean; data?: SessionSidecar[]; error?: string }>;
  open: (workspaceRoot: string, sessionId: string) => Promise<{ success: boolean; data?: OpenedSession | null; error?: string }>;
  create: (
    workspaceRoot: string,
    opts?: { title?: string; agentMode?: SessionPayload['agentMode']; contextLimit?: number; lockRouteId?: string | null }
  ) => Promise<{ success: boolean; data?: { sessionId: string }; error?: string }>;
  switch: (workspaceRoot: string, sessionId: string | null) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  rename: (workspaceRoot: string, sessionId: string, title: string) => Promise<{ success: boolean; data?: SessionPayload | null; error?: string }>;
  remove: (workspaceRoot: string, sessionId: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  fork: (workspaceRoot: string, sessionId: string, uptoMessageId: string) => Promise<{ success: boolean; data?: { sessionId: string } | null; error?: string }>;
  search: (workspaceRoot: string, query: string) => Promise<{ success: boolean; data?: SessionSidecar[]; error?: string }>;
  getActive: (workspaceRoot: string) => Promise<{ success: boolean; data?: string | null; error?: string }>;
  onChatSessionChanged: (cb: (event: { workspaceRoot: string; sessionId: string | null; renamed?: boolean }) => void) => () => void;
};

function getBridge(): Bridge | undefined {
  try {
    const api = (window as unknown as { electronAPI?: { session?: Bridge } }).electronAPI;
    return api?.session;
  } catch {
    return undefined;
  }
}

export type LockedReason = 'unavailable' | 'dpapi-mismatch' | 'unknown';

interface SessionStoreState {
  workspaceRoot: string | null;
  sidecars: SessionSidecar[];
  activeSessionId: string | null;
  /** Payload of the currently-opened session (null if not opened yet or locked). */
  activePayload: SessionPayload | null;
  /** Non-null when the active session failed to decrypt (locked badge). */
  lockedReason: LockedReason | null;
  loading: boolean;
  /** Search filter currently applied to `sidecars` (empty = no filter). */
  query: string;

  setWorkspaceRoot: (root: string | null) => void;
  refreshList: () => Promise<void>;
  setActiveSearch: (q: string) => void;
  createSession: (title?: string) => Promise<string | null>;
  switchSession: (sessionId: string | null) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  forkFromMessage: (sessionId: string, uptoMessageId: string) => Promise<string | null>;
  openActive: () => Promise<void>;
}

function deriveLockedReason(opened: OpenedSession | null): LockedReason | null {
  if (!opened) return null;
  // OpenedSession is a discriminated union on `locked`.
  if ('locked' in opened && opened.locked) {
    const r = (opened as { reason?: unknown }).reason;
    if (r === 'unavailable' || r === 'dpapi-mismatch') return r;
    return 'unknown';
  }
  return null;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  workspaceRoot: null,
  sidecars: [],
  activeSessionId: null,
  activePayload: null,
  lockedReason: null,
  loading: false,
  query: '',

  setWorkspaceRoot: (root) => {
    set({ workspaceRoot: root, sidecars: [], activeSessionId: null, activePayload: null, lockedReason: null });
    if (root) void get().refreshList();
  },

  setActiveSearch: (q) => set({ query: q }),

  refreshList: async () => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return;
    set({ loading: true });
    try {
      // Sidecars only — the list path must never trigger decryption.
      const [listRes, activeRes] = await Promise.all([bridge.list(root), bridge.getActive(root)]);
      if (listRes?.success && Array.isArray(listRes.data)) {
        set({ sidecars: listRes.data });
      }
      if (activeRes?.success) {
        set({ activeSessionId: activeRes.data ?? null });
      }
    } finally {
      set({ loading: false });
    }
  },

  createSession: async (title) => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return null;
    const res = await bridge.create(root, title ? { title } : undefined);
    if (res?.success && res.data?.sessionId) {
      await get().refreshList();
      return res.data.sessionId;
    }
    return null;
  },

  switchSession: async (sessionId) => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return;
    await bridge.switch(root, sessionId);
    set({ activeSessionId: sessionId, activePayload: null, lockedReason: null });
    if (sessionId) await get().openActive();
  },

  renameSession: async (sessionId, title) => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return;
    await bridge.rename(root, sessionId, title);
    await get().refreshList();
  },

  deleteSession: async (sessionId) => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return;
    await bridge.remove(root, sessionId);
    if (get().activeSessionId === sessionId) {
      set({ activeSessionId: null, activePayload: null, lockedReason: null });
    }
    await get().refreshList();
  },

  forkFromMessage: async (sessionId, uptoMessageId) => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    if (!bridge || !root) return null;
    const res = await bridge.fork(root, sessionId, uptoMessageId);
    if (res?.success && res.data?.sessionId) {
      await get().refreshList();
      return res.data.sessionId;
    }
    return null;
  },

  openActive: async () => {
    const bridge = getBridge();
    const root = get().workspaceRoot;
    const id = get().activeSessionId;
    if (!bridge || !root || !id) return;
    const res = await bridge.open(root, id);
    if (res?.success && res.data) {
      const opened = res.data;
      if ('locked' in opened && opened.locked) {
        set({ activePayload: null, lockedReason: deriveLockedReason(opened) ?? 'unknown' });
      } else if ('payload' in opened) {
        set({ activePayload: opened.payload, lockedReason: null });
      }
    }
  },
}));

/**
 * Subscribe once at app boot: keeps the store reconciled with broadcasts from
 * other windows (`session:changed` fired by `session:switch|rename|delete`).
 * Returns a disposer to satisfy the strict "every listener must unsubscribe"
 * rule (see chat-sidecar useEffect cleanup pattern).
 */
export function initSessionSync(): () => void {
  const bridge = getBridge();
  if (!bridge?.onChatSessionChanged) return () => {};
  const dispose = bridge.onChatSessionChanged((event) => {
    const state = useSessionStore.getState();
    if (!state.workspaceRoot || event.workspaceRoot !== state.workspaceRoot) return;
    if (event.renamed) {
      void state.refreshList();
      return;
    }
    if (event.sessionId === state.activeSessionId) return; // echo guard
    useSessionStore.setState({
      activeSessionId: event.sessionId,
      activePayload: null,
      lockedReason: null,
    });
    if (event.sessionId) void state.openActive();
  });
  return () => {
    try { dispose(); } catch { /* tolerated */ }
  };
}

// Keep the alias so callers typing `SessionBridge` get the right narrowing.
export type { SessionBridge };
