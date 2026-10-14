import React, { useEffect, useState, useRef } from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import {
  X,
  Check,
  FileEdit,
  Code2,
  SplitSquareVertical,
  SplitSquareHorizontal,
  LayoutTemplate,
  WrapText,
  Maximize2,
  Minimize2,
  Save,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { GitBlameGutter } from './GitBlameGutter';
import {
  registerMonacoLspProviders,
  syncDocumentWithLsp,
  notifyDocumentChanged,
  notifyDocumentSaved,
  notifyDocumentClosed
} from '../services/monaco-lsp-adapter';

interface SplitPaneState {
  isSplit: boolean;
  orientation: 'horizontal' | 'vertical';
  secondaryTabPath: string | null;
}

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

  const monaco = useMonaco();
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [wordWrap, setWordWrap] = useState<'off' | 'on'>('off');
  const [isZenMode, setIsZenMode] = useState(false);
  const [splitState, setSplitState] = useState<SplitPaneState>({
    isSplit: false,
    orientation: 'vertical',
    secondaryTabPath: null
  });

  const editorRef = useRef<any>(null);
  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const secondaryTab = openTabs.find((t) => t.path === splitState.secondaryTabPath) || openTabs[1] || null;

  // Register LSP providers once Monaco is loaded
  useEffect(() => {
    if (monaco) {
      registerMonacoLspProviders(monaco);
    }
  }, [monaco]);

  // Sync active file with LSP when opened or tab switches
  useEffect(() => {
    if (activeTab) {
      syncDocumentWithLsp(activeTab.path, activeTab.language, activeTab.content);
    }
  }, [activeTab?.path]);

  // Global Keyboard shortcuts in editor area
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTab) {
          notifyDocumentSaved(activeTab.path, activeTab.content);
        }
        void saveActiveFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleSplit('vertical');
      } else if (e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveFile, activeTab]);

  const toggleSplit = (orientation: 'horizontal' | 'vertical') => {
    setSplitState((prev) => {
      if (prev.isSplit && prev.orientation === orientation) {
        return { ...prev, isSplit: false };
      }
      const otherTab = openTabs.find((t) => t.path !== activeTabPath) || null;
      return {
        isSplit: true,
        orientation,
        secondaryTabPath: otherTab ? otherTab.path : activeTabPath
      };
    });
  };

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;

    // Enable multi-cursor modifier
    editor.updateOptions({
      multiCursorModifier: 'alt',
      bracketPairColorization: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true,
        highlightActiveIndentation: true
      },
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'always',
      renderWhitespace: 'selection'
    });
  };

  const handleContentChange = (path: string, newContent: string) => {
    updateTabContent(path, newContent);
    notifyDocumentChanged(path, newContent);
  };

  const handleCloseTab = (path: string) => {
    notifyDocumentClosed(path);
    closeTab(path);
    if (splitState.secondaryTabPath === path) {
      setSplitState((prev) => ({ ...prev, secondaryTabPath: null, isSplit: false }));
    }
  };

  // Breadcrumbs path split
  const pathParts = activeTab ? activeTab.path.replace(/\\/g, '/').split('/').filter(Boolean) : [];
  const displayParts = pathParts.slice(-4);

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
        position: isZenMode ? 'fixed' : 'relative',
        inset: isZenMode ? 0 : undefined,
        zIndex: isZenMode ? 9000 : 1
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
                fontSize: '11px',
                borderRadius: '4px'
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
                fontSize: '11px',
                borderRadius: '4px'
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
            justifyContent: 'space-between',
            userSelect: 'none',
            overflow: 'hidden'
          }}
        >
          {/* Tabs List */}
          <div style={{ display: 'flex', alignItems: 'center', height: '100%', overflowX: 'auto', flex: 1 }}>
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
                    borderTop: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                    flexShrink: 0
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
                      handleCloseTab(tab.path);
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

          {/* Right Toolbar: Split Editor, Minimap, Word Wrap, Zen Mode, Git Blame */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px', flexShrink: 0 }}>
            {/* Split Vertical */}
            <button
              onClick={() => toggleSplit('vertical')}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: splitState.isSplit && splitState.orientation === 'vertical' ? 'var(--accent-primary)' : 'var(--text-muted)',
                backgroundColor: splitState.isSplit && splitState.orientation === 'vertical' ? 'var(--bg-tertiary)' : 'transparent'
              }}
              title="Split Editor Right (Ctrl+\)"
            >
              <SplitSquareVertical size={14} />
            </button>

            {/* Split Horizontal */}
            <button
              onClick={() => toggleSplit('horizontal')}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: splitState.isSplit && splitState.orientation === 'horizontal' ? 'var(--accent-primary)' : 'var(--text-muted)',
                backgroundColor: splitState.isSplit && splitState.orientation === 'horizontal' ? 'var(--bg-tertiary)' : 'transparent'
              }}
              title="Split Editor Down"
            >
              <SplitSquareHorizontal size={14} />
            </button>

            {/* Toggle Minimap */}
            <button
              onClick={() => setMinimapEnabled((prev) => !prev)}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: minimapEnabled ? 'var(--accent-primary)' : 'var(--text-muted)'
              }}
              title="Toggle Minimap"
            >
              <LayoutTemplate size={14} />
            </button>

            {/* Toggle Word Wrap */}
            <button
              onClick={() => setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'))}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: wordWrap === 'on' ? 'var(--accent-primary)' : 'var(--text-muted)'
              }}
              title="Toggle Word Wrap (Alt+Z)"
            >
              <WrapText size={14} />
            </button>

            {/* Zen Mode */}
            <button
              onClick={() => setIsZenMode((prev) => !prev)}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: isZenMode ? 'var(--accent-amber)' : 'var(--text-muted)'
              }}
              title="Toggle Zen Mode"
            >
              {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            {/* Git Blame Gutter Info */}
            {activeTab && (
              <div style={{ marginLeft: '6px' }}>
                <GitBlameGutter filePath={activeTab.path} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Breadcrumb Navigation Bar */}
      {activeTab && !diffReview?.isOpen && (
        <div
          style={{
            height: '24px',
            backgroundColor: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            gap: '4px',
            userSelect: 'none'
          }}
        >
          {displayParts.map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 && <ChevronRight size={10} color="var(--border-strong)" />}
              <span
                style={{
                  color: index === displayParts.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: index === displayParts.length - 1 ? 600 : 400
                }}
              >
                {part}
              </span>
            </React.Fragment>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
            <span style={{ color: 'var(--accent-cyan)' }}>LSP Active</span>
            <span>{activeTab.language}</span>
          </div>
        </div>
      )}

      {/* Main Monaco Surface (Single or Split Pane) */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: splitState.orientation === 'horizontal' ? 'column' : 'row' }}>
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
          <>
            {/* Primary Editor Pane */}
            <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
              <Editor
                key={`primary_${activeTab.path}`}
                path={activeTab.path}
                language={activeTab.language}
                value={activeTab.content}
                theme="vs-dark"
                onMount={handleEditorMount}
                onChange={(val) => {
                  if (val !== undefined) handleContentChange(activeTab.path, val);
                }}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  minimap: { enabled: minimapEnabled, side: 'right' },
                  wordWrap,
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  tabSize: 2,
                  bracketPairColorization: { enabled: true },
                  guides: {
                    indentation: true,
                    bracketPairs: true,
                    highlightActiveIndentation: true
                  },
                  multiCursorModifier: 'alt'
                }}
              />
            </div>

            {/* Secondary Split Pane if Active */}
            {splitState.isSplit && secondaryTab && (
              <div
                style={{
                  flex: 1,
                  height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                  borderLeft: splitState.orientation === 'vertical' ? '1px solid var(--border-subtle)' : 'none',
                  borderTop: splitState.orientation === 'horizontal' ? '1px solid var(--border-subtle)' : 'none'
                }}
              >
                <div
                  style={{
                    height: '24px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <span>{secondaryTab.name} (Split View)</span>
                  <button
                    onClick={() => setSplitState((prev) => ({ ...prev, isSplit: false }))}
                    style={{ padding: '2px', color: 'var(--text-muted)' }}
                    title="Close Split"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div style={{ height: 'calc(100% - 24px)' }}>
                  <Editor
                    key={`secondary_${secondaryTab.path}`}
                    path={secondaryTab.path}
                    language={secondaryTab.language}
                    value={secondaryTab.content}
                    theme="vs-dark"
                    onChange={(val) => {
                      if (val !== undefined) handleContentChange(secondaryTab.path, val);
                    }}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      minimap: { enabled: false },
                      wordWrap,
                      lineNumbers: 'on',
                      bracketPairColorization: { enabled: true },
                      multiCursorModifier: 'alt'
                    }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              height: '100%',
              width: '100%',
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
              <span>Press <strong>Ctrl+P</strong> to quickly open any file in your project</span>
              <span>Press <strong>Ctrl+Shift+P</strong> to open the Command Palette</span>
              <span>Press <strong>Ctrl+Shift+F</strong> for global search and replace</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
