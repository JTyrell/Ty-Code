/**
 * Free Provider & Model Curation Types (Phase 6.1)
 *
 * Provides strong typing for:
 * 1. Permanent Free Provider Registry (OpenRouter, Groq, OpenKilo, Hugging Face, Together AI, Fireworks AI, Google AI Studio, Anthropic Claude via FCC, OpenCode)
 * 2. Model Tier Classification (Tier S Reasoning, Tier A Coding, Tier B General, Tier C Fast)
 * 3. Provider Health Monitoring (latency, success rate, cooldowns, auto-disabling)
 *
 * Brand: Ty-Code
 */

export type FreeProviderId =
  | 'openrouter-free'
  | 'groq-free'
  | 'openkilo-free'
  | 'huggingface-free'
  | 'together-ai-free'
  | 'fireworks-ai-free'
  | 'google-ai-studio-free'
  | 'anthropic-claude-free'
  | 'opencode-built-in';

export type FreeAuthType =
  | 'api_key_optional'
  | 'anonymous'
  | 'fcc_proxy'
  | 'opencode_integration';

export type ModelCapabilityCategory =
  | 'reasoning'
  | 'coding'
  | 'ultra_fast'
  | 'fast'
  | 'general'
  | 'large_context'
  | 'efficient'
  | 'multimodal'
  | 'inherited';

export interface FreeProviderCapabilities {
  reasoning?: string[];
  coding?: string[];
  ultra_fast?: string[];
  fast?: string[];
  general?: string[];
  large_context?: string[];
  efficient?: string[];
  multimodal?: string[];
  inherited?: string;
  [key: string]: string[] | string | undefined;
}

export interface FreeProvider {
  id: FreeProviderId;
  name: string;
  base_url: string;
  auth_type: FreeAuthType;
  best_free_models: string[];
  setup_instructions: string;
  model_capabilities: FreeProviderCapabilities;
  health_endpoint?: string;
  signup_url?: string;
}

export type ModelTier =
  | 'tier_s_reasoning'
  | 'tier_a_coding'
  | 'tier_b_general'
  | 'tier_c_fast';

export interface TierClassification {
  tier: ModelTier;
  name: string;
  description: string;
  models: string[];
  recommendedUseCases: string[];
}

export interface ProviderHealthStatus {
  providerId: FreeProviderId | string;
  isHealthy: boolean;
  lastChecked: number;
  latencyMs: number;
  successRate: number; // 0.0 to 1.0 (1.0 = 100%)
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  isRateLimited: boolean;
  cooldownUntil?: number;
  lastError?: string;
  autoDisabled: boolean;
}

export interface CuratedModelItem {
  providerId: FreeProviderId;
  providerName: string;
  modelId: string;
  tier: ModelTier;
  capabilities: ModelCapabilityCategory[];
  isAnonymous: boolean;
  requiresKey: boolean;
}
