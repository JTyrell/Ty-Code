import { AlertCircle, Cpu, Eye, GitBranch, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useGitStore } from '../state/git-store';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { useLspStore } from '../state/lsp-store';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { undoWorkspaceEditTransaction } from '../services/workspace-edit-commands';
import { AgentStatusBar } from './AgentStatusBar';

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

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const language = activeTab?.language || 'plaintext';
  const diagnosticsList = Object.values(diagnostics).flatMap((event) => event.diagnostics);
  const errors = diagnosticsList.filter((item) => item.severity === 1).length;
  const warnings = diagnosticsList.filter((item) => item.severity === 2).length;
  const server = servers.find((item) => item.languageId === getServerLanguage(language));
  const branchName = status?.isRepo ? status.currentBranch : 'No Git';
  const hasAheadBehind = Boolean((status?.ahead || 0) > 0 || (status?.behind || 0) > 0);
  const autoApplied = recentEdits.filter((item) => item.autoApplied);

  useEffect(() => {
    void refreshServers();
    void refreshRecentEdits();
    const timer = window.setInterval(() => { void refreshServers(); void refreshRecentEdits(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshServers, refreshRecentEdits]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }} title="Active AI Engine"><Cpu size={12} color="var(--accent-primary)" /><span>{settings?.activeModel?.split('/').pop() || 'DeepSeek V3'}</span></div>
      </div>
    </div>
  );
};
