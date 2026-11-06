/**
 * Ty-Code Desktop IDE - Extension Controls "…" Menu
 * VS Code parity context menu for the Extensions view header:
 * Views ▸, Check for Extension Updates, auto-update toggle, enable/disable all,
 * Show Running Extensions, Start Extension Bisect, and Install from VSIX…
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  EllipsisVertical,
  Eye,
  FolderOpen,
  RefreshCw,
  ToggleRight,
  ToggleLeft,
  ArrowUpCircle,
  GitCompareArrows,
  ChevronRight,
  Activity,
  Sliders
} from 'lucide-react';
import './extensions.css';

export interface ExtensionControlsMenuProps {
  updatesCount: number;
  isCheckingUpdates: boolean;
  autoUpdateEnabled: boolean;
  bisectActive: boolean;
  showSimulator: boolean;
  showTracer: boolean;
  vsixProgress: { percent: number; message: string } | null;
  onInstallFromVsix: () => void;
  onCheckUpdates: () => void;
  onToggleAutoUpdate: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onShowRunning: () => void;
  onBisect: () => void;
  onToggleSimulator: () => void;
  onToggleTracer: () => void;
}

export const ExtensionControlsMenu: React.FC<ExtensionControlsMenuProps> = ({
  updatesCount,
  isCheckingUpdates,
  autoUpdateEnabled,
  bisectActive,
  showSimulator,
  showTracer,
  vsixProgress,
  onInstallFromVsix,
  onCheckUpdates,
  onToggleAutoUpdate,
  onEnableAll,
  onDisableAll,
  onShowRunning,
  onBisect,
  onToggleSimulator,
  onToggleTracer
}) => {
  const [open, setOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setViewsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setViewsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setViewsOpen(false);
  };

  const runAction = (handler: () => void) => () => {
    close();
    handler();
  };

  return (
    <div className="extension-menu-root" ref={rootRef}>
      <button
        type="button"
        className="extension-header-btn"
        onClick={() => setOpen((v) => !v)}
        title="Views and More Actions…"
        aria-label="Extensions actions menu"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="extension-controls-menu-trigger"
      >
        <EllipsisVertical size={14} />
        {updatesCount > 0 && <span className="extension-menu-dot" aria-hidden>{updatesCount}</span>}
      </button>

      {open && (
        <div className="extension-menu-panel" role="menu" data-testid="extension-controls-menu">
          {/* Views submenu (parity with VS Code) */}
          <div
            className="extension-menu-item has-submenu"
            role="menuitem"
            tabIndex={0}
            onMouseEnter={() => setViewsOpen(true)}
            onClick={() => setViewsOpen((v) => !v)}
            onKeyDown={(e) => e.key === 'Enter' && setViewsOpen((v) => !v)}
          >
            <Eye size={14} />
            <span>Views</span>
            <ChevronRight size={12} className="extension-menu-chevron" />
            {viewsOpen && (
              <div className="extension-submenu-panel" role="menu">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showSimulator}
                  className="extension-menu-item"
                  onClick={(e) => { e.stopPropagation(); close(); onToggleSimulator(); }}
                >
                  <Sliders size={14} />
                  <span>Width Simulator</span>
                  {showSimulator && <span className="extension-menu-check">✓</span>}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showTracer}
                  className="extension-menu-item"
                  onClick={(e) => { e.stopPropagation(); close(); onToggleTracer(); }}
                >
                  <Activity size={14} />
                  <span>Install Pipeline Trace</span>
                  {showTracer && <span className="extension-menu-check">✓</span>}
                </button>
              </div>
            )}
          </div>

          <div className="extension-menu-separator" />

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onCheckUpdates)}
            disabled={isCheckingUpdates}
            data-testid="menu-check-updates"
          >
            <RefreshCw size={14} className={isCheckingUpdates ? 'animate-spin' : ''} />
            <span>{isCheckingUpdates ? 'Checking for Updates…' : 'Check for Extension Updates'}</span>
            {!isCheckingUpdates && updatesCount > 0 && <span className="extension-menu-badge">{updatesCount}</span>}
          </button>

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onToggleAutoUpdate)}
            data-testid="menu-toggle-auto-update"
          >
            <ArrowUpCircle size={14} />
            <span>
              {autoUpdateEnabled
                ? 'Disable Auto Update for All Extensions'
                : 'Enable Auto Update for All Extensions'}
            </span>
          </button>

          <div className="extension-menu-separator" />

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onEnableAll)}
            data-testid="menu-enable-all"
          >
            <ToggleRight size={14} />
            <span>Enable All Extensions</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onDisableAll)}
            data-testid="menu-disable-all"
          >
            <ToggleLeft size={14} />
            <span>Disable All Installed Extensions</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onShowRunning)}
            data-testid="menu-show-running"
          >
            <Activity size={14} />
            <span>Show Running Extensions</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onBisect)}
            data-testid="menu-bisect"
          >
            <GitCompareArrows size={14} />
            <span>{bisectActive ? 'Continue Extension Bisect…' : 'Start Extension Bisect…'}</span>
            {bisectActive && <span className="extension-menu-badge live">●</span>}
          </button>

          <div className="extension-menu-separator" />

          <button
            type="button"
            role="menuitem"
            className="extension-menu-item"
            onClick={runAction(onInstallFromVsix)}
            data-testid="menu-install-vsix"
          >
            <FolderOpen size={14} />
            <span>{vsixProgress ? `Installing VSIX… ${vsixProgress.percent}%` : 'Install from VSIX…'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
