import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Check, ChevronDown, ChevronUp, Columns, Minus, Plus, RotateCcw, Split, X } from 'lucide-react';
import { ensureMonaco, useMonacoRuntime } from '../services/monaco-runtime';
import { registerScmDiffNavigator } from '../services/scm-diff-navigation';
import { useGitStore } from '../state/git-store';
import { toast } from '../state/toast-store';
import { useThemeSync, getMonacoTheme } from '../hooks/useThemeSync';
import './SourceControlPanel.css';

export const DiffViewer: React.FC = () => {
  const theme = useThemeSync();
  const monacoTheme = getMonacoTheme(theme);
  // Zustand selector audit: narrow slices to eliminate render storms
  const activeDiff = useGitStore((s) => s.activeDiff);
  const activeHunks = useGitStore((s) => s.activeHunks);
  const diffInline = useGitStore((s) => s.diffInline);
  const setDiffInline = useGitStore((s) => s.setDiffInline);
  const closeDiff = useGitStore((s) => s.closeDiff);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const discardChanges = useGitStore((s) => s.discardChanges);
  const applyHunk = useGitStore((s) => s.applyHunk);

  const [hunkIndex, setHunkIndex] = useState(0);
  const monacoRuntime = useMonacoRuntime();
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    setHunkIndex(0);
  }, [activeDiff?.filePath, activeDiff?.isStaged]);

  useEffect(() => {
    if (activeDiff && monacoRuntime.status === 'idle') {
      void ensureMonaco().catch(() => undefined);
    }
  }, [activeDiff, monacoRuntime.status]);

  // Go G7's "else SCM" half: publish a hunk stepper to the command layer while
  // this overlay is open, so Alt+F3 / Shift+Alt+F3 walk git's hunks instead of
  // falling through to whatever diff editor the editor service has registered.
  //
  // The stepper lives here rather than in the editor service because this
  // component owns `hunkIndex`, and that same index drives the Stage / Unstage /
  // Revert-hunk buttons below. Handing the Monaco diff editor to the editor
  // service instead would let Alt+F3 move the cursor while `hunkIndex` still
  // pointed at the previous hunk — so "Revert hunk" would destroy work the user
  // is no longer looking at. Git's hunk list and the change list Monaco
  // computes from the two strings it is handed are not 1:1 either, so the two
  // cannot simply be swapped.
  const hunkIndexRef = useRef(0);

  useEffect(() => {
    hunkIndexRef.current = hunkIndex;
  }, [hunkIndex]);

  /**
   * Step to a hunk and centre it in the modified pane. Wraps at both ends, so
   * repeated Alt+F3 cycles a long diff rather than stopping at the last change.
   *
   * Returns false when this diff has no hunks at all, which is how the Go
   * handler learns there is nothing here to walk and should try the diff editor
   * registered with the editor service instead.
   */
  const stepToHunk = useCallback(
    (index: number): boolean => {
      if (!activeHunks.length) return false;
      const nextIndex = (index + activeHunks.length) % activeHunks.length;
      setHunkIndex(nextIndex);
      const selected = activeHunks[nextIndex];
      const lineNumber = selected.newStart || selected.oldStart || 1;
      diffEditorRef.current?.getModifiedEditor().revealLineInCenter(lineNumber);
      return true;
    },
    [activeHunks]
  );

  // Withdrawn on close and on unmount, which restores the *previous* navigator
  // rather than clearing it — so StrictMode's double mount and a popout window
  // closing both leave the Go menu pointed at something real.
  useEffect(() => {
    if (!activeDiff) return;
    const registration = registerScmDiffNavigator({
      hunkCount: () => activeHunks.length,
      step: (direction) => stepToHunk(hunkIndexRef.current + direction)
    });
    return () => registration.dispose();
  }, [activeDiff, activeHunks, stepToHunk]);

  // Defer DiffEditor layout to rAF after visibility or diff change
  useEffect(() => {
    if (!diffEditorRef.current) return;
    const rafId = window.requestAnimationFrame(() => {
      try {
        diffEditorRef.current?.layout();
      } catch {
        // Layout transition
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [diffInline, activeDiff?.filePath]);

  useEffect(() => {
    setHunkIndex((current) => Math.max(0, Math.min(current, activeHunks.length - 1)));
  }, [activeHunks.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeDiff) closeDiff();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDiff, closeDiff]);

  if (!activeDiff) return null;

  const languageByExtension: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    go: 'go', rs: 'rust', yml: 'yaml', yaml: 'yaml', sh: 'shell'
  };
  const extension = activeDiff.filePath.split('.').pop()?.toLowerCase() || '';
  const language = languageByExtension[extension] || 'plaintext';
  const activeHunk = activeHunks[hunkIndex];

  const handleDiscard = () => {
    const description = activeDiff.isUntracked ? 'Delete untracked file' : 'Discard all unstaged working-tree changes';
    toast.warning(`${description}?`, `Target: "${activeDiff.filePath}". This cannot be undone.`, {
      label: 'Discard',
      onClick: () => {
        void discardChanges(activeDiff.filePath, activeDiff.isUntracked);
      }
    });
  };

  return <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
    <header style={{ minHeight: 38, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', fontSize: 11 }}>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: 'var(--accent-primary)' }}><Split size={13} /></span>
        <strong style={{ minWidth: 0, overflow: 'hidden', color: 'var(--text-primary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeDiff.filePath}</strong>
        <span style={{ flexShrink: 0, color: 'var(--text-muted)' }}>{activeDiff.isStaged ? 'Staged · HEAD ↔ Index' : 'Working Tree ↔ Index'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 5 }}>
          <button aria-label="Previous diff hunk" title="Previous hunk" disabled={!activeHunks.length} onClick={() => stepToHunk(hunkIndex - 1)} style={{ width: 23, height: 24, color: 'var(--text-secondary)' }}><ChevronUp size={13} /></button>
          <span aria-live="polite" style={{ minWidth: 35, color: 'var(--text-muted)', fontSize: 9, textAlign: 'center' }}>{activeHunks.length ? `${hunkIndex + 1} / ${activeHunks.length}` : '0 hunks'}</span>
          <button aria-label="Next diff hunk" title="Next hunk" disabled={!activeHunks.length} onClick={() => stepToHunk(hunkIndex + 1)} style={{ width: 23, height: 24, color: 'var(--text-secondary)' }}><ChevronDown size={13} /></button>
        </div>
        {activeHunk && <>
          {activeDiff.isStaged ? <button className="source-control-subtle-button" onClick={() => void applyHunk(activeHunk.id, 'unstage')} title="Unstage selected hunk"><Minus size={11} />Unstage hunk</button>
            : <>
              <button className="source-control-subtle-button" onClick={() => void applyHunk(activeHunk.id, 'stage')} title="Stage selected hunk"><Plus size={11} />Stage hunk</button>
              <button className="source-control-danger-button" onClick={() => {
                if (window.confirm(`Revert only this hunk in “${activeDiff.filePath}”?`)) void applyHunk(activeHunk.id, 'revert');
              }} title="Revert selected hunk"><RotateCcw size={11} />Revert hunk</button>
            </>}
        </>}
        <button onClick={() => setDiffInline(!diffInline)} title={diffInline ? 'Switch to side-by-side diff' : 'Switch to inline diff'} aria-label={diffInline ? 'Switch to side-by-side diff' : 'Switch to inline diff'} style={{ height: 25, padding: '0 7px', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: 9 }}>
          {diffInline ? <Columns size={12} /> : <Split size={12} />}{diffInline ? 'Side-by-side' : 'Inline'}
        </button>
        {activeDiff.isStaged ? <button className="source-control-subtle-button" onClick={() => void unstageFile(activeDiff.filePath)}><Minus size={11} />Unstage file</button>
          : <>
            <button className="source-control-danger-button" onClick={handleDiscard} title="Discard unstaged file changes"><RotateCcw size={11} />Discard</button>
            <button className="source-control-primary-button" onClick={() => void stageFile(activeDiff.filePath)}><Check size={11} />Stage file</button>
          </>}
        <button onClick={closeDiff} title="Close diff (Esc)" aria-label="Close diff" style={{ width: 25, height: 25, color: 'var(--text-muted)' }}><X size={14} /></button>
      </div>
    </header>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {!monacoRuntime.monaco ? <div role={monacoRuntime.error ? 'alert' : 'status'} style={{ padding: 16, color: 'var(--text-muted)' }}>{monacoRuntime.error || 'Loading diff editor…'}</div> : <DiffEditor
        original={activeDiff.originalContent}
        modified={activeDiff.modifiedContent}
        language={language}
        theme={monacoTheme}
        onMount={(editor) => { diffEditorRef.current = editor; }}
        options={{
          renderSideBySide: !diffInline,
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          readOnly: true,
          renderWhitespace: 'selection',
          diffWordWrap: 'off',
          originalEditable: false,
          minimap: { enabled: false }
        }}
      />}
    </div>
  </div>;
};
