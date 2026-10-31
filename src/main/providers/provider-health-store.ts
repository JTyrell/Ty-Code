/**
 * Sticky provider health.
 *
 * - `invalid_key` entries are persisted to a local file beside the settings
 *   store and stay sticky until the key is re-saved, re-tested successfully,
 *   healed by a successful re-probe, or 24h have elapsed without re-save.
 *   The failover chain reads them at request time, so a dead provider is
 *   skipped entirely after its first failure (no re-walking, no re-emission).
 * - `rate_limited` entries honour Retry-After and live in memory only.
 * - `degraded` (transient, Route Truth Prompt) entries live in memory only
 *   and are NEVER selectors: an unexpected protocol fault may only record a
 *   short transient degraded TTL — it must not skip or sticky-mark a route.
 *
 * Sticky persistence is gated: ONLY `invalid_key` failures may call
 * markInvalidKey (see src/main/providers/error-classifier.ts).
 *
 * Local-only: nothing in this module touches the network (Zero-Telemetry).
 */

import fs from 'fs';
import path from 'path';

export type ProviderHealthState = 'invalid_key' | 'rate_limited' | 'degraded_transient';

export interface ProviderHealthSnapshot {
  updatedAt: number;
  invalidProviders: string[];
  rateLimitedProviders: Array<{ providerId: string; retryAt: number }>;
}

export interface PersistedEntry {
  state: 'invalid_key';
  since: number;
  httpStatus: number;
  /** Original classification that produced this entry (Route Truth Prompt). */
  failureClass?: 'invalid_key' | 'protocol_error';
}

const DEFAULT_RATE_LIMIT_TTL_MS = 60_000;
/** Prompt 1 Step 4: a sticky invalid_key entry auto-expires after 24h. */
export const STICKY_INVALID_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_DEGRADED_TTL_MS_DEFAULT = 10_000;

/** Same normalisation the agent engine uses: `groq-free` shares health with `groq`. */
export function normaliseHealthId(providerId: string): string {
  return (providerId || '').toLowerCase().trim().replace(/-free$/, '');
}

export class ProviderHealthStore {
  private invalid = new Map<string, PersistedEntry>();
  private rateLimited = new Map<string, number>();
  private degraded = new Map<string, number>();
  private loaded = false;
  private filePath: string | null = null;
  private listeners = new Set<(snapshot: ProviderHealthSnapshot) => void>();

  /** Test-only: point the store at a custom file and reset in-memory state. */
  __forTest(filePath: string | null, opts?: { loaded?: boolean }): void {
    this.invalid.clear();
    this.rateLimited.clear();
    this.degraded.clear();
    this.loaded = opts?.loaded ?? true;
    this.filePath = filePath;
  }

  private resolveFile(): string | null {
    if (this.filePath) return this.filePath;
    try {
      // Lazy require keeps this module importable from tests without Electron.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron');
      this.filePath = path.join(app.getPath('userData'), 'provider-health.json');
    } catch {
      this.filePath = null;
    }
    return this.filePath;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const file = this.resolveFile();
    if (!file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, PersistedEntry>;
      for (const [id, entry] of Object.entries(parsed || {})) {
        if (entry && entry.state === 'invalid_key') this.invalid.set(normaliseHealthId(id), entry);
      }
      // Route Truth Prompt: expire sticky invalid_key entries after 24h even
      // if no re-save happened — auto-age-out on load, then persist the trim.
      if (this.dropAgedEntries()) this.persist();
    } catch {
      // Missing or corrupt file: start clean.
    }
  }

  /** Drops sticky entries older than the 24h TTL; true when any were dropped. */
  private dropAgedEntries(): boolean {
    const cutoff = Date.now() - STICKY_INVALID_KEY_TTL_MS;
    let dropped = false;
    for (const [id, entry] of this.invalid) {
      if (typeof entry?.since === 'number' && entry.since < cutoff) {
        this.invalid.delete(id);
        dropped = true;
      }
    }
    return dropped;
  }

  private snapshot(): ProviderHealthSnapshot {
    const now = Date.now();
    return {
      updatedAt: now,
      invalidProviders: Array.from(this.invalid.keys()),
      rateLimitedProviders: Array.from(this.rateLimited.entries())
        .filter(([, retryAt]) => retryAt > now)
        .map(([providerId, retryAt]) => ({ providerId, retryAt }))
    };
  }

  private emitChange(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private persist(): void {
    const file = this.resolveFile();
    if (!file) return;
    try {
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(this.invalid), null, 2), 'utf-8');
    } catch (err) {
      console.warn('[HEALTH] Could not persist provider health:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Auth rejection with an auth-specific body/code (classified by
   * error-classifier.ts): sticky until key re-save / successful re-probe /
   * 24h TTL. `failureClass` records how the sticky entry came to be so
   * healRoutes can clear misclassified legacy entries.
   */
  markInvalidKey(providerId: string, httpStatus: number, failureClass?: 'invalid_key' | 'protocol_error'): void {
    // Strict Route Truth guarantee: a protocol_error NEVER becomes a persisted
    // sticky entry — even if a caller misuses this API, it downgrades to the
    // transient degraded TTL.
    if (failureClass === 'protocol_error') {
      this.markTransientDegraded(providerId);
      return;
    }
    this.load();
    this.dropAgedEntries();
    const id = normaliseHealthId(providerId);
    if (!id || this.invalid.has(id)) return; // first-write-wins
    this.invalid.set(id, { state: 'invalid_key', since: Date.now(), httpStatus, failureClass: failureClass || 'invalid_key' });
    this.persist();
    this.emitChange();
  }

  /** Call when the user saves a key for the provider or a re-test succeeds. */
  clear(providerId: string): void {
    this.load();
    const id = normaliseHealthId(providerId);
    const had = this.invalid.delete(id);
    this.rateLimited.delete(id);
    this.degraded.delete(id);
    if (had) this.persist();
    if (had) this.emitChange();
  }

  /** 429: honour Retry-After (seconds) in memory only. */
  markRateLimited(providerId: string, retryAfterSec?: number): void {
    const id = normaliseHealthId(providerId);
    if (!id) return;
    const ttl = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : DEFAULT_RATE_LIMIT_TTL_MS;
    this.rateLimited.set(id, Date.now() + ttl);
    this.emitChange();
  }

  /**
   * Route Truth Prompt: a protocol_error must not write health state beyond a
   * transient degraded TTL. NEVER persisted, NEVER a failover selector — the
   * route stays in the chain; this only records the transient state.
   */
  markTransientDegraded(providerId: string, ttlMs: number = TRANSIENT_DEGRADED_TTL_MS_DEFAULT): void {
    const id = normaliseHealthId(providerId);
    if (!id) return;
    this.degraded.set(id, Date.now() + Math.max(0, ttlMs));
    this.emitChange();
  }

  /** Live transient-degraded state (false once expired). */
  getDegraded(providerId: string): boolean {
    const id = normaliseHealthId(providerId);
    const until = this.degraded.get(id);
    if (until !== undefined && until > Date.now()) return true;
    if (until !== undefined) this.degraded.delete(id);
    return false;
  }

  getState(providerId: string): ProviderHealthState | null {
    this.load();
    const id = normaliseHealthId(providerId);
    this.dropAgedEntries();
    if (this.invalid.has(id)) return 'invalid_key';
    const until = this.rateLimited.get(id);
    if (until && until > Date.now()) return 'rate_limited';
    if (until) this.rateLimited.delete(id);
    const degradedUntil = this.degraded.get(id);
    if (degradedUntil !== undefined && degradedUntil > Date.now()) return 'degraded_transient';
    if (degradedUntil !== undefined) this.degraded.delete(id);
    return null;
  }

  isDead(providerId: string): boolean {
    const state = this.getState(providerId);
    // Transient degraded entries block nothing: the route stays in the chain.
    return state === 'invalid_key' || state === 'rate_limited';
  }

  public getSnapshot(): ProviderHealthSnapshot {
    this.load();
    this.dropAgedEntries();
    return this.snapshot();
  }

  public onDidChange(listener: (snapshot: ProviderHealthSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Normalised ids that failover must skip right now (degraded excluded). */
  deadProviderSet(): Set<string> {
    this.load();
    this.dropAgedEntries();
    const dead = new Set<string>(this.invalid.keys());
    const now = Date.now();
    for (const [id, until] of this.rateLimited) {
      if (until > now) dead.add(id);
      else this.rateLimited.delete(id);
    }
    return dead;
  }

  /**
   * Sticky invalid_key roster for healRoutes(): normalised ids plus original
   * metadata so classification-aware healing can clear false entries.
   */
  listInvalid(): Array<{ providerId: string; since: number; httpStatus: number; failureClass?: 'invalid_key' | 'protocol_error' }> {
    this.load();
    this.dropAgedEntries();
    return Array.from(this.invalid.entries()).map(([providerId, entry]) => ({
      providerId,
      since: entry.since,
      httpStatus: entry.httpStatus,
      failureClass: entry.failureClass
    }));
  }
}

export const providerHealthStore = new ProviderHealthStore();
