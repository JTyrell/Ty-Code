/**
 * ReliabilityAdvisorCard (Autonomous Free-Tier Reliability, Prompt 3).
 *
 * The LAST-RESORT surface of the silent remediation ladder: the ladder only
 * emits a single advisor event AFTER every silent recovery step has been
 * tried (key refresh -> sidecar heal -> rotation -> cooldown). Exactly one
 * card per root cause (rootCauseHash, session-deduped) is rendered here and
 * it auto-clears when the sentinel reports the route recovered. Non-modal:
 * the chat stays fully usable while the card is on screen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, Settings, X } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import type { ReliabilityAdvisorPayload } from '../../../../shared/types/agent-events';

type AdvisorCard = Extract<ReliabilityAdvisorPayload, { kind: 'card' }>;

export const ReliabilityAdvisorCard: React.FC = () => {
  const [card, setCard] = useState<AdvisorCard | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seenHashesRef = useRef<Set<string>>(new Set());
  const openSettings = useChatStore((s) => s.openSettings);

  useEffect(() => {
    const off = window.electronAPI?.onReliabilityAdvisor?.((payload) => {
      if (!payload) return;
      if (payload.kind === 'recovered') {
        // Auto-dismiss once the same root cause heals (or anything recovers
        // right after this card asked for help).
        setCard((prev) => (!prev || !payload.rootCauseHash || prev.rootCauseHash === payload.rootCauseHash ? null : prev));
        return;
      }
      if (seenHashesRef.current.has(payload.rootCauseHash)) return;
      seenHashesRef.current.add(payload.rootCauseHash);
      setCard(payload);
    });
    return () => off?.();
  }, []);

  const runPrimaryAction = useCallback(async () => {
    if (!card) return;
    setBusy(true);
    try {
      const api = window.electronAPI;
      if (card.taxonomyCode === 'network.sidecar_down' && api?.reliabilityRepairFcc) {
        await api.reliabilityRepairFcc();
        return;
      }
      if ((card.taxonomyCode === 'provider.unavailable' || card.taxonomyCode === 'pool.exhausted') && api?.reliabilityRetestProviders) {
        await api.reliabilityRetestProviders();
        return;
      }
      if (card.taxonomyCode === 'auth.invalid_key') {
        openSettings('providers');
        return;
      }
      if (card.actionUrl && api?.openExternal) {
        await api.openExternal(card.actionUrl);
        return;
      }
      openSettings('providers');
    } finally {
      setBusy(false);
    }
  }, [card, openSettings]);

  if (!card) return null;

  return (
    <div
      role="alert"
      data-testid="reliability-advisor-card"
      style={{
        margin: '8px 10px 0',
        padding: '10px 12px',
        borderRadius: '10px',
        border: '1px solid rgba(251, 191, 36, 0.45)',
        background: 'linear-gradient(180deg, rgba(251, 191, 36, 0.10), rgba(251, 191, 36, 0.03))',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <Activity size={13} color="#fbbf24" style={{ flexShrink: 0 }} />
        <strong style={{ fontSize: '11.5px', color: '#fbbf24', flexShrink: 0 }}>Auto-recovery exhausted</strong>
        <span
          style={{
            fontSize: '10px',
            color: 'var(--text-muted, #94a3b8)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          [{card.taxonomyCode}]
        </span>
        <button
          type="button"
          aria-label="Dismiss reliability advisor"
          onClick={() => setCard(null)}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted, #94a3b8)',
            cursor: 'pointer',
            padding: '2px'
          }}
        >
          <X size={12} />
        </button>
      </div>

      <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-primary, #f1f5f9)', lineHeight: 1.5 }}>{card.message}</p>
      {card.remedy && (
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.5 }}>{card.remedy}</p>
      )}

      {card.stepsTaken.length > 0 && (
        <button
          type="button"
          onClick={() => setStepsOpen((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted, #94a3b8)',
            fontSize: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            cursor: 'pointer',
            padding: '0'
          }}
        >
          <ChevronDown
            size={10}
            style={{ transform: stepsOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}
          />
          {stepsOpen ? 'Hide' : 'Show'} what Ty-Code already tried ({card.stepsTaken.length} silent steps)
        </button>
      )}
      {stepsOpen && (
        <ul
          style={{
            margin: 0,
            paddingLeft: '16px',
            fontSize: '10.5px',
            color: 'var(--text-muted, #94a3b8)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {card.stepsTaken.map((step, i) => (
            <li key={i}>
              {step.step}: {step.outcome}
              {step.detail ? ` — ${step.detail}` : ''}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="reliability-advisor-action"
          onClick={() => void runPrimaryAction()}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '6px',
            background: '#fbbf24',
            color: '#111827',
            border: 'none',
            fontSize: '11px',
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1
          }}
        >
          {busy ? 'Working…' : card.actionLabel || 'Try to fix it'}
        </button>
        <button
          type="button"
          onClick={() => openSettings('providers')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'var(--text-secondary, #cbd5e1)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            fontSize: '11px',
            cursor: 'pointer'
          }}
        >
          <Settings size={11} />
          Open Settings
        </button>
      </div>
    </div>
  );
};

export default ReliabilityAdvisorCard;
