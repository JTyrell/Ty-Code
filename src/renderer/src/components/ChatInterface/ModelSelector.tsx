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
  ShieldCheck,
  Clock,
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
import type { ProviderType } from '../../../../preload/types';

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
      modelId: 'deepseek/deepseek-r1:free',
      modelName: 'DeepSeek R1 (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_s_reasoning',
      isFree: true,
      latencyMs: 850,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 180,
      selectionReason: 'Deep architectural and multi-step reasoning'
    },
    {
      modelId: 'deepseek/deepseek-r1-0528:free',
      modelName: 'DeepSeek R1 0528 (Kilo Gateway)',
      providerId: 'openkilo-free',
      providerName: 'OpenKilo',
      tier: 'tier_s_reasoning',
      isFree: true,
      latencyMs: 650,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 185,
      selectionReason: 'High-availability Kilo reasoning endpoint'
    }
  ],
  tier_a_coding: [
    {
      modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
      modelName: 'Qwen 2.5 Coder 32B Instruct',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 420,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 175,
      selectionReason: 'Exceptional code generation and component authoring'
    },
    {
      modelId: 'qwen/qwen3-coder:free',
      modelName: 'Qwen 3 Coder (Kilo Gateway)',
      providerId: 'openkilo-free',
      providerName: 'OpenKilo',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 380,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 180,
      selectionReason: 'Massive 262K context code specialist'
    },
    {
      modelId: 'llama-3.3-70b-versatile',
      modelName: 'Llama 3.3 70B Versatile (Groq)',
      providerId: 'groq-free',
      providerName: 'Groq',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 140,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 190,
      selectionReason: 'Ultra-fast 70B inference engine'
    }
  ],
  tier_b_general: [
    {
      modelId: 'meta-llama/llama-3.3-70b-instruct:free',
      modelName: 'Llama 3.3 70B Instruct',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_b_general',
      isFree: true,
      latencyMs: 350,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 160,
      selectionReason: 'Balanced conversation and technical explanations'
    },
    {
      modelId: 'gemini-1.5-flash',
      modelName: 'Gemini 1.5 Flash (AI Studio)',
      providerId: 'google-ai-studio-free',
      providerName: 'Google AI Studio',
      tier: 'tier_b_general',
      isFree: true,
      latencyMs: 260,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 165,
      selectionReason: 'High-speed multimodal intelligence'
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
      latencyMs: 80,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 200,
      selectionReason: 'Sub-100ms ultra-fast execution'
    },
    {
      modelId: 'gemini-2.0-flash-exp',
      modelName: 'Gemini 2.0 Flash Exp',
      providerId: 'google-ai-studio-free',
      providerName: 'Google AI Studio',
      tier: 'tier_c_fast',
      isFree: true,
      latencyMs: 110,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 195,
      selectionReason: 'Experimental ultra-responsive flash model'
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
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeModelId = settings?.activeModel || 'qwen/qwen-2.5-coder-32b-instruct:free';
  const activeProvider = settings?.activeProvider || 'openrouter';

  // Determine active tier based on active model
  const activeTier: ModelTier = (() => {
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
  const modelShortName = activeModelId.split('/').pop()?.replace(':free', '') || activeModelId;

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
    try {
      if (window.electronAPI?.modelRouterGetAvailableModels) {
        const res = await window.electronAPI.modelRouterGetAvailableModels();
        if (res.success && res.data) {
          setCatalog(res.data);
        }
      }
    } catch {
      // Keep fallback
    }
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
    const targetProvider = (candidate.providerId.replace('-free', '') as ProviderType) || 'openrouter';

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

          {/* Grouped Models List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(Object.keys(catalog) as ModelTier[]).map((tierKey) => {
              const tierInfo = TIER_LABELS[tierKey];
              const modelsInTier = catalog[tierKey] || [];
              if (modelsInTier.length === 0) return null;

              return (
                <div key={tierKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
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

                  {modelsInTier.map((candidate) => {
                    const isSelected = activeModelId === candidate.modelId || activeModelId.includes(candidate.modelId);

                    return (
                      <div
                        key={candidate.modelId}
                        id={`model-option-${candidate.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                        onClick={() => void handleSelectModel(candidate)}
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
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            via {candidate.providerName} • ~{candidate.latencyMs}ms
                          </span>
                        </div>

                        {isSelected && <Check size={13} color="#38bdf8" style={{ flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
