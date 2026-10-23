import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Zap,
  Rocket,
  Laptop,
  ChevronDown,
  ChevronRight,
  Check,
  Lock,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Cpu,
  Loader2,
  Search,
  X,
  Sparkles,
  Layers,
  Brain,
  Code2,
  Eye,
  Sliders
} from 'lucide-react';
import { toast } from '../../state/toast-store';
import { useSettingsStore, TY_CODE_FREE_PROVIDER } from '../../state/settings-store';
import { ModelCatalogVerifierPanel } from './ModelCatalogVerifierPanel';
import type { VerifiedModelCatalogSummary } from '../../../../preload/types';
import './ProvidersModelsTab.css';

type CatalogModel = VerifiedModelCatalogSummary['models'][number];

interface ProvidersModelsTabProps {
  onOpenApiKeys: () => void;
  onOpenByok: () => void;
  onOpenProviderSetup: () => void;
  onOpenWizard: () => void;
}

interface CatalogSection {
  id: 'free' | 'premium' | 'local';
  title: string;
  subtitle: string;
  models: CatalogModel[];
  badge?: { label: string; tone: 'green' | 'amber' | 'zinc' | 'blue' };
}

const PROVIDER_TAG_LABELS: Record<string, string> = {
  'ty-code-free': 'Ty-Code Free',
  openrouter: 'OpenRouter',
  'openrouter-free': 'OpenRouter',
  openkilo: 'OpenKilo',
  'openkilo-free': 'OpenKilo',
  ollama: 'Ollama (local)',
  'fcc-proxy': 'FCC Proxy',
  opencode: 'OpenCode Zen',
  groq: 'Groq',
  'google-ai-studio': 'Google AI Studio',
  'anthropic-claude-free': 'FCC Claude Free'
};

function providerTag(providerId: string): string {
  const key = providerId.replace(/-free$/, '');
  return PROVIDER_TAG_LABELS[providerId] || PROVIDER_TAG_LABELS[key] || providerId.replace(/\b\w/g, (c) => c.toUpperCase());
}

function providerIdForSelection(providerId: string): string {
  if (providerId === 'openrouter-free') return 'openrouter';
  return providerId;
}

// Brand visuals for AI providers: curated colors & icons
function getProviderBrand(providerId: string, modelName: string) {
  const lowerName = modelName.toLowerCase();
  const lowerProv = providerId.toLowerCase();

  if (lowerProv.includes('claude') || lowerName.includes('claude')) {
    return {
      bg: 'linear-gradient(135deg, rgba(234, 88, 12, 0.2) 0%, rgba(194, 65, 12, 0.35) 100%)',
      color: '#fb923c',
      border: 'rgba(249, 115, 22, 0.35)',
      initial: 'CL',
      brand: 'Anthropic'
    };
  }
  if (lowerProv.includes('openai') || lowerName.includes('gpt') || lowerName.includes('o1') || lowerName.includes('o3')) {
    return {
      bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.35) 100%)',
      color: '#34d399',
      border: 'rgba(16, 185, 129, 0.35)',
      initial: 'AI',
      brand: 'OpenAI'
    };
  }
  if (lowerProv.includes('google') || lowerName.includes('gemini')) {
    return {
      bg: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.35) 100%)',
      color: '#a78bfa',
      border: 'rgba(139, 92, 246, 0.35)',
      initial: 'GE',
      brand: 'Google Gemini'
    };
  }
  if (lowerProv.includes('deepseek') || lowerName.includes('deepseek')) {
    return {
      bg: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(14, 116, 144, 0.35) 100%)',
      color: '#22d3ee',
      border: 'rgba(6, 182, 212, 0.35)',
      initial: 'DS',
      brand: 'DeepSeek'
    };
  }
  if (lowerProv.includes('llama') || lowerName.includes('llama')) {
    return {
      bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(29, 78, 216, 0.35) 100%)',
      color: '#60a5fa',
      border: 'rgba(59, 130, 246, 0.35)',
      initial: 'LL',
      brand: 'Meta'
    };
  }
  if (lowerProv.includes('groq')) {
    return {
      bg: 'linear-gradient(135deg, rgba(249, 115, 22, 0.2) 0%, rgba(234, 88, 12, 0.35) 100%)',
      color: '#fb923c',
      border: 'rgba(249, 115, 22, 0.35)',
      initial: 'GQ',
      brand: 'Groq'
    };
  }
  if (lowerProv.includes('mistral') || lowerName.includes('mistral') || lowerName.includes('codestral')) {
    return {
      bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.35) 100%)',
      color: '#fcd34d',
      border: 'rgba(245, 158, 11, 0.35)',
      initial: 'MS',
      brand: 'Mistral'
    };
  }
  if (lowerProv.includes('qwen') || lowerName.includes('qwen')) {
    return {
      bg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(79, 70, 229, 0.35) 100%)',
      color: '#818cf8',
      border: 'rgba(99, 102, 241, 0.35)',
      initial: 'QW',
      brand: 'Qwen'
    };
  }
  if (lowerProv.includes('ollama')) {
    return {
      bg: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(71, 85, 105, 0.35) 100%)',
      color: '#67e8f9',
      border: 'rgba(6, 182, 212, 0.35)',
      initial: 'OL',
      brand: 'Ollama'
    };
  }
  if (lowerProv.includes('openkilo')) {
    return {
      bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(4, 120, 87, 0.35) 100%)',
      color: '#6ee7b7',
      border: 'rgba(16, 185, 129, 0.35)',
      initial: 'OK',
      brand: 'OpenKilo'
    };
  }
  if (lowerProv.includes('ty-code') || lowerProv.includes('free')) {
    return {
      bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(99, 102, 241, 0.3) 100%)',
      color: '#34d399',
      border: 'rgba(52, 211, 153, 0.35)',
      initial: 'TY',
      brand: 'Ty-Code Free'
    };
  }
  // Default fallback brand
  return {
    bg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(126, 34, 206, 0.35) 100%)',
    color: '#c084fc',
    border: 'rgba(168, 85, 247, 0.35)',
    initial: 'AI',
    brand: 'OpenRouter'
  };
}

// Model capability badges & specs
function getModelBadges(model: CatalogModel) {
  const badges: { text: string; type: 'reasoning' | 'coding' | 'context' | 'vision' | 'fast' }[] = [];
  const lowerId = model.modelId.toLowerCase();
  const lowerName = model.name.toLowerCase();

  if (lowerId.includes('r1') || lowerName.includes('reason') || lowerId.includes('o1') || lowerId.includes('o3') || lowerName.includes('thinking')) {
    badges.push({ text: '🧠 Reasoning', type: 'reasoning' });
  }
  if (lowerId.includes('coder') || lowerName.includes('coder') || lowerId.includes('sonnet') || lowerId.includes('deepseek')) {
    badges.push({ text: '💻 Code', type: 'coding' });
  }
  if (lowerId.includes('gemini') || lowerName.includes('gemini') || lowerId.includes('1m')) {
    badges.push({ text: '1M Ctx', type: 'context' });
  } else if (lowerId.includes('sonnet') || lowerId.includes('claude')) {
    badges.push({ text: '200k Ctx', type: 'context' });
  } else if (lowerId.includes('4o') || lowerId.includes('llama') || lowerId.includes('qwen')) {
    badges.push({ text: '128k Ctx', type: 'context' });
  }
  if (lowerId.includes('vision') || lowerId.includes('4o') || lowerId.includes('flash') || lowerId.includes('sonnet')) {
    badges.push({ text: '👁️ Vision', type: 'vision' });
  }
  if (lowerId.includes('groq') || lowerId.includes('flash') || lowerId.includes('mini')) {
    badges.push({ text: '⚡ Ultra-Fast', type: 'fast' });
  }

  return badges;
}

export function ProvidersModelsTab({ onOpenApiKeys, onOpenByok, onOpenProviderSetup, onOpenWizard }: ProvidersModelsTabProps) {
  const [catalog, setCatalog] = useState<VerifiedModelCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'free' | 'premium' | 'local' | 'reasoning' | 'coding'>('all');
  const [openSections, setOpenSections] = useState<Record<CatalogSection['id'], boolean>>({
    free: true,
    premium: true,
    local: true
  });

  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const setActiveModel = useSettingsStore((s) => s.setActiveModel);

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (!window.electronAPI?.getVerifiedModels) {
        throw new Error('Catalog bridge unavailable in this build.');
      }
      const response = await window.electronAPI.getVerifiedModels();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'ProviderGateway catalog could not be loaded.');
      }
      setCatalog(response.data);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const sections: CatalogSection[] = useMemo(() => {
    if (!catalog) return [];
    const isFreeEntry = (m: CatalogModel): boolean =>
      m.providerId === TY_CODE_FREE_PROVIDER ||
      (m.modelId.endsWith(':free') && m.providerId.startsWith('openrouter')) ||
      (!m.requiresKey && m.providerId !== 'ollama');
    const free = catalog.models.filter(isFreeEntry);
    const local = catalog.models.filter((m) => m.providerId === 'ollama');
    const freeOrLocalIds = new Set([...free, ...local].map((m) => m.modelId + '|' + m.providerId));
    const premium = catalog.models.filter((m) => {
      const key = `${m.modelId}|${m.providerId}`;
      return !freeOrLocalIds.has(key) && !key.includes('|ollama');
    });

    return [
      {
        id: 'free',
        title: 'Ty-Code Free (Zero Configuration)',
        subtitle: 'Rotating Community Key provisioned instantly. Zero setup, zero telemetry, full offline-safe routing.',
        models: free,
        badge: catalog.communityKeyCached
          ? { label: 'Active & Ready', tone: 'green' }
          : { label: 'Provisioning Community Key...', tone: 'amber' }
      },
      {
        id: 'premium',
        title: 'Premium (One-Key Access)',
        subtitle: 'One OpenRouter key unlocks Claude 3.7 Sonnet, GPT-4o, DeepSeek-R1, and Gemini via ProviderGateway.',
        models: premium,
        badge: catalog.openRouterKeyAvailable
          ? { label: 'One-Key Active', tone: 'green' }
          : { label: 'Key Needed', tone: 'amber' }
      },
      {
        id: 'local',
        title: 'Local (Ollama Offline)',
        subtitle: '100% private offline inference on localhost:11434. No keys, no network calls.',
        models: local,
        badge: catalog.ollamaConnected
          ? { label: 'Connected', tone: 'green' }
          : { label: 'Disconnected', tone: 'zinc' }
      }
    ];
  }, [catalog]);

  const isModelLocked = (model: CatalogModel): boolean => {
    if (!catalog || !model.requiresKey) return false;
    if (model.providerId === TY_CODE_FREE_PROVIDER) return !catalog.communityKeyCached;
    if (model.providerId === 'openrouter') return !catalog.openRouterKeyAvailable;
    const norm = model.providerId.replace(/-free$/, '');
    if (catalog.providerKeyConfigured[model.providerId] || catalog.providerKeyConfigured[norm]) return false;
    return !catalog.openRouterKeyAvailable;
  };

  const gatewayPill = useMemo(() => {
    if (!catalog) {
      return { ok: false, label: 'Loading ProviderGateway catalog...', actionable: false };
    }
    const activeProvider = activeProviderId || '';
    if (activeProvider === TY_CODE_FREE_PROVIDER) {
      return catalog.communityKeyCached
        ? { ok: true, label: 'Gateway Ready', actionable: false }
        : { ok: false, label: 'Provisioning Community Key', actionable: false };
    }
    if (activeProvider === 'auto' || activeProvider === 'openkilo' || activeProvider === 'openkilo-free' || activeProvider === 'fcc-proxy' || activeProvider === 'ollama') {
      return { ok: true, label: 'Gateway Ready', actionable: false };
    }
    const activeModel = catalog.models.find((m) => m.modelId === activeModelId);
    const providerId = activeModel?.providerId || activeProvider;
    const norm = providerId.replace(/-free$/, '');
    const ownKey = catalog.providerKeyConfigured[providerId] || catalog.providerKeyConfigured[norm];
    const covered = ownKey || (catalog.openRouterKeyAvailable && ['openrouter', 'openai', 'anthropic', 'claude', 'deepseek', 'qwen'].includes(norm));
    if (covered) return { ok: true, label: 'Gateway Ready', actionable: false };
    return { ok: false, label: `Key Missing: ${providerTag(providerId)}`, actionable: true };
  }, [catalog, activeProviderId, activeModelId]);

  // Currently active model details
  const currentActiveModel = useMemo(() => {
    if (!catalog) return null;
    return catalog.models.find(
      (m) => m.modelId === activeModelId && providerIdForSelection(m.providerId) === activeProviderId
    ) || catalog.models.find((m) => m.modelId === activeModelId) || null;
  }, [catalog, activeModelId, activeProviderId]);

  const handleSelect = (model: CatalogModel): void => {
    if (isModelLocked(model)) {
      toast.warning(
        model.providerId === 'openrouter' ? 'One-Key Access required' : 'Provider key required',
        `${model.name} needs a key before the ProviderGateway can route it. Add it in API Keys.`,
        { label: 'Open API Keys', onClick: onOpenApiKeys }
      );
      return;
    }
    const selectionProviderId = providerIdForSelection(model.providerId);
    setActiveProvider(selectionProviderId, model.modelId);
    setActiveModel(model.modelId);
    toast.success('Model Activated', `${model.name} is now served by the ProviderGateway.`);
  };

  const toggleSection = (id: CatalogSection['id']): void => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter models based on search query & active category filter
  const filterModels = (models: CatalogModel[], sectionId: CatalogSection['id']) => {
    return models.filter((m) => {
      // Category filter
      if (activeFilter === 'free' && sectionId !== 'free') return false;
      if (activeFilter === 'premium' && sectionId !== 'premium') return false;
      if (activeFilter === 'local' && sectionId !== 'local') return false;
      if (activeFilter === 'reasoning') {
        const isReason = m.modelId.toLowerCase().includes('r1') || m.name.toLowerCase().includes('reason') || m.modelId.toLowerCase().includes('o1') || m.modelId.toLowerCase().includes('o3');
        if (!isReason) return false;
      }
      if (activeFilter === 'coding') {
        const isCode = m.modelId.toLowerCase().includes('coder') || m.name.toLowerCase().includes('coder') || m.modelId.toLowerCase().includes('sonnet') || m.modelId.toLowerCase().includes('deepseek');
        if (!isCode) return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        providerTag(m.providerId).toLowerCase().includes(q)
      );
    });
  };

  const totalModelCount = useMemo(() => {
    return catalog?.models.length || 0;
  }, [catalog]);

  return (
    <div className="pm-container" id="providers-models-tab">
      {/* ---------------------------------------------------------------------
          Hero Active Model & Gateway Status Banner
          --------------------------------------------------------------------- */}
      <div className="pm-hero-card">
        <div className="pm-hero-header">
          <div className="pm-hero-info">
            <div className="pm-hero-title-row">
              <h3 className="pm-hero-title">
                <Sparkles size={18} color="#818cf8" />
                AI Providers &amp; Models
              </h3>
              <span className="pm-hero-badge">
                <span
                  id="gateway-status-dot"
                  className="w-2 h-2 rounded-full inline-block"
                  style={{
                    backgroundColor: gatewayPill.ok ? '#10b981' : '#f43f5e',
                    boxShadow: gatewayPill.ok ? '0 0 8px #10b981' : '0 0 8px #f43f5e'
                  }}
                />
                <span id="gateway-status-label">
                  {gatewayPill.ok ? 'Gateway Ready' : gatewayPill.label}
                </span>
              </span>
            </div>
            <p className="pm-hero-desc">
              High-performance model routing served directly by Ty-Code ProviderGateway. Click any model to activate
              instantly — changes apply across chat, inline completions, and agents with zero friction.
            </p>
          </div>

          <div className="pm-hero-actions">
            <button
              onClick={() => void refreshCatalog()}
              disabled={loading}
              className="pm-btn pm-btn-secondary"
              id="btn-refresh-model-catalog"
              title="Refresh provider database and live connectivity"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>Refresh</span>
            </button>
            <button
              onClick={onOpenProviderSetup}
              className="pm-btn pm-btn-secondary"
              id="btn-open-provider-config-modal"
              title="Configure custom endpoint or test keys"
            >
              <Sliders size={13} />
              <span>Configure Provider</span>
            </button>
            <button
              onClick={onOpenWizard}
              className="pm-btn pm-btn-primary"
              title="Launch the Onboarding & Setup Wizard"
            >
              <Rocket size={13} />
              <span>Setup Wizard</span>
            </button>
          </div>
        </div>

        {/* Spotlight: Currently Active Engine Card */}
        {currentActiveModel && (
          <div className="pm-spotlight">
            <div className="pm-spotlight-left">
              {(() => {
                const brand = getProviderBrand(currentActiveModel.providerId, currentActiveModel.name);
                return (
                  <div
                    className="pm-provider-avatar"
                    style={{
                      background: brand.bg,
                      color: brand.color,
                      border: `1px solid ${brand.border}`
                    }}
                  >
                    {brand.initial}
                  </div>
                );
              })()}
              <div className="pm-spotlight-details">
                <span className="pm-spotlight-label">Active AI Engine in Chat &amp; Agents</span>
                <div className="pm-spotlight-name">
                  <span>{currentActiveModel.name}</span>
                  <span className="pm-spotlight-provider-pill">{providerTag(currentActiveModel.providerId)}</span>
                </div>
              </div>
            </div>

            <div className="pm-spotlight-meta">
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <span className="pm-spotlight-status-dot" />
                Live Routing Active
              </span>
              <span className="text-[11px] text-zinc-500">
                Localhost Bridge &bull; Zero-Telemetry
              </span>
            </div>
          </div>
        )}

        {gatewayPill.actionable && (
          <div className="mt-3 flex items-center justify-between p-3 rounded-lg bg-rose-950/20 border border-rose-500/30 text-xs">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
              <span>{gatewayPill.label}. Please add your key to enable routing.</span>
            </div>
            <button
              onClick={onOpenApiKeys}
              id="btn-gateway-open-api-keys"
              className="pm-btn pm-btn-secondary text-rose-200 border-rose-500/40 hover:bg-rose-500/20"
            >
              Add Key in API Keys
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------------
          Search & Quick Filter Bar
          --------------------------------------------------------------------- */}
      <div className="pm-toolbar">
        <div className="pm-search-box">
          <Search size={14} className="pm-search-icon" />
          <input
            type="text"
            className="pm-search-input"
            placeholder={`Search ${totalModelCount} models (e.g. Claude, GPT, DeepSeek, 200k)...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="pm-search-clear" onClick={() => setSearchQuery('')} title="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="pm-filter-pills">
          <button
            className={`pm-filter-pill ${activeFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All Models ({totalModelCount})
          </button>
          <button
            className={`pm-filter-pill ${activeFilter === 'free' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('free')}
          >
            ⚡ Free Tier
          </button>
          <button
            className={`pm-filter-pill ${activeFilter === 'premium' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('premium')}
          >
            🚀 Premium
          </button>
          <button
            className={`pm-filter-pill ${activeFilter === 'local' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('local')}
          >
            💻 Local (Ollama)
          </button>
          <button
            className={`pm-filter-pill ${activeFilter === 'reasoning' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('reasoning')}
          >
            🧠 Reasoning
          </button>
          <button
            className={`pm-filter-pill ${activeFilter === 'coding' ? 'is-active' : ''}`}
            onClick={() => setActiveFilter('coding')}
          >
            🛠️ Coding
          </button>
        </div>
      </div>

      {/* Load error banner */}
      {loadError && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-950/25 border border-rose-500/35 text-xs text-rose-200">
          <AlertTriangle size={16} className="text-rose-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-rose-300">Catalog Unavailable</div>
            <div className="opacity-90 mt-0.5">{loadError}</div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          Categorized Tier Sections (Free, Premium, Local)
          --------------------------------------------------------------------- */}
      {sections.map((section) => {
        const filteredModels = filterModels(section.models, section.id);
        const isOpen = openSections[section.id] || (section.id === 'local' && catalog?.ollamaConnected);

        if (filteredModels.length === 0 && (activeFilter === section.id || searchQuery)) {
          // If searching or filtering and no matches in this section, hide or collapse
          if (activeFilter === section.id && searchQuery) {
            return (
              <div key={section.id} className="pm-empty-state">
                <span>No models matched &ldquo;{searchQuery}&rdquo; in {section.title}</span>
              </div>
            );
          }
        }

        const sectionIcon =
          section.id === 'free' ? (
            <div className="pm-section-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
              <Zap size={15} />
            </div>
          ) : section.id === 'premium' ? (
            <div className="pm-section-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa' }}>
              <Rocket size={15} />
            </div>
          ) : (
            <div className="pm-section-icon" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee' }}>
              <Laptop size={15} />
            </div>
          );

        return (
          <div key={section.id} className="pm-section">
            <button
              onClick={() => toggleSection(section.id)}
              className="pm-section-header"
              id={`section-toggle-${section.id}`}
            >
              <div className="pm-section-title-wrap">
                {sectionIcon}
                <span className="pm-section-title">{section.title}</span>
                {section.badge && (
                  <span
                    id={`section-badge-${section.id}`}
                    className={`pm-section-badge ${
                      section.badge.tone === 'green'
                        ? 'pm-badge-green'
                        : section.badge.tone === 'amber'
                          ? 'pm-badge-amber'
                          : 'pm-badge-zinc'
                    }`}
                  >
                    {section.badge.label}
                  </span>
                )}
              </div>

              <div className="pm-section-meta">
                <span>{filteredModels.length} {filteredModels.length === 1 ? 'model' : 'models'}</span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
            </button>

            {isOpen && (
              <div className="pm-section-body">
                <p className="pm-section-subtitle">{section.subtitle}</p>

                {filteredModels.length === 0 ? (
                  <div className="pm-empty-state">
                    {section.id === 'local' ? (
                      <>
                        <Cpu size={16} className="text-zinc-500" />
                        <span>
                          No Ollama models detected. Install Ollama from{' '}
                          <a
                            href="https://ollama.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 underline hover:text-cyan-300 font-semibold"
                          >
                            ollama.com
                          </a>{' '}
                          and run <code>ollama run qwen2.5-coder</code> to enable local inference.
                        </span>
                      </>
                    ) : (
                      <span>No models available for the selected filter. Try clearing filters or refreshing.</span>
                    )}
                  </div>
                ) : (
                  <div className="pm-cards-grid">
                    {filteredModels.map((model) => {
                      const isActive =
                        model.modelId === activeModelId &&
                        providerIdForSelection(model.providerId) === activeProviderId;
                      const locked = isModelLocked(model);
                      const brand = getProviderBrand(model.providerId, model.name);
                      const badges = getModelBadges(model);

                      return (
                        <div
                          key={`${model.providerId}|${model.modelId}`}
                          onClick={() => handleSelect(model)}
                          role="radio"
                          aria-checked={isActive}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelect(model);
                            }
                          }}
                          className={`pm-model-card ${isActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
                          id={`model-card-${model.providerId}-${model.modelId.replace(/[^a-z0-9-]/gi, '_')}`}
                        >
                          <div className="pm-card-left">
                            <div
                              className="pm-card-brand-icon"
                              style={{
                                background: brand.bg,
                                color: brand.color,
                                border: `1px solid ${brand.border}`
                              }}
                              title={brand.brand}
                            >
                              {brand.initial}
                            </div>

                            <div className="pm-card-info">
                              <div className="pm-card-name-row">
                                <span className="pm-card-title" title={model.name}>
                                  {model.name}
                                </span>
                                {isActive && (
                                  <span className="pm-active-pill">
                                    <Check size={9} strokeWidth={3} />
                                    Active
                                  </span>
                                )}
                                {locked && (
                                  <span
                                    className="pm-locked-pill"
                                    title="Requires API key in API Keys tab before ProviderGateway can route it."
                                  >
                                    <Lock size={9} />
                                    {model.providerId === 'openrouter' ? 'One-Key' : 'Key Req'}
                                  </span>
                                )}
                              </div>

                              <div className="pm-card-tags-row">
                                <span className="pm-provider-tag">{providerTag(model.providerId)}</span>
                                {badges.map((b, i) => (
                                  <span
                                    key={i}
                                    className={`pm-spec-chip ${
                                      b.type === 'reasoning'
                                        ? 'pm-chip-reasoning'
                                        : b.type === 'coding'
                                          ? 'pm-chip-coding'
                                          : b.type === 'context'
                                            ? 'pm-chip-context'
                                            : b.type === 'vision'
                                              ? 'pm-chip-vision'
                                              : 'pm-chip-fast'
                                    }`}
                                  >
                                    {b.text}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pm-card-right">
                            <div className="pm-radio-indicator">
                              {isActive && <Check size={12} color="#ffffff" strokeWidth={3.5} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ---------------------------------------------------------------------
          Model Catalog Live Verifier (Collapsible Panel)
          --------------------------------------------------------------------- */}
      <details className="pm-section" style={{ background: 'rgba(16, 20, 32, 0.7)' }}>
        <summary className="pm-section-header" style={{ cursor: 'pointer' }}>
          <div className="pm-section-title-wrap">
            <div className="pm-section-icon" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee' }}>
              <ShieldCheck size={15} />
            </div>
            <span className="pm-section-title">Model Catalog Live Verifier</span>
            <span className="pm-section-badge pm-section-badge-blue">Auto-Healing Database</span>
          </div>
          <span className="text-xs text-zinc-400">Live /models sanity probe</span>
        </summary>
        <div className="pm-section-body">
          <ModelCatalogVerifierPanel onCorrectionsApplied={() => void refreshCatalog()} />
        </div>
      </details>

      {/* ---------------------------------------------------------------------
          Navigation to BYOK & Keys Vault
          --------------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Layers size={15} className="text-purple-400" />
          <p className="text-xs text-zinc-400 m-0">
            Advanced custom OpenAI endpoints, BYOK vaults, and token quota tracking live in their dedicated tabs.
          </p>
        </div>
        <button
          onClick={onOpenByok}
          className="pm-btn pm-btn-secondary text-xs"
        >
          Open BYOK &amp; Keys
        </button>
      </div>

      {/* ---------------------------------------------------------------------
          Permanent FCC Attribution Credit Invariant
          --------------------------------------------------------------------- */}
      <div className="pm-attribution-strip">
        <Rocket size={13} className="text-indigo-400 shrink-0" />
        <span>
          Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
          <a
            href="https://github.com/Alishahryar1/free-claude-code"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://github.com/Alishahryar1/free-claude-code
          </a>
        </span>
      </div>
    </div>
  );
}
