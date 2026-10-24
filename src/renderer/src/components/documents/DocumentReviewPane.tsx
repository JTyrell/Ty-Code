import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import Editor from '@monaco-editor/react';
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
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  FileText,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Save,
  Send,
  X,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import {
  useDocumentReviewStore,
  type DocumentReviewStatus
} from '../../state/document-review-store';
import { useChatStore } from '../../state/chat-store';
import type { AgentDocument, AgentDocumentSection } from '../../../../preload/types';
import { useThemeSync, getMonacoTheme } from '../../hooks/useThemeSync';

// Register highlight.js languages for code blocks
const HLJS_LANGS: Record<string, LanguageFn> = {
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
for (const [name, lang] of Object.entries(HLJS_LANGS)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang);
}

// ---------------------------------------------------------------------------
// Markdown Code Block Component with Syntax Highlighting & Copy
// ---------------------------------------------------------------------------
interface CodeBlockProps {
  language?: string;
  codeString: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, codeString }) => {
  const [copied, setCopied] = useState(false);

  const highlightedHtml = useMemo(() => {
    const lang = (language || 'plaintext').toLowerCase();
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(codeString, { language: lang, ignoreIllegals: true }).value;
      } catch {
        // Fallback to plain text escaping
      }
    }
    try {
      return hljs.highlightAuto(codeString).value;
    } catch {
      return codeString
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [codeString, language]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg border border-[#2e3440] bg-[#0d0e11] overflow-hidden text-xs shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[rgba(255,255,255,0.03)] border-b border-[#2e3440] text-[11px] text-gray-400">
        <span className="font-mono text-gray-400 uppercase tracking-wider text-[10px]">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-gray-400 hover:text-white hover:bg-[#23272e] transition-colors"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-[12px] leading-relaxed text-gray-200 m-0">
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Custom Markdown Components for Consistent Dark-Theme Typography
// ---------------------------------------------------------------------------
const customMarkdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children || '').replace(/\n$/, '');
    const isInline = !match && !codeString.includes('\n');

    if (isInline) {
      return (
        <code
          className="px-1.5 py-0.5 rounded bg-[#1e222b] text-[#e5e9f0] font-mono text-[11px] border border-[#2e3440]"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock language={match ? match[1] : undefined} codeString={codeString} />;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded border border-[#2e3440]">
        <table className="w-full text-left text-xs border-collapse divide-y divide-[#2e3440]">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-[#1b1e24] text-gray-300 font-semibold">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-[#23272e] bg-[#111317]">{children}</tbody>;
  },
  th({ children }) {
    return <th className="px-3 py-2 text-xs font-semibold text-gray-200">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-2 text-xs text-gray-300">{children}</td>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-4 border-indigo-500 pl-3 py-1 text-gray-400 italic bg-[#171a21]/50 rounded-r">
        {children}
      </blockquote>
    );
  },
  ul({ children }) {
    return <ul className="my-2 pl-5 list-disc space-y-1 text-gray-300">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 pl-5 list-decimal space-y-1 text-gray-300">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-gray-300 text-xs leading-relaxed">{children}</li>;
  },
  p({ children }) {
    return <p className="my-2 text-xs leading-relaxed text-gray-300">{children}</p>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
      >
        {children}
      </a>
    );
  }
};

// ---------------------------------------------------------------------------
// SectionBlock Component: Renders a section with inline hover comment button
// ---------------------------------------------------------------------------
interface SectionBlockProps {
  section: AgentDocumentSection;
  index: number;
  comments: string[];
  isUpdated?: boolean;
  onAddComment: (comment: string) => void;
  disabled?: boolean;
}

const SectionBlock: React.FC<SectionBlockProps> = ({
  section,
  index,
  comments,
  isUpdated = false,
  onAddComment,
  disabled = false
}) => {
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Extract the heading title vs the remaining markdown body
  const bodyMarkdown = useMemo(() => {
    // Strip leading heading line (# Title) if present in the section markdown
    return section.markdown.replace(/^#{1,6}\s+[^\r\n]*(?:\r?\n|$)/, '').trim();
  }, [section.markdown]);

  const handleSendComment = () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    onAddComment(trimmed);
    setCommentText('');
    setIsComposerOpen(false);
  };

  const headingClasses = useMemo(() => {
    switch (section.level) {
      case 1:
        return 'text-lg font-bold text-gray-100 pb-1 border-b border-[#2e3440]';
      case 2:
        return 'text-base font-semibold text-gray-100 pb-0.5 border-b border-[#2e3440]/60';
      case 3:
        return 'text-sm font-semibold text-gray-200';
      default:
        return 'text-xs font-semibold text-gray-300';
    }
  }, [section.level]);

  return (
    <section id={section.id} className="group relative my-4 rounded-lg doc-review-section bg-[#14171d]/60 p-3.5 border border-[#23272e] hover:border-[#2e3440] transition-colors">
      {/* Heading Row with hover comment bubble */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[#1f242d] text-gray-400">
            {index + 1}
          </span>
          <h3 className={`flex-1 min-w-0 truncate m-0 ${headingClasses}`}>
            {section.heading}
          </h3>
          {isUpdated && (
            <span
              id={`section-updated-${section.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex-shrink-0"
              title="This section was updated in response to review feedback"
            >
              <Sparkles size={10} />
              Updated
            </span>
          )}
        </div>

        {/* Action: Add feedback to section */}
        {!disabled && (
          <button
            type="button"
            onClick={() => setIsComposerOpen((prev) => !prev)}
            className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 rounded text-xs ${
              isComposerOpen
                ? 'bg-indigo-600/30 text-indigo-300 opacity-100'
                : 'text-gray-400 hover:text-white hover:bg-[#23272e]'
            }`}
            title="Leave feedback on this section for the agent"
          >
            <MessageSquarePlus size={14} />
            <span className="text-[11px]">Feedback</span>
          </button>
        )}
      </div>

      {/* Section Markdown Body */}
      {bodyMarkdown ? (
        <div className="text-gray-300 text-xs">
          <ReactMarkdown components={customMarkdownComponents}>
            {bodyMarkdown}
          </ReactMarkdown>
        </div>
      ) : null}

      {/* Existing Comments / Annotations Chips */}
      {comments && comments.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[#23272e] pt-2.5">
          <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
            <MessageSquare size={11} />
            Queued Feedback ({comments.length})
          </span>
          {comments.map((c, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded bg-indigo-950/20 border border-indigo-900/30 text-xs text-indigo-200"
            >
              <span className="text-indigo-400 text-[10px] font-mono mt-0.5">#{i + 1}</span>
              <p className="m-0 text-xs flex-1 text-gray-300 leading-normal">{c}</p>
            </div>
          ))}
        </div>
      )}

      {/* Inline Comment Composer */}
      {isComposerOpen && (
        <div className="mt-3 p-3 rounded-md bg-[#191d24] border border-indigo-500/40 shadow-lg animate-fadeIn">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-gray-300 flex items-center gap-1.5">
              <MessageSquarePlus size={13} className="text-indigo-400" />
              Feedback on &ldquo;{section.heading}&rdquo;
            </span>
            <button
              type="button"
              onClick={() => setIsComposerOpen(false)}
              className="text-gray-500 hover:text-gray-300 p-0.5 rounded"
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Type feedback or instructions for this section. It will be queued for the agent..."
            rows={2}
            className="w-full rounded bg-[#0f1115] border border-[#2e3440] p-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none font-sans"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSendComment();
              }
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-gray-500">
              Press <kbd className="px-1 py-0.5 rounded bg-[#23272e] text-gray-400">Ctrl+Enter</kbd> to queue
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsComposerOpen(false)}
                className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#23272e] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendComment}
                disabled={!commentText.trim()}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors shadow-sm"
              >
                <Send size={12} />
                Send to Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Main DocumentReviewPane Component
// ---------------------------------------------------------------------------
export const DocumentReviewPane: React.FC = () => {
  const activeDocument = useDocumentReviewStore((s) => s.activeDocument);
  const mode = useDocumentReviewStore((s) => s.mode);
  const comments = useDocumentReviewStore((s) => s.comments);
  const status = useDocumentReviewStore((s) => s.status);
  const setMode = useDocumentReviewStore((s) => s.setMode);
  const addComment = useDocumentReviewStore((s) => s.addComment);
  const setStatus = useDocumentReviewStore((s) => s.setStatus);
  const updateDocumentMarkdown = useDocumentReviewStore((s) => s.updateDocumentMarkdown);
  const updatedSectionIds = useDocumentReviewStore((s) => s.updatedSectionIds);

  const currentTaskId = useChatStore((s) => s.currentTaskId);
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const setDraftPrompt = useChatStore((s) => s.setDraftPrompt);
  const queueMessage = useChatStore((s) => s.queueMessage);

  const theme = useThemeSync();
  const monacoTheme = getMonacoTheme(theme);
  const [editMarkdown, setEditMarkdown] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeDocument) {
      setEditMarkdown(activeDocument.markdown);
    }
  }, [activeDocument?.id, activeDocument?.markdown]);

  if (!activeDocument) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-gray-500 text-sm">
        No document proposed for review.
      </div>
    );
  }

  // Handle proceed execution for plan documents
  const handleProceed = async () => {
    if (!activeDocument) return;

    // 1. Resolve pending approval IPC if waiting
    if (pendingApproval) {
      await respondToApproval(true);
    } else if (window.electronAPI?.sendApprovalResponse) {
      try {
        await window.electronAPI.sendApprovalResponse(`plan_${activeDocument.id}`, 'APPROVED');
      } catch {
        // Handled gracefully
      }
    }

    // 2. Set agent mode to execute / build
    setAgentMode('build' as any);
    if (window.electronAPI?.setAgentMode) {
      void window.electronAPI.setAgentMode('execute');
    }

    // 3. Update review status
    setStatus('approved');
  };

  // Handle request changes / request revision
  const handleRequestRevision = () => {
    if (!activeDocument) return;
    const isPlan = activeDocument.kind === 'plan';
    const contextPrefix = `Regarding ${isPlan ? 'Execution Plan' : 'Report'} "${activeDocument.title}": `;
    setDraftPrompt(contextPrefix);
    setStatus('revision-requested');
  };

  // Handle Save & Preview in Edit Mode
  const handleSaveAndPreview = async () => {
    if (!activeDocument) return;
    setIsSaving(true);
    try {
      if (window.electronAPI?.updateDocument) {
        const res = await window.electronAPI.updateDocument({
          id: activeDocument.id,
          markdown: editMarkdown,
          title: activeDocument.title
        });
        if (res?.success && res.data) {
          updateDocumentMarkdown(res.data.markdown);
        } else {
          updateDocumentMarkdown(editMarkdown);
        }
      } else {
        updateDocumentMarkdown(editMarkdown);
      }
      setMode('preview');
    } catch {
      updateDocumentMarkdown(editMarkdown);
      setMode('preview');
    } finally {
      setIsSaving(false);
    }
  };

  const isApproved = status === 'approved';
  const isPlan = activeDocument.kind === 'plan';

  return (
    <div className="flex h-full w-full flex-col doc-review-pane bg-[#0f1115] text-gray-100 overflow-hidden font-sans select-text">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Sticky Header                                                    */}
      {/* ------------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 flex min-h-[46px] items-center justify-between border-b border-[#23272e] doc-review-header bg-[#14171d]/95 px-4 backdrop-blur-sm shadow-sm">
        {/* Left: Kind Badge & Title */}
        <div className="flex items-center gap-3 min-w-0 mr-4">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
              isPlan
                ? 'bg-blue-950/40 text-blue-400 border-blue-800/50'
                : 'bg-purple-950/40 text-purple-300 border-purple-800/50'
            }`}
          >
            {activeDocument.kind}
          </span>
          <h2 className="text-sm font-semibold text-gray-100 truncate m-0">
            {activeDocument.title}
          </h2>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">
            {activeDocument.sections.length} {activeDocument.sections.length === 1 ? 'section' : 'sections'}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {mode === 'edit' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditMarkdown(activeDocument.markdown);
                  setMode('preview');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-[#23272e] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAndPreview}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-sm"
              >
                <Save size={13} />
                <span>{isSaving ? 'Saving…' : 'Save & Preview'}</span>
              </button>
            </>
          ) : isApproved ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs font-medium">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span>Approved — executing</span>
              {currentTaskId && (
                <span className="text-[10px] text-emerald-400/80 font-mono flex items-center gap-1 ml-1">
                  ({currentTaskId})
                </span>
              )}
            </div>
          ) : (
            <>
              {/* Context-dependent Actions */}
              {isPlan && (
                <button
                  type="button"
                  onClick={handleProceed}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition-colors shadow-sm shadow-emerald-950/50"
                  title="Approve this plan and proceed with execution"
                >
                  <CheckCircle2 size={13} />
                  <span>Proceed with Execution</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white bg-[#1e222b] hover:bg-[#282e3a] border border-[#2e3440] transition-colors"
                title="Edit markdown directly"
              >
                <Edit3 size={13} />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={handleRequestRevision}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-amber-300 hover:text-amber-200 bg-amber-950/20 hover:bg-amber-950/40 border border-amber-900/40 transition-colors"
                title={isPlan ? 'Request changes to this plan' : 'Request a revision for this report'}
              >
                {isPlan ? <MessageSquare size={13} /> : <RotateCcw size={13} />}
                <span>{isPlan ? 'Request Changes' : 'Request Revision'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Body: Preview Mode (Markdown Sections) or Edit Mode (Monaco)       */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {mode === 'edit' ? (
          <div className="h-full w-full">
            <Editor
              language="markdown"
              value={editMarkdown}
              onChange={(val) => setEditMarkdown(val || '')}
              theme={monacoTheme}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                lineNumbers: 'on',
                wordWrap: 'on',
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
            />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-6">
            {/* Document Header Banner */}
            <div className="mb-6 pb-4 border-b border-[#23272e]">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                <FileText size={14} className="text-indigo-400" />
                <span>Structured Agent {isPlan ? 'Execution Plan' : 'Analysis Report'}</span>
                <span>•</span>
                <span>{new Date(activeDocument.createdAt).toLocaleTimeString()}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 tracking-tight m-0">
                {activeDocument.title}
              </h1>
            </div>

            {/* Sections Container */}
            <div className="space-y-4">
              {activeDocument.sections.map((section, idx) => (
                <SectionBlock
                  key={section.id}
                  section={section}
                  index={idx}
                  comments={comments[section.id] || []}
                  isUpdated={updatedSectionIds.includes(section.id)}
                  onAddComment={(text) => {
                    addComment(section.id, text);
                    queueMessage(`[FEEDBACK ON SECTION: ${section.heading}] ${text}`);
                  }}
                  disabled={isApproved}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentReviewPane;
