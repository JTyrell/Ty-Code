/**
 * Canvas Chat Sidecar (M3E Canvas overhaul, Step 4)
 *
 * Chat UI for the Canvas window, mirroring the main IDE sidecar's styling.
 * Messages route through `sendCanvasChatMessage` (IPC `canvas:chat-send`) to
 * the canvas agent engine in the main process. Tokens stream back over
 * `canvas:agent-event`; when generation completes and the canvas updates, the
 * engine notifies the main window chat (`canvas:main-chat-update`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Palette, Send, Sparkles } from 'lucide-react';
import { serializeCanvasNode, useCanvasStore } from '../../state/canvas-store';

interface SidecarMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface CanvasChatSidecarProps {
  onCanvasFocus?: () => void;
}

export const CanvasChatSidecar: React.FC<CanvasChatSidecarProps> = ({ onCanvasFocus }) => {
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activePlatform, setActivePlatform] = useState<string>('react');
  const [streamingText, setStreamingText] = useState('');
  const [currentStatus, setCurrentStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; language: string } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);

  const appendMessage = useCallback((message: SidecarMessage) => {
    if (seenMessageIdsRef.current.has(message.id)) return;
    seenMessageIdsRef.current.add(message.id);
    setMessages((prev) => [...prev, message]);
  }, []);

  // Shared-state bootstrap: pull snapshot, subscribe to platform + message sync
  useEffect(() => {
    void window.electronAPI?.canvasRequestState?.()
      .then((res) => {
        if (!res?.success || !res.data) return;
        setActivePlatform(res.data.activePlatform);
        for (const message of res.data.sharedConversationHistory || []) {
          if (message.role === 'user' || message.role === 'assistant') {
            appendMessage(message as unknown as SidecarMessage);
          }
        }
      })
      .catch(() => {});

    const unsubState = window.electronAPI?.onCanvasStateSynced?.((snapshot) => {
      const data = snapshot as { activePlatform?: string } | null;
      if (data?.activePlatform) setActivePlatform(data.activePlatform);
    });
    const unsubMessages = window.electronAPI?.onCanvasMessageSynced?.((incoming) => {
      const message = (incoming as { id?: string; role?: string; content?: string; timestamp?: number }) || {};
      if (message.role !== 'user' && message.role !== 'assistant') return;
      appendMessage({
        id: message.id || `canvas_external_${message.timestamp || Date.now()}`,
        role: message.role as 'user' | 'assistant',
        content: message.content as string,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now()
      });
    });
    return () => {
      unsubState?.();
      unsubMessages?.();
    };
  }, [appendMessage]);

  // Streaming agent events (tokens / status / done / error)
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCanvasAgentEvent?.((event) => {
      const data = (event as { type?: string; content?: string } | null) || {};
      switch (data.type) {
        case 'token':
          if (data.content) setStreamingText((prev) => prev + data.content);
          break;
        case 'status':
          setCurrentStatus(data.content || '');
          break;
        case 'done':
          setStreamingText('');
          setCurrentStatus('');
          setIsGenerating(false);
          break;
        case 'error':
          setStreamingText('');
          setCurrentStatus(data.content || 'Generation failed.');
          setIsGenerating(false);
          break;
        default:
          break;
      }
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const element = feedRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streamingText]);

  const handleSend = useCallback(() => {
    const prompt = chatInput.trim();
    if (!prompt || isGenerating) return;

    const localId = `canvas_${globalThis.crypto.randomUUID()}`;
    setIsGenerating(true);
    setStreamingText('');
    setCurrentStatus('Routing to canvas agent…');
    setShowCode(false);

    // Push into the shared history; main window's sidecar appends it too.
    if (window.electronAPI?.canvasSyncMessage) {
      window.electronAPI
        .canvasSyncMessage({ message: { id: localId, role: 'user', content: prompt, timestamp: Date.now(), origin: 'canvas' } })
        .catch((err: unknown) => console.warn('Failed to sync canvas message:', err));
    }
    appendMessage({ id: localId, role: 'user', content: prompt, timestamp: Date.now() });
    setChatInput('');

    const sender = window.electronAPI?.canvasChatSend
      ? window.electronAPI.canvasChatSend({
          prompt,
          currentCanvasState: {
            activePlatform: activePlatform as CanvasChatSendPlatform,
            canvasComponents: useCanvasStore.getState().nodes.map((node) => serializeCanvasNode(node) as never)
          }
        })
      : window.electronAPI?.canvasAgentGenerate
        ? window.electronAPI.canvasAgentGenerate(prompt)
        : Promise.resolve(null);

    void sender
      .then((res) => {
        if (res?.success && res.data) {
          if (res.data.code) setGeneratedCode({ code: res.data.code, language: res.data.language || 'tsx' });
        } else if (res && !res.success) {
          setCurrentStatus(res.error || 'Generation failed.');
        }
      })
      .catch((err: unknown) => {
        console.warn('Canvas generation errored:', err);
        setCurrentStatus(err instanceof Error ? err.message : String(err));
        setIsGenerating(false);
      });
  }, [chatInput, isGenerating, activePlatform, appendMessage]);

  return (
    <aside
      style={{
        width: '285px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--border-subtle, #272a34)',
        backgroundColor: '#15161c',
        minHeight: 0
      }}
      aria-label="Canvas chat sidecar"
    >
      <div
        style={{
          height: '36px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: '1px solid #272a34',
          backgroundColor: '#18191e'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <Sparkles size={13} color="#c084fc" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#e5e7eb' }}>Canvas Chat</span>
          <span
            style={{
              fontSize: '9px',
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(168, 85, 247, 0.16)',
              color: '#d8b4fe',
              fontWeight: 600,
              border: '1px solid rgba(168, 85, 247, 0.3)',
              whiteSpace: 'nowrap'
            }}
          >
            {activePlatform}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            type="button"
            onClick={() => setShowCode((prev) => !prev)}
            disabled={!generatedCode}
            title="Toggle the Code Preview tab"
            style={{
              padding: '2px 7px',
              borderRadius: 5,
              background: showCode && generatedCode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${showCode && generatedCode ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
              color: generatedCode ? '#e9d5ff' : '#6b7280',
              fontSize: '9.5px',
              fontWeight: 700,
              cursor: generatedCode ? 'pointer' : 'default'
            }}
          >
            {'</> Code'}
          </button>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: isGenerating ? '#f59e0b' : '#10b981',
              boxShadow: isGenerating ? '0 0 6px rgba(245, 158, 11, 0.6)' : '0 0 6px rgba(16, 185, 129, 0.6)'
            }}
          />
        </div>
      </div>

      <div
        ref={feedRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          minHeight: 0
        }}
      >
        {showCode && generatedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'rgba(168, 85, 247, 0.2)',
                  color: '#d8b4fe',
                  fontWeight: 700
                }}
              >
                {generatedCode.language}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(generatedCode.code)
                    .then(() => {
                      setCodeCopied(true);
                      window.setTimeout(() => setCodeCopied(false), 2000);
                    })
                    .catch((err: unknown) => console.warn('Copy failed:', err));
                }}
                style={{
                  marginLeft: 'auto',
                  padding: '2px 7px',
                  borderRadius: 5,
                  background: 'rgba(255, 255, 255, 0.07)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: codeCopied ? '#34d399' : '#cbd5e1',
                  fontSize: '9.5px',
                  cursor: 'pointer'
                }}
              >
                {codeCopied ? 'Copied' : 'Copy code'}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                padding: 8,
                borderRadius: 7,
                background: '#14151b',
                border: '1px solid #272a34',
                color: '#9fd6c4',
                fontSize: '9.5px',
                lineHeight: 1.5,
                whiteSpace: 'pre'
              }}
            >
              {generatedCode.code}
            </pre>
          </div>
        ) : (
          <>
            {messages.length === 0 && !streamingText ? (
              <div
                style={{
                  fontSize: '10.5px',
                  color: '#6b7280',
                  textAlign: 'center',
                  padding: '18px 6px',
                  lineHeight: 1.5
                }}
              >
                This chat shares history with the main IDE sidecar.
                <br />
                Describe a UI change and the canvas updates live.
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '6px 9px',
                  borderRadius: message.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                  backgroundColor: message.role === 'user' ? 'rgba(168, 85, 247, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                  border: message.role === 'user' ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#e5e7eb',
                  fontSize: '10.5px',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '220px',
                  overflowY: 'auto'
                }}
                title={message.content}
              >
                {message.content.length > 400 ? `${message.content.slice(0, 400)}…` : message.content}
              </div>
            ))}
            {streamingText ? (
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '92%',
                  padding: '6px 9px',
                  borderRadius: '10px 10px 10px 3px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  color: '#c4b5fd',
                  fontSize: '10.5px',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '220px',
                  overflowY: 'auto'
                }}
              >
                <Palette size={10} color="#c084fc" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
                {streamingText.length > 400 ? `${streamingText.slice(-400)}` : streamingText}
                <span style={{ opacity: 0.6 }}>▍</span>
              </div>
            ) : currentStatus ? (
              <div style={{ fontSize: '9.5px', color: currentStatus.includes('failed') ? '#f87171' : '#94a3b8', padding: '2px 4px' }}>
                {currentStatus}
              </div>
            ) : null}
            {onCanvasFocus && generatedCode ? (
              <button
                type="button"
                onClick={onCanvasFocus}
                style={{
                  alignSelf: 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 9px',
                  borderRadius: 6,
                  background: 'rgba(168, 85, 247, 0.15)',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  color: '#d8b4fe',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <ExternalLink size={10} />
                View in Canvas
              </button>
            ) : null}
          </>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: '6px',
          padding: '8px 10px',
          borderTop: '1px solid #272a34',
          backgroundColor: '#18191e'
        }}
      >
        <input
          type="text"
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder={isGenerating ? 'Generating UI…' : 'Make the submit button blue and larger…'}
          aria-label="Canvas chat message"
          disabled={isGenerating && !streamingText}
          style={{
            flex: 1,
            minWidth: 0,
            background: '#1f212a',
            border: '1px solid #2d313d',
            borderRadius: '7px',
            color: '#e5e7eb',
            fontSize: '11px',
            padding: '7px 9px',
            outline: 'none'
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          title="Send to canvas agent"
          aria-label="Send to canvas agent"
          disabled={!chatInput.trim() || isGenerating}
          style={{
            flexShrink: 0,
            background: '#a855f7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '7px',
            padding: '7px 11px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: chatInput.trim() && !isGenerating ? 'pointer' : 'default',
            opacity: chatInput.trim() && !isGenerating ? 1 : 0.45
          }}
        >
          <Send size={12} />
        </button>
      </div>

      {generatedCode ? (
        <button
          type="button"
          onClick={() => setShowCode(true)}
          title="Open the Code Preview tab"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderTop: '1px solid #272a34',
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            fontSize: '10px',
            cursor: 'pointer'
          }}
        >
          <Copy size={10} />
          Last generated {generatedCode.language} code available
        </button>
      ) : null}
    </aside>
  );
};

type CanvasChatSendPlatform = 'react' | 'flutter' | 'swiftui' | 'web' | 'other';

export default CanvasChatSidecar;
