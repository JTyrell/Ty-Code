/**
 * Ty-Code Desktop IDE - Extensions Sidecar View Panel
 * Integrates Installed and Marketplace tabs with ExtensionList and ExtensionCard.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Boxes,
  Search,
  Download,
  Star,
  Settings,
  RefreshCw,
  FolderOpen,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  Package,
  Layers,
  Sparkles,
  AlertCircle,
  Sliders,
  Activity
} from 'lucide-react';
import type { ExtensionMetadata, InstalledExtension } from '../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../shared/types/marketplace';
import { useExtensionStore } from '../state/extension-store';
import { ExtensionDetail } from './ExtensionDetail';
import { ExtensionSettings } from './ExtensionSettings';
import { ExtensionList } from './extensions/ExtensionList';
import { ExtensionWidthSimulator } from './extensions/ExtensionWidthSimulator';
import { ExtensionTracePanel } from './extensions/ExtensionTracePanel';

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

  const [showSimulator, setShowSimulator] = useState(false);
  const [showTracer, setShowTracer] = useState(false);

  useEffect(() => {
    void loadInstalled();
    void searchMarketplace('popular');
  }, [loadInstalled, searchMarketplace]);

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

  // Determine installed extensions that have newer versions in registry
  const updatesAvailableCount = useMemo(() => {
    return installed.filter((inst) => {
      const match = marketplace.find((m) => m.id === inst.id);
      return match && isVersionNewer(match.version, inst.manifest.version);
    }).length;
  }, [installed, marketplace]);

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => void installFromVsix()}
            disabled
            style={{ padding: '3px 6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'not-allowed' }}
            title="VSIX installation is unavailable until package validation is implemented"
            aria-label="VSIX installation unavailable"
          >
            <FolderOpen size={13} />
          </button>
          <button
            onClick={() => {
              void loadInstalled();
              void searchMarketplace(query || 'popular');
            }}
            style={{ padding: '3px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}
            title="Refresh Extensions"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowSimulator((s) => !s)}
            style={{
              padding: '3px 6px',
              borderRadius: '4px',
              color: showSimulator ? 'var(--accent-primary)' : 'var(--text-secondary)',
              backgroundColor: showSimulator ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
            title="Toggle Container Width Simulator"
            aria-label="Toggle Container Width Simulator"
          >
            <Sliders size={13} />
          </button>
          <button
            onClick={() => setShowTracer(true)}
            style={{
              padding: '3px 6px',
              borderRadius: '4px',
              color: showTracer ? 'var(--accent-primary)' : 'var(--text-secondary)',
              backgroundColor: showTracer ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
            title="Trace Extension Install Pipeline (E1..E9 Live Probe)"
            aria-label="Trace Extension Install Pipeline"
          >
            <Activity size={13} />
          </button>
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
            onSelect={setActiveDetail}
            onToggle={toggleExtension}
            onConfigure={setActiveSettings}
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
    </div>
  );
};
