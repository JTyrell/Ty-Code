/**
 * OmniRoute Free-First Strategy
 * Strictly prioritizes free-tier providers (local models, free community tiers, and zero-cost API endpoints)
 * when available, falling back to cost-optimized paid providers only if free tiers are unavailable or failing.
 */

import type { ConnectionPool } from '../connection-pool';
import type { ProviderCandidate, RoutingContext, RoutingStrategy } from './types';
import { AutoStrategy } from './auto-strategy';

export class FreeFirstStrategy implements RoutingStrategy {
  public readonly name = 'free-first';
  private autoFallback = new AutoStrategy();

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

    const poolToCheck = valid.length > 0 ? valid : candidates;

    // Filter free candidates
    const freeCandidates = poolToCheck.filter((c) =>
      c.model.capabilities.isFree ||
      c.model.costTier === 'free' ||
      c.provider.isFreeTierAvailable ||
      c.provider.category === 'local' ||
      c.provider.category === 'web_cookie'
    );

    if (freeCandidates.length > 0) {
      // Pick best free candidate using auto strategy scoring
      return this.autoFallback.select(freeCandidates, context, pool);
    }

    // Fall back to paid candidates using Auto strategy
    return this.autoFallback.select(poolToCheck, context, pool);
  }
}
