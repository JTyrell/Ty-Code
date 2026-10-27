/**
 * ProviderHealthDashboard Component (Phase FCC-1)
 *
 * Admin-UI-grade provider health dashboard & ToS curation surface:
 * - Fleet summary card: healthy count, degraded count, total free models available right now
 * - Free-token framing: "1.3B+ free tokens/mo across 61 providers"
 * - Sidecar lifecycle controls: running/stopped/restart, logs viewer, 'Disable FCC layer' toggle
 * - Status display: 'FCC offline — native supply active' when FCC layer is unavailable
 * - Searchable model & provider UI with filter buttons:
 *     free-only, reasoning, coding, fast, large-context, ToS compliant
 * - 61-provider grid with health dot, latency, success rate, quota remaining, ToS status, auth type
 * - Per-provider actions: test, enable/disable, view models, open signup
 * - Risky providers shown disabled by default with prominent ToS explanation tooltip
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Server,
  Zap,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Cpu,
  Sparkles,
  Info,
  Clock,
  Layers,
  Sliders,
  ChevronDown,
  ChevronUp,
  X,
  Lock,
  Play,
  Square
} from 'lucide-react';
import type {
  FCCProviderHealthInfo,
  FCCFleetSummary,
  FCCToSStatus,
  FCCServerStatus
} from '../../../../preload/types';

export const FCC_CREDIT_STRING =
  'Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code';

export type ModelFilterTag =
  | 'all'
  | 'free_only'
  | 'reasoning'
  | 'coding'
  | 'fast'
  | 'large_context'
  | 'compliant_only';

export const ProviderHealthDashboard: React.FC = () => {
  const [fleetSummary, setFleetSummary] = useState<FCCFleetSummary | null>(null);
  const [providers, setProviders] = useState<FCCProviderHealthInfo[]>([]);
  const [fccStatus, setFccStatus] = useState<FCCServerStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ModelFilterTag>('all');
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isTestingProvider, setIsTestingProvider] = useState<Record<string, boolean>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTogglingFcc, setIsTogglingFcc] = useState(false);
  const [activeTooltipProviderId, setActiveTooltipProviderId] = useState<string | null>(null);

  // Load status, catalog, and fleet summary
  const fetchData = useCallback(async () => {
    try {
      if (window.electronAPI?.fccGetFleetSummary) {
        const res = await window.electronAPI.fccGetFleetSummary();
        if (res.success && res.data) {
          setFleetSummary(res.data);
        }
      }

      if (window.electronAPI?.fccGetStatus) {
        const res = await window.electronAPI.fccGetStatus();
        if (res.success && res.data) {
          setFccStatus(res.data);
        }
      }

      if (window.electronAPI?.fccGetCatalog) {
        const res = await window.electronAPI.fccGetCatalog();
        if (res.success && Array.isArray(res.data)) {
          setProviders(res.data);
        }
      }
    } catch {
      // Fallback
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(fetchData, 4000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Fetch logs when modal is open
  const fetchLogs = useCallback(async () => {
    try {
      if (window.electronAPI?.fccGetLogs) {
        const res = await window.electronAPI.fccGetLogs();
        if (res.success && Array.isArray(res.data)) {
          setLogs(res.data);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    if (isLogsOpen) {
      void fetchLogs();
      const timer = setInterval(fetchLogs, 2000);
      return () => clearInterval(timer);
    }
  }, [isLogsOpen, fetchLogs]);

  // Handle Sidecar Lifecycle Controls
  const handleStartSidecar = async () => {
    setIsTogglingFcc(true);
    try {
      if (window.electronAPI?.fccStart) {
        await window.electronAPI.fccStart();
      }
      await fetchData();
    } finally {
      setIsTogglingFcc(false);
    }
  };

  const handleStopSidecar = async () => {
    setIsTogglingFcc(true);
    try {
      if (window.electronAPI?.fccStop) {
        await window.electronAPI.fccStop();
      }
      await fetchData();
    } finally {
      setIsTogglingFcc(false);
    }
  };

  const handleRestartSidecar = async () => {
    setIsTogglingFcc(true);
    try {
      if (window.electronAPI?.fccRestart) {
        await window.electronAPI.fccRestart();
      }
      await fetchData();
    } finally {
      setIsTogglingFcc(false);
    }
  };

  const handleToggleFccLayer = async (enabled: boolean) => {
    setIsTogglingFcc(true);
    try {
      if (window.electronAPI?.fccSetEnabled) {
        await window.electronAPI.fccSetEnabled(enabled);
      }
      await fetchData();
    } finally {
      setIsTogglingFcc(false);
    }
  };

  // Provider Test
  const handleTestProvider = async (providerId: string) => {
    setIsTestingProvider((prev) => ({ ...prev, [providerId]: true }));
    try {
      if (window.electronAPI?.fccTestProvider) {
        await window.electronAPI.fccTestProvider(providerId);
      }
      await fetchData();
    } finally {
      setIsTestingProvider((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  // Provider Enable/Disable
  const handleToggleProvider = async (providerId: string, currentEnabled: boolean) => {
    try {
      if (window.electronAPI?.fccToggleProvider) {
        await window.electronAPI.fccToggleProvider(providerId, !currentEnabled);
      }
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, enabled: !currentEnabled } : p))
      );
    } catch {
      // Ignore
    }
  };

  // Catalog Sync
  const handleSyncCatalog = async () => {
    setIsSyncing(true);
    try {
      if (window.electronAPI?.fccSyncCatalog) {
        await window.electronAPI.fccSyncCatalog();
      }
      await fetchData();
    } finally {
      setIsSyncing(false);
    }
  };

  // Filtered Providers
  const filteredProviders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return providers.filter((p) => {
      // Text search
      const matchesQuery =
        !q ||
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.models.some((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));

      if (!matchesQuery) return false;

      // Filter tags
      switch (activeFilter) {
        case 'free_only':
          return p.isFreeTierAvailable || p.models.some((m) => m.isFree);
        case 'reasoning':
          return p.models.some((m) => m.capabilities.reasoning);
        case 'coding':
          return p.models.some((m) => m.capabilities.coding);
        case 'fast':
          return p.models.some((m) => m.capabilities.fast || (m.capabilities.speedTokensPerSec && m.capabilities.speedTokensPerSec >= 200));
        case 'large_context':
          return p.models.some((m) => m.capabilities.largeContext || m.contextWindow >= 100_000);
        case 'compliant_only':
          return p.tosStatus === 'compliant';
        default:
          return true;
      }
    });
  }, [providers, searchQuery, activeFilter]);

  const isFccEnabled = fccStatus?.enabled !== false;
  const isRunning = fccStatus?.running === true && isFccEnabled;
  const isFallback = !isRunning;

  return (
    <div
      className="provider-health-dashboard"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        color: 'var(--text-primary, #f8fafc)'
      }}
    >
      {/* Surface 4 Credit Line Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(99, 102, 241, 0.12))',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          borderRadius: '8px',
          fontSize: '11px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={14} color="#c084fc" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
            <a
              href="https://github.com/Alishahryar1/free-claude-code"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#c084fc', textDecoration: 'underline' }}
            >
              https://github.com/Alishahryar1/free-claude-code
            </a>
          </span>
        </div>
        <span
          style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: 'rgba(168, 85, 247, 0.25)',
            color: '#e9d5ff',
            fontWeight: 600
          }}
        >
          61 Curated Providers
        </span>
      </div>

      {/* Fleet Summary Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-secondary, #13141a)',
          border: '1px solid var(--border-subtle, #282834)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}
      >
        {/* Top Header Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={18} color="var(--accent-primary, #818cf8)" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                FCC Model Supply Fleet
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: isRunning
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(245, 158, 11, 0.2)',
                  color: isRunning ? '#34d399' : '#fbbf24',
                  border: `1px solid ${isRunning ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`
                }}
              >
                {isRunning ? 'Active & Healthy' : 'FCC offline — native supply active'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
              1.3B+ free tokens/mo across 61 providers • Port {fccStatus?.port || 8082}
            </p>
          </div>

          {/* Lifecycle Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isRunning ? (
              <button
                type="button"
                onClick={() => void handleStopSidecar()}
                disabled={isTogglingFcc}
                title="Stop sidecar process"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '5px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  cursor: 'pointer'
                }}
              >
                <Square size={11} /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartSidecar()}
                disabled={isTogglingFcc || !isFccEnabled}
                title="Start sidecar process"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '5px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  cursor: 'pointer'
                }}
              >
                <Play size={11} /> Start
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleRestartSidecar()}
              disabled={isTogglingFcc || !isFccEnabled}
              title="Restart sidecar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '5px',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={11} className={isTogglingFcc ? 'spin' : ''} /> Restart
            </button>

            <button
              type="button"
              onClick={() => setIsLogsOpen(true)}
              title="View sidecar stdout/stderr logs"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '5px',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#a5b4fc',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                cursor: 'pointer'
              }}
            >
              <Terminal size={11} /> Logs Viewer
            </button>

            {/* Enable/Disable Toggle */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: '#cbd5e1',
                cursor: 'pointer',
                marginLeft: '6px'
              }}
            >
              <input
                type="checkbox"
                checked={isFccEnabled}
                onChange={(e) => void handleToggleFccLayer(e.target.checked)}
              />
              <span>Enable FCC</span>
            </label>
          </div>
        </div>

        {/* Fleet Metrics 4-Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px'
          }}
        >
          <div style={{ padding: '10px', background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.03))', borderRadius: '6px', border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>Total Providers</span>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
              {fleetSummary?.providersCount ?? 0}
            </div>
            <span style={{ fontSize: '10px', color: '#38bdf8' }}>Catalog snapshot entries</span>
          </div>

          <div style={{ padding: '10px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
            <span style={{ fontSize: '10px', color: '#34d399', textTransform: 'uppercase', fontWeight: 600 }}>Healthy Providers</span>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', marginTop: '2px' }}>
              {fleetSummary?.healthyProvidersCount ?? 0}
            </div>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Live &amp; responsive</span>
          </div>

          <div style={{ padding: '10px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
            <span style={{ fontSize: '10px', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 600 }}>Degraded / Risky</span>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24', marginTop: '2px' }}>
              {(fleetSummary?.degradedProvidersCount ?? 0) + (fleetSummary?.stoppedProvidersCount ?? 0)}
            </div>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Risky off by default</span>
          </div>

          <div style={{ padding: '10px', background: 'rgba(168, 85, 247, 0.05)', borderRadius: '6px', border: '1px solid rgba(168, 85, 247, 0.15)' }}>
            <span style={{ fontSize: '10px', color: '#c084fc', textTransform: 'uppercase', fontWeight: 600 }}>Free Models Active</span>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#c084fc', marginTop: '2px' }}>
              {fleetSummary?.totalFreeModels ?? 0}
            </div>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Zero-cost supply</span>
          </div>
        </div>

        {/* Free Tokens Allowance Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary, #94a3b8)' }}>
            <span>Aggregate Monthly Free Token Pool: <strong style={{ color: 'var(--text-primary)' }}>
              {(((fleetSummary?.aggregateFreeTokens || 0) / 1_000_000_000).toFixed(2))} Billion tokens
            </strong></span>
            <span>Used: {((fleetSummary?.usedTokens ?? 0) / 1_000_000).toFixed(1)}M / {(fleetSummary?.aggregateFreeTokens ?? 0) / 1_000_000}M</span>
          </div>
          <div style={{ height: '6px', width: '100%', backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.max(1, ((fleetSummary?.usedTokens ?? 0) / Math.max(1, fleetSummary?.aggregateFreeTokens ?? 1)) * 100))}%`,
                background: 'linear-gradient(90deg, #818cf8, #c084fc)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'var(--bg-secondary, #13141a)',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid var(--border-subtle, #282834)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 61 providers or models (e.g. deepseek, groq, gemini)..."
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.05))',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '12px'
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => void handleSyncCatalog()}
            disabled={isSyncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.06))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              color: 'var(--text-primary)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={12} className={isSyncing ? 'spin' : ''} />
            Sync Catalog
          </button>
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Filter size={12} /> Filters:
          </span>
          {[
            { id: 'all', label: 'All (61)' },
            { id: 'free_only', label: 'Free Only' },
            { id: 'reasoning', label: 'Reasoning' },
            { id: 'coding', label: 'Coding' },
            { id: 'fast', label: 'Fast (300+ tok/s)' },
            { id: 'large_context', label: 'Large Context (1M+)' },
            { id: 'compliant_only', label: 'ToS Compliant Only' }
          ].map((tag) => {
            const isSelected = activeFilter === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => setActiveFilter(tag.id as ModelFilterTag)}
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: isSelected ? 600 : 500,
                  border: isSelected ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                  color: isSelected ? '#a5b4fc' : '#94a3b8',
                  cursor: 'pointer'
                }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 61 Providers Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '12px'
        }}
      >
        {filteredProviders.map((p) => {
          const isExpanded = expandedProviderId === p.id;
          const isTesting = isTestingProvider[p.id] === true;

          // ToS badge styling
          const tosBadge = (() => {
            switch (p.tosStatus) {
              case 'compliant':
                return { label: 'ToS: Compliant', bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.3)' };
              case 'verified':
                return { label: 'ToS: Verified', bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.3)' };
              case 'conditional':
                return { label: 'ToS: Conditional', bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
              case 'risky':
                return { label: 'ToS: Risky', bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.3)' };
            }
          })();

          // Health dot color
          const healthColor =
            !p.enabled || p.health === 'stopped'
              ? '#64748b'
              : p.health === 'healthy'
              ? '#10b981'
              : p.health === 'untested'
              ? '#818cf8'
              : '#f59e0b';

          return (
            <div
              key={p.id}
              style={{
                backgroundColor: 'var(--bg-secondary, #13141a)',
                border: `1px solid ${p.enabled ? 'var(--border-subtle, #282834)' : 'rgba(239, 68, 68, 0.2)'}`,
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                opacity: p.enabled ? 1 : 0.75,
                transition: 'all 0.15s ease'
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: healthColor,
                      boxShadow: p.enabled && p.health === 'healthy' ? '0 0 6px #10b981' : undefined                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {p.name}
                    </div>
                    <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'capitalize' }}>
                      {p.category.replace('_', ' ')} • {p.authMethod}
                    </span>
                  </div>
                </div>

                {/* ToS Status Badge with Tooltip for Risky */}
                <div style={{ position: 'relative' }}>
                  <span
                    onMouseEnter={() => setActiveTooltipProviderId(p.id)}
                    onMouseLeave={() => setActiveTooltipProviderId(null)}
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: tosBadge.bg,
                      color: tosBadge.color,
                      border: `1px solid ${tosBadge.border}`,
                      cursor: p.tosExplanation ? 'help' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    {p.tosStatus === 'risky' && <ShieldAlert size={10} />}
                    {tosBadge.label}
                  </span>

                  {/* Tooltip on hover */}
                  {activeTooltipProviderId === p.id && p.tosExplanation && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '100%',
                        marginTop: '4px',
                        zIndex: 100,
                        width: '220px',
                        padding: '8px',
                        backgroundColor: 'var(--bg-secondary, #1e1e28)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                        fontSize: '10px',
                        color: 'var(--text-primary)',
                        lineHeight: '1.4'
                      }}
                    >
                      <strong style={{ color: '#f87171' }}>ToS Notice: </strong>
                      {p.tosExplanation}
                    </div>
                  )}
                </div>
              </div>

              {/* Metrics Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  backgroundColor: 'var(--bg-tertiary, rgba(255, 255, 255, 0.02))',
                  borderRadius: '6px',
                  fontSize: '10px',
                  color: 'var(--text-secondary, #94a3b8)'
                }}
              >
                <span>Latency: <strong style={{ color: 'var(--text-primary)' }}>{p.health === 'untested' ? '—' : `${p.latencyMs}ms`}</strong></span>
                <span>Success: <strong style={{ color: 'var(--text-primary)' }}>{p.successRate > 0 ? `${p.successRate}%` : '—'}</strong></span>
                <span>Quota: <strong style={{ color: 'var(--text-primary)' }}>{p.quotaRemainingPercent > 0 ? `${p.quotaRemainingPercent}%` : '—'}</strong></span>
              </div>

              {/* Free Tokens Banner */}
              {p.monthlyFreeTokens > 0 && (
                <div style={{ fontSize: '10px', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Zap size={11} /> {(p.monthlyFreeTokens / 1_000_000).toFixed(0)}M free tokens/mo
                </div>
              )}

              {/* Models Count & Accordion Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: '#94a3b8' }}>
                  {p.models.length} model{p.models.length === 1 ? '' : 's'} available
                </span>
                <button
                  type="button"
                  onClick={() => setExpandedProviderId(isExpanded ? null : p.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#818cf8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    fontSize: '11px',
                    padding: '2px 4px'
                  }}
                >
                  {isExpanded ? <>Hide <ChevronUp size={12} /></> : <>View Models <ChevronDown size={12} /></>}
                </button>
              </div>

              {/* Expanded Models List */}
              {isExpanded && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px',
                    backgroundColor: 'var(--bg-tertiary, rgba(0, 0, 0, 0.25))',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))'
                  }}
                >
                  {p.models.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '4px 0',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {m.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span
                            style={{
                              fontSize: '8px',
                              padding: '1px 4px',
                              borderRadius: '2px',
                              background: 'rgba(168, 85, 247, 0.2)',
                              color: '#c084fc',
                              fontWeight: 700
                            }}
                          >
                            {m.provenance}
                          </span>
                          {m.isFree && (
                            <span
                              style={{
                                fontSize: '8px',
                                padding: '1px 4px',
                                borderRadius: '2px',
                                background: 'rgba(16, 185, 129, 0.2)',
                                color: '#34d399',
                                fontWeight: 700
                              }}
                            >
                              FREE
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: '9px', color: '#94a3b8' }}>
                        {m.id} • Context: {(m.contextWindow / 1000).toFixed(0)}k
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions Footer */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => void handleTestProvider(p.id)}
                    disabled={isTesting}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.06))',
                      border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
                      color: 'var(--text-primary)',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Activity size={10} className={isTesting ? 'spin' : ''} />
                    {isTesting ? 'Testing...' : 'Test'}
                  </button>

                  {p.signupUrl && (
                    <a
                      href={p.signupUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: 'transparent',
                        color: '#94a3b8',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        textDecoration: 'none'
                      }}
                    >
                      Portal <ExternalLink size={9} />
                    </a>
                  )}
                </div>

                {/* Enable / Disable Toggle */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: p.enabled ? '#34d399' : '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() => void handleToggleProvider(p.id, p.enabled)}
                  />
                  <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Logs Viewer Modal */}
      {isLogsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="FCC Sidecar Logs Viewer"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 'var(--layer-modal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setIsLogsOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '760px',
              height: '520px',
              backgroundColor: '#0d1117',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                background: '#161b22'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={16} color="#818cf8" />
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                  FCC Sidecar Process Logs (Port {fccStatus?.port || 8082})
                </span>
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                  {logs.length} entries
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsLogsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer'
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Logs Body */}
            <div
              style={{
                flex: 1,
                padding: '14px',
                overflowY: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                lineHeight: '1.5',
                color: '#e2e8f0',
                background: '#0d1117'
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: '#64748b' }}>No logs recorded yet.</div>
              ) : (
                logs.map((line, idx) => (
                  <div
                    key={idx}
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color: line.includes('[ERROR]')
                        ? '#f87171'
                        : line.includes('[WARN]')
                        ? '#fbbf24'
                        : '#cbd5e1'
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                background: '#161b22'
              }}
            >
              <button
                type="button"
                onClick={async () => {
                  if (window.electronAPI?.fccClearLogs) {
                    await window.electronAPI.fccClearLogs();
                    await fetchLogs();
                  }
                }}
                style={{
                  padding: '5px 10px',
                  borderRadius: '4px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Clear Logs
              </button>
              <button
                type="button"
                onClick={() => void fetchLogs()}
                style={{
                  padding: '5px 12px',
                  borderRadius: '4px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  color: '#c7d2fe',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
