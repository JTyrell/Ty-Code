import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Download, RefreshCw, Trash2 } from 'lucide-react';
import type { AgentPerformanceReport, AgentTelemetryRecord } from '../../../../preload/types';

const CONTEXT_WINDOW_LIMIT = 128_000;
const SPARKLINE_POINTS = 40;

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  minWidth: 0
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)'
};

const metricStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  lineHeight: 1.2
};

const hintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)'
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value * 10) / 10);
}

function TokenSparkline({ values, width, height }: { values: number[]; width: number; height: number }) {
  if (values.length < 2) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '11px',
          border: '1px dashed var(--border-subtle)',
          borderRadius: '8px'
        }}
      >
        Not enough LLM activity yet — run a task to collect data.
      </div>
    );
  }
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 2 - (value / max) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    >
      <polygon
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill="rgba(56, 189, 248, 0.14)"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ObservabilityPanel() {
  const [report, setReport] = useState<AgentPerformanceReport | null>(null);
  const [llmTimeline, setLlmTimeline] = useState<number[]>([]);
  const [latestTokensIn, setLatestTokensIn] = useState<number | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const reportResponse = await window.electronAPI.getAgentTelemetryReport();
      if (reportResponse?.success && reportResponse.data) {
        setReport(reportResponse.data);
        setLoadError('');
      } else {
        setLoadError(reportResponse?.error || 'Telemetry report unavailable');
      }
      const eventsResponse = await window.electronAPI.getAgentTelemetryEvents({ type: 'llm_call' });
      if (eventsResponse?.success && Array.isArray(eventsResponse.data)) {
        const events = eventsResponse.data as AgentTelemetryRecord[];
        const recent = events.slice(-SPARKLINE_POINTS);
        setLlmTimeline(recent.map((event) => (event.type === 'llm_call' ? event.tokensOut : 0)));
        const lastEvent = recent.length > 0 ? recent[recent.length - 1] : null;
        setLatestTokensIn(lastEvent && lastEvent.type === 'llm_call' ? lastEvent.tokensIn : null);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load telemetry');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 3000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleExport = useCallback(async () => {
    try {
      const response = await window.electronAPI.exportAgentTelemetry();
      if (!response?.success || !response.data) return;
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ty-code-agent-telemetry-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Export is best-effort
    }
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await window.electronAPI.clearAgentTelemetry();
      setReport(null);
      setLlmTimeline([]);
      setLatestTokensIn(null);
      await load();
    } catch {
      // Clear is best-effort
    }
  }, [load]);

  const toolCalls = report?.toolCalls;
  const overallRate = toolCalls ? Math.round(toolCalls.overallSuccessRate * 100) : 0;
  const pieColor = overallRate >= 90 ? '#10b981' : overallRate >= 70 ? '#f59e0b' : '#f87171';
  const pieStyle: React.CSSProperties = {
    width: '84px',
    height: '84px',
    borderRadius: '50%',
    background: `conic-gradient(${pieColor} 0turn ${overallRate / 100}turn, var(--surface-3) ${overallRate / 100}turn 1turn)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const pieHoleStyle: React.CSSProperties = {
    width: '58px',
    height: '58px',
    borderRadius: '50%',
    background: 'var(--bg-secondary)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const contextUsed = typeof latestTokensIn === 'number' && latestTokensIn > 0
    ? latestTokensIn
    : report && report.contextCompactions.count > 0
      ? report.contextCompactions.averageTokensAfter
      : 0;
  const contextPct = Math.max(0, Math.min(100, Math.round((contextUsed / CONTEXT_WINDOW_LIMIT) * 100)));
  const contextColor = contextPct >= 85 ? '#f87171' : contextPct >= 60 ? '#f59e0b' : '#38bdf8';

  const maxToolDuration = toolCalls && toolCalls.perTool.length > 0
    ? Math.max(...toolCalls.perTool.map((metric) => metric.avgDuration), 1)
    : 1;

  return (
    <section
      data-observability-panel
      style={{
        margin: '0 24px 24px',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        background: 'var(--bg-tertiary)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Activity size={16} color="var(--accent-primary, #38bdf8)" />
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Agent Observability
        </span>
        <span style={hintStyle}>Local-only metrics — nothing leaves this machine</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={load}
          disabled={refreshing}
          title="Refresh metrics"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <RefreshCw size={12} className={refreshing ? 'background-agent-spin' : undefined} />
          Refresh
        </button>
        <button
          onClick={handleExport}
          title="Export collected data as JSON"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <Download size={12} />
          Export Report
        </button>
        <button
          onClick={handleClear}
          title="Clear collected data"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <Trash2 size={12} />
          Clear Data
        </button>
      </div>

      {loadError ? (
        <div style={{ fontSize: '12px', color: 'var(--accent-red, #f87171)' }}>{loadError}</div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Token usage per LLM call (output)</div>
          <TokenSparkline values={llmTimeline} width={240} height={48} />
          <div style={hintStyle}>
            {report
              ? `${formatNumber(report.llmCalls.count)} calls · in ${formatNumber(report.llmCalls.tokensIn)} · out ${formatNumber(report.llmCalls.tokensOut)} · avg ${formatNumber(report.llmCalls.averageDuration)}ms`
              : 'Collecting…'}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Tool success rate</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={pieStyle}>
              <div style={pieHoleStyle}>
                <span style={{ fontSize: '15px', fontWeight: 600, color: pieColor }}>{overallRate}%</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                {toolCalls ? formatNumber(toolCalls.totalCount) : 0} tool calls
              </span>
              <span style={hintStyle}>
                avg {formatNumber(toolCalls?.averageDuration ?? 0)}ms per call
              </span>
              <span style={hintStyle}>
                {toolCalls && toolCalls.perTool.length > 0
                  ? `busiest: ${toolCalls.perTool[0].toolName} ×${formatNumber(toolCalls.perTool[0].count)}`
                  : 'no tool activity yet'}
              </span>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Avg response time per tool</div>
          {toolCalls && toolCalls.perTool.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {toolCalls.perTool.slice(0, 6).map((metric) => (
                <div key={metric.toolName} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      width: '132px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flexShrink: 0
                    }}
                    title={metric.toolName}
                  >
                    {metric.toolName}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: '8px',
                      borderRadius: '4px',
                      background: 'var(--surface-3)',
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: `${Math.max(2, Math.round((metric.avgDuration / maxToolDuration) * 100))}%`,
                        background: metric.successRate >= 0.9 ? 'var(--accent-green, #10b981)' : metric.successRate >= 0.7 ? 'var(--accent-amber, #f59e0b)' : 'var(--accent-red, #f87171)',
                        borderRadius: '4px',
                        display: 'block'
                      }}
                    />
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatNumber(metric.avgDuration)}ms
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span style={hintStyle}>No tool calls recorded yet.</span>
          )}
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Context window usage</div>
          <div style={{ ...metricStyle, fontSize: '16px' }}>
            ~{formatNumber(contextUsed)} / {formatNumber(CONTEXT_WINDOW_LIMIT)} tokens ({contextPct}%)
          </div>
          <span
            style={{
              display: 'block',
              width: '100%',
              height: '8px',
              borderRadius: '4px',
              background: 'var(--surface-3)',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                width: `${Math.max(2, contextPct)}%`,
                background: contextColor,
                borderRadius: '4px',
                display: 'block'
              }}
            />
          </span>
          <div style={hintStyle}>
            Compactions: {report?.contextCompactions.count ?? 0} · tokens saved: {formatNumber(report?.contextCompactions.totalTokensSaved ?? 0)}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Iterations &amp; efficiency</div>
          <div style={{ ...metricStyle, fontSize: '16px' }}>
            {report?.agentIterations.count ?? 0} iterations recorded
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={hintStyle}>
              avg todos completed / iteration: {report?.agentIterations.averageTodosCompleted ?? 0}
            </span>
            <span style={hintStyle}>
              avg todos remaining / iteration: {report?.agentIterations.averageTodosRemaining ?? 0}
            </span>
            <span style={hintStyle}>
              errors recorded: {report?.errors.count ?? 0}
            </span>
          </div>
        </div>
      </div>

      {report && report.errors.recentMessages.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={sectionTitleStyle}>Recent errors</div>
          {report.errors.recentMessages.slice(-5).reverse().map((message, index) => (
            <div
              key={`${index}-${message.slice(0, 24)}`}
              style={{
                fontSize: '11px',
                color: 'var(--accent-red, #f87171)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={message}
            >
              {message.length > 220 ? `${message.slice(0, 220)}…` : message}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default ObservabilityPanel;
