/**
 * OmniRoute Strategies Index & Factory
 */

import type { RoutingStrategyType } from '../../../../preload/types';
import type { RoutingStrategy } from './types';
import { AutoStrategy } from './auto-strategy';
import { FreeFirstStrategy } from './free-first-strategy';
import { FastestStrategy } from './fastest-strategy';
import { BalancedStrategy } from './balanced-strategy';
import { ManualStrategy } from './manual-strategy';

export * from './types';
export * from './auto-strategy';
export * from './free-first-strategy';
export * from './fastest-strategy';
export * from './balanced-strategy';
export * from './manual-strategy';

const strategyInstances: Record<RoutingStrategyType, RoutingStrategy> = {
  auto: new AutoStrategy(),
  'free-first': new FreeFirstStrategy(),
  fastest: new FastestStrategy(),
  balanced: new BalancedStrategy(),
  manual: new ManualStrategy()
};

export function getRoutingStrategy(type: RoutingStrategyType = 'auto'): RoutingStrategy {
  return strategyInstances[type] || strategyInstances.auto;
}
