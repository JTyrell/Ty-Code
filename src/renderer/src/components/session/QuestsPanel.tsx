/**
 * Prompt B — Quests dock panel (sidecar tab).
 *
 * The control surface for spec-first autonomous delegation. A quest is
 * delegated from here (or from chat / the command palette), its Spec is
 * approved in the Document Review Pane, and it then runs inside an isolated
 * git worktree — this panel streams its live log, shows todo progress, and
 * lists the changed files for per-file Accept and merge review. Nothing is
 * invented: every field is projected from the main-process quest events, and
 * the diff is a read-only Monaco view of the worktree branch vs the base
 * commit. The main workspace is only ever touched by an explicit Accept /
 * Finish (which run `git checkout`/commit in the service), never by this panel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  Rocket, RefreshCw, Loader2, AlertTriangle, Check, X, Ban, Trash2, GitBranch,
  FileDiff as FileDiffIcon, ListChecks, Terminal, ShieldCheck, Eye, Plus
} from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useSessionStore } from '../../state/session-store';
import { useQuestStore, sortQuests } from '../../state/quest-store';
import { toast } from '../../state/toast-store';
import { useThemeSync, getMonacoTheme } from '../../hooks/useThemeSync';
import type { QuestMeta, QuestLogLine, QuestFileDiff } from '../../../../shared/types/quest';
import type { IpcResponse } from '../../../../preload/types';
import './QuestsPanel.css';

function questApi(): NonNullable<typeof window.electronAPI.quest> {
  const api = window.electronAPI.quest;
  if (!api) throw new Error('Quest API is not available in this build.');
  return api;
}

async function unwrap<T>(res: IpcResponse<T>): Promise<T> {
  if (!res.success || res.data === undefined) throw new Error(res.error || 'Quest action failed.');
  return res.data;
}

const STATUS_LABEL: Record<QuestMeta['status'], string> = {
  drafting: 'Drafting spec',
  'awaiting-approval': 'Awaiting approval',
  queued: 'Queued',
  running: 'Running',
  reviewing: 'Merge review',
  merged: 'Merged',
  discarded: 'Discarded',
  cancelled: 'Cancelled',
  failed: 'Failed'
};

const TERMINAL = new Set<QuestMeta['status']>(['merged', 'discarded', 'cancelled', 'failed']);

/** A single quest card: header, progress, log, and merge-review actions. */
const QuestCard: React.FC<{
  quest: QuestMeta;
  log: QuestLogLine[];
  busy: boolean;
  onAction: (fn: () => Promise<void>) => void;
}> = ({ quest, log, busy, onAction }) => {
  const [expanded, setExpanded] = useState(quest.status === 'running' || quest.status === 'reviewing');
  const [diffFile, setDiffFile] = useState<QuestFileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const monacoTheme = getMonacoTheme(useThemeSync());

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length, expanded]);

  const completedTodos = quest.todos.filter((t) => t.status === 'completed').length;
  const todoPct = quest.todos.length ? Math.round((completedTodos / quest.todos.length) * 100) : 0;
  const accepted = new Set(quest.acceptedFiles);

  const openDiff = (path: string) => {
    setLoadingDiff(true);
    setDiffFile(null);
    onAction(async () => {
      try {
        const diff = await unwrap(await questApi().fileDiff(quest.id, path));
        setDiffFile(diff);
      } finally {
        setLoadingDiff(false);
      }
    });
  };

  const acceptFile = (path: string) =>
    onAction(async () => {
      await unwrap(await questApi().acceptFiles(quest.id, [path]));
      toast.success('Accepted change', path);
    });

  const acceptAll = () => {
    const pending = quest.changedFiles.filter((f) => !accepted.has(f.path)).map((f) => f.path);
    if (!pending.length) return;
    onAction(async () => {
      await unwrap(await questApi().acceptFiles(quest.id, pending));
      toast.success(`Accepted ${pending.length} file(s)`, 'Merge accepted to commit them into your branch.');
    });
  };

  const finish = (mode: 'accept-commit' | 'cherry-pick') =>
    onAction(async () => {
      await unwrap(await questApi().finish(quest.id, mode));
      toast.success(mode === 'cherry-pick' ? 'Quest cherry-picked' : 'Quest merged', 'Worktree removed.');
    });

  const discard = () =>
    onAction(async () => {
      await unwrap(await questApi().discard(quest.id));
      toast.info('Quest discarded', 'Worktree removed; accepted changes reverted.');
    });

  const cancel = () =>
    onAction(async () => {
      await unwrap(await questApi().cancel(quest.id));
      toast.info('Cancellation requested', 'The quest will stop at its next safe point.');
    });

  const approveNow = () =>
    onAction(async () => {
      await unwrap(await questApi().approve(quest.id));
      toast.success('Quest approved', 'Running in an isolated worktree.');
    });

  return (
    <article className={`quest-card is-${quest.status}`}>
      <header className="quest-card__head" onClick={() => setExpanded((e) => !e)}>
        <span className={`quest-chip is-${quest.status}`}>
          {(quest.status === 'running' || quest.status === 'drafting') && <Loader2 size={10} className="animate-spin" aria-hidden="true" />}
          {STATUS_LABEL[quest.status]}
        </span>
        <strong className="quest-card__title" title={quest.objective}>{quest.title}</strong>
        <span className="quest-card__branch" title={`branch ${quest.branch}`}>
          <GitBranch size={10} aria-hidden="true" />
          {quest.baseCommit ? quest.baseCommit.slice(0, 7) : '—'}
        </span>
        <ChevronCw open={expanded} />
      </header>

      {quest.todos.length > 0 && (
        <div className="quest-card__progress" title={`${completedTodos}/${quest.todos.length} todos complete`}>
          <ListChecks size={11} aria-hidden="true" />
          <span className="quest-card__bar"><span className="quest-card__bar-fill" style={{ width: `${todoPct}%` }} /></span>
          <span className="quest-card__progress-text">{completedTodos}/{quest.todos.length}</span>
        </div>
      )}

      {quest.error && (
        <div className="quest-card__error" role="alert"><AlertTriangle size={11} aria-hidden="true" /> {quest.error}</div>
      )}

      {expanded && (
        <div className="quest-card__body">
          {quest.status === 'awaiting-approval' && (
            <div className="quest-card__gate">
              <ShieldCheck size={12} aria-hidden="true" />
              <span>Review the Spec in the Document pane and Approve there — or start now:</span>
              <button type="button" className="quest-btn is-primary" onClick={approveNow} disabled={busy}>
                <Rocket size={11} aria-hidden="true" /> Approve &amp; run
              </button>
            </div>
          )}

          {quest.status === 'reviewing' && (
            <div className="quest-card__review">
              <div className="quest-card__review-head">
                <FileDiffIcon size={11} aria-hidden="true" />
                <span>{quest.changedFiles.length} changed file(s)</span>
                <div className="quest-card__review-actions">
                  <button type="button" className="quest-btn" onClick={acceptAll} disabled={busy || quest.changedFiles.every((f) => accepted.has(f.path))}>
                    <Check size={11} aria-hidden="true" /> Accept all
                  </button>
                  <button type="button" className="quest-btn is-primary" onClick={() => finish('accept-commit')} disabled={busy || quest.acceptedFiles.length === 0} title="Commit the accepted files to your branch">
                    Merge accepted
                  </button>
                  <button type="button" className="quest-btn" onClick={() => finish('cherry-pick')} disabled={busy} title="Cherry-pick the whole quest branch">
                    Cherry-pick
                  </button>
                  <button type="button" className="quest-btn is-danger" onClick={discard} disabled={busy}>
                    <Trash2 size={11} aria-hidden="true" /> Discard
                  </button>
                </div>
              </div>
              <ul className="quest-files">
                {quest.changedFiles.map((f) => {
                  const isAccepted = accepted.has(f.path);
                  return (
                    <li key={f.path} className={`quest-file${isAccepted ? ' is-accepted' : ''}`}>
                      <span className={`quest-file__status is-${f.status[0]}`}>{f.status}</span>
                      <span className="quest-file__path" title={f.path}>{f.path}</span>
                      <button type="button" className="quest-file__view" onClick={() => openDiff(f.path)} disabled={loadingDiff} title="View diff (read-only)">
                        <Eye size={11} aria-hidden="true" /> Diff
                      </button>
                      {!isAccepted && (
                        <button type="button" className="quest-file__accept" onClick={() => acceptFile(f.path)} disabled={busy} title="Bring this file into your workspace">
                          <Check size={11} aria-hidden="true" /> Accept
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {diffFile && (
                <div className="quest-diff">
                  <div className="quest-diff__head">
                    <strong>{diffFile.path}</strong>
                    <button type="button" className="quest-diff__close" onClick={() => setDiffFile(null)} aria-label="Close diff"><X size={12} /></button>
                  </div>
                  <div className="quest-diff__editor">
                    <DiffEditor
                      original={diffFile.originalContent}
                      modified={diffFile.modifiedContent}
                      theme={monacoTheme}
                      options={{ readOnly: true, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12 }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {(quest.status === 'running' || quest.status === 'queued') && (
            <div className="quest-card__actions">
              <button type="button" className="quest-btn is-danger" onClick={cancel} disabled={busy}>
                <Ban size={11} aria-hidden="true" /> Cancel quest
              </button>
            </div>
          )}

          <div className="quest-log" ref={logRef}>
            <div className="quest-log__label"><Terminal size={10} aria-hidden="true" /> Live log</div>
            {log.length === 0 ? (
              <p className="quest-log__empty">No activity yet.</p>
            ) : (
              log.map((line, i) => (
                <div key={i} className={`quest-log__line is-${line.level}`}>
                  <span className="quest-log__text">{line.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </article>
  );
};

const ChevronCw: React.FC<{ open: boolean }> = ({ open }) => (
  <span className="quest-card__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
);

export const QuestsPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const quests = useQuestStore((s) => s.quests);
  const logs = useQuestStore((s) => s.logs);
  const ready = useQuestStore((s) => s.ready);
  const refresh = useQuestStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [objective, setObjective] = useState('');

  const shown = useMemo(() => sortQuests(quests), [quests]);

  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: unknown) {
      toast.error('Quest action failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (workspacePath) void refresh(workspacePath);
    }
  }, [workspacePath, refresh]);

  const delegate = () => {
    const text = objective.trim();
    if (!text || !workspacePath) return;
    setBusy(true);
    void (async () => {
      try {
        await unwrap(await questApi().draft(workspacePath, text, activeSessionId || undefined));
        setObjective('');
        setDraftOpen(false);
        toast.success('Quest drafted', 'Review the Spec and Approve to run it in isolation.');
      } catch (err: unknown) {
        toast.error('Could not draft quest', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        if (workspacePath) void refresh(workspacePath);
      }
    })();
  };

  if (!workspacePath) {
    return <div className="quests-panel"><p className="quests-panel__empty">Open a workspace to delegate quests.</p></div>;
  }

  return (
    <div className="quests-panel">
      <header className="quests-panel__header">
        <div className="quests-panel__title">
          <Rocket size={14} aria-hidden="true" />
          <strong>Quests</strong>
          <span className="quests-panel__count">{shown.length}</span>
        </div>
        <div className="quests-panel__tools">
          <button type="button" className="quests-panel__new" onClick={() => setDraftOpen((v) => !v)} disabled={busy} title="Delegate a new quest">
            <Plus size={12} aria-hidden="true" /> Delegate
          </button>
          <button type="button" className="quests-panel__refresh" onClick={() => void refresh(workspacePath)} disabled={busy} title="Reload quests">
            <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>
      </header>

      {draftOpen && (
        <div className="quests-panel__composer">
          <textarea
            className="quests-panel__objective"
            placeholder="Describe the long-horizon task to delegate. The agent drafts a Spec you can review and approve before anything runs."
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={4}
            disabled={busy}
          />
          <div className="quests-panel__composer-actions">
            <span className="quests-panel__hint">Runs only in an isolated worktree after you Approve.</span>
            <button type="button" className="quest-btn is-primary" onClick={delegate} disabled={busy || !objective.trim()}>
              <Rocket size={11} aria-hidden="true" /> Draft Spec
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="quests-panel__empty">
          {ready
            ? 'No quests yet. Delegate one from chat with /quest, the command palette, or the Delegate button above.'
            : 'Loading quests…'}
        </p>
      ) : (
        <ul className="quests-panel__list">
          {shown.map((q) => (
            <li key={q.id}>
              <QuestCard quest={q} log={logs[q.id] || []} busy={busy && !TERMINAL.has(q.status)} onAction={runAction} />
            </li>
          ))}
        </ul>
      )}

      <p className="quests-panel__footnote">
        Parallel quests (max 3) run in <code>.tycode/worktrees/</code> off your current HEAD. Your workspace changes
        only when you Accept files and Merge, or you cherry-pick the quest branch.
      </p>
    </div>
  );
};

export default QuestsPanel;
