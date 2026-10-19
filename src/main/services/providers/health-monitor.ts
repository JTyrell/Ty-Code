/**
 * Provider Health Monitor (Phase 6.1)
 *
 * Monitors provider availability, tracks latency and success rates,
 * detects rate-limiting / cooldown periods, and automatically disables
 * failing endpoints to preserve seamless user experience.
 *
 * Brand: Ty-Code
 */

import type {
  FreeProviderId,
  ProviderHealthStatus
} from '../../../shared/types/free-providers';
import { freeProviderRegistry } from './free-provider-registry';
import { bootProfiler } from '../perf/boot-profiler';

export class ProviderHealthMonitor {
  private static instance: ProviderHealthMonitor;
  private readonly statuses: Map<string, ProviderHealthStatus> = new Map();
  private readonly consecutiveFailures: Map<string, number> = new Map();
  private monitorTimer: NodeJS.Timeout | null = null;
  private isMonitoringActive = false;

  private readonly failureThreshold = 3; // Auto-disable after 3 consecutive failures
  private readonly defaultCooldownMs = 60_000; // 60s default cooldown on 429 Rate Limit

  private constructor() {
    this.initializeStatuses();
  }

  public static getInstance(): ProviderHealthMonitor {
    if (!ProviderHealthMonitor.instance) {
      ProviderHealthMonitor.instance = new ProviderHealthMonitor();
    }
    return ProviderHealthMonitor.instance;
  }

  private initializeStatuses(): void {
    const providers = freeProviderRegistry.getAllProviders();
    for (const p of providers) {
      this.statuses.set(p.id, {
        providerId: p.id,
        isHealthy: true,
        lastChecked: 0,
        latencyMs: 0, // no fabricated warm baseline; measured on first real outcome
        successRate: 0, // 0 = no data until first probe/request
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        isRateLimited: false,
        autoDisabled: false
      });
      this.consecutiveFailures.set(p.id, 0);
    }
  }

  /**
   * Retrieves the current health status of a provider.
   */
  public getProviderHealth(providerId: string): ProviderHealthStatus {
    let status = this.statuses.get(providerId);
    if (!status) {
      status = {
        providerId,
        isHealthy: true,
        lastChecked: 0,
        latencyMs: 0, // no fabricated baseline
        successRate: 0, // 0 = no data
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        isRateLimited: false,
        autoDisabled: false
      };
      this.statuses.set(providerId, status);
    }

    // Check if cooldown has expired
    if (status.isRateLimited && status.cooldownUntil && Date.now() >= status.cooldownUntil) {
      status.isRateLimited = false;
      status.cooldownUntil = undefined;
    }

    return status;
  }

  /**
   * Returns a snapshot map of all provider health statuses.
   */
  public getAllHealthStatuses(): Record<string, ProviderHealthStatus> {
    const snapshot: Record<string, ProviderHealthStatus> = {};
    for (const [id, status] of this.statuses.entries()) {
      if (status.isRateLimited && status.cooldownUntil && Date.now() >= status.cooldownUntil) {
        status.isRateLimited = false;
        status.cooldownUntil = undefined;
      }
      snapshot[id] = { ...status };
    }
    return snapshot;
  }

  /**
   * Checks whether a provider is currently healthy, active, and out of cooldown.
   */
  public isProviderAvailable(providerId: string): boolean {
    const status = this.getProviderHealth(providerId);
    if (status.autoDisabled) return false;
    if (status.isRateLimited && status.cooldownUntil && Date.now() < status.cooldownUntil) {
      return false;
    }
    return status.isHealthy;
  }

  /**
   * Records the outcome of an actual API request to maintain real-time metrics.
   */
  public recordRequestOutcome(
    providerId: string,
    success: boolean,
    latencyMs: number,
    error?: string
  ): void {
    const status = this.getProviderHealth(providerId);
    status.lastChecked = Date.now();
    status.totalRequests++;

    if (success) {
      status.successfulRequests++;
      this.consecutiveFailures.set(providerId, 0);
      status.isHealthy = true;
      status.autoDisabled = false;
      // Seed exact first measurement; exponential moving average afterwards
      status.latencyMs = status.latencyMs === 0
        ? Math.max(1, latencyMs)
        : Math.round(status.latencyMs * 0.7 + latencyMs * 0.3);
    } else {
      status.failedRequests++;
      const currentFailures = (this.consecutiveFailures.get(providerId) || 0) + 1;
      this.consecutiveFailures.set(providerId, currentFailures);
      status.lastError = error || 'Request failed';

      // Auto-disable if consecutive failures exceed threshold
      if (currentFailures >= this.failureThreshold) {
        status.autoDisabled = true;
        status.isHealthy = false;
      }
    }

    status.successRate = status.totalRequests > 0
      ? Number((status.successfulRequests / status.totalRequests).toFixed(3))
      : 1.0;
  }

  /**
   * Convenience method to record a successful request.
   */
  public recordSuccess(providerId: string, latencyMs = 100): void {
    this.recordRequestOutcome(providerId, true, latencyMs);
  }

  /**
   * Convenience method to record a failed request.
   */
  public recordFailure(providerId: string, error?: string): void {
    this.recordRequestOutcome(providerId, false, 0, error);
  }

  /**
   * Puts a provider into temporary cooldown after a 429 Too Many Requests response.
   */
  public recordRateLimit(providerId: string, cooldownDurationMs = this.defaultCooldownMs): void {
    const status = this.getProviderHealth(providerId);
    status.isRateLimited = true;
    status.cooldownUntil = Date.now() + cooldownDurationMs;
    status.lastChecked = Date.now();
    status.lastError = `Rate limited (HTTP 429). Cooldown for ${Math.round(cooldownDurationMs / 1000)}s.`;
  }

  /**
   * Actively pings a provider to verify reachability and measure round-trip latency.
   */
  public async pingProvider(
    providerId: string,
    customFetch: typeof fetch = globalThis.fetch
  ): Promise<ProviderHealthStatus> {
    const provider = freeProviderRegistry.getProvider(providerId);
    const status = this.getProviderHealth(providerId);

    if (!provider || provider.base_url === 'auto') {
      status.lastChecked = Date.now();
      status.isHealthy = true;
      return status;
    }

    const targetUrl = provider.base_url.replace(/\/+$/, '') + '/models';
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await customFetch(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Ty-Code/1.0.0-health-monitor'
        },
        signal: controller.signal
      }).catch((err) => {
        clearTimeout(timeoutId);
        throw err;
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - start;

      // HTTP 200, 204, or 401/403 (service is reachable and up, auth expected) are healthy
      if (res.status === 200 || res.status === 204 || res.status === 401 || res.status === 403) {
        this.recordRequestOutcome(providerId, true, elapsed);
      } else if (res.status === 429) {
        this.recordRateLimit(providerId);
        this.recordRequestOutcome(providerId, false, elapsed, 'HTTP 429 Rate Limit');
      } else {
        this.recordRequestOutcome(providerId, false, elapsed, `HTTP status ${res.status}`);
      }
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.recordRequestOutcome(providerId, false, elapsed, msg);
    }

    const currentHealth = this.getProviderHealth(providerId);
    try {
      bootProfiler.recordHealthPing(providerId, currentHealth.latencyMs || 0, currentHealth.isHealthy ? 'healthy' : 'unhealthy');
    } catch {
      // Non-blocking
    }

    return currentHealth;
  }

  /**
   * Pings all registered free providers concurrently.
   */
  public async pingAllProviders(
    customFetch: typeof fetch = globalThis.fetch
  ): Promise<Record<string, ProviderHealthStatus>> {
    const providers = freeProviderRegistry.getAllProviders();
    await Promise.all(providers.map((p) => this.pingProvider(p.id, customFetch)));
    return this.getAllHealthStatuses();
  }

  /**
   * Pings all registered free providers staggered (Tier 2 boot requirement).
   * Staggered 200ms apart, max 3 concurrent, non-blocking.
   */
  public async pingAllProvidersStaggered(
    staggerMs = 200,
    maxConcurrent = 3,
    customFetch: typeof fetch = globalThis.fetch
  ): Promise<Record<string, ProviderHealthStatus>> {
    const providers = freeProviderRegistry.getAllProviders();
    const queue = [...providers];
    const executing: Array<Promise<void>> = [];

    while (queue.length > 0 || executing.length > 0) {
      while (queue.length > 0 && executing.length < maxConcurrent) {
        const nextProvider = queue.shift()!;
        const promise = (async () => {
          await this.pingProvider(nextProvider.id, customFetch);
        })().finally(() => {
          const index = executing.indexOf(promise);
          if (index >= 0) executing.splice(index, 1);
        });
        executing.push(promise);
        if (queue.length > 0 && staggerMs > 0) {
          await new Promise((r) => setTimeout(r, staggerMs));
        }
      }
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }
    return this.getAllHealthStatuses();
  }

  /**
   * Starts periodic health monitoring (default: 30 seconds).
   */
  public startMonitoring(
    intervalMs = 30_000,
    customFetch: typeof fetch = globalThis.fetch,
    skipInitialPing = false
  ): void {
    if (this.isMonitoringActive) return;
    this.isMonitoringActive = true;

    // Run initial health check only if not skipped (e.g. at boot, BootScheduler handles staggered pings)
    if (!skipInitialPing) {
      void this.pingAllProviders(customFetch);
    }

    // Schedule recurring background check
    this.monitorTimer = setInterval(() => {
      void this.pingAllProviders(customFetch);
    }, intervalMs);

    if (this.monitorTimer.unref) {
      this.monitorTimer.unref();
    }
  }

  /**
   * Stops periodic health monitoring.
   */
  public stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.isMonitoringActive = false;
  }

  /**
   * Manually resets a provider's health metrics back to healthy status.
   */
  public resetProviderHealth(providerId: string): void {
    const status = this.getProviderHealth(providerId);
    status.isHealthy = true;
    status.autoDisabled = false;
    status.isRateLimited = false;
    status.cooldownUntil = undefined;
    status.lastError = undefined;
    this.consecutiveFailures.set(providerId, 0);
  }
}

export const providerHealthMonitor = ProviderHealthMonitor.getInstance();
export const healthMonitor = providerHealthMonitor;
