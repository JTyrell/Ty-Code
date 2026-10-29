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
  Presentation,
  Lightbulb
} from 'lucide-react';
import type { ChatMessage, ProposedDiff, ToolExecutionRecord } from '../../../preload/types';
import { ChatErrorCard } from './ChatErrorCard';
import { MessageRenderer } from './chat/MessageRenderer';
import { ThinkingPanel } from './chat/ThinkingPanel';
import { useTypographyStore, buildChatTypographyStyle } from '../state/typography-store';
import { normalisePunctuation } from '../services/punctuation-normaliser';
import { toast } from '../state/toast-store';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { useDocumentReviewStore } from '../state/document-review-store';
import { useSettingsStore } from '../state/settings-store';

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
// Tool Execution & Action Grouping (Antigravity-style mid-process actions)
// ---------------------------------------------------------------------------

type ToolCategory = 'command' | 'read' | 'edit' | 'search' | 'dir' | 'other';

interface ToolActionInfo {
  category: ToolCategory;
  verb: string;
  target: string;
  fullTarget: string;
  previewText: string;
}

function extractTarget(tool: ToolExecutionRecord): { target: string; fullTarget: string } {
  const args = tool.arguments || {};

  // 1. Explicit toolSummary or toolAction from agents
  if (typeof args.toolSummary === 'string' && args.toolSummary.trim()) {
    const summary = args.toolSummary.trim();
    return { target: summary, fullTarget: summary };
  }

  // 2. File path parameters (view_file, write_to_file, replace_file_content, etc.)
  const rawPath = (
    args.AbsolutePath ||
    args.TargetFile ||
    args.targetFile ||
    args.filePath ||
    args.filepath ||
    args.path ||
    args.file ||
    args.filename ||
    args.uri ||
    args.target ||
    (typeof args.Url === 'string' ? args.Url : undefined) ||
    (typeof args.url === 'string' ? args.url : undefined)
  );

  const isCmdTool = [
    'run_command', 'exec', 'terminal', 'bash', 'sh', 'cmd', 'powershell', 'ls', 'npm', 'git', 'node'
  ].includes(tool.name.toLowerCase());

  // 3. Command lines (run_command, bash, etc.)
  const rawCmd = (
    args.CommandLine ||
    args.commandLine ||
    args.command ||
    args.cmd ||
    args.script
  );

  if (isCmdTool && rawCmd && typeof rawCmd === 'string') {
    const firstLine = rawCmd.trim().split('\n')[0].trim();
    return {
      target: firstLine.length > 42 ? firstLine.slice(0, 39) + '…' : firstLine,
      fullTarget: rawCmd
    };
  }

  // 4. `ls` tool
  if (tool.name.toLowerCase() === 'ls') {
    if (typeof rawPath === 'string' && rawPath.trim() && rawPath.trim() !== '.') {
      return { target: `ls ${rawPath.trim()}`, fullTarget: `ls ${rawPath.trim()}` };
    }
    return { target: 'ls', fullTarget: 'ls' };
  }

  // 5. File path formatting
  if (typeof rawPath === 'string' && rawPath.trim()) {
    const full = rawPath.trim().replace(/\\/g, '/');
    const parts = full.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] || full;
    return { target: basename, fullTarget: full };
  }

  // 6. Search queries (grep, find)
  const rawQuery = (
    args.Query ||
    args.query ||
    args.pattern ||
    args.searchTerm ||
    args.text
  );
  if (typeof rawQuery === 'string' && rawQuery.trim()) {
    const full = rawQuery.trim();
    const compact = full.length > 30 ? `"${full.slice(0, 27)}…"` : `"${full}"`;
    return { target: compact, fullTarget: full };
  }

  // 7. Directory paths (list_dir)
  const rawDir = args.DirectoryPath || args.directoryPath || args.dir;
  if (typeof rawDir === 'string' && rawDir.trim()) {
    const full = rawDir.trim().replace(/\\/g, '/');
    const parts = full.split('/').filter(Boolean);
    return { target: parts.slice(-2).join('/') || full, fullTarget: full };
  }

  return { target: '', fullTarget: '' };
}

function resolveToolAction(tool: ToolExecutionRecord): ToolActionInfo {
  const name = tool.name.toLowerCase();
  const isFailed = tool.status === 'error' || tool.isError;
  const isRunning = tool.status === 'running';
  const { target, fullTarget } = extractTarget(tool);

  let category: ToolCategory = 'other';
  if (
    [
      'run_command', 'exec', 'terminal', 'bash', 'sh', 'cmd', 'powershell',
      'ls', 'npm', 'git', 'node', 'spawn'
    ].includes(name)
  ) {
    category = 'command';
  } else if (
    [
      'view', 'view_file', 'read', 'read_file', 'read_url_content', 'read_resource',
      'cat', 'head', 'tail', 'open_file'
    ].includes(name)
  ) {
    category = 'read';
  } else if (
    [
      'write', 'write_to_file', 'edit', 'edit_file', 'replace', 'replace_file_content',
      'multi_replace_file_content', 'apply_diff', 'patch', 'create_file'
    ].includes(name)
  ) {
    category = 'edit';
  } else if (
    [
      'grep', 'grep_search', 'search', 'search_files', 'find', 'find_files',
      'rg', 'search_docs'
    ].includes(name)
  ) {
    category = 'search';
  } else if (
    ['list_dir', 'dir', 'tree', 'list_directory'].includes(name)
  ) {
    category = 'dir';
  }

  let verb = '';
  switch (category) {
    case 'read':
      verb = isRunning ? 'Viewing' : isFailed ? 'Failed to view' : 'Viewed';
      break;
    case 'edit':
      verb = isRunning ? 'Editing' : isFailed ? 'Failed to edit' : 'Edited';
      break;
    case 'command':
      verb = isRunning ? 'Running' : isFailed ? 'Failed' : 'Ran';
      break;
    case 'search':
      verb = isRunning ? 'Searching' : isFailed ? 'Search failed' : 'Searched';
      break;
    case 'dir':
      verb = isRunning ? 'Listing' : isFailed ? 'Failed to list' : 'Listed';
      break;
    default:
      verb = isRunning ? 'Running' : isFailed ? 'Failed' : 'Executed';
      break;
  }

  const previewText = target ? `${verb} ${target}` : `${verb} ${tool.name}`;

  return {
    category,
    verb,
    target,
    fullTarget,
    previewText
  };
}

interface ToolActionGroup {
  id: string;
  category: ToolCategory;
  tools: ToolExecutionRecord[];
}

function groupConsecutiveTools(tools: ToolExecutionRecord[]): ToolActionGroup[] {
  if (!tools || tools.length === 0) return [];

  const groups: ToolActionGroup[] = [];
  let currentGroup: ToolActionGroup | null = null;

  for (const tool of tools) {
    const { category } = resolveToolAction(tool);

    if (currentGroup && currentGroup.category === category) {
      currentGroup.tools.push(tool);
    } else {
      currentGroup = {
        id: `group-${tool.id}-${groups.length}`,
        category,
        tools: [tool]
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

function getToolCategoryIcon(category: ToolCategory, name: string) {
  const lower = name.toLowerCase();
  const iconStyle = { flexShrink: 0 } as const;
  if (category === 'read') return <FileText size={13} style={{ ...iconStyle, color: 'var(--accent-cyan)' }} />;
  if (category === 'edit') return <FileCode size={13} style={{ ...iconStyle, color: 'var(--accent-green)' }} />;
  if (category === 'command') return <Terminal size={13} style={{ ...iconStyle, color: 'var(--accent-amber)' }} />;
  if (category === 'search') return <Search size={13} style={{ ...iconStyle, color: 'var(--accent-primary)' }} />;
  if (category === 'dir') return <Folder size={13} style={{ ...iconStyle, color: 'var(--accent-blue)' }} />;
  if (lower.includes('presentation')) return <Presentation size={13} style={{ ...iconStyle, color: 'var(--accent-primary)' }} />;
  return <Wrench size={13} style={{ ...iconStyle, color: 'var(--text-muted)' }} />;
}

interface ToolBlockProps {
  tool: ToolExecutionRecord;
  isNested?: boolean;
}

const ToolExecutionBlock: React.FC<ToolBlockProps> = ({ tool, isNested = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isFailed = tool.status === 'error' || tool.isError;
  const isRunning = tool.status === 'running';
  const isSuccess = tool.status === 'success' && !tool.isError;

  const argCount = Object.keys(tool.arguments || {}).length;
  const action = resolveToolAction(tool);

  const statusColor = isFailed ? 'var(--accent-red)' : isRunning ? 'var(--accent-blue)' : 'var(--accent-green)';

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
        borderRadius: isNested ? '8px' : '10px',
        border: '1px solid var(--border-subtle)',
        borderLeft: `${isNested ? 2.5 : 3}px solid ${statusColor}`,
        background: isNested ? 'var(--bg-primary)' : 'var(--bg-secondary)',
        transition: 'all 0.18s ease',
        margin: isNested ? '2px 0' : '5px 0',
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
          padding: isNested ? '5px 10px' : '6px 12px',
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
          {getToolCategoryIcon(action.category, tool.name)}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
            <span style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: '11px', flexShrink: 0 }}>
              {action.verb}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '11.5px',
                maxWidth: isNested ? '260px' : '360px'
              }}
              title={action.fullTarget || action.target || tool.name}
            >
              {action.target || tool.name}
            </span>
          </div>
          {argCount > 1 && !action.target && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              ({argCount} args)
            </span>
          )}
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
              <pre style={{ margin: 0, padding: '8px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '10.5px', maxHeight: '192px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', ...(isFailed ? { background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: 'var(--accent-red)' } : { background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }) }}>
                {tool.output || '(No output produced)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ToolActionGroupProps {
  group: ToolActionGroup;
}

const ToolActionGroupBlock: React.FC<ToolActionGroupProps> = ({ group }) => {
  // If only 1 action in this group, render standalone tool block
  if (group.tools.length === 1) {
    return <ToolExecutionBlock tool={group.tools[0]} />;
  }

  const hasRunning = group.tools.some((t) => t.status === 'running');
  const failCount = group.tools.filter((t) => t.status === 'error' || t.isError).length;
  const isSuccess = !hasRunning && failCount === 0;

  const groupStatusColor = failCount > 0 ? 'var(--accent-red)' : hasRunning ? 'var(--accent-blue)' : 'var(--accent-green)';

  const [groupExpanded, setGroupExpanded] = useState<boolean>(() => hasRunning || failCount > 0);

  // Auto-expand if a command inside starts running or fails
  useEffect(() => {
    if (hasRunning || failCount > 0) {
      setGroupExpanded(true);
    }
  }, [hasRunning, failCount]);

  const groupTitle = useMemo(() => {
    const count = group.tools.length;
    switch (group.category) {
      case 'read':
        return hasRunning ? `Viewing ${count} files` : `Viewed ${count} files`;
      case 'edit':
        return hasRunning ? `Editing ${count} files` : `Edited ${count} files`;
      case 'command':
        return hasRunning ? `Running ${count} commands` : `Ran ${count} commands`;
      case 'search':
        return hasRunning ? `Searching (${count} queries)` : `Searched (${count} queries)`;
      case 'dir':
        return hasRunning ? `Listing ${count} directories` : `Listed ${count} directories`;
      default:
        return hasRunning ? `Executing ${count} actions` : `Executed ${count} actions`;
    }
  }, [group.category, group.tools.length, hasRunning]);

  const distinctTargets = useMemo(() => {
    return Array.from(new Set(group.tools.map((t) => resolveToolAction(t).target).filter(Boolean)));
  }, [group.tools]);

  const targetsPreview = useMemo(() => {
    if (distinctTargets.length === 0) return '';
    const slice = distinctTargets.slice(0, 3).join(', ');
    return distinctTargets.length > 3 ? `${slice} +${distinctTargets.length - 3}` : slice;
  }, [distinctTargets]);

  return (
    <div
      style={{
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${groupStatusColor}`,
        background: 'var(--bg-secondary)',
        transition: 'all 0.18s ease',
        margin: '6px 0',
        overflow: 'hidden',
        fontSize: '11px'
      }}
    >
      {/* Group Header: Antigravity-style consolidated group row */}
      <button
        type="button"
        onClick={() => setGroupExpanded(!groupExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 12px',
          textAlign: 'left',
          userSelect: 'none',
          cursor: 'pointer',
          background: 'transparent'
        }}
        aria-expanded={groupExpanded}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
            {groupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {getToolCategoryIcon(group.category, group.tools[0].name)}
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11.5px', flexShrink: 0 }}>
            {groupTitle}
          </span>
          {targetsPreview && (
            <span
              style={{
                fontSize: '10.5px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '220px'
              }}
              title={distinctTargets.join(', ')}
            >
              ({targetsPreview})
            </span>
          )}
          <span
            style={{
              fontSize: '9.5px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '10px',
              background: 'var(--surface-3)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              flexShrink: 0
            }}
          >
            {group.tools.length}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
          {hasRunning && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 600 }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Running</span>
            </span>
          )}
          {failCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-red)', fontWeight: 700 }}>
              <XCircle size={11} />
              <span>{failCount} failed{group.tools.length > failCount ? `, ${group.tools.length - failCount} passed` : ''}</span>
            </span>
          )}
          {isSuccess && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>
              <Check size={11} />
              <span>Success</span>
            </span>
          )}
        </div>
      </button>

      {/* Expanded group items */}
      {groupExpanded && (
        <div
          style={{
            padding: '6px 8px 8px 12px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          {group.tools.map((tool) => (
            <ToolExecutionBlock key={tool.id} tool={tool} isNested={true} />
          ))}
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
  isStreaming?: boolean;
}

const ChatMessageItemComponent: React.FC<ChatMessageProps> = ({
  message,
  isLastAssistant = false,
  isRunning = false,
  currentStatus,
  onRegenerate,
  onInspectDiff,
  onApplyDiff,
  onRetryError,
  isStreaming: propIsStreaming
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
  const isMessageStreaming = propIsStreaming ?? Boolean(message.streaming ?? message.isStreaming ?? (isLastAssistant && isRunning));
  const renderMode = message.renderMode ?? (isMessageStreaming ? 'streaming' : 'markdown');
  const isStreaming = renderMode === 'streaming';
  const liveThoughts = useChatStore((s) => s.currentThoughts);

  const activeDocument = useDocumentReviewStore((s) => s.activeDocument);
  const openDocument = useDocumentReviewStore((s) => s.openDocument);
  const setDocTabActive = useDocumentReviewStore((s) => s.setDocTabActive);
  const docReviewStatus = useDocumentReviewStore((s) => s.status);
  const setDocReviewStatus = useDocumentReviewStore((s) => s.setStatus);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const [showRememberModal, setShowRememberModal] = useState(false);
  const [rememberCategory, setRememberCategory] = useState<'style' | 'architecture' | 'stack'>('style');
  const [rememberRuleText, setRememberRuleText] = useState('');
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [savedCorrectionSuccess, setSavedCorrectionSuccess] = useState(false);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  // Typography & Motion: container-scoped CSS variables. Every markdown block
  // inside inherits these, so user font edits restyle the message without
  // re-entering the MessageRenderer worker pipeline (it is memoized).
  const chatFontFamily = useTypographyStore((s) => s.chatFontFamily);
  const chatFontSize = useTypographyStore((s) => s.chatFontSize);
  const ukPunctuationEnabled = useTypographyStore((s) => s.ukPunctuationEnabled);
  const chatTypographyVars = useMemo(
    () => buildChatTypographyStyle(chatFontFamily, chatFontSize),
    [chatFontFamily, chatFontSize]
  );

  // Route badge: while streaming the badge reads LIVE from the unified route
  // store (settings-store activeProviderId/activeModelId — always the current
  // route incl. mid-failover flips); on done it finalizes to the metadata
  // stamped on the message. "default" and empty are never rendered: they
  // fall through to "routing…" until a real route exists.
  const liveProviderId = useSettingsStore((s) => s.activeProviderId);
  const liveModelId = useSettingsStore((s) => s.activeModelId);
  const stampedProviderId = message.metadata?.providerId || '';
  const stampedModelId = message.metadata?.modelId || '';
  const routeIsLive = isMessageStreaming;
  const liveProvider = liveProviderId && liveProviderId !== 'default' ? liveProviderId : '';
  const liveModel = liveModelId && liveModelId !== 'default' ? liveModelId : '';
  const stampedProvider = stampedProviderId && stampedProviderId !== 'default' ? stampedProviderId : '';
  const stampedModel = stampedModelId && stampedModelId !== 'default' ? stampedModelId : '';
  const badgeProviderId = routeIsLive ? (liveProvider || stampedProvider) : (stampedProvider || liveProvider);
  const badgeModelId = routeIsLive ? (liveModel || stampedModel) : (stampedModel || liveModel);
  const badgeModelLabel = badgeModelId || 'routing…';

  const proposedDoc = message.proposedDocument || (
    activeDocument && (
      message.taskId === activeDocument.id ||
      message.toolExecutions?.some((t) => (t.name === 'submit_plan' || t.name === 'submit_report') && t.status !== 'error')
    ) ? activeDocument : null
  );

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

  const hasTextContent = Boolean(message.content && message.content.length > 0);

  const isThinking =
    isAssistant &&
    !hasTextContent &&
    (Boolean(message.streaming) || Boolean(message.isStreaming) || (isLastAssistant && isRunning));

  const thinkingLabel = useMemo(() => {
    if (message.statusText) return message.statusText;
    if (currentStatus) return currentStatus;
    const runningTool = toolList.find((t) => t.status === 'running');
    if (runningTool) {
      const action = resolveToolAction(runningTool);
      return `${action.verb} ${action.target || runningTool.name}…`;
    }
    return 'Thinking…';
  }, [message.statusText, currentStatus, toolList]);

  // Agent activity separation: everything the harness does (reasoning tool
  // calls and notices) renders inside one collapsible panel. While the task
  // runs it stays open for live visibility; when the turn completes it
  // collapses so the model's answer is the only thing in focus.
  const reasoningWords = useMemo(
    () => (message.reasoning ? message.reasoning.split(/\s+/).filter(Boolean).length : 0),
    [message.reasoning]
  );
  const activitySteps = toolList.length + (reasoningWords > 0 ? 1 : 0);
  const toolGroups = useMemo(() => groupConsecutiveTools(toolList), [toolList]);

  const runningToolLabel = useMemo(() => {
    const running = toolList.find((t) => t.status === 'running');
    if (!running) return null;
    const action = resolveToolAction(running);
    return `${action.verb} ${action.target || running.name}…`;
  }, [toolList]);

  useEffect(() => {
    if (Boolean(isRunning) && !wasRunningRef.current) setActivityOpen(true);
    if (!isRunning && wasRunningRef.current) setActivityOpen(false);
    wasRunningRef.current = Boolean(isRunning);
  }, [isRunning]);

  const handleCopyMessage = async () => {
    if (message.content) {
      const textToCopy = ukPunctuationEnabled
        ? normalisePunctuation(message.content)
        : message.content;
      await window.electronAPI?.copyToClipboard(textToCopy);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 1600);
    }
  };

  const handleSaveCorrection = async () => {
    if (!rememberRuleText.trim()) return;
    setIsSavingCorrection(true);
    try {
      const res = await window.electronAPI.saveCorrection({
        workspacePath,
        rule: rememberRuleText.trim(),
        category: rememberCategory
      });
      if (res.success && res.data) {
        toast.success('Preference remembered', res.data.rule);
        setSavedCorrectionSuccess(true);
        setShowRememberModal(false);
      } else {
        toast.error('Failed to save preference', res.error || 'Unknown error');
      }
    } catch (err: unknown) {
      toast.error('Failed to save preference', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingCorrection(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render: USER MESSAGE
  // -------------------------------------------------------------------------
  if (isUser) {
    return (
      <article
        className="chat-message-bubble chat-message-user contain-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          margin: '8px 0',
          padding: '0 4px',
          contain: 'content',
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 80px',
          ...chatTypographyVars
        }}
      >
        <div
          className="contain-content"
          style={{
            maxWidth: '88%',
            borderRadius: '16px',
            borderTopRightRadius: '5px',
            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-primary-hover) 100%)',
            color: '#ffffff',
            padding: '10px 14px',
            fontSize: 'var(--chat-font-size, 12px)',
            lineHeight: 'var(--chat-line-height, 1.6)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
            userSelect: 'text',
            contain: 'content'
          }}
        >
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

        {/* User preference remember button & modal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '10px' }}>
          <button
            type="button"
            onClick={() => {
              setRememberRuleText(message.content);
              setShowRememberModal(!showRememberModal);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10.5px',
              color: savedCorrectionSuccess ? 'var(--accent-green)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: '4px'
            }}
            title="Remember this preference in workspace Correction Memory"
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e5a50a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = savedCorrectionSuccess ? 'var(--accent-green)' : 'var(--text-muted)'; }}
          >
            {savedCorrectionSuccess ? (
              <>
                <Check size={11} style={{ color: 'var(--accent-green)' }} />
                <span>Preference remembered</span>
              </>
            ) : (
              <>
                <Lightbulb size={11} style={{ color: '#e5a50a' }} />
                <span>Remember this preference</span>
              </>
            )}
          </button>
        </div>

        {showRememberModal && (
          <div
            style={{
              marginTop: '6px',
              padding: '10px',
              borderRadius: '8px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              width: '100%',
              maxWidth: '360px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <Lightbulb size={13} style={{ color: '#e5a50a' }} />
                <span>Correction Memory</span>
              </div>
              <button
                type="button"
                onClick={() => setShowRememberModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Save this preference to your workspace audit ledger so the AI never repeats this mistake.
            </div>

            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              {(['style', 'architecture', 'stack'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setRememberCategory(cat)}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    borderRadius: '4px',
                    border: rememberCategory === cat ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                    background: rememberCategory === cat ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                    color: rememberCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: '10px',
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                    fontWeight: rememberCategory === cat ? 600 : 400
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <textarea
              value={rememberRuleText}
              onChange={(e) => setRememberRuleText(e.target.value)}
              rows={2}
              placeholder="Rule (e.g. ALWAYS use Zod for validation)"
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                resize: 'vertical',
                marginBottom: '8px',
                boxSizing: 'border-box'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setShowRememberModal(false)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '10px'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrection}
                disabled={isSavingCorrection || !rememberRuleText.trim()}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: 'var(--accent-primary)',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: isSavingCorrection || !rememberRuleText.trim() ? 'not-allowed' : 'pointer',
                  opacity: isSavingCorrection || !rememberRuleText.trim() ? 0.6 : 1,
                  fontSize: '10px'
                }}
              >
                {isSavingCorrection ? 'Remembering…' : 'Save Preference'}
              </button>
            </div>
          </div>
        )}
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
        <details
          className="chat-message-bubble chat-message-system contain-content"
          style={{
            margin: '6px 0',
            maxWidth: '94%',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface-2)',
            overflow: 'hidden',
            fontSize: '11px',
            contain: 'content'
          }}
        >
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
      <div
        className="chat-message-bubble chat-message-system contain-content"
        style={{
          margin: '6px 0',
          display: 'flex',
          justifyContent: 'center',
          padding: '0 8px',
          contain: 'content'
        }}
      >
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
    <article
      className="chat-message-bubble chat-message-assistant contain-content"
      style={{
        margin: '10px 0',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        color: 'var(--text-secondary)',
        contain: 'content',
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 140px',
        ...chatTypographyVars
      }}
    >
      <div
        className="contain-content"
        style={{
          borderRadius: '16px',
          borderBottomLeftRadius: '5px',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          padding: '14px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
          contain: 'content'
        }}
      >
        {/* Assistant Header: Avatar + Model identity & Cached/Failover indicators */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'var(--surface-3)', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', flexShrink: 0, boxShadow: '0 0 8px rgba(0,0,0,0.12)' }}>
              <Sparkles size={11} />
            </div>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '12px' }}>Ty-Code Assistant</span>
            {(routeIsLive || badgeModelId) && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                • {badgeModelLabel}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {message.modeEscalation && (
              <span
                id="mode-escalated-chip"
                className="mode-escalated-chip"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%)',
                  border: '1px solid var(--accent-primary)',
                  color: 'var(--accent-primary)',
                  boxShadow: '0 0 10px rgba(139, 92, 246, 0.2)',
                  letterSpacing: '0.02em'
                }}
              >
                <Zap size={10} style={{ color: 'var(--accent-primary)' }} />
                <span>Mode escalated: {message.modeEscalation.from} → {message.modeEscalation.to}</span>
              </span>
            )}
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

        {/* 1. THINKING PANEL (Step 2: Structured thought array rendering) */}
        {((message.thoughts && message.thoughts.length > 0) || (isMessageStreaming && liveThoughts && liveThoughts.length > 0) || message.reasoning) ? (
          <ThinkingPanel
            messageId={message.id}
            thoughts={message.thoughts && message.thoughts.length > 0 ? message.thoughts : (message.reasoning ? message.reasoning.split('\n').filter(Boolean) : [])}
            isStreaming={isMessageStreaming}
            durationSeconds={message.thoughtDurationSeconds}
          />
        ) : isThinking ? (
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-primary)', padding: '8px 12px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Shimmer gradient overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)', animation: 'shimmer 2s infinite', pointerEvents: 'none' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)', opacity: 0.7, flexShrink: 0, animation: 'ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', animation: 'pulse 1.5s ease-in-out infinite', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
              {thinkingLabel}
            </span>
          </div>
        ) : null}

        {/* 2. AGENT ACTIVITY: tool use and command execution records */}
        {toolList.length > 0 && (
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
              title="Toggle agent activity: tool use, command execution"
            >
              <Bot size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600 }}>Agent Activity</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                <span>
                  {toolList.length} tool{toolList.length === 1 ? '' : 's'}
                </span>
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
                {/* Tool use / command execution records grouped by consecutive category */}
                {toolGroups.map((group) => (
                  <ToolActionGroupBlock key={group.id} group={group} />
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

        {/* 4. MAIN TEXT RESPONSE: Compact Document Card when proposed, else Deferred Markdown */}
        {proposedDoc ? (
          <div
            id={`compact-doc-card-${proposedDoc.id}`}
            style={{
              margin: '8px 0',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(20, 23, 29, 0.95)',
              border: `1px solid ${proposedDoc.kind === 'plan' ? 'rgba(99, 102, 241, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              fontSize: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  background: proposedDoc.kind === 'plan' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(16, 185, 129, 0.25)',
                  color: proposedDoc.kind === 'plan' ? '#a5b4fc' : '#6ee7b7',
                  border: `1px solid ${proposedDoc.kind === 'plan' ? 'rgba(99, 102, 241, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                  flexShrink: 0
                }}
              >
                📄 {proposedDoc.kind.toUpperCase()}
              </span>
              <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  &ldquo;{proposedDoc.title}&rdquo;
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '6px' }}>
                  — {proposedDoc.sections.length} section{proposedDoc.sections.length === 1 ? '' : 's'} · opened in editor
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  openDocument(proposedDoc);
                  setDocTabActive(true);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 9px',
                  borderRadius: '5px',
                  background: 'var(--bg-tertiary, #1e222b)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Open and view full document in editor"
              >
                <Eye size={11} />
                <span>View in Editor</span>
              </button>

              {proposedDoc.kind === 'plan' && (
                <button
                  type="button"
                  disabled={docReviewStatus === 'approved'}
                  onClick={async () => {
                    if (pendingApproval) {
                      await respondToApproval(true);
                    } else if (window.electronAPI?.sendApprovalResponse) {
                      try {
                        await window.electronAPI.sendApprovalResponse(`plan_${proposedDoc.id}`, 'APPROVED');
                      } catch { }
                    }
                    setAgentMode('build' as any);
                    if (window.electronAPI?.setAgentMode) {
                      void window.electronAPI.setAgentMode('execute');
                    }
                    setDocReviewStatus('approved');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '5px',
                    background: docReviewStatus === 'approved' ? 'rgba(16, 185, 129, 0.2)' : 'var(--accent-green, #10b981)',
                    color: docReviewStatus === 'approved' ? '#6ee7b7' : '#ffffff',
                    border: docReviewStatus === 'approved' ? '1px solid rgba(16, 185, 129, 0.4)' : 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: docReviewStatus === 'approved' ? 'default' : 'pointer'
                  }}
                  title="Approve plan and proceed with execution"
                >
                  <Check size={11} />
                  <span>{docReviewStatus === 'approved' ? 'Approved' : 'Proceed'}</span>
                </button>
              )}
            </div>
          </div>
        ) : message.content ? (
          <MessageRenderer content={message.content} isStreaming={isStreaming} />
        ) : null}

        {/* 4b. SCOPE REJECTION CARD */}
        {message.scopeRejectionCard && (
          <div
            id="scope-rejection-card"
            style={{
              margin: '10px 0',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderLeft: '4px solid var(--accent-red)',
              background: 'rgba(239, 68, 68, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={14} style={{ color: 'var(--accent-red)' }} />
                <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--accent-red)' }}>
                  Scope Violation: Tool &ldquo;{message.scopeRejectionCard.toolName}&rdquo; Blocked
                </span>
              </div>
              <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-red)', fontWeight: 600 }}>
                {message.scopeRejectionCard.mode} Mode ({message.scopeRejectionCard.scope})
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {message.scopeRejectionCard.reason}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {message.scopeRejectionCard.remedy}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <button
                id="btn-escalate-mode-build"
                type="button"
                onClick={() => {
                  try {
                    const wsPath = useWorkspaceStore.getState().workspacePath || '';
                    useChatStore.getState().setAgentMode?.('build');
                    void useChatStore.getState().sendMessage(`Switch to BUILD mode and execute ${message.scopeRejectionCard?.toolName}.`, wsPath);
                  } catch (e) {
                    console.error('Failed to trigger BUILD escalation', e);
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  background: 'var(--accent-primary)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '11px'
                }}
              >
                <Zap size={11} />
                <span>Switch to BUILD Mode &amp; Execute</span>
              </button>
            </div>
          </div>
        )}

        {/* 4c. TRUNCATION CONTINUATION BANNER & BUTTON */}
        {(message.truncated || message.actions?.includes('Continue')) && (
          <div
            id="truncated-continuation-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              margin: '10px 0 6px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              color: 'var(--accent-amber)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 600 }}>
              <Clock size={13} style={{ flexShrink: 0 }} />
              <span>Response paused at token limit.</span>
            </div>
            <button
              id="continue-generation-btn"
              type="button"
              onClick={() => {
                try {
                  const wsPath = useWorkspaceStore.getState().workspacePath || '';
                  void useChatStore.getState().sendMessage('Continue exactly where you stopped without repeating previous content.', wsPath);
                } catch (e) {
                  console.error('Failed to continue generation', e);
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 12px',
                borderRadius: '6px',
                background: 'var(--accent-primary)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '11px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
              }}
            >
              <Zap size={10} fill="currentColor" />
              <span>Continue</span>
            </button>
          </div>
        )}

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
                  ['Provider', String(badgeProviderId || 'routing…')],
                  ['Model', String(badgeModelLabel)],
                  ['Stream Events', String(message.metadata?.streamEventCount ?? 0)],
                  ...(message.metadata?.firstTokenAt
                    ? [['Time to First Token', `${Math.max(0, message.metadata.firstTokenAt - message.timestamp)}ms`]]
                    : []),
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
            {message.content && (
              <button
                type="button"
                onClick={() => {
                  setRememberRuleText(message.content);
                  setShowRememberModal(!showRememberModal);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  color: savedCorrectionSuccess ? 'var(--accent-green)' : 'var(--text-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title="Remember this preference in workspace Correction Memory"
                onMouseEnter={(e) => { e.currentTarget.style.color = '#e5a50a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = savedCorrectionSuccess ? 'var(--accent-green)' : 'var(--text-muted)'; }}
              >
                {savedCorrectionSuccess ? (
                  <>
                    <Check size={11} style={{ color: 'var(--accent-green)' }} />
                    <span>Remembered</span>
                  </>
                ) : (
                  <>
                    <Lightbulb size={11} style={{ color: '#e5a50a' }} />
                    <span>Remember preference</span>
                  </>
                )}
              </button>
            )}

            {showRememberModal && !isUser && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: '26px',
                  zIndex: 40,
                  width: '320px',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                    <Lightbulb size={13} style={{ color: '#e5a50a' }} />
                    <span>Correction Memory</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRememberModal(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Save this preference to your workspace audit ledger so the AI never repeats this mistake.
                </div>

                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                  {(['style', 'architecture', 'stack'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setRememberCategory(cat)}
                      style={{
                        flex: 1,
                        padding: '3px 6px',
                        borderRadius: '4px',
                        border: rememberCategory === cat ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                        background: rememberCategory === cat ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        color: rememberCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                        fontSize: '10px',
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                        fontWeight: rememberCategory === cat ? 600 : 400
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <textarea
                  value={rememberRuleText}
                  onChange={(e) => setRememberRuleText(e.target.value)}
                  rows={2}
                  placeholder="Rule (e.g. NEVER use var, use const or let)"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono, monospace)',
                    resize: 'vertical',
                    marginBottom: '8px',
                    boxSizing: 'border-box'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setShowRememberModal(false)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '10px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCorrection}
                    disabled={isSavingCorrection || !rememberRuleText.trim()}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      border: 'none',
                      background: 'var(--accent-primary)',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor: isSavingCorrection || !rememberRuleText.trim() ? 'not-allowed' : 'pointer',
                      opacity: isSavingCorrection || !rememberRuleText.trim() ? 0.6 : 1,
                      fontSize: '10px'
                    }}
                  >
                    {isSavingCorrection ? 'Remembering…' : 'Save Preference'}
                  </button>
                </div>
              </div>
            )}

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

export const ChatMessageItem = React.memo(ChatMessageItemComponent);
export { ChatMessageItem as ChatMessage };
export default ChatMessageItem;
