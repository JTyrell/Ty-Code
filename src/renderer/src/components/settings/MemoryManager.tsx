/**
 * Prompt C Step 4 — Auto-Memory manager (Settings → Project Rules & Memory).
 *
 * Two surfaces in one panel:
 *  1. Confirmation queue — candidates proposed by the post-task distillation pass. Each
 *     can be edited (rule text + scope) before Approve, or Dismissed. Nothing reaches
 *     correction memory until the user explicitly approves it.
 *  2. Approved memories — the union of project- and global-scope rules now stored in
 *     correction memory, searchable/filterable and deletable.
 *
 * All actions go through the memory IPC; the panel refreshes when a new distillation
 * proposes candidates (via the `tycode:memory-proposed` window event).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Brain, Sparkles, Search, Check, X, Trash2, Globe, Folder, Filter, Loader2, Lightbulb } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { toast } from '../../state/toast-store';
import type { MemoryCandidate, StoredMemory } from '../../../../shared/types/memory';
import type { IpcResponse } from '../../../../preload/types';

function requireMemoryApi(): NonNullable<typeof window.electronAPI.memory> {
  const api = window.electronAPI.memory;
  if (!api) throw new Error('Memory API is not available in this build.');
  return api;
}

const CATEGORIES = ['style', 'architecture', 'stack'] as const;

export const MemoryManager: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [stored, setStored] = useState<StoredMemory[]>([]);
  const [loading, setLoading] = useState(true);

  // Editable drafts keyed by candidate id.
  const [draftRule, setDraftRule] = useState<Record<string, string>>({});
  const [draftScope, setDraftScope] = useState<Record<string, 'project' | 'global'>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Stored list filters.
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'project' | 'global'>('all');
  const [catFilter, setCatFilter] = useState<'all' | (typeof CATEGORIES)[number]>('all');

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setCandidates([]);
      setStored([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const api = requireMemoryApi();
      const [pendingRes, storedRes] = await Promise.all([
        api.pending(workspacePath) as Promise<IpcResponse<MemoryCandidate[]>>,
        api.stored(workspacePath) as Promise<IpcResponse<StoredMemory[]>>
      ]);
      const pend = pendingRes.success && Array.isArray(pendingRes.data) ? pendingRes.data : [];
      setCandidates(pend);
      setDraftRule((prev) => {
        const next: Record<string, string> = {};
        for (const c of pend) next[c.id] = prev[c.id] ?? c.rule;
        return next;
      });
      setDraftScope((prev) => {
        const next: Record<string, 'project' | 'global'> = {};
        for (const c of pend) next[c.id] = prev[c.id] ?? c.scope;
        return next;
      });
      setStored(storedRes.success && Array.isArray(storedRes.data) ? storedRes.data : []);
    } catch (err) {
      toast.error('Memory load failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh when a distillation proposes new candidates after a task.
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('tycode:memory-proposed', handler);
    return () => window.removeEventListener('tycode:memory-proposed', handler);
  }, [refresh]);

  const approve = useCallback(
    async (c: MemoryCandidate) => {
      if (!workspacePath) return;
      const rule = (draftRule[c.id] ?? c.rule).trim();
      if (!rule) {
        toast.warning('Empty rule', 'Edit or restore the rule text before approving.');
        return;
      }
      setBusyId(c.id);
      try {
        const res = (await requireMemoryApi().approve(workspacePath, c.id, draftScope[c.id] ?? c.scope, rule)) as IpcResponse<{ ok: boolean }>;
        if (!res.success) throw new Error(res.error || 'Approval failed.');
        toast.success('Memory saved', `Approved rule added to ${draftScope[c.id] ?? c.scope} correction memory.`);
        await refresh();
      } catch (err) {
        toast.error('Approve failed', err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [workspacePath, draftRule, draftScope, refresh]
  );

  const dismiss = useCallback(
    async (c: MemoryCandidate) => {
      if (!workspacePath) return;
      setBusyId(c.id);
      try {
        const res = (await requireMemoryApi().dismiss(workspacePath, c.id)) as IpcResponse<boolean>;
        if (!res.success) throw new Error(res.error || 'Dismiss failed.');
        setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      } catch (err) {
        toast.error('Dismiss failed', err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [workspacePath]
  );

  const removeStored = useCallback(
    async (m: StoredMemory) => {
      if (!workspacePath) return;
      try {
        const res = (await requireMemoryApi().remove(workspacePath, m.scope, m.id)) as IpcResponse<boolean>;
        if (res.success && res.data) {
          setStored((prev) => prev.filter((x) => !(x.id === m.id && x.scope === m.scope)));
          toast.success('Memory removed', 'Deleted from correction memory.');
        } else {
          toast.error('Delete failed', res.error || 'Could not delete memory.');
        }
      } catch (err) {
        toast.error('Error', err instanceof Error ? err.message : String(err));
      }
    },
    [workspacePath]
  );

  const filteredStored = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stored.filter((m) => {
      if (scopeFilter !== 'all' && m.scope !== scopeFilter) return false;
      if (catFilter !== 'all' && m.category !== catFilter) return false;
      if (q && !m.rule.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [stored, query, scopeFilter, catFilter]);

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
      active
        ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
        : 'border-[#2a2c3a] bg-[#1a1c26] text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-slate-100">Auto-Memory</h3>
        <span className="text-[11px] text-slate-500">Proposals from finished tasks — you approve what becomes a rule.</span>
      </div>

      {!workspacePath ? (
        <div className="text-xs text-slate-500">Open a workspace to collect and manage learned memories.</div>
      ) : (
        <>
          {/* Confirmation queue */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Lightbulb size={13} className="text-amber-400" />
              <span>Awaiting confirmation ({candidates.length})</span>
              {loading && <Loader2 size={12} className="animate-spin text-slate-500" />}
            </div>

            {candidates.length === 0 ? (
              <div className="text-[11px] text-slate-500 border border-dashed border-[#2a2c3a] rounded-lg px-3 py-4">
                No pending proposals. After you finish a task, Ty-Code drafts candidate rules here for your review — never saved automatically.
              </div>
            ) : (
              candidates.map((c) => {
                const scope = draftScope[c.id] ?? c.scope;
                const rule = draftRule[c.id] ?? c.rule;
                const busy = busyId === c.id;
                return (
                  <div key={c.id} className="rounded-lg border border-[#2a2c3a] bg-[#151720] p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 uppercase">{c.category}</span>
                      <span className="text-xs font-medium text-slate-200">{c.title}</span>
                      <span className="ml-auto text-[10px] text-slate-500">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <textarea
                      value={rule}
                      onChange={(e) => setDraftRule((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      rows={2}
                      className="w-full text-xs font-mono bg-[#0f1017] border border-[#2a2c3a] rounded-md p-2 text-slate-200 resize-y focus:outline-none focus:border-indigo-500/60"
                    />
                    {c.rationale && <p className="text-[11px] text-slate-500 italic">Why: {c.rationale}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" className={chip(scope === 'project')} onClick={() => setDraftScope((prev) => ({ ...prev, [c.id]: 'project' }))}>
                        <Folder size={11} className="inline mr-1" /> Project
                      </button>
                      <button type="button" className={chip(scope === 'global')} onClick={() => setDraftScope((prev) => ({ ...prev, [c.id]: 'global' }))}>
                        <Globe size={11} className="inline mr-1" /> Global
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void dismiss(c)}
                          className="px-2.5 py-1 rounded-md text-[11px] border border-[#2a2c3a] text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-50"
                        >
                          <X size={12} className="inline mr-1" /> Dismiss
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void approve(c)}
                          className="px-2.5 py-1 rounded-md text-[11px] bg-emerald-600/80 hover:bg-emerald-600 text-white disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={12} className="inline animate-spin mr-1" /> : <Check size={12} className="inline mr-1" />} Approve
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* Approved memories */}
          <section className="space-y-3 pt-2 border-t border-[#202230]">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Sparkles size={13} className="text-indigo-400" />
              <span>Approved memories ({stored.length})</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search learned rules…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-[#0f1017] border border-[#2a2c3a] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500/60"
                />
              </div>
              <Filter size={12} className="text-slate-500" />
              <button type="button" className={chip(scopeFilter === 'all')} onClick={() => setScopeFilter('all')}>All</button>
              <button type="button" className={chip(scopeFilter === 'project')} onClick={() => setScopeFilter('project')}>Project</button>
              <button type="button" className={chip(scopeFilter === 'global')} onClick={() => setScopeFilter('global')}>Global</button>
              <span className="w-px h-4 bg-[#2a2c3a]" />
              <button type="button" className={chip(catFilter === 'all')} onClick={() => setCatFilter('all')}>Any topic</button>
              {CATEGORIES.map((cat) => (
                <button key={cat} type="button" className={chip(catFilter === cat)} onClick={() => setCatFilter(cat)}>
                  {cat}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filteredStored.length === 0 ? (
                <div className="text-[11px] text-slate-500">No approved memories match this filter yet.</div>
              ) : (
                filteredStored.map((m) => (
                  <div key={`${m.scope}:${m.id}`} className="group flex items-start gap-2 rounded-lg border border-[#2a2c3a] bg-[#151720] p-2.5">
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      {m.scope === 'global' ? <Globe size={12} className="text-indigo-400" /> : <Folder size={12} className="text-emerald-400" />}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-300 uppercase">{m.category}</span>
                    </div>
                    <div className="flex-1 min-w-0 text-xs font-mono text-slate-200 leading-relaxed break-words">{m.rule}</div>
                    <button
                      type="button"
                      onClick={() => void removeStored(m)}
                      className="opacity-60 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all shrink-0"
                      title="Delete memory"
                      aria-label={`Delete memory: ${m.rule}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default MemoryManager;
