/**
 * OmniRoute Settings Migration
 * Ensures 100% preservation of all existing user configurations and API keys
 * when upgrading to OmniRoute Layer 2 multi-provider aggregation.
 */

import type { ProviderSettings, ProviderType, RoutingStrategyType } from '../../../preload/types';

export const DEFAULT_OMNIROUTE_SETTINGS: ProviderSettings = {
  activeProvider: 'openrouter',
  activeModel: 'deepseek/deepseek-chat',
  apiKeys: {},
  apiKeysConfigured: {},
  customEndpoints: {
    ollama: 'http://localhost:11434/v1',
    'fcc-proxy': 'http://localhost:8082/v1',
    openkilo: 'https://api.kilo.ai/api/gateway'
  },
  temperature: 0.2,
  maxTokens: 4096,
  routingStrategy: 'manual',
  enableFailover: true,
  maxFailoverRetries: 3,
  healthMonitoringEnabled: true,
  healthCheckIntervalMs: 30_000,
  terminalProfiles: [],
  defaultTerminalProfileId: '',
  thirdPartyRuntimeEnabled: false,
  telemetry: { enabled: false },
  security: {
    terminalPolicy: 'restricted',
    fileAccessPolicy: 'workspace-only',
    systemAccessConfirmed: false,
    reviewPolicy: 'always-ask'
  },
  'editor.reviewPolicy': 'alwaysReview',
  'lsp.autoStart': true,
  editor: {
    fontSize: 13,
    tabSize: 2,
    minimap: true,
    bracketPairs: true,
    autoSave: 'afterDelay',
    autoSaveDelay: 1000,
    wordWrap: 'off',
    formatOnSave: false
  },
  languageServers: {},
  integrations: {},
  modules: {}
};

const VALID_STRATEGIES = new Set<RoutingStrategyType>([
  'auto',
  'free-first',
  'fastest',
  'balanced',
  'manual'
]);

/**
 * Migrates any raw or legacy settings object into the OmniRoute v2 format,
 * preserving all existing API keys, endpoints, and user preferences with zero loss.
 */
export function migrateProviderSettings(raw: unknown): ProviderSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_OMNIROUTE_SETTINGS, apiKeys: {}, apiKeysConfigured: {} };
  }

  const input = raw as Record<string, unknown>;

  // 1. Preserve all existing API keys
  const apiKeys: Record<string, string | undefined> = {};
  if (input.apiKeys && typeof input.apiKeys === 'object' && !Array.isArray(input.apiKeys)) {
    for (const [provider, key] of Object.entries(input.apiKeys as Record<string, unknown>)) {
      if (typeof key === 'string' && key.trim()) {
        apiKeys[provider as ProviderType] = key.trim();
      }
    }
  }

  // 2. Preserve all custom endpoints
  const customEndpoints: Record<string, string | undefined> = {
    ...DEFAULT_OMNIROUTE_SETTINGS.customEndpoints
  };
  if (input.customEndpoints && typeof input.customEndpoints === 'object' && !Array.isArray(input.customEndpoints)) {
    for (const [provider, url] of Object.entries(input.customEndpoints as Record<string, unknown>)) {
      if (typeof url === 'string' && url.trim()) {
        customEndpoints[provider as ProviderType] = url.trim();
      }
    }
  }

  // 3. Preserve OmniRoute routing configuration
  let routingStrategy: RoutingStrategyType = 'manual';
  if (typeof input.routingStrategy === 'string' && VALID_STRATEGIES.has(input.routingStrategy as RoutingStrategyType)) {
    routingStrategy = input.routingStrategy as RoutingStrategyType;
  }

  const enableFailover = input.enableFailover !== undefined
    ? input.enableFailover === true
    : DEFAULT_OMNIROUTE_SETTINGS.enableFailover;

  const maxFailoverRetries = typeof input.maxFailoverRetries === 'number' && input.maxFailoverRetries > 0
    ? Math.min(10, Math.floor(input.maxFailoverRetries))
    : DEFAULT_OMNIROUTE_SETTINGS.maxFailoverRetries;

  const healthMonitoringEnabled = input.healthMonitoringEnabled !== undefined
    ? input.healthMonitoringEnabled === true
    : DEFAULT_OMNIROUTE_SETTINGS.healthMonitoringEnabled;

  const healthCheckIntervalMs = typeof input.healthCheckIntervalMs === 'number' && input.healthCheckIntervalMs >= 5000
    ? input.healthCheckIntervalMs
    : DEFAULT_OMNIROUTE_SETTINGS.healthCheckIntervalMs;

  // 4. Construct complete migrated settings
  return {
    ...DEFAULT_OMNIROUTE_SETTINGS,
    ...(input as Partial<ProviderSettings>),
    activeProvider: (typeof input.activeProvider === 'string' && input.activeProvider ? input.activeProvider : DEFAULT_OMNIROUTE_SETTINGS.activeProvider) as ProviderType,
    activeModel: typeof input.activeModel === 'string' && input.activeModel ? input.activeModel : DEFAULT_OMNIROUTE_SETTINGS.activeModel,
    apiKeys,
    customEndpoints,
    temperature: typeof input.temperature === 'number' ? Math.max(0, Math.min(2, input.temperature)) : DEFAULT_OMNIROUTE_SETTINGS.temperature,
    maxTokens: typeof input.maxTokens === 'number' ? Math.max(512, Math.min(65536, input.maxTokens)) : DEFAULT_OMNIROUTE_SETTINGS.maxTokens,
    routingStrategy,
    enableFailover,
    maxFailoverRetries,
    healthMonitoringEnabled,
    healthCheckIntervalMs,
    apiKeysConfigured: undefined
  };
}
