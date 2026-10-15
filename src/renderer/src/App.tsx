import React, { useEffect, useState, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityBar, type ActivityTab } from './components/ActivityBar';
import { Sidebar } from './components/Sidebar';
import { SearchPanel } from './components/SearchPanel';
import { SourceControlPanel } from './components/SourceControlPanel';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { OutlineView } from './components/OutlineView';
import { CodeReviewPanel } from './components/CodeReviewPanel';
import { CanvasWebview } from './components/CanvasWebview';
import { EditorArea } from './components/EditorArea';
import { DiffViewer } from './components/DiffViewer';
import { ChatSidecar } from './components/ChatSidecar';
import { TerminalDrawer } from './components/TerminalDrawer';
import { StatusBar } from './components/StatusBar';
import { QuickOpen } from './components/QuickOpen';
import { CommandPalette } from './components/CommandPalette';
import { SettingsModal } from './components/SettingsModal';
import { UsageDashboard } from './components/UsageDashboard';
import { OnboardingWizard } from './components/OnboardingWizard';
import { WorkspaceEditReview } from './components/WorkspaceEditReview';
import { ToastContainer } from './components/ToastContainer';
import { ExtensionInputDialog } from './components/ExtensionInputDialog';
import { AgentApprovalModal } from './components/AgentApprovalModal';
import { useChatStore } from './state/chat-store';
import { useWorkspaceStore } from './state/workspace-store';
import { useEditorNavigationStore } from './state/editor-navigation-store';

export const App: React.FC = () => {
  const [activityTab, setActivityTab] = useState<ActivityTab>('explorer');
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [quickOpenInitialQuery, setQuickOpenInitialQuery] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Resizable Sidebars State
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(380);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [isSketcherExpanded, setIsSketcherExpanded] = useState(false);

  // Automatically widen left sidebar when opening UI sketcher if too narrow
  useEffect(() => {
    if (activityTab === 'ui-sketcher' && leftWidth < 380) {
      setLeftWidth(380);
    }
  }, [activityTab, leftWidth]);

  const { initSettings, toggleTerminal, toggleSettings } = useChatStore();
  const { setWorkspacePath, setFileTree } = useWorkspaceStore();
  const navigateTo = useEditorNavigationStore((state) => state.navigateTo);

  useEffect(() => {
    initSettings();

    // Auto-load current workspace tree
    (async () => {
      try {
        const treeRes = await window.electronAPI.getWorkspaceTree('');
        if (treeRes.success && treeRes.data) {
          setWorkspacePath(treeRes.data.path);
          setFileTree(treeRes.data);
        }
      } catch (err) {
        console.error('Failed to load initial workspace:', err);
      }
    })();
  }, [initSettings, setWorkspacePath, setFileTree]);

  // Global Keyboard Shortcuts (Ctrl+P, Ctrl+Shift+P, Ctrl+Shift+F, Ctrl+Shift+G, Ctrl+`)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsQuickOpenOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActivityTab('search');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setActivityTab('source-control');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setQuickOpenInitialQuery('#');
        setIsQuickOpenOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setQuickOpenInitialQuery(':');
        setIsQuickOpenOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setQuickOpenInitialQuery('@');
        setIsQuickOpenOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        toggleSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        setActivityTab('extensions');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        useEditorNavigationStore.getState().runAction('toggleMinimap');
      } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminal, toggleSettings]);

  // Handle Left Sidebar Resizing
  const handleLeftMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
    const startX = e.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(550, startWidth + delta));
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Handle Right Sidebar (AI Chat) Resizing
  const handleRightMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
    const startX = e.clientX;
    const startWidth = rightWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Dragging leftwards increases the width of the right sidebar
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(280, Math.min(750, startWidth + delta));
      setRightWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingRight(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      {/* Top Application Title Bar */}
      <TitleBar />

      {/* Main Workspace Area (3-Column Layout with Resizers) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Leftmost Activity Bar */}
        <ActivityBar activeTab={activityTab} onTabChange={setActivityTab} />

        {/* Dynamic Primary Left Panel (Explorer / Search / Source Control / Code Review / Extensions / Skills / Outline) */}
        <div style={{ width: `${leftWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          {activityTab === 'explorer' && <Sidebar />}
          {activityTab === 'search' && <SearchPanel onNavigateToLocation={(filePath, line, column) => navigateTo({ filePath, line, column })} />}
          {activityTab === 'source-control' && <SourceControlPanel />}
          {activityTab === 'code-review' && <CodeReviewPanel />}
          {activityTab === 'extensions' && <ExtensionsPanel />}
          {activityTab === 'skills' && <SkillsPanel />}
          {activityTab === 'outline' && <OutlineView onNavigateToLine={(line) => navigateTo({ line })} />}
          {activityTab === 'ui-sketcher' && (
            <CanvasWebview
              isExpanded={isSketcherExpanded}
              onExpandToggle={(expanded) => {
                setIsSketcherExpanded(expanded);
                if (expanded) {
                  setLeftWidth((w) => Math.max(w, 640));
                } else {
                  setLeftWidth(380);
                }
              }}
            />
          )}
        </div>

        {/* Left Splitter Resizer Handle */}
        <div
          className={`resizer-col ${isDraggingLeft ? 'dragging' : ''}`}
          onMouseDown={handleLeftMouseDown}
          title="Drag to resize sidebar"
        />

        {/* Central Monaco Editor Workspace + Git Diff Viewer + Integrated Terminal */}
        <div style={{ flex: 1, height: '100%', minWidth: 200, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <EditorArea />
            <DiffViewer />
            <WorkspaceEditReview />
          </div>
          {/* Integrated Terminal docked and locked within editor width bounds */}
          <TerminalDrawer />
        </div>

        {/* Right Splitter Resizer Handle */}
        <div
          className={`resizer-col ${isDraggingRight ? 'dragging' : ''}`}
          onMouseDown={handleRightMouseDown}
          title="Drag to resize assistant panel"
        />

        {/* Right AI Assistant Sidecar */}
        <div style={{ width: `${rightWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          <ChatSidecar />
        </div>
      </div>

      {/* Editor status bar */}
      <StatusBar />

      {/* Quick Open File (Ctrl+P, :line, @symbol) */}
      <QuickOpen
        isOpen={isQuickOpenOpen}
        initialQuery={quickOpenInitialQuery}
        onClose={() => { setIsQuickOpenOpen(false); setQuickOpenInitialQuery(''); }}
        onSwitchToCommandPalette={() => setIsCommandPaletteOpen(true)}
        onNavigateToLine={(lineNumber, filePath) => navigateTo({ line: lineNumber, filePath })}
      />

      {/* Command Palette (Ctrl+Shift+P) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigateToView={(view) => setActivityTab(view as any)}
        onToggleMinimap={() => useEditorNavigationStore.getState().runAction('toggleMinimap')}
        onToggleWordWrap={() => useEditorNavigationStore.getState().runAction('toggleWordWrap')}
        onToggleZenMode={() => useEditorNavigationStore.getState().runAction('toggleZenMode')}
        onSplitEditor={(orientation) => useEditorNavigationStore.getState().runAction(orientation === 'vertical' ? 'splitVertical' : 'splitHorizontal')}
        onOpenWorkspaceSymbols={() => { setQuickOpenInitialQuery('#'); setIsQuickOpenOpen(true); }}
        onOpenQuickOpen={(initialQuery) => { setQuickOpenInitialQuery(initialQuery); setIsQuickOpenOpen(true); }}
      />

      {/* Settings & Usage Modals */}
      <SettingsModal />
      <UsageDashboard />
      <OnboardingWizard />
      <ExtensionInputDialog />
      <AgentApprovalModal />

      {/* Global Toast Notifications */}
      <ToastContainer />
    </div>
  );
};
