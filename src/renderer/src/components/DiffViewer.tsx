import React, { useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {
  X,
  Plus,
  Minus,
  RotateCcw,
  Split,
  Columns,
  ChevronUp,
  ChevronDown,
  FileCode,
  Check
} from 'lucide-react';
import { useGitStore } from '../state/git-store';

export const DiffViewer: React.FC = () => {
  const {
    activeDiff,
    diffInline,
    setDiffInline,
    closeDiff,
    stageFile,
    unstageFile,
    discardChanges
  } = useGitStore();

  const [hunkIndex, setHunkIndex] = useState(0);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

  if (!activeDiff) return null;

  const detectLanguage = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'json':
        return 'json';
      case 'md':
        return 'markdown';
      case 'css':
        return 'css';
      case 'html':
        return 'html';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      default:
        return 'plaintext';
    }
  };

  const language = detectLanguage(activeDiff.filePath);

  const handleDiffMount = (editor: Monaco.editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor;
  };

  const handleNextHunk = () => {
    if (!diffEditorRef.current) return;
    const navigator = diffEditorRef.current.getLineChanges();
    if (navigator && navigator.length > 0) {
      const nextIndex = (hunkIndex + 1) % navigator.length;
      setHunkIndex(nextIndex);
      const change = navigator[nextIndex];
      diffEditorRef.current.getModifiedEditor().revealLineInCenter(change.modifiedStartLineNumber);
    }
  };

  const handlePrevHunk = () => {
    if (!diffEditorRef.current) return;
    const navigator = diffEditorRef.current.getLineChanges();
    if (navigator && navigator.length > 0) {
      const prevIndex = (hunkIndex - 1 + navigator.length) % navigator.length;
      setHunkIndex(prevIndex);
      const change = navigator[prevIndex];
      diffEditorRef.current.getModifiedEditor().revealLineInCenter(change.modifiedStartLineNumber);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      {/* Top Diff Review Action Bar */}
      <div
        style={{
          height: '38px',
          backgroundColor: '#1b1c22',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '12px'
        }}
      >
        {/* Left: File and Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileCode size={14} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {activeDiff.filePath}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            ({activeDiff.isStaged ? 'Staged (Index ↔ HEAD)' : 'Working Changes ↔ Index'})
          </span>
        </div>

        {/* Right: Controls (Hunk Navigation, Inline/Split Toggle, Stage, Close) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Hunk Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginRight: '6px' }}>
            <button
              onClick={handlePrevHunk}
              style={{ padding: '3px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}
              title="Previous Hunk"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={handleNextHunk}
              style={{ padding: '3px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}
              title="Next Hunk"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Inline vs Side-by-Side Toggle */}
          <button
            onClick={() => setDiffInline(!diffInline)}
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px'
            }}
            title={diffInline ? 'Switch to Side-by-Side View' : 'Switch to Inline Diff View'}
          >
            {diffInline ? <Columns size={13} /> : <Split size={13} />}
            <span>{diffInline ? 'Side-by-Side' : 'Inline'}</span>
          </button>

          {/* Stage / Unstage Action */}
          {activeDiff.isStaged ? (
            <button
              onClick={() => void unstageFile(activeDiff.filePath)}
              style={{
                padding: '3px 10px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px'
              }}
            >
              <Minus size={12} />
              <span>Unstage</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => void discardChanges(activeDiff.filePath)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-red)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px'
                }}
              >
                <RotateCcw size={12} />
                <span>Discard</span>
              </button>
              <button
                onClick={() => void stageFile(activeDiff.filePath)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: 500
                }}
              >
                <Plus size={12} />
                <span>Stage File</span>
              </button>
            </>
          )}

          {/* Close Diff Button */}
          <button
            onClick={closeDiff}
            style={{
              padding: '4px',
              borderRadius: '4px',
              color: 'var(--text-muted)'
            }}
            title="Close Diff View (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Monaco DiffEditor */}
      <div style={{ flex: 1, position: 'relative' }}>
        <DiffEditor
          original={activeDiff.originalContent}
          modified={activeDiff.modifiedContent}
          language={language}
          theme="vs-dark"
          onMount={handleDiffMount}
          options={{
            renderSideBySide: !diffInline,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            readOnly: true,
            renderWhitespace: 'selection',
            diffWordWrap: 'off'
          }}
        />
      </div>
    </div>
  );
};
