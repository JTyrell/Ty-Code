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

  // 7-second transition between token amount and model view
  useEffect(() => {
    const interval = setInterval(() => {
      setViewMode((prev) => (prev === 'tokens' ? 'model' : 'tokens'));
    }, 7000);
    return () => clearInterval(interval);
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

  const activeModel = settings?.activeModel || 'qwen/qwen-2.5-coder-32b-instruct:free';
  const activeProvider = settings?.activeProvider || 'openrouter';
  const modelShortName = activeModel.split('/').pop() || activeModel;
  const isFreeModel =
    activeModel.includes(':free') ||
    activeProvider === 'openkilo' ||
    activeProvider === 'fcc-proxy' ||
    activeProvider === 'ollama';

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

  const providerQuota = quotaSnapshot?.providers?.[activeProvider];
  const providerHealth = providerQuota?.healthStatus || 'healthy';
  const dotColor =
    isRunning
      ? '#38bdf8'
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

  const result = formatTelemetryTokens(tokens, limit, breakpoint);
  if (!result) return null;

  const fullTokensStr = new Intl.NumberFormat('en-US').format(tokens);
  const fullLimitStr = new Intl.NumberFormat('en-US').format(limit);
  const percentNum = limit > 0 ? Math.round((tokens / limit) * 100) : 0;
  const tooltip = `${savingsLabel} • Model: ${activeModel} (${currentTier.label}) • Tokens: ${fullTokensStr} / ${fullLimitStr} (${percentNum}% used). Click to open Smart Orchestration & Quota Dashboard.`;
  const ariaLabel = `Tokens ${result.label ? `${result.label} ` : ''}${result.formatted}, ${percentNum}% used, model: ${modelShortName}`;

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
      data-tokens={tokens}
      data-limit={limit}
      style={{
        transition: 'all 0.3s ease',
        minWidth: viewMode === 'model' && breakpoint === 'wide' ? '220px' : undefined
      }}
    >
      {viewMode === 'tokens' ? (
        <>
          <Zap size={11} className={styles.icon} />
          {breakpoint === 'wide' && <span className={styles.label}>Tokens</span>}
          <span className={styles.value}>{result.formatted}</span>
        </>
      ) : (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: dotColor,
              boxShadow: `0 0 6px ${dotColor}`
            }}
            aria-hidden="true"
          />
          <Cpu size={11} color="var(--accent-primary, #818cf8)" />
          <span style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {modelShortName}
          </span>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: '3px',
              backgroundColor: currentTier.bg,
              color: currentTier.color,
              border: `1px solid ${currentTier.border}`
            }}
          >
            {currentTier.label}
          </span>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: '3px',
              backgroundColor: isFreeModel ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
              color: isFreeModel ? '#34d399' : '#38bdf8',
              border: `1px solid ${isFreeModel ? 'rgba(16, 185, 129, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`
            }}
          >
            {isFreeModel ? 'FREE' : 'PAID'}
          </span>
        </div>
      )}
    </button>
  );
};
