import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Search,
  Settings,
  ChevronDown,
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  FolderOpen,
  FileCode,
  Terminal as TerminalIcon,
  HelpCircle,
  ExternalLink,
  Shield,
  Palette
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import { toast } from '../state/toast-store';
import type { AppInfo } from '../../../preload/types';

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties => ({ WebkitAppRegion: region } as React.CSSProperties);

export type AppTheme = 'dark' | 'light' | 'high-contrast';

// Custom purplish microchip logo matching Ty-Code design language
const TyCodeMicrochipLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <div
    style={{
      width: `${size + 5}px`,
      height: `${size + 5}px`,
      borderRadius: '5px',
      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22) 0%, rgba(99, 102, 241, 0.16) 100%)',
      border: '1px solid rgba(168, 85, 247, 0.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 10px rgba(168, 85, 247, 0.25)',
      flexShrink: 0
    }}
  >
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tyMicrochipGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* Outer Chip Body */}
      <rect x="5" y="5" width="14" height="14" rx="2.5" stroke="url(#tyMicrochipGrad)" strokeWidth="1.8" />
      {/* Inner Core */}
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" fill="url(#tyMicrochipGrad)" fillOpacity="0.3" stroke="url(#tyMicrochipGrad)" strokeWidth="1.2" />
      {/* Top Pins */}
      <path d="M8.5 2v3M12 2v3M15.5 2v3" stroke="url(#tyMicrochipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Bottom Pins */}
      <path d="M8.5 19v3M12 19v3M15.5 19v3" stroke="url(#tyMicrochipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Left Pins */}
      <path d="M2 8.5h3M2 12h3M2 15.5h3" stroke="url(#tyMicrochipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Right Pins */}
      <path d="M19 8.5h3M19 12h3M19 15.5h3" stroke="url(#tyMicrochipGrad)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </div>
);

// Panel & Layout control icons
const LayoutAllIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v6h2V5H3zm3 0v6h4V5H6zm5 0v6h2V5h-2z" fillRule="evenodd" />
  </svg>
);

const SidebarLeftIcon: React.FC<{ size?: number; active?: boolean }> = ({ size = 14, active }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 2H3v6h2V5zm1 0v6h7V5H6z" fillRule="evenodd" opacity={active ? 1 : 0.75} />
  </svg>
);

const PanelBottomIcon: React.FC<{ size?: number; active?: boolean }> = ({ size = 14, active }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v4h10V5H3zm0 5v1h10v-1H3z" fillRule="evenodd" opacity={active ? 1 : 0.75} />
  </svg>
);

const SidebarRightIcon: React.FC<{ size?: number; active?: boolean }> = ({ size = 14, active }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 2H3v6h7V5zm1 0v6h2V5h-2z" fillRule="evenodd" opacity={active ? 1 : 0.75} />
  </svg>
);

// Native Windows Caption Button SVGs (pixel-crisp 10x10)
const MinimizeIcon: React.FC = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
    <rect width="10" height="1" fill="currentColor" />
  </svg>
);

const MaximizeIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <rect x="0.5" y="0.5" width="9" height="9" />
  </svg>
);

const RestoreIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M2.5 0.5 h 7 v 7 h -1" />
    <rect x="0.5" y="2.5" width="7" height="7" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
    <line x1="1" y1="1" x2="9" y2="9" />
    <line x1="9" y1="1" x2="1" y2="9" />
  </svg>
);

interface WindowControlButtonProps {
  onClick: () => void;
  title: string;
  isClose?: boolean;
  children: React.ReactNode;
}

const WindowControlButton: React.FC<WindowControlButtonProps> = ({ onClick, title, isClose, children }) => {
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      title={title}
      aria-label={title}
      style={{
        width: '46px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isClose
          ? active
            ? '#f1707a'
            : hovered
            ? '#e81123'
            : 'transparent'
          : active
          ? 'rgba(255, 255, 255, 0.16)'
          : hovered
          ? 'rgba(255, 255, 255, 0.08)'
          : 'transparent',
        color: isClose && hovered ? '#ffffff' : 'var(--text-secondary, #94a3b8)',
        border: 'none',
        outline: 'none',
        cursor: 'default',
        padding: 0,
        margin: 0,
        transition: 'background-color 100ms ease, color 100ms ease',
        ...appRegion('no-drag')
      }}
    >
      {children}
    </button>
  );
};

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  divider?: boolean;
}

export const TitleBar: React.FC = () => {
  const { workspacePath, setWorkspacePath, setFileTree } = useWorkspaceStore();
  const { toggleSettings, openSettings, toggleTerminal, isTerminalOpen } = useChatStore();
  const openUsageDashboard = useUsageDashboardStore((s) => s.openDashboard);

  const [theme, setTheme] = useState<AppTheme>(() => {
    return (localStorage.getItem('ty_claude_theme') as AppTheme) || 'dark';
  });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'>('idle');
  const [updatePercent, setUpdatePercent] = useState<number>(0);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // Menubar state
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState<boolean>(false);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Apply theme to body
  useEffect(() => {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-high-contrast');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('ty_claude_theme', theme);
  }, [theme]);

  // Window maximize & App info listener
  useEffect(() => {
    void window.electronAPI?.isWindowMaximized?.().then((max) => {
      setIsMaximized(Boolean(max));
    });

    const cleanupMaximize = window.electronAPI?.onWindowMaximizeChange?.((max) => {
      setIsMaximized(max);
    });

    void window.electronAPI?.getAppInfo?.().then((res) => {
      if (res?.success && res.data) setAppInfo(res.data);
    });

    const cleanupStatus = window.electronAPI?.onUpdateStatus?.((status) => {
      if (status.type === 'checking') setUpdateStatus('checking');
      else if (status.type === 'available') {
        setUpdateStatus('available');
        toast.info('New update available', `Version ${status.version || ''}`, {
          label: 'Download',
          onClick: () => { void window.electronAPI.downloadUpdate(); }
        });
      } else if (status.type === 'not-available') {
        setUpdateStatus('idle');
      } else if (status.type === 'downloaded') {
        setUpdateStatus('downloaded');
        toast.success('Update ready to install!', 'Restart Ty-Code to apply update.', {
          label: 'Restart Now',
          onClick: () => window.electronAPI.installUpdate()
        });
      } else if (status.type === 'error') {
        setUpdateStatus('idle');
        toast.error('Update check failed', status.error || 'The update service could not complete the request.');
      }
    });

    const cleanupProgress = window.electronAPI?.onUpdateProgress?.((progress) => {
      setUpdateStatus('downloading');
      setUpdatePercent(progress.percent || 0);
    });

    return () => {
      cleanupMaximize?.();
      cleanupStatus?.();
      cleanupProgress?.();
    };
  }, []);

  // Close menus when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuBarRef.current && !menuBarRef.current.contains(target)) {
        setActiveMenu(null);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setIsProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenu(null);
        setIsProfileMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleOpenFolder = async () => {
    try {
      const res = await window.electronAPI.selectWorkspaceFolder();
      if (res.success && res.data) {
        setWorkspacePath(res.data);
        const treeRes = await window.electronAPI.getWorkspaceTree(res.data);
        if (treeRes.success && treeRes.data) {
          setFileTree(treeRes.data);
          toast.success('Workspace opened', res.data);
        }
      }
    } catch (err) {
      toast.error('Failed to open folder', String(err));
    }
  };

  const cycleTheme = () => {
    const next: AppTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'high-contrast' : 'dark';
    setTheme(next);
    toast.info(`Theme set to ${next}`);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res.error) {
        setUpdateStatus('idle');
        toast.error('Update check failed', res.error);
      } else if (res.updateAvailable) {
        setUpdateStatus('available');
      } else {
        setUpdateStatus('idle');
        toast.success('Up to date', `Ty-Code v${res.currentVersion} is the latest version.`);
      }
    } catch (err) {
      setUpdateStatus('idle');
      toast.error('Update check failed', String(err));
    }
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, select, input, [data-no-drag="true"]')) {
      return;
    }
    window.electronAPI?.maximizeWindow?.();
  };

  const folderName = workspacePath ? workspacePath.split(/[/\\]/).pop() : '';
  const isMac = appInfo?.platform === 'darwin';

  // Desktop Menu Definitions
  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New File', shortcut: 'Ctrl+N', action: () => window.dispatchEvent(new CustomEvent('workbench:new-file')) },
      { label: 'Open Folder…', shortcut: 'Ctrl+O', action: handleOpenFolder },
      { divider: true, label: '' },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => toast.info('File saved') },
      { label: 'Save All', action: () => toast.info('All workspace files saved') },
      { divider: true, label: '' },
      { label: 'Settings', shortcut: 'Ctrl+,', action: toggleSettings },
      { divider: true, label: '' },
      { label: 'Exit', shortcut: 'Alt+F4', action: () => window.electronAPI.closeWindow() }
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: () => document.execCommand('redo') },
      { divider: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
      { divider: true, label: '' },
      { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: () => window.dispatchEvent(new CustomEvent('workbench:find-in-files')) }
    ],
    Selection: [
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
      { label: 'Expand Selection', shortcut: 'Alt+Shift+Right' },
      { label: 'Shrink Selection', shortcut: 'Alt+Shift+Left' },
      { divider: true, label: '' },
      { label: 'Copy Line Up', shortcut: 'Alt+Shift+Up' },
      { label: 'Copy Line Down', shortcut: 'Alt+Shift+Down' }
    ],
    View: [
      { label: 'Command Palette…', shortcut: 'Ctrl+Shift+P', action: () => window.dispatchEvent(new CustomEvent('workbench:command-palette')) },
      { label: 'Quick Open…', shortcut: 'Ctrl+P', action: () => window.dispatchEvent(new CustomEvent('workbench:quick-open')) },
      { divider: true, label: '' },
      { label: 'Toggle Primary Sidebar', shortcut: 'Ctrl+B', action: () => window.dispatchEvent(new CustomEvent('workbench:toggle-left-sidebar')) },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: toggleTerminal },
      { label: 'Toggle AI Assistant', shortcut: 'Ctrl+Alt+B', action: () => window.dispatchEvent(new CustomEvent('workbench:toggle-right-sidebar')) },
      { divider: true, label: '' },
      { label: 'Usage & Quota Dashboard', action: openUsageDashboard },
      { label: 'Boot Timeline', action: () => window.dispatchEvent(new CustomEvent('workbench:show-boot-timeline')) }
    ],
    Go: [
      { label: 'Go to File…', shortcut: 'Ctrl+P', action: () => window.dispatchEvent(new CustomEvent('workbench:quick-open')) },
      { label: 'Go to Symbol…', shortcut: 'Ctrl+T', action: () => window.dispatchEvent(new CustomEvent('workbench:quick-open-symbols')) },
      { label: 'Go to Line…', shortcut: 'Ctrl+G', action: () => window.dispatchEvent(new CustomEvent('workbench:quick-open-line')) },
      { divider: true, label: '' },
      { label: 'Back', shortcut: 'Alt+Left' },
      { label: 'Forward', shortcut: 'Alt+Right' }
    ],
    Run: [
      { label: 'Start Debugging', shortcut: 'F5', action: () => toast.info('Starting debug session…') },
      { label: 'Run Without Debugging', shortcut: 'Ctrl+F5', action: () => toast.info('Running code…') },
      { divider: true, label: '' },
      { label: 'Run Active File in Terminal', action: toggleTerminal }
    ],
    Terminal: [
      { label: 'New Terminal', shortcut: 'Ctrl+Shift+`', action: toggleTerminal },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: toggleTerminal },
      { divider: true, label: '' },
      { label: 'Clear Terminal' }
    ],
    Help: [
      { label: 'Documentation', action: () => toast.info('Ty-Code Documentation') },
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S' },
      { label: 'Check for Updates…', action: handleCheckUpdate },
      { divider: true, label: '' },
      { label: 'About Ty-Code', action: () => setIsAboutOpen(true) }
    ]
  };

  return (
    <header
      onDoubleClick={handleHeaderDoubleClick}
      style={{
        height: '35px',
        backgroundColor: 'var(--bg-secondary, #0e171b)',
        borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMac ? '0 12px 0 78px' : '0 0 0 10px',
        userSelect: 'none',
        position: 'relative',
        zIndex: 50,
        ...appRegion('drag')
      }}
    >
      {/* Left: App Logo & Menubar */}
      <div
        ref={menuBarRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '100%',
          ...appRegion('no-drag')
        }}
      >
        {/* Ty-Code Microchip Logo */}
        <div style={{ marginRight: '4px', display: 'flex', alignItems: 'center' }} title="Ty-Code">
          <TyCodeMicrochipLogo size={16} />
        </div>

        {/* Menu Bar Items */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '1px', height: '100%' }}>
          {Object.keys(menus).map((menuKey) => {
            const isOpen = activeMenu === menuKey;
            return (
              <div key={menuKey} style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveMenu(isOpen ? null : menuKey)}
                  onMouseEnter={() => {
                    if (activeMenu !== null && activeMenu !== menuKey) {
                      setActiveMenu(menuKey);
                    }
                  }}
                  style={{
                    fontSize: '12px',
                    padding: '3px 7px',
                    color: isOpen ? '#ffffff' : 'var(--text-secondary, #94a3b8)',
                    backgroundColor: isOpen ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 100ms ease, color 100ms ease'
                  }}
                  onMouseOver={(e) => {
                    if (!isOpen) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.color = '#ffffff';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isOpen) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
                    }
                  }}
                >
                  {menuKey}
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      backgroundColor: 'var(--bg-secondary, #12181f)',
                      border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                      borderRadius: '6px',
                      padding: '4px 0',
                      minWidth: '220px',
                      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
                      zIndex: 9999,
                      backdropFilter: 'blur(16px)'
                    }}
                  >
                    {menus[menuKey].map((item, idx) => {
                      if (item.divider) {
                        return (
                          <div
                            key={idx}
                            style={{
                              height: '1px',
                              backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))',
                              margin: '4px 0'
                            }}
                          />
                        );
                      }
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setActiveMenu(null);
                            item.action?.();
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 12px',
                            fontSize: '12px',
                            color: 'var(--text-primary, #e2e8f0)',
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--accent-primary, #0284c7)';
                            e.currentTarget.style.color = '#ffffff';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
                          }}
                        >
                          <span>{item.label}</span>
                          {item.shortcut && (
                            <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '16px' }}>
                              {item.shortcut}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Center: Window & Workspace Title */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'none',
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: '12px',
          fontWeight: 450,
          letterSpacing: '0.2px',
          whiteSpace: 'nowrap',
          maxWidth: '40vw',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        <span>
          {folderName ? `${folderName} — Ty-Code` : 'Ty-Code'}
        </span>
      </div>

      {/* Right: Layout Toggles, Search, Utilities, Avatar & Window Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          ...appRegion('no-drag')
        }}
      >
        {/* Layout Icons (Matching Screenshot) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginRight: '4px' }}>
          {/* Toggle All Panels / Split */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('workbench:toggle-all-panels'))}
            style={{
              padding: '4px 6px',
              color: 'var(--text-secondary, #94a3b8)',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Customize Layout"
            aria-label="Customize Layout"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
          >
            <LayoutAllIcon size={14} />
          </button>

          {/* Toggle Primary Sidebar (Left) */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('workbench:toggle-left-sidebar'))}
            style={{
              padding: '4px 6px',
              color: 'var(--text-secondary, #94a3b8)',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Toggle Primary Sidebar (Ctrl+B)"
            aria-label="Toggle Primary Sidebar (Ctrl+B)"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
          >
            <SidebarLeftIcon size={14} />
          </button>

          {/* Toggle Bottom Panel (Terminal) */}
          <button
            onClick={toggleTerminal}
            style={{
              padding: '4px 6px',
              color: isTerminalOpen ? 'var(--accent-primary, #38bdf8)' : 'var(--text-secondary, #94a3b8)',
              background: isTerminalOpen ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Toggle Panel (Ctrl+`)"
            aria-label="Toggle Panel (Ctrl+`)"
            onMouseEnter={(e) => { if (!isTerminalOpen) { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; } }}
            onMouseLeave={(e) => { if (!isTerminalOpen) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; } }}
          >
            <PanelBottomIcon size={14} active={isTerminalOpen} />
          </button>

          {/* Toggle Secondary Sidebar (AI Assistant) */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('workbench:toggle-right-sidebar'))}
            style={{
              padding: '4px 6px',
              color: 'var(--text-secondary, #94a3b8)',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Toggle Secondary Sidebar (AI Assistant)"
            aria-label="Toggle Secondary Sidebar (AI Assistant)"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
          >
            <SidebarRightIcon size={14} />
          </button>
        </div>

        {/* Search Quick Open Icon */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('workbench:quick-open'))}
          style={{
            padding: '4px 6px',
            color: 'var(--text-secondary, #94a3b8)',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Search Files (Ctrl+P)"
          aria-label="Search Files (Ctrl+P)"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
        >
          <Search size={14} />
        </button>

        {/* Vertical Divider */}
        <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.12))', margin: '0 5px' }} />

        {/* Global / Updates Check */}
        <button
          onClick={handleCheckUpdate}
          style={{
            padding: '4px 6px',
            color: updateStatus === 'available' ? 'var(--accent-green, #10b981)' : updateStatus === 'downloaded' ? 'var(--accent-cyan, #06b6d4)' : 'var(--text-secondary, #94a3b8)',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
          title={
            updateStatus === 'checking'
              ? 'Checking for updates…'
              : updateStatus === 'downloading'
              ? `Downloading update (${updatePercent}%)…`
              : updateStatus === 'downloaded'
              ? 'Update downloaded! Restart to apply'
              : 'Check for Updates'
          }
          aria-label="Check for Updates"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {updateStatus === 'checking' ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : updateStatus === 'downloaded' ? (
            <CheckCircle2 size={13} color="var(--accent-green, #10b981)" />
          ) : updateStatus === 'available' || updateStatus === 'downloading' ? (
            <DownloadCloud size={13} color="var(--accent-primary, #38bdf8)" />
          ) : (
            <RefreshCw size={13} />
          )}
          {updateStatus === 'downloading' && (
            <span style={{ fontSize: '10px' }}>{updatePercent}%</span>
          )}
        </button>

        {/* Settings Gear */}
        <button
          onClick={toggleSettings}
          style={{
            padding: '4px 6px',
            color: 'var(--text-secondary, #94a3b8)',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Settings & API Keys (Ctrl+,)"
          aria-label="Settings & API Keys (Ctrl+,)"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#ffffff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
        >
          <Settings size={14} />
        </button>

        {/* Avatar Profile Dropdown */}
        <div ref={profileMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            style={{
              padding: '3px 5px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Profile & Preferences"
            aria-label="Profile & Preferences"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            {/* Cosmic avatar circle matching screenshot */}
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #38bdf8 0%, #6366f1 50%, #0f172a 100%)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                boxShadow: '0 0 6px rgba(56, 189, 248, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                fontWeight: 700,
                color: '#ffffff',
                userSelect: 'none'
              }}
            >
              TC
            </div>
            <ChevronDown size={10} style={{ color: 'var(--text-secondary, #94a3b8)', opacity: 0.8 }} />
          </button>

          {isProfileMenuOpen && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                backgroundColor: 'var(--bg-secondary, #12181f)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                borderRadius: '6px',
                padding: '6px 0',
                minWidth: '200px',
                boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
                zIndex: 9999,
                backdropFilter: 'blur(16px)'
              }}
            >
              <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>Developer</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary, #94a3b8)' }}>Ty-Code Desktop</div>
              </div>
              <button
                type="button"
                onClick={() => { setIsProfileMenuOpen(false); openSettings('byok'); }}
                style={{ width: '100%', background: 'none', border: 'none', padding: '6px 12px', fontSize: '12px', color: 'var(--text-primary, #e2e8f0)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary, #0284c7)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)'; }}
              >
                <Shield size={13} />
                <span>API Keys & BYOK…</span>
              </button>
              <button
                type="button"
                onClick={() => { setIsProfileMenuOpen(false); openUsageDashboard(); }}
                style={{ width: '100%', background: 'none', border: 'none', padding: '6px 12px', fontSize: '12px', color: 'var(--text-primary, #e2e8f0)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary, #0284c7)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)'; }}
              >
                <FolderOpen size={13} />
                <span>Quota & Analytics</span>
              </button>
              <button
                type="button"
                onClick={() => { cycleTheme(); }}
                style={{ width: '100%', background: 'none', border: 'none', padding: '6px 12px', fontSize: '12px', color: 'var(--text-primary, #e2e8f0)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary, #0284c7)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)'; }}
              >
                <Palette size={13} />
                <span>Theme: {theme}</span>
              </button>
              <div style={{ height: '1px', backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))', margin: '4px 0' }} />
              <button
                type="button"
                onClick={() => { setIsProfileMenuOpen(false); void handleCheckUpdate(); }}
                style={{ width: '100%', background: 'none', border: 'none', padding: '6px 12px', fontSize: '12px', color: 'var(--text-primary, #e2e8f0)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary, #0284c7)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)'; }}
              >
                <RefreshCw size={13} />
                <span>Check for Updates…</span>
              </button>
            </div>
          )}
        </div>

        {/* Custom Window Controls (Flush right corner on Windows & Linux) */}
        {!isMac && (
          <div style={{ display: 'flex', alignItems: 'center', height: '100%', marginLeft: '8px' }}>
            <WindowControlButton
              title="Minimize"
              onClick={() => window.electronAPI.minimizeWindow()}
            >
              <MinimizeIcon />
            </WindowControlButton>
            <WindowControlButton
              title={isMaximized ? 'Restore' : 'Maximize'}
              onClick={() => window.electronAPI.maximizeWindow()}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </WindowControlButton>
            <WindowControlButton
              title="Close"
              isClose
              onClick={() => window.electronAPI.closeWindow()}
            >
              <CloseIcon />
            </WindowControlButton>
          </div>
        )}
      </div>

      {/* About Ty-Code Modal with Mandatory Upstream FCC Attribution */}
      {isAboutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="About Ty-Code"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 10005,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            ...appRegion('no-drag')
          }}
          onClick={() => setIsAboutOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              color: '#f8fafc'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <TyCodeMicrochipLogo size={28} />
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Ty-Code</h3>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Version {appInfo?.version || '1.0.0'} • MIT License
                </div>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', margin: '0 0 16px 0' }}>
              The high-performance, developer-first AI code editor with zero-cost model supply, real extension security, and local safeStorage.
            </p>

            <div
              style={{
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                color: '#c7d2fe',
                marginBottom: '16px',
                lineHeight: '1.5'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px', color: '#818cf8' }}>
                Upstream Model Supply Attribution
              </div>
              <div style={{ wordBreak: 'break-all' }}>
                Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setIsAboutOpen(false)}
                style={{
                  backgroundColor: 'var(--accent-primary, #6366f1)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
