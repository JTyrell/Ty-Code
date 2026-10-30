/**
 * Ty-Code Desktop IDE - Redesigned StatusBar
 * Clean, hierarchical 24px single-row footer with responsive telemetry,
 * overflow collapse, and zero layout shift.
 */

import React, { useEffect } from 'react';
import {
  Folder,
  GitBranch,
  RefreshCw,
  Activity,
  Bell,
  Sparkles,
  Zap
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useGitStore } from '../state/git-store';
import { useLspStore } from '../state/lsp-store';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import { useOnboardingStore } from '../state/onboarding-store';
import { toast } from '../state/toast-store';
import { FleetHealthIndicator } from './FleetHealthIndicator';
import { WarmUpIndicator } from './WarmUpIndicator';
import { TelemetryBadge } from './status/TelemetryBadge';
import { OverflowMenu } from './status/OverflowMenu';
import { ContextBadge } from './status-bar/ContextBadge';
import { useAvailableWidth } from '../hooks/useAvailableWidth';
import styles from './StatusBar.module.css';

export const StatusBar: React.FC = () => {
  const { ref: containerRef, width: availableWidth } = useAvailableWidth<HTMLElement>();

  // Narrow store selectors
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);

  const isRunning = useChatStore((s) => s.isRunning);
  const currentStatus = useChatStore((s) => s.currentStatus);
  const openSettings = useChatStore((s) => s.openSettings);

  const status = useGitStore((s) => s.status);
  const isSyncing = useGitStore((s) => s.isSyncing);
  const syncRepo = useGitStore((s) => s.syncRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);

  const diagnostics = useLspStore((s) => s.diagnostics);
  const refreshServers = useLspStore((s) => s.refreshServers);

  const recentEdits = useWorkspaceEditStore((s) => s.recentEdits);
  const refreshRecentEdits = useWorkspaceEditStore((s) => s.refreshRecentEdits);

  const refreshQuota = useUsageDashboardStore((s) => s.refreshStats);

  const connectedProviders = useOnboardingStore((s) => s.connectedProviders);
  const discoveredFreeModelsCount = useOnboardingStore((s) => s.discoveredFreeModelsCount);
  const isCompleted = useOnboardingStore((s) => s.isCompleted);
  const shouldShowReminder = useOnboardingStore((s) => s.shouldShowReminder);
  const dismissReminder = useOnboardingStore((s) => s.dismissReminder);

  useEffect(() => {
    if (shouldShowReminder()) {
      toast.info('💡 Connect your free provider accounts for 15+ models and higher limits.');
      dismissReminder(false);
    }
  }, [shouldShowReminder, dismissReminder]);

  // Real model count from onboarding discovery (set during catalog load),
  // never a hardcoded per-provider lookup. Falls back to provider count when
  // no real discovery data exists so we never surface a fabricated total.
  const totalModels = (isCompleted && discoveredFreeModelsCount > 0)
    ? discoveredFreeModelsCount
    : connectedProviders.length;

  // Derived calculations
  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const folderName = workspacePath ? workspacePath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace' : 'Workspace';
  const branchName = status?.isRepo ? status.currentBranch : 'No Git';
  const hasAheadBehind = Boolean((status?.ahead || 0) > 0 || (status?.behind || 0) > 0);

  const diagnosticsList = Object.values(diagnostics).flatMap((d) => d.diagnostics);
  const errors = diagnosticsList.filter((item) => item.severity === 1).length;
  const warnings = diagnosticsList.filter((item) => item.severity === 2).length;
  const totalAlerts = errors + warnings;

  // Periodic safety syncs
  useEffect(() => {
    void refreshServers();
    void refreshRecentEdits();
    void refreshQuota();
    const timer = window.setInterval(() => {
      void refreshServers();
      void refreshRecentEdits();
      void refreshQuota();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshServers, refreshRecentEdits, refreshQuota]);

  // Transient message detection
  const transientMessage = (() => {
    if (isRunning) {
      return {
        icon: <Activity size={11} className={styles.spin} color="var(--accent-primary)" />,
        text: currentStatus || 'Agent working...'
      };
    }
    if (activeTab?.isDirty) {
      return {
        text: 'Unsaved changes'
      };
    }
    const autoApplied = recentEdits.filter((e) => e.autoApplied);
    if (autoApplied.length > 0) {
      return {
        text: `${autoApplied.length} edit${autoApplied.length > 1 ? 's' : ''} auto-applied`
      };
    }
    return null;
  })();

  return (
    <footer
      ref={containerRef}
      id="status-bar-container"
      className={styles.statusBar}
      role="contentinfo"
      aria-label="Application Status Bar"
      data-available-width={availableWidth}
    >
      {/* ================================================================= */}
      {/* 1. LEFT ZONE: ["workspace name", "git branch + sync state"]        */}
      {/* ================================================================= */}
      <div className={styles.leftZone} data-zone="left">
        <button
          type="button"
          id="status-bar-workspace-btn"
          className={styles.statusBtn}
          title={`Workspace: ${workspacePath || folderName}`}
          aria-label={`Workspace ${folderName}`}
        >
          <Folder size={11} color="var(--accent-primary)" />
          <span style={{ fontWeight: 500 }}>{folderName}</span>
        </button>

        <button
          type="button"
          id="status-bar-git-btn"
          className={styles.statusBtn}
          onClick={() => void (status?.isRepo ? syncRepo() : refreshStatus())}
          title={status?.isRepo ? `Git Branch: ${branchName} (Click to sync remote)` : 'Click to check Git status'}
          aria-label={`Git branch ${branchName}${hasAheadBehind ? `, ahead ${status?.ahead || 0}, behind ${status?.behind || 0}` : ''}`}
        >
          <GitBranch size={12} color="var(--accent-primary)" />
          <span>{branchName}</span>
          {hasAheadBehind && (
            <span style={{ color: 'var(--text-muted)' }}>
              {status?.behind ? `↓${status.behind}` : ''}
              {status?.ahead ? `↑${status.ahead}` : ''}
            </span>
          )}
          {isSyncing && <RefreshCw size={10} className={styles.spin} />}
        </button>

        <ContextBadge />
      </div>

      {/* 1px divider between left and center */}
      <span className={styles.divider} aria-hidden="true" />

      {/* ================================================================= */}
      {/* 2. CENTER ZONE: Transient status messages only - empty otherwise  */}
      {/* ================================================================= */}
      <div className={styles.centerZone} data-zone="center">
        {transientMessage && (
          <div className={styles.transientMsg} role="status" aria-live="polite">
            {transientMessage.icon}
            <span>{transientMessage.text}</span>
          </div>
        )}
      </div>

      {/* 1px divider between center and right */}
      <span className={styles.divider} aria-hidden="true" />

      {/* ================================================================= */}
      {/* 3. RIGHT ZONE: health, telemetry, notifications, model control   */}
      {/* ================================================================= */}
      <div className={styles.rightZone} data-zone="right">
        {/* 3.1 Health dot + Progressive Warm-up indicator */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <FleetHealthIndicator />
          <WarmUpIndicator />
        </div>

        {/* 3.15 Provider Access Tier Chip */}
        <button
          type="button"
          id="status-bar-provider-chip"
          className={styles.statusBtn}
          onClick={() => {
            const isAnon = useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true';
            if (isAnon || connectedProviders.length === 0) {
              useOnboardingStore.getState().openWizard('welcome');
            } else {
              openSettings('providers');
            }
          }}
          title={
            (useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0)
              ? 'Anonymous tier active (~50 req/h). Click to enable full free supply (61 providers, 1.3B+ free tokens/month).'
              : `Connected: ${connectedProviders.join(', ')}${(isCompleted && discoveredFreeModelsCount > 0) ? ` (${totalModels} models)` : ''}. Click to open Settings > Providers.`
          }
          style={{
            color: (useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0) ? '#38bdf8' : '#34d399',
            background: (useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0) ? 'rgba(56, 189, 248, 0.08)' : 'rgba(16, 185, 129, 0.08)',
            border: `1px solid ${(useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0) ? 'rgba(56, 189, 248, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
            padding: '0 6px',
            borderRadius: '4px'
          }}
          aria-label={
            (useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0)
              ? 'Anonymous tier active — Enable full free supply'
              : `${connectedProviders.length} providers${(isCompleted && discoveredFreeModelsCount > 0) ? `, ${totalModels} models` : ''} connected`
          }
        >
          {(useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0) ? (
            <Zap size={11} color="#38bdf8" />
          ) : (
            <Sparkles size={11} color="#34d399" />
          )}
          <span>
            {(useOnboardingStore.getState().isSkipped || localStorage.getItem('ty_code_anonymous_tier_active') === 'true' || connectedProviders.length === 0)
              ? 'Enable full free supply'
              : `${connectedProviders.length} provider${connectedProviders.length > 1 ? 's' : ''}${(isCompleted && discoveredFreeModelsCount > 0) ? ` • ${totalModels} models` : ''}`}
          </span>
        </button>

        {/* 3.2 Telemetry token counter (responsive) */}
        <TelemetryBadge availableWidth={availableWidth} />

        {/* 3.4 Notifications bell */}
        <button
          type="button"
          id="status-bar-notifications-btn"
          className={styles.bellBtn}
          onClick={() => openSettings('diagnostics')}
          title={
            totalAlerts > 0
              ? `${errors} errors, ${warnings} warnings. Click to open Diagnostics.`
              : 'Notifications: All systems operational. Click to open Diagnostics.'
          }
          aria-label={`Notifications, ${errors} errors, ${warnings} warnings`}
        >
          <Bell size={12} />
          {totalAlerts > 0 && (
            <span
              className={`${styles.bellBadge} ${errors > 0 ? styles.bellBadgeError : ''}`}
              aria-hidden="true"
            />
          )}
        </button>

        {/* 3.5 Overflow '…' menu */}
        <OverflowMenu isTelemetryCollapsed={availableWidth < 240} />
      </div>
    </footer>
  );
};
