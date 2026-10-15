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
  autoApplied: true;
}

interface WorkspaceEditState {
  request: WorkspaceEditRequest | null;
  recentEdits: RecentWorkspaceEdit[];
  forcePreviewAll: boolean;
  editorRevision: number;
  lastAppliedEditorRevision: number;
  lastAppliedTransactionId: string | null;
  pendingEditorContents: Record<string, string>;
  setRequest: (request: WorkspaceEditRequest) => void;
  updatePreview: (preview: WorkspaceEditPreview) => void;
  markRequestStale: () => void;
  clearRequest: () => void;
  markEditorChanged: (filePath: string, content: string) => void;
  markTransactionApplied: (transactionId: string) => void;
  invalidateUndoShortcut: () => void;
  consumePendingEditorContent: (filePath: string) => string | undefined;
  setForcePreviewAll: (enabled: boolean) => void;
  refreshRecentEdits: () => Promise<void>;
  removeRecentEdit: (transactionId: string) => void;
  recordRecentEdit: (edit: RecentWorkspaceEdit) => void;
}

export const useWorkspaceEditStore = create<WorkspaceEditState>((set) => ({
  request: null,
  recentEdits: [],
  forcePreviewAll: false,
  editorRevision: 0,
  lastAppliedEditorRevision: -1,
  lastAppliedTransactionId: null,
  pendingEditorContents: {},
  setRequest: (request) => set({ request }),
  updatePreview: (preview) => set((state) => state.request ? { request: { ...state.request, preview, isStale: false } } : state),
  markRequestStale: () => set((state) => state.request ? { request: { ...state.request, isStale: true } } : state),
  clearRequest: () => set({ request: null }),
  setForcePreviewAll: (forcePreviewAll) => set({ forcePreviewAll }),
  markEditorChanged: (filePath, content) => set((state) => ({ editorRevision: state.editorRevision + 1, pendingEditorContents: { ...state.pendingEditorContents, [filePath]: content } })),
  markTransactionApplied: (transactionId: string) => set((state) => ({ lastAppliedEditorRevision: state.editorRevision, lastAppliedTransactionId: transactionId })),
  invalidateUndoShortcut: () => set({ lastAppliedEditorRevision: -1, lastAppliedTransactionId: null }),
  consumePendingEditorContent: (filePath) => {
    let value: string | undefined;
    set((state) => {
      value = state.pendingEditorContents[filePath];
      const pendingEditorContents = { ...state.pendingEditorContents };
      delete pendingEditorContents[filePath];
      return { pendingEditorContents };
    });
    return value;
  },
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
