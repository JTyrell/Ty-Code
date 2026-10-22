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
  Loader2
} from 'lucide-react';
import { toast } from '../../state/toast-store';
import { useSettingsStore, TY_CODE_FREE_PROVIDER } from '../../state/settings-store';
import { ModelCatalogVerifierPanel } from './ModelCatalogVerifierPanel';
import type { VerifiedModelCatalogSummary } from '../../../../preload/types';

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
  badge?: { label: string; tone: 'green' | 'amber' | 'zinc' };
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
  // Route premium OpenRouter entries and their free-flavored aliases through
  // the One-Key channel; everything else keeps its catalog providerId.
  if (providerId === 'openrouter-free') return 'openrouter';
  return providerId;
}

export function ProvidersModelsTab({ onOpenApiKeys, onOpenByok, onOpenProviderSetup, onOpenWizard }: ProvidersModelsTabProps) {
  const [catalog, setCatalog] = useState<VerifiedModelCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openSections, setOpenSections] = useState<Record<CatalogSection['id'], boolean>>({
    free: true,
    premium: true,
    local: true
  });

  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (!window.electronAPI?.getVerifiedModelCatalog) {
        throw new Error('Catalog bridge unavailable in this build.');
      }
      const response = await window.electronAPI.getVerifiedModelCatalog();
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
    // Catalog order already puts the default free model first; keep it.
    return [
      {
        id: 'free',
        title: 'Ty-Code Free (Zero Configuration)',
        subtitle: 'Rotating Community Key, provisioned instantly. Zero setup, zero telemetry.',
        models: free,
        badge: catalog.communityKeyCached
          ? { label: 'Community Key ready', tone: 'green' }
          : { label: 'Provisioning Community Key...', tone: 'amber' }
      },
      {
        id: 'premium',
        title: 'Premium (One-Key Access)',
        subtitle: 'One OpenRouter key unlocks the full premium lineup via the ProviderGateway bridge.',
        models: premium,
        badge: catalog.openRouterKeyAvailable
          ? { label: 'One-Key active', tone: 'green' }
          : { label: 'Key needed', tone: 'amber' }
      },
      {
        id: 'local',
        title: 'Local (Ollama)',
        subtitle: '100% private offline inference on localhost:11434.',
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
    // One-Key Premium bridge: an OpenRouter key covers the premium lineup.
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

  const handleSelect = (model: CatalogModel): void => {
    if (isModelLocked(model)) {
      toast.warning(
        model.providerId === 'openrouter' ? 'One-Key Access required' : 'Provider key required',
        `${model.name} needs a key before the ProviderGateway can route it. Add it in API Keys.`,
        { label: 'Open API Keys', onClick: onOpenApiKeys }
      );
      return;
    }
    // Instant, no Save button: the unified settings store syncs to main
    // through the providers:update-active-config IPC channel on change.
    setActiveProvider(providerIdForSelection(model.providerId), model.modelId);
    toast.success('Model Activated', `${model.name} is now served by the ProviderGateway.`);
  };

  const toggleSection = (id: CatalogSection['id']): void => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const badgeTone: Record<'green' | 'amber' | 'zinc', string> = {
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    zinc: 'bg-zinc-600/20 text-zinc-400 border-zinc-600/30'
  };

  const sectionIcon: Record<CatalogSection['id'], React.ReactNode> = {
    free: <Zap size={14} className="text-emerald-400" />,
    premium: <Rocket size={14} className="text-purple-400" />,
    local: <Laptop size={14} className="text-cyan-400" />
  };

  return (
    <div className="flex flex-col gap-4 text-zinc-200" id="providers-models-tab">
      {/* Header row: title + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">AI Providers &amp; Models</h3>
          <p className="text-xs text-zinc-500">
            Verified catalog served by the local ProviderGateway. Click a card to activate instantly; changes save and
            route without a Save button.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refreshCatalog()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/70 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/70 transition-colors cursor-pointer"
            id="btn-refresh-model-catalog"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            onClick={onOpenProviderSetup}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/70 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/70 transition-colors cursor-pointer"
            id="btn-open-provider-config-modal"
          >
            Configure &amp; Test Provider
          </button>
          <button
            onClick={onOpenWizard}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer"
          >
            Re-run Setup Wizard
          </button>
        </div>
      </div>

      {/* Gateway status pill */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${gatewayPill.ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]'}`}
            id="gateway-status-dot"
          />
          <span className={`text-xs font-semibold ${gatewayPill.ok ? 'text-emerald-300' : 'text-rose-300'}`} id="gateway-status-label">
            {gatewayPill.ok ? '🟢 Gateway Ready' : `🔴 ${gatewayPill.label}`}
          </span>
          <span className="text-[11px] text-zinc-500 hidden sm:inline">Routing runs locally; Zero-Telemetry, nothing leaves this device.</span>
        </div>
        {gatewayPill.actionable && (
          <button
            onClick={onOpenApiKeys}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 transition-colors cursor-pointer"
            id="btn-gateway-open-api-keys"
          >
            Add Key in API Keys
          </button>
        )}
      </div>

      {/* Load errors */}
      {loadError && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 text-xs">
          <AlertTriangle size={14} className="text-rose-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-rose-300">Catalog unavailable</div>
            <div className="text-rose-200/80">{loadError}</div>
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.map((section) => {
        const isOpen = openSections[section.id] || (section.id === 'local' && catalog?.ollamaConnected);
        return (
          <div key={section.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-zinc-900/90 hover:bg-zinc-800/70 transition-colors cursor-pointer select-none"
              id={`section-toggle-${section.id}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {sectionIcon[section.id]}
                <span className="text-sm font-semibold text-white text-left">{section.title}</span>
                {section.badge && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeTone[section.badge.tone]}`}>
                    {section.badge.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-zinc-500">{section.models.length} models</span>
                {isOpen ? <ChevronDown size={15} className="text-zinc-500" /> : <ChevronRight size={15} className="text-zinc-500" />}
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-1">
                <p className="text-[11px] text-zinc-500 mb-3">{section.subtitle}</p>
                {section.models.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-4 rounded-lg bg-zinc-900/70 border border-dashed border-zinc-700 text-xs text-zinc-500">
                    {section.id === 'local' ? (
                      <>
                        <Cpu size={14} className="text-zinc-600" />
                        <span>
                          No Ollama models detected. Install from{' '}
                          <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline hover:text-cyan-300">
                            ollama.com
                          </a>{' '}
                          and refresh.
                        </span>
                      </>
                    ) : (
                      <>No models available yet. Hit Refresh.</>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {section.models.map((model) => {
                      const isActive =
                        model.modelId === activeModelId && providerIdForSelection(model.providerId) === activeProviderId;
                      const locked = isModelLocked(model);
                      return (
                        <div
                          key={`${model.providerId}|${model.modelId}`}
                          onClick={() => handleSelect(model)}
                          role="radio"
                          aria-checked={isActive}
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSelect(model);
                            }
                          }}
                          className={`group flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isActive
                              ? 'bg-indigo-500/10 border-indigo-500/40 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]'
                              : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50'
                          } ${locked ? 'opacity-70' : ''}`}
                          id={`model-card-${model.providerId}-${model.modelId.replace(/[^a-z0-9-]/gi, '_')}`}
                        >
                          {/* Left: name + provider tag */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-zinc-200'}`}>
                                {model.name}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                  <Check size={10} />
                                  Active
                                </span>
                              )}
                              {locked && (
                                <span
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-700/30 text-zinc-400 border border-zinc-600/40"
                                  title="Requires a key; the ProviderGateway needs it before routing."
                                >
                                  <Lock size={10} />
                                  {model.providerId === 'openrouter' ? 'One-Key Access' : 'Key required'}
                                </span>
                              )}
                            </div>
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-medium text-zinc-400 border border-zinc-700">
                              {providerTag(model.providerId)}
                            </span>
                          </div>

                          {/* Right: radio indicator driven by the unified store */}
                          <span
                            className={`flex items-center justify-center w-[18px] h-[18px] rounded-full border-2 shrink-0 transition-all ${
                              isActive ? 'border-indigo-400 bg-indigo-500' : 'border-zinc-600 group-hover:border-zinc-400'
                            }`}
                          >
                            {isActive && <Check size={11} className="text-white" strokeWidth={3} />}
                          </span>
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

      {/* Catalog self-healing (collapsed by default to keep the tab clean) */}
      <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <summary className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-900/90 cursor-pointer select-none">
          <span className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <ShieldCheck size={14} className="text-cyan-400" />
            Model Catalog Verifier
          </span>
          <span className="text-[11px] text-zinc-500">Live /models corrections for the provider &amp; models database</span>
        </summary>
        <div className="px-4 pb-4 pt-2">
          <ModelCatalogVerifierPanel />
        </div>
      </details>

      {/* Advanced alias routing: BYOK vault + custom endpoints */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 flex-wrap">
        <p className="text-[11px] text-zinc-500">
          Advanced BYOK providers, custom OpenAI-compatible endpoints and key vaults live in their dedicated tabs.
        </p>
        <button
          onClick={onOpenByok}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          Open BYOK &amp; Keys
        </button>
      </div>

      {/* Attribution (kept from the previous tab) */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/70 text-[11px] text-zinc-500">
        <Rocket size={12} className="text-indigo-400 shrink-0" />
        <span>
          Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
          <a
            href="https://github.com/Alishahryar1/free-claude-code"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 underline hover:text-zinc-300"
          >
            github.com/Alishahryar1/free-claude-code
          </a>
        </span>
      </div>
    </div>
  );
}
