import React, { useState, useMemo } from 'react';
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
    <div className="my-2.5 rounded-lg border border-zinc-800 bg-[#0d0e11] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/70 border-b border-zinc-800/80 text-[11px] text-zinc-400">
        <span className="font-mono text-zinc-300">{language || 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Copy code block"
        >
          {copied ? (
            <>
              <Check size={11} className="text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-zinc-200 font-mono leading-relaxed text-[11.5px] select-text">
        <code
          className={`hljs${highlightLanguage ? ` language-${highlightLanguage}` : ''}`}
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
      <code className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-indigo-300 font-mono text-[11px]" {...props}>
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

  const getToolIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('grep') || lower.includes('search')) return <Search size={13} className="text-indigo-400 shrink-0" />;
    if (lower.includes('read') || lower.includes('view')) return <FileText size={13} className="text-cyan-400 shrink-0" />;
    if (lower.includes('write') || lower.includes('replace') || lower.includes('edit')) return <FileCode size={13} className="text-emerald-400 shrink-0" />;
    if (lower.includes('command') || lower.includes('terminal') || lower.includes('bash')) return <Terminal size={13} className="text-amber-400 shrink-0" />;
    if (lower.includes('dir') || lower.includes('tree') || lower.includes('folder')) return <Folder size={13} className="text-blue-400 shrink-0" />;
    if (lower.includes('presentation')) return <Presentation size={13} className="text-purple-400 shrink-0" />;
    return <Wrench size={13} className="text-zinc-400 shrink-0" />;
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
      className={`rounded-lg border transition-all my-1.5 overflow-hidden text-xs ${
        isFailed
          ? 'border-rose-500/30 bg-rose-500/5'
          : isRunning
          ? 'border-indigo-500/30 bg-indigo-500/5'
          : 'border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/80'
      }`}
    >
      {/* Header Button: Click to toggle arguments and output */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left select-none cursor-pointer hover:bg-white/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-zinc-400">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {getToolIcon(tool.name)}
          <span className="font-mono font-medium text-zinc-200 truncate text-[11.5px]">
            {tool.name}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            ({argCount} {argCount === 1 ? 'arg' : 'args'})
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-[11px] text-indigo-400 font-medium">
              <Loader2 size={11} className="animate-spin" />
              <span>Running</span>
            </span>
          )}
          {isSuccess && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
              <Check size={11} />
              <span>Success</span>
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-1 text-[11px] text-rose-400 font-semibold">
              <XCircle size={11} />
              <span>Failed</span>
            </span>
          )}
          {tool.status === 'cancelled' && (
            <span className="text-[11px] text-zinc-500">Stopped</span>
          )}
        </div>
      </button>

      {/* Collapsible Details: Arguments and Output (Collapsed by Default) */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-1.5 border-t border-zinc-800/60 flex flex-col gap-2 bg-black/20 text-[11px]">
          {/* Arguments */}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400 mb-1">
                Input Arguments
              </div>
              <pre className="p-2 rounded bg-[#0a0b0d] border border-zinc-900 text-zinc-300 font-mono text-[10.5px] max-h-36 overflow-y-auto whitespace-pre-wrap select-text">
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {tool.output !== undefined && (
            <div>
              <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase mb-1">
                <span className={isFailed ? 'text-rose-400' : 'text-zinc-400'}>
                  {isFailed ? 'Error Output' : 'Result Output'}
                </span>
                <button
                  type="button"
                  onClick={handleCopyOutput}
                  className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre
                className={`p-2 rounded font-mono text-[10.5px] max-h-48 overflow-y-auto whitespace-pre-wrap select-text ${
                  isFailed
                    ? 'bg-rose-950/20 border border-rose-900/40 text-rose-200'
                    : 'bg-[#0a0b0d] border border-zinc-900 text-zinc-300'
                }`}
              >
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
    <div className="my-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5 flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <FileCode size={13} className="text-indigo-400 shrink-0" />
        <span className="font-mono text-zinc-200 truncate">{diff.filePath}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
          Ready to review
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onInspect && (
          <button
            type="button"
            onClick={onInspect}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition-colors flex items-center gap-1"
          >
            <Eye size={11} />
            <span>Inspect</span>
          </button>
        )}
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors flex items-center gap-1"
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
      <article className="flex flex-col items-end my-2 px-1">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-gradient-to-br from-indigo-600 to-indigo-700 text-white px-3.5 py-2.5 text-xs shadow-md shadow-indigo-950/20 leading-relaxed select-text">
          {/* Attached images */}
          {Array.isArray(message.images) && message.images.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {message.images.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`Pasted image ${idx + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-white/20"
                />
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap">{message.content}</div>
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
        <details className="my-1.5 max-w-[94%] rounded-lg border border-purple-500/30 bg-purple-500/10 overflow-hidden text-xs">
          <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-purple-300 font-medium select-none list-none">
            <Presentation size={12} className="text-purple-400 shrink-0" />
            <span className="truncate">M3E Canvas updated: {action}</span>
            <ChevronDown size={12} className="ml-auto text-purple-400 shrink-0" />
          </summary>
          <div className="p-2.5 border-t border-purple-500/20 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                void (window as any).electronAPI?.focusCanvasWindow?.().catch(() => undefined);
              }}
              className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-[11px] font-semibold transition-colors cursor-pointer"
            >
              <span>View in Canvas</span>
            </button>
            {snippet && (
              <pre className="p-2 rounded bg-black/60 border border-white/10 text-emerald-300 font-mono text-[10px] max-h-36 overflow-auto">
                {snippet}
              </pre>
            )}
          </div>
        </details>
      );
    }

    return (
      <div className="my-1.5 flex justify-center px-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-zinc-900/80 border border-zinc-800 text-zinc-400">
          <Info size={11} className="text-zinc-500" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: UNIFIED ASSISTANT MESSAGE
  // -------------------------------------------------------------------------
  return (
    <article className="my-2.5 flex flex-col w-full text-zinc-200">
      <div className="rounded-2xl rounded-bl-sm border border-zinc-800/80 bg-[#15171b] p-3.5 shadow-sm">
        {/* Assistant Header: Avatar + Model identity & Cached/Failover indicators */}
        <div className="flex items-center justify-between gap-2 mb-2.5 pb-1.5 border-b border-zinc-800/40 text-[11px] text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm">
              <Sparkles size={11} />
            </div>
            <span className="font-semibold text-zinc-200 text-xs">Ty-Code Assistant</span>
            {message.metadata?.modelId && (
              <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
                • {message.metadata.modelId}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {message.isCached && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30">
                <Zap size={9} />
                cached
              </span>
            )}
            {message.failoverNotice && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                <Clock size={9} />
                <span>{message.failoverNotice}</span>
              </span>
            )}
          </div>
        </div>

        {/* 1. THINKING STATE: Clean, Shimmering Indicator (Tailwind shimmer + pulse) */}
        {isThinking && (
          <div className="relative overflow-hidden rounded-lg bg-zinc-900/80 border border-indigo-500/30 px-3 py-2 my-2 flex items-center gap-2.5 shadow-inner">
            {/* Shimmer gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent animate-[shimmer_2s_infinite]" />
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping shrink-0" />
            <span className="text-xs font-medium text-zinc-200 animate-pulse truncate select-none">
              {thinkingLabel}
            </span>
          </div>
        )}

        {/* 2. REASONING PROCESS (Collapsible, subtle, clean) */}
        {message.reasoning && (
          <details className="group my-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 overflow-hidden text-xs">
            <summary className="flex items-center justify-between px-3 py-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200 transition-colors select-none font-medium">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-indigo-400" />
                <span>Thought Process</span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  ({message.reasoning.split(/\s+/).filter(Boolean).length} words)
                </span>
              </div>
              <ChevronDown size={12} className="transition-transform group-open:rotate-180 text-zinc-500" />
            </summary>
            <div className="px-3 pb-3 pt-1 border-t border-zinc-850 text-zinc-300 font-mono text-[11px] leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap select-text">
              {message.reasoning}
            </div>
          </details>
        )}

        {/* 3. COLLAPSIBLE TOOL EXECUTION BLOCKS */}
        {toolList.length > 0 && (
          <div className="my-2 space-y-1">
            {toolList.map((tool) => (
              <ToolExecutionBlock key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* 4. PROPOSED DIFFS */}
        {message.proposedDiffs && message.proposedDiffs.length > 0 && (
          <div className="my-2 space-y-1.5">
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

        {/* 5. MAIN TEXT RESPONSE (Markdown Content) */}
        {message.content ? (
          <div className="text-xs leading-relaxed text-zinc-100 select-text">
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
          </div>
        ) : null}

        {/* 6. ERROR CARD */}
        {message.errorCard && (
          <div className="my-2">
            <ChatErrorCard errorCard={message.errorCard} onRetry={onRetryError} />
          </div>
        )}

        {/* 7. BOTTOM ACTIONS & HIDDEN METADATA DETAILS */}
        <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-zinc-800/40 text-[11px] text-zinc-500">
          {/* Left: Metadata Details Toggle (Prompt/Response token counts hidden by default) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              title="Toggle execution & token telemetry details"
            >
              <Info size={11} />
              <span>Details</span>
              <ChevronDown size={10} className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </button>

            {showDetails && (
              <div className="absolute left-0 bottom-6 z-20 w-64 p-2.5 rounded-lg border border-zinc-800 bg-[#0f1013] shadow-xl text-[10.5px] text-zinc-400 space-y-1 select-text">
                <div className="font-semibold text-zinc-200 border-b border-zinc-800/80 pb-1 mb-1">
                  Message Telemetry
                </div>
                <div className="flex justify-between">
                  <span>Provider:</span>
                  <span className="font-mono text-zinc-300">{message.metadata?.providerId || 'default'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Model:</span>
                  <span className="font-mono text-zinc-300">{message.metadata?.modelId || 'default'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stream Events:</span>
                  <span className="font-mono text-zinc-300">{message.metadata?.streamEventCount ?? 0}</span>
                </div>
                {message.content && (
                  <div className="flex justify-between">
                    <span>Est. Response Tokens:</span>
                    <span className="font-mono text-zinc-300">~{Math.round(message.content.length / 4)}</span>
                  </div>
                )}
                {toolList.length > 0 && (
                  <div className="flex justify-between">
                    <span>Tools Executed:</span>
                    <span className="font-mono text-zinc-300">{toolList.length}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Quick actions (Copy, Regenerate) */}
          <div className="flex items-center gap-2">
            {message.content && (
              <button
                type="button"
                onClick={handleCopyMessage}
                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title="Copy response"
              >
                {copiedMessage ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedMessage ? 'Copied' : 'Copy'}</span>
              </button>
            )}

            {isLastAssistant && !isRunning && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title="Regenerate last response"
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
