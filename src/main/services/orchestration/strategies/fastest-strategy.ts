/**
 * OmniRoute Fastest Strategy
 * Routes to the lowest-latency provider based on real-time measured ping response times
 * and token streaming throughput.
 */

import type { ConnectionPool } from '../connection-pool';
import type { ProviderCandidate, RoutingContext, RoutingStrategy } from './types';

export class FastestStrategy implements RoutingStrategy {
  public readonly name = 'fastest';

  public select(
    candidates: ProviderCandidate[],
    context: RoutingContext,
    pool: ConnectionPool
  ): ProviderCandidate | null {
    if (!candidates.length) return null;

    // Filter out cooling down and excluded providers
    const valid = candidates.filter((c) => {
      if (context.excludedProviders?.has(c.provider.id)) return false;
      return pool.isAvailable(c.provider.id);
    });

    const eligible = valid.length > 0 ? valid : candidates;

    let fastest: ProviderCandidate | null = null;
    let lowestLatency = Infinity;

    for (const c of eligible) {
      const stats = pool.getStats(c.provider.id);
      const latency = stats?.latencyMs ?? 200;

      // Adjust with model throughput bonus (higher tokens/sec lowers effective latency)
      const speed = c.model.capabilities.speedTokensPerSec ?? 60;
      const effectiveScore = latency - (speed * 0.3);

      if (effectiveScore < lowestLatency) {
        lowestLatency = effectiveScore;
        fastest = c;
      }
    }

    return fastest || eligible[0] || null;
  }
}
