/**
 * OmniRoute Manual Strategy
 * Routes to the specific provider and model selected by the user.
 * If the selected provider is failing/cooling down and failover is required,
 * falls back to a compatible alternative.
 */

import type { ConnectionPool } from '../connection-pool';
import type { ProviderCandidate, RoutingContext, RoutingStrategy } from './types';
import { AutoStrategy } from './auto-strategy';

export class ManualStrategy implements RoutingStrategy {
  public readonly name = 'manual';
  private autoFallback = new AutoStrategy();

  public select(
    candidates: ProviderCandidate[],
    context: RoutingContext,
    pool: ConnectionPool
  ): ProviderCandidate | null {
    if (!candidates.length) return null;

    const manual = context.manualSelection;
    if (manual) {
      // Find candidate matching explicit user selection
      const matched = candidates.find(
        (c) => c.provider.id === manual.providerId && c.model.id === manual.modelId
      );

      // If matched, not excluded, and not cooling down, return it directly
      if (
        matched &&
        !context.excludedProviders?.has(matched.provider.id) &&
        pool.isAvailable(matched.provider.id)
      ) {
        return matched;
      }

      // If matched by provider only and available
      const providerMatched = candidates.find(
        (c) =>
          c.provider.id === manual.providerId &&
          !context.excludedProviders?.has(c.provider.id) &&
          pool.isAvailable(c.provider.id)
      );
      if (providerMatched) return providerMatched;
    }

    // If manual target is in cooldown or excluded during failover, fall back to best candidate
    return this.autoFallback.select(candidates, context, pool);
  }
}
