/**
 * Background Health Monitoring and Auto-Failover Engine (Phase Diagnostics 5)
 *
 * Keeps the free-provider fleet healthy during real work:
 * - Pings healthy providers every 60s with a minimal 1-token request
 * - Marks RATE_LIMITED (429) and PROVIDER_DOWN (5xx / network drops) with cooldown timers
 * - Calculates fleet-wide health (all-healthy / degraded / no-working-provider)
 * - Strict Quiet Mode: zero background network checks while battery saver or metered connection is active
 * - Supports simulated outages and seamless failover recovery
 *
 * Brand: Ty-Code
 */

import type {
  DiagnosticsFleetHealth,
  FleetHealthState,
  ProviderHealthDetail,
  ProviderHealthState
} from '../../../shared/types/diagnostics';
import { freeProviderRegistry } from '../providers/free-provider-registry';
import { providerHealthMonitor } from '../providers/health-monitor';

export class DiagnosticsHealthMonitor {
  private static instance: DiagnosticsHealthMonitor;

  private readonly providers: Map<string, ProviderHealthDetail> = new Map();
  private readonly listeners: Set<(health: DiagnosticsFleetHealth) => void> = new Set();

  private pingTimer: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private pingIntervalMs = 60_000; // 60s default
  private defaultCooldownMs = 60_000; // 60s default cooldown

  // Quiet mode flags (Battery Saver / Metered Connection)
  private quietMode = false;
  private batterySaver = false;
  private meteredConnection = false;

  private constructor() {
    this.initializeFleet();
  }

  public static getInstance(): DiagnosticsHealthMonitor {
    if (!DiagnosticsHealthMonitor.instance) {
      DiagnosticsHealthMonitor.instance = new DiagnosticsHealthMonitor();
    }
    return DiagnosticsHealthMonitor.instance;
  }

  /**
   * Initializes fleet records from the permanent free provider registry
   */
  public initializeFleet(): void {
    const freeList = freeProviderRegistry.getAllProviders();
    for (const p of freeList) {
      const existing = this.providers.get(p.id);
      if (!existing) {
        this.providers.set(p.id, {
          providerId: p.id,
          providerName: p.name,
          isHealthy: true,
          status: 'HEALTHY',
          latencyMs: 120,
          consecutiveFailures: 0,
          testedModel: p.best_free_models[0] || 'default'
        });
      }
    }
  }

  /**
   * Returns whether quiet mode is currently suppressing background network checks.
   * True if quietMode, batterySaver, or meteredConnection is set.
   */
  public isQuietModeActive(): boolean {
    return this.quietMode || this.batterySaver || this.meteredConnection;
  }

  public setQuietMode(enabled: boolean): void {
    this.quietMode = Boolean(enabled);
    this.notifyListeners();
  }

  public setBatterySaver(enabled: boolean): void {
    this.batterySaver = Boolean(enabled);
    this.notifyListeners();
  }

  public setMeteredConnection(enabled: boolean): void {
    this.meteredConnection = Boolean(enabled);
    this.notifyListeners();
  }

  public getQuietModeFlags(): { quietMode: boolean; batterySaver: boolean; meteredConnection: boolean; active: boolean } {
    return {
      quietMode: this.quietMode,
      batterySaver: this.batterySaver,
      meteredConnection: this.meteredConnection,
      active: this.isQuietModeActive()
    };
  }

  /**
   * Returns a snapshot of a single provider's health details, updating cooldown expiration.
   */
  public getProviderDetail(providerId: string): ProviderHealthDetail {
    let detail = this.providers.get(providerId);
    if (!detail) {
      const reg = freeProviderRegistry.getProvider(providerId);
      detail = {
        providerId,
        providerName: reg?.name || providerId,
        isHealthy: true,
        status: 'HEALTHY',
        latencyMs: 150,
        consecutiveFailures: 0,
        testedModel: reg?.best_free_models[0] || 'default'
      };
      this.providers.set(providerId, detail);
    }

    const now = Date.now();
    if (detail.cooldownUntil) {
      if (now >= detail.cooldownUntil) {
        // Cooldown has expired, mark as eligible to probe or recovered
        detail.cooldownUntil = undefined;
        detail.cooldownRemainingSec = 0;
        if (detail.status === 'COOLDOWN' || detail.status === 'RATE_LIMITED' || detail.status === 'PROVIDER_DOWN') {
          detail.status = 'HEALTHY';
          detail.isHealthy = true;
          detail.lastError = undefined;
        }
      } else {
        detail.cooldownRemainingSec = Math.max(1, Math.ceil((detail.cooldownUntil - now) / 1000));
      }
    } else {
      detail.cooldownRemainingSec = 0;
    }

    return detail;
  }

  /**
   * Computes the overall fleet health state and returns the full DiagnosticsFleetHealth payload.
   */
  public getFleetHealth(): DiagnosticsFleetHealth {
    const now = Date.now();
    const providersSnapshot: Record<string, ProviderHealthDetail> = {};

    let healthyCount = 0;
    let degradedCount = 0;
    let downCount = 0;

    for (const [id] of this.providers) {
      const detail = this.getProviderDetail(id);
      providersSnapshot[id] = { ...detail };

      if (detail.isHealthy && detail.status === 'HEALTHY' && !detail.cooldownUntil) {
        healthyCount++;
      } else if (detail.status === 'RATE_LIMITED' || detail.status === 'COOLDOWN') {
        degradedCount++;
      } else if (detail.status === 'PROVIDER_DOWN') {
        downCount++;
      } else {
        degradedCount++;
      }
    }

    const totalCount = this.providers.size;
    let state: FleetHealthState = 'all-healthy';

    if (healthyCount === 0 && totalCount > 0) {
      state = 'no-working-provider';
    } else if (healthyCount < totalCount) {
      state = 'degraded';
    } else {
      state = 'all-healthy';
    }

    return {
      state,
      timestamp: now,
      healthyCount,
      totalCount,
      degradedCount,
      downCount,
      quietModeActive: this.isQuietModeActive(),
      batterySaver: this.batterySaver,
      meteredConnection: this.meteredConnection,
      providers: providersSnapshot
    };
  }

  /**
   * Records a rate limit (HTTP 429) on a provider with a cooldown timer.
   */
  public recordRateLimit(
    providerId: string,
    cooldownMs = this.defaultCooldownMs,
    error = 'HTTP 429 Rate Limit Exceeded'
  ): void {
    const detail = this.getProviderDetail(providerId);
    detail.isHealthy = false;
    detail.status = 'RATE_LIMITED';
    detail.lastPingTime = Date.now();
    detail.lastError = error;
    detail.cooldownUntil = Date.now() + cooldownMs;
    detail.cooldownRemainingSec = Math.ceil(cooldownMs / 1000);
    detail.consecutiveFailures++;

    // Sync with Phase 6.1 provider health monitor
    providerHealthMonitor.recordRateLimit(providerId, cooldownMs);

    this.notifyListeners();
  }

  /**
   * Records a provider outage (5xx / network abort / socket hangup) with a cooldown timer.
   */
  public recordProviderDown(
    providerId: string,
    cooldownMs = this.defaultCooldownMs,
    error = 'Provider Down / Network Failure'
  ): void {
    const detail = this.getProviderDetail(providerId);
    detail.isHealthy = false;
    detail.status = 'PROVIDER_DOWN';
    detail.lastPingTime = Date.now();
    detail.lastError = error;
    detail.cooldownUntil = Date.now() + cooldownMs;
    detail.cooldownRemainingSec = Math.ceil(cooldownMs / 1000);
    detail.consecutiveFailures++;

    providerHealthMonitor.recordFailure(providerId, error);

    this.notifyListeners();
  }

  /**
   * Records a successful request/ping on a provider.
   */
  public recordSuccess(providerId: string, latencyMs = 100): void {
    const detail = this.getProviderDetail(providerId);
    detail.isHealthy = true;
    detail.status = 'HEALTHY';
    detail.lastPingTime = Date.now();
    detail.lastError = undefined;
    detail.cooldownUntil = undefined;
    detail.cooldownRemainingSec = 0;
    detail.consecutiveFailures = 0;
    detail.latencyMs = Math.round(detail.latencyMs ? detail.latencyMs * 0.7 + latencyMs * 0.3 : latencyMs);

    providerHealthMonitor.recordSuccess(providerId, latencyMs);

    this.notifyListeners();
  }

  /**
   * Simulates an outage for testing and validation (RATE_LIMITED or PROVIDER_DOWN).
   */
  public simulateProviderOutage(
    providerId: string,
    type: 'RATE_LIMITED' | 'PROVIDER_DOWN' = 'PROVIDER_DOWN',
    cooldownMs = this.defaultCooldownMs
  ): DiagnosticsFleetHealth {
    if (type === 'RATE_LIMITED') {
      this.recordRateLimit(providerId, cooldownMs, `Simulated 429 Rate Limit on ${providerId}`);
    } else {
      this.recordProviderDown(providerId, cooldownMs, `Simulated Outage (503 Service Unavailable) on ${providerId}`);
    }
    return this.getFleetHealth();
  }

  /**
   * Simulates recovery for testing and validation.
   */
  public simulateProviderRecovery(providerId: string): DiagnosticsFleetHealth {
    this.recordSuccess(providerId, 95);
    return this.getFleetHealth();
  }

  /**
   * Executes a minimal 1-token health check request to a provider.
   *
   * Ping payload:
   *   max_tokens: 1
   *   messages: [{ role: 'user', content: 'ping' }]
   *
   * If quiet mode is active, ZERO network requests are made.
   */
  public async pingProvider(
    providerId: string,
    customFetch: typeof fetch = globalThis.fetch
  ): Promise<ProviderHealthDetail> {
    if (this.isQuietModeActive()) {
      return this.getProviderDetail(providerId);
    }

    const detail = this.getProviderDetail(providerId);
    const now = Date.now();

    // If still in cooldown, skip pinging
    if (detail.cooldownUntil && now < detail.cooldownUntil) {
      return detail;
    }

    const reg = freeProviderRegistry.getProvider(providerId);
    if (!reg || reg.base_url === 'auto') {
      detail.lastPingTime = now;
      detail.isHealthy = true;
      detail.status = 'HEALTHY';
      return detail;
    }

    const targetModel = detail.testedModel || reg.best_free_models[0] || 'default';
    const endpoint = `${reg.base_url.replace(/\/+$/, '')}/chat/completions`;
    const start = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Ty-Code/1.0.0-health-monitor'
    };

    if (providerId === 'openkilo-free') {
      headers.Authorization = 'Bearer anonymous';
    } else if (reg.auth_type === 'anonymous') {
      headers.Authorization = 'Bearer anonymous';
    }

    const body = {
      model: targetModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await customFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      }).catch((err) => {
        clearTimeout(timeout);
        throw err;
      });

      clearTimeout(timeout);
      const elapsed = Date.now() - start;

      if (response.status === 200 || response.status === 204) {
        this.recordSuccess(providerId, elapsed);
      } else if (response.status === 429) {
        // Check for Retry-After header
        const retryAfter = response.headers?.get?.('retry-after');
        let cooldownMs = this.defaultCooldownMs;
        if (retryAfter) {
          const sec = Number(retryAfter);
          if (!Number.isNaN(sec) && sec > 0) cooldownMs = sec * 1000;
        }
        this.recordRateLimit(providerId, cooldownMs, `HTTP 429 Rate Limited. Cooldown for ${Math.round(cooldownMs / 1000)}s.`);
      } else if (response.status >= 500) {
        this.recordProviderDown(providerId, this.defaultCooldownMs, `HTTP ${response.status} Provider Down`);
      } else if (response.status === 401 || response.status === 403) {
        // If unconfigured provider requires a key, check fallback reachability via /models
        if (reg.auth_type === 'api_key_optional') {
          // Reachable endpoint, requires auth key
          detail.lastPingTime = Date.now();
          detail.latencyMs = elapsed;
          detail.lastError = 'API key required';
          // Keep healthy reachability
          detail.isHealthy = true;
          detail.status = 'HEALTHY';
        } else {
          this.recordProviderDown(providerId, this.defaultCooldownMs, `HTTP ${response.status} Auth Failure`);
        }
      } else {
        // Other unexpected status codes
        this.recordProviderDown(providerId, this.defaultCooldownMs, `HTTP ${response.status}`);
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      this.recordProviderDown(providerId, this.defaultCooldownMs, `Connection error: ${msg}`);
    }

    return this.getProviderDetail(providerId);
  }

  /**
   * Pings all healthy (or eligible out-of-cooldown) providers in parallel.
   * If quiet mode is active, ZERO network requests are made.
   */
  public async checkHealth(customFetch: typeof fetch = globalThis.fetch): Promise<DiagnosticsFleetHealth> {
    if (this.isQuietModeActive()) {
      // Quiet mode is active: ZERO background requests
      return this.getFleetHealth();
    }

    const promises: Promise<ProviderHealthDetail>[] = [];
    for (const [id] of this.providers) {
      promises.push(this.pingProvider(id, customFetch));
    }

    await Promise.allSettled(promises);
    return this.getFleetHealth();
  }

  /**
   * Starts periodic background health checks (default: 60s).
   */
  public startMonitoring(intervalMs = 60_000, customFetch: typeof fetch = globalThis.fetch): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.pingIntervalMs = intervalMs;

    // Run initial check if not quiet
    if (!this.isQuietModeActive()) {
      void this.checkHealth(customFetch);
    }

    this.pingTimer = setInterval(() => {
      if (!this.isQuietModeActive()) {
        void this.checkHealth(customFetch);
      }
    }, intervalMs);

    if (this.pingTimer.unref) {
      this.pingTimer.unref();
    }
  }

  /**
   * Stops background health checks.
   */
  public stopMonitoring(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.isMonitoring = false;
  }

  /**
   * Subscribes a listener to fleet health changes.
   */
  public onFleetHealthChange(listener: (health: DiagnosticsFleetHealth) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const health = this.getFleetHealth();
    for (const listener of this.listeners) {
      try {
        listener(health);
      } catch (err) {
        console.error('Error notifying fleet health listener:', err);
      }
    }
  }

  /**
   * Resets all providers and quiet mode settings back to healthy default state.
   */
  public reset(): void {
    this.quietMode = false;
    this.batterySaver = false;
    this.meteredConnection = false;
    this.providers.clear();
    this.initializeFleet();
    this.notifyListeners();
  }
}

export const diagnosticsHealthMonitor = DiagnosticsHealthMonitor.getInstance();
