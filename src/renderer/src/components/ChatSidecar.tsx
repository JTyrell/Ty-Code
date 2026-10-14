import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
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
  AlertCircle,
  Copy,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import type { ChatMessage, ToolCall, ProposedDiff } from '../../../preload/types';

interface CodeBlockProps {
  language?: string;
  value: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        backgroundColor: '#0d0e11'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          backgroundColor: 'var(--bg-tertiary)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span>{language || 'text'}</span>
        <button
          onClick={handleCopy}
          style={{
            padding: '2px 6px',
            fontSize: '10px',
            color: copied ? 'var(--accent-green)' : 'var(--text-secondary)'
          }}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={11} color="var(--accent-green)" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <pre
        style={{
          margin: 0,
          padding: '10px',
          fontSize: '11px',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: 1.45,
          overflowX: 'auto',
          color: '#e2e8f0',
          whiteSpace: 'pre'
        }}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
};

interface ToolCardProps {
  tool: ToolCall;
  output?: string;
  isError?: boolean;
  isRunning?: boolean;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, output, isError, isRunning }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-card">
      <div
        className="tool-header"
        onClick={() => setExpanded(!expanded)}
        style={{
          color: isError ? 'var(--accent-red)' : isRunning ? 'var(--accent-primary)' : 'var(--text-primary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={12} color="var(--accent-primary)" />
          <strong>{tool.name}</strong>
          <span style={{ color: 'var(--text-muted)' }}>
            ({Object.keys(tool.arguments || {}).length} args)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isRunning ? (
            <span style={{ fontSize: '10px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} className="animate-spin" />
              <span>Running</span>
            </span>
          ) : output ? (
            <span style={{ fontSize: '10px', color: isError ? 'var(--accent-red)' : 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isError ? <AlertCircle size={11} /> : <Check size={11} />}
              <span>{isError ? 'Failed' : 'Success'}</span>
            </span>
          ) : null}
        </div>
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
  const feedRef = useRef<HTMLDivElement>(null);
  const userAtBottomRef = useRef(true);

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

  // Monitor user scrolling: if user scrolled up, do not force-scroll down
  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    userAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 60;
  };

  useEffect(() => {
    if (userAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, currentThought, currentStatus]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isRunning) return;

    const promptText = input.trim();
    setInput('');
    userAtBottomRef.current = true;

    sendMessage(
      promptText,
      workspacePath,
      activeTab?.path,
      activeTab?.content
    );
  };

  const handleRegenerate = () => {
    if (isRunning) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      userAtBottomRef.current = true;
      sendMessage(
        lastUserMsg.content,
        workspacePath,
        activeTab?.path,
        activeTab?.content
      );
    }
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
        width: '100%',
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
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Loader2 size={10} className="animate-spin" />
              <span>{currentStatus}</span>
            </span>
          )}
          <button onClick={clearChat} title="Clear Chat History" style={{ padding: '3px' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Message History Feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
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

        {messages.map((msg, idx) => (
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

                {/* Render Markdown Response */}
                <div style={{ lineHeight: 1.5 }}>
                  <ReactMarkdown
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeText = String(children).replace(/\n$/, '');
                        const isBlock = match || codeText.includes('\n');

                        if (isBlock) {
                          return <CodeBlock language={match?.[1]} value={codeText} />;
                        }
                        return (
                          <code
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.08)',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              color: 'var(--accent-cyan)'
                            }}
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>

                {/* Regenerate Button if Last Assistant Message */}
                {idx === messages.length - 1 && !isRunning && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                      onClick={handleRegenerate}
                      style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        color: 'var(--text-secondary)'
                      }}
                      title="Regenerate last response"
                    >
                      <RotateCcw size={11} />
                      <span>Regenerate</span>
                    </button>
                  </div>
                )}
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
              wordBreak: 'break-word'
            }}
          >
            <ReactMarkdown
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeText = String(children).replace(/\n$/, '');
                  const isBlock = match || codeText.includes('\n');
                  if (isBlock) {
                    return <CodeBlock language={match?.[1]} value={codeText} />;
                  }
                  return (
                    <code
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        padding: '2px 5px',
                        borderRadius: '4px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'var(--accent-cyan)'
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
              }}
            >
              {streamingText}
            </ReactMarkdown>
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
              Reasoning Process (DeepSeek R1):
            </div>
            {currentThought}
          </div>
        )}

        {/* Typing indicator while waiting for first token */}
        {isRunning && !streamingText && !currentThought && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              color: 'var(--text-muted)',
              fontSize: '11px'
            }}
          >
            <Loader2 size={12} className="animate-spin" color="var(--accent-primary)" />
            <span>Ty-Claude is thinking...</span>
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
