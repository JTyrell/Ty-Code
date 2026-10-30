/**
 * ReliabilityAdvisorCard (Autonomous Free-Tier Reliability, Prompt 3 + Prompt 2).
 *
 * The LAST-RESORT surface of the silent remediation ladder: the ladder only
 * emits a single advisor event AFTER every silent recovery step has been
 * tried (key refresh -> sidecar heal -> rotation -> route heal -> cooldown).
 * Exactly one card per root cause (rootCauseHash, session-deduped) is
 * rendered here and it auto-clears when the sentinel reports the route
 * recovered. Non-modal: the chat stays fully usable while the card is on
 * screen — the card is dismissible and never blocks input.
 *
 * Prompt 2 contracts:
 *   - Action dedupe: actions render from the payload's deduped action list
 *     (ids unique; ONE primary "Open Settings" max; distinct secondaries
 *     like "Re-test & recover routes"). Every action id maps to exactly one
 *     IPC channel (validated against ADVISOR_ACTION_CATALOG in unit tests).
 *   - Narrative coherence: the headline is the ladder-derived truth
 *     ("N recovery steps attempted, none restored service"), the step list
 *     shows target + retry outcome (red = failed, amber = ran but the retry
 *     still failed, green = restored service), and the carrying route line
 *     shows where the chat is queued/living.
 *   - "Re-test & recover routes" is wired to reliability:heal-routes; a heal
 *     auto-dismisses the card with a "Recovered via <route>" note.
 *   - The payload is Zod-validated at the subscription boundary.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, Settings, X } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import type { AdvisorAction, ReliabilityAdvisorPayload } from '../../../../shared/types/agent-events';
import { ADVISOR_ACTION_CATALOG, ReliabilityAdvisorPayloadSchema } from '../../../../shared/types/agent-events';

type AdvisorCard = Extract<ReliabilityAdvisorPayload, { kind: 'card' }>;

/** Derives the dedupe-ready action list (payload actions first, fallback to catalog). */
function deriveActions(card: AdvisorCard): AdvisorAction[] {
  const actions: AdvisorAction[] = [...(card.actions || [])];
  // Backward-compat fallback: older payloads only carried actionLabel/actionUrl.
  if (!actions.some((a) => a.id === 'open_settings') && card.taxonomyCode === 'auth.invalid_key') {
    actions.push({ ...ADVISOR_ACTION_CATALOG.open_settings });
  }
  if (!actions.some((a) => a.id === 'heal_routes')) {
    actions.push({ ...ADVISOR_ACTION_CATALOG.heal_routes });
  }
  // Dedupe by action id (uniqueness contract).
  const byId = new Map<string, AdvisorAction>();
  for (const action of actions) byId.set(action.id, action);
  const primary = Array.from(byId.values()).filter((a) => a.primary);
  const nonPrimary = Array.from(byId.values()).filter((a) => !a.primary && a.id !== 'open_settings');
  const ordered: AdvisorAction[] = [];
  if (primary.length > 0) ordered.push({ ...primary[0], primary: true });
  if (!ordered.some((a) => a.id === 'open_settings')) {
    // open_settings is never listed as a secondary — it is already primary
    // on keyed families, and root fixes belong to the targeted actions.
    ordered.push({ ...ADVISOR_ACTION_CATALOG.open_settings });
  }
  for (const action of nonPrimary) ordered.push(action);
  return ordered;
}

export const ReliabilityAdvisorCard: React.FC = () => {
  const [card, setCard] = useState<AdvisorCard | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seenHashesRef = useRef<Set<string>>(new Set());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openSettings = useChatStore((s) => s.openSettings);

  useEffect(() => {
    const off = window.electronAPI?.onReliabilityAdvisor?.((payload) => {
      // Zod-guard the payload at the subscription boundary (Prompt 2 strict).
      const parsed = ReliabilityAdvisorPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const data = parsed.data;
      if (data.kind === 'recovered') {
        // Auto-dismiss once the same root cause heals (or anything recovers
        // right after this card asked for help).
        setCard((prev) => (!prev || !data.rootCauseHash || prev.rootCauseHash === data.rootCauseHash ? null : prev));
        return;
      }
      if (seenHashesRef.current.has(data.rootCauseHash)) return;
      seenHashesRef.current.add(data.rootCauseHash);
      setCard(data);
      setNote(null);
    });
    // Disposable listener contract: exactly one off-switch.
    return () => {
      off?.();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    };
  }, []);

  const runAction = useCallback(
    async (action: AdvisorAction) => {
      if (!card) return;
      setBusy(true);
      try {
        const api = window.electronAPI;
        if (action.id === 'open_settings') {
          openSettings('providers');
          return;
        }
        if (action.id === 'heal_routes' && api?.reliabilityHealRoutes) {
          const res = await api.reliabilityHealRoutes();
          if (res?.success && res.data && res.data.healed.length > 0) {
            const healedRoute = res.data.healed[0].providerId;
            setNote(`Recovered via ${healedRoute}`);
            // Auto-dismiss after the note is readable (timer cleaned up in unsubscribe).
            dismissTimerRef.current = setTimeout(() => {
              setCard(null);
              setNote(null);
            }, 2600);
          } else {
            setNote('No route recovered yet — try Settings or another provider.');
          }
          return;
        }
        if (action.id === 'repair_fcc_sidecar' && api?.reliabilityRepairFcc) {
          const res = await api.reliabilityRepairFcc();
          if (res?.success && res.data?.isActive) {
            setNote('FCC sidecar repaired.');
            dismissTimerRef.current = setTimeout(() => {
              setCard(null);
              setNote(null);
            }, 2600);
          } else {
            setNote('Sidecar still unhealthy — check the Diagnostics panel.');
          }
          return;
        }
        if (action.id === 'retest_providers' && api?.reliabilityRetestProviders) {
          await api.reliabilityRetestProviders();
          setNote('Providers re-tested — healthy routes are back in the pool.');
          return;
        }
        if (action.id === 'start_ollama' && api?.reliabilityStartOllama) {
          await api.reliabilityStartOllama();
          setNote('Local models starting — they will appear in the model list.');
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
    },
    [card, openSettings]
  );

  const actions = useMemo(() => (card ? deriveActions(card) : []), [card]);

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
        <strong style={{ fontSize: '11.5px', color: '#fbbf24', flexShrink: 0, overflowWrap: 'break-word', maxWidth: '60vw' }}>{card.headline || 'Auto-recovery exhausted'}</strong>
        <span
          style={{
            fontSize: '10px',
            color: 'var(--text-muted, #94a3b8)',
            overflowWrap: 'break-word',
            whiteSpace: 'normal',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '40vw'
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

      <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-primary, #f1f5f9)', lineHeight: 1.5, overflowWrap: 'break-word' }}>{card.message}</p>
      {card.remedy && (
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.5, overflowWrap: 'break-word' }}>{card.remedy}</p>
      )}
      {card.carryingRoute && (
        <p style={{ margin: 0, fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', lineHeight: 1.5, overflowWrap: 'break-word' }}>{card.carryingRoute}</p>
      )}
      {note && (
        <p style={{ margin: 0, fontSize: '11px', color: '#34d399', lineHeight: 1.5, overflowWrap: 'break-word' }}>{note}</p>
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
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            listStyleType: 'disc',
            maxWidth: '100%',
            overflowWrap: 'break-word'
          }}
        >
          {card.stepsTaken.map((step, i) => {
            // Narrative coherence: truthful per-step verdict.
            const restored = step.retrySucceeded === true;
            const failed = step.outcome === 'failed' || !restored;
            const ranButRetryStillFailed = step.outcome === 'ok' && !restored;
            const color = restored ? '#34d399' : ranButRetryStillFailed ? '#fbbf24' : '#f87171';
            return (
              <li key={i} style={{ color, overflowWrap: 'break-word', maxWidth: '100%' }}>
                {step.step}
                {step.target ? ` → ${step.target}` : ''}: {step.outcome}
                {ranButRetryStillFailed ? ' (retry still failed)' : ''}
                {step.detail ? ` — ${step.detail}` : ''}
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {actions.map((action, i) => (
          <button
            key={action.id}
            type="button"
            data-testid={i === 0 ? 'reliability-advisor-action' : `reliability-advisor-action-${action.id}`}
            onClick={() => void runAction(action)}
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '6px',
              background: action.primary ? '#fbbf24' : 'rgba(255, 255, 255, 0.06)',
              color: action.primary ? '#111827' : 'var(--text-secondary, #cbd5e1)',
              border: action.primary ? 'none' : '1px solid rgba(255, 255, 255, 0.14)',
              fontSize: '11px',
              fontWeight: action.primary ? 600 : 400,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy && !action.primary ? 0.7 : busy ? 0.7 : 1
            }}
          >
            {action.id === 'open_settings' && <Settings size={11} />}
            {busy && action.primary ? 'Working…' : action.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ReliabilityAdvisorCard;
