import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SETTINGS_SCHEMA_VERSION,
  SettingsPatchSchema,
  SettingsSchema,
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
  security: DEFAULT_SECURITY_POLICY
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
  const source = isRecord(raw.settings) ? raw.settings : raw;
  const { schemaVersion: _schemaVersion, apiKeys: _apiKeys, ...nonSecret } = source;
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...nonSecret,
    apiKeys: {},
    customEndpoints: { ...DEFAULT_SETTINGS.customEndpoints, ...(isRecord(source.customEndpoints) ? source.customEndpoints : {}) },
    editor: { ...DEFAULT_SETTINGS.editor, ...(isRecord(source.editor) ? source.editor : {}) },
    languageServers: isRecord(source.languageServers) ? source.languageServers : {},
    security: { ...DEFAULT_SECURITY_POLICY, ...(isRecord(source.security) ? source.security : {}) }
  };
  const parsed = SettingsSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const defaults = SettingsSchema.parse(DEFAULT_SETTINGS);
  const partial = SettingsPatchSchema.safeParse(nonSecret);
  if (!partial.success) return defaults;
  const fallback = SettingsSchema.safeParse({
    ...defaults,
    ...partial.data,
    apiKeys: {},
    customEndpoints: { ...defaults.customEndpoints, ...partial.data.customEndpoints },
    editor: { ...defaults.editor, ...partial.data.editor },
    languageServers: { ...defaults.languageServers, ...partial.data.languageServers },
    security: { ...defaults.security, ...partial.data.security }
  });
  return fallback.success ? fallback.data : defaults;
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
    security: { ...security, systemAccessConfirmed: base.security.systemAccessConfirmed }
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
    if (scope === 'global') {
      if (isRecord(updates) && Object.prototype.hasOwnProperty.call(updates, 'apiKeys')) {
        throw new Error('Credentials must be saved through the secure provider settings channel.');
      }
      const patch = SettingsPatchSchema.safeParse(updates);
      if (!patch.success) throw new Error(`Global settings failed schema validation: ${patch.error.issues[0]?.message || 'invalid settings'}`);
      const next = SettingsSchema.safeParse({
        ...this.globalSettings,
        ...patch.data,
        apiKeys: {},
        customEndpoints: { ...this.globalSettings.customEndpoints, ...patch.data.customEndpoints },
        editor: { ...this.globalSettings.editor, ...patch.data.editor },
        languageServers: { ...this.globalSettings.languageServers, ...patch.data.languageServers },
        security: { ...this.globalSettings.security, ...patch.data.security }
      });
      if (!next.success) throw new Error(`Global settings failed schema validation: ${next.error.issues[0]?.message || 'invalid settings'}`);
      await this.writeFile(this.globalSettingsPath, next.data);
      this.globalSettings = next.data;
    } else {
      if (!this.workspacePath) throw new Error('Select a workspace before saving workspace settings.');
      const patch = WorkspaceSettingsSchema.safeParse(updates);
      if (!patch.success) throw new Error(`Workspace settings failed schema validation: ${patch.error.issues[0]?.message || 'invalid settings'}`);
      const next = WorkspaceSettingsSchema.safeParse({
        ...this.workspaceSettings,
        ...patch.data,
        customEndpoints: { ...this.workspaceSettings.customEndpoints, ...patch.data.customEndpoints },
        editor: { ...this.workspaceSettings.editor, ...patch.data.editor },
        languageServers: { ...this.workspaceSettings.languageServers, ...patch.data.languageServers },
        security: { ...this.workspaceSettings.security, ...patch.data.security }
      });
      if (!next.success) throw new Error(`Workspace settings failed schema validation: ${next.error.issues[0]?.message || 'invalid settings'}`);
      await this.writeFile(await this.resolveWorkspaceSettingsPath(true), next.data);
      this.workspaceSettings = next.data;
      await this.configureWorkspaceWatcher();
    }
    this.events.emit('change');
  }

  public async initializeFromLegacySettings(settings: SettingsPatch): Promise<void> {
    if (await this.hasGlobalFile()) return;
    const { apiKeys: _apiKeys, ...nonSecret } = settings;
    await this.saveLayer('global', nonSecret);
  }

  public async refresh(): Promise<void> {
    if (this.watchFiles) await this.configureGlobalWatcher();
    const before = JSON.stringify([this.globalSettings, this.workspaceSettings]);
    try {
      const raw = await fs.readFile(this.globalSettingsPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
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
      const parsed: unknown = JSON.parse(raw);
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

  private async writeFile(filePath: string, value: Record<string, unknown> | SettingsData | WorkspaceSettingsPatch): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const { apiKeys: _apiKeys, ...withoutSecrets } = value as Record<string, unknown>;
    try {
      await fs.writeFile(tempPath, JSON.stringify({ ...withoutSecrets, schemaVersion: SETTINGS_SCHEMA_VERSION }, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
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
