/**
 * Model Tier Classifier (Phase 6.1)
 *
 * Classifies models into intelligence, reasoning, and efficiency tiers
 * (Tier S Reasoning, Tier A Coding, Tier B General, Tier C Fast)
 * for optimal routing and intelligent task assignment.
 *
 * Brand: Ty-Code
 */

import type {
  ModelTier,
  TierClassification
} from '../../../shared/types/free-providers';

export const MODEL_TIERS: Record<ModelTier, TierClassification> = {
  tier_s_reasoning: {
    tier: 'tier_s_reasoning',
    name: 'Tier S: Complex Reasoning & Planning',
    description: 'Best for complex reasoning, architectural design, deep debugging, and multi-step agent planning',
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'deepseek/deepseek-r1-0528',
      'nvidia/nemotron-3.5-super-vl:free',
      'thinkingmachines/inkling-small:free'
    ],
    recommendedUseCases: [
      'Algorithmic problem solving',
      'Codebase refactoring plans',
      'Deep logical deduction',
      'Multi-file architectural coordination'
    ]
  },
  tier_a_coding: {
    tier: 'tier_a_coding',
    name: 'Tier A: Code Engineering & Editing',
    description: 'Best for code generation, surgical block edits, syntax transformations, and unit tests',
    models: [
      'poolside/laguna-s-2.1:free',
      'cohere/north-mini-code:free',
      'qwen/qwen-2.5-coder-32b-instruct:free',
      'claude-3-5-sonnet-20241022 (via FCC)',
      'codellama/CodeLlama-34b-Instruct-hf',
      'llama-3.3-70b-versatile (Groq)'
    ],
    recommendedUseCases: [
      'Function and component implementation',
      'Test-driven development',
      'API client generation',
      'Language conversions'
    ]
  },
  tier_b_general: {
    tier: 'tier_b_general',
    name: 'Tier B: General Assistance & Conversation',
    description: 'Best for general assistance, explanations, documentation writing, and conversational flow',
    models: [
      'kilo-auto/free',
      'openrouter/free',
      'dots-studio/dots-3-note-preview:free',
      'llama-3.3-70b-versatile (Groq)',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'
    ],
    recommendedUseCases: [
      'Technical documentation & comments',
      'Code explanations and summaries',
      'Pair programming discussions',
      'Changelog & PR descriptions'
    ]
  },
  tier_c_fast: {
    tier: 'tier_c_fast',
    name: 'Tier C: Ultra-Fast & Efficient',
    description: 'Best for quick responses, simple queries, sub-second auto-completions, and low-latency edits',
    models: [
      'llama-3.1-8b-instant (Groq)',
      'gemini-2.0-flash-exp',
      'liquid/lfm-2.5-2.6b:free',
      'mistralai/Mistral-7B-Instruct-v0.3'
    ],
    recommendedUseCases: [
      'Inline suggestions & completions',
      'Quick single-line syntax fixes',
      'Commit message generation',
      'High-throughput classification'
    ]
  }
};

export class ModelClassifier {
  private static instance: ModelClassifier;

  public static getInstance(): ModelClassifier {
    if (!ModelClassifier.instance) {
      ModelClassifier.instance = new ModelClassifier();
    }
    return ModelClassifier.instance;
  }

  /**
   * Returns all model tiers and their metadata.
   */
  public getAllTiers(): Record<ModelTier, TierClassification> {
    return MODEL_TIERS;
  }

  /**
   * Retrieves the tier classification metadata for a specific tier.
   */
  public getTier(tier: ModelTier): TierClassification {
    return MODEL_TIERS[tier] || MODEL_TIERS.tier_b_general;
  }

  /**
   * Returns all models classified under a specific tier.
   */
  public getModelsInTier(tier: ModelTier): string[] {
    return MODEL_TIERS[tier]?.models || [];
  }

  /**
   * Classifies a model string into its appropriate tier.
   */
  public classifyModelTier(modelId: string): ModelTier {
    if (!modelId) return 'tier_b_general';
    const lower = modelId.toLowerCase();

    // 1. Direct model list checks
    for (const [tierKey, tierInfo] of Object.entries(MODEL_TIERS)) {
      for (const m of tierInfo.models) {
        const cleanM = m.replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
        if (lower === cleanM || lower.includes(cleanM) || cleanM.includes(lower)) {
          return tierKey as ModelTier;
        }
      }
    }

    // 2. Tier S Heuristics: Deep reasoning models
    if (
      lower.includes('deepseek-r1') ||
      lower.includes('r1-0528') ||
      lower.includes('o1-mini') ||
      lower.includes('o1-preview') ||
      lower.includes('o3-mini') ||
      lower.includes('qwq')
    ) {
      return 'tier_s_reasoning';
    }

    // 3. Tier A Heuristics: Code specialists & frontier flagships
    if (
      lower.includes('coder') ||
      lower.includes('codellama') ||
      lower.includes('sonnet') ||
      lower.includes('claude-3-5') ||
      lower.includes('deepseek-chat') ||
      lower.includes('starcoder')
    ) {
      return 'tier_a_coding';
    }

    // 4. Tier C Heuristics: Lightweight & sub-second models
    if (
      lower.includes('flash') ||
      lower.includes('instant') ||
      lower.includes('8b') ||
      lower.includes('7b') ||
      lower.includes('3b') ||
      lower.includes('1b') ||
      lower.includes('haiku') ||
      lower.includes('mini')
    ) {
      return 'tier_c_fast';
    }

    // 5. Tier B: General 70B+ instruction and chat models
    return 'tier_b_general';
  }

  /**
   * Returns detailed TierClassification information for a model.
   */
  public getModelTierInfo(modelId: string): TierClassification {
    const tier = this.classifyModelTier(modelId);
    return MODEL_TIERS[tier];
  }

  /**
   * Recommends a ModelTier based on the user task description.
   */
  public getSuggestedTierForTask(task: string): ModelTier {
    const lower = task.toLowerCase();
    if (lower.includes('reason') || lower.includes('plan') || lower.includes('architect') || lower.includes('math') || lower.includes('logic')) {
      return 'tier_s_reasoning';
    }
    if (lower.includes('code') || lower.includes('implement') || lower.includes('refactor') || lower.includes('test') || lower.includes('bug')) {
      return 'tier_a_coding';
    }
    if (lower.includes('fast') || lower.includes('quick') || lower.includes('inline') || lower.includes('instant') || lower.includes('simple')) {
      return 'tier_c_fast';
    }
    return 'tier_b_general';
  }
}

export const modelClassifier = ModelClassifier.getInstance();
