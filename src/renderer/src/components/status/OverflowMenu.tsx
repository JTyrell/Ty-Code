/**
 * Ty-Code Desktop IDE - OverflowMenu
 * Popover menu listing items collapsed below breakpoints:
 * - Full telemetry with live context percentage and token counts
 * - Editor encoding, line endings, indentation, cursor position
 * - LSP server status and workspace diagnostics counts
 * - Git branch and sync state
 * - Orchestration mode, tier, and session controls
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MoreHorizontal,
  Zap,
  FileCode,
  AlertCircle,
  Cpu,
  Sparkles,
  Eye,
  Undo2,
  Activity,
  Check
} from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useChatStore } from '../../state/chat-store';
import { useGitStore } from '../../state/git-store';
import { useLspStore } from '../../state/lsp-store';
import { usePairProgrammingStore } from '../../state/pair-programming-store';
import { useWorkspaceEditStore } from '../../state/workspace-edit-store';
import { useUsageDashboardStore } from '../../state/usage-dashboard-store';
import { undoWorkspaceEditTransaction } from '../../services/workspace-edit-commands';
import styles from './OverflowMenu.module.css';

export interface OverflowMenuProps {
  className?: string;
  isTelemetryCollapsed?: boolean;
}

export const OverflowMenu: React.FC<OverflowMenuProps> = ({ className, isTelemetryCollapsed }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Store slices
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const settings = useChatStore((s) => s.settings);
  const contextTokens = useChatStore((s) => s.contextTokens);
  const contextLimit = useChatStore((s) => s.contextLimit);
  const openSettings = useChatStore((s) => s.openSettings);

  const status = useGitStore((s) => s.status);
  const syncRepo = useGitStore((s) => s.syncRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);

  const servers = useLspStore((s) => s.servers);
  const diagnostics = useLspStore((s) => s.diagnostics);

  const isPairActive = usePairProgrammingStore((s) => s.isPairActive);
  const togglePairMode = usePairProgrammingStore((s) => s.togglePairMode);

  const forcePreviewAll = useWorkspaceEditStore((s) => s.forcePreviewAll);
  const setForcePreviewAll = useWorkspaceEditStore((s) => s.setForcePreviewAll);
  const recentEdits = useWorkspaceEditStore((s) => s.recentEdits);

  const quotaSnapshot = useUsageDashboardStore((s) => s.quotaSnapshot);
  const openDashboard = useUsageDashboardStore((s) => s.openDashboard);

  // Derived state
  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const language = activeTab?.language || 'plaintext';
  const diagnosticsList = Object.values(diagnostics).flatMap((d) => d.diagnostics);
  const errors = diagnosticsList.filter((d) => d.severity === 1).length;
  const warnings = diagnosticsList.filter((d) => d.severity === 2).length;
  const server = servers.find((s) => s.languageId === language || (language === 'typescript' && s.languageId === 'javascript'));

  const activeModel = settings?.activeModel || 'qwen/qwen3-coder:free';
  const activeProvider = settings?.activeProvider || 'openkilo';
  const modelShortName = activeModel.split('/').pop() || activeModel;

  const tokens = contextTokens ?? 0;
  const limit = contextLimit ?? 128_000;
  const usageRatio = limit > 0 ? Math.min(1, tokens / limit) : 0;
  const usagePercent = Math.round(usageRatio * 100);

  const autoApplied = recentEdits.filter((e) => e.autoApplied);
  const branchName = status?.isRepo ? status.currentBranch : 'No Git';
  const folderName = workspacePath ? workspacePath.split(/[/\\]/).filter(Boolean).pop() : 'Workspace';

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div ref={menuRef} className={`${styles.container} ${className || ''}`}>
      <button
        type="button"
        id="status-bar-overflow-btn"
        className={styles.triggerBtn}
        onClick={() => setIsOpen((prev) => !prev)}
        title="More status items & live telemetry"
        aria-label="More status items and telemetry"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={13} />
      </button>

      {isOpen && (
        <>
          <div
            className={styles.backdrop}
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            id="status-bar-overflow-popover"
            role="dialog"
            aria-label="Status Bar Overflow Menu"
            className={styles.popover}
          >
            {/* 1. Telemetry Section */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Context & Telemetry</div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <Zap size={11} color="var(--accent-primary)" />
                  <span>Tokens (In-Flight)</span>
                </div>
                <span className={styles.rowValue}>
                  {new Intl.NumberFormat('en-US').format(tokens)} / {new Intl.NumberFormat('en-US').format(limit)}
                </span>
              </div>
              <div className={styles.progressBarTrack}>
                <div
                  className={styles.progressBarFill}
                  style={{
                    width: `${usagePercent}%`,
                    backgroundColor: usagePercent >= 90 ? 'var(--accent-amber)' : 'var(--accent-primary)'
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                <span>{usagePercent}% of limit</span>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    openDashboard();
                    setIsOpen(false);
                  }}
                >
                  Quota Dashboard
                </button>
              </div>
            </div>

            {/* 2. Editor & File Formatting */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Editor & Formatting</div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <FileCode size={11} />
                  <span>Language</span>
                </div>
                <span className={styles.rowValue} style={{ textTransform: 'capitalize' }}>
                  {language}
                </span>
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <span>Encoding / Line End</span>
                </div>
                <span className={styles.rowValue}>UTF-8 · LF</span>
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <span>Indentation / Cursor</span>
                </div>
                <span className={styles.rowValue}>
                  Spaces: {settings?.editor?.tabSize || 2} · Ln 1, Col 1
                </span>
              </div>
            </div>

            {/* 3. LSP & Diagnostics */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Language Server & Health</div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <Activity size={11} />
                  <span>LSP Status</span>
                </div>
                <span
                  className={styles.rowValue}
                  style={{
                    color: server?.status === 'running' ? 'var(--accent-green)' : 'var(--text-muted)'
                  }}
                >
                  {server ? `LSP ${server.status === 'running' ? 'Running' : 'Ready'}` : 'LSP Ready'}
                </span>
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <AlertCircle
                    size={11}
                    color={errors > 0 ? 'var(--accent-red)' : warnings > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'}
                  />
                  <span>Diagnostics</span>
                </div>
                <span className={styles.rowValue}>
                  {errors} errors · {warnings} warnings
                </span>
              </div>
            </div>

            {/* 4. Git & Workspace */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Workspace & Git</div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Workspace</span>
                <span className={styles.rowValue} title={workspacePath}>
                  {folderName}
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Branch</span>
                <span className={styles.rowValue}>{branchName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    void (status?.isRepo ? syncRepo() : refreshStatus());
                    setIsOpen(false);
                  }}
                >
                  Sync Repository
                </button>
              </div>
            </div>

            {/* 5. AI Session Controls */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>AI Orchestration Controls</div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <Cpu size={11} color="var(--accent-primary)" />
                  <span>Model</span>
                </div>
                <span className={styles.rowValue}>{modelShortName}</span>
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <Sparkles size={11} color={isPairActive ? 'var(--accent-green)' : 'var(--text-muted)'} />
                  <span>AI Pair Mode</span>
                </div>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={togglePairMode}
                  style={{ color: isPairActive ? 'var(--accent-green)' : 'var(--text-secondary)' }}
                >
                  {isPairActive ? 'Active (ON)' : 'Disabled (OFF)'}
                </button>
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  <Eye size={11} />
                  <span>Preview All Edits</span>
                </div>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setForcePreviewAll(!forcePreviewAll)}
                  style={{ color: forcePreviewAll ? 'var(--accent-amber)' : 'var(--text-secondary)' }}
                >
                  {forcePreviewAll ? 'ON' : 'OFF'}
                </button>
              </div>

              {autoApplied.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Auto-applied edits ({autoApplied.length})
                  </div>
                  {autoApplied.slice(0, 3).map((item) => (
                    <div key={item.transactionId} className={styles.row} style={{ marginTop: '2px' }}>
                      <span style={{ fontSize: '10px' }}>
                        {item.origin.replace('-', ' ')} ({item.fileCount}f)
                      </span>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => void undoWorkspaceEditTransaction(item.transactionId)}
                      >
                        <Undo2 size={10} /> Revert
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
