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

export interface ModelCatalogEntry {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  tier: ModelTier;
  isFree: boolean;
  baseLatencyMs: number;
}

export const ROUTER_MODEL_CATALOG: ModelCatalogEntry[] = [
  // Tier S: Complex Reasoning & Planning
  {
    modelId: 'deepseek/deepseek-r1:free',
    modelName: 'DeepSeek R1 (Free)',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_s_reasoning',
    isFree: true,
    baseLatencyMs: 850
  },
  {
    modelId: 'deepseek/deepseek-r1-0528:free',
    modelName: 'DeepSeek R1 0528 (Kilo Gateway)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_s_reasoning',
    isFree: true,
    baseLatencyMs: 650
  },
  {
    modelId: 'claude-3.5-sonnet',
    modelName: 'Claude 3.5 Sonnet (Copilot)',
    providerId: 'opencode-built-in',
    providerName: 'OpenCode Copilot',
    tier: 'tier_s_reasoning',
    isFree: true,
    baseLatencyMs: 900
  },

  // Tier A: Code Generation & Editing
  {
    modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
    modelName: 'Qwen 2.5 Coder 32B Instruct',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_a_coding',
    isFree: true,
    baseLatencyMs: 420
  },
  {
    modelId: 'qwen/qwen3-coder:free',
    modelName: 'Qwen 3 Coder (Kilo Gateway)',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_a_coding',
    isFree: true,
    baseLatencyMs: 380
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
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    modelName: 'Llama 3.3 70B Instruct',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 350
  },
  {
    modelId: 'google/gemma-3-27b-it:free',
    modelName: 'Gemma 3 27B IT',
    providerId: 'openkilo-free',
    providerName: 'OpenKilo',
    tier: 'tier_b_general',
    isFree: true,
    baseLatencyMs: 290
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
  },
  {
    modelId: 'mistralai/mistral-7b-instruct:free',
    modelName: 'Mistral 7B Instruct (Free)',
    providerId: 'openrouter-free',
    providerName: 'OpenRouter',
    tier: 'tier_c_fast',
    isFree: true,
    baseLatencyMs: 220
  }
];

export class ModelRouter {
  private static instance: ModelRouter;

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
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

    // 3. Get candidate models
    const allModels = [...ROUTER_MODEL_CATALOG];

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

    // 4. Rank candidates according to multi-factor criteria
    const ranked = candidatePool.map((entry) => {
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
      selectionReason
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
   */
  public getCatalogGroupedByTier(): Record<ModelTier, RankedModelCandidate[]> {
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

    for (const entry of ROUTER_MODEL_CATALOG) {
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
