import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Trash2,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import type { ShellInfo } from '../../../preload/types';

interface TerminalTab {
  id: string;
  ptyId: string;
  shellId: string;
  shellName: string;
}

export const TerminalDrawer: React.FC = () => {
  const { isTerminalOpen, toggleTerminal } = useChatStore();
  const { workspacePath } = useWorkspaceStore();

  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showShellMenu, setShowShellMenu] = useState(false);

  // References to active xterm instances and fit addons
  const terminalRefs = useRef<Map<string, { term: XtermTerminal; fit: FitAddon; container: HTMLDivElement }>>(new Map());
  const activeTabRef = useRef<string | null>(null);
  activeTabRef.current = activeTabId;

  // Load available OS shells on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI.getAvailableShells();
        if (res.success && res.data) {
          setAvailableShells(res.data);
        }
      } catch (err) {
        console.error('Failed to get available shells:', err);
      }
    })();
  }, []);

  // Spawn initial terminal tab when opened if empty
  useEffect(() => {
    if (isTerminalOpen && tabs.length === 0 && availableShells.length > 0) {
      const defaultShell = availableShells.find((s) => s.isDefault) || availableShells[0];
      handleSpawnTerminal(defaultShell.id);
    }
  }, [isTerminalOpen, availableShells, tabs.length]);

  const handleSpawnTerminal = async (shellId?: string) => {
    try {
      setShowShellMenu(false);
      const res = await window.electronAPI.spawnPty({
        shellId,
        cwd: workspacePath,
        cols: 80,
        rows: 24
      });

      if (res.success && res.data) {
        const newTab: TerminalTab = {
          id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          ptyId: res.data.ptyId,
          shellId: res.data.shellId,
          shellName: res.data.shellName
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
      }
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
    }
  };

  const handleCloseTab = async (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (!tabToClose) return;

    // Kill PTY process
    await window.electronAPI.killPty(tabToClose.ptyId);

    // Dispose xterm instance
    const entry = terminalRefs.current.get(tabId);
    if (entry) {
      entry.term.dispose();
      terminalRefs.current.delete(tabId);
    }

    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      setActiveTabId(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null);
    }
  };

  const handleClearActiveTerminal = () => {
    if (!activeTabId) return;
    const entry = terminalRefs.current.get(activeTabId);
    if (entry) {
      entry.term.clear();
    }
  };

  // Attach Xterm to container when active tab renders
  const attachTerminal = (tab: TerminalTab, container: HTMLDivElement | null) => {
    if (!container) return;

    // Check if terminal already initialized for this tab
    if (terminalRefs.current.has(tab.id)) {
      const entry = terminalRefs.current.get(tab.id)!;
      if (entry.container !== container) {
        container.innerHTML = '';
        entry.term.open(container);
        entry.fit.fit();
      }
      return;
    }

    container.innerHTML = '';

    const term = new XtermTerminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', Cascadia, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#121316',
        foreground: '#f3f4f6',
        cursor: '#8b5cf6',
        cursorAccent: '#121316',
        selectionBackground: 'rgba(139, 92, 246, 0.35)',
        black: '#1f2128',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f3f4f6',
        brightBlack: '#4b5563',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(container);
    fitAddon.fit();

    terminalRefs.current.set(tab.id, { term, fit: fitAddon, container });

    // Send keystrokes to PTY stdin
    term.onData((data) => {
      window.electronAPI.writePty(tab.ptyId, data);
    });

    // Receive stdout from PTY
    const unsubData = window.electronAPI.onPtyData(tab.ptyId, (data) => {
      term.write(data);
    });

    // On exit
    const unsubExit = window.electronAPI.onPtyExit(tab.ptyId, (code) => {
      term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
    });

    // Resize listener
    const resizeObserver = new ResizeObserver(() => {
      if (activeTabRef.current === tab.id) {
        try {
          fitAddon.fit();
          window.electronAPI.resizePty(tab.ptyId, term.cols, term.rows);
        } catch {
          // ignore
        }
      }
    });
    resizeObserver.observe(container);

    // Initial size notify
    window.electronAPI.resizePty(tab.ptyId, term.cols, term.rows);
  };

  if (!isTerminalOpen) return null;

  return (
    <div
      style={{
        height: isMaximized ? '65vh' : '280px',
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 10
      }}
    >
      {/* Terminal Tab Bar */}
      <div
        style={{
          height: '35px',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px'
        }}
      >
        {/* Left: Shell Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', overflowX: 'auto' }}>
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  height: '28px',
                  padding: '0 10px',
                  backgroundColor: isActive ? 'var(--bg-primary)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderTop: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  borderRadius: '4px 4px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 500
                }}
              >
                <TerminalIcon size={12} color={isActive ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                <span>{`${idx + 1}: ${tab.shellName}`}</span>
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  style={{ padding: '2px', color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  title="Close Terminal"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}

          {/* New Terminal Dropdown Button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowShellMenu(!showShellMenu)}
              style={{
                height: '26px',
                padding: '0 6px',
                backgroundColor: showShellMenu ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-secondary)',
                borderRadius: '4px'
              }}
              title="New Terminal Shell"
            >
              <Plus size={13} />
              <ChevronDown size={11} />
            </button>

            {showShellMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '32px',
                  left: 0,
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
                  zIndex: 999,
                  minWidth: '180px',
                  padding: '4px'
                }}
              >
                <div style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  AVAILABLE OS SHELLS
                </div>
                {availableShells.map((shell) => (
                  <div
                    key={shell.id}
                    onClick={() => handleSpawnTerminal(shell.id)}
                    style={{
                      padding: '6px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      borderRadius: '4px',
                      color: 'var(--text-primary)'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <TerminalIcon size={12} color="var(--accent-primary)" />
                    <span>{shell.name}</span>
                    {shell.isDefault && (
                      <span style={{ fontSize: '10px', color: 'var(--accent-cyan)', marginLeft: 'auto' }}>
                        Default
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions (Clear, Maximize, Close) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={handleClearActiveTerminal}
            style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}
            title="Clear Terminal"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}
            title={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={toggleTerminal}
            style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}
            title="Close Terminal Panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Viewports Container */}
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#121316', overflow: 'hidden' }}>
        {tabs.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-muted)'
            }}
          >
            <TerminalIcon size={32} strokeWidth={1.5} color="var(--border-strong)" />
            <div style={{ fontSize: '13px' }}>No active terminal sessions</div>
            <button
              onClick={() => handleSpawnTerminal()}
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                padding: '4px 12px',
                fontSize: '11px',
                marginTop: '4px'
              }}
            >
              <Plus size={12} />
              <span>Launch Terminal</span>
            </button>
          </div>
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                ref={(el) => attachTerminal(tab, el)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: '6px 10px',
                  display: isActive ? 'block' : 'none'
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
