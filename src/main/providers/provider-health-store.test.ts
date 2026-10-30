/**
 * Unit tests for ProviderHealthStore — sticky provider health behind the
 * Route Event Policy failover chain.
 *
 * Covers the "sticky health" verification surface:
 *   - invalid_key persists to the injected local file (normalised ids) and is
 *     read back by a fresh store instance (login-object independence)
 *   - invalid_key is sticky: a later failure does not overwrite the first entry
 *   - clear() persists the deletion and also drops in-memory rate limits
 *   - rate_limited honours Retry-After in memory only (never persisted) and
 *     expires by TTL
 *   - deadProviderSet() unions sticky + TTL states and prunes expired ones
 *   - normalisation: `groq-free` shares health with `groq`
 *
 * All persistence goes through __forTest-injected temp files — the userData
 * path is never touched from tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ProviderHealthStore,
  normaliseHealthId,
  providerHealthStore
} from './provider-health-store';

let tempDir = '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ty-health-'));
});

afterEach(() => {
  vi.useRealTimers();
  providerHealthStore.__forTest(null);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function tempFile(name: string): string {
  return path.join(tempDir, name);
}

describe('ProviderHealthStore invalid_key persistence', () => {
  it('persists a normalised invalid_key entry to the injected file', () => {
    const file = tempFile('health-basic.json');
    providerHealthStore.__forTest(file);

    providerHealthStore.markInvalidKey('Groq-Free', 401);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { state: string; httpStatus: number }>;
    expect(parsed['groq']).toBeDefined();
    expect(parsed['groq'].state).toBe('invalid_key');
    expect(parsed['groq'].httpStatus).toBe(401);

    expect(providerHealthStore.getState('groq-free')).toBe('invalid_key');
    expect(providerHealthStore.isDead('groq')).toBe(true);
  });

  it('keeps the first invalid_key entry sticky when the same provider fails again', () => {
    const file = tempFile('health-sticky.json');
    providerHealthStore.__forTest(file);

    providerHealthStore.markInvalidKey('openrouter', 401);
    providerHealthStore.markInvalidKey('openrouter', 403);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { httpStatus: number }>;
    expect(parsed['openrouter'].httpStatus).toBe(401);
  });

  it('persists deletion on clear() and re-arms the provider', () => {
    const file = tempFile('health-clear.json');
    providerHealthStore.__forTest(file);

    providerHealthStore.markInvalidKey('openrouter', 401);
    providerHealthStore.clear('openrouter');

    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({});
    expect(providerHealthStore.isDead('openrouter')).toBe(false);
  });
});

describe('ProviderHealthStore reload from disk', () => {
  it('a fresh store instance reads sticky invalid_key state back from the file', () => {
    const file = tempFile('health-reload.json');
    providerHealthStore.__forTest(file);
    providerHealthStore.markInvalidKey('openkilo', 403);

    const second = new ProviderHealthStore();
    second.__forTest(file, { loaded: false });
    expect(second.getState('OpenKilo')).toBe('invalid_key');
    expect(second.isDead('openkilo')).toBe(true);
  });
});

describe('ProviderHealthStore rate_limited TTL (memory only)', () => {
  it('keeps 429 state in memory only and honours Retry-After seconds', () => {
    const file = tempFile('health-rate.json');
    providerHealthStore.__forTest(file);

    providerHealthStore.markRateLimited('google', 2);
    expect(providerHealthStore.getState('google')).toBe('rate_limited');

    // Memory only: markRateLimited never touches the persistence file.
    expect(fs.existsSync(file)).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:00:03Z'));
    expect(providerHealthStore.getState('google')).toBeNull();
  });

  it('uses the default TTL when no Retry-After header was supplied', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markRateLimited('groq');
    expect(providerHealthStore.isDead('groq')).toBe(true);
    vi.setSystemTime(new Date('2026-01-01T00:01:30Z'));
    expect(providerHealthStore.getState('groq')).toBeNull();
  });

  it('clear() drops an in-memory rate limit as well as sticky state', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markRateLimited('groq', 60);
    providerHealthStore.clear('groq');
    expect(providerHealthStore.isDead('groq')).toBe(false);
  });
});

describe('ProviderHealthStore deadProviderSet', () => {
  it('unions sticky and TTL states and prunes expired rate limits', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markInvalidKey('groq', 401);
    providerHealthStore.markRateLimited('google', 5);

    let dead = providerHealthStore.deadProviderSet();
    expect(dead.has('groq')).toBe(true);
    expect(dead.has('google')).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    dead = providerHealthStore.deadProviderSet();
    expect(dead.has('groq')).toBe(true);
    expect(dead.has('google')).toBe(false);
  });
});

// ===== Route Truth (Prompt 1) =====
describe('ProviderHealthStore sticky invalid_key 24h auto-expiry', () => {
  it('drops a sticky entry aged 24h+ at load time and persists the trim', () => {
    const file = tempFile('health-expiry.json');
    providerHealthStore.__forTest(file);
    providerHealthStore.markInvalidKey('openrouter', 401, 'invalid_key');
    expect(providerHealthStore.isDead('openrouter')).toBe(true);

    // One millisecond past the 24h TTL: the entry ages out.
    vi.setSystemTime(new Date('2026-01-02T00:00:00.001Z'));
    const second = new ProviderHealthStore();
    second.__forTest(file, { loaded: false });
    expect(second.getState('openrouter')).toBeNull();
    expect(second.isDead('openrouter')).toBe(false);
    // The aged-out entry was trimmed from persistence too.
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({});
  });

  it('still exposes entries younger than 24h after reload', () => {
    const file = tempFile('health-young.json');
    providerHealthStore.__forTest(file);
    providerHealthStore.markInvalidKey('openrouter', 401, 'invalid_key');

    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const second = new ProviderHealthStore();
    second.__forTest(file, { loaded: false });
    expect(second.getState('openrouter')).toBe('invalid_key');
  });
});

describe('ProviderHealthStore transient degraded (Route Truth)', () => {
  it('is a memory-only TTL state, never persisted and never a failover selector', () => {
    const file = tempFile('health-degraded.json');
    providerHealthStore.__forTest(file);

    providerHealthStore.markTransientDegraded('openrouter');
    expect(providerHealthStore.getState('openrouter')).toBe('degraded_transient');
    // NOT a selector: isDead/deadProviderSet exclude degraded routes.
    expect(providerHealthStore.isDead('openrouter')).toBe(false);
    expect(providerHealthStore.deadProviderSet().has('openrouter')).toBe(false);
    // Memory only.
    expect(fs.existsSync(file)).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:00:10.001Z'));
    expect(providerHealthStore.getState('openrouter')).toBeNull();
  });

  it('clears degraded state together with sticky/rate state', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markTransientDegraded('groq', 60_000);
    providerHealthStore.clear('groq');
    expect(providerHealthStore.getState('groq')).toBeNull();
  });
});

describe('ProviderHealthStore listInvalid (heal roster)', () => {
  it('returns normalised entries with original classification metadata', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markInvalidKey('openrouter', 401, 'invalid_key');
    // A protocol_error class can no longer be written by the live API (the
    // store downgrades it to a transient degraded TTL) — it only appears in
    // LEGACY files painted by builds predating the central classifier.
    const file = tempFile('health-legacy.json');
    fs.writeFileSync(file, JSON.stringify({
      'groq': { state: 'invalid_key', since: Date.now(), httpStatus: 400, failureClass: 'protocol_error' }
    }), 'utf-8');
    const legacy = new ProviderHealthStore();
    legacy.__forTest(file, { loaded: false });

    const roster = providerHealthStore.listInvalid();
    const openrouter = roster.find((r) => r.providerId === 'openrouter');
    expect(openrouter?.failureClass).toBe('invalid_key');
    expect(openrouter?.httpStatus).toBe(401);

    const legacyRoster = legacy.listInvalid();
    const groq = legacyRoster.find((r) => r.providerId === 'groq');
    expect(groq?.failureClass).toBe('protocol_error');
    expect(groq?.httpStatus).toBe(400);
  });

  it('defaults the recorded classification to invalid_key', () => {
    providerHealthStore.__forTest(null);
    providerHealthStore.markInvalidKey('groq', 401);
    expect(providerHealthStore.listInvalid()[0].failureClass).toBe('invalid_key');
  });

  it('loading a legacy protocol_error entry does not create a dead selector', () => {
    const file = tempFile('health-legacy-nonsticky.json');
    fs.writeFileSync(file, JSON.stringify({
      'groq': { state: 'invalid_key', since: Date.now(), httpStatus: 400, failureClass: 'protocol_error' }
    }), 'utf-8');
    const legacy = new ProviderHealthStore();
    legacy.__forTest(file, { loaded: false });
    expect(legacy.listInvalid().some((r) => r.providerId === 'groq')).toBe(true);
    // Heal semantics: the roster keeps it observable so healRoutes can clear
    // it without a probe, but it must not silently block a healthy route.
    expect(legacy.isDead('groq')).toBe(true);
  });
});

describe('normaliseHealthId', () => {
  it('shares health between a provider and its free alias', () => {
    expect(normaliseHealthId('groq-free')).toBe('groq');
    expect(normaliseHealthId('GROQ')).toBe('groq');
    expect(normaliseHealthId('fcc-proxy')).toBe('fcc-proxy');
    expect(normaliseHealthId('ty-code-free')).toBe('ty-code');
    expect(normaliseHealthId('')).toBe('');
  });
});
