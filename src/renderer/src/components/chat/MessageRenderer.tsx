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
 * UK punctuation normaliser: delegating to the code-safe service.
 */
export function applyUkPunctuation(markdown: string): string {
  return normalisePunctuation(markdown);
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
    () => normalisePunctuation(content, { enabled: ukPunctuationEnabled }),
    [content, ukPunctuationEnabled]
  );

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
      navigator.clipboard.writeText(code).then(() => {
        const oldHtml = target.innerHTML;
        target.textContent = 'Copied';
        (target as HTMLElement).style.color = 'var(--accent-green)';
        setTimeout(() => {
          target.innerHTML = oldHtml;
          (target as HTMLElement).style.color = 'var(--text-muted)';
        }, 1600);
      }).catch(() => undefined);
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
      const parsed = marked.parse(normalizedContent, { gfm: true, breaks: true }) as string;
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
          fontSize: 'var(--chat-font-size, 12px)',
          lineHeight: 'var(--chat-line-height, 1.7)',
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--chat-font-family, inherit)',
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
        fontSize: 'var(--chat-font-size, 12px)',
        lineHeight: 'var(--chat-line-height, 1.7)',
        color: 'var(--text-primary)',
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
