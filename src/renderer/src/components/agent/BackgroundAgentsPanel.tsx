import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Square, XCircle } from 'lucide-react';
import type { BackgroundAgentDetails, BackgroundAgentSnapshot } from '../../../../preload/types';

const panelStyle: React.CSSProperties = {
  flexShrink: 0,
  margin: '10px 12px 0',
  padding: '10px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg-secondary)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '7px 8px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.18)'
};

const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11
};

const progressBarTrackStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: 'rgba(255, 255, 255, 0.12)',
  overflow: 'hidden'
};

const taskTextStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 10,
  lineHeight: 1.45,
  overflowWrap: 'anywhere'
};

const transcriptStyle: React.CSSProperties = {
  maxHeight: 220,
  overflow: 'auto',
  padding: 6,
  marginTop: 4,
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.25)',
  color: 'var(--text-secondary)',
  font: '9px/1.5 var(--font-mono)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text'
};

const buttonStyle: React.CSSProperties = {
  minHeight: 22,
  padding: '2px 8px',
  fontSize: 10,
  fontWeight: 550,
  color: 'var(--text-secondary)',
  background: 'var(--bg-hover)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  cursor: 'pointer'
};

function describeAge(startedAt: number, completedAt: number | undefined, nowTs: number): string {
  const end = completedAt ?? nowTs;
  const ms = Math.max(0, end - startedAt);
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function statusIcon(status: BackgroundAgentSnapshot['status']): React.ReactNode {
  if (status === 'running') return <Loader2 size={12} color="var(--accent-primary)" style={{ animation: 'background-agent-spin 1s linear infinite' }} />;
  if (status === 'completed') return <CheckCircle2 size={12} color="var(--accent-green)" />;
  if (status === 'failed') return <XCircle size={12} color="var(--accent-red)" />;
  return <Play size={11} color="var(--text-muted)" />;
}

function AgentRow({ agent, nowTs, onCancel }: { agent: BackgroundAgentSnapshot; nowTs: number; onCancel: (id: string) => void }): React.ReactNode {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<BackgroundAgentDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const loadDetails = useCallback(async () => {
    setDetailsLoading(true);
    try {
      const response = await window.electronAPI.getBackgroundAgentDetails(agent.id);
      if (response?.success) setDetails(response.data ?? null);
    } catch {
      setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }, [agent.id]);

  const toggleDetails = () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    if (next) void loadDetails();
  };

  const isError = details?.agent.error;
  return (
    <div style={rowStyle}>
      <div style={rowHeaderStyle}>
        {statusIcon(agent.status)}
        <strong style={{ color: 'var(--text-primary)', fontSize: 11, overflowWrap: 'anywhere' }}>{agent.name}</strong>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 9 }}>{describeAge(agent.startedAt, agent.completedAt, nowTs)}</span>
        <button type="button" style={buttonStyle} onClick={toggleDetails}>
          {detailsOpen ? 'Hide details' : 'View details'}
        </button>
        {(agent.status === 'running' || agent.status === 'idle') && (
          <button type="button" style={{ ...buttonStyle, color: 'var(--accent-red)' }} onClick={() => onCancel(agent.id)}>
            <Square size={9} /> Cancel
          </button>
        )}
      </div>
      <div style={progressBarTrackStyle}>
        <div style={{ height: '100%', width: `${agent.progress}%`, borderRadius: 2, background: agent.status === 'failed' ? 'var(--accent-red)' : 'var(--accent-primary)' }} />
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>
        {agent.status === 'running' ? `${agent.progress}%` : agent.status === 'failed' ? `failed: ${agent.error || 'unknown error'}` : agent.status}
      </span>
      <span style={taskTextStyle}>{agent.task.slice(0, 220)}{agent.task.length > 220 ? '…' : ''}</span>
      {detailsOpen && (
        detailsLoading && !details ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Loading transcript…</span>
        ) : (
          <pre style={transcriptStyle}>{(details?.transcript || []).map((entry: { role: string; content: string }) => `[${entry.role}] ${entry.content}`).join('\n')}{isError ? `\n[result] ${isError}` : ''}</pre>
        )
      )}
    </div>
  );
}

export const BackgroundAgentsPanel: React.FC = () => {
  const [agents, setAgents] = useState<BackgroundAgentSnapshot[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await window.electronAPI.getBackgroundAgents?.();
      if (response?.success && response.data) setAgents(response.data);
      else if (response?.success && !response.data) setAgents([]);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => setNowTs(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  const handleCancel = useCallback(async (agentId: string) => {
    try {
      await window.electronAPI.cancelBackgroundAgent?.(agentId);
    } catch {
      return;
    }
    void refresh();
  }, [refresh]);

  if (agents.length === 0) return null;
  const active = agents.filter((agent) => agent.status === 'running' || agent.status === 'idle');
  const completed = agents.filter((agent) => agent.status === 'completed' || agent.status === 'failed');

  return (
    <section style={panelStyle} aria-label="Background agents">
      <div style={{ ...rowHeaderStyle, gap: 6 }}>
        <Loader2 size={12} color="var(--accent-primary)" />
        <strong style={{ color: 'var(--text-primary)', fontSize: 11 }}>Background agents</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{active.length} active</span>
      </div>
      {active.map((agent) => (
        <AgentRow key={agent.id} agent={agent} nowTs={nowTs} onCancel={(id) => void handleCancel(id)} />
      ))}
      {completed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            style={{ ...buttonStyle, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => setCompletedOpen((open) => !open)}
          >
            {completedOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Completed ({completed.length})
          </button>
          {completedOpen && completed.map((agent) => (
            <AgentRow key={agent.id} agent={agent} nowTs={nowTs} onCancel={(id) => void handleCancel(id)} />
          ))}
        </div>
      )}
    </section>
  );
};
