/**
 * OmniRoute Strategy Types
 */

import type { ConnectionPool } from '../connection-pool';
import type { ModelMetadata, ProviderMetadata, TaskType } from '../provider-registry';
import type { RoutingStrategyType } from '../../../../preload/types';

export interface ProviderCandidate {
  provider: ProviderMetadata;
  model: ModelMetadata;
  customEndpoint?: string;
  apiKey?: string;
}

export interface RoutingContext {
  taskType?: TaskType;
  requiredCapabilities?: {
    tools?: boolean;
    reasoning?: boolean;
    minContextWindow?: number;
  };
  manualSelection?: {
    providerId: string;
    modelId: string;
  };
  promptTokensEstimate?: number;
  excludedProviders?: Set<string>;
}

export interface RoutingStrategy {
  readonly name: RoutingStrategyType;
  select(
    candidates: ProviderCandidate[],
    context: RoutingContext,
    pool: ConnectionPool
  ): ProviderCandidate | null;
}
