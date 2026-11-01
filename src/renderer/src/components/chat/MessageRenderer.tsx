/**
 * Worker-Offloaded Message Renderer (Phase 2: Offloading the Main Thread)
 *
 * Offloads Markdown parsing and Syntax Highlighting to Web Workers to ensure
 * smooth 60fps rendering without micro-stutters during high-speed AI streaming.
 *
 * Typography & Motion (Prompt 1):
 * - Container CSS variables (--chat-font-family / --chat-font-size /
 *   --chat-line-height) are read from the closest chat message container so
 *   typography changes never re-enter the worker pipeline.
 * - Optional UK punctuation normaliser rewrites prose "AI punctuation"
 *   (em/en dashes, ellipses) at presentation time; fenced code blocks,
 *   inline code spans and numeric-range en dashes stay byte-for-byte
 *   identical and the stored transcript is never mutated.
 * - Optional Matrix decode animation: streaming text resolves from glyphs;
 *   on completion a scanline sweep plays once before final markdown reveal.
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import MarkdownParserWorker from '../../workers/markdown-parser.worker?worker';
import HighlightWorker from '../../workers/highlight.worker?worker';
import type { MarkdownWorkerResponse } from '../../workers/markdown-parser.worker';
import type { HighlightWorkerResponse } from '../../workers/highlight.worker';
import { useTypographyStore } from '../../state/typography-store';
import { copyTextOrNotify } from '../../lib/clipboard';
import { MatrixDecode } from './MatrixDecode';
import { ScrambleText } from './ScrambleText';
import { normalisePunctuation } from '../../services/punctuation-normaliser';

export interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
}

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

// Markup only — every visual property lives in the .code-shelf* rule family in
// ChatSidecar.css. `data-code` is load-bearing: handleContainerClick reads it.
function buildCodeShelfHtml(rawCode: string, language: string, highlightedHtml: string): string {
  const displayLang = language || 'code';
  const encoded = encodeURIComponent(rawCode);
  return `
<div class="code-shelf contain-content">
  <div class="code-shelf-header">
    <span class="code-shelf-lang">${escapeHtml(displayLang)}</span>
    <button type="button" class="code-shelf-copy-btn" data-code="${encoded}">
      Copy
    </button>
  </div>
  <pre class="code-shelf-pre">
    <code class="hljs ${displayLang ? 'language-' + escapeHtml(displayLang) : ''}">${highlightedHtml}</code>
  </pre>
</div>
`.trim();
}

/**
 * UK punctuation normaliser: delegating to the code-safe service.
 */
export function applyUkPunctuation(markdown: string): string {
  return normalisePunctuation(markdown);
}

/**
 * Strips raw textual tool-call XML blocks (e.g. `<tool_call>`, `<dots_function_call>`,
 * `<function_calls>`, `<invoke>`) and cleans up spacing artifacts around inline code
 * so model tool markup never leaks into the rendered chat prose.
 */
export function sanitizeAssistantDisplayContent(raw: string, isStreaming = false): string {
  if (!raw) return '';
  let text = raw
    // Strip fenced XML/JSON blocks wrapping tool calls
    .replace(/```(?:xml|json|tool_call)?\s*<(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)\b[\s\S]*?<\/(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)>\s*```/gi, '')
    // Strip closed XML tool call blocks
    .replace(/<(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)\b[^>]*>[\s\S]*?<\/(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    // Strip trailing unclosed tool-call block only when preceded by <dots_function_call> / <tool_call> / <function_calls> / <antml:function_calls>
    .replace(/<(?:tool_call|dots_function_call|function_calls|antml:function_calls)\b[\s\S]*$/gi, '')
    .replace(/<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g, '');

  if (!isStreaming) {
    text = text
      // Clean up stray spaces before punctuation right after inline backtick code: `path` . -> `path`.
      .replace(/(`[^`\n]+`)[ \t]+([.,;:!?])/g, '$1$2')
      // Collapse 3+ consecutive blank lines into a clean paragraph break
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return text;
}

// Shared worker singletons (Step 2: eliminate freeze causes)
// MessageRenderer is instantiated once per chat message — creating workers
// per instance multiplied highlight.js grammar sets across dozens of V8
// isolates (~1MB+ each). One shared worker per type serves all instances;
// responses are already multiplexed by request id in the message handlers.
let sharedMarkdownWorker: Worker | null = null;
let sharedHighlightWorker: Worker | null = null;

function getSharedMarkdownWorker(): Worker {
  if (!sharedMarkdownWorker) {
    sharedMarkdownWorker = new MarkdownParserWorker();
    sharedMarkdownWorker.addEventListener('error', () => { sharedMarkdownWorker = null; });
  }
  return sharedMarkdownWorker;
}

function getSharedHighlightWorker(): Worker {
  if (!sharedHighlightWorker) {
    sharedHighlightWorker = new HighlightWorker();
    sharedHighlightWorker.addEventListener('error', () => { sharedHighlightWorker = null; });
  }
  return sharedHighlightWorker;
}

const MessageRendererImpl: React.FC<MessageRendererProps> = ({ content, isStreaming = false }) => {
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const currentReqIdRef = useRef<string>('');

  // Markdown Swap Gating: keep plain scrambled view mounted until decode frontier settles
  const [isSettled, setIsSettled] = useState<boolean>(!isStreaming);

  const matrixDecodeEnabled = useTypographyStore((s) => s.matrixDecodeEnabled);
  const ukPunctuationEnabled = useTypographyStore((s) => s.ukPunctuationEnabled);

  useEffect(() => {
    if (isStreaming) {
      setIsSettled(false);
    }
  }, [isStreaming]);

  // If matrix decode is disabled in settings, don't gate markdown swap when stream ends
  useEffect(() => {
    if (!matrixDecodeEnabled && !isStreaming) {
      setIsSettled(true);
    }
  }, [matrixDecodeEnabled, isStreaming]);

  const handleSettled = useCallback(() => {
    setIsSettled(true);
  }, []);

  const normalizedContent = useMemo(
    () => normalisePunctuation(sanitizeAssistantDisplayContent(content, isStreaming), { enabled: ukPunctuationEnabled }),
    [content, isStreaming, ukPunctuationEnabled]
  );

  // Ensure settlement never deadlocks if stream finishes with empty content
  useEffect(() => {
    if (!isStreaming && !normalizedContent) {
      setIsSettled(true);
    }
  }, [isStreaming, normalizedContent]);

  // 1. Workers are shared singletons — never terminated per component
  // (the shared instance lives for the whole renderer lifetime).
  const markdownWorker = useMemo(() => getSharedMarkdownWorker(), []);
  const highlightWorker = useMemo(() => getSharedHighlightWorker(), []);

  // Main thread event delegation for copy buttons and external links embedded
  // in worker-generated HTML
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href]');
    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        void window.electronAPI?.openExternal?.(href);
        return;
      }
    }

    const target = (e.target as HTMLElement).closest('.code-shelf-copy-btn');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();

    const rawCode = target.getAttribute('data-code');
    if (rawCode) {
      const code = decodeURIComponent(rawCode);
      // One pipeline for every copy surface: the async API, then main, and a
      // toast with Retry if both fail. A swallowed rejection here is how a code
      // block ends up looking copied while the clipboard holds yesterday's text.
      void copyTextOrNotify(code, 'chat.code-shelf').then((result) => {
        if (!result.ok) return;
        const oldHtml = target.innerHTML;
        target.textContent = 'Copied';
        target.classList.add('is-copied');
        setTimeout(() => {
          target.innerHTML = oldHtml;
          target.classList.remove('is-copied');
        }, 1600);
      });
    }
  }, []);

  useEffect(() => {
    // 2. When message is streaming, render plain text (do not block on workers)
    if (isStreaming) {
      setRenderedHtml(null);
      return;
    }

    if (!normalizedContent) {
      setRenderedHtml('');
      return;
    }

    // 3. When stream finishes ([DONE]), send full markdown to Markdown Worker
    const reqId = crypto.randomUUID();
    currentReqIdRef.current = reqId;
    // Shared worker outlives this component: keep the highlight detach hook in
    // effect scope so a late response cannot touch an unmounted component.
    let detachHighlightListener: (() => void) | null = null;

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

      const DOMPURIFY_CONFIG = {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_TAGS: [
          'button', 'svg', 'path', 'line', 'rect', 'circle',
          'math', 'semantics', 'mrow', 'msup', 'msub', 'msubsup',
          'mi', 'mn', 'mo', 'annotation', 'span', 'div'
        ],
        ADD_ATTR: [
          'target', 'rel', 'data-code', 'type', 'aria-hidden',
          'style', 'class', 'xmlns', 'encoding', 'viewBox', 'd',
          'height', 'width', 'fill', 'stroke', 'preserveAspectRatio'
        ]
      };

      // If no code blocks, sanitize and commit immediately
      if (blocksMap.size === 0) {
        const sanitized = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
        setRenderedHtml(sanitized);
        return;
      }

      // Send code blocks to Highlight Worker
      const blocksToSend = Array.from(blocksMap.entries()).map(([blockId, val]) => ({
        blockId,
        code: val.code,
        language: val.language
      }));

      // Shared worker outlives this component: the highlight listener must be
      // reachable from the effect cleanup so a late response cannot touch an
      // unmounted component.
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

        // 5. Render final HTML using dangerouslySetInnerHTML (DOMPurify prevents XSS, allows KaTeX)
        const sanitized = DOMPurify.sanitize(assembledHtml, DOMPURIFY_CONFIG);

        setRenderedHtml(sanitized);
        highlightWorker.removeEventListener('message', onHighlightMessage);
      };

      highlightWorker.addEventListener('message', onHighlightMessage);
      highlightWorker.postMessage({ id: reqId, blocks: blocksToSend });
      detachHighlightListener = () => {
        highlightWorker.removeEventListener('message', onHighlightMessage);
      };
    };

    markdownWorker.addEventListener('message', onMarkdownMessage);
    markdownWorker.postMessage({ id: reqId, markdown: normalizedContent });

    return () => {
      markdownWorker.removeEventListener('message', onMarkdownMessage);
      detachHighlightListener?.();
    };
  }, [normalizedContent, isStreaming, markdownWorker, highlightWorker]);

  // Immediate fallback HTML using marked (GFM tables, bold, headings)
  // so finalized responses never flash or get stuck as raw markdown source
  const fallbackHtml = useMemo(() => {
    if (isStreaming || !normalizedContent) return null;
    try {
      const parsed = marked.parse(normalizedContent, { gfm: true, breaks: false }) as string;
      return DOMPurify.sanitize(parsed, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_TAGS: [
          'button', 'svg', 'path', 'line', 'rect', 'circle',
          'math', 'semantics', 'mrow', 'msup', 'msub', 'msubsup',
          'mi', 'mn', 'mo', 'annotation', 'span', 'div'
        ],
        ADD_ATTR: [
          'target', 'rel', 'data-code', 'type', 'aria-hidden',
          'style', 'class', 'xmlns', 'encoding', 'viewBox', 'd',
          'height', 'width', 'fill', 'stroke', 'preserveAspectRatio'
        ]
      });
    } catch {
      return null;
    }
  }, [normalizedContent, isStreaming]);

  const displayHtml = renderedHtml || fallbackHtml;

  // STREAM / DECODE SWEEP: plain text with ScrambleText (zero markdown AST during streaming or settle sweep)
  const showScrambleView = isStreaming || (!isSettled && matrixDecodeEnabled);

  if (showScrambleView) {
    return (
      <div
        className="message-content-streaming contain-content"
        style={{
          fontSize: 'var(--chat-font-size, 13px)',
          lineHeight: 'var(--chat-line-height, 1.65)',
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          fontFamily: 'var(--chat-font-family, inherit)',
          WebkitFontSmoothing: 'antialiased',
          userSelect: 'text',
          contain: 'content'
        }}
      >
        <ScrambleText
          text={normalizedContent}
          enabled={matrixDecodeEnabled}
          streaming={isStreaming}
          onSettled={handleSettled}
        />
      </div>
    );
  }

  if (!displayHtml) {
    return null;
  }

  // ON STREAM COMPLETE: Render rich HTML (with tables, headings, code blocks)
  return (
    <div
      className="markdown-content chat-message-markdown-html prose prose-invert prose-sm max-w-none contain-content"
      style={{
        fontSize: 'var(--chat-font-size, 13px)',
        lineHeight: 'var(--chat-line-height, 1.65)',
        color: 'var(--text-primary)',
        WebkitFontSmoothing: 'antialiased',
        userSelect: 'text',
        contain: 'content'
      }}
      onClick={handleContainerClick}
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  );
};

export const MessageRenderer = memo(MessageRendererImpl);

export default MessageRenderer;
