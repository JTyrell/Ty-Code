import React, { useEffect, useState } from 'react';
import {
  X,
  Zap,
  TrendingUp,
  ShieldCheck,
  RefreshCw,
  Cpu,
  Server,
  DollarSign,
  Activity,
  Sparkles,
  Info,
  Clock,
  Layers,
  ChevronRight,
  Gauge,
  Database,
  AlertCircle
} from 'lucide-react';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import { useChatStore } from '../state/chat-store';
import { useOnboardingStore } from '../state/onboarding-store';
import type { SmartTaskType, FccOptimizationSavings, FccQuotaMetersSummary, FCCServerStatus, FCCServiceStatus } from '../../../preload/types';
import { ProviderDashboard } from './dashboard/ProviderDashboard';
import { UsageLedgerView } from './dashboard/UsageLedgerView';
import { ObservabilityPanel } from './agent/ObservabilityPanel';

const TASK_BADGES: Record<SmartTaskType, { label: string; color: string; bg: string }> = {
  coding: { label: 'Code Gen', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
  reasoning: { label: 'Reasoning', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
  'fast-response': { label: 'Fast Latency', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  'large-context': { label: 'Large Context', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  multimodal: { label: 'Vision / Multimodal', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
  'simple-query': { label: 'Quick Query', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' }
};

export const UsageDashboard: React.FC = () => {
  const {
    isOpen,
    quotaSnapshot,
    routingLogs,
    isLoading,
    closeDashboard,
    refreshStats,
    setFreeMode
  } = useUsageDashboardStore();

  const openSettings = useChatStore((s) => s.openSettings);
  const settings = useChatStore((s) => s.settings);
  const openWizard = useOnboardingStore((s) => s.openWizard);

  const [activeTab, setActiveTab] = useState<'unified' | 'quotas' | 'ledger' | 'rules' | 'logs'>('unified');
  const [optSavings, setOptSavings] = useState<FccOptimizationSavings | null>(null);
  const [quotaMeters, setQuotaMeters] = useState<FccQuotaMetersSummary | null>(null);
  const [fccEngine, setFccEngine] = useState<FCCServerStatus | null>(null);
  const [fccService, setFccService] = useState<FCCServiceStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      void refreshStats();
      const fetchMeters = () => {
        if (window.electronAPI?.fccGetOptimizationSavings) {
          window.electronAPI.fccGetOptimizationSavings().then((res) => {
            if (res?.success && res.data) setOptSavings(res.data);
          }).catch(() => {});
        }
        if (window.electronAPI?.fccGetQuotaMeters) {
          window.electronAPI.fccGetQuotaMeters().then((res) => {
            if (res?.success && res.data) setQuotaMeters(res.data);
          }).catch(() => {});
        }
        if (window.electronAPI?.fccGetStatus) {
          window.electronAPI.fccGetStatus().then((res) => {
            if (res?.success && res.data) setFccEngine(res.data);
          }).catch(() => {});
        }
        if (window.electronAPI?.fccGetServiceStatus) {
          window.electronAPI.fccGetServiceStatus().then((res) => {
            if (res?.success && res.data) setFccService(res.data);
          }).catch(() => {});
        }
      };
      fetchMeters();
      const interval = setInterval(() => {
        void refreshStats();
        fetchMeters();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, refreshStats]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDashboard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeDashboard]);

  if (!isOpen) return null;

  const totalLimit = quotaSnapshot?.totalFreeTokensAvailable || 0;
  const totalUsed = quotaSnapshot?.totalTokensConsumed || 0;
  const savings = quotaSnapshot?.totalCostSavedUsd || 0;
  const freeMode = quotaSnapshot?.freeModeActive ?? true;
  const connectedProviderCount = quotaSnapshot?.providers ? Object.keys(quotaSnapshot.providers).length : 0;
  const remainingTokens = Math.max(0, totalLimit - totalUsed);
  const percentUsed = totalLimit > 0
    ? Math.min(100, Math.max(0, (totalUsed / totalLimit) * 100))
    : 0;
  const engineRunning = fccEngine?.running ?? false;
  const engineHealthColor = fccEngine?.health === 'healthy' ? '#34d399' : fccEngine?.health === 'degraded' ? '#fbbf24' : '#64748b';

  // Active binding sync (mirrors the ModelSelector state in the chat toolbar)
  const isAutoBinding = !settings?.activeProvider || settings.activeProvider === 'auto';
  const rawActiveProvider = (settings?.activeProvider || 'auto') as string;
  const normalizedActiveProvider = rawActiveProvider === 'auto'
    ? 'openkilo'
    : (rawActiveProvider.replace(/-free$/, '') || 'openkilo');
  const activeModelShort = isAutoBinding
    ? 'Auto (FCC decides)'
    : (settings?.activeModel || 'kilo-auto/free').split('/').pop()?.replace(':free', '') || (settings?.activeModel || 'kilo-auto/free');
  const activeQuota = (quotaMeters?.providers || []).find((p) => {
    const pid = (p.providerId || '').replace(/-free$/, '');
    return pid === normalizedActiveProvider || (p.providerId || '').includes(normalizedActiveProvider);
  });
  const activePercentUsed = activeQuota?.percentUsed ?? 0;
  const activeRemainingTokens = activeQuota?.remainingTokens;
  const activeLimitTokens = activeQuota?.limitTokens;

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return tokens.toString();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 'var(--layer-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      onClick={closeDashboard}
    >
      <div
        style={{
          width: '920px',
          maxWidth: '95vw',
          height: '94vh',
          maxHeight: '94vh',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '14px',
          border: '1px solid var(--border-default)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.5), 0 0 25px var(--surface-2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--text-primary)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-tertiary)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-primary))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(6, 182, 212, 0.3)'
              }}
            >
              <Gauge size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
                  Smart Orchestration &amp; Quota Dashboard
                </h2>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: freeMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: freeMode ? 'var(--accent-green)' : 'var(--accent-amber)',
                    border: `1px solid ${freeMode ? 'var(--accent-green)' : 'var(--accent-amber)'}`
                  }}
                >
                  {freeMode ? '100% Free Mode Active' : 'Hybrid Free/Paid'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Multi-provider automated model routing, token quota tracking, and rate-limit failover
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => void setFreeMode(!freeMode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 500,
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: freeMode ? 'rgba(16, 185, 129, 0.15)' : 'var(--surface-2)',
                color: freeMode ? 'var(--accent-green)' : 'var(--text-secondary)',
                border: `1px solid ${freeMode ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              title="Toggle Free Mode to enforce 0-cost model selection"
            >
              <Zap size={14} />
              {freeMode ? 'Free Mode: ON' : 'Free Mode: OFF'}
            </button>

            <button
              onClick={() => void refreshStats()}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '6px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Refresh Quota Stats"
            >
              <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
            </button>

            <button
              onClick={closeDashboard}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Close Dashboard"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scroll Canvas — the whole card body (top third included) scrolls as one surface; binding strip and tab nav pin via position:sticky */}
        <div
          id="usage-dash-scroll-zone"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain'
          }}
        >
        {/* Hero Metrics Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px',
            padding: '20px 24px 12px 24px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Total Free Tokens</span>
              <Sparkles size={16} color="var(--accent-cyan)" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: 'var(--accent-cyan)' }}>
              {formatTokens(totalLimit)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {connectedProviderCount > 0
                ? `Aggregated monthly across ${connectedProviderCount} provider${connectedProviderCount === 1 ? '' : 's'}`
                : 'No connected providers yet'}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Tokens Consumed</span>
              <Activity size={16} color="var(--accent-green)" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: 'var(--accent-green)' }}>
              {formatTokens(totalUsed)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {formatTokens(remainingTokens)} remaining headroom
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Cost Saved (Est.)</span>
              <DollarSign size={16} color="var(--accent-green)" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: 'var(--accent-green)' }}>
              ${savings.toFixed(2)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              vs $3.00/1M commercial API cost
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Global Quota Used</span>
              <TrendingUp size={16} color="var(--accent-primary)" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: 'var(--accent-primary)' }}>
              {percentUsed.toFixed(2)}%
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              of aggregated monthly free-token capacity
            </div>
          </div>
        </div>

        {/* Token Optimization Savings Meter Banner */}
        <div
          id="fcc-optimization-savings-meter"
          style={{
            margin: '0 24px 12px 24px',
            padding: '12px 18px',
            borderRadius: '8px',
            background: 'linear-gradient(90deg, rgba(6, 182, 212, 0.12), rgba(16, 185, 129, 0.12))',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Zap size={18} color="var(--accent-cyan)" />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {optSavings?.label || 'Optimization saved 0 tokens (0%) this session'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                RTK Output Compression: {new Intl.NumberFormat('en-US').format(optSavings?.rtkSavedTokens || 0)} tok • Headroom Context Pruning: {new Intl.NumberFormat('en-US').format(optSavings?.headroomSavedTokens || 0)} tok • Semantic Response Cache: {new Intl.NumberFormat('en-US').format(optSavings?.cacheSavedTokens || 0)} tok
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              color: 'var(--accent-green)',
              fontWeight: 600,
              border: '1px solid var(--accent-green)'
            }}
          >
            {optSavings?.percent || 0}% Optimized
          </span>
        </div>

        {/* FCC Engine — live sidecar layer state (genuine binary / embedded core / integrity) */}
        <div
          id="fcc-engine-status-banner"
          style={{
            margin: '0 24px 12px 24px',
            padding: '12px 18px',
            borderRadius: '8px',
            background: engineRunning ? 'rgba(16, 185, 129, 0.10)' : 'var(--bg-tertiary)',
            border: engineRunning ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Server size={18} color={engineRunning ? 'var(--accent-green)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: engineRunning ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  FCC Engine {engineRunning ? 'running' : 'stopped'}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 8px',
                    borderRadius: '10px',
                    backgroundColor: engineRunning ? 'rgba(16, 185, 129, 0.18)' : 'var(--surface-2)',
                    color: engineHealthColor,
                    fontWeight: 600
                  }}
                >
                  {fccEngine?.health || 'unknown'}
                </span>
                {fccService?.installed && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    genuine binary detected
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {fccEngine?.mode === 'external-process' ? 'Genuine FCC process' : 'Built-in sidecar'}
                {fccEngine?.port ? ` • port ${fccEngine.port}` : ''}
                {fccEngine?.uptimeSeconds ? ` • up ${Math.floor(fccEngine.uptimeSeconds / 60)}m` : ''}
                {` • ${fccEngine?.providersCount ?? 0} supply models`}
                {` • integrity: ${fccEngine?.integrityStatus || 'unverified'}`}
              </div>
              {(fccService?.lastError || fccEngine?.integrityError) && (
                <div style={{ fontSize: '11px', color: 'var(--accent-red)', marginTop: '2px' }}>
                  {fccService?.lastError || fccEngine?.integrityError}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {formatTokens(fccEngine?.freeTokensUsed || 0)} tok
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                used this session of {formatTokens(fccEngine?.freeTokensAllocated || 0)} declared
              </div>
            </div>
            {!engineRunning && (
              <button
                id="fcc-engine-retry-btn"
                onClick={() => void window.electronAPI?.fccRetryService?.()}
                style={{
                  fontSize: '11px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
                title="Attempt to bring the FCC engine back online"
              >
                Retry Engine
              </button>
            )}
          </div>
        </div>

        {/* Active Binding strip — sticky inside the scroll canvas; pins to the top edge once scrolled past, while the upper third stays scrollable */}
        <div
          id="fcc-active-binding-strip"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            margin: '0 24px 8px 24px',
            padding: '10px 16px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
            backdropFilter: 'blur(6px)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <Sparkles size={15} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeModelShort}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '1px 8px',
                    borderRadius: '10px',
                    backgroundColor: isAutoBinding ? 'rgba(16, 185, 129, 0.2)' : 'rgba(6, 182, 212, 0.2)',
                    color: isAutoBinding ? 'var(--accent-green)' : 'var(--accent-cyan)',
                    border: `1px solid ${isAutoBinding ? 'var(--accent-green)' : 'var(--accent-cyan)'}`
                  }}
                >
                  {isAutoBinding ? 'Auto' : 'Manual'}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                via {isAutoBinding ? 'OpenKilo (FCC free pool)' : activeQuota?.providerName || normalizedActiveProvider}
                {isAutoBinding ? '' : ' — active in Model Selector'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
              {activeRemainingTokens !== undefined
                ? `${formatTokens(Math.max(0, activeRemainingTokens))} tok left`
                : 'No metered quota'}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              {activeLimitTokens !== undefined
                ? `of ${formatTokens(activeLimitTokens)} • ${activePercentUsed.toFixed(1)}% used`
                : activeQuota
                ? `${activePercentUsed.toFixed(1)}% used`
                : '\u2014'}
            </span>
            {activeQuota?.isExhausted && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-red)',
                  border: '1px solid var(--accent-red)'
                }}
              >
                Exhausted — failover ready
              </span>
            )}
          </div>
        </div>

        {/* Tab Navigation — sticky directly under the binding strip */}
        <div
          id="usage-dash-tab-nav"
          style={{
            position: 'sticky',
            top: 57,
            zIndex: 5,
            display: 'flex',
            gap: '8px',
            padding: '8px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            backgroundColor: 'var(--bg-secondary)',
            backdropFilter: 'blur(6px)'
          }}
        >
          <button
            id="tab-btn-unified-ecosystem"
            onClick={() => setActiveTab('unified')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'unified' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'unified' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Layers size={14} />
            Unified Dashboard (Phase 6.5)
          </button>

          <button
            onClick={() => setActiveTab('quotas')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'quotas' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'quotas' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Server size={14} />
            Provider Quota Gauges
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            id="tab-usage-ledger"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'ledger' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'ledger' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Database size={14} />
            Usage Ledger &amp; Resets
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'rules' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'rules' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Cpu size={14} />
            Intelligent Routing Rules
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'logs' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'logs' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Clock size={14} />
            Decision Logs (Power User)
            {routingLogs.length > 0 && (
              <span
                style={{
                  fontSize: '10px',
                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                  color: 'var(--accent-cyan)',
                  padding: '1px 6px',
                  borderRadius: '10px'
                }}
              >
                {routingLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Body Content — flows inside the unified scroll canvas; the unified tab keeps a fixed 64vh workspace for its internal scrolling */}
        <div
          id="usage-dash-tab-body"
          style={{
            flex: '0 0 auto',
            boxSizing: 'border-box',
            padding: activeTab === 'unified' ? '0' : '16px 24px'
          }}
        >
          {activeTab === 'unified' && (
            <div style={{ height: '64vh', overflow: 'hidden' }}>
              <ProviderDashboard onClose={closeDashboard} />
            </div>
          )}

          {activeTab === 'ledger' && (
            <div style={{ padding: '8px 0' }}>
              <UsageLedgerView />
            </div>
          )}

          {activeTab === 'quotas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {quotaMeters && (
                <div
                  id="fcc-aggregate-daily-meters"
                  style={{
                    padding: '14px 18px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '4px'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      {new Intl.NumberFormat('en-US').format(quotaMeters.aggregateFreeTokensRemainingToday)} free tokens remaining today
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Daily estimate across {quotaMeters.providers.length} free providers ({new Intl.NumberFormat('en-US').format(quotaMeters.aggregateFreeTokensDailyBudget)} total daily budget)
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      backgroundColor: quotaMeters.hasAnyExhausted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: quotaMeters.hasAnyExhausted ? 'var(--accent-red)' : 'var(--accent-green)',
                      border: `1px solid ${quotaMeters.hasAnyExhausted ? 'var(--accent-red)' : 'var(--accent-green)'}`
                    }}
                  >
                    {quotaMeters.hasAnyExhausted ? 'Failover Active' : 'All Pools Healthy'}
                  </span>
                </div>
              )}

              {(quotaMeters?.providers || []).map((p) => {
                const usedPct = p.percentUsed;
                const isExhausted = p.isExhausted;

                return (
                  <div
                    key={p.providerId}
                    id={`quota-bar-${p.providerId}`}
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: `1px solid ${isExhausted ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
                      borderRadius: '8px',
                      padding: '14px 18px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: isExhausted ? 'var(--accent-red)' : 'var(--accent-green)',
                            boxShadow: `0 0 8px ${isExhausted ? 'var(--accent-red)' : 'var(--accent-green)'}`
                          }}
                        />
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.providerName}</span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-2)',
                            color: 'var(--text-secondary)'
                          }}
                        >
                          {p.providerId === 'ollama' ? 'Local Unlimited' : p.providerId === 'copilot' ? 'Subscription' : 'Free Tier'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Remaining:{' '}
                          <strong style={{ color: 'var(--text-primary)' }}>
                            {p.remainingTokens !== undefined ? formatTokens(p.remainingTokens) : 'Unlimited'}
                          </strong>{' '}
                          /{' '}
                          {p.limitTokens ? formatTokens(p.limitTokens) : 'Unlimited'}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            backgroundColor: isExhausted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            color: isExhausted ? 'var(--accent-red)' : 'var(--accent-green)',
                            border: `1px solid ${isExhausted ? 'var(--accent-red)' : 'var(--accent-green)'}`
                          }}
                        >
                          {isExhausted ? 'Quota Limit' : p.resetHuman}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div
                      style={{
                        height: '6px',
                        width: '100%',
                        backgroundColor: 'var(--bg-primary)',
                        borderRadius: '3px',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(1, usedPct)}%`,
                          background:
                            usedPct > 90
                              ? 'linear-gradient(90deg, var(--accent-amber), var(--accent-red))'
                              : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>

                    {/* Exhaustion Upsell Card */}
                    {isExhausted && (
                      <div
                        style={{
                          marginTop: '8px',
                          padding: '10px 14px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <AlertCircle size={14} />
                          <span>Quota exhausted for {p.providerName}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {quotaMeters?.recommendedAlternative ? `${quotaMeters.recommendedAlternative.reason} Or connect your GitHub Copilot / ChatGPT subscription at $0 extra cost.` : 'Switch to another free provider or connect your existing subscription.'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          {quotaMeters?.recommendedAlternative && (
                            <button
                              type="button"
                              onClick={() => {
                                closeDashboard();
                                openSettings('providers');
                              }}
                              style={{
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                borderRadius: '4px',
                                backgroundColor: 'var(--accent-blue)',
                                color: '#fff',
                                border: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              Switch to {quotaMeters.recommendedAlternative.providerId}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              closeDashboard();
                              openWizard('subscriptions');
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '4px',
                              backgroundColor: 'rgba(16, 185, 129, 0.2)',
                              color: 'var(--accent-green)',
                              border: '1px solid var(--accent-green)',
                              cursor: 'pointer'
                            }}
                          >
                            Connect Copilot (No extra cost)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'rules' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(6, 182, 212, 0.15)',
                      color: 'var(--accent-cyan)',
                      fontWeight: 600
                    }}
                  >
                    Code Generation
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Qwen3 Coder / DeepSeek Coder
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Routes refactoring, function writing, algorithms, and bug fixes to state-of-the-art coding weights.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(168, 85, 247, 0.15)',
                      color: 'var(--accent-primary)',
                      fontWeight: 600
                    }}
                  >
                    Complex Reasoning
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  DeepSeek R1 / R1-0528 (164K)
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Leverages thinking tokens and chain-of-thought for mathematical, architectural, and multi-file logic.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: 'var(--accent-green)',
                      fontWeight: 600
                    }}
                  >
                    Fast Responses
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Groq Llama 3.3 70B Versatile
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Ultra-low latency LPU engine for live inline completions, typing feedback, and quick explanations.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: 'var(--accent-amber)',
                      fontWeight: 600
                    }}
                  >
                    Large Context (&gt;32K)
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Qwen3 Coder (262K) / GLM-5 / Long-Context Model
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Deep repository search and whole-project awareness without context truncation or loss of precision.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(236, 72, 153, 0.15)',
                      color: '#ec4899',
                      fontWeight: 600
                    }}
                  >
                    Vision &amp; Multimodal
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Long-Context Vision / Gemma 3 27B
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Image attachments, UI screenshot reviews, and visual bug inspections automatically select vision models.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text-secondary)',
                      fontWeight: 600
                    }}
                  >
                    Simple Queries
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Llama 3.2 3B / Llama 3.1 8B (Fast &amp; Free)
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Saves quota for high-complexity prompts by answering straightforward questions with fast small weights.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {routingLogs.length === 0 ? (
                <div
                  style={{
                    padding: '36px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '13px'
                  }}
                >
                  No routing decisions recorded yet. Send a prompt or run code generation to see real-time orchestrator selections!
                </div>
              ) : (
                routingLogs.map((log) => {
                  const badge = TASK_BADGES[log.detectedTask] || TASK_BADGES['simple-query'];
                  const dateStr = new Date(log.timestamp).toLocaleTimeString();

                  return (
                    <div
                      key={log.id}
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '6px',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {dateStr}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: badge.bg,
                            color: badge.color,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {badge.label}
                        </span>
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '240px'
                          }}
                          title={log.promptSnippet}
                        >
                          "{log.promptSnippet}"
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontWeight: 500 }}>
                          {log.selectedModel}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-2)',
                            color: 'var(--text-secondary)'
                          }}
                        >
                          {log.selectedProvider}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {log.rationale}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        <ObservabilityPanel />
        </div> {/* /usage-dash-scroll-zone */}

        {/* Footer */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-tertiary)',
            fontSize: '12px',
            color: 'var(--text-muted)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={14} color="var(--accent-green)" />
            <span>ToS-compliant local &amp; anonymous routing active</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Auto-failover enabled across 5 free providers</span>
          </div>
        </div>
      </div>
    </div>
  );
};
