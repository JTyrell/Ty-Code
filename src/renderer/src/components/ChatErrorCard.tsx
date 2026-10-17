/**
 * ChatErrorCard (Obsidian Cyber): renders a backend error-taxonomy payload.
 *
 * Accepts either `errorCard={...}` (shared ChatErrorCard payload) or the
 * legacy `error={...}` prop. Actions never use window.open(): the main process
 * denies it (setWindowOpenHandler -> deny) and ty-code:// is not a browsable scheme,
 * so in-app URLs are routed to store actions and web URLs go through the async
 * `openExternal` IPC (invoke, never sendSync).
 *
 * Each click is timed with console.time('button_click') so click-to-dispatch
 * latency is visible in DevTools.
 */
import React, { useCallback, useState } from 'react';
import { AlertTriangle, WifiOff, Key, Clock, Server, RotateCcw, Settings, Activity, X, Lightbulb, ExternalLink } from 'lucide-react';
import type { ChatErrorCard as ChatErrorCardType } from '../../../shared/types/agent-events';
import { useChatStore } from '../state/chat-store';

export interface ChatErrorCardProps {
  errorCard?: ChatErrorCardType;
  /** Legacy alias for errorCard. */
  error?: ChatErrorCardType;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

const AMBER = '#f59e0b';
const RED = '#ef4444';

function timed(label: string, fn: () => void): void {
  console.time(label);
  try {
    fn();
  } finally {
    console.timeEnd(label);
  }
}

export const ChatErrorCard: React.FC<ChatErrorCardProps> = ({ errorCard, error, onRetry, onDismiss, className }) => {
  const card = errorCard ?? error;
  const openSettings = useChatStore((s) => s.openSettings);
  const [actionError, setActionError] = useState<string | null>(null);

  const code = card?.taxonomyCode ?? 'ERROR';
  const isAmber = code === 'NETWORK_BLOCKED' || code === 'RATE_LIMITED' || code === 'QUOTA_EXCEEDED';
  const accent = isAmber ? AMBER : RED;
  const border = isAmber ? 'rgba(245,158,11,0.45)' : 'rgba(239,68,68,0.45)';

  const runAction = useCallback(() => {
    if (!card) return;
    const { actionUrl, actionLabel } = card;
    timed('button_click', () => {
      setActionError(null);
      if (actionUrl === 'ty-code://action/retry' || actionLabel === 'Retry') {
        onRetry?.();
      } else if (actionUrl === 'ty-code://settings/providers' || actionUrl === 'settings:providers') {
        openSettings('providers');
      } else if (actionUrl === 'ty-code://dashboard/quota') {
        openSettings('analytics');
      } else if (actionUrl && /^https?:\/\//i.test(actionUrl)) {
        // Async IPC: do not await on the click path; surface failure afterwards.
        void window.electronAPI.openExternal(actionUrl).then((res) => {
          if (!res?.success) setActionError(res?.error || 'Could not open link.');
        }).catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
      } else if (actionUrl) {
        setActionError(`Unsupported action URL: ${actionUrl}`);
      }
    });
  }, [card, onRetry, openSettings]);

  if (!card) return null;

  const Icon = code === 'NETWORK_BLOCKED' ? WifiOff
    : code.startsWith('CONFIG_') ? Key
    : code === 'RATE_LIMITED' || code === 'QUOTA_EXCEEDED' ? Clock
    : code === 'PROVIDER_DOWN' || code === 'TIMEOUT' ? Server
    : AlertTriangle;

  const secondary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', fontSize: 11, fontWeight: 500,
    borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#cbd5e1', cursor: 'pointer'
  };

  return (
    <div
      className={`chat-error-card ${className || ''}`}
      role="alert"
      data-taxonomy-code={code}
      style={{
        margin: '10px 0', padding: '14px 16px', color: '#f1f5f9', borderRadius: 8, border: `1px solid ${border}`,
        background: 'linear-gradient(180deg, rgba(18,24,38,0.95), rgba(12,16,23,0.98))', boxShadow: `0 4px 20px ${isAmber ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)'}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon size={15} color={accent} />
          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: accent, border: `1px solid ${border}`, background: isAmber ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)' }}>{code}</span>
          {card.providerId && <span style={{ fontSize: 11, color: '#94a3b8' }}>{card.providerId}</span>}
        </div>
        {onDismiss && (
          <button type="button" aria-label="Dismiss error card" onClick={() => timed('button_click', onDismiss)}
            style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}><X size={14} /></button>
        )}
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5, fontWeight: 500, color: '#f8fafc' }}>{card.message}</p>

      {card.remedy && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 10px', marginBottom: 12, fontSize: 12, lineHeight: 1.4, color: '#cbd5e1', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6 }}>
          <Lightbulb size={14} color={AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
          <span><strong style={{ color: AMBER }}>Remedy:</strong> {card.remedy}</span>
        </div>
      )}

      {actionError && <div role="status" style={{ fontSize: 11, color: RED, marginBottom: 8 }}>{actionError}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {card.actionLabel ? (
          <button type="button" onClick={runAction}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 5, border: `1px solid ${border}`, background: isAmber ? '#d97706' : 'var(--accent-primary, #6366f1)', color: '#fff', cursor: 'pointer' }}>
            {card.actionLabel === 'Retry' ? <RotateCcw size={12} /> : <ExternalLink size={12} />}
            <span>{card.actionLabel}</span>
          </button>
        ) : onRetry ? (
          <button type="button" onClick={() => timed('button_click', onRetry)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 5, border: `1px solid ${border}`, background: '#d97706', color: '#fff', cursor: 'pointer' }}>
            <RotateCcw size={12} /><span>Retry</span>
          </button>
        ) : null}
        <button type="button" style={secondary} onClick={() => timed('button_click', () => openSettings('providers'))}><Settings size={11} /><span>Settings</span></button>
        <button type="button" style={secondary} onClick={() => timed('button_click', () => openSettings('diagnostics'))}><Activity size={11} /><span>Diagnostics</span></button>
      </div>
    </div>
  );
};
