import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Palette,
  RotateCcw,
  ExternalLink,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { M3ECanvas } from './canvas/M3ECanvas';
import { CanvasChatSidecar } from './canvas/CanvasChatSidecar';

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties =>
  ({ WebkitAppRegion: region } as React.CSSProperties);

// Custom purplish microchip logo matching Ty-Code design language
const TyCodeMicrochipLogo: React.FC<{ size?: number }> = ({ size = 16 }) => (
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
        <linearGradient id="sketcherChipGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="14" height="14" rx="2.5" stroke="url(#sketcherChipGrad)" strokeWidth="1.8" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" fill="url(#sketcherChipGrad)" fillOpacity="0.3" stroke="url(#sketcherChipGrad)" strokeWidth="1.2" />
      <path d="M8.5 2v3M12 2v3M15.5 2v3" stroke="url(#sketcherChipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.5 19v3M12 19v3M15.5 19v3" stroke="url(#sketcherChipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 8.5h3M2 12h3M2 15.5h3" stroke="url(#sketcherChipGrad)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M19 8.5h3M19 12h3M19 15.5h3" stroke="url(#sketcherChipGrad)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </div>
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

export const SketcherWindow: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [editorKey, setEditorKey] = useState(0);

  const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  // Listen to window maximize changes
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

  // Reload remounts the visual editor (re-pulls the shared snapshot).
  const handleReload = () => {
    setEditorKey((prev) => prev + 1);
  };

  const handleOpenExternal = async () => {
    try {
      if (window.electronAPI?.openExternal) {
        const fullUrl = window.location.origin + '/m3e-canvas/index.html';
        await window.electronAPI.openExternal(fullUrl);
      }
    } catch (err) {
      console.warn('Failed to open external canvas:', err);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#121316',
        color: '#e5e7eb',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Custom Title Bar matching Main Window Design */}
      <header
        style={{
          height: '34px',
          backgroundColor: '#18191e',
          borderBottom: '1px solid var(--border-subtle, #272a34)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMac ? '0 12px 0 78px' : '0 0 0 10px',
          userSelect: 'none',
          position: 'relative',
          zIndex: 50,
          flexShrink: 0,
          ...appRegion('drag')
        }}
      >
        {/* Left: Logo, Name, Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            height: '100%',
            ...appRegion('no-drag')
          }}
        >
          <TyCodeMicrochipLogo size={16} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f3f4f6', letterSpacing: '-0.2px' }}>
            Ty-Code
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(168, 85, 247, 0.16)',
              color: '#d8b4fe',
              fontWeight: 600,
              border: '1px solid rgba(168, 85, 247, 0.32)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Palette size={10} color="#c084fc" />
            UI Sketcher • M3E Canvas
          </span>
        </div>

        {/* Center: Window Title */}
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
            fontWeight: 500,
            whiteSpace: 'nowrap',
            maxWidth: '45vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          <span>Material 3 Expressive UI Sketcher</span>
        </div>

        {/* Right: Actions and Native Window Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            ...appRegion('no-drag')
          }}
        >
          {/* Reload Canvas Button */}
          <button
            onClick={handleReload}
            title="Reload Canvas"
            aria-label="Reload Canvas"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              cursor: 'pointer',
              padding: '5px 8px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '2px',
              transition: 'background-color 100ms ease, color 100ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
            }}
          >
            <RotateCcw size={13} />
          </button>

          {/* Open in Browser */}
          <button
            onClick={handleOpenExternal}
            title="Open Canvas in External Browser"
            aria-label="Open Canvas in External Browser"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              cursor: 'pointer',
              padding: '5px 8px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '6px',
              transition: 'background-color 100ms ease, color 100ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
            }}
          >
            <ExternalLink size={13} />
          </button>

          {/* Windows Caption Buttons */}
          {!isMac && (
            <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <WindowControlButton
                title="Minimize"
                onClick={() => window.electronAPI?.minimizeWindow?.()}
              >
                <MinimizeIcon />
              </WindowControlButton>
              <WindowControlButton
                title={isMaximized ? 'Restore' : 'Maximize'}
                onClick={() => window.electronAPI?.maximizeWindow?.()}
              >
                {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
              </WindowControlButton>
              <WindowControlButton
                title="Close"
                isClose
                onClick={() => window.electronAPI?.closeWindow?.()}
              >
                <CloseIcon />
              </WindowControlButton>
            </div>
          )}
        </div>
      </header>

      {/* Floating Toast Notification when Prompt is Sent */}
      {showToast && (
        <div
          style={{
            position: 'absolute',
            top: '46px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#10b981',
            color: '#ffffff',
            padding: '7px 18px',
            borderRadius: '999px',
            fontSize: '11.5px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease-in-out'
          }}
        >
          <Sparkles size={13} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Body: Visual Editor (3-pane M3E Canvas) + Shared Chat Rail */}
      <div style={{ flex: 1, width: '100%', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <M3ECanvas key={editorKey} />

        <CanvasChatSidecar />
      </div>

      {/* Bottom Status Bar */}
      <footer
        style={{
          height: '24px',
          backgroundColor: '#15161c',
          borderTop: '1px solid var(--border-subtle, #272a34)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '11px',
          color: 'var(--text-secondary, #94a3b8)',
          flexShrink: 0,
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)'
            }}
          />
          <span style={{ fontWeight: 500, color: '#e5e7eb' }}>IPC Bridge Active</span>
          <span style={{ color: '#6b7280' }}>•</span>
          <span style={{ color: '#9ca3af' }}>Synced with main IDE chat sidecar</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px' }}>
          <span>Click <strong style={{ color: '#d8b4fe' }}>Send to Ty-Code Chat</strong> in the canvas toolbar</span>
        </div>
      </footer>
    </div>
  );
};
