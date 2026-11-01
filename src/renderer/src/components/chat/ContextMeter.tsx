/**
 * Phase 4 Step 3 — Context Meter component.
 *
 * Renders in the ChatSidecar footer. Reads `contextTokens`/`contextLimit`
 * already threaded onto `useChatStore` so no second source of truth exists
 * for "how full is the window?". The thresholds come from
 * `shared/types/context-meter.ts` (70% amber, 85% red, 95% critical).
 *
 * Actions:
 *  - **Compact now**: crosses IPC so the compactor runs against the same
 *    transcript the unified store just decrypted (never a stale RAM copy),
 *    and surfaces a chip with the summary the compactor produced.
 *  - Chip auto-clears after 6s; Esc clears it early.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useSessionStore } from '../../state/session-store';
import { bandForRatio } from '../../../../shared/types/context-meter';
import './ContextMeter.css';

export const ContextMeter: React.FC = () => {
  const contextTokens = useChatStore((s) => s.contextTokens);
  const contextLimit = useChatStore((s) => s.contextLimit);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const sessionId = useSessionStore((s) => s.activeSessionId);

  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState<{ summary: string; before: number; after: number } | null>(null);

  const ratio = useMemo(() => {
    if (!contextLimit || contextLimit <= 0) return 0;
    return Math.min(4, contextTokens / contextLimit);
  }, [contextTokens, contextLimit]);

  const band = bandForRatio(ratio);

  useEffect(() => {
    if (!chip) return;
    const t = window.setTimeout(() => setChip(null), 6000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChip(null); };
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [chip]);

  const handleCompact = useCallback(async () => {
    if (!workspacePath || !sessionId || busy) return;
    setBusy(true);
    try {
      const api = window.electronAPI?.contextMeter;
      if (!api?.compactNow) return;
      const res = await api.compactNow(workspacePath, sessionId, contextLimit);
      if (res?.success && res.data) {
        setChip({
          summary: res.data.summary,
          before: res.data.tokensBefore,
          after: res.data.tokensAfter,
        });
        // Keep the live meter honest with the persisted, compacted transcript.
        useChatStore.getState().setContextTokens(res.data.tokensAfter);
      }
    } finally {
      setBusy(false);
    }
  }, [workspacePath, sessionId, contextLimit, busy]);

  const pctText = `${Math.round(ratio * 100)}%`;

  return (
    <div className="chat-context-meter" data-band={band} role="group" aria-label="Context usage">
      <div className="chat-context-meter-bar" aria-hidden="true">
        <div className="chat-context-meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="chat-context-meter-text">
        <span className="chat-context-meter-count">
          {contextTokens.toLocaleString()} / {contextLimit.toLocaleString()}
        </span>
        <span className="chat-context-meter-pct">{pctText}</span>
      </div>
      {band !== 'safe' && (
        <button
          type="button"
          className="chat-context-meter-compact"
          onClick={() => void handleCompact()}
          disabled={busy || !workspacePath || !sessionId}
          title="Compact the conversation history into a summary"
        >
          <Layers size={11} />
          <span>{busy ? 'Compacting…' : 'Compact now'}</span>
        </button>
      )}
      {chip && (
        <div className="chat-context-meter-chip" role="status">
          <span className="chat-context-meter-chip-summary" title={chip.summary}>
            {chip.summary.length > 60 ? `${chip.summary.slice(0, 60)}…` : chip.summary}
          </span>
          <span className="chat-context-meter-chip-delta">
            {chip.before.toLocaleString()} → {chip.after.toLocaleString()} tokens
          </span>
          <button
            type="button"
            className="chat-context-meter-chip-close"
            onClick={() => setChip(null)}
            aria-label="Dismiss compaction notice"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
};

export default ContextMeter;
