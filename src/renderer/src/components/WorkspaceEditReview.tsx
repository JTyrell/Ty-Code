import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import type { WorkspaceEditPreview } from '../../../preload/types';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import { undoWorkspaceEditTransaction, updateOpenTabsFromTransaction } from '../services/workspace-edit-commands';
import { ensureMonaco, useMonacoRuntime } from '../services/monaco-runtime';
import { useThemeSync, getMonacoTheme } from '../hooks/useThemeSync';
import './WorkspaceEditReview.css';

function fullPath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  return `${workspacePath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return /^[A-Z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export const WorkspaceEditReview: React.FC = () => {
  const theme = useThemeSync();
  const monacoTheme = getMonacoTheme(theme);
  const { request, clearRequest, updatePreview, refreshRecentEdits, markTransactionApplied } = useWorkspaceEditStore();
  const { workspacePath, openTabs, refreshFileTree } = useWorkspaceStore();
  const [selectedFile, setSelectedFile] = useState(0);
  const monacoRuntime = useMonacoRuntime();
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  // Phase 4 per-hunk review — hunkAccept[fileIndex][hunkIndex]; a missing entry means
  // "everything accepted" so the default flow is byte-identical to the old Apply.
  const [hunkAccept, setHunkAccept] = useState<Record<number, boolean[]>>({});

  useEffect(() => {
    setSelectedFile(0);
    setError('');
    setHunkAccept({});
  }, [request?.preview.previewId]);

  useEffect(() => {
    if (request && monacoRuntime.status === 'idle') void ensureMonaco().catch(() => undefined);
  }, [request, monacoRuntime.status]);

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
  // Honesty: a rejected hunk means Apply composes a partial patch, not the full edit.
  const rejectedHunks = preview.files.reduce((total, file, fileIndex) => {
    const flags = hunkAccept[fileIndex];
    return flags ? total + flags.filter((accepted) => !accepted).length : total;
  }, 0);

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

  const isHunkAccepted = (fileIndex: number, hunkIndex: number): boolean =>
    hunkAccept[fileIndex]?.[hunkIndex] ?? true;

  const toggleHunk = (fileIndex: number, hunkIndex: number, total: number): void => {
    setHunkAccept((prev) => {
      const flags = prev[fileIndex] ?? Array.from({ length: total }, () => true);
      const next = [...flags];
      next[hunkIndex] = !(next[hunkIndex] ?? true);
      return { ...prev, [fileIndex]: next };
    });
  };

  const setFileHunks = (fileIndex: number, total: number, value: boolean): void => {
    setHunkAccept((prev) => ({ ...prev, [fileIndex]: Array.from({ length: total }, () => value) }));
  };

  /**
   * Build the accepted-hunk map for a partial apply. A file with everything kept
   * (default, or explicitly all accepted) is omitted so the main service composes it
   * in full; a file with any rejection sends its kept hunk indices (empty = revert).
   * Returns null when nothing is rejected, so the caller takes the plain full-apply path.
   */
  const buildComposedMap = (): Record<string, number[]> | null => {
    let partial = false;
    const map: Record<string, number[]> = {};
    preview.files.forEach((file, fileIndex) => {
      const total = file.diff.hunks.length;
      const flags = hunkAccept[fileIndex];
      if (!flags) return;
      const kept: number[] = [];
      flags.forEach((accepted, index) => {
        if (accepted) kept.push(index);
      });
      if (kept.length === total) return;
      partial = true;
      map[file.filePath] = kept;
    });
    return partial ? map : null;
  };

  const apply = async () => {
    setIsApplying(true);
    setError('');
    try {
      const composedMap = buildComposedMap();
      const response = composedMap
        ? await window.electronAPI.applyComposedWorkspaceEdit(preview.previewId, composedMap)
        : await window.electronAPI.applyWorkspaceEdit(preview.previewId);
      if (!response.success || !response.data) throw new Error(response.error || 'The edit transaction could not be applied.');
      const result = response.data;
      updateOpenTabsFromTransaction(result, workspacePath);
      markTransactionApplied(result.transactionId);
      window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: result.files.map((file) => file.filePath) }));
      clearRequest();
      await refreshFileTree();
      await refreshRecentEdits();
      toast.success(`${applyLabel} complete`, `${result.fileCount} file${result.fileCount === 1 ? '' : 's'} changed.`, {
        label: 'Undo',
        onClick: () => { void undoWorkspaceEditTransaction(result.transactionId); }
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsApplying(false);
    }
  };


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
            <Check size={13} />{isApplying ? 'Applying…' : rejectedHunks > 0 ? 'Apply accepted hunks' : applyLabel}
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
          {selected && selected.diff.hunks.length > 0 && (
            <div className="workspace-edit-review__hunks" role="group" aria-label="Per-hunk review" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)', marginRight: 2 }}>Hunks:</span>
              <button type="button" className="workspace-edit-review__hunk-all" onClick={() => setFileHunks(selectedFile, selected.diff.hunks.length, true)}><Check size={11} />Accept all</button>
              <button type="button" className="workspace-edit-review__hunk-all" onClick={() => setFileHunks(selectedFile, selected.diff.hunks.length, false)}><X size={11} />Reject all</button>
              {selected.diff.hunks.map((hunk, hunkIndex) => {
                const added = hunk.lines.filter((line) => line.startsWith('+')).length;
                const removed = hunk.lines.filter((line) => line.startsWith('-')).length;
                const accepted = isHunkAccepted(selectedFile, hunkIndex);
                return (
                  <button
                    key={hunkIndex}
                    type="button"
                    aria-pressed={accepted}
                    title={accepted ? `Accept hunk ${hunkIndex + 1} (click to reject)` : `Reject hunk ${hunkIndex + 1} (click to accept)`}
                    onClick={() => toggleHunk(selectedFile, hunkIndex, selected.diff.hunks.length)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: accepted ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: accepted ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)', textDecoration: accepted ? 'none' : 'line-through' }}
                  >
                    {accepted ? <Check size={11} /> : <X size={11} />}
                    #{hunkIndex + 1}
                    <span style={{ color: 'var(--text-muted)' }}>+{added}/-{removed}</span>
                  </button>
                );
              })}
            </div>
          )}
          {selected && !monacoRuntime.monaco && <div role={monacoRuntime.error ? 'alert' : 'status'} style={{ padding: 16, color: 'var(--text-muted)' }}>{monacoRuntime.error || 'Loading diff editor…'}</div>}
          {selected && monacoRuntime.monaco && <DiffEditor
            original={selected.originalContent}
            modified={selected.modifiedContent}
            language={openTabs.find((tab) => normalizePath(tab.path) === normalizePath(fullPath(workspacePath, selected.filePath)))?.language || 'plaintext'}
            theme={monacoTheme}
            options={{ readOnly: true, renderSideBySide: true, automaticLayout: true, scrollBeyondLastLine: false, minimap: { enabled: false }, fontSize: 13, fontFamily: 'var(--font-mono)' }}
          />}
        </div>
      </div>
    </section>
  );
};
