import type { ModelConfig, ProviderSettings, ProviderType, DiscoveredModel, TestConnectionResult } from '../../preload/types';
import { parseSSELines, type StreamPayload } from './sse-parser';
import {
  OmniRouteRouter,
  omniRouteRouter
} from '../services/orchestration/router';
import { connectionPool } from '../services/orchestration/connection-pool';
import { providerRegistry } from '../services/orchestration/provider-registry';
import { fccManager } from '../services/orchestration/fcc-manager';
import { quotaTracker } from '../services/orchestration/quota-tracker';
import { requestCache } from '../services/orchestration/request-cache';
import { performanceManager } from '../services/orchestration/performance-manager';
import { usageLedger } from '../services/usage/ledger';
import { credentialStore } from '../services/auth/credential-store';
import { optimizationPipeline } from './optimization-pipeline';
import { getPreconfiguredProvider } from '../config/provider-registry';
import type { ProviderCandidate } from '../services/orchestration/strategies/types';

import { freeProviderRegistry } from '../services/providers/free-provider-registry';
import { modelClassifier } from '../services/providers/model-classifier';
import { providerHealthMonitor } from '../services/providers/health-monitor';
import { readStoredCredentials } from '../ipc/settings-handlers';
import { keyDetector } from '../services/providers/key-detector';

import { DEFAULT_PRESET_MODELS } from '../../preload/preset-models';
export { DEFAULT_PRESET_MODELS };

export function isFreeModel(modelId: string, providerId: string): boolean {
  if (freeProviderRegistry.isFreeModel(modelId, providerId)) return true;
  if (providerId === 'ollama' || providerId === 'fcc-proxy' || providerId === 'anthropic-claude-free') return true;
  if (/:free($|:|\/)/i.test(modelId) || modelId.toLowerCase().includes(':free')) return true;
  if (providerId === 'groq' || providerId === 'groq-free') {
    const groqFree = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'];
    if (groqFree.includes(modelId)) return true;
  }
  return false;
}

export function categorizeModel(modelId: string, isFree: boolean, providerId: string): 'Free' | 'Fast' | 'Premium/Reasoning' {
  if (isFree) return 'Free';
  const tier = modelClassifier.classifyModelTier(modelId);
  if (tier === 'tier_c_fast') return 'Fast';
  if (tier === 'tier_s_reasoning' || tier === 'tier_a_coding') return 'Premium/Reasoning';
  if (providerId === 'groq' || providerId === 'groq-free' || /(instant|flash|turbo|mini|fast|8b|3b)/i.test(modelId)) return 'Fast';
  return 'Premium/Reasoning';
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface StreamEventCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onToolCallDelta?: (toolCalls: Array<{ id: string; name: string; arguments: string }>) => void;
  onFailoverNotice?: (notice: { attempt: number; failedProvider: string; nextProvider?: string; nextModel?: string; error: string }) => void;
}

interface AccumulatedToolCall { id: string; name: string; args: string; }

function appendDelta(existing: string, incoming: string | undefined): string {
  if (!incoming || incoming === existing || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  return existing + incoming;
}

export class ProviderGateway {
  public static router: OmniRouteRouter = omniRouteRouter;
  public static freeRegistry = freeProviderRegistry;
  public static modelClassifier = modelClassifier;
  public static healthMonitor = providerHealthMonitor;

  static getEndpoint(provider: ProviderType, customEndpoints: Partial<Record<ProviderType, string>> = {}): string {
    if (customEndpoints && customEndpoints[provider]) return customEndpoints[provider]!;
    const freeProvider = freeProviderRegistry.getProvider(provider);
    if (freeProvider?.base_url && freeProvider.base_url !== 'auto') return freeProvider.base_url;
    const preconfigured = getPreconfiguredProvider(provider);
    if (preconfigured?.baseUrl) return preconfigured.baseUrl;
    const registered = providerRegistry.getProvider(provider);
    if (registered?.defaultEndpoint) return registered.defaultEndpoint;
    switch (provider) {
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      case 'openkilo': return 'https://api.kilo.ai/api/gateway';
      case 'opencode': return 'https://api.opencode.ai/v1';
      case 'groq': return 'https://api.groq.com/openai/v1';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'ollama': return 'http://localhost:11434/v1';
      case 'fcc-proxy': return 'http://localhost:8082/v1';
      default: return 'https://openrouter.ai/api/v1';
    }
  }

  /**
   * Dynamic model discovery hitting the provider's /models endpoint.
   * Auto-tags free models and categorizes them into Free, Fast, and Premium/Reasoning.
   */
  static async getAvailableModels(
    providerId: string,
    apiKey?: string,
    customEndpoint?: string
  ): Promise<DiscoveredModel[]> {
    const preconfigured = getPreconfiguredProvider(providerId);
    const baseUrl = (customEndpoint || preconfigured?.baseUrl || this.getEndpoint(providerId as ProviderType, {})).replace(/\/+$/, '');

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ty-code.dev';
      headers['X-Title'] = 'Ty-Code Desktop';
    }

    let rawModels: Array<{ id: string; name?: string; description?: string; context_length?: number }> = [];

    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000)
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid API Key');
        }
        if (providerId === 'ollama' || baseUrl.includes('11434')) {
          return await this.fetchOllamaNativeTags(baseUrl);
        }
        const errorText = await response.text();
        throw new Error(`Failed to fetch models (${response.status}): ${errorText.slice(0, 150)}`);
      }

      const data = await response.json() as { data?: Array<any>; models?: Array<any> };
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      rawModels = list.map((m: any) => ({
        id: String(m.id || m.name || ''),
        name: typeof m.name === 'string' && m.name ? m.name : String(m.id || ''),
        description: typeof m.description === 'string' ? m.description : undefined,
        context_length: typeof m.context_length === 'number' ? m.context_length : typeof m.context_window === 'number' ? m.context_window : undefined
      })).filter((m) => Boolean(m.id));
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Invalid API Key') {
        throw err;
      }
      if (providerId === 'ollama' || baseUrl.includes('11434')) {
        try {
          return await this.fetchOllamaNativeTags(baseUrl);
        } catch {
          // Ignore and rethrow original or return empty
        }
      }
      throw err;
    }

    return rawModels.map((m) => {
      const free = isFreeModel(m.id, providerId);
      const category = categorizeModel(m.id, free, providerId);
      return {
        id: m.id,
        name: m.name || m.id,
        provider: providerId,
        isFree: free,
        category,
        contextLength: m.context_length,
        description: m.description
      };
    });
  }

  private static async fetchOllamaNativeTags(baseUrl: string): Promise<DiscoveredModel[]> {
    const rootUrl = baseUrl.replace(/\/v1\/?$/, '');
    const tagRes = await fetch(`${rootUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000)
    });
    if (!tagRes.ok) {
      throw new Error(`Ollama tags request failed with status ${tagRes.status}`);
    }
    const json = await tagRes.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
    const list = Array.isArray(json.models) ? json.models : [];
    return list.map((m) => ({
      id: m.name,
      name: `${m.name} (${m.details?.parameter_size || 'local'})`,
      provider: 'ollama',
      isFree: true,
      category: 'Free' as const,
      description: 'Local offline Ollama model'
    }));
  }

  private static validatedModelsCache = new Set<string>();

  public static async ensureModelAvailable(
    providerId: string,
    modelId: string,
    apiKey?: string,
    customEndpoint?: string,
    offlineDemoMode?: boolean
  ): Promise<void> {
    const cacheKey = `${providerId}:${modelId}`;
    if (this.validatedModelsCache.has(cacheKey)) return;

    if (offlineDemoMode || providerId === 'fcc-proxy') {
      this.validatedModelsCache.add(cacheKey);
      return;
    }

    try {
      const models = await this.getAvailableModels(providerId, apiKey, customEndpoint);
      if (Array.isArray(models) && models.length > 0) {
        const found = models.some((m) => m.id === modelId || m.name === modelId || m.id.endsWith(`/${modelId}`));
        if (!found) {
          const validFree = models.filter((m) => m.isFree).map((m) => m.id);
          const error = new Error(
            `[MODEL_UNAVAILABLE] Model ID "${modelId}" is not available on provider "${providerId}". Valid models include: ${models.slice(0, 5).map((m) => m.id).join(', ')}`
          );
          (error as any).validFreeModels = validFree;
          throw error;
        }
      }
      this.validatedModelsCache.add(cacheKey);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('MODEL_UNAVAILABLE')) {
        throw err;
      }
      if (err instanceof Error && (err.message.includes('Invalid API Key') || err.message.includes('401') || err.message.includes('403'))) {
        throw err;
      }
      this.validatedModelsCache.add(cacheKey);
    }
  }

  /**
   * Test connection to a provider endpoint.
   * Sends a minimal 1-token completion request to verify credentials, or pings local server for zero-config.
   */
  static async testConnection(
    providerId: string,
    apiKey?: string,
    modelId?: string,
    customEndpoint?: string
  ): Promise<TestConnectionResult> {
    const startTime = performance.now();
    const preconfigured = getPreconfiguredProvider(providerId);
    const baseUrl = (customEndpoint || preconfigured?.baseUrl || this.getEndpoint(providerId as ProviderType, {})).replace(/\/+$/, '');

    // Zero-config (e.g. Ollama) or Custom provider without required key: ping server / models endpoint
    if (preconfigured?.setupType === 'zero_config' || providerId === 'ollama' || (providerId === 'custom' && !apiKey?.trim())) {
      try {
        let modelsCount = 0;
        try {
          const models = await this.getAvailableModels(providerId, apiKey, customEndpoint);
          modelsCount = models.length;
        } catch {
          const pingRes = await fetch(baseUrl, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => null);
          if (!pingRes || (!pingRes.ok && pingRes.status !== 404)) {
            const rootUrl = baseUrl.replace(/\/v1\/?$/, '');
            const pingRoot = await fetch(rootUrl, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (!pingRoot || !pingRoot.ok) {
              return {
                success: false,
                latencyMs: Math.round(performance.now() - startTime),
                error: `Cannot connect to ${providerId === 'ollama' ? 'Ollama' : 'endpoint'}. Make sure the server is running.`
              };
            }
          }
        }
        return {
          success: true,
          latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
          modelsFound: modelsCount
        };
      } catch (err: unknown) {
        return {
          success: false,
          latencyMs: Math.round(performance.now() - startTime),
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    if (!apiKey?.trim()) {
      return {
        success: false,
        latencyMs: 0,
        error: 'API key is required.'
      };
    }

    const testModel = modelId || preconfigured?.defaultModel || (providerId === 'groq' ? 'llama-3.3-70b-versatile' : 'meta-llama/llama-3.3-70b-instruct:free');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    };
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ty-code.dev';
      headers['X-Title'] = 'Ty-Code Desktop';
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(12_000)
      });

      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            latencyMs,
            error: 'Invalid API Key'
          };
        }
        let parsedError = `HTTP ${response.status}`;
        try {
          const errJson = await response.json() as { error?: { message?: string }; message?: string };
          parsedError = errJson.error?.message || errJson.message || parsedError;
        } catch {
          const errText = await response.text();
          if (errText) parsedError = errText.slice(0, 150);
        }
        providerHealthMonitor.recordRequestOutcome(providerId, false, latencyMs, parsedError);
        return {
          success: false,
          latencyMs,
          error: parsedError
        };
      }

      providerHealthMonitor.recordRequestOutcome(providerId, true, latencyMs);
      return {
        success: true,
        latencyMs
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      const message = err instanceof Error ? err.message : String(err);
      providerHealthMonitor.recordRequestOutcome(providerId, false, latencyMs, message);
      return {
        success: false,
        latencyMs,
        error: message.includes('fetch failed') ? `Connection failed: Unable to reach ${baseUrl}` : message
      };
    }
  }

  static async streamChat(
    settings: ProviderSettings,
    messages: ChatCompletionMessage[],
    tools: unknown[],
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal,
    traceId?: string
  ): Promise<{ fullText: string; fullThought: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    // Determine primary task based on tools or message signals
    const hasTools = tools && tools.length > 0;
    const taskType = hasTools ? 'coding' : 'general';

    // Phase FCC-4: Headroom Context Pruning of Stale Tool Results
    const headroomResult = optimizationPipeline.pruneMessageHistory(messages);
    const optimizedMessages = headroomResult.prunedMessages;

    const executionResult = await this.router.executeWithFailover({
      context: {
        taskType,
        requiredCapabilities: { tools: hasTools },
        manualSelection: {
          providerId: settings.activeProvider,
          modelId: settings.activeModel
        }
      },
      settings,
      messages: optimizedMessages,
      abortSignal,
      onFailover: (event) => {
        callbacks.onFailoverNotice?.({
          attempt: event.attempt,
          failedProvider: event.failedProvider,
          nextProvider: event.nextProvider,
          nextModel: event.nextModel,
          error: event.error
        });
      },
      execute: async (candidate: ProviderCandidate, reconciledMessages: ChatCompletionMessage[]) => {
        return this.streamWithCandidate(candidate, settings, reconciledMessages, tools, callbacks, abortSignal, traceId);
      }
    });

    return executionResult.result;
  }

  private static async streamWithCandidate(
    candidate: ProviderCandidate,
    settings: ProviderSettings,
    messages: ChatCompletionMessage[],
    tools: unknown[],
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal,
    traceId?: string
  ): Promise<{ fullText: string; fullThought: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    const providerId = candidate.provider.id as ProviderType;
    const modelId = candidate.model.id;
    const baseUrl = candidate.customEndpoint || this.getEndpoint(providerId, settings.customEndpoints || {});

    // Resolve key at call time via safeStorage decryption; anonymous providers use no key
    let apiKey = '';
    const freeProv = freeProviderRegistry.getProvider(providerId) || freeProviderRegistry.getProvider(`${providerId}-free`);
    const isAnonymous =
      (providerId === 'openkilo' || providerId === 'openkilo-free' || freeProv?.auth_type === 'anonymous') &&
      (!settings.apiKeys?.[providerId] || settings.apiKeys[providerId] === 'anonymous');
    const isLocalZeroConfig = providerId === 'ollama';

    if (providerId === 'fcc-proxy') {
      const isCustomEndpoint = Boolean(candidate.customEndpoint) || Boolean(settings.customEndpoints?.['fcc-proxy']);
      if (!isCustomEndpoint && !fccManager.isGenuineBinaryRunning()) {
        throw new Error('[ProviderGateway] CONFIG_MISSING: Genuine free-claude-code binary is not running. Please install free-claude-code or connect an AI provider.');
      }
    }

    if (!isAnonymous && !isLocalZeroConfig && providerId !== 'fcc-proxy') {
      if (candidate.apiKey && candidate.apiKey.trim()) {
        apiKey = candidate.apiKey.trim();
      } else {
        // 1. Try secure credentialStore (RealConnect 2 Electron safeStorage)
        const storedKey = credentialStore.getDecryptedKey(providerId);
        if (storedKey && storedKey.trim()) {
          apiKey = storedKey.trim();
        } else {
          // 2. Fall back to settings-handlers or settings.apiKeys
          try {
            const { keys } = await readStoredCredentials();
            apiKey = keys[providerId] || keys[providerId.replace(/-free$/, '')] || settings.apiKeys?.[providerId] || '';
          } catch {
            apiKey = settings.apiKeys?.[providerId] || '';
          }
        }
      }

      // 3. Auto-detect from environment variables if not yet saved
      if (!apiKey || !apiKey.trim()) {
        const envKeyMap: Record<string, string[]> = {
          openrouter: ['OPENROUTER_API_KEY'],
          'openrouter-free': ['OPENROUTER_API_KEY'],
          groq: ['GROQ_API_KEY'],
          'groq-free': ['GROQ_API_KEY'],
          anthropic: ['ANTHROPIC_API_KEY'],
          openai: ['OPENAI_API_KEY'],
          'google-ai-studio': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          'google-ai-studio-free': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          deepseek: ['DEEPSEEK_API_KEY'],
          'together-ai-free': ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
          'fireworks-ai-free': ['FIREWORKS_API_KEY'],
          'huggingface-free': ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
          mistral: ['MISTRAL_API_KEY'],
          cohere: ['COHERE_API_KEY']
        };

        const envVars = envKeyMap[providerId] || envKeyMap[providerId.replace(/-free$/, '')] || [];
        for (const ev of envVars) {
          const val = process.env[ev];
          if (val && val.trim().length > 4) {
            apiKey = val.trim();
            void credentialStore.saveCredential(providerId, apiKey, `Auto-detected from $${ev}`).catch(() => undefined);
            break;
          }
        }
      }

      // 4. Auto-detect from system config files or git credentials
      if (!apiKey || !apiKey.trim()) {
        try {
          const detected = keyDetector.detectFromEnvironment();
          const target = detected.find(
            (d) => d.providerId === providerId || d.providerId === providerId.replace(/-free$/, '')
          );
          if (target?.rawKey) {
            apiKey = target.rawKey;
            void credentialStore
              .saveCredential(providerId, apiKey, `Auto-detected from ${target.sourceDescription || target.source}`)
              .catch(() => undefined);
          }
        } catch {
          // Non-blocking
        }
      }

      if (!apiKey || !apiKey.trim()) {
        throw new Error(
          `[ProviderGateway] CONFIG_MISSING: No API key configured for provider "${providerId}". Use 1-Click Auto-Detect or switch to OpenKilo (Zero-Key Free) or Ollama (Local).`
        );
      }
    }

    // Validate model IDs against live /models before first call; invalid -> MODEL_UNAVAILABLE error
    await ProviderGateway.ensureModelAvailable(providerId, modelId, apiKey, baseUrl, settings.offlineDemoMode === true);

    // H5: Provider Gateway Resolution (log key PRESENCE ONLY, never value)
    if (traceId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
        connectivityTracer.recordHop(traceId, 'H5', {
          status: 'PASS',
          metadata: {
            providerId,
            modelId,
            baseUrl,
            keyPresent: Boolean(apiKey),
            keyLength: apiKey ? apiKey.length : 0,
            keySource: candidate.apiKey ? 'candidate' : (settings.apiKeys[providerId] ? 'safeStorage' : 'none')
          }
        });
      } catch {
        // ignore trace recording error
      }
    }

    // Phase FCC-4: Semantic Response Cache (hash-keyed, per-session opt-out)
    const optCacheKey = optimizationPipeline.computeCacheKey(modelId, messages, tools, settings.temperature);
    const optCached = optimizationPipeline.getCachedResponse(optCacheKey);
    if (optCached) {
      if (optCached.fullText) callbacks.onToken?.(optCached.fullText);
      if (optCached.fullThought) callbacks.onThought?.(optCached.fullThought);
      callbacks.onToolCallDelta?.(optCached.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments)
      })));
      performanceManager.recordLatency(4);
      return {
        fullText: optCached.fullText,
        fullThought: optCached.fullThought,
        toolCalls: optCached.toolCalls
      };
    }

    // Phase 5.6: Request Caching for Repeated Queries
    const cacheKey = requestCache.computeKey(modelId, messages, tools, settings.temperature);
    const cached = requestCache.get(cacheKey);
    if (cached) {
      if (cached.fullText) callbacks.onToken?.(cached.fullText);
      if (cached.fullThought) callbacks.onThought?.(cached.fullThought);
      callbacks.onToolCallDelta?.(cached.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments)
      })));
      performanceManager.recordLatency(4);
      return {
        fullText: cached.fullText,
        fullThought: cached.fullThought,
        toolCalls: cached.toolCalls
      };
    }

    const requestStartTime = performance.now();

    if (providerId === 'fcc-proxy' && !fccManager.getStatus().running) {
      await fccManager.start();
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (candidate.provider.headersFactory) {
      Object.assign(headers, candidate.provider.headersFactory({ apiKey }));
    } else if (providerId === 'fcc-proxy' || providerId === 'openrouter') {
      headers['User-Agent'] = 'free-claude-code/0.9.4 (Ty-Code Desktop Sidecar)';
      headers['HTTP-Referer'] = 'https://github.com/Alishahryar1/free-claude-code';
      headers['X-Title'] = 'Ty-Code Desktop';
      if (providerId === 'fcc-proxy') {
        headers['X-FCC-Client'] = 'ty-code';
      }
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: true,
      temperature: settings.temperature ?? 0.2,
      max_tokens: Math.min(settings.maxTokens ?? 4096, candidate.model.maxOutputTokens || 4096)
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    let response: Response;
    const fetchStartTime = performance.now();
    const gatewayUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    console.log('Gateway: Fetching from', gatewayUrl, 'with model', modelId, 'headers', JSON.stringify({ ...headers, ...(headers.Authorization ? { Authorization: 'Bearer ***' } : {}) }));
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortSignal
      });
    } catch (networkErr: unknown) {
      console.error('Gateway: NETWORK ERROR for', gatewayUrl, networkErr instanceof Error ? `${networkErr.name}: ${networkErr.message} cause=${(networkErr as { cause?: { code?: string } }).cause?.code ?? ''}` : String(networkErr));
      if (traceId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
          connectivityTracer.recordHop(traceId, 'H6', {
            status: 'FAIL',
            durationMs: Math.round(performance.now() - fetchStartTime),
            error: networkErr instanceof Error ? networkErr.message : String(networkErr),
            metadata: {
              url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
              method: 'POST',
              errorType: 'network_blocked'
            }
          });
        } catch {
          // ignore
        }
      }
      throw networkErr;
    }

    console.log('Gateway: Response status', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gateway: Error body', errorText.slice(0, 500));
      let parsedError = errorText;
      try {
        const errorJson = JSON.parse(errorText) as { error?: { message?: string }; message?: string };
        parsedError = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        // Use provider's raw error response
      }

      if (traceId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
          connectivityTracer.recordHop(traceId, 'H6', {
            status: 'FAIL',
            durationMs: Math.round(performance.now() - fetchStartTime),
            error: `HTTP ${response.status}: ${parsedError}`,
            metadata: {
              url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
              method: 'POST',
              status: response.status,
              statusText: response.statusText
            }
          });
        } catch {
          // ignore
        }
      }

      if (response.headers) {
        usageLedger.updateRateLimitsFromHeaders(providerId, response.headers);
      }
      void usageLedger.recordTransaction({
        providerId,
        modelId,
        latencyMs: Math.round(performance.now() - requestStartTime),
        success: false,
        error: `HTTP ${response.status}: ${parsedError}`,
        headers: response.headers
      });
      throw new Error(`[${providerId}] API Error (${response.status}): ${parsedError}`);
    }

    if (traceId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
        connectivityTracer.recordHop(traceId, 'H6', {
          status: 'PASS',
          durationMs: Math.round(performance.now() - fetchStartTime),
          metadata: {
            url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
            method: 'POST',
            status: 200,
            statusText: 'OK'
          }
        });
      } catch {
        // ignore
      }
    }

    if (response.headers) {
      usageLedger.updateRateLimitsFromHeaders(providerId, response.headers);
    }

    if (!response.body) throw new Error(`[${providerId}] Response body is empty`);

    let fullText = '';
    let fullThought = '';
    let firstChunkReported = false;
    let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
    const toolCalls = new Map<number, AccumulatedToolCall>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const consume = (payload: StreamPayload) => {
      if (payload.usage) {
        streamUsage = payload.usage;
      }
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        if (!firstChunkReported) console.log('Gateway: First chunk', JSON.stringify(delta.content.slice(0, 80)));
        fullText += delta.content;
        callbacks.onToken?.(delta.content);

        if (traceId && !firstChunkReported) {
          firstChunkReported = true;
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
            connectivityTracer.recordHop(traceId, 'H7', {
              status: 'PASS',
              payloadSize: delta.content.length,
              metadata: {
                firstChunkParsed: true,
                deltaPreview: delta.content.slice(0, 40),
                timeToFirstTokenMs: Math.round(performance.now() - fetchStartTime)
              }
            });
          } catch {
            // ignore
          }
        }
      }
      const thought = delta.reasoning_content || delta.reasoning;
      if (thought) {
        fullThought += thought;
        callbacks.onThought?.(thought);
      }
      if (!delta.tool_calls) return;
      delta.tool_calls.forEach((toolCall, offset) => {
        const index = Number.isInteger(toolCall.index)
          ? toolCall.index as number
          : toolCall.id ? Array.from(toolCalls.entries()).find(([, item]) => item.id === toolCall.id)?.[0] ?? toolCalls.size + offset
            : toolCalls.size + offset;
        const current = toolCalls.get(index) || { id: '', name: '', args: '' };
        current.id = appendDelta(current.id, toolCall.id);
        current.name = appendDelta(current.name, toolCall.function?.name);
        current.args += toolCall.function?.arguments || '';
        toolCalls.set(index, current);
      });
      callbacks.onToolCallDelta?.(Array.from(toolCalls.values()).map((toolCall) => ({
        id: toolCall.id, name: toolCall.name, arguments: toolCall.args
      })));
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSELines(buffer, consume);
      }
      buffer += decoder.decode();
      if (buffer) parseSSELines(`${buffer}\n`, consume);
    } finally {
      reader.releaseLock();
    }

    const parsedToolCalls = Array.from(toolCalls.values()).map((toolCall) => {
      if (!toolCall.name || !toolCall.args) throw new Error('The model returned an incomplete tool call. Try again.');
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.args) as Record<string, unknown>;
      } catch {
        throw new Error(`Malformed JSON in tool call arguments for ${toolCall.name}.`);
      }
      return { id: toolCall.id || `call_${crypto.randomUUID()}`, name: toolCall.name, arguments: args };
    });

    if (providerId === 'fcc-proxy') {
      fccManager.recordTokenUsage(Math.max(10, Math.ceil(fullText.length / 4)));
    }

    const finalUsage = streamUsage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    const isExact = Boolean(finalUsage && (finalUsage.prompt_tokens || finalUsage.total_tokens));
    const promptTokens = finalUsage?.prompt_tokens ?? Math.max(1, Math.ceil(JSON.stringify(messages).length / 3.8));
    const completionTokens = finalUsage?.completion_tokens ?? Math.max(1, Math.ceil(fullText.length / 3.8));
    const totalTokens = finalUsage?.total_tokens ?? (promptTokens + completionTokens);

    quotaTracker.recordUsage(providerId, modelId, {
      promptTokens,
      completionTokens,
      totalTokens
    }, true);

    const elapsedMs = Math.max(1, Math.round(performance.now() - requestStartTime));
    performanceManager.recordLatency(elapsedMs);

    void usageLedger.recordTransaction({
      providerId,
      modelId,
      promptTokens,
      completionTokens,
      totalTokens,
      isExactUsage: isExact,
      latencyMs: elapsedMs,
      success: true,
      headers: response.headers
    });

    try {
      credentialStore.touchCredential(providerId);
    } catch {
      // non-blocking
    }

    requestCache.set(cacheKey, {
      fullText,
      fullThought,
      toolCalls: parsedToolCalls,
      modelId,
      providerId,
      promptTokens,
      completionTokens
    });

    optimizationPipeline.setCachedResponse(optCacheKey, {
      fullText,
      fullThought,
      toolCalls: parsedToolCalls,
      promptTokens,
      completionTokens
    });

    return { fullText, fullThought, toolCalls: parsedToolCalls };
  }
}

export { omniRouteRouter, connectionPool, providerRegistry, quotaTracker };
