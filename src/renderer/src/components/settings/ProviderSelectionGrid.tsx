import React from 'react';
import {
  Zap,
  Cpu,
  Code2,
  Share2,
  Box,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  CircleDot
} from 'lucide-react';
import type { PreConfiguredProvider } from '../../../../preload/types';
import { HoverMarquee } from '../ui/HoverMarquee';

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'testing';

export interface ProviderStatusInfo {
  status: ConnectionStatus;
  latencyMs?: number;
  error?: string;
}

export interface ProviderSelectionGridProps {
  providers: PreConfiguredProvider[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  providerStatuses: Record<string, ProviderStatusInfo>;
  onSelectCustom: () => void;
  isCustomSelected?: boolean;
}

const ProviderIcon: React.FC<{ id: string; size?: number }> = ({ id, size = 20 }) => {
  switch (id) {
    case 'openrouter':
      return <Share2 size={size} color="#6366f1" />;
    case 'groq':
      return <Zap size={size} color="#f59e0b" />;
    case 'ollama':
      return <Cpu size={size} color="#10b981" />;
    case 'openkilo':
      return <Box size={size} color="#ec4899" />;
    case 'opencode':
      return <Code2 size={size} color="#06b6d4" />;
    default:
      return <CircleDot size={size} color="var(--accent-primary)" />;
  }
};

export const ProviderSelectionGrid: React.FC<ProviderSelectionGridProps> = ({
  providers = [],
  selectedProviderId,
  onSelectProvider,
  providerStatuses = {},
  onSelectCustom,
  isCustomSelected = false
}) => {
  const safeProviders = Array.isArray(providers) ? providers : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
          AI Provider Marketplace &amp; Connectors
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Select a provider to configure or test
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: '10px'
        }}
      >
        {safeProviders.map((p) => {
          if (!p || !p.id) return null;
          const isSelected = !isCustomSelected && selectedProviderId === p.id;
          const statusInfo = (providerStatuses && providerStatuses[p.id]) || { status: 'disconnected' };

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProvider(p.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                textAlign: 'left',
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                border: isSelected
                  ? '1.5px solid var(--accent-primary)'
                  : '1px solid var(--border-subtle)',
                boxShadow: isSelected ? '0 0 0 1px var(--accent-primary), 0 4px 12px rgba(0,0,0,0.15)' : 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-hover)'
                  }}
                >
                  <ProviderIcon id={p.id} size={18} />
                </div>

                {/* Status Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                  {statusInfo.status === 'testing' && (
                    <span style={{ color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Loader2 size={11} className="spin" /> Testing…
                    </span>
                  )}
                  {statusInfo.status === 'connected' && (
                    <span
                      style={{
                        color: 'var(--accent-green)',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: 500
                      }}
                    >
                      <CheckCircle2 size={10} />
                      Connected {statusInfo.latencyMs ? `(${statusInfo.latencyMs}ms)` : ''}
                    </span>
                  )}
                  {statusInfo.status === 'error' && (
                    <span
                      style={{
                        color: 'var(--accent-red)',
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                      title={statusInfo.error}
                    >
                      <AlertCircle size={10} /> Error
                    </span>
                  )}
                  {statusInfo.status === 'disconnected' && (
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--bg-hover)',
                        padding: '2px 6px',
                        borderRadius: '10px'
                      }}
                    >
                      {p.setupType === 'zero_config' ? 'Ready to ping' : 'Not configured'}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', minWidth: 0 }}>
                <HoverMarquee
                  as="span"
                  style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}
                  text={p.name}
                />
                {p.setupType === 'zero_config' && (
                  <span
                    style={{
                      fontSize: '9px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: 'var(--accent-green)',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontWeight: 600
                    }}
                  >
                    ZERO-CONFIG
                  </span>
                )}
              </div>

              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  margin: '4px 0 0',
                  lineHeight: 1.35,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
              >
                {p.notes || p.baseUrl}
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  marginTop: '10px',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '10px'
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  {statusInfo.status === 'connected' ? 'Configured' : 'Setup needed'}
                </span>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                  Configure ↗
                </span>
              </div>
            </button>
          );
        })}

        {/* Add Custom Provider Card */}
        <button
          type="button"
          onClick={onSelectCustom}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            textAlign: 'left',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: isCustomSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            border: isCustomSelected
              ? '1.5px solid var(--accent-primary)'
              : '1px dashed var(--border-subtle)',
            boxShadow: isCustomSelected ? '0 0 0 1px var(--accent-primary)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            minHeight: '100px'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              backgroundColor: isCustomSelected ? 'var(--accent-primary)' : 'var(--bg-hover)',
              color: isCustomSelected ? '#fff' : 'var(--text-primary)',
              marginBottom: '8px'
            }}
          >
            <Plus size={18} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Add Custom Provider
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            LM Studio, vLLM, LocalAI, or custom /v1 proxy
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              width: '100%',
              marginTop: '8px',
              fontSize: '10px',
              color: 'var(--accent-primary)',
              fontWeight: 600
            }}
          >
            Configure ↗
          </div>
        </button>
      </div>
    </div>
  );
};
