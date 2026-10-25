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
          isHealthy: false,
          status: 'UNTESTED',
          consecutiveFailures: 0,
          testedModel: p.best_free_models[0] || 'default'
        } as ProviderHealthDetail);
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
        isHealthy: false,
        status: 'UNTESTED',
        consecutiveFailures: 0,
        testedModel: reg?.best_free_models[0] || 'default'
      };
      this.providers.set(providerId, detail);
    }

    // Cooldown expired: health is no longer proven and must be re-verified on the next real ping
    const now = Date.now();
    if (detail.cooldownUntil) {
      if (now >= detail.cooldownUntil) {
        detail.cooldownUntil = undefined;
        detail.cooldownRemainingSec = 0;
        if (detail.status === 'COOLDOWN' || detail.status === 'RATE_LIMITED' || detail.status === 'PROVIDER_DOWN') {
          detail.status = 'UNTESTED';
          detail.isHealthy = false;
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
    let untestedCount = 0;

    for (const [id] of this.providers) {
      const detail = this.getProviderDetail(id);
      providersSnapshot[id] = { ...detail };

      switch (detail.status) {
        case 'HEALTHY':
          if (detail.isHealthy && !detail.cooldownUntil) {
            healthyCount++;
          } else if (detail.cooldownUntil) {
            degradedCount++;
          } else {
            degradedCount++;
          }
          break;
        case 'RATE_LIMITED':
        case 'COOLDOWN':
          degradedCount++;
          break;
        case 'UNCONFIGURED':
          // Reachable but needs a configured key: functional gap, not a network outage
          degradedCount++;
          break;
        case 'PROVIDER_DOWN':
          downCount++;
          break;
        default:
          untestedCount++;
          break;
      }
    }

    const totalCount = this.providers.size;
    const testedCount = totalCount - untestedCount;
    let state: FleetHealthState;

    if (totalCount === 0 || (healthyCount === 0 && testedCount === 0)) {
      // Nothing proven yet: never fabricate health, report degraded until evidence arrives
      state = 'degraded';
    } else if (healthyCount === 0) {
      state = 'no-working-provider';
    } else if (healthyCount === totalCount && untestedCount === 0) {
      state = 'all-healthy';
    } else {
      state = 'degraded';
    }

    return {
      state,
      timestamp: now,
      healthyCount,
      totalCount,
      testedCount,
      untestedCount,
      degradedCount,
      downCount,
      quietModeActive: this.isQuietModeActive(),
      batterySaver: this.batterySaver,
      meteredConnection: this.meteredConnection,
      providers: providersSnapshot
    };
  }

  /**
   * Ingests an authoritative provider connection diagnostic result.
   * Only REAL evidence (connection tests, pings) may declare a provider healthy; nothing is assumed.
   */
  public recordConnectionResult(
    providerId: string,
    status: 'PASS' | 'FAIL' | 'SKIPPED',
    ttftMs?: number,
    errorCode?: string,
    message?: string,
    testedModel?: string
  ): ProviderHealthDetail | null {
    const detail = this.getProviderDetail(providerId);
    // Unknown ids only enter the fleet when a real test produced evidence (e.g. local Ollama)
    if (status === 'SKIPPED') {
      detail.lastPingTime = Date.now();
      this.notifyListeners();
      return detail;
    }

    if (testedModel) detail.testedModel = testedModel;

    if (status === 'PASS') {
      if (ttftMs && ttftMs > 0) {
        this.recordSuccess(providerId, ttftMs);
      } else {
        this.recordSuccess(providerId);
      }
      detail.verifiedAt = Date.now();
      return detail;
    }

    detail.lastPingTime = Date.now();
    detail.verifiedAt = detail.verifiedAt || undefined;
    const reason = typeof message === 'string' && message.trim() ? message : errorCode || 'Connection test failed';

    if (errorCode === 'CONFIG_MISSING') {
      detail.isHealthy = false;
      detail.status = 'UNCONFIGURED';
      detail.lastError = `Needs configuration: ${reason}`;
      detail.cooldownUntil = undefined;
      detail.cooldownRemainingSec = 0;
      providerHealthMonitor.recordFailure(providerId, reason);
      this.notifyListeners();
      return detail;
    }

    if (errorCode === 'RATE_LIMITED' || errorCode === 'QUOTA_EXCEEDED') {
      this.recordRateLimit(providerId, this.defaultCooldownMs, reason);
      detail.verifiedAt = Date.now();
      return detail;
    }

    this.recordProviderDown(providerId, this.defaultCooldownMs, `${errorCode || 'FAIL'}: ${reason}`);
    detail.verifiedAt = Date.now();
    return detail;
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

    // Consecutive-failure backoff: repeated 429s on the same provider (the
    // anonymous pools hammer easily) double the cooldown up to 30 minutes so
    // background pings stop re-entering a rate-limited pool every minute.
    if (cooldownMs <= this.defaultCooldownMs) {
      const failNum = detail.consecutiveFailures;
      const backoffMs = Math.min(
        this.defaultCooldownMs * Math.pow(2, Math.max(0, failNum - 1)),
        30 * 60_000
      );
      cooldownMs = Math.max(cooldownMs, backoffMs);
    }

    detail.cooldownUntil = Date.now() + cooldownMs;
    detail.cooldownRemainingSec = Math.ceil(cooldownMs / 1000);
    detail.consecutiveFailures++;
    detail.verifiedAt = Date.now();

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
    detail.verifiedAt = Date.now();

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
    detail.verifiedAt = Date.now();
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
      // No deterministic endpoint to probe: never fabricate health, keep it unproven
      detail.lastPingTime = now;
      if (detail.status === 'UNTESTED') {
        detail.status = 'UNTESTED';
        detail.isHealthy = false;
      }
      return detail;
    }

    if (reg.auth_type === 'api_key_optional') {
      // Key-bearing free providers (openrouter-free, groq-free, ...) are never
      // probed by the background monitor: the ping cannot attach the user's
      // stored credential (and must not - each probe would burn their
      // free-tier request budget), so an unkeyed probe would only yield a
      // misleading 401 "UNCONFIGURED". Health evidence for these comes
      // exclusively from real traffic outcomes or the explicit diagnostics
      // suite, which attaches the stored key.
      detail.lastPingTime = now;
      if (detail.status === 'UNTESTED') {
        detail.status = 'UNTESTED';
        detail.isHealthy = false;
      }
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
        // Reachable endpoint, but without a working key there is no usable connection
        detail.lastPingTime = Date.now();
        detail.latencyMs = elapsed;
        detail.lastError = 'API key required or rejected';
        detail.isHealthy = false;
        detail.status = 'UNCONFIGURED';
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
