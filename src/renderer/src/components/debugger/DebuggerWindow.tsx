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
          ? 'rgba(255, 255, 255, 0.16)'
          : hovered
          ? 'rgba(255, 255, 255, 0.08)'
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
    <div className="flex flex-col w-screen h-screen bg-[#121316] text-zinc-200 overflow-hidden select-none">
      {/* Pop-Out Window Title Bar with Window Controls */}
      <header
        style={{
          height: '32px',
          minHeight: '32px',
          backgroundColor: '#0c0d0f',
          borderBottom: '1px solid #27272a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMac ? '76px' : '10px',
          paddingRight: 0,
          ...appRegion('drag')
        }}
      >
        {/* Left Titlebar Brand */}
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Bug size={11} />
          </div>
          <span className="text-[11px] font-semibold text-zinc-300 tracking-wide">
            Ty-Code • Omni-Debugger
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full uppercase font-bold tracking-wider bg-zinc-800 text-zinc-400 font-mono">
            {selectedRole} Mode
          </span>
          <span className="text-[10px] text-zinc-500">
            ({totalFindings} findings)
          </span>
        </div>

        {/* Center / Right Titlebar Controls */}
        <div className="flex items-center h-full">
          {/* Dock back into sidebar button */}
          <button
            type="button"
            onClick={togglePopOutMode}
            className="px-2 py-1 mr-2 rounded text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex items-center gap-1"
            style={appRegion('no-drag')}
            title="Dock debugger back into the main IDE sidebar"
          >
            <Minimize2 size={12} />
            <span className="hidden sm:inline">Dock to Sidebar</span>
          </button>

          {/* Window Caption Buttons (Windows/Linux) */}
          {!isMac && (
            <div style={{ display: 'flex', height: '100%' }}>
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
      <div className="flex-1 overflow-hidden">
        <OmniDebugger isStandalone={true} />
      </div>
    </div>
  );
};
