import { AlertCircle, Cpu, Eye, GitBranch, RefreshCw, Sparkles, Undo2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useGitStore } from '../state/git-store';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { useLspStore } from '../state/lsp-store';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { undoWorkspaceEditTransaction } from '../services/workspace-edit-commands';
import { AgentStatusBar } from './AgentStatusBar';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';

function getServerLanguage(language: string): string {
  if (language === 'javascript') return 'typescript';
  if (language === 'c') return 'cpp';
  return language;
}

export const StatusBar: React.FC = () => {
  const { openTabs, activeTabPath } = useWorkspaceStore();
  const { settings } = useChatStore();
  const { status, isSyncing, syncRepo, refreshStatus } = useGitStore();
  const { isPairActive, togglePairMode } = usePairProgrammingStore();
  const { servers, diagnostics, refreshServers } = useLspStore();
  const { forcePreviewAll, setForcePreviewAll, recentEdits, refreshRecentEdits } = useWorkspaceEditStore();
  const [showAutoApplied, setShowAutoApplied] = useState(false);

  const { quotaSnapshot, openDashboard, refreshStats: refreshQuota } = useUsageDashboardStore();

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const language = activeTab?.language || 'plaintext';
  const diagnosticsList = Object.values(diagnostics).flatMap((event) => event.diagnostics);
  const errors = diagnosticsList.filter((item) => item.severity === 1).length;
  const warnings = diagnosticsList.filter((item) => item.severity === 2).length;
  const server = servers.find((item) => item.languageId === getServerLanguage(language));
  const branchName = status?.isRepo ? status.currentBranch : 'No Git';
  const hasAheadBehind = Boolean((status?.ahead || 0) > 0 || (status?.behind || 0) > 0);
  const autoApplied = recentEdits.filter((item) => item.autoApplied);

  const activeModel = settings?.activeModel || 'qwen/qwen3-coder:free';
  const activeProvider = settings?.activeProvider || 'openkilo';
  const modelShortName = activeModel.split('/').pop() || activeModel;
  const isFreeModel = activeModel.includes(':free') || activeProvider === 'openkilo' || activeProvider === 'fcc-proxy' || activeProvider === 'ollama' || (quotaSnapshot?.freeModeActive ?? true);

  const currentTier = (() => {
    const m = activeModel.toLowerCase();
    if (m.includes('r1') || m.includes('o1')) return { label: 'Tier S', name: 'Reasoning', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)' };
    if (m.includes('coder') || m.includes('code') || m.includes('sonnet') || m.includes('codellama')) return { label: 'Tier A', name: 'Coding', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.15)', border: 'rgba(129, 140, 248, 0.3)' };
    if (m.includes('8b') || m.includes('flash') || m.includes('instant')) return { label: 'Tier C', name: 'Fast', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.3)' };
    return { label: 'Tier B', name: 'General', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.3)' };
  })();

  const providerQuota = quotaSnapshot?.providers ? quotaSnapshot.providers[activeProvider] : undefined;
  const isCooldown = providerQuota?.healthStatus === 'cooling_down';
  const isExhausted = providerQuota?.healthStatus === 'exhausted';
  const dotColor = isCooldown ? '#f59e0b' : isExhausted ? '#ef4444' : '#10b981';

  const totalUsed = quotaSnapshot?.totalTokensConsumed || 0;
  const usageDisplay = totalUsed > 1000 ? `${(totalUsed / 1000).toFixed(0)}k used` : '2.05B Free';

  useEffect(() => {
    void refreshServers();
    void refreshRecentEdits();
    void refreshQuota();
    const timer = window.setInterval(() => {
      void refreshServers();
      void refreshRecentEdits();
      void refreshQuota();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshServers, refreshRecentEdits, refreshQuota]);

  return (
    <div style={{ height: '24px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: '11px', color: 'var(--text-secondary)', userSelect: 'none', zIndex: 5, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button type="button" onClick={() => void (status?.isRepo ? syncRepo() : refreshStatus())} title={status?.isRepo ? `Git Branch: ${branchName} (Click to sync remote)` : 'Click to check Git status'} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
          <GitBranch size={12} color="var(--accent-primary)" />{branchName}
          {hasAheadBehind && <span style={{ color: 'var(--text-muted)' }}>{status?.behind ? `↓${status.behind}` : ''}{status?.ahead ? `↑${status.ahead}` : ''}</span>}
          {isSyncing && <RefreshCw size={10} className="spin" />}
        </button>

        <div title={`Workspace diagnostics: ${errors} errors, ${warnings} warnings`} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: errors ? 'var(--accent-red)' : warnings ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
          <AlertCircle size={11} /><span>{errors} errors · {warnings} warnings</span>
        </div>
        {server && <span title={server.error || server.resolvedPath || server.name} style={{ color: server.status === 'running' ? 'var(--accent-green)' : server.status === 'error' ? 'var(--accent-red)' : 'var(--text-muted)' }}>LSP {server.status === 'running' ? 'Running' : server.status === 'error' ? 'Error' : server.isAvailable ? 'Ready' : 'Unavailable'}</span>}
        <span style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />
        <AgentStatusBar />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button type="button" aria-pressed={forcePreviewAll} onClick={() => setForcePreviewAll(!forcePreviewAll)} title={forcePreviewAll ? 'Force-preview is on for this session' : 'Force-preview all edits for this session'} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: forcePreviewAll ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
          <Eye size={12} />{forcePreviewAll ? 'Preview all: on' : 'Preview all'}
        </button>
        <div style={{ position: 'relative' }}>
          <button type="button" onClick={() => setShowAutoApplied((open) => !open)} title="Recently auto-applied edits" aria-expanded={showAutoApplied} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: autoApplied.length ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
            <Undo2 size={12} />Auto-applied {autoApplied.length || ''}
          </button>
          {showAutoApplied && <div role="dialog" aria-label="Recently auto-applied edits" style={{ position: 'absolute', right: 0, bottom: 26, width: 320, maxHeight: 260, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--border-strong)', boxShadow: '0 12px 28px rgba(0,0,0,.45)', zIndex: 20 }}>
            <strong style={{ padding: '4px 6px', color: 'var(--text-primary)' }}>Recently auto-applied</strong>
            {autoApplied.length === 0 ? <span style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>No auto-applied edits this session.</span> : autoApplied.map((item) => <div key={item.transactionId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 6px', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{item.origin.replace('-', ' ')} · {item.fileCount} file{item.fileCount === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => void undoWorkspaceEditTransaction(item.transactionId)} style={{ color: 'var(--accent-cyan)' }}><Undo2 size={12} />Revert</button>
            </div>)}
          </div>}
        </div>
        <button type="button" onClick={togglePairMode} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isPairActive ? '#22c55e' : 'var(--text-secondary)' }} title={isPairActive ? 'AI Pair Programming is ON (Click to disable)' : 'Click to enable AI Pair Programming mode'}>
          <Sparkles size={11} color={isPairActive ? '#22c55e' : 'var(--text-muted)'} /><span>Pair: {isPairActive ? 'ON' : 'OFF'}</span>
        </button>
        <span>Ln 1, Col 1</span><span>Spaces: {settings?.editor?.tabSize || 2}</span><span>UTF-8</span>
        <span style={{ textTransform: 'capitalize', color: 'var(--accent-cyan)' }}>{language}</span>

        {/* Smart Orchestrator: Model / Provider / Quota Indicator */}
        <button
          type="button"
          id="status-bar-active-model-btn"
          onClick={openDashboard}
          title={`Active AI: ${modelShortName} (${currentTier.label}: ${currentTier.name}) via ${activeProvider} (${isCooldown ? 'Cooldown' : 'Healthy'}). Click to open Smart Orchestration & Quota Dashboard.`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-primary)',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '2px 7px',
            cursor: 'pointer',
            fontSize: '11px',
            transition: 'all 0.15s ease'
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: dotColor,
              boxShadow: `0 0 6px ${dotColor}`
            }}
          />
          <Cpu size={12} color="var(--accent-primary)" />
          <span id="status-bar-active-model" style={{ fontWeight: 500 }}>{modelShortName}</span>
          <span
            id="status-bar-model-tier-badge"
            style={{
              fontSize: '8px',
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: '3px',
              backgroundColor: currentTier.bg,
              color: currentTier.color,
              border: `1px solid ${currentTier.border}`
            }}
            title={`${currentTier.label}: ${currentTier.name}`}
          >
            {currentTier.label}
          </span>
          {isFreeModel && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '0 4px',
                borderRadius: '3px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              FREE
            </span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            ⚡ {usageDisplay}
          </span>
        </button>
      </div>
    </div>
  );
};
