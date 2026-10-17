/**
 * ChatErrorCard UI Component (Real Agent Error Taxonomy)
 *
 * Renders categorized error states originating from the backend diagnostics/error taxonomy engine.
 * Theme: Obsidian Cyber (sleek dark mode, red/amber glow accent border, high contrast monospace badges).
 *
 * Taxonomy Handled:
 * - CONFIG_MISSING: 'ty-code://settings/providers' -> 'Connect Provider'
 * - NETWORK_BLOCKED: in-app retry -> 'Retry'
 * - RATE_LIMITED / QUOTA_EXCEEDED: 'ty-code://dashboard/quota' -> 'View Quota Dashboard'
 * - PROVIDER_DOWN / TIMEOUT: 'ty-code://settings/providers' -> 'Switch Model'
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  WifiOff,
  Key,
  Clock,
  Server,
  RotateCcw,
  ExternalLink,
  Settings,
  Activity,
  X,
  Lightbulb,
  Info,
  ShieldAlert,
  Zap
} from 'lucide-react';
import type { ChatErrorCard as ChatErrorCardType } from '../../../shared/types/agent-events';
import { useChatStore } from '../state/chat-store';

export interface ChatErrorCardProps {
  errorCard?: ChatErrorCardType;
  taxonomyCode?: string;
  message?: string;
  remedy?: string;
  actionUrl?: string;
  actionLabel?: string;
  providerId?: string;
  suggestedFallback?: string;
  retryAfterSec?: number;
  hopId?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export const ChatErrorCard: React.FC<ChatErrorCardProps> = (props) => {
  // Support both full errorCard object prop or flattened direct props
  const raw = props.errorCard;
  const taxonomyCode = props.taxonomyCode || raw?.taxonomyCode || 'ERROR';
  const message = props.message || raw?.message || 'An unexpected agent error occurred.';
  const remedy = props.remedy || raw?.remedy;
  const actionUrl = props.actionUrl || raw?.actionUrl;
  const actionLabel = props.actionLabel || raw?.actionLabel;
  const providerId = props.providerId || raw?.providerId;
  const suggestedFallback = props.suggestedFallback || raw?.suggestedFallback;
  const retryAfterSec = props.retryAfterSec ?? raw?.retryAfterSec;
  const hopId = props.hopId || raw?.hopId;

  const onRetry = props.onRetry;
  const onDismiss = props.onDismiss;

  const openSettings = useChatStore((s) => s.openSettings);
  const [retrying, setRetrying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(retryAfterSec ?? null);

  // Handle retry countdown if retryAfterSec is given
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Color scheme based on taxonomy classification
  const isNetwork = taxonomyCode === 'NETWORK_BLOCKED';
  const isRateLimit = taxonomyCode === 'RATE_LIMITED' || taxonomyCode === 'QUOTA_EXCEEDED';
  const isConfig = taxonomyCode === 'CONFIG_MISSING' || taxonomyCode === 'CONFIG_INVALID';
  const isOutage = taxonomyCode === 'PROVIDER_DOWN' || taxonomyCode === 'TIMEOUT';

  const accentColor = isNetwork || isRateLimit
    ? '#f59e0b' // Amber glow
    : '#ef4444'; // Red glow

  const borderColor = isNetwork || isRateLimit
    ? 'rgba(245, 158, 11, 0.45)'
    : 'rgba(239, 68, 68, 0.45)';

  const badgeBg = isNetwork || isRateLimit
    ? 'rgba(245, 158, 11, 0.15)'
    : 'rgba(239, 68, 68, 0.15)';

  const getTaxonomyIcon = () => {
    if (isNetwork) return <WifiOff size={15} color={accentColor} />;
    if (isConfig) return <Key size={15} color={accentColor} />;
    if (isRateLimit) return <Clock size={15} color={accentColor} />;
    if (isOutage) return <Server size={15} color={accentColor} />;
    return <AlertTriangle size={15} color={accentColor} />;
  };

  const handleActionClick = () => {
    // 1. In-app retry action
    if (actionLabel === 'Retry' || actionLabel === 'Retry Now' || actionUrl === 'ty-code://action/retry') {
      if (onRetry) {
        setRetrying(true);
        onRetry();
        window.setTimeout(() => setRetrying(false), 1500);
      }
      return;
    }

    // 2. In-app settings providers action
    if (
      actionUrl === 'ty-code://settings/providers' ||
      actionUrl === 'settings:providers' ||
      actionLabel === 'Connect Provider' ||
      actionLabel === 'Switch Model' ||
      actionLabel === 'Add API Key in Settings'
    ) {
      openSettings('providers');
      return;
    }

    // 3. In-app quota dashboard action
    if (actionUrl === 'ty-code://dashboard/quota' || actionLabel === 'View Quota Dashboard') {
      openSettings('analytics');
      return;
    }

    // 4. External URL link
    if (actionUrl) {
      if (window.electronAPI?.openExternal) {
        void window.electronAPI.openExternal(actionUrl);
      } else if (typeof window !== 'undefined') {
        window.open(actionUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleManualRetry = () => {
    if (!onRetry) return;
    setRetrying(true);
    onRetry();
    window.setTimeout(() => setRetrying(false), 1500);
  };

  return (
    <div
      className={`chat-error-card ${props.className || ''}`}
      role="alert"
      style={{
        margin: '10px 0',
        padding: '14px 16px',
        backgroundColor: '#0c1017',
        backgroundImage: 'linear-gradient(180deg, rgba(18, 24, 38, 0.95) 0%, rgba(12, 16, 23, 0.98) 100%)',
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        boxShadow: `0 4px 20px ${isNetwork || isRateLimit ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)'}`,
        position: 'relative',
        color: '#f1f5f9',
        fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)'
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {getTaxonomyIcon()}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              fontFamily: 'var(--font-mono, monospace)',
              backgroundColor: badgeBg,
              color: accentColor,
              border: `1px solid ${borderColor}`
            }}
          >
            {taxonomyCode}
          </span>
          {providerId && (
            <span
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}
            >
              {providerId}
            </span>
          )}
          {hopId && (
            <span
              style={{
                fontSize: '10px',
                color: '#64748b',
                fontFamily: 'monospace'
              }}
            >
              [{hopId}]
            </span>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error card"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#cbd5e1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error Message */}
      <div style={{ marginBottom: '10px' }}>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            lineHeight: '1.5',
            color: '#f8fafc',
            fontWeight: 500
          }}
        >
          {message}
        </p>
      </div>

      {/* Remedy / What is needed */}
      {remedy && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '8px 10px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            marginBottom: '12px',
            fontSize: '12px',
            color: '#cbd5e1',
            lineHeight: '1.4'
          }}
        >
          <Lightbulb size={14} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: '#f59e0b', marginRight: '4px' }}>Remedy:</strong>
            <span>{remedy}</span>
          </div>
        </div>
      )}

      {/* Suggested Fallback Notice */}
      {suggestedFallback && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: '#94a3b8',
            marginBottom: '12px'
          }}
        >
          <Info size={12} color="#38bdf8" />
          <span>Suggested fallback: <strong style={{ color: '#e2e8f0' }}>{suggestedFallback}</strong></span>
        </div>
      )}

      {/* Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          marginTop: '6px'
        }}
      >
        {/* Primary Action Button (from payload actionLabel or Retry) */}
        {actionLabel ? (
          <button
            type="button"
            onClick={handleActionClick}
            disabled={retrying || (countdown !== null && countdown > 0 && actionLabel.toLowerCase().includes('retry'))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '5px',
              border: `1px solid ${borderColor}`,
              backgroundColor: isNetwork || isRateLimit ? '#d97706' : 'var(--accent-primary, #6366f1)',
              color: '#ffffff',
              cursor: retrying ? 'wait' : 'pointer',
              transition: 'opacity 0.15s ease',
              boxShadow: `0 2px 8px ${isNetwork || isRateLimit ? 'rgba(217, 119, 6, 0.25)' : 'rgba(99, 102, 241, 0.25)'}`
            }}
          >
            {actionLabel.toLowerCase().includes('retry') ? (
              <RotateCcw size={12} className={retrying ? 'animate-spin' : ''} />
            ) : actionLabel.toLowerCase().includes('provider') || actionLabel.toLowerCase().includes('model') ? (
              <Settings size={12} />
            ) : actionLabel.toLowerCase().includes('quota') ? (
              <Activity size={12} />
            ) : (
              <Zap size={12} />
            )}
            <span>
              {retrying
                ? 'Retrying…'
                : countdown !== null && countdown > 0 && actionLabel.toLowerCase().includes('retry')
                ? `Retry (${countdown}s)`
                : actionLabel}
            </span>
            {actionUrl && !actionUrl.startsWith('ty-code://') && !actionUrl.startsWith('settings:') && (
              <ExternalLink size={10} style={{ opacity: 0.8 }} />
            )}
          </button>
        ) : onRetry ? (
          <button
            type="button"
            onClick={handleManualRetry}
            disabled={retrying}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '5px',
              border: `1px solid ${borderColor}`,
              backgroundColor: '#d97706',
              color: '#ffffff',
              cursor: retrying ? 'wait' : 'pointer'
            }}
          >
            <RotateCcw size={12} className={retrying ? 'animate-spin' : ''} />
            <span>{retrying ? 'Retrying…' : 'Retry'}</span>
          </button>
        ) : null}

        {/* Secondary Navigation Actions */}
        <button
          type="button"
          onClick={() => openSettings('providers')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '5px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            color: '#cbd5e1',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; }}
        >
          <Settings size={11} />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => openSettings('diagnostics')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '5px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            color: '#cbd5e1',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; }}
        >
          <Activity size={11} />
          <span>Diagnostics</span>
        </button>
      </div>
    </div>
  );
};
