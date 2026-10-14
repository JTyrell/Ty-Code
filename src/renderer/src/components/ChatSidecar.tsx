import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ChatSidecar.css';
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
import { Send, Square, Sparkles, Trash2, ChevronRight, ChevronDown, Terminal, FileCode, Check, Eye, AlertCircle, Copy, RotateCcw, Loader2, ShieldCheck, X } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import type { ChatMessage, ToolCall, ToolExecutionStatus } from '../../../preload/types';

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

interface CodeBlockProps { language?: string; value: string; }

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language?.toLowerCase() || '';
  const highlightLanguage = languages[normalizedLanguage] ? normalizedLanguage : '';
  const highlighted = useMemo(() => highlightLanguage
    ? hljs.highlight(value, { language: highlightLanguage }).value
    : hljs.highlightAuto(value).value, [highlightLanguage, value]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return <div className="code-block">
    <div className="code-block-header"><span>{language || 'code'}</span>
      <button onClick={() => void handleCopy()} title="Copy code" aria-label="Copy code block">
        {copied ? <><Check size={11} color="var(--accent-green)" /><span>Copied</span></> : <><Copy size={11} /><span>Copy</span></>}
      </button>
    </div>
    <pre><code className={`hljs${highlightLanguage ? ` language-${highlightLanguage}` : ''}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
  </div>;
};

const markdownComponents: Components = {
  pre({ children }) { return <>{children}</>; },
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/.exec(className || '')?.[1];
    const value = String(children).replace(/\n$/, '');
    if (language || value.includes('\n')) return <CodeBlock language={language} value={value} />;
    return <code className={className} {...props}>{children}</code>;
  }
};

function MarkdownContent({ content }: { content: string }): React.ReactElement {
  return <div className="markdown-content"><ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown></div>;
}

interface ToolCardProps { tool: ToolCall; status?: ToolExecutionStatus; output?: string; }

const ToolCard: React.FC<ToolCardProps> = ({ tool, status, output }) => {
  const [expanded, setExpanded] = useState(false);
  const isError = status === 'error';
  return <section className="tool-card">
    <button className="tool-header" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tool.name} tool details`} style={{ color: isError ? 'var(--accent-red)' : status === 'running' ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Terminal size={12} color="var(--accent-primary)" />
        <strong>{tool.name}</strong><span style={{ color: 'var(--text-muted)' }}>({Object.keys(tool.arguments || {}).length} args)</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {status === 'running' && <span className="tool-status is-running"><Loader2 size={11} className="animate-spin" />Running</span>}
        {status === 'success' && <span className="tool-status is-success"><Check size={11} />Success</span>}
        {status === 'error' && <span className="tool-status is-error"><AlertCircle size={11} />Failed</span>}
        {status === 'cancelled' && <span className="tool-status is-cancelled">Stopped</span>}
      </span>
    </button>
    {expanded && <div className="tool-body">
      <div style={{ marginBottom: 8, color: 'var(--accent-cyan)' }}><strong>Input:</strong>{' '}{JSON.stringify(tool.arguments, null, 2)}</div>
      {output !== undefined && <div><strong style={{ color: isError ? 'var(--accent-red)' : 'var(--text-secondary)' }}>Output:</strong><div style={{ marginTop: 4 }}>{output}</div></div>}
    </div>}
  </section>;
};

function DiffCard({ diff: proposedDiff, onInspect, onApply }: {
  diff: NonNullable<ChatMessage['proposedDiffs']>[number]; onInspect: () => void; onApply: () => void;
}): React.ReactElement {
  return <div className="diff-card">
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 11, fontWeight: 600 }}><FileCode size={13} color="var(--accent-primary)" /><span style={{ overflowWrap: 'anywhere' }}>{proposedDiff.filePath}</span></div>
      <span style={{ flexShrink: 0, color: 'var(--accent-amber)', fontSize: 10 }}>Ready to review</span>
    </div>
    <div className="diff-actions">
      <button onClick={onInspect} style={{ padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', fontSize: 11 }}><Eye size={12} />Inspect</button>
      <button onClick={onApply} style={{ padding: '4px 8px', background: 'var(--accent-green)', color: '#fff', fontSize: 11 }}><Check size={12} />Apply</button>
    </div>
  </div>;
}

export const ChatSidecar: React.FC = () => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const userAtBottomRef = useRef(true);
  const { messages, isRunning, currentStatus, currentThought, streamingText, pendingApproval, sendMessage, stopTask, respondToApproval, clearChat } = useChatStore();
  const [approvalSending, setApprovalSending] = useState(false);
  const { workspacePath, activeTabPath, openTabs, openDiffReview, applyDiff } = useWorkspaceStore();
  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const firstTokenPending = isRunning && !streamingText && !currentThought && !messages.some((message) => message.role === 'tool' && message.toolStatus === 'running');

  const handleScroll = () => {
    const feed = feedRef.current;
    if (feed) userAtBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  };
  useEffect(() => {
    if (!userAtBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }));
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streamingText, currentThought, currentStatus]);

  const sendPrompt = (prompt: string, appendUserMessage = true) => {
    userAtBottomRef.current = true;
    void sendMessage(prompt, workspacePath, activeTab?.path, activeTab?.content, appendUserMessage);
  };
  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!input.trim() || isRunning) return;
    const prompt = input.trim();
    setInput('');
    sendPrompt(prompt);
  };
  const handleRegenerate = () => {
    if (!isRunning && lastUserMessage) sendPrompt(lastUserMessage.content, false);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(); }
  };

  return <aside className="chat-sidecar">
    <header className="chat-header">
      <div className="chat-header-title"><Sparkles size={14} color="var(--accent-primary)" /><span>Assistant Sidecar</span></div>
      <div className="chat-header-actions">
        {currentStatus && <span className="chat-status"><Loader2 size={10} className="animate-spin" /><span>{currentStatus}</span></span>}
        <button onClick={clearChat} title="Clear chat history" aria-label="Clear chat history" className="chat-icon-button"><Trash2 size={13} /></button>
      </div>
    </header>

    <div ref={feedRef} onScroll={handleScroll} className="chat-feed" aria-live="polite">
      {messages.length === 0 && !streamingText && <div className="chat-empty-state"><Sparkles size={30} color="var(--border-strong)" /><strong>How can Ty-Code help you today?</strong><span>Explore your workspace, implement a feature, fix a bug, or run a test suite.</span></div>}
      {messages.map((message) => <article key={message.id} className={`chat-message is-${message.role}`}>
        {message.role === 'user' ? <div className="user-message-bubble">{message.content}</div> : <div className="assistant-message-bubble">
          {message.toolCall && <ToolCard tool={message.toolCall} status={message.toolStatus} output={message.toolResult?.output ?? (message.toolStatus === 'running' ? undefined : message.content || undefined)} />}
          {message.toolCalls?.map((tool: ToolCall) => <ToolCard key={tool.id} tool={tool} />)}
          {message.proposedDiffs?.map((proposedDiff) => <DiffCard key={proposedDiff.id} diff={proposedDiff} onInspect={() => openDiffReview(proposedDiff)} onApply={() => void applyDiff(proposedDiff)} />)}
          {message.content && <MarkdownContent content={message.content} />}
          {message.reasoning && <details className="chat-reasoning"><summary>Reasoning summary</summary><div>{message.reasoning}</div></details>}
          {message.id === lastAssistantId && !isRunning && lastUserMessage && <div className="assistant-message-actions"><button onClick={handleRegenerate} title="Regenerate last response"><RotateCcw size={11} />Regenerate</button></div>}
        </div>}
      </article>)}
      {streamingText && <article className="chat-message is-assistant"><div className="assistant-message-bubble"><MarkdownContent content={streamingText} /></div></article>}
      {pendingApproval && <article className="agent-approval" role="alert" aria-labelledby="agent-approval-title">
        <div className="agent-approval-heading"><ShieldCheck size={15} /><div><strong id="agent-approval-title">Approval required</strong><span>{pendingApproval.reason}</span></div></div>
        <div className="agent-approval-tool"><strong>{pendingApproval.toolCall.name}</strong><pre>{JSON.stringify(pendingApproval.toolCall.arguments, null, 2)}</pre></div>
        {pendingApproval.affectedPaths && pendingApproval.affectedPaths.length > 0 && <div className="agent-approval-paths"><strong>Potentially affected paths</strong><ul>{pendingApproval.affectedPaths.map((path) => <li key={path}>{path}</li>)}</ul></div>}
        <div className="agent-approval-actions">
          <button className="agent-approval-decline" disabled={approvalSending} onClick={async () => { setApprovalSending(true); try { await respondToApproval(false); } finally { setApprovalSending(false); } }}><X size={12} />Deny</button>
          <button className="agent-approval-accept" disabled={approvalSending} onClick={async () => { setApprovalSending(true); try { await respondToApproval(true); } finally { setApprovalSending(false); } }}><Check size={12} />Approve operation</button>
        </div>
        <span className="agent-approval-note">The protected Git or destructive shell command will not run until approved. The request expires after two minutes.</span>
      </article>}
      {currentThought && <div className="chat-reasoning is-live"><strong>Reasoning</strong><span>{currentThought}</span></div>}
      {firstTokenPending && <div className="chat-typing-indicator" role="status"><Loader2 size={12} className="animate-spin" color="var(--accent-primary)" /><span>Ty-Code is thinking…</span></div>}
      <div ref={messagesEndRef} />
    </div>

    <form onSubmit={handleSubmit} className="chat-composer">
      <div className="chat-composer-field">
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Ty-Code… (Enter to send)" aria-label="Message Ty-Code" rows={3} />
        {isRunning ? <button type="button" onClick={() => void stopTask()} className="chat-send-button is-stop" title="Stop agent" aria-label="Stop agent"><Square size={12} /></button>
          : <button type="submit" disabled={!input.trim()} className="chat-send-button" title="Send message" aria-label="Send message"><Send size={13} /></button>}
      </div>
      <div className="chat-composer-hint">Shift+Enter for a new line</div>
    </form>
  </aside>;
};
