/**
 * Route-trail parsing for the "No Hollow Bubbles" failure strip (Step 4).
 *
 * The gateway emits ONE consolidated route event per turn as a `status` chunk,
 * e.g. "[ROUTE] openrouter(degenerate) -> ty-code-free(ok)". We reuse the
 * existing status line (no new chunk type) and parse it here so a finalized
 * message can render "Empty response from {route} — tried {n} routes" with a
 * Details view of the full trail — WITHOUT ever fabricating model content.
 *
 * Kept standalone (no store/window imports) so it is trivially unit-testable
 * in a plain node environment, mirroring no-response-notice.ts.
 */

export interface RouteHop {
  providerId: string;
  outcome: string;
  attempts: number;
}

export interface ParsedRouteTrail {
  hops: RouteHop[];
  skips: string[];
  /** True only when the line carried a real "[ROUTE] " prefix. */
  recognized: boolean;
}

export interface RouteFailure {
  /** The route that last produced a non-ok (degenerate/fail) outcome. */
  route: string;
  /** Number of distinct routes actually attempted this turn. */
  triedCount: number;
  /** The raw consolidated trail line, for the Details view. */
  trail: string;
}

/** Parse the consolidated "[ROUTE] a(x) -> b(ok)" status line into hops. */
export function parseRouteTrail(line: string | undefined | null): ParsedRouteTrail {
  const empty: ParsedRouteTrail = { hops: [], skips: [], recognized: false };
  if (!line) return empty;
  const trimmed = String(line).trim();
  if (!trimmed.startsWith('[ROUTE]')) return empty;
  const body = trimmed.replace(/^\[ROUTE\]\s*/, '').trim();
  if (!body) return { hops: [], skips: [], recognized: true };

  const hops: RouteHop[] = [];
  const skips: string[] = [];
  for (const rawSeg of body.split('->')) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    const match = /^(.*?)\(([^()]+)\)$/.exec(seg);
    if (match) {
      const providerId = match[1].trim();
      let outcome = match[2].trim();
      let attempts = 1;
      const xMatch = /^(.*?)x(\d+)$/i.exec(outcome);
      if (xMatch) {
        outcome = xMatch[1].trim();
        attempts = Math.max(1, parseInt(xMatch[2], 10) || 1);
      }
      if (outcome === 'skip') {
        if (providerId && !skips.includes(providerId)) skips.push(providerId);
        continue;
      }
      if (providerId) hops.push({ providerId, outcome, attempts });
    } else {
      // Bare provider (no parenthetical) — treat as a hop with unknown outcome.
      hops.push({ providerId: seg, outcome: 'unknown', attempts: 1 });
    }
  }
  return { hops, skips, recognized: true };
}

function isFailureOutcome(outcome: string): boolean {
  return outcome !== 'ok' && outcome !== 'skip' && outcome !== '';
}

/**
 * Build the failure-strip descriptor from a trail line. Falls back to the
 * live task route (currentTaskProviderId) when no trail was emitted (a single
 * degenerate route that never failed over still needs a named route).
 */
export function buildRouteFailure(
  trailLine: string | undefined | null,
  fallbackRoute: string
): RouteFailure {
  const { hops } = parseRouteTrail(trailLine);
  let route = (fallbackRoute || 'the provider').trim() || 'the provider';
  let triedCount = 0;
  let trail = (trailLine || '').trim();

  if (hops.length > 0) {
    triedCount = hops.length;
    const lastFailure = [...hops].reverse().find((h) => isFailureOutcome(h.outcome));
    if (lastFailure) route = lastFailure.providerId;
    if (!trail) trail = `[ROUTE] ${hops.map((h) => `${h.providerId}(${h.outcome})`).join(' -> ')}`;
  } else {
    triedCount = 1;
  }

  return { route, triedCount, trail };
}
