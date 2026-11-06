import { describe, expect, it } from 'vitest';
import { parseRouteTrail, buildRouteFailure } from './route-trail';

describe('parseRouteTrail (consolidated [ROUTE] line)', () => {
  it('parses a degenerate -> ok failover into ordered hops', () => {
    const { hops, skips, recognized } = parseRouteTrail('[ROUTE] openrouter(degenerate) -> ty-code-free(ok)');
    expect(recognized).toBe(true);
    expect(hops).toEqual([
      { providerId: 'openrouter', outcome: 'degenerate', attempts: 1 },
      { providerId: 'ty-code-free', outcome: 'ok', attempts: 1 }
    ]);
    expect(skips).toEqual([]);
  });

  it('extracts the retry attempt counter (xN) and collapses skips', () => {
    const { hops, skips } = parseRouteTrail('[ROUTE] dead(skip) -> groq(429x2) -> openkilo(ok)');
    expect(skips).toEqual(['dead']);
    expect(hops).toEqual([
      { providerId: 'groq', outcome: '429', attempts: 2 },
      { providerId: 'openkilo', outcome: 'ok', attempts: 1 }
    ]);
  });

  it('returns an empty parse for a non-[ROUTE] line', () => {
    expect(parseRouteTrail('Thinking…').recognized).toBe(false);
    expect(parseRouteTrail(undefined).hops).toEqual([]);
  });
});

describe('buildRouteFailure (failure strip descriptor)', () => {
  it('names the last failing route and counts distinct routes tried', () => {
    const f = buildRouteFailure('[ROUTE] openrouter(degenerate) -> ty-code-free(ok)', 'ty-code-free');
    expect(f.route).toBe('openrouter');
    expect(f.triedCount).toBe(2);
    expect(f.trail).toContain('openrouter(degenerate)');
  });

  it('reports an all-degenerate pool (no ok hop) as the last hollow route', () => {
    const f = buildRouteFailure('[ROUTE] openrouter(degenerate) -> groq(degenerate)', 'groq');
    expect(f.route).toBe('groq');
    expect(f.triedCount).toBe(2);
  });

  it('falls back to the live route with one attempt when no trail was emitted', () => {
    const f = buildRouteFailure('', 'ty-code-free');
    expect(f.route).toBe('ty-code-free');
    expect(f.triedCount).toBe(1);
  });
});
