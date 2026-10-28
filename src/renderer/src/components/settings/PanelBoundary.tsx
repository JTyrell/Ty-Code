/**
 * PanelBoundary — per-tab error isolation for the Settings modal.
 *
 * ONE boundary seats EACH settings tab panel, so a crash inside any single
 * tab (e.g. the old GovernorPanel "Maximum update depth exceeded") can never
 * take down the whole Settings modal or the other tabs. The top-level
 * boundary in App.tsx remains as last resort only.
 *
 * Boundary instances are keyed per tab and UNMOUNT when the tab is left,
 * so switching tabs "Reloads the panel" naturally; the "Reload panel"
 * button resets the boundary in place for the active tab.
 *
 * Dev crash hook (verification): in dev builds, run
 *   window.__crashSettingsPanel('diagnostics')  → that tab throws on next mount
 *   window.__restoreSettingsPanel()             → clears the injected fault
 *   window.__listCrashingPanel()
 */

import React from 'react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { RefreshCw } from 'lucide-react';
import { trackRenders } from '../../dev/render-storm';

/** Dev-only injected-crash registry (always empty in production). */
const crashingPanel: Set<string> = new Set<string>();

interface PanelGlobals {
  __crashSettingsPanel?: (tabId: string) => void;
  __restoreSettingsPanel?: () => string[];
  __listCrashingPanel?: () => string[];
}

if (import.meta.env.DEV) {
  const w = window as unknown as PanelGlobals;
  w.__crashSettingsPanel = (tabId: string): void => {
    if (import.meta.env.DEV) crashingPanel?.add(tabId);
  };
  w.__restoreSettingsPanel = (): string[] => {
    const removed: string[] = [];
    crashingPanel?.forEach((tabId) => removed.push(tabId));
    crashingPanel?.clear();
    return removed;
  };
  w.__listCrashingPanel = (): string[] => {
    const ids: string[] = [];
    crashingPanel?.forEach((tabId) => ids.push(tabId));
    return ids;
  };
}

/**
 * Dev-only render counter for tab panels. Re-renders in lock-step with the
 * parent subtree, so storm windows reflect real re-render pressure of that
 * panel's seat in the tree.
 */
/**
 * Dev-only fault injection seat: throws from INSIDE the boundary's children
 * tree so PanelBoundary itself catches it (a boundary cannot catch its own
 * throw). Controlled via window.__crashSettingsPanel(tabId).
 */
const DevCrashTrigger: React.FC<{ tabId: string }> = ({ tabId }) => {
  if (import.meta.env.DEV && crashingPanel.has(tabId)) {
    throw new Error(
      `Dev-injected crash in settings tab "${tabId}" (window.__crashSettingsPanel). Use window.__restoreSettingsPanel() to clear.`
    );
  }
  return null;
};

export const RenderStormWatch: React.FC<{ name: string }> = ({ name }) => {
  trackRenders(name);
  return null;
};

export const PanelBoundary: React.FC<{
  tabId: string;
  className?: string;
  children: React.ReactNode;
}> = ({ tabId, className, children }) => {
  return (
    <ErrorBoundary
      className={className}
      fallback={(error, reset) => (
        <div
          role="alert"
          className={`tab-panel-crashed ${className || ''}`}
          style={{
            margin: '8px 0',
            padding: '18px 20px',
            borderRadius: '10px',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.05)',
            color: 'var(--text-primary, #f1f5f9)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            maxWidth: '760px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <RefreshCw size={15} color="#ef4444" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 600 }}>
                "{tabId}" panel crashed
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--text-secondary, #94a3b8)' }}>
                The error is contained to this tab. Other settings tabs are unaffected.
              </p>
            </div>
          </div>

          <div
            style={{
              padding: '8px 10px',
              marginBottom: '12px',
              borderRadius: '6px',
              background: 'var(--bg-tertiary, rgba(0, 0, 0, 0.4))',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '10.5px',
              color: '#fca5a5',
              maxHeight: '80px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {error.message || 'Unknown render exception'}
          </div>

          <button
            type="button"
            onClick={reset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 13px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              backgroundColor: 'var(--accent-primary, #6366f1)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={12} />
            <span>Reload panel</span>
          </button>
        </div>
      )}
    >
      <DevCrashTrigger tabId={tabId} />
      {children}
    </ErrorBoundary>
  );
};
