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

import { getKey, getCommunityKey, warmUpCommunityKey, getCommunityKeyCached, hasCommunityKey, invalidateCommunityKey, emitCommunityKeyStatus } from '../services/credential-vault';
import { getVerifiedModels, type VerifiedModelConfig } from '../services/verified-models';
import { fetchFCCCatalog, canFccServeCompletions } from '../services/fcc-catalog-sync';
import { opencodeBridge, buildBridgePromptFromMessages } from '../services/opencode-bridge';

import { policyEngine } from '../services/policy/policy-engine';
import { usageLedger as tokenAccountingLedger } from '../services/usage/usage-ledger';
import { countTokens, type LayerToken } from '../services/usage/token-accounting';

const OPENCODE_FREE_PROTOCOL = 'opencode-cli://';

import https from 'node:https';
import http from 'node:http';
import { Agent as UndiciAgent } from 'undici';
import { BrowserWindow } from 'electron';
import { DEFAULT_PRESET_MODELS } from '../../preload/preset-models';
export { DEFAULT_PRESET_MODELS, getVerifiedModels, type VerifiedModelConfig };

const httpsAgentPool = new Map<string, https.Agent>();
const httpAgentPool = new Map<string, http.Agent>();
const undiciDispatcherPool = new Map<string, UndiciAgent>();

/**
 * Returns a pooled HTTPS/HTTP agent configured with keepAlive: true per provider host,
 * reusing established TLS handshakes and TCP sockets across requests.
 */
export function getProviderHttpsAgent(urlStr: string): https.Agent | http.Agent {
  try {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const hostKey = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (isHttps ? 443 : 80)}`;
    if (isHttps) {
      let agent = httpsAgentPool.get(hostKey);
      if (!agent) {
        agent = new https.Agent({
          keepAlive: true,
          keepAliveMsecs: 15_000,
          maxSockets: 32,
          maxFreeSockets: 10,
          timeout: 60_000
        });
        httpsAgentPool.set(hostKey, agent);
      }
      return agent;
    } else {
      let agent = httpAgentPool.get(hostKey);
      if (!agent) {
        agent = new http.Agent({
          keepAlive: true,
          keepAliveMsecs: 15_000,
          maxSockets: 32,
          maxFreeSockets: 10,
          timeout: 60_000
        });
        httpAgentPool.set(hostKey, agent);
      }
      return agent;
    }
  } catch {
    return new https.Agent({ keepAlive: true });
  }
}

/**
 * Returns a pooled Undici Agent dispatcher with keepAlive configured per host.
 */
export function getProviderDispatcher(urlStr: string): UndiciAgent | undefined {
  try {
    const parsed = new URL(urlStr);
    const hostKey = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? 443 : 80)}`;
    let dispatcher = undiciDispatcherPool.get(hostKey);
    if (!dispatcher) {
      dispatcher = new UndiciAgent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 300_000
      });
      undiciDispatcherPool.set(hostKey, dispatcher);
    }
    return dispatcher;
  } catch {
    return undefined;
  }
}

/**
 * Dispatches fetch with pooled HTTPS keepAlive agents and undici dispatchers
 * so TLS handshakes are efficiently reused across provider requests.
 */
export function providerFetch(url: string, init?: RequestInit): Promise<Response> {
  const agent = getProviderHttpsAgent(url);
  const dispatcher = getProviderDispatcher(url);
  return fetch(url, {
    ...init,
    agent,
    dispatcher
  } as RequestInit);
}

/**
 * End-to-End Chat Latency Tracker (Diagnostic Telemetry)
 * Measures H1 (Renderer Send) -> H2 (IPC Bridge) -> H3 (Gateway Adapter) ->
 * H4 (Network TTFT) -> H5 (Renderer Flush), calculating TTFT, IPC Overhead, and UI Render Lag.
 */
interface TaskHopTimings {
  taskId: string;
  h1?: number; // Renderer Send
  h2?: number; // IPC Bridge
  h3?: number; // Gateway Adapter
  h4?: number; // Network TTFT
  h5?: number; // Renderer Flush
  tokenCount: number;
  streamStartTime?: number;
  streamEndTime?: number;
  summaryLogged?: boolean;
}

export class ChatLatencyTracker {
  private tasks = new Map<string, TaskHopTimings>();
  private activeTaskId: string | null = null;

  public now(): number {
    return performance.timeOrigin + performance.now();
  }

  public setActiveTaskId(taskId: string): void {
    this.activeTaskId = taskId;
  }

  public getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  private getOrCreate(taskId: string): TaskHopTimings {
    let entry = this.tasks.get(taskId);
    if (!entry) {
      entry = { taskId, tokenCount: 0 };
      this.tasks.set(taskId, entry);
    }
    return entry;
  }

  public recordH1(taskId: string, timestamp?: number): void {
    const entry = this.getOrCreate(taskId);
    if (entry.h1 !== undefined) return;
    const t = timestamp ?? this.now();
    entry.h1 = t;
    console.log(`[PERF] [H1] Renderer Send: Task ${taskId} at ${t.toFixed(2)}ms`);
  }

  public recordH2(taskId: string, timestamp?: number): void {
    const entry = this.getOrCreate(taskId);
    if (entry.h2 !== undefined) return;
    const t = timestamp ?? this.now();
    entry.h2 = t;
    const ipcOverhead = entry.h1 !== undefined ? Math.max(0, t - entry.h1) : 0;
    console.log(`[PERF] [H2] IPC Bridge: Task ${taskId} received at ${t.toFixed(2)}ms | IPC Overhead=${ipcOverhead.toFixed(2)}ms`);
  }

  public recordH3(taskId: string, timestamp?: number): void {
    const entry = this.getOrCreate(taskId);
    if (entry.h3 !== undefined) return;
    const t = timestamp ?? this.now();
    entry.h3 = t;
    console.log(`[PERF] [H3] Gateway Adapter: Dispatching fetch for task ${taskId} at ${t.toFixed(2)}ms`);
  }

  public recordH4(taskId: string, timestamp?: number): void {
    const entry = this.getOrCreate(taskId);
    if (entry.h4 !== undefined) return;
    const t = timestamp ?? this.now();
    entry.h4 = t;
    entry.streamStartTime = t;
    const ttft = entry.h1 !== undefined ? Math.max(0, t - entry.h1) : 0;
    console.log(`[PERF] [H4] Network TTFT: First chunk received for task ${taskId} at ${t.toFixed(2)}ms | TTFT=${ttft.toFixed(2)}ms`);
  }

  public recordH5(taskId: string, timestamp?: number): void {
    const entry = this.getOrCreate(taskId);
    if (entry.h5 !== undefined) return;
    const t = timestamp ?? this.now();
    entry.h5 = t;
    const uiLag = entry.h4 !== undefined ? Math.max(0, t - entry.h4) : 0;
    console.log(`[PERF] [H5] Renderer Flush: First token painted for task ${taskId} at ${t.toFixed(2)}ms | UI Render Lag=${uiLag.toFixed(2)}ms`);
    if (entry.streamEndTime && !entry.summaryLogged) {
      this.outputSummary(taskId);
    }
  }

  public recordToken(taskId: string, _token?: string): void {
    const entry = this.getOrCreate(taskId);
    entry.tokenCount += 1;
  }

  public recordStreamEnd(taskId: string): void {
    const entry = this.getOrCreate(taskId);
    entry.streamEndTime = this.now();
    if (entry.h5 !== undefined) {
      this.outputSummary(taskId);
    } else {
      const timeoutMs = 150;
      setTimeout(() => {
        if (!entry.summaryLogged) {
          this.outputSummary(taskId);
        }
      }, timeoutMs);
    }
  }

  public outputSummary(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.summaryLogged) return;
    entry.summaryLogged = true;

    const h1 = entry.h1 ?? entry.h2 ?? this.now();
    const h2 = entry.h2 ?? h1;
    const h4 = entry.h4 ?? entry.h3 ?? h2;
    const h5 = entry.h5 ?? h4;

    const ttft = Math.max(0, Math.round((h4 - h1) * 10) / 10);
    const ipc = Math.max(0, Math.round((h2 - h1) * 10) / 10);
    const uiLag = Math.max(0, Math.round((h5 - h4) * 10) / 10);

    const count = entry.tokenCount;
    const streamDurationSec = entry.streamStartTime && entry.streamEndTime
      ? Math.max(0.001, (entry.streamEndTime - entry.streamStartTime) / 1000)
      : 1;
    const tps = Math.round((count / streamDurationSec) * 10) / 10;

    console.log(`[PERF] Task ${taskId}: TTFT=${ttft}ms | IPC=${ipc}ms | UI_Lag=${uiLag}ms | Total_Tokens=${count} | Tokens_Per_Sec=${tps}`);
  }

  public getHops(taskId: string): Array<{ hop: 'H1' | 'H2' | 'H3' | 'H4' | 'H5'; latencyMs: number }> {
    const entry = this.tasks.get(taskId);
    if (!entry) return [];
    const hops: Array<{ hop: 'H1' | 'H2' | 'H3' | 'H4' | 'H5'; latencyMs: number }> = [];
    const base = entry.h1 ?? entry.h2 ?? 0;
    if (entry.h1 !== undefined) hops.push({ hop: 'H1', latencyMs: 0 });
    if (entry.h2 !== undefined) hops.push({ hop: 'H2', latencyMs: Math.max(0, Math.round((entry.h2 - base) * 10) / 10) });
    if (entry.h3 !== undefined) hops.push({ hop: 'H3', latencyMs: Math.max(0, Math.round((entry.h3 - (entry.h2 ?? base)) * 10) / 10) });
    if (entry.h4 !== undefined) hops.push({ hop: 'H4', latencyMs: Math.max(0, Math.round((entry.h4 - (entry.h3 ?? entry.h2 ?? base)) * 10) / 10) });
    if (entry.h5 !== undefined) hops.push({ hop: 'H5', latencyMs: Math.max(0, Math.round((entry.h5 - (entry.h4 ?? entry.h3 ?? entry.h2 ?? base)) * 10) / 10) });
    return hops;
  }
}

export const chatLatencyTracker = new ChatLatencyTracker();
tokenAccountingLedger.registerHopProvider(chatLatencyTracker.getHops.bind(chatLatencyTracker));

/**
 * StreamChunkBatcher: Main Process High-Frequency Stream Batcher (16-24ms cadence, immediate first token)
 * Accumulates rapid token / thought chunks from SSE streams and flushes to IPC every 20ms
 * to avoid IPC bridge saturation while guaranteeing zero token loss and zero delay on token #1.
 */
export class StreamChunkBatcher {
  private queue: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (accumulated: string) => void;
  private isFirst = true;

  constructor(onFlush: (accumulated: string) => void, flushIntervalMs = 20) {
    this.onFlush = onFlush;
    this.flushIntervalMs = flushIntervalMs;
  }

  public push(chunk: string): void {
    if (!chunk) return;
    this.queue.push(chunk);
    // Flush the very first token immediately (no coalescing on chunk #1) for minimum TTFT
    if (this.isFirst) {
      this.isFirst = false;
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushIntervalMs);
    }
  }

  public flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const combined = this.queue.join('');
    this.queue = [];
    this.onFlush(combined);
  }

  public dispose(): void {
    this.flush();
  }
}

/**
 * Direct Multi-Provider Gateway with Vault Integration (KeyHarvest-3)
 * Reads credentials dynamically from credential-vault via safeStorage at request time.
 */
function isGoogleProviderId(providerId: string): boolean {
  const p = (providerId || '').toLowerCase();
  return p === 'gemini' || p.startsWith('gemini') || p.includes('google');
}

/** Tool schema accepted by sendChatRequest (OpenAI function shape). */
export interface GatewayToolSchema {
  name: string;
  description: string;
  /** JSON schema of accepted arguments (OpenAI `parameters`). */
  parameters?: unknown;
  /** Anthropic alias for `parameters`. */
  input_schema?: unknown;
}

/** A tool invocation parsed from a provider response. */
export interface GatewayToolCall {
  id: string;
  name: string;
  arguments: string;
}

const FCC_SIDECAR_URL = 'http://localhost:8082/v1/chat/completions';
const KILO_URL = 'https://api.kilo.ai/api/gateway/chat/completions';

const TY_CODE_FREE_PROVIDER = 'ty-code-free';
const TY_CODE_FREE_MODEL = 'google/gemma-4-31b-it:free';

export class KeyMissingError extends Error {
  public readonly code = 'KEY_MISSING_ERROR';
  public readonly providerId: string;

  constructor(providerId: string, message?: string) {
    super(
      message ||
        `KEY_MISSING_ERROR: No API key found for provider "${providerId}". Please add your API key in Settings -> Providers.`
    );
    this.name = 'KeyMissingError';
    this.providerId = providerId;
  }
}

/**
 * Global active model selection (Prompt 2: Fix Routing Across All Features).
 * Controls whether routing is locked to a specific provider/model or dynamically
 * evaluated via the adaptive router.
 */
let currentActiveModel: { providerId: string; modelId: string; isAutoMode: boolean } = {
  providerId: TY_CODE_FREE_PROVIDER,
  modelId: TY_CODE_FREE_MODEL,
  isAutoMode: true
};

let gatewayActiveOverride: { providerId: string; modelId: string } | null = null;

const endpointOverrides: Partial<Record<string, string>> = {};

export function setEndpointOverride(providerId: string, url?: string): void {
  const key = (providerId || '').toLowerCase().trim();
  if (!key) return;
  if (url && url.trim()) {
    endpointOverrides[key] = url.trim();
  } else {
    delete endpointOverrides[key];
  }
}

export function setActiveModel(config: { providerId: string; modelId: string; isAutoMode: boolean }): void {
  const p = (config?.providerId || TY_CODE_FREE_PROVIDER).trim();
  const m = (config?.modelId || TY_CODE_FREE_MODEL).trim();
  const isAuto = Boolean(config?.isAutoMode || p === 'auto');

  currentActiveModel = {
    providerId: isAuto ? 'auto' : p,
    modelId: isAuto ? '' : m,
    isAutoMode: isAuto
  };

  gatewayActiveOverride = {
    providerId: currentActiveModel.providerId,
    modelId: currentActiveModel.modelId
  };

  try {
    import('../services/orchestration/user-preferences').then(({ userPreferences }) => {
      if (isAuto) {
        void userPreferences.updatePreferences({
          mode: 'auto',
          manualProviderId: undefined,
          manualModelId: undefined
        });
        console.log('[GATEWAY] Active model set to Auto (adaptive routing enabled)');
      } else {
        void userPreferences.updatePreferences({
          mode: 'manual',
          manualProviderId: p,
          manualModelId: m
        });
        console.log(`[GATEWAY] Active model locked to: provider=${p}, model=${m}`);
      }
    }).catch(() => {});
  } catch {}
}

export function getActiveModel(): { providerId: string; modelId: string; isAutoMode: boolean } {
  return { ...currentActiveModel };
}

export function setGatewayActiveConfig(providerId: string, modelId: string): { providerId: string; modelId: string } {
  setActiveModel({
    providerId,
    modelId,
    isAutoMode: providerId === 'auto' || !providerId
  });
  return { providerId: currentActiveModel.providerId, modelId: currentActiveModel.modelId };
}

export function getGatewayActiveOverride(): { providerId: string; modelId: string } | null {
  return { providerId: currentActiveModel.providerId, modelId: currentActiveModel.modelId };
}

// ZeroFriction-2 One-Key Premium: premium direct providers transparently
// re-route through OpenRouter's unified API when the provider's own native
// key is absent but the user's OpenRouter key (the One Key) is stored.
// Community Key material is deliberately excluded — the shared community
// budget must never fund paid per-token premium traffic.
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PREMIUM_MODEL_OPENROUTER_MAP: Record<string, { model: string; name: string }> = {
  openai: { model: 'openai/gpt-4o', name: 'GPT-4o' },
  anthropic: { model: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  claude: { model: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  alibaba: { model: 'qwen/qwen-max', name: 'Qwen Max' },
  qwen: { model: 'qwen/qwen-max', name: 'Qwen Max' },
  deepseek: { model: 'deepseek/deepseek-chat', name: 'DeepSeek V3' }
};

/**
 * Layered OpenRouter key resolution (credentialStore -> settings vault ->
 * legacy vault -> env). Used by the One-Key Premium bridge in sendChatRequest.
 */
async function resolveOpenRouterKey(): Promise<string | undefined> {
  for (const candidate of ['openrouter', 'openrouter-free']) {
    const vaultKey = await getKey(candidate).catch(() => undefined);
    if (vaultKey && vaultKey.trim()) {
      console.log('[GATEWAY] Using in-memory cached key for openrouter');
      return vaultKey.trim();
    }
  }
  for (const candidate of ['openrouter', 'openrouter-free']) {
    try {
      const stored = credentialStore.getDecryptedKey(candidate);
      if (stored && stored.trim()) {
        console.log('[GATEWAY] Using in-memory cached key for openrouter');
        return stored.trim();
      }
    } catch {
      // Vault read failure - continue to next layer
    }
  }
  try {
    const { readStoredCredentials } = await import('../ipc/settings-handlers');
    const { keys } = await readStoredCredentials();
    for (const candidate of ['openrouter', 'openrouter-free']) {
      const value = keys[candidate];
      if (value && value.trim()) {
        console.log('[GATEWAY] Using in-memory cached key for openrouter');
        return value.trim();
      }
    }
  } catch {
    // Non-blocking: fall through to legacy vault
  }
  const envValue = process.env.OPENROUTER_API_KEY;
  if (envValue && envValue.trim().length > 4) return envValue.trim();
  return undefined;
}

/**
 * Executes a chat completion through the local opencode CLI bridge and maps
 * stdout chunks to the caller's onToken listener (final text is returned so
 * direct callers get the same string contract as HTTP providers).
 */
async function runOpenCodeBridge(
  modelId: string,
  messages: any[],
  onToken?: (chunk: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  console.log(`[OPENCODE-BRIDGE] executing via local opencode CLI: model=${modelId}`);
  // Keys the user saved for premium providers (vault, safeStorage) are passed
  // to the CLI via its environment — never on the argv line.
  let bridgeKey: string | undefined;
  try {
    const modelPrefix = (modelId || '').split('/')[0].toLowerCase().trim();
    if (modelPrefix) {
      const stored = await getKey(modelPrefix).catch(() => undefined);
      if (stored && stored.trim()) bridgeKey = stored.trim();
    }
  } catch {
    bridgeKey = undefined;
  }
  const bridgeParts: string[] = [];
  try {
    for await (const chunk of opencodeBridge.executePrompt(
      buildBridgePromptFromMessages(messages),
      modelId,
      bridgeKey,
      { abortSignal }
    )) {
      if (!chunk) continue;
      bridgeParts.push(chunk);
      try {
        onToken?.(chunk);
      } catch {
        // Downstream listener failures must never break the bridge stream.
      }
    }
  } catch (err: unknown) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.warn(`[OPENCODE-BRIDGE] failed for ${modelId}: ${messageText}`);
    throw err instanceof Error ? err : new Error(messageText);
  }
  return bridgeParts.join('');
}

export type NormalizedFinishReason = 'length' | 'stop' | 'tool_calls' | 'content_filter';

/**
 * Extracts and normalizes stream termination / finish_reason across providers
 * (OpenAI, Anthropic, Gemini, Groq, Ollama, etc.)
 */
export function parseFinishReason(raw: unknown): NormalizedFinishReason | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as any;

  // OpenAI / OpenRouter / Groq / DeepSeek / Ollama style
  const choiceFinish = obj.choices?.[0]?.finish_reason ?? obj.finish_reason;
  if (choiceFinish) {
    const cf = String(choiceFinish).toLowerCase().trim();
    if (cf === 'length' || cf === 'max_tokens') return 'length';
    if (cf === 'stop' || cf === 'end_turn') return 'stop';
    if (cf === 'tool_calls' || cf === 'function_call') return 'tool_calls';
    if (cf === 'content_filter' || cf === 'safety') return 'content_filter';
  }

  // Anthropic style
  const anthropicStop = obj.delta?.stop_reason || obj.message?.stop_reason || obj.stop_reason;
  if (anthropicStop) {
    const as = String(anthropicStop).toLowerCase().trim();
    if (as === 'max_tokens' || as === 'length') return 'length';
    if (as === 'end_turn' || as === 'stop_sequence') return 'stop';
    if (as === 'tool_use' || as === 'tool_calls') return 'tool_calls';
  }

  // Gemini style
  const geminiFinish = obj.candidates?.[0]?.finishReason;
  if (geminiFinish) {
    const gf = String(geminiFinish).toUpperCase().trim();
    if (gf === 'MAX_TOKENS' || gf === 'LENGTH') return 'length';
    if (gf === 'STOP') return 'stop';
    if (gf === 'SAFETY' || gf === 'RECITATION') return 'content_filter';
  }

  return null;
}

export async function sendChatRequest(
  providerId: string,
  modelId: string,
  messages: any[],
  stream: boolean = true,
  apiKey?: string,
  onToken?: (chunk: string) => void,
  handoffCount: number = 0,
  abortSignal?: AbortSignal,
  onHandoff?: (info: { fromProvider: string; toProvider: string; toModel: string }) => void,
  onReasoning?: (thought: string) => void,
  tools?: GatewayToolSchema[],
  onToolCalls?: (calls: GatewayToolCall[]) => void,
  taskId?: string,
  context?: 'chat' | 'debugger' | 'canvas' | string,
  continuationCount: number = 0,
  onStatus?: (status: { type: string; content?: string; truncated?: boolean; actions?: string[] }) => void
): Promise<string> {
  const currentTaskId = taskId || chatLatencyTracker.getActiveTaskId() || `task_${Date.now()}`;
  chatLatencyTracker.setActiveTaskId(currentTaskId);

  // Read currentActiveModel to determine routing (Prompt 2: Fix Routing)
  const activeConfig = getActiveModel();
  let effectiveProvider = providerId;
  let effectiveModel = modelId;

  // If isAutoMode === true (or caller passed blank / 'auto'):
  if (activeConfig.isAutoMode || !effectiveProvider || effectiveProvider === 'auto') {
    try {
      const { modelRouter } = await import('../services/orchestration/model-router');
      const userMessage = [...messages].reverse().find((m) => m?.role === 'user');
      const promptText = typeof userMessage?.content === 'string'
        ? userMessage.content
        : Array.isArray(userMessage?.content)
        ? (userMessage.content.map((c: any) => c.text || '').join(' ') || '')
        : '';
      const decision = await modelRouter.selectModel(promptText || 'help with code');
      if (decision?.selectedModel) {
        effectiveProvider = decision.selectedModel.providerId;
        effectiveModel = decision.selectedModel.modelId;
        console.log(`[GATEWAY][ADAPTIVE] Auto mode selected: ${effectiveProvider}/${effectiveModel} (task: ${decision.taskClassification.taskType})`);
      }
    } catch (routerErr) {
      console.warn('[GATEWAY][ADAPTIVE] Auto routing selection error:', routerErr);
      effectiveProvider = TY_CODE_FREE_PROVIDER;
      effectiveModel = TY_CODE_FREE_MODEL;
    }
  } else {
    // isAutoMode === false: lock routing to the specified providerId and modelId
    if (handoffCount === 0 && activeConfig.providerId && activeConfig.modelId) {
      effectiveProvider = activeConfig.providerId;
      effectiveModel = activeConfig.modelId;
    } else {
      if (!effectiveProvider || effectiveProvider === 'auto' || effectiveProvider === 'current') {
        effectiveProvider = activeConfig.providerId;
      }
      if (!effectiveModel || effectiveModel === 'Auto' || effectiveModel === '') {
        effectiveModel = activeConfig.modelId;
      }
    }
  }

  if (!effectiveProvider || !String(effectiveProvider).trim()) effectiveProvider = TY_CODE_FREE_PROVIDER;
  if (!effectiveModel || !String(effectiveModel).trim()) effectiveModel = TY_CODE_FREE_MODEL;

  providerId = effectiveProvider;
  modelId = effectiveModel;
  const provider = providerId;
  const norm = (providerId || '').toLowerCase().trim().replace(/-free$/, '');
  const isKilo = norm === 'kilo' || norm === 'openkilo';
  const isCopilot = norm === 'copilot' || norm === 'github-copilot' || norm === 'copilot-subscription';
  // Ty-Code Free (ZeroFriction-1): the zero-friction community tier. Requests
  // route to OpenRouter and authenticate with the rotating Community Key or
  // the user's own OpenRouter key; no user input is ever required.
  const isTyCodeFree = norm === 'ty-code-free' || (providerId || '').toLowerCase().trim() === 'ty-code-free';
  // Selecting a Ty-Code Free model must trigger the Community Key bootstrap
  // before routing decisions; cache-first warm-up keeps the stream path hot.
  if (isTyCodeFree) {
    try {
      warmUpCommunityKey();
    } catch {
      // Warm-up failure is fine: the stream path re-resolves lazily.
    }
  }

  // ZeroFriction diagnosis (Prompt 3): entry logs; keys are never printed.
  console.log(`[GATEWAY] Request received [${context || 'chat'}] - provider: ${providerId}, model: ${modelId}`);
  console.log('[GATEWAY] Checking if provider requires key...');

  // OpenCode Free Tier (auto-discovery): entries surfaced from the user's
  // local opencode config are served by the real installed `opencode` CLI via
  // the subprocess bridge. No HTTP request is ever issued for this tier, so
  // resolve the bridge result right away — the config lookup below is skipped.
  if ((providerId || '').toLowerCase().trim() === 'opencode-free') {
    return await runOpenCodeBridge(modelId, messages, onToken, abortSignal);
  }
  // FCC Free Tier: the 'fcc' provider id hydrates the FCC supply layer through
  // the dynamic catalog; the 'anthropic-claude-free' binding normalizes to
  // 'anthropic-claude' (single -free suffix strip), and the provider registry
  // also exposes the raw 'fcc-proxy' id. All three route through the FCC layer.
  const isFcc = norm === 'fcc' || (providerId || '').toLowerCase().trim() === 'fcc';
  const isFccProxy =
    isFcc ||
    norm === 'anthropic-claude' ||
    norm === 'fcc-proxy' ||
    norm === 'fccproxy' ||
    providerId === 'fcc-proxy';

  // Enterprise Policy Pre-Dispatch Enforcement
  const providerPolicyCheck = policyEngine.assertAllowed({
    type: 'provider_dispatch',
    target: providerId
  });
  if (!providerPolicyCheck.allowed) {
    throw new Error(`[POLICY BLOCKED] ${providerPolicyCheck.reason || 'Provider dispatch denied by enterprise policy'}`);
  }

  const isFreeTierRequest = isTyCodeFree || isFcc || isFccProxy || norm === 'openkilo' || norm === 'kilo' || (providerId || '').toLowerCase().includes('free');
  if (isFreeTierRequest) {
    const freeRoutingCheck = policyEngine.assertAllowed({
      type: 'free_routing',
      target: providerId
    });
    if (!freeRoutingCheck.allowed) {
      throw new Error(`[POLICY BLOCKED] ${freeRoutingCheck.reason || 'Free-tier routing denied by enterprise policy'}`);
    }
  }

  // One-Key Premium (ZeroFriction-2): when a premium direct request is bridged
  // to OpenRouter, the wire payload must use OpenRouter's namespaced model id
  // (e.g. "openai/gpt-4o") rather than the provider-native id. Typed as
  // undefined until a bridge actually rewrites the request.
  let bridgeRequestModel: string | undefined;

  // 1. Fetch verified models catalog and find requested model configuration
  const allModels = await getVerifiedModels();
  let config = allModels.find(
    (m) =>
      (m.modelId === modelId || m.modelId.toLowerCase() === modelId.toLowerCase()) &&
      (m.providerId.toLowerCase() === norm || m.providerId.toLowerCase() === providerId.toLowerCase())
  );

  if (!config) {
    if (!isFccProxy) {
      config = allModels.find(
        (m) => m.modelId === modelId || m.modelId.toLowerCase() === modelId.toLowerCase()
      );
    }
  }

  // Gracefully fallback to standard endpoints if model is not directly listed
    if (!config) {
      if (isFccProxy) {
        const overrideKey = (providerId || '').toLowerCase().trim();
        const overrideUrl = endpointOverrides[overrideKey] || endpointOverrides[norm] || endpointOverrides['fcc-proxy'];
        if (overrideUrl) {
          console.log(`[FCC][AUTO] Tier 0 — endpoint override for ${providerId} -> ${overrideUrl}`);
          const base = overrideUrl.replace(/\/+$/, '');
          config = {
            modelId,
            name: `${providerId} (endpoint override)`,
            url: /chat\/completions$/.test(base) ? base : `${base}/chat/completions`,
            requiresKey: false,
            providerId: 'fcc-proxy'
          };
        } else {
        // FCC Auto routing. Tier 0: a live entry from the dynamic FCC catalog
        // (sidecar, supply facade, or connected subscription) while a genuine
        // free-claude-code binary can serve completions. Tier 1: the FCC
        // sidecar itself (genuine binary up). Then graceful degradation:
        // tier 2 = any provider that owns its key (never borrowed), tier 3 =
        // the anonymous OpenKilo pool.
        const canServe = (() => {
          try {
            return canFccServeCompletions();
          } catch {
            return false;
          }
        })();
          console.log(`[FCC][AUTO] provider=${providerId} model=${modelId} genuineBinary=${canServe ? 'up' : 'down'}`);
        if (canServe) {
          let fccEntry: VerifiedModelConfig | undefined;
          try {
            const fccCatalog = await fetchFCCCatalog();
            fccEntry = fccCatalog.find((m) => (m.modelId || '').toLowerCase() === (modelId || '').toLowerCase());
          } catch {
            fccEntry = undefined;
          }
          if (fccEntry) {
            console.log(`[FCC][AUTO] Tier 0 — dynamic FCC catalog entry ${fccEntry.providerId} (${fccEntry.modelId})`);
            config = fccEntry;
          } else {
            console.log(`[FCC][AUTO] Tier 1 — routing through FCC sidecar at ${FCC_SIDECAR_URL}`);
            config = { modelId, name: 'FCC Free Tier', url: FCC_SIDECAR_URL, requiresKey: false, providerId: 'anthropic-claude-free' };
          }
        } else {
          const nativeFallback = pickHandoffCandidate(allModels, 'fcc-proxy', modelId);
          if (nativeFallback) {
            console.log(`[FCC][AUTO] Tier 2 — sidecar down, using keyed provider ${nativeFallback.providerId} (${nativeFallback.modelId})`);
            config = nativeFallback;
          } else {
            console.log('[FCC][AUTO] Tier 3 — sidecar down, no keyed provider found; using anonymous OpenKilo pool');
            config = { modelId, name: modelId, url: KILO_URL, requiresKey: false, providerId: 'openkilo' };
          }
        }
        }
      } else if (norm === 'openrouter') {
        config = { modelId, name: modelId, url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, providerId: 'openrouter' };
      } else if (norm === 'ty-code-free') {
        config = { modelId, name: modelId, url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, providerId: 'ty-code-free' };
      } else if (norm === 'groq') {
        config = { modelId, name: modelId, url: 'https://api.groq.com/openai/v1/chat/completions', requiresKey: true, providerId: 'groq' };
      } else if (norm === 'anthropic' || norm === 'claude') {
        config = { modelId, name: modelId, url: 'https://api.anthropic.com/v1/messages', requiresKey: true, providerId: 'anthropic' };
      } else if (isGoogleProviderId(providerId)) {
        config = { modelId, name: modelId, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', requiresKey: true, providerId: 'google-ai-studio' };
      } else if (isKilo) {
      config = { modelId, name: modelId, url: 'https://api.kilo.ai/api/gateway/chat/completions', requiresKey: false, providerId: 'openkilo' };
    } else if (isCopilot) {
      config = { modelId, name: modelId, url: 'https://api.githubcopilot.com/chat/completions', requiresKey: true, providerId: 'copilot' };
    } else if (norm === 'openai') {
      config = { modelId, name: modelId, url: 'https://api.openai.com/v1/chat/completions', requiresKey: true, providerId: 'openai' };
    } else if (norm === 'deepseek') {
      config = { modelId, name: modelId, url: 'https://api.deepseek.com/chat/completions', requiresKey: true, providerId: 'deepseek' };
    } else if (norm === 'qwen' || norm === 'alibaba') {
      config = { modelId, name: modelId, url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', requiresKey: true, providerId: 'alibaba' };
  } else {
    throw new Error('Unverified model or provider requested');
  }
  }

  // CLI-bridge safety net: whatever path resolved the config, an entry with
  // the bridge pseudo-endpoint must never reach an HTTP fetch. Reroute it
  // through the opencode CLI bridge instead.
  if (config.url.startsWith(OPENCODE_FREE_PROTOCOL)) {
    return await runOpenCodeBridge(modelId, messages, onToken, abortSignal);
  }

  // FCC hybrid guard: 'fcc' entries from the unified feed point at the sidecar,
  // whose embedded stub cannot serve completions without a genuine
  // free-claude-code binary. When the sidecar URL is not user-overridden and
  // the binary is down, re-route through the FCC auto tiers instead of failing.
  const sidecarUrlPattern = /\b(127\.0\.0\.1|localhost):8082\b/;
  if (
    (config.providerId === 'fcc' || config.providerId === 'fcc-proxy') &&
    sidecarUrlPattern.test(config.url) &&
    !canFccServeCompletions()
  ) {
    console.log(`[FCC][HYBRID] FCC route unavailable for "${modelId}"; applying FCC auto-tier fallback`);
    const nativeFallback = pickHandoffCandidate(allModels, 'fcc-proxy', modelId);
    config = nativeFallback || { modelId, name: modelId, url: KILO_URL, requiresKey: false, providerId: 'openkilo' };
  }

  // Enterprise policy check on resolved config provider
  if (config && config.providerId && config.providerId.toLowerCase() !== (providerId || '').toLowerCase()) {
    const resolvedCheck = policyEngine.assertAllowed({
      type: 'provider_dispatch',
      target: config.providerId
    });
    if (!resolvedCheck.allowed) {
      throw new Error(`[POLICY BLOCKED] ${resolvedCheck.reason || 'Resolved provider denied by enterprise policy'}`);
    }
  }

  // 2. Read key from secure vault at request time
  // Layered resolution (same pipeline as streamChat): explicit param ->
  // RealConnect credentialStore -> settings vault file -> legacy vault -> env
  let key = apiKey;
  if (config.requiresKey && !key && config.providerId !== 'openkilo' && norm !== 'openkilo') {
    const keyCandidates = Array.from(new Set([
      ...getProviderAliases(providerId),
      ...getProviderAliases(config.providerId),
      norm,
      norm.replace(/-free$/, ''),
      config.providerId.replace(/-free$/, ''),
      ...(isCopilot ? ['copilot', 'github-copilot', 'copilot-subscription'] : [])
    ]));

    // 1. In-memory decryption cache via getKey (0ms latency, zero event loop blocking)
    for (const candidate of keyCandidates) {
      const vaultKey = await getKey(candidate).catch(() => undefined);
      if (vaultKey && vaultKey.trim()) {
        key = vaultKey.trim();
        console.log(`[GATEWAY] Using in-memory cached key for ${providerId || candidate}`);
        break;
      }
    }

    if (!key) {
      for (const candidate of keyCandidates) {
        const stored = credentialStore.getDecryptedKey(candidate);
        if (stored && stored.trim()) {
          key = stored.trim();
          console.log(`[GATEWAY] Using in-memory cached key for ${providerId || candidate}`);
          break;
        }
      }
    }

    if (!key) {
      try {
        const { keys } = await readStoredCredentials();
        for (const candidate of keyCandidates) {
          const value = keys[candidate];
          if (value && value.trim()) {
            key = value.trim();
            console.log(`[GATEWAY] Using in-memory cached key for ${providerId || candidate}`);
            break;
          }
        }
      } catch {
        // Non-blocking: fall through to legacy vault / env
      }
    }

    if (!key) {
      const envKeyMap: Record<string, string[]> = {
        openrouter: ['OPENROUTER_API_KEY'],
        groq: ['GROQ_API_KEY'],
        anthropic: ['ANTHROPIC_API_KEY'],
        claude: ['ANTHROPIC_API_KEY'],
        openai: ['OPENAI_API_KEY'],
        'google-ai-studio': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        deepseek: ['DEEPSEEK_API_KEY'],
        copilot: ['GITHUB_COPILOT_TOKEN', 'COPILOT_TOKEN'],
        chatgpt: ['CHATGPT_TOKEN', 'CHATGPT_API_KEY'],
        opencode: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY']
      };
      for (const candidate of keyCandidates) {
        for (const envVar of envKeyMap[candidate] || envKeyMap[candidate.replace(/-free$/, '')] || []) {
          const envValue = process.env[envVar];
          if (envValue && envValue.trim().length > 4) {
            key = envValue.trim();
            void credentialStore.saveCredential(candidate, key, `Auto-detected from $${envVar}`).catch(() => undefined);
            break;
          }
        }
        if (key) break;
      }
    }

    if (!key) {
      if (isTyCodeFree) {
        // Zero-friction guarantee: last-chance bootstrap of the Community Key
        // (cache-first, 5s remote timeout). Only when the endpoint is down or
        // offline-first-launch returns null do we degrade to the pure-
        // anonymous free pool instead of demanding user input.
        console.log('[GATEWAY] No user key found - attempting Community Key fallback');
        console.log('[GATEWAY] Calling getCommunityKey()...');
        try {
          const community = await getCommunityKey();
          console.log(`[GATEWAY] Community Key returned: ${community ? 'YES (length: ' + community.length + ')' : 'NO - null'}`);
          if (community) {
            key = community;
            console.log('[GATEWAY] ty-code-free: Community Key resolved via bootstrap.');
          }
        } catch (err) {
          console.warn('[GATEWAY] Community Key bootstrap error:', err instanceof Error ? err.message : err);
        }
        if (!key) {
          console.log('[GATEWAY] Community Key FAILED - falling back to anonymous tier');
          console.warn('[GATEWAY] ty-code-free: Community Key unavailable; degrading to anonymous OpenKilo pool.');
          emitCommunityKeyStatus('degraded');
          config = { modelId, name: modelId, url: KILO_URL, requiresKey: false, providerId: 'openkilo' };
        }
      } else {
        // One-Key Premium bridge (ZeroFriction-2): premium direct provider has
        // no key of its own, but the user's single OpenRouter key unlocks the
        // whole premium lineup. Re-route to OpenRouter's unified API with the
        // namespaced model id instead of demanding another key.
        const premiumRoute = PREMIUM_MODEL_OPENROUTER_MAP[norm];
        if (premiumRoute) {
          const openRouterKey = await resolveOpenRouterKey();
          if (openRouterKey) {
            console.log(`[GATEWAY][ONE-KEY] ${norm}/${modelId} has no native key; bridging to OpenRouter as ${premiumRoute.model}`);
            config = {
              modelId: premiumRoute.model,
              name: premiumRoute.name,
              url: OPENROUTER_CHAT_URL,
              requiresKey: true,
              providerId: 'openrouter'
            };
            bridgeRequestModel = premiumRoute.model;
            key = openRouterKey;
          }
        }
        if (!key) {
          try {
            console.log('[GATEWAY] No user key found - attempting Community Key fallback');
            console.log('[GATEWAY] Calling getCommunityKey()...');
            const communityKey = await getCommunityKey();
            console.log(`[GATEWAY] Community Key returned: ${communityKey ? 'YES (length: ' + communityKey.length + ')' : 'NO - null'}`);
            if (communityKey) {
              console.log(`[GATEWAY] ${providerId} has no key configured; routing via Ty-Code Free community bridge`);
              config = {
                modelId: modelId || TY_CODE_FREE_MODEL,
                name: modelId,
                url: 'https://openrouter.ai/api/v1/chat/completions',
                requiresKey: true,
                providerId: 'ty-code-free'
              };
              key = communityKey;
            }
          } catch {
            // Community key resolution failed
          }

          if (!key) {
            throw new KeyMissingError(
              providerId,
              `KEY_MISSING_ERROR: No API key found for provider "${providerId}". Please add your API key in Settings -> Providers to unlock ${modelId}.`
            );
          }
        }
      }
    }
  }

  // Determine keySource for explicit logging requirement
  let keySource: 'user_key' | 'community_key' | 'free_tier' | 'one_key_openrouter' = 'free_tier';
  if (!config.requiresKey) {
    keySource = 'free_tier';
  } else if (isTyCodeFree || (key && key === getCommunityKeyCached())) {
    keySource = 'community_key';
  } else if (bridgeRequestModel) {
    keySource = 'one_key_openrouter';
  } else if (key) {
    keySource = 'user_key';
  }

  console.log(`[GATEWAY] Routing request: provider=${providerId}, model=${modelId}, keySource=${keySource}`);

  // Whether the resolved key came from the Community Key card (rotating).
  const usedCommunityKey = isTyCodeFree && Boolean(key && key === getCommunityKeyCached());

  // 3. Construct headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const normP = (config.providerId || providerId).toLowerCase().trim();
  if (key) {
    if (normP === 'anthropic' || normP === 'claude') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      if (key === getCommunityKeyCached()) {
        console.log('[GATEWAY] Setting Authorization header with Community Key');
      }
      headers['Authorization'] = `Bearer ${key}`;
    }
  }

  if (isCopilot || normP === 'copilot') {
    headers['Editor-Version'] = 'vscode/1.85.0';
    headers['Editor-Plugin-Version'] = 'copilot-chat/0.11.1';
    headers['Copilot-Integration-Id'] = 'vscode-chat';
  } else if (normP === 'openrouter' || normP === 'ty-code-free') {
    headers['HTTP-Referer'] = 'https://github.com/Alishahryar1/free-claude-code';
    headers['X-Title'] = 'Ty-Code';
  }

  const url = config.url;
  const providerDisplay = config.name || providerId;

  console.log(`[GATEWAY] Fetching from ${config.url}`);
  console.log(`[GATEWAY] Request URL: ${config.url}`);
  console.log(`[GATEWAY] Provider: ${providerId}, Model: ${modelId}`);

  // Per-Layer Token Accounting: Phase 'request' (Hook 2)
  const requestLayers: LayerToken[] = [];
  let totalInputTokens = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const contentStr = typeof m === 'string' ? m : (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
    const role = (typeof m === 'string' ? 'user' : m?.role) || 'user';
    const isLast = i === messages.length - 1;
    if (role === 'system') {
      const counted = countTokens(contentStr, 'markdown');
      requestLayers.push({
        name: 'system',
        kind: 'system',
        tokens: counted.tokens,
        method: counted.method,
        cached: true
      });
      totalInputTokens += counted.tokens;
    } else if (isLast && role === 'user') {
      const counted = countTokens(contentStr, 'prose');
      requestLayers.push({
        name: 'user',
        kind: 'user',
        tokens: counted.tokens,
        method: counted.method,
        cached: false
      });
      totalInputTokens += counted.tokens;
    } else if (role === 'tool') {
      const counted = countTokens(contentStr, 'json');
      requestLayers.push({
        name: `tool_result:${m.name || 'tool'}`,
        kind: 'tool',
        tokens: counted.tokens,
        method: counted.method,
        cached: false
      });
      totalInputTokens += counted.tokens;
    } else {
      const counted = countTokens(contentStr, 'prose');
      requestLayers.push({
        name: `history:${role}`,
        kind: 'history',
        tokens: counted.tokens,
        method: counted.method,
        cached: false
      });
      totalInputTokens += counted.tokens;
    }
  }

  const billingType: 'free-tier' | 'local' | 'metered' = isFreeTierRequest
    ? 'free-tier'
    : (norm === 'local' || norm === 'ollama' || norm === 'vllm')
    ? 'local'
    : 'metered';

  tokenAccountingLedger.record({
    sessionId: currentTaskId,
    taskId: currentTaskId,
    provider: config?.providerId || providerId,
    model: config?.modelId || modelId,
    billing: billingType,
    phase: 'request',
    layers: requestLayers,
    totals: {
      input: totalInputTokens,
      output: 0,
      cachedInput: 0
    },
    hops: chatLatencyTracker.getHops(currentTaskId)
  });

  let usageInputTokens: number | undefined;
  let usageOutputTokens: number | undefined;
  let usageCachedTokens: number | undefined;

  const extractProviderUsage = (json: any) => {
    if (!json || typeof json !== 'object') return;
    if (json.usage) {
      if (typeof json.usage.prompt_tokens === 'number') usageInputTokens = json.usage.prompt_tokens;
      if (typeof json.usage.completion_tokens === 'number') usageOutputTokens = json.usage.completion_tokens;
      if (typeof json.usage.output_tokens === 'number') usageOutputTokens = json.usage.output_tokens;
      if (typeof json.usage.input_tokens === 'number') usageInputTokens = json.usage.input_tokens;
      if (typeof json.usage.prompt_tokens_details?.cached_tokens === 'number') {
        usageCachedTokens = json.usage.prompt_tokens_details.cached_tokens;
      }
      if (typeof json.usage.cache_read_input_tokens === 'number') {
        usageCachedTokens = json.usage.cache_read_input_tokens;
      }
    }
    if (json.message?.usage) {
      if (typeof json.message.usage.input_tokens === 'number') usageInputTokens = json.message.usage.input_tokens;
      if (typeof json.message.usage.output_tokens === 'number') usageOutputTokens = json.message.usage.output_tokens;
      if (typeof json.message.usage.cache_read_input_tokens === 'number') {
        usageCachedTokens = json.message.usage.cache_read_input_tokens;
      }
    }
  };

  const recordResponseUsage = (responseText: string) => {
    const finalOutput = usageOutputTokens !== undefined ? usageOutputTokens : countTokens(responseText, 'prose').tokens;
    const finalInput = usageInputTokens !== undefined ? usageInputTokens : totalInputTokens;
    const finalCached = usageCachedTokens ?? 0;

    tokenAccountingLedger.record({
      sessionId: currentTaskId,
      taskId: currentTaskId,
      provider: config?.providerId || providerId,
      model: config?.modelId || modelId,
      billing: billingType,
      phase: 'response',
      layers: [
        {
          name: 'response',
          kind: 'response',
          tokens: finalOutput,
          method: usageOutputTokens !== undefined ? 'tiktoken' : 'calibrated',
          cached: false,
          cacheHit: finalCached > 0
        }
      ],
      totals: {
        input: finalInput,
        output: finalOutput,
        cachedInput: finalCached
      },
      hops: chatLatencyTracker.getHops(currentTaskId)
    });
  };

  // Construct payload
  // Vision support: user messages carrying pasted images (data URLs) are sent
  // as OpenAI-style multimodal content parts; Anthropic payloads get their own
  // base64 source format via toAnthropicContent below.
  const formattedMessages = messages.map((m: any) => {
    if (typeof m === 'string') return { role: 'user', content: m };
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: `[Tool Result for ${m.name || 'tool'}]: ${m.content}`
      };
    }
    if ((m.role === 'user' || !m.role) && Array.isArray(m.images) && m.images.length > 0) {
      return {
        role: m.role || 'user',
        content: [
          { type: 'text', text: m.content || '' },
          ...m.images.map((url: string) => ({ type: 'image_url', image_url: { url } }))
        ]
      };
    }
    // Reasoning models (e.g. Kilo Auto / DeepSeek R1) require the reasoning
    // captured alongside each earlier assistant turn to be echoed back.
    // Preserve OpenAI-style tool_calls on replayed assistant turns: providers
    // like Cohere (via the Kilo gateway) reject a thinking-only turn whose
    // tool_calls were dropped, so keep them; a reasoning-only turn with no
    // tool_calls drops the reasoning to avoid a pending-thought payload.
    if (m.role === 'assistant' && typeof m.reasoning_content === 'string' && m.reasoning_content) {
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      if (!hasToolCalls && !String(m.content || '').trim()) {
        return { role: 'assistant', content: ' ' };
      }
      return {
        role: 'assistant',
        content: m.content || '',
        ...(hasToolCalls ? { tool_calls: m.tool_calls } : {}),
        reasoning_content: m.reasoning_content
      };
    }
    return { role: m.role || 'user', content: m.content || '' };
  });

  const parseDataImageSource = (url: string): { type: 'base64'; media_type: string; data: string } => {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(url);
    if (match) return { type: 'base64', media_type: match[1], data: match[2] };
    return { type: 'base64', media_type: 'image/png', data: '' };
  };
  const toAnthropicContent = (c: any): any => {
    if (!Array.isArray(c)) return c;
    return c.map((part: any) => {
      if (part?.type === 'image_url' && part?.image_url?.url) {
        return { type: 'image', source: parseDataImageSource(part.image_url.url) };
      }
      return { type: 'text', text: part?.text || '' };
    });
  };

  let requestModel = modelId;
  if (isCopilot) {
    if (modelId.startsWith('copilot/')) {
      requestModel = modelId.replace(/^copilot\//, '');
    } else if (modelId.startsWith('copilot-')) {
      requestModel = modelId.replace(/^copilot-/, '');
    }
  }

  let payload: any;
  if (norm === 'anthropic' || norm === 'claude') {
    const systemMsg = formattedMessages.find((m: any) => m.role === 'system');
    const userAndAssistantMsgs = formattedMessages.filter((m: any) => m.role !== 'system');
    const contextMaxTokens = context === 'debugger' ? 8192 : context === 'canvas' ? 4096 : 4096;
    payload = {
      model: modelId,
      messages: userAndAssistantMsgs.map((m: any) => ({ role: m.role, content: toAnthropicContent(m.content) })),
      max_tokens: contextMaxTokens,
      stream
    };
    if (systemMsg && systemMsg.content) {
      payload.system = systemMsg.content;
    }
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema || t.parameters || { type: 'object', properties: {} }
      }));
    }
  } else {
    payload = {
      model: isCopilot ? requestModel : bridgeRequestModel || modelId,
      // Reasoning models (Kilo Auto / DeepSeek R1-style) require every earlier
      // assistant turn to carry the reasoning returned with it. Tool-carrying
      // turns keep their OpenAI tool_calls so Kilo/Cohere does not see a
      // thinking-only turn; reasoning-only turns with no tool_calls drop the
      // reasoning (and submit a space placeholder) to satisfy providers that
      // require a text item after thinking content.
      messages: formattedMessages.map((m: any) => {
        if (m.role === 'assistant' && typeof m.reasoning_content === 'string' && m.reasoning_content) {
          const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
          const textContent = String(m.content || '');
          if (!hasToolCalls && !textContent.trim()) {
            return { role: m.role, content: ' ' };
          }
          if (hasToolCalls) {
            return { role: m.role, content: m.content, tool_calls: m.tool_calls, reasoning_content: m.reasoning_content };
          }
          return { role: m.role, content: m.content, reasoning_content: m.reasoning_content };
        }
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          return { role: m.role, content: m.content, tool_calls: m.tool_calls };
        }
        return { role: m.role, content: m.content };
      }),
      stream,
      ...(context === 'debugger' ? { max_tokens: 8192 } : {})
    };
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters || t.input_schema || { type: 'object', properties: {} }
        }
      }));
      payload.tool_choice = 'auto';
    }
  }

  let fullText = '';
  let fullThought = '';

  // FCC stream normalization inputs: lines the OpenAI SSE parser could not
  // categorize are kept aside so non-SSE FCC flavors (NDJSON, bare JSON,
  // plain text) can be salvaged into a token stream after the read loop.
  const strayNonSseLines: string[] = [];

  // Structured tool_calls accumulator (OpenAI delta.tool_calls fragments and
  // Anthropic tool_use content blocks both land here).
  const streamedToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  const flushToolCalls = () => {
    if (!onToolCalls || streamedToolCalls.size === 0) return;
    const calls = [...streamedToolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call], i) => ({
        id: call.id || `call_gw_${Date.now().toString(36)}_${i}`,
        name: call.name,
        arguments: call.arguments || '{}'
      }))
      .filter((call) => call.name);
    if (calls.length > 0) {
      console.log(`[GATEWAY] ${calls.length} tool call(s) captured from provider response: ${calls.map((c) => c.name).join(', ')}`);
      try {
        onToolCalls(calls);
      } catch (callbackErr) {
        console.warn('[GATEWAY] onToolCalls callback failed:', callbackErr instanceof Error ? callbackErr.message : callbackErr);
      }
    }
  };

  try {
    // 4. Make the fetch request with the key in the headers
    const requestStartMs = Date.now();
    
    // Create a 120s timeout signal for large file operations and long streaming responses
    const timeoutSignal = AbortSignal.timeout(120_000);
    // Combine with any existing abortSignal
    const combinedSignal = abortSignal 
      ? AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal;
    
    // Record H3 (Gateway Adapter): right before fetch() is called to the LLM provider
    chatLatencyTracker.recordH3(currentTaskId);

    const response = await providerFetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: combinedSignal
    });

    console.log(`[GATEWAY] Response status: ${response.status}`);

    // Auth rejections (401/403) are treated as provider-level failures: FCC
    // fails over to the next eligible free provider instead of hard-failing,
    // so a revoked/expired key never blocks a free conversation.
    const shouldHandoff = response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403 || (response.status === 404 && /:free|\/free/.test(requestModel || modelId));
    if (shouldHandoff && usedCommunityKey && (response.status === 401 || response.status === 403)) {
      // The rotating Community Key was rejected: drop the cached card so the
      // next attempt re-bootstraps the current rotation, then fail over.
      console.log('[GATEWAY] Auth FAILED (401/403) - Community Key may be invalid or expired');
      console.log('[GATEWAY] Invalidating cached Community Key...');
      console.warn('[GATEWAY] ty-code-free: Community Key rejected; invalidating cache for re-bootstrap.');
      invalidateCommunityKey();
    }
    if (shouldHandoff) {
      if (handoffCount < 2) {
        console.log(`[GATEWAY] Provider failed (${response.status}). Handing off to next provider (Attempt ${handoffCount + 1}/2).`);
        // FCC-managed handoff: only providers that are keyless or own their key.
        const requestedModel = requestModel || modelId;
        const nextModel = pickHandoffCandidate(allModels, config?.providerId || providerId, requestedModel);
        if (nextModel) {
          console.log(`[GATEWAY] Handing off to ${nextModel.providerId} (${nextModel.modelId})`);
          try {
            onHandoff?.({
              fromProvider: config.providerId || providerId,
              toProvider: nextModel.providerId,
              toModel: nextModel.modelId
            });
          } catch {
            // Notification callback must never break the request chain
          }
          // Only carry the original key when the target is the same provider
          // family — never forward one provider's key to another provider.
          const nextApiKey = (nextModel.providerId || '') === (providerId || '') ? apiKey : undefined;
          // Recursively call sendChatRequest with the new provider and incremented handoffCount
          return await sendChatRequest(
            nextModel.providerId,
            nextModel.modelId,
            messages,
            stream,
            nextApiKey,
            onToken,
            handoffCount + 1,
            abortSignal,
            onHandoff,
            onReasoning,
            tools,
            onToolCalls,
            currentTaskId,
            context,
            continuationCount,
            onStatus
          );
        } else {
          throw new Error(`[GATEWAY] All providers failed. Maximum handoffs reached.`);
        }
      } else {
        const errType = response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_DOWN';
        throw new Error(`[${errType}] ${providerDisplay} failed (${response.status}) and maximum handoffs (2) reached.`);
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[GATEWAY] Request failed with status ${response.status}:`, errText);
      let parsedMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        parsedMsg = errJson.error?.message || errJson.message || errText;
      } catch {}
      providerHealthMonitor.recordRequestOutcome(config.providerId || providerId, false, Math.max(1, Date.now() - requestStartMs), `${response.status}: ${parsedMsg}`);
      // Self-heal: reasoning models demand 'reasoning_content' on every earlier
      // assistant turn. Legacy history (or handoff copies) may lack it — convert
      // those turns into summarized user notes and retry once.
      if (response.status === 400 && parsedMsg.includes('reasoning_content') && Array.isArray(messages) && !(messages as any).__reasoningSanitized) {
        (messages as any).__reasoningSanitized = true;
        const sanitized = messages.map((m: any) => {
          if (m && m.role === 'assistant' && !(typeof m.reasoning_content === 'string' && m.reasoning_content)) {
            const summary = typeof m.content === 'string' ? m.content.slice(0, 200) : '';
            return { role: 'user', content: `[assistant turn summary] ${summary}` };
          }
          return m;
        });
        console.log('[GATEWAY] Reasoning content required: sanitizing history and retrying once.');
        return await sendChatRequest(providerId, modelId, sanitized, stream, apiKey, onToken, handoffCount, abortSignal, onHandoff, onReasoning, tools, onToolCalls, currentTaskId, context, continuationCount, onStatus);
      }
      throw new Error(`[GATEWAY] ${providerDisplay} API error (${response.status}): ${parsedMsg}`);
    }

    // 5. Handle the streaming response (response.body.getReader()) and return the text
    if (!response.body) {
      throw new Error(`[GATEWAY] Response body is empty from ${providerId}`);
    }

  if (!stream) {
    const data: any = await response.json();
    // Record H4 (Network TTFT) for non-streaming response
    chatLatencyTracker.recordH4(currentTaskId);
    const text = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
    // Non-stream structured tool calls (OpenAI shape + Anthropic tool_use blocks)
    const messageToolCalls = data.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(messageToolCalls)) {
      messageToolCalls.forEach((tc: any, idx: number) => {
        if (tc?.function?.name) {
          streamedToolCalls.set(idx, {
            id: tc.id || `call_gw_ns_${idx}`,
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {})
          });
        }
      });
    }
    if (Array.isArray(data.content)) {
      data.content.forEach((block: any, idx: number) => {
        if (block?.type === 'tool_use' && block?.name) {
          streamedToolCalls.set(idx, {
            id: block.id || `call_gw_ns_${idx}`,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {})
          });
        }
      });
    }
    const embeddedReasoning = data.choices?.[0]?.message?.reasoning_content;
    if (typeof embeddedReasoning === 'string' && embeddedReasoning) {
      fullThought += embeddedReasoning;
      if (onReasoning) onReasoning(embeddedReasoning);
    }
    if (onToken) onToken(text);
    chatLatencyTracker.recordToken(currentTaskId, text);
    providerHealthMonitor.recordRequestOutcome(config.providerId || providerId, true, Math.max(1, Date.now() - requestStartMs));
    extractProviderUsage(data);
    const finish = parseFinishReason(data);
    flushToolCalls();
    chatLatencyTracker.recordStreamEnd(currentTaskId);
    recordResponseUsage(text);

    if (finish === 'length') {
      if (continuationCount < 2) {
        console.log(`[GATEWAY] Non-streaming response truncated by provider (finish_reason='length'). Auto-continuing (${continuationCount + 1}/2)...`);
        onStatus?.({ type: 'status', content: 'Response hit token limit — continuing…' });
        const continuationMessages = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: 'Continue exactly where you stopped.' }
        ];
        try {
          const continuationText = await sendChatRequest(
            providerId,
            modelId,
            continuationMessages,
            stream,
            apiKey,
            onToken,
            handoffCount,
            abortSignal,
            onHandoff,
            onReasoning,
            tools,
            onToolCalls,
            currentTaskId,
            context,
            continuationCount + 1,
            onStatus
          );
          return text + continuationText;
        } catch (contErr) {
          console.warn('[GATEWAY] Non-streaming auto-continuation failed:', contErr);
        }
      } else {
        console.warn('[GATEWAY] Auto-continuations exhausted (2/2). Marking as truncated.');
        onStatus?.({
          type: 'done',
          truncated: true,
          actions: ['Continue']
        });
      }
    }

    return text;
  }

    const tokenBatcher = new StreamChunkBatcher((chunk) => {
      if (onToken) onToken(chunk);
    }, 20);
    const reasoningBatcher = new StreamChunkBatcher((chunk) => {
      if (onReasoning) onReasoning(chunk);
    }, 20);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let isFirstChunk = true;
    let lastFinishReason: NormalizedFinishReason | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (isFirstChunk) {
          isFirstChunk = false;
          // Record H4 (Network TTFT): when the very first byte/chunk is received from the LLM
          chatLatencyTracker.recordH4(currentTaskId);
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const json = JSON.parse(dataStr);
              extractProviderUsage(json);
              const finish = parseFinishReason(json);
              if (finish) lastFinishReason = finish;
              // Reasoning models stream their chain-of-thought in a dedicated
              // delta field. Capture it for the reasoning_content echo but never
              // mix it into the assistant content stream.
              const reasoningToken: unknown =
                json.choices?.[0]?.delta?.reasoning_content ??
                json.choices?.[0]?.delta?.reasoning;
              if (typeof reasoningToken === 'string' && reasoningToken) {
                fullThought += reasoningToken;
                reasoningBatcher.push(reasoningToken);
              }
              // OpenAI-style streamed tool calls arrive as fragments:
              // { index, id?, function?: { name?, arguments? } }
              const deltaToolCalls: unknown = json.choices?.[0]?.delta?.tool_calls;
              if (Array.isArray(deltaToolCalls)) {
                for (const fragment of deltaToolCalls as any[]) {
                  if (!fragment) continue;
                  const idx = typeof fragment.index === 'number' ? fragment.index : streamedToolCalls.size;
                  const slot = streamedToolCalls.get(idx) || { id: '', name: '', arguments: '' };
                  if (fragment.id) slot.id = fragment.id;
                  if (fragment.function?.name) slot.name = fragment.function.name;
                  if (typeof fragment.function?.arguments === 'string') slot.arguments += fragment.function.arguments;
                  streamedToolCalls.set(idx, slot);
                }
              }
              // Anthropic SSE: content_block_start announces a tool_use block,
              // input_json_delta streams partial JSON, content_block_stop closes it.
              if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
                const idx = typeof json.index === 'number' ? json.index : streamedToolCalls.size;
                streamedToolCalls.set(idx, {
                  id: json.content_block.id || `call_gw_an_${idx}`,
                  name: json.content_block.name,
                  arguments: ''
                });
              } else if (json.type === 'input_json_delta' && typeof json.partial_json === 'string') {
                const idx = typeof json.index === 'number' ? json.index : Math.max(0, streamedToolCalls.size - 1);
                const slot = streamedToolCalls.get(idx);
                if (slot) slot.arguments += json.partial_json;
              }
              let token = json.choices?.[0]?.delta?.content;
              if ((token === undefined || token === null) && json.delta?.text) {
                token = json.delta.text;
              }

              if (token) {
                fullText += token;
                tokenBatcher.push(token);
                chatLatencyTracker.recordToken(currentTaskId, token);
              }
            } catch (parseErr) {
              console.warn('[GATEWAY] SSE chunk parse skipped:', parseErr instanceof Error ? parseErr.message : parseErr);
            }
          } else {
            strayNonSseLines.push(trimmed);
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr !== '[DONE]') {
            try {
              const json = JSON.parse(dataStr);
              extractProviderUsage(json);
              const finish = parseFinishReason(json);
              if (finish) lastFinishReason = finish;
              const trailingReasoning = json.choices?.[0]?.delta?.reasoning_content ?? json.choices?.[0]?.delta?.reasoning;
              if (typeof trailingReasoning === 'string' && trailingReasoning) {
                fullThought += trailingReasoning;
                reasoningBatcher.push(trailingReasoning);
              }
              const token = json.choices?.[0]?.delta?.content ?? json.delta?.text;
              if (token) {
                fullText += token;
                tokenBatcher.push(token);
                chatLatencyTracker.recordToken(currentTaskId, token);
              }
            } catch {}
          }
        }
      }
    } finally {
      tokenBatcher.flush();
      reasoningBatcher.flush();
    }

    // FCC responses are not always OpenAI SSE: genuine free-claude-code
    // flavors may stream NDJSON, answer with a bare JSON object, or emit
    // plain text. If no OpenAI token was ever decoded, salvage the stray
    // payload into the onToken/onReasoning stream so agent-engine keeps a
    // stable token flow (AgentStreamChunk { type: 'token', content }).
    if (fullText === '' && strayNonSseLines.length > 0) {
      const salvageable = strayNonSseLines.filter(
        (l) => !/^(event|id|retry):/i.test(l) && l !== '[DONE]'
      );
      if (salvageable.length > 0) {
        const blobText = salvageable.join('\n');
        let salvagedContent = '';
        let salvagedThought = '';
        let structured = false;
        try {
          const blob = JSON.parse(blobText) as any;
          const finish = parseFinishReason(blob);
          if (finish) lastFinishReason = finish;
          const candidate = blob?.choices?.[0]?.message?.content ?? blob?.choices?.[0]?.delta?.content ?? blob?.content?.[0]?.text;
          if (typeof candidate === 'string') {
            salvagedContent = candidate;
            structured = true;
          }
          const blobThought = blob?.choices?.[0]?.delta?.reasoning_content ?? blob?.choices?.[0]?.delta?.reasoning;
          if (typeof blobThought === 'string' && blobThought) salvagedThought = blobThought;
        } catch {
          // Not a single JSON blob — try per-line NDJSON, then fall back to
          // the raw text stream so plain prose is never swallowed.
          const ndjsonPieces: string[] = [];
          const plainPieces: string[] = [];
          for (const line of salvageable) {
            if (line.startsWith('{')) {
              try {
                const json = JSON.parse(line) as any;
                const piece = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? json?.delta?.text;
                if (typeof piece === 'string' && piece) {
                  ndjsonPieces.push(piece);
                  structured = true;
                }
                const pieceThought = json?.choices?.[0]?.delta?.reasoning_content ?? json?.choices?.[0]?.delta?.reasoning;
                if (typeof pieceThought === 'string' && pieceThought) salvagedThought += pieceThought;
              } catch {
                plainPieces.push(line);
              }
            } else {
              plainPieces.push(line);
            }
          }
          if (ndjsonPieces.length > 0) salvagedContent = [...(salvagedContent ? [salvagedContent] : []), ...ndjsonPieces].join('');
          if (!structured) salvagedContent = [...ndjsonPieces, ...plainPieces].join(plainPieces.length > 0 && ndjsonPieces.length > 0 ? '\n' : '').trim();
        }
        if (salvagedContent.trim()) {
          fullText = salvagedContent;
          if (salvagedThought) {
            fullThought += salvagedThought;
            if (onReasoning) onReasoning(salvagedThought);
          }
          console.log(`[GATEWAY] FCC non-SSE stream normalized (${salvageable.length} line(s), structured=${structured}).`);
          if (onToken) onToken(salvagedContent);
          chatLatencyTracker.recordToken(currentTaskId, salvagedContent);
        }
      }
    }

    providerHealthMonitor.recordRequestOutcome(config.providerId || providerId, true, Math.max(1, Date.now() - requestStartMs));
    flushToolCalls();
    chatLatencyTracker.recordStreamEnd(currentTaskId);
    recordResponseUsage(fullText);

    if (lastFinishReason === 'length') {
      if (continuationCount < 2) {
        console.log(`[GATEWAY] Streaming response truncated by provider (finish_reason='length'). Auto-continuing (${continuationCount + 1}/2)...`);
        onStatus?.({ type: 'status', content: 'Response hit token limit — continuing…' });
        const continuationMessages = [
          ...messages,
          { role: 'assistant', content: fullText },
          { role: 'user', content: 'Continue exactly where you stopped.' }
        ];
        try {
          const continuationText = await sendChatRequest(
            providerId,
            modelId,
            continuationMessages,
            stream,
            apiKey,
            onToken,
            handoffCount,
            abortSignal,
            onHandoff,
            onReasoning,
            tools,
            onToolCalls,
            currentTaskId,
            context,
            continuationCount + 1,
            onStatus
          );
          fullText += continuationText;
        } catch (contErr) {
          console.warn('[GATEWAY] Streaming auto-continuation failed:', contErr);
        }
      } else {
        console.warn('[GATEWAY] Auto-continuations exhausted (2/2). Marking stream as truncated.');
        onStatus?.({
          type: 'done',
          truncated: true,
          actions: ['Continue']
        });
      }
    }

    return fullText;
  } catch (err: any) {
    console.error('[GATEWAY] Exact Node.js fetch error:', err);
    console.error(`[GATEWAY] Error message: ${err?.message || String(err)}`);
    // User-initiated abort must never be re-routed to another provider
    if (abortSignal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    if (
      handoffCount < 2 &&
      (err?.message?.includes('429') ||
        err?.message?.includes('500') ||
        err?.message?.includes('502') ||
        err?.message?.includes('503') ||
        err?.message?.includes('fetch failed') ||
        err?.message?.includes('network'))
    ) {
      console.log(`[GATEWAY] Provider failed mid-stream. Handing off to next provider (Attempt ${handoffCount + 1}/2).`);
      // FCC-managed handoff: eligibility + priority in one selector.
      const requestedModel = requestModel || modelId;
      const nextModel = pickHandoffCandidate(allModels, config?.providerId || providerId, requestedModel);
      if (nextModel) {
        console.log(`[GATEWAY] Handing off to ${nextModel.providerId} (${nextModel.modelId})`);
        try {
          onHandoff?.({
            fromProvider: config.providerId || providerId,
            toProvider: nextModel.providerId,
            toModel: nextModel.modelId
          });
        } catch {
          // Notification callback must never break the request chain
        }
        const nextApiKey = (nextModel.providerId || '') === (providerId || '') ? apiKey : undefined;
        // Recursively call sendChatRequest with the new provider and incremented handoffCount
        return await sendChatRequest(
          nextModel.providerId,
          nextModel.modelId,
          messages,
          stream,
          nextApiKey,
          onToken,
          handoffCount + 1,
          abortSignal,
          onHandoff,
          onReasoning,
          tools,
          onToolCalls,
          currentTaskId,
          context,
          continuationCount,
          onStatus
        );
      } else {
        chatLatencyTracker.recordStreamEnd(currentTaskId);
        throw new Error(`[GATEWAY] All providers failed. Maximum handoffs reached.`);
      }
    }
    chatLatencyTracker.recordStreamEnd(currentTaskId);
    throw err;
  }
}

export function isFreeModel(modelId: string, providerId: string): boolean {
  if (freeProviderRegistry.isFreeModel(modelId, providerId)) return true;
  if (providerId === 'ollama' || providerId === 'fcc-proxy' || providerId === 'anthropic-claude-free') return true;
  if (providerId === 'openkilo' || providerId === 'kilo' || providerId === 'opencode') return true;
  if (/:free($|:|\/)/i.test(modelId) || modelId.toLowerCase().includes(':free')) return true;
  if (providerId === 'groq' || providerId === 'groq-free') {
    const groqFree = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];
    if (groqFree.includes(modelId)) return true;
  }
  return false;
}

const HANDOFF_ENV_HINTS: Record<string, string[]> = {
  openrouter: ['OPENROUTER_API_KEY'],
  groq: ['GROQ_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'google-ai-studio': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  copilot: ['GITHUB_COPILOT_TOKEN', 'COPILOT_TOKEN'],
  opencode: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY']
};

export function getProviderAliases(providerId: string): string[] {
  const p = (providerId || '').toLowerCase().trim();
  const norm = p.replace(/-free$/, '');
  const aliases = new Set<string>([providerId, p, norm, `${norm}-free`]);
  if (p.includes('google') || p === 'gemini') {
    ['gemini', 'google-ai-studio', 'google-ai-studio-free', 'google'].forEach((a) => aliases.add(a));
  }
  if (p === 'anthropic' || p === 'claude' || p.includes('anthropic')) {
    ['anthropic', 'claude', 'anthropic-claude', 'anthropic-claude-free'].forEach((a) => aliases.add(a));
  }
  if (p === 'copilot' || p.includes('copilot')) {
    ['copilot', 'github-copilot', 'copilot-subscription'].forEach((a) => aliases.add(a));
  }
  if (p === 'chatgpt' || p.includes('chatgpt')) {
    ['chatgpt', 'chatgpt-subscription'].forEach((a) => aliases.add(a));
  }
  if (p === 'openkilo' || p === 'kilo') {
    ['openkilo', 'kilo'].forEach((a) => aliases.add(a));
  }
  if (p === 'ty-code-free' || p === 'tycode-free') {
    ['ty-code-free', 'openrouter', 'openrouter-free'].forEach((a) => aliases.add(a));
  }
  if (p === 'openrouter') {
    ['openrouter', 'openrouter-free'].forEach((a) => aliases.add(a));
  }
  if (p === 'groq') {
    ['groq', 'groq-free'].forEach((a) => aliases.add(a));
  }
  if (p === 'opencode') {
    ['opencode', 'opencode-zen'].forEach((a) => aliases.add(a));
  }
  return Array.from(aliases);
}

/** True only when THIS provider has credentials of its own (or is keyless). */
export function providerHasOwnKey(providerId: string): boolean {
  const p = (providerId || '').toLowerCase().trim();
  // The Ty-Code Free community tier counts as available when the rotating
  // Community Key card exists in the encrypted cache (zero user input).
  if (p === 'ty-code-free' || p === 'tycode-free') {
    if (hasCommunityKey()) return true;
  }
  const candidates = getProviderAliases(providerId);
  for (const candidate of candidates) {
    try {
      const stored = credentialStore.getDecryptedKey(candidate);
      if (stored && stored.trim()) return true;
    } catch {
      // Vault read failure — treat as no key
    }
  }
  try {
    const { getAllVaultKeys } = require('../services/credential-vault');
    const vKeys = getAllVaultKeys();
    for (const candidate of candidates) {
      if (vKeys[candidate] && vKeys[candidate].trim()) return true;
    }
  } catch {}
  for (const candidate of candidates) {
    for (const envVar of HANDOFF_ENV_HINTS[candidate] || []) {
      const envValue = process.env[envVar];
      if (envValue && envValue.trim().length > 4) return true;
    }
  }
  return false;
}

/**
 * FCC-managed failover selection: a handoff target is eligible only if it
 * (a) is keyless/anonymous (OpenKilo gateway, Ollama), or
 * (b) is a free-tier model of the provider we already hold a key for, or
 * (c) has its OWN stored key — never a borrowed key from another provider.
 * Priority: same model elsewhere > free pool > keyed-with-own-key.
 */
export function pickHandoffCandidate(
  allModels: VerifiedModelConfig[],
  currentProviderId: string,
  requestedModel: string
): VerifiedModelConfig | undefined {
  const isFreeCandidate = (m: VerifiedModelConfig) =>
    isFreeModel(m.modelId, m.providerId) || !m.requiresKey;

  const eligible = allModels.filter((m) => {
    if ((m.providerId || '').toLowerCase() === (currentProviderId || '').toLowerCase()) return false;
    return !m.requiresKey || providerHasOwnKey(m.providerId);
  });
  if (eligible.length === 0) return undefined;

  const sameModelAlt = eligible.find(
    (m) => m.modelId === requestedModel || m.modelId.toLowerCase() === requestedModel.toLowerCase()
  );
  if (sameModelAlt) return sameModelAlt;

  const freePool = eligible.filter(isFreeCandidate);
  const pool = freePool.length > 0 ? freePool : eligible;
  return pool[0];
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
  images?: string[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface StreamEventCallbacks {
  onToken?: (token: string) => void;
  onRawToken?: (token: string) => void;
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
  public static sendChatRequest = sendChatRequest;
  public static setActiveModel = setActiveModel;
  public static setEndpointOverride = setEndpointOverride;
  public static getActiveModel = getActiveModel;
  public static getVerifiedModels = getVerifiedModels;
  public static router: OmniRouteRouter = omniRouteRouter;
  public static freeRegistry = freeProviderRegistry;
  public static modelClassifier = modelClassifier;
  public static healthMonitor = providerHealthMonitor;

  /**
   * Google AI Studio / Gemini detection. Accepts the FCC id, the free-registry
   * id, and the generic 'gemini' alias.
   */
  private static isGoogleProvider(providerId: string): boolean {
    const p = (providerId || '').toLowerCase();
    return p === 'gemini' || p.startsWith('gemini') || p.includes('google');
  }

  /**
   * Normalize a generativelanguage.googleapis.com base URL to the API root
   * (no /v1beta, no /openai suffix) so the correct route can be built.
   */
  private static googleApiRoot(baseUrl: string): string {
    return baseUrl
      .replace(/\/openai\/?$/, '')
      .replace(/\/v1beta\/?$/, '')
      .replace(/\/+$/, '');
  }

  private static googleChatUrl(baseUrl: string, configuredUrl?: string): string | undefined {
    if (!configuredUrl || configuredUrl.includes('generativelanguage.googleapis.com')) {
      return `${this.googleApiRoot(baseUrl)}/v1beta/openai/chat/completions`;
    }
    return configuredUrl;
  }

  static getEndpoint(provider: ProviderType, customEndpoints: Partial<Record<ProviderType, string>> = {}): string {
    const rawCustom = customEndpoints && customEndpoints[provider];
    if (rawCustom) {
      if (rawCustom.includes('api.openkilo.com')) {
        return 'https://api.kilo.ai/api/gateway';
      }
      return rawCustom;
    }
    const freeProvider = freeProviderRegistry.getProvider(provider);
    if (freeProvider?.base_url && freeProvider.base_url !== 'auto') return freeProvider.base_url;
    const preconfigured = getPreconfiguredProvider(provider);
    if (preconfigured?.baseUrl) return preconfigured.baseUrl;
    const registered = providerRegistry.getProvider(provider);
    if (registered?.defaultEndpoint) return registered.defaultEndpoint;
    switch (provider) {
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      case 'ty-code-free':
      case 'tycode-free': return 'https://openrouter.ai/api/v1';
      case 'openkilo': return 'https://api.kilo.ai/api/gateway';
      case 'opencode': return 'https://api.opencode.ai/v1';
      case 'groq': return 'https://api.groq.com/openai/v1';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'gemini':
      case 'google-ai-studio': return 'https://generativelanguage.googleapis.com';
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
    if (providerId === 'ollama') {      const allVerified = await getVerifiedModels();
      const localModels = allVerified.filter((m) => m.providerId === 'ollama');
      return localModels.map((m) => ({
        id: m.modelId,
        name: m.name,
        provider: 'ollama',
        isFree: true,
        category: 'Free' as const,
        description: 'Local offline Ollama model'
      }));
    }

    const preconfigured = getPreconfiguredProvider(providerId);
    const baseUrl = (customEndpoint || preconfigured?.baseUrl || this.getEndpoint(providerId as ProviderType, {})).replace(/\/+$/, '');

    // Google AI Studio / Gemini: the native list endpoint accepts the key only
    // through the x-goog-api-key header (covers both classic AIza... keys and
    // the new AQ.Ab8... Cloud keys). Bearer auth is rejected here.
    if (this.isGoogleProvider(providerId)) {
      const rootUrl = this.googleApiRoot(baseUrl);
      const listUrl = `${rootUrl}/v1beta/models`;
      const listHeaders: Record<string, string> = { 'Accept': 'application/json' };
      if (apiKey?.trim()) listHeaders['x-goog-api-key'] = apiKey.trim();
      const listRes = await providerFetch(listUrl, {
        method: 'GET',
        headers: listHeaders,
        signal: AbortSignal.timeout(10_000)
      });
      if (!listRes.ok) {
        const errText = await listRes.text().catch(() => '');
        if (listRes.status === 401 || listRes.status === 403 || (listRes.status === 400 && /api key not valid|permission/i.test(errText))) {
          throw new Error('Invalid API Key');
        }
        throw new Error(`Failed to fetch Gemini models (${listRes.status}): ${errText.slice(0, 150)}`);
      }
      const listData = await listRes.json() as { models?: Array<{ name?: string; displayName?: string; description?: string; inputTokenLimit?: number }> };
      const gList = Array.isArray(listData.models) ? listData.models : [];
      const gModels = gList
        .map((m) => {
          const id = String(m.name || '').replace(/^models\//, '');
          return {
            id,
            name: m.displayName || id,
            description: m.description,
            context_length: m.inputTokenLimit
          };
        })
        .filter((m) => m.id && !m.id.includes('embedding') && !m.id.includes('aqa') && !m.id.includes('imagen') && !m.id.includes('veo'));
      return gModels.map((m) => {
        const free = isFreeModel(m.id, providerId) || m.id.startsWith('gemini');
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
      const response = await providerFetch(`${baseUrl}/models`, {
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

  /** True only when this provider has its own stored/env credentials (or is keyless). */
  static providerHasStoredKey(providerId: string): boolean {
    return providerHasOwnKey(providerId);
  }

  static resolveStoredKey(providerId: string): string | null {
    const candidates = getProviderAliases(providerId);
    for (const candidate of candidates) {
      try {
        const stored = credentialStore.getDecryptedKey(candidate);
        if (stored && stored.trim()) return stored.trim();
      } catch {}
    }
    try {
      const { getAllVaultKeys } = require('../services/credential-vault');
      const vKeys = getAllVaultKeys();
      for (const candidate of candidates) {
        if (vKeys[candidate] && vKeys[candidate].trim()) return vKeys[candidate].trim();
      }
    } catch {}
    for (const candidate of candidates) {
      for (const envVar of HANDOFF_ENV_HINTS[candidate] || []) {
        const envValue = process.env[envVar];
        if (envValue && envValue.trim().length > 4) return envValue.trim();
      }
    }
    return null;
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
    let baseUrl = (customEndpoint || preconfigured?.baseUrl || this.getEndpoint(providerId as ProviderType, {})).replace(/\/+$/, '');
    if (baseUrl.includes('api.openkilo.com')) {
      baseUrl = 'https://api.kilo.ai/api/gateway';
    }

    // Zero-config (e.g. Ollama, OpenKilo) or Custom provider without required key: ping server / models endpoint
    if (preconfigured?.setupType === 'zero_config' || providerId === 'ollama' || providerId === 'openkilo' || (providerId === 'custom' && !apiKey?.trim())) {
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

    let effectiveKey = (apiKey || '').trim();
    if (!effectiveKey) {
      effectiveKey = (this.resolveStoredKey(providerId) || '').trim();
    }
    if (!effectiveKey) {
      try {
        const { readStoredCredentials } = await import('../ipc/settings-handlers');
        const { keys } = await readStoredCredentials();
        const candidates = getProviderAliases(providerId);
        for (const cand of candidates) {
          if (keys[cand] && keys[cand].trim()) {
            effectiveKey = keys[cand].trim();
            break;
          }
        }
      } catch {}
    }

    if (!effectiveKey) {
      return {
        success: false,
        latencyMs: 0,
        error: 'API key is required.'
      };
    }

    const norm = (providerId || '').toLowerCase().trim();

    // Native Anthropic test endpoint
    if (norm === 'anthropic' || norm === 'claude' || norm === 'anthropic-claude') {
      try {
        const res = await providerFetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': effectiveKey,
            'anthropic-version': '2023-06-01'
          },
          signal: AbortSignal.timeout(10_000)
        });
        const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
        if (res.ok) {
          providerHealthMonitor.recordRequestOutcome(providerId, true, latencyMs);
          return { success: true, latencyMs };
        }
        if (res.status === 401 || res.status === 403) {
          providerHealthMonitor.recordRequestOutcome(providerId, false, latencyMs, 'Invalid Anthropic API key');
          return { success: false, latencyMs, error: 'Invalid Anthropic API key' };
        }
        const msgRes = await providerFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': effectiveKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: modelId || 'claude-3-5-haiku-20241022',
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          }),
          signal: AbortSignal.timeout(10_000)
        });
        const msgLatency = Math.max(1, Math.round(performance.now() - startTime));
        if (msgRes.ok) {
          providerHealthMonitor.recordRequestOutcome(providerId, true, msgLatency);
          return { success: true, latencyMs: msgLatency };
        }
        const errBody = await msgRes.text().catch(() => '');
        providerHealthMonitor.recordRequestOutcome(providerId, false, msgLatency, errBody);
        return { success: false, latencyMs: msgLatency, error: msgRes.status === 401 ? 'Invalid Anthropic API key' : `HTTP ${msgRes.status}` };
      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - startTime);
        return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const isGoogle = this.isGoogleProvider(providerId);

    // Native Google Gemini test endpoint
    if (isGoogle) {
      try {
        const res = await providerFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(effectiveKey)}`, {
          signal: AbortSignal.timeout(10_000)
        });
        const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
        if (res.ok) {
          providerHealthMonitor.recordRequestOutcome(providerId, true, latencyMs);
          return { success: true, latencyMs };
        }
        if (res.status === 400 || res.status === 403) {
          providerHealthMonitor.recordRequestOutcome(providerId, false, latencyMs, 'Invalid Google Gemini API key');
          return { success: false, latencyMs, error: 'Invalid Google Gemini API key' };
        }
      } catch {
        // Fall through to OpenAI-compatible test below
      }
    }

    const testModel = modelId || (isGoogle ? 'gemini-2.0-flash' : preconfigured?.defaultModel || (providerId === 'groq' ? 'openai/gpt-oss-120b' : providerId.includes('openkilo') ? 'kilo-auto/free' : 'dots-studio/dots-3-note-preview:free'));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${effectiveKey}`
    };
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ty-code.dev';
      headers['X-Title'] = 'Ty-Code Desktop';
    }

    // Google's OpenAI-compatible surface lives at /v1beta/openai/chat/completions
    // (Bearer accepted); the bare /v1beta/chat/completions path 404s.
    const chatUrl = isGoogle ? this.googleChatUrl(baseUrl)! : `${baseUrl}/chat/completions`;

    try {
      const response = await providerFetch(chatUrl, {
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
        const probeBody = await response.text().catch(() => '');
        const invalidKey = response.status === 401 || response.status === 403
          || (response.status === 400 && /api key not valid|permission/i.test(probeBody));
        if (invalidKey) {
          const hint = isGoogle && /AQ\./i.test(apiKey || '')
            ? 'Invalid API Key (new-format Google Cloud key detected — make sure the Generative Language API is enabled for that key\'s project at aistudio.google.com/app/apikey, or create a classic AI Studio key)'
            : 'Invalid API Key';
          return {
            success: false,
            latencyMs,
            error: hint
          };
        }
        let parsedError = `HTTP ${response.status}`;
        try {
          const errJson = JSON.parse(probeBody) as { error?: { message?: string }; message?: string };
          parsedError = errJson.error?.message || errJson.message || parsedError;
        } catch {
          if (probeBody) parsedError = probeBody.slice(0, 150);
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

    // ZeroFriction diagnosis (Prompt 3): entry logs for the agent streaming path.
    console.log(`[GATEWAY] Request received - provider: ${providerId}, model: ${modelId}`);
    console.log('[GATEWAY] Checking if provider requires key...');

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
        const aliases = getProviderAliases(providerId);
        // 1. In-memory decryption cache via getKey (0ms latency)
        for (const alias of aliases) {
          const vaultKey = await getKey(alias).catch(() => undefined);
          if (vaultKey && vaultKey.trim()) {
            apiKey = vaultKey.trim();
            console.log(`[GATEWAY] Using in-memory cached key for ${providerId || alias}`);
            break;
          }
        }
        // 2. Try secure credentialStore (RealConnect 2 Electron safeStorage)
        if (!apiKey) {
          for (const alias of aliases) {
            const storedKey = credentialStore.getDecryptedKey(alias);
            if (storedKey && storedKey.trim()) {
              apiKey = storedKey.trim();
              console.log(`[GATEWAY] Using in-memory cached key for ${providerId || alias}`);
              break;
            }
          }
        }
        // 3. Try settings-handlers or settings.apiKeys
        if (!apiKey) {
          try {
            const { keys } = await readStoredCredentials();
            for (const alias of aliases) {
              if (keys[alias] && keys[alias].trim()) {
                apiKey = keys[alias].trim();
                console.log(`[GATEWAY] Using in-memory cached key for ${providerId || alias}`);
                break;
              }
            }
          } catch {
            // Non-blocking
          }
        }
        // 4. Try settings.apiKeys
        if (!apiKey && settings.apiKeys) {
          for (const alias of aliases) {
            if (settings.apiKeys[alias as ProviderType]) {
              apiKey = settings.apiKeys[alias as ProviderType]!;
              break;
            }
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
          cohere: ['COHERE_API_KEY'],
          opencode: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'],
          'opencode-free': ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY']
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
        try {
          // ZeroFriction diagnosis (Prompt 3): the last-chance vault bootstrap.
          console.log('[GATEWAY] No user key found - attempting Community Key fallback');
          console.log('[GATEWAY] Calling getCommunityKey()...');
          const community = await getCommunityKey().catch(() => null);
          console.log(`[GATEWAY] Community Key returned: ${community ? 'YES (length: ' + community.length + ')' : 'NO - null'}`);
          if (community) {
            apiKey = community;
          }
          if (!community) {
            console.log('[GATEWAY] Community Key FAILED - falling back to anonymous tier');
          }
        } catch {}
      }

      if (!apiKey || !apiKey.trim()) {
        if (providerId === 'openkilo' || providerId === 'openkilo-free' || (modelId || '').includes(':free') || (modelId || '').includes('/free')) {
          apiKey = 'anonymous';
        } else {
          throw new Error(
            `[ProviderGateway] CONFIG_MISSING: No API key configured for provider "${providerId}". Use 1-Click Auto-Detect or switch to OpenKilo (Zero-Key Free) or Ollama (Local).`
          );
        }
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
    if (apiKey) {
      if (apiKey === getCommunityKeyCached()) {
        // ZeroFriction diagnosis (Prompt 3): which credential identity is on the wire.
        console.log('[GATEWAY] Setting Authorization header with Community Key');
      }
      headers.Authorization = `Bearer ${apiKey}`;
    }
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
    let gatewayUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    if (this.isGoogleProvider(providerId) || baseUrl.includes('generativelanguage.googleapis.com')) {
      gatewayUrl = this.googleChatUrl(baseUrl)!;
    }
    if (gatewayUrl.includes('api.openkilo.com')) {
      gatewayUrl = 'https://api.kilo.ai/api/gateway/chat/completions';
    }
    console.log('Gateway: Fetching from', gatewayUrl, 'with model', modelId, 'headers', JSON.stringify({ ...headers, ...(headers.Authorization ? { Authorization: 'Bearer ***' } : {}) }));
    console.log(`[GATEWAY] Request URL: ${gatewayUrl}`);
    try {
      // Add 120s timeout for long streaming responses
      const timeoutSignal = AbortSignal.timeout(120_000);
      const combinedSignal = abortSignal 
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;
      
      response = await providerFetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal
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
      // ZeroFriction diagnosis (Prompt 3): log-only - no behavior change here.
      if (apiKey === getCommunityKeyCached() && (response.status === 401 || response.status === 403)) {
        console.log('[GATEWAY] Auth FAILED (401/403) - Community Key may be invalid or expired');
        console.log('[GATEWAY] Invalidating cached Community Key...');
        console.warn('[GATEWAY] ty-code-free: Community Key rejected; invalidating cache for re-bootstrap (LOG ONLY - identity untouched in this path).');
      }
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

    const tokenBatcher = new StreamChunkBatcher((chunk) => {
      callbacks.onToken?.(chunk);
    }, 20);
    const thoughtBatcher = new StreamChunkBatcher((chunk) => {
      callbacks.onThought?.(chunk);
    }, 20);

    const consume = (payload: StreamPayload) => {
      if (payload.usage) {
        streamUsage = payload.usage;
      }
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        if (!firstChunkReported) console.log('Gateway: First chunk', JSON.stringify(delta.content.slice(0, 80)));
        fullText += delta.content;
        tokenBatcher.push(delta.content);
        callbacks.onRawToken?.(delta.content);

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
        thoughtBatcher.push(thought);
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
      tokenBatcher.flush();
      thoughtBatcher.flush();
    } finally {
      tokenBatcher.flush();
      thoughtBatcher.flush();
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
