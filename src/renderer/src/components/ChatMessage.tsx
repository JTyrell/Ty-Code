import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { MessageRenderer, sanitizeAssistantDisplayContent } from './chat/MessageRenderer';
import { ThinkingPanel } from './chat/ThinkingPanel';
import { useTypographyStore, buildChatTypographyStyle } from '../state/typography-store';
import { normalisePunctuation } from '../services/punctuation-normaliser';
import { toast } from '../state/toast-store';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { useDocumentReviewStore } from '../state/document-review-store';
import { useSettingsStore } from '../state/settings-store';
import { copyTextOrNotify } from '../lib/clipboard';

// ---------------------------------------------------------------------------
// Code shelf: rendered by MessageRenderer's buildCodeShelfHtml and styled by
// the .code-shelf* rule family in ChatSidecar.css. The shelf background stays
// dark in every theme on purpose — the global hljs token palette is dark-only,
// so a light pastel theme would otherwise render unreadable syntax colours.
// Grammars come from ChatSidecar.tsx (main thread) and from the full
// highlight.js bundle inside workers/highlight.worker.ts.
// ---------------------------------------------------------------------------

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
  if (category === 'read') return <FileText size={13} className="chat-tool-cat-icon is-read" />;
  if (category === 'edit') return <FileCode size={13} className="chat-tool-cat-icon is-edit" />;
  if (category === 'command') return <Terminal size={13} className="chat-tool-cat-icon is-command" />;
  if (category === 'search') return <Search size={13} className="chat-tool-cat-icon is-search" />;
  if (category === 'dir') return <Folder size={13} className="chat-tool-cat-icon is-dir" />;
  if (lower.includes('presentation')) return <Presentation size={13} className="chat-tool-cat-icon is-presentation" />;
  return <Wrench size={13} className="chat-tool-cat-icon" />;
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
      void copyTextOrNotify(tool.output, 'chat.agent-tool-output').then((result) => {
        if (!result.ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <div
      className={`chat-tool-card${isNested ? ' is-nested' : ''}`}
      style={{ '--tool-status-color': statusColor } as React.CSSProperties}
    >
      {/* Header Button: Click to toggle arguments and output */}
      <button
        type="button"
        className={`chat-tool-header${isNested ? ' is-nested' : ''}`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="chat-tool-heading">
          <span className="chat-tool-chevron">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {getToolCategoryIcon(action.category, tool.name)}
          <div className="chat-tool-identity">
            <span className="chat-tool-verb">{action.verb}</span>
            <span
              className={`chat-tool-target${isNested ? ' is-nested' : ''}`}
              title={action.fullTarget || action.target || tool.name}
            >
              {action.target || tool.name}
            </span>
          </div>
          {argCount > 1 && !action.target && (
            <span className="chat-tool-arg-count">({argCount} args)</span>
          )}
        </div>

        <div className="chat-tool-trailing">
          {isRunning && (
            <span className="chat-tool-status is-running">
              <Loader2 size={11} className="chat-tool-spinner" />
              <span>Running</span>
            </span>
          )}
          {isSuccess && (
            <span className="chat-tool-status is-success">
              <Check size={11} />
              <span>Success</span>
            </span>
          )}
          {isFailed && (
            <span className="chat-tool-status is-failed">
              <XCircle size={11} />
              <span>Failed</span>
            </span>
          )}
          {tool.status === 'cancelled' && (
            <span className="chat-tool-status is-cancelled">Stopped</span>
          )}
        </div>
      </button>

      {/* Collapsible Details: Arguments and Output (Collapsed by Default) */}
      {expanded && (
        <div className="chat-tool-details">
          {/* Arguments */}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div>
              <div className="chat-tool-section-label">Input Arguments</div>
              <pre className="chat-tool-pre">{JSON.stringify(tool.arguments, null, 2)}</pre>
            </div>
          )}

          {/* Output */}
          {tool.output !== undefined && (
            <div>
              <div className="chat-tool-output-heading">
                <span className={`chat-tool-section-label${isFailed ? ' is-error' : ''}`}>
                  {isFailed ? 'Error Output' : 'Result Output'}
                </span>
                <button
                  type="button"
                  className={`chat-tool-copy${copied ? ' is-copied' : ''}`}
                  onClick={handleCopyOutput}
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className={`chat-tool-pre is-output${isFailed ? ' is-error' : ''}`}>
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
      className="chat-tool-card is-group"
      style={{ '--tool-status-color': groupStatusColor } as React.CSSProperties}
    >
      {/* Group Header: consolidated group row */}
      <button
        type="button"
        className="chat-tool-header is-group"
        onClick={() => setGroupExpanded(!groupExpanded)}
        aria-expanded={groupExpanded}
      >
        <div className="chat-tool-heading">
          <span className="chat-tool-chevron">
            {groupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {getToolCategoryIcon(group.category, group.tools[0].name)}
          <span className="chat-tool-group-title">{groupTitle}</span>
          {targetsPreview && (
            <span className="chat-tool-group-targets" title={distinctTargets.join(', ')}>
              ({targetsPreview})
            </span>
          )}
          <span className="chat-tool-group-count">{group.tools.length}</span>
        </div>

        <div className="chat-tool-trailing">
          {hasRunning && (
            <span className="chat-tool-status is-running">
              <Loader2 size={11} className="chat-tool-spinner" />
              <span>Running</span>
            </span>
          )}
          {failCount > 0 && (
            <span className="chat-tool-status is-failed">
              <XCircle size={11} />
              <span>{failCount} failed{group.tools.length > failCount ? `, ${group.tools.length - failCount} passed` : ''}</span>
            </span>
          )}
          {isSuccess && (
            <span className="chat-tool-status is-success">
              <Check size={11} />
              <span>Success</span>
            </span>
          )}
        </div>
      </button>

      {/* Expanded group items */}
      {groupExpanded && (
        <div className="chat-tool-group-body">
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
    <div className="chat-diff-card">
      <div className="chat-diff-heading">
        <FileCode size={13} className="chat-diff-icon" />
        <span className="chat-diff-path">{diff.filePath}</span>
        <span className="chat-diff-state">Ready to review</span>
      </div>

      <div className="chat-diff-actions">
        {onInspect && (
          <button type="button" className="chat-diff-btn chat-diff-btn-inspect" onClick={onInspect}>
            <Eye size={11} />
            <span>Inspect</span>
          </button>
        )}
        {onApply && (
          <button type="button" className="chat-diff-btn chat-diff-btn-apply" onClick={onApply}>
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

  const cleanedAssistantContent = useMemo(
    () => (isAssistant ? sanitizeAssistantDisplayContent(message.content || '', isStreaming) : (message.content || '')),
    [isAssistant, message.content, isStreaming]
  );

  const hasTextContent = Boolean(cleanedAssistantContent && cleanedAssistantContent.trim().length > 0);

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
    const rawToCopy = isAssistant ? cleanedAssistantContent : message.content;
    if (rawToCopy) {
      const textToCopy = ukPunctuationEnabled
        ? normalisePunctuation(rawToCopy)
        : rawToCopy;
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
        style={chatTypographyVars}
      >
        <div className="chat-user-bubble contain-content">
          {/* Attached images */}
          {Array.isArray(message.images) && message.images.length > 0 && (
            <div className="chat-user-images">
              {message.images.map((src, idx) => (
                <img
                  key={idx}
                  className="chat-user-image"
                  src={src}
                  alt={`Pasted image ${idx + 1}`}
                />
              ))}
            </div>
          )}
          <div className="chat-user-bubble-text">{message.content}</div>
        </div>

        {/* User preference remember button & modal */}
        {((message.content || '').trim().length >= 24 || showRememberModal || savedCorrectionSuccess) && (
        <div className="chat-remember-row">
          <button
            type="button"
            className={`chat-remember-trigger${savedCorrectionSuccess ? ' is-saved' : ''}`}
            onClick={() => {
              setRememberRuleText(message.content);
              setShowRememberModal(!showRememberModal);
            }}
            title="Remember this preference in workspace Correction Memory"
          >
            {savedCorrectionSuccess ? (
              <>
                <Check size={11} />
                <span>Preference remembered</span>
              </>
            ) : (
              <>
                <Lightbulb size={11} className="chat-remember-bulb" />
                <span>Remember this preference</span>
              </>
            )}
          </button>
        </div>
        )}

        {showRememberModal && (
          <div className="chat-remember-card">
            <div className="chat-remember-card-header">
              <div className="chat-remember-card-title">
                <Lightbulb size={13} className="chat-remember-bulb" />
                <span>Correction Memory</span>
              </div>
              <button
                type="button"
                className="chat-remember-card-close"
                onClick={() => setShowRememberModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="chat-remember-hint">
              Save this preference to your workspace audit ledger so the AI never repeats this mistake.
            </div>

            <div className="chat-remember-cats">
              {(['style', 'architecture', 'stack'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`chat-remember-cat${rememberCategory === cat ? ' is-active' : ''}`}
                  onClick={() => setRememberCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            <textarea
              className="chat-remember-input"
              value={rememberRuleText}
              onChange={(e) => setRememberRuleText(e.target.value)}
              rows={2}
              placeholder="Rule (e.g. ALWAYS use Zod for validation)"
            />

            <div className="chat-remember-actions">
              <button
                type="button"
                className="chat-remember-cancel"
                onClick={() => setShowRememberModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="chat-remember-save"
                onClick={handleSaveCorrection}
                disabled={isSavingCorrection || !rememberRuleText.trim()}
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
          className="chat-message-bubble chat-message-system is-canvas contain-content"
        >
          <summary className="chat-canvas-summary">
            <Presentation size={12} className="chat-canvas-icon" />
            <span className="chat-canvas-summary-label">M3E Canvas updated: {action}</span>
            <ChevronDown size={12} className="chat-canvas-chevron" />
          </summary>
          <div className="chat-canvas-body">
            <button
              type="button"
              className="chat-canvas-open"
              onClick={() => {
                void (window as any).electronAPI?.focusCanvasWindow?.().catch(() => undefined);
              }}
            >
              <span>View in Canvas</span>
            </button>
            {snippet && (
              <pre className="chat-canvas-snippet">{snippet}</pre>
            )}
          </div>
        </details>
      );
    }

    return (
      <div
        className="chat-message-bubble chat-message-system contain-content"
      >
        <div className="chat-system-chip">
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
      style={chatTypographyVars}
    >
      <div className="chat-assistant-bubble contain-content">
        {/* Assistant Header: Avatar + Model identity & Cached/Failover indicators */}
        <div className="chat-assistant-header">
          <div className="chat-assistant-identity">
            <div className="chat-assistant-avatar">
              <Sparkles size={11} />
            </div>
            <span className="chat-assistant-name">Ty-Code Assistant</span>
            {(routeIsLive || badgeModelId) && (
              <span className="chat-assistant-model">
                • {badgeModelLabel}
              </span>
            )}
          </div>

          <div className="chat-assistant-badges">
            {message.modeEscalation && (
              <span
                id="mode-escalated-chip"
                className="mode-escalated-chip"
              >
                <Zap size={10} />
                <span>Mode escalated: {message.modeEscalation.from} → {message.modeEscalation.to}</span>
              </span>
            )}
            {message.isCached && (
              <span className="chat-badge is-cached">
                <Zap size={9} />
                cached
              </span>
            )}
            {message.failoverNotice && (
              <span className="chat-badge is-failover">
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
          <div className="chat-thinking-live">
            {/* Shimmer gradient overlay */}
            <div className="chat-thinking-live-shimmer" />
            <div className="chat-thinking-live-dot" />
            <span className="chat-thinking-live-label">
              {thinkingLabel}
            </span>
          </div>
        ) : null}

        {/* 1b. NO-RESPONSE STRIP: the turn finalized with no content, thoughts,
            tools or error (a degenerate empty stream that the gateway ladder
            could not heal). Render an actionable notice instead of a blank
            bubble. Never injects fake model text; Regenerate re-runs the send
            EXCLUDING the hollow route so the first attempt rotates away. Details
            reveals the full [ROUTE] trail (degenerate attempts + key rotations).
            Auto-dismisses as soon as any real chunk lands. */}
        {message.noResponseNotice && !isMessageStreaming ? (
          <div className="chat-no-response" role="status">
            <AlertCircle size={13} className="chat-no-response-icon" />
            <span className="chat-no-response-label">
              {message.routeFailure
                ? `Empty response from ${message.routeFailure.route} \u2014 tried ${message.routeFailure.triedCount} route${message.routeFailure.triedCount === 1 ? '' : 's'}`
                : 'No response received'}
            </span>
            {!message.routeFailure && (
              <span className="chat-no-response-hint">
                The model returned an empty reply. Try again on a different route.
              </span>
            )}
            {onRegenerate && (
              <button
                type="button"
                className="chat-no-response-btn"
                onClick={onRegenerate}
                title="Regenerate, skipping the route that returned empty"
              >
                <RotateCcw size={11} />
                <span>Regenerate</span>
              </button>
            )}
            {message.routeFailure?.trail && (
              <button
                type="button"
                className="chat-no-response-btn"
                onClick={() => setShowDetails(!showDetails)}
                title="Toggle the route trail"
              >
                <Info size={11} />
                <span>Details</span>
                <ChevronDown size={10} className={`chat-footer-chevron${showDetails ? ' is-open' : ''}`} />
              </button>
            )}
          </div>
        ) : null}

        {/* 2. AGENT ACTIVITY: tool use and command execution records */}
        {toolList.length > 0 && (
          <div className="chat-activity">
            <button
              type="button"
              className="chat-activity-header"
              onClick={() => setActivityOpen(!activityOpen)}
              title="Toggle agent activity: tool use, command execution"
            >
              <Bot size={12} className="chat-activity-icon" />
              <span className="chat-activity-title">Agent Activity</span>
              <span className="chat-activity-count">
                <span>
                  {toolList.length} tool{toolList.length === 1 ? '' : 's'}
                </span>
              </span>
              {runningToolLabel && (
                <span className="chat-activity-running">
                  <span className="chat-activity-running-dot" />
                  {runningToolLabel}
                </span>
              )}
              <ChevronDown
                size={12}
                className={`chat-activity-chevron${activityOpen ? ' is-open' : ''}`}
              />
            </button>

            {activityOpen && (
              <div className="chat-activity-body">
                {/* Tool use / command execution records grouped by consecutive category */}
                {toolGroups.map((group) => (
                  <ToolActionGroupBlock key={group.id} group={group} />
                ))}

                {/* Harness notices (failover announcements) */}
                {message.failoverNotice && (
                  <div className="chat-harness-notice">
                    <Clock size={11} />
                    <span>{message.failoverNotice}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3. PROPOSED DIFFS */}
        {message.proposedDiffs && message.proposedDiffs.length > 0 && (
          <div className="chat-diff-list">
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
            className={`chat-doc-card${proposedDoc.kind === 'plan' ? ' is-plan' : ''}`}
          >
            <div className="chat-doc-card-identity">
              <span className="chat-doc-kind-chip">
                📄 {proposedDoc.kind.toUpperCase()}
              </span>
              <div className="chat-doc-card-title">
                <strong>
                  &ldquo;{proposedDoc.title}&rdquo;
                </strong>
                <span className="chat-doc-card-meta">
                  — {proposedDoc.sections.length} section{proposedDoc.sections.length === 1 ? '' : 's'} · opened in editor
                </span>
              </div>
            </div>

            <div className="chat-doc-card-actions">
              <button
                type="button"
                className="chat-doc-btn"
                onClick={() => {
                  openDocument(proposedDoc);
                  setDocTabActive(true);
                }}
                title="Open and view full document in editor"
              >
                <Eye size={11} />
                <span>View in Editor</span>
              </button>

              {proposedDoc.kind === 'plan' && (
                <button
                  type="button"
                  className="chat-doc-btn chat-doc-btn-approve"
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
            className="chat-scope-rejection"
          >
            <div className="chat-scope-rejection-head">
              <div className="chat-scope-rejection-heading">
                <AlertCircle size={14} />
                <span className="chat-scope-rejection-title">
                  Scope Violation: Tool &ldquo;{message.scopeRejectionCard.toolName}&rdquo; Blocked
                </span>
              </div>
              <span className="chat-scope-rejection-mode">
                {message.scopeRejectionCard.mode} Mode ({message.scopeRejectionCard.scope})
              </span>
            </div>

            <div className="chat-scope-rejection-reason">
              {message.scopeRejectionCard.reason}
            </div>
            <div className="chat-scope-rejection-remedy">
              {message.scopeRejectionCard.remedy}
            </div>

            <div className="chat-scope-rejection-actions">
              <button
                id="btn-escalate-mode-build"
                type="button"
                className="chat-scope-btn-escalate"
                onClick={() => {
                  try {
                    const wsPath = useWorkspaceStore.getState().workspacePath || '';
                    useChatStore.getState().setAgentMode?.('build');
                    void useChatStore.getState().sendMessage(`Switch to BUILD mode and execute ${message.scopeRejectionCard?.toolName}.`, wsPath);
                  } catch (e) {
                    console.error('Failed to trigger BUILD escalation', e);
                  }
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
            className="chat-truncation-banner"
          >
            <div className="chat-truncation-message">
              <Clock size={13} />
              <span>Response paused at token limit.</span>
            </div>
            <button
              id="continue-generation-btn"
              type="button"
              className="chat-truncation-btn"
              onClick={() => {
                try {
                  const wsPath = useWorkspaceStore.getState().workspacePath || '';
                  void useChatStore.getState().sendMessage('Continue exactly where you stopped without repeating previous content.', wsPath);
                } catch (e) {
                  console.error('Failed to continue generation', e);
                }
              }}
            >
              <Zap size={10} fill="currentColor" />
              <span>Continue</span>
            </button>
          </div>
        )}

        {/* 5. ERROR CARD */}
        {message.errorCard && (
          <div className="message-error-slot">
            <ChatErrorCard errorCard={message.errorCard} onRetry={onRetryError} />
          </div>
        )}

        {/* 6. BOTTOM ACTIONS & HIDDEN METADATA DETAILS */}
        <div className="chat-message-footer">
          {/* Left: Metadata Details Toggle (Prompt/Response token counts hidden by default) */}
          <div className="chat-telemetry-anchor">
            <button
              type="button"
              className="chat-footer-btn"
              onClick={() => setShowDetails(!showDetails)}
              title="Toggle execution & token telemetry details"
            >
              <Info size={11} />
              <span>Details</span>
              <ChevronDown size={10} className={`chat-footer-chevron${showDetails ? ' is-open' : ''}`} />
            </button>

            {showDetails && (
              <div className="chat-telemetry-popover">
                <div className="chat-telemetry-title">
                  Message Telemetry
                </div>
                {[
                  ['Provider', String(badgeProviderId || 'routing…')],
                  ['Model', String(badgeModelLabel)],
                  ['Stream Events', String(message.metadata?.streamEventCount ?? 0)],
                  ...(message.metadata?.firstTokenAt
                    ? [['Time to First Token', `${Math.max(0, message.metadata.firstTokenAt - message.timestamp)}ms`]]
                    : []),
                  ...(cleanedAssistantContent ? [['Est. Response Tokens', `~${Math.round(cleanedAssistantContent.length / 4)}`]] : []),
                  ...(toolList.length > 0 ? [['Tools Executed', String(toolList.length)]] : []),
                  ...(message.routeTrail || message.routeFailure?.trail
                    ? [['Route Trail', message.routeTrail || message.routeFailure!.trail]]
                    : [])
                ].map(([label, value]) => (
                  <div key={label} className="chat-telemetry-row">
                    <span>{label}:</span>
                    <span className="chat-telemetry-value">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Quick actions (Copy, Regenerate) */}
          <div className="chat-message-actions">
            {hasTextContent && (
              <button
                type="button"
                className={`chat-remember-trigger chat-footer-btn${savedCorrectionSuccess ? ' is-remembered' : ''}`}
                onClick={() => {
                  setRememberRuleText(cleanedAssistantContent);
                  setShowRememberModal(!showRememberModal);
                }}
                title="Remember this preference in workspace Correction Memory"
              >
                {savedCorrectionSuccess ? (
                  <>
                    <Check size={11} />
                    <span>Remembered</span>
                  </>
                ) : (
                  <>
                    <Lightbulb size={11} className="chat-remember-bulb" />
                    <span>Remember</span>
                  </>
                )}
              </button>
            )}

            {showRememberModal && !isUser && (
              <div
                className="chat-remember-card chat-remember-pop"
              >
                <div className="chat-remember-card-header">
                  <div className="chat-remember-card-title">
                    <Lightbulb size={13} className="chat-remember-bulb" />
                    <span>Correction Memory</span>
                  </div>
                  <button
                    type="button"
                    className="chat-remember-card-close"
                    onClick={() => setShowRememberModal(false)}
                  >
                    ✕
                  </button>
                </div>

                <div className="chat-remember-hint">
                  Save this preference to your workspace audit ledger so the AI never repeats this mistake.
                </div>

                <div className="chat-remember-cats">
                  {(['style', 'architecture', 'stack'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`chat-remember-cat${rememberCategory === cat ? ' is-active' : ''}`}
                      onClick={() => setRememberCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <textarea
                  className="chat-remember-input"
                  value={rememberRuleText}
                  onChange={(e) => setRememberRuleText(e.target.value)}
                  rows={2}
                  placeholder="Rule (e.g. NEVER use var, use const or let)"
                />

                <div className="chat-remember-actions">
                  <button
                    type="button"
                    className="chat-remember-cancel"
                    onClick={() => setShowRememberModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="chat-remember-save"
                    onClick={handleSaveCorrection}
                    disabled={isSavingCorrection || !rememberRuleText.trim()}
                  >
                    {isSavingCorrection ? 'Remembering…' : 'Save Preference'}
                  </button>
                </div>
              </div>
            )}

            {hasTextContent && (
              <button
                type="button"
                className={`chat-footer-btn${copiedMessage ? ' is-copied' : ''}`}
                onClick={handleCopyMessage}
                title="Copy response"
              >
                {copiedMessage ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedMessage ? 'Copied' : 'Copy'}</span>
              </button>
            )}

            {isLastAssistant && !isRunning && onRegenerate && (
              <button
                type="button"
                className="chat-footer-btn"
                onClick={onRegenerate}
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

export const ChatMessageItem = React.memo(ChatMessageItemComponent);
export { ChatMessageItem as ChatMessage };
export default ChatMessageItem;
