/**
 * Ty-Code Desktop IDE - TelemetryBadge
 * Responsive, size-aware telemetry token counter adapting to available width.
 * Prevents layout shift using fixed-width slots and tabular-nums.
 */

import React from 'react';
import { Zap } from 'lucide-react';
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
  const openDashboard = useUsageDashboardStore((s) => s.openDashboard);

  const tokens = propTokens !== undefined ? propTokens : (storeTokens ?? 0);
  const limit = propLimit !== undefined ? propLimit : (storeLimit ?? 128_000);

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
  const tooltip = `Tokens: ${fullTokensStr} / ${fullLimitStr} (${percentNum}% used). Click to open Smart Orchestration & Quota Dashboard.`;
  const ariaLabel = `Tokens ${result.label ? `${result.label} ` : ''}${result.formatted}, ${percentNum}% used`;

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
    >
      <Zap size={11} className={styles.icon} />
      {breakpoint === 'wide' && <span className={styles.label}>Tokens</span>}
      <span className={styles.value}>{result.formatted}</span>
    </button>
  );
};
