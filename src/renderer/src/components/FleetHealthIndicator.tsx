import React, { useEffect, useState, useCallback } from 'react';
import { Activity } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import type { DiagnosticsFleetHealth, FleetHealthState } from '../../../shared/types/diagnostics';

export const FleetHealthIndicator: React.FC = () => {
  // No fabricated defaults: nothing "healthy" is claimed until real fleet data arrives
  const [health, setHealth] = useState<DiagnosticsFleetHealth | null>(null);
  const openSettings = useChatStore((state) => state.openSettings);

  const fetchHealth = useCallback(async () => {
    if (window.electronAPI?.diagnosticsGetFleetHealth) {
      try {
        const res = await window.electronAPI.diagnosticsGetFleetHealth();
        if (res.success && res.data) {
          setHealth(res.data);
        }
      } catch (err) {
        console.warn('Failed to fetch diagnostics fleet health:', err);
      }
    }
  }, []);

  useEffect(() => {
    void fetchHealth();

    // Subscribe to IPC fleet health change broadcasts
    let unsubscribe: (() => void) | undefined;
    if (window.electronAPI?.onDiagnosticsFleetHealthChanged) {
      unsubscribe = window.electronAPI.onDiagnosticsFleetHealthChanged((updated) => {
        if (updated) {
          setHealth(updated);
        }
      });
    }

    // Periodic safety poll every 15s
    const timer = setInterval(() => {
      void fetchHealth();
    }, 15_000);

    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [fetchHealth]);

  // Check battery & connection APIs in browser/renderer to auto-inform main process if possible
  useEffect(() => {
    const handleConnectionChange = () => {
      const conn = (navigator as unknown as { connection?: { saveData?: boolean; type?: string } }).connection;
      if (conn?.saveData && window.electronAPI?.diagnosticsSetMeteredConnection) {
        void window.electronAPI.diagnosticsSetMeteredConnection(true);
      }
    };

    if ('connection' in navigator) {
      handleConnectionChange();
      const conn = (navigator as unknown as { connection?: EventTarget }).connection;
      conn?.addEventListener?.('change', handleConnectionChange);
      return () => {
        conn?.removeEventListener?.('change', handleConnectionChange);
      };
    }
    return undefined;
  }, []);

  const state: FleetHealthState = health?.state || 'degraded';
  const dotColor = !health
    ? '#9ca3af'
    : state === 'all-healthy'
      ? '#10b981'
      : state === 'degraded'
        ? '#f59e0b'
        : '#ef4444';

  const labelText = !health
    ? 'Fleet: checking...'
    : state === 'all-healthy'
      ? 'Fleet Healthy'
      : state === 'degraded'
        ? 'Fleet Degraded'
        : 'Fleet Down';

  const titleText = (() => {
    if (!health) return 'Fetching live fleet health from the diagnostics service. Click to open Diagnostics.';
    const untested = health.untestedCount > 0 ? `, ${health.untestedCount} untested` : '';
    const base = state === 'all-healthy'
      ? `Fleet Health: All Healthy (${health.healthyCount}/${health.totalCount} proven operational)`
      : state === 'degraded'
        ? `Fleet Health: Degraded (${health.healthyCount} proven healthy, ${health.testedCount}/${health.totalCount} connection-tested${untested})`
        : `Fleet Health: No Working Providers (0 proven of ${health.totalCount})`;
    const quiet = health.quietModeActive ? ' [Quiet Mode: Pings Paused]' : '';
    return `${base}${quiet}. Click to open Diagnostics.`;
  })();

  const handleClick = () => {
    openSettings('diagnostics');
  };

  return (
    <button
      type="button"
      id="status-bar-health-indicator"
      data-fleet-state={state}
      onClick={handleClick}
      title={titleText}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        color: 'var(--text-secondary)',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '4px',
        padding: '2px 6px',
        cursor: 'pointer',
        fontSize: '11px',
        transition: 'all 0.15s ease'
      }}
    >
      <div
        id="status-bar-health-dot"
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: `0 0 6px ${dotColor}`,
          flexShrink: 0
        }}
      />
      <Activity size={11} color={dotColor} />
      <span id="status-bar-health-text" style={{ fontWeight: 500 }}>
        {labelText}
      </span>
      {health?.quietModeActive && (
        <span
          id="status-bar-health-quiet-tag"
          style={{
            fontSize: '8px',
            padding: '0 3px',
            borderRadius: '2px',
            backgroundColor: 'rgba(148, 163, 184, 0.2)',
            color: 'var(--text-muted)'
          }}
          title="Quiet Mode Active: Battery Saver / Metered Connection (background checks paused)"
        >
          QUIET
        </span>
      )}
    </button>
  );
};
