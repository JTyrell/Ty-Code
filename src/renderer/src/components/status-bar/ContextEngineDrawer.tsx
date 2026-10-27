/**
 * Ty-Code Context Engine Drawer (Prompt 3)
 *
 * The Context Audit panel as a dockable bottom drawer of the CENTER column:
 * a flex sibling of the editor area and the integrated terminal that
 * participates in the layout split (with a top-edge resize handle). It is
 * never an absolutely-positioned overlay, so it can never slide behind the
 * left dock or the AI sidecar.
 *
 * The audit is driven by the shared workspace session bus
 * (context-audit-store.initContextAuditSync), so the root shown here matches
 * the editor/debugger/canvas session strips exactly.
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Lightbulb,
  FolderOpen
} from 'lucide-react';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import { useContextAuditStore } from '../../state/context-audit-store';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import styles from './ContextEngineDrawer.module.css';

const DRAWER_MIN_HEIGHT = 180;
const DRAWER_MAX_HEIGHT = 480;
const DRAWER_DEFAULT_HEIGHT = 300;

export const getScoreColor = (score: number): string => {
  if (score >= 90) return '#34d399'; // Emerald
  if (score >= 80) return '#38bdf8'; // Sky cyan
  if (score >= 70) return '#fbbf24'; // Amber
  return '#f87171'; // Rose
};

export const ContextEngineDrawer: React.FC = () => {
  const isOpen = useContextAuditStore((s) => s.isOpen);
  const scoreResult = useContextAuditStore((s) => s.scoreResult);
  const profile = useContextAuditStore((s) => s.profile);
  const corrections = useContextAuditStore((s) => s.corrections);
  const isLoading = useContextAuditStore((s) => s.isLoading);
  const isResyncing = useContextAuditStore((s) => s.isResyncing);
  const closeAuditPanel = useContextAuditStore((s) => s.closeAuditPanel);
  const resyncWorkspace = useContextAuditStore((s) => s.resyncWorkspace);
  const deleteCorrectionEntry = useContextAuditStore((s) => s.deleteCorrectionEntry);

  // Single source of truth: the shared workspace session bus.
  const sessionRootPath = useWorkspaceSessionStore((s) => s.session.rootPath);
  const hasWorkspace = Boolean(sessionRootPath);

  const [height, setHeight] = useState(DRAWER_DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startY: 0, startHeight: DRAWER_DEFAULT_HEIGHT });

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuditPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeAuditPanel]);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragState.current = { startY: e.clientY, startHeight: height };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [height]);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    // Dragging up increases the drawer height (drawer grows upward).
    const delta = dragState.current.startY - e.clientY;
    const maxHeight = Math.max(DRAWER_MIN_HEIGHT, Math.min(DRAWER_MAX_HEIGHT, window.innerHeight - 220));
    setHeight(Math.max(DRAWER_MIN_HEIGHT, Math.min(maxHeight, dragState.current.startHeight + delta)));
  }, [isDragging]);

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture already released */
    }
  }, [isDragging]);

  if (!isOpen) return null;

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
    <section
      id="context-engine-drawer"
      className={styles.drawer}
      style={{ height: `${height}px` }}
      role="complementary"
      aria-label="Context Engine Audit Drawer"
    >
      <div
        className={`${styles.resizeHandle} ${isDragging ? styles.dragging : ''}`}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        title="Drag to resize the Context Engine drawer"
      />

      {/* Header */}
      <div className={styles.drawerHeader}>
        <div className={styles.headerTitleGroup}>
          <Brain size={15} color={scoreColor} />
          <h3 className={styles.headerTitle}>Context Engine Audit</h3>
          {hasWorkspace && grade && (
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
          )}
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={closeAuditPanel}
          aria-label="Close Context Engine Drawer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Workspace session presence strip (session bus root parity) */}
      <div style={{ padding: '0 14px', flexShrink: 0 }}>
        <SessionPresenceStrip self="context" />
      </div>

      {!hasWorkspace ? (
        /* Delegation card: the Explorer owns Open Folder; the session bus syncs this panel */
        <div className={styles.drawerBody}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
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
              <FolderOpen size={13} />
              Open Folder
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Scrollable Body */}
          <div className={styles.drawerBody}>
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
                        onClick={() => sessionRootPath && void deleteCorrectionEntry(sessionRootPath, corr.id)}
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
          <div className={styles.drawerFooter}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
              {isResyncing || isLoading ? 'Analyzing workspace stack...' : 'Context auto-syncs on changes'}
            </span>
            <button
              type="button"
              className={styles.resyncBtn}
              onClick={() => void resyncWorkspace(sessionRootPath ?? undefined)}
              disabled={isResyncing || isLoading}
              title="Rescan repository manifests and refresh Context Score"
            >
              <RefreshCw size={11} className={isResyncing || isLoading ? styles.spin : ''} />
              <span>{isResyncing ? 'Resyncing...' : 'Resync Workspace'}</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
};
