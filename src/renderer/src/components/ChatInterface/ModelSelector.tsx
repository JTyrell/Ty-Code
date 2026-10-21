/**
 * Intelligent Model Selector & Mid-Conversation Switcher (Phase 6.4)
 *
 * Provides:
 * 1. Current model display with Tier badge (Tier S, Tier A, Tier B, Tier C)
 * 2. Routing Mode Switcher (Auto, Fastest, Most Capable, Manual)
 * 3. Grouped model dropdown categorized by Tier with latency, provider, and free badges
 * 4. Mid-conversation model switching while preserving full chat history
 * 5. Quick-switch keyboard shortcut: Ctrl+M / Cmd+M
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Zap,
  Cpu,
  ChevronDown,
  Check,
  Sliders,
  Layers,
  Compass,
  ArrowRight
} from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { toast } from '../../state/toast-store';
import type {
  ModelTier,
  RankedModelCandidate,
  RoutingPreferenceMode,
  RouterUserPreferences
} from '../../../../shared/types/model-router';
import type { ProviderType, ProviderConnectivitySnapshot } from '../../../../preload/types';

export const TIER_LABELS: Record<ModelTier, { name: string; color: string; bg: string; border: string }> = {
  tier_s_reasoning: {
    name: 'Tier S: Reasoning',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.3)'
  },
  tier_a_coding: {
    name: 'Tier A: Coding',
    color: '#818cf8',
    bg: 'rgba(129, 140, 248, 0.12)',
    border: 'rgba(129, 140, 248, 0.3)'
  },
  tier_b_general: {
    name: 'Tier B: General',
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.3)'
  },
  tier_c_fast: {
    name: 'Tier C: Fast',
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.3)'
  }
};

export const FALLBACK_CATALOG: Record<ModelTier, RankedModelCandidate[]> = {
  tier_s_reasoning: [
    {
      modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      modelName: 'NVIDIA Nemotron 3 Ultra (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_s_reasoning',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 180,
      selectionReason: 'Deep architectural and multi-step reasoning'
    },
    {
      modelId: 'nvidia/nemotron-3.5-super-vl:free',
      modelName: 'Nemotron 3.5 Super (Kilo Gateway)',
      providerId: 'openkilo-free',
      providerName: 'OpenKilo',
      tier: 'tier_s_reasoning',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 185,
      selectionReason: 'High-availability Kilo reasoning endpoint'
    }
  ],
  tier_a_coding: [
    {
      modelId: 'cohere/north-mini-code:free',
      modelName: 'North Mini Code (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 175,
      selectionReason: 'Exceptional code generation and component authoring'
    },
    {
      modelId: 'poolside/laguna-s-2.1:free',
      modelName: 'Poolside Laguna S (Kilo Gateway)',
      providerId: 'openkilo-free',
      providerName: 'OpenKilo',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 180,
      selectionReason: 'Massive 262K context code specialist'
    },
    {
      modelId: 'deepseek/deepseek-v4.1-flash:free',
      modelName: 'DeepSeek V4.1 Flash (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 190,
      selectionReason: 'High-throughput reasoning coder with 1M context'
    }
  ],
  tier_b_general: [
    {
      modelId: 'dots-studio/dots-3-note-preview:free',
      modelName: 'Dots 3 Note Preview (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_b_general',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 160,
      selectionReason: 'Balanced conversation and technical explanations'
    },
    {
      modelId: 'meituan/longcat-2.0:free',
      modelName: 'LongCat 2.0 (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_b_general',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 165,
      selectionReason: '1M context MoE generalist from Meituan'
    }
  ],
  tier_c_fast: [
    {
      modelId: 'llama-3.1-8b-instant',
      modelName: 'Llama 3.1 8B Instant (Groq)',
      providerId: 'groq-free',
      providerName: 'Groq',
      tier: 'tier_c_fast',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 200,
      selectionReason: 'Sub-100ms ultra-fast execution'
    },
    {
      modelId: 'minimax/minimax-m3.1-flash:free',
      modelName: 'MiniMax M3.1 Flash (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_c_fast',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 195,
      selectionReason: 'Ultra-responsive flash model with 1M context'
    }
  ]
};

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export const ModelSelector: React.FC = () => {
  const { settings, saveSettings } = useChatStore();
  const [isOpen, setIsOpen] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingPreferenceMode>('auto');
  const [catalog, setCatalog] = useState<Record<ModelTier, RankedModelCandidate[]>>(FALLBACK_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<Record<string, ProviderConnectivitySnapshot>>({});
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeModelId = settings?.activeModel || 'kilo-auto/free';
  const isAutoBinding = !settings?.activeProvider || settings.activeProvider === 'auto';
  const activeProvider = isAutoBinding ? 'auto' : settings.activeProvider;

  // Determine active tier based on active model
  const activeTier: ModelTier = isAutoBinding
    ? 'tier_b_general'
    : (() => {
        for (const [tier, models] of Object.entries(catalog) as [ModelTier, RankedModelCandidate[]][]) {
          if (models.some((m) => m.modelId === activeModelId || activeModelId.includes(m.modelId))) {
            return tier;
          }
        }
        if (activeModelId.includes('r1') || activeModelId.includes('o1')) return 'tier_s_reasoning';
        if (activeModelId.includes('coder') || activeModelId.includes('code') || activeModelId.includes('sonnet')) return 'tier_a_coding';
        if (activeModelId.includes('8b') || activeModelId.includes('flash')) return 'tier_c_fast';
        return 'tier_b_general';
      })();

  const currentTierInfo = TIER_LABELS[activeTier] || TIER_LABELS.tier_a_coding;
  const modelShortName = isAutoBinding
    ? 'Auto'
    : activeModelId.split('/').pop()?.replace(':free', '') || activeModelId;

  // Load preferences and available models from main process
  useEffect(() => {
    void loadPreferences();
    void loadCatalog();
  }, []);

  // Keyboard shortcut listener: Ctrl+M / Cmd+M
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const calculateDropdownPosition = useCallback((): DropdownPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    const width = Math.max(0, Math.min(310, viewportWidth - margin * 2));
    const maxLeft = Math.max(margin, viewportWidth - margin - width);
    const left = Math.min(Math.max(margin, rect.right - width), maxLeft);
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const spaceAbove = Math.max(0, rect.top - gap - margin);
    const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(440, openBelow ? spaceBelow : spaceAbove);
    const top = openBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - maxHeight);

    return { top, left, width, maxHeight };
  }, []);

  const toggleDropdown = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        const pos = calculateDropdownPosition();
        if (pos) setDropdownPosition(pos);
        void loadCatalog();
      }
      return next;
    });
  };

  // Keep the portal menu inside the app window even when its trigger is near an edge.
  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return;
    }

    const updatePosition = () => {
      const nextPosition = calculateDropdownPosition();
      if (!nextPosition) return;

      setDropdownPosition((current) => current
        && current.top === nextPosition.top
        && current.left === nextPosition.left
        && current.width === nextPosition.width
        && current.maxHeight === nextPosition.maxHeight
        ? current
        : nextPosition);
    };

    updatePosition();
    const trigger = triggerRef.current;
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (trigger) resizeObserver?.observe(trigger);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, calculateDropdownPosition]);

  // Click outside closes the trigger and its portaled menu.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || dropdownMenuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const loadPreferences = async () => {
    try {
      if (window.electronAPI?.modelRouterGetPreferences) {
        const res = await window.electronAPI.modelRouterGetPreferences();
        if (res.success && res.data) {
          setRoutingMode(res.data.mode);
        }
      }
    } catch {
      // Fallback to auto
    }
  };

  const loadCatalog = async () => {
    setCatalogLoading(true);
    try {
      if (window.electronAPI?.modelRouterGetAvailableModels) {
        const fetchConnStatus = async () => {
          try {
            if (window.electronAPI?.providerGetConnectionStatus) {
              return await window.electronAPI.providerGetConnectionStatus();
            }
          } catch {
            // Connectivity snapshot is best-effort
          }
          return null;
        };

        const [catalogRes, statusRes] = await Promise.all([
          window.electronAPI.modelRouterGetAvailableModels(),
          fetchConnStatus()
        ]);
        if (catalogRes.success && catalogRes.data) {
          setCatalog(catalogRes.data);
        }
        if (statusRes?.success && statusRes.data) {
          setConnStatus(statusRes.data);
        }
      }
    } catch {
      // Keep fallback
    } finally {
      setCatalogLoading(false);
    }
  };

  // A provider counts as connected only when real traffic has succeeded there
  // (measured request outcomes or a live hosted-supply probe).
  const isProviderConnected = (providerId?: string): boolean => {
    if (!providerId) return false;
    const normalized = providerId.replace(/-free$/, '');
    const status = connStatus[normalized] || connStatus[providerId];
    return Boolean(status?.connected);
  };

  const handleModeChange = async (mode: RoutingPreferenceMode) => {
    setRoutingMode(mode);
    try {
      if (window.electronAPI?.modelRouterSetPreferences) {
        await window.electronAPI.modelRouterSetPreferences({ mode });
      }
      toast.success(
        'Routing Mode Updated',
        mode === 'auto'
          ? 'Intelligent router will automatically select best model per task.'
          : mode === 'fastest'
          ? 'Fastest healthy free endpoint will be prioritized.'
          : mode === 'most_capable'
          ? 'Highest reasoning and coding tiers (Tier S/A) prioritized.'
          : 'Manual model override active.'
      );
    } catch {
      // Ignore
    }
  };

  const handleSelectModel = async (candidate: RankedModelCandidate) => {
    // Preserve conversation context: DO NOT clear messages, simply switch active model in settings
    const stripped = candidate.providerId.replace(/-free$/, '');
    const targetProvider = ((stripped === 'opencode-built-in' ? 'opencode' : stripped) || 'openkilo') as ProviderType;

    // Keyed providers that never completed a verified request will fail with
    // CONFIG_MISSING on send — surface the connect requirement up front.
    if (candidate.provenance === 'your key' && !isProviderConnected(candidate.providerId)) {
      toast.warning(
        'Connect required',
        `${candidate.providerName} needs its own API key — add it in Settings → Providers. The model stays selected for when the key is active.`
      );
    }

    await saveSettings({
      activeModel: candidate.modelId,
      activeProvider: targetProvider
    });

    if (routingMode !== 'manual') {
      setRoutingMode('manual');
      if (window.electronAPI?.modelRouterSetPreferences) {
        await window.electronAPI.modelRouterSetPreferences({
          mode: 'manual',
          manualModelId: candidate.modelId,
          manualProviderId: candidate.providerId
        });
      }
    }

    setIsOpen(false);
    toast.success('Model Switched', `Now chatting with ${candidate.modelName} (${TIER_LABELS[candidate.tier].name})`);
  };

  const handleSelectAuto = async () => {
    // Return to the "Auto" binding: FCC decides the concrete free provider/model
    // per request (free-first, key-safe handoff). No manual override left behind.
    await saveSettings({ activeModel: '', activeProvider: 'auto' });
    if (window.electronAPI?.modelRouterSetPreferences) {
      await window.electronAPI.modelRouterSetPreferences({ mode: 'auto' });
    }
    setRoutingMode('auto');
    setIsOpen(false);
    toast.success('Auto Enabled', 'FCC will route each message to the best managed free model');
  };

  return (
    <div
      ref={dropdownRef}
      id="chat-model-selector-container"
      className="chat-model-selector-container"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        userSelect: 'none'
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        id="btn-model-selector-trigger"
        ref={triggerRef}
        className="chat-model-selector-trigger"
        onClick={toggleDropdown}
        title={`Active Model: ${activeModelId} (${currentTierInfo.name}). Press Ctrl+M to switch models.`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          height: '24px',
          padding: '0 6px',
          borderRadius: '6px',
          background: isOpen ? 'var(--surface-3, rgba(255, 255, 255, 0.08))' : 'var(--surface-2, rgba(255, 255, 255, 0.04))',
          border: isOpen ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontSize: '11px',
          fontWeight: 500,
          cursor: 'pointer',
          maxWidth: '100%',
          minWidth: 0,
          flexShrink: 1,
          transition: 'all 0.15s ease'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {routingMode === 'auto' ? (
            <Sparkles size={11} color="#38bdf8" />
          ) : routingMode === 'fastest' ? (
            <Zap size={11} color="#fbbf24" />
          ) : routingMode === 'most_capable' ? (
            <Cpu size={11} color="#818cf8" />
          ) : (
            <Sliders size={11} color="#cbd5e1" />
          )}
        </span>

        <span
          className="chat-model-selector-name"
          style={{
            maxWidth: '75px',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1
          }}
        >
          {modelShortName}
        </span>

        {/* Tier Chip */}
        <span
          id="badge-active-tier"
          style={{
            fontSize: '9px',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: '3px',
            backgroundColor: currentTierInfo.bg,
            color: currentTierInfo.color,
            border: `1px solid ${currentTierInfo.border}`,
            letterSpacing: '0.5px',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {currentTierInfo.name.split(':')[0]}
        </span>

        <ChevronDown size={11} color="var(--text-muted)" style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && dropdownPosition && createPortal(
        <div
          ref={dropdownMenuRef}
          id="model-selector-dropdown-menu"
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: `${dropdownPosition.maxHeight}px`,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            overflowY: 'auto',
            background: '#161922',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
            zIndex: 2000,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {/* Mode Selector Segmented Control */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            {[
              { id: 'auto', label: 'Auto', icon: Sparkles, color: '#38bdf8' },
              { id: 'fastest', label: 'Fastest', icon: Zap, color: '#fbbf24' },
              { id: 'most_capable', label: 'Capable', icon: Cpu, color: '#818cf8' },
              { id: 'manual', label: 'Manual', icon: Sliders, color: '#cbd5e1' }
            ].map((m) => {
              const IconComp = m.icon;
              const isSelected = routingMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  id={m.id === 'auto' ? 'btn-mode-auto' : m.id === 'fastest' ? 'btn-mode-fastest' : `btn-mode-${m.id}`}
                  onClick={() => void handleModeChange(m.id as RoutingPreferenceMode)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '4px 0',
                    border: 'none',
                    borderRadius: '4px',
                    background: isSelected ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                    color: isSelected ? '#ffffff' : 'var(--text-muted)',
                    fontSize: '10px',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <IconComp size={10} color={isSelected ? m.color : 'inherit'} />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Select Model (Ctrl+M)
            </span>
            <span style={{ fontSize: '10px', color: '#34d399', fontWeight: 600 }}>
              Auto-Failover Active
            </span>
          </div>

          {/* Honest sync indicator */}
          {catalogLoading ? (
            <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', padding: '0 4px' }}>
              Syncing live model catalog (FCC supply layer)…
            </div>
          ) : null}

          {/* Auto (FCC decides) — the managed free-supply binding */}
          {(() => {
            const isAutoSelected = isAutoBinding && routingMode === 'auto';
            return (
              <div
                id="model-option-auto"
                onClick={() => void handleSelectAuto()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  background: isAutoSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.04)',
                  border: isAutoSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(56, 189, 248, 0.15)',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease'
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.1)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.04)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <Sparkles size={11} color="#38bdf8" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#ffffff' }}>Auto (FCC decides)</span>
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  Best free model per message
                </span>
              </div>
            );
          })()}

          {/* Grouped Models List — first by supply tier (Free / Premium / Local), then capability tier */}
          {(() => {
            const tiers = Object.keys(catalog) as ModelTier[];
            const isLocalModel = (m: RankedModelCandidate): boolean =>
              (m.providerId || '').includes('ollama') || (m.providerName || '').includes('Ollama');

            const freeByTier = tiers
              .map((tierKey) => ({ tier: tierKey, models: (catalog[tierKey] || []).filter((m) => m.isFree && !isLocalModel(m)) }))
              .filter((g) => g.models.length > 0);
            const premiumByTier = tiers
              .map((tierKey) => ({ tier: tierKey, models: (catalog[tierKey] || []).filter((m) => !m.isFree && !isLocalModel(m)) }))
              .filter((g) => g.models.length > 0);
            const localByTier = tiers
              .map((tierKey) => ({ tier: tierKey, models: (catalog[tierKey] || []).filter((m) => isLocalModel(m)) }))
              .filter((g) => g.models.length > 0);

            const freeTotal = freeByTier.reduce((n, g) => n + g.models.length, 0);
            const premiumTotal = premiumByTier.reduce((n, g) => n + g.models.length, 0);
            const localTotal = localByTier.reduce((n, g) => n + g.models.length, 0);
            const premiumConnectedTotal = premiumByTier.reduce((n, g) => n + g.models.filter((m) => isProviderConnected(m.providerId)).length, 0);

            const renderTierGroup = (tierKey: ModelTier, models: RankedModelCandidate[], groupKey: string) => {
              if (models.length === 0) return null;
              const tierInfo = TIER_LABELS[tierKey];
              return (
                <div key={groupKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '2px 4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: tierInfo.color,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
                    <span>{tierInfo.name}</span>
                  </div>

                  {models.map((candidate) => {
                    const isSelected = activeModelId === candidate.modelId || activeModelId.includes(candidate.modelId);

                    return (
                      <div
                        key={candidate.modelId}
                        id={`model-option-${candidate.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                        onClick={() => void handleSelectModel(candidate)}
                        onMouseEnter={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255, 255, 255, 0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255, 255, 255, 0.02)';
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderRadius: '5px',
                          background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                          border: isSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            <span
                              style={{
                                minWidth: 0,
                                flex: '1 1 auto',
                                fontSize: '11px',
                                fontWeight: isSelected ? 600 : 500,
                                color: isSelected ? '#ffffff' : 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {candidate.modelName}
                            </span>
                            {candidate.isFree && (
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: '8px',
                                  fontWeight: 700,
                                  padding: '0 4px',
                                  borderRadius: '2px',
                                  backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                  color: '#34d399',
                                  border: '1px solid rgba(16, 185, 129, 0.4)'
                                }}
                              >
                                FREE
                              </span>
                            )}
                            {candidate.provenance && (
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: '8px',
                                  fontWeight: 700,
                                  padding: '0 4px',
                                  borderRadius: '2px',
                                  backgroundColor:
                                    candidate.provenance === 'FCC'
                                      ? 'rgba(168, 85, 247, 0.2)'
                                      : candidate.provenance === 'your key'
                                      ? 'rgba(56, 189, 248, 0.2)'
                                      : candidate.provenance === 'anonymous'
                                      ? 'rgba(16, 185, 129, 0.2)'
                                      : candidate.provenance === 'subscription'
                                      ? 'rgba(245, 158, 11, 0.2)'
                                      : 'rgba(245, 158, 11, 0.2)',
                                  color:
                                    candidate.provenance === 'FCC'
                                      ? '#c084fc'
                                      : candidate.provenance === 'your key'
                                      ? '#38bdf8'
                                      : candidate.provenance === 'anonymous'
                                      ? '#34d399'
                                      : candidate.provenance === 'subscription'
                                      ? '#fbbf24'
                                      : '#fbbf24',
                                  border: `1px solid ${
                                    candidate.provenance === 'FCC'
                                      ? 'rgba(168, 85, 247, 0.4)'
                                      : candidate.provenance === 'your key'
                                      ? 'rgba(56, 189, 248, 0.4)'
                                      : candidate.provenance === 'anonymous'
                                      ? 'rgba(16, 185, 129, 0.4)'
                                      : candidate.provenance === 'subscription'
                                      ? 'rgba(245, 158, 11, 0.4)'
                                      : 'rgba(245, 158, 11, 0.4)'
                                  }`
                                }}
                              >
                                {candidate.provenance === 'subscription'
                                  ? (candidate.providerId?.includes('copilot') || candidate.modelId?.includes('copilot'))
                                    ? 'via your Copilot — no extra cost'
                                    : 'via your subscription — no extra cost'
                                  : candidate.provenance}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {(candidate.provenance === 'subscription' || candidate.providerId?.includes('copilot'))
                              ? 'via your Copilot — no extra cost'
                              : `via ${candidate.providerName}`}
                          </span>
                        </div>

                        {isSelected && <Check size={13} color="#38bdf8" style={{ flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
              );
            };

            const renderSection = (
              sectionKey: string,
              id: string,
              label: string,
              count: number,
              groups: { tier: ModelTier; models: RankedModelCandidate[] }[],
              headerBg: string,
              headerBorder: string,
              labelColor: string,
              hint?: React.ReactNode
            ) => {
              if (count === 0 && !hint) return null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div
                    id={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 4px',
                      borderRadius: '4px',
                      background: headerBg,
                      border: `1px solid ${headerBorder}`
                    }}
                  >
                    <span style={{ fontSize: '11px', flexShrink: 0 }}>{label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '9px', color: labelColor }}> {count > 0 ? `${count}` : ''}</span>
                  </div>
                  {hint}
                  {groups.map((g) => renderTierGroup(g.tier, g.models, `${sectionKey}-${g.tier}`))}
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Ty-Code Free — zero-friction community supply, no key required */}
                {renderSection(
                  'free',
                  'models-group-free',
                  '⚡ Ty-Code Free (No Key Required)',
                  freeTotal,
                  freeByTier,
                  'rgba(16, 185, 129, 0.08)',
                  'rgba(16, 185, 129, 0.22)',
                  'rgba(52, 211, 153, 0.75)'
                )}

                {/* Premium — unlocked with the One Key (OpenRouter) or a provider's own key */}
                {renderSection(
                  'premium',
                  'models-group-premium',
                  '🚀 Premium (Requires One Key)',
                  premiumTotal,
                  premiumByTier,
                  'rgba(245, 158, 11, 0.08)',
                  'rgba(245, 158, 11, 0.22)',
                  'rgba(251, 191, 36, 0.8)',
                  premiumTotal > 0 && premiumConnectedTotal === 0 ? (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '0 4px' }}>
                      Add your OpenRouter key once in Settings to unlock these; a provider's own key also works.
                    </div>
                  ) : undefined
                )}

                {/* Local — Ollama models running on this machine */}
                {renderSection(
                  'local',
                  'models-group-local',
                  '💻 Local (Ollama)',
                  localTotal,
                  localByTier,
                  'rgba(148, 163, 184, 0.08)',
                  'rgba(148, 163, 184, 0.22)',
                  'rgba(148, 163, 184, 0.8)',
                  localTotal === 0 ? (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '0 4px' }}>
                      Install Ollama to see fully local models here.
                    </div>
                  ) : undefined
                )}
              </div>
            );
          })()}
        </div>,
        document.body
      )}
    </div>
  );
};
