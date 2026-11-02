/**
 * Prompt C Step 3 — Semantic index panel (sidecar tab).
 *
 * Surfaces the local code index status (which embedding source built it, how many
 * chunks, how many files have drifted since), lets the user rebuild — incrementally
 * or forced — streaming build progress, and offers a live `semantic_search` box so the
 * meaning-based recall can be tried directly. Nothing is fabricated: an absent or empty
 * index is reported as such, and search simply returns no rows until one is built.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, RefreshCw, Search, AlertTriangle, Check, Loader2, Clock, Cpu } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { toast } from '../../state/toast-store';
import type { IndexStatus, SemanticHit } from '../../../../shared/types/semantic';
import type { IpcResponse } from '../../../../preload/types';
import './IndexPanel.css';

function requireIndexApi(): NonNullable<typeof window.electronAPI.index> {
  const api = window.electronAPI.index;
  if (!api) throw new Error('Index API is not available in this build.');
  return api;
}

function formatTime(epochMs: number | null): string {
  if (!epochMs) return 'never';
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return String(epochMs);
  }
}

export const IndexPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SemanticHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = (await requireIndexApi().status(workspacePath)) as IpcResponse<IndexStatus>;
      if (!response.success) throw new Error(response.error || 'Failed to read index status.');
      setStatus(response.data ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to rebuild progress once on mount.
  useEffect(() => {
    let api: NonNullable<typeof window.electronAPI.index> | null = null;
    try {
      api = requireIndexApi();
    } catch {
      return;
    }
    return api.onProgress((event) => {
      if (!mountedRef.current) return;
      if (event.phase === 'start') setProgress('Scanning workspace…');
      else if (event.phase === 'embed' && event.total) setProgress(`Embedding ${event.done ?? 0}/${event.total} chunks…`);
      else if (event.phase === 'source-change') setProgress(`Embedder switched: ${event.detail || ''}`);
      else if (event.phase === 'done') setProgress('Index ready.');
      else if (event.phase === 'error') setProgress(`Error: ${event.detail || 'unknown'}`);
    });
  }, []);

  const rebuild = useCallback(
    async (force: boolean) => {
      if (!workspacePath) {
        toast.error('No workspace open', 'Open a folder before building the index.');
        return;
      }
      setRebuilding(true);
      setProgress('Starting…');
      setError('');
      try {
        const response = (await requireIndexApi().rebuild(workspacePath, force)) as IpcResponse<
          import('../../../../shared/types/semantic').RebuildIndexResult
        >;
        if (!response.success) throw new Error(response.error || 'Index rebuild failed.');
        const result = response.data;
        if (result) {
          setStatus(result.status);
          if (result.rebuilt) toast.success('Index rebuilt', result.message || '');
          else if (result.reason === 'fresh') toast.info('Index is fresh', 'No source drift since the last build.');
          else if (result.reason === 'no-source') toast.info('Nothing to index', 'No source files found in this workspace.');
          else if (result.reason === 'unavailable') toast.error('Embedder unavailable', result.message || '');
          else toast.info('Index not rebuilt', result.message || result.reason || '');
        }
      } catch (reason) {
        const msg = reason instanceof Error ? reason.message : String(reason);
        setError(msg);
        toast.error('Index rebuild failed', msg);
      } finally {
        setRebuilding(false);
        setProgress('');
      }
    },
    [workspacePath]
  );

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!workspacePath || !q) return;
    setSearching(true);
    setError('');
    try {
      const response = (await requireIndexApi().search(workspacePath, q, 8)) as IpcResponse<SemanticHit[]>;
      if (!response.success) throw new Error(response.error || 'Semantic search failed.');
      setHits(response.data ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setHits(null);
    } finally {
      setSearching(false);
    }
  }, [workspacePath, query]);

  return (
    <div className="index-panel">
      <header className="index-panel-header">
        <div className="index-panel-title">
          <Layers size={15} aria-hidden="true" />
          <span>Semantic Index</span>
        </div>
        <button type="button" className="index-panel-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh status">
          <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
        </button>
      </header>

      {!workspacePath ? (
        <div className="index-panel-empty">Open a workspace folder to build its semantic index.</div>
      ) : (
        <>
          <div className="index-panel-status">
            {status?.exists ? (
              status.pendingFiles > 0 ? (
                <span className="index-badge is-stale">
                  <AlertTriangle size={12} aria-hidden="true" /> {status.pendingFiles} file{status.pendingFiles === 1 ? '' : 's'} pending
                </span>
              ) : (
                <span className="index-badge is-fresh">
                  <Check size={12} aria-hidden="true" /> Up to date
                </span>
              )
            ) : (
              <span className="index-badge is-missing">Not built yet</span>
            )}
            <span className="index-panel-meta">
              <Cpu size={11} aria-hidden="true" /> {status?.source ?? '—'}
              {status?.dim ? ` · ${status.dim}d` : ''}
              {status?.exists ? ` · ${status.chunkCount} chunks` : ''}
            </span>
            <span className="index-panel-generated">
              <Clock size={11} aria-hidden="true" /> {formatTime(status?.builtAt ?? null)}
            </span>
          </div>

          <div className="index-panel-actions">
            <button type="button" className="chat-error-btn chat-error-btn-primary" onClick={() => void rebuild(false)} disabled={rebuilding}>
              {rebuilding ? <Loader2 size={12} className="is-spinning" /> : <Layers size={12} />}
              <span>{rebuilding ? 'Building…' : 'Update index'}</span>
            </button>
            <button type="button" className="chat-error-btn" onClick={() => void rebuild(true)} disabled={rebuilding}>
              <RefreshCw size={12} />
              <span>Rebuild all</span>
            </button>
            {progress && <span className="index-panel-progress">{progress}</span>}
          </div>

          {error && <div className="index-panel-error">{error}</div>}

          <div className="index-panel-search">
            <input
              className="index-panel-search-input"
              type="text"
              value={query}
              placeholder="Search code by meaning…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
            />
            <button type="button" className="index-panel-search-btn" onClick={() => void runSearch()} disabled={searching || !query.trim()}>
              {searching ? <Loader2 size={13} className="is-spinning" /> : <Search size={13} />}
            </button>
          </div>

          {hits && (
            <div className="index-panel-results">
              {hits.length === 0 ? (
                <div className="index-panel-noresults">No matches — build the index first if you haven’t.</div>
              ) : (
                hits.map((h) => (
                  <div key={`${h.relPath}#${h.chunkIndex}`} className="index-hit">
                    <div className="index-hit-path">
                      <span className="index-hit-file">{h.relPath}</span>
                      <span className="index-hit-line">:{h.startLine}</span>
                      <span className="index-hit-score">{h.score.toFixed(3)}</span>
                    </div>
                    <pre className="index-hit-snippet">{h.snippet.split('\n').slice(0, 4).join('\n')}</pre>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default IndexPanel;
