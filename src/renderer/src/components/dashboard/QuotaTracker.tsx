/**
 * Quota Tracker Component (Phase 6.5)
 *
 * Real-time token counting, daily/monthly quota visualizations with progress bars,
 * commercial cost projection, threshold alerts, time-bucketed historical charts,
 * and per-model consumption breakdowns.
 *
 * Brand: Ty-Code
 */

import React, { useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  DollarSign,
  BarChart3,
  Calendar,
  Layers,
  Sparkles,
  PieChart,
  ShieldCheck,
  Zap
} from 'lucide-react';
import type {
  ConnectedProviderInfo,
  HistoricalUsageBucket,
  ModelUsageStat,
  QuotaAlertItem,
  FreeTierSummary
} from '../../../../shared/types/quota-dashboard';

interface QuotaTrackerProps {
  providers: ConnectedProviderInfo[];
  summary: FreeTierSummary;
  historyDaily: HistoricalUsageBucket[];
  historyWeekly: HistoricalUsageBucket[];
  historyMonthly: HistoricalUsageBucket[];
  modelBreakdown: ModelUsageStat[];
  alerts: QuotaAlertItem[];
}

export const QuotaTracker: React.FC<QuotaTrackerProps> = ({
  providers,
  summary,
  historyDaily,
  historyWeekly,
  historyMonthly,
  modelBreakdown,
  alerts
}) => {
  const [chartMode, setChartMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [viewScope, setViewScope] = useState<'monthly' | 'daily'>('monthly');

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return tokens.toLocaleString();
  };

  const getProgressBarColor = (pct: number) => {
    if (pct >= 90) return '#ef4444';
    if (pct >= 70) return '#f59e0b';
    return '#10b981';
  };

  const activeHistoryData =
    chartMode === 'daily'
      ? historyDaily
      : chartMode === 'weekly'
        ? historyWeekly
        : historyMonthly;

  const maxHistoryTokens = Math.max(1, ...activeHistoryData.map((d) => d.tokens));

  return (
    <div id="quota-tracker-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Active Quota Alerts */}
      {alerts.length > 0 && (
        <div id="quota-alerts-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {alerts.map((alert) => (
            <div
              key={alert.id}
              id={`alert-item-${alert.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: alert.severity === 'critical' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                border: alert.severity === 'critical' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                color: alert.severity === 'critical' ? '#fca5a5' : '#fcd34d',
                fontSize: '12px'
              }}
            >
              <AlertTriangle size={16} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{alert.providerName}: </span>
                {alert.message}
              </div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)'
                }}
              >
                {alert.percentUsed}% Quota
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div
        id="quota-kpi-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px'
        }}
      >
        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '14px 16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <span>Total Free Pool</span>
            <Layers size={14} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
            {formatTokens(summary.totalFreeTokensMonthly)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Monthly limit across {summary.activeFreeProvidersCount} providers
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '14px 16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <span>Consumed (Month)</span>
            <TrendingUp size={14} color="#10b981" />
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399', marginTop: '6px' }}>
            {formatTokens(summary.totalTokensConsumedMonthly)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {((summary.totalTokensConsumedMonthly / Math.max(1, summary.totalFreeTokensMonthly)) * 100).toFixed(1)}% of free pool
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '14px 16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <span>Commercial Cost Saved</span>
            <DollarSign size={14} color="#fbbf24" />
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24', marginTop: '6px' }}>
            ${summary.totalEstimatedSavingsUsd.toFixed(2)} USD
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Calculated at $3.00 / 1M token benchmark
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '14px 16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <span>Remaining Headroom</span>
            <ShieldCheck size={14} color="#c084fc" />
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#c084fc', marginTop: '6px' }}>
            {formatTokens(summary.totalRemainingTokensMonthly)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Zero-cost capacity remaining
          </div>
        </div>
      </div>

      {/* Provider Quota Progress Bars */}
      <div
        id="provider-quota-bars-section"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
              Quota Consumption by Provider
            </h4>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Real-time progress towards daily and monthly rate thresholds
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              type="button"
              id="btn-scope-monthly"
              onClick={() => setViewScope('monthly')}
              style={{
                background: viewScope === 'monthly' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: viewScope === 'monthly' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Monthly Quota
            </button>
            <button
              type="button"
              id="btn-scope-daily"
              onClick={() => setViewScope('daily')}
              style={{
                background: viewScope === 'daily' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: viewScope === 'daily' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Daily Limit
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {providers.map((p) => {
            const maxTokens = viewScope === 'monthly' ? p.monthlyQuotaTokens : p.dailyQuotaTokens;
            const usedTokens = viewScope === 'monthly' ? p.consumedTokens : p.consumedTokensToday;
            const pct = Math.min(100, Math.round((usedTokens / Math.max(1, maxTokens)) * 1000) / 10);
            const barColor = getProgressBarColor(pct);

            return (
              <div key={p.id} id={`quota-bar-${p.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{p.name}</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>({p.id})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#94a3b8' }}>
                      {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
                    </span>
                    <span style={{ fontWeight: 700, color: barColor, minWidth: '40px', textAlign: 'right' }}>
                      {pct}%
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: barColor,
                      borderRadius: '3px',
                      transition: 'width 0.4s ease'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical Usage Charts (Daily, Weekly, Monthly) */}
      <div
        id="usage-history-chart-section"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart3 size={15} color="#38bdf8" />
              Historical Token Consumption Trends
            </h4>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Granular time-series distribution across connected free providers
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            {(['daily', 'weekly', 'monthly'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                id={mode === 'daily' ? 'btn-chart-mode-daily' : mode === 'weekly' ? 'btn-chart-mode-weekly' : 'btn-chart-mode-monthly'}
                onClick={() => setChartMode(mode)}
                style={{
                  background: chartMode === mode ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: chartMode === mode ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize'
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Lightweight Modern Bar Chart */}
        <div
          id="history-bar-chart"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            height: '140px',
            paddingTop: '20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          {activeHistoryData.map((bucket, idx) => {
            const heightPct = Math.max(8, Math.round((bucket.tokens / maxHistoryTokens) * 100));

            return (
              <div
                key={idx}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'flex-end'
                }}
                title={`${bucket.dateLabel}: ${bucket.tokens.toLocaleString()} tokens (${bucket.requests} requests)`}
              >
                <div
                  style={{
                    width: '100%',
                    height: `${heightPct}%`,
                    backgroundColor: idx === activeHistoryData.length - 1 ? '#38bdf8' : 'rgba(56, 189, 248, 0.45)',
                    borderRadius: '4px 4px 0 0',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#60a5fa')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = idx === activeHistoryData.length - 1 ? '#38bdf8' : 'rgba(56, 189, 248, 0.45)')}
                />
                <span
                  style={{
                    fontSize: '9px',
                    color: '#64748b',
                    marginTop: '6px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {bucket.dateLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-Model Usage Breakdown */}
      <div
        id="model-breakdown-section"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px'
        }}
      >
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PieChart size={15} color="#c084fc" />
          Per-Model Consumption Breakdown
        </h4>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {modelBreakdown.map((item) => (
            <div
              key={item.modelId}
              id={`model-stat-${item.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '8px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(0, 0, 0, 0.15)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{item.modelName}</span>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>via {item.providerName}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {item.requestCount} requests · {item.avgLatencyMs}ms avg
                  </span>
                  <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                    {formatTokens(item.tokensConsumed)} ({item.percentage}%)
                  </span>
                </div>
              </div>

              <div
                style={{
                  width: '100%',
                  height: '4px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${item.percentage}%`,
                    height: '100%',
                    backgroundColor: '#818cf8',
                    borderRadius: '2px'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
