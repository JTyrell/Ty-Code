/**
 * Help menu document viewer (Prompt 5b Step 5, groups G1 and G2).
 *
 * One panel serves four menu rows — Ty-Code Documentation, Show Release Notes,
 * View License and Privacy Policy — because they differ only in which document
 * id they ask main for. The id is store state rather than a prop, so opening a
 * second document while the first is still on screen replaces it instead of
 * stacking a modal over a modal.
 *
 * Four decisions in here are load-bearing rather than stylistic.
 *
 *  - **`marked` + `DOMPurify`, not `react-markdown`.** The README's Feature
 *    Deep-Dive is a GitHub-flavoured table, and `remark-gfm` is not a
 *    dependency of this project — `react-markdown` without it renders that
 *    table as a paragraph of literal pipe characters, which reads as a broken
 *    panel on the first document a demo visitor opens. `marked` is already
 *    installed and already handles GFM, and `chat/MessageRenderer.tsx` already
 *    sanitises its output with DOMPurify. Reusing that pipeline means one
 *    markdown renderer in the app instead of two that drift apart.
 *  - **Every link is claimed, including the ones this viewer cannot follow.**
 *    Letting a relative `href` through would navigate this window to a file URL
 *    and replace the entire workbench with a single markdown document — an
 *    unrecoverable click from inside a help panel. External links go to
 *    `openExternal`; anything else is reported in the footer rather than being
 *    silently swallowed, because a link that does nothing when clicked is a
 *    dead click wearing an underline.
 *  - **`format: 'text'` is never markdown-rendered.** The licence ships as
 *    text because an MIT licence is fixed-width-ish prose whose all-caps
 *    disclaimer paragraphs are meant to read as a wall; a markdown renderer
 *    would reflow the line breaks that make it one. It goes in a `<pre>` as a
 *    React text child, so that path performs no HTML parsing at all.
 *  - **Nothing here is synthesised.** The error sentence is whatever main
 *    returned, verbatim — it names the candidate paths it tried, which is the
 *    only actionable half of the message, and paraphrasing it would drop them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react';
import { useCopyFeedback } from '../lib/clipboard';
import { formatKibibytes } from '../lib/process-explorer-format';
import { useAppDocsStore } from '../state/app-docs-store';

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties =>
  ({ WebkitAppRegion: region } as React.CSSProperties);

/**
 * Narrower than the chat renderer's config on purpose.
 *
 * A document is read, not operated on, so the interactive and layout-owning
 * tags are refused outright: `style` because a document must not restyle the
 * panel it is displayed in, and the form controls because a `<button>` inside a
 * sanitised document is a control this app never wired a handler to.
 */
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style']
};

/** Handed to the OS rather than to this window's navigation. */
const EXTERNAL_HREF = /^(https?:|mailto:)/i;

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  borderRadius: '6px',
  padding: '7px 12px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary, #cbd5e1)'
};

export const DocViewerModal: React.FC = () => {
  const activeId = useAppDocsStore((s) => s.activeId);
  const doc = useAppDocsStore((s) => s.doc);
  const isLoading = useAppDocsStore((s) => s.isLoading);
  const error = useAppDocsStore((s) => s.error);
  const closeDoc = useAppDocsStore((s) => s.closeDoc);
  const reload = useAppDocsStore((s) => s.reload);

  const { copied, copy } = useCopyFeedback();
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** Set only when the press started on the overlay itself. See `onOverlayClick`. */
  const pressedOnOverlay = useRef(false);

  // Escape is claimed in the capture phase so a keybinding bound on the bubble
  // cannot also fire on the same keystroke and close something underneath.
  // The listener exists only while a document is open, so a closed viewer
  // leaves Escape alone.
  useEffect(() => {
    if (!activeId) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeDoc();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeId, closeDoc]);

  useEffect(() => {
    if (!activeId) return;
    setLinkNote(null);
    cardRef.current?.focus();
  }, [activeId]);

  const rendered = useMemo(() => {
    if (!doc || doc.format !== 'markdown') return null;
    try {
      const parsed = marked.parse(doc.content, { gfm: true, breaks: false }) as string;
      return { html: DOMPurify.sanitize(parsed, SANITIZE_CONFIG), degraded: false };
    } catch {
      // Falling back to the raw text keeps the document readable instead of
      // blank. Saying it is unformatted is the honest half of that trade.
      return { html: null, degraded: true };
    }
  }, [doc]);

  const onBodyClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    event.preventDefault();

    if (EXTERNAL_HREF.test(href)) {
      if (window.electronAPI?.openExternal) {
        void window.electronAPI.openExternal(href);
        setLinkNote(null);
      } else {
        setLinkNote(`This window has no desktop bridge, so it cannot open ${href}`);
      }
      return;
    }
    setLinkNote(`That link points inside the repository rather than at something Ty-Code can open: ${href}`);
  }, []);

  /**
   * Close on an overlay click, but only when the press *started* there.
   *
   * Selecting text to copy it is the main thing a user does in this panel, and
   * a drag that happens to end over the dimmed backdrop would otherwise discard
   * the selection and the document together.
   */
  const onOverlayClick = useCallback(() => {
    if (pressedOnOverlay.current) closeDoc();
    pressedOnOverlay.current = false;
  }, [closeDoc]);

  if (!activeId) return null;

  const showPlainText = Boolean(doc) && (doc!.format === 'text' || rendered?.degraded === true);

  return (
    <div
      role="presentation"
      onMouseDown={(e) => { pressedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={onOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 'var(--layer-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        ...appRegion('no-drag')
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={doc ? doc.title : 'Ty-Code document'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-secondary, #0f172a)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
          borderRadius: '12px',
          width: 'min(880px, 100%)',
          height: 'min(82vh, 780px)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          color: 'var(--text-primary, #f8fafc)',
          outline: 'none',
          overflow: 'hidden'
        }}
      >
        {/* Header -------------------------------------------------------- */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
            flexShrink: 0
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, overflowWrap: 'anywhere' }}>
              {doc ? doc.title : 'Reading…'}
            </h3>
            {doc && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px', fontFamily: 'var(--font-mono, monospace)' }}>
                {/* Repo-relative by contract, so this never prints the build
                    machine's directory layout into a screenshot. */}
                {doc.source} • {formatKibibytes(doc.bytes / 1024)}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => closeDoc()}
            aria-label="Close document"
            style={{ ...buttonBase, padding: '6px', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body ---------------------------------------------------------- */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
          {doc?.truncated && (
            <div style={bannerStyle('rgba(245, 158, 11, 0.10)', 'rgba(245, 158, 11, 0.30)', '#fcd34d')}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>
                {/* Derived from what is actually on screen rather than from a
                    copy of main's character cap, so the two cannot drift. */}
                Showing the first {doc.content.length.toLocaleString()} characters of a{' '}
                {formatKibibytes(doc.bytes / 1024)} file.
              </span>
            </div>
          )}

          {rendered?.degraded && (
            <div style={bannerStyle('rgba(245, 158, 11, 0.10)', 'rgba(245, 158, 11, 0.30)', '#fcd34d')}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>This document could not be rendered as markdown, so it is shown as plain text.</span>
            </div>
          )}

          {error && (
            <div style={bannerStyle('rgba(239, 68, 68, 0.10)', 'rgba(239, 68, 68, 0.30)', '#fca5a5')}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ overflowWrap: 'anywhere' }}>{error}</span>
            </div>
          )}

          {isLoading && !doc && !error && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)', padding: '24px 0' }}>
              Reading from disk…
            </div>
          )}

          {!isLoading && !doc && !error && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)', padding: '24px 0' }}>
              Nothing to show.
            </div>
          )}

          {doc && showPlainText && (
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '12px',
                lineHeight: '1.6',
                color: 'var(--text-primary, #f8fafc)',
                userSelect: 'text'
              }}
            >
              {doc.content}
            </pre>
          )}

          {doc && !showPlainText && rendered?.html && (
            <div
              className="markdown-content"
              onClick={onBodyClick}
              style={{ fontSize: '13px', lineHeight: '1.65', userSelect: 'text' }}
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          )}
        </div>

        {/* Footer -------------------------------------------------------- */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
            flexShrink: 0
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '11px',
              color: 'var(--text-muted, #94a3b8)',
              overflowWrap: 'anywhere'
            }}
          >
            {linkNote || (isLoading ? 'Refreshing…' : '')}
          </div>

          <button
            type="button"
            disabled={!doc}
            onClick={() => { if (doc) void copy(doc.content, `help-doc:${doc.id}`); }}
            style={{ ...buttonBase, opacity: doc ? 1 : 0.45, cursor: doc ? 'pointer' : 'not-allowed' }}
          >
            {copied ? <Check size={12} color="var(--accent-green, #22c55e)" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={() => reload()}
            title="Re-read this file from disk"
            style={buttonBase}
          >
            <RefreshCw size={12} />
            <span>Reload</span>
          </button>

          <button
            type="button"
            onClick={() => closeDoc()}
            style={{
              ...buttonBase,
              backgroundColor: 'var(--accent-primary, #6366f1)',
              borderColor: 'var(--accent-primary, #6366f1)',
              color: '#ffffff'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

function bannerStyle(background: string, border: string, color: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    background,
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '12px',
    lineHeight: '1.5',
    color,
    marginBottom: '12px'
  };
}
