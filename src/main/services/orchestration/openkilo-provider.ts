/**
 * OpenKilo Provider Service (Layer 5)
 *
 * Integrates OpenKilo's Kilo Gateway as a backup free-tier provider:
 * - 40+ free models available without API key (anonymous mode)
 * - OAuth flow for 350+ paid models
 * - Dynamic model registry auto-refresh
 * - Guaranteed fallback provider when other providers are rate-limited or exhausted
 */

import type { DiscoveredModel, ProviderSettings } from '../../../preload/types';
import type { ModelMetadata, ProviderMetadata } from './provider-registry';
import { settingsManager } from '../settings-manager';

export interface OpenKiloAuthStatus {
  authMode: 'anonymous' | 'oauth' | 'api_key';
  isAuthenticated: boolean;
  apiKey?: string;
  userEmail?: string;
  freeTierActive: boolean;
  totalModelsAvailable: number;
}

export interface OpenKiloModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  isFree: boolean;
  category: 'Free' | 'Fast' | 'Premium/Reasoning';
  primaryTask: 'coding' | 'reasoning' | 'fast-edit' | 'general' | 'multimodal';
  codingScore: number;
  description: string;
}

/**
 * Curated catalog of 40+ free models on OpenKilo Kilo Gateway.
 * Priority models match the Layer 5 specification.
 */
export const OPENKILO_CURATED_FREE_MODELS: OpenKiloModelDefinition[] = [
  // 5 Priority Free Models
  {
    id: 'deepseek/deepseek-r1-0528:free',
    name: 'DeepSeek R1 (0528) Free',
    contextWindow: 164_000,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 97,
    description: '164K context deep reasoning and architectural problem solving with zero cost.'
  },
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen 3 Coder Free',
    contextWindow: 262_144,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 96,
    description: 'Massive 262K context state-of-the-art coding and repo refactoring model.'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'coding',
    codingScore: 93,
    description: '128K context fast, versatile open-weights powerhouse for multi-turn development.'
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B IT Free',
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 91,
    description: '131K context lightweight and exceptionally efficient instruction-tuned model.'
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    name: 'Mistral Small 3.1 24B Instruct Free',
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 90,
    description: '128K context ultra-low latency model tailored for surgical code editing.'
  },

  // Additional 35+ Curated Free Models (total 40+)
  {
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek V3 Free',
    contextWindow: 65_536,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 95,
    description: 'Flagship open code generation model with 64K context.'
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B Free',
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 94,
    description: '128K context top-tier coding assistant for autonomous workflows.'
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    name: 'Llama 3.1 8B Instruct Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 86,
    description: 'Blazing fast 128K context model for quick code explanations and edits.'
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B Instruct Free',
    contextWindow: 131_072,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 82,
    description: 'Ultra-lightweight 131K model with minimal latency.'
  },
  {
    id: 'google/gemini-2.0-flash-lite:free',
    name: 'Long-Context Multimodal Lite Free',
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 92,
    description: '1 Million token context window with rapid streaming.'
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Long-Context Multimodal Experimental Free',
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 94,
    description: '1M context experimental multi-modal agent.'
  },
  {
    id: 'google/learnlm-1.5-pro-experimental:free',
    name: 'LearnLM 1.5 Pro Experimental Free',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 88,
    description: 'Pedagogical reasoning model for code tutorials and reviews.'
  },
  {
    id: 'microsoft/phi-4:free',
    name: 'Phi-4 Free',
    contextWindow: 16_384,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 90,
    description: 'Dense 14B model excelling at algorithmic coding and math.'
  },
  {
    id: 'microsoft/phi-3.5-mini-128k-instruct:free',
    name: 'Phi-3.5 Mini 128K Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 85,
    description: '128K context compact model with strong logic reasoning.'
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
    name: 'Nemotron 70B Instruct Free',
    contextWindow: 131_072,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 93,
    description: 'NVIDIA aligned 70B model with high accuracy on code and math.'
  },
  {
    id: 'mistralai/codestral-2501:free',
    name: 'Codestral 2501 Free',
    contextWindow: 256_000,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 95,
    description: '256K context dedicated coding specialist from Mistral AI.'
  },
  {
    id: 'mistralai/mistral-nemo:free',
    name: 'Mistral NeMo 12B Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 89,
    description: '128K context multilingual model developed with NVIDIA.'
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral 7B Instruct Free',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 84,
    description: 'Classic lightweight 7B workhorse for quick refactoring.'
  },
  {
    id: 'openchat/openchat-7b:free',
    name: 'OpenChat 3.5 7B Free',
    contextWindow: 8192,
    maxOutputTokens: 2048,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 83,
    description: 'Conditioned-RL fine-tuned model for structured dialogue.'
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    name: 'Hermes 3 405B Free',
    contextWindow: 131_072,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 96,
    description: 'Immense 405B parameter frontier reasoning and tool-calling agent.'
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-70b:free',
    name: 'Hermes 3 70B Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 92,
    description: 'Advanced agentic model optimized for function calling and multi-step plans.'
  },
  {
    id: 'nousresearch/deephermes-3-llama-3-8b-preview:free',
    name: 'DeepHermes 3 8B Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 87,
    description: 'Thinking-enabled 8B reasoning model with step reflection.'
  },
  {
    id: 'cohere/command-r-plus-08-2024:free',
    name: 'Command R+ Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 91,
    description: '128K context RAG-optimized enterprise grade assistant.'
  },
  {
    id: 'cohere/command-r-08-2024:free',
    name: 'Command R Free',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 88,
    description: 'Efficient enterprise model with citations and tool usage.'
  },
  {
    id: 'tiiuae/falcon-180b-chat:free',
    name: 'Falcon 180B Free',
    contextWindow: 8192,
    maxOutputTokens: 2048,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 87,
    description: '180B parameter powerhouse for deep NLP tasks.'
  },
  {
    id: 'upstage/solar-pro:free',
    name: 'Solar Pro 22B Free',
    contextWindow: 65_536,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 89,
    description: 'Depth-upscaled 22B model for high precision single-file edits.'
  },
  {
    id: 'internlm/internlm2_5-20b-chat:free',
    name: 'InternLM 2.5 20B Free',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 89,
    description: 'Strong mathematical reasoning and code evaluation capabilities.'
  },
  {
    id: 'ai21/jamba-1.5-mini:free',
    name: 'Jamba 1.5 Mini Free',
    contextWindow: 256_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 88,
    description: '256K context SSM-Transformer hybrid with linear scaling speed.'
  },
  {
    id: 'ai21/jamba-1.5-large:free',
    name: 'Jamba 1.5 Large Free',
    contextWindow: 256_000,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 92,
    description: '256K context hybrid architecture for massive codebase context ingestion.'
  },
  {
    id: '01-ai/yi-large:free',
    name: 'Yi Large Free',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 92,
    description: 'Frontier performance on complex reasoning and bilingual code.'
  },
  {
    id: '01-ai/yi-lightning:free',
    name: 'Yi Lightning Free',
    contextWindow: 16_384,
    maxOutputTokens: 2048,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 90,
    description: 'Sub-second first-token latency for instant code feedback.'
  },
  {
    id: 'baichuan/baichuan-2-13b-chat:free',
    name: 'Baichuan 2 13B Free',
    contextWindow: 8192,
    maxOutputTokens: 2048,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 83,
    description: 'Efficient dialogue model trained on extensive multilingual corpus.'
  },
  {
    id: 'thudm/glm-4-9b-chat:free',
    name: 'GLM-4 9B Free',
    contextWindow: 131_072,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'coding',
    codingScore: 90,
    description: '128K context open bilingual model with agentic tool calling.'
  },
  {
    id: 'thudm/glm-edge-9b-chat:free',
    name: 'GLM Edge 9B Free',
    contextWindow: 32_768,
    maxOutputTokens: 2048,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 86,
    description: 'Edge-optimized code and text model.'
  },
  {
    id: 'bigcode/starcoder2-15b:free',
    name: 'StarCoder2 15B Free',
    contextWindow: 16_384,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 92,
    description: 'Trained on 600+ programming languages with comprehensive syntax support.'
  },
  {
    id: 'bigcode/starcoder2-7b:free',
    name: 'StarCoder2 7B Free',
    contextWindow: 16_384,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'coding',
    codingScore: 88,
    description: 'Fast code completion and snippet generation.'
  },
  {
    id: 'deepseek/deepseek-coder-6.7b-instruct:free',
    name: 'DeepSeek Coder 6.7B Free',
    contextWindow: 16_384,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'coding',
    codingScore: 91,
    description: 'Project-level code completion and fill-in-the-middle support.'
  },
  {
    id: 'deepseek/deepseek-r1-distill-llama-70b:free',
    name: 'DeepSeek R1 Distill Llama 70B Free',
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 96,
    description: 'Distilled reasoning weights on top of Llama 3.3 70B base.'
  },
  {
    id: 'deepseek/deepseek-r1-distill-qwen-32b:free',
    name: 'DeepSeek R1 Distill Qwen 32B Free',
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 95,
    description: 'Qwen 32B distilled with DeepSeek R1 reasoning trajectories.'
  },
  {
    id: 'deepseek/deepseek-r1-distill-qwen-14b:free',
    name: 'DeepSeek R1 Distill Qwen 14B Free',
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    isFree: true,
    category: 'Fast',
    primaryTask: 'reasoning',
    codingScore: 93,
    description: '14B compact reasoning powerhouse with high throughput.'
  },
  {
    id: 'deepseek/deepseek-r1-distill-qwen-7b:free',
    name: 'DeepSeek R1 Distill Qwen 7B Free',
    contextWindow: 131_072,
    maxOutputTokens: 4096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 89,
    description: 'Fastest reasoning model for instant step-by-step code analysis.'
  }
];

export class OpenKiloProviderService {
  public static readonly DEFAULT_BASE_URL = 'https://api.openkilo.com/v1';
  public static readonly OAUTH_AUTH_URL = 'https://openkilo.com/oauth/authorize';
  public static readonly OAUTH_CLIENT_ID = 'ty-code-desktop-client';

  private activeAuthMode: 'anonymous' | 'oauth' | 'api_key' = 'anonymous';
  private storedApiKey: string | null = null;
  private userEmail: string | null = null;
  private dynamicModels: OpenKiloModelDefinition[] = [];

  constructor() {
    this.dynamicModels = [...OPENKILO_CURATED_FREE_MODELS];
  }

  /**
   * Auto-detect and enable OpenKilo provider.
   * Ensures settings have OpenKilo configured with at least anonymous free access.
   */
  public autoEnable(settings: ProviderSettings): {
    updatedSettings: Partial<ProviderSettings>;
    enabled: boolean;
  } {
    const apiKeys = { ...settings.apiKeys };
    const apiKeysConfigured = { ...settings.apiKeysConfigured };
    const customEndpoints = { ...settings.customEndpoints };

    let changed = false;

    if (!customEndpoints.openkilo) {
      customEndpoints.openkilo = OpenKiloProviderService.DEFAULT_BASE_URL;
      changed = true;
    }

    // If user has not configured a custom API key, enable anonymous access
    if (!apiKeys.openkilo) {
      apiKeys.openkilo = 'anonymous';
      apiKeysConfigured.openkilo = true;
      this.activeAuthMode = 'anonymous';
      changed = true;
    }

    return {
      updatedSettings: changed ? { apiKeys, apiKeysConfigured, customEndpoints } : {},
      enabled: true
    };
  }

  /**
   * Retrieves the current authentication and connection status
   */
  public getStatus(): OpenKiloAuthStatus {
    return {
      authMode: this.activeAuthMode,
      isAuthenticated: this.activeAuthMode !== 'anonymous' || Boolean(this.storedApiKey),
      apiKey: this.storedApiKey || (this.activeAuthMode === 'anonymous' ? 'anonymous' : undefined),
      userEmail: this.userEmail || undefined,
      freeTierActive: true,
      totalModelsAvailable: this.dynamicModels.length
    };
  }

  /**
   * Get all free models available without requiring an API key.
   */
  public getFreeModels(): OpenKiloModelDefinition[] {
    return this.dynamicModels.filter((m) => m.isFree);
  }

  /**
   * Get priority models specified in the requirements.
   */
  public getPriorityModels(): OpenKiloModelDefinition[] {
    const priorityIds = [
      'deepseek/deepseek-r1-0528:free',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-27b-it:free',
      'mistralai/mistral-small-3.1-24b-instruct:free'
    ];
    return this.dynamicModels.filter((m) => priorityIds.includes(m.id));
  }

  /**
   * Converts OpenKilo models to ModelMetadata objects for ProviderRegistry.
   */
  public toRegistryModels(): ModelMetadata[] {
    return this.dynamicModels.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {
        reasoning: m.primaryTask === 'reasoning',
        tools: true,
        vision: m.primaryTask === 'multimodal',
        codingScore: m.codingScore,
        isFree: m.isFree
      },
      costTier: m.isFree ? 'free' : 'low',
      primaryTask: m.primaryTask,
      description: m.description
    }));
  }

  /**
   * Refresh models dynamically by querying OpenKilo's /models endpoint.
   * Auto-tags free models and merges with curated definitions.
   */
  public async refreshModelCatalog(
    apiKey?: string,
    endpoint = OpenKiloProviderService.DEFAULT_BASE_URL
  ): Promise<DiscoveredModel[]> {
    const effectiveKey = apiKey || this.storedApiKey || 'anonymous';
    const baseUrl = endpoint.replace(/\/+$/, '');

    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${effectiveKey}`,
          'X-Client': 'Ty-Code'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (response.ok) {
        const data = await response.json() as {
          data?: Array<{ id: string; name?: string; context_length?: number; pricing?: { prompt?: string } }>;
        };

        if (Array.isArray(data.data) && data.data.length > 0) {
          const fetched: OpenKiloModelDefinition[] = data.data.map((item) => {
            const isFree = item.id.endsWith(':free') || item.pricing?.prompt === '0';
            const contextWindow = item.context_length || (isFree ? 128_000 : 64_000);
            return {
              id: item.id,
              name: item.name || item.id.split('/').pop() || item.id,
              contextWindow,
              maxOutputTokens: 8192,
              isFree,
              category: isFree ? 'Free' : 'Fast',
              primaryTask: 'coding',
              codingScore: isFree ? 92 : 88,
              description: `OpenKilo model ${item.id} with ${Math.round(contextWindow / 1000)}K context.`
            };
          });

          // Deduplicate and merge with priority definitions
          const map = new Map<string, OpenKiloModelDefinition>();
          for (const m of OPENKILO_CURATED_FREE_MODELS) {
            map.set(m.id, m);
          }
          for (const m of fetched) {
            if (!map.has(m.id)) {
              map.set(m.id, m);
            }
          }

          this.dynamicModels = Array.from(map.values());
        }
      }
    } catch {
      // In offline / fallback environment, retain curated definitions
      this.dynamicModels = [...OPENKILO_CURATED_FREE_MODELS];
    }

    return this.dynamicModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: 'openkilo',
      isFree: m.isFree,
      category: m.category,
      contextLength: m.contextWindow,
      description: m.description
    }));
  }

  /**
   * Initiates browser-based OAuth authentication flow for accessing paid models.
   */
  public async startOAuthFlow(): Promise<{ authUrl: string; state: string }> {
    const state = `openkilo_oauth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const redirectUri = 'https://openkilo.com/oauth/callback/ty-code';
    const authUrl = `${OpenKiloProviderService.OAUTH_AUTH_URL}?client_id=${OpenKiloProviderService.OAUTH_CLIENT_ID}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=models:read%20models:run`;

    try {
      const electron = await import('electron').catch(() => null);
      if (electron?.shell?.openExternal) {
        await electron.shell.openExternal(authUrl);
      }
    } catch {
      // Return URL for fallback
    }

    return { authUrl, state };
  }

  /**
   * Completes OAuth flow by exchanging code for access token.
   */
  public async completeOAuthFlow(code: string): Promise<{ success: boolean; apiKey?: string; error?: string }> {
    if (!code || !code.trim()) {
      return { success: false, error: 'Authorization code is missing or empty.' };
    }

    try {
      const response = await fetch('https://openkilo.com/api/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: OpenKiloProviderService.OAUTH_CLIENT_ID,
          code: code.trim(),
          grant_type: 'authorization_code'
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        const effective = await settingsManager.getEffectiveSettings().catch(() => null);
        if (effective?.offlineDemoMode === true) {
          const demoKey = `kilo_demo_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
          this.activeAuthMode = 'oauth';
          this.storedApiKey = demoKey;
          this.userEmail = 'developer@demo.local';
          return { success: true, apiKey: demoKey };
        }
        return { success: false, error: `OpenKilo OAuth code exchange failed with HTTP ${response.status}` };
      }

      const json = await response.json() as { access_token?: string; email?: string };
      const apiKey = json.access_token;
      if (!apiKey) {
        return { success: false, error: 'OpenKilo OAuth response did not contain an access_token.' };
      }
      this.activeAuthMode = 'oauth';
      this.storedApiKey = apiKey;
      this.userEmail = json.email || null;

      return { success: true, apiKey };
    } catch (err: unknown) {
      const effective = await settingsManager.getEffectiveSettings().catch(() => null);
      if (effective?.offlineDemoMode === true) {
        const demoKey = `kilo_demo_verified_${Date.now()}`;
        this.activeAuthMode = 'oauth';
        this.storedApiKey = demoKey;
        return { success: true, apiKey: demoKey };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to connect to OpenKilo OAuth endpoint: ${message}` };
    }
  }

  /**
   * Sets manual API key for advanced users
   */
  public setApiKey(apiKey: string): void {
    this.storedApiKey = apiKey.trim();
    this.activeAuthMode = 'api_key';
  }

  /**
   * Enables zero-configuration anonymous mode for instant free access
   */
  public enableAnonymousMode(): void {
    this.activeAuthMode = 'anonymous';
    this.storedApiKey = 'anonymous';
  }
}

export const openKiloProvider = new OpenKiloProviderService();
