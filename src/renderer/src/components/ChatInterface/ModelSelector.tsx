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
  ArrowRight,
  Lock,
  Search,
  Monitor,
  Clock
} from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { useSettingsStore } from '../../state/settings-store';
import { toast } from '../../state/toast-store';
import type {
  ModelTier,
  RankedModelCandidate,
  RoutingPreferenceMode,
  RouterUserPreferences
} from '../../../../shared/types/model-router';
import type { AvailableModelConfig, ModelAvailabilitySummary, ProviderType, ProviderConnectivitySnapshot, OpencodeInstallProgress } from '../../../../preload/types';

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
      modelId: 'google/gemma-4-31b-it:free',
      modelName: 'Gemma 4 31B (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 190,
      selectionReason: 'Strong generalist with 262K context and multimodal input'
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
      modelId: 'nvidia/nemotron-3.5-super-vl:free',
      modelName: 'Nemotron 3.5 Super VL (Free)',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_b_general',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 165,
      selectionReason: '1M context multimodal generalist from NVIDIA'
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
  const communityKeyStatus = useSettingsStore((s) => s.communityKeyStatus);
  const [isOpen, setIsOpen] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingPreferenceMode>('auto');
  const [catalog, setCatalog] = useState<Record<ModelTier, RankedModelCandidate[]>>(FALLBACK_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<Record<string, ProviderConnectivitySnapshot>>({});
  // Availability-gated catalog (Provider Series Prompt 1): the picker renders
  // ONLY entries that are actually usable; locked ones render disabled with a
  // route to Settings.
  const [availabilityList, setAvailabilityList] = useState<AvailableModelConfig[] | null>(null);
  const [availabilitySummary, setAvailabilitySummary] = useState<ModelAvailabilitySummary | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [lockedTooltipId, setLockedTooltipId] = useState<string | null>(null);
  const [cliInstall, setCliInstall] = useState<{ active: boolean; percent: number; note: string | null }>({
    active: false,
    percent: 0,
    note: null
  });
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [selectedCandidate, setSelectedCandidate] = useState<RankedModelCandidate | null>(null);

  // Sync selectedCandidate when settings.activeModel changes
  useEffect(() => {
    if (settings?.activeModel) {
      for (const models of Object.values(catalog)) {
        const found = models.find((m) => m.modelId === settings.activeModel);
        if (found) {
          setSelectedCandidate(found);
          return;
        }
      }
    } else if (settings?.activeProvider === 'auto' || !settings?.activeProvider) {
      setSelectedCandidate(null);
    }
  }, [settings?.activeModel, settings?.activeProvider, catalog]);

  const currentActiveModelId = selectedCandidate?.modelId || settings?.activeModel || '';
  const activeModelId = currentActiveModelId || 'Auto';
  const isAutoMode = routingMode === 'auto' && (!selectedCandidate && (!settings?.activeModel || settings?.activeProvider === 'auto'));

  // Find candidate in catalog if available
  const matchedCandidate = (() => {
    if (selectedCandidate) return selectedCandidate;
    if (!currentActiveModelId) return null;
    for (const models of Object.values(catalog)) {
      const found = models.find((m) => m.modelId === currentActiveModelId);
      if (found) return found;
    }
    return null;
  })();

  const activeTier: ModelTier = isAutoMode
    ? 'tier_b_general'
    : (matchedCandidate?.tier || (() => {
        if (currentActiveModelId.includes('r1') || currentActiveModelId.includes('o1')) return 'tier_s_reasoning';
        if (currentActiveModelId.includes('coder') || currentActiveModelId.includes('code') || currentActiveModelId.includes('sonnet')) return 'tier_a_coding';
        if (currentActiveModelId.includes('8b') || currentActiveModelId.includes('flash')) return 'tier_c_fast';
        return 'tier_b_general';
      })());

  const currentTierInfo = TIER_LABELS[activeTier] || TIER_LABELS.tier_a_coding;
  const modelShortName = isAutoMode
    ? 'Auto'
    : matchedCandidate?.modelName || (currentActiveModelId.split('/').pop()?.replace(':free', '') || currentActiveModelId || 'Auto');

  // Load preferences and available models from main process
  useEffect(() => {
    void loadPreferences();
    void loadCatalog();
  }, []);

  // Live progress for the OpenCode CLI auto-install (opencode-free locked rows)
  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpencodeInstallProgress?.((progress: OpencodeInstallProgress) => {
      setCliInstall((prev) => (prev.active ? { ...prev, percent: progress.percent, note: progress.message } : prev));
    });
    return () => unsubscribe?.();
  }, []);

  const handleOpencodeCliInstall = async (): Promise<void> => {
    const api = window.electronAPI;
    if (cliInstall.active) return;
    if (!api?.opencodeInstall) {
      setCliInstall({ active: false, percent: 0, note: 'Installer unavailable in this build.' });
      return;
    }
    setCliInstall({ active: true, percent: 0, note: 'Starting installer...' });
    try {
      const res = await api.opencodeInstall();
      if (res.success && res.data) {
        setCliInstall({ active: false, percent: 100, note: res.data.alreadyInstalled ? 'OpenCode CLI was already installed.' : 'Installed. Refreshing free models...' });
        setLockedTooltipId(null);
        void loadCatalog();
        setTimeout(() => setCliInstall({ active: false, percent: 0, note: null }), 3000);
      } else {
        setCliInstall({ active: false, percent: 0, note: res.error || 'OpenCode CLI installation failed.' });
      }
    } catch (err: unknown) {
      setCliInstall({ active: false, percent: 0, note: err instanceof Error ? err.message : String(err) });
    }
  };

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

        const [catalogRes, availRes, summaryRes, statusRes] = await Promise.all([
          window.electronAPI.modelRouterGetAvailableModels(),
          window.electronAPI.getAvailableModels ? window.electronAPI.getAvailableModels() : Promise.resolve(null),
          window.electronAPI.getModelAvailabilitySummary ? window.electronAPI.getModelAvailabilitySummary() : Promise.resolve(null),
          fetchConnStatus()
        ]);
        if (catalogRes.success && catalogRes.data) {
          setCatalog(catalogRes.data);
        }
        if (availRes && (availRes as any).success && Array.isArray((availRes as any).data)) {
          setAvailabilityList((availRes as any).data as AvailableModelConfig[]);
          setLockedTooltipId(null);
        }
        if (summaryRes && (summaryRes as any).success && (summaryRes as any).data) {
          setAvailabilitySummary((summaryRes as any).data as ModelAvailabilitySummary);
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
    setSelectedCandidate(candidate);
    setRoutingMode('manual');

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

    try {
      if (window.electronAPI?.modelRouterSetPreferences) {
        await window.electronAPI.modelRouterSetPreferences({
          mode: 'manual',
          manualModelId: candidate.modelId,
          manualProviderId: candidate.providerId
        });
      }
    } catch {}

    try {
      if (window.electronAPI?.updateActiveProviderConfig) {
        await window.electronAPI.updateActiveProviderConfig({
          providerId: targetProvider,
          modelId: candidate.modelId
        });
      }
    } catch {}

    setIsOpen(false);
    toast.success('Model Switched', `Now chatting with ${candidate.modelName} (${TIER_LABELS[candidate.tier].name})`);
  };

  const handleSelectAuto = async () => {
    setSelectedCandidate(null);
    setRoutingMode('auto');

    // Return to the "Auto" binding: FCC decides the concrete free provider/model
    // per request (free-first, key-safe handoff). No manual override left behind.
    await saveSettings({ activeModel: '', activeProvider: 'auto' });
    try {
      if (window.electronAPI?.modelRouterSetPreferences) {
        await window.electronAPI.modelRouterSetPreferences({ mode: 'auto' });
      }
    } catch {}

    try {
      if (window.electronAPI?.updateActiveProviderConfig) {
        await window.electronAPI.updateActiveProviderConfig({
          providerId: 'auto',
          modelId: ''
        });
      }
    } catch {}

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
            maxWidth: '120px',
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
          {communityKeyStatus === 'degraded' && (
            <div
              id="chip-community-key-degraded-model-selector"
              className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-[10px] px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                color: '#facc15',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                fontSize: '10px',
                padding: '3px 8px',
                borderRadius: '9999px',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                lineHeight: '1.2'
              }}
            >
              ⚠️ Free Tier Rate Limited (Using Anonymous Fallback)
            </div>
          )}

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
            const isAutoSelected = isAutoMode;
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
                  background: isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(56, 189, 248, 0.04)',
                  border: isAutoSelected ? '1px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.15)',
                  boxShadow: isAutoSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease'
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(56, 189, 248, 0.1)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(56, 189, 248, 0.04)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <Sparkles size={11} color="#38bdf8" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#ffffff' }}>Auto (FCC decides)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    Best free model per message
                  </span>
                  {isAutoSelected && <Check size={13} color="#38bdf8" style={{ flexShrink: 0 }} />}
                </div>
              </div>
            );
          })()}

          {/* Search + Availability-gated list (Provider Series Prompt 1):
              every row natively verified against keys/services; locked rows cannot be selected. */}
          <input
            type="text"
            id="model-search-input"
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
            placeholder="Search models or providers…"
            style={{
              boxSizing: 'border-box',
              width: '100%',
              padding: '5px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '11px',
              outline: 'none'
            }}
          />

          {availabilitySummary && availabilitySummary.communityKeyCooldownSec > 0 && (
            <div
              id="community-key-cooldown-chip"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '9.5px',
                fontWeight: 600,
                color: 'var(--accent-amber)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <Clock size={10} style={{ flexShrink: 0 }} />
              <span>Community Key refresh is rate limited - new keys live again in {Math.ceil(availabilitySummary.communityKeyCooldownSec / 60)} min</span>
            </div>
          )}

          {(() => {
            const availability = availabilityList ?? [];
            // Router-catalog enrichment: tier + provenance by model id.
            const catalogByModelId = new Map<string, RankedModelCandidate>();
            for (const models of Object.values(catalog)) {
              for (const c of models || []) catalogByModelId.set(c.modelId, c);
            }

            const q = modelQuery.trim().toLowerCase();
            const matches = (r: AvailableModelConfig): boolean =>
              !q ||
              r.name.toLowerCase().includes(q) ||
              r.modelId.toLowerCase().includes(q) ||
              (r.providerName || '').toLowerCase().includes(q) ||
              r.providerId.toLowerCase().includes(q);

            const isLocalEntry = (r: AvailableModelConfig): boolean =>
              /https?:\/\/(127\.0\.0\.1|localhost)/i.test(r.url) ||
              /ollama|vllm|localai|jan-|jan_|llama-cpp|ooba|text-gen|kobold|open-webui|tabbyml|cortex|llamafile|local-model/i.test(r.providerId);

            const availableRows = availability.filter((r) => matches(r) && r.availabilityStatus === 'available' && !isLocalEntry(r));
            const lockedRows = availability.filter((r) => matches(r) && r.availabilityStatus !== 'available' && !isLocalEntry(r));
            const localRows = availability.filter((r) => matches(r) && isLocalEntry(r) && r.availabilityStatus === 'available');

            const toCandidate = (r: AvailableModelConfig): RankedModelCandidate => {
              const enriched = catalogByModelId.get(r.modelId);
              return {
                modelId: r.modelId,
                modelName: r.name,
                providerId: r.providerId,
                providerName: r.providerName,
                tier: enriched?.tier || 'tier_b_general',
                isFree: !r.requiresKey,
                latencyMs: enriched?.latencyMs ?? 0,
                healthScore: enriched?.healthScore ?? 1,
                isRateLimited: false,
                estimatedRemainingTokens: enriched?.estimatedRemainingTokens,
                compositeRankScore: enriched?.compositeRankScore ?? 100,
                selectionReason: enriched?.selectionReason || `Verified available via ${r.providerName}`,
                provenance: enriched?.provenance
              };
            };

            const lockReason = (r: AvailableModelConfig): string => {
              if (r.availabilityStatus === 'key_required') {
                if (r.providerId === 'opencode-free') {
                  return 'The OpenCode CLI is not installed. Install it with one click to use these free models.';
                }
                if (r.providerId === 'ty-code-free' || r.providerId === 'tycode-free') {
                  return 'Community Key is bootstrapping - retry in a moment, or add your own OpenRouter key in Settings to unlock instantly.';
                }
                return `Add ${r.providerName} API key in Settings to unlock`;
              }
              if (r.providerId === 'fcc' || r.providerId === 'fcc-proxy') {
                return 'Start the FCC sidecar in Settings to make this model available.';
              }
              if (r.providerId === 'opencode-free') {
                return 'The OpenCode CLI is not installed. Install it with one click to use these free models.';
              }
              return `Start ${r.providerName} locally to make this model available.`;
            };

            const renderRow = (r: AvailableModelConfig, locked: boolean) => {
              const rowId = `${r.providerId}::${r.modelId}`;
              const isSelected = !locked && !isAutoMode && (
                currentActiveModelId === r.modelId || selectedCandidate?.modelId === r.modelId
              );
              const tooltipOpen = locked && lockedTooltipId === rowId;

              return (
                <div key={rowId} id={`model-option-${r.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                  style={{ position: 'relative' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (locked) {
                        setLockedTooltipId(tooltipOpen ? null : rowId);
                        return;
                      }
                      void handleSelectModel(toCandidate(r));
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      boxSizing: 'border-box',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.02)',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                      boxShadow: isSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                      cursor: locked ? 'help' : 'pointer',
                      opacity: locked ? 0.75 : 1,
                      textAlign: 'left',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        {locked && <Lock size={10} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
                        <span
                          style={{
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '11px',
                            fontWeight: isSelected ? 600 : 500,
                            color: locked ? 'var(--text-muted)' : isSelected ? '#ffffff' : 'var(--text-primary)'
                          }}
                        >
                          {r.name}
                        </span>
                        {!locked && !r.requiresKey && (
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
                        {!locked && r.providerId === 'ty-code-free' && (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: '8px',
                              fontWeight: 700,
                              padding: '0 4px',
                              borderRadius: '2px',
                              backgroundColor: 'rgba(56, 189, 248, 0.2)',
                              color: '#38bdf8',
                              border: '1px solid rgba(56, 189, 248, 0.4)'
                            }}
                          >
                            COMMUNITY
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        via {r.providerName}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {locked && (
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {r.availabilityStatus === 'key_required' ? 'locked' : 'offline'}
                        </span>
                      )}
                      {isSelected && <Check size={13} color="#38bdf8" style={{ flexShrink: 0 }} />}
                    </div>
                  </button>

                  {tooltipOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        left: '8px',
                        right: '8px',
                        top: 'calc(100% - 2px)',
                        zIndex: 2100,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '8px',
                        borderRadius: '6px',
                        background: '#1b1f2b',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.5)'
                      }}
                    >
                      <span style={{ fontSize: '10.5px', color: 'var(--text-primary)' }}>{lockReason(r)}</span>
                      {r.providerId === 'opencode-free' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <button
                            type="button"
                            id="btn-opencode-install"
                            disabled={cliInstall.active}
                            onClick={() => void handleOpencodeCliInstall()}
                            style={{
                              alignSelf: 'flex-start',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              border: 'none',
                              background: '#38bdf8',
                              color: '#0b1220',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: cliInstall.active ? 'wait' : 'pointer',
                              opacity: cliInstall.active ? 0.7 : 1
                            }}
                          >
                            {cliInstall.active ? `Installing (${Math.round(cliInstall.percent)}%)` : 'Install CLI for me'}
                          </button>
                          {(cliInstall.active || cliInstall.note) && (
                            <span
                              style={{
                                fontSize: '9.5px',
                                color: 'var(--text-muted)',
                                maxWidth: '240px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: cliInstall.active ? 'nowrap' : 'normal'
                              }}
                            >
                              {cliInstall.note}
                            </span>
                          )}
                        </div>
                      )}
                      {r.availabilityStatus === 'key_required' && (
                        <button
                          type="button"
                          id={`btn-unlock-${r.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                          onClick={() => {
                            useChatStore.getState().openSettings('providers');
                            setIsOpen(false);
                          }}
                          style={{
                            alignSelf: 'flex-start',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: 'none',
                            background: '#38bdf8',
                            color: '#0b1220',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Open Settings
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            const renderSection = (
              sectionKey: string,
              id: string,
              label: string,
              rows: AvailableModelConfig[],
              opts: { bg: string; border: string; labelColor: string; hint?: string; count: number }
            ) => {
              if (rows.length === 0 && !opts.hint) return null;
              return (
                <div key={sectionKey} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    id={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 4px',
                      borderRadius: '4px',
                      background: opts.bg,
                      border: `1px solid ${opts.border}`
                    }}
                  >
                    <span style={{ fontSize: '11px', flexShrink: 0 }}>{label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '9px', color: opts.labelColor, fontVariantNumeric: 'tabular-nums' }}>
                      {rows.length > 0 ? `${rows.length}` : ''}
                    </span>
                  </div>
                  {opts.hint && rows.length === 0 && (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '0 4px' }}>{opts.hint}</div>
                  )}
                  {rows.map((r) => renderRow(r, r.availabilityStatus !== 'available'))}
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* ⚡ Available Now — free tier, community-keyed tier and keyed providers with a resolvable key */}
                {renderSection('available', 'models-group-free', '⚡ Available Now', availableRows, {
                  count: availableRows.length,
                  bg: 'rgba(16, 185, 129, 0.08)',
                  border: 'rgba(16, 185, 129, 0.22)',
                  labelColor: 'rgba(52, 211, 153, 0.75)',
                  hint: 'No models are currently usable. Add a provider key in Settings or start a local backend.'
                })}

                {/* 🔒 Unlock with Key — requires keys or services the user doesn't have yet */}
                {renderSection('locked', 'models-group-locked', '🔒 Locked (Needs key or service)', lockedRows, {
                  count: lockedRows.length,
                  bg: 'rgba(148, 163, 184, 0.06)',
                  border: 'rgba(148, 163, 184, 0.16)',
                  labelColor: 'var(--text-muted)',
                })}

                {/* 💻 Local — only models whose local backend answered (Ollama etc.) */}
                {renderSection('local', 'models-group-local', '💻 Local (running backend)', localRows, {
                  count: localRows.length,
                  bg: 'rgba(56, 189, 248, 0.08)',
                  border: 'rgba(56, 189, 248, 0.22)',
                  labelColor: 'rgba(125, 211, 252, 0.85)',
                  hint: 'Install + run Ollama (or another local backend) to see local models here.'
                })}
              </div>
            );
          })()}
        </div>,
        document.body
      )}
    </div>
  );
};
