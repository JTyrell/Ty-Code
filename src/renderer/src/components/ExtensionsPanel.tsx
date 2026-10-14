import React, { useState, useEffect } from 'react';
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
  Sparkles
} from 'lucide-react';
import type { ExtensionMetadata, InstalledExtension } from '../../../preload/types';
import { useExtensionStore } from '../state/extension-store';
import { ExtensionDetail } from './ExtensionDetail';
import { ExtensionSettings } from './ExtensionSettings';

export const ExtensionsPanel: React.FC = () => {
  const {
    installed,
    marketplace,
    activeTab,
    selectedCategory,
    query,
    isLoading,
    activeDetail,
    activeSettings,
    setActiveTab,
    setSelectedCategory,
    setQuery,
    setActiveDetail,
    setActiveSettings,
    loadInstalled,
    searchMarketplace,
    installExtension,
    toggleExtension,
    installFromVsix
  } = useExtensionStore();

  useEffect(() => {
    void loadInstalled();
    void searchMarketplace('popular');
  }, [loadInstalled, searchMarketplace]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void searchMarketplace(query);
  };

  const categories = ['All', 'Languages', 'Tools', 'AI', 'Linters', 'Git & SCM', 'Themes'];

  // Filter installed extensions based on query & category
  const filteredInstalled = installed.filter((ext) => {
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
            style={{ padding: '3px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}
            title="Install from VSIX Package"
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
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

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
            onChange={(e) => {
              setQuery(e.target.value);
              if (activeTab === 'marketplace' && e.target.value.length >= 3) {
                void searchMarketplace(e.target.value);
              }
            }}
            placeholder={activeTab === 'installed' ? 'Filter installed extensions…' : 'Search Open VSX marketplace…'}
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
      </div>

      {/* Main Extension List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {activeTab === 'installed' ? (
          /* INSTALLED VIEW */
          filteredInstalled.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No installed extensions match filter.
            </div>
          ) : (
            filteredInstalled.map((ext) => {
              const isEnabled = ext.enabled;
              const hasConfig = Boolean(ext.manifest.contributes?.configuration?.properties);

              return (
                <div
                  key={ext.id}
                  onClick={() => setActiveDetail(ext)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: '6px',
                    backgroundColor: 'var(--bg-tertiary)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                  className="file-item-hover"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <Boxes size={18} color={isEnabled ? 'var(--accent-primary)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ext.manifest.displayName || ext.manifest.name}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {ext.manifest.publisher} • v{ext.manifest.version}
                        </div>
                      </div>
                    </div>

                    {/* Enable/Disable Toggle & Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {hasConfig && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSettings(ext);
                          }}
                          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                          title="Configure Settings"
                        >
                          <Settings size={13} />
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleExtension(ext.id, !isEnabled);
                        }}
                        style={{
                          padding: '2px',
                          color: isEnabled ? 'var(--accent-green)' : 'var(--text-muted)'
                        }}
                        title={isEnabled ? 'Click to Disable' : 'Click to Enable'}
                      >
                        {isEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </div>
                  </div>

                  {ext.manifest.description && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {ext.manifest.description}
                    </div>
                  )}

                  {ext.isBuiltIn && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <span style={{ fontSize: '9px', backgroundColor: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-primary)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                        BUILT-IN
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          /* MARKETPLACE VIEW */
          isLoading ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              Searching Open VSX registry…
            </div>
          ) : marketplace.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No marketplace extensions found.
            </div>
          ) : (
            marketplace.map((ext) => {
              const isAlreadyInstalled = installed.some((i) => i.id === ext.id);

              return (
                <div
                  key={ext.id}
                  onClick={() => setActiveDetail(ext)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: '6px',
                    backgroundColor: 'var(--bg-tertiary)',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '10px'
                  }}
                  className="file-item-hover"
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      flexShrink: 0
                    }}
                  >
                    {ext.iconUrl ? (
                      <img src={ext.iconUrl} alt={ext.displayName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <Boxes size={20} color="var(--accent-primary)" />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ext.displayName || ext.name}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>v{ext.version}</span>
                    </div>

                    <div style={{ fontSize: '10px', color: 'var(--accent-cyan)' }}>
                      {ext.namespace}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                      {ext.description}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: 'var(--text-muted)' }}>
                        <span>⬇ {ext.downloadCount?.toLocaleString() || 0}</span>
                        {ext.rating && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--accent-amber)' }}>
                            <Star size={10} fill="var(--accent-amber)" /> {ext.rating}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isAlreadyInstalled) void installExtension(ext);
                        }}
                        style={{
                          padding: '2px 8px',
                          fontSize: '10px',
                          backgroundColor: isAlreadyInstalled ? 'var(--bg-primary)' : 'var(--accent-primary)',
                          color: isAlreadyInstalled ? 'var(--accent-green)' : '#fff',
                          border: isAlreadyInstalled ? '1px solid var(--accent-green)' : 'none',
                          borderRadius: '3px',
                          fontWeight: 500,
                          cursor: isAlreadyInstalled ? 'default' : 'pointer'
                        }}
                      >
                        {isAlreadyInstalled ? 'Installed' : 'Install'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )
        )}
      </div>

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
    </div>
  );
};
