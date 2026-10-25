import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 4;

export type SettingsErrorCode = 'VALIDATION' | 'IO' | 'PARSE' | 'LOCK';

export interface StructuredSettingsError {
  ok: false;
  code: SettingsErrorCode;
  message: string;
  detail: string;
}

/**
 * Classifies an error into a structured reason code with message and stack trace.
 */
export function classifySettingsError(error: unknown): { code: SettingsErrorCode; message: string; detail: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  const msg = err.message || 'Unknown settings error';
  const stack = err.stack || String(error);

  let code: SettingsErrorCode = 'IO';

  if (
    err.name === 'SyntaxError' ||
    /syntaxerror/i.test(msg) ||
    /unexpected token/i.test(msg) ||
    /is not valid json/i.test(msg)
  ) {
    code = 'PARSE';
  } else if (
    err.name === 'ZodError' ||
    /schema validation|validation|invalid settings|invalid input|\bexpected\b|unrecognized_keys/i.test(msg)
  ) {
    code = 'VALIDATION';
  } else if (
    /ebusy|eperm|locked|resource busy|lock/i.test(msg) ||
    (err as any).code === 'EBUSY' ||
    (err as any).code === 'EPERM'
  ) {
    code = 'LOCK';
  } else if (
    /enoent|eacces|enospc|io|file|write|read/i.test(msg) ||
    (err as any).code === 'ENOENT' ||
    (err as any).code === 'EACCES' ||
    (err as any).code === 'ENOSPC'
  ) {
    code = 'IO';
  }

  return { code, message: msg, detail: stack };
}

/**
 * Safe serialization: strips functions/undefined/Map/Set, converts BigInt,
 * and fails fast with a PARSE error if a non-serializable value is encountered.
 */
export function safeSerializeSettings(value: unknown): string {
  try {
    const replacer = (_key: string, val: unknown) => {
      if (typeof val === 'function' || typeof val === 'symbol') return undefined;
      if (val instanceof Map) return Object.fromEntries(val);
      if (val instanceof Set) return Array.from(val);
      if (typeof val === 'bigint') return val.toString();
      return val;
    };
    return JSON.stringify(value, replacer, 2);
  } catch (err: unknown) {
    const classified = classifySettingsError(err);
    const error = new Error(`Serialization failed: ${classified.message}`);
    (error as any).code = 'PARSE';
    (error as any).stack = classified.detail;
    throw error;
  }
}

/**
 * Versioned settings migration step for older settings documents.
 */
export function migrateSettingsDocument(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const migrated = { ...raw };

  if (version < 2) {
    if (!migrated.customEndpoints || typeof migrated.customEndpoints !== 'object') {
      migrated.customEndpoints = {};
    }
  }

  if (version < 3) {
    if (migrated.freeMode === undefined) migrated.freeMode = true;
    if (migrated.quotaAlertThreshold === undefined) migrated.quotaAlertThreshold = 80;
    if (migrated.autoRotateProviders === undefined) migrated.autoRotateProviders = true;
  }

  if (version < 4) {
    if (typeof migrated.defaultTerminalProfileId !== 'string') {
      migrated.defaultTerminalProfileId = '';
    }
    migrated.schemaVersion = SETTINGS_SCHEMA_VERSION;
  }

  return migrated;
}

export const EditorPreferencesSchema = z.object({
  fontSize: z.number().int().min(8).max(36).optional(),
  tabSize: z.number().int().min(1).max(8).optional(),
  minimap: z.boolean().optional(),
  bracketPairs: z.boolean().optional(),
  autoSave: z.enum(['off', 'afterDelay', 'onFocusChange']).optional(),
  autoSaveDelay: z.number().int().min(100).max(60_000).optional(),
  wordWrap: z.enum(['off', 'on', 'wordWrapColumn', 'bounded']).optional(),
  formatOnSave: z.boolean().optional(),
  // Chat typography & motion (Typography & Motion settings section)
  chatFontFamily: z.enum(['sans', 'serif', 'mono', 'plex']).optional(),
  chatFontSize: z.number().int().min(12).max(18).optional(),
  matrixDecodeEnabled: z.boolean().optional(),
  ukPunctuationEnabled: z.boolean().optional()
}).passthrough();

export const TerminalProfileSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  shellId: z.string().min(1).max(128),
  customShellPath: z.string().max(4096).optional()
}).passthrough();

export const LanguageServerConfigSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string().max(500)).max(64).optional(),
  path: z.string().max(4096).optional()
}).passthrough();

export const LanguageServersSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  LanguageServerConfigSchema
);

export const SecurityPolicySettingsSchema = z.object({
  terminalPolicy: z.enum(['always-ask', 'always-proceed', 'restricted']),
  fileAccessPolicy: z.enum(['workspace-only', 'system-access']),
  systemAccessConfirmed: z.boolean(),
  reviewPolicy: z.enum(['always-ask', 'auto-apply-safe'])
}).passthrough();

export const TelemetrySettingsSchema = z.object({
  enabled: z.boolean()
}).passthrough();

// Validated categories made forward-compatible with .passthrough()
export const ProviderSettingsSchema = z.object({
  activeProvider: z.string().min(1).max(128).default('auto'),
  apiKeys: z.record(z.string().min(1).max(128), z.string().max(16_384).optional()).default({}),
  customEndpoints: z.record(z.string().min(1).max(128), z.string().max(4096).optional()).default({}),
  offlineDemoMode: z.boolean().optional(),
  hasCompletedOnboarding: z.boolean().optional(),
  fccEnabled: z.boolean().optional(),
  communityKeyBootstrap: z.record(z.string(), z.unknown()).optional(),
  performanceOptimization: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export const ModelSettingsSchema = z.object({
  activeModel: z.string().max(512).default(''),
  activeHarness: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(1).max(2_000_000).default(4096)
}).passthrough();

export const RoutingSettingsSchema = z.object({
  routingStrategy: z.enum(['auto', 'free-first', 'fastest', 'balanced', 'manual']).default('manual'),
  enableFailover: z.boolean().default(true),
  maxFailoverRetries: z.number().int().min(0).max(10).default(3),
  healthMonitoringEnabled: z.boolean().default(true),
  healthCheckIntervalMs: z.number().int().min(5_000).max(3_600_000).default(30_000)
}).passthrough();

export const TerminalSettingsSchema = z.object({
  terminalProfiles: z.array(TerminalProfileSchema).max(64).default([]),
  defaultTerminalProfileId: z.string().max(128).default('')
}).passthrough();

export const EditorSettingsSchema = z.object({
  'editor.reviewPolicy': z.string().default('alwaysReview'),
  editor: EditorPreferencesSchema.default({})
}).passthrough();

export const LanguageServerSettingsSchema = z.object({
  'lsp.autoStart': z.boolean().default(true),
  languageServers: LanguageServersSchema.default({})
}).passthrough();

export const ExtensionSettingsSchema = z.object({
  thirdPartyRuntimeEnabled: z.boolean().default(false)
}).passthrough();

export const SecuritySettingsSchema = z.object({
  security: SecurityPolicySettingsSchema.default({
    terminalPolicy: 'restricted',
    fileAccessPolicy: 'workspace-only',
    systemAccessConfirmed: false,
    reviewPolicy: 'always-ask'
  })
}).passthrough();

export const IntegrationModuleConfigSchema = z.object({
  enabled: z.boolean(),
  installedAt: z.number().optional(),
  customConfig: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export const IntegrationsSettingsSchema = z.object({
  integrations: z.record(z.string().min(1).max(128), z.boolean()).default({}),
  modules: z.record(z.string().min(1).max(128), IntegrationModuleConfigSchema).default({})
}).passthrough();

export const GeneralSettingsSchema = z.object({
  runInBackground: z.boolean().optional(),
  notifyOnBackgroundCompletion: z.boolean().optional(),
  notifyOnAttentionNeeded: z.boolean().optional(),
  freeMode: z.boolean().default(true),
  quotaAlertThreshold: z.number().min(0).max(100).default(80),
  autoRotateProviders: z.boolean().default(true),
  schemaVersion: z.number().default(SETTINGS_SCHEMA_VERSION)
}).passthrough();

export const SettingsSchema = ProviderSettingsSchema
  .merge(ModelSettingsSchema)
  .merge(RoutingSettingsSchema)
  .merge(TerminalSettingsSchema)
  .merge(EditorSettingsSchema)
  .merge(LanguageServerSettingsSchema)
  .merge(ExtensionSettingsSchema)
  .merge(SecuritySettingsSchema)
  .merge(IntegrationsSettingsSchema)
  .merge(GeneralSettingsSchema)
  .merge(z.object({ telemetry: TelemetrySettingsSchema.default({ enabled: false }) }))
  .passthrough();

export const SettingsPatchSchema = SettingsSchema.partial().extend({
  editor: EditorPreferencesSchema.partial().optional(),
  languageServers: LanguageServersSchema.optional(),
  security: SecurityPolicySettingsSchema.partial().optional(),
  telemetry: TelemetrySettingsSchema.partial().optional()
}).passthrough();

export const WorkspaceSettingsSchema = SettingsPatchSchema
  .omit({ apiKeys: true, telemetry: true })
  .extend({
    security: SecurityPolicySettingsSchema.partial().omit({ systemAccessConfirmed: true }).optional()
  })
  .passthrough();

export type SettingsData = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type WorkspaceSettingsPatch = z.infer<typeof WorkspaceSettingsSchema>;
export type SecurityPolicySettings = z.infer<typeof SecurityPolicySettingsSchema>;
export type TelemetrySettings = z.infer<typeof TelemetrySettingsSchema>;
export type SettingsScope = 'global' | 'workspace';
