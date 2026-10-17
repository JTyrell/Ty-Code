/**
 * Permanent Free Provider Registry (Phase 6.1)
 *
 * Hardcoded registry of all free-tier providers with their curated best models,
 * capabilities, and setup instructions. Fully built into Ty-Code with zero required
 * initial configuration.
 *
 * Brand: Ty-Code
 */

import type {
  FreeProvider,
  FreeProviderId,
  CuratedModelItem,
  ModelCapabilityCategory
} from '../../../shared/types/free-providers';

export const PERMANENT_FREE_PROVIDERS: FreeProvider[] = [
  {
    id: 'openrouter-free',
    name: 'OpenRouter (Free Tier)',
    base_url: 'https://openrouter.ai/api/v1',
    auth_type: 'api_key_optional',
    best_free_models: [
      'deepseek/deepseek-r1:free',
      'deepseek/deepseek-chat:free',
      'qwen/qwen-2.5-coder-32b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
      'nvidia/llama-3.1-nemotron-70b-instruct:free'
    ],
    setup_instructions: 'Get free API key at openrouter.ai/keys',
    model_capabilities: {
      reasoning: ['deepseek-r1:free'],
      coding: ['qwen-2.5-coder-32b-instruct:free', 'deepseek-chat:free'],
      fast: ['gemini-2.0-flash-exp:free', 'mistral-7b-instruct:free'],
      general: ['llama-3.3-70b-instruct:free']
    },
    signup_url: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq-free',
    name: 'Groq (Free Tier)',
    base_url: 'https://api.groq.com/openai/v1',
    auth_type: 'api_key_optional',
    best_free_models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ],
    setup_instructions: 'Get free API key at console.groq.com',
    model_capabilities: {
      ultra_fast: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      coding: ['llama-3.3-70b-versatile'],
      general: ['mixtral-8x7b-32768', 'gemma2-9b-it']
    },
    signup_url: 'https://console.groq.com/keys'
  },
  {
    id: 'openkilo-free',
    name: 'OpenKilo (Kilo Gateway)',
    base_url: 'https://api.kilo.ai/api/gateway',
    auth_type: 'anonymous',
    best_free_models: [
      'deepseek/deepseek-r1-0528:free',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-27b-it:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'z-ai/glm-5:free'
    ],
    setup_instructions: 'No API key required - works instantly',
    model_capabilities: {
      reasoning: ['deepseek-r1-0528:free'],
      coding: ['qwen3-coder:free'],
      large_context: ['glm-5:free', 'qwen3-coder:free'],
      efficient: ['gemma-3-27b-it:free']
    },
    signup_url: 'https://openkilo.com'
  },
  {
    id: 'huggingface-free',
    name: 'Hugging Face Inference API (Free Tier)',
    base_url: 'https://api-inference.huggingface.co/models',
    auth_type: 'api_key_optional',
    best_free_models: [
      'codellama/CodeLlama-34b-Instruct-hf',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'HuggingFaceH4/zephyr-7b-beta',
      'google/gemma-7b-it',
      'meta-llama/Llama-2-13b-chat-hf'
    ],
    setup_instructions: 'Get free API key at huggingface.co/settings/tokens',
    model_capabilities: {
      coding: ['CodeLlama-34b-Instruct-hf'],
      fast: ['Mistral-7B-Instruct-v0.3', 'zephyr-7b-beta'],
      general: ['gemma-7b-it', 'Llama-2-13b-chat-hf']
    },
    signup_url: 'https://huggingface.co/settings/tokens'
  },
  {
    id: 'together-ai-free',
    name: 'Together AI (Free Tier)',
    base_url: 'https://api.together.xyz/v1',
    auth_type: 'api_key_optional',
    best_free_models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'
    ],
    setup_instructions: 'Get free API key at together.ai',
    model_capabilities: {
      coding: ['Qwen2.5-Coder-32B-Instruct'],
      fast: ['Meta-Llama-3.1-8B-Instruct-Turbo'],
      general: ['Llama-3.3-70B-Instruct-Turbo-Free', 'Mixtral-8x7B-Instruct-v0.1']
    },
    signup_url: 'https://together.ai'
  },
  {
    id: 'fireworks-ai-free',
    name: 'Fireworks AI (Free Tier)',
    base_url: 'https://api.fireworks.ai/inference/v1',
    auth_type: 'api_key_optional',
    best_free_models: [
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
      'accounts/fireworks/models/mixtral-8x22b-instruct'
    ],
    setup_instructions: 'Get free API key at fireworks.ai',
    model_capabilities: {
      coding: ['qwen2p5-coder-32b-instruct'],
      fast: ['llama-v3p3-70b-instruct'],
      general: ['mixtral-8x22b-instruct']
    },
    signup_url: 'https://fireworks.ai'
  },
  {
    id: 'google-ai-studio-free',
    name: 'Google AI Studio (Gemini Free Tier)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    auth_type: 'api_key_optional',
    best_free_models: [
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ],
    setup_instructions: 'Get free API key at aistudio.google.com/app/apikey',
    model_capabilities: {
      ultra_fast: ['gemini-2.0-flash-exp'],
      large_context: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      multimodal: ['gemini-2.0-flash-exp', 'gemini-1.5-pro']
    },
    signup_url: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'anthropic-claude-free',
    name: 'Anthropic Claude (Free Tier via FCC)',
    base_url: 'https://api.anthropic.com/v1',
    auth_type: 'fcc_proxy',
    best_free_models: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022'
    ],
    setup_instructions: 'Access via FCC proxy - requires FCC server',
    model_capabilities: {
      coding: ['claude-3-5-sonnet-20241022'],
      fast: ['claude-3-5-haiku-20241022'],
      general: ['claude-3-5-sonnet-20241022']
    }
  },
  {
    id: 'opencode-built-in',
    name: 'OpenCode Built-in Providers',
    base_url: 'auto',
    auth_type: 'opencode_integration',
    best_free_models: [
      "All free models from OpenCode's provider list"
    ],
    setup_instructions: 'Auto-detected from OpenCode installation',
    model_capabilities: {
      inherited: "All capabilities from OpenCode's provider catalog"
    }
  }
];

export class FreeProviderRegistry {
  private static instance: FreeProviderRegistry;
  private readonly providers: Map<FreeProviderId, FreeProvider> = new Map();

  private constructor() {
    for (const provider of PERMANENT_FREE_PROVIDERS) {
      this.providers.set(provider.id, provider);
    }
  }

  public static getInstance(): FreeProviderRegistry {
    if (!FreeProviderRegistry.instance) {
      FreeProviderRegistry.instance = new FreeProviderRegistry();
    }
    return FreeProviderRegistry.instance;
  }

  /**
   * Returns all permanently registered free providers.
   */
  public getAllProviders(): FreeProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Retrieves a free provider by its unique identifier.
   */
  public getProvider(id: string): FreeProvider | undefined {
    return this.providers.get(id as FreeProviderId);
  }

  /**
   * Returns whether a given provider is registered in the permanent free registry.
   */
  public isRegisteredProvider(id: string): boolean {
    return this.providers.has(id as FreeProviderId);
  }

  /**
   * Checks whether a model is marked or known as a free model across all providers.
   */
  public isFreeModel(modelId: string, providerId?: string): boolean {
    if (!modelId) return false;
    const lowerModel = modelId.toLowerCase();

    // 1. Explicit :free tag (OpenRouter, OpenKilo, etc.)
    if (lowerModel.includes(':free')) return true;

    // 2. Local Ollama or FCC proxy models are always free
    if (providerId === 'ollama' || providerId === 'fcc-proxy' || providerId === 'anthropic-claude-free') {
      return true;
    }

    // 3. Match against known curated free models
    for (const provider of this.providers.values()) {
      if (providerId && provider.id !== providerId) {
        continue;
      }
      for (const m of provider.best_free_models) {
        if (m === modelId || m.toLowerCase() === lowerModel) return true;
        // Strip provider prefix for comparison (e.g. "deepseek/deepseek-r1:free" vs "deepseek-r1:free")
        const strippedM = m.split('/').pop() || m;
        const strippedCandidate = modelId.split('/').pop() || modelId;
        if (strippedM.toLowerCase() === strippedCandidate.toLowerCase()) return true;
      }
    }

    // 4. Provider-specific heuristics
    if (providerId === 'groq' || providerId === 'groq-free') {
      const groqFree = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'];
      if (groqFree.some((gm) => lowerModel.includes(gm.toLowerCase()))) return true;
    }

    if (providerId === 'google-ai-studio-free' || providerId === 'gemini') {
      const geminiFree = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      if (geminiFree.some((gm) => lowerModel.includes(gm))) return true;
    }

    return false;
  }

  /**
   * Collects all curated free models across all registered providers.
   */
  public getAllFreeModels(): Array<{
    providerId: FreeProviderId;
    providerName: string;
    modelId: string;
    capabilities: ModelCapabilityCategory[];
  }> {
    const results: Array<{
      providerId: FreeProviderId;
      providerName: string;
      modelId: string;
      capabilities: ModelCapabilityCategory[];
    }> = [];

    for (const provider of this.providers.values()) {
      for (const modelId of provider.best_free_models) {
        if (modelId.startsWith('All free models')) continue; // Skip wildcard/inherited placeholder
        const caps: ModelCapabilityCategory[] = [];
        for (const [capName, models] of Object.entries(provider.model_capabilities)) {
          if (Array.isArray(models)) {
            const matches = models.some(
              (m) =>
                m.toLowerCase() === modelId.toLowerCase() ||
                modelId.toLowerCase().includes(m.toLowerCase()) ||
                m.toLowerCase().includes((modelId.split('/').pop() || '').toLowerCase())
            );
            if (matches) {
              caps.push(capName as ModelCapabilityCategory);
            }
          }
        }
        if (caps.length === 0) {
          caps.push('general');
        }
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          capabilities: caps
        });
      }
    }

    return results;
  }

  /**
   * Suggests the best curated free model and provider for a given task.
   */
  public getBestModelForTask(
    task: 'coding' | 'reasoning' | 'fast' | 'general' | 'large_context' | 'multimodal'
  ): { providerId: FreeProviderId; providerName: string; modelId: string } | undefined {
    switch (task) {
      case 'reasoning':
        return {
          providerId: 'openrouter-free',
          providerName: 'OpenRouter (Free Tier)',
          modelId: 'deepseek/deepseek-r1:free'
        };
      case 'coding':
        return {
          providerId: 'openrouter-free',
          providerName: 'OpenRouter (Free Tier)',
          modelId: 'qwen/qwen-2.5-coder-32b-instruct:free'
        };
      case 'fast':
        return {
          providerId: 'groq-free',
          providerName: 'Groq (Free Tier)',
          modelId: 'llama-3.1-8b-instant'
        };
      case 'large_context':
        return {
          providerId: 'google-ai-studio-free',
          providerName: 'Google AI Studio (Gemini Free Tier)',
          modelId: 'gemini-1.5-pro'
        };
      case 'multimodal':
        return {
          providerId: 'google-ai-studio-free',
          providerName: 'Google AI Studio (Gemini Free Tier)',
          modelId: 'gemini-2.0-flash-exp'
        };
      case 'general':
      default:
        return {
          providerId: 'groq-free',
          providerName: 'Groq (Free Tier)',
          modelId: 'llama-3.3-70b-versatile'
        };
    }
  }

  /**
   * Generates a high-level summary of all free providers.
   */
  public getAllProvidersSummary(): {
    totalProviders: number;
    totalCuratedModels: number;
    anonymousProviders: number;
    proxyProviders: number;
    providers: Array<{ id: string; name: string; modelCount: number; authType: string }>;
  } {
    const all = this.getAllProviders();
    const curatedModels = this.getAllFreeModels();
    return {
      totalProviders: all.length,
      totalCuratedModels: curatedModels.length,
      anonymousProviders: all.filter((p) => p.auth_type === 'anonymous').length,
      proxyProviders: all.filter((p) => p.auth_type === 'fcc_proxy').length,
      providers: all.map((p) => ({
        id: p.id,
        name: p.name,
        modelCount: p.best_free_models.length,
        authType: p.auth_type
      }))
    };
  }
}

export const freeProviderRegistry = FreeProviderRegistry.getInstance();
