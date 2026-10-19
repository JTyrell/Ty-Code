/**
 * Usage Analytics Service (Phase 6.5)
 *
 * Tracks granular request history, time-bucketed usage metrics (daily, weekly, monthly),
 * per-model consumption analytics, and generates intelligent, usage-pattern-driven
 * optimization recommendations.
 *
 * Brand: Ty-Code
 */

import type {
  RecentActivityRecord,
  HistoricalUsageBucket,
  ModelUsageStat,
  OptimizationRecommendation,
  ProviderDashboardData,
  ProviderComparisonMetric
} from '../../../shared/types/quota-dashboard';
import { quotaTracker } from './quota-tracker';
import { healthMonitor } from '../providers/health-monitor';
import { PERMANENT_FREE_PROVIDERS, freeProviderRegistry } from '../providers/free-provider-registry';
import { usageLedger } from '../usage/ledger';

export class UsageAnalyticsService {
  private static instance: UsageAnalyticsService | null = null;
  private recentActivity: RecentActivityRecord[] = [];
  private dismissedRecommendations = new Set<string>();

  public static getInstance(): UsageAnalyticsService {
    if (!UsageAnalyticsService.instance) {
      UsageAnalyticsService.instance = new UsageAnalyticsService();
    }
    return UsageAnalyticsService.instance;
  }

  constructor() {
    // Zero-server architecture: relies directly on real usageLedger transactions
  }


  private seedInitialAnalyticsData(): void {
    // RealConnect 2: relies directly on real usageLedger transactions
  }

  /**
   * Records a completed model execution into telemetry
   */
  public recordActivity(record: Omit<RecentActivityRecord, 'id' | 'timestamp'>): RecentActivityRecord {
    const fullRecord: RecentActivityRecord = {
      ...record,
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now()
    };

    this.recentActivity.unshift(fullRecord);
    if (this.recentActivity.length > 100) {
      this.recentActivity.pop();
    }

    // Also update quota tracker
    quotaTracker.recordUsage(
      record.providerId,
      record.modelId,
      { totalTokens: record.totalTokens, promptTokens: record.promptTokens, completionTokens: record.completionTokens },
      record.status !== 'error',
      record.latencyMs
    );

    return fullRecord;
  }

  /**
   * Gets recent activity records (default 10)
   */
  public getRecentActivity(limit = 10): RecentActivityRecord[] {
    const ledgerTx = usageLedger.getSnapshot().recentTransactions || [];
    const fromLedger: RecentActivityRecord[] = ledgerTx.slice(-limit).reverse().map((tx) => ({
      id: tx.id,
      timestamp: tx.timestamp,
      providerId: tx.providerId,
      providerName: tx.providerId,
      modelId: tx.modelId,
      modelName: tx.modelId,
      taskType: 'code_generation',
      promptTokens: tx.promptTokens,
      completionTokens: tx.completionTokens,
      totalTokens: tx.totalTokens,
      latencyMs: tx.latencyMs,
      status: tx.success ? 'success' : 'error',
      costSavedUsd: tx.costSavedUsd
    }));
    return [...this.recentActivity, ...fromLedger].slice(0, limit);
  }

  /**
   * Generates time-bucketed historical usage charts (Daily, Weekly, Monthly) from real ledger
   */
  public getHistoricalUsage(): {
    daily: HistoricalUsageBucket[];
    weekly: HistoricalUsageBucket[];
    monthly: HistoricalUsageBucket[];
  } {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const ledger = usageLedger.getSnapshot();
    const transactions = ledger.recentTransactions || [];

    // Daily buckets (last 14 days)
    const daily: HistoricalUsageBucket[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = now - (i + 1) * oneDay;
      const dayEnd = now - i * oneDay;
      const d = new Date(dayEnd);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;

      const dayTxs = transactions.filter((t) => t.timestamp >= dayStart && t.timestamp < dayEnd);
      const tokens = dayTxs.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
      const requests = dayTxs.length;
      const costSavedUsd = Math.round(dayTxs.reduce((sum, t) => sum + (t.costSavedUsd || 0), 0) * 100) / 100;
      const byProvider: Record<string, number> = {};
      for (const t of dayTxs) {
        byProvider[t.providerId] = (byProvider[t.providerId] || 0) + (t.totalTokens || 0);
      }

      daily.push({
        timestamp: dayEnd,
        dateLabel: label,
        tokens,
        requests,
        costSavedUsd,
        byProvider
      });
    }

    // Weekly buckets (last 8 weeks)
    const weekly: HistoricalUsageBucket[] = [];
    for (let w = 7; w >= 0; w--) {
      const weekStart = now - (w + 1) * 7 * oneDay;
      const weekEnd = now - w * 7 * oneDay;
      const d = new Date(weekEnd);
      const label = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString('default', { month: 'short' })}`;

      const weekTxs = transactions.filter((t) => t.timestamp >= weekStart && t.timestamp < weekEnd);
      const tokens = weekTxs.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
      const requests = weekTxs.length;
      const costSavedUsd = Math.round(weekTxs.reduce((sum, t) => sum + (t.costSavedUsd || 0), 0) * 100) / 100;
      const byProvider: Record<string, number> = {};
      for (const t of weekTxs) {
        byProvider[t.providerId] = (byProvider[t.providerId] || 0) + (t.totalTokens || 0);
      }

      weekly.push({
        timestamp: weekEnd,
        dateLabel: label,
        tokens,
        requests,
        costSavedUsd,
        byProvider
      });
    }

    // Monthly buckets (last 6 months)
    const monthly: HistoricalUsageBucket[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let m = 5; m >= 0; m--) {
      const monthStart = now - (m + 1) * 30 * oneDay;
      const monthEnd = now - m * 30 * oneDay;
      const d = new Date(monthEnd);
      const label = monthNames[d.getMonth()] || `M${d.getMonth() + 1}`;

      const monthTxs = transactions.filter((t) => t.timestamp >= monthStart && t.timestamp < monthEnd);
      const tokens = monthTxs.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
      const requests = monthTxs.length;
      const costSavedUsd = Math.round(monthTxs.reduce((sum, t) => sum + (t.costSavedUsd || 0), 0) * 100) / 100;
      const byProvider: Record<string, number> = {};
      for (const t of monthTxs) {
        byProvider[t.providerId] = (byProvider[t.providerId] || 0) + (t.totalTokens || 0);
      }

      monthly.push({
        timestamp: monthEnd,
        dateLabel: label,
        tokens,
        requests,
        costSavedUsd,
        byProvider
      });
    }

    return { daily, weekly, monthly };
  }

  /**
   * Aggregates consumption metrics per model from real ledger counters
   */
  public getModelUsageBreakdown(): ModelUsageStat[] {
    const ledger = usageLedger.getSnapshot();
    const counters = ledger.providerCounters || {};
    const rawCounts: Record<string, { modelName: string; providerId: string; providerName: string; tokens: number; requests: number; totalLatency: number }> = {};

    for (const counter of Object.values(counters)) {
      rawCounts[counter.modelId] = {
        modelName: counter.modelId,
        providerId: counter.providerId,
        providerName: counter.providerId,
        tokens: counter.totalTokens,
        requests: counter.requests,
        totalLatency: counter.totalLatencyMs
      };
    }

    // Incorporate recent live activity records
    for (const act of this.recentActivity) {
      if (!rawCounts[act.modelId]) {
        rawCounts[act.modelId] = {
          modelName: act.modelName,
          providerId: act.providerId,
          providerName: act.providerName,
          tokens: 0,
          requests: 0,
          totalLatency: 0
        };
      }
      rawCounts[act.modelId].tokens += act.totalTokens;
      rawCounts[act.modelId].requests += 1;
      rawCounts[act.modelId].totalLatency += act.latencyMs;
    }

    const totalTokensAll = Object.values(rawCounts).reduce((acc, curr) => acc + curr.tokens, 0);

    const stats: ModelUsageStat[] = Object.entries(rawCounts).map(([modelId, data]) => ({
      modelId,
      modelName: data.modelName,
      providerId: data.providerId,
      providerName: data.providerName,
      tokensConsumed: data.tokens,
      requestCount: data.requests,
      avgLatencyMs: Math.round(data.totalLatency / Math.max(1, data.requests)),
      percentage: totalTokensAll > 0 ? Math.round((data.tokens / totalTokensAll) * 1000) / 10 : 0
    }));

    stats.sort((a, b) => b.tokensConsumed - a.tokensConsumed);
    return stats;
  }

  /**
   * Generates intelligent, dynamic optimization recommendations
   */
  public getRecommendations(): OptimizationRecommendation[] {
    const list: OptimizationRecommendation[] = [];
    const modelStats = this.getModelUsageBreakdown();
    const quotaSnapshot = quotaTracker.getSnapshot();

    // Recommendation 1: Frequent reasoning tasks -> suggest DeepSeek R1
    const reasoningActivity = this.recentActivity.filter((r) => r.taskType === 'complex_reasoning');
    const hasDeepSeek = this.recentActivity.some((r) => r.modelId.includes('deepseek-r1'));
    if (reasoningActivity.length >= 1) {
      list.push({
        id: 'rec_reasoning_deepseek',
        type: 'add_provider',
        title: 'High Reasoning Demand Detected',
        description: 'You use reasoning tasks frequently - consider adding DeepSeek R1 provider for math and complex planning.',
        priority: 'high',
        actionLabel: 'Configure DeepSeek R1',
        actionKey: 'open_settings_providers',
        targetProviderId: 'openrouter-free',
        targetModelId: 'kilo-auto/free',
        dismissed: this.dismissedRecommendations.has('rec_reasoning_deepseek')
      });
    }

    // Recommendation 2: Approaching Groq quota -> enable OpenKilo as backup
    const groqQuota = quotaSnapshot.providers['groq'] || quotaSnapshot.providers['groq-free'];
    const groqUsagePct = groqQuota ? groqQuota.percentUsed : 35;
    list.push({
      id: 'rec_groq_backup',
      type: 'backup_provider',
      title: 'Groq Rate-Limit Headroom Guard',
      description: "You're approaching Groq quota - enable OpenKilo as backup to avoid interruptions.",
      priority: groqUsagePct > 70 ? 'high' : 'medium',
      actionLabel: 'Enable OpenKilo Backup',
      actionKey: 'enable_openkilo',
      targetProviderId: 'openkilo',
      dismissed: this.dismissedRecommendations.has('rec_groq_backup')
    });

    // Recommendation 3: Pin most-used model
    if (modelStats.length > 0) {
      const topModel = modelStats[0];
      list.push({
        id: `rec_pin_${topModel.modelId}`,
        type: 'pin_model',
        title: `Pin Frequent Model (${topModel.modelName})`,
        description: `Your most-used model is ${topModel.modelName} (${topModel.percentage}% of tokens) - consider pinning it for faster access.`,
        priority: 'medium',
        actionLabel: `Pin ${topModel.modelName}`,
        actionKey: 'pin_model',
        targetModelId: topModel.modelId,
        dismissed: this.dismissedRecommendations.has(`rec_pin_${topModel.modelId}`)
      });
    }

    // Recommendation 4: Slow provider detection
    for (const [providerId, providerQuota] of Object.entries(quotaSnapshot.providers)) {
      if (providerQuota.healthStatus === 'cooling_down' || providerQuota.isRateLimited) {
        list.push({
          id: `rec_slow_${providerId}`,
          type: 'disable_slow',
          title: `Temporary Degradation: ${providerQuota.providerName}`,
          description: `Provider ${providerQuota.providerName} has been slow or cooling down - consider disabling it temporarily or letting router failover.`,
          priority: 'low',
          actionLabel: 'Inspect Health',
          actionKey: 'view_health',
          targetProviderId: providerId,
          dismissed: this.dismissedRecommendations.has(`rec_slow_${providerId}`)
        });
        break;
      }
    }

    return list.filter((r) => !r.dismissed);
  }

  /**
   * Dismisses an optimization recommendation by ID
   */
  public dismissRecommendation(id: string): boolean {
    this.dismissedRecommendations.add(id);
    return true;
  }

  /**
   * Returns side-by-side provider comparison matrix.
   * Values are derived from real sources: curated registries (model counts)
   * and the quota tracker (real recorded usage). Latency and success rate
   * report 0 = "not measured" — no fabricated telemetry is served.
   */
  public getProviderComparisons(): ProviderComparisonMetric[] {
    const snapshotProviders = quotaTracker.getSnapshot().providers;

    const descriptors: Array<{
      providerId: string;
      providerName: string;
      bestFor: string;
      ratingTier: ProviderComparisonMetric['ratingTier'];
      strengths: string[];
    }> = [
      {
        providerId: 'openrouter-free',
        providerName: 'OpenRouter Free',
        bestFor: 'Reasoning & Specialized Coding',
        ratingTier: 'S',
        strengths: ['DeepSeek R1 :free access', 'Qwen 2.5 Coder :free', 'No credit card required']
      },
      {
        providerId: 'groq-free',
        providerName: 'Groq Ultra-Fast',
        bestFor: 'Sub-100ms Ultra-Fast Responses',
        ratingTier: 'A',
        strengths: ['LPU hardware acceleration', 'Llama 3.3 70B at 300+ t/s', 'Zero inference overhead']
      },
      {
        providerId: 'openkilo',
        providerName: 'OpenKilo Gateway',
        bestFor: 'Gateway models via single free key',
        ratingTier: 'S',
        strengths: ['kilo-auto/free router', 'Large context free models', 'Single anonymous key']
      },
      {
        providerId: 'google-ai-studio-free',
        providerName: 'Google AI Studio',
        bestFor: 'Multimodal & Large Context',
        ratingTier: 'A',
        strengths: ['Gemini 2.0 Flash', 'Large context window', 'Native vision & audio support']
      },
      {
        providerId: 'github-models-free',
        providerName: 'GitHub Models',
        bestFor: 'Standard GitHub-hosted Models',
        ratingTier: 'B',
        strengths: ['Direct GitHub PAT authentication', 'High enterprise availability', 'Official Azure endpoint']
      },
      {
        providerId: 'fcc-proxy',
        providerName: 'FCC Free-Claude-Code Proxy',
        bestFor: 'Community-subsidized Claude access',
        ratingTier: 'A',
        strengths: ['Community token pool', 'Claude 3.5 Sonnet proxy', 'Local sidecar architecture']
      }
    ];

    return descriptors.map((desc) => {
      const reg = freeProviderRegistry.getProvider(desc.providerId);
      const q = snapshotProviders[desc.providerId];
      const realFreeModels = reg
        ? reg.best_free_models.filter((m) => !m.startsWith('All free models'))
        : [];
      return {
        providerId: desc.providerId,
        providerName: desc.providerName,
        freeModelCount: realFreeModels.length,
        totalTokensAvailable: q?.monthlyFreeTokens ?? 0,
        averageLatencyMs: 0, // not measured until FCC probe sync runs; 0 = no data
        successRate: 0, // no fabricated telemetry; 0 = no data
        bestFor: desc.bestFor,
        ratingTier: desc.ratingTier,
        strengths: desc.strengths
      };
    });
  }

  /**
   * Builds the comprehensive unified provider dashboard payload
   */
  public getDashboardData(): ProviderDashboardData {
    const quotaSnapshot = quotaTracker.getSnapshot();
    const comparisons = this.getProviderComparisons();
    const history = this.getHistoricalUsage();
    const modelBreakdown = this.getModelUsageBreakdown();
    const recommendations = this.getRecommendations();
    const recentActivity = this.getRecentActivity(10);

    // Real last-activity per provider derived from the usage ledger
    const ledgerTx = usageLedger.getSnapshot().recentTransactions || [];
    const lastActiveByProvider = new Map<string, number>();
    for (const tx of ledgerTx) {
      const prev = lastActiveByProvider.get(tx.providerId);
      if (!prev || tx.timestamp > prev) {
        lastActiveByProvider.set(tx.providerId, tx.timestamp);
      }
    }

    // Build ConnectedProviderInfo[] — all values derive from real sources;
    // zero means "no data", never a fabricated figure.
    const connectedProviders = comparisons.map((comp) => {
      const q = quotaSnapshot.providers[comp.providerId] || quotaSnapshot.providers[comp.providerId.replace('-free', '')];
      const reg = freeProviderRegistry.getProvider(comp.providerId);
      const realFreeModels = reg
        ? reg.best_free_models.filter((m) => !m.startsWith('All free models'))
        : [];
      const monthlyQuotaTokens = q?.monthlyFreeTokens ?? 0;
      const consumedTokens = q?.consumedTokens ?? 0;
      const remainingTokens = Math.max(0, monthlyQuotaTokens - consumedTokens);
      const percentUsed = monthlyQuotaTokens > 0
        ? Math.min(100, Math.round((consumedTokens / monthlyQuotaTokens) * 1000) / 10)
        : 0;
      const isRateLimited = q?.isRateLimited ?? false;
      const status = isRateLimited
        ? 'rate_limited'
        : q
          ? 'connected'
          : 'offline';

      return {
        id: comp.providerId,
        name: comp.providerName,
        category: comp.providerId.includes('openkilo') || comp.providerId.includes('fcc')
          ? ('free_aggregator' as const)
          : ('free_direct' as const),
        status: status as any,
        freeModelCount: realFreeModels.length,
        freeModels: realFreeModels.slice(0, 3),
        latencyMs: comp.averageLatencyMs,
        successRate: comp.successRate,
        totalRequests: q?.requestsCount ?? 0,
        monthlyQuotaTokens,
        dailyQuotaTokens: Math.round(monthlyQuotaTokens / 30),
        consumedTokens,
        consumedTokensToday: 0, // daily consumption is not tracked per-provider; 0 = no data
        remainingTokens,
        percentUsed,
        bestFor: comp.bestFor,
        healthScore: isRateLimited ? 0.3 : q ? 1.0 : 0.5,
        isRateLimited,
        lastActiveTimestamp: lastActiveByProvider.get(comp.providerId) ?? 0
      };
    });

    // Summary calculations
    const totalFreeTokensMonthly = connectedProviders.reduce((acc, p) => acc + p.monthlyQuotaTokens, 0);
    const totalTokensConsumedMonthly = connectedProviders.reduce((acc, p) => acc + p.consumedTokens, 0);
    const totalTokensConsumedToday = connectedProviders.reduce((acc, p) => acc + p.consumedTokensToday, 0);
    const totalFreeTokensDailyLimit = Math.round(totalFreeTokensMonthly / 30);
    const totalRemainingTokensMonthly = Math.max(0, totalFreeTokensMonthly - totalTokensConsumedMonthly);
    const totalEstimatedSavingsUsd = Math.round((totalTokensConsumedMonthly / 1_000_000) * 3.0 * 100) / 100;
    const totalFreeModelsAvailable = connectedProviders.reduce((acc, p) => acc + p.freeModelCount, 0);

    const alerts = (quotaSnapshot.recentAlerts || []).map((a) => ({
      id: a.id,
      providerId: a.providerId,
      providerName: quotaSnapshot.providers[a.providerId]?.providerName || a.providerId,
      message: a.message,
      severity: a.severity,
      timestamp: a.timestamp,
      percentUsed: quotaSnapshot.providers[a.providerId]?.percentUsed || 85
    }));

    return {
      providers: connectedProviders,
      summary: {
        totalFreeTokensMonthly,
        totalFreeTokensDailyLimit,
        totalTokensConsumedMonthly,
        totalTokensConsumedToday,
        totalRemainingTokensMonthly,
        totalEstimatedSavingsUsd,
        activeFreeProvidersCount: connectedProviders.filter((p) => p.status === 'connected').length,
        totalFreeModelsAvailable
      },
      recentActivity,
      historyDaily: history.daily,
      historyWeekly: history.weekly,
      historyMonthly: history.monthly,
      modelBreakdown,
      recommendations,
      comparisons,
      alerts
    };
  }
}

export const usageAnalytics = UsageAnalyticsService.getInstance();
