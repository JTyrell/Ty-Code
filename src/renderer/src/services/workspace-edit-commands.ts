import type { WorkspaceEditTransactionResult } from '../../../preload/types';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';

function fullPath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  return `${workspacePath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return /^[A-Z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function updateOpenTabsFromTransaction(result: WorkspaceEditTransactionResult, workspacePath: string): void {
  const changed = new Map(result.files.map((file) => [normalizePath(fullPath(workspacePath, file.filePath)), file]));
  useWorkspaceEditStore.setState((state) => ({
    pendingEditorContents: {
      ...state.pendingEditorContents,
      ...Object.fromEntries(result.files.map((file) => [fullPath(workspacePath, file.filePath), file.content]))
    }
  }));
  useWorkspaceStore.setState((state) => ({
    openTabs: state.openTabs.map((tab) => {
      const file = changed.get(normalizePath(tab.path));
      return file ? { ...tab, content: file.content, isDirty: file.isDirty } : tab;
    })
  }));
}

export function handleAutoAppliedTransaction(result: WorkspaceEditTransactionResult): void {
  const workspace = useWorkspaceStore.getState();
  updateOpenTabsFromTransaction(result, workspace.workspacePath);
  useWorkspaceEditStore.getState().markTransactionApplied(result.transactionId);
  useWorkspaceEditStore.getState().recordRecentEdit({
    transactionId: result.transactionId,
    origin: result.origin,
    createdAt: Date.now(),
    fileCount: result.fileCount,
    autoApplied: true
  });
  window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: result.files.map((file) => file.filePath) }));
  void workspace.refreshFileTree();
  toast.info('Low-risk edit auto-applied', `${result.fileCount} tracked file${result.fileCount === 1 ? '' : 's'} changed.`, {
    label: 'Undo',
    onClick: () => { void undoWorkspaceEditTransaction(result.transactionId); }
  });
}

export async function undoWorkspaceEditTransaction(transactionId: string): Promise<void> {
  const response = await window.electronAPI.undoWorkspaceEdit(transactionId);
  if (!response.success || !response.data) {
    toast.error('Could not undo edit', response.error || 'The files changed after the edit was applied.');
    return;
  }
  const workspace = useWorkspaceStore.getState();
  updateOpenTabsFromTransaction(response.data, workspace.workspacePath);
  window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: response.data.files.map((file) => file.filePath) }));
  useWorkspaceEditStore.getState().removeRecentEdit(transactionId);
  useWorkspaceEditStore.getState().invalidateUndoShortcut();
  await workspace.refreshFileTree();
  toast.success('Edit undone', `${response.data.fileCount} file${response.data.fileCount === 1 ? '' : 's'} restored.`);
}

export async function undoWorkspaceEditFromEditor(): Promise<void> {
  const state = useWorkspaceEditStore.getState();
  if (!state.lastAppliedTransactionId || state.lastAppliedEditorRevision !== state.editorRevision) return;
  await undoWorkspaceEditTransaction(state.lastAppliedTransactionId);
}
