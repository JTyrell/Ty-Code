/**
 * Request Cache Service (Phase 5.6)
 *
 * Content-addressable LRU cache for LLM queries and repetitive agent operations.
 * Drastically reduces latency (<5ms for cached hits) and saves free token quota.
 */

import crypto from 'node:crypto';
import type { RequestCacheStats } from '../../../preload/types';

export interface CachedResponse {
  hash: string;
  fullText: string;
  fullThought: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  modelId: string;
  providerId: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

export class RequestCacheService {
  private cache = new Map<string, CachedResponse>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private totalTokensSaved = 0;
  private totalLatencySavedMs = 0;

  constructor(maxEntries = 250, defaultTtlMs = 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Generates a deterministic SHA-256 fingerprint for a request payload
   */
  public computeKey(
    modelId: string,
    messages: Array<{ role: string; content?: string }>,
    tools?: unknown[],
    temperature?: number
  ): string {
    const payload = {
      model: modelId,
      messages: messages.map((m) => ({ role: m.role, content: m.content || '' })),
      tools: tools || [],
      temperature: temperature ?? 0.2
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  public get(key: string): CachedResponse | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    entry.hitCount++;
    this.totalTokensSaved += (entry.promptTokens + entry.completionTokens);
    this.totalLatencySavedMs += 1200; // Average LLM round-trip saved (~1.2s)

    // Move to most-recently-used by reinserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  public set(
    key: string,
    response: {
      fullText: string;
      fullThought: string;
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      modelId: string;
      providerId: string;
      promptTokens: number;
      completionTokens: number;
    },
    ttlMs?: number
  ): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first key in map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const ttl = ttlMs || this.defaultTtlMs;
    const cached: CachedResponse = {
      hash: key,
      ...response,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      hitCount: 0
    };

    this.cache.set(key, cached);
  }

  public getStats(): RequestCacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRatePercent = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      totalEntries: this.cache.size,
      tokensSaved: this.totalTokensSaved,
      latencySavedMs: this.totalLatencySavedMs,
      hitRatePercent: Math.round(hitRatePercent * 100) / 100
    };
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalTokensSaved = 0;
    this.totalLatencySavedMs = 0;
  }
}

export const requestCache = new RequestCacheService();
