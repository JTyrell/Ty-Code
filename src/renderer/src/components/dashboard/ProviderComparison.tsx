/**
 * Provider Comparison Component (Phase 6.5)
 *
 * Side-by-side comparison matrix of free-tier AI providers evaluating model count,
 * quota allocation, real-world latency, reliability success rate, and specialization.
 *
 * Brand: Ty-Code
 */

import React, { useState } from 'react';
import {
  Layers,
  Zap,
  CheckCircle2,
  Clock,
  Sparkles,
  Award,
  ShieldCheck,
  TrendingUp,
  Cpu
} from 'lucide-react';
import type { ProviderComparisonMetric } from '../../../../shared/types/quota-dashboard';

interface ProviderComparisonProps {
  comparisons: ProviderComparisonMetric[];
  onSelectProvider?: (providerId: string) => void;
}

export const ProviderComparison: React.FC<ProviderComparisonProps> = ({
  comparisons,
  onSelectProvider
}) => {
  const [filterTier, setFilterTier] = useState<'ALL' | 'S' | 'A' | 'B'>('ALL');

  const filteredComparisons = filterTier === 'ALL'
    ? comparisons
    : comparisons.filter((c) => c.ratingTier === filterTier);

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return tokens.toString();
  };

  const getTierBadge = (tier: 'S' | 'A' | 'B' | 'C') => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      S: { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' },
      A: { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' },
      B: { bg: 'rgba(52, 211, 153, 0.15)', text: '#34d399', border: 'rgba(52, 211, 153, 0.35)' },
      C: { bg: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24', border: 'rgba(251, 191, 36, 0.35)' }
    };
    const c = colors[tier] || colors.B;
    return (
      <span
        style={{
          fontSize: '11px',
          fontWeight: 800,
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: c.bg,
          color: c.text,
          border: `1px solid ${c.border}`,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        Tier {tier}
      </span>
    );
  };

  return (
    <div id="provider-comparison-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header and Tier Filter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Award size={16} color="var(--accent-primary, #38bdf8)" />
            Side-by-Side Provider Benchmark Matrix
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Multi-dimensional evaluation of free capacity, latency profile, and task suitability.
          </p>
        </div>

        {/* Filter Segmented Control */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: '6px',
            padding: '2px',
            border: '1px solid var(--border-subtle)'
          }}
        >
          {(['ALL', 'S', 'A', 'B'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              id={tier === 'S' ? 'btn-filter-tier-s' : tier === 'A' ? 'btn-filter-tier-a' : tier === 'B' ? 'btn-filter-tier-b' : 'btn-filter-tier-all'}
              onClick={() => setFilterTier(tier)}
              style={{
                background: filterTier === tier ? 'var(--surface-3)' : 'transparent',
                color: filterTier === tier ? 'var(--accent-primary, #38bdf8)' : 'var(--text-secondary)',
                border: filterTier === tier ? '1px solid var(--border-default)' : '1px solid transparent',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {tier === 'ALL' ? 'All Providers' : `Tier ${tier}`}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Comparison Cards */}
      <div
        id="provider-comparison-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '12px'
        }}
      >
        {filteredComparisons.map((item) => (
          <div
            key={item.providerId}
            id={`card-comparison-${item.providerId}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '16px',
              gap: '14px',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
          >
            {/* Provider Title & Tier Badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <Cpu size={16} color="var(--accent-primary, #38bdf8)" />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.providerName}
                  </h4>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {item.providerId}
                  </span>
                </div>
              </div>

              {getTierBadge(item.ratingTier)}
            </div>

            {/* Metrics Breakdown Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: '8px',
                padding: '10px 12px',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Free Models
                </span>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {item.freeModelCount} Models
                </div>
              </div>

              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Free Quota
                </span>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan, #06b6d4)', marginTop: '2px' }}>
                  {formatTokens(item.totalTokensAvailable)} /mo
                </div>
              </div>

              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Avg Latency
                </span>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: item.averageLatencyMs <= 150 ? 'var(--accent-green, #10b981)' : 'var(--text-primary)',
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Clock size={11} color={item.averageLatencyMs > 0 && item.averageLatencyMs <= 150 ? 'var(--accent-green, #10b981)' : 'var(--text-muted)'} />
                  {item.averageLatencyMs > 0 ? `${item.averageLatencyMs} ms` : 'Not measured'}
                </div>
              </div>

              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Success Rate
                </span>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: item.successRate >= 99 ? 'var(--accent-green, #10b981)' : 'var(--accent-amber, #f59e0b)',
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <CheckCircle2 size={11} color={item.successRate >= 99 ? 'var(--accent-green, #10b981)' : 'var(--text-muted)'} />
                  {item.successRate > 0 ? `${item.successRate}%` : 'No data'}
                </div>
              </div>
            </div>

            {/* Best For Tag */}
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Best For:
              </span>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  backgroundColor: 'var(--surface-2)',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {item.bestFor}
              </div>
            </div>

            {/* Key Strengths */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Key Strengths
              </span>
              <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {item.strengths.map((str, idx) => (
                  <li key={idx}>{str}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
