import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import {
  Sparkles,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileCode,
  FileText,
  Search,
  Folder,
  Wrench,
  AlertCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Eye,
  Info,
  Clock,
  Zap,
  Bot,
  User,
  Presentation
} from 'lucide-react';
import type { ChatMessage, ProposedDiff, ToolExecutionRecord } from '../../../preload/types';
import { ChatErrorCard } from './ChatErrorCard';

// ---------------------------------------------------------------------------
// Syntax Highlighting setup
// ---------------------------------------------------------------------------
const languages: Record<string, LanguageFn> = {
  bash, shell: bash, sh: bash,
  css,
  diff,
  html: xml, xml,
  js: javascript, javascript, jsx: javascript,
  json,
  md: markdown, markdown,
  powershell, ps1: powershell,
  py: python, python,
  ts: typescript, tsx: typescript, typescript,
  yaml, yml: yaml
};
for (const [name, language] of Object.entries(languages)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}

// ---------------------------------------------------------------------------
// Shared theme-variable style helpers (styles must follow every theme)
// ---------------------------------------------------------------------------
const CODE_SHELF_BG = '#0d0e11';
const CODE_SHELF_HEAD_BG = 'rgba(255, 255, 255, 0.03)';

const codeShelf: React.CSSProperties = {
  margin: '10px 0',
  borderRadius: '10px',
  border: '1px solid var(--border-strong)',
  background: CODE_SHELF_BG,
  overflow: 'hidden',
  fontSize: '11px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)'
};

const codeShelfHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 10px',
  background: CODE_SHELF_HEAD_BG,
  borderBottom: '1px solid var(--border-strong)',
  fontSize: '11px',
  color: 'var(--text-muted)'
};

const codeShelfLang: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10.5px',
  color: 'var(--text-muted)',
  letterSpacing: '0.02em'
};

const codeShelfCopy: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 7px',
  borderRadius: '5px',
  fontSize: '10.5px',
  color: 'var(--text-muted)',
  background: 'transparent',
  border: '1px solid transparent',
  cursor: 'pointer'
};

const codeShelfPre: React.CSSProperties = {
  margin: 0,
  padding: '12px',
  overflowX: 'auto',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  lineHeight: 1.6,
  fontSize: '11.5px',
  userSelect: 'text'
  // note: no bg on pre; the dark shelf bg stays constant in all themes so the
  // global hljs token palette remains legible in light pastel themes too
};

// ---------------------------------------------------------------------------
// Code Block with Copy
// ---------------------------------------------------------------------------
interface CodeBlockProps {
  language?: string;
  value: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language?.toLowerCase() || '';
  const highlightLanguage = languages[normalizedLanguage] ? normalizedLanguage : '';
  const highlighted = useMemo(
    () =>
      highlightLanguage
        ? hljs.highlight(value, { language: highlightLanguage }).value
        : hljs.highlightAuto(value).value,
    [highlightLanguage, value]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={codeShelf}>
      <div style={codeShelfHeader}>
        <span style={codeShelfLang}>{language || 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          style={codeShelfCopy}
          title="Copy code block"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--surface-3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = copied ? 'var(--accent-green)' : 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {copied ? (
            <>
              <Check size={11} style={{ color: 'var(--accent-green)' }} />
              <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Copied</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre style={codeShelfPre}>
        <code
          className={`hljs${highlightLanguage ? ` language-${highlightLanguage}` : ''}`}
          style={{ background: 'transparent' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
};

const markdownComponents: Components = {
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/.exec(className || '')?.[1];
    const value = String(children).replace(/\n$/, '');
    if (language || value.includes('\n')) {
      return <CodeBlock language={language} value={value} />;
    }
    return (
      <code
        style={{
          padding: '1px 6px',
          borderRadius: '5px',
          background: 'var(--surface-3)',
          color: 'var(--accent-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px'
        }}
        {...props}
      >
        {children}
      </code>
    );
  }
};

// ---------------------------------------------------------------------------
// Tool Execution Block (Compact & Collapsible)
// ---------------------------------------------------------------------------
interface ToolBlockProps {
  tool: ToolExecutionRecord;
}

const ToolExecutionBlock: React.FC<ToolBlockProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isFailed = tool.status === 'error' || tool.isError;
  const isRunning = tool.status === 'running';
  const isSuccess = tool.status === 'success' && !tool.isError;

  const argCount = Object.keys(tool.arguments || {}).length;

  const statusColor = isFailed ? 'var(--accent-red)' : isRunning ? 'var(--accent-blue)' : 'var(--accent-green)';

  const getToolIcon = (name: string) => {
    const lower = name.toLowerCase();
    const iconStyle = { color: 'var(--accent-cyan)', flexShrink: 0 } as const;
    if (lower.includes('grep') || lower.includes('search')) return <Search size={13} style={{ ...iconStyle, color: 'var(--accent-primary)' }} />;
    if (lower.includes('read') || lower.includes('view')) return <FileText size={13} style={iconStyle} />;
    if (lower.includes('write') || lower.includes('replace') || lower.includes('edit')) return <FileCode size={13} style={{ ...iconStyle, color: 'var(--accent-green)' }} />;
    if (lower.includes('command') || lower.includes('terminal') || lower.includes('bash')) return <Terminal size={13} style={{ ...iconStyle, color: 'var(--accent-amber)' }} />;
    if (lower.includes('dir') || lower.includes('tree') || lower.includes('folder')) return <Folder size={13} style={{ ...iconStyle, color: 'var(--accent-blue)' }} />;
    if (lower.includes('presentation')) return <Presentation size={13} style={{ ...iconStyle, color: 'var(--accent-primary)' }} />;
    return <Wrench size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />;
  };

  const handleCopyOutput = () => {
    if (tool.output) {
      navigator.clipboard.writeText(tool.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      style={{
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${statusColor}`,
        background: 'var(--bg-secondary)',
        transition: 'all 0.18s ease',
        margin: '5px 0',
        overflow: 'hidden',
        fontSize: '11px'
      }}
    >
      {/* Header Button: Click to toggle arguments and output */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          textAlign: 'left',
          userSelect: 'none',
          cursor: 'pointer',
          background: 'transparent'
        }}
        aria-expanded={expanded}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {getToolIcon(tool.name)}
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11.5px' }}>
            {tool.name}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            ({argCount} {argCount === 1 ? 'arg' : 'args'})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
          {isRunning && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 600 }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Running</span>
            </span>
          )}
          {isSuccess && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>
              <Check size={11} />
              <span>Success</span>
            </span>
          )}
          {isFailed && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-red)', fontWeight: 700 }}>
              <XCircle size={11} />
              <span>Failed</span>
            </span>
          )}
          {tool.status === 'cancelled' && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stopped</span>
          )}
        </div>
      </button>

      {/* Collapsible Details: Arguments and Output (Collapsed by Default) */}
      {expanded && (
        <div style={{ padding: '6px 12px 10px', paddingTop: 6, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface-2)', fontSize: '11px' }}>
          {/* Arguments */}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Input Arguments
              </div>
              <pre style={{ margin: 0, padding: '8px', borderRadius: '8px', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '10.5px', maxHeight: '144px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {tool.output !== undefined && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>
                <span style={{ color: isFailed ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                  {isFailed ? 'Error Output' : 'Result Output'}
                </span>
                <button
                  type="button"
                  onClick={handleCopyOutput}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  {copied ? <Check size={10} style={{ color: 'var(--accent-green)' }} /> : <Copy size={10} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre style={{ margin: 0, padding: '8px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '10.5px', maxHeight: '192px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', ...(isFailed ? { background: 'var(--accent-red)', color: '#ffffff', opacity: 0.92 } : { background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }) }}>
                {tool.output || '(No output produced)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Diff Inspection Card
// ---------------------------------------------------------------------------
const DiffCard: React.FC<{
  diff: ProposedDiff;
  onInspect?: () => void;
  onApply?: () => void;
}> = ({ diff, onInspect, onApply }) => {
  return (
    <div style={{
      margin: '8px 0',
      borderRadius: '10px',
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
      padding: '10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      fontSize: '11px',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <FileCode size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{diff.filePath}</span>
        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '5px', background: 'var(--surface-2)', color: 'var(--accent-amber)', border: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          Ready to review
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {onInspect && (
          <button
            type="button"
            onClick={onInspect}
            style={{ padding: '4px 8px', borderRadius: '6px', background: 'var(--surface-3)', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border-subtle)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <Eye size={11} />
            <span>Inspect</span>
          </button>
        )}
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            style={{ padding: '4px 8px', borderRadius: '6px', background: 'var(--accent-green)', color: '#ffffff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
          >
            <Check size={11} />
            <span>Apply</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main ChatMessage Component
// ---------------------------------------------------------------------------
export interface ChatMessageProps {
  message: ChatMessage;
  isLastAssistant?: boolean;
  isRunning?: boolean;
  currentStatus?: string;
  contextTokens?: number;
  onRegenerate?: () => void;
  onInspectDiff?: (diff: ProposedDiff) => void;
  onApplyDiff?: (diff: ProposedDiff) => void;
  onRetryError?: () => void;
}

export const ChatMessageItem: React.FC<ChatMessageProps> = ({
  message,
  isLastAssistant = false,
  isRunning = false,
  currentStatus,
  onRegenerate,
  onInspectDiff,
  onApplyDiff,
  onRetryError
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  // Agent Activity panel: thinking, tool/command use and harness notices live
  // here, collapsed by default so the main response stays focused.
  const [activityOpen, setActivityOpen] = useState(false);
  const wasRunningRef = useRef(false);

  const isAssistant = message.role === 'assistant';
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // Normalize tools: extract from toolExecutions or legacy toolCall/toolCalls
  const toolList: ToolExecutionRecord[] = useMemo(() => {
    if (message.toolExecutions && message.toolExecutions.length > 0) {
      return message.toolExecutions;
    }
    const list: ToolExecutionRecord[] = [];
    if (message.toolCall) {
      list.push({
        id: message.toolCall.id,
        name: message.toolCall.name,
        arguments: message.toolCall.arguments,
        status: message.toolStatus || 'success',
        output: message.toolResult?.output ?? (message.role === 'tool' ? message.content : undefined),
        isError: message.toolResult?.isError
      });
    }
    if (message.toolCalls) {
      message.toolCalls.forEach((t) => {
        list.push({
          id: t.id,
          name: t.name,
          arguments: t.arguments,
          status: 'success'
        });
      });
    }
    return list;
  }, [message]);

  const isThinking =
    isAssistant &&
    isLastAssistant &&
    isRunning &&
    (Boolean(currentStatus) ||
      Boolean(message.statusText) ||
      !message.content ||
      toolList.some((t) => t.status === 'running'));

  const thinkingLabel = useMemo(() => {
    if (message.statusText) return message.statusText;
    if (currentStatus) return currentStatus;
    const runningTool = toolList.find((t) => t.status === 'running');
    if (runningTool) return `Running ${runningTool.name}…`;
    if (!message.content) return 'Analyzing workspace…';
    return 'Thinking…';
  }, [message.statusText, currentStatus, toolList, message.content]);

  // Agent activity separation: everything the harness does (reasoning tool
  // calls and notices) renders inside one collapsible panel. While the task
  // runs it stays open for live visibility; when the turn completes it
  // collapses so the model's answer is the only thing in focus.
  const reasoningWords = useMemo(
    () => (message.reasoning ? message.reasoning.split(/\s+/).filter(Boolean).length : 0),
    [message.reasoning]
  );
  const activitySteps = toolList.length + (reasoningWords > 0 ? 1 : 0);
  const runningToolLabel = useMemo(() => {
    const running = toolList.find((t) => t.status === 'running');
    return running ? `Running ${running.name}…` : null;
  }, [toolList]);

  useEffect(() => {
    if (Boolean(isRunning) && !wasRunningRef.current) setActivityOpen(true);
    if (!isRunning && wasRunningRef.current) setActivityOpen(false);
    wasRunningRef.current = Boolean(isRunning);
  }, [isRunning]);

  const handleCopyMessage = async () => {
    if (message.content) {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 1600);
    }
  };

  // -------------------------------------------------------------------------
  // Render: USER MESSAGE
  // -------------------------------------------------------------------------
  if (isUser) {
    return (
      <article style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', margin: '8px 0', padding: '0 4px' }}>
        <div style={{
          maxWidth: '88%',
          borderRadius: '16px',
          borderTopRightRadius: '5px',
          background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-primary-hover) 100%)',
          color: '#ffffff',
          padding: '10px 14px',
          fontSize: '12px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
          lineHeight: 1.6,
          userSelect: 'text'
        }}>
          {/* Attached images */}
          {Array.isArray(message.images) && message.images.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {message.images.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`Pasted image ${idx + 1}`}
                  style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.25)' }}
                />
              ))}
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        </div>
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Render: SYSTEM MESSAGE (Handoffs, Canvas sync)
  // -------------------------------------------------------------------------
  if (isSystem) {
    if (message.content.startsWith('🎨 M3E Canvas updated')) {
      const action = message.content.split('🎨 M3E Canvas updated: ')[1]?.split('.')[0] || 'updated_ui';
      const snippetMatch = message.content.match(/```\n([\s\S]*?)\n```/);
      const snippet = snippetMatch ? snippetMatch[1] : '';
      return (
        <details style={{ margin: '6px 0', maxWidth: '94%', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', overflow: 'hidden', fontSize: '11px' }}>
          <summary style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 600, userSelect: 'none', listStyle: 'none' }}>
            <Presentation size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>M3E Canvas updated: {action}</span>
            <ChevronDown size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />
          </summary>
          <div style={{ padding: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                void (window as any).electronAPI?.focusCanvasWindow?.().catch(() => undefined);
              }}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', background: 'var(--accent-primary)', color: '#ffffff', fontSize: '11px', fontWeight: 700 }}
            >
              <span>View in Canvas</span>
            </button>
            {snippet && (
              <pre style={{ margin: 0, padding: '8px', borderRadius: '8px', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontSize: '10px', maxHeight: '144px', overflow: 'auto' }}>
                {snippet}
              </pre>
            )}
          </div>
        </details>
      );
    }

    return (
      <div style={{ margin: '6px 0', display: 'flex', justifyContent: 'center', padding: '0 8px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 500, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
          <Info size={11} />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: UNIFIED ASSISTANT MESSAGE
  // -------------------------------------------------------------------------
  return (
    <article style={{ margin: '10px 0', display: 'flex', flexDirection: 'column', width: '100%', color: 'var(--text-secondary)' }}>
      <div style={{
        borderRadius: '16px',
        borderBottomLeftRadius: '5px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        padding: '14px',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
      }}>
        {/* Assistant Header: Avatar + Model identity & Cached/Failover indicators */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'var(--surface-3)', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', flexShrink: 0, boxShadow: '0 0 8px rgba(0,0,0,0.12)' }}>
              <Sparkles size={11} />
            </div>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '12px' }}>Ty-Code Assistant</span>
            {message.metadata?.modelId && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                • {message.metadata.modelId}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {message.isCached && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '5px', fontSize: '10px', fontWeight: 600, background: 'var(--surface-2)', color: 'var(--accent-cyan)', border: '1px solid var(--border-subtle)' }}>
                <Zap size={9} />
                cached
              </span>
            )}
            {message.failoverNotice && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '5px', fontSize: '10px', fontWeight: 600, background: 'var(--surface-2)', color: 'var(--accent-amber)', border: '1px solid var(--border-subtle)' }}>
                <Clock size={9} />
                <span>{message.failoverNotice}</span>
              </span>
            )}
          </div>
        </div>

        {/* 1. THINKING STATE: Clean, Shimmering Indicator */}
        {isThinking && (
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-primary)', padding: '8px 12px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Shimmer gradient overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)', animation: 'shimmer 2s infinite', pointerEvents: 'none' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)', opacity: 0.7, flexShrink: 0, animation: 'ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', animation: 'pulse 1.5s ease-in-out infinite', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
              {thinkingLabel}
            </span>
          </div>
        )}

        {/* 2. AGENT ACTIVITY: the harness work (thinking, summarized thinking,
            tool use, command execution, notices) is fully separated from the
            user-facing response. Collapsed once the turn completes; toggle
            manually at any time. */}
        {activitySteps > 0 && (
          <div style={{ margin: '8px 0', borderRadius: '10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', overflow: 'hidden', fontSize: '11px' }}>
            <button
              type="button"
              onClick={() => setActivityOpen(!activityOpen)}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                background: 'transparent',
                textAlign: 'left',
                userSelect: 'none'
              }}
              title="Toggle agent activity: thinking, tool use, command execution"
            >
              <Bot size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600 }}>Agent Activity</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {reasoningWords > 0 && <span>thought {reasoningWords}w</span>}
                {toolList.length > 0 && (
                  <span>
                    {toolList.length} tool{toolList.length === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              {runningToolLabel && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px', fontSize: '10px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-primary)', opacity: 0.7, animation: 'ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
                  {runningToolLabel}
                </span>
              )}
              <ChevronDown
                size={12}
                style={{ marginLeft: 'auto', transition: 'transform 0.18s ease', color: 'var(--text-muted)', flexShrink: 0, transform: activityOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            {activityOpen && (
              <div style={{ padding: '6px 8px 8px', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                {/* Thought process (live reasoning + summarized thinking) */}
                {message.reasoning && (
                  <details style={{ borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', overflow: 'hidden', fontSize: '11px' }}>
                    <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600, userSelect: 'none', listStyle: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Sparkles size={12} style={{ color: 'var(--accent-primary)' }} />
                        <span>Thought Process</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({reasoningWords} words)</span>
                      </div>
                      <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
                    </summary>
                    <div style={{ padding: '6px 12px 12px', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.65, maxHeight: '224px', overflowY: 'auto', whiteSpace: 'pre-wrap', userSelect: 'text' }}>
                      {message.reasoning}
                    </div>
                  </details>
                )}

                {/* Tool use / command execution records */}
                {toolList.map((tool) => (
                  <ToolExecutionBlock key={tool.id} tool={tool} />
                ))}

                {/* Harness notices (failover announcements) */}
                {message.failoverNotice && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-amber)', background: 'var(--surface-2)', fontSize: '11px', color: 'var(--accent-amber)' }}>
                    <Clock size={11} style={{ flexShrink: 0 }} />
                    <span>{message.failoverNotice}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3. PROPOSED DIFFS */}
        {message.proposedDiffs && message.proposedDiffs.length > 0 && (
          <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {message.proposedDiffs.map((diff) => (
              <DiffCard
                key={diff.id}
                diff={diff}
                onInspect={() => onInspectDiff?.(diff)}
                onApply={() => onApplyDiff?.(diff)}
              />
            ))}
          </div>
        )}

        {/* 4. MAIN TEXT RESPONSE (Markdown Content) */}
        {message.content ? (
          <div style={{ fontSize: '12px', lineHeight: 1.7, color: 'var(--text-primary)', userSelect: 'text' }}>
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
          </div>
        ) : null}

        {/* 5. ERROR CARD */}
        {message.errorCard && (
          <div style={{ margin: '8px 0' }}>
            <ChatErrorCard errorCard={message.errorCard} onRetry={onRetryError} />
          </div>
        )}

        {/* 6. BOTTOM ACTIONS & HIDDEN METADATA DETAILS */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-muted)' }}>
          {/* Left: Metadata Details Toggle (Prompt/Response token counts hidden by default) */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}
              title="Toggle execution & token telemetry details"
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Info size={11} />
              <span>Details</span>
              <ChevronDown size={10} style={{ transition: 'transform 0.18s ease', transform: showDetails ? 'rotate(180deg)' : 'none' }} />
            </button>

            {showDetails && (
              <div style={{ position: 'absolute', left: 0, bottom: '24px', zIndex: 20, width: '256px', padding: '10px', borderRadius: '10px', border: '1px solid var(--border-strong)', background: 'var(--bg-secondary)', boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)', fontSize: '10.5px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px', userSelect: 'text' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '4px', marginBottom: '4px' }}>
                  Message Telemetry
                </div>
                {[
                  ['Provider', String(message.metadata?.providerId || 'default')],
                  ['Model', String(message.metadata?.modelId || 'default')],
                  ['Stream Events', String(message.metadata?.streamEventCount ?? 0)],
                  ...(message.content ? [['Est. Response Tokens', `~${Math.round(message.content.length / 4)}`]] : []),
                  ...(toolList.length > 0 ? [['Tools Executed', String(toolList.length)]] : [])
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                    <span>{label}:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Quick actions (Copy, Regenerate) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {message.content && (
              <button
                type="button"
                onClick={handleCopyMessage}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}
                title="Copy response"
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = copiedMessage ? 'var(--accent-green)' : 'var(--text-muted)'; }}
              >
                {copiedMessage ? <Check size={11} style={{ color: 'var(--accent-green)' }} /> : <Copy size={11} />}
                <span>{copiedMessage ? 'Copied' : 'Copy'}</span>
              </button>
            )}

            {isLastAssistant && !isRunning && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}
                title="Regenerate last response"
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <RotateCcw size={11} />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

export { ChatMessageItem as ChatMessage };
export default ChatMessageItem;
