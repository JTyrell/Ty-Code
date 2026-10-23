import React, { useEffect, useState } from 'react';
import { Bug, Sparkles, Minimize2, ExternalLink } from 'lucide-react';
import { OmniDebugger } from './OmniDebugger';
import { useDebuggerStore } from '../../state/debugger-store';

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties =>
  ({ WebkitAppRegion: region } as React.CSSProperties);

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
      type="button"
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
          ? 'var(--surface-3)'
          : hovered
          ? 'var(--surface-2)'
          : 'transparent',
        color: isClose && hovered ? '#ffffff' : '#94a3b8',
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

export const DebuggerWindow: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  const selectedRole = useDebuggerStore((s) => s.selectedRole);
  const analysisResults = useDebuggerStore((s) => s.analysisResults);
  const togglePopOutMode = useDebuggerStore((s) => s.togglePopOutMode);

  useEffect(() => {
    window.electronAPI?.isWindowMaximized?.().then((max) => {
      setIsMaximized(max);
    }).catch(() => {});

    const unsubscribe = window.electronAPI?.onWindowMaximizeChange?.((max: boolean) => {
      setIsMaximized(max);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const totalFindings = analysisResults.filter((r) => r.role === selectedRole).length;

  return (
    <div
      className="omni-window-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        background: '#090d16',
        color: '#e2e8f0',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Pop-Out Window Title Bar with Window Controls */}
      <header
        className="omni-window-titlebar"
        style={{
          height: '35px',
          minHeight: '35px',
          maxHeight: '35px',
          boxSizing: 'border-box',
          backgroundColor: '#0c101c',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMac ? '76px' : '12px',
          paddingRight: 0,
          flexShrink: 0,
          ...appRegion('drag')
        }}
      >
        {/* Left Titlebar Brand */}
        <div
          className="omni-window-titlebar-left"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '8px',
            height: '100%',
            flexShrink: 0,
            minWidth: 0
          }}
        >
          <div
            className="omni-window-brand-icon"
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '5px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.22) 100%)',
              border: '1px solid rgba(129, 140, 248, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a5b4fc',
              boxShadow: '0 0 10px rgba(99, 102, 241, 0.25)',
              flexShrink: 0
            }}
          >
            <Bug size={12} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#818cf8', fontWeight: 700 }}>Ty-Code</span>
              <span style={{ color: '#64748b', margin: '0 5px' }}>•</span>
              Omni-Debugger
            </span>
          </div>

          <span
            className="omni-window-mode-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '9.5px',
              padding: '1px 7px',
              borderRadius: '4px',
              textTransform: 'uppercase',
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              background:
                selectedRole === 'dev'
                  ? 'rgba(99, 102, 241, 0.16)'
                  : selectedRole === 'qa'
                  ? 'rgba(245, 158, 11, 0.16)'
                  : 'rgba(168, 85, 247, 0.16)',
              color:
                selectedRole === 'dev'
                  ? '#a5b4fc'
                  : selectedRole === 'qa'
                  ? '#fcd34d'
                  : '#d8b4fe',
              border:
                selectedRole === 'dev'
                  ? '1px solid rgba(99, 102, 241, 0.35)'
                  : selectedRole === 'qa'
                  ? '1px solid rgba(245, 158, 11, 0.35)'
                  : '1px solid rgba(168, 85, 247, 0.35)'
            }}
          >
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                background:
                  selectedRole === 'dev'
                    ? '#818cf8'
                    : selectedRole === 'qa'
                    ? '#fbbf24'
                    : '#c084fc'
              }}
            />
            {selectedRole} Mode
          </span>

          <span
            className="omni-window-findings-badge"
            style={{
              fontSize: '11px',
              color: '#64748b',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap'
            }}
          >
            ({totalFindings} findings)
          </span>
        </div>

        {/* Center Draggable Spacer */}
        <div style={{ flex: 1, height: '100%', minWidth: '16px', ...appRegion('drag') }} />

        {/* Right Titlebar Controls */}
        <div
          className="omni-window-titlebar-right"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            height: '100%',
            flexShrink: 0
          }}
        >
          {/* Dock back into sidebar button */}
          <button
            type="button"
            onClick={togglePopOutMode}
            className="omni-window-dock-btn"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 9px',
              marginRight: '8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 500,
              color: '#cbd5e1',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 120ms ease',
              ...appRegion('no-drag')
            }}
            title="Dock debugger back into the main IDE sidebar"
          >
            <Minimize2 size={12} color="#94a3b8" />
            <span>Dock to Sidebar</span>
          </button>

          {/* Window Caption Buttons (Windows/Linux) */}
          {!isMac && (
            <div
              className="omni-window-caption-controls"
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: '100%',
                ...appRegion('no-drag')
              }}
            >
              <WindowControlButton
                onClick={() => window.electronAPI?.minimizeWindow?.()}
                title="Minimize"
              >
                <MinimizeIcon />
              </WindowControlButton>

              <WindowControlButton
                onClick={() => window.electronAPI?.maximizeWindow?.()}
                title={isMaximized ? 'Restore Down' : 'Maximize'}
              >
                {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
              </WindowControlButton>

              <WindowControlButton
                onClick={() => window.electronAPI?.closeWindow?.()}
                title="Close"
                isClose
              >
                <CloseIcon />
              </WindowControlButton>
            </div>
          )}
        </div>
      </header>

      {/* Main OmniDebugger Viewport */}
      <div
        className="omni-window-content"
        style={{
          flex: 1,
          height: 'calc(100vh - 35px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <OmniDebugger isStandalone={true} />
      </div>
    </div>
  );
};
