/**
 * Unified Provider Dashboard & Quota Management Types (Phase 6.5)
 *
 * Comprehensive contracts for connected providers, real-time health,
 * daily/monthly quota tracking, usage analytics, provider comparisons,
 * and AI-driven optimization recommendations.
 *
 * Brand: Ty-Code
 */

export type ProviderConnectionStatus = 'connected' | 'rate_limited' | 'degraded' | 'offline';

export type ProviderCategory = 'free_aggregator' | 'free_direct' | 'byok_custom' | 'local';

export interface ConnectedProviderInfo {
  id: string;
  name: string;
  category: ProviderCategory;
  status: ProviderConnectionStatus;
  freeModelCount: number;
  freeModels: string[];
  latencyMs: number;
  successRate: number; // 0-100
  totalRequests: number;
  monthlyQuotaTokens: number;
  dailyQuotaTokens: number;
  consumedTokens: number;
  consumedTokensToday: number;
  remainingTokens: number;
  percentUsed: number;
  bestFor: string;
  healthScore: number; // 0.0 - 1.0
  isRateLimited: boolean;
  lastActiveTimestamp: number;
}

export interface FreeTierSummary {
  totalFreeTokensMonthly: number;
  totalFreeTokensDailyLimit: number;
  totalTokensConsumedMonthly: number;
  totalTokensConsumedToday: number;
  totalRemainingTokensMonthly: number;
  totalEstimatedSavingsUsd: number;
  activeFreeProvidersCount: number;
  totalFreeModelsAvailable: number;
}

export interface RecentActivityRecord {
  id: string;
  timestamp: number;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: 'success' | 'failover' | 'error';
  costSavedUsd: number;
}

export interface HistoricalUsageBucket {
  timestamp: number;
  dateLabel: string;
  tokens: number;
  requests: number;
  costSavedUsd: number;
  byProvider: Record<string, number>;
}

export interface ModelUsageStat {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  tokensConsumed: number;
  requestCount: number;
  avgLatencyMs: number;
  percentage: number;
}

export type RecommendationType =
  | 'add_provider'
  | 'backup_provider'
  | 'pin_model'
  | 'disable_slow'
  | 'quota_alert'
  | 'switch_tier';

export interface OptimizationRecommendation {
  id: string;
  type: RecommendationType;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  actionLabel: string;
  actionKey: string;
  targetProviderId?: string;
  targetModelId?: string;
  dismissed: boolean;
}

export interface ProviderComparisonMetric {
  providerId: string;
  providerName: string;
  freeModelCount: number;
  totalTokensAvailable: number;
  averageLatencyMs: number;
  successRate: number;
  bestFor: string;
  ratingTier: 'S' | 'A' | 'B' | 'C';
  strengths: string[];
}

export interface ProviderDashboardData {
  providers: ConnectedProviderInfo[];
  summary: FreeTierSummary;
  recentActivity: RecentActivityRecord[];
  historyDaily: HistoricalUsageBucket[];
  historyWeekly: HistoricalUsageBucket[];
  historyMonthly: HistoricalUsageBucket[];
  modelBreakdown: ModelUsageStat[];
  recommendations: OptimizationRecommendation[];
  comparisons: ProviderComparisonMetric[];
  alerts: QuotaAlertItem[];
}

export interface QuotaAlertItem {
  id: string;
  providerId: string;
  providerName: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  percentUsed: number;
}
