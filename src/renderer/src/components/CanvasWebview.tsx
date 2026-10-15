import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Palette,
  RotateCcw,
  Maximize2,
  Minimize2,
  ExternalLink,
  Sparkles,
  Check,
  Compass
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';

interface CanvasWebviewProps {
  onExpandToggle?: (isExpanded: boolean) => void;
  isExpanded?: boolean;
}

export const CanvasWebview: React.FC<CanvasWebviewProps> = ({
  onExpandToggle,
  isExpanded: controlledExpanded
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;
  const [lastInjectedPrompt, setLastInjectedPrompt] = useState<string | null>(null);
  const [showInjectedToast, setShowInjectedToast] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const setDraftPrompt = useChatStore((state) => state.setDraftPrompt);

  // Path to static m3e-canvas index.html
  // Vite serves public assets from /m3e-canvas/index.html
  const canvasUrl = './m3e-canvas/index.html';

  // Handle incoming prompt export from m3e-canvas iframe
  const handlePromptExport = useCallback((promptText: string) => {
    if (!promptText || typeof promptText !== 'string') return;

    // 1. Pass generated prompt directly into chat-store to pre-fill input & focus
    setDraftPrompt(promptText);

    // 2. Also send over IPC if electronAPI bridge is available
    if (window.electronAPI?.sketcherSendPrompt) {
      window.electronAPI.sketcherSendPrompt(promptText).catch(() => {});
    }

    setLastInjectedPrompt(promptText);
    setShowInjectedToast(true);
    window.setTimeout(() => setShowInjectedToast(false), 3000);
  }, [setDraftPrompt]);

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // Validate origin / message structure
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'TY_CODE_PROMPT_EXPORT' && typeof event.data.prompt === 'string') {
          handlePromptExport(event.data.prompt);
        }
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [handlePromptExport]);

  // Reload iframe canvas
  const handleReload = () => {
    if (iframeRef.current) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = 'about:blank';
      window.setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = currentSrc;
      }, 50);
    }
  };

  const handleToggleExpand = () => {
    const next = !isExpanded;
    setInternalExpanded(next);
    onExpandToggle?.(next);
  };

  const handleOpenExternal = async () => {
    try {
      if (window.electronAPI?.openExternal) {
        // Resolve absolute or dev URL
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
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-primary, #121316)',
        color: 'var(--text-primary, #e5e7eb)',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Top Sketcher Header */}
      <div
        style={{
          height: '38px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          backgroundColor: '#18191f',
          borderBottom: '1px solid var(--border-subtle, #272a34)',
          flexShrink: 0,
          zIndex: 4
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Palette size={16} color="var(--accent-primary, #a855f7)" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#f3f4f6', whiteSpace: 'nowrap' }}>
            UI Sketcher
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#d8b4fe',
              fontWeight: 600,
              border: '1px solid rgba(168, 85, 247, 0.3)'
            }}
          >
            M3E
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={handleReload}
            title="Reload canvas"
            aria-label="Reload sketcher canvas"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <RotateCcw size={13} />
          </button>

          <button
            onClick={handleToggleExpand}
            title={isExpanded ? 'Restore sidebar width' : 'Expand canvas view'}
            aria-label={isExpanded ? 'Restore sidebar width' : 'Expand canvas view'}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            onClick={handleOpenExternal}
            title="Open canvas in browser"
            aria-label="Open canvas in external browser"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Floating Toast Notification when Prompt is Injected into Chat */}
      {showInjectedToast && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#10b981',
            color: '#ffffff',
            padding: '6px 14px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 10,
            animation: 'fadeIn 0.2s ease-in-out'
          }}
        >
          <Sparkles size={12} />
          <span>Prompt loaded into Ty-Code Chat Sidecar!</span>
        </div>
      )}

      {/* Embedded Iframe hosting the static M3E Canvas */}
      <div style={{ flex: 1, width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={canvasUrl}
          title="M3E Canvas UI Sketcher"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            backgroundColor: '#111216'
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      </div>

      {/* Bottom Status Bar */}
      <div
        style={{
          height: '24px',
          backgroundColor: '#15161c',
          borderTop: '1px solid var(--border-subtle, #272a34)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          fontSize: '10px',
          color: 'var(--text-muted, #6b7280)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
          <span>IPC Bridge Active</span>
        </div>
        <span>Click 'Send to Ty-Code Chat' in canvas</span>
      </div>
    </div>
  );
};
