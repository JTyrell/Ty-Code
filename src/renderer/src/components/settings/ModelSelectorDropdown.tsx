import React, { useState, useMemo } from 'react';
import {
  Search,
  Check,
  Sparkles,
  Zap,
  Cpu,
  RefreshCw,
  Gift,
  HelpCircle
} from 'lucide-react';
import type { DiscoveredModel } from '../../../../preload/types';

export interface ModelSelectorDropdownProps {
  models: DiscoveredModel[];
  selectedModelId: string;
  onSelectModel: (modelId: string, model?: DiscoveredModel) => void;
  isLoading?: boolean;
  onRefreshModels?: () => void;
  providerName?: string;
}

type ModelCategoryFilter = 'All' | 'Free' | 'Fast' | 'Premium/Reasoning';

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  models = [],
  selectedModelId,
  onSelectModel,
  isLoading = false,
  onRefreshModels,
  providerName = 'Provider'
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModelCategoryFilter>('All');

  const safeModels = Array.isArray(models) ? models : [];

  // Compute category counts
  const categoryCounts = useMemo(() => {
    let free = 0;
    let fast = 0;
    let premium = 0;
    for (const m of safeModels) {
      if (!m) continue;
      if (m.isFree || m.category === 'Free') free++;
      else if (m.category === 'Fast') fast++;
      else premium++;
    }
    return { all: safeModels.length, free, fast, premium };
  }, [safeModels]);

  // Filter models based on search query and category
  const filteredModels = useMemo(() => {
    return safeModels.filter((m) => {
      if (!m || !m.id) return false;
      // Category filter
      if (selectedCategory === 'Free' && !m.isFree && m.category !== 'Free') return false;
      if (selectedCategory === 'Fast' && m.category !== 'Fast') return false;
      if (selectedCategory === 'Premium/Reasoning' && (m.isFree || m.category !== 'Premium/Reasoning')) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesId = m.id.toLowerCase().includes(query);
        const matchesName = m.name?.toLowerCase().includes(query);
        const matchesDesc = m.description?.toLowerCase().includes(query);
        return matchesId || matchesName || matchesDesc;
      }
      return true;
    });
  }, [safeModels, selectedCategory, searchQuery]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '14px'
      }}
    >
      {/* Header and Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Available Models {providerName ? `(${providerName})` : ''}
          </span>
          <span
            style={{
              fontSize: '10px',
              backgroundColor: 'var(--bg-hover)',
              padding: '1px 6px',
              borderRadius: '10px',
              color: 'var(--text-secondary)'
            }}
          >
            {models.length} discovered
          </span>
        </div>
        {onRefreshModels && <p className="model-provider-disclosure">Refresh contacts the selected provider to retrieve its model list.</p>}

        {onRefreshModels && (
          <button
            type="button"
            onClick={onRefreshModels}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: isLoading ? 'wait' : 'pointer',
              padding: '2px 6px'
            }}
            title="Contact the selected provider to refresh its available model list"
          >
            <RefreshCw size={11} className={isLoading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative', width: '100%' }}>
        <Search
          size={13}
          style={{
            position: 'absolute',
            left: '9px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)'
          }}
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search models by name or id (e.g., deepseek, llama, 70b, free)..."
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            fontSize: '11px',
            borderRadius: '4px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-primary)'
          }}
        />
      </div>

      {/* Category Pills Filter */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
        <button
          type="button"
          onClick={() => setSelectedCategory('All')}
          style={{
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '4px',
            backgroundColor: selectedCategory === 'All' ? 'var(--accent-primary)' : 'var(--bg-hover)',
            color: selectedCategory === 'All' ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          All ({categoryCounts.all})
        </button>

        <button
          type="button"
          onClick={() => setSelectedCategory('Free')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '4px',
            backgroundColor: selectedCategory === 'Free' ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-hover)',
            color: selectedCategory === 'Free' ? 'var(--accent-green)' : 'var(--text-secondary)',
            border: selectedCategory === 'Free' ? '1px solid var(--accent-green)' : 'none',
            cursor: 'pointer'
          }}
        >
          <Gift size={11} color="var(--accent-green)" />
          <span>Free ({categoryCounts.free})</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedCategory('Fast')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '4px',
            backgroundColor: selectedCategory === 'Fast' ? 'rgba(6, 182, 212, 0.2)' : 'var(--bg-hover)',
            color: selectedCategory === 'Fast' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            border: selectedCategory === 'Fast' ? '1px solid var(--accent-cyan)' : 'none',
            cursor: 'pointer'
          }}
        >
          <Zap size={11} color="var(--accent-cyan)" />
          <span>Fast ({categoryCounts.fast})</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedCategory('Premium/Reasoning')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '4px',
            backgroundColor: selectedCategory === 'Premium/Reasoning' ? 'rgba(168, 85, 247, 0.2)' : 'var(--bg-hover)',
            color: selectedCategory === 'Premium/Reasoning' ? '#c084fc' : 'var(--text-secondary)',
            border: selectedCategory === 'Premium/Reasoning' ? '1px solid #c084fc' : 'none',
            cursor: 'pointer'
          }}
        >
          <Cpu size={11} color="#c084fc" />
          <span>Reasoning ({categoryCounts.premium})</span>
        </button>
      </div>

      {/* Model List View */}
      <div
        style={{
          maxHeight: '180px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          paddingRight: '4px'
        }}
      >
        {filteredModels.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '11px' }}>
            No models match the filter. Try another search term.
          </div>
        ) : (
          filteredModels.map((m) => {
            const isSelected = selectedModelId === m.id;
            const isFree = m.isFree || m.category === 'Free';

            return (
              <div
                key={m.id}
                onClick={() => onSelectModel(m.id, m)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? 'var(--bg-hover)' : 'var(--bg-primary)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {m.name || m.id}
                    </span>

                    {/* Free Badge */}
                    {isFree && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          backgroundColor: 'rgba(16, 185, 129, 0.18)',
                          color: 'var(--accent-green)',
                          padding: '1px 5px',
                          borderRadius: '4px'
                        }}
                      >
                        FREE
                      </span>
                    )}

                    {/* Fast Badge */}
                    {!isFree && m.category === 'Fast' && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          backgroundColor: 'rgba(6, 182, 212, 0.15)',
                          color: 'var(--accent-cyan)',
                          padding: '1px 5px',
                          borderRadius: '4px'
                        }}
                      >
                        FAST
                      </span>
                    )}

                    {/* Reasoning Badge */}
                    {!isFree && m.category === 'Premium/Reasoning' && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          backgroundColor: 'rgba(168, 85, 247, 0.15)',
                          color: '#c084fc',
                          padding: '1px 5px',
                          borderRadius: '4px'
                        }}
                      >
                        REASONING
                      </span>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      fontFamily: 'monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {m.id} {m.contextLength ? `· ${Math.round(m.contextLength / 1024)}k context` : ''}
                  </span>
                </div>

                {isSelected && (
                  <div style={{ color: 'var(--accent-primary)', flexShrink: 0, marginLeft: '8px' }}>
                    <Check size={14} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
