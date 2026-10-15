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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="provider-cards-container">
      {/* Top action header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={17} color="var(--accent-primary)" />
            AI Providers &amp; Bring-Your-Own-Key (BYOK)
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
            Use permanently registered free tier providers, connect custom API keys, or self-host local LLMs.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            id="btn-launch-byok-wizard"
            onClick={onLaunchWizard}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '12px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)'
            }}
          >
            <Plus size={14} />
            Add Key / Wizard
          </button>

          <button
            type="button"
            id="btn-open-advanced-json"
            onClick={onOpenAdvanced}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#cbd5e1',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <Sliders size={13} />
            JSON Config
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'free', 'configured', 'local'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              id={`filter-tab-${tab}`}
              onClick={() => setFilter(tab)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                border: filter === tab ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                background: filter === tab ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: filter === tab ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {tab === 'free' ? 'Free Tier' : tab === 'local' ? 'Local / Zero-Config' : tab}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', minWidth: '220px' }}>
          <Search size={14} color="#64748b" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            id="input-search-providers"
            placeholder="Search providers or models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px 6px 30px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(15, 23, 42, 0.6)',
              color: '#f8fafc',
              fontSize: '12px'
            }}
          />
        </div>
      </div>

      {/* Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: '12px'
        }}
        id="providers-grid"
      >
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
              style={{
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(30, 41, 59, 0.4)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'border-color 0.2s, background-color 0.2s',
                gap: '12px'
              }}
            >
              {/* Header: Logo, Name, Badge */}
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {getProviderIcon(provider.id, 20)}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                        {provider.name}
                      </h4>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {isZeroConfig ? 'Zero Config (No Key)' : isConfigured ? 'Custom Key Active' : 'Key Optional'}
                      </span>
                    </div>
                  </div>

                  {/* Free tier pill */}
                  {provider.best_free_models && provider.best_free_models.length > 0 && (
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        fontSize: '11px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {provider.best_free_models.length} Free Model{provider.best_free_models.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {/* Status Indicator */}
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                  {conn?.status === 'connected' ? (
                    <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle2 size={12} />
                      Connected ({conn.latencyMs || 0}ms)
                    </span>
                  ) : conn?.status === 'error' ? (
                    <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={12} />
                      {conn.error || 'Connection Failed'}
                    </span>
                  ) : isConfigured ? (
                    <span style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <LockKeyhole size={12} />
                      Key Saved: {stored?.maskedKey || '••••••••'}
                    </span>
                  ) : (
                    <span style={{ color: '#64748b' }}>Not Connected</span>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                  paddingTop: '10px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)'
                }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    id={`btn-add-key-${provider.id}`}
                    onClick={() => onAddKey(provider.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '5px',
                      background: isConfigured ? 'rgba(255, 255, 255, 0.08)' : 'rgba(99, 102, 241, 0.2)',
                      border: isConfigured ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(99, 102, 241, 0.4)',
                      color: isConfigured ? '#e2e8f0' : '#818cf8',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {isConfigured ? 'Update Key' : 'Add Key'}
                  </button>

                  <button
                    type="button"
                    id={`btn-test-${provider.id}`}
                    disabled={isTesting}
                    onClick={() => void onTestConnection(provider.id)}
                    title="Test connection to provider"
                    style={{
                      padding: '5px 8px',
                      borderRadius: '5px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#cbd5e1',
                      fontSize: '11px',
                      cursor: isTesting ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <RotateCw size={11} className={isTesting ? 'spinning' : ''} />
                    {isTesting ? 'Testing' : 'Test'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  {isConfigured && (
                    <button
                      type="button"
                      id={`btn-remove-${provider.id}`}
                      onClick={() => void onRemoveKey(provider.id)}
                      title="Remove stored key"
                      style={{
                        padding: '5px 7px',
                        borderRadius: '5px',
                        background: 'transparent',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        color: '#f87171',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}

                  <button
                    type="button"
                    id={`btn-settings-${provider.id}`}
                    onClick={() => onOpenSettings(provider.id)}
                    title="Configure models & endpoints"
                    style={{
                      padding: '5px 7px',
                      borderRadius: '5px',
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#94a3b8',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
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
