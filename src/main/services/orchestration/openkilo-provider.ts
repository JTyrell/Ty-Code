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
 * Curated catalog of free models on Kilo Gateway, verified against the live
 * GET https://api.kilo.ai/api/gateway/models endpoint.
 * Only genuine zero-cost model IDs are listed here.
 * Re-audited 2026-10-21 with real chat/completions probes: thinkingmachines/
 * inkling-small:free and nvidia/nemotron-3-super-120b-a12b:free now 404 on
 * Kilo, xingchen-agi/xing4.0-29b-a4b:free returns persistent upstream 429 —
 * all three were removed. Probe again before re-adding any of them.
 */
export const OPENKILO_CURATED_FREE_MODELS: OpenKiloModelDefinition[] = [
  {
    id: 'kilo-auto/free',
    name: 'Kilo Auto (Free Router)',
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 92,
    description: 'Zero-cost smart router that picks the best live free model for each request.'
  },
  {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S 2.1 Free',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 95,
    description: '262K context frontier code model purpose-built for repository-scale development.'
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code Free',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    isFree: true,
    category: 'Free',
    primaryTask: 'coding',
    codingScore: 93,
    description: 'Fast code generation and editing tuned for agentic workflows.'
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA Nemotron 3.5 Super VL Free',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 94,
    description: '1M context flagship reasoning and architectural problem solving.'
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter Free (Kilo)',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 90,
    description: 'Hassle-free routing across the OpenRouter free tier, no key needed.'
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA Nemotron 3 Ultra Free',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Premium/Reasoning',
    primaryTask: 'reasoning',
    codingScore: 96,
    description: '550B-parameter ultra tier for complex multi-step reasoning at zero cost.'
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots 3 Note Preview Free',
    contextWindow: 512_000,
    maxOutputTokens: 8_192,
    isFree: true,
    category: 'Free',
    primaryTask: 'general',
    codingScore: 88,
    description: '512K context generalist assistant for whole-repo chat and review.'
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA Nemotron 3 Nano Omni Free',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    isFree: true,
    category: 'Free',
    primaryTask: 'reasoning',
    codingScore: 90,
    description: 'Compact omni reasoning model with fast step-by-step thinking.'
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA Nemotron 3.5 Lightning Free',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 89,
    description: 'High-throughput 1M context model for long documents and light tasks.'
  },
  {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1 Free',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 91,
    description: 'Low-latency sibling of Laguna S for instant, surgical edits.'
  },
  {
    id: 'nvidia/nemotron-3.5-content-safety:free',
    name: 'NVIDIA Nemotron 3.5 Content Safety Free',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    isFree: true,
    category: 'Fast',
    primaryTask: 'general',
    codingScore: 60,
    description: 'Content-safety guard model; useful for filtering checks.'
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'Liquid LFM 2.5 2.6B Free',
    contextWindow: 65_536,
    maxOutputTokens: 8_192,
    isFree: true,
    category: 'Fast',
    primaryTask: 'fast-edit',
    codingScore: 80,
    description: 'Ultra-light model for rapid micro-edits.'
  }
];


export class OpenKiloProviderService {
  public static readonly DEFAULT_BASE_URL = 'https://api.kilo.ai/api/gateway';
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

    // Self-heal: migrate stale/paid OpenKilo model IDs to the real free auto-router.
    if (settings.activeProvider === 'openkilo' && settings.activeModel) {
      const curatedIds = new Set(OPENKILO_CURATED_FREE_MODELS.map((m) => m.id));
      if (!curatedIds.has(settings.activeModel)) {
        return {
          updatedSettings: {
            apiKeys,
            apiKeysConfigured,
            customEndpoints,
            activeModel: 'kilo-auto/free'
          },
          enabled: true
        };
      }
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
      'kilo-auto/free',
      'poolside/laguna-s-2.1:free',
      'nvidia/nemotron-3.5-super-vl:free',
      'cohere/north-mini-code:free',
      'openrouter/free'
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
          this.userEmail = null; // demo mode fabricates no account identity
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
