import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 2;

export const EditorPreferencesSchema = z.object({
  fontSize: z.number().int().min(8).max(36).optional(),
  tabSize: z.number().int().min(1).max(8).optional(),
  minimap: z.boolean().optional(),
  bracketPairs: z.boolean().optional(),
  autoSave: z.enum(['off', 'afterDelay', 'onFocusChange']).optional(),
  autoSaveDelay: z.number().int().min(100).max(60_000).optional(),
  wordWrap: z.enum(['off', 'on', 'wordWrapColumn', 'bounded']).optional(),
  formatOnSave: z.boolean().optional()
}).strict();

const TerminalProfileSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  shellId: z.string().min(1).max(128),
  customShellPath: z.string().max(4096).optional()
}).strict();

const LanguageServerConfigSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string().max(500)).max(64).optional(),
  path: z.string().max(4096).optional()
}).strict();

const LanguageServersSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  LanguageServerConfigSchema
);

export const SecurityPolicySettingsSchema = z.object({
  terminalPolicy: z.enum(['always-ask', 'always-proceed', 'restricted']),
  fileAccessPolicy: z.enum(['workspace-only', 'system-access']),
  systemAccessConfirmed: z.boolean(),
  reviewPolicy: z.enum(['always-ask', 'auto-apply-safe'])
}).strict();

// Eight validated categories: provider, model, routing, terminal, editor,
// language-server, extension, and security settings.
export const ProviderSettingsSchema = z.object({
  activeProvider: z.string().min(1).max(128),
  apiKeys: z.record(z.string().min(1).max(128), z.string().max(16_384).optional()),
  customEndpoints: z.record(z.string().min(1).max(128), z.string().max(4096).optional())
}).strip();

export const ModelSettingsSchema = z.object({
  activeModel: z.string().min(1).max(512),
  activeHarness: z.enum([
    'claude-code', 'codex', 'opencode', 'pi', 'cline', 'aider', 'hermes',
    'deepseek', 'grok-build', 'muse-code', 'vscode-chat'
  ]).optional(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(512).max(65_536)
}).strip();

export const RoutingSettingsSchema = z.object({
  routingStrategy: z.enum(['auto', 'free-first', 'fastest', 'balanced', 'manual']),
  enableFailover: z.boolean(),
  maxFailoverRetries: z.number().int().min(0).max(10),
  healthMonitoringEnabled: z.boolean(),
  healthCheckIntervalMs: z.number().int().min(5_000).max(3_600_000)
}).strip();

export const TerminalSettingsSchema = z.object({
  terminalProfiles: z.array(TerminalProfileSchema).max(32),
  defaultTerminalProfileId: z.string().max(128)
}).strip();

export const EditorSettingsSchema = z.object({
  'editor.reviewPolicy': z.enum(['alwaysReview', 'autoApplySafeSingleFile']),
  editor: EditorPreferencesSchema
}).strip();

export const LanguageServerSettingsSchema = z.object({
  'lsp.autoStart': z.boolean(),
  languageServers: LanguageServersSchema
}).strip();

export const ExtensionSettingsSchema = z.object({
  thirdPartyRuntimeEnabled: z.boolean()
}).strip();

export const SecuritySettingsSchema = z.object({
  security: SecurityPolicySettingsSchema
}).strip();

export const SettingsSchema = ProviderSettingsSchema
  .merge(ModelSettingsSchema)
  .merge(RoutingSettingsSchema)
  .merge(TerminalSettingsSchema)
  .merge(EditorSettingsSchema)
  .merge(LanguageServerSettingsSchema)
  .merge(ExtensionSettingsSchema)
  .merge(SecuritySettingsSchema);

export const SettingsPatchSchema = SettingsSchema.partial().extend({
  editor: EditorPreferencesSchema.partial().optional(),
  languageServers: LanguageServersSchema.optional(),
  security: SecurityPolicySettingsSchema.partial().optional()
});

// Workspace settings can override non-secret values only. System access is a
// global opt-in and cannot be enabled by a project-local settings file.
export const WorkspaceSettingsSchema = SettingsPatchSchema
  .omit({ apiKeys: true })
  .extend({
    security: SecurityPolicySettingsSchema.partial().omit({ systemAccessConfirmed: true }).optional()
  })
  .strip();

export type SettingsData = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type WorkspaceSettingsPatch = z.infer<typeof WorkspaceSettingsSchema>;
export type SecurityPolicySettings = z.infer<typeof SecurityPolicySettingsSchema>;
export type SettingsScope = 'global' | 'workspace';
