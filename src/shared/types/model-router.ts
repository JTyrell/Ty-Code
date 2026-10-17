/**
 * Intelligent Model Router Types (Phase 6.4)
 *
 * Types for:
 * 1. Task classification & intent detection
 * 2. Multi-factor model selection algorithm (tier, availability, health, latency, quota)
 * 3. User routing preferences (Auto, Fastest, Most Capable, Preferred Provider, Manual)
 * 4. Real-time mid-conversation switching
 *
 * Brand: Ty-Code
 */

import type { ModelTier, FreeProviderId } from './free-providers';
export type { ModelTier, FreeProviderId };

export type TaskType =
  | 'complex_reasoning'
  | 'code_generation'
  | 'code_editing'
  | 'general_chat'
  | 'quick_response';

export interface TaskTypeDefinition {
  type: TaskType;
  keywords: string[];
  best_tier: ModelTier;
  description: string;
}

export interface TaskClassificationResult {
  taskType: TaskType;
  bestTier: ModelTier;
  confidence: number;
  matchedKeywords: string[];
  rationale: string;
}

export type RoutingPreferenceMode =
  | 'auto'
  | 'fastest'
  | 'most_capable'
  | 'preferred_provider'
  | 'manual';

export interface RouterUserPreferences {
  mode: RoutingPreferenceMode;
  preferredProviderId?: FreeProviderId | string;
  manualModelId?: string;
  manualProviderId?: string;
  autoFailoverEnabled: boolean;
  maxFailoverAttempts: number;
  preferFreeModels: boolean;
}

export interface RankedModelCandidate {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  tier: ModelTier;
  isFree: boolean;
  latencyMs: number;
  healthScore: number; // 0.0 to 1.0
  isRateLimited: boolean;
  estimatedRemainingTokens?: number;
  compositeRankScore: number; // Higher is better
  selectionReason: string;
  provenance?: 'FCC' | 'your key' | 'anonymous' | 'subscription';
}

export interface ModelRoutingDecision {
  selectedModel: RankedModelCandidate;
  fallbackCandidates: RankedModelCandidate[];
  taskClassification: TaskClassificationResult;
  appliedPreferenceMode: RoutingPreferenceMode;
  timestamp: number;
}
