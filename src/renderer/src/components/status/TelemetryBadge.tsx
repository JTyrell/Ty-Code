/**
 * Ty-Code Desktop IDE - TelemetryBadge
 * Responsive, size-aware telemetry token counter adapting to available width.
 * Prevents layout shift using fixed-width slots and tabular-nums.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Zap, Cpu } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { useUsageDashboardStore } from '../../state/usage-dashboard-store';
import { getTelemetryBreakpoint, TelemetryBreakpoint } from '../../hooks/useAvailableWidth';
import styles from './TelemetryBadge.module.css';

export interface TelemetryBadgeProps {
  tokens?: number;
  limit?: number;
  availableWidth?: number;
  onClick?: () => void;
  className?: string;
}

export function formatTelemetryTokens(
  tokens: number,
  limit: number,
  breakpoint: TelemetryBreakpoint
): { formatted: string; label?: string } | null {
  if (breakpoint === 'hidden') return null;

  if (breakpoint === 'wide') {
    const formattedTokens = new Intl.NumberFormat('en-US').format(tokens);
    const formattedLimit = new Intl.NumberFormat('en-US').format(limit);
    return {
      label: 'Tokens',
      formatted: `${formattedTokens} / ${formattedLimit}`
    };
  }

  if (breakpoint === 'medium') {
    const compactTokens = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(tokens).toLowerCase();
    const compactLimit = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(limit).toLowerCase();
    return {
      formatted: `${compactTokens} / ${compactLimit}`
    };
  }

  if (breakpoint === 'narrow') {
    const pct = limit > 0 ? Math.round((tokens / limit) * 100) : 0;
    return {
      formatted: `${pct}%`
    };
  }

  return null;
}

export const TelemetryBadge: React.FC<TelemetryBadgeProps> = ({
  tokens: propTokens,
  limit: propLimit,
  availableWidth,
  onClick,
  className
}) => {
  const storeTokens = useChatStore((s) => s.contextTokens);
  const storeLimit = useChatStore((s) => s.contextLimit);
  const settings = useChatStore((s) => s.settings);
  const isRunning = useChatStore((s) => s.isRunning);
  const quotaSnapshot = useUsageDashboardStore((s) => s.quotaSnapshot);
  const openDashboard = useUsageDashboardStore((s) => s.openDashboard);
  const [savingsLabel, setSavingsLabel] = useState<string>('Optimization saved 0 tokens (0%) this session');
  const [viewMode, setViewMode] = useState<'tokens' | 'model'>('tokens');
  const [isFading, setIsFading] = useState(false);

  // 7-second transition between token amount and model view with smooth fade in/out
  useEffect(() => {
    let fadeTimer: NodeJS.Timeout | null = null;
    const interval = setInterval(() => {
      setIsFading(true);
      fadeTimer = setTimeout(() => {
        setViewMode((prev) => (prev === 'tokens' ? 'model' : 'tokens'));
        setIsFading(false);
      }, 300);
    }, 7000);
    return () => {
      clearInterval(interval);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  useEffect(() => {
    const fetchSavings = () => {
      if (window.electronAPI?.fccGetOptimizationSavings) {
        window.electronAPI.fccGetOptimizationSavings().then((res) => {
          if (res?.success && res.data?.label) {
            setSavingsLabel(res.data.label);
          }
        }).catch(() => {});
      }
    };
    fetchSavings();
    const timer = setInterval(fetchSavings, 10000);
    return () => clearInterval(timer);
  }, []);

  const tokens = propTokens !== undefined ? propTokens : (storeTokens ?? 0);
  const limit = propLimit !== undefined ? propLimit : (storeLimit ?? 128_000);

  const activeModel = settings?.activeModel || 'kilo-auto/free';
  const activeProvider = settings?.activeProvider || 'openrouter';
  const modelShortName = activeModel.split('/').pop() || activeModel;
  const isFreeModel =
    activeModel.includes(':free') ||
    activeProvider === 'openkilo' ||
    activeProvider === 'fcc-proxy' ||
    activeProvider === 'ollama';

  // Real per-provider / per-model quota from the orchestration quota tracker.
  // QuotaTracker forward-counts consumed tokens with healthStatus earned by usage.
  const providerQuota = quotaSnapshot?.providers?.[activeProvider];
  const usedQuotaTokens = providerQuota?.consumedTokens ?? 0;
  const quotaLimit = limit === 0 ? 0 : Math.max(0, providerQuota?.monthlyFreeTokens ?? 0);
  const quotaUserData = providerQuota?.monthlyFreeTokens !== undefined;
  const quotaDisplay = quotaUserData ? usedQuotaTokens : tokens;
  const quotaDisplayLimit = quotaUserData ? (quotaLimit > 0 ? quotaLimit : limit) : limit;

  const currentTier = useMemo(() => {
    const m = activeModel.toLowerCase();
    if (m.includes('r1') || m.includes('o1'))
      return { label: 'Tier S', name: 'Reasoning', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)' };
    if (m.includes('coder') || m.includes('code') || m.includes('sonnet') || m.includes('codellama'))
      return { label: 'Tier A', name: 'Coding', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.15)', border: 'rgba(129, 140, 248, 0.3)' };
    if (m.includes('8b') || m.includes('flash') || m.includes('instant'))
      return { label: 'Tier C', name: 'Fast', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.3)' };
    return { label: 'Tier B', name: 'General', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.3)' };
  }, [activeModel]);

  const providerQuotaAlt =
    providerQuota || (quotaSnapshot?.providers ? quotaSnapshot.providers[`${activeProvider}-free`] : undefined);
  const providerHealth = providerQuotaAlt?.healthStatus || 'untested';
  const dotColor =
    isRunning
      ? '#38bdf8'
      : providerHealth === 'untested'
        ? '#818cf8'
        : providerHealth === 'exhausted'
          ? '#ef4444'
          : providerHealth === 'cooling_down' || providerHealth === 'degraded'
            ? '#f59e0b'
            : '#10b981';

  // Compute breakpoint from explicit availableWidth or default to wide
  const breakpoint = availableWidth !== undefined ? getTelemetryBreakpoint(availableWidth) : 'wide';

  if (breakpoint === 'hidden') {
    return null;
  }

  // The badge's primary counter is the ACTIVE PROVIDER's real quota usage
  // (tokens consumed vs the provider's tracked free limit), so users can see
  // when to switch providers without waiting for a usage window to reset.
  const result = formatTelemetryTokens(quotaDisplay, quotaDisplayLimit, breakpoint);
  if (!result) return null;

  const fullQuotaStr = new Intl.NumberFormat('en-US').format(quotaDisplay);
  const fullQuotaLimitStr = new Intl.NumberFormat('en-US').format(quotaDisplayLimit);
  const contextFullStr = new Intl.NumberFormat('en-US').format(tokens);
  const percentNum = quotaDisplayLimit > 0 ? Math.round((quotaDisplay / quotaDisplayLimit) * 100) : 0;
  const quotaSource = quotaUserData
    ? `${activeProvider}: ${fullQuotaStr} / ${fullQuotaLimitStr} free-token quota used (${percentNum}%)`
    : `No quota data recorded yet for ${activeProvider} — showing session context: ${contextFullStr} tokens`;
  const switchHint =
    providerHealth === 'exhausted' || providerHealth === 'cooling_down'
      ? ' • Provider limit reached — switch to another provider hosting this same model to keep working (Ctrl+M).'
      : '';
  const tooltip = `${savingsLabel} • Model: ${activeModel} (${currentTier.label}) • ${quotaSource}${switchHint} Click to open Smart Orchestration & Quota Dashboard.`;
  const ariaLabel = `Provider tokens ${result.label ? `${result.label} ` : ''}${result.formatted}, ${percentNum}% used, model: ${modelShortName}`;

  const slotClass =
    breakpoint === 'wide'
      ? styles.slotWide
      : breakpoint === 'medium'
        ? styles.slotMedium
        : styles.slotNarrow;

  const handleClick = onClick || openDashboard;

  return (
    <button
      type="button"
      id="status-bar-telemetry-badge"
      className={`${styles.badge} ${slotClass} ${className || ''}`}
      onClick={handleClick}
      title={tooltip}
      aria-label={ariaLabel}
      data-breakpoint={breakpoint}
      data-tokens={quotaDisplay}
      data-limit={quotaDisplayLimit}
    >
      <div
        className={styles.viewContent}
        style={{
          opacity: isFading ? 0 : 1,
          transform: isFading ? 'scale(0.96)' : 'scale(1)',
          transition: 'opacity 0.28s ease, transform 0.28s ease'
        }}
      >
        {viewMode === 'tokens' ? (
          <>
            <Zap size={11} className={styles.icon} />
            {breakpoint === 'wide' && <span className={styles.label}>Quota</span>}
            <span className={styles.value}>{result.formatted}</span>
          </>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', minWidth: 0 }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: dotColor,
                boxShadow: `0 0 6px ${dotColor}`,
                flexShrink: 0
              }}
              aria-hidden="true"
            />
            {breakpoint !== 'narrow' && (
              <>
                <Cpu size={10} color="var(--accent-primary, #818cf8)" style={{ flexShrink: 0 }} />
                <div className={styles.marqueeContainer}>
                  <span className={styles.marqueeText} style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '10.5px' }}>
                    {modelShortName}
                  </span>
                </div>
              </>
            )}
            <span
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '1px 3px',
                borderRadius: '3px',
                backgroundColor: currentTier.bg,
                color: currentTier.color,
                border: `1px solid ${currentTier.border}`,
                flexShrink: 0,
                lineHeight: 1
              }}
            >
              {currentTier.label}
            </span>
            {breakpoint === 'wide' && (
              <span
                style={{
                  fontSize: '8.5px',
                  fontWeight: 700,
                  padding: '1px 3px',
                  borderRadius: '3px',
                  backgroundColor: isFreeModel ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                  color: isFreeModel ? '#34d399' : '#38bdf8',
                  border: `1px solid ${isFreeModel ? 'rgba(16, 185, 129, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                  flexShrink: 0,
                  lineHeight: 1
                }}
              >
                {isFreeModel ? 'FREE' : 'PAID'}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
};
