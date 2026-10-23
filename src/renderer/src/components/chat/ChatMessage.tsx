/**
 * ChatMessage Component & Worker-Driven Markdown Integration (Phase 2: Offloading the Main Thread)
 *
 * Implements extreme rendering optimization by offloading heavy Markdown parsing (marked)
 * and Syntax Highlighting (highlight.js) to Web Workers (markdown-parser.worker.ts and highlight.worker.ts),
 * eliminating main-thread layout thrashing and ensuring 60fps streaming.
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import MarkdownParserWorker from '../../workers/markdown-parser.worker?worker';
import HighlightWorker from '../../workers/highlight.worker?worker';
import type { MarkdownWorkerResponse } from '../../workers/markdown-parser.worker';
import type { HighlightWorkerResponse } from '../../workers/highlight.worker';
import {
  ChatMessageItem as UpstreamChatMessageItem,
  type ChatMessageProps as UpstreamChatMessageProps
} from '../ChatMessage';

// Re-export upstream types and MessageRenderer
export * from '../ChatMessage';
export { MessageRenderer } from './MessageRenderer';
export type { MessageRendererProps } from './MessageRenderer';

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCodeShelfHtml(rawCode: string, language: string, highlightedHtml: string): string {
  const displayLang = language || 'code';
  const encoded = encodeURIComponent(rawCode);
  return `
<div class="code-shelf contain-content" style="margin: 10px 0; border-radius: 10px; border: 1px solid var(--border-strong); background: #0d0e11; overflow: hidden; font-size: 11px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); contain: content;">
  <div class="code-shelf-header" style="display: flex; align-items: center; justify-content: space-between; padding: 5px 10px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid var(--border-strong); font-size: 11px; color: var(--text-muted); user-select: none;">
    <span class="code-shelf-lang" style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); letter-spacing: 0.02em;">${escapeHtml(displayLang)}</span>
    <button type="button" class="code-shelf-copy-btn" data-code="${encoded}" style="display: flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 5px; font-size: 10.5px; color: var(--text-muted); background: transparent; border: 1px solid transparent; cursor: pointer;">
      Copy
    </button>
  </div>
  <pre style="margin: 0; padding: 12px; overflow-x: auto; color: var(--text-primary); font-family: var(--font-mono); line-height: 1.6; font-size: 11.5px; user-select: text;">
    <code class="hljs ${displayLang ? 'language-' + escapeHtml(displayLang) : ''}" style="background: transparent;">${highlightedHtml}</code>
  </pre>
</div>
`.trim();
}

/**
 * WorkerMessageRenderer: Encapsulates the 5-step Web Worker Markdown & Syntax Highlighting pipeline:
 * 1. Initializes workers using useMemo to prevent recreation.
 * 2. When message is streaming, renders unstyled plain text with a cursor.
 * 3. When stream finishes ([DONE]), dispatches markdown to MarkdownParserWorker.
 * 4. Extracts code blocks from worker HTML and pipes them to HighlightWorker.
 * 5. Assembles styled code shelves, sanitizes with DOMPurify, and renders safely via dangerouslySetInnerHTML.
 */
export const WorkerMessageRenderer: React.FC<{ content: string; isStreaming?: boolean }> = ({
  content,
  isStreaming = false
}) => {
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const currentReqIdRef = useRef<string>('');

  // 1. Initialize workers using useMemo to prevent recreation across re-renders
  const markdownWorker = useMemo(() => new MarkdownParserWorker(), []);
  const highlightWorker = useMemo(() => new HighlightWorker(), []);

  // Worker lifecycle cleanup
  useEffect(() => {
    return () => {
      markdownWorker.terminate();
      highlightWorker.terminate();
    };
  }, [markdownWorker, highlightWorker]);

  // Event delegation for copy buttons in worker-generated HTML
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('.code-shelf-copy-btn');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();

    const rawCode = target.getAttribute('data-code');
    if (rawCode) {
      const code = decodeURIComponent(rawCode);
      navigator.clipboard
        .writeText(code)
        .then(() => {
          const oldHtml = target.innerHTML;
          target.textContent = 'Copied';
          (target as HTMLElement).style.color = 'var(--accent-green)';
          setTimeout(() => {
            target.innerHTML = oldHtml;
            (target as HTMLElement).style.color = 'var(--text-muted)';
          }, 1600);
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // 2. When message is streaming, render plain text (do not block on workers)
    if (isStreaming) {
      setRenderedHtml(null);
      return;
    }

    if (!content) {
      setRenderedHtml('');
      return;
    }

    // 3. When stream finishes ([DONE]), send full markdown to Markdown Worker
    const reqId = crypto.randomUUID();
    currentReqIdRef.current = reqId;

    const onMarkdownMessage = (e: MessageEvent<MarkdownWorkerResponse>) => {
      const data = e.data;
      if (data.id !== currentReqIdRef.current) return;

      const rawHtml = data.html || '';

      // 4. Once HTML is returned, parse code blocks and send to Highlight Worker
      const codeBlockRegex = /<pre><code(?:\s+class="(?:language-)?([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi;
      let blockIndex = 0;
      const blocksMap = new Map<string, { code: string; language: string }>();

      const placeholderHtml = rawHtml.replace(codeBlockRegex, (_match, lang, codeContent) => {
        const blockId = `__TYCODE_BLOCK_${blockIndex++}__`;
        const unescapedCode = decodeHtmlEntities(codeContent || '');
        blocksMap.set(blockId, {
          code: unescapedCode,
          language: (lang || '').trim()
        });
        return blockId;
      });

      // If no code blocks, sanitize and commit immediately
      if (blocksMap.size === 0) {
        const sanitized = DOMPurify.sanitize(rawHtml, {
          ADD_TAGS: ['button', 'svg', 'path'],
          ADD_ATTR: ['target', 'rel', 'data-code', 'type'],
          USE_PROFILES: { html: true }
        });
        setRenderedHtml(sanitized);
        return;
      }

      // Send code blocks to Highlight Worker
      const blocksToSend = Array.from(blocksMap.entries()).map(([blockId, val]) => ({
        blockId,
        code: val.code,
        language: val.language
      }));

      const onHighlightMessage = (hEvent: MessageEvent<HighlightWorkerResponse>) => {
        const hData = hEvent.data;
        if (hData.id !== currentReqIdRef.current) return;

        const highlightedMap = new Map<string, string>();
        if (Array.isArray(hData.blocks)) {
          for (const b of hData.blocks) {
            highlightedMap.set(b.blockId, b.html);
          }
        }

        // Assemble HTML by substituting placeholders with styled code shelves
        let assembledHtml = placeholderHtml;
        for (const [blockId, info] of blocksMap.entries()) {
          const highlightedCodeHtml = highlightedMap.get(blockId) || escapeHtml(info.code);
          const shelfHtml = buildCodeShelfHtml(info.code, info.language, highlightedCodeHtml);
          assembledHtml = assembledHtml.split(blockId).join(shelfHtml);
        }

        // 5. Render final HTML using dangerouslySetInnerHTML (DOMPurify prevents XSS)
        const sanitized = DOMPurify.sanitize(assembledHtml, {
          ADD_TAGS: ['button', 'svg', 'path'],
          ADD_ATTR: ['target', 'rel', 'data-code', 'type'],
          USE_PROFILES: { html: true }
        });

        setRenderedHtml(sanitized);
        highlightWorker.removeEventListener('message', onHighlightMessage);
      };

      highlightWorker.addEventListener('message', onHighlightMessage);
      highlightWorker.postMessage({ id: reqId, blocks: blocksToSend });
    };

    markdownWorker.addEventListener('message', onMarkdownMessage);
    markdownWorker.postMessage({ id: reqId, markdown: content });

    return () => {
      markdownWorker.removeEventListener('message', onMarkdownMessage);
    };
  }, [content, isStreaming, markdownWorker, highlightWorker]);

  // DURING ACTIVE STREAMING: Render fast, unstyled plain text with streaming cursor
  if (isStreaming || renderedHtml === null) {
    return (
      <div
        className="message-content-streaming contain-content"
        style={{
          fontSize: '12px',
          lineHeight: 1.7,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
          userSelect: 'text',
          contain: 'content'
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

  // ON STREAM COMPLETE: Render worker-parsed, highlighted, and DOMPurify-sanitized HTML
  return (
    <div
      className="markdown-content chat-message-markdown-html contain-content"
      style={{
        fontSize: '12px',
        lineHeight: 1.7,
        color: 'var(--text-primary)',
        userSelect: 'text',
        contain: 'content'
      }}
      onClick={handleContainerClick}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
};

export interface ChatMessageProps extends UpstreamChatMessageProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * ChatMessage Component: renders a chat message with isolated CSS containment
 * and worker-offloaded markdown and syntax highlighting.
 */
export const ChatMessage: React.FC<ChatMessageProps> = (props) => {
  return <UpstreamChatMessageItem {...props} />;
};

export const ChatMessageItem: React.FC<ChatMessageProps> = ChatMessage;
export default ChatMessage;
