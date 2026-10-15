import { create } from 'zustand';
import type { QuotaSnapshot, RoutingDecisionLog } from '../../../preload/types';

interface UsageDashboardState {
  isOpen: boolean;
  quotaSnapshot: QuotaSnapshot | null;
  routingLogs: RoutingDecisionLog[];
  isLoading: boolean;
  openDashboard: () => void;
  closeDashboard: () => void;
  toggleDashboard: () => void;
  refreshStats: () => Promise<void>;
  setFreeMode: (enabled: boolean) => Promise<void>;
}

export const useUsageDashboardStore = create<UsageDashboardState>((set, get) => ({
  isOpen: false,
  quotaSnapshot: null,
  routingLogs: [],
  isLoading: false,

  openDashboard: () => {
    set({ isOpen: true });
    void get().refreshStats();
  },

  closeDashboard: () => set({ isOpen: false }),

  toggleDashboard: () => {
    const next = !get().isOpen;
    set({ isOpen: next });
    if (next) {
      void get().refreshStats();
    }
  },

  refreshStats: async () => {
    if (!window.electronAPI) return;
    set({ isLoading: true });
    try {
      const [quotaRes, logsRes] = await Promise.all([
        window.electronAPI.orchestrationGetQuotaStats(),
        window.electronAPI.orchestrationGetSmartRoutingLogs()
      ]);

      set({
        quotaSnapshot: quotaRes.success && quotaRes.data ? quotaRes.data : get().quotaSnapshot,
        routingLogs: logsRes.success && logsRes.data ? logsRes.data : get().routingLogs,
        isLoading: false
      });
    } catch (err) {
      console.error('Failed to refresh quota stats:', err);
      set({ isLoading: false });
    }
  },

  setFreeMode: async (enabled: boolean) => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.orchestrationSetFreeMode(enabled);
      if (res.success && res.data) {
        await get().refreshStats();
      }
    } catch (err) {
      console.error('Failed to toggle Free Mode:', err);
    }
  }
}));
