/**
 * Ty-Code Context Engine: ContextBadge (Prompt 3)
 *
 * Displays "🧠 Context: 85%" in the bottom status bar. Clicking toggles the
 * Context Engine drawer — a dockable bottom drawer of the center column
 * (ContextEngineDrawer.tsx) that participates in the layout split instead of
 * floating over it, so it can never be trapped by the status bar's stacking
 * context or render behind the editor split panes.
 *
 * The score is driven by the shared workspace session bus; the badge reads
 * the same session root as the editor/debugger/canvas session strips.
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import React, { useEffect } from 'react';
import { Brain } from 'lucide-react';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import { useContextAuditStore } from '../../state/context-audit-store';
import { getScoreColor } from './ContextEngineDrawer';
import styles from './ContextBadge.module.css';

export interface ContextBadgeProps {
  className?: string;
}

export const ContextBadge: React.FC<ContextBadgeProps> = ({ className }) => {
  const { attachSurface, detachSurface } = useWorkspaceSessionStore();

  useEffect(() => {
    attachSurface('context');
    return () => detachSurface('context');
  }, [attachSurface, detachSurface]);

  const isOpen = useContextAuditStore((s) => s.isOpen);
  const scoreResult = useContextAuditStore((s) => s.scoreResult);
  const toggleAuditPanel = useContextAuditStore((s) => s.toggleAuditPanel);

  // Single source of truth: the shared workspace session bus.
  const sessionRootPath = useWorkspaceSessionStore((s) => s.session.rootPath);
  const hasWorkspace = Boolean(sessionRootPath);

  const score = hasWorkspace && scoreResult ? scoreResult.score : null;
  const grade = hasWorkspace && scoreResult ? scoreResult.grade : null;
  const scoreColor = hasWorkspace && scoreResult && score !== null ? getScoreColor(score) : 'var(--text-muted)';

  return (
    <button
      type="button"
      id="status-bar-context-badge-btn"
      className={`${styles.badgeBtn} ${isOpen ? styles.active : ''} ${className || ''}`}
      onClick={toggleAuditPanel}
      title={hasWorkspace
        ? `Context Audit Score: ${score}% (Grade ${grade}). Click to open Context Engine drawer.`
        : 'Context Audit — No workspace open. Click to enable.'}
      aria-label={hasWorkspace ? `Context Audit Score ${score} percent` : 'Context Audit disabled without workspace'}
      aria-expanded={isOpen}
      aria-controls="context-engine-drawer"
    >
      <Brain size={12} color={scoreColor} />
      <span>{hasWorkspace ? `Context: ${score}%` : 'Context: —'}</span>
      <span
        className={styles.scoreDot}
        style={{ backgroundColor: scoreColor }}
        aria-hidden="true"
      />
    </button>
  );
};
