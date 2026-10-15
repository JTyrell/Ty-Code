/**
 * OmniRoute Auto Strategy
 * Selects the optimal provider and model based on the active task type,
 * required capabilities (tool execution, reasoning), and real-time health score.
 */

import type { ConnectionPool } from '../connection-pool';
import type { ProviderCandidate, RoutingContext, RoutingStrategy } from './types';

export class AutoStrategy implements RoutingStrategy {
  public readonly name = 'auto';

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
    const task = context.taskType || 'coding';

    let bestCandidate: ProviderCandidate | null = null;
    let highestScore = -Infinity;

    for (const c of eligible) {
      let score = pool.getHealthScore(c.provider.id);

      // Capability matching bonus
      if (context.requiredCapabilities?.tools) {
        if (!c.model.capabilities.tools) score -= 40;
        else score += 15;
      }

      if (context.requiredCapabilities?.reasoning) {
        if (!c.model.capabilities.reasoning) score -= 30;
        else score += 25;
      }

      // Context window capacity check
      const requiredContext = context.requiredCapabilities?.minContextWindow ?? context.promptTokensEstimate ?? 4000;
      if (c.model.contextWindow < requiredContext) {
        score -= 50;
      }

      // Task affinity
      switch (task) {
        case 'coding':
          score += (c.model.capabilities.codingScore ?? 50) * 0.4;
          if (c.model.primaryTask === 'coding') score += 15;
          break;
        case 'reasoning':
          if (c.model.capabilities.reasoning) score += 30;
          score += (c.model.capabilities.codingScore ?? 50) * 0.2;
          break;
        case 'fast-edit':
          const speed = c.model.capabilities.speedTokensPerSec ?? 50;
          score += Math.min(30, speed * 0.1);
          break;
        case 'general':
          score += 10;
          break;
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = c;
      }
    }

    return bestCandidate || eligible[0] || null;
  }
}
