/**
 * OmniRoute Balanced Strategy
 * Weighted round-robin routing based on provider reliability, success rate, and health score.
 * Distributes requests smoothly across active healthy providers while weighting towards
 * the most stable endpoints.
 */

import type { ConnectionPool } from '../connection-pool';
import type { ProviderCandidate, RoutingContext, RoutingStrategy } from './types';

export class BalancedStrategy implements RoutingStrategy {
  public readonly name = 'balanced';
  private roundRobinCounter = 0;

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
    if (eligible.length === 1) return eligible[0];

    // Compute health weights
    const weights = eligible.map((c) => {
      const score = pool.getHealthScore(c.provider.id);
      return Math.max(1, score);
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Weighted round-robin selection
    this.roundRobinCounter = (this.roundRobinCounter + 1) % 1_000_000;
    const threshold = this.roundRobinCounter % totalWeight;

    let accumulator = 0;
    for (let i = 0; i < eligible.length; i++) {
      accumulator += weights[i];
      if (accumulator > threshold) {
        return eligible[i];
      }
    }

    return eligible[0];
  }
}
