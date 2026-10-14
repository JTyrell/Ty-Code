import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Sparkles,
  Trash2,
  ChevronRight,
  ChevronDown,
  Terminal,
  FileCode,
  Check,
  Eye,
  AlertCircle
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import type { ChatMessage, ToolCall, ProposedDiff } from '../../../preload/types';

interface ToolCardProps {
  tool: ToolCall;
  output?: string;
  isError?: boolean;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, output, isError }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-card">
      <div
        className="tool-header"
        onClick={() => setExpanded(!expanded)}
        style={{ color: isError ? 'var(--accent-red)' : 'var(--text-primary)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={12} color="var(--accent-primary)" />
          <strong>{tool.name}</strong>
          <span style={{ color: 'var(--text-muted)' }}>
            ({Object.keys(tool.arguments || {}).length} args)
          </span>
        </div>
        {output && (
          <span style={{ fontSize: '10px', color: isError ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {isError ? 'Failed' : 'Success'}
          </span>
        )}
      </div>

      {expanded && (
        <div className="tool-body">
          <div style={{ marginBottom: '6px', color: 'var(--accent-cyan)' }}>
            <strong>Input:</strong> {JSON.stringify(tool.arguments, null, 2)}
          </div>
          {output && (
            <div>
              <strong style={{ color: isError ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                Output:
              </strong>
              <div style={{ marginTop: '4px' }}>{output}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChatSidecar: React.FC = () => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isRunning,
    currentStatus,
    currentThought,
    streamingText,
    sendMessage,
    stopTask,
    clearChat
  } = useChatStore();

  const { workspacePath, activeTabPath, openTabs, openDiffReview, applyDiff } = useWorkspaceStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, currentThought, currentStatus]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isRunning) return;

    const promptText = input.trim();
    setInput('');

    sendMessage(
      promptText,
      workspacePath,
      activeTab?.path,
      activeTab?.content
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        width: '380px',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Sidecar Header */}
      <div
        style={{
          height: '35px',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={14} color="var(--accent-primary)" />
          <span style={{ color: 'var(--text-primary)' }}>Assistant Sidecar</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {currentStatus && (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--accent-primary)',
                background: 'rgba(139, 92, 246, 0.1)',
                padding: '2px 6px',
                borderRadius: '4px'
              }}
              className="animate-pulse"
            >
              {currentStatus}
            </span>
          )}
          <button onClick={clearChat} title="Clear Chat History" style={{ padding: '3px' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Message History Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && !streamingText && (
          <div
            style={{
              padding: '30px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <Sparkles size={32} color="var(--border-strong)" />
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              How can Ty-Claude help you today?
            </div>
            <div style={{ fontSize: '11px', lineHeight: 1.6, maxWidth: '280px' }}>
              Ask to explore the workspace, implement features, fix bugs, or run test suites.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
            }}
          >
            {msg.role === 'user' ? (
              <div
                style={{
                  maxWidth: '88%',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '8px 8px 0 8px',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {msg.content}
              </div>
            ) : msg.role === 'tool' ? (
              <div style={{ width: '100%' }}>
                {msg.toolResult && (
                  <ToolCard
                    tool={{
                      id: msg.toolResult.toolCallId,
                      name: msg.toolResult.name,
                      arguments: {}
                    }}
                    output={msg.toolResult.output}
                    isError={msg.toolResult.isError}
                  />
                )}
              </div>
            ) : (
              <div
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  padding: '10px 12px',
                  borderRadius: '0 8px 8px 8px',
                  fontSize: '12px',
                  lineHeight: 1.6,
                  wordBreak: 'break-word'
                }}
              >
                {/* Tool calls badges */}
                {msg.toolCalls?.map((tc) => (
                  <ToolCard key={tc.id} tool={tc} />
                ))}

                {/* Diff proposal card */}
                {msg.proposedDiffs?.map((diff) => (
                  <div key={diff.id} className="diff-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '11px' }}>
                        <FileCode size={13} color="var(--accent-primary)" />
                        <span>{diff.filePath}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--accent-green)' }}>Ready to Apply</span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button
                        onClick={() => openDiffReview(diff)}
                        style={{
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          padding: '4px 8px',
                          fontSize: '11px',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <Eye size={12} />
                        <span>Inspect Diff</span>
                      </button>
                      <button
                        onClick={() => applyDiff(diff)}
                        style={{
                          backgroundColor: 'var(--accent-green)',
                          color: '#fff',
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 500
                        }}
                      >
                        <Check size={12} />
                        <span>Apply</span>
                      </button>
                    </div>
                  </div>
                ))}

                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              </div>
            )}
          </div>
        ))}

        {/* Live streaming message */}
        {streamingText && (
          <div
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              padding: '10px 12px',
              borderRadius: '0 8px 8px 8px',
              fontSize: '12px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {streamingText}
          </div>
        )}

        {/* DeepSeek Reasoning Thoughts */}
        {currentThought && (
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: 'rgba(6, 182, 212, 0.05)',
              borderLeft: '2px solid var(--accent-cyan)',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              fontStyle: 'italic',
              whiteSpace: 'pre-wrap'
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--accent-cyan)' }}>
              Reasoning Process:
            </div>
            {currentThought}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '10px',
          backgroundColor: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ position: 'relative' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Ty-Claude (Enter to send, Shift+Enter for newline)..."
            rows={3}
            style={{
              width: '100%',
              resize: 'none',
              fontSize: '12px',
              paddingRight: '40px',
              backgroundColor: 'var(--bg-tertiary)',
              borderColor: 'var(--border-subtle)'
            }}
          />

          <div style={{ position: 'absolute', right: '8px', bottom: '10px' }}>
            {isRunning ? (
              <button
                type="button"
                onClick={stopTask}
                style={{
                  backgroundColor: 'var(--accent-red)',
                  color: '#fff',
                  width: '28px',
                  height: '28px',
                  borderRadius: '4px'
                }}
                title="Stop Agent"
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                style={{
                  backgroundColor: input.trim() ? 'var(--accent-primary)' : 'var(--bg-hover)',
                  color: '#ffffff',
                  width: '28px',
                  height: '28px',
                  borderRadius: '4px'
                }}
                title="Send Message"
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
