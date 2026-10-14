import React, { useEffect } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { X, Check, FileEdit, Code2 } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';

export const EditorArea: React.FC = () => {
  const {
    openTabs,
    activeTabPath,
    setActiveTab,
    closeTab,
    updateTabContent,
    saveActiveFile,
    diffReview,
    closeDiffReview,
    applyDiff
  } = useWorkspaceStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveFile]);

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden'
      }}
    >
      {/* Diff Review Bar if Diff Active */}
      {diffReview?.isOpen && (
        <div
          style={{
            height: '38px',
            backgroundColor: 'rgba(139, 92, 246, 0.15)',
            borderBottom: '1px solid var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            <FileEdit size={14} color="var(--accent-primary)" />
            <span>
              Reviewing AI proposed modifications to <strong>{diffReview.diff.filePath}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => applyDiff(diffReview.diff)}
              style={{
                backgroundColor: 'var(--accent-green)',
                color: '#fff',
                padding: '4px 10px',
                fontWeight: 500,
                fontSize: '11px'
              }}
            >
              <Check size={12} />
              <span>Apply Changes</span>
            </button>
            <button
              onClick={closeDiffReview}
              style={{
                backgroundColor: 'var(--bg-hover)',
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                fontSize: '11px'
              }}
            >
              <X size={12} />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Tabs Header */}
      {!diffReview?.isOpen && (
        <div
          style={{
            height: '35px',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            overflowX: 'auto',
            userSelect: 'none'
          }}
        >
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            return (
              <div
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                style={{
                  height: '100%',
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  backgroundColor: isActive ? 'var(--bg-primary)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderRight: '1px solid var(--border-subtle)',
                  borderTop: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                <span>{tab.name}</span>
                {tab.isDirty && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-cyan)'
                    }}
                    title="Unsaved changes"
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                  style={{
                    padding: '2px',
                    borderRadius: '3px',
                    color: 'var(--text-muted)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Monaco Surface */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {diffReview?.isOpen ? (
          <DiffEditor
            original={diffReview.diff.originalContent}
            modified={diffReview.diff.proposedContent}
            language="typescript"
            theme="vs-dark"
            options={{
              renderSideBySide: true,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              readOnly: true
            }}
          />
        ) : activeTab ? (
          <Editor
            key={activeTab.path}
            path={activeTab.path}
            language={activeTab.language}
            value={activeTab.content}
            theme="vs-dark"
            onChange={(val) => {
              if (val !== undefined) {
                updateTabContent(activeTab.path, val);
              }
            }}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: true },
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              tabSize: 2
            }}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              color: 'var(--text-muted)'
            }}
          >
            <Code2 size={48} strokeWidth={1.5} color="var(--border-strong)" />
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              No file is currently open
            </div>
            <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'center' }}>
              <span>Select a file from the explorer on the left</span>
              <span>Or ask the AI Assistant on the right to inspect or edit your code</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
