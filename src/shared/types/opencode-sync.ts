/**
 * OpenCode Integration & Provider Sync Types (Phase 6.3)
 *
 * Provides type contracts for:
 * 1. OpenCode provider & model synchronization
 * 2. OpenCode free tier discovery & catalog integration
 * 3. OpenCode autonomous agent harnesses (Build, Plan, General)
 * 4. Agent framework selection (Ty-Code Native vs OpenCode)
 *
 * Brand: Ty-Code
 */

export interface OpenCodeProviderConfig {
  id: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
  isCustom?: boolean;
  isFree?: boolean;
  headers?: Record<string, string>;
}

export interface OpenCodeConfig {
  version?: string;
  defaultProvider?: string;
  defaultModel?: string;
  providers?: Record<string, OpenCodeProviderConfig | Record<string, unknown>>;
  customProviders?: Record<string, OpenCodeProviderConfig>;
  keys?: Record<string, string>;
  mcpServers?: Record<string, unknown>;
  agentSettings?: {
    defaultMode?: 'build' | 'plan' | 'general';
    autoApproveReadOnly?: boolean;
  };
}

export interface OpenCodeDetectionResult {
  isInstalled: boolean;
  configPath?: string;
  providerCount: number;
  modelCount: number;
  freeModelCount: number;
  configuredProviders: string[];
  version?: string;
  lastSyncedAt?: number;
}

export interface OpenCodeFreeTierSummary {
  hasOpenRouterFree: boolean;
  openRouterFreeModels: string[];
  hasGroqFree: boolean;
  groqFreeModels: string[];
  hasCopilotFree: boolean;
  hasGeminiFree: boolean;
  geminiFreeModels: string[];
  hasOllamaLocal: boolean;
  ollamaModels: string[];
  customFreeProviders: string[];
  totalFreeModels: number;
}

/**
 * Ty-Code framework selector values.
 * 'collaborative' = Ty-Code Collaborative (native pair-programming engine)
 * 'autonomous'    = Ty-Code Autonomous (3-agent multi-harness engine)
 */
export type AgentFramework = 'collaborative' | 'autonomous';

export interface OpenCodeImportResult {
  success: boolean;
  importedProviders: string[];
  importedKeysCount: number;
  importedModelsCount: number;
  freeModelsFound: number;
  message?: string;
}
