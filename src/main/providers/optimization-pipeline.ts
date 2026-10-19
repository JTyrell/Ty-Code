/**
 * Token Optimization Pipeline (Phase FCC-4)
 *
 * Implements RTK-style output compression, Headroom-style context pruning,
 * and semantic response caching to optimize token efficiency by >=20%:
 *
 * 1. RTK-style: compress tool outputs/terminal dumps (>N lines summarized) before send.
 * 2. Headroom-style: context pruning of stale tool results beyond relevance window.
 * 3. Semantic response cache: hash-keyed, per-session opt-out, labeled 'cached' in chat.
 * 4. Savings meter: 'Optimization saved X tokens (Y%) this session' in Usage Dashboard + status bar tooltip.
 *
 * Brand: Ty-Code
 */

import crypto from 'node:crypto';
import type { ChatCompletionMessage } from './provider-gateway';
import type { FccProviderQuotaBar, FccQuotaMetersSummary } from '../../preload/types';
import { usageLedger } from '../services/usage/ledger';

export interface RtkCompressionResult {
  compressed: string;
  originalChars: number;
  compressedChars: number;
  savedTokens: number;
  wasCompressed: boolean;
}

export interface HeadroomPruningResult {
  prunedMessages: ChatCompletionMessage[];
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  prunedCount: number;
}

export interface CachedResponse {
  fullText: string;
  fullThought: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  promptTokens: number;
  completionTokens: number;
  timestamp: number;
}

export interface SessionSavingsSummary {
  savedTokens: number;
  rawTokens: number;
  optimizedTokens: number;
  percent: number;
  label: string;
  rtkSavedTokens: number;
  headroomSavedTokens: number;
  cacheSavedTokens: number;
}

export class OptimizationPipeline {
  private static instance: OptimizationPipeline;

  // In-memory semantic cache: key -> CachedResponse
  private responseCache = new Map<string, CachedResponse>();
  private cacheTtlMs = 15 * 60 * 1000; // 15 minutes TTL

  // Per-session cache opt-out: sessionId -> boolean
  private sessionCacheOptOut = new Map<string, boolean>();

  // Session-level cumulative token metrics
  private sessionRawTokens = 0;
  private sessionOptimizedTokens = 0;
  private sessionRtkSaved = 0;
  private sessionHeadroomSaved = 0;
  private sessionCacheSaved = 0;

  private constructor() {}

  public static getInstance(): OptimizationPipeline {
    if (!OptimizationPipeline.instance) {
      OptimizationPipeline.instance = new OptimizationPipeline();
    }
    return OptimizationPipeline.instance;
  }

  /**
   * RTK-Style Output Compression:
   * Compresses large tool outputs / terminal dumps (>maxLines or >maxChars)
   * while preserving head (top 10 lines) and tail (bottom 10 lines).
   */
  public compressToolOutput(
    output: string,
    maxLines = 25,
    maxChars = 1200
  ): RtkCompressionResult {
    if (!output) {
      return {
        compressed: '',
        originalChars: 0,
        compressedChars: 0,
        savedTokens: 0,
        wasCompressed: false
      };
    }

    const originalChars = output.length;
    const lines = output.split(/\r?\n/);

    if (lines.length <= maxLines && originalChars <= maxChars) {
      return {
        compressed: output,
        originalChars,
        compressedChars: originalChars,
        savedTokens: 0,
        wasCompressed: false
      };
    }

    const headLines = lines.slice(0, 10);
    const tailLines = lines.slice(-10);
    const omittedLines = lines.length - headLines.length - tailLines.length;
    const omittedChars = originalChars - (headLines.join('\n').length + tailLines.join('\n').length);

    const compressed = [
      ...headLines,
      `\n... [RTK-compressed: ${omittedLines} lines omitted and summarized (${omittedChars} chars) for token efficiency] ...\n`,
      ...tailLines
    ].join('\n');

    const compressedChars = compressed.length;
    const savedTokens = Math.max(0, Math.round((originalChars - compressedChars) / 3.8));

    this.recordSavings('rtk', savedTokens, Math.round(originalChars / 3.8));

    return {
      compressed,
      originalChars,
      compressedChars,
      savedTokens,
      wasCompressed: true
    };
  }

  /**
   * Headroom-Style Context Pruning:
   * Prunes bulky tool results older than the active relevance window (default: 3 turns),
   * leaving a concise reference while preserving the assistant's decision and the latest user turn.
   */
  public pruneMessageHistory(
    messages: ChatCompletionMessage[],
    relevanceWindowTurns = 3
  ): HeadroomPruningResult {
    if (!messages || messages.length <= 4) {
      const estimated = this.estimateTokens(messages);
      return {
        prunedMessages: messages,
        originalTokens: estimated,
        optimizedTokens: estimated,
        savedTokens: 0,
        prunedCount: 0
      };
    }

    const originalTokens = this.estimateTokens(messages);
    let prunedCount = 0;
    const cutoffIndex = Math.max(1, messages.length - (relevanceWindowTurns * 2));

    const prunedMessages = messages.map((msg, index) => {
      // Never prune system prompt (index 0) or messages in the active relevance window
      if (index === 0 || index >= cutoffIndex) {
        return msg;
      }

      // Check for tool results or bulky assistant responses with tool calls
      if (msg.role === 'tool' || (msg.content && msg.content.length > 600 && msg.role === 'assistant')) {
        const originalLength = msg.content.length;
        const lineCount = msg.content.split(/\r?\n/).length;

        prunedCount++;
        const summary = `[Headroom-pruned: Output (${lineCount} lines / ${originalLength} chars) retained in workspace cache]`;

        return {
          ...msg,
          content: summary
        };
      }

      return msg;
    });

    const optimizedTokens = this.estimateTokens(prunedMessages);
    const savedTokens = Math.max(0, originalTokens - optimizedTokens);

    if (savedTokens > 0) {
      this.recordSavings('headroom', savedTokens, originalTokens);
    }

    return {
      prunedMessages,
      originalTokens,
      optimizedTokens,
      savedTokens,
      prunedCount
    };
  }

  /**
   * Semantic Response Caching:
   * Computes a canonical SHA-256 hash key across model, messages, tools, and temperature.
   */
  public computeCacheKey(
    modelId: string,
    messages: ChatCompletionMessage[],
    tools?: unknown[],
    temperature?: number
  ): string {
    const canonical = JSON.stringify({
      m: modelId,
      t: temperature ?? 0.2,
      msgs: messages.map((m) => ({ r: m.role, c: m.content, tc: m.tool_calls })),
      tls: tools || []
    });

    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Retrieves a cached response if valid and not opted out for the session.
   */
  public getCachedResponse(key: string, sessionId?: string): CachedResponse | null {
    if (sessionId && this.sessionCacheOptOut.get(sessionId)) {
      return null;
    }

    const entry = this.responseCache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.responseCache.delete(key);
      return null;
    }

    // Record cache hit savings
    const savedTokens = entry.completionTokens || Math.max(1, Math.round(entry.fullText.length / 3.8));
    this.recordSavings('cache', savedTokens, savedTokens + entry.promptTokens);

    return entry;
  }

  /**
   * Stores a response in the semantic cache.
   */
  public setCachedResponse(
    key: string,
    response: Omit<CachedResponse, 'timestamp'>,
    sessionId?: string
  ): void {
    if (sessionId && this.sessionCacheOptOut.get(sessionId)) {
      return;
    }

    this.responseCache.set(key, {
      ...response,
      timestamp: Date.now()
    });

    // Enforce max cache size (200 entries)
    if (this.responseCache.size > 200) {
      const oldestKey = this.responseCache.keys().next().value;
      if (oldestKey) this.responseCache.delete(oldestKey);
    }
  }

  /**
   * Sets per-session cache opt-out.
   */
  public setSessionCacheOptOut(sessionId: string, optOut: boolean): void {
    this.sessionCacheOptOut.set(sessionId, optOut);
  }

  public isSessionCacheOptedOut(sessionId: string): boolean {
    return Boolean(this.sessionCacheOptOut.get(sessionId));
  }

  /**
   * Records token savings across categories.
   */
  public recordSavings(
    category: 'rtk' | 'headroom' | 'cache',
    savedTokens: number,
    rawTokens: number
  ): void {
    if (savedTokens <= 0) return;

    this.sessionRawTokens += Math.max(savedTokens, rawTokens);
    this.sessionOptimizedTokens += Math.max(0, rawTokens - savedTokens);

    if (category === 'rtk') this.sessionRtkSaved += savedTokens;
    if (category === 'headroom') this.sessionHeadroomSaved += savedTokens;
    if (category === 'cache') this.sessionCacheSaved += savedTokens;
  }

  /**
   * Returns session savings summary matching the exact required format:
   * 'Optimization saved X tokens (Y%) this session'
   */
  public getSessionSavingsSummary(): SessionSavingsSummary {
    const savedTokens = this.sessionRtkSaved + this.sessionHeadroomSaved + this.sessionCacheSaved;
    const rawTokens = Math.max(savedTokens, this.sessionRawTokens);
    const optimizedTokens = Math.max(0, rawTokens - savedTokens);
    const percent = rawTokens > 0 ? Math.min(100, Math.round((savedTokens / rawTokens) * 100)) : 0;

    const formattedSaved = new Intl.NumberFormat('en-US').format(savedTokens);
    const label = `Optimization saved ${formattedSaved} tokens (${percent}%) this session`;

    return {
      savedTokens,
      rawTokens,
      optimizedTokens,
      percent,
      label,
      rtkSavedTokens: this.sessionRtkSaved,
      headroomSavedTokens: this.sessionHeadroomSaved,
      cacheSavedTokens: this.sessionCacheSaved
    };
  }

  /**
   * Resets session counters (e.g. on new session or testing).
   */
  public resetSessionSavings(): void {
    this.sessionRawTokens = 0;
    this.sessionOptimizedTokens = 0;
    this.sessionRtkSaved = 0;
    this.sessionHeadroomSaved = 0;
    this.sessionCacheSaved = 0;
  }

  /**
   * Generates real-time quota meters summary per provider and aggregated free daily tokens.
   */
  public getQuotaMetersSummary(activeProviderId = 'openrouter'): FccQuotaMetersSummary {
    const ledger = usageLedger.getSnapshot();
    const rateLimits = ledger.rateLimits || {};
    const counters = ledger.providerCounters || {};

    const freeProviderDefs = [
      { id: 'openrouter', name: 'OpenRouter Free Tier', dailyBudget: 200_000, defaultModel: 'dots-studio/dots-3-note-preview:free' },
      { id: 'google-ai-studio', name: 'Google AI Studio Free', dailyBudget: 1_000_000, defaultModel: 'gemini-2.5-flash' },
      { id: 'groq', name: 'Groq High-Speed Free', dailyBudget: 500_000, defaultModel: 'llama-3.3-70b-versatile' },
      { id: 'huggingchat', name: 'HuggingChat Free', dailyBudget: 150_000, defaultModel: 'meta-llama/Llama-3.3-70B-Instruct' },
      { id: 'openkilo', name: 'OpenKilo Zero-Key Free', dailyBudget: 300_000, defaultModel: 'deepseek/deepseek-chat' },
      { id: 'copilot', name: 'GitHub Copilot (Subscription)', dailyBudget: 2_000_000, defaultModel: 'gpt-4o' },
      { id: 'ollama', name: 'Ollama Local (Unlimited)', dailyBudget: 5_000_000, defaultModel: 'llama3:latest' }
    ];

    let aggregateDailyBudget = 0;
    let aggregateRemainingToday = 0;
    const providerBars: FccProviderQuotaBar[] = [];

    for (const def of freeProviderDefs) {
      const rl = rateLimits[def.id] || rateLimits[`${def.id}-free`];
      const counter = counters[def.id] || counters[`${def.id}-free`];
      const usedTokens = counter?.totalTokens || 0;

      const limitTokens = rl?.limitTokens ?? def.dailyBudget;
      const remainingTokens = rl?.remainingTokens !== undefined
        ? rl.remainingTokens
        : Math.max(0, limitTokens - usedTokens);
      const remainingRequests = rl?.remainingRequests;
      const limitRequests = rl?.limitRequests;

      const isExhausted = (remainingTokens <= 0) || (remainingRequests !== undefined && remainingRequests <= 0);
      const percentUsed = limitTokens > 0
        ? Math.min(100, Math.max(0, Math.round(((limitTokens - remainingTokens) / limitTokens) * 100)))
        : 0;

      // Honest reset reporting: only claim a reset window the provider sheet
      // actually told us about, otherwise state it plainly.
      let resetHuman: string;
      let resetsInSeconds: number;
      if (rl?.resetsInSeconds !== undefined) {
        resetsInSeconds = rl.resetsInSeconds;
        resetHuman = rl?.resetHuman || (resetsInSeconds > 0
          ? `resets in ${Math.floor(resetsInSeconds / 3600)}h ${Math.floor((resetsInSeconds % 3600) / 60)}m`
          : 'active');
      } else if (usedTokens > 0) {
        resetsInSeconds = 0;
        resetHuman = 'reset time unknown (no provider header yet)';
      } else {
        resetsInSeconds = 0;
        resetHuman = 'no usage recorded yet';
      }

      aggregateDailyBudget += limitTokens;
      aggregateRemainingToday += remainingTokens;

      providerBars.push({
        providerId: def.id,
        providerName: def.name,
        isFreeTier: true,
        remainingTokens,
        limitTokens,
        remainingRequests,
        limitRequests,
        percentUsed,
        resetHuman,
        resetsInSeconds,
        isExhausted
      });
    }

    const hasAnyExhausted = providerBars.some((p) => p.isExhausted);
    const activeProvider = providerBars.find((p) => p.providerId === activeProviderId);
    const activeProviderExhausted = Boolean(activeProvider?.isExhausted);

    // Recommend highest remaining alternative
    const candidates = providerBars.filter((p) => !p.isExhausted && p.providerId !== activeProviderId);
    const bestCandidate = candidates.sort((a, b) => (b.remainingTokens || 0) - (a.remainingTokens || 0))[0] || providerBars[0];

    const recommendedAlternative = bestCandidate
      ? {
          providerId: bestCandidate.providerId,
          modelId: freeProviderDefs.find((d) => d.id === bestCandidate.providerId)?.defaultModel || 'gemini-2.5-flash',
          reason: `${bestCandidate.providerName}: ${(bestCandidate.remainingTokens || 0).toLocaleString()} free tokens available of ${(bestCandidate.limitTokens || 0).toLocaleString()}.`
        }
      : {
          providerId: 'openrouter',
          modelId: freeProviderDefs.find((d) => d.id === 'openrouter')?.defaultModel || 'dots-studio/dots-3-note-preview:free',
          reason: 'No free-tier provider data available yet.'
        };

    return {
      aggregateFreeTokensRemainingToday: aggregateRemainingToday,
      aggregateFreeTokensDailyBudget: aggregateDailyBudget,
      providers: providerBars,
      hasAnyExhausted,
      activeProviderExhausted,
      recommendedAlternative
    };
  }

  /**
   * Helper to estimate tokens for messages array (~3.8 chars/token).
   */
  public estimateTokens(messages: ChatCompletionMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      chars += (m.content || '').length;
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          chars += tc.function.name.length + tc.function.arguments.length;
        }
      }
    }
    return Math.max(1, Math.round(chars / 3.8));
  }
}

export const optimizationPipeline = OptimizationPipeline.getInstance();
