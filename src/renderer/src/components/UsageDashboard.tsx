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
  Gauge
} from 'lucide-react';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import type { SmartTaskType } from '../../../preload/types';
import { ProviderDashboard } from './dashboard/ProviderDashboard';

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

  const [activeTab, setActiveTab] = useState<'unified' | 'quotas' | 'rules' | 'logs'>('unified');

  useEffect(() => {
    if (isOpen) {
      void refreshStats();
      const interval = setInterval(() => {
        void refreshStats();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, refreshStats]);

  if (!isOpen) return null;

  const totalLimit = quotaSnapshot?.totalFreeTokensAvailable || 2_050_000_000;
  const totalUsed = quotaSnapshot?.totalTokensConsumed || 0;
  const savings = quotaSnapshot?.totalCostSavedUsd || 0;
  const freeMode = quotaSnapshot?.freeModeActive ?? true;
  const remainingTokens = Math.max(0, totalLimit - totalUsed);
  const percentUsed = Math.min(100, Math.max(0, (totalUsed / totalLimit) * 100));

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
        backgroundColor: 'rgba(10, 15, 29, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
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
          maxHeight: '88vh',
          backgroundColor: '#0f172a',
          borderRadius: '14px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 25px rgba(56, 189, 248, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f1f5f9'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)'
              }}
            >
              <Gauge size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
                  Smart Orchestration &amp; Quota Dashboard
                </h2>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: freeMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: freeMode ? '#34d399' : '#fbbf24',
                    border: `1px solid ${freeMode ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`
                  }}
                >
                  {freeMode ? '100% Free Mode Active' : 'Hybrid Free/Paid'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>
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
                backgroundColor: freeMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: freeMode ? '#34d399' : '#94a3b8',
                border: `1px solid ${freeMode ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
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
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '6px',
                color: '#94a3b8',
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
                color: '#94a3b8',
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
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Total Free Tokens</span>
              <Sparkles size={16} color="#38bdf8" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: '#38bdf8' }}>
              {formatTokens(totalLimit)}+
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              Aggregated monthly across 5 providers
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Tokens Consumed</span>
              <Activity size={16} color="#10b981" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: '#10b981' }}>
              {formatTokens(totalUsed)}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              {formatTokens(remainingTokens)} remaining headroom
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Cost Saved (Est.)</span>
              <DollarSign size={16} color="#34d399" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: '#34d399' }}>
              ${savings.toFixed(2)}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              vs $3.00/1M commercial API cost
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              borderRadius: '10px',
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Global Quota Used</span>
              <TrendingUp size={16} color="#a855f7" />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px', color: '#a855f7' }}>
              {percentUsed.toFixed(2)}%
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              Sub-5% estimation accuracy
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '8px 24px',
            borderBottom: '1px solid rgba(51, 65, 85, 0.4)'
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
              color: activeTab === 'unified' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'unified' ? '2px solid #38bdf8' : '2px solid transparent',
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
              color: activeTab === 'quotas' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'quotas' ? '2px solid #38bdf8' : '2px solid transparent',
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
            onClick={() => setActiveTab('rules')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              color: activeTab === 'rules' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'rules' ? '2px solid #38bdf8' : '2px solid transparent',
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
              color: activeTab === 'logs' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'logs' ? '2px solid #38bdf8' : '2px solid transparent',
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
                  backgroundColor: 'rgba(56, 189, 248, 0.2)',
                  color: '#38bdf8',
                  padding: '1px 6px',
                  borderRadius: '10px'
                }}
              >
                {routingLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: activeTab === 'unified' ? '0' : '16px 24px' }}>
          {activeTab === 'unified' && (
            <div style={{ height: '620px', overflow: 'hidden' }}>
              <ProviderDashboard onClose={closeDashboard} />
            </div>
          )}

          {activeTab === 'quotas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Object.values(quotaSnapshot?.providers || {}).map((p) => {
                const usedPct = p.percentUsed ?? (p.monthlyFreeTokens ? Math.min(100, (p.consumedTokens / p.monthlyFreeTokens) * 100) : 0);
                const isCooldown = p.healthStatus === 'cooling_down';
                const isExhausted = p.healthStatus === 'exhausted';

                return (
                  <div
                    key={p.providerId}
                    style={{
                      backgroundColor: 'rgba(30, 41, 59, 0.4)',
                      border: '1px solid rgba(51, 65, 85, 0.5)',
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
                            backgroundColor: isCooldown ? '#f59e0b' : isExhausted ? '#ef4444' : '#10b981',
                            boxShadow: `0 0 8px ${isCooldown ? '#f59e0b' : isExhausted ? '#ef4444' : '#10b981'}`
                          }}
                        />
                        <span style={{ fontSize: '14px', fontWeight: 600 }}>{p.providerName}</span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            color: '#94a3b8'
                          }}
                        >
                          {p.providerId === 'ollama' ? 'Local Unlimited' : 'Free Tier'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                        <span style={{ color: '#94a3b8' }}>
                          Used:{' '}
                          <strong style={{ color: '#f1f5f9' }}>
                            {formatTokens(p.consumedTokens)}
                          </strong>{' '}
                          /{' '}
                          {p.monthlyFreeTokens ? formatTokens(p.monthlyFreeTokens) : 'Unlimited'}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            backgroundColor:
                              isCooldown
                                ? 'rgba(245, 158, 11, 0.15)'
                                : isExhausted
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(16, 185, 129, 0.15)',
                            color: isCooldown ? '#f59e0b' : isExhausted ? '#ef4444' : '#34d399',
                            border: `1px solid ${
                              isCooldown
                                ? 'rgba(245, 158, 11, 0.3)'
                                : isExhausted
                                  ? 'rgba(239, 68, 68, 0.3)'
                                  : 'rgba(16, 185, 129, 0.3)'
                            }`
                          }}
                        >
                          {isCooldown ? 'Cooling Down' : isExhausted ? 'Quota Limit' : 'Operational'}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div
                      style={{
                        height: '6px',
                        width: '100%',
                        backgroundColor: 'rgba(15, 23, 42, 0.8)',
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
                              ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                              : 'linear-gradient(90deg, #0ea5e9, #10b981)',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'rules' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
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
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontWeight: 600
                    }}
                  >
                    Code Generation
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Qwen3 Coder / DeepSeek Coder
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Routes refactoring, function writing, algorithms, and bug fixes to state-of-the-art coding weights.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
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
                      color: '#a855f7',
                      fontWeight: 600
                    }}
                  >
                    Complex Reasoning
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  DeepSeek R1 / R1-0528 (164K)
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Leverages thinking tokens and chain-of-thought for mathematical, architectural, and multi-file logic.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
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
                      color: '#10b981',
                      fontWeight: 600
                    }}
                  >
                    Fast Responses
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Groq Llama 3.3 70B Versatile
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Ultra-low latency LPU engine for live inline completions, typing feedback, and quick explanations.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
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
                      color: '#f59e0b',
                      fontWeight: 600
                    }}
                  >
                    Large Context (&gt;32K)
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Qwen3 Coder (262K) / GLM-5 / Long-Context Model
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Deep repository search and whole-project awareness without context truncation or loss of precision.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(236, 72, 153, 0.2)',
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
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Long-Context Vision / Gemma 3 27B
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Image attachments, UI screenshot reviews, and visual bug inspections automatically select vision models.
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
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
                      backgroundColor: 'rgba(148, 163, 184, 0.15)',
                      color: '#94a3b8',
                      fontWeight: 600
                    }}
                  >
                    Simple Queries
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Llama 3.2 3B / Llama 3.1 8B (Fast &amp; Free)
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
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
                    color: '#64748b',
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
                        backgroundColor: 'rgba(30, 41, 59, 0.4)',
                        border: '1px solid rgba(51, 65, 85, 0.4)',
                        borderRadius: '6px',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
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
                            color: '#e2e8f0',
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
                        <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>
                          {log.selectedModel}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            color: '#94a3b8'
                          }}
                        >
                          {log.selectedProvider}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
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

        {/* Footer */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid rgba(51, 65, 85, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.8)',
            fontSize: '12px',
            color: '#64748b'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={14} color="#10b981" />
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
