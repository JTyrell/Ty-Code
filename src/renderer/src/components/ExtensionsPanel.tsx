/**
 * Ty-Code Desktop IDE - Extensions Sidecar View Panel
 * Integrates Installed and Marketplace tabs with ExtensionList and ExtensionCard.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Boxes,
  Search,
  RefreshCw,
  FolderOpen,
  AlertCircle,
  ArrowUpCircle,
  Layers,
  Package
} from 'lucide-react';
import type { InstalledExtension } from '../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../shared/types/marketplace';
import { useExtensionStore } from '../state/extension-store';
import { toast } from '../state/toast-store';
import { ExtensionDetail } from './ExtensionDetail';
import { ExtensionSettings } from './ExtensionSettings';
import { ExtensionList } from './extensions/ExtensionList';
import { ExtensionWidthSimulator } from './extensions/ExtensionWidthSimulator';
import { ExtensionTracePanel } from './extensions/ExtensionTracePanel';
import { ExtensionControlsMenu } from './extensions/ExtensionControlsMenu';
import { RunningExtensionsModal } from './extensions/RunningExtensionsModal';
import { ExtensionBisectModal } from './extensions/ExtensionBisectModal';

/**
 * Formats SemVer version comparison to detect available updates.
 */
export function isVersionNewer(registryVer?: string, installedVer?: string): boolean {
  if (!registryVer || !installedVer) return false;
  const regParts = registryVer.split('.').map((p) => parseInt(p, 10) || 0);
  const instParts = installedVer.split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(regParts.length, instParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = regParts[i] || 0;
    const inst = instParts[i] || 0;
    if (r > inst) return true;
    if (r < inst) return false;
  }
  return false;
}

export const ExtensionsPanel: React.FC = () => {
  // Zustand selector audit: subscribe to narrow slices only
  const installed = useExtensionStore((s) => s.installed);
  const marketplace = useExtensionStore((s) => s.marketplace);
  const activeTab = useExtensionStore((s) => s.activeTab);
  const selectedCategory = useExtensionStore((s) => s.selectedCategory);
  const query = useExtensionStore((s) => s.query);
  const sortBy = useExtensionStore((s) => s.sortBy);
  const isLoading = useExtensionStore((s) => s.isLoading);
  const isMarketplaceLoading = useExtensionStore((s) => s.isMarketplaceLoading);
  const isOfflineCache = useExtensionStore((s) => s.isOfflineCache);
  const offlineMessage = useExtensionStore((s) => s.offlineMessage);
  const rateLimited = useExtensionStore((s) => s.rateLimited);
  const retryAfterSec = useExtensionStore((s) => s.retryAfterSec);
  const installingMap = useExtensionStore((s) => s.installingMap);
  const errorMap = useExtensionStore((s) => s.errorMap);
  const error = useExtensionStore((s) => s.error);
  const activeDetail = useExtensionStore((s) => s.activeDetail);
  const activeSettings = useExtensionStore((s) => s.activeSettings);
  const setActiveTab = useExtensionStore((s) => s.setActiveTab);
  const setSelectedCategory = useExtensionStore((s) => s.setSelectedCategory);
  const setQuery = useExtensionStore((s) => s.setQuery);
  const setSortBy = useExtensionStore((s) => s.setSortBy);
  const setActiveDetail = useExtensionStore((s) => s.setActiveDetail);
  const setActiveSettings = useExtensionStore((s) => s.setActiveSettings);
  const loadInstalled = useExtensionStore((s) => s.loadInstalled);
  const searchMarketplace = useExtensionStore((s) => s.searchMarketplace);
  const installExtension = useExtensionStore((s) => s.installExtension);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const installFromVsix = useExtensionStore((s) => s.installFromVsix);
  const retryInstall = useExtensionStore((s) => s.retryInstall);
  const retrySearch = useExtensionStore((s) => s.retrySearch);
  const updatesAvailable = useExtensionStore((s) => s.updatesAvailable);
  const isCheckingUpdates = useExtensionStore((s) => s.isCheckingUpdates);
  const autoUpdateEnabled = useExtensionStore((s) => s.autoUpdateEnabled);
  const bisectState = useExtensionStore((s) => s.bisectState);
  const pendingVsixProgress = useExtensionStore((s) => s.pendingVsixProgress);
  const checkForUpdates = useExtensionStore((s) => s.checkForUpdates);
  const updateExtensionNow = useExtensionStore((s) => s.updateExtensionNow);
  const applyAllUpdates = useExtensionStore((s) => s.applyAllUpdates);
  const toggleAllExtensions = useExtensionStore((s) => s.toggleAllExtensions);
  const setAutoUpdate = useExtensionStore((s) => s.setAutoUpdate);
  const loadAutoUpdatePreference = useExtensionStore((s) => s.loadAutoUpdatePreference);

  const [showSimulator, setShowSimulator] = useState(false);
  const [showTracer, setShowTracer] = useState(false);
  const [showRunning, setShowRunning] = useState(false);
  const [showBisect, setShowBisect] = useState(false);

  useEffect(() => {
    void loadInstalled();
    void searchMarketplace('popular');
    void loadAutoUpdatePreference();
  }, [loadInstalled, searchMarketplace, loadAutoUpdatePreference]);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    const timer = window.setTimeout(() => {
      if (query.trim().length >= 1) {
        void searchMarketplace(query);
      } else {
        void searchMarketplace('popular');
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      useExtensionStore.getState().cancelMarketplaceSearch();
    };
  }, [activeTab, query, searchMarketplace]);

  // Combine authoritative registry checks ("Check for Extension Updates") with
  // newer versions visible on the currently loaded marketplace page.
  const updatesMap = useMemo(() => {
    const map: Record<string, { id: string; displayName: string; installedVersion: string; latestVersion: string }> = {};
    for (const u of updatesAvailable) {
      map[u.id] = u;
    }
    for (const inst of installed) {
      if (inst.isBuiltIn || map[inst.id]) continue;
      const match = marketplace.find((m) => m.id === inst.id);
      if (match && isVersionNewer(match.version, inst.manifest.version)) {
        map[inst.id] = {
          id: inst.id,
          displayName: inst.manifest.displayName || match.displayName,
          installedVersion: inst.manifest.version,
          latestVersion: match.version
        };
      }
    }
    return map;
  }, [installed, marketplace, updatesAvailable]);

  const updatesAvailableCount = Object.keys(updatesMap).length;

  const handleCheckUpdates = useCallback(async () => {
    const updates = await checkForUpdates();
    if (updates.length > 0) {
      toast.info(`${updates.length} extension update(s) available`, updates.map((u) => `${u.displayName} → v${u.latestVersion}`).join(', '));
    } else {
      toast.success('Extensions are up to date', 'Checked every installed community extension against Open VSX.');
    }
  }, [checkForUpdates]);

  // Startup auto-update: one registry pass per session; honors the persisted preference.
  const startupCheckedRef = useRef(false);
  useEffect(() => {
    if (isLoading || startupCheckedRef.current) return;
    const hasUserExtensions = installed.some((i) => !i.isBuiltIn);
    if (!hasUserExtensions) return;
    startupCheckedRef.current = true;
    // Deliberately not cancelled on dep changes: the check must run once per session.
    window.setTimeout(() => {
      void (async () => {
        const updates = await checkForUpdates();
        if (updates.length === 0) return;
        if (useExtensionStore.getState().autoUpdateEnabled) {
          toast.info(`Auto-updating ${updates.length} extension(s)…`, 'Auto update is enabled for all extensions.');
          const applied = await applyAllUpdates();
          if (applied > 0) toast.success(`${applied} extension(s) updated`);
        } else {
          toast.info(`${updates.length} extension update(s) available`, undefined, {
            label: 'Update All',
            onClick: () => { void applyAllUpdates(); }
          });
        }
      })();
    }, 4000);
  }, [isLoading, installed, checkForUpdates, applyAllUpdates]);

  const handleApplyAllUpdates = useCallback(async () => {
    const applied = await applyAllUpdates();
    if (applied > 0) {
      toast.success(`${applied} extension(s) updated`);
      void loadInstalled();
    }
  }, [applyAllUpdates, loadInstalled]);

  const handleUpdateOne = useCallback(async (id: string) => {
    const ok = await updateExtensionNow(id);
    if (ok) toast.success(`${updatesMap[id]?.displayName || id} updated`);
    else toast.error('Extension update failed', `Could not update ${id}. Open the trace panel for details.`);
  }, [updateExtensionNow, updatesMap]);

  const handleToggleAutoUpdate = useCallback(async () => {
    const next = !autoUpdateEnabled;
    const ok = await setAutoUpdate(next);
    if (ok) {
      toast.info(next ? 'Auto update enabled for all extensions' : 'Auto update disabled for all extensions');
    }
  }, [autoUpdateEnabled, setAutoUpdate]);

  const handleBulkToggle = useCallback(async (enabled: boolean) => {
    const result = await toggleAllExtensions(enabled);
    if (!result) return;
    const label = enabled ? 'Enabled' : 'Disabled';
    const suffix = result.skippedMetadataOnly.length > 0
      ? ` (${result.skippedMetadataOnly.length} skipped: awaiting runtime security review)`
      : '';
    toast.info(`${label} ${result.changed} extension(s)${suffix}`);
  }, [toggleAllExtensions]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void searchMarketplace(query);
  };

  const categories = ['All', 'Languages', 'Tools', 'AI', 'Linters', 'Git & SCM', 'Themes'];

  // Memoize derived list of filtered extensions to stop re-render storms
  const filteredInstalled = useMemo(() => {
    return installed.filter((ext) => {
      const matchesQuery =
        !query ||
        ext.manifest.name.toLowerCase().includes(query.toLowerCase()) ||
        (ext.manifest.displayName && ext.manifest.displayName.toLowerCase().includes(query.toLowerCase())) ||
        (ext.manifest.description && ext.manifest.description.toLowerCase().includes(query.toLowerCase()));

      const matchesCategory =
        selectedCategory === 'All' ||
        (ext.manifest.categories && ext.manifest.categories.includes(selectedCategory));

      return matchesQuery && matchesCategory;
    });
  }, [installed, query, selectedCategory]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Top Header */}
      <div
        style={{
          height: '35px',
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Boxes size={14} color="var(--accent-primary)" />
          <span>Extensions</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={() => void installFromVsix()}
            className="extension-header-btn"
            disabled={Boolean(pendingVsixProgress)}
            title="Install from VSIX…"
            aria-label="Install from VSIX"
            data-testid="install-vsix-button"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={() => {
              void loadInstalled();
              void searchMarketplace(query || 'popular');
            }}
            className="extension-header-btn"
            title="Refresh Extensions"
            aria-label="Refresh Extensions"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <ExtensionControlsMenu
            updatesCount={updatesAvailableCount}
            isCheckingUpdates={isCheckingUpdates}
            autoUpdateEnabled={autoUpdateEnabled}
            bisectActive={Boolean(bisectState?.active)}
            showSimulator={showSimulator}
            showTracer={showTracer}
            vsixProgress={pendingVsixProgress}
            onInstallFromVsix={() => { void installFromVsix(); }}
            onCheckUpdates={() => { void handleCheckUpdates(); }}
            onToggleAutoUpdate={() => { void handleToggleAutoUpdate(); }}
            onEnableAll={() => { void handleBulkToggle(true); }}
            onDisableAll={() => { void handleBulkToggle(false); }}
            onShowRunning={() => setShowRunning(true)}
            onBisect={() => setShowBisect(true)}
            onToggleSimulator={() => setShowSimulator((s) => !s)}
            onToggleTracer={() => setShowTracer((s) => !s)}
          />
        </div>
      </div>

      {showSimulator ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ExtensionWidthSimulator onClose={() => setShowSimulator(false)} />
        </div>
      ) : (
        <>
          {/* Tabs: Installed vs Marketplace */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-tertiary)'
            }}
          >
        <button
          onClick={() => setActiveTab('installed')}
          style={{
            flex: 1,
            padding: '7px 0',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            color: activeTab === 'installed' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'installed' ? '2px solid var(--accent-primary)' : '2px solid transparent'
          }}
        >
          <Layers size={12} />
          <span>Installed ({installed.length})</span>
          {updatesAvailableCount > 0 && (
            <span
              data-testid="updates-available-badge"
              style={{
                fontSize: '10px',
                fontWeight: 700,
                backgroundColor: 'var(--accent-primary)',
                color: '#ffffff',
                padding: '1px 5px',
                borderRadius: '10px',
                lineHeight: 1.2
              }}
              title={`${updatesAvailableCount} update(s) available`}
            >
              {updatesAvailableCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('marketplace')}
          style={{
            flex: 1,
            padding: '7px 0',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            color: activeTab === 'marketplace' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'marketplace' ? '2px solid var(--accent-primary)' : '2px solid transparent'
          }}
        >
          <Package size={12} />
          <span>Marketplace</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <form onSubmit={handleSearchSubmit} style={{ position: 'relative' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeTab === 'installed' ? 'Filter installed extensions…' : 'Search extension registry…'}
            style={{
              width: '100%',
              fontSize: '11px',
              paddingLeft: '28px',
              height: '28px',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              outline: 'none'
            }}
          />
          <Search size={13} style={{ position: 'absolute', left: '8px', top: '8px', color: 'var(--text-muted)' }} />
        </form>

        {/* Category Filter Pills */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginTop: '6px', paddingBottom: '2px' }}>
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  if (activeTab === 'marketplace') {
                    void searchMarketplace(cat === 'All' ? 'popular' : cat);
                  }
                }}
                style={{
                  fontSize: '10px',
                  padding: '2px 7px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                  backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)'
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Result Count and Sort By Selector */}
        <div
          data-testid="extension-results-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '6px',
            padding: '0 2px',
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}
        >
          <span data-testid="extension-result-count">
            {activeTab === 'marketplace'
              ? `${marketplace.length} result${marketplace.length === 1 ? '' : 's'}`
              : `${filteredInstalled.length} installed`}
          </span>

          {activeTab === 'marketplace' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>Sort by:</span>
              <select
                data-testid="extension-sort-selector"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'relevance' | 'downloadCount' | 'rating')}
                style={{
                  fontSize: '11px',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '3px',
                  padding: '1px 4px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
                aria-label="Sort extensions"
              >
                <option value="relevance">Relevance</option>
                <option value="downloadCount">Downloads</option>
                <option value="rating">Rating</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Live "Install from VSIX" progress */}
      {pendingVsixProgress && (
        <div
          data-testid="vsix-progress-banner"
          className="extension-banner purple"
        >
          <RefreshCw size={14} className="animate-spin" />
          <span>{pendingVsixProgress.message}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{pendingVsixProgress.percent}%</span>
        </div>
      )}

      {/* One-click "Update All" when registry updates are pending */}
      {updatesAvailableCount > 0 && !pendingVsixProgress && (
        <div
          data-testid="updates-available-banner"
          className="extension-banner purple"
        >
          <ArrowUpCircle size={14} />
          <span>{updatesAvailableCount} update(s) available</span>
          <button
            type="button"
            onClick={() => { void handleApplyAllUpdates(); }}
            style={{
              marginLeft: 'auto',
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '3px',
              backgroundColor: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Update All
          </button>
        </div>
      )}

      {/* Active bisect session reminder */}
      {bisectState?.active && (
        <div
          data-testid="bisect-active-banner"
          className="extension-banner amber"
          onClick={() => setShowBisect(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setShowBisect(true)}
          style={{ cursor: 'pointer' }}
        >
          <AlertCircle size={14} />
          <span>Extension bisect running — round {bisectState.round}, {bisectState.candidates.length} candidates left. Click to continue.</span>
        </div>
      )}

      {/* Rate Limited Banner */}
      {rateLimited && (
        <div
          data-testid="rate-limited-banner"
          style={{
            margin: '8px 10px 0 10px',
            padding: '6px 10px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '4px',
            color: 'var(--accent-red)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <AlertCircle size={14} />
          <span>Registry rate limited, retry in {retryAfterSec}s</span>
        </div>
      )}

      {/* Offline Cached Results Banner */}
      {isOfflineCache && (
        <div
          data-testid="offline-cached-banner"
          style={{
            margin: '8px 10px 0 10px',
            padding: '6px 10px',
            backgroundColor: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: '4px',
            color: 'var(--accent-amber)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} />
            <span>{offlineMessage || 'offline — cached results'}</span>
          </div>
          <button
            type="button"
            onClick={() => void retrySearch()}
            style={{
              fontSize: '10px',
              padding: '2px 7px',
              borderRadius: '3px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Extension List */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'installed' ? (
          <ExtensionList
            items={filteredInstalled}
            installed={installed}
            updatesMap={updatesMap}
            onSelect={setActiveDetail}
            onToggle={toggleExtension}
            onConfigure={setActiveSettings}
            onUpdate={(id) => { void handleUpdateOne(id); }}
            onClearSearch={() => setQuery('')}
          />
        ) : (
          <ExtensionList
            items={marketplace}
            installed={installed}
            isLoading={isMarketplaceLoading}
            error={error}
            isOfflineCache={isOfflineCache}
            offlineMessage={offlineMessage}
            installingMap={installingMap}
            errorMap={errorMap}
            onSelect={setActiveDetail}
            onInstall={(item) => { void installExtension(item); }}
            onUninstall={(id) => { void uninstallExtension(id); }}
            onToggle={toggleExtension}
            onConfigure={setActiveSettings}
            onRetryInstall={retryInstall}
            onRetrySearch={retrySearch}
            onClearSearch={() => setQuery('')}
          />
        )}
      </div>
    </>
  )}

      {/* Extension Detail Modal */}
      {activeDetail && (
        <ExtensionDetail
          item={activeDetail}
          onClose={() => setActiveDetail(null)}
        />
      )}

      {/* Extension Settings Modal */}
      {activeSettings && (
        <ExtensionSettings
          extension={activeSettings}
          onClose={() => setActiveSettings(null)}
        />
      )}

      {/* Extension Installation Pipeline Trace Modal */}
      <ExtensionTracePanel
        isOpen={showTracer}
        onClose={() => setShowTracer(false)}
      />

      {/* Running Extensions (live runtime host states) */}
      {showRunning && <RunningExtensionsModal onClose={() => setShowRunning(false)} />}

      {/* Extension Bisect session */}
      {showBisect && <ExtensionBisectModal onClose={() => setShowBisect(false)} />}
    </div>
  );
};
