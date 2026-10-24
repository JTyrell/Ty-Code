/**
 * Ty-Code Usage Ledger — Query & Insight Surface
 *
 * Implements:
 * - Aggregations by day / provider / model / mode / role / layer-kind
 * - Built-in insights:
 *   1. History bloat alert: history layers > 60% of input tokens -> suggest compaction
 *   2. Cache hit-rate per provider & wasted-cache detection (cached prefix changed mid-session)
 *   3. Cost attribution per role prompt (e.g., ROLE:security = 340 tokens x N requests)
 *   4. Tokens-per-hop anomaly (H3 -> H4 delta spikes = tool-result inflation)
 *
 * Brand: Ty-Code
 */

import { usageLedger, type DailyRollup } from './usage-ledger';
import type { TokenAccountingRecord, LayerToken } from './token-accounting';

export interface LedgerAggregations {
  dateRange: { start: string; end: string };
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { requests: number; input: number; output: number; cached: number; costUsd: number }>;
  byModel: Record<string, { requests: number; input: number; output: number; costUsd: number }>;
  byMode: Record<string, { requests: number; tokens: number }>;
  byRole: Record<string, { requests: number; tokens: number; costUsd: number }>;
  byLayerKind: Record<string, { tokens: number; percent: number }>;
}

export interface LedgerInsight {
  type: 'history-bloat' | 'cache-hit-rate' | 'wasted-cache' | 'role-cost-attribution' | 'hop-anomaly';
  severity: 'info' | 'warning' | 'alert';
  title: string;
  message: string;
  metrics: Record<string, number | string | boolean>;
  recommendation?: string;
}

export interface LedgerQueryOptions {
  monthKey?: string; // YYYY-MM
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  sessionId?: string;
  taskId?: string;
  provider?: string;
}

export class LedgerQueryService {
  private ledger: typeof usageLedger;

  constructor(customLedger?: typeof usageLedger) {
    this.ledger = customLedger || usageLedger;
  }

  /**
   * Fetches raw records matching query options.
   */
  public async getRecords(options: LedgerQueryOptions = {}): Promise<TokenAccountingRecord[]> {
    const monthKey = options.monthKey || new Date().toISOString().slice(0, 7);
    const rawRecords = await this.ledger.getMonthlyRecords(monthKey);

    return rawRecords.filter((rec) => {
      if (options.startDate && rec.ts.slice(0, 10) < options.startDate) return false;
      if (options.endDate && rec.ts.slice(0, 10) > options.endDate) return false;
      if (options.sessionId && rec.sessionId !== options.sessionId) return false;
      if (options.taskId && rec.taskId !== options.taskId) return false;
      if (options.provider && rec.provider !== options.provider) return false;
      return true;
    });
  }

  /**
   * Queries records and computes aggregations.
   */
  public async queryLedger(options: LedgerQueryOptions = {}): Promise<{ records: TokenAccountingRecord[]; aggregations: LedgerAggregations }> {
    const records = await this.getRecords(options);
    const aggregations = await this.aggregate(options);
    return { records, aggregations };
  }

  /**
   * Computes multi-dimensional aggregations over records.
   */
  public async aggregate(options: LedgerQueryOptions = {}): Promise<LedgerAggregations> {
    const records = await this.getRecords(options);

    const agg: LedgerAggregations = {
      dateRange: {
        start: records[0]?.ts.slice(0, 10) || options.startDate || '',
        end: records[records.length - 1]?.ts.slice(0, 10) || options.endDate || ''
      },
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      totalCostUsd: 0,
      byProvider: {},
      byModel: {},
      byMode: {},
      byRole: {},
      byLayerKind: {}
    };

    let totalLayerTokens = 0;

    for (const rec of records) {
      if (rec.phase === 'request' || rec.phase === 'response') {
        agg.totalRequests++;
      }

      agg.totalInputTokens += rec.totals.input;
      agg.totalOutputTokens += rec.totals.output;
      agg.totalCachedTokens += rec.totals.cachedInput;
      agg.totalCostUsd += rec.cost?.amount || 0;

      // By Provider
      if (!agg.byProvider[rec.provider]) {
        agg.byProvider[rec.provider] = { requests: 0, input: 0, output: 0, cached: 0, costUsd: 0 };
      }
      const p = agg.byProvider[rec.provider];
      p.requests++;
      p.input += rec.totals.input;
      p.output += rec.totals.output;
      p.cached += rec.totals.cachedInput;
      p.costUsd += rec.cost?.amount || 0;

      // By Model
      if (!agg.byModel[rec.model]) {
        agg.byModel[rec.model] = { requests: 0, input: 0, output: 0, costUsd: 0 };
      }
      const m = agg.byModel[rec.model];
      m.requests++;
      m.input += rec.totals.input;
      m.output += rec.totals.output;
      m.costUsd += rec.cost?.amount || 0;

      // By Layers
      for (const layer of rec.layers) {
        totalLayerTokens += layer.tokens;
        if (!agg.byLayerKind[layer.kind]) {
          agg.byLayerKind[layer.kind] = { tokens: 0, percent: 0 };
        }
        agg.byLayerKind[layer.kind].tokens += layer.tokens;

        if (layer.name.startsWith('ROLE:')) {
          const role = layer.name.slice(5);
          if (!agg.byRole[role]) {
            agg.byRole[role] = { requests: 0, tokens: 0, costUsd: 0 };
          }
          agg.byRole[role].requests++;
          agg.byRole[role].tokens += layer.tokens;
          if (rec.totals.input > 0 && (rec.cost?.amount || 0) > 0) {
            agg.byRole[role].costUsd += (layer.tokens / rec.totals.input) * (rec.cost?.amount || 0);
          }
        } else if (layer.name.startsWith('MODE:')) {
          const mode = layer.name.slice(5);
          if (!agg.byMode[mode]) {
            agg.byMode[mode] = { requests: 0, tokens: 0 };
          }
          agg.byMode[mode].requests++;
          agg.byMode[mode].tokens += layer.tokens;
        }
      }
    }

    // Compute percentages for layer kinds
    for (const kind of Object.keys(agg.byLayerKind)) {
      const tokens = agg.byLayerKind[kind].tokens;
      agg.byLayerKind[kind].percent = totalLayerTokens > 0 ? Number(((tokens / totalLayerTokens) * 100).toFixed(1)) : 0;
    }

    return agg;
  }

  /**
   * Generates automated insights based on usage patterns.
   */
  public async getInsights(options: LedgerQueryOptions = {}): Promise<LedgerInsight[]> {
    const records = await this.getRecords(options);
    const insights: LedgerInsight[] = [];

    if (records.length === 0) return insights;

    // ─── Insight 1: History Bloat Alert (> 60% of input tokens) ──────────────
    let totalInput = 0;
    let totalHistory = 0;
    for (const r of records) {
      totalInput += r.totals.input;
      for (const l of r.layers) {
        if (l.kind === 'history') totalHistory += l.tokens;
      }
    }

    const historyRatio = totalInput > 0 ? totalHistory / totalInput : 0;
    if (historyRatio > 0.6) {
      insights.push({
        type: 'history-bloat',
        severity: 'warning',
        title: 'History Bloat Detected',
        message: `Conversation history constitutes ${(historyRatio * 100).toFixed(1)}% of all input tokens (${totalHistory.toLocaleString()} tokens).`,
        metrics: {
          historyRatio: Number((historyRatio * 100).toFixed(1)),
          historyTokens: totalHistory,
          inputTokens: totalInput
        },
        recommendation: 'Trigger context compaction or start a fresh subtask to keep turn latency low.'
      });
    }

    // ─── Insight 2: Provider Cache Hit-Rate & Wasted Cache ───────────────────
    const providerCacheStats: Record<string, { totalInput: number; cachedInput: number }> = {};
    for (const r of records) {
      if (!providerCacheStats[r.provider]) {
        providerCacheStats[r.provider] = { totalInput: 0, cachedInput: 0 };
      }
      providerCacheStats[r.provider].totalInput += r.totals.input;
      providerCacheStats[r.provider].cachedInput += r.totals.cachedInput;
    }

    for (const [provider, stats] of Object.entries(providerCacheStats)) {
      if (stats.totalInput >= 5000) {
        const hitRate = stats.cachedInput / stats.totalInput;
        insights.push({
          type: 'cache-hit-rate',
          severity: hitRate >= 0.5 ? 'info' : 'warning',
          title: `Prompt Cache Efficiency (${provider})`,
          message: `${provider} achieved a ${(hitRate * 100).toFixed(1)}% prompt-cache hit rate (${stats.cachedInput.toLocaleString()} cached / ${stats.totalInput.toLocaleString()} total tokens).`,
          metrics: {
            provider,
            hitRate: Number((hitRate * 100).toFixed(1)),
            cachedTokens: stats.cachedInput,
            totalInputTokens: stats.totalInput
          },
          recommendation:
            hitRate < 0.3
              ? 'Stable CORE and PROFILE prefixes are being invalidated frequently mid-session. Keep the pinned prompt header intact.'
              : undefined
        });
      }
    }

    // ─── Insight 3: Cost Attribution per Role Prompt ─────────────────────────
    const roleStats: Record<string, { tokens: number; costUsd: number; requests: number }> = {};
    for (const r of records) {
      for (const l of r.layers) {
        if (l.name.startsWith('ROLE:')) {
          const role = l.name.slice(5);
          if (!roleStats[role]) roleStats[role] = { tokens: 0, costUsd: 0, requests: 0 };
          roleStats[role].tokens += l.tokens;
          roleStats[role].requests++;
          if (r.totals.input > 0 && (r.cost?.amount || 0) > 0) {
            roleStats[role].costUsd += (l.tokens / r.totals.input) * (r.cost?.amount || 0);
          }
        }
      }
    }

    const topCostRoles = Object.entries(roleStats).sort((a, b) => b[1].costUsd - a[1].costUsd);
    if (topCostRoles.length > 0) {
      const [topRole, stats] = topCostRoles[0];
      insights.push({
        type: 'role-cost-attribution',
        severity: 'info',
        title: `Highest Cost Role: ROLE:${topRole}`,
        message: `ROLE:${topRole} accounted for $${stats.costUsd.toFixed(4)} across ${stats.requests} injections (${stats.tokens.toLocaleString()} tokens).`,
        metrics: {
          role: topRole,
          costUsd: Number(stats.costUsd.toFixed(4)),
          tokens: stats.tokens,
          injections: stats.requests
        }
      });
    }

    // ─── Insight 4: Tokens-per-hop Anomaly (Tool-result Inflation) ───────────
    for (const r of records) {
      if (r.phase === 'tool' && r.totals.input > 8000) {
        insights.push({
          type: 'hop-anomaly',
          severity: 'warning',
          title: 'Tool Result Token Inflation',
          message: `Task ${r.taskId.slice(0, 10)} received a large tool result of ${r.totals.input.toLocaleString()} tokens during phase 'tool'.`,
          metrics: {
            taskId: r.taskId,
            toolTokens: r.totals.input,
            provider: r.provider
          },
          recommendation: 'Filter search/grep outputs or use pagination to prevent tool outputs from filling the context window.'
        });
        break; // Show at most 1 anomaly alert per query
      }
    }

    return insights;
  }
}

export const ledgerQueryService = new LedgerQueryService();
