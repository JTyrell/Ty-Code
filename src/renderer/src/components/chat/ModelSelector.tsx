/**
 * Intelligent Model Selector & Dynamic Availability Picker (Phase 6.4 / Provider Series Prompt 1)
 *
 * Dynamically filters the model catalog based on actual usable status:
 * 1. ⚡ Available Now (green badge): Free models, models with valid/verified keys
 * 2. 🔒 Unlock with Key (grayed out, lock icon): Models requiring keys the user doesn't have
 *    - Clicking locked models shows a tooltip: "Add [Provider] API key in Settings to unlock" with button
 *    - Never allows selecting a model that cannot actually be used
 * 3. 💻 Local (blue badge): Ollama models (only displayed if Ollama is detected running)
 * 4. Search/filter bar at the top to quickly find models by name or provider
 * 5. Full support for "Auto (FCC decides)" and "Ty-Code Free" community tier
 * 6. Quick-switch keyboard shortcut: Ctrl+M / Cmd+M
 *
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Zap,
  Cpu,
  ChevronDown,
  Check,
  Sliders,
  Lock,
  Search,
  Clock,
  X,
  Settings as SettingsIcon,
  Monitor,
  AlertCircle
} from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { useSettingsStore } from '../../state/settings-store';
import { useActiveModelStore } from '../../state/active-model-store';
import { toast } from '../../state/toast-store';
import type { ReliabilityRouteHealth } from '../../../../shared/types/agent-events';
import type {
  ModelTier,
  RankedModelCandidate,
  RoutingPreferenceMode
} from '../../../../shared/types/model-router';
import type {
  AvailableModelConfig,
  ModelAvailabilitySummary,
  ProviderType,
  ProviderConnectivitySnapshot,
  OpencodeInstallProgress
} from '../../../../preload/types';

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
      modelId: 'openai/gpt-oss-20b',
      modelName: 'GPT OSS 20B (Groq)',
      providerId: 'groq-free',
      providerName: 'Groq',
      tier: 'tier_c_fast',
      isFree: true,
      latencyMs: 0,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 200,
      selectionReason: 'Sub-second ultra-fast execution on Groq LPUs'
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
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const communityKeyStatus = useSettingsStore((s) => s.communityKeyStatus);
  const [isOpen, setIsOpen] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingPreferenceMode>('auto');
  const [catalog, setCatalog] = useState<Record<ModelTier, RankedModelCandidate[]>>(FALLBACK_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<Record<string, ProviderConnectivitySnapshot>>({});

  // Availability-gated catalog: dynamically updated from window.electronAPI.getAvailableModels()
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
  const matchedCandidate = useMemo(() => {
    if (selectedCandidate) return selectedCandidate;
    if (!currentActiveModelId) return null;
    for (const models of Object.values(catalog)) {
      const found = models.find((m) => m.modelId === currentActiveModelId);
      if (found) return found;
    }
    return null;
  }, [selectedCandidate, currentActiveModelId, catalog]);

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

  const lastLoadedProviderRef = useRef<string | undefined>(undefined);

  // Load preferences and available models from main process on mount
  useEffect(() => {
    void loadPreferences();
    void loadAvailableCatalog();
    lastLoadedProviderRef.current = settings?.activeProvider;
  }, []);

  // Guard: only reload catalog if activeProvider actually changes (not on re-renders or token updates)
  useEffect(() => {
    if (settings?.activeProvider && settings.activeProvider !== lastLoadedProviderRef.current) {
      lastLoadedProviderRef.current = settings.activeProvider;
      void loadAvailableCatalog();
    }
  }, [settings?.activeProvider]);

  // Live progress for OpenCode CLI auto-installer
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpencodeInstallProgress?.((progress: OpencodeInstallProgress) => {
      setCliInstall((prev) => (prev.active ? { ...prev, percent: progress.percent, note: progress.message } : prev));
    });
    return () => unsubscribe?.();
  }, []);

  // Live reliability health (Autonomous Reliability, Prompt 2):
  // the ModelSelector is a READ-ONLY consumer of the Reliability Sentinel
  // snapshot. It never probes anything itself; display-only dots/countdowns.
  const [reliabilityHealth, setReliabilityHealth] = useState<{ routes: ReliabilityRouteHealth[]; updatedAt: number } | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // Per-second clock (dropdown-open only) so cooldown countdowns tick without
  // waiting for the next sentinel broadcast.
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    void window.electronAPI?.getReliabilityHealth?.().then((res) => {
      if (!disposed && res?.success && res.data) {
        setReliabilityHealth({ routes: res.data.routes, updatedAt: res.data.updatedAt });
      }
    });
    const offHealth = window.electronAPI?.onReliabilityHealth?.((snapshot) => {
      if (disposed) return;
      setReliabilityHealth({ routes: snapshot.routes, updatedAt: snapshot.updatedAt });
    });
    return () => {
      disposed = true;
      offHealth?.();
    };
  }, [isOpen]);

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
        void loadAvailableCatalog();
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
    const width = Math.max(0, Math.min(340, viewportWidth - margin * 2));
    const maxLeft = Math.max(margin, viewportWidth - margin - width);
    const left = Math.min(Math.max(margin, rect.right - width), maxLeft);
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const spaceAbove = Math.max(0, rect.top - gap - margin);
    const openBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(480, openBelow ? spaceBelow : spaceAbove);
    const top = openBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - maxHeight);

    return { top, left, width, maxHeight };
  }, []);

  const toggleDropdown = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        const pos = calculateDropdownPosition();
        if (pos) setDropdownPosition(pos);
        void loadAvailableCatalog();
      }
      return next;
    });
  };

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

  // Click outside closes the trigger and its portaled menu
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

  /**
   * Primary catalog loader: uses window.electronAPI.getAvailableModels()
   * to dynamically obtain availabilityStatus ('available' | 'key_required' | 'service_unavailable')
   */
  const loadAvailableCatalog = async () => {
    setCatalogLoading(true);
    try {
      const fetchConnStatus = async () => {
        try {
          if (window.electronAPI?.providerGetConnectionStatus) {
            return await window.electronAPI.providerGetConnectionStatus();
          }
        } catch {
          // Best-effort
        }
        return null;
      };

      const [availRes, summaryRes, catalogRes, statusRes] = await Promise.all([
        window.electronAPI?.getAvailableModels ? window.electronAPI.getAvailableModels() : Promise.resolve(null),
        window.electronAPI?.getModelAvailabilitySummary ? window.electronAPI.getModelAvailabilitySummary() : Promise.resolve(null),
        window.electronAPI?.modelRouterGetAvailableModels ? window.electronAPI.modelRouterGetAvailableModels() : Promise.resolve(null),
        fetchConnStatus()
      ]);

      if (availRes) {
        const models = Array.isArray(availRes)
          ? availRes
          : (availRes.success && Array.isArray(availRes.data) ? availRes.data : []);
        setAvailabilityList(models);
        setLockedTooltipId(null);
      }

      if (summaryRes) {
        const summary = (summaryRes as any).success && (summaryRes as any).data
          ? (summaryRes as any).data
          : summaryRes;
        if (summary && typeof summary.total === 'number') {
          setAvailabilitySummary(summary as ModelAvailabilitySummary);
        }
      }

      if (catalogRes?.success && catalogRes.data) {
        setCatalog(catalogRes.data);
      }

      if (statusRes?.success && statusRes.data) {
        setConnStatus(statusRes.data);
      }
    } catch {
      // Retain fallback catalog
    } finally {
      setCatalogLoading(false);
    }
  };

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

    // Prompt 2: annotate (never block) selections on cooling routes.
    const routeHealth = healthInfoFor(candidate.providerId, candidate.modelId);
    if (routeHealth && (routeHealth.status === 'cooling' || liveCooldownRemaining(routeHealth) > 0)) {
      toast.info(
        'Route is cooling',
        `${candidate.modelName} has been flaky. Ty-Code will silently auto-rotate to the next healthy route if it fails.`
      );
    }

    // Preserve conversation context: DO NOT clear messages, simply switch active model in settings
    const stripped = candidate.providerId.replace(/-free$/, '');
    const targetProvider = ((stripped === 'opencode-built-in' ? 'opencode' : stripped) || 'openkilo') as ProviderType;

    // NOTE: unconnected "your key" candidates no longer toast here. Main's
    // RouteEventPolicy is the single emission source for ACTIONABLE warnings
    // (once per provider per session, with the settings deep-link); this
    // component surfaces the policy notice below when the sync resolves.

    await saveSettings({
      activeModel: candidate.modelId,
      activeProvider: targetProvider
    });

    try {
      await useActiveModelStore.getState().setActiveModel(targetProvider, candidate.modelId);
    } catch {}

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
        const syncRes = await window.electronAPI.updateActiveProviderConfig({
          providerId: targetProvider,
          modelId: candidate.modelId,
          mode: useSettingsStore.getState().lockMode,
          origin: 'explicit'
        });
        // Main's RouteEventPolicy dedupes (once per provider per session).
        const notice = syncRes?.data?.notice;
        if (notice?.severity === 'warning') toast.warning(notice.title, notice.message);
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
      await useActiveModelStore.getState().setAutoMode(true);
    } catch {}

    try {
      if (window.electronAPI?.modelRouterSetPreferences) {
        await window.electronAPI.modelRouterSetPreferences({ mode: 'auto' });
      }
    } catch {}

    try {
      if (window.electronAPI?.updateActiveProviderConfig) {
        await window.electronAPI.updateActiveProviderConfig({
          providerId: 'auto',
          modelId: '',
          mode: useSettingsStore.getState().lockMode
        });
      }
    } catch {}

    setIsOpen(false);
    toast.success('Auto Enabled', 'FCC will route each message to the best managed free model');
  };

  // Pre-index the router catalog by modelId to enrich tier/latency metadata
  const catalogByModelId = useMemo(() => {
    const map = new Map<string, RankedModelCandidate>();
    for (const models of Object.values(catalog)) {
      for (const c of models || []) {
        map.set(c.modelId, c);
      }
    }
    return map;
  }, [catalog]);

  const toCandidate = useCallback((r: AvailableModelConfig): RankedModelCandidate => {
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
  }, [catalogByModelId]);

  const isLocalEntry = useCallback((r: AvailableModelConfig): boolean => {
    return /https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)/i.test(r.url) ||
      /ollama|vllm|localai|jan-|jan_|llama-cpp|ooba|text-gen|kobold|open-webui|tabbyml|cortex|llamafile|local-model/i.test(r.providerId);
  }, []);

  // Sentinel snapshot entry for a candidate (exact model first, then any
  // route on the same provider, e.g. the FCC sidecar health).
  const healthInfoFor = useCallback(
    (providerId: string, modelId: string): ReliabilityRouteHealth | null => {
      if (!reliabilityHealth || reliabilityHealth.routes.length === 0) return null;
      const p = (providerId || '').toLowerCase().trim();
      const norm = (id: string): string => (id || '').toLowerCase().trim().replace(/-free$/, '');
      const exact = reliabilityHealth.routes.find((h) => h.providerId.toLowerCase() === p && h.modelId === modelId);
      if (exact) return exact;
      return reliabilityHealth.routes.find((h) => norm(h.providerId) === norm(p)) || null;
    },
    [reliabilityHealth]
  );

  const liveCooldownRemaining = useCallback(
    (health: ReliabilityRouteHealth | null): number => {
      if (!health || !reliabilityHealth) return 0;
      const elapsedSec = Math.max(0, Math.floor((nowSec * 1000 - reliabilityHealth.updatedAt) / 1000));
      return Math.max(0, health.cooldownRemainingSec - elapsedSec);
    },
    [reliabilityHealth, nowSec]
  );

  // Filter models based on query and availability groups
  const { fccRows, availableRows, lockedRows, localRows } = useMemo(() => {
    const list = availabilityList ?? [];
    const q = modelQuery.trim().toLowerCase();
    const matches = (r: AvailableModelConfig): boolean => {
      if (!q) return true;
      return r.name.toLowerCase().includes(q) ||
        r.modelId.toLowerCase().includes(q) ||
        (r.providerName || '').toLowerCase().includes(q) ||
        r.providerId.toLowerCase().includes(q);
    };

    const isFcc = (r: AvailableModelConfig): boolean =>
      r.providerId === 'fcc' || r.providerId === 'fcc-proxy' || r.modelId.startsWith('fcc:');

    // 0. FCC Free Tier: High-priority multi-harness free fleet
    const fcc = list.filter((r) => matches(r) && isFcc(r) && r.availabilityStatus === 'available');

    // 1. Available Now: Free models, models with valid keys (excluding local running models & FCC Free Tier)
    const available = list.filter((r) => matches(r) && r.availabilityStatus === 'available' && !isLocalEntry(r) && !isFcc(r));

    // 2. Unlock with Key: Models requiring keys or services the user does not have
    const locked = list.filter((r) => matches(r) && r.availabilityStatus !== 'available' && !isLocalEntry(r));

    // 3. Local: Ollama/local models (ONLY if running/available)
    const local = list.filter((r) => matches(r) && isLocalEntry(r) && r.availabilityStatus === 'available');

    return {
      fccRows: fcc,
      availableRows: available,
      lockedRows: locked,
      localRows: local
    };
  }, [availabilityList, modelQuery, isLocalEntry]);

  const lockReason = (r: AvailableModelConfig): string => {
    if (r.availabilityStatus === 'key_required') {
      if (r.providerId === 'opencode-free') {
        return 'The OpenCode CLI is not installed. Install it with one click to use these free models.';
      }
      if (r.providerId === 'ty-code-free' || r.providerId === 'tycode-free') {
        return 'Community Key is bootstrapping — add your own OpenRouter key in Settings to unlock instantly.';
      }
      return `Add ${r.providerName} API key in Settings to unlock`;
    }
    if (r.providerId === 'fcc' || r.providerId === 'fcc-proxy') {
      return 'Start the FCC sidecar in Settings to make this model available.';
    }
    return `Start ${r.providerName} locally to make this model available.`;
  };

  const renderModelRow = (r: AvailableModelConfig, isLocked: boolean) => {
    const rowId = `${r.providerId}::${r.modelId}`;
    const isSelected = !isLocked && !isAutoMode && (
      currentActiveModelId === r.modelId || selectedCandidate?.modelId === r.modelId
    );
    const tooltipOpen = isLocked && lockedTooltipId === rowId;

    return (
      <div
        key={rowId}
        id={`model-option-${r.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
        style={{ position: 'relative' }}
      >
        <button
          type="button"
          onClick={() => {
            if (isLocked) {
              // STRICT RULE: Never allow selecting a locked model. Clicking toggles unlock tooltip.
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
            borderRadius: '6px',
            background: isSelected
              ? 'rgba(56, 189, 248, 0.16)'
              : 'transparent',
            border: isSelected
              ? '1px solid var(--accent-primary, #38bdf8)'
              : '1px solid transparent',
            boxShadow: isSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
            cursor: isLocked ? 'pointer' : 'pointer',
            opacity: isLocked ? 0.65 : 1,
            textAlign: 'left',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.background = isLocked
                ? 'rgba(255, 255, 255, 0.04)'
                : 'var(--bg-hover, rgba(255, 255, 255, 0.08))';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }
          }}
          title={isLocked ? `Locked: Click to see how to unlock ${r.name}` : r.name}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '1px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              {isLocked ? (
                <Lock size={11} color="var(--text-muted, #94a3b8)" style={{ flexShrink: 0 }} />
              ) : isLocalEntry(r) ? (
                <Monitor size={11} color="var(--accent-primary, #38bdf8)" style={{ flexShrink: 0 }} />
              ) : null}

              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '11px',
                  fontWeight: isSelected ? 600 : 500,
                  color: isLocked
                    ? 'var(--text-muted, #94a3b8)'
                    : isSelected
                    ? 'var(--accent-primary, #38bdf8)'
                    : 'var(--text-primary, #f1f5f9)'
                }}
              >
                {r.name}
              </span>

              {!isLocked && !r.requiresKey && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: '8.5px',
                    fontWeight: 700,
                    padding: '0 4px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(16, 185, 129, 0.18)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.4)'
                  }}
                >
                  FREE
                </span>
              )}

              {!isLocked && (r.providerId === 'ty-code-free' || r.providerId === 'tycode-free') && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: '8.5px',
                    fontWeight: 700,
                    padding: '0 4px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(56, 189, 248, 0.18)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)'
                  }}
                >
                  COMMUNITY
                </span>
              )}
            </div>

            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-muted, #64748b)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              via {r.providerName}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {isLocked && (
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  color: 'var(--text-muted, #64748b)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  padding: '1px 5px',
                  borderRadius: '3px'
                }}
              >
                {r.availabilityStatus === 'key_required' ? 'Key Needed' : 'Unavailable'}
              </span>
            )}
            {!isLocked && (() => {
              const health = healthInfoFor(r.providerId, r.modelId);
              if (!health || health.status === 'unknown') return null;
              const remaining = liveCooldownRemaining(health);
              const cooling = health.status === 'cooling' || remaining > 0;
              const dotColor = cooling ? '#fbbf24' : health.status === 'degraded' ? '#fb923c' : '#34d399';
              const dotTitle = cooling
                ? `Route cooling${remaining > 0 ? ` — retry in ~${remaining}s` : ''}. Ty-Code will auto-rotate if needed.`
                : `Reliability: ${health.status} · success ${Math.round(health.successRate * 100)}%${health.cachedTtftMs ? ` · TTFT ${health.cachedTtftMs}ms` : ''}`;
              return (
                <span title={dotTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                  {cooling && remaining > 0 && (
                    <span style={{ fontSize: '9px', fontWeight: 600, color: '#fbbf24' }}>{remaining}s</span>
                  )}
                </span>
              );
            })()}
            {isSelected && <Check size={13} color="var(--accent-primary, #38bdf8)" style={{ flexShrink: 0 }} />}
          </div>
        </button>

        {/* Locked Tooltip Popover with direct link to Settings */}
        {tooltipOpen && (
          <div
            id={`tooltip-locked-${r.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
            style={{
              position: 'absolute',
              left: '4px',
              right: '4px',
              top: 'calc(100% + 2px)',
              zIndex: 2200,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--surface-3, #1e293b)',
              border: '1px solid var(--accent-primary, #38bdf8)',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
              animation: 'fadeIn 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
              <AlertCircle size={13} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ fontSize: '11px', color: '#f1f5f9', lineHeight: 1.35, fontWeight: 500 }}>
                {lockReason(r)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <button
                type="button"
                id={`btn-unlock-${r.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                onClick={(e) => {
                  e.stopPropagation();
                  useChatStore.getState().openSettings('providers');
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: 'var(--accent-primary, #38bdf8)',
                  color: '#0b1220',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <SettingsIcon size={11} />
                <span>Open Settings</span>
              </button>

              {r.providerId === 'opencode-free' && (
                <button
                  type="button"
                  id="btn-opencode-install"
                  disabled={cliInstall.active}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleOpencodeCliInstall();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#38bdf8',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: cliInstall.active ? 'wait' : 'pointer'
                  }}
                >
                  {cliInstall.active ? `Installing (${Math.round(cliInstall.percent)}%)` : 'Install CLI'}
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLockedTooltipId(null);
                }}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '2px'
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSectionHeader = (
    id: string,
    title: string,
    count: number,
    colorScheme: { bg: string; border: string; text: string; badgeBg: string; badgeText: string }
  ) => {
    return (
      <div
        id={id}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderRadius: '5px',
          background: colorScheme.bg,
          border: `1px solid ${colorScheme.border}`,
          marginTop: '2px'
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: colorScheme.text }}>
          {title}
        </span>
        <span
          style={{
            fontSize: '9.5px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: '9999px',
            background: colorScheme.badgeBg,
            color: colorScheme.badgeText,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {count}
        </span>
      </div>
    );
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
          background: isOpen ? 'var(--surface-3)' : 'var(--surface-2)',
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
            <Sparkles size={11} color="var(--accent-primary, #38bdf8)" />
          ) : routingMode === 'fastest' ? (
            <Zap size={11} color="var(--accent-amber, #fbbf24)" />
          ) : routingMode === 'most_capable' ? (
            <Cpu size={11} color="var(--accent-purple, #818cf8)" />
          ) : (
            <Sliders size={11} color="var(--text-secondary, #cbd5e1)" />
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

        <ChevronDown
          size={11}
          color="var(--text-muted)"
          style={{
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease'
          }}
        />
      </button>

      {/* Portaled Dropdown Menu */}
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
            background: 'var(--bg-secondary, #0f172a)',
            border: '1px solid var(--border-default, #334155)',
            borderRadius: '8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.45)',
            zIndex: 2000,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {/* Free Tier Degraded Banner */}
          {communityKeyStatus === 'degraded' && (
            <div
              id="chip-community-key-degraded-model-selector"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                color: 'var(--accent-amber, #fbbf24)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                fontSize: '10px',
                padding: '4px 8px',
                borderRadius: '6px',
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
              background: 'var(--bg-tertiary, #1e293b)',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))'
            }}
          >
            {[
              { id: 'auto', label: 'Auto', icon: Sparkles, color: 'var(--accent-primary, #38bdf8)' },
              { id: 'fastest', label: 'Fastest', icon: Zap, color: 'var(--accent-amber, #fbbf24)' },
              { id: 'most_capable', label: 'Capable', icon: Cpu, color: 'var(--accent-purple, #818cf8)' },
              { id: 'manual', label: 'Manual', icon: Sliders, color: 'var(--text-secondary, #cbd5e1)' }
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
                    background: isSelected ? 'var(--surface-3, rgba(255, 255, 255, 0.12))' : 'transparent',
                    color: isSelected ? 'var(--text-primary, #fff)' : 'var(--text-muted, #94a3b8)',
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

          {/* Auto (FCC decides) Option */}
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
                  borderRadius: '6px',
                  background: isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'var(--surface-2, #1e293b)',
                  border: isAutoSelected ? '1px solid var(--accent-primary, #38bdf8)' : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                  boxShadow: isAutoSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'var(--bg-hover, rgba(255, 255, 255, 0.08))';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = isAutoSelected ? 'rgba(56, 189, 248, 0.16)' : 'var(--surface-2, #1e293b)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <Sparkles size={11} color="var(--accent-primary, #38bdf8)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary, #f1f5f9)' }}>
                    Auto (FCC decides)
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted, #94a3b8)', whiteSpace: 'nowrap' }}>
                    Best free model per message
                  </span>
                  {isAutoSelected && <Check size={13} color="var(--accent-primary, #38bdf8)" style={{ flexShrink: 0 }} />}
                </div>
              </div>
            );
          })()}

          {/* Search / Filter Bar */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              boxSizing: 'border-box'
            }}
          >
            <Search
              size={12}
              color="var(--text-muted, #94a3b8)"
              style={{
                position: 'absolute',
                left: '8px',
                pointerEvents: 'none'
              }}
            />
            <input
              type="text"
              id="model-search-input"
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder="Search models or providers…"
              style={{
                boxSizing: 'border-box',
                width: '100%',
                padding: '6px 26px 6px 26px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                background: 'var(--bg-primary, #0b1220)',
                color: 'var(--text-primary, #f1f5f9)',
                fontSize: '11px',
                outline: 'none'
              }}
            />
            {modelQuery && (
              <button
                type="button"
                onClick={() => setModelQuery('')}
                style={{
                  position: 'absolute',
                  right: '6px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted, #94a3b8)'
                }}
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Rate Limit Cooldown Chip */}
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
                color: 'var(--accent-amber, #fbbf24)',
                background: 'var(--surface-2, #1e293b)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))'
              }}
            >
              <Clock size={10} style={{ flexShrink: 0 }} />
              <span>
                Community Key refresh is rate limited — new keys active in {Math.ceil(availabilitySummary.communityKeyCooldownSec / 60)} min
              </span>
            </div>
          )}

          {catalogLoading && (
            <div style={{ fontSize: '9.5px', color: 'var(--text-muted, #94a3b8)', padding: '0 4px' }}>
              Syncing live model catalog…
            </div>
          )}

          {/* Grouped Model Sections */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 0. ⚡ FCC Free Tier */}
            {fccRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {renderSectionHeader('models-group-fcc', '⚡ FCC Free Tier', fccRows.length, {
                  bg: 'rgba(234, 179, 8, 0.08)',
                  border: 'rgba(234, 179, 8, 0.25)',
                  text: '#fbbf24',
                  badgeBg: '#eab308',
                  badgeText: '#000000'
                })}
                {fccRows.map((r) => renderModelRow(r, false))}
              </div>
            )}

            {/* 1. ⚡ Available Now (green badge) */}
            {availableRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {renderSectionHeader('models-group-available', '⚡ Available Now', availableRows.length, {
                  bg: 'rgba(16, 185, 129, 0.08)',
                  border: 'rgba(16, 185, 129, 0.25)',
                  text: '#34d399',
                  badgeBg: '#10b981',
                  badgeText: '#ffffff'
                })}
                {availableRows.map((r) => renderModelRow(r, false))}
              </div>
            )}

            {/* 2. 💻 Local (blue badge) — ONLY if Ollama / local backend is running */}
            {localRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {renderSectionHeader('models-group-local', '💻 Local', localRows.length, {
                  bg: 'rgba(56, 189, 248, 0.08)',
                  border: 'rgba(56, 189, 248, 0.25)',
                  text: '#38bdf8',
                  badgeBg: '#0284c7',
                  badgeText: '#ffffff'
                })}
                {localRows.map((r) => renderModelRow(r, false))}
              </div>
            )}

            {/* 3. 🔒 Unlock with Key (grayed out, lock icon) */}
            {lockedRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {renderSectionHeader('models-group-locked', '🔒 Unlock with Key', lockedRows.length, {
                  bg: 'rgba(148, 163, 184, 0.08)',
                  border: 'rgba(148, 163, 184, 0.2)',
                  text: '#94a3b8',
                  badgeBg: 'rgba(148, 163, 184, 0.25)',
                  badgeText: '#e2e8f0'
                })}
                {lockedRows.map((r) => renderModelRow(r, true))}
              </div>
            )}

            {/* Empty Search State */}
            {fccRows.length === 0 && availableRows.length === 0 && localRows.length === 0 && lockedRows.length === 0 && (
              <div
                style={{
                  padding: '16px 8px',
                  textAlign: 'center',
                  fontSize: '11px',
                  color: 'var(--text-muted, #94a3b8)'
                }}
              >
                {modelQuery ? `No models match "${modelQuery}"` : 'No models available.'}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ModelSelector;
