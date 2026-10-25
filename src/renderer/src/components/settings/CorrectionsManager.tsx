import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Sparkles,
  Shield,
  MessageSquare,
  Bug,
  Palette,
  Globe,
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { CorrectionEntry, CorrectionCategory, CorrectionSurface } from '../../../../preload/types';
import { toast } from '../../state/toast-store';

export const CorrectionsManager: React.FC = () => {
  const [entries, setEntries] = useState<CorrectionEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSurface, setSelectedSurface] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Manual rule addition state
  const [newRule, setNewRule] = useState<string>('');
  const [newCategory, setNewCategory] = useState<CorrectionCategory>('style');
  const [newSurface, setNewSurface] = useState<CorrectionSurface>('global');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load corrections from workspace
  const loadEntries = useCallback(async () => {
    if (!window.electronAPI?.getCorrectionEntries) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await window.electronAPI.getCorrectionEntries();
      if (res.success && Array.isArray(res.data)) {
        setEntries(res.data);
      }
    } catch (err) {
      console.warn('[CorrectionsManager] Failed to load entries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();

    // Subscribe to live correction events across surfaces
    if (window.electronAPI?.onCorrectionAdded) {
      const unsubscribe = window.electronAPI.onCorrectionAdded((entry) => {
        setEntries((prev) => {
          if (prev.some((e) => e.id === entry.id)) return prev;
          return [...prev, entry];
        });
      });
      return () => unsubscribe();
    }
    return undefined;
  }, [loadEntries]);

  // Handle saving new rule
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRule.trim();
    if (!trimmed) {
      toast.warning('Rule Required', 'Please enter a rule description.');
      return;
    }

    if (!window.electronAPI?.saveCorrection) {
      toast.error('API Unavailable', 'Correction saving API is not available.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await window.electronAPI.saveCorrection({
        rule: trimmed,
        category: newCategory,
        surface: newSurface
      });

      if (res.success && res.data) {
        toast.success('Rule Added', `Learned rule successfully saved: "${res.data.rule}"`);
        setNewRule('');
        setEntries((prev) => {
          if (prev.some((e) => e.id === res.data!.id)) return prev;
          return [...prev, res.data!];
        });
      } else {
        toast.error('Failed to Add Rule', res.error || 'Unknown error occurred.');
      }
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle deleting rule
  const handleDeleteRule = async (id: string, ruleText: string) => {
    if (!window.electronAPI?.deleteCorrection) return;

    try {
      const res = await window.electronAPI.deleteCorrection({ id });
      if (res.success && res.data) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        toast.success('Rule Deleted', `Removed rule: "${ruleText.slice(0, 40)}…"`);
      } else {
        toast.error('Delete Failed', res.error || 'Could not delete rule.');
      }
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err));
    }
  };

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Surface filter
      const entrySurface = entry.surface || 'chat';
      if (selectedSurface !== 'all' && entrySurface !== selectedSurface) {
        return false;
      }
      // Category filter
      if (selectedCategory !== 'all' && entry.category !== selectedCategory) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesRule = entry.rule.toLowerCase().includes(query);
        const matchesCat = entry.category.toLowerCase().includes(query);
        const matchesSurf = entrySurface.toLowerCase().includes(query);
        return matchesRule || matchesCat || matchesSurf;
      }
      return true;
    });
  }, [entries, selectedSurface, selectedCategory, searchQuery]);

  // Counts by surface
  const surfaceCounts = useMemo(() => {
    const counts = { all: entries.length, chat: 0, debugger: 0, canvas: 0, global: 0 };
    for (const e of entries) {
      const surf = (e.surface || 'chat') as 'chat' | 'debugger' | 'canvas' | 'global';
      if (counts[surf] !== undefined) {
        counts[surf]++;
      }
    }
    return counts;
  }, [entries]);

  const getSurfaceBadge = (surface?: CorrectionSurface) => {
    const surf = surface || 'chat';
    switch (surf) {
      case 'chat':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <MessageSquare size={10} /> Chat Sidecar
          </span>
        );
      case 'debugger':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Bug size={10} /> Omni-Debugger
          </span>
        );
      case 'canvas':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Palette size={10} /> M3E Canvas
          </span>
        );
      case 'global':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Globe size={10} /> Universal Global
          </span>
        );
    }
  };

  const getCategoryBadge = (category: CorrectionCategory) => {
    switch (category) {
      case 'architecture':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-rose-500/10 text-rose-300 border border-rose-500/20">
            Architecture
          </span>
        );
      case 'stack':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            Stack
          </span>
        );
      case 'style':
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            Style
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 text-slate-200">
      {/* Header Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-indigo-950/20 to-slate-900 border border-purple-900/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 shadow-inner">
              <Brain size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Universal Correction Memory &amp; Project Rules</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Learning Loop Active
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Rules learned from Chat Sidecar, Omni-Debugger, or M3E Canvas are instantly synchronized and enforced across all surfaces.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-[11px] text-emerald-400 shrink-0">
            <Shield size={13} />
            <span>Zero-Telemetry Guaranteed (Local SQLite WAL)</span>
          </div>
        </div>
      </div>

      {/* Manual Add Rule Section */}
      <div className="p-4 rounded-xl bg-[#14161f] border border-[#272938]">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={15} className="text-purple-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Add Global Rule or Preference
          </h4>
        </div>
        <form onSubmit={handleAddRule} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder='e.g., "Always prefer functional components over class components" or "Never use var"'
              className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
            />
            <div className="flex items-center gap-2">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CorrectionCategory)}
                className="px-2.5 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-slate-300 focus:outline-none focus:border-purple-500"
                title="Rule Category"
              >
                <option value="style">Style</option>
                <option value="architecture">Architecture</option>
                <option value="stack">Stack</option>
              </select>

              <select
                value={newSurface}
                onChange={(e) => setNewSurface(e.target.value as CorrectionSurface)}
                className="px-2.5 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-slate-300 focus:outline-none focus:border-purple-500"
                title="Target Surface"
              >
                <option value="global">Global (All Surfaces)</option>
                <option value="chat">Chat Sidecar</option>
                <option value="debugger">Omni-Debugger</option>
                <option value="canvas">M3E Canvas</option>
              </select>

              <button
                type="submit"
                disabled={isSubmitting || !newRule.trim()}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium text-white transition-all flex items-center gap-1.5 shadow-sm shrink-0"
              >
                <Sparkles size={13} />
                <span>Save Rule</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        {/* Surface category tabs */}
        <div className="flex items-center gap-1 bg-[#10121a] p-1 rounded-lg border border-[#232534] overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedSurface('all')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              selectedSurface === 'all'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1c27]'
            }`}
          >
            All Surfaces ({surfaceCounts.all})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSurface('chat')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              selectedSurface === 'chat'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1c27]'
            }`}
          >
            <MessageSquare size={12} /> Chat ({surfaceCounts.chat})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSurface('debugger')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              selectedSurface === 'debugger'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1c27]'
            }`}
          >
            <Bug size={12} /> Debugger ({surfaceCounts.debugger})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSurface('canvas')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              selectedSurface === 'canvas'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1c27]'
            }`}
          >
            <Palette size={12} /> Canvas ({surfaceCounts.canvas})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSurface('global')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              selectedSurface === 'global'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1c27]'
            }`}
          >
            <Globe size={12} /> Global ({surfaceCounts.global})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search learned rules…"
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#0e1017] border border-[#242636] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      {/* Rules List */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">
            <Sparkles size={18} className="animate-spin mx-auto mb-2 text-purple-400" />
            Loading project rules from local ledger…
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#10121a]/50 border border-[#202230] text-center">
            <Brain size={28} className="mx-auto mb-2 text-slate-600" />
            <h5 className="text-xs font-medium text-slate-300">No matching learned rules found</h5>
            <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? 'Try a different search term or reset surface filters.'
                : 'Teach the AI preferences via the Chat Sidecar, Debugger, or Canvas, or use the form above to add your first global project rule.'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="group p-3.5 rounded-xl bg-[#12141c] hover:bg-[#151722] border border-[#202230] hover:border-purple-800/40 transition-all flex items-start justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {getSurfaceBadge(entry.surface)}
                  {getCategoryBadge(entry.category)}
                  <span className="text-[10px] text-slate-500">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-200 leading-relaxed break-words">
                  {entry.rule}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleDeleteRule(entry.id, entry.rule)}
                className="opacity-60 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all shrink-0"
                title="Delete rule"
                aria-label={`Delete rule: ${entry.rule}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer Info */}
      <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500 border-t border-[#202230]">
        <span>Total Rules Active: {entries.length}</span>
        <span>Storage: SQLite WAL + Dual-Durability JSONL</span>
      </div>
    </div>
  );
};

export default CorrectionsManager;
