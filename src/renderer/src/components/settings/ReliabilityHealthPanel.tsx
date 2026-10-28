/**
 * Reliability Health Panel (Autonomous Free-Tier Reliability, Prompt 3).
 *
 * Read-only Diagnostics surface over the main-process Reliability Sentinel:
 *  - live route table (status dots, success %, TTFT p50/p95, cooldowns) fed
 *    by the dedicated `reliability:health-snapshot` channel,
 *  - the bounded reliability ledger (last events, local JSONL mirror),
 *  - the turn-bounded latency tracker uptime/summary stats from
 *    `reliability:get-stats`,
 *  - manual action buttons: retest providers, repair FCC sidecar, start
 *    Ollama (the same one-click remedies the advisor card offers).
 *
 * Zero probes fired from the renderer: the Sentinel is the single source.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Server, Zap } from 'lucide-react';
import { toast } from '../../state/toast-store';
import type {
  ReliabilityHealthSnapshot,
  ReliabilityRouteHealth
} from '../../../../shared/types/agent-events';
import type { ReliabilityLedgerRecord, ReliabilityStatsSummary } from '../../../../preload/types';

const STATUS_COLORS: Record<ReliabilityRouteHealth['status'], string> = {
  ok: '#34d399',
  degraded: '#fb923c',
  cooling: '#fbbf24',
  unknown: '#94a3b8'
};

const sectionStyle: React.CSSProperties = {
  margin: '10px 0',
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid var(--border-subtle, #262833)',
  background: 'var(--bg-secondary, #17181d)'
};

const statGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: '8px',
  marginTop: '8px'
};

const statCellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '8px',
  background: 'var(--bg-tertiary, #1e2026)',
  border: '1px solid var(--border-subtle, #262833)'
};

export const ReliabilityHealthPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ReliabilityHealthSnapshot | null>(null);
  const [stats, setStats] = useState<ReliabilityStatsSummary | null>(null);
  const [ledger, setLedger] = useState<ReliabilityLedgerRecord[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    void api?.getReliabilityHealth?.().then((res) => {
      if (res?.success && res.data) setSnapshot(res.data);
    });
    void api?.getReliabilityStats?.().then((res) => {
      if (res?.success && res.data) setStats(res.data);
    });
    void api?.getReliabilityLedgerTail?.(40).then((res) => {
      if (res?.success && res.data) setLedger(res.data.records);
    });
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.electronAPI?.onReliabilityHealth?.((next) => {
      setSnapshot(next);
    });
    return () => off?.();
  }, [refresh]);

  const runAction = useCallback(async (id: 'retest' | 'fcc' | 'ollama') => {
    const api = window.electronAPI;
    setBusyAction(id);
    try {
      if (id === 'retest') {
        const res = await api?.reliabilityRetestProviders?.();
        if (res?.success && res.data) {
          toast.success('Provider retest complete', `Sentinel snapshot refreshed — ${res.data.routes.length} routes tracked.`);
        } else {
          toast.error('Retest failed', res?.error || 'The provider retest could not run.');
        }
      } else if (id === 'fcc') {
        const res = await api?.reliabilityRepairFcc?.();
        if (res?.success) {
          toast.success('FCC sidecar repair started', 'The sidecar heals and re-enters the routing chain automatically.');
        } else {
          toast.error('Repair failed', res?.error || 'The FCC sidecar could not be started.');
        }
      } else {
        const res = await api?.reliabilityStartOllama?.();
        if (res?.success) {
          toast.success('Ollama started', 'Local models are joining the free routing chain.');
        } else {
          toast.error('Could not start Ollama', res?.error || 'The `ollama serve` process did not respond.');
        }
      }
      void refresh();
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const statCell = (label: string, value: React.ReactNode, accent?: string) => (
    <div style={statCellStyle}>
      <div style={{ fontSize: '9.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted, #64748b)' }}>{label}</div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: accent || 'var(--text-primary, #f1f5f9)' }}>{value}</div>
    </div>
  );

  return (
    <section
      className="reliability-health-panel"
      data-testid="reliability-health-panel"
      style={sectionStyle}
      aria-label="Free-tier reliability health"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <CheckCircle2 size={13} color="#34d399" />
        <strong style={{ fontSize: '12px', color: 'var(--text-primary, #f1f5f9)' }}>Free-Tier Reliability</strong>
        <span style={{ fontSize: '10px', color: 'var(--text-muted, #94a3b8)' }}>
          sentinel snapshot {snapshot ? new Date(snapshot.updatedAt).toLocaleTimeString() : 'loading…'} · v
          {snapshot?.version ?? 0}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void runAction('retest')}
            disabled={busyAction === 'retest'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.14)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              fontSize: '10.5px',
              cursor: busyAction === 'retest' ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={10} className={busyAction === 'retest' ? 'animate-spin' : ''} />
            Retest Providers
          </button>
          <button
            type="button"
            onClick={() => void runAction('fcc')}
            disabled={busyAction === 'fcc'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-secondary, #cbd5e1)',
              border: '1px solid var(--border-subtle, #262833)',
              fontSize: '10.5px',
              cursor: busyAction === 'fcc' ? 'not-allowed' : 'pointer'
            }}
          >
            <Server size={10} />
            Repair FCC
          </button>
          <button
            type="button"
            onClick={() => void runAction('ollama')}
            disabled={busyAction === 'ollama'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-secondary, #cbd5e1)',
              border: '1px solid var(--border-subtle, #262833)',
              fontSize: '10.5px',
              cursor: busyAction === 'ollama' ? 'not-allowed' : 'pointer'
            }}
          >
            <Zap size={10} />
            Start Ollama
          </button>
        </div>
      </div>

      {stats && (
        <div style={statGridStyle}>
          {statCell('Probes', stats.probeCount)}
          {statCell('Probe fails', stats.probeFailures, stats.probeFailures > 0 ? '#fb923c' : undefined)}
          {statCell('Ladder steps', stats.ladderSteps)}
          {statCell('Ladder fixed', stats.ladderSucceeded, '#34d399')}
          {statCell('Cooldowns', stats.cooldownCount)}
          {statCell('Rotations', stats.rotationCount)}
          {statCell('Advisor cards', stats.advisorCount, stats.advisorCount > 0 ? '#fbbf24' : undefined)}
          {statCell('Recovered', stats.recoveredCount, '#34d399')}
        </div>
      )}

      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {(snapshot?.routes || []).slice(0, 24).map((route) => {
          const key = `${route.providerId}::${route.modelId}`;
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 8px',
                borderRadius: '6px',
                background: 'var(--bg-tertiary, #1e2026)',
                border: '1px solid var(--border-subtle, #262833)',
                fontSize: '10.5px'
              }}
            >
              <span
                title={`Reliability: ${route.status}`}
                style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: STATUS_COLORS[route.status], flexShrink: 0 }}
              />
              <span style={{ color: 'var(--text-primary, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {route.providerId} · {route.modelId}
              </span>
              <span style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-muted, #64748b)' }}>
                {Math.round(route.successRate * 100)}%
                {route.cachedTtftMs ? ` · p50 ${route.cachedTtftMs}ms` : ''}
                {route.p95TtftMs ? ` · p95 ${route.p95TtftMs}ms` : ''}
                {route.cooldownRemainingSec > 0 ? ` · cooling ${route.cooldownRemainingSec}s` : ''}
              </span>
            </div>
          );
        })}
        {snapshot && snapshot.routes.length === 0 && (
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted, #64748b)' }}>
            The sentinel has not built a route roster yet. Probes begin ~20-60s after boot, idle-aware.
          </div>
        )}
      </div>

      {ledger.length > 0 && (
        <details style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)' }}>
            Reliability ledger (last {ledger.length} events, local-only)
          </summary>
          <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '220px', overflowY: 'auto' }}>
            {ledger.map((rec, i) => (
              <div key={i} style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>
                {new Date(rec.at).toLocaleTimeString()} · {rec.kind} · {rec.route || '*'} · {rec.outcome || '-'}
                {typeof rec.latencyMs === 'number' ? ` · ${rec.latencyMs}ms` : ''}
                {rec.detail ? ` · ${rec.detail}` : ''}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
};

export default ReliabilityHealthPanel;
