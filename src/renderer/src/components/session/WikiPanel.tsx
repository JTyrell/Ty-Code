/**
 * Prompt C Step 1 — Project Wiki panel (sidecar tab).
 *
 * Shows the wiki's freshness (from the hash-driven status), lets the user
 * regenerate on demand, streams per-section generation progress, and browses the
 * generated sections. Every action goes straight to the wiki IPC; nothing here
 * fabricates content — an empty/failed wiki is surfaced honestly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, AlertTriangle, Check, Loader2, Clock } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { toast } from '../../state/toast-store';
import { WIKI_SECTIONS, type WikiSectionId, type WikiStatus } from '../../../../shared/types/wiki';
import type { IpcResponse } from '../../../../preload/types';
import './WikiPanel.css';

function requireWikiApi(): NonNullable<typeof window.electronAPI.wiki> {
  const api = window.electronAPI.wiki;
  if (!api) throw new Error('Wiki API is not available in this build.');
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

export const WikiPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [selected, setSelected] = useState<WikiSectionId | null>(null);
  const [sectionBody, setSectionBody] = useState<string>('');
  const [error, setError] = useState('');
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
      const response = (await requireWikiApi().status(workspacePath)) as IpcResponse<WikiStatus>;
      if (!response.success) throw new Error(response.error || 'Failed to read wiki status.');
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

  // Subscribe to generation progress once on mount.
  useEffect(() => {
    let api: NonNullable<typeof window.electronAPI.wiki> | null = null;
    try {
      api = requireWikiApi();
    } catch {
      return;
    }
    return api.onProgress((event) => {
      if (!mountedRef.current) return;
      if (event.phase === 'start') setProgress(`Drafting ${event.section}…`);
      else if (event.phase === 'done') setProgress(`Finished ${event.section}.`);
      else if (event.phase === 'error') setProgress(`Error on ${event.section}: ${event.message || 'unknown'}`);
    });
  }, []);

  const regenerate = useCallback(async () => {
    if (!workspacePath) {
      toast.error('No workspace open', 'Open a folder before generating the wiki.');
      return;
    }
    setGenerating(true);
    setProgress('Starting…');
    setError('');
    try {
      const response = (await requireWikiApi().generate(workspacePath, true)) as IpcResponse<
        import('../../../../shared/types/wiki').GenerateWikiResult
      >;
      if (!response.success) throw new Error(response.error || 'Wiki generation failed.');
      const result = response.data;
      if (result) {
        setStatus(result.status);
        if (result.generated) toast.success('Wiki generated', 'Six sections written to .tycode/wiki/.');
        else if (result.reason === 'llm-unavailable') toast.error('No model route', 'Lock a model before generating the wiki.');
        else if (result.reason === 'fresh') toast.info('Wiki is fresh', 'No drift since the last generation.');
        else toast.info('Wiki not regenerated', result.message || result.reason || '');
      }
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      setError(msg);
      toast.error('Wiki generation failed', msg);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  }, [workspacePath]);

  const openSection = useCallback(async (section: WikiSectionId) => {
    if (!workspacePath) return;
    setSelected(section);
    setSectionBody('Loading…');
    try {
      const response = (await requireWikiApi().read(workspacePath, section)) as IpcResponse<{ content: string | null }>;
      if (!response.success) throw new Error(response.error || 'Failed to read section.');
      setSectionBody(response.data?.content ?? '_This section has not been generated yet._');
    } catch (reason) {
      setSectionBody(reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath]);

  return (
    <div className="wiki-panel">
      <header className="wiki-panel-header">
        <div className="wiki-panel-title">
          <BookOpen size={15} aria-hidden="true" />
          <span>Project Wiki</span>
        </div>
        <button type="button" className="wiki-panel-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh status">
          <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
        </button>
      </header>

      {!workspacePath ? (
        <div className="wiki-panel-empty">Open a workspace folder to generate its wiki.</div>
      ) : (
        <>
          <div className="wiki-panel-status">
            {status?.exists ? (
              status.stale ? (
                <span className="wiki-badge is-stale">
                  <AlertTriangle size={12} aria-hidden="true" /> Stale · {status.changedFiles} files changed
                </span>
              ) : (
                <span className="wiki-badge is-fresh">
                  <Check size={12} aria-hidden="true" /> Up to date
                </span>
              )
            ) : (
              <span className="wiki-badge is-missing">Not generated yet</span>
            )}
            <span className="wiki-panel-generated">
              <Clock size={11} aria-hidden="true" /> {formatTime(status?.generatedAt ?? null)}
            </span>
          </div>

          <div className="wiki-panel-actions">
            <button type="button" className="chat-error-btn chat-error-btn-primary" onClick={() => void regenerate()} disabled={generating}>
              {generating ? <Loader2 size={12} className="is-spinning" /> : <BookOpen size={12} />}
              <span>{generating ? 'Generating…' : 'Regenerate wiki'}</span>
            </button>
            {progress && <span className="wiki-panel-progress">{progress}</span>}
          </div>

          {error && <div className="wiki-panel-error">{error}</div>}

          <div className="wiki-panel-sections">
            {WIKI_SECTIONS.map((section) => {
              const generated = status?.sections.some((s) => s.id === section);
              return (
                <button
                  key={section}
                  type="button"
                  className={`wiki-section-chip${selected === section ? ' is-active' : ''}${generated ? '' : ' is-ghost'}`}
                  onClick={() => void openSection(section)}
                >
                  @{section}
                  {!generated && <small className="wiki-section-missing">missing</small>}
                </button>
              );
            })}
          </div>

          {selected && (
            <article className="wiki-section-body">
              <h3 className="wiki-section-heading">@{selected}</h3>
              <pre className="wiki-section-markdown">{sectionBody}</pre>
            </article>
          )}
        </>
      )}
    </div>
  );
};

export default WikiPanel;
