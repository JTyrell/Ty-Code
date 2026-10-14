import { create } from 'zustand';
import type { WorkspaceEditOrigin, WorkspaceEditPreview } from '../../../preload/types';

export interface WorkspaceEditRequest {
  preview: WorkspaceEditPreview;
  refresh: () => Promise<WorkspaceEditPreview>;
  isStale: boolean;
  sourceKey?: string;
  filePaths?: string[];
}

export interface RecentWorkspaceEdit {
  transactionId: string;
  origin: WorkspaceEditOrigin;
  createdAt: number;
  fileCount: number;
}

interface WorkspaceEditState {
  request: WorkspaceEditRequest | null;
  recentEdits: RecentWorkspaceEdit[];
  forcePreviewAll: boolean;
  setRequest: (request: WorkspaceEditRequest) => void;
  updatePreview: (preview: WorkspaceEditPreview) => void;
  markRequestStale: () => void;
  clearRequest: () => void;
  setForcePreviewAll: (enabled: boolean) => void;
  refreshRecentEdits: () => Promise<void>;
  removeRecentEdit: (transactionId: string) => void;
  recordRecentEdit: (edit: RecentWorkspaceEdit) => void;
}

export const useWorkspaceEditStore = create<WorkspaceEditState>((set) => ({
  request: null,
  recentEdits: [],
  forcePreviewAll: false,
  setRequest: (request) => set({ request }),
  updatePreview: (preview) => set((state) => state.request ? { request: { ...state.request, preview, isStale: false } } : state),
  markRequestStale: () => set((state) => state.request ? { request: { ...state.request, isStale: true } } : state),
  clearRequest: () => set({ request: null }),
  setForcePreviewAll: (forcePreviewAll) => set({ forcePreviewAll }),
  refreshRecentEdits: async () => {
    try {
      const response = await window.electronAPI.getRecentWorkspaceEdits();
      if (response.success && response.data) set({ recentEdits: response.data });
    } catch {
      // The editor remains usable if the undo audit list is unavailable.
    }
  },
  removeRecentEdit: (transactionId) => set((state) => ({ recentEdits: state.recentEdits.filter((item) => item.transactionId !== transactionId) })),
  recordRecentEdit: (edit) => set((state) => ({ recentEdits: [edit, ...state.recentEdits.filter((item) => item.transactionId !== edit.transactionId)].slice(0, 10) }))
}));
