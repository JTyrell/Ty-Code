/**
 * Ty-Code Observability — Prompt Composition Panel
 *
 * Visualizes the dynamic system prompt assembly stack:
 *   - Header row: mode, taskClass, cache hit/miss, H0 assembly latency, degraded status
 *   - Budget bar: token estimate vs budget (<70% green, 70-90% amber, >90% red)
 *   - Composition stack: layer blocks, pinned violet indicators, compact/micro tier tags
 *   - Ghost rows: dropped layers with drop reasons
 *   - Inspector side pane: inspect layer text with copy button & full prompt modal
 *   - History selector: past 50 assembly snapshots
 *
 * Brand: Ty-Code
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Layers,
  Pin,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  Cpu,
  FileCode,
  Terminal,
  Shield,
  Maximize2,
  X,
  ChevronDown
} from 'lucide-react';
import {
  useSelectedAssembly,
  useAssemblyHistory,
  useSelectedTaskId,
  useSetSelectedTaskId
} from '../../state/observability-store';
import type { AssemblyLayer } from '../../../../preload/types';

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function getKindIcon(kind: AssemblyLayer['kind']) {
  switch (kind) {
    case 'core':
      return <Shield size={14} className="text-violet-400" />;
    case 'profile':
      return <FileCode size={14} className="text-cyan-400" />;
    case 'mode':
      return <Cpu size={14} className="text-emerald-400" />;
    case 'role':
      return <Layers size={14} className="text-blue-400" />;
    case 'quest':
      return <Clock size={14} className="text-amber-400" />;
    case 'env':
      return <Terminal size={14} className="text-slate-400" />;
    default:
      return <Layers size={14} className="text-slate-400" />;
  }
}

export const PromptCompositionPanel: React.FC = () => {
  const assembly = useSelectedAssembly();
  const history = useAssemblyHistory();
  const selectedTaskId = useSelectedTaskId();
  const setSelectedTaskId = useSetSelectedTaskId();

  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedFull, setCopiedFull] = useState(false);
  const [fullPromptOpen, setFullPromptOpen] = useState(false);

  const activeLayers = assembly?.layers || [];

  const selectedLayer = useMemo(() => {
    if (!selectedLayerId) return activeLayers[0] || null;
    return activeLayers.find((l) => l.id === selectedLayerId) || activeLayers[0] || null;
  }, [activeLayers, selectedLayerId]);

  const handleCopyLayer = useCallback((text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleCopyFullPrompt = useCallback(() => {
    if (!assembly?.systemPrompt) return;
    navigator.clipboard.writeText(assembly.systemPrompt);
    setCopiedFull(true);
    setTimeout(() => setCopiedFull(false), 2000);
  }, [assembly?.systemPrompt]);

  if (!assembly) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#12141a] p-6 text-center text-sm text-slate-400">
        <Layers size={28} className="mx-auto mb-2 text-slate-600 opacity-60" />
        <p className="font-medium text-slate-300">No prompt assembly data recorded yet</p>
        <p className="mt-1 text-xs text-slate-500">Run a task in Chat to view its prompt assembly breakdown.</p>
      </div>
    );
  }

  const budgetPct = Math.min(100, Math.round((assembly.tokenEstimate / (assembly.budget || 1)) * 100));
  const budgetColor =
    budgetPct > 90 ? 'bg-red-500' : budgetPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  const budgetTextColor =
    budgetPct > 90 ? 'text-red-400' : budgetPct >= 70 ? 'text-amber-400' : 'text-emerald-400';

  const maxTokens = Math.max(...activeLayers.map((l) => l.tokens), 1);

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#12141a] p-4 text-slate-200"
      data-testid="prompt-composition-panel"
    >
      {/* ─── Header Row ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Layers size={16} className="text-cyan-400" />
            <span>Prompt Composition</span>
          </div>

          {/* Task selector dropdown */}
          {history.length > 0 && (
            <div className="relative inline-block">
              <select
                value={selectedTaskId || assembly.taskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="cursor-pointer appearance-none rounded-md border border-white/10 bg-slate-900/90 py-1 pl-2.5 pr-7 text-xs font-mono text-cyan-300 hover:border-cyan-500/50 focus:outline-none"
              >
                {history.map((h) => (
                  <option key={h.taskId} value={h.taskId}>
                    {h.taskId.slice(0, 14)} · {h.mode} ({h.roles.join(',') || 'none'})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-2 top-2.5 text-slate-400"
              />
            </div>
          )}

          {/* Mode Badge */}
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
            {assembly.mode}
          </span>

          {/* Task Class Badge */}
          <span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400 border border-blue-500/20">
            {assembly.taskClass}
          </span>

          {/* Cache Chip */}
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-medium ${
              assembly.cache === 'hit'
                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                : 'bg-slate-800 text-slate-400 border border-white/5'
            }`}
          >
            cache:{assembly.cache}
          </span>

          {/* H0 Latency */}
          <span className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-0.5 text-[11px] font-mono text-slate-300 border border-white/5">
            <Clock size={11} className="text-slate-400" />
            H0: {assembly.assemblyMs}ms
          </span>

          {/* Degraded Warning */}
          {assembly.degraded && (
            <span
              className="flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/30"
              title="Degradation ladder applied due to token budget"
            >
              <AlertTriangle size={12} className="text-amber-400" />
              degraded
            </span>
          )}
        </div>

        <button
          onClick={() => setFullPromptOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-slate-700 hover:text-white"
        >
          <Maximize2 size={12} />
          View full system prompt
        </button>
      </div>

      {/* ─── Budget Bar ─── */}
      <div className="rounded-lg bg-black/30 p-2.5 border border-white/5">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-slate-400 font-medium">System Prompt Token Budget</span>
          <span className={`font-mono font-semibold ${budgetTextColor}`}>
            {formatTokens(assembly.tokenEstimate)} / {formatTokens(assembly.budget)} ({budgetPct}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full ${budgetColor} transition-all duration-300`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      </div>

      {/* ─── Main Content: Stack + Inspector ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Composition Stack (7 cols) */}
        <div className="space-y-1.5 lg:col-span-7">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Injected Composition Layers
          </div>

          <div className="space-y-1.5">
            {activeLayers.map((layer) => {
              const isSelected = selectedLayer?.id === layer.id;
              const isPinned = layer.pinned;
              const isDropped = layer.dropped;
              const widthPct = Math.max(8, Math.round((layer.tokens / maxTokens) * 100));

              return (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className={`group relative flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2 text-xs transition-all ${
                    isDropped
                      ? 'border-white/5 bg-white/[0.01] text-slate-500 line-through'
                      : isSelected
                      ? isPinned
                        ? 'border-violet-500 bg-violet-950/20 shadow-sm shadow-violet-500/10'
                        : 'border-cyan-500/60 bg-cyan-950/20'
                      : isPinned
                      ? 'border-violet-500/40 bg-violet-950/10 hover:border-violet-500/70'
                      : 'border-white/5 bg-slate-900/60 hover:border-white/20'
                  }`}
                >
                  {/* Left Label & Badges */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex-shrink-0">{getKindIcon(layer.kind)}</span>

                    {isPinned && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/30 rounded px-1 py-0.2">
                        <Pin size={10} className="fill-violet-400" />
                        pinned
                      </span>
                    )}

                    <span
                      className={`truncate font-medium ${
                        isDropped ? 'text-slate-500 line-through' : 'text-slate-200'
                      }`}
                    >
                      {layer.label}
                    </span>

                    {/* Role tier badge */}
                    {layer.tier && (
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-mono font-semibold uppercase ${
                          layer.tier === 'FULL'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : layer.tier === 'COMPACT'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        }`}
                      >
                        {layer.tier}
                      </span>
                    )}

                    {/* Scope badge */}
                    {layer.scope && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400 border border-white/5">
                        scope: {layer.scope}
                      </span>
                    )}

                    {/* Dropped reason */}
                    {isDropped && layer.reason && (
                      <span className="text-[10px] italic text-red-400/80 no-underline">
                        ({layer.reason})
                      </span>
                    )}
                  </div>

                  {/* Right Tokens & Proportional Bar */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-mono text-[11px] text-slate-400">
                      {isDropped ? '—' : `${layer.tokens} tok`}
                    </span>

                    {!isDropped && (
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full ${
                            isPinned ? 'bg-violet-400' : 'bg-cyan-400'
                          }`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Inspector Pane (5 cols) */}
        <div className="flex flex-col rounded-lg border border-white/10 bg-slate-900/80 p-3 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <FileCode size={14} className="text-cyan-400" />
              <span className="truncate max-w-[200px]">{selectedLayer?.label || 'Layer Inspector'}</span>
              {selectedLayer && (
                <span className="font-mono text-[10px] text-slate-400">
                  ({selectedLayer.tokens} tokens)
                </span>
              )}
            </div>

            {selectedLayer?.text && (
              <button
                onClick={() => handleCopyLayer(selectedLayer.text)}
                className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                title="Copy layer text"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          <div className="relative flex-1 overflow-auto rounded bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300 max-h-[360px]">
            {selectedLayer?.text ? (
              <pre className="whitespace-pre-wrap break-words">{selectedLayer.text}</pre>
            ) : (
              <div className="py-8 text-center text-slate-500 italic">
                {selectedLayer?.dropped
                  ? `Layer was dropped (${selectedLayer.reason || 'budget constraint'}).`
                  : 'Select a layer to inspect its verbatim text.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Full System Prompt Modal ─── */}
      {fullPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-white/15 bg-[#12141a] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">
                  Full Assembled System Prompt ({assembly.taskId})
                </h3>
                <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs font-mono text-cyan-300">
                  {assembly.tokenEstimate} tokens
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyFullPrompt}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  {copiedFull ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copiedFull ? 'Copied Full Prompt' : 'Copy Full'}</span>
                </button>
                <button
                  onClick={() => setFullPromptOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto rounded-lg bg-black/50 p-4 font-mono text-xs text-slate-200 border border-white/5">
              <pre className="whitespace-pre-wrap break-words">{assembly.systemPrompt}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptCompositionPanel;
