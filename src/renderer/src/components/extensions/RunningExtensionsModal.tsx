/**
 * Ty-Code Desktop IDE - Running Extensions Modal
 * Live runtime snapshot of extension activation state (VS Code "Show Running Extensions" parity).
 * Backed by extensionHost.getRunningExtensions() - real worker states, timings, and errors.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, RefreshCw, Activity, AlertCircle, Zap } from 'lucide-react';
import type { RunningExtensionInfo } from '../../../../shared/types/marketplace';
import { useExtensionStore } from '../../state/extensions-store';
import { LogoWithFallback } from './LogoWithFallback';
import './extensions.css';

const STATE_TONES: Record<RunningExtensionInfo['state'], { label: string; tone: string }> = {
  activated: { label: 'Activated', tone: 'green' },
  activating: { label: 'Activating', tone: 'amber' },
  unactivated: { label: 'Not activated yet', tone: 'muted' },
  deactivated: { label: 'Deactivated', tone: 'muted' },
  failed: { label: 'Activation failed', tone: 'red' }
};

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString();
}

export const RunningExtensionsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const runningExtensions = useExtensionStore((s) => s.runningExtensions);
  const loadRunningExtensions = useExtensionStore((s) => s.loadRunningExtensions);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadRunningExtensions();
  }, [loadRunningExtensions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const activated = useMemo(() => runningExtensions.filter((r) => r.state === 'activated'), [runningExtensions]);
  const failed = useMemo(() => runningExtensions.filter((r) => r.state === 'failed'), [runningExtensions]);
  const totalActivationMs = useMemo(
    () => activated.reduce((sum, r) => sum + (r.activationDurationMs || 0), 0),
    [activated]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRunningExtensions();
    setRefreshing(false);
  };

  return (
    <div className="extension-modal-overlay" onClick={onClose}>
      <div
        className="extension-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Running Extensions"
        data-testid="running-extensions-modal"
      >
        <div className="extension-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={15} color="var(--accent-primary)" />
            <span>Running Extensions</span>
            <span className="extension-modal-count">
              {activated.length} active · {formatDuration(totalActivationMs)} total startup
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="extension-header-btn" onClick={() => void handleRefresh()} title="Refresh runtime state">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button type="button" className="extension-header-btn" onClick={onClose} title="Close" aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="extension-modal-body">
          {failed.length > 0 && (
            <div className="extension-banner red" style={{ margin: '0 0 8px 0' }}>
              <AlertCircle size={14} />
              <span>{failed.length} extension(s) failed to activate. See error details below.</span>
            </div>
          )}

          {runningExtensions.length === 0 && !refreshing && (
            <div className="extension-modal-empty">
              <Zap size={22} />
              <span>No extensions registered with the runtime host yet.</span>
            </div>
          )}

          {runningExtensions.map((ext) => {
            const tone = STATE_TONES[ext.state];
            return (
              <div key={ext.id} className="extension-running-row" data-testid={`running-row-${ext.id}`}>
                <LogoWithFallback id={ext.id} displayName={ext.displayName} size={28} />
                <div className="extension-running-info">
                  <div className="extension-running-name">
                    <span>{ext.displayName}</span>
                    <span className="extension-version-chip">v{ext.version}</span>
                    {ext.isBuiltIn && <span className="extension-builtin-badge">BUILT-IN</span>}
                  </div>
                  <div className="extension-running-sub">
                    <span>{ext.id}</span>
                    <span>·</span>
                    <span title="Activation duration">{formatDuration(ext.activationDurationMs)}</span>
                    <span>·</span>
                    <span title="Activated at">{formatTime(ext.activatedAt)}</span>
                    <span>·</span>
                    <span title="Registered commands">{ext.commandCount} cmd</span>
                  </div>
                  {ext.error && <div className="extension-running-error">{ext.error}</div>}
                </div>
                <span className={`extension-state-chip ${tone.tone}`}>{tone.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
