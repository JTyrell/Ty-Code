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
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ChatSidecar } from './components/ChatSidecar';
import { StatusBar } from './components/StatusBar';
import { AIBadge } from './components/AIBadge';
import { QuickOpen } from './components/QuickOpen';
import { CommandPalette } from './components/CommandPalette';
import { OnboardingWizard } from './components/OnboardingWizard';
import { FirstRunOnboardingModal } from './components/FirstRunOnboardingModal';
import { WorkspaceEditReview } from './components/WorkspaceEditReview';
import { ContextEngineDrawer } from './components/status-bar/ContextEngineDrawer';
import { ToastContainer } from './components/ToastContainer';
import { toast } from './state/toast-store';
import { useBootStateStore } from './state/boot-state-store';
import {
  useGovernorStore,
  startGovernorSampling,
  stopGovernorSampling
} from './state/governor-store';
import { ExtensionInputDialog } from './components/ExtensionInputDialog';
import { AgentApprovalModal } from './components/AgentApprovalModal';
import { ExtensionTracePanel } from './components/extensions/ExtensionTracePanel';
import { transitionProfiler } from './services/perf/transition-profiler';
import { useChatStore } from './state/chat-store';
import { useUsageDashboardStore } from './state/usage-dashboard-store';
import { useAppDocsStore } from './state/app-docs-store';
import { initTypographyStore, useTypographyStore } from './state/typography-store';
import { useWorkspaceStore } from './state/workspace-store';
import { useEditorNavigationStore } from './state/editor-navigation-store';
import { useDebuggerStore } from './state/debugger-store';
import { useActiveModelSync } from './state/active-model-store';
import { useThemeSync } from './hooks/useThemeSync';
import { initDocumentProposedListener } from './state/document-review-store';
import { initWorkspaceSessionSync } from './state/workspace-session-store';
import { initSessionSync } from './state/session-store';
import { initCanvasPreviewSync } from './state/canvas-preview-store';
import { initContextAuditSync } from './state/context-audit-store';
import { LazyModelManager } from './services/lazy-model-manager';
import { installCommandContextSources } from './lib/command-contexts';
import { installCommandRuntime } from './lib/command-runtime';
import { registerEditorCommandHandlers } from './lib/editor-commands';
import { registerDebugCommandHandlers } from './lib/debug-commands';
import { registerTerminalCommandHandlers } from './lib/terminal-commands';
import { registerWorkbenchCommandHandlers } from './lib/workbench-commands';

import { Palette } from 'lucide-react';
import { SketcherWindow } from './components/SketcherWindow';
import { DebuggerWindow } from './components/debugger/DebuggerWindow';
import { OmniDebugger } from './components/debugger/OmniDebugger';
import { ProcessExplorerWindow } from './components/ProcessExplorerWindow';

// Dynamic import() for Tier 2/3 heavy modules — no top-level static imports
const TerminalDrawer = React.lazy(() => import('./components/TerminalDrawer').then((m) => ({ default: m.TerminalDrawer })));
const ExtensionsPanel = React.lazy(() => import('./components/ExtensionsPanel').then((m) => ({ default: m.ExtensionsPanel })));
const BootTimeline = React.lazy(() => import('./components/BootTimeline').then((m) => ({ default: m.BootTimeline })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const UsageDashboard = React.lazy(() => import('./components/UsageDashboard').then((m) => ({ default: m.UsageDashboard })));
const CodeReviewPanel = React.lazy(() => import('./components/CodeReviewPanel').then((m) => ({ default: m.CodeReviewPanel })));
const DiffViewer = React.lazy(() => import('./components/DiffViewer').then((m) => ({ default: m.DiffViewer })));
const DocViewerModal = React.lazy(() => import('./components/DocViewerModal').then((m) => ({ default: m.DocViewerModal })));

const MainWorkbench: React.FC = () => {
  useActiveModelSync();
  const [activityTab, setActivityTab] = useState<ActivityTab>('explorer');
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [quickOpenInitialQuery, setQuickOpenInitialQuery] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isBootTimelineOpen, setIsBootTimelineOpen] = useState(false);
  const [isExtensionTraceOpen, setIsExtensionTraceOpen] = useState(false);

  // Resizable Sidebars State
  // The left Explorer sidecar always starts closed on a new window. The user
  // must open it (ActivityBar) and choose a folder from its empty state.
  const [leftWidth, setLeftWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(380);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  // Remembered widths, so a toggle restores whatever the user last dragged to
  // rather than a hard-coded panel size. Declared above the callbacks that read
  // them; they used to sit further down, which worked only because nothing ever
  // invoked those callbacks during render.
  const lastLeftWidthRef = useRef(260);
  const lastRightWidthRef = useRef(380);

  // Zustand selector audit: subscribe to narrow slices only
  const initSettings = useChatStore((s) => s.initSettings);
  const toggleTerminal = useChatStore((s) => s.toggleTerminal);
  const setWorkspacePath = useWorkspaceStore((s) => s.setWorkspacePath);
  const setFileTree = useWorkspaceStore((s) => s.setFileTree);
  const navigateTo = useEditorNavigationStore((state) => state.navigateTo);
  const isPopOutMode = useDebuggerStore((s) => s.isPopOutMode);
  // Prompt 3: tri-state hydration gate — undefined while the boot-state IPC
  // (main-process first-run decision) has not resolved. While undefined, the
  // boot-time Suspense trees below stay unmounted so no lazy chunk can suspend
  // and flash a ViewSkeleton before first paint.
  const bootHydration = useBootStateStore((s) => s.hydration);
  const isSettingsOpen = useChatStore((s) => s.isSettingsOpen);
  const usageDashboardOpen = useUsageDashboardStore((s) => s.isOpen);
  // Drives the doc viewer's Suspense fallback the same way as the two modals
  // above: a skeleton may only stand in for a view that is genuinely open.
  const docViewerOpen = useAppDocsStore((s) => s.activeId !== null);
  const prevPopOutRef = useRef(isPopOutMode);

  useEffect(() => {
    // If user docked it back from popout window, bring it into the sidebar
    if (prevPopOutRef.current && !isPopOutMode) {
      setActivityTab('debugger');
      setLeftWidth((lw) => (lw > 0 ? lw : Math.max(lastLeftWidthRef.current, 360)));
    }
    prevPopOutRef.current = isPopOutMode;
  }, [isPopOutMode]);

  // Measure panel transitions and promote tasks on demand
  const handleTabChange = useCallback((tab: ActivityTab) => {
    if (tab === 'ui-sketcher') {
      if (window.electronAPI?.sketcherOpenWindow) {
        window.electronAPI.sketcherOpenWindow().catch(console.error);
      }
      return;
    }

    if (tab === 'debugger') {
      if (window.electronAPI?.debuggerOpenWindow) {
        window.electronAPI.debuggerOpenWindow().catch(console.error);
        useDebuggerStore.setState({ isPopOutMode: true });
      } else {
        setActivityTab('debugger');
        setLeftWidth((lw) => (lw > 0 ? lw : Math.max(lastLeftWidthRef.current, 360)));
      }
      return;
    }

    if (tab === activityTab) {
      setLeftWidth((lw) => {
        if (lw > 0) {
          lastLeftWidthRef.current = lw;
          return 0;
        }
        return lastLeftWidthRef.current || 260;
      });
      return;
    }

    setLeftWidth((lw) => {
      if (lw === 0) {
        return lastLeftWidthRef.current || 260;
      }
      return lw;
    });

    const eventName = tab === 'extensions' ? 'extensions_open' : `panel_open:${tab}`;
    const id = transitionProfiler.startTransition(eventName);
    if (tab === 'extensions') {
      void window.electronAPI?.bootSchedulerPromote?.('extension_host');
    }
    setActivityTab(tab);
    void transitionProfiler.endTransition(id, `panel_visible:${tab}`);
  }, [activityTab]);

  const handleToggleTerminal = useCallback(() => {
    const id = transitionProfiler.startTransition('terminal_toggle');
    void window.electronAPI?.bootSchedulerPromote?.('terminal');
    toggleTerminal();
    void transitionProfiler.endTransition(id, 'terminal_toggle');
  }, [toggleTerminal]);

  /**
   * Open Settings, optionally straight to one of its tabs.
   *
   * `openSettings` and never `toggleSettings`: Ty-Code > Preferences is a menu
   * row, and a row that closes the panel it names whenever that panel happens to
   * be open is the same trap as a toggle wired to "Show Source Control". The
   * scheduler promotion stays — the settings chunk hydrates lazily, so without
   * it a cold open renders a skeleton for a beat.
   */
  const openPreferences = useCallback((tab?: string) => {
    const id = transitionProfiler.startTransition('settings_open');
    void window.electronAPI?.bootSchedulerPromote?.('settings_hydration');
    useChatStore.getState().openSettings(tab);
    void transitionProfiler.endTransition(id, 'settings_open');
  }, []);

  const togglePrimarySidebar = useCallback(() => {
    setLeftWidth((w) => {
      if (w > 0) {
        lastLeftWidthRef.current = w;
        return 0;
      }
      return lastLeftWidthRef.current || 260;
    });
  }, []);

  const toggleAssistantSidebar = useCallback(() => {
    setRightWidth((w) => {
      if (w > 0) {
        lastRightWidthRef.current = w;
        return 0;
      }
      return lastRightWidthRef.current || 380;
    });
  }, []);

  /**
   * Open the Assistant panel without ever closing it.
   *
   * Prompt E quick actions route answers into the sidecar; dispatching the
   * toggle event for that would shut the panel whenever it already happened
   * to be open. Same reveal-only shape as `showActivityView` uses for the
   * left sidebar.
   */
  const ensureAssistantSidebar = useCallback(() => {
    setRightWidth((w) => (w > 0 ? w : lastRightWidthRef.current || 380));
  }, []);

  /**
   * Reveal an activity-bar view, opening the primary sidebar if it is shut.
   *
   * Deliberately not `handleTabChange`: clicking the already-active tab toggles
   * the panel closed there, so a menu row wired straight to it would hide the
   * very view it names. The old `Ctrl+Shift+F` binding had exactly that bug —
   * it set the tab and left the sidebar shut, which made the shortcut look
   * broken whenever the panel happened to be closed.
   */
  const showActivityView = useCallback((view: ActivityTab) => {
    setLeftWidth((w) => (w > 0 ? w : lastLeftWidthRef.current || 260));
    const eventName = view === 'extensions' ? 'extensions_open' : `panel_open:${view}`;
    const id = transitionProfiler.startTransition(eventName);
    if (view === 'extensions') {
      void window.electronAPI?.bootSchedulerPromote?.('extension_host');
    }
    setActivityTab(view);
    void transitionProfiler.endTransition(id, `panel_visible:${view}`);
  }, []);

  /**
   * Open Quick Open with a mode prefix already typed: `''` lists files, `'#'`
   * searches workspace symbols, `'@'` symbols in the active editor and `':'`
   * jumps to a line.
   *
   * Opens rather than toggles, because four Go-menu rows share this one surface
   * with different prefixes and a toggle would make Ctrl+P followed by Ctrl+G
   * close the overlay the user had just asked for.
   */
  const openQuickOpenWith = useCallback((prefix: string) => {
    setQuickOpenInitialQuery(prefix);
    setIsQuickOpenOpen(true);
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  // Preload terminal module during background/idle (instance created on first open)
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('./components/TerminalDrawer');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Subscribe to document_proposed IPC stream events for Document Review Pane
  useEffect(() => {
    return initDocumentProposedListener();
  }, []);

  // Prompt 1 (Workspace Session Bus): hydrate + subscribe in every window
  // (main App + canvas/debugger popout shells all mount App).
  // Prompt 3 (Workspace Unification): the Context Engine audit is driven by
  // the same session bus — one root, one score, no divergent state.
  // Prompt 4 (M3E Live Editor): the Safe Edit Review Gate preview proposals
  // fired from the canvas surface surface here in the Main Editor.
  useEffect(() => {
    const disposeAuditSync = initContextAuditSync();
    const disposeSessionSync = initWorkspaceSessionSync();
    const disposeMultiSessionSync = initSessionSync();
    const disposeCanvasPreviewSync = initCanvasPreviewSync();
    return () => {
      disposeAuditSync();
      disposeSessionSync();
      disposeMultiSessionSync();
      disposeCanvasPreviewSync();
    };
  }, []);

  // Memory Governor (Steps 1/3/4/5): renderer-side sampling, state hydration,
  // crash/shed notices and the hidden-window rAF guard.
  useEffect(() => {
    if (!window.electronAPI) return;

    startGovernorSampling();

    void window.electronAPI.governorGetState()
      .then((res) => {
        if (res?.success && res.data) useGovernorStore.getState().setSnapshot(res.data);
      })
      .catch(() => {});

    // Heartbeat the editor surface every 30s so it is never idle-terminated.
    const heartbeatTimer = setInterval(() => {
      try { window.electronAPI?.surfaceHeartbeat?.('editor'); } catch {}
    }, 30_000);

    const unsubState = window.electronAPI.onGovernorStateChanged?.((payload) => {
      useGovernorStore.getState().setTier(payload.tier);
      useGovernorStore.getState().setLiteMode(payload.mode === 'LITE');
      // Step 4: renderer-side cache eviction as pressure rises.
      if (payload.tier !== 'NOMINAL') {
        LazyModelManager.getInstance().applyGovernorTier(payload.tier);
      }
    });

    const unsubCrashed = window.electronAPI.onGovernorSurfaceCrashed?.(({ surfaceId, notice }) => {
      toast.error(`${surfaceId} surface crashed`, notice || 'It reloaded automatically. Other surfaces are unaffected.');
    });

    const unsubShed = window.electronAPI.onGovernorSurfaceShed?.(({ surfaceId, notice }) => {
      toast.info(`${surfaceId} surface unloaded`, notice || 'Unloaded to free memory. Reopen it from the activity bar.');
    });

    const unsubLite = window.electronAPI.onGovernorLiteMode?.(({ totalSystemRamGb, notice }) => {
      useGovernorStore.getState().setLiteMode(true);
      useGovernorStore.setState({ totalSystemRamGb });
      toast.info('LITE mode enabled', notice || `Low-RAM device detected (${totalSystemRamGb.toFixed(1)} GB).`);
    });

    // Prompt 4 (Vault hardening): ONE warning per session when stored keys
    // cannot be decrypted on this machine (e.g. DPAPI context mismatch).
    const unsubVault = window.electronAPI.onVaultKeysUndecryptable?.(({ message }) => {
      toast.warning('Stored keys could not be decrypted', message);
    });

    // Prompt (Terminal Command Dispatch Fix): every dispatch failure is a
    // visible, retryable event — silent drops are forbidden.
    const unsubDispatchFailed = window.electronAPI.onTerminalDispatchFailed?.(({ cmd, opts, reason }) => {
      const attempt = { cmd, opts };
      toast.error('Could not reach terminal', reason, {
        label: 'Retry',
        onClick: () => { void window.electronAPI?.terminalRunCommand?.(attempt.cmd, attempt.opts); }
      });
    });

    // Step 3.2: hidden windows pause rAF-driven work via the guard flag.
    const onVisibility = (): void => {
      useGovernorStore.getState().setDocumentHidden(document.hidden);
      if (!document.hidden) {
        try { window.electronAPI?.surfaceHeartbeat?.('editor'); } catch {}
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopGovernorSampling();
      clearInterval(heartbeatTimer);
      unsubState?.();
      unsubCrashed?.();
      unsubShed?.();
      unsubLite?.();
      unsubVault?.();
      unsubDispatchFailed?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
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

  // Listen for custom workbench events from TitleBar and Status Bar.
  //
  // These listeners and the command handlers registered below now share one
  // implementation per action. They used to be written out twice — once here,
  // once inside the raw keydown chain — and the copies had already drifted:
  // the chain's Ctrl+Shift+F set the activity tab without opening the sidebar,
  // while this one opened the sidebar without touching the tab.
  useEffect(() => {
    const onShowBootTimeline = (): void => setIsBootTimelineOpen(true);
    const onQuickOpen = (): void => openQuickOpenWith('');
    const onCommandPalette = (): void => setIsCommandPaletteOpen(true);
    const onToggleAllPanels = (): void => {
      togglePrimarySidebar();
      toggleAssistantSidebar();
    };

    window.addEventListener('workbench:show-boot-timeline', onShowBootTimeline);
    window.addEventListener('workbench:toggle-left-sidebar', togglePrimarySidebar);
    window.addEventListener('workbench:toggle-right-sidebar', toggleAssistantSidebar);
    const onEnsureAssistant = (): void => ensureAssistantSidebar();
    window.addEventListener('workbench:ensure-assistant', onEnsureAssistant);
    window.addEventListener('workbench:toggle-all-panels', onToggleAllPanels);
    window.addEventListener('workbench:quick-open', onQuickOpen);
    window.addEventListener('workbench:command-palette', onCommandPalette);

    return () => {
      window.removeEventListener('workbench:show-boot-timeline', onShowBootTimeline);
      window.removeEventListener('workbench:toggle-left-sidebar', togglePrimarySidebar);
      window.removeEventListener('workbench:toggle-right-sidebar', toggleAssistantSidebar);
      window.removeEventListener('workbench:ensure-assistant', onEnsureAssistant);
      window.removeEventListener('workbench:toggle-all-panels', onToggleAllPanels);
      window.removeEventListener('workbench:quick-open', onQuickOpen);
      window.removeEventListener('workbench:command-palette', onCommandPalette);
    };
  }, [openQuickOpenWith, togglePrimarySidebar, toggleAssistantSidebar, ensureAssistantSidebar]);

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
    initTypographyStore();
    void useTypographyStore.getState().hydrate();

    // Prompt 3: resolve the boot-state gate ONCE at mount (StrictMode-safe
    // generation guard inside hydrate). Until this resolves, boot-time
    // Suspense trees (Settings / Usage / Diff / BootTimeline / Onboarding) are
    // not mounted, so their lazy chunks can never suspend during first paint.
    void useBootStateStore.getState().hydrate();

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

  // Prompt 5: the shell's command handlers, registered from here because every
  // one of them closes over this component's setters. A window with no
  // workbench mounted therefore registers none, and its menu rows disappear
  // instead of turning into dead clicks — which is the truth about that window.
  //
  // This replaces the raw `keydown` chain that used to sit here. Twelve of its
  // branches are now registry entries, so a chord and the menu row it belongs to
  // are a single declaration and can no longer drift apart. The thirteenth keeps
  // its command but loses its chord: Ctrl+Shift+S meant "rescan workspace" here
  // and means "Save As…" in the registry, because that is what the key means in
  // every other editor. Rescan stays reachable from Show All Commands.
  useEffect(() => {
    const disposable = registerWorkbenchCommandHandlers({
      toggleCommandPalette,
      openQuickOpen: openQuickOpenWith,
      showActivityView,
      togglePrimarySidebar,
      toggleAssistantSidebar,
      toggleTerminal: handleToggleTerminal,
      openBootTimeline: () => setIsBootTimelineOpen(true),
      openPreferences
    });
    return () => disposable.dispose();
  }, [
    toggleCommandPalette,
    openQuickOpenWith,
    showActivityView,
    togglePrimarySidebar,
    toggleAssistantSidebar,
    handleToggleTerminal,
    openPreferences
  ]);

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

      {/* Main Workspace Area (3-Column Layout with Resizers) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Leftmost Activity Bar */}
        <ActivityBar activeTab={activityTab} onTabChange={handleTabChange} isLeftPanelOpen={leftWidth > 0} />

        {/* Dynamic Primary Left Panel (Explorer / Search / Source Control / Code Review / Extensions / Skills / Outline) */}
        <div style={{ width: `${leftWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          {activityTab === 'explorer' && <Sidebar />}
          {activityTab === 'search' && <SearchPanel onNavigateToLocation={(filePath, line, column) => navigateTo({ filePath, line, column })} />}
          {activityTab === 'source-control' && <SourceControlPanel />}
          <React.Suspense fallback={<ViewSkeleton type="panel" />}>
            {activityTab === 'code-review' && <CodeReviewPanel />}
            {activityTab === 'extensions' && <ExtensionsPanel />}
            {activityTab === 'ui-sketcher' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center', gap: '12px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Palette size={24} color="#a855f7" />
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>M3E UI Sketcher</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', maxWidth: '200px' }}>
                  Visual sketcher runs in a dedicated resizable window.
                </div>
                <button
                  type="button"
                  onClick={() => window.electronAPI?.sketcherOpenWindow?.()}
                  style={{
                    backgroundColor: 'var(--accent-primary, #6366f1)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '4px'
                  }}
                >
                  Open Window
                </button>
              </div>
            )}
          </React.Suspense>
          {activityTab === 'skills' && <SkillsPanel />}
          {activityTab === 'outline' && <OutlineView onNavigateToLine={(line) => navigateTo({ line })} />}
          {activityTab === 'debugger' && <OmniDebugger />}
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
            {/* Prompt 3: DiffViewer tree only mounts after hydration resolves —
                before that its lazy chunk would suspend behind a modal
                skeleton, which reads as the boot flash. */}
            {bootHydration !== undefined && (
              <React.Suspense fallback={<ViewSkeleton type="diff" />}>
                <DiffViewer />
              </React.Suspense>
            )}
            <WorkspaceEditReview />
          </div>
          {/* Context Engine drawer: dockable, in-flow participant of the center column split */}
          <ContextEngineDrawer />
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

      {/* Settings & Usage Modals protected with individual ErrorBoundaries.
          Prompt 3: the whole boot-time modal block mounts only AFTER the
          boot-state gate resolves, and each fallback reflects the view's
          actual open state so a skeleton can never represent a moment that is
          pure chunk-loading (that was the 'start with skeleton then remove' flash). */}
      {bootHydration !== undefined && (
        <>
          <ErrorBoundary fallbackTitle="Settings Error" onReset={() => useChatStore.setState({ isSettingsOpen: false })}>
            <React.Suspense fallback={isSettingsOpen ? <ViewSkeleton type="modal" /> : null}>
              <SettingsModal />
            </React.Suspense>
          </ErrorBoundary>

          <ErrorBoundary fallbackTitle="Usage Dashboard Error" onReset={() => useChatStore.getState().openSettings('analytics')}>
            <React.Suspense fallback={usageDashboardOpen ? <ViewSkeleton type="modal" /> : null}>
              <UsageDashboard />
            </React.Suspense>
          </ErrorBoundary>

          <ErrorBoundary fallbackTitle="Document Viewer Error" onReset={() => useAppDocsStore.getState().closeDoc()}>
            <React.Suspense fallback={docViewerOpen ? <ViewSkeleton type="modal" /> : null}>
              <DocViewerModal />
            </React.Suspense>
          </ErrorBoundary>

          <ErrorBoundary fallbackTitle="Boot Timeline Error" onReset={() => setIsBootTimelineOpen(false)}>
            <React.Suspense fallback={null}>
              <BootTimeline
                isOpen={isBootTimelineOpen}
                onClose={() => setIsBootTimelineOpen(false)}
              />
            </React.Suspense>
          </ErrorBoundary>

          <ErrorBoundary fallbackTitle="Onboarding Wizard Error">
            <OnboardingWizard />
          </ErrorBoundary>
        </>
      )}

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

export const App: React.FC = () => {
  useThemeSync();

  // Prompt 5: one command runtime per window, installed before the hash router
  // branches so a popout gets the same registry-driven keybindings bound to its
  // own context instead of a second, hand-written copy of them.
  //
  // The order is load-bearing. `installCommandContextSources` has to run first,
  // because `installCommandRuntime` resolves enablement against the contributor
  // set on the way in — sources first means the very first paint already knows
  // whether an editor is open, rather than greying every row out and flickering
  // it back a frame later. Teardown unwinds in reverse for the same reason.
  //
  // The terminal and task handlers register here rather than in `MainWorkbench`
  // with the workbench ones, even though the drawer only mounts there. They take
  // no shell deps — they read the workspace store and the bridge directly — and
  // a popout editor window that hid its Terminal menu entirely would leave the
  // user with no way to learn where terminals live. Instead the rows paint and
  // decline with `NO_TERMINAL_SURFACE`, which names the window to go to. The Run
  // menu's debug rows register here for the same reason: the session is main's,
  // shared by every window, so a popout that could not reach it would be hiding
  // rows whose state it can genuinely observe.
  useEffect(() => {
    const sources = installCommandContextSources();
    const editorCommands = registerEditorCommandHandlers();
    const terminalCommands = registerTerminalCommandHandlers();
    const debugCommands = registerDebugCommandHandlers();
    const runtime = installCommandRuntime();
    return () => {
      runtime.dispose();
      debugCommands.dispose();
      terminalCommands.dispose();
      editorCommands.dispose();
      sources.dispose();
    };
  }, []);

  const isSketcher = typeof window !== 'undefined' && (window.location.hash.includes('sketcher') || window.location.hash.includes('canvas'));
  if (isSketcher) {
    return <SketcherWindow />;
  }
  const isDebugger = typeof window !== 'undefined' && window.location.hash.includes('debugger');
  if (isDebugger) {
    return <DebuggerWindow />;
  }
  // Help > Open Process Explorer gets its own window rather than a panel inside
  // this one, because a memory readout rendered by the process it is measuring
  // reports a number that includes itself — and goes blank at the exact moment
  // main is the thing that is sick. It renders no menu bar and no command
  // runtime: the hooks above still ran, so teardown is unchanged.
  const isProcessExplorer = typeof window !== 'undefined' && window.location.hash.includes('process-explorer');
  if (isProcessExplorer) {
    return <ProcessExplorerWindow />;
  }
  return <MainWorkbench />;
};
