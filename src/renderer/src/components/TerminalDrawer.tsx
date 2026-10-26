import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as TerminalIcon, Plus, X, Trash2, Maximize2, Minimize2, ChevronDown, Columns, FolderSync, Copy, ClipboardPaste, Settings2 } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import type { ShellInfo, TerminalSplitOrientation } from '../../../preload/types';

interface TerminalTab { id: string; ptyId: string; shellId: string; shellName: string; profileId?: string; cwd: string; serializedHistory?: string; hasExited?: boolean; }
interface PersistedTerminalTab { shellId: string; profileId?: string; cwd: string; serializedHistory?: string; }
interface PersistedTerminalState { version: 2; tabs: PersistedTerminalTab[]; activeIndex: number; splitIndex: number | null; orientation: TerminalSplitOrientation; height?: number; splitRatio?: number; }
interface TerminalRuntime {
  term: XtermTerminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  disposables: Array<() => void>;
  resizeObserver: ResizeObserver;
  saveTimer: number | null;
}
const TERMINAL_STORAGE_KEY = 'ty_claude_terminal_session_v2';
const LEGACY_TERMINAL_STORAGE_KEY = 'ty_claude_terminal_saved_tabs';
const MAX_HISTORY_CHARS = 120_000;
function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }
function activeFileDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return normalized;
  if (slash === 0) return '/';
  if (slash === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}

export const TerminalDrawer: React.FC = () => {
  const isTerminalOpen = useChatStore((s) => s.isTerminalOpen);
  const toggleTerminal = useChatStore((s) => s.toggleTerminal);
  const settings = useChatStore((s) => s.settings);
  const toggleSettings = useChatStore((s) => s.toggleSettings);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [splitOrientation, setSplitOrientation] = useState<TerminalSplitOrientation>('horizontal');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [terminalHeight, setTerminalHeight] = useState(290);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showShellMenu, setShowShellMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [terminalError, setTerminalError] = useState('');
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuCoords, setMenuCoords] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const terminalRefs = useRef<Map<string, TerminalRuntime>>(new Map());
  const tabsRef = useRef<TerminalTab[]>([]);
  const activeTabRef = useRef<string | null>(null);
  const splitTabRef = useRef<string | null>(null);
  const orientationRef = useRef<TerminalSplitOrientation>(splitOrientation);
  const restoredRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const terminalHeightRef = useRef(terminalHeight);
  const splitRatioRef = useRef(splitRatio);
  activeTabRef.current = activeTabId;
  splitTabRef.current = splitTabId;
  orientationRef.current = splitOrientation;
  terminalHeightRef.current = terminalHeight;
  splitRatioRef.current = splitRatio;

  // Keep-alive terminal optimization: pause/blur when hidden, defer fit() to rAF on visible
  useEffect(() => {
    if (isTerminalOpen) {
      const rafId = window.requestAnimationFrame(() => {
        for (const [id, runtime] of terminalRefs.current.entries()) {
          try {
            runtime.fit.fit();
            const tab = tabsRef.current.find((t) => t.id === id);
            if (tab) {
              window.electronAPI.resizePty(tab.ptyId, runtime.term.cols, runtime.term.rows);
            }
            if (activeTabRef.current === id) {
              runtime.term.focus();
            }
          } catch {
            // Non-fatal layout transition
          }
        }
      });
      return () => window.cancelAnimationFrame(rafId);
    } else {
      // Pause cursor and active redraw when hidden
      for (const runtime of terminalRefs.current.values()) {
        try {
          runtime.term.blur();
        } catch {
          // Non-fatal
        }
      }
    }
  }, [isTerminalOpen]);

  const updateTabs = useCallback((update: (current: TerminalTab[]) => TerminalTab[]) => {
    const next = update(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  }, []);
  const persistNow = useCallback((sourceTabs = tabsRef.current) => {
    if (persistTimerRef.current !== null) { window.clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    const splitIndex = sourceTabs.findIndex((tab) => tab.id === splitTabRef.current);
    const state: PersistedTerminalState = {
      version: 2,
      tabs: sourceTabs.map((tab) => {
        let serializedHistory = tab.serializedHistory;
        const runtime = terminalRefs.current.get(tab.id);
        if (runtime) {
          try { serializedHistory = runtime.serialize.serialize({ scrollback: 1000 }).slice(-MAX_HISTORY_CHARS); }
          catch { /* Retain the last persisted history snapshot. */ }
        }
        return { shellId: tab.shellId, profileId: tab.profileId, cwd: tab.cwd, serializedHistory };
      }),
      activeIndex: Math.max(0, sourceTabs.findIndex((tab) => tab.id === activeTabRef.current)),
      splitIndex: splitIndex >= 0 ? splitIndex : null,
      orientation: orientationRef.current,
      height: terminalHeightRef.current,
      splitRatio: splitRatioRef.current
    };
    try { localStorage.setItem(TERMINAL_STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { console.warn('[Terminal] Unable to persist terminal history:', err); }
  }, []);
  const queuePersist = useCallback((tabId?: string) => {
    const runtime = tabId ? terminalRefs.current.get(tabId) : undefined;
    if (runtime?.saveTimer !== null && runtime?.saveTimer !== undefined) window.clearTimeout(runtime.saveTimer);
    if (runtime) runtime.saveTimer = window.setTimeout(() => persistNow(), 450);
    else {
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => persistNow(), 100);
    }
  }, [persistNow]);

  useEffect(() => {
    if (!window.electronAPI) {
      setTerminalError('Interactive terminals are available in the Ty-Code desktop app.');
      return;
    }
    let cancelled = false;
    void window.electronAPI.getAvailableShells().then((response) => {
      if (!cancelled && response.success && response.data) setAvailableShells(response.data);
      else if (!cancelled && response.error) setTerminalError(response.error);
    }).catch((err: unknown) => { if (!cancelled) setTerminalError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  const disposeTerminal = useCallback((tabId: string, killPty: boolean) => {
    const runtime = terminalRefs.current.get(tabId);
    if (runtime) {
      runtime.resizeObserver.disconnect();
      runtime.disposables.forEach((dispose) => dispose());
      if (runtime.saveTimer !== null) window.clearTimeout(runtime.saveTimer);
      runtime.serialize.dispose();
      runtime.fit.dispose();
      runtime.term.dispose();
      terminalRefs.current.delete(tabId);
    }
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (killPty && tab) void window.electronAPI.killPty(tab.ptyId);
  }, []);

  const handleSpawnTerminal = useCallback(async (request: { shellId?: string; profileId?: string; cwd?: string; serializedHistory?: string; makeSplit?: boolean; autoRunCommand?: string } = {}) => {
    const previousActiveTabId = activeTabRef.current;
    setShowShellMenu(false);
    setTerminalError('');
    if (!window.electronAPI) {
      setTerminalError('Interactive terminals are available in the Ty-Code desktop app.');
      return;
    }
    let response;
    try {
      response = await window.electronAPI.spawnPty({ shellId: request.shellId, profileId: request.profileId, cwd: request.cwd || workspacePath || undefined, cols: 80, rows: 24, autoRunCommand: request.autoRunCommand });
    } catch (err: unknown) {
      setTerminalError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!response.success || !response.data) { setTerminalError(response.error || 'Could not start the selected shell.'); return; }
    const tab: TerminalTab = {
      id: createId('terminal'), ptyId: response.data.ptyId, shellId: response.data.shellId,
      shellName: response.data.shellName, profileId: request.profileId,
      cwd: request.cwd || workspacePath, serializedHistory: request.serializedHistory
    };
    updateTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    activeTabRef.current = tab.id;
    if (request.makeSplit && tabsRef.current.length > 0) {
      const previousActive = tabsRef.current.find((item) => item.id === previousActiveTabId);
      const splitTarget = previousActive || tabsRef.current[tabsRef.current.length - 2] || tabsRef.current[0];
      splitTabRef.current = splitTarget.id;
      setSplitTabId(splitTarget.id);
    }
    queuePersist();
  }, [queuePersist, updateTabs, workspacePath]);
  const spawnRef = useRef(handleSpawnTerminal);
  spawnRef.current = handleSpawnTerminal;
  const isTerminalOpenRef = useRef(isTerminalOpen);
  isTerminalOpenRef.current = isTerminalOpen;
  const toggleTerminalRef = useRef(toggleTerminal);
  toggleTerminalRef.current = toggleTerminal;

  // FCC agent quick-toggle (Command Palette: "Ty-Code: Open FCC Terminal Agent")
  useEffect(() => {
    const handler = () => {
      void (async () => {
        let autoRunCommand: string | undefined;
        try {
          const svcRes = await window.electronAPI?.fccGetServiceStatus?.();
          const svc = svcRes?.data;
          if (svc?.installed && Array.isArray(svc.wrapperCommandsAvailable) && svc.wrapperCommandsAvailable.length > 0) {
            autoRunCommand = svc.wrapperCommandsAvailable.includes('fcc-claude') ? 'fcc-claude' : svc.wrapperCommandsAvailable[0];
          }
        } catch {
          // Non-blocking; terminal still opens
        }
        if (!autoRunCommand) {
          toast.info('FCC engine not installed — connect a provider or install free-claude-code in Settings → Ty-Code AI Settings.');
        }
        if (!isTerminalOpenRef.current) toggleTerminalRef.current();
        void spawnRef.current({ autoRunCommand });
      })();
    };
    window.addEventListener('tycode:fcc-agent-terminal', handler);
    return () => window.removeEventListener('tycode:fcc-agent-terminal', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ autoRunCommand?: string; cwd?: string }>).detail || {};
      if (!detail.autoRunCommand) return;
      if (!isTerminalOpenRef.current) toggleTerminalRef.current();
      void spawnRef.current({ autoRunCommand: detail.autoRunCommand, cwd: detail.cwd });
    };
    window.addEventListener('tycode:run-terminal-command', handler);
    return () => window.removeEventListener('tycode:run-terminal-command', handler);
  }, []);

  useEffect(() => {
    if (!isTerminalOpen || availableShells.length === 0 || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(TERMINAL_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      let saved: PersistedTerminalState | null = parsed && typeof parsed === 'object' && 'version' in parsed
        ? parsed as PersistedTerminalState
        : null;
      if (!saved) {
        const legacyRaw = localStorage.getItem(LEGACY_TERMINAL_STORAGE_KEY);
        const legacyTabs: unknown = legacyRaw ? JSON.parse(legacyRaw) : null;
        if (Array.isArray(legacyTabs)) {
          saved = {
            version: 2,
            tabs: legacyTabs.filter((tab): tab is { shellId: string } => Boolean(tab && typeof tab === 'object' && 'shellId' in tab && typeof tab.shellId === 'string'))
              .map((tab) => ({ shellId: tab.shellId, cwd: workspacePath })),
            activeIndex: 0,
            splitIndex: null,
            orientation: 'horizontal'
          };
          localStorage.removeItem(LEGACY_TERMINAL_STORAGE_KEY);
        }
      }
      if (saved?.version === 2 && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
        const orientation = saved.orientation === 'vertical' ? 'vertical' : 'horizontal';
        orientationRef.current = orientation;
        setSplitOrientation(orientation);
        if (typeof saved.height === 'number') {
          const height = Math.min(900, Math.max(160, saved.height));
          terminalHeightRef.current = height;
          setTerminalHeight(height);
        }
        if (typeof saved.splitRatio === 'number') {
          const ratio = Math.min(0.8, Math.max(0.2, saved.splitRatio));
          splitRatioRef.current = ratio;
          setSplitRatio(ratio);
        }
        void (async () => {
          for (const tab of saved.tabs.slice(0, 8)) await handleSpawnTerminal({ shellId: tab.shellId, profileId: tab.profileId, cwd: tab.cwd || workspacePath, serializedHistory: tab.serializedHistory });
          const restored = tabsRef.current;
          const activeIndex = Math.min(saved.activeIndex || 0, restored.length - 1);
          if (restored[activeIndex]) {
            activeTabRef.current = restored[activeIndex].id;
            setActiveTabId(restored[activeIndex].id);
          }
          const splitIndex = saved.splitIndex;
          if (splitIndex !== null && splitIndex !== undefined && splitIndex !== activeIndex) {
            const index = Math.min(splitIndex, restored.length - 1);
            if (restored[index]) {
              splitTabRef.current = restored[index].id;
              setSplitTabId(restored[index].id);
            }
          }
          persistNow(restored);
        })();
        return;
      }
    } catch (err) { console.warn('[Terminal] Saved session could not be restored:', err); }
    const profile = settings?.terminalProfiles?.find((item) => item.id === settings.defaultTerminalProfileId);
    const shellId = profile?.shellId || availableShells.find((shell) => shell.isDefault)?.id || availableShells[0].id;
    void handleSpawnTerminal({ shellId, profileId: profile?.id, cwd: workspacePath || undefined });
  }, [availableShells, handleSpawnTerminal, isTerminalOpen, persistNow, settings, workspacePath]);

  useEffect(() => { if (restoredRef.current) queuePersist(); }, [tabs, activeTabId, splitTabId, splitOrientation, terminalHeight, queuePersist]);
  useEffect(() => {
    const saveBeforeUnload = () => persistNow();
    window.addEventListener('beforeunload', saveBeforeUnload);
    return () => window.removeEventListener('beforeunload', saveBeforeUnload);
  }, [persistNow]);
  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistNow();
    for (const tab of tabsRef.current) disposeTerminal(tab.id, false);
  }, [disposeTerminal, persistNow]);

  const handleCloseTab = (tabId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const nextTabs = tabsRef.current.filter((tab) => tab.id !== tabId);
    const nextActive = activeTabRef.current === tabId ? nextTabs[nextTabs.length - 1]?.id || null : activeTabRef.current;
    const nextSplit = splitTabRef.current === tabId ? null : splitTabRef.current;
    activeTabRef.current = nextActive;
    splitTabRef.current = nextSplit;
    setActiveTabId(nextActive);
    setSplitTabId(nextSplit);
    disposeTerminal(tabId, true);
    updateTabs(() => nextTabs);
    persistNow(nextTabs);
  };
  const handleSyncCwd = () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabRef.current);
    if (!tab || !activeTabPath) return;
    const cwd = activeFileDirectory(activeTabPath);
    window.electronAPI.syncPtyCwd(tab.ptyId, cwd, tab.shellId);
    updateTabs((current) => current.map((item) => item.id === tab.id ? { ...item, cwd } : item));
    queuePersist();
  };

  const updateMenuCoords = useCallback(() => {
    if (!menuButtonRef.current) return;
    const rect = menuButtonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedMenuHeight = 280;
    const placeAbove = spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 260));

    if (placeAbove) {
      setMenuCoords({
        bottom: window.innerHeight - rect.top + 4,
        left
      });
    } else {
      setMenuCoords({
        top: rect.bottom + 4,
        left
      });
    }
  }, []);

  const handleToggleMenu = useCallback(() => {
    setShowShellMenu((prev) => {
      if (!prev) {
        updateMenuCoords();
      }
      return !prev;
    });
  }, [updateMenuCoords]);

  useEffect(() => {
    if (!showShellMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) {
        return;
      }
      setShowShellMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowShellMenu(false);
        menuButtonRef.current?.focus();
      }
    };
    const handleResize = () => {
      updateMenuCoords();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [showShellMenu, updateMenuCoords]);
  const handleToggleSplit = () => {
    if (splitTabRef.current) {
      splitTabRef.current = null; setSplitTabId(null);
    } else {
      const other = tabsRef.current.find((tab) => tab.id !== activeTabRef.current);
      if (other) { splitTabRef.current = other.id; setSplitTabId(other.id); }
      else void handleSpawnTerminal({
        shellId: settings?.terminalProfiles?.find((profile) => profile.id === settings.defaultTerminalProfileId)?.shellId || availableShells.find((shell) => shell.isDefault)?.id,
        profileId: settings?.defaultTerminalProfileId, makeSplit: true
      });
    }
    queuePersist();
  };
  const toggleSplitOrientation = () => {
    const next = splitOrientation === 'horizontal' ? 'vertical' : 'horizontal';
    orientationRef.current = next; setSplitOrientation(next); queuePersist();
  };
  const handleTerminalResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const initialHeight = terminalHeight;
    const move = (moveEvent: PointerEvent) => {
      const height = Math.min(Math.round(window.innerHeight * 0.75), Math.max(160, initialHeight + startY - moveEvent.clientY));
      terminalHeightRef.current = height;
      setTerminalHeight(height);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      queuePersist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const rawRatio = splitOrientation === 'horizontal' ? (moveEvent.clientX - bounds.left) / bounds.width : (moveEvent.clientY - bounds.top) / bounds.height;
      const ratio = Math.min(0.8, Math.max(0.2, rawRatio));
      splitRatioRef.current = ratio;
      setSplitRatio(ratio);
    };
    const stop = () => { window.removeEventListener('pointermove', move); queuePersist(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  const copySelection = async (tabId: string) => {
    const runtime = terminalRefs.current.get(tabId);
    if (runtime?.term.hasSelection()) try { await navigator.clipboard.writeText(runtime.term.getSelection()); } catch { /* Clipboard may be unavailable. */ }
    setContextMenu(null);
  };
  const pasteClipboard = async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab) try { const text = await navigator.clipboard.readText(); if (text) window.electronAPI.writePty(tab.ptyId, text); } catch { /* Permission denied. */ }
    setContextMenu(null);
  };
  const clearTerminal = (tabId: string) => { terminalRefs.current.get(tabId)?.term.clear(); setContextMenu(null); };

  const attachTerminal = (tab: TerminalTab, container: HTMLDivElement | null) => {
    if (!container || terminalRefs.current.has(tab.id)) return;
    container.replaceChildren();
    const terminalFontFamily = getComputedStyle(container).getPropertyValue('--font-mono').trim() || 'monospace';
    const term = new XtermTerminal({ cursorBlink: true, scrollback: 1000, fontFamily: terminalFontFamily, fontSize: 13, lineHeight: 1.2, theme: {
      background: '#121316', foreground: '#f3f4f6', cursor: '#8b5cf6', cursorAccent: '#121316', selectionBackground: 'rgba(139, 92, 246, 0.35)', black: '#1f2128', red: '#ef4444', green: '#10b981', yellow: '#f59e0b', blue: '#3b82f6', magenta: '#8b5cf6', cyan: '#06b6d4', white: '#f3f4f6', brightBlack: '#4b5563', brightRed: '#f87171', brightGreen: '#34d399', brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#a78bfa', brightCyan: '#22d3ee', brightWhite: '#ffffff'
    } });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit); term.loadAddon(serialize); term.loadAddon(new WebLinksAddon()); term.open(container);
    const runtime: TerminalRuntime = {
      term, fit, serialize, disposables: [], saveTimer: null,
      resizeObserver: new ResizeObserver(() => {
        if (container.getBoundingClientRect().width <= 0 || container.getBoundingClientRect().height <= 0) return;
        try { fit.fit(); window.electronAPI.resizePty(tab.ptyId, term.cols, term.rows); } catch { /* Layout transition. */ }
      })
    };
    terminalRefs.current.set(tab.id, runtime);
    runtime.resizeObserver.observe(container);
    const input = term.onData((data) => window.electronAPI.writePty(tab.ptyId, data));
    runtime.disposables.push(() => input.dispose());
    term.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'c' && (event.shiftKey || term.hasSelection())) {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
        return false;
      }
      if (modifier && key === 'v') {
        void navigator.clipboard.readText().then((text) => { if (text) window.electronAPI.writePty(tab.ptyId, text); }).catch(() => undefined);
        return false;
      }
      return true;
    });
    runtime.disposables.push(window.electronAPI.onPtyData(tab.ptyId, (data) => term.write(data, () => queuePersist(tab.id))));
    runtime.disposables.push(window.electronAPI.onPtyExit(tab.ptyId, (code) => {
      term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
      updateTabs((current) => current.map((item) => item.id === tab.id ? { ...item, hasExited: true } : item));
      queuePersist(tab.id);
    }));
    if (tab.serializedHistory) term.write(tab.serializedHistory);
    void window.electronAPI.attachPty(tab.ptyId).then((response) => { if (!response.success) setTerminalError(response.error || 'Could not attach terminal output.'); });
    window.requestAnimationFrame(() => {
      try { fit.fit(); window.electronAPI.resizePty(tab.ptyId, term.cols, term.rows); if (activeTabRef.current === tab.id) term.focus(); }
      catch { /* Pane may be hidden while xterm initializes. */ }
    });
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return <section className="terminal-drawer" style={{ display: isTerminalOpen ? 'flex' : 'none', width: '100%', height: isMaximized ? '100%' : `${terminalHeight}px`, maxHeight: isMaximized ? '100%' : '85%' }} aria-label="Integrated terminal">
    <div className="terminal-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Resize terminal panel" aria-valuenow={terminalHeight} tabIndex={0} onPointerDown={handleTerminalResizePointerDown}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowUp' ? 16 : event.key === 'ArrowDown' ? -16 : 0;
        if (!delta) return;
        event.preventDefault();
        const height = Math.min(Math.round(window.innerHeight * 0.75), Math.max(160, terminalHeight + delta));
        terminalHeightRef.current = height;
        setTerminalHeight(height);
        queuePersist();
      }} />
    <header className="terminal-toolbar">
      <div className="terminal-tabs-section">
        <div className="terminal-tab-strip" role="tablist" aria-label="Terminal sessions">
          {tabs.map((tab, index) => <div key={tab.id} className={`terminal-tab${tab.id === activeTabId ? ' is-active' : ''}`} role="tab" aria-selected={tab.id === activeTabId} tabIndex={tab.id === activeTabId ? 0 : -1}
            onClick={() => { setActiveTabId(tab.id); activeTabRef.current = tab.id; terminalRefs.current.get(tab.id)?.term.focus(); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveTabId(tab.id); } }}
            onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); }} title={`${tab.shellName} · ${tab.cwd}`}>
            <TerminalIcon size={12} aria-hidden="true" /><span className="terminal-tab-label">{index + 1}: {tab.shellName}</span>
            {tab.hasExited && <span className="terminal-exited-dot" title="Shell exited" />}
            <button className="terminal-tab-close" onClick={(event) => handleCloseTab(tab.id, event)} title="Close terminal" aria-label={`Close ${tab.shellName} terminal`}><X size={11} /></button>
          </div>)}
        </div>
        <div className="terminal-new-menu-wrap">
          <button
            ref={menuButtonRef}
            className="terminal-icon-button terminal-new-btn"
            onClick={handleToggleMenu}
            title="New terminal (choose shell profile)"
            aria-label="New terminal"
            aria-expanded={showShellMenu}
            aria-haspopup="menu"
          >
            <Plus size={13} />
            <ChevronDown size={11} className={showShellMenu ? 'terminal-chevron-open' : ''} />
          </button>
        </div>
      </div>
      <div className="terminal-actions">
        {activeTabPath && <button className="terminal-icon-button" onClick={handleSyncCwd} title="Change directory to active editor file" aria-label="Sync terminal to active file"><FolderSync size={13} /></button>}
        <button className="terminal-icon-button" onClick={toggleSplitOrientation} title={`Switch split direction (${splitOrientation === 'horizontal' ? 'side by side' : 'stacked'})`} aria-label="Switch split direction"><Columns size={13} /><span className="terminal-axis-label">{splitOrientation === 'horizontal' ? 'H' : 'V'}</span></button>
        <button className={`terminal-icon-button${splitTabId ? ' is-selected' : ''}`} onClick={handleToggleSplit} title={splitTabId ? 'Close split pane' : 'Split terminal'} aria-label={splitTabId ? 'Close split pane' : 'Split terminal'}><Columns size={13} /></button>
        <button className="terminal-icon-button" onClick={() => activeTab && clearTerminal(activeTab.id)} title="Clear terminal" aria-label="Clear terminal"><Trash2 size={13} /></button>
        <button className="terminal-icon-button" onClick={() => setIsMaximized((value) => !value)} title={isMaximized ? 'Restore terminal height' : 'Expand terminal'} aria-label={isMaximized ? 'Restore terminal height' : 'Expand terminal'}>{isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className="terminal-icon-button" onClick={toggleTerminal} title="Close terminal panel" aria-label="Close terminal panel"><X size={13} /></button>
      </div>
    </header>
    {terminalError && <div className="terminal-error" role="alert">{terminalError}<button onClick={() => setTerminalError('')} aria-label="Dismiss error"><X size={12} /></button></div>}
    <div ref={splitContainerRef} className={`terminal-panes${splitTabId ? ` is-split is-${splitOrientation}` : ''}`}
      style={splitOrientation === 'horizontal' && splitTabId ? { gridTemplateColumns: `${splitRatio}fr 4px ${1 - splitRatio}fr` } : splitTabId ? { gridTemplateRows: `${splitRatio}fr 4px ${1 - splitRatio}fr` } : undefined}
      onClick={() => setContextMenu(null)}>
      {tabs.length === 0 ? <div className="terminal-empty-state"><TerminalIcon size={28} /><span>No active terminal sessions</span><button onClick={() => void handleSpawnTerminal({ shellId: availableShells.find((shell) => shell.isDefault)?.id })}><Plus size={12} />Launch Terminal</button></div>
        : tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isSplit = tab.id === splitTabId;
          const visible = isActive || isSplit;
          return <React.Fragment key={tab.id}>
            <div className="terminal-pane" role="tabpanel" aria-label={`${tab.shellName} terminal`} aria-hidden={!visible} ref={(element) => attachTerminal(tab, element)}
              style={{ display: visible ? 'block' : 'none', gridColumn: splitTabId && splitOrientation === 'horizontal' ? (isActive ? '1' : '3') : '1', gridRow: splitTabId && splitOrientation === 'vertical' ? (isActive ? '1' : '3') : '1' }}
              onClick={() => { if (visible) terminalRefs.current.get(tab.id)?.term.focus(); }}
              onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); }} />
            {splitTabId && isActive && <div className={`terminal-splitter is-${splitOrientation}`} role="separator" aria-orientation={splitOrientation === 'horizontal' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(splitRatio * 100)} tabIndex={0} onPointerDown={handleSplitPointerDown}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 0.05 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.05 : 0;
                if (!delta) return;
                event.preventDefault();
                const ratio = Math.min(0.8, Math.max(0.2, splitRatio + delta));
                splitRatioRef.current = ratio;
                setSplitRatio(ratio);
                queuePersist();
              }} />}
          </React.Fragment>;
        })}
    </div>
    {showShellMenu && (
      <div
        ref={menuRef}
        className="terminal-profile-menu"
        style={{
          top: menuCoords.top !== undefined ? `${menuCoords.top}px` : undefined,
          bottom: menuCoords.bottom !== undefined ? `${menuCoords.bottom}px` : undefined,
          left: `${menuCoords.left}px`
        }}
        role="menu"
        aria-label="Terminal Shell Profiles"
      >
        <div className="terminal-menu-header">
          <span className="terminal-menu-label">SHELL PROFILES</span>
          <span className="terminal-menu-count">
            {(settings?.terminalProfiles?.length || 0) + availableShells.length} available
          </span>
        </div>
        <div className="terminal-menu-scrollable" role="group">
          {settings?.terminalProfiles && settings.terminalProfiles.length > 0 && (
            <div className="terminal-menu-group">
              <div className="terminal-menu-subheader">CONFIGURED PROFILES</div>
              {settings.terminalProfiles.map((profile) => (
                <button
                  key={profile.id}
                  role="menuitem"
                  className="terminal-menu-item"
                  onClick={() => {
                    setShowShellMenu(false);
                    void handleSpawnTerminal({ profileId: profile.id, shellId: profile.shellId });
                  }}
                >
                  <TerminalIcon size={12} className="terminal-menu-icon" />
                  <span className="terminal-menu-name" title={profile.name}>{profile.name}</span>
                  {profile.id === settings.defaultTerminalProfileId && (
                    <span className="terminal-default-label">Default</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="terminal-menu-group">
            {settings?.terminalProfiles && settings.terminalProfiles.length > 0 && (
              <div className="terminal-menu-subheader">DETECTED SYSTEM SHELLS</div>
            )}
            {availableShells.map((shell) => (
              <button
                key={shell.id}
                role="menuitem"
                className="terminal-menu-item"
                onClick={() => {
                  setShowShellMenu(false);
                  void handleSpawnTerminal({ shellId: shell.id });
                }}
              >
                <TerminalIcon size={12} className="terminal-menu-icon" />
                <span className="terminal-menu-name" title={shell.name}>{shell.name}</span>
                {shell.isDefault && (
                  <span className="terminal-default-label">System</span>
                )}
              </button>
            ))}
          </div>
          {availableShells.length === 0 && (!settings?.terminalProfiles || settings.terminalProfiles.length === 0) && (
            <div className="terminal-menu-empty">No shell profiles detected</div>
          )}
        </div>
        <div className="terminal-menu-footer">
          <button
            className="terminal-settings-link"
            role="menuitem"
            onClick={() => {
              setShowShellMenu(false);
              toggleSettings();
            }}
          >
            <Settings2 size={12} />
            <span>Configure profiles…</span>
          </button>
        </div>
      </div>
    )}
    {contextMenu && <div className="terminal-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
      <button role="menuitem" onClick={() => void copySelection(contextMenu.tabId)}><Copy size={12} />Copy selection</button>
      <button role="menuitem" onClick={() => void pasteClipboard(contextMenu.tabId)}><ClipboardPaste size={12} />Paste</button>
      <button role="menuitem" onClick={() => clearTerminal(contextMenu.tabId)}><Trash2 size={12} />Clear terminal</button>
    </div>}
  </section>;
};
