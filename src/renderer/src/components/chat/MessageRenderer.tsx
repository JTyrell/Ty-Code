import React, { useState, useEffect, useMemo } from 'react';
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
import { Check, Copy } from 'lucide-react';

// Syntax Highlighting setup (registered once at module scope)
const languages: Record<string, LanguageFn> = {
  bash,
  sh: bash,
  zsh: bash,
  css,
  diff,
  patch: diff,
  html: xml,
  xml,
  js: javascript,
  javascript,
  jsx: javascript,
  json,
  md: markdown,
  markdown,
  powershell,
  ps1: powershell,
  py: python,
  python,
  ts: typescript,
  typescript,
  tsx: typescript,
  yaml,
  yml: yaml
};

for (const [name, language] of Object.entries(languages)) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
}

// Shelf styles for code blocks
const CODE_SHELF_BG = '#0d0e11';
const CODE_SHELF_HEAD_BG = 'rgba(255, 255, 255, 0.03)';

const codeShelfStyle: React.CSSProperties = {
  margin: '10px 0',
  borderRadius: '10px',
  border: '1px solid var(--border-strong)',
  background: CODE_SHELF_BG,
  overflow: 'hidden',
  fontSize: '11px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)'
};

const codeShelfHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 10px',
  background: CODE_SHELF_HEAD_BG,
  borderBottom: '1px solid var(--border-strong)',
  fontSize: '11px',
  color: 'var(--text-muted)'
};

const codeShelfLangStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10.5px',
  color: 'var(--text-muted)',
  letterSpacing: '0.02em'
};

const codeShelfCopyStyle: React.CSSProperties = {
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

const codeShelfPreStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px',
  overflowX: 'auto',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  lineHeight: 1.6,
  fontSize: '11.5px',
  userSelect: 'text'
};

export interface CodeBlockProps {
  language?: string;
  value: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
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
    <div style={codeShelfStyle}>
      <div style={codeShelfHeaderStyle}>
        <span style={codeShelfLangStyle}>{language || 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          style={codeShelfCopyStyle}
          title="Copy code block"
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'var(--surface-3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = copied ? 'var(--accent-green)' : 'var(--text-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
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
      <pre style={codeShelfPreStyle}>
        <code
          className={`hljs${highlightLanguage ? ` language-${highlightLanguage}` : ''}`}
          style={{ background: 'transparent' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
};

export const markdownComponents: Components = {
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

export interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * MessageRenderer: Deferred Syntax Highlighting & Markdown Parsing
 * During Streaming: Render incoming text as plain, unstyled text with minimal inline styling.
 *                   Do NOT run react-markdown or highlight.js on high-frequency streaming tokens.
 * On Stream Complete: Triggers useEffect when isStreaming becomes false, executing the heavy
 *                     Markdown AST parsing and syntax highlighting exactly once.
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({ content, isStreaming = false }) => {
  const [parsedMarkdown, setParsedMarkdown] = useState<React.ReactNode | null>(() => {
    // If not streaming at initial mount (historical / stationary message), parse immediately
    return !isStreaming ? <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown> : null;
  });

  useEffect(() => {
    // When isStreaming becomes false, or when stationary content changes,
    // run the heavy Markdown AST parsing and syntax highlighting exactly once.
    if (!isStreaming) {
      setParsedMarkdown(
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
      );
    }
  }, [isStreaming, content]);

  // DURING ACTIVE STREAMING: Render fast, unstyled text (60fps guaranteed, zero AST thrashing)
  if (isStreaming || !parsedMarkdown) {
    return (
      <div
        className="message-content-streaming"
        style={{
          fontSize: '12px',
          lineHeight: 1.7,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
          userSelect: 'text'
        }}
      >
        {content}
        {isStreaming && (
          <span
            className="streaming-cursor"
            style={{
              display: 'inline-block',
              width: '6px',
              height: '13px',
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
              backgroundColor: 'var(--accent-primary, #60a5fa)',
              opacity: 0.8
            }}
          />
        )}
      </div>
    );
  }

  // ON STREAM COMPLETE: Render the heavy, highlighted markdown
  return (
    <div style={{ fontSize: '12px', lineHeight: 1.7, color: 'var(--text-primary)', userSelect: 'text' }}>
      {parsedMarkdown}
    </div>
  );
};

export default MessageRenderer;
