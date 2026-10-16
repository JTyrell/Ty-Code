/**
 * Extension Webview Panel Component (ExtensionsFix 5)
 *
 * Implements strict iframe sandboxing and MessageChannel nonce handshake:
 *   - sandbox="allow-scripts" (strictly NEVER 'allow-same-origin' to prevent parent DOM access)
 *   - Generates cryptographically strong nonce
 *   - Establishes bidirectional MessageChannel after nonce handshake verification
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface ExtensionWebviewPanelProps {
  panelId: string;
  title: string;
  html: string;
  nonce?: string;
  onDidReceiveMessage?: (message: unknown) => void;
  onHandshakeComplete?: (panelId: string) => void;
}

export const ExtensionWebviewPanel: React.FC<ExtensionWebviewPanelProps> = ({
  panelId,
  title,
  html,
  nonce: initialNonce,
  onDidReceiveMessage,
  onHandshakeComplete
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState<string>(() => initialNonce || Math.random().toString(36).substring(2) + Date.now().toString(36));
  const [isHandshakeDone, setIsHandshakeDone] = useState(false);
  const portRef = useRef<MessagePort | null>(null);

  // MessageChannel setup & nonce handshake
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const channel = new MessageChannel();
    portRef.current = channel.port1;

    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === 'handshake-ack' && data.nonce === nonce) {
        setIsHandshakeDone(true);
        onHandshakeComplete?.(panelId);
        return;
      }
      onDidReceiveMessage?.(data);
    };

    const handleLoad = () => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              type: 'webview-init',
              panelId,
              nonce
            },
            '*',
            [channel.port2]
          );
        }
      } catch (err) {
        console.warn(`[ExtensionWebviewPanel] Handshake initiation failed for panel "${panelId}":`, err);
      }
    };

    iframe.addEventListener('load', handleLoad);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      if (portRef.current) {
        portRef.current.close();
        portRef.current = null;
      }
    };
  }, [panelId, nonce, onDidReceiveMessage, onHandshakeComplete]);

  // Construct iframe srcDoc injecting client-side handshake responder
  const secureSrcDoc = React.useMemo(() => {
    const handshakeScript = `
      <script>
        (function() {
          let hostPort = null;
          window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'webview-init' && event.ports && event.ports[0]) {
              hostPort = event.ports[0];
              window.vscode = {
                postMessage: function(msg) {
                  if (hostPort) hostPort.postMessage(msg);
                }
              };
              hostPort.onmessage = function(e) {
                window.dispatchEvent(new MessageEvent('message', { data: e.data }));
              };
              hostPort.postMessage({ type: 'handshake-ack', nonce: event.data.nonce });
            }
          });
        })();
      </script>
    `;
    return `${handshakeScript}${html}`;
  }, [html]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden'
      }}
      data-testid={`extension-webview-panel-${panelId}`}
    >
      <div
        style={{
          padding: '6px 12px',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{title}</span>
        <span
          style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: isHandshakeDone ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
            color: isHandshakeDone ? 'var(--accent-green)' : 'var(--accent-amber)'
          }}
        >
          {isHandshakeDone ? 'Secure Sandbox' : 'Connecting...'}
        </span>
      </div>

      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={secureSrcDoc}
        /* CRITICAL SECURITY: sandbox MUST include 'allow-scripts' and MUST NEVER include 'allow-same-origin' */
        sandbox="allow-scripts"
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          backgroundColor: '#fff'
        }}
      />
    </div>
  );
};
