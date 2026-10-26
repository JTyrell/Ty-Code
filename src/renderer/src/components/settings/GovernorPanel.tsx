/**
 * Memory Governor Panel (Step 4: Diagnostics tab)
 *
 * Renders the current governor tier, main-process RSS and a ~12-minute
 * sparkline from the local ring buffer. All data is read through atomic
 * Zustand selectors and stays on the machine (Zero-Telemetry).
 */

import React from 'react';
import { Activity, ShieldAlert } from 'lucide-react';
import {
  useGovernorStore,
  selectGovernorTier,
  selectGovernorLiteMode,
  selectGovernorMainRssMb,
  selectGovernorTotalRamGb,
  selectGovernorSparkline,
  selectGovernorLatestSample,
  selectGovernorSurfaces,
  type GovernorTier
} from '../../state/governor-store';

const TIER_COLORS: Record<GovernorTier, string> = {
  NOMINAL: '#34d399',
  ELEVATED: '#fbbf24',
  CRITICAL: '#fb923c',
  OVER: '#f87171'
};

const TIER_ACTIONS: Record<GovernorTier, string> = {
  NOMINAL: 'Full features. Idle budget 0.8-1.2 GB.',
  ELEVATED: 'Cold caches evicted.',
  CRITICAL: 'Background work paused; pooled Monaco models and content caches shed.',
  OVER: 'Least-recently-active surface shed to avoid OS OOM.'
};

export const GovernorPanel: React.FC = () => {
  const tier = useGovernorStore(selectGovernorTier);
  const liteMode = useGovernorStore(selectGovernorLiteMode);
  const mainRssMb = useGovernorStore(selectGovernorMainRssMb);
  const totalSystemRamGb = useGovernorStore(selectGovernorTotalRamGb);
  const sparkline = useGovernorStore(selectGovernorSparkline);
  const latestSample = useGovernorStore(selectGovernorLatestSample);
  const surfaces = useGovernorStore(selectGovernorSurfaces);

  const color = TIER_COLORS[tier];
  const w = 220;
  const h = 40;
  const maxMb = Math.max(3.0 * 1024, ...sparkline, 1);
  const points = sparkline.length > 1
    ? sparkline
        .map((mb, i) => {
          const x = (i / (sparkline.length - 1)) * w;
          const y = h - (mb / maxMb) * h;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    : null;

  return (
    <div
      className="governor-panel"
      style={{
        margin: '0 0 16px 0',
        padding: '14px 16px',
        borderRadius: '10px',
        border: `1px solid ${color}44`,
        backgroundColor: `${color}0f`,
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 150 }}>
        {tier === 'CRITICAL' || tier === 'OVER' ? (
          <ShieldAlert size={16} color={color} />
        ) : (
          <Activity size={16} color={color} />
        )}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color }}>
            Memory: {tier}
            {liteMode ? ' · LITE' : ''}
          </div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted, #6b7280)' }}>
            {TIER_ACTIONS[tier]}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '14px', fontSize: '11px', color: 'var(--text-secondary, #9ca3af)' }}>
        <span>
          Main RSS: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{mainRssMb.toFixed(0)} MB</strong>
        </span>
        {latestSample?.rendererHeapUsedMb !== undefined && (
          <span>
            Renderer heap: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{latestSample.rendererHeapUsedMb.toFixed(0)} MB</strong>
          </span>
        )}
        {totalSystemRamGb > 0 && (
          <span>
            System RAM: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{totalSystemRamGb.toFixed(1)} GB</strong>
          </span>
        )}
        <span>
          Surfaces: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{surfaces.filter((s) => s.active).length}</strong>/{surfaces.length}
        </span>
      </div>

      <svg width={w} height={h} style={{ flexShrink: 0 }} aria-label="Main-process RSS, last ~12 minutes">
        {points && (
          <>
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <line
              x1="0"
              x2={w}
              y1={h - (3.0 * 1024 / maxMb) * h}
              y2={h - (3.0 * 1024 / maxMb) * h}
              stroke="#f8717155"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          </>
        )}
      </svg>
    </div>
  );
};
