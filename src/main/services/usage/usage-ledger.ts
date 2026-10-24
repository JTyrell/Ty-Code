/**
 * Ty-Code Usage Ledger (Feature 1)
 *
 * Append-only, tamper-evident hash-chained JSON-lines ledger:
 *   Location: ~/.tycode/ledger/usage-YYYY-MM.jsonl
 *   Hash chain: recordHash = sha256(prevHash + canonical(record))
 *   Buffered async append: flushes at 20 records or 2s debounce (never blocks streaming)
 *   Costing: uses resources/pricing/model-pricing.json; free-tier & local => $0
 *   Rollups: hourly in-memory rollups synced to ~/.tycode/ledger/daily-YYYY-MM-DD.json
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  type TokenAccountingRecord,
  type LayerToken,
  type BillingTier,
  type AccountingPhase,
  computeRecordHash,
  TokenAccountingRecord as TokenAccountingRecordSchema
} from './token-accounting';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const FLUSH_BATCH_SIZE = 20;
const FLUSH_DEBOUNCE_MS = 2000;

export interface ModelPricingEntry {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

export interface PricingConfig {
  version: number;
  currency: 'USD';
  rates: Record<string, ModelPricingEntry>;
  default: ModelPricingEntry;
}

const DEFAULT_PRICING: PricingConfig = {
  version: 1,
  currency: 'USD',
  rates: {
    'claude-3-5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
    'claude-3-opus': { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
    'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4.0, cacheReadPer1M: 0.08, cacheWritePer1M: 1.0 },
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, cacheReadPer1M: 1.25, cacheWritePer1M: 2.5 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075, cacheWritePer1M: 0.15 },
    'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0, cacheReadPer1M: 0.31, cacheWritePer1M: 1.25 },
    'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3, cacheReadPer1M: 0.018, cacheWritePer1M: 0.075 },
    'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28, cacheReadPer1M: 0.014, cacheWritePer1M: 0.14 }
  },
  default: { inputPer1M: 1.0, outputPer1M: 3.0, cacheReadPer1M: 0.25, cacheWritePer1M: 1.0 }
};

export interface DailyRollup {
  date: string; // YYYY-MM-DD
  recordsCount: number;
  totals: {
    input: number;
    output: number;
    cachedInput: number;
    costUsd: number;
  };
  byProvider: Record<string, { requests: number; input: number; output: number; costUsd: number }>;
  byModel: Record<string, { requests: number; input: number; output: number; costUsd: number }>;
  byMode: Record<string, { requests: number; tokens: number }>;
  byRole: Record<string, { requests: number; tokens: number; costUsd: number }>;
  byLayerKind: Record<string, { tokens: number }>;
  hourlyBuckets: Record<string, { input: number; output: number; cachedInput: number; costUsd: number }>;
}

export class UsageLedger extends EventEmitter {
  private baseDir: string;
  private pricing: PricingConfig = DEFAULT_PRICING;
  private buffer: Array<Omit<TokenAccountingRecord, 'recordHash' | 'prevHash'>> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastKnownHashByMonth: Map<string, string> = new Map();
  private dailyRollups: Map<string, DailyRollup> = new Map();
  private isFlushing = false;
  private hopProvider: ((taskId: string) => Array<{ hop: 'H1' | 'H2' | 'H3' | 'H4' | 'H5'; latencyMs: number }>) | null = null;

  constructor(customBaseDir?: string) {
    super();
    this.baseDir = customBaseDir || path.join(os.homedir(), '.tycode', 'ledger');
    this.loadPricing();
  }

  public registerHopProvider(provider: (taskId: string) => Array<{ hop: 'H1' | 'H2' | 'H3' | 'H4' | 'H5'; latencyMs: number }>): void {
    this.hopProvider = provider;
  }

  public setBaseDir(dir: string): void {
    this.baseDir = dir;
    this.lastKnownHashByMonth.clear();
    this.dailyRollups.clear();
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  private loadPricing(): void {
    try {
      const candidates = [
        path.resolve(__dirname, '../../../resources/pricing/model-pricing.json'),
        path.resolve(process.cwd(), 'resources/pricing/model-pricing.json'),
        path.join(this.baseDir, 'model-pricing.json')
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          this.pricing = JSON.parse(raw);
          return;
        }
      }
    } catch {
      this.pricing = DEFAULT_PRICING;
    }
  }

  /**
   * Calculates cost in USD for token consumption.
   * Billing of 'free-tier' or 'local' always returns 0.
   */
  public computeCost(
    provider: string,
    model: string,
    billing: BillingTier,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens = 0
  ): { currency: 'USD'; amount: number } {
    if (billing === 'free-tier' || billing === 'local') {
      return { currency: 'USD', amount: 0 };
    }

    const normModel = model.toLowerCase();
    const rate =
      this.pricing.rates[normModel] ||
      Object.entries(this.pricing.rates).find(([k]) => normModel.includes(k))?.[1] ||
      this.pricing.default;

    const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
    const inputCost = (uncachedInput / 1_000_000) * rate.inputPer1M;
    const cachedCost = (cachedInputTokens / 1_000_000) * (rate.cacheReadPer1M ?? rate.inputPer1M * 0.1);
    const outputCost = (outputTokens / 1_000_000) * rate.outputPer1M;

    const total = Math.max(0, inputCost + cachedCost + outputCost);
    return { currency: 'USD', amount: Number(total.toFixed(6)) };
  }

  /**
   * Helper returning calculated cost amount as a number.
   */
  public calculateCost(
    provider: string,
    model: string,
    totals: { input: number; output: number; cachedInput?: number },
    billing: BillingTier = 'metered'
  ): number {
    return this.computeCost(
      provider,
      model,
      billing,
      totals.input,
      totals.output,
      totals.cachedInput ?? 0
    ).amount;
  }

  /**
   * Appends an accounting event into the buffer and schedules async flush.
   */
  public record(params: {
    sessionId: string;
    taskId: string;
    provider: string;
    model: string;
    billing?: BillingTier;
    phase: AccountingPhase;
    layers: LayerToken[];
    totals: { input: number; output: number; cachedInput?: number };
    hops?: Array<{ hop: 'H1' | 'H2' | 'H3' | 'H4' | 'H5'; latencyMs: number }>;
    policyAudit?: { action: string; allowed: boolean; reason?: string; org?: string };
    ts?: string;
  }): void {
    const ts = params.ts || new Date().toISOString();
    const billing = params.billing || 'metered';
    const cachedInput = params.totals.cachedInput || 0;
    const cost = this.computeCost(
      params.provider,
      params.model,
      billing,
      params.totals.input,
      params.totals.output,
      cachedInput
    );

    const partialRecord: Omit<TokenAccountingRecord, 'recordHash' | 'prevHash'> = {
      id: crypto.randomUUID(),
      ts,
      sessionId: params.sessionId,
      taskId: params.taskId,
      provider: params.provider,
      model: params.model,
      billing,
      phase: params.phase,
      layers: params.layers,
      totals: {
        input: params.totals.input,
        output: params.totals.output,
        cachedInput
      },
      ...(params.hops ? { hops: params.hops } : {}),
      cost,
      ...(params.policyAudit ? { policyAudit: params.policyAudit } : {})
    };

    this.buffer.push(partialRecord);
    this.updateInMemoryRollup(partialRecord);

    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, FLUSH_DEBOUNCE_MS);
    }
  }

  /**
   * Updates in-memory rollup statistics for real-time querying.
   */
  private updateInMemoryRollup(rec: Omit<TokenAccountingRecord, 'recordHash' | 'prevHash'>): void {
    const dateStr = rec.ts.slice(0, 10); // YYYY-MM-DD
    const hourStr = rec.ts.slice(11, 13); // HH

    let rollup = this.dailyRollups.get(dateStr);
    if (!rollup) {
      rollup = {
        date: dateStr,
        recordsCount: 0,
        totals: { input: 0, output: 0, cachedInput: 0, costUsd: 0 },
        byProvider: {},
        byModel: {},
        byMode: {},
        byRole: {},
        byLayerKind: {},
        hourlyBuckets: {}
      };
      this.dailyRollups.set(dateStr, rollup);
    }

    rollup.recordsCount++;
    rollup.totals.input += rec.totals.input;
    rollup.totals.output += rec.totals.output;
    rollup.totals.cachedInput += rec.totals.cachedInput;
    rollup.totals.costUsd += rec.cost?.amount || 0;

    // Provider
    if (!rollup.byProvider[rec.provider]) {
      rollup.byProvider[rec.provider] = { requests: 0, input: 0, output: 0, costUsd: 0 };
    }
    const pEntry = rollup.byProvider[rec.provider];
    pEntry.requests++;
    pEntry.input += rec.totals.input;
    pEntry.output += rec.totals.output;
    pEntry.costUsd += rec.cost?.amount || 0;

    // Model
    if (!rollup.byModel[rec.model]) {
      rollup.byModel[rec.model] = { requests: 0, input: 0, output: 0, costUsd: 0 };
    }
    const mEntry = rollup.byModel[rec.model];
    mEntry.requests++;
    mEntry.input += rec.totals.input;
    mEntry.output += rec.totals.output;
    mEntry.costUsd += rec.cost?.amount || 0;

    // Hourly
    if (!rollup.hourlyBuckets[hourStr]) {
      rollup.hourlyBuckets[hourStr] = { input: 0, output: 0, cachedInput: 0, costUsd: 0 };
    }
    const hEntry = rollup.hourlyBuckets[hourStr];
    hEntry.input += rec.totals.input;
    hEntry.output += rec.totals.output;
    hEntry.cachedInput += rec.totals.cachedInput;
    hEntry.costUsd += rec.cost?.amount || 0;

    // Layers & roles
    for (const l of rec.layers) {
      if (!rollup.byLayerKind[l.kind]) {
        rollup.byLayerKind[l.kind] = { tokens: 0 };
      }
      rollup.byLayerKind[l.kind].tokens += l.tokens;

      if (l.name.startsWith('ROLE:')) {
        const roleName = l.name.slice(5);
        if (!rollup.byRole[roleName]) {
          rollup.byRole[roleName] = { requests: 0, tokens: 0, costUsd: 0 };
        }
        rollup.byRole[roleName].requests++;
        rollup.byRole[roleName].tokens += l.tokens;
        // Approximate role cost portion
        if (rec.totals.input > 0 && (rec.cost?.amount || 0) > 0) {
          const share = (l.tokens / rec.totals.input) * (rec.cost?.amount || 0);
          rollup.byRole[roleName].costUsd += share;
        }
      } else if (l.name.startsWith('MODE')) {
        const modeName = l.name;
        if (!rollup.byMode[modeName]) {
          rollup.byMode[modeName] = { requests: 0, tokens: 0 };
        }
        rollup.byMode[modeName].requests++;
        rollup.byMode[modeName].tokens += l.tokens;
      }
    }
  }

  /**
   * Retrieves the latest previous hash for a given monthly file.
   */
  private async getLatestHashForMonth(filePath: string, monthKey: string): Promise<string> {
    if (this.lastKnownHashByMonth.has(monthKey)) {
      return this.lastKnownHashByMonth.get(monthKey)!;
    }

    try {
      if (fs.existsSync(filePath)) {
        const content = await fsp.readFile(filePath, 'utf8');
        const lines = content.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          const parsed = JSON.parse(lastLine);
          if (parsed && typeof parsed.recordHash === 'string') {
            this.lastKnownHashByMonth.set(monthKey, parsed.recordHash);
            return parsed.recordHash;
          }
        }
      }
    } catch {
      // file empty or unreadable
    }

    this.lastKnownHashByMonth.set(monthKey, GENESIS_PREV_HASH);
    return GENESIS_PREV_HASH;
  }

  /**
   * Flushes all buffered accounting records to disk with tamper-evident hash chaining.
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) return;
    this.isFlushing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const itemsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      await fsp.mkdir(this.baseDir, { recursive: true });

      // Group by monthly file
      const byMonth = new Map<string, Array<Omit<TokenAccountingRecord, 'recordHash' | 'prevHash'>>>();
      for (const item of itemsToFlush) {
        const monthKey = item.ts.slice(0, 7); // YYYY-MM
        const list = byMonth.get(monthKey) || [];
        list.push(item);
        byMonth.set(monthKey, list);
      }

      for (const [monthKey, records] of byMonth.entries()) {
        const filePath = path.join(this.baseDir, `usage-${monthKey}.jsonl`);
        let prevHash = await this.getLatestHashForMonth(filePath, monthKey);

        const lines: string[] = [];
        for (const item of records) {
          if ((!item.hops || item.hops.length === 0) && this.hopProvider) {
            const hops = this.hopProvider(item.taskId);
            if (hops && hops.length > 0) {
              (item as any).hops = hops;
            }
          }
          const recordHash = computeRecordHash(prevHash, item);
          const fullRecord: TokenAccountingRecord = {
            ...item,
            prevHash,
            recordHash
          };
          // Validate schema
          TokenAccountingRecordSchema.parse(fullRecord);
          lines.push(JSON.stringify(fullRecord));
          prevHash = recordHash;
          this.emit('record', fullRecord);
        }

        this.lastKnownHashByMonth.set(monthKey, prevHash);
        await fsp.appendFile(filePath, lines.join('\n') + '\n', 'utf8');
      }

      // Persist daily rollup files for fast querying
      await this.persistDailyRollups();
    } catch (err) {
      // Re-queue items on failure so we don't lose accounting data
      this.buffer.unshift(...itemsToFlush);
      console.error('[UsageLedger] Error flushing usage ledger:', err);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Persists daily rollups to ~/.tycode/ledger/daily-YYYY-MM-DD.json
   */
  private async persistDailyRollups(): Promise<void> {
    try {
      for (const [dateStr, rollup] of this.dailyRollups.entries()) {
        const rollupPath = path.join(this.baseDir, `daily-${dateStr}.json`);
        await fsp.writeFile(rollupPath, JSON.stringify(rollup, null, 2), 'utf8');
      }
    } catch {
      // rollup persistence is best-effort
    }
  }

  /**
   * Returns daily rollup for a given date if present in memory or on disk.
   */
  public async getDailyRollup(dateStr: string): Promise<DailyRollup | null> {
    if (this.dailyRollups.has(dateStr)) {
      return this.dailyRollups.get(dateStr)!;
    }
    const rollupPath = path.join(this.baseDir, `daily-${dateStr}.json`);
    try {
      const raw = await fsp.readFile(rollupPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.dailyRollups.set(dateStr, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Reads raw records for a given month (YYYY-MM).
   */
  public async getMonthlyRecords(monthKey: string): Promise<TokenAccountingRecord[]> {
    await this.flush();
    const filePath = path.join(this.baseDir, `usage-${monthKey}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = await fsp.readFile(filePath, 'utf8');
      return content
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
}

// Global Singleton
export const usageLedger = new UsageLedger();
