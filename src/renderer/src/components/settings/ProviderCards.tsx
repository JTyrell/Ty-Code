/**
 * Provider Cards Grid (Phase 6.2)
 *
 * Visual cards for each provider showing status, free tier info, latency,
 * and quick actions (Add Key, Test, Remove, Settings).
 *
 * Brand: Ty-Code
 */

import React, { useState, useMemo } from 'react';
import {
  Zap,
  Cpu,
  Share2,
  Box,
  Code2,
  Server,
  Plus,
  RotateCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Search,
  Sliders,
  Sparkles,
  LockKeyhole
} from 'lucide-react';
import type { FreeProvider } from '../../../../shared/types/free-providers';
import type { StoredKeySummary } from '../../../../shared/types/byok';
import './ProviderCards.css';

export interface ProviderCardsProps {
  freeProviders: FreeProvider[];
  storedKeys: StoredKeySummary[];
  onAddKey: (providerId: string) => void;
  onTestConnection: (providerId: string) => Promise<void>;
  onRemoveKey: (providerId: string) => Promise<void>;
  onOpenSettings: (providerId: string) => void;
  onLaunchWizard: () => void;
  onOpenAdvanced: () => void;
  testingProviders: Record<string, boolean>;
  connectionStatuses: Record<string, { status: 'connected' | 'error' | 'disconnected'; latencyMs?: number; error?: string }>;
}

const getProviderIcon = (id: string, size = 20) => {
  const cleanId = id.toLowerCase();
  if (cleanId.includes('openrouter')) return <Share2 size={size} color="#6366f1" />;
  if (cleanId.includes('groq')) return <Zap size={size} color="#f59e0b" />;
  if (cleanId.includes('openkilo')) return <Box size={size} color="#ec4899" />;
  if (cleanId.includes('ollama')) return <Cpu size={size} color="#10b981" />;
  if (cleanId.includes('opencode')) return <Code2 size={size} color="#06b6d4" />;
  if (cleanId.includes('google') || cleanId.includes('gemini')) return <Sparkles size={size} color="#3b82f6" />;
  if (cleanId.includes('anthropic') || cleanId.includes('claude')) return <ShieldCheck size={size} color="#d97706" />;
  if (cleanId.includes('together')) return <Server size={size} color="#8b5cf6" />;
  if (cleanId.includes('fireworks')) return <Zap size={size} color="#ef4444" />;
  return <Server size={size} color="var(--accent-primary)" />;
};

export const ProviderCards: React.FC<ProviderCardsProps> = ({
  freeProviders,
  storedKeys,
  onAddKey,
  onTestConnection,
  onRemoveKey,
  onOpenSettings,
  onLaunchWizard,
  onOpenAdvanced,
  testingProviders,
  connectionStatuses
}) => {
  const [filter, setFilter] = useState<'all' | 'free' | 'configured' | 'local'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Map stored key lookup
  const keyMap = useMemo(() => {
    const map = new Map<string, StoredKeySummary>();
    for (const k of storedKeys) {
      map.set(k.providerId, k);
      map.set(k.providerId.replace('-free', ''), k);
      map.set(`${k.providerId}-free`, k);
    }
    return map;
  }, [storedKeys]);

  const filteredProviders = useMemo(() => {
    return freeProviders.filter((p) => {
      const stored = keyMap.get(p.id);
      const isConfigured = Boolean(stored?.isConfigured);
      const isLocal = p.auth_type === 'anonymous' || /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::|\/)/i.test(p.base_url);

      if (filter === 'free' && (!p.best_free_models || p.best_free_models.length === 0)) return false;
      if (filter === 'configured' && !isConfigured && !isLocal) return false;
      if (filter === 'local' && !isLocal) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesId = p.id.toLowerCase().includes(q);
        const matchesModel = p.best_free_models?.some((m) => m.toLowerCase().includes(q));
        if (!matchesName && !matchesId && !matchesModel) return false;
      }

      return true;
    });
  }, [freeProviders, keyMap, filter, searchQuery]);

  return (
    <div className="byok-cards-container" id="provider-cards-container">
      {/* Top action header */}
      <div className="byok-hero-card">
        <div className="byok-hero-info">
          <h3 className="byok-hero-title">
            <Server size={17} color="var(--accent-primary)" />
            AI Providers &amp; Bring-Your-Own-Key (BYOK)
          </h3>
          <p className="byok-hero-desc">
            Use permanently registered free tier providers, connect custom API keys, or self-host local LLMs.
          </p>
        </div>

        <div className="byok-hero-actions">
          <button
            type="button"
            id="btn-launch-byok-wizard"
            onClick={onLaunchWizard}
            className="byok-btn-primary"
          >
            <Plus size={14} />
            Add Key / Wizard
          </button>

          <button
            type="button"
            id="btn-open-advanced-json"
            onClick={onOpenAdvanced}
            className="byok-btn-secondary"
          >
            <Sliders size={13} />
            JSON Config
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="byok-toolbar">
        <div className="byok-filter-group">
          {(['all', 'free', 'configured', 'local'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              id={`filter-tab-${tab}`}
              onClick={() => setFilter(tab)}
              className={`byok-filter-pill ${filter === tab ? 'is-active' : ''}`}
            >
              {tab === 'free' ? 'Free Tier' : tab === 'local' ? 'Local / Zero-Config' : tab === 'configured' ? 'Configured' : 'All'}
            </button>
          ))}
        </div>

        <div className="byok-search-wrap">
          <Search size={14} className="byok-search-icon" />
          <input
            type="text"
            id="input-search-providers"
            placeholder="Search providers or models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="byok-search-input"
          />
        </div>
      </div>

      {/* Cards Grid */}
      <div className="byok-cards-grid" id="providers-grid">
        {filteredProviders.map((provider) => {
          const stored = keyMap.get(provider.id);
          const isConfigured = Boolean(stored?.isConfigured);
          const isTesting = Boolean(testingProviders[provider.id]);
          const conn = connectionStatuses[provider.id];
          const isZeroConfig = provider.auth_type === 'anonymous';

          return (
            <div
              key={provider.id}
              id={`provider-card-${provider.id}`}
              className="byok-card"
            >
              {/* Header: Logo, Name, Badge */}
              <div>
                <div className="byok-card-top">
                  <div className="byok-card-brand-row">
                    <div className="byok-card-icon-box">
                      {getProviderIcon(provider.id, 20)}
                    </div>
                    <div className="byok-card-meta">
                      <h4 className="byok-card-title">
                        {provider.name}
                      </h4>
                      <span className="byok-card-subtitle">
                        {isZeroConfig ? 'Zero Config (No Key)' : isConfigured ? 'Custom Key Active' : 'Key Optional'}
                      </span>
                    </div>
                  </div>

                  {/* Free tier pill */}
                  {provider.best_free_models && provider.best_free_models.length > 0 && (
                    <span className="byok-card-free-pill">
                      {provider.best_free_models.length} Free Model{provider.best_free_models.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {/* Status Indicator */}
                <div className="byok-card-status-row">
                  {conn?.status === 'connected' ? (
                    <span className="byok-status-pill byok-status-connected">
                      <CheckCircle2 size={12} />
                      Connected ({conn.latencyMs || 0}ms)
                    </span>
                  ) : conn?.status === 'error' ? (
                    <span className="byok-status-pill byok-status-error">
                      <AlertCircle size={12} />
                      {conn.error || 'Connection Failed'}
                    </span>
                  ) : isConfigured ? (
                    <span className="byok-status-pill byok-status-configured">
                      <LockKeyhole size={12} />
                      Connected ({stored?.maskedKey || 'Key Saved'})
                    </span>
                  ) : isZeroConfig ? (
                    <span className="byok-status-pill byok-status-anonymous">
                      <Zap size={12} />
                      Anonymous
                    </span>
                  ) : (
                    <span className="byok-status-disconnected">Disconnected</span>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="byok-card-footer">
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    id={`btn-add-key-${provider.id}`}
                    onClick={() => onAddKey(provider.id)}
                    title={isConfigured ? 'Update provider key' : 'Connect provider'}
                    className={isConfigured ? 'byok-card-btn-update' : 'byok-card-btn-connect'}
                  >
                    {isConfigured ? 'Update Key' : 'Connect'}
                  </button>

                  <button
                    type="button"
                    id={`btn-test-${provider.id}`}
                    disabled={isTesting}
                    onClick={() => void onTestConnection(provider.id)}
                    title="Test Connection"
                    className="byok-card-btn-test"
                  >
                    <RotateCw size={11} className={isTesting ? 'spinning' : ''} />
                    {isTesting ? 'Testing...' : 'Test Connection'}
                  </button>

                  {isConfigured && (
                    <button
                      type="button"
                      id={`btn-remove-${provider.id}`}
                      onClick={() => void onRemoveKey(provider.id)}
                      title="Disconnect provider"
                      className="byok-card-btn-disconnect"
                    >
                      <Trash2 size={11} />
                      <span>Disconnect</span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    id={`btn-settings-${provider.id}`}
                    onClick={() => onOpenSettings(provider.id)}
                    title="Configure models & endpoints"
                    className="byok-card-btn-icon"
                  >
                    <Sliders size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
