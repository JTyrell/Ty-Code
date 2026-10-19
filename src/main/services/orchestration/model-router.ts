/**
 * Intelligent Model Router (Phase 6.4)
 *
 * Implements the 6-step multi-factor model selection and auto-failover algorithm:
 * 1. Classify task type from user message (complex_reasoning, code_generation, etc.)
 * 2. Identify best model tier for that task (Tier S, Tier A, Tier B, Tier C)
 * 3. Filter to available models in that tier (healthy, not rate-limited, not cooling down)
 * 4. Rank candidates by:
 *    (a) User preference (Auto, Fastest, Most Capable, Preferred Provider, Manual)
 *    (b) Provider health score (success rate, uptime)
 *    (c) Network latency (ms)
 *    (d) Quota remaining
 * 5. Select top-ranked model
 * 6. If top model fails, auto-failover to next ranked candidate seamlessly
 *
 * Brand: Ty-Code
 */

import type {
  ModelTier,
  FreeProviderId,
  ProviderHealthStatus
} from '../../../shared/types/free-providers';
import type {
  ModelRoutingDecision,
  RankedModelCandidate,
  RouterUserPreferences,
  RoutingPreferenceMode,
  TaskClassificationResult
} from '../../../shared/types/model-router';
import { taskClassifier } from './task-classifier';
import { userPreferences } from './user-preferences';
import { providerHealthMonitor } from '../providers/health-monitor';
import { MODEL_TIERS } from '../providers/model-classifier';
import { freeProviderRegistry } from '../providers/free-provider-registry';
import { quotaTracker } from './quota-tracker';
import { fccCatalogSync } from '../fcc/catalog-sync';
import { fccIntegrityChecker } from './fcc-integrity';
import { getVerifiedModels, type VerifiedModelConfig } from '../verified-models';
import { providerHasOwnKey } from '../../providers/provider-gateway';

export interface ModelCatalogEntry {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  tier: ModelTier;
  isFree: boolean;
  baseLatencyMs: number;
  provenance?: 'FCC' | 'your key' | 'anonymous' | 'subscription';
}

export const ROUTER_MODEL_CATALOG: ModelCatalogEntry[] = [
  // Tier S: Complex Reasoning & Planning
  {
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    modelName: 'NVIDIA Nemotron 3 Ultra (Free)',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_s_reasoning',
    isFree: true,
    baseLatencyMs: 850
  },
  {
    modelId: 'kilo-auto/free',
    modelName: 'Kilo Auto (Free Router)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_s_reasoning',
    isFree: true,
    baseLatencyMs: 650
  },
  {
    modelId: 'poolside/laguna-s-2.1:free',
    modelName: 'Poolside Laguna S 2.1 (Kilo Gateway)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_a_coding',
    isFree: true,
    baseLatencyMs: 380
  },
  {
    modelId: 'openrouter/free',
    modelName: 'OpenRouter Free (Kilo Gateway)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 400
  },
  {
    modelId: 'llama-3.3-70b-versatile',
    modelName: 'Llama 3.3 70B Versatile (Groq Ultra-Fast)',
    providerId: 'groq-free',
    providerName: 'Groq',
    tier: 'tier_a_coding',
    isFree: true,
    baseLatencyMs: 140
  },
  {
    modelId: 'claude-3-5-sonnet-20241022',
    modelName: 'Claude 3.5 Sonnet (FCC Proxy)',
    providerId: 'anthropic-claude-free',
    providerName: 'FCC Proxy',
    tier: 'tier_a_coding',
    isFree: true,
    baseLatencyMs: 780
  },

  // Tier B: General Conversation & Assistance
  {
    modelId: 'dots-studio/dots-3-note-preview:free',
    modelName: 'Dots 3 Note Preview (Free)',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 350
  },
  {
    modelId: 'thinkingmachines/inkling-small:free',
    modelName: 'Inkling Small (Kilo Gateway)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 390
  },
  {
    modelId: 'gemini-1.5-flash',
    modelName: 'Gemini 1.5 Flash (AI Studio)',
    providerId: 'google-ai-studio-free',
    providerName: 'Google AI Studio',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 260
  },

  // Tier C: Quick Responses & Ultra-Fast Confirmation
  {
    modelId: 'llama-3.1-8b-instant',
    modelName: 'Llama 3.1 8B Instant (Groq)',
    providerId: 'groq-free',
    providerName: 'Groq',
    tier: 'tier_c_fast',
    isFree: true,
    baseLatencyMs: 80
  },
  {
    modelId: 'gemini-2.0-flash-exp',
    modelName: 'Gemini 2.0 Flash Exp (AI Studio)',
    providerId: 'google-ai-studio-free',
    providerName: 'Google AI Studio',
    tier: 'tier_c_fast',
    isFree: true,
    baseLatencyMs: 110
  }
];

export class ModelRouter {
  private static instance: ModelRouter;

  private supplementalCache: ModelCatalogEntry[] | null = null;
  private supplementalCacheAt = 0;

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  /** Heuristic tier mapping for verified entries that lack FCC capability metadata. */
  private static classifyTierFromId(modelId: string, name: string): ModelTier {
    const hay = `${modelId} ${name}`.toLowerCase();
    if (/reason|think|-r1|o1-|ultra|opus|maverick|405b|550b|70b/.test(hay)) return 'tier_s_reasoning';
    if (/coder|code|laguna|north|starcoder|deepseek/.test(hay)) return 'tier_a_coding';
    if (/8b|mini|instant|flash|lightning|small|fast|turbo/.test(hay)) return 'tier_c_fast';
    return 'tier_b_general';
  }

  private static providerDisplayName(providerId: string): string {
    switch ((providerId || '').toLowerCase()) {
      case 'openkilo': case 'openkilo-free': return 'OpenKilo';
      case 'opencode': case 'opencode-free': return 'OpenCode Zen';
      case 'openrouter': case 'openrouter-free': return 'OpenRouter';
      case 'groq': case 'groq-free': return 'Groq';
      case 'google-ai-studio': case 'google-ai-studio-free': return 'Google AI Studio';
      case 'ollama': return 'Ollama (local)';
      default: return providerId.replace(/-free$/, '');
    }
  }

  private static baseLatencyFor(providerId: string): number {
    const id = (providerId || '').toLowerCase();
    if (id === 'ollama' || id.startsWith('ollama')) return 60;
    if (id.startsWith('groq')) return 140;
    if (id.startsWith('opencode')) return 320;
    if (id.startsWith('openkilo')) return 400;
    if (id.startsWith('google-ai-studio')) return 260;
    return 380;
  }

  /**
   * Live backend supply bridge: models actually loaded in the gateway
   * (verified-models.ts = FCC + OpenKilo + OpenCode Zen + preconfigured + Ollama)
   * that the FCC catalog block does not already cover. 20s cache.
   */
  public async getVerifiedSupplementalEntries(force = false): Promise<ModelCatalogEntry[]> {
    if (!force && this.supplementalCache && Date.now() - this.supplementalCacheAt < 20_000) {
      return this.supplementalCache;
    }

    const fccModelIds = new Set<string>();
    try {
      for (const provider of fccCatalogSync.getCatalog() || []) {
        for (const model of provider.models || []) fccModelIds.add(model.id);
      }
    } catch {
      // FCC service unavailable — supplement everything from verified supply
    }

    const verified = await getVerifiedModels().catch(() => [] as VerifiedModelConfig[]);
    const supplemental: ModelCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const vm of verified) {
      const key = `${(vm.providerId || '').toLowerCase()}::${vm.modelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (fccModelIds.has(vm.modelId)) continue;

      supplemental.push({
        modelId: vm.modelId,
        modelName: vm.name || vm.modelId,
        providerId: vm.providerId,
        providerName: ModelRouter.providerDisplayName(vm.providerId),
        tier: ModelRouter.classifyTierFromId(vm.modelId, vm.name || ''),
        isFree: !vm.requiresKey || (vm.providerId || '').toLowerCase().includes('opencode'),
        baseLatencyMs: ModelRouter.baseLatencyFor(vm.providerId),
        provenance: vm.requiresKey ? 'your key' : 'anonymous'
      });
    }

    this.supplementalCache = supplemental;
    this.supplementalCacheAt = Date.now();
    return supplemental;
  }

  /**
   * Main selection algorithm: selects best available model for given prompt and preferences.
   */
  public async selectModel(
    prompt: string,
    overridePreferences?: Partial<RouterUserPreferences>
  ): Promise<ModelRoutingDecision> {
    const prefs = {
      ...(await userPreferences.getPreferences()),
      ...(overridePreferences || {})
    };

    // 1. Classify task type from prompt
    const classification = taskClassifier.classify(prompt);

    // 2. Identify target tier based on preference mode and classification
    let targetTier = classification.bestTier;
    if (prefs.mode === 'most_capable') {
      targetTier = 'tier_s_reasoning';
    } else if (prefs.mode === 'fastest') {
      targetTier = 'tier_c_fast';
    }

    // 3. Get candidate models (curated registry + live verified backend supply)
    const supplemental = await this.getVerifiedSupplementalEntries();
    const seenCatIds = new Set<string>();
    const allModels = [...ROUTER_MODEL_CATALOG, ...supplemental].filter((entry) => {
      if (seenCatIds.has(entry.modelId)) return false;
      seenCatIds.add(entry.modelId);
      return true;
    });

    // Filter to available candidates (not rate-limited, healthy)
    const availableCandidates = allModels.filter((entry) => {
      const health = providerHealthMonitor.getProviderHealth(entry.providerId);
      if (health.isRateLimited) {
        if (health.cooldownUntil && Date.now() < health.cooldownUntil) return false;
      }
      if (health.autoDisabled) return false;
      return true;
    });

    const candidatePool = availableCandidates.length > 0 ? availableCandidates : allModels;

    // FCC policy: default ranking is FREE-first. Paid models become routable
    // only when the user supplies their own key for that provider (BYOK).
    const freePool = prefs.preferFreeModels === false
      ? candidatePool
      : filterRoutableFreeFirst(candidatePool);

    const ranked = (freePool.length > 0 ? freePool : candidatePool).map((entry) => {
      return this.scoreCandidate(entry, targetTier, prefs);
    });

    // Sort descending by compositeRankScore
    ranked.sort((a, b) => b.compositeRankScore - a.compositeRankScore);

    // 5. Select top-ranked model
    const topCandidate = ranked[0] || this.getFallbackDefault();
    const fallbackList = ranked.slice(1);

    return {
      selectedModel: topCandidate,
      fallbackCandidates: fallbackList,
      taskClassification: classification,
      appliedPreferenceMode: prefs.mode,
      timestamp: Date.now()
    };
  }

  /**
   * Computes a multi-factor composite rank score for a model candidate.
   */
  private scoreCandidate(
    entry: ModelCatalogEntry,
    targetTier: ModelTier,
    prefs: RouterUserPreferences
  ): RankedModelCandidate {
    const health = providerHealthMonitor.getProviderHealth(entry.providerId);
    let score = 100;

    // Factor 1: Tier match
    if (entry.tier === targetTier) {
      score += 50;
    } else if (targetTier === 'tier_s_reasoning' && entry.tier === 'tier_a_coding') {
      score += 25; // Tier A is a strong fallback for Tier S
    } else if (targetTier === 'tier_a_coding' && entry.tier === 'tier_s_reasoning') {
      score += 35; // Tier S can easily do Tier A tasks
    }

    // Factor 2: Latency (lower latency gives higher points, up to +30)
    const effectiveLatency = health.latencyMs || entry.baseLatencyMs;
    const latencyBonus = Math.max(0, 30 - Math.floor(effectiveLatency / 40));
    score += latencyBonus;

    // Factor 3: Provider Health (success rate up to +20)
    const successRate = typeof health.successRate === 'number' ? health.successRate : 1.0;
    score += successRate * 20;

    // Factor 4: User Preference adjustments
    if (prefs.mode === 'manual' && prefs.manualModelId === entry.modelId) {
      score += 500; // Strongest priority when user manually specified model
    }
    if (prefs.mode === 'preferred_provider' && prefs.preferredProviderId === entry.providerId) {
      score += 100;
    }
    if (prefs.mode === 'fastest') {
      // Massive weight on low latency
      score += Math.max(0, 200 - (effectiveLatency / 5));
    }
    if (prefs.mode === 'most_capable') {
      if (entry.tier === 'tier_s_reasoning') score += 150;
      if (entry.tier === 'tier_a_coding') score += 75;
    }

    // Factor 5: Quota remaining
    const quota = quotaTracker.getProviderQuota(entry.providerId);
    if (quota && quota.monthlyFreeTokens > 0) {
      const remainingPercent = quota.remainingTokens / quota.monthlyFreeTokens;
      score += Math.max(0, remainingPercent * 10);
    }

    let selectionReason = `Matched tier ${entry.tier} with ${effectiveLatency}ms latency`;
    if (prefs.mode === 'manual' && prefs.manualModelId === entry.modelId) {
      selectionReason = 'Manual user selection';
    } else if (prefs.mode === 'fastest') {
      selectionReason = `Optimized for speed (${effectiveLatency}ms latency)`;
    } else if (prefs.mode === 'most_capable') {
      selectionReason = `Optimized for maximum reasoning capability (${entry.tier})`;
    } else if (prefs.mode === 'preferred_provider' && prefs.preferredProviderId === entry.providerId) {
      selectionReason = `Preferred provider boost for ${entry.providerName}`;
    }

    return {
      modelId: entry.modelId,
      modelName: entry.modelName,
      providerId: entry.providerId,
      providerName: entry.providerName,
      tier: entry.tier,
      isFree: entry.isFree,
      latencyMs: effectiveLatency,
      healthScore: successRate,
      isRateLimited: health.isRateLimited,
      compositeRankScore: Math.round(score),
      selectionReason,
      provenance: entry.provenance || 'your key'
    };
  }

  /**
   * Retrieves the next fallback candidate after a failure on currentModelId.
   */
  public getNextFallback(
    decision: ModelRoutingDecision,
    failedModelId: string
  ): RankedModelCandidate | null {
    // Record failure in health monitor
    const failedCandidate = [decision.selectedModel, ...decision.fallbackCandidates].find(
      (c) => c.modelId === failedModelId
    );
    if (failedCandidate) {
      providerHealthMonitor.recordFailure(failedCandidate.providerId, 'Auto-failover triggered by router');
    }

    const availableFallbacks = decision.fallbackCandidates.filter(
      (c) => c.modelId !== failedModelId && !c.isRateLimited
    );

    return availableFallbacks[0] || null;
  }

  /**
   * Executes a prompt/query with automated failover logic across ranked candidates.
   */
  public async executeWithAutoFailover<T>(
    prompt: string,
    runner: (candidate: RankedModelCandidate) => Promise<T>,
    overridePreferences?: Partial<RouterUserPreferences>
  ): Promise<{ result: T; selectedModel: RankedModelCandidate; failoverHistory: string[] }> {
    const decision = await this.selectModel(prompt, overridePreferences);
    const candidatesToTry = [decision.selectedModel, ...decision.fallbackCandidates];
    const failoverHistory: string[] = [];

    const maxTries = overridePreferences?.maxFailoverAttempts || 3;
    let lastError: unknown;

    for (let i = 0; i < Math.min(candidatesToTry.length, maxTries); i++) {
      const candidate = candidatesToTry[i];
      try {
        const result = await runner(candidate);
        providerHealthMonitor.recordSuccess(candidate.providerId, candidate.latencyMs);
        return {
          result,
          selectedModel: candidate,
          failoverHistory
        };
      } catch (err: unknown) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        failoverHistory.push(`Model ${candidate.modelId} failed: ${errMsg}`);
        providerHealthMonitor.recordFailure(candidate.providerId, errMsg);
      }
    }

    throw new Error(
      `All ${candidatesToTry.length} model candidates failed in auto-failover sequence. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  /**
   * Returns all available models in the catalog, optionally grouped by tier.
   * ModelSelector primary source = FCC catalog (61 providers); native registry merges as secondary;
   * provenance badges: 'FCC', 'your key', 'anonymous', 'subscription'.
   * If FCC is unavailable or disabled: graceful instant fallback to native registry + anonymous in <2s.
   */
  public async getCatalogGroupedByTier(): Promise<Record<ModelTier, RankedModelCandidate[]>> {
    const defaultPrefs: RouterUserPreferences = {
      mode: 'auto',
      autoFailoverEnabled: true,
      maxFailoverAttempts: 3,
      preferFreeModels: true
    };

    const grouped: Record<ModelTier, RankedModelCandidate[]> = {
      tier_s_reasoning: [],
      tier_a_coding: [],
      tier_b_general: [],
      tier_c_fast: []
    };

    const seenModelIds = new Set<string>();

    // 1. Primary Source: FCC Catalog (when FCC layer is enabled and not stopped)
    if (fccIntegrityChecker.isFccEnabled()) {
      const fccProviders = fccCatalogSync.getCatalog();
      for (const provider of fccProviders) {
        if (!provider.enabled || provider.health === 'stopped') continue;

        for (const model of provider.models) {
          if (seenModelIds.has(model.id)) continue;
          seenModelIds.add(model.id);

          let tier: ModelTier = 'tier_b_general';
          if (model.capabilities.reasoning) tier = 'tier_s_reasoning';
          else if (model.capabilities.coding) tier = 'tier_a_coding';
          else if (model.capabilities.fast) tier = 'tier_c_fast';

          // FCC-managed free supply is the anonymous hosted gateway. Providers
          // whose API requires a key (Zhipu, Baichuan, …) must be presented as
          // BYOK ('your key'), never as FCC free — otherwise selecting their
          // models without a key immediately produces CONFIG_MISSING.
          const keylessProvider = provider.authMethod !== 'api_key';
          grouped[tier].push({
            modelId: model.id,
            modelName: model.name,
            providerId: provider.id,
            providerName: provider.name,
            tier,
            isFree: keylessProvider ? model.isFree : false,
            latencyMs: provider.latencyMs || 250,
            healthScore: provider.health === 'healthy' ? 1.0 : 0.7,
            isRateLimited: false,
            compositeRankScore: 180 + (keylessProvider && model.isFree ? 20 : 0),
            selectionReason: model.description || `Powered by free-claude-code (${provider.name})`,
            provenance: keylessProvider ? (model.provenance || 'FCC') : 'your key'
          });
        }
      }
    }

    // 2. Secondary Source: live verified backend supply (FCC extras + OpenKilo + OpenCode Zen + preconfigured + Ollama)
    const supplemental = await this.getVerifiedSupplementalEntries();
    for (const entry of supplemental) {
      if (seenModelIds.has(entry.modelId)) continue;
      seenModelIds.add(entry.modelId);
      const scored = this.scoreCandidate(entry, entry.tier, defaultPrefs);
      grouped[entry.tier].push(scored);
    }

    return grouped;
  }

  private getFallbackDefault(): RankedModelCandidate {
    return {
      modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
      modelName: 'Qwen 2.5 Coder 32B Instruct',
      providerId: 'openrouter-free',
      providerName: 'OpenRouter',
      tier: 'tier_a_coding',
      isFree: true,
      latencyMs: 380,
      healthScore: 1.0,
      isRateLimited: false,
      compositeRankScore: 100,
      selectionReason: 'Universal fallback model'
    };
  }
}

export const modelRouter = ModelRouter.getInstance();

/**
 * FCC free-default policy: a model is routable by default only when it is free
 * (anonymous gateway / :free pool / baked supply) or the provider holds its own
 * credentials (BYOK). Borrowed credentials from another provider never qualify.
 */
function filterRoutableFreeFirst(pool: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return pool.filter((entry) => entry.isFree || providerHasOwnKey(entry.providerId));
}
