import React, { useEffect, useState, useRef, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityBar, type ActivityTab } from './components/ActivityBar';
import { Sidebar } from './components/Sidebar';
import { SearchPanel } from './components/SearchPanel';
import { SourceControlPanel } from './components/SourceControlPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { OutlineView } from './components/OutlineView';
import { EditorArea } from './components/EditorArea';
import { ViewSkeleton } from './components/common/ViewSkeleton';
import { ChatSidecar } from './components/ChatSidecar';
import { StatusBar } from './components/StatusBar';
import { AIBadge } from './components/AIBadge';
import { QuickOpen } from './components/QuickOpen';
import { CommandPalette } from './components/CommandPalette';
import { OnboardingWizard } from './components/OnboardingWizard';
import { FirstRunOnboardingModal } from './components/FirstRunOnboardingModal';
import { WorkspaceEditReview } from './components/WorkspaceEditReview';
import { ToastContainer } from './components/ToastContainer';
import { ExtensionInputDialog } from './components/ExtensionInputDialog';
import { AgentApprovalModal } from './components/AgentApprovalModal';
import { ExtensionTracePanel } from './components/extensions/ExtensionTracePanel';
import { transitionProfiler } from './services/perf/transition-profiler';
import { useChatStore } from './state/chat-store';
import { useWorkspaceStore } from './state/workspace-store';
import { useEditorNavigationStore } from './state/editor-navigation-store';

// Dynamic import() for Tier 2/3 heavy modules — no top-level static imports
const TerminalDrawer = React.lazy(() => import('./components/TerminalDrawer').then((m) => ({ default: m.TerminalDrawer })));
const ExtensionsPanel = React.lazy(() => import('./components/ExtensionsPanel').then((m) => ({ default: m.ExtensionsPanel })));
const BootTimeline = React.lazy(() => import('./components/BootTimeline').then((m) => ({ default: m.BootTimeline })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const UsageDashboard = React.lazy(() => import('./components/UsageDashboard').then((m) => ({ default: m.UsageDashboard })));
const CodeReviewPanel = React.lazy(() => import('./components/CodeReviewPanel').then((m) => ({ default: m.CodeReviewPanel })));
const CanvasWebview = React.lazy(() => import('./components/CanvasWebview').then((m) => ({ default: m.CanvasWebview })));
const DiffViewer = React.lazy(() => import('./components/DiffViewer').then((m) => ({ default: m.DiffViewer })));

export const App: React.FC = () => {
  const [activityTab, setActivityTab] = useState<ActivityTab>('explorer');
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [quickOpenInitialQuery, setQuickOpenInitialQuery] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isBootTimelineOpen, setIsBootTimelineOpen] = useState(false);
  const [isExtensionTraceOpen, setIsExtensionTraceOpen] = useState(false);

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

  // Zustand selector audit: subscribe to narrow slices only
  const initSettings = useChatStore((s) => s.initSettings);
  const toggleTerminal = useChatStore((s) => s.toggleTerminal);
  const toggleSettings = useChatStore((s) => s.toggleSettings);
  const setWorkspacePath = useWorkspaceStore((s) => s.setWorkspacePath);
  const setFileTree = useWorkspaceStore((s) => s.setFileTree);
  const navigateTo = useEditorNavigationStore((state) => state.navigateTo);

  // Measure panel transitions and promote tasks on demand
  const handleTabChange = useCallback((tab: ActivityTab) => {
    const eventName = tab === 'extensions' ? 'extensions_open' : `panel_open:${tab}`;
    const id = transitionProfiler.startTransition(eventName);
    if (tab === 'extensions') {
      void window.electronAPI?.bootSchedulerPromote?.('extension_host');
    }
    setActivityTab(tab);
    void transitionProfiler.endTransition(id, `panel_visible:${tab}`);
  }, []);

  const handleToggleTerminal = useCallback(() => {
    const id = transitionProfiler.startTransition('terminal_toggle');
    void window.electronAPI?.bootSchedulerPromote?.('terminal');
    toggleTerminal();
    void transitionProfiler.endTransition(id, 'terminal_toggle');
  }, [toggleTerminal]);

  const handleToggleSettings = useCallback(() => {
    const id = transitionProfiler.startTransition('settings_open');
    void window.electronAPI?.bootSchedulerPromote?.('settings_hydration');
    toggleSettings();
    void transitionProfiler.endTransition(id, 'settings_open');
  }, [toggleSettings]);

  // Preload terminal module during background/idle (instance created on first open)
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('./components/TerminalDrawer');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Listen for user interaction to notify boot scheduler and accelerate Tier 3
  useEffect(() => {
    const onUserInteract = (): void => {
      void window.electronAPI?.bootSchedulerNotifyInteraction?.();
      window.removeEventListener('pointerdown', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
    };
    window.addEventListener('pointerdown', onUserInteract, { once: true });
    window.addEventListener('keydown', onUserInteract, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
    };
  }, []);

  const lastLeftWidthRef = useRef(260);
  const lastRightWidthRef = useRef(380);

  // Listen for custom workbench events from TitleBar and Status Bar
  useEffect(() => {
    const onShowBootTimeline = (): void => setIsBootTimelineOpen(true);
    const onToggleLeft = (): void => {
      setLeftWidth((w) => {
        if (w > 0) {
          lastLeftWidthRef.current = w;
          return 0;
        }
        return lastLeftWidthRef.current || 260;
      });
    };
    const onToggleRight = (): void => {
      setRightWidth((w) => {
        if (w > 0) {
          lastRightWidthRef.current = w;
          return 0;
        }
        return lastRightWidthRef.current || 380;
      });
    };
    const onToggleAllPanels = (): void => {
      setLeftWidth((lw) => {
        if (lw > 0) {
          lastLeftWidthRef.current = lw;
          return 0;
        }
        return lastLeftWidthRef.current || 260;
      });
      setRightWidth((rw) => {
        if (rw > 0) {
          lastRightWidthRef.current = rw;
          return 0;
        }
        return lastRightWidthRef.current || 380;
      });
    };
    const onQuickOpen = (): void => setIsQuickOpenOpen(true);
    const onCommandPalette = (): void => setIsCommandPaletteOpen(true);

    window.addEventListener('workbench:show-boot-timeline', onShowBootTimeline);
    window.addEventListener('workbench:toggle-left-sidebar', onToggleLeft);
    window.addEventListener('workbench:toggle-right-sidebar', onToggleRight);
    window.addEventListener('workbench:toggle-all-panels', onToggleAllPanels);
    window.addEventListener('workbench:quick-open', onQuickOpen);
    window.addEventListener('workbench:command-palette', onCommandPalette);

    return () => {
      window.removeEventListener('workbench:show-boot-timeline', onShowBootTimeline);
      window.removeEventListener('workbench:toggle-left-sidebar', onToggleLeft);
      window.removeEventListener('workbench:toggle-right-sidebar', onToggleRight);
      window.removeEventListener('workbench:toggle-all-panels', onToggleAllPanels);
      window.removeEventListener('workbench:quick-open', onQuickOpen);
      window.removeEventListener('workbench:command-palette', onCommandPalette);
    };
  }, []);

  useEffect(() => {
    // Record renderer_first_paint after initial frame and paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (window.electronAPI?.perfRecordRendererMark) {
          void window.electronAPI.perfRecordRendererMark({
            name: 'renderer_first_paint',
            timestamp: performance.now(),
            phase: 'boot'
          });
        }
      }, 0);
    });

    initSettings();

    // Auto-load current workspace tree
    (async () => {
      try {
        const treeRes = await window.electronAPI.getWorkspaceTree('');
        if (treeRes.success && treeRes.data) {
          setWorkspacePath(treeRes.data.path);
          setFileTree(treeRes.data);
        }
        // Shell interactive mark
        if (window.electronAPI?.perfRecordRendererMark) {
          void window.electronAPI.perfRecordRendererMark({
            name: 'shell_interactive',
            timestamp: performance.now(),
            phase: 'boot'
          });
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
        handleToggleSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleTabChange('extensions');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        useEditorNavigationStore.getState().runAction('toggleMinimap');
      } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        handleToggleTerminal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTerminal, handleToggleSettings, handleTabChange]);

  // Handle Left Sidebar Resizing
  const handleLeftMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
    const startX = e.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth + delta));
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

      {/* Top-Right Floating AI Model Badge */}
      <AIBadge variant="floating-top" rightOffset={rightWidth} />

      {/* Main Workspace Area (3-Column Layout with Resizers) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Leftmost Activity Bar */}
        <ActivityBar activeTab={activityTab} onTabChange={handleTabChange} />

        {/* Dynamic Primary Left Panel (Explorer / Search / Source Control / Code Review / Extensions / Skills / Outline) */}
        <div style={{ width: `${leftWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          {activityTab === 'explorer' && <Sidebar />}
          {activityTab === 'search' && <SearchPanel onNavigateToLocation={(filePath, line, column) => navigateTo({ filePath, line, column })} />}
          {activityTab === 'source-control' && <SourceControlPanel />}
          <React.Suspense fallback={<ViewSkeleton type="panel" />}>
            {activityTab === 'code-review' && <CodeReviewPanel />}
            {activityTab === 'extensions' && <ExtensionsPanel />}
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
          </React.Suspense>
          {activityTab === 'skills' && <SkillsPanel />}
          {activityTab === 'outline' && <OutlineView onNavigateToLine={(line) => navigateTo({ line })} />}
        </div>

        {/* Left Splitter Resizer Handle */}
        {leftWidth > 0 && (
          <div
            className={`resizer-col ${isDraggingLeft ? 'dragging' : ''}`}
            onMouseDown={handleLeftMouseDown}
            title="Drag to resize sidebar"
          />
        )}

        {/* Central Monaco Editor Workspace + Git Diff Viewer + Integrated Terminal */}
        <div style={{ flex: 1, height: '100%', minWidth: 200, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', scrollbarGutter: 'stable' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <EditorArea />
            <React.Suspense fallback={<ViewSkeleton type="diff" />}>
              <DiffViewer />
            </React.Suspense>
            <WorkspaceEditReview />
          </div>
          {/* Integrated Terminal docked and locked within editor width bounds */}
          <React.Suspense fallback={null}>
            <TerminalDrawer />
          </React.Suspense>
        </div>

        {/* Right Splitter Resizer Handle */}
        {rightWidth > 0 && (
          <div
            className={`resizer-col ${isDraggingRight ? 'dragging' : ''}`}
            onMouseDown={handleRightMouseDown}
            title="Drag to resize assistant panel"
          />
        )}

        {/* Right AI Assistant Sidecar */}
        <div style={{ width: `${rightWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden', display: rightWidth > 0 ? 'block' : 'none' }}>
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
        onOpenBootTimeline={() => setIsBootTimelineOpen(true)}
        onOpenExtensionTrace={() => setIsExtensionTraceOpen(true)}
      />

      {/* Settings & Usage Modals */}
      <React.Suspense fallback={<ViewSkeleton type="modal" />}>
        <SettingsModal />
        <UsageDashboard />
        <BootTimeline
          isOpen={isBootTimelineOpen}
          onClose={() => setIsBootTimelineOpen(false)}
        />
      </React.Suspense>
      <OnboardingWizard />
      <ExtensionInputDialog />
      <AgentApprovalModal />
      <ExtensionTracePanel
        isOpen={isExtensionTraceOpen}
        onClose={() => setIsExtensionTraceOpen(false)}
      />

      {/* Global Toast Notifications */}
      <ToastContainer />
    </div>
  );
};
