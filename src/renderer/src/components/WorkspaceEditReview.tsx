import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, ChevronDown, ChevronRight, RefreshCw, Undo2, X } from 'lucide-react';
import type { WorkspaceEditPreview, WorkspaceEditTransactionResult } from '../../../preload/types';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import './WorkspaceEditReview.css';

function fullPath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  return `${workspacePath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return /^[A-Z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function applyResultToOpenTabs(result: WorkspaceEditTransactionResult, workspacePath: string): void {
  const changed = new Map(result.files.map((file) => [normalizePath(fullPath(workspacePath, file.filePath)), file]));
  useWorkspaceStore.setState((state) => ({
    openTabs: state.openTabs.map((tab) => {
      const file = changed.get(normalizePath(tab.path));
      return file ? { ...tab, content: file.content, isDirty: file.isDirty } : tab;
    })
  }));
}

export const WorkspaceEditReview: React.FC = () => {
  const { request, clearRequest, updatePreview, refreshRecentEdits } = useWorkspaceEditStore();
  const { workspacePath, openTabs, refreshFileTree } = useWorkspaceStore();
  const [selectedFile, setSelectedFile] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedFile(0);
    setError('');
  }, [request?.preview.previewId]);

  useEffect(() => {
    if (request) void refreshRecentEdits();
  }, [request, refreshRecentEdits]);

  if (!request) return null;
  const preview = request.preview;
  const selected = preview.files[selectedFile];
  const isMultiFile = preview.files.length > 1;
  const isStale = request.isStale || error.toLowerCase().includes('stale') || error.toLowerCase().includes('changed since');
  const applyLabel = preview.origin === 'lsp-rename' ? 'Apply rename' : preview.origin === 'refactor' ? 'Apply refactor' : 'Apply replacements';
  const blockedDirtySearch = preview.origin === 'search-replace' && preview.files.some((file) => {
    const tab = openTabs.find((item) => normalizePath(item.path) === normalizePath(fullPath(workspacePath, file.filePath)));
    return tab?.isDirty;
  });

  const cancel = async () => {
    await window.electronAPI.cancelWorkspaceEdit(preview.previewId);
    clearRequest();
  };

  const refresh = async () => {
    setError('');
    setIsApplying(true);
    try {
      const next = await request.refresh();
      await window.electronAPI.cancelWorkspaceEdit(preview.previewId);
      updatePreview(next);
      setSelectedFile(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsApplying(false);
    }
  };

  const apply = async () => {
    setIsApplying(true);
    setError('');
    try {
      const response = await window.electronAPI.applyWorkspaceEdit(preview.previewId);
      if (!response.success || !response.data) throw new Error(response.error || 'The edit transaction could not be applied.');
      const result = response.data;
      applyResultToOpenTabs(result, workspacePath);
      window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: result.files.map((file) => file.filePath) }));
      clearRequest();
      await refreshFileTree();
      await refreshRecentEdits();
      toast.success(`${applyLabel} complete`, `${result.fileCount} file${result.fileCount === 1 ? '' : 's'} changed.`, {
        label: 'Undo',
        onClick: () => { void undoTransaction(result.transactionId); }
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsApplying(false);
    }
  };

  async function undoTransaction(transactionId: string): Promise<void> {
    const response = await window.electronAPI.undoWorkspaceEdit(transactionId);
    if (!response.success || !response.data) {
      toast.error('Could not undo edit', response.error || 'The files changed after the edit was applied.');
      return;
    }
    applyResultToOpenTabs(response.data, workspacePath);
    window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: response.data.files.map((file) => file.filePath) }));
    useWorkspaceEditStore.getState().removeRecentEdit(transactionId);
    await refreshFileTree();
    toast.success('Edit undone', `${response.data.fileCount} file${response.data.fileCount === 1 ? '' : 's'} restored.`);
  }

  return (
    <section className="workspace-edit-review" aria-label="Review workspace edits">
      <header className="workspace-edit-review__header">
        <div className="workspace-edit-review__heading">
          <strong>{preview.title}</strong>
          <span>{preview.totalEdits} changes in {preview.files.length} file{preview.files.length === 1 ? '' : 's'}</span>
          {isMultiFile && <span className="workspace-edit-review__atomic">All files apply together</span>}
        </div>
        <div className="workspace-edit-review__actions">
          {isStale && <button type="button" className="workspace-edit-review__refresh" onClick={() => void refresh()} disabled={isApplying}><RefreshCw size={13} />Refresh preview</button>}
          <button type="button" className="workspace-edit-review__apply" onClick={() => void apply()} disabled={isApplying || !preview.files.length || blockedDirtySearch || request.isStale}>
            <Check size={13} />{isApplying ? 'Applying…' : applyLabel}
          </button>
          <button type="button" className="workspace-edit-review__cancel" onClick={() => void cancel()} disabled={isApplying}><X size={13} />Cancel</button>
        </div>
      </header>

      {error && <div className="workspace-edit-review__error" role="alert">{error}</div>}
      {request.isStale && !error && <div className="workspace-edit-review__warning" role="status">Search or replacement options changed. Refresh the preview before applying.</div>}
      {blockedDirtySearch && <div className="workspace-edit-review__warning" role="status">Save or discard unsaved changes in affected files, then refresh the preview.</div>}

      <div className="workspace-edit-review__body">
        <nav className="workspace-edit-review__files" aria-label="Affected files">
          {preview.files.map((file, index) => (
            <button key={file.filePath} type="button" className={index === selectedFile ? 'is-selected' : ''} onClick={() => setSelectedFile(index)} aria-current={index === selectedFile ? 'true' : undefined}>
              {index === selectedFile ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="workspace-edit-review__file-path" title={file.filePath}>{file.filePath}</span>
              <span className="workspace-edit-review__file-count">{file.editCount}</span>
            </button>
          ))}
        </nav>
        <div className="workspace-edit-review__diff" aria-label={selected ? `Diff for ${selected.filePath}` : 'No file selected'}>
          {selected && <DiffEditor
            original={selected.originalContent}
            modified={selected.modifiedContent}
            language={openTabs.find((tab) => normalizePath(tab.path) === normalizePath(fullPath(workspacePath, selected.filePath)))?.language || 'plaintext'}
            theme="vs-dark"
            options={{ readOnly: true, renderSideBySide: true, automaticLayout: true, scrollBeyondLastLine: false, minimap: { enabled: false }, fontSize: 13, fontFamily: 'var(--font-mono)' }}
          />}
        </div>
      </div>
    </section>
  );
};
