/**
 * OmniRoute Connection Pool & Health Monitoring
 * Features:
 * - Ping providers every 30s
 * - Health scoring (latency, success rate, quota/cooldown)
 * - Cooldown management with exponential backoff for rate-limited providers
 * - Real-time availability tracking for request-level routing
 */

import { providerRegistry, type ProviderMetadata } from './provider-registry';

export interface ProviderStats {
  providerId: string;
  latencyMs: number;
  rollingLatencies: number[];
  successRate: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  consecutiveFailures: number;
  lastChecked: number;
  lastPingSuccess: boolean;
  isHealthy: boolean;
  cooldownUntil: number;
  isCoolingDown: boolean;
  healthScore: number;
  lastErrorMessage?: string;
}

export type PingExecutorFn = (
  providerId: string,
  endpoint: string,
  apiKey?: string
) => Promise<{ success: boolean; latencyMs: number; error?: string }>;

export class ConnectionPool {
  private stats = new Map<string, ProviderStats>();
  private monitorTimer: NodeJS.Timeout | null = null;
  private customPingExecutor: PingExecutorFn | null = null;
  private monitoredProviderIds = new Set<string>();

  constructor() {
    this.initializeDefaultStats();
  }

  private initializeDefaultStats(): void {
    const allProviders = providerRegistry.getAllProviders();
    for (const p of allProviders) {
      this.initProviderStats(p.id);
    }
  }

  public initProviderStats(providerId: string): ProviderStats {
    let existing = this.stats.get(providerId);
    if (!existing) {
      existing = {
        providerId,
        latencyMs: 150,
        rollingLatencies: [150],
        successRate: 1.0,
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        consecutiveFailures: 0,
        lastChecked: Date.now(),
        lastPingSuccess: true,
        isHealthy: true,
        cooldownUntil: 0,
        isCoolingDown: false,
        healthScore: 85
      };
      this.stats.set(providerId, existing);
    }
    return existing;
  }

  public setCustomPingExecutor(executor: PingExecutorFn | null): void {
    this.customPingExecutor = executor;
  }

  public registerMonitoredProvider(providerId: string): void {
    this.monitoredProviderIds.add(providerId);
    this.initProviderStats(providerId);
  }

  public unregisterMonitoredProvider(providerId: string): void {
    this.monitoredProviderIds.delete(providerId);
  }

  public startMonitoring(intervalMs = 30_000): void {
    this.stopMonitoring();
    this.monitorTimer = setInterval(() => {
      void this.pingAllMonitored();
    }, intervalMs);
    if (this.monitorTimer.unref) {
      this.monitorTimer.unref();
    }
  }

  public stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  public isMonitoring(): boolean {
    return this.monitorTimer !== null;
  }

  public async pingAllMonitored(
    endpoints?: Partial<Record<string, string>>,
    apiKeys?: Partial<Record<string, string>>
  ): Promise<Record<string, { success: boolean; latencyMs: number }>> {
    const results: Record<string, { success: boolean; latencyMs: number }> = {};
    const idsToPing = this.monitoredProviderIds.size > 0
      ? Array.from(this.monitoredProviderIds)
      : ['openrouter', 'groq', 'deepseek', 'ollama'];

    for (const id of idsToPing) {
      const endpoint = endpoints?.[id];
      const apiKey = apiKeys?.[id];
      const res = await this.pingProvider(id, endpoint, apiKey);
      results[id] = { success: res.success, latencyMs: res.latencyMs };
    }
    return results;
  }

  public async pingProvider(
    providerId: string,
    customEndpoint?: string,
    apiKey?: string
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const provider = providerRegistry.getProvider(providerId);
    const endpoint = customEndpoint || provider?.defaultEndpoint || '';

    if (this.customPingExecutor) {
      try {
        const start = Date.now();
        const res = await this.customPingExecutor(providerId, endpoint, apiKey);
        if (res.success) {
          this.recordSuccess(providerId, res.latencyMs);
        } else {
          this.recordFailure(providerId, res.error || 'Health check failed');
        }
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.recordFailure(providerId, msg);
        return { success: false, latencyMs: 9999, error: msg };
      }
    }

    const start = Date.now();
    try {
      const checkUrl = provider?.healthCheckEndpoint || `${endpoint.replace(/\/+$/, '')}/models`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(checkUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latencyMs = Math.max(1, Date.now() - start);
      if (res.ok || res.status === 401 || res.status === 403) {
        // 401/403 means server is up and responsive to auth
        this.recordSuccess(providerId, latencyMs);
        return { success: true, latencyMs };
      } else {
        const err = `Ping failed with HTTP ${res.status}`;
        this.recordFailure(providerId, err, res.status);
        return { success: false, latencyMs, error: err };
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.recordFailure(providerId, msg);
      return { success: false, latencyMs, error: msg };
    }
  }

  public recordSuccess(providerId: string, latencyMs: number): void {
    const s = this.initProviderStats(providerId);
    s.totalRequests++;
    s.successfulRequests++;
    s.consecutiveFailures = 0;
    s.cooldownUntil = 0;
    s.isCoolingDown = false;
    s.lastPingSuccess = true;
    s.isHealthy = true;
    s.lastChecked = Date.now();
    delete s.lastErrorMessage;

    // Rolling latency window (up to 10 entries)
    s.rollingLatencies.push(latencyMs);
    if (s.rollingLatencies.length > 10) s.rollingLatencies.shift();
    const sum = s.rollingLatencies.reduce((a, b) => a + b, 0);
    s.latencyMs = Math.round(sum / s.rollingLatencies.length);

    s.successRate = Number((s.successfulRequests / s.totalRequests).toFixed(3));
    s.healthScore = this.calculateHealthScore(s);
  }

  public recordFailure(providerId: string, error: unknown, statusCode?: number): void {
    const s = this.initProviderStats(providerId);
    s.totalRequests++;
    s.failedRequests++;
    s.consecutiveFailures++;
    s.lastPingSuccess = false;
    s.lastChecked = Date.now();

    const errorMsg = error instanceof Error ? error.message : String(error);
    s.lastErrorMessage = errorMsg;

    const provider = providerRegistry.getProvider(providerId);
    const isRateLimited =
      statusCode === 429 ||
      /rate limit|429|quota exceeded|too many requests|tokens per minute/i.test(errorMsg);

    const baseMs = provider?.rateLimitPattern?.cooldownBaseMs ?? 5000;
    const maxMs = provider?.rateLimitPattern?.maxCooldownMs ?? 180_000;

    if (isRateLimited) {
      // Exponential backoff
      const exponent = Math.max(0, s.consecutiveFailures - 1);
      const backoffMs = Math.min(maxMs, baseMs * Math.pow(2, exponent));
      s.cooldownUntil = Date.now() + backoffMs;
      s.isCoolingDown = true;
    } else if (s.consecutiveFailures >= 2) {
      // General failure cooldown (10 seconds)
      s.cooldownUntil = Date.now() + Math.min(maxMs, 10_000 * s.consecutiveFailures);
      s.isCoolingDown = true;
      s.isHealthy = false;
    }

    s.successRate = Number((s.successfulRequests / s.totalRequests).toFixed(3));
    s.healthScore = this.calculateHealthScore(s);
  }

  public isAvailable(providerId: string): boolean {
    const s = this.stats.get(providerId);
    if (!s) return true;
    if (s.cooldownUntil > 0 && Date.now() < s.cooldownUntil) {
      s.isCoolingDown = true;
      return false;
    }
    s.isCoolingDown = false;
    return s.isHealthy;
  }

  public getHealthScore(providerId: string): number {
    const s = this.stats.get(providerId);
    if (!s) return 80;
    return this.calculateHealthScore(s);
  }

  private calculateHealthScore(s: ProviderStats): number {
    const now = Date.now();
    const isCooling = s.cooldownUntil > 0 && now < s.cooldownUntil;
    s.isCoolingDown = isCooling;
    if (isCooling) return 0;

    // Up to 50 points from success rate
    const successPoints = Math.round(s.successRate * 50);

    // Up to 30 points from latency (0-100ms = 30pts, 1000ms+ = 0pts)
    const normalizedLatency = Math.max(0, Math.min(1000, s.latencyMs));
    const latencyPoints = Math.round(30 * (1 - normalizedLatency / 1000));

    // Up to 20 points for health & ping success
    const healthBonus = s.isHealthy && s.lastPingSuccess ? 20 : s.isHealthy ? 10 : 0;

    return Math.max(0, Math.min(100, successPoints + latencyPoints + healthBonus));
  }

  public getStats(providerId: string): ProviderStats | undefined {
    const s = this.stats.get(providerId);
    if (s) {
      s.isCoolingDown = s.cooldownUntil > 0 && Date.now() < s.cooldownUntil;
      s.healthScore = this.calculateHealthScore(s);
    }
    return s;
  }

  public getAllStats(): Record<string, ProviderStats> {
    const result: Record<string, ProviderStats> = {};
    for (const [id, stat] of this.stats.entries()) {
      stat.isCoolingDown = stat.cooldownUntil > 0 && Date.now() < stat.cooldownUntil;
      stat.healthScore = this.calculateHealthScore(stat);
      result[id] = { ...stat };
    }
    return result;
  }

  public resetStats(providerId?: string): void {
    if (providerId) {
      this.stats.delete(providerId);
      this.initProviderStats(providerId);
    } else {
      this.stats.clear();
      this.initializeDefaultStats();
    }
  }
}

export const connectionPool = new ConnectionPool();
