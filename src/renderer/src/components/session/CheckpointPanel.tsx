/**
 * Phase 3 — Checkpoint Details & Rollback panel (sidecar).
 *
 * Lists the reversible points the agent captured for the current workspace and
 * offers an honest "Restore to here": a preview surfaces three-way conflicts
 * (files the user edited after the agent) BEFORE anything is written, then the
 * chosen mode (force / keep-mine / review) applies through the same service the
 * agent used to capture. Nothing here fabricates state — the list is read from
 * the plaintext manifests (never decrypted) and restore results come straight
 * from `checkpointService`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, RotateCcw, ShieldCheck, GitBranch, Camera, AlertTriangle, Check } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useSessionStore } from '../../state/session-store';
import { toast } from '../../state/toast-store';
import type { CheckpointManifest, RestoreResult, RestoreMode } from '../../../../shared/types/checkpoint';
import type { IpcResponse } from '../../../../preload/types';
import './CheckpointPanel.css';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return String(epochMs);
  }
}

function touchedSummary(manifest: CheckpointManifest): string {
  const parts: string[] = [];
  if (manifest.touched.length) parts.push(`${manifest.touched.length} edited`);
  if (manifest.created.length) parts.push(`${manifest.created.length} created`);
  if (manifest.deleted.length) parts.push(`${manifest.deleted.length} deleted`);
  return parts.length ? parts.join(' · ') : 'no files';
}

const RESULT_WORDING: Record<keyof Pick<RestoreResult, 'restored' | 'created' | 'deleted' | 'skipped'>, string> = {
  restored: 'Reverted',
  created: 'Re-created',
  deleted: 'Removed',
  skipped: 'Left untouched'
};

// The preload `checkpoint` namespace is optional in the type (mocked builds may
// omit it); resolve it once per call and fail loudly rather than silently no-op.
function requireCheckpointApi(): NonNullable<typeof window.electronAPI.checkpoint> {
  const api = window.electronAPI.checkpoint;
  if (!api) throw new Error('Checkpoint API is not available in this build.');
  return api;
}

export const CheckpointPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const refreshFileTree = useWorkspaceStore((s) => s.refreshFileTree);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [manifests, setManifests] = useState<CheckpointManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Restore flow: the checkpoint awaiting a decision, its preview conflicts, and
  // the pending mode. Kept in one slot so only one restore is ever armed.
  const [pending, setPending] = useState<{ manifest: CheckpointManifest; preview?: RestoreResult } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setManifests([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = (await requireCheckpointApi().list(workspacePath)) as IpcResponse<CheckpointManifest[]>;
      if (!response.success) throw new Error(response.error || 'Failed to list checkpoints.');
      setManifests((response.data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeSessionId]);

  const totals = useMemo(
    () => ({
      count: manifests.length,
      bytes: manifests.reduce((sum, m) => sum + (m.sizeBytes || 0), 0),
      gitBacked: manifests.some((m) => m.backend === 'git-ref')
    }),
    [manifests]
  );

  const activeCheckpoints = useMemo(
    () => (activeSessionId ? manifests.filter((m) => m.taskId === activeSessionId) : manifests),
    [manifests, activeSessionId]
  );
  // Session-scoped list when we can attribute it; otherwise show the whole
  // workspace history so the panel is never silently empty.
  const shown = activeCheckpoints.length ? activeCheckpoints : manifests;

  const startRestore = async (manifest: CheckpointManifest) => {
    if (!workspacePath) return;
    setBusyId(manifest.id);
    setError('');
    try {
      const preview = (await requireCheckpointApi().restorePreview(
        workspacePath,
        manifest.id
      )) as IpcResponse<RestoreResult>;
      if (!preview.success) throw new Error(preview.error || 'Could not preview the restore.');
      setPending({ manifest, preview: preview.data });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRestore = async (mode: RestoreMode) => {
    if (!workspacePath || !pending) return;
    const { manifest } = pending;
    setBusyId(manifest.id);
    setError('');
    try {
      const response = (await requireCheckpointApi().restore(
        workspacePath,
        manifest.id,
        mode
      )) as IpcResponse<RestoreResult>;
      if (!response.success || !response.data) throw new Error(response.error || 'Restore failed.');
      const result = response.data;
      const summary = (['restored', 'created', 'deleted', 'skipped'] as const)
        .map((key) => (result[key].length ? `${RESULT_WORDING[key]} ${result[key].length}` : null))
        .filter(Boolean)
        .join(', ') || 'nothing to do';
      if (result.conflicts.length && mode === 'review') {
        toast.warning('Restore left conflicts', `${result.conflicts.length} file(s) you edited were not overwritten.`);
      } else {
        toast.success(`Restored checkpoint #${manifest.n}`, summary);
      }
      setPending(null);
      await refresh();
      await refreshFileTree().catch(() => undefined);
      window.dispatchEvent(new CustomEvent('workspace-files-mutated', { detail: manifest.touched }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const refreshFileTreeAction = () => {
    void refreshFileTree().catch(() => undefined);
  };

  if (!workspacePath) {
    return (
      <div className="checkpoint-panel">
        <p className="checkpoint-panel__empty">Open a workspace to see its checkpoints.</p>
      </div>
    );
  }

  return (
    <div className="checkpoint-panel">
      <header className="checkpoint-panel__header">
        <div className="checkpoint-panel__title">
          <History size={14} aria-hidden="true" />
          <strong>Checkpoints</strong>
          {totals.gitBacked ? (
            <span className="checkpoint-badge is-git" title="Some checkpoints use hidden git refs (full fidelity).">
              <GitBranch size={11} aria-hidden="true" /> git refs
            </span>
          ) : (
            <span className="checkpoint-badge is-snapshot" title="Encrypted local snapshots (no git repo detected).">
              <Camera size={11} aria-hidden="true" /> local snapshots
            </span>
          )}
        </div>
        <div className="checkpoint-panel__meta">
          <span>{totals.count} kept</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(totals.bytes)} / 512 MB</span>
          <button type="button" className="checkpoint-panel__refresh" onClick={() => void refresh()} disabled={loading} title="Reload checkpoints">
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="checkpoint-panel__error" role="alert">
          <AlertTriangle size={12} aria-hidden="true" /> {error}
        </div>
      )}

      {shown.length === 0 && !loading ? (
        <p className="checkpoint-panel__empty">
          No checkpoints yet. The agent captures one right before it edits files, so you can roll back exactly its changes.
        </p>
      ) : (
        <ul className="checkpoint-panel__list">
          {shown.map((manifest) => {
            const isPending = pending?.manifest.id === manifest.id;
            const conflicts = isPending ? pending?.preview?.conflicts ?? [] : [];
            return (
              <li key={manifest.id} className={`checkpoint-card${isPending ? ' is-pending' : ''}`}>
                <div className="checkpoint-card__row">
                  <span className="checkpoint-card__n">#{manifest.n}</span>
                  <span className={`checkpoint-card__backend is-${manifest.backend}`}>
                    {manifest.backend === 'git-ref' ? <GitBranch size={10} aria-hidden="true" /> : <Camera size={10} aria-hidden="true" />}
                    {manifest.backend}
                  </span>
                  <span className="checkpoint-card__time">{formatTime(manifest.createdAt)}</span>
                  <span className="checkpoint-card__size">{formatBytes(manifest.sizeBytes)}</span>
                </div>
                {manifest.summary && <div className="checkpoint-card__summary">{manifest.summary}</div>}
                <div className="checkpoint-card__files">{touchedSummary(manifest)}</div>

                {!isPending && (
                  <div className="checkpoint-card__actions">
                    <button
                      type="button"
                      className="checkpoint-card__restore"
                      onClick={() => void startRestore(manifest)}
                      disabled={busyId === manifest.id}
                      title="Preview reverting the agent's changes at this point"
                    >
                      <RotateCcw size={12} aria-hidden="true" /> Restore to here
                    </button>
                  </div>
                )}

                {isPending && pending?.preview && (
                  <div className="checkpoint-card__confirm">
                    <div className="checkpoint-card__impact">
                      <ShieldCheck size={12} aria-hidden="true" />
                      <span>
                        Will revert {pending.preview.restored.length}, re-create {pending.preview.created.length}, remove{' '}
                        {pending.preview.deleted.length}.
                      </span>
                    </div>
                    {conflicts.length > 0 ? (
                      <div className="checkpoint-card__conflicts">
                        <AlertTriangle size={12} aria-hidden="true" />
                        <span>{conflicts.length} file(s) you edited after the agent will need a decision:</span>
                        <ul>
                          {conflicts.map((conflict) => (
                            <li key={conflict.path} title={conflict.path}>
                              {conflict.path}
                            </li>
                          ))}
                        </ul>
                        <div className="checkpoint-card__modes">
                          <button type="button" onClick={() => void confirmRestore('force')} disabled={busyId === manifest.id}>
                            <Check size={11} aria-hidden="true" /> Overwrite all
                          </button>
                          <button type="button" onClick={() => void confirmRestore('keep-mine')} disabled={busyId === manifest.id}>
                            Keep my edits
                          </button>
                          <button type="button" className="is-review" onClick={() => void confirmRestore('review')} disabled={busyId === manifest.id}>
                            Review-safe (skip conflicts)
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="checkpoint-card__modes">
                        <button type="button" className="is-review" onClick={() => void confirmRestore('force')} disabled={busyId === manifest.id}>
                          <RotateCcw size={11} aria-hidden="true" /> Confirm restore
                        </button>
                      </div>
                    )}
                    <div className="checkpoint-card__secondary">
                      <button type="button" className="checkpoint-card__cancel" onClick={() => setPending(null)} disabled={busyId === manifest.id}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="checkpoint-panel__footnote">
        Restore reverts only the agent&apos;s captured changes.{' '}
        <button type="button" className="checkpoint-panel__link" onClick={refreshFileTreeAction}>
          Refresh file tree
        </button>{' '}
        after a restore to reload open editors.
      </p>
    </div>
  );
};

export default CheckpointPanel;
