/**
 * HistoryBrowser (Phase 1) — searchable, decrypt-free session list.
 *
 * Renders from `useSessionStore().sidecars` (plaintext metadata only). The
 * critical invariant from `unified-session-store.ts` is that this component
 * never triggers a decryption on its own — only a user-initiated `switch`
 * opens (and decrypts) a session. A locked session shows the "Locked" badge
 * with `[Start fresh]` and `[Copy diagnostic]` and never crashes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Search, Trash2, Pencil, CornerDownLeft, Lock, Copy } from 'lucide-react';
import { useSessionStore } from '../../state/session-store';
import { copyText } from '../../lib/clipboard';
import type { SessionSidecar } from '../../../../shared/types/session-envelope';
import './HistoryBrowser.css';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffMs = now - ts;
  const day = 86400_000;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toISOString().slice(0, 10);
}

export const HistoryBrowser: React.FC = () => {
  const sidecars = useSessionStore((s) => s.sidecars);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const query = useSessionStore((s) => s.query);
  const loading = useSessionStore((s) => s.loading);
  const lockedReason = useSessionStore((s) => s.lockedReason);
  const setQuery = useSessionStore((s) => s.setActiveSearch);
  const switchSession = useSessionStore((s) => s.switchSession);
  const createSession = useSessionStore((s) => s.createSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const filtered: SessionSidecar[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...sidecars].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter((s) => s.title.toLowerCase().includes(q));
  }, [sidecars, query]);

  const handleStartFresh = useCallback(async () => {
    const id = await createSession(undefined);
    if (id) await switchSession(id);
  }, [createSession, switchSession]);

  const handleCopyDiagnostic = useCallback(async () => {
    const line = `session-locked reason=${lockedReason ?? 'unknown'} active=${activeId ?? 'none'} ts=${new Date().toISOString()}`;
    try {
      await copyText(line, 'history-diagnostic');
    } catch {
      /* clipboard failure is UX-tolerated; the text remains in devtools */
    }
  }, [lockedReason, activeId]);

  const beginRename = (sc: SessionSidecar) => {
    setEditingId(sc.sessionId);
    setDraftTitle(sc.title);
  };

  const commitRename = async () => {
    if (editingId && draftTitle.trim()) {
      await renameSession(editingId, draftTitle.trim());
    }
    setEditingId(null);
    setDraftTitle('');
  };

  return (
    <div className="chat-history-browser" role="region" aria-label="Session history">
      <div className="chat-history-toolbar">
        <div className="chat-history-search">
          <Search size={11} />
          <input
            type="search"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>
        <button
          type="button"
          className="chat-history-new"
          onClick={() => void handleStartFresh()}
          title="Start a new session"
        >
          <Plus size={11} />
          <span>New</span>
        </button>
      </div>

      {loading && <div className="chat-history-status">Loading…</div>}

      {filtered.length === 0 && !loading && (
        <div className="chat-history-empty">
          <span>No sessions match.</span>
        </div>
      )}

      <ul className="chat-history-list">
        {filtered.map((sc) => {
          const isActive = sc.sessionId === activeId;
          const isLockedActive = isActive && lockedReason !== null;
          return (
            <li
              key={sc.sessionId}
              className={`chat-history-item${isActive ? ' is-active' : ''}${isLockedActive ? ' is-locked' : ''}`}
            >
              <div className="chat-history-item-main">
                {editingId === sc.sessionId ? (
                  <input
                    className="chat-history-rename-input"
                    value={draftTitle}
                    autoFocus
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      if (e.key === 'Escape') { setEditingId(null); setDraftTitle(''); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="chat-history-item-title"
                    onClick={() => void switchSession(sc.sessionId)}
                  >
                    {isLockedActive && <Lock size={10} className="chat-history-lock" />}
                    <span>{sc.title}</span>
                  </button>
                )}
                <div className="chat-history-item-meta">
                  <span>{sc.messageCount} msg</span>
                  {typeof sc.todoCount === 'number' && sc.todoCount > 0 && (
                    <span>· {sc.todoCount} todo</span>
                  )}
                  {sc.agentMode && <span>· {sc.agentMode}</span>}
                  <span>· {formatDate(sc.updatedAt)}</span>
                </div>
              </div>
              <div className="chat-history-item-actions">
                <button
                  type="button"
                  className="chat-history-icon-btn"
                  onClick={() => beginRename(sc)}
                  title="Rename session"
                  aria-label={`Rename ${sc.title}`}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="chat-history-icon-btn"
                  onClick={() => void switchSession(sc.sessionId)}
                  title="Open session"
                  aria-label={`Open ${sc.title}`}
                >
                  <CornerDownLeft size={11} />
                </button>
                <button
                  type="button"
                  className="chat-history-icon-btn is-danger"
                  onClick={() => {
                    if (window.confirm(`Delete session "${sc.title}"? This cannot be undone.`)) {
                      void deleteSession(sc.sessionId);
                    }
                  }}
                  title="Delete session"
                  aria-label={`Delete ${sc.title}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {lockedReason && (
        <div className="chat-history-locked-banner" role="alert">
          <div className="chat-history-locked-message">
            <Lock size={11} />
            <span>
              Locked: created on another machine or OS profile
              {lockedReason !== 'unknown' ? ` (${lockedReason})` : ''}.
            </span>
          </div>
          <div className="chat-history-locked-actions">
            <button
              type="button"
              className="chat-history-locked-btn"
              onClick={() => void handleStartFresh()}
            >
              Start fresh
            </button>
            <button
              type="button"
              className="chat-history-locked-btn is-secondary"
              onClick={() => void handleCopyDiagnostic()}
            >
              <Copy size={10} />
              <span>Copy diagnostic</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryBrowser;
