/**
 * Context Audit Store (Zustand)
 *
 * Manages state for the Ty-Code Context Audit Score, stack profile,
 * missing context warnings, and active correction memories ledger.
 *
 * Workspace unification (Prompt 3): the audit is driven exclusively by the
 * workspace session bus (workspace-session-store) so every surface — editor,
 * debugger, canvas, context — renders the identical root and score.
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import { create } from 'zustand';
import type { ContextScoreResult, WorkspaceProfile, CorrectionEntry } from '../../../preload/types';
import { useWorkspaceSessionStore } from './workspace-session-store';

interface ContextAuditState {
  isOpen: boolean;
  scoreResult: ContextScoreResult | null;
  profile: WorkspaceProfile | null;
  corrections: CorrectionEntry[];
  isLoading: boolean;
  isResyncing: boolean;
  error: string | null;

  openAuditPanel: () => void;
  closeAuditPanel: () => void;
  toggleAuditPanel: () => void;
  clearAuditData: () => void;
  fetchAuditData: (workspacePath?: string) => Promise<void>;
  resyncWorkspace: (workspacePath?: string) => Promise<void>;
  deleteCorrectionEntry: (workspacePath: string, id: string) => Promise<void>;
}

const IDLE_SCAN_TIMEOUT_MS = 3000;

type IdleHandle = number;
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

interface IdleWindow {
  requestIdleCallback?: (cb: IdleCallback, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function scheduleIdleScan(cb: () => void): IdleHandle | null {
  const idleWindow = window as unknown as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    return idleWindow.requestIdleCallback(() => cb(), { timeout: IDLE_SCAN_TIMEOUT_MS });
  }
  return window.setTimeout(cb, IDLE_SCAN_TIMEOUT_MS) as unknown as IdleHandle;
}

function cancelIdleScan(handle: IdleHandle | null): void {
  if (handle === null) return;
  const idleWindow = window as unknown as IdleWindow;
  if (typeof idleWindow.cancelIdleCallback === 'function') {
    idleWindow.cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}

// Monotonic fetch token: only the latest requested snapshot may commit, so a
// slow scan for a superseded root can never overwrite fresher data.
let fetchSequence = 0;
// Pending idle scan handle for the active root transition.
let pendingIdleHandle: IdleHandle | null = null;

function clearPendingIdleScan(): void {
  if (pendingIdleHandle !== null) {
    cancelIdleScan(pendingIdleHandle);
    pendingIdleHandle = null;
  }
}

export const useContextAuditStore = create<ContextAuditState>((set, get) => ({
  isOpen: false,
  scoreResult: null,
  profile: null,
  corrections: [],
  isLoading: false,
  isResyncing: false,
  error: null,

  openAuditPanel: () => set({ isOpen: true }),
  closeAuditPanel: () => set({ isOpen: false }),
  toggleAuditPanel: () => set((s) => ({ isOpen: !s.isOpen })),

  clearAuditData: () => {
    fetchSequence += 1; // invalidate any in-flight fetch
    set({
      scoreResult: null,
      profile: null,
      corrections: [],
      isLoading: false,
      error: null
    });
  },

  fetchAuditData: async (workspacePath?: string) => {
    if (!window.electronAPI?.getContextScore) return;
    const seq = ++fetchSequence;
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.getContextScore(workspacePath);
      if (seq !== fetchSequence) return; // superseded by a newer root transition
      if (res?.success && res.data) {
        set({
          scoreResult: res.data.scoreResult,
          profile: res.data.profile,
          corrections: res.data.corrections,
          isLoading: false
        });
      } else {
        set({
          isLoading: false,
          error: res?.error || 'Failed to fetch Context Audit Score'
        });
      }
    } catch (err: unknown) {
      if (seq !== fetchSequence) return;
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  },

  resyncWorkspace: async (workspacePath?: string) => {
    if (!window.electronAPI?.resyncWorkspaceContext) return;
    const seq = ++fetchSequence;
    set({ isResyncing: true, error: null });
    try {
      const res = await window.electronAPI.resyncWorkspaceContext(workspacePath);
      if (seq !== fetchSequence) return;
      if (res?.success && res.data) {
        set({
          scoreResult: res.data.scoreResult,
          profile: res.data.profile,
          corrections: res.data.corrections,
          isResyncing: false
        });
      } else {
        set({
          isResyncing: false,
          error: res?.error || 'Failed to resync workspace'
        });
      }
    } catch (err: unknown) {
      if (seq !== fetchSequence) return;
      set({
        isResyncing: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  },

  deleteCorrectionEntry: async (workspacePath: string, id: string) => {
    if (!window.electronAPI?.deleteCorrection) return;
    try {
      const res = await window.electronAPI.deleteCorrection({ workspacePath, id });
      if (res?.success) {
        // Optimistically remove from state and refresh score
        set((s) => ({
          corrections: s.corrections.filter((c) => c.id !== id)
        }));
        await get().fetchAuditData(workspacePath);
      }
    } catch (err: unknown) {
      console.error('[useContextAuditStore] Failed to delete correction:', err);
    }
  }
}));

/**
 * Workspace unification (Prompt 3 Step 2): subscribe the audit to the session
 * bus snapshot. Root transitions (opened / changed / closed) arrive as
 * rootPath changes on the shared session store, so the Context Engine can
 * never diverge from the editor/debugger/canvas session strips.
 *
 * - opened / changed → idle-time scan. The 5-minute TTL WorkspaceProfile
 *   cache in the main-process workspace-scanner is reused; the session
 *   manager itself evicts caches when the root actually changes.
 * - closed → clear the audit back to the no-workspace state.
 */
export function initContextAuditSync(): () => void {
  const scheduleScan = (rootPath: string): void => {
    clearPendingIdleScan();
    pendingIdleHandle = scheduleIdleScan(() => {
      pendingIdleHandle = null;
      void useContextAuditStore.getState().fetchAuditData(rootPath);
    });
  };

  const unsubscribe = useWorkspaceSessionStore.subscribe((state, prevState) => {
    const rootPath = state.session.rootPath;
    const prevRoot = prevState.session.rootPath;
    if (rootPath === prevRoot) return;

    if (rootPath) {
      // opened | changed — reuse the TTL profile cache, scan at idle.
      scheduleScan(rootPath);
    } else {
      // closed — drop back to the no-workspace state immediately.
      clearPendingIdleScan();
      useContextAuditStore.getState().clearAuditData();
    }
  });

  // Bootstrap: if the session snapshot is already hydrated (e.g. sync ran
  // before this subscription), scan the current root once.
  const hydratedRoot = useWorkspaceSessionStore.getState().session.rootPath;
  if (hydratedRoot) {
    scheduleScan(hydratedRoot);
  }

  return () => {
    clearPendingIdleScan();
    fetchSequence += 1;
    unsubscribe();
  };
}
