/**
 * Smart Orchestrator & Model Selector (Layer 6)
 *
 * Automatically inspects incoming user queries and tasks to select
 * the highest-performing free tier model:
 * 1. Code generation: Qwen3 Coder / DeepSeek Coder
 * 2. Complex reasoning: DeepSeek R1 / R1 Distill
 * 3. Fast responses: Groq Llama 3.3 / Mistral Small
 * 4. Large context: Qwen3 Coder (262K) / DeepSeek R1 0528 (164K)
 * 5. Vision / Multimodal: long-context vision models
 * 6. Simple queries: Llama 3.2 3B / Llama 3.1 8B (quota saving)
 *
 * Provides real-time routing decision logs for power users.
 */

import type {
  ProviderSettings,
  RoutingDecisionLog,
  SmartModelSelection,
  SmartTaskType
} from '../../../preload/types';
import { providerRegistry, type ProviderMetadata, type ModelMetadata } from './provider-registry';
import { omniRouteRouter } from './router';
import { quotaTracker } from './quota-tracker';
import type { ProviderCandidate } from './strategies/types';

export class SmartModelSelectorService {
  private decisionLogs: RoutingDecisionLog[] = [];
  private readonly maxLogs = 50;

  /**
   * Intelligently classifies prompt and messages into a SmartTaskType
   */
  public classifyTask(
    prompt: string,
    context?: {
      messages?: Array<{ role: string; content?: string }>;
      hasImages?: boolean;
      tokenEstimate?: number;
      contextTokens?: number;
    }
  ): { task: SmartTaskType; confidence: number; rationale: string } {
    const text = prompt.toLowerCase();
    const tokenEstimate = context?.contextTokens || context?.tokenEstimate || Math.ceil(prompt.length / 3.8);

    // 1. Multimodal / Vision check
    if (
      context?.hasImages ||
      /(\.png|\.jpg|\.jpeg|\.webp|\.svg|data:image\/|screenshot|diagram|mockup)/i.test(prompt)
    ) {
      return {
        task: 'multimodal',
        confidence: 0.95,
        rationale: 'Image data or visual asset references detected; routed to multimodal-capable vision model.'
      };
    }

    // 2. Large Context check (long prompt or estimated tokens > 32K)
    if (tokenEstimate > 32_000 || (context?.messages && context.messages.length > 25)) {
      return {
        task: 'large-context',
        confidence: 0.96,
        rationale: `Conversation context exceeds ${Math.round(tokenEstimate / 1000)}K tokens; routed to large-context model (>= 128K).`
      };
    }

    // 3. Complex Reasoning check
    const reasoningKeywords = [
      'think step by step',
      'deep reasoning',
      'prove',
      'mathematical',
      'architectural decision',
      'tradeoff analysis',
      'explain the logic',
      'formal verification',
      'algorithmic complexity',
      'why does',
      'analyze deeply',
      'deduce',
      'chain of thought'
    ];
    if (reasoningKeywords.some((kw) => text.includes(kw))) {
      return {
        task: 'reasoning',
        confidence: 0.94,
        rationale: 'Deep analytical, mathematical, or architectural problem-solving keywords detected; routed to frontier reasoning model.'
      };
    }

    // 4. Code Generation & Refactoring check
    const codingKeywords = [
      'function',
      'class',
      'const ',
      'let ',
      'var ',
      'interface ',
      'type ',
      'import ',
      'export ',
      'implement',
      'refactor',
      'write code',
      'unit test',
      'fix bug',
      'error:',
      'syntax',
      'typescript',
      'python',
      'javascript',
      'golang',
      'rust',
      'regex',
      'component',
      'react',
      'api endpoint',
      'sql query',
      'algorithm'
    ];
    const hasCodeBlock = prompt.includes('```') || prompt.includes('function') || prompt.includes('const ');
    if (hasCodeBlock || codingKeywords.some((kw) => text.includes(kw))) {
      return {
        task: 'coding',
        confidence: 0.95,
        rationale: 'Software development, syntax, or code refactoring task detected; routed to code-specialized frontier model.'
      };
    }

    // 5. Simple Query check (short greetings, basic definitions, quick lookups)
    if (
      prompt.trim().length < 40 &&
      /^(hi|hello|hey|what is|define|who is|thank you|thanks|ping|test)\b/i.test(prompt.trim())
    ) {
      return {
        task: 'simple-query',
        confidence: 0.92,
        rationale: 'Concise inquiry or greeting detected; routed to lightweight, high-speed model to save free-tier quota.'
      };
    }

    // 6. Fast response (General rapid assistance)
    return {
      task: 'fast-response',
      confidence: 0.88,
      rationale: 'Interactive development query; routed to low-latency instruction model for immediate streaming responses.'
    };
  }

  /**
   * Automatically selects the optimal free model based on the classified task
   */
  public selectModelForTask(
    prompt: string,
    settings: ProviderSettings,
    context?: {
      messages?: Array<{ role: string; content?: string }>;
      hasImages?: boolean;
      forceFree?: boolean;
    }
  ): SmartModelSelection {
    const classification = this.classifyTask(prompt, context);
    const freeMode = settings.freeMode !== false && (quotaTracker.isFreeModeActive() || context?.forceFree);

    // Get all candidate models
    const candidates = omniRouteRouter.getCandidates(settings);

    // Filter to free tier candidates when free mode is active
    const viableCandidates = freeMode
      ? candidates.filter((c) => c.model.capabilities.isFree || c.provider.isFreeTierAvailable || c.provider.id === 'openkilo' || c.provider.id === 'fcc-proxy' || c.provider.id === 'ollama')
      : candidates;

    const pool = viableCandidates.length ? viableCandidates : candidates;

    // Apply rule hierarchy based on classification.task
    let selected: ProviderCandidate | null = null;
    let rationale = '';

    switch (classification.task) {
      case 'coding':
        // Rule 1: Code generation -> Prefer Qwen 3 Coder, DeepSeek Coder, DeepSeek V3
        selected =
          pool.find((c) => c.model.id.includes('qwen3-coder') || c.model.id.includes('qwen-2.5-coder')) ||
          pool.find((c) => c.model.id.includes('deepseek-chat') || c.model.id.includes('coder')) ||
          pool.find((c) => (c.model.capabilities.codingScore || 0) >= 94) ||
          pool[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Top-tier coding specialist with ${Math.round(selected.model.contextWindow / 1000)}K context and score ${selected.model.capabilities.codingScore || 95}/100.`;
        break;

      case 'reasoning':
        // Rule 2: Complex reasoning -> Prefer DeepSeek R1, R1 Distill, o1 variants
        selected =
          pool.find((c) => c.model.id.includes('r1-0528') || c.model.id.includes('deepseek-r1')) ||
          pool.find((c) => c.model.capabilities.reasoning) ||
          pool.find((c) => c.model.id.includes('r1-distill')) ||
          pool[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Frontier reasoning model with deep reflection, chain-of-thought, and formal architectural verification.`;
        break;

      case 'fast-response':
        // Rule 3: Fast responses -> Prefer Groq ultra-fast or Mistral Small / Llama 3.3
        selected =
          pool.find((c) => c.provider.id === 'groq') ||
          pool.find((c) => c.model.id.includes('mistral-small') || c.model.id.includes('llama-3.3-70b')) ||
          pool.find((c) => c.model.contextWindow <= 128_000) ||
          pool[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Low-latency high-throughput engine optimized for snappy sub-second streaming.`;
        break;

      case 'large-context':
        // Rule 4: Large context -> Prefer 128K+ context models for repository-scale prompts.
        selected =
          pool.find((c) => c.model.contextWindow >= 250_000) ||
          pool.find((c) => c.model.contextWindow >= 128_000) ||
          pool.sort((a, b) => b.model.contextWindow - a.model.contextWindow)[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Massive ${Math.round(selected.model.contextWindow / 1000)}K context window accommodates repository-scale prompts without truncation.`;
        break;

      case 'multimodal':
        // Rule 5: Vision tasks -> Prefer multimodal models
        selected =
          pool.find((c) => c.model.capabilities.vision || c.model.id.includes('flash') || c.model.id.includes('gemma-3')) ||
          pool.find((c) => c.model.id.includes('gemini')) ||
          pool[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Multimodal architecture capable of optical diagram analysis and UI code extraction.`;
        break;

      case 'simple-query':
        // Rule 6: Simple queries -> Prefer small/fast models to save quota
        selected =
          pool.find((c) => c.model.id.includes('3b') || c.model.id.includes('8b')) ||
          pool.find((c) => c.model.contextWindow <= 128_000) ||
          pool[0];
        rationale = `Selected ${selected.model.name} (${selected.provider.name}): Ultra-lightweight model handles concise lookups with negligible latency while conserving monthly free quota.`;
        break;
    }

    if (!selected) {
      selected = pool[0];
      rationale = `Defaulted to ${selected.model.name} (${selected.provider.name}) based on provider health and availability.`;
    }

    // Check quota headroom
    const quota = quotaTracker.getProviderQuota(selected.provider.id);
    const quotaHeadroomPercent = quota ? 100 - quota.percentUsed : 100;

    // Build alternative options
    const alternatives = pool
      .filter((c) => c.model.id !== selected?.model.id)
      .slice(0, 3)
      .map((c) => ({
        providerId: c.provider.id,
        modelId: c.model.id,
        rationale: `${c.model.name} (${c.provider.name}) - ${Math.round(c.model.contextWindow / 1000)}K context, ${c.model.capabilities.isFree ? 'Free' : 'Paid'}`
      }));

    const result: SmartModelSelection = {
      task: classification.task,
      providerId: selected.provider.id,
      modelId: selected.model.id,
      modelName: selected.model.name,
      isFree: Boolean(selected.model.capabilities.isFree || selected.provider.isFreeTierAvailable),
      rationale,
      contextWindow: selected.model.contextWindow,
      confidence: classification.confidence,
      quotaHeadroomPercent,
      alternatives
    };

    // Log decision for power-user visibility
    this.recordDecisionLog(prompt, result);

    return result;
  }

  private recordDecisionLog(prompt: string, selection: SmartModelSelection): void {
    const log: RoutingDecisionLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      promptSnippet: prompt.slice(0, 80).replace(/\n/g, ' ') + (prompt.length > 80 ? '…' : ''),
      detectedTask: selection.task,
      selectedProvider: selection.providerId,
      selectedModel: selection.modelId,
      isFree: selection.isFree,
      rationale: selection.rationale
    };

    this.decisionLogs.unshift(log);
    if (this.decisionLogs.length > this.maxLogs) {
      this.decisionLogs.pop();
    }
  }

  public selectModel(
    prompt: string,
    context?: {
      contextTokens?: number;
      hasImages?: boolean;
      forceFree?: boolean;
    }
  ): SmartModelSelection {
    const defaultSettings: ProviderSettings = {
      activeProvider: 'openkilo',
      activeModel: 'deepseek/deepseek-r1-0528:free',
      temperature: 0.2,
      maxTokens: 4096,
      freeMode: true,
      apiKeys: {},
      customEndpoints: {}
    };
    return this.selectModelForTask(prompt, defaultSettings, context);
  }

  public getDecisionLogs(): RoutingDecisionLog[] {
    return [...this.decisionLogs];
  }

  public clearDecisionLogs(): void {
    this.decisionLogs = [];
  }
}

export const smartModelSelector = new SmartModelSelectorService();
