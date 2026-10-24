/**
 * Ty-Code Observability Store (Zustand Slice)
 *
 * Manages prompt composition history and telemetry snapshots.
 *
 * Constraints:
 * - Atomic selectors per field (zero whole-store re-renders during streaming).
 * - Disposable IPC subscription wired at module init.
 * - In-memory only: zero telemetry leaves the machine.
 *
 * Brand: Ty-Code
 */

import { create } from 'zustand';
import type { AssemblyResult } from '../../../preload/types';

export interface ObservabilityState {
  latestAssembly: AssemblyResult | null;
  history: AssemblyResult[];
  selectedTaskId: string | null;
  loading: boolean;

  // Actions
  setSelectedTaskId: (taskId: string | null) => void;
  loadHistory: () => Promise<void>;
  addAssembly: (assembly: AssemblyResult) => void;
  clearHistory: () => void;
}

export const useObservabilityStore = create<ObservabilityState>((set, get) => ({
  latestAssembly: null,
  history: [],
  selectedTaskId: null,
  loading: false,

  setSelectedTaskId: (taskId: string | null) => {
    set({ selectedTaskId: taskId });
  },

  loadHistory: async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.getAssemblyHistory) return;
    set({ loading: true });
    try {
      const res = await window.electronAPI.getAssemblyHistory();
      if (res.success && Array.isArray(res.data)) {
        const history = res.data;
        const latest = history[0] || null;
        set({
          history,
          latestAssembly: latest,
          selectedTaskId: get().selectedTaskId || latest?.taskId || null,
          loading: false
        });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  addAssembly: (assembly: AssemblyResult) => {
    if (!assembly) return;
    set((state) => {
      const filtered = state.history.filter((h) => h.taskId !== assembly.taskId);
      const updatedHistory = [assembly, ...filtered].slice(0, 50);
      return {
        history: updatedHistory,
        latestAssembly: assembly,
        selectedTaskId: state.selectedTaskId || assembly.taskId
      };
    });
  },

  clearHistory: () => {
    set({ history: [], latestAssembly: null, selectedTaskId: null });
  }
}));

// Wire Disposable IPC Subscription at store init
if (typeof window !== 'undefined' && window.electronAPI?.onAssemblyUpdate) {
  window.electronAPI.onAssemblyUpdate((assembly) => {
    useObservabilityStore.getState().addAssembly(assembly);
  });
  // Initial load
  void useObservabilityStore.getState().loadHistory();
}

// ─── Atomic Selectors (Ty-Code Architecture Guideline) ─────────────────────

export const useLatestAssembly = () => useObservabilityStore((s) => s.latestAssembly);
export const useAssemblyHistory = () => useObservabilityStore((s) => s.history);
export const useSelectedTaskId = () => useObservabilityStore((s) => s.selectedTaskId);
export const useSetSelectedTaskId = () => useObservabilityStore((s) => s.setSelectedTaskId);
export const useObservabilityLoading = () => useObservabilityStore((s) => s.loading);

export const useSelectedAssembly = (): AssemblyResult | null => {
  return useObservabilityStore((s) => {
    if (!s.selectedTaskId) return s.latestAssembly;
    return s.history.find((h) => h.taskId === s.selectedTaskId) || s.latestAssembly;
  });
};
