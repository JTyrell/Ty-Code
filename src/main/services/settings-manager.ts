import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SETTINGS_SCHEMA_VERSION,
  classifySettingsError,
  safeSerializeSettings,
  migrateSettingsDocument,
  EditorSettingsSchema,
  ExtensionSettingsSchema,
  GeneralSettingsSchema,
  IntegrationsSettingsSchema,
  LanguageServerSettingsSchema,
  ModelSettingsSchema,
  ProviderSettingsSchema,
  RoutingSettingsSchema,
  SecuritySettingsSchema,
  SettingsPatchSchema,
  SettingsSchema,
  TelemetrySettingsSchema,
  TerminalSettingsSchema,
  WorkspaceSettingsSchema,
  type SettingsData,
  type SettingsPatch,
  type SettingsScope,
  type WorkspaceSettingsPatch
} from '../../shared/types/settings';
import { DEFAULT_OMNIROUTE_SETTINGS } from './orchestration/migration';

const DEFAULT_GLOBAL_SETTINGS_PATH = path.join(os.homedir(), '.ty-claude', 'settings.json');
const WORKSPACE_SETTINGS_RELATIVE_PATH = path.join('.ty-claude', 'settings.json');

export const DEFAULT_SECURITY_POLICY = {
  terminalPolicy: 'restricted',
  fileAccessPolicy: 'workspace-only',
  systemAccessConfirmed: false,
  reviewPolicy: 'always-ask'
} as const;

export const DEFAULT_SETTINGS: SettingsData = SettingsSchema.parse({
  ...DEFAULT_OMNIROUTE_SETTINGS,
  security: DEFAULT_SECURITY_POLICY,
  telemetry: { enabled: false }
});

export interface SettingsManagerOptions {
  globalSettingsPath?: string;
  workspacePath?: string;
  watchFiles?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGlobal(value: unknown): SettingsData {
  const raw = isRecord(value) ? value : {};
  const migrated = migrateSettingsDocument(raw);
  const source = isRecord(migrated.settings) ? migrated.settings : migrated;
  const defaults = SettingsSchema.parse(DEFAULT_SETTINGS);
  const endpointEntries = Object.entries(isRecord(source.customEndpoints) ? source.customEndpoints : {})
    .filter(([key, endpoint]) => key.length > 0 && key.length <= 128 && typeof endpoint === 'string' && endpoint.length <= 4096)
    .map(([key, endpoint]) => {
      if (typeof endpoint === 'string' && endpoint.includes('api.openkilo.com')) {
        return [key, 'https://api.kilo.ai/api/gateway'];
      }
      return [key, endpoint];
    });
  const categoryValues = [
    ProviderSettingsSchema.safeParse({
      activeProvider: typeof source.activeProvider === 'string' && source.activeProvider ? source.activeProvider : defaults.activeProvider,
      modelLock: isRecord(source.modelLock) ? source.modelLock : defaults.modelLock,
      apiKeys: {},
      customEndpoints: { ...defaults.customEndpoints, ...Object.fromEntries(endpointEntries) },
      offlineDemoMode: source.offlineDemoMode,
      hasCompletedOnboarding: source.hasCompletedOnboarding,
      fccEnabled: source.fccEnabled
    }),
    ModelSettingsSchema.safeParse({
      activeModel: typeof source.activeModel === 'string' && source.activeModel.length <= 512 ? source.activeModel : defaults.activeModel,
      ...(source.activeHarness === undefined ? {} : { activeHarness: source.activeHarness }),
      temperature: typeof source.temperature === 'number' ? source.temperature : defaults.temperature,
      maxTokens: typeof source.maxTokens === 'number' ? source.maxTokens : defaults.maxTokens
    }),
    RoutingSettingsSchema.safeParse({
      routingStrategy: source.routingStrategy ?? defaults.routingStrategy,
      enableFailover: source.enableFailover ?? defaults.enableFailover,
      maxFailoverRetries: source.maxFailoverRetries ?? defaults.maxFailoverRetries,
      healthMonitoringEnabled: source.healthMonitoringEnabled ?? defaults.healthMonitoringEnabled,
      healthCheckIntervalMs: source.healthCheckIntervalMs ?? defaults.healthCheckIntervalMs
    }),
    TerminalSettingsSchema.safeParse({
      terminalProfiles: source.terminalProfiles ?? defaults.terminalProfiles,
      defaultTerminalProfileId: typeof source.defaultTerminalProfileId === 'string' ? source.defaultTerminalProfileId : defaults.defaultTerminalProfileId
    }),
    EditorSettingsSchema.safeParse({
      'editor.reviewPolicy': source['editor.reviewPolicy'] ?? defaults['editor.reviewPolicy'],
      editor: { ...defaults.editor, ...(isRecord(source.editor) ? source.editor : {}) }
    }),
    LanguageServerSettingsSchema.safeParse({
      'lsp.autoStart': source['lsp.autoStart'] ?? defaults['lsp.autoStart'],
      languageServers: isRecord(source.languageServers) ? source.languageServers : defaults.languageServers
    }),
    ExtensionSettingsSchema.safeParse({
      thirdPartyRuntimeEnabled: source.thirdPartyRuntimeEnabled ?? defaults.thirdPartyRuntimeEnabled
    }),
    SecuritySettingsSchema.safeParse({
      security: { ...DEFAULT_SECURITY_POLICY, ...(isRecord(source.security) ? source.security : {}) }
    }),
    IntegrationsSettingsSchema.safeParse({
      integrations: isRecord(source.integrations) ? source.integrations : defaults.integrations,
      modules: isRecord(source.modules) ? source.modules : defaults.modules
    }),
    GeneralSettingsSchema.safeParse({
      runInBackground: source.runInBackground ?? defaults.runInBackground,
      notifyOnBackgroundCompletion: source.notifyOnBackgroundCompletion ?? defaults.notifyOnBackgroundCompletion,
      notifyOnAttentionNeeded: source.notifyOnAttentionNeeded ?? defaults.notifyOnAttentionNeeded,
      freeMode: source.freeMode ?? defaults.freeMode,
      quotaAlertThreshold: source.quotaAlertThreshold ?? defaults.quotaAlertThreshold,
      autoRotateProviders: source.autoRotateProviders ?? defaults.autoRotateProviders
    }),
    TelemetrySettingsSchema.safeParse({
      telemetry: { ...defaults.telemetry, ...(isRecord(source.telemetry) ? source.telemetry : {}) }
    })
  ];
  const normalized = { ...defaults };
  for (const category of categoryValues) {
    if (category.success) Object.assign(normalized, category.data);
  }
  return SettingsSchema.parse(normalized);
}

function mergeSettings(base: SettingsData, workspace: WorkspaceSettingsPatch): SettingsData {
  const security = { ...base.security, ...workspace.security };
  const terminalRank = { 'always-ask': 0, restricted: 1, 'always-proceed': 2 } as const;
  if (workspace.security?.terminalPolicy && terminalRank[workspace.security.terminalPolicy] > terminalRank[base.security.terminalPolicy]) {
    security.terminalPolicy = base.security.terminalPolicy;
  }
  if (workspace.security?.reviewPolicy === 'auto-apply-safe' && base.security.reviewPolicy !== 'auto-apply-safe') {
    security.reviewPolicy = base.security.reviewPolicy;
  }
  if (security.fileAccessPolicy === 'system-access'
    && (base.security.fileAccessPolicy !== 'system-access' || !base.security.systemAccessConfirmed)) {
    security.fileAccessPolicy = 'workspace-only';
  }
  return {
    ...base,
    ...workspace,
    apiKeys: base.apiKeys,
    customEndpoints: { ...base.customEndpoints, ...workspace.customEndpoints },
    editor: { ...base.editor, ...workspace.editor },
    languageServers: { ...base.languageServers, ...workspace.languageServers },
    security: { ...security, systemAccessConfirmed: base.security.systemAccessConfirmed },
    telemetry: base.telemetry
  };
}

export class SettingsManager {
  private readonly globalSettingsPath: string;
  private readonly watchFiles: boolean;
  private readonly events = new EventEmitter();
  private workspacePath: string | null = null;
  private globalSettings: SettingsData = SettingsSchema.parse(DEFAULT_SETTINGS);
  private workspaceSettings: WorkspaceSettingsPatch = {};
  private globalWatcher: FSWatcher | null = null;
  private workspaceWatcher: FSWatcher | null = null;
  private workspaceParentWatcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoadError: string | undefined;

  constructor(options: SettingsManagerOptions = {}) {
    this.globalSettingsPath = path.resolve(options.globalSettingsPath || DEFAULT_GLOBAL_SETTINGS_PATH);
    this.watchFiles = options.watchFiles !== false;
    if (options.workspacePath) this.workspacePath = path.resolve(options.workspacePath);
  }

  public getGlobalSettingsPath(): string {
    return this.globalSettingsPath;
  }

  public getWorkspaceSettingsPath(): string | null {
    return this.workspacePath ? path.join(this.workspacePath, WORKSPACE_SETTINGS_RELATIVE_PATH) : null;
  }

  public getLastLoadError(): string | undefined {
    return this.lastLoadError;
  }

  public onDidChange(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  public async setWorkspacePath(workspacePath: string): Promise<void> {
    const nextPath = path.resolve(workspacePath);
    if (this.workspacePath === nextPath) return;
    this.workspacePath = nextPath;
    this.closeWorkspaceWatchers();
    await this.refresh();
    await this.configureWorkspaceWatcher();
  }

  public async hasGlobalFile(): Promise<boolean> {
    try {
      await fs.access(this.globalSettingsPath);
      return true;
    } catch {
      return false;
    }
  }

  public async getLayerSettings(scope: SettingsScope): Promise<SettingsData | WorkspaceSettingsPatch> {
    await this.refresh();
    return scope === 'global' ? structuredClone(this.globalSettings) : structuredClone(this.workspaceSettings);
  }

  public async getEffectiveSettings(): Promise<SettingsData> {
    await this.refresh();
    return mergeSettings(this.globalSettings, this.workspaceSettings);
  }

  public async saveLayer(scope: SettingsScope, updates: unknown): Promise<void> {
    await this.refresh();
    if (scope === 'workspace' && isRecord(updates) && Object.prototype.hasOwnProperty.call(updates, 'telemetry')) {
      const err = new Error('Telemetry consent is global and cannot be changed by workspace settings.');
      (err as any).code = 'VALIDATION';
      throw err;
    }
    if (scope === 'global') {
      if (isRecord(updates) && Object.prototype.hasOwnProperty.call(updates, 'apiKeys')) {
        const err = new Error('Credentials must be saved through the secure provider settings channel.');
        (err as any).code = 'VALIDATION';
        throw err;
      }
      const patch = SettingsPatchSchema.safeParse(updates);
      if (!patch.success) {
        const firstIssue = patch.error.issues[0]?.message || 'invalid settings';
        const err = new Error(`Global settings failed schema validation: ${firstIssue}`);
        (err as any).code = 'VALIDATION';
        throw err;
      }
      const rawCandidate: Record<string, unknown> = {
        ...this.globalSettings,
        ...patch.data,
        apiKeys: {},
        customEndpoints: { ...this.globalSettings.customEndpoints, ...(patch.data.customEndpoints || {}) },
        editor: { ...this.globalSettings.editor, ...(patch.data.editor || {}) },
        languageServers: { ...this.globalSettings.languageServers, ...(patch.data.languageServers || {}) },
        security: { ...this.globalSettings.security, ...(patch.data.security || {}) },
        telemetry: { ...this.globalSettings.telemetry, ...(patch.data.telemetry || {}) }
      };
      // Clean up undefined values so they don't overwrite valid defaults
      for (const [k, v] of Object.entries(rawCandidate)) {
        if (v === undefined && (this.globalSettings as any)[k] !== undefined) {
          rawCandidate[k] = (this.globalSettings as any)[k];
        }
      }
      if (typeof rawCandidate.defaultTerminalProfileId !== 'string') {
        rawCandidate.defaultTerminalProfileId = '';
      }
      const next = SettingsSchema.safeParse(rawCandidate);
      if (!next.success) {
        const firstIssue = next.error.issues[0]?.message || 'invalid settings';
        const err = new Error(`Global settings failed schema validation: ${firstIssue}`);
        (err as any).code = 'VALIDATION';
        throw err;
      }
      // Echo suppression (Prompt: Break the Model-Sync Echo Loop): a no-op
      // save (identical content) must not fire the change event — every
      // 'change' fans out into renderer re-hydrations. Primitive content
      // comparison, same pattern as the file-watcher reload path below.
      const globalChanged = JSON.stringify(next.data) !== JSON.stringify(this.globalSettings);
      await this.writeFile(this.globalSettingsPath, next.data);
      this.globalSettings = next.data;
      if (globalChanged) this.events.emit('change');
      return;
    } else {
      if (!this.workspacePath) {
        const err = new Error('Select a workspace before saving workspace settings.');
        (err as any).code = 'IO';
        throw err;
      }
      const patch = WorkspaceSettingsSchema.safeParse(updates);
      if (!patch.success) {
        const firstIssue = patch.error.issues[0]?.message || 'invalid settings';
        const err = new Error(`Workspace settings failed schema validation: ${firstIssue}`);
        (err as any).code = 'VALIDATION';
        throw err;
      }
      const next = WorkspaceSettingsSchema.safeParse({
        ...this.workspaceSettings,
        ...patch.data,
        customEndpoints: { ...this.workspaceSettings.customEndpoints, ...patch.data.customEndpoints },
        editor: { ...this.workspaceSettings.editor, ...patch.data.editor },
        languageServers: { ...this.workspaceSettings.languageServers, ...patch.data.languageServers },
        security: { ...this.workspaceSettings.security, ...patch.data.security }
      });
      if (!next.success) {
        const firstIssue = next.error.issues[0]?.message || 'invalid settings';
        const err = new Error(`Workspace settings failed schema validation: ${firstIssue}`);
        (err as any).code = 'VALIDATION';
        throw err;
      }
      const workspaceChanged = JSON.stringify(next.data) !== JSON.stringify(this.workspaceSettings);
      await this.writeFile(await this.resolveWorkspaceSettingsPath(true), next.data);
      this.workspaceSettings = next.data;
      await this.configureWorkspaceWatcher();
      if (workspaceChanged) this.events.emit('change');
    }
  }

  public async initializeFromLegacySettings(settings: SettingsPatch): Promise<void> {
    if (await this.hasGlobalFile()) return;
    const { apiKeys: _apiKeys, ...nonSecret } = settings;
    await this.saveLayer('global', nonSecret);
  }

  private refreshInFlight: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  public refresh(): Promise<void> {
    // Coalesce concurrent refreshes so parallel callers don't race on a file being rewritten.
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshInner().finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }

  private async refreshInner(): Promise<void> {
    // Wait for pending writes so we never read a half-written file.
    await this.writeChain.catch(() => undefined);
    if (this.watchFiles) await this.configureGlobalWatcher();
    const before = JSON.stringify([this.globalSettings, this.workspaceSettings]);
    try {
      const raw = await fs.readFile(this.globalSettingsPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr: unknown) {
        // Step 3: Corrupted file recovery: back up broken file to settings.corrupt-{timestamp}.json
        const corruptTimestamp = Date.now();
        const backupPath = path.join(
          path.dirname(this.globalSettingsPath),
          `settings.corrupt-${corruptTimestamp}.json`
        );
        console.warn(`[SettingsManager] Corrupted settings JSON detected at ${this.globalSettingsPath}. Backing up to ${backupPath} and recovering to defaults:`, parseErr);
        try {
          await fs.writeFile(backupPath, raw, 'utf8');
        } catch (backupErr) {
          console.error('[SettingsManager] Failed writing corrupt backup:', backupErr);
        }
        this.globalSettings = SettingsSchema.parse(DEFAULT_SETTINGS);
        await this.writeFile(this.globalSettingsPath, this.globalSettings);
        return;
      }
      if (!isRecord(parsed)) throw new Error('Global settings root must be a JSON object.');
      this.globalSettings = normalizeGlobal(parsed);
      if (parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
        await this.writeFile(this.globalSettingsPath, this.globalSettings);
      }
      this.lastLoadError = undefined;
    } catch (error) {
      this.globalSettings = SettingsSchema.parse(DEFAULT_SETTINGS);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.lastLoadError = error instanceof Error ? error.message : String(error);
      }
    }

    try {
      const workspaceFile = await this.resolveWorkspaceSettingsPath(false);
      const raw = await fs.readFile(workspaceFile, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr: unknown) {
        const corruptTimestamp = Date.now();
        const backupPath = path.join(
          path.dirname(workspaceFile),
          `settings.corrupt-${corruptTimestamp}.json`
        );
        console.warn(`[SettingsManager] Corrupted workspace settings JSON at ${workspaceFile}. Backing up to ${backupPath} and resetting:`, parseErr);
        try {
          await fs.writeFile(backupPath, raw, 'utf8');
        } catch { }
        this.workspaceSettings = {};
        return;
      }
      if (!isRecord(parsed)) throw new Error('Workspace settings root must be a JSON object.');
      const { schemaVersion: _version, apiKeys: _apiKeys, ...clean } = parsed;
      const result = WorkspaceSettingsSchema.safeParse(clean);
      if (!result.success) throw new Error(result.error.issues[0]?.message || 'Workspace settings failed schema validation.');
      this.workspaceSettings = result.data;
      if (parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION) await this.writeFile(workspaceFile, result.data);
    } catch (error) {
      this.workspaceSettings = {};
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.lastLoadError = error instanceof Error ? error.message : String(error);
      }
    }

    if (before !== JSON.stringify([this.globalSettings, this.workspaceSettings])) this.events.emit('change');
  }

  public dispose(): void {
    this.globalWatcher?.close();
    this.globalWatcher = null;
    this.closeWorkspaceWatchers();
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.events.removeAllListeners();
  }

  private isContained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  private async resolveWorkspaceSettingsPath(createDirectory: boolean): Promise<string> {
    if (!this.workspacePath) throw new Error('Select a workspace before accessing workspace settings.');
    const root = await fs.realpath(this.workspacePath);
    const directory = path.join(root, '.ty-claude');
    if (createDirectory) await fs.mkdir(directory, { recursive: true });
    try {
      const realDirectory = await fs.realpath(directory);
      if (!this.isContained(root, realDirectory)) throw new Error('Workspace settings directory resolves outside the active workspace.');
      const filePath = path.join(realDirectory, 'settings.json');
      try {
        const realFilePath = await fs.realpath(filePath);
        if (!this.isContained(root, realFilePath)) throw new Error('Workspace settings file resolves outside the active workspace.');
        return realFilePath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return filePath;
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !createDirectory) return path.join(directory, 'settings.json');
      throw error;
    }
  }

  private writeFile(filePath: string, value: Record<string, unknown> | SettingsData | WorkspaceSettingsPatch): Promise<void> {
    const run = this.writeChain.catch(() => undefined).then(() => this.writeFileUnsafe(filePath, value));
    this.writeChain = run;
    return run;
  }

  private async writeFileUnsafe(filePath: string, value: Record<string, unknown> | SettingsData | WorkspaceSettingsPatch): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    const { apiKeys: _apiKeys, ...withoutSecrets } = value as Record<string, unknown>;
    const serialized = safeSerializeSettings({
      ...withoutSecrets,
      schemaVersion: SETTINGS_SCHEMA_VERSION
    });
    try {
      await fs.writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
      let renameSuccess = false;
      let lastRenameError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempPath, filePath);
          renameSuccess = true;
          break;
        } catch (renameErr) {
          lastRenameError = renameErr;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
      if (!renameSuccess) {
        throw lastRenameError;
      }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      const classified = classifySettingsError(error);
      const err = new Error(classified.message);
      (err as any).code = classified.code;
      (err as any).stack = classified.detail;
      throw err;
    }
  }

  private scheduleRefresh(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.refresh().catch((error: unknown) => {
        this.lastLoadError = error instanceof Error ? error.message : String(error);
      });
    }, 80);
  }

  private async configureGlobalWatcher(): Promise<void> {
    if (this.globalWatcher) return;
    const directory = path.dirname(this.globalSettingsPath);
    await fs.mkdir(directory, { recursive: true }).catch(() => undefined);
    try {
      this.globalWatcher = watch(directory, (_event, filename) => {
        if (!filename || filename.toString() === path.basename(this.globalSettingsPath)) this.scheduleRefresh();
      });
    } catch {
      // Settings remain readable on filesystems that do not support watching.
    }
  }

  private async configureWorkspaceWatcher(): Promise<void> {
    if (!this.watchFiles || !this.workspacePath) return;
    this.closeWorkspaceWatchers();
    const root = await fs.realpath(this.workspacePath).catch(() => null);
    if (!root) return;
    const directory = path.join(root, '.ty-claude');
    try {
      const realDirectory = await fs.realpath(directory);
      if (!this.isContained(root, realDirectory)) return;
      this.workspaceWatcher = watch(realDirectory, (_event, filename) => {
        if (!filename || filename.toString() === 'settings.json') this.scheduleRefresh();
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
      try {
        this.workspaceParentWatcher = watch(root, (_event, filename) => {
          if (!filename || filename.toString() === '.ty-claude') {
            this.scheduleRefresh();
            setTimeout(() => void this.configureWorkspaceWatcher(), 100);
          }
        });
      } catch {
        // Workspace files can still be read when a request refreshes settings.
      }
    }
  }

  private closeWorkspaceWatchers(): void {
    this.workspaceWatcher?.close();
    this.workspaceWatcher = null;
    this.workspaceParentWatcher?.close();
    this.workspaceParentWatcher = null;
  }
}

export const settingsManager = new SettingsManager();
