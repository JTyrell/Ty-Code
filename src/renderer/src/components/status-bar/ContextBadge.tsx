/**
 * Ty-Code Context Engine: ContextBadge & Context Audit Panel (Step 2)
 *
 * Displays "🧠 Context: 85%" in the bottom status bar.
 * Clicking opens the Context Audit Panel showcasing:
 * - Detected Stack (Frameworks, DBs, Architecture, Key Directories)
 * - Missing Context warnings with fidelity hints
 * - Active Correction Memories with trash icon to delete rules
 * - "Resync Workspace" button triggering local rescan
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import React, { useEffect, useRef } from 'react';
import {
  Brain,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  X,
  Layers,
  Database,
  Code2,
  FolderTree,
  Lightbulb
} from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import { useContextAuditStore } from '../../state/context-audit-store';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import styles from './ContextBadge.module.css';

export interface ContextBadgeProps {
  className?: string;
}

export const ContextBadge: React.FC<ContextBadgeProps> = ({ className }) => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const { attachSurface, detachSurface } = useWorkspaceSessionStore();

  useEffect(() => {
    attachSurface('context');
    return () => detachSurface('context');
  }, [attachSurface, detachSurface]);

  const {
    isOpen,
    scoreResult,
    profile,
    corrections,
    isLoading,
    isResyncing,
    toggleAuditPanel,
    closeAuditPanel,
    fetchAuditData,
    resyncWorkspace,
    deleteCorrectionEntry
  } = useContextAuditStore();

  const panelRef = useRef<HTMLDivElement>(null);

  // Initial fetch and workspace change listener
  useEffect(() => {
    void fetchAuditData(workspacePath);
  }, [workspacePath, fetchAuditData]);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAuditPanel();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Check if click was on the badge button itself
        const badgeBtn = document.getElementById('status-bar-context-badge-btn');
        if (badgeBtn && badgeBtn.contains(e.target as Node)) return;
        closeAuditPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, closeAuditPanel]);

  const hasWorkspace = Boolean(workspacePath);
  const getScoreColor = (sc: number): string => {
    if (sc >= 90) return '#34d399'; // Emerald
    if (sc >= 80) return '#38bdf8'; // Sky cyan
    if (sc >= 70) return '#fbbf24'; // Amber
    return '#f87171'; // Rose
  };
  const score = hasWorkspace && scoreResult ? scoreResult.score : null;
  const grade = hasWorkspace && scoreResult ? scoreResult.grade : null;
  const scoreColor = hasWorkspace && scoreResult && score !== null ? getScoreColor(score) : 'var(--text-muted)';
  const detectedStack = scoreResult?.detectedStack || {
    primaryLanguage: hasWorkspace ? (profile?.primaryLanguage || 'TypeScript') : '—',
    frameworks: hasWorkspace ? (profile?.frameworks || []) : [],
    databases: hasWorkspace ? (profile?.databases || []) : [],
    architecture: hasWorkspace ? (profile?.architecture || 'Modular Application') : '—',
    keyDirectories: hasWorkspace ? (profile?.keyDirectories || {}) : {}
  };
  const missingWarnings = scoreResult?.missingContext ?? (hasWorkspace ? profile?.missingContext || [] : []);

  return (
    <>
      {/* 1. Status Bar Context Badge */}
      <button
        type="button"
        id="status-bar-context-badge-btn"
        className={`${styles.badgeBtn} ${isOpen ? styles.active : ''} ${className || ''}`}
        onClick={toggleAuditPanel}
        title={hasWorkspace
          ? `Context Audit Score: ${score}% (Grade ${grade}). Click to open Context Audit Panel.`
          : 'Context Audit — No workspace open. Click to enable.'}
        aria-label={hasWorkspace ? `Context Audit Score ${score} percent` : 'Context Audit disabled without workspace'}
        aria-expanded={isOpen && hasWorkspace}
      >
        <Brain size={12} color={scoreColor} />
        <span>{hasWorkspace ? `Context: ${score}%` : 'Context: —'}</span>
        <span
          className={styles.scoreDot}
          style={{ backgroundColor: scoreColor }}
          aria-hidden="true"
        />
      </button>

      {/* 2. Floating Context Audit Panel Popover */}
      {isOpen && !hasWorkspace && (
        <>
          <div className={styles.backdrop} aria-hidden="true" onClick={closeAuditPanel} />
          <div
            ref={panelRef}
            className={styles.auditPanel}
            role="dialog"
            aria-label="Context Engine unavailable without workspace"
          >
            <div className={styles.panelHeader}>
              <div className={styles.headerTitleGroup}>
                <Brain size={15} color="var(--text-muted)" />
                <h3 className={styles.headerTitle}>Context Engine — No Workspace Open</h3>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={closeAuditPanel}
                  aria-label="Close Context Audit Panel"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div style={{ padding: '18px 16px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              The Context Engine grounds its audit in the shared workspace root. Delegating — the Explorer (Main
              Editor) owns Open Folder; once the root is set on the workspace session bus, this panel auto-syncs.
              <button
                type="button"
                onClick={() => void window.electronAPI?.openFolderDialog?.()}
                title="Delegate workspace open to the Explorer entry"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                  padding: '7px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent-primary, #6366f1)',
                  color: '#fff',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Open Folder
              </button>
            </div>
          </div>
        </>
      )}

      {isOpen && hasWorkspace && (
        <>
          <div className={styles.backdrop} aria-hidden="true" onClick={closeAuditPanel} />
          <div
            ref={panelRef}
            id="context-audit-panel"
            className={styles.auditPanel}
            role="dialog"
            aria-label="Context Engine Audit Panel"
          >
            {/* Header */}
            <div className={styles.panelHeader}>
              <div className={styles.headerTitleGroup}>
                <Brain size={15} color={scoreColor} />
                <h3 className={styles.headerTitle}>Context Engine Audit</h3>
                <span
                  className={styles.gradeBadge}
                  style={{
                    backgroundColor: `${scoreColor}22`,
                    color: scoreColor,
                    border: `1px solid ${scoreColor}44`
                  }}
                >
                  Grade {grade}
                </span>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={closeAuditPanel}
                aria-label="Close Context Audit Panel"
              >
                <X size={14} />
              </button>
            </div>

            {/* Workspace session presence strip (Prompt 1: session bus) */}
            <div style={{ padding: '0 14px', flexShrink: 0 }}>
              <SessionPresenceStrip self="context" />
            </div>

            {/* Scrollable Body */}
            <div className={styles.panelBody}>
              {/* Score Overview Card */}
              <div className={styles.scoreOverviewCard}>
                <div className={styles.scoreRow}>
                  <div>
                    <span className={styles.scoreBig} style={{ color: scoreColor }}>
                      {score}%
                    </span>
                    <span className={styles.scoreSubtitle}> &mdash; AI Stack Grounding</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Target: 100%
                  </span>
                </div>
                <div className={styles.progressBarContainer}>
                  <div
                    className={styles.progressBarFill}
                    style={{
                      width: `${score}%`,
                      backgroundColor: scoreColor
                    }}
                  />
                </div>
              </div>

              {/* Detected Stack Section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h4 className={styles.sectionTitle}>
                    <Layers size={12} color="var(--accent-primary)" />
                    Detected Stack
                  </h4>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {detectedStack.architecture}
                  </span>
                </div>
                <div className={styles.chipGrid}>
                  <span className={`${styles.chip} ${styles.chipPrimary}`}>
                    <Code2 size={11} />
                    {detectedStack.primaryLanguage}
                  </span>
                  {detectedStack.frameworks.map((fw) => (
                    <span key={fw} className={styles.chip}>
                      {fw}
                    </span>
                  ))}
                  {detectedStack.databases.map((db) => (
                    <span key={db} className={`${styles.chip} ${styles.chipDb}`}>
                      <Database size={11} />
                      {db}
                    </span>
                  ))}
                  {detectedStack.databases.length === 0 && (
                    <span className={styles.chip} style={{ color: 'var(--text-muted)' }}>
                      No DB detected
                    </span>
                  )}
                </div>
              </div>

              {/* Missing Context Section */}
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>
                  <AlertTriangle size={12} color="#fbbf24" />
                  Missing Context Warnings
                </h4>
                {missingWarnings.length > 0 ? (
                  missingWarnings.map((warn, i) => (
                    <div key={i} className={styles.warningCard}>
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <strong>{warn}</strong>
                        <div style={{ fontSize: '10px', opacity: 0.85, marginTop: 2 }}>
                          Adding this config eliminates model assumptions and raises Context Score.
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.successCard}>
                    <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                    <span>Complete context detected. Omni-Orchestrator has high fidelity.</span>
                  </div>
                )}
              </div>

              {/* Active Correction Memories Section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h4 className={styles.sectionTitle}>
                    <Lightbulb size={12} color="#34d399" />
                    Active Correction Memories ({corrections.length})
                  </h4>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Auto-injected into Omni-Orchestrator
                  </span>
                </div>
                {corrections.length > 0 ? (
                  <div className={styles.correctionsList}>
                    {corrections.map((corr) => (
                      <div key={corr.id} className={styles.correctionItem}>
                        <span className={styles.correctionTag}>{corr.category}</span>
                        <span className={styles.correctionRule}>{corr.rule}</span>
                        <button
                          type="button"
                          className={styles.trashBtn}
                          onClick={() => void deleteCorrectionEntry(workspacePath, corr.id)}
                          title="Delete this correction rule"
                          aria-label={`Delete rule ${corr.rule}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    No corrections recorded yet. Click "💡 Remember this preference" on any agent message to pin project rules.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className={styles.panelFooter}>
              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                {isResyncing || isLoading ? 'Analyzing workspace stack...' : 'Context auto-syncs on changes'}
              </span>
              <button
                type="button"
                className={styles.resyncBtn}
                onClick={() => void resyncWorkspace(workspacePath)}
                disabled={isResyncing || isLoading}
                title="Rescan repository manifests and refresh Context Score"
              >
                <RefreshCw size={11} className={isResyncing || isLoading ? styles.spin : ''} />
                <span>{isResyncing ? 'Resyncing...' : 'Resync Workspace'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};
