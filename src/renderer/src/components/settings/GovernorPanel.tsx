/**
 * Memory Governor Panel (Step 4: Diagnostics tab)
 *
 * Renders the current governor tier, main-process RSS and a ~12-minute
 * sparkline from the local ring buffer. Zero-render-loop design:
 * - Hook selectors return PRIMITIVES only (tier, rss, counts, version).
 * - The sparkline is drawn into a <canvas> via a ref inside ONE
 *   empty-deps store.subscribe effect; per-sample updates trigger ZERO
 *   setState except the tier label (hook-selected, changes only on tier flip).
 * - The ring buffer is read through the immutable sampleVersion counter;
 *   the live samples array is never selected through a hook.
 * All data is read through atomic Zustand selectors and stays on the machine
 * (Zero-Telemetry).
 */

import React, { useEffect, useRef } from 'react';
import { Activity, ShieldAlert } from 'lucide-react';
import {
  useGovernorStore,
  selectGovernorTier,
  selectGovernorLiteMode,
  selectGovernorMainRssMb,
  selectGovernorTotalRamGb,
  selectGovernorSampleVersion,
  selectGovernorSurfaceTotal,
  selectGovernorSurfaceActive,
  type GovernorTier
} from '../../state/governor-store';
import { trackRenders } from '../../dev/render-storm';

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

const SPARK_W = 220;
const SPARK_H = 40;
const DANGER_MB = 3.0 * 1024;

function drawSparkline(canvas: HTMLCanvasElement, samples: readonly number[], tier: GovernorTier): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== SPARK_W * dpr || canvas.height !== SPARK_H * dpr) {
    canvas.width = Math.round(SPARK_W * dpr);
    canvas.height = Math.round(SPARK_H * dpr);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  const maxMb = Math.max(DANGER_MB, ...samples, 1);
  const color = TIER_COLORS[tier];

  // Danger threshold line (3 GB)
  const dangerY = SPARK_H - (DANGER_MB / maxMb) * SPARK_H;
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.33)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, dangerY);
  ctx.lineTo(SPARK_W, dangerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // RSS polyline
  if (samples.length > 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((mb, i) => {
      const x = (i / (samples.length - 1)) * SPARK_W;
      const y = SPARK_H - (mb / maxMb) * SPARK_H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

export const GovernorPanel: React.FC = () => {
  trackRenders('settings:GovernorPanel');
  // Primitives only — stable by value, no snapshot instability possible.
  const tier = useGovernorStore(selectGovernorTier);
  const liteMode = useGovernorStore(selectGovernorLiteMode);
  const mainRssMb = useGovernorStore(selectGovernorMainRssMb);
  const totalSystemRamGb = useGovernorStore(selectGovernorTotalRamGb);
  const surfaceTotal = useGovernorStore(selectGovernorSurfaceTotal);
  const surfaceActive = useGovernorStore(selectGovernorSurfaceActive);
  // Immutable ring-buffer VERSION counter (never the live array).
  useGovernorStore(selectGovernorSampleVersion);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererHeapTextRef = useRef<HTMLSpanElement>(null);

  const color = TIER_COLORS[tier];

  useEffect(() => {
    let lastVersion = -1;

    const renderSample = (): void => {
      const state = useGovernorStore.getState();
      if (state.sampleVersion === lastVersion) return;
      lastVersion = state.sampleVersion;

      const canvas = canvasRef.current;
      if (canvas) {
        drawSparkline(
          canvas,
          state.samples.map((s) => s.mainRssMb),
          state.tier
        );
      }
      const heapText = rendererHeapTextRef.current;
      if (heapText) {
        heapText.textContent =
          state.latestSample?.rendererHeapUsedMb !== undefined
            ? `${state.latestSample.rendererHeapUsedMb.toFixed(0)} MB`
            : '—';
      }
    };

    // Initial draw from the current snapshot (no state writes).
    renderSample();

    // ONE disposable subscription; cleanup on unmount.
    const unsubscribe = useGovernorStore.subscribe(() => {
      renderSample();
    });
    return () => {
      unsubscribe();
    };
  }, []);

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
        <span>
          Renderer heap: <strong ref={rendererHeapTextRef} style={{ color: 'var(--text-primary, #e5e7eb)' }}>—</strong>
        </span>
        {totalSystemRamGb > 0 && (
          <span>
            System RAM: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{totalSystemRamGb.toFixed(1)} GB</strong>
          </span>
        )}
        <span>
          Surfaces: <strong style={{ color: 'var(--text-primary, #e5e7eb)' }}>{surfaceActive}</strong>/{surfaceTotal}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: SPARK_W, height: SPARK_H, flexShrink: 0 }}
        aria-label="Main-process RSS, last ~12 minutes"
      />
    </div>
  );
};
