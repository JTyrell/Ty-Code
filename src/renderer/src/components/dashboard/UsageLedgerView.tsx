/**
 * Per-Instance Usage Ledger View (Scale 1)
 *
 * Visualizes local per-instance usage metrics, free-tier rate limits with
 * live "resets in Xh Ym" countdowns, exact vs estimated token counts,
 * and JSON/CSV export buttons.
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Download,
  Trash2,
  RefreshCw,
  Clock,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  Sparkles,
  FileText,
  Table,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface LedgerOverall {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalErrors: number;
  totalCostSavedUsd: number;
  averageLatencyMs: number;
}

interface ProviderModelCounter {
  providerId: string;
  modelId: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errors: number;
  totalLatencyMs: number;
  lastUsedAt: number;
  costSavedUsd: number;
  exactUsageCount: number;
  estimatedUsageCount: number;
}

interface ProviderRateLimitInfo {
  providerId: string;
  resetsAt?: number;
  resetsInSeconds?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  limitRequests?: number;
  limitTokens?: number;
  lastUpdated: number;
  resetHuman?: string;
}

interface LedgerTransaction {
  id: string;
  timestamp: number;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  costSavedUsd: number;
  isExactUsage: boolean;
}

interface UsageLedgerData {
  version: number;
  instanceId: string;
  createdAt: number;
  lastUpdated: number;
  overall: LedgerOverall;
  providerCounters: Record<string, ProviderModelCounter>;
  rateLimits: Record<string, ProviderRateLimitInfo>;
  recentTransactions: LedgerTransaction[];
}

export const UsageLedgerView: React.FC = () => {
  const [data, setData] = useState<UsageLedgerData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const loadLedger = useCallback(async () => {
    if (!window.electronAPI?.usageGetLedger) return;
    setIsLoading(true);
    try {
      const res = await window.electronAPI.usageGetLedger();
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      console.error('Failed to load usage ledger:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLedger();
    const interval = setInterval(() => void loadLedger(), 5000);
    return () => clearInterval(interval);
  }, [loadLedger]);

  const handleExport = async (format: 'json' | 'csv') => {
    if (!window.electronAPI?.usageExportLedger) return;
    try {
      const res = await window.electronAPI.usageExportLedger(format);
      if (res.success && res.data) {
        const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
        const blob = new Blob([res.data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ty-code-usage-ledger-${Date.now()}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        setExportNotice(`Exported ${format.toUpperCase()} successfully.`);
        setTimeout(() => setExportNotice(null), 3000);
      }
    } catch (err) {
      console.error(`Export ${format} error:`, err);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear your local usage ledger? This action cannot be undone.')) {
      return;
    }
    if (!window.electronAPI?.usageClearLedger) return;
    try {
      const res = await window.electronAPI.usageClearLedger();
      if (res.success) {
        await loadLedger();
        setExportNotice('Ledger cleared.');
        setTimeout(() => setExportNotice(null), 3000);
      }
    } catch (err) {
      console.error('Clear ledger error:', err);
    }
  };

  const overall = data?.overall || {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalErrors: 0,
    totalCostSavedUsd: 0,
    averageLatencyMs: 0
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="usage-ledger-view">
      {/* Top Banner & Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldCheck size={18} color="var(--accent-green, #10b981)" />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Zero-Server Local Ledger (Per-Instance)
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              All usage is stored securely on your machine in <code>userData/usage-ledger.json</code>. Zero tracking servers.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {exportNotice && (
            <span style={{ fontSize: '11px', color: 'var(--accent-green, #34d399)', marginRight: '6px' }}>
              {exportNotice}
            </span>
          )}

          <button
            type="button"
            onClick={() => void handleExport('json')}
            id="btn-export-ledger-json"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            title="Export usage ledger as JSON"
          >
            <Download size={12} />
            Export JSON
          </button>

          <button
            type="button"
            onClick={() => void handleExport('csv')}
            id="btn-export-ledger-csv"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            title="Export usage ledger as CSV"
          >
            <Table size={12} />
            Export CSV
          </button>

          <button
            type="button"
            onClick={() => void handleClear()}
            id="btn-clear-ledger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              color: 'var(--accent-red, #f87171)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            title="Clear usage ledger records"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Hero Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px'
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px 14px'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Total AI Requests</span>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: 'var(--accent-primary, #38bdf8)' }}>
            {overall.totalRequests.toLocaleString()}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {overall.totalErrors > 0 ? `${overall.totalErrors} errors encountered` : '0 errors (100% success)'}
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px 14px'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Total Tokens Consumed</span>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: 'var(--accent-purple, #a855f7)' }}>
            {formatTokens(overall.totalTokens)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {formatTokens(overall.totalPromptTokens)} prompt · {formatTokens(overall.totalCompletionTokens)} completion
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px 14px'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Total Cost Saved</span>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: 'var(--accent-green, #34d399)' }}>
            ${overall.totalCostSavedUsd.toFixed(4)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Benchmark: $3.00 / 1M tokens
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px 14px'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Average Latency</span>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: 'var(--accent-amber, #f59e0b)' }}>
            {overall.averageLatencyMs}ms
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Across all streaming hops
          </div>
        </div>
      </div>

      {/* Provider Free-Tier Caps & Resets */}
      <div>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Provider Quotas &amp; Header Rate Limits
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {Object.entries(data?.rateLimits || {}).length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '16px',
                textAlign: 'center',
                backgroundColor: 'var(--surface-2)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: '8px',
                color: 'var(--text-muted)',
                fontSize: '12px'
              }}
            >
              No provider rate-limit headers recorded yet. Headers are captured dynamically during API responses.
            </div>
          ) : (
            Object.entries(data?.rateLimits || {}).map(([providerId, limit]) => (
              <div
                key={providerId}
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {providerId}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                    {limit.remainingRequests !== undefined
                      ? `${limit.remainingRequests} requests remaining`
                      : 'Active quota'}
                    {limit.remainingTokens !== undefined ? ` · ${formatTokens(limit.remainingTokens)} tokens left` : ''}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    backgroundColor: limit.resetHuman === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: limit.resetHuman === 'active' ? '#34d399' : '#fbbf24',
                    border: `1px solid ${limit.resetHuman === 'active' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                    fontSize: '11px',
                    fontWeight: 500
                  }}
                >
                  <Clock size={12} />
                  <span>{limit.resetHuman || 'active'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Provider Counters (Exact vs Estimated Breakdown) */}
      <div>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Model Consumption &amp; Accuracy Ledger
        </h4>
        <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '8px 12px' }}>Provider / Model</th>
                <th style={{ padding: '8px 12px' }}>Requests</th>
                <th style={{ padding: '8px 12px' }}>Prompt Tok</th>
                <th style={{ padding: '8px 12px' }}>Comp Tok</th>
                <th style={{ padding: '8px 12px' }}>Total Tok</th>
                <th style={{ padding: '8px 12px' }}>Accuracy (Exact/Est)</th>
                <th style={{ padding: '8px 12px' }}>Cost Saved</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data?.providerCounters || {}).length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No model transactions logged yet. Run a prompt in the chat sidecar to populate the ledger.
                  </td>
                </tr>
              ) : (
                Object.entries(data?.providerCounters || {}).map(([key, counter]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {counter.providerId} / <span style={{ color: 'var(--accent-primary, #38bdf8)' }}>{counter.modelId}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{counter.requests}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{counter.promptTokens.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{counter.completionTokens.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--accent-purple, #a855f7)' }}>
                      {counter.totalTokens.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8'
                        }}
                      >
                        {counter.exactUsageCount} exact / {counter.estimatedUsageCount} est
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--accent-green, #10b981)', fontWeight: 600 }}>
                      ${counter.costSavedUsd.toFixed(4)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
