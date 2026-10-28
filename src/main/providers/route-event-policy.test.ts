/**
 * Unit tests for RouteEventPolicy — the single source of truth for what Main
 * may tell the renderer about provider routing.
 *
 * Covers the Prompt "Route Event Policy" verification surface:
 *   - classification matrix (SILENT / LEDGER_PLUS_ONCE / ACTIONABLE)
 *   - boot-time muting (policy not armed -> nothing emitted, ledger only)
 *   - LEDGER_PLUS_ONCE once-per-session hint + actionble re-arm on key save
 *   - exactly ONE consolidated [ROUTE] status trail per turn
 *   - consecutive retry attempts collapse into a single hop entry
 *   - sticky-health skips render as (skip) entries, deduped
 *   - [ROUTE-EVENTS] turn counter line reflects emitted counts + class tallies
 *
 * Local-only: the JSONL ledger resolves to null without Electron, so nothing
 * is written to disk from tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  routeEventPolicy,
  type KeyMissingContext,
  type RouteNotice
} from './route-event-policy';

function keyCtx(partial: Partial<KeyMissingContext>): KeyMissingContext {
  return {
    providerId: 'openrouter',
    apiKeyOptional: false,
    origin: 'auto',
    landedOnWorkingFree: true,
    ...partial
  };
}

describe('RouteEventPolicy classification', () => {
  beforeEach(() => routeEventPolicy.__resetForTest());
  afterEach(() => vi.restoreAllMocks());

  it('classifies explicit selection of an optional provider as SILENT', () => {
    expect(
      routeEventPolicy.classifyKeyMissing(keyCtx({ origin: 'explicit', apiKeyOptional: true }))
    ).toBe('SILENT');
  });

  it('classifies explicit selection of a keyed provider as ACTIONABLE', () => {
    expect(
      routeEventPolicy.classifyKeyMissing(keyCtx({ origin: 'explicit', apiKeyOptional: false }))
    ).toBe('ACTIONABLE');
  });

  it('classifies automatic misses that did not land on a working free tier as SILENT', () => {
    expect(
      routeEventPolicy.classifyKeyMissing(keyCtx({ origin: 'auto', landedOnWorkingFree: false }))
    ).toBe('SILENT');
  });

  it('classifies automatic misses with a free-tier landing on an optional provider as SILENT', () => {
    expect(
      routeEventPolicy.classifyKeyMissing(keyCtx({ origin: 'auto', apiKeyOptional: true, landedOnWorkingFree: true }))
    ).toBe('SILENT');
  });

  it('classifies automatic misses with a free-tier landing on a keyed provider as LEDGER_PLUS_ONCE', () => {
    expect(
      routeEventPolicy.classifyKeyMissing(keyCtx({ origin: 'auto', apiKeyOptional: false, landedOnWorkingFree: true }))
    ).toBe('LEDGER_PLUS_ONCE');
  });
});

describe('RouteEventPolicy emission gating', () => {
  beforeEach(() => routeEventPolicy.__resetForTest());
  afterEach(() => vi.restoreAllMocks());

  it('never emits before the first real turn writes a ledger record only', () => {
    const notice = routeEventPolicy.resolveKeyMissingNotice(
      keyCtx({ origin: 'auto', apiKeyOptional: false, landedOnWorkingFree: true })
    );
    expect(notice).toBeNull();
    const records = routeEventPolicy.getRecentRouteRecords();
    const last = records[records.length - 1];
    expect(last.class).toBe('LEDGER_PLUS_ONCE');
    expect(last.kind).toBe('key_missing');
  });

  it('emits the per-session unlock hint exactly once and never again', () => {
    routeEventPolicy.beginTurn('t-once');
    const ctx = keyCtx({ origin: 'auto', apiKeyOptional: false, landedOnWorkingFree: true });
    const first: RouteNotice | null = routeEventPolicy.resolveKeyMissingNotice(ctx, 't-once');
    expect(first).not.toBeNull();
    expect(first?.severity).toBe('info');
    expect(first?.class).toBe('LEDGER_PLUS_ONCE');
    expect(routeEventPolicy.resolveKeyMissingNotice(ctx, 't-once')).toBeNull();
  });

  it('keeps silent providers fully silent even mid-turn', () => {
    routeEventPolicy.beginTurn('t-silent');
    expect(
      routeEventPolicy.resolveKeyMissingNotice(
        keyCtx({ origin: 'auto', apiKeyOptional: true, landedOnWorkingFree: true }),
        't-silent'
      )
    ).toBeNull();
  });

  it('emits the actionable warning once per provider, re-armed by onKeySaved', () => {
    routeEventPolicy.beginTurn('t-actionable');
    const explicit = keyCtx({ origin: 'explicit', apiKeyOptional: false, providerId: 'OpenRouter' });
    const first = routeEventPolicy.resolveKeyMissingNotice(explicit, 't-actionable');
    expect(first).not.toBeNull();
    expect(first?.severity).toBe('warning');
    expect(first?.class).toBe('ACTIONABLE');
    expect(first?.title).toBe('Provider key missing');
    expect(first?.actionUrl).toBe('ty-code://settings/api-keys');

    expect(routeEventPolicy.resolveKeyMissingNotice(explicit, 't-actionable')).toBeNull();

    const other = routeEventPolicy.resolveKeyMissingNotice(
      keyCtx({ origin: 'explicit', providerId: 'Google' }),
      't-actionable'
    );
    expect(other).not.toBeNull();
    expect(other?.message).toContain('Google');

    routeEventPolicy.onKeySaved('openrouter');
    const rearmed = routeEventPolicy.resolveKeyMissingNotice(explicit, 't-actionable');
    expect(rearmed).not.toBeNull();
    expect(rearmed?.message).toContain('OpenRouter');
  });
});

describe('RouteEventPolicy consolidated trail', () => {
  beforeEach(() => routeEventPolicy.__resetForTest());
  afterEach(() => vi.restoreAllMocks());

  it('emits exactly one consolidated [ROUTE] line at done for a real failover', () => {
    routeEventPolicy.beginTurn('t-trail');
    routeEventPolicy.recordHop('t-trail', 'OpenRouter', 401);
    routeEventPolicy.recordHop('t-trail', 'Google', 401);
    routeEventPolicy.setLanding('t-trail', 'ty-code-free');
    const line = routeEventPolicy.finishTurn('t-trail', 'ty-code-free');
    expect(line).toBe('[ROUTE] openrouter(401) -> google(401) -> ty-code-free(ok)');
  });

  it('collapses consecutive retry attempts on the same provider into one hop', () => {
    routeEventPolicy.beginTurn('t-retry');
    routeEventPolicy.recordHop('t-retry', 'openrouter', 401);
    routeEventPolicy.recordHop('t-retry', 'openrouter', 403);
    routeEventPolicy.recordHop('t-retry', 'openrouter', 500);
    routeEventPolicy.setLanding('t-retry', 'ty-code-free');
    const line = routeEventPolicy.finishTurn('t-retry', 'ty-code-free');
    expect(line).toBe('[ROUTE] openrouter(500x3) -> ty-code-free(ok)');
  });

  it('renders sticky-health skips as deduped (skip) entries', () => {
    routeEventPolicy.beginTurn('t-skip');
    routeEventPolicy.recordSkip('t-skip', 'Google');
    routeEventPolicy.recordSkip('t-skip', 'google');
    routeEventPolicy.recordSkip('t-skip', 'Groq');
    routeEventPolicy.recordHop('t-skip', 'groq', 500);
    routeEventPolicy.setLanding('t-skip', 'ty-code-free');
    const line = routeEventPolicy.finishTurn('t-skip', 'ty-code-free');
    expect(line).toBe('[ROUTE] google(skip) -> groq(skip) -> groq(500) -> ty-code-free(ok)');
  });

  it('emits nothing on a later turn when sticky health skips dead providers (direct route)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Later turn: dead providers (burned during the first turn's hop records)
    // are skipped up-front via sticky health, so there are no failed hops and
    // nothing reaches the renderer — the trail only shows skips + the landing.
    routeEventPolicy.beginTurn('t-second-turn');
    routeEventPolicy.recordSkip('t-second-turn', 'openrouter');
    routeEventPolicy.recordSkip('t-second-turn', 'google');
    routeEventPolicy.recordHop('t-second-turn', 'ty-code-free', 'ok');
    routeEventPolicy.setLanding('t-second-turn', 'ty-code-free');
    expect(routeEventPolicy.finishTurn('t-second-turn', 'ty-code-free')).toBeNull();
    const counter = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.startsWith('[ROUTE-EVENTS] turn=t-second-turn'));
    expect(counter).toBe('[ROUTE-EVENTS] turn=t-second-turn emitted=0 classes={silent:3, once:0, actionable:0}');
  });

  it('returns null (no emission) for a direct route yet logs the counter', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    routeEventPolicy.beginTurn('t-direct');
    const line = routeEventPolicy.finishTurn('t-direct', 'ty-code-free');
    expect(line).toBeNull();
    const counter = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.startsWith('[ROUTE-EVENTS] turn=t-direct'));
    expect(counter).toBe('[ROUTE-EVENTS] turn=t-direct emitted=0 classes={silent:0, once:0, actionable:0}');
  });

  it('prints the [ROUTE-EVENTS] counter with emitted and class tallies on real failover', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    routeEventPolicy.beginTurn('t-counter');
    const ctx = keyCtx({ origin: 'auto', apiKeyOptional: false, landedOnWorkingFree: true });
    routeEventPolicy.resolveKeyMissingNotice(ctx, 't-counter');
    routeEventPolicy.recordHop('t-counter', 'openrouter', 401);
    routeEventPolicy.setLanding('t-counter', 'ty-code-free');
    routeEventPolicy.finishTurn('t-counter', 'ty-code-free');
    const counter = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.startsWith('[ROUTE-EVENTS] turn=t-counter'));
    // Exact checklist semantics: the once-per-session hint (once=1) plus the
    // single consolidated trail at done (emitted increments again) exactly once.
    expect(counter).toBe('[ROUTE-EVENTS] turn=t-counter emitted=2 classes={silent:1, once:1, actionable:0}');
  });

  it('cleans up turn state after finish (double finish and unknown turns are no-ops)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    routeEventPolicy.beginTurn('t-clean');
    routeEventPolicy.recordHop('t-clean', 'openrouter', 401);
    expect(routeEventPolicy.finishTurn('t-clean', 'ty-code-free')).not.toBeNull();
    expect(routeEventPolicy.finishTurn('t-clean', 'ty-code-free')).toBeNull();
    expect(routeEventPolicy.finishTurn('never-existed', 'ty-code-free')).toBeNull();
    expect(logSpy.mock.calls.filter((call) => String(call[0]).startsWith('[ROUTE'))).toHaveLength(2);
  });

  it('tolerates hop records that arrive with no turn in progress', () => {
    expect(() => routeEventPolicy.recordHop(undefined, 'OpenRouter', 401)).not.toThrow();
    expect(() => routeEventPolicy.recordSkip(undefined, 'Google')).not.toThrow();
    expect(() => routeEventPolicy.setLanding(undefined, 'ty-code-free')).not.toThrow();
  });
});

/** Parses the class tallies out of the [ROUTE-EVENTS] counter line. */
function parseClassTally(counter: string | undefined): void {
  const match = /classes=\{silent:(\d+), once:(\d+), actionable:(\d+)\}/.exec(counter ?? '');
  expect(match).not.toBeNull();
  if (!match) return;
  const [, silent, once, actionable] = match;
  expect(Number(silent)).toBeGreaterThanOrEqual(0);
  expect(once).toBe('1');
  expect(Number(actionable)).toBeGreaterThanOrEqual(0);
}
