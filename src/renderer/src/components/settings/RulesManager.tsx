/**
 * Prompt C Step 2 — Rules manager (Settings → "Project Rules & Memory").
 *
 * Lists the Markdown rules in the project-local `.tycode/rules/` directory, offers
 * an editor (mode + globs + body) with create/save/delete, and a tester that shows
 * exactly which rules would fire for a given file path. Everything reads/writes
 * through the Zod-guarded rules IPC namespace; nothing fabricates rule state — the
 * list is whatever is actually on disk.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText, Plus, Trash2, Save, Zap, Search, X, FileCode2 } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { toast } from '../../state/toast-store';
import type { RuleMeta, RuleMode, RuleFile, FiredRule } from '../../../../shared/types/rules';
import type { IpcResponse } from '../../../../preload/types';

function requireRulesApi(): NonNullable<typeof window.electronAPI.rules> {
  const api = window.electronAPI.rules;
  if (!api) throw new Error('Rules API is not available in this build.');
  return api;
}

const MODES: { id: RuleMode; label: string; hint: string }[] = [
  { id: 'always', label: 'Always', hint: 'Injected into every request' },
  { id: 'glob', label: 'Glob', hint: 'Injected when a matching file is in context' },
  { id: 'model-decision', label: 'Model decides', hint: 'Listed as available; fetched via load_rule' },
  { id: 'manual', label: 'Manual', hint: 'Only via @rule mention' }
];

interface Draft {
  name: string;
  title: string;
  description: string;
  mode: RuleMode;
  globs: string;
  body: string;
  isNew: boolean;
}

const EMPTY_DRAFT: Draft = { name: '', title: '', description: '', mode: 'always', globs: '', body: '', isNew: true };

export const RulesManager: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const [rules, setRules] = useState<RuleMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  // Tester state
  const [testPath, setTestPath] = useState('');
  const [fired, setFired] = useState<FiredRule[] | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setRules([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = (await requireRulesApi().list(workspacePath)) as IpcResponse<RuleMeta[]>;
      if (!res.success) throw new Error(res.error || 'Failed to list rules.');
      setRules(res.data ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openRule = useCallback(async (name: string) => {
    if (!workspacePath) return;
    try {
      const res = (await requireRulesApi().read(workspacePath, name)) as IpcResponse<RuleFile | null>;
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to read rule.');
      setDraft({
        name: res.data.name,
        title: res.data.title,
        description: res.data.description,
        mode: res.data.mode,
        globs: res.data.globs.join(', '),
        body: res.data.body,
        isNew: false
      });
    } catch (reason) {
      toast.error('Open rule failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath]);

  const saveDraft = useCallback(async () => {
    if (!workspacePath || !draft) return;
    if (!draft.name.trim()) {
      toast.warning('Name required', 'Give the rule a short file-name slug.');
      return;
    }
    const globs = draft.globs.split(',').map((g) => g.trim()).filter(Boolean);
    if (draft.mode === 'glob' && globs.length === 0) {
      toast.warning('Globs required', 'A glob rule needs at least one pattern.');
      return;
    }
    try {
      const res = (await requireRulesApi().save({
        workspaceRoot: workspacePath,
        name: draft.name.trim(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        mode: draft.mode,
        globs,
        body: draft.body
      })) as IpcResponse<RuleMeta>;
      if (!res.success) throw new Error(res.error || 'Failed to save rule.');
      toast.success('Rule saved', `Saved .tycode/rules/${draft.name.trim()}.md`);
      setDraft(null);
      await refresh();
    } catch (reason) {
      toast.error('Save failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath, draft, refresh]);

  const deleteRule = useCallback(async (name: string) => {
    if (!workspacePath) return;
    try {
      const res = (await requireRulesApi().remove(workspacePath, name)) as IpcResponse<boolean>;
      if (!res.success) throw new Error(res.error || 'Failed to delete rule.');
      toast.success('Rule deleted', `Removed ${name}`);
      if (draft?.name === name) setDraft(null);
      await refresh();
    } catch (reason) {
      toast.error('Delete failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath, draft, refresh]);

  const runTester = useCallback(async () => {
    if (!workspacePath || !testPath.trim()) return;
    setTesting(true);
    try {
      const res = (await requireRulesApi().test(workspacePath, testPath.trim())) as IpcResponse<{ fired: FiredRule[] }>;
      if (!res.success || !res.data) throw new Error(res.error || 'Tester failed.');
      setFired(res.data.fired);
    } catch (reason) {
      toast.error('Tester failed', reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTesting(false);
    }
  }, [workspacePath, testPath]);

  const modeCounts = useMemo(() => {
    const counts: Record<RuleMode, number> = { always: 0, glob: 0, 'model-decision': 0, manual: 0 };
    for (const r of rules) counts[r.mode]++;
    return counts;
  }, [rules]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-900/40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
            <ScrollText size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">Project Rules Engine</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Git-shareable Markdown rules in <code className="text-indigo-300">.tycode/rules/</code>. Injection mode is set per-file via frontmatter.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white flex items-center gap-1.5 shrink-0"
          >
            <Plus size={13} /> New Rule
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap text-[11px]">
          {MODES.map((m) => (
            <span key={m.id} className="px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700 text-slate-300" title={m.hint}>
              {m.label}: <strong className="text-white">{modeCounts[m.id]}</strong>
            </span>
          ))}
        </div>
      </div>

      {!workspacePath && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-300 text-xs">
          Open a workspace folder to author and test project rules.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
          <X size={13} /> {error}
        </div>
      )}

      {/* Editor */}
      {draft && (
        <div className="p-4 rounded-xl bg-[#14161f] border border-[#272938] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              {draft.isNew ? 'New Rule' : `Edit: ${draft.name}`}
            </h4>
            <button type="button" onClick={() => setDraft(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="slug (e.g. react-style)"
              disabled={!draft.isNew}
              className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
            />
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Title"
              className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="One-line description (shown to the model for model-decision rules)"
            className="w-full px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value as RuleMode })}
              className="px-2.5 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>
              ))}
            </select>
            {draft.mode === 'glob' && (
              <input
                value={draft.globs}
                onChange={(e) => setDraft({ ...draft, globs: e.target.value })}
                placeholder="globs, comma-separated: *.tsx, src/**/*.ts"
                className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            )}
          </div>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="Rule instructions (Markdown)…"
            rows={6}
            className="w-full px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono resize-y"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void saveDraft()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white flex items-center gap-1.5"
            >
              <Save size={13} /> Save Rule
            </button>
          </div>
        </div>
      )}

      {/* Tester */}
      <div className="p-4 rounded-xl bg-[#14161f] border border-[#272938] space-y-3">
        <div className="flex items-center gap-2">
          <Zap size={15} className="text-amber-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Rule Tester</h4>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={testPath}
              onChange={(e) => setTestPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runTester(); }}
              placeholder="Enter a workspace-relative path, e.g. src/App.tsx"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void runTester()}
            disabled={testing || !testPath.trim()}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-xs font-medium text-white flex items-center gap-1.5 shrink-0"
          >
            <FileCode2 size={13} /> Test
          </button>
        </div>
        {fired && (
          <div className="space-y-1.5">
            {fired.length === 0 ? (
              <p className="text-[11px] text-slate-500">No rules fire for this path.</p>
            ) : (
              fired.map((f) => (
                <div key={f.rule.name} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#0c0d12] border border-[#242636]">
                  <span className="text-xs text-slate-200 truncate">{f.rule.title || f.rule.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 shrink-0">{f.reason}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Rules list */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading project rules…</div>
        ) : rules.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#10121a]/50 border border-[#202230] text-center">
            <ScrollText size={26} className="mx-auto mb-2 text-slate-600" />
            <h5 className="text-xs font-medium text-slate-300">No project rules yet</h5>
            <p className="text-[11px] text-slate-500 mt-1">Create one with “New Rule”; it is written to <code>.tycode/rules/</code> and shared via git.</p>
          </div>
        ) : (
          rules.map((r) => (
            <div
              key={r.name}
              className="group p-3 rounded-xl bg-[#12141c] hover:bg-[#151722] border border-[#202230] hover:border-indigo-800/40 transition-all flex items-start justify-between gap-3 cursor-pointer"
              onClick={() => void openRule(r.name)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-white">{r.title || r.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/40">{r.mode}</span>
                  {r.globs.length > 0 && <span className="text-[10px] text-slate-500 font-mono truncate">{r.globs.join(', ')}</span>}
                </div>
                {r.description && <p className="text-[11px] text-slate-500 mt-1 truncate">{r.description}</p>}
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void deleteRule(r.name); }}
                className="opacity-60 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all shrink-0"
                title="Delete rule"
                aria-label={`Delete rule ${r.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RulesManager;
