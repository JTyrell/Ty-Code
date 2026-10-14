import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Search,
  Download,
  Star,
  ExternalLink,
  CheckCircle,
  RefreshCw,
  X
} from 'lucide-react';
import type { ExtensionMetadata } from '../../../preload/types';

export const ExtensionsPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [extensions, setExtensions] = useState<ExtensionMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedExt, setSelectedExt] = useState<ExtensionMetadata | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const searchExtensions = async (searchQuery: string) => {
    setIsLoading(true);
    try {
      const res = await window.electronAPI.searchExtensions(searchQuery);
      if (res.success && res.data) {
        setExtensions(res.data);
      }
    } catch (err) {
      console.error('Failed to search extensions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    searchExtensions('popular');
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    searchExtensions(query);
  };

  const handleInstall = (ext: ExtensionMetadata) => {
    setInstalledIds((prev) => new Set([...prev, ext.id]));
  };

  const categories = ['Python', 'TypeScript', 'Prettier', 'ESLint', 'GitLens', 'Themes', 'Rust', 'Docker'];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          height: '35px',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Boxes size={14} color="var(--accent-primary)" />
          <span>VS Code Extensions (Open VSX)</span>
        </div>
        <button onClick={() => searchExtensions(query || 'popular')} title="Refresh">
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search Input */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <form onSubmit={handleSearchSubmit} style={{ position: 'relative' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Open VSX extensions..."
            style={{
              width: '100%',
              fontSize: '11px',
              paddingLeft: '28px',
              height: '28px',
              backgroundColor: 'var(--bg-tertiary)'
            }}
          />
          <Search size={13} style={{ position: 'absolute', left: '8px', top: '8px', color: 'var(--text-muted)' }} />
        </form>

        {/* Quick Tag Pills */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginTop: '6px', paddingBottom: '2px' }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setQuery(cat);
                searchExtensions(cat);
              }}
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                borderRadius: '3px',
                whiteSpace: 'nowrap',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Extension List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            Searching Open VSX registry...
          </div>
        ) : extensions.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            No extensions found for "{query}".
          </div>
        ) : (
          extensions.map((ext) => {
            const isInstalled = installedIds.has(ext.id);
            return (
              <div
                key={ext.id}
                onClick={() => setSelectedExt(ext)}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '6px',
                  backgroundColor: 'var(--bg-tertiary)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '8px'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
              >
                {/* Extension Icon */}
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--bg-secondary)',
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

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ext.displayName}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>v{ext.version}</span>
                  </div>

                  <div style={{ fontSize: '10px', color: 'var(--accent-cyan)', marginBottom: '2px' }}>
                    {ext.namespace}
                  </div>

                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.3
                    }}
                  >
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
                        handleInstall(ext);
                      }}
                      style={{
                        padding: '2px 8px',
                        fontSize: '10px',
                        backgroundColor: isInstalled ? 'var(--accent-green)' : 'var(--accent-primary)',
                        color: '#fff',
                        fontWeight: 500,
                        borderRadius: '3px'
                      }}
                    >
                      {isInstalled ? (
                        <>
                          <CheckCircle size={10} />
                          <span>Enabled</span>
                        </>
                      ) : (
                        <span>Install</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Extension Details Modal */}
      {selectedExt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setSelectedExt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '500px',
              maxHeight: '80vh',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden'
                  }}
                >
                  {selectedExt.iconUrl ? (
                    <img src={selectedExt.iconUrl} alt={selectedExt.displayName} style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <Boxes size={28} color="var(--accent-primary)" />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600 }}>{selectedExt.displayName}</div>
                  <div style={{ fontSize: '11px', color: 'var(--accent-cyan)' }}>{selectedExt.namespace} • v{selectedExt.version}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Downloads: {selectedExt.downloadCount?.toLocaleString()}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedExt(null)} style={{ padding: '4px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {selectedExt.description}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={() => handleInstall(selectedExt)}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  fontWeight: 500,
                  fontSize: '12px'
                }}
              >
                {installedIds.has(selectedExt.id) ? 'Enabled in Ty-Claude' : 'Install Extension'}
              </button>
              {selectedExt.downloadUrl && (
                <a
                  href={selectedExt.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Download size={13} />
                  <span>Download .VSIX</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
