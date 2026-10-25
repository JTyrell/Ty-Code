/**
 * Sticky provider health.
 *
 * - `invalid_key` entries are persisted to a local file beside the settings
 *   store and stay sticky until the key is re-saved or re-tested successfully.
 *   The failover chain reads them at request time, so a dead provider is
 *   skipped entirely after its first failure (no re-walking, no re-emission).
 * - `rate_limited` entries honour Retry-After and live in memory only.
 *
 * Local-only: nothing in this module touches the network (Zero-Telemetry).
 */

import fs from 'fs';
import path from 'path';

export type ProviderHealthState = 'invalid_key' | 'rate_limited';

interface PersistedEntry {
  state: 'invalid_key';
  since: number;
  httpStatus: number;
}

const DEFAULT_RATE_LIMIT_TTL_MS = 60_000;

/** Same normalisation the agent engine uses: `groq-free` shares health with `groq`. */
export function normaliseHealthId(providerId: string): string {
  return (providerId || '').toLowerCase().trim().replace(/-free$/, '');
}

class ProviderHealthStore {
  private invalid = new Map<string, PersistedEntry>();
  private rateLimited = new Map<string, number>();
  private loaded = false;
  private filePath: string | null = null;

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
    } catch {
      // Missing or corrupt file: start clean.
    }
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

  /** Auth rejection (401/403): sticky until the key is re-saved or re-tested. */
  markInvalidKey(providerId: string, httpStatus: number): void {
    this.load();
    const id = normaliseHealthId(providerId);
    if (!id || this.invalid.has(id)) return;
    this.invalid.set(id, { state: 'invalid_key', since: Date.now(), httpStatus });
    this.persist();
  }

  /** Call when the user saves a key for the provider or a re-test succeeds. */
  clear(providerId: string): void {
    this.load();
    const id = normaliseHealthId(providerId);
    const had = this.invalid.delete(id);
    this.rateLimited.delete(id);
    if (had) this.persist();
  }

  /** 429: honour Retry-After (seconds) in memory only. */
  markRateLimited(providerId: string, retryAfterSec?: number): void {
    const id = normaliseHealthId(providerId);
    if (!id) return;
    const ttl = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : DEFAULT_RATE_LIMIT_TTL_MS;
    this.rateLimited.set(id, Date.now() + ttl);
  }

  getState(providerId: string): ProviderHealthState | null {
    this.load();
    const id = normaliseHealthId(providerId);
    if (this.invalid.has(id)) return 'invalid_key';
    const until = this.rateLimited.get(id);
    if (until && until > Date.now()) return 'rate_limited';
    if (until) this.rateLimited.delete(id);
    return null;
  }

  isDead(providerId: string): boolean {
    return this.getState(providerId) !== null;
  }

  /** Normalised ids that failover must skip right now. */
  deadProviderSet(): Set<string> {
    this.load();
    const dead = new Set<string>(this.invalid.keys());
    const now = Date.now();
    for (const [id, until] of this.rateLimited) {
      if (until > now) dead.add(id);
      else this.rateLimited.delete(id);
    }
    return dead;
  }
}

export const providerHealthStore = new ProviderHealthStore();
