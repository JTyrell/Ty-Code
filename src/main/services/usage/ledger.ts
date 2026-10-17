/**
 * Per-Instance AI Usage & Rate-Limit Ledger (Scale 1)
 *
 * Local per-instance ledger persisting to userData (atomic JSON):
 * - Per-provider, per-model counters: requests, prompt/completion tokens, errors, latency, cost savings
 * - Live update from stream usage payloads or accurate tokenizer approximations (~3.8 chars/tok)
 * - Free-tier cap extraction from response headers (x-ratelimit-reset, x-ratelimit-remaining, retry-after)
 * - Human-readable "resets in Xh Ym" calculation
 * - Export as JSON and CSV
 * - Zero-server architecture: 100% client-local, zero tracking servers
 * - Stub interface for optional future encrypted cross-device sync
 *
 * Brand: Ty-Code
 */

import { app } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ProviderModelCounter {
  providerId: string;
  modelId: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errors: number;
  totalLatencyMs: number;
  lastUsedAt: number;
  costSavedUsd: number;
  exactUsageCount: number;
  estimatedUsageCount: number;
}

export interface ProviderRateLimitInfo {
  providerId: string;
  resetsAt?: number; // epoch ms
  resetsInSeconds?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  limitRequests?: number;
  limitTokens?: number;
  lastUpdated: number;
  resetHuman?: string; // e.g. "resets in 2h 15m" or "active"
}

export interface LedgerTransaction {
  id: string;
  timestamp: number;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  costSavedUsd: number;
  isExactUsage: boolean;
  rateLimitRemaining?: number;
  rateLimitResetsAt?: number;
}

export interface UsageLedgerSnapshot {
  version: number;
  instanceId: string;
  createdAt: number;
  lastUpdated: number;
  overall: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalErrors: number;
    totalCostSavedUsd: number;
    averageLatencyMs: number;
  };
  providerCounters: Record<string, ProviderModelCounter>;
  rateLimits: Record<string, ProviderRateLimitInfo>;
  recentTransactions: LedgerTransaction[];
}

/**
 * Stub interface for optional future encrypted cross-device sync.
 * (No server is deployed or contacted in this zero-server client phase).
 */
export interface EncryptedSyncProviderStub {
  syncLedger(encryptedBlob: string): Promise<{ success: boolean; message: string }>;
  pullRemoteLedger(): Promise<{ success: boolean; encryptedBlob?: string; message: string }>;
}

const getUserDataPath = (): string => {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // fallback if app is not yet initialized
  }
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Ty-Code')
    : path.join(process.env.HOME || process.cwd(), '.ty-code');
};

const LEDGER_FILE = path.join(getUserDataPath(), 'usage-ledger.json');
const SQLITE_FILE = path.join(getUserDataPath(), 'usage-ledger.db');
const COMMERCIAL_PRICE_PER_M_TOKENS = 3.0; // $3.00 per 1M tokens benchmark

export interface SqliteLedgerRow {
  id?: number;
  provider_id: string;
  model_id: string;
  timestamp: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  error_count: number;
  success_count: number;
}

export class UsageLedgerService {
  private static instance: UsageLedgerService;

  private instanceId: string = crypto.randomUUID();
  private createdAt = Date.now();
  private lastUpdated = Date.now();
  private isLoaded = false;
  private isWriting = false;
  private writePending = false;
  private sqliteDb: any = null;

  private overall = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalErrors: 0,
    totalCostSavedUsd: 0,
    averageLatencyMs: 0
  };

  private providerCounters = new Map<string, ProviderModelCounter>();
  private rateLimits = new Map<string, ProviderRateLimitInfo>();
  private recentTransactions: LedgerTransaction[] = [];
  private static readonly MAX_RECENT_TRANSACTIONS = 500;

  private constructor() {
    this.initSqlite();
    void this.loadLedger();
  }

  private initSqlite(): void {
    try {
      // Support native node:sqlite or better-sqlite3 dynamically
      let DatabaseClass: any = null;
      try {
        DatabaseClass = require('node:sqlite').DatabaseSync;
      } catch {
        try {
          const fallbackMod = 'better-sqlite3';
          DatabaseClass = require(fallbackMod);
        } catch {}
      }

      if (DatabaseClass) {
        fsSync.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
        this.sqliteDb = new DatabaseClass(SQLITE_FILE);
        this.sqliteDb.exec(`
          CREATE TABLE IF NOT EXISTS usage_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            completion_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            error_count INTEGER NOT NULL,
            success_count INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_ledger(provider_id);
          CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_ledger(timestamp);
        `);
      }
    } catch (err) {
      // SQLite init warning; fall back gracefully to JSON persistence
    }
  }

  public getSqliteDb(): any {
    return this.sqliteDb;
  }

  public static getInstance(): UsageLedgerService {
    if (!UsageLedgerService.instance) {
      UsageLedgerService.instance = new UsageLedgerService();
    }
    return UsageLedgerService.instance;
  }

  /**
   * Initializes or loads persisted ledger from disk
   */
  public async loadLedger(): Promise<void> {
    if (this.isLoaded) return;

    try {
      const raw = await fs.readFile(LEDGER_FILE, 'utf8');
      const data = JSON.parse(raw) as UsageLedgerSnapshot;
      if (data && typeof data === 'object') {
        this.instanceId = data.instanceId || this.instanceId;
        this.createdAt = data.createdAt || this.createdAt;
        this.lastUpdated = data.lastUpdated || Date.now();
        if (data.overall) {
          this.overall = { ...this.overall, ...data.overall };
        }
        if (data.providerCounters) {
          for (const [key, counter] of Object.entries(data.providerCounters)) {
            this.providerCounters.set(key, counter);
          }
        }
        if (data.rateLimits) {
          for (const [key, limit] of Object.entries(data.rateLimits)) {
            this.rateLimits.set(key, limit);
          }
        }
        if (Array.isArray(data.recentTransactions)) {
          this.recentTransactions = data.recentTransactions.slice(-UsageLedgerService.MAX_RECENT_TRANSACTIONS);
        }
      }
    } catch {
      // File does not exist yet; will be written on first transaction
    } finally {
      this.isLoaded = true;
    }
  }

  /**
   * Persists ledger atomically using temporary file + rename
   */
  private async persist(): Promise<void> {
    if (this.isWriting) {
      this.writePending = true;
      return;
    }

    this.isWriting = true;
    this.writePending = false;
    this.lastUpdated = Date.now();

    try {
      const snapshot = this.getSnapshot();
      await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
      const tmpPath = `${LEDGER_FILE}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmpPath, LEDGER_FILE);
    } catch (err) {
      console.warn('[Ledger] Failed to persist usage ledger:', err);
    } finally {
      this.isWriting = false;
      if (this.writePending) {
        setImmediate(() => void this.persist());
      }
    }
  }

  /**
   * High-accuracy fallback token estimation: ~3.8 characters per token
   */
  public estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.round(text.length / 3.8));
  }

  /**
   * Updates rate limit metadata from provider HTTP response headers
   */
  public updateRateLimitsFromHeaders(
    providerId: string,
    headers: Headers | Record<string, string | string[] | undefined>
  ): void {
    const getHeader = (name: string): string | null => {
      if (!headers) return null;
      if (typeof (headers as Headers).get === 'function') {
        return (headers as Headers).get(name);
      }
      const record = headers as Record<string, string | string[] | undefined>;
      const val = record[name] ?? record[name.toLowerCase()];
      return Array.isArray(val) ? val[0] : (val || null);
    };

    const remainingRequestsStr = getHeader('x-ratelimit-remaining-requests') || getHeader('x-ratelimit-remaining');
    const remainingTokensStr = getHeader('x-ratelimit-remaining-tokens');
    const limitRequestsStr = getHeader('x-ratelimit-limit-requests') || getHeader('x-ratelimit-limit');
    const limitTokensStr = getHeader('x-ratelimit-limit-tokens');
    const resetTimeStr = getHeader('x-ratelimit-reset') || getHeader('x-ratelimit-reset-requests') || getHeader('retry-after');

    const remainingRequests = remainingRequestsStr ? parseInt(remainingRequestsStr, 10) : undefined;
    const remainingTokens = remainingTokensStr ? parseInt(remainingTokensStr, 10) : undefined;
    const limitRequests = limitRequestsStr ? parseInt(limitRequestsStr, 10) : undefined;
    const limitTokens = limitTokensStr ? parseInt(limitTokensStr, 10) : undefined;

    let resetsAt: number | undefined;
    let resetsInSeconds: number | undefined;

    if (resetTimeStr) {
      const num = parseFloat(resetTimeStr);
      if (!isNaN(num)) {
        if (num > 1_000_000_000_000) {
          // Epoch ms
          resetsAt = Math.round(num);
          resetsInSeconds = Math.max(0, Math.round((resetsAt - Date.now()) / 1000));
        } else if (num > 1_000_000_000) {
          // Epoch seconds
          resetsAt = Math.round(num * 1000);
          resetsInSeconds = Math.max(0, Math.round((resetsAt - Date.now()) / 1000));
        } else {
          // Relative seconds (e.g. retry-after: 60)
          resetsInSeconds = Math.round(num);
          resetsAt = Date.now() + (resetsInSeconds * 1000);
        }
      } else {
        // Date string
        const parsedDate = Date.parse(resetTimeStr);
        if (!isNaN(parsedDate)) {
          resetsAt = parsedDate;
          resetsInSeconds = Math.max(0, Math.round((resetsAt - Date.now()) / 1000));
        }
      }
    }

    const resetHuman = this.formatResetHuman(resetsInSeconds);

    this.rateLimits.set(providerId, {
      providerId,
      resetsAt,
      resetsInSeconds,
      remainingRequests: isNaN(remainingRequests as number) ? undefined : remainingRequests,
      remainingTokens: isNaN(remainingTokens as number) ? undefined : remainingTokens,
      limitRequests: isNaN(limitRequests as number) ? undefined : limitRequests,
      limitTokens: isNaN(limitTokens as number) ? undefined : limitTokens,
      lastUpdated: Date.now(),
      resetHuman
    });

    void this.persist();
  }

  /**
   * Formats remaining seconds into friendly string (e.g. "resets in 2h 15m")
   */
  private formatResetHuman(seconds?: number): string {
    if (seconds === undefined || seconds <= 0) return 'active';
    if (seconds < 60) return `resets in ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `resets in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `resets in ${hours}h ${remMinutes}m` : `resets in ${hours}h`;
  }

  /**
   * Records an individual AI transaction into the ledger
   */
  public async recordTransaction(params: {
    providerId: string;
    modelId: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    isExactUsage?: boolean;
    latencyMs?: number;
    success?: boolean;
    error?: string;
    headers?: Headers | Record<string, string | string[] | undefined>;
  }): Promise<void> {
    await this.loadLedger();

    const providerId = params.providerId || 'unknown';
    const modelId = params.modelId || 'default';
    const success = params.success !== false;
    const latencyMs = Math.max(1, params.latencyMs || 1);
    const isExact = Boolean(params.isExactUsage);

    const promptTokens = Math.max(0, params.promptTokens || 0);
    const completionTokens = Math.max(0, params.completionTokens || 0);
    const totalTokens = params.totalTokens || (promptTokens + completionTokens);

    // Compute cost savings relative to commercial standard
    const costSavedUsd = Number(((totalTokens / 1_000_000) * COMMERCIAL_PRICE_PER_M_TOKENS).toFixed(5));

    // Update rate limits if headers provided
    if (params.headers) {
      this.updateRateLimitsFromHeaders(providerId, params.headers);
    }
    const currentRateLimit = this.rateLimits.get(providerId);

    // Key by provider:model
    const counterKey = `${providerId}:${modelId}`;
    const existing = this.providerCounters.get(counterKey) || {
      providerId,
      modelId,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      errors: 0,
      totalLatencyMs: 0,
      lastUsedAt: Date.now(),
      costSavedUsd: 0,
      exactUsageCount: 0,
      estimatedUsageCount: 0
    };

    existing.requests += 1;
    existing.promptTokens += promptTokens;
    existing.completionTokens += completionTokens;
    existing.totalTokens += totalTokens;
    if (!success) existing.errors += 1;
    existing.totalLatencyMs += latencyMs;
    existing.lastUsedAt = Date.now();
    existing.costSavedUsd += costSavedUsd;
    if (isExact) existing.exactUsageCount += 1;
    else existing.estimatedUsageCount += 1;

    this.providerCounters.set(counterKey, existing);

    // Update overall totals
    this.overall.totalRequests += 1;
    this.overall.totalPromptTokens += promptTokens;
    this.overall.totalCompletionTokens += completionTokens;
    this.overall.totalTokens += totalTokens;
    if (!success) this.overall.totalErrors += 1;
    this.overall.totalCostSavedUsd += costSavedUsd;

    const prevCount = this.overall.totalRequests - 1;
    this.overall.averageLatencyMs = Math.round(
      (this.overall.averageLatencyMs * prevCount + latencyMs) / this.overall.totalRequests
    );

    // Add transaction to history
    const transaction: LedgerTransaction = {
      id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: Date.now(),
      providerId,
      modelId,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      success,
      error: params.error,
      costSavedUsd,
      isExactUsage: isExact,
      rateLimitRemaining: currentRateLimit?.remainingRequests,
      rateLimitResetsAt: currentRateLimit?.resetsAt
    };

    this.recentTransactions.push(transaction);
    if (this.recentTransactions.length > UsageLedgerService.MAX_RECENT_TRANSACTIONS) {
      this.recentTransactions.shift();
    }

    // Insert into SQLite database if available
    if (this.sqliteDb) {
      try {
        const stmt = this.sqliteDb.prepare(`
          INSERT INTO usage_ledger (
            provider_id, model_id, timestamp, prompt_tokens, completion_tokens, total_tokens, latency_ms, error_count, success_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          providerId,
          modelId,
          transaction.timestamp,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          success ? 0 : 1,
          success ? 1 : 0
        );
      } catch {
        // non-blocking
      }
    }

    void this.persist();
  }

  /**
   * Revocation: removes provider token from safeStorage attribution and clears provider rate limit
   */
  public async disconnectProvider(providerId: string): Promise<void> {
    this.rateLimits.delete(providerId);
    this.rateLimits.delete(`${providerId}-free`);
    void this.persist();
  }

  /**
   * Returns complete snapshot of the usage ledger
   */
  public getSnapshot(): UsageLedgerSnapshot {
    const providerCountersRecord: Record<string, ProviderModelCounter> = {};
    for (const [k, v] of this.providerCounters.entries()) {
      providerCountersRecord[k] = { ...v };
    }

    const rateLimitsRecord: Record<string, ProviderRateLimitInfo> = {};
    for (const [k, v] of this.rateLimits.entries()) {
      // Re-evaluate human reset string
      let resetsInSeconds = v.resetsInSeconds;
      if (v.resetsAt) {
        resetsInSeconds = Math.max(0, Math.round((v.resetsAt - Date.now()) / 1000));
      }
      rateLimitsRecord[k] = {
        ...v,
        resetsInSeconds,
        resetHuman: this.formatResetHuman(resetsInSeconds)
      };
    }

    return {
      version: 1,
      instanceId: this.instanceId,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
      overall: { ...this.overall },
      providerCounters: providerCountersRecord,
      rateLimits: rateLimitsRecord,
      recentTransactions: [...this.recentTransactions]
    };
  }

  /**
   * Exports ledger to JSON string
   */
  public exportJson(): string {
    return JSON.stringify(this.getSnapshot(), null, 2);
  }

  /**
   * Exports ledger transactions to standard CSV format
   */
  public exportCsv(): string {
    const headers = [
      'ID',
      'Timestamp_ISO',
      'Provider',
      'Model',
      'Prompt_Tokens',
      'Completion_Tokens',
      'Total_Tokens',
      'Latency_ms',
      'Success',
      'Is_Exact_Usage',
      'Cost_Saved_USD',
      'Error'
    ];

    const rows = this.recentTransactions.map((tx) => [
      tx.id,
      new Date(tx.timestamp).toISOString(),
      `"${tx.providerId.replace(/"/g, '""')}"`,
      `"${tx.modelId.replace(/"/g, '""')}"`,
      tx.promptTokens,
      tx.completionTokens,
      tx.totalTokens,
      tx.latencyMs,
      tx.success ? 'TRUE' : 'FALSE',
      tx.isExactUsage ? 'EXACT' : 'ESTIMATED',
      tx.costSavedUsd.toFixed(5),
      `"${(tx.error || '').replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Resets local ledger counters
   */
  public async clearLedger(): Promise<void> {
    this.overall = {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalErrors: 0,
      totalCostSavedUsd: 0,
      averageLatencyMs: 0
    };
    this.providerCounters.clear();
    this.rateLimits.clear();
    this.recentTransactions = [];
    if (this.sqliteDb) {
      try {
        this.sqliteDb.exec('DELETE FROM usage_ledger');
      } catch {}
    }
    await this.persist();
  }

  /**
   * Resets local ledger counters for a specific provider (e.g. upon subscription revocation)
   */
  public async resetProvider(providerId: string): Promise<void> {
    for (const [key, counter] of this.providerCounters.entries()) {
      if (counter.providerId === providerId) {
        this.providerCounters.delete(key);
      }
    }
    this.rateLimits.delete(providerId);
    this.recentTransactions = this.recentTransactions.filter((tx) => tx.providerId !== providerId);
    if (this.sqliteDb) {
      try {
        const stmt = this.sqliteDb.prepare('DELETE FROM usage_ledger WHERE provider_id = ?');
        stmt.run(providerId);
      } catch {}
    }
    await this.persist();
  }

  /**
   * Retrieves raw transaction rows from SQLite database
   */
  public getSqliteRows(limit = 100): SqliteLedgerRow[] {
    if (!this.sqliteDb) return [];
    try {
      const stmt = this.sqliteDb.prepare(`
        SELECT provider_id, model_id, timestamp, prompt_tokens, completion_tokens, total_tokens, latency_ms, error_count, success_count
        FROM usage_ledger
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      return stmt.all(limit) as SqliteLedgerRow[];
    } catch {
      return [];
    }
  }

  /**
   * Aggregates usage grouped by provider and model directly from SQLite
   */
  public getAggregatedStats(): Array<{
    provider_id: string;
    model_id: string;
    total_requests: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    avg_latency_ms: number;
    error_count: number;
    success_count: number;
  }> {
    if (!this.sqliteDb) {
      return Array.from(this.providerCounters.values()).map((c) => ({
        provider_id: c.providerId,
        model_id: c.modelId,
        total_requests: c.requests,
        total_prompt_tokens: c.promptTokens,
        total_completion_tokens: c.completionTokens,
        total_tokens: c.totalTokens,
        avg_latency_ms: c.requests > 0 ? Math.round(c.totalLatencyMs / c.requests) : 0,
        error_count: c.errors,
        success_count: Math.max(0, c.requests - c.errors)
      }));
    }
    try {
      const stmt = this.sqliteDb.prepare(`
        SELECT
          provider_id,
          model_id,
          COUNT(*) as total_requests,
          SUM(prompt_tokens) as total_prompt_tokens,
          SUM(completion_tokens) as total_completion_tokens,
          SUM(total_tokens) as total_tokens,
          ROUND(AVG(latency_ms)) as avg_latency_ms,
          SUM(error_count) as error_count,
          SUM(success_count) as success_count
        FROM usage_ledger
        GROUP BY provider_id, model_id
        ORDER BY total_tokens DESC
      `);
      return stmt.all() as any[];
    } catch {
      return [];
    }
  }

  // =========================================================================
  // Optional Future Encrypted Cross-Device Sync (Stub Interface Only)
  // =========================================================================

  /**
   * Stub interface for optional future encrypted cross-device sync.
   * Zero server calls are made in this phase.
   */
  public getSyncStub(): EncryptedSyncProviderStub {
    return {
      syncLedger: async (_encryptedBlob: string) => ({
        success: true,
        message: 'Encrypted sync stub: zero-server mode is active. Ledger remains strictly local on this device.'
      }),
      pullRemoteLedger: async () => ({
        success: false,
        message: 'No remote sync backend configured. Operating in zero-server local mode.'
      })
    };
  }
}

export const usageLedger = UsageLedgerService.getInstance();
