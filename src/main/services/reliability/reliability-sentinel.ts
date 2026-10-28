/**
 * Reliability Sentinel (Autonomous Free-Tier Reliability, Prompt 1).
 *
 * An autonomous, boot-only background gauge for the free-tier routes:
 *  - Probes ONE free route at a time, staggered every ~50s, ONLY while no
 *    chat stream is active (idle-aware; boot-time only, never during a turn).
 *    Budget: at most 1 probe per model per 5 minutes. Probes are cheap:
 *    GET /models (or /health for the FCC sidecar) with a strict 5s timeout -
 *    no tokens, no chat requests.
 *  - Maintains per-route status ('ok' | 'degraded' | 'cooling' | 'unknown'),
 *    TTFT p50/p95, and a rolling success rate (window 10).
 *  - Success < 60% over the last 10 attempts, OR >= 2 consecutive failures,
 *    marks the route degraded/cooling. Adaptive cooldowns: 429 honors
 *    Retry-After (or learns a recurrence window), server failures use a
 *    doubling backoff (90s step, 20min cap).
 *  - Every change bumps a snapshot version and fans it out on the
 *    `reliability:health-snapshot` channel (dedicated SILENT-class channel;
 *    Diagnostics panel + ModelSelector read-only consumers).
 *  - Dev-only chaos injection: faults queued via the `devChaos` IPC (created
 *    elsewhere, packaged builds refuse) are consumed by the gateway right
 *    before fetch so NATIVE failover + the remediation ladder run exactly as
 *    they would on a real outage.
 *
 * Zero Telemetry: probes only hit the free provider endpoints themselves;
 * no data leaves the machine.
 */

import { getVerifiedModels, type VerifiedModelConfig } from '../verified-models';
import { fccSidecarManager } from '../fcc-sidecar-manager';
import { getCommunityKeyCached, listProvidersWithKeys, probeSavedKey } from '../credential-vault';
import { providerHealthStore } from '../../providers/provider-health-store';
import { providerHealthMonitor } from '../providers/health-monitor';
import { chatLatencyTracker } from '../../providers/provider-gateway';
import { reliabilityLedger } from './reliability-ledger';
import { broadcastReliability, isPackagedBuild } from './bus';
import type { DevChaosRequest, ReliabilityHealthSnapshot, ReliabilityRouteHealth } from '../../../shared/types/agent-events';

const TICK_INTERVAL_MS = 50_000;
const FIRST_TICK_MIN_MS = 20_000;
const FIRST_TICK_JITTER_MS = 40_000;
const PROBE_TIMEOUT_MS = 5_000;
const MIN_PROBE_INTERVAL_MS = 300_000; // 1 probe / 5 min / model
const ROUTE_CACHE_TTL_MS = 10 * 60_000;
const SUCCESS_WINDOW = 10;
const TTFT_WINDOW = 20;
const COOLING_SUCCESS_THRESHOLD = 0.6;
const COOLING_MIN_SAMPLES = 6;
const OK_SUCCESS_THRESHOLD = 0.85;
const BASE_429_COOLDOWN_MS = 180_000;
const BASE_PROBE_COOLDOWN_MS = 90_000;
const MAX_COOLDOWN_MS = 3_600_000;
const KEY_REVALIDATE_INTERVAL_MS = 30 * 60_000; // Prompt 2: staggered key revalidation

type RouteStatus = 'ok' | 'degraded' | 'cooling' | 'unknown';

interface RouteStat {
  providerId: string;
  modelId: string;
  url: string;
  results: Array<{ ok: boolean; at: number; ttftMs?: number; status?: number }>;
  status: RouteStatus;
  failuresInARow: number;
  cooldownUntil: number;
  lastError: string | null;
  lastProbeTs: number | null;
  ttftHistory: number[];
}

function routeKey(providerId: string, modelId: string): string {
  return `${(providerId || '').toLowerCase()}::${modelId}`;
}

function isTyCodeFree(providerId: string): boolean {
  const p = (providerId || '').toLowerCase();
  return p === 'ty-code-free' || p === 'tycode-free';
}

function isFccProvider(providerId: string): boolean {
  const p = (providerId || '').toLowerCase();
  return p === 'fcc' || p === 'fcc-proxy' || p === 'anthropic-claude';
}

function percentile(sorted: number[], pct: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1) + 0.5)));
  return Math.round(sorted[idx]);
}

class ReliabilitySentinel {
  private stats = new Map<string, RouteStat>();
  private builtAt = 0;
  private version = 0;
  private lastBroadcastAt = 0;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private queueIndex = 0;
  private buildPromise: Promise<void> | null = null;
  private keyTimer: ReturnType<typeof setInterval> | null = null;
  private keyRevalidateIdx = 0;
  private queuedFaults = new Map<string, { fault: 'timeout' | 'refused' | 'rate_429'; until: number }>();

  // ---------- Lifecycle ----------

  /** Idempotent start; called once from the main boot sequence. */
  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const firstDelay = FIRST_TICK_MIN_MS + Math.floor(Math.random() * FIRST_TICK_JITTER_MS);
    this.firstTimer = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, TICK_INTERVAL_MS);
    }, firstDelay);
    // Prompt 2: staggered saved-key revalidation roster (one key per tick,
    // idle-aware, 5s probe budget).
    this.keyTimer = setInterval(() => {
      void this.revalidateNextKey().catch(() => undefined);
    }, KEY_REVALIDATE_INTERVAL_MS);
  }

  public stop(): void {
    this.stopped = true;
    if (this.firstTimer) {
      clearTimeout(this.firstTimer);
      this.firstTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.keyTimer) {
      clearInterval(this.keyTimer);
      this.keyTimer = null;
    }
  }

  /** Single staggered probe tick: skips completely while a stream runs. */
  public async tick(): Promise<void> {
    if (this.stopped) return;
    if (chatLatencyTracker.getActiveTaskId()) return;
    this.buildRoutes();
    if (this.buildPromise) await this.buildPromise;
    const key = this.nextRouteByBudget();
    if (!key) return;
    await this.probeRoute(key);
  }

  /**
   * Prompt 2: staggered saved-key revalidation. Rotates ONE provider per
   * 30-min tick (idle-aware; skipped while a stream runs). Success clears
   * ONLY the sticky invalid-key flag; active rate-limit cooldowns are never
   * touched by revalidation.
   */
  private async revalidateNextKey(): Promise<void> {
    if (this.stopped) return;
    if (chatLatencyTracker.getActiveTaskId()) return;
    const roster = listProvidersWithKeys();
    if (roster.length === 0) return;
    const provider = roster[this.keyRevalidateIdx % roster.length];
    this.keyRevalidateIdx = (this.keyRevalidateIdx + 1) % roster.length;
    const res = await probeSavedKey(provider, PROBE_TIMEOUT_MS).catch(() => ({
      valid: false as const,
      status: undefined as number | undefined,
      message: 'probe error'
    }));
    if (res.valid) {
      if (providerHealthStore.getState(provider) === 'invalid_key') providerHealthStore.clear(provider);
      reliabilityLedger.record({ at: Date.now(), kind: 'probe', route: provider, outcome: 'ok', detail: 'saved-key revalidation ok' });
    } else {
      // Only an auth-shaped rejection is sticky; transient probe failures
      // never flip the invalid_key flag.
      if (res.status === 401 || res.status === 403) {
        providerHealthStore.markInvalidKey(provider, res.status);
      }
      reliabilityLedger.record({
        at: Date.now(),
        kind: 'probe',
        route: provider,
        outcome: 'failed',
        detail: `saved-key revalidation failed (${res.message})`
      });
    }
  }

  // ---------- Route roster ----------

  private buildRoutes(): void {
    const now = Date.now();
    if (now - this.builtAt < ROUTE_CACHE_TTL_MS && this.stats.size > 0) return;
    if (this.buildPromise) return;
    this.builtAt = now;
    this.buildPromise = getVerifiedModels()
      .then((models) => {
        for (const m of models) {
          const key = routeKey(m.providerId, m.modelId);
          if (this.stats.has(key) || !this.shouldIncludeRoute(m)) continue;
          this.stats.set(key, {
            providerId: m.providerId,
            modelId: m.modelId,
            url: m.url,
            results: [],
            status: 'unknown',
            failuresInARow: 0,
            cooldownUntil: 0,
            lastError: null,
            lastProbeTs: null,
            ttftHistory: []
          });
        }
      })
      .finally(() => {
        this.buildPromise = null;
      })
      .then(() => undefined);
  }

  private shouldIncludeRoute(m: VerifiedModelConfig): boolean {
    // Only HTTP-reachable free/keyless routes (and the community tier).
    if (!m.url || !m.url.startsWith('http')) return false;
    if (!m.requiresKey) return true;
    return isTyCodeFree(m.providerId);
  }

  private nextRouteByBudget(): string | null {
    this.buildRoutes();
    const now = Date.now();
    const keys = Array.from(this.stats.keys());
    if (keys.length === 0) return null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(this.queueIndex + i) % keys.length];
      const stat = this.stats.get(key)!;
      if (stat.lastProbeTs && now - stat.lastProbeTs < MIN_PROBE_INTERVAL_MS) continue;
      if (now < stat.cooldownUntil) continue;
      this.queueIndex = (this.queueIndex + i + 1) % keys.length;
      return key;
    }
    return null;
  }

  // ---------- Probing ----------

  private probeTarget(stat: RouteStat): string | null {
    try {
      const p = stat.providerId;
      if (isFccProvider(p) || stat.url.includes(':8765')) {
        if (!fccSidecarManager.isActive()) return null;
        return `${fccSidecarManager.getBaseUrl()}/health`;
      }
      const u = new URL(stat.url);
      if (u.port === '11434') return `${u.origin}/api/tags`;
      if (isTyCodeFree(p)) return 'https://openrouter.ai/api/v1/models';
      return `${u.origin}/models`;
    } catch {
      return null;
    }
  }

  private probeHeaders(stat: RouteStat): Record<string, string> {
    if (isTyCodeFree(stat.providerId)) {
      const community = getCommunityKeyCached();
      if (community) return { Authorization: `Bearer ${community}` };
    }
    return {};
  }

  private async probeRoute(key: string): Promise<void> {
    const stat = this.stats.get(key);
    if (!stat) return;
    stat.lastProbeTs = Date.now();
    const url = this.probeTarget(stat);
    if (!url) {
      // Sidecar down or unsupported transport: record 'unknown', never punished.
      reliabilityLedger.record({ at: Date.now(), kind: 'probe', route: key, outcome: 'skipped', detail: 'no probe target' });
      return;
    }
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.probeHeaders(stat),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      const latencyMs = Date.now() - started;
      const ok = res.status >= 200 && res.status < 300;
      stat.ttftHistory.push(latencyMs);
      if (stat.ttftHistory.length > TTFT_WINDOW) stat.ttftHistory = stat.ttftHistory.slice(-TTFT_WINDOW);
      this.recordOutcome(stat, ok, latencyMs, res.status);
    } catch (err) {
      const latencyMs = Date.now() - started;
      this.recordOutcome(stat, false, latencyMs, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  // ---------- Stats + cooldown ----------

  private recordOutcome(stat: RouteStat, ok: boolean, ttftMs: number | undefined, httpStatus: number | undefined, error?: string): void {
    stat.results.push({ ok, at: Date.now(), ttftMs, status: httpStatus });
    if (stat.results.length > SUCCESS_WINDOW) stat.results = stat.results.slice(-SUCCESS_WINDOW);

    const previous = stat.status;
    if (ok) {
      stat.failuresInARow = 0;
      stat.lastError = null;
      stat.cooldownUntil = 0;
    } else {
      stat.failuresInARow += 1;
      stat.lastError = error || (httpStatus ? `HTTP ${httpStatus}` : 'probe failed');
      // Adaptive cooldown from the probe history only; request-path 429s are
      // already handled by the gateway (Retry-After) and mirrored here.
      let cooldownMs: number;
      if (httpStatus === 429) {
        cooldownMs = Math.min(BASE_429_COOLDOWN_MS * 2 ** Math.max(0, stat.failuresInARow - 1), MAX_COOLDOWN_MS);
        providerHealthStore.markRateLimited(stat.providerId, Math.ceil(cooldownMs / 1000));
      } else {
        cooldownMs = Math.min(BASE_PROBE_COOLDOWN_MS * 2 ** Math.max(0, stat.failuresInARow - 1), 20 * 60_000);
      }
      stat.cooldownUntil = Date.now() + cooldownMs;
    }

    stat.status = this.computeStatus(stat);

    reliabilityLedger.record({
      at: Date.now(),
      kind: 'probe',
      route: routeKey(stat.providerId, stat.modelId),
      outcome: ok ? 'ok' : 'failed',
      latencyMs: ttftMs,
      detail: stat.status !== previous ? `status ${previous} -> ${stat.status}` : stat.lastError || undefined
    });
    providerHealthMonitor.recordRequestOutcome(stat.providerId, ok, ttftMs ?? 1, stat.lastError || undefined);

    if (previous !== 'ok' && stat.status === 'ok') {
      reliabilityLedger.record({ at: Date.now(), kind: 'recovered', route: routeKey(stat.providerId, stat.modelId), outcome: 'recovered' });
      try {
        // Late require avoids an eager circular import: the ladder only uses
        // this callback inside its own functions.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { reliabilityLadder } = require('./remediation-ladder') as typeof import('./remediation-ladder');
        reliabilityLadder.onRouteRecovered(stat.providerId, stat.modelId);
      } catch {
        // Recovery notification is best-effort.
      }
    }

    this.version += 1;
    this.broadcastSnapshot();
  }

  private computeStatus(stat: RouteStat): RouteStatus {
    const now = Date.now();
    const okCount = stat.results.filter((r) => r.ok).length;
    const rate = stat.results.length > 0 ? okCount / stat.results.length : 0;
    if (stat.results.length >= COOLING_MIN_SAMPLES && rate < COOLING_SUCCESS_THRESHOLD) return 'cooling';
    if (stat.cooldownUntil > now && stat.failuresInARow >= 2) return 'cooling';
    if (stat.failuresInARow >= 2) return 'degraded';
    if (stat.results.length >= 2 && rate >= OK_SUCCESS_THRESHOLD) return 'ok';
    return stat.results.length === 0 ? 'unknown' : 'degraded';
  }

  // ---------- Snapshot / queries ----------

  public getHealthSnapshot(): ReliabilityHealthSnapshot {
    const now = Date.now();
    const routes: ReliabilityRouteHealth[] = [];
    for (const stat of this.stats.values()) {
      const okCount = stat.results.filter((r) => r.ok).length;
      const sorted = [...stat.ttftHistory].sort((a, b) => a - b);
      routes.push({
        providerId: stat.providerId,
        modelId: stat.modelId,
        status: stat.status,
        successRate: stat.results.length > 0 ? Math.round((okCount / stat.results.length) * 100) / 100 : 0,
        cachedTtftMs: percentile(sorted, 50),
        p95TtftMs: percentile(sorted, 95),
        cooldownRemainingSec: Math.max(0, Math.ceil((stat.cooldownUntil - now) / 1000)),
        lastError: stat.lastError,
        lastProbeTs: stat.lastProbeTs
      });
    }
    return { version: this.version, updatedAt: now, routes };
  }

  private broadcastSnapshot(): void {
    const now = Date.now();
    if (now - this.lastBroadcastAt < 500) return; // coalesce micro-storms
    this.lastBroadcastAt = now;
    broadcastReliability('reliability:health-snapshot', this.getHealthSnapshot());
  }

  /** True when every route of this provider is cooling/degraded. */
  public isProviderPoor(providerId: string): boolean {
    const norm = (providerId || '').toLowerCase().replace(/-free$/, '');
    let seen = false;
    for (const stat of this.stats.values()) {
      if ((stat.providerId || '').toLowerCase().replace(/-free$/, '') !== norm) continue;
      seen = true;
      if (stat.status === 'ok') return false;
    }
    return seen;
  }

  public getCooldownRemainingSec(providerId: string, modelId?: string): number {
    const now = Date.now();
    let max = 0;
    for (const stat of this.stats.values()) {
      if ((providerId || '').toLowerCase() !== stat.providerId.toLowerCase()) continue;
      if (modelId && stat.modelId !== modelId) continue;
      if (stat.cooldownUntil > now) max = Math.max(max, Math.ceil((stat.cooldownUntil - now) / 1000));
    }
    return max;
  }

  // ---------- Dev-only chaos ----------

  /**
   * Queues a fault for the NEXT request(s) matching the route. Packaged
   * builds refuse unconditionally (belt) - the CI guard (`chaos-hook-guard`)
   * verifies the IPC handler also sits inside an `!app.isPackaged` block
   * (braces). `auth_401` never queues a gateway fault: it simulates a revoked
   * Community Key by invalidating + silently re-fetching it (the real ladder
   * behavior it exercises).
   */
  public queueChaosFault(req: DevChaosRequest): void {
    if (isPackagedBuild()) throw new Error('CHAOS_DISABLED_IN_PACKAGED_BUILD');
    if (req.fault === 'auth_401') {
      reliabilityLedger.record({ at: Date.now(), kind: 'chaos', route: req.providerId || '*', outcome: 'started', detail: 'auth_401: community key invalidated for silent refresh' });
      void import('../credential-vault').then(async ({ invalidateCommunityKey, getCommunityKey }) => {
        try {
          invalidateCommunityKey();
          await getCommunityKey();
          reliabilityLedger.record({ at: Date.now(), kind: 'chaos', route: req.providerId || '*', outcome: 'ok', detail: 'auth_401: community key refreshed' });
        } catch (err) {
          reliabilityLedger.record({ at: Date.now(), kind: 'chaos', route: req.providerId || '*', outcome: 'failed', detail: `auth_401: ${err instanceof Error ? err.message : String(err)}` });
        }
      });
      return;
    }
    const durationMs = req.durationMs ?? 60_000;
    const keys = this.matchRoutes(req.providerId, req.modelId);
    if (keys.length === 0) throw new Error('CHAOS_NO_MATCHING_ROUTE');
    for (const key of keys) {
      this.queuedFaults.set(key, { fault: req.fault, until: Date.now() + durationMs });
    }
    reliabilityLedger.record({ at: Date.now(), kind: 'chaos', route: req.providerId || '*', outcome: 'started', detail: `${req.fault} queued for ${durationMs}ms on ${keys.length} route(s)` });
    this.version += 1;
    this.broadcastSnapshot();
  }

  /** Gateway consult right before fetch; consumes a matching queued fault. */
  public takeChaosFault(providerId: string, modelId: string): DevChaosRequest | null {
    if (this.queuedFaults.size === 0) return null;
    const now = Date.now();
    const keys = this.matchRoutes(providerId, modelId);
    for (const key of keys) {
      const q = this.queuedFaults.get(key);
      if (q) {
        this.queuedFaults.delete(key);
        if (q.until > now) {
          return { fault: q.fault, durationMs: 0 };
        }
        // Expired while sitting queued; keep scanning.
      }
    }
    return null;
  }

  private matchRoutes(providerId?: string, modelId?: string): string[] {
    const keys: string[] = [];
    const p = (providerId || '').toLowerCase().trim();
    const m = (modelId || '').trim();
    for (const [key, stat] of this.stats.entries()) {
      if (p && stat.providerId.toLowerCase() !== p) continue;
      if (m && stat.modelId !== m) continue;
      keys.push(key);
    }
    if (!p && !m && keys.length === 0) return [];
    return keys;
  }

  // ---------- Test/dev hooks ----------

  public __resetForTest(): void {
    this.stop();
    this.stats.clear();
    this.queuedFaults.clear();
    this.version = 0;
    this.builtAt = 0;
    this.queueIndex = 0;
    this.keyRevalidateIdx = 0;
    this.stopped = true;
  }

  public __debugState(): { routeCount: number; version: number; queuedFaults: number } {
    return { routeCount: this.stats.size, version: this.version, queuedFaults: this.queuedFaults.size };
  }
}

export const reliabilitySentinel = new ReliabilitySentinel();
