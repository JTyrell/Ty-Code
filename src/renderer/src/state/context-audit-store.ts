/**
 * Context Audit Store (Zustand)
 *
 * Manages state for the Ty-Code Context Audit Score, stack profile,
 * missing context warnings, and active correction memories ledger.
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import { create } from 'zustand';
import type { ContextScoreResult, WorkspaceProfile, CorrectionEntry } from '../../../preload/types';

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
  fetchAuditData: (workspacePath?: string) => Promise<void>;
  resyncWorkspace: (workspacePath?: string) => Promise<void>;
  deleteCorrectionEntry: (workspacePath: string, id: string) => Promise<void>;
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

  fetchAuditData: async (workspacePath?: string) => {
    if (!window.electronAPI?.getContextScore) return;
    set({ isLoading: true, error: null });
    try {
      const res = await window.electronAPI.getContextScore(workspacePath);
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
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  },

  resyncWorkspace: async (workspacePath?: string) => {
    if (!window.electronAPI?.resyncWorkspaceContext) return;
    set({ isResyncing: true, error: null });
    try {
      const res = await window.electronAPI.resyncWorkspaceContext(workspacePath);
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
