/**
 * OmniRoute Router Core (Layer 2)
 *
 * Central model aggregation and intelligent multi-provider orchestration engine:
 * - Connection pool management with 30s background health monitoring
 * - Automatic failover: retries across healthy alternative providers on failure
 * - Request-level routing based on model availability, capabilities, and health scores
 * - Cooldown management with exponential backoff for rate-limited endpoints
 * - Context window reconciliation across disparate model limits
 */

import type { ProviderSettings, RoutingStrategyType } from '../../../preload/types';
import type { ChatCompletionMessage } from '../../providers/provider-gateway';
import { ConnectionPool, connectionPool } from './connection-pool';
import { ProviderRegistry, providerRegistry, type ProviderMetadata, type ModelMetadata } from './provider-registry';
import { getRoutingStrategy } from './strategies';
import { fccManager } from './fcc-manager';
import { modelRotationManager, FALLBACK_CHAIN } from '../model-rotation-manager';
import { credentialStore } from '../auth/credential-store';
import type { ProviderCandidate, RoutingContext } from './strategies/types';
import { providerHealthStore } from '../../providers/provider-health-store';
import { routeEventPolicy } from '../../providers/route-event-policy';
import { sidecarLogLedger } from '../fcc/sidecar-log-ledger';
import { FAILOVER_RESUME_INSTRUCTION } from '../fcc/sidecar-line-classifier';

export interface FailoverEvent {
  attempt: number;
  failedProvider: string;
  error: string;
  nextProvider?: string;
  nextModel?: string;
}


export interface RoutingExecutionResult<T> {
  result: T;
  selectedCandidate: ProviderCandidate;
  attempts: number;
  failoverHistory: FailoverEvent[];
  latencyMs: number;
}

export interface ExecuteWithFailoverOptions<T> {
  context: RoutingContext;
  settings: ProviderSettings;
  messages: ChatCompletionMessage[];
  /**
   * `carriedPartial` is non-empty when a previous sibling attempt already
   * streamed visible content before failing — the fresh attempt must CONTINUE
   * that content (never restart it).
   */
  execute: (candidate: ProviderCandidate, reconciledMessages: ChatCompletionMessage[], carriedPartial?: string) => Promise<T>;
  onFailover?: (event: FailoverEvent) => void;
  abortSignal?: AbortSignal;
}

export class OmniRouteRouter {
  constructor(
    public readonly registry: ProviderRegistry = providerRegistry,
    public readonly pool: ConnectionPool = connectionPool
  ) {}

  /**
   * Starts background health monitoring pinging providers every 30s
   */
  public startHealthMonitoring(intervalMs = 30_000): void {
    this.pool.startMonitoring(intervalMs);
  }

  /**
   * Stops background health monitoring
   */
  public stopHealthMonitoring(): void {
    this.pool.stopMonitoring();
  }

  /**
   * Estimates token count for chat messages (~4 characters per token)
   */
  public estimateTokens(messages: ChatCompletionMessage[]): number {
    let charCount = 0;
    for (const m of messages) {
      charCount += (m.content || '').length;
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          charCount += tc.function.name.length + tc.function.arguments.length;
        }
      }
    }
    return Math.ceil(charCount / 4);
  }

  /**
   * Reconciles message history with the target model's context window limit.
   * If messages exceed the budget (contextWindow - maxOutputTokens - buffer),
   * older conversational turns and bulky tool outputs are pruned while preserving
   * the system prompt and latest user instruction.
   */
  public reconcileContextWindow(
    messages: ChatCompletionMessage[],
    contextLimit: number,
    maxOutputTokens = 4096
  ): ChatCompletionMessage[] {
    if (!messages.length) return [];

    const safetyBuffer = 600;
    const maxInputTokens = Math.max(1000, contextLimit - maxOutputTokens - safetyBuffer);
    const estimated = this.estimateTokens(messages);

    if (estimated <= maxInputTokens) {
      return messages;
    }

    // Must reconcile: keep system message (0) and last user message (length - 1)
    const systemMessage = messages[0].role === 'system' ? messages[0] : null;
    const startIndex = systemMessage ? 1 : 0;
    const lastMessage = messages[messages.length - 1];

    const pruned: ChatCompletionMessage[] = systemMessage ? [systemMessage] : [];

    // Add truncation notice
    pruned.push({
      role: 'system',
      content: `[Context reconciliation: Earlier conversation history was truncated to fit the target model's ${contextLimit} token context window.]`
    });

    // Collect middle messages working backward from newest to oldest
    const middleTurns: ChatCompletionMessage[] = [];
    let currentTokens = this.estimateTokens(pruned) + this.estimateTokens([lastMessage]);

    for (let i = messages.length - 2; i >= startIndex; i--) {
      const msg = messages[i];
      let msgToInclude = msg;

      // Truncate overly long individual messages
      if (msg.content && msg.content.length > 3000) {
        msgToInclude = {
          ...msg,
          content: msg.content.slice(0, 2500) + '\n[...truncated to fit context budget...]'
        };
      }

      const turnTokens = this.estimateTokens([msgToInclude]);
      if (currentTokens + turnTokens <= maxInputTokens) {
        middleTurns.unshift(msgToInclude);
        currentTokens += turnTokens;
      } else {
        break;
      }
    }

    pruned.push(...middleTurns);
    if (lastMessage !== systemMessage) {
      pruned.push(lastMessage);
    }

    return pruned;
  }

  /**
   * Collects all candidate providers configured with API keys, local endpoints, or free tiers
   */
  public getCandidates(settings: ProviderSettings): ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];
    const storeKeys = credentialStore.getAllDecryptedKeys();
    const configuredKeys = { ...storeKeys, ...(settings.apiKeys || {}) };
    const customEndpoints = settings.customEndpoints || {};

    const allProviders = this.registry.getAllProviders();

    for (const provider of allProviders) {
      const pNorm = provider.id.toLowerCase().trim().replace(/-free$/, '');
      const apiKey = configuredKeys[provider.id] || configuredKeys[pNorm] || credentialStore.getDecryptedKey(provider.id);
      const customEndpoint = customEndpoints[provider.id];

      const isConfigured = Boolean(apiKey);
      const isLocal = provider.category === 'local';

      // REMOVE fcc-proxy from generic fallback chain: only allowed if activeProvider AND (customEndpoint or genuine binary running)
      if (provider.id === 'fcc-proxy') {
        const hasEndpoint = Boolean(customEndpoint) || Boolean(customEndpoints['fcc-proxy']);
        if (provider.id !== settings.activeProvider || (!hasEndpoint && !fccManager.isGenuineBinaryRunning())) {
          continue;
        }
      }

      // Local providers are only candidates if their endpoint is configured, or if provider is ollama with configured endpoint, or if activeProvider
      if (isLocal) {
        const hasEndpoint = Boolean(customEndpoint) || (provider.id === 'ollama' && Boolean(customEndpoints.ollama));
        if (!hasEndpoint && provider.id !== settings.activeProvider) {
          continue;
        }
      } else if (provider.category === 'web_cookie' || provider.category === 'oauth') {
        // Web cookie or OAuth providers require configured credential or active selection
        if (!isConfigured && provider.id !== settings.activeProvider) {
          continue;
        }
      } else {
        // API key providers require an API key unless they offer an open free tier (like OpenRouter, OpenKilo, or FCC free models) or activeProvider
        if (!isConfigured && provider.id !== 'openrouter' && provider.id !== 'openkilo' && provider.id !== 'fcc' && provider.id !== 'fcc-proxy' && !provider.isFreeTierAvailable && provider.id !== settings.activeProvider) {
          continue;
        }
      }

      for (const model of provider.supportedModels) {
        // If provider is not configured with an API key, only include models explicitly marked as free
        if (!isConfigured && !isLocal && !model.capabilities.isFree && provider.id !== settings.activeProvider) {
          continue;
        }

        candidates.push({
          provider,
          model,
          apiKey: apiKey || (provider.id === 'openkilo' ? 'anonymous' : undefined),
          customEndpoint: customEndpoint || undefined
        });
      }
    }

    // Always ensure the currently active model is present if not already matched
    const activeProviderId = settings.activeProvider;
    const activeModelId = settings.activeModel;
    const hasActiveCandidate = candidates.some(
      (c) => c.provider.id === activeProviderId && c.model.id === activeModelId
    );

    if (!hasActiveCandidate && activeProviderId) {
      let prov = this.registry.getProvider(activeProviderId);
      if (!prov) {
        prov = {
          id: activeProviderId,
          name: activeProviderId,
          category: activeProviderId === 'fcc-proxy' || activeProviderId === 'ollama' ? 'local' : 'api_key',
          authMethod: activeProviderId === 'fcc-proxy' || activeProviderId === 'ollama' ? 'none' : 'api_key',
          defaultEndpoint: customEndpoints[activeProviderId] || (activeProviderId === 'fcc-proxy' ? 'http://127.0.0.1:8082/v1' : activeProviderId === 'ollama' ? 'http://localhost:11434/v1' : 'https://openrouter.ai/api/v1'),
          isFreeTierAvailable: activeProviderId === 'fcc-proxy' || activeProviderId === 'ollama',
          rateLimitPattern: { requestsPerMinute: 60, tokensPerMinute: 100_000, cooldownBaseMs: 5000, maxCooldownMs: 120_000 },
          supportedModels: []
        };
      }

      const syntheticModel: ModelMetadata = {
        id: activeModelId || `${activeProviderId}-model`,
        name: activeModelId || `${activeProviderId} Model`,
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        capabilities: { reasoning: false, tools: true, vision: false, codingScore: 90 },
        costTier: 'low',
        primaryTask: 'coding'
      };

      candidates.unshift({
        provider: prov,
        model: syntheticModel,
        apiKey: configuredKeys[activeProviderId],
        customEndpoint: customEndpoints[activeProviderId]
      });
    }

    return candidates;
  }

  /**
   * Routes a request to the best candidate according to the active strategy and context
   */
  public route(context: RoutingContext, settings: ProviderSettings): ProviderCandidate | null {
    const candidates = this.getCandidates(settings);
    if (!candidates.length) return null;

    const strategyType: RoutingStrategyType = settings.routingStrategy || 'auto';
    const strategy = getRoutingStrategy(strategyType);

    // If manual strategy, populate context with active settings
    const enrichedContext: RoutingContext = {
      ...context,
      manualSelection: context.manualSelection || {
        providerId: settings.activeProvider,
        modelId: settings.activeModel
      }
    };

    return strategy.select(candidates, enrichedContext, this.pool);
  }

  /**
   * Executes a model call with automatic multi-provider failover.
   * If a provider fails (e.g. rate limit 429, timeout, network error),
   * OmniRoute automatically selects the next best alternative provider and retries.
   */
  public async executeWithFailover<T>(
    optionsOrMessages: ExecuteWithFailoverOptions<T> | ChatCompletionMessage[],
    maybeSettings?: ProviderSettings,
    maybeExecute?: (candidate: ProviderCandidate, reconciledMessages: ChatCompletionMessage[], carriedPartial?: string) => Promise<T>,
    maybeOnFailover?: (event: FailoverEvent) => void,
    maybeContext?: RoutingContext
  ): Promise<RoutingExecutionResult<T>> {
    let options: ExecuteWithFailoverOptions<T>;
    if (Array.isArray(optionsOrMessages)) {
      options = {
        messages: optionsOrMessages,
        settings: maybeSettings || ({} as ProviderSettings),
        execute: maybeExecute!,
        onFailover: maybeOnFailover,
        context: maybeContext || {}
      };
    } else {
      options = optionsOrMessages;
    }

    const { context = {}, settings = {} as ProviderSettings, messages, execute } = options;

    const failoverEnabled = settings.enableFailover !== false;
    const maxRetries = failoverEnabled ? (settings.maxFailoverRetries ?? 3) : 1;
    // Sticky health is read at request time: providers with a persisted
    // invalid_key (or a live Retry-After TTL) are excluded before the first
    // attempt, so they are never re-walked and never re-announced.
    const excludedProviders = new Set<string>(context.excludedProviders || []);
    for (const dead of providerHealthStore.deadProviderSet()) {
      excludedProviders.add(dead);
      excludedProviders.add(`${dead}-free`);
      routeEventPolicy.recordSkip(undefined, dead);
    }
    const failoverHistory: FailoverEvent[] = [];

    // Retry idempotency (Prompt 2): only ZERO-token attempts may restart from
    // scratch. When an attempt already streamed visible content and then
    // failed, the partial text is carried forward and the next provider
    // receives the assistant prefix + resume instruction to continue.
    let attemptMessages = messages;
    let carriedPartial = '';

    let attempt = 0;
    const startTime = Date.now();

    while (attempt < maxRetries) {
      attempt++;

      const routeContext: RoutingContext = {
        ...context,
        excludedProviders,
        promptTokensEstimate: this.estimateTokens(attemptMessages)
      };

      const candidate = this.route(routeContext, settings);
      if (!candidate) {
        throw new Error(
          `[OmniRoute] No healthy provider candidates available for routing. (Attempts: ${attempt}, Excluded: ${Array.from(excludedProviders).join(', ')})`
        );
      }

      const reconciledMessages = this.reconcileContextWindow(
        attemptMessages,
        candidate.model.contextWindow,
        candidate.model.maxOutputTokens
      );

      const requestStart = Date.now();
      try {
        const result = await execute(candidate, reconciledMessages, carriedPartial || undefined);
        const reqLatency = Date.now() - requestStart;

        // Record success in connection pool
        this.pool.recordSuccess(candidate.provider.id, reqLatency);

        return {
          result,
          selectedCandidate: candidate,
          attempts: attempt,
          failoverHistory,
          latencyMs: Date.now() - startTime
        };
      } catch (err: unknown) {
        if (options.abortSignal?.aborted) {
          throw err;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        const statusCodeMatch = errorMsg.match(/\((\d{3})\)/);
        const statusCode = statusCodeMatch ? Number(statusCodeMatch[1]) : undefined;

        // Retry idempotency (Prompt 2): the streaming execute attaches how many
        // token chars it already pushed downstream (`__attemptTokensReceived`)
        // and the total visible partial text (`__carriedPartial`). A request
        // that produced visible tokens is NEVER silently re-run — it continues.
        const meta = err as { __attemptTokensReceived?: number; __carriedPartial?: string };
        const tokensReceived = typeof meta.__attemptTokensReceived === 'number' && meta.__attemptTokensReceived > 0
          ? meta.__attemptTokensReceived
          : 0;
        const carriedVisible = typeof meta.__carriedPartial === 'string' ? meta.__carriedPartial : '';
        const canCarry = tokensReceived > 0 && carriedVisible.trim().length > 0;
        sidecarLogLedger.record(
          'rerun-decision',
          `[OmniRoute] ${candidate.provider.id} failed (HTTP ${statusCode ?? 'err'}) after ${tokensReceived} token chars → ${attempt < maxRetries ? (canCarry ? 'carry partial to next provider' : 'fresh attempt (no visible partial to resume)') : 'exhausted, surfacing error'}`
        );
        if (canCarry && attempt < maxRetries) {
          carriedPartial = carriedVisible;
          attemptMessages = [
            ...messages,
            { role: 'assistant', content: carriedPartial },
            { role: 'user', content: FAILOVER_RESUME_INSTRUCTION }
          ] as ChatCompletionMessage[];
        }

        // Record failure & trigger exponential cooldown if 429
        this.pool.recordFailure(candidate.provider.id, errorMsg, statusCode);
        excludedProviders.add(candidate.provider.id);

        // Sticky health: auth rejections persist, rate limits keep a TTL in memory.
        if (statusCode === 401 || statusCode === 403 || /invalid api key|api key not valid|unauthori[sz]ed/i.test(errorMsg)) {
          providerHealthStore.markInvalidKey(candidate.provider.id, statusCode ?? 401);
        } else if (statusCode === 429 || /\[RATE_LIMITED\]/.test(errorMsg)) {
          const retryAfter = errorMsg.match(/retry[- ]after[^\d]*(\d+)/i);
          providerHealthStore.markRateLimited(candidate.provider.id, retryAfter ? Number(retryAfter[1]) : undefined);
        }
        // Ledger + trail only. Retries against the same provider collapse into
        // one hop with an attempt counter; nothing is emitted from here.
        routeEventPolicy.recordHop(undefined, candidate.provider.id, statusCode ?? 'err');

        const event: FailoverEvent = {
          attempt,
          failedProvider: candidate.provider.id,
          error: errorMsg
        };
        failoverHistory.push(event);

        if (attempt < maxRetries) {
          // Identify next candidate for notification
          const peekContext: RoutingContext = { ...routeContext, excludedProviders };
          const next = this.route(peekContext, settings);
          if (!next) {
            throw new Error(
              `[OmniRoute Failover Exhausted] Failed after ${attempt} attempt: ${failoverHistory.map((h) => `${h.failedProvider} (${h.error})`).join(' -> ')}`
            );
          }
          event.nextProvider = next.provider.id;
          event.nextModel = next.model.id;
          routeEventPolicy.setLanding(undefined, next.provider.id);
          // No per-hop notification: the hop is already in the per-turn trail and
          // the single consolidated [ROUTE] line is emitted once at `done`.
          // `options.onFailover` is retained in the options type for API
          // compatibility but is intentionally never invoked per hop.
        } else {
          // Out of retry attempts
          throw new Error(
            `[OmniRoute Failover Exhausted] Failed after ${attempt} attempts across providers: ${failoverHistory.map((h) => `${h.failedProvider} (${h.error})`).join(' -> ')}`
          );
        }
      }
    }

    throw new Error(`[OmniRoute] Max routing failover attempts (${maxRetries}) reached.`);
  }
}

export const omniRouteRouter = new OmniRouteRouter();
