/**
 * Ty-Code Desktop IDE - Extension Bisect Modal
 * Real half-splitting debug session: the main-process service disables half of the
 * suspect extensions each round; the user reports whether the issue persists until
 * the culprit is identified. Mirrors VS Code's "Start Extension Bisect".
 */

import React, { useEffect } from 'react';
import { X, GitCompareArrows, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useExtensionStore } from '../../state/extensions-store';
import { toast } from '../../state/toast-store';
import './extensions.css';

export const ExtensionBisectModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const bisectState = useExtensionStore((s) => s.bisectState);
  const installed = useExtensionStore((s) => s.installed);
  const startBisect = useExtensionStore((s) => s.startBisect);
  const reportBisectRound = useExtensionStore((s) => s.reportBisectRound);
  const stopBisect = useExtensionStore((s) => s.stopBisect);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const nameFor = (id: string) =>
    installed.find((i) => i.id === id)?.manifest.displayName || id;

  const handleStart = async () => {
    const state = await startBisect();
    if (state) {
      toast.info(
        'Extension bisect started',
        `${state.suspects.length} extensions are being tested. ${state.disabledThisRound.length} disabled this round.`
      );
    }
  };

  const handleReport = async (issuePresent: boolean) => {
    const state = await reportBisectRound(issuePresent);
    if (state?.identified) {
      toast.success(
        'Likely culprit found',
        `"${nameFor(state.identified)}" is the most probable cause after ${state.round} round(s).`
      );
    }
  };

  const handleStop = async (restore: boolean) => {
    await stopBisect(restore);
    onClose();
  };

  const idle = !bisectState || (!bisectState.active && !bisectState.identified);

  return (
    <div className="extension-modal-overlay" onClick={onClose}>
      <div
        className="extension-modal-panel narrow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Extension Bisect"
        data-testid="extension-bisect-modal"
      >
        <div className="extension-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitCompareArrows size={15} color="var(--accent-primary)" />
            <span>Extension Bisect</span>
            {bisectState?.active && (
              <span className="extension-modal-count">Round {bisectState.round}</span>
            )}
          </div>
          <button type="button" className="extension-header-btn" onClick={onClose} title="Close" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="extension-modal-body">
          {idle && (
            <div className="extension-bisect-intro">
              <p>
                Extension bisect helps find a problematic extension by enabling/disabling
                installed extensions in a binary-search style session. You will be asked after
                each restart-free round whether the issue still exists.
              </p>
              <button type="button" className="extension-btn-install" onClick={() => void handleStart()} data-testid="bisect-start">
                <GitCompareArrows size={13} />
                <span>Start Bisect Session</span>
              </button>
            </div>
          )}

          {bisectState?.active && (
            <>
              <div className="extension-bisect-progress">
                <div className="extension-bisect-stat">
                  <strong>{bisectState.candidates.length}</strong>
                  <span>candidates remaining</span>
                </div>
                <div className="extension-bisect-stat">
                  <strong>{bisectState.disabledThisRound.length}</strong>
                  <span>disabled this round</span>
                </div>
                <div className="extension-bisect-stat">
                  <strong>{bisectState.round}</strong>
                  <span>round</span>
                </div>
              </div>

              <p className="extension-bisect-question">
                Reload your workspace state and check the problem you are debugging.
                Does the issue still occur with these extensions disabled?
              </p>

              <div className="extension-bisect-disabled-list">
                {bisectState.disabledThisRound.map((id) => (
                  <span key={id} className="extension-bisect-chip">{nameFor(id)}</span>
                ))}
              </div>

              <div className="extension-bisect-actions">
                <button
                  type="button"
                  className="extension-btn-install"
                  onClick={() => void handleReport(true)}
                  data-testid="bisect-still-present"
                >
                  <AlertTriangle size={13} />
                  <span>Issue is present</span>
                </button>
                <button
                  type="button"
                  className="extension-btn-secondary"
                  onClick={() => void handleReport(false)}
                  data-testid="bisect-gone"
                >
                  <CheckCircle2 size={13} />
                  <span>Issue is gone</span>
                </button>
              </div>
            </>
          )}

          {bisectState && !bisectState.active && bisectState.identified && (
            <div className="extension-bisect-result" data-testid="bisect-result">
              <CheckCircle2 size={22} color="var(--accent-green)" />
              <div>
                <div className="extension-bisect-result-title">
                  Likely culprit: {nameFor(bisectState.identified)}
                </div>
                <div className="extension-bisect-result-sub">
                  Identified after {bisectState.round} round(s) out of {bisectState.suspects.length} suspects.
                  Keep it disabled or uninstall it to confirm.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="extension-modal-footer">
          <button type="button" className="extension-btn-secondary" onClick={() => void handleStop(true)}>
            Stop &amp; Restore
          </button>
          <button type="button" className="extension-btn-ghost" onClick={onClose}>
            Keep Session
          </button>
        </div>
      </div>
    </div>
  );
};
