import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { IpcResponse, ProviderSettings, ProviderType, EditReviewPolicy, LanguageServerConfig } from '../../preload/types';
import { z } from 'zod';
import { migrateProviderSettings, DEFAULT_OMNIROUTE_SETTINGS } from '../services/orchestration/migration';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-code-settings.json');
const LEGACY_SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-claude-settings.json');

const EditorPreferencesSchema = z.object({
  fontSize: z.number().int().min(8).max(36).optional(),
  tabSize: z.number().int().min(1).max(8).optional(),
  minimap: z.boolean().optional(),
  bracketPairs: z.boolean().optional(),
  autoSave: z.enum(['off', 'afterDelay', 'onFocusChange']).optional(),
  autoSaveDelay: z.number().int().min(100).max(60_000).optional(),
  wordWrap: z.enum(['off', 'on', 'wordWrapColumn', 'bounded']).optional(),
  formatOnSave: z.boolean().optional()
}).strict();
const LanguageServerConfigSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string().max(500)).max(64).optional(),
  path: z.string().max(4096).optional()
}).strict();
const LanguageServersSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), LanguageServerConfigSchema);

function migrateLanguageServers(value: unknown): ProviderSettings['languageServers'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const migrated: Record<string, LanguageServerConfig> = {};
  for (const [languageId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const legacyCommand = typeof entry.command === 'string' && (path.isAbsolute(entry.command) || path.win32.isAbsolute(entry.command)) ? entry.command : undefined;
    const candidate = {
      enabled: entry.enabled !== false,
      ...(Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === 'string') ? { args: entry.args } : {}),
      ...(typeof entry.path === 'string' ? { path: entry.path } : typeof entry.customPath === 'string' ? { path: entry.customPath } : legacyCommand ? { path: legacyCommand } : {})
    };
    const parsed = LanguageServerConfigSchema.safeParse(candidate);
    if (parsed.success) migrated[languageId] = parsed.data;
  }
  return migrated;
}

const DEFAULT_SETTINGS: ProviderSettings = {
  ...DEFAULT_OMNIROUTE_SETTINGS
};

type StoredSettings = Partial<Omit<ProviderSettings, 'apiKeys' | 'apiKeysConfigured'>> & {
  apiKeys?: Partial<Record<ProviderType, string>>;
};

function encryptSecret(secret: string): string {
  if (!secret) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable. API keys were not saved.');
  }
  return safeStorage.encryptString(secret).toString('base64');
}

function decryptSecret(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  if (!safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
  } catch {
    // Never interpret legacy plaintext/base64 values as encrypted credentials.
    return '';
  }
}

async function readDecryptedSettings(): Promise<ProviderSettings> {
  try {
    let raw: string;
    try {
      raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    } catch {
      raw = await fs.readFile(LEGACY_SETTINGS_FILE, 'utf-8');
    }
    const parsed = JSON.parse(raw) as StoredSettings;
    const apiKeys: Partial<Record<ProviderType, string>> = {};
    for (const [provider, value] of Object.entries(parsed.apiKeys || {})) {
      if (typeof value === 'string') apiKeys[provider as ProviderType] = decryptSecret(value);
    }
    const migrated = migrateProviderSettings({
      ...parsed,
      apiKeys
    });
    return {
      ...migrated,
      thirdPartyRuntimeEnabled: parsed.thirdPartyRuntimeEnabled === true,
      'editor.reviewPolicy': parsed['editor.reviewPolicy'] === 'autoApplySafeSingleFile' ? 'autoApplySafeSingleFile' : 'alwaysReview',
      'lsp.autoStart': typeof parsed['lsp.autoStart'] === 'boolean' ? parsed['lsp.autoStart'] : DEFAULT_SETTINGS['lsp.autoStart'],
      editor: { ...DEFAULT_SETTINGS.editor, ...(EditorPreferencesSchema.safeParse(parsed.editor).success ? EditorPreferencesSchema.parse(parsed.editor) : {}) },
      languageServers: { ...DEFAULT_SETTINGS.languageServers, ...migrateLanguageServers(parsed.languageServers) },
      apiKeysConfigured: undefined
    };
  } catch {
    return { ...DEFAULT_SETTINGS, apiKeys: {}, apiKeysConfigured: undefined };
  }
}

/** Renderer-safe settings: API key values are never returned through IPC. */
export async function getSettings(): Promise<IpcResponse<ProviderSettings>> {
  try {
    const settings = await readDecryptedSettings();
    const apiKeysConfigured: Partial<Record<ProviderType, boolean>> = {};
    for (const [provider, key] of Object.entries(settings.apiKeys)) {
      apiKeysConfigured[provider as ProviderType] = Boolean(key);
    }
    return { success: true, data: { ...settings, apiKeys: {}, apiKeysConfigured } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Main-process-only provider settings, including decrypted credentials. */
export async function getProviderSettings(): Promise<IpcResponse<ProviderSettings>> {
  try {
    return { success: true, data: await readDecryptedSettings() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function saveSettings(updates: Partial<ProviderSettings>): Promise<IpcResponse<void>> {
  try {
    if (updates.thirdPartyRuntimeEnabled !== undefined && typeof updates.thirdPartyRuntimeEnabled !== 'boolean') {
      throw new Error('Third-party extension runtime preference must be boolean.');
    }
    if (updates['editor.reviewPolicy'] !== undefined && !['alwaysReview', 'autoApplySafeSingleFile'].includes(updates['editor.reviewPolicy'])) {
      throw new Error('Editor review policy is invalid.');
    }
    if (updates['lsp.autoStart'] !== undefined && typeof updates['lsp.autoStart'] !== 'boolean') throw new Error('LSP auto-start preference must be boolean.');
    const editorResult = updates.editor === undefined ? undefined : EditorPreferencesSchema.safeParse(updates.editor);
    if (editorResult && !editorResult.success) throw new Error('Editor settings are invalid.');
    const languageServersResult = updates.languageServers === undefined ? undefined : LanguageServersSchema.safeParse(updates.languageServers);
    if (languageServersResult && !languageServersResult.success) throw new Error('Language-server settings are invalid.');
    const current = await readDecryptedSettings();
    const apiKeys = { ...current.apiKeys };
    for (const [provider, rawKey] of Object.entries(updates.apiKeys || {})) {
      if (typeof rawKey === 'string' && rawKey.trim()) apiKeys[provider as ProviderType] = rawKey.trim();
    }

    const merged: ProviderSettings = {
      ...current,
      ...updates,
      apiKeys,
      customEndpoints: { ...current.customEndpoints, ...updates.customEndpoints },
      routingStrategy: updates.routingStrategy ?? current.routingStrategy ?? 'manual',
      enableFailover: updates.enableFailover !== undefined ? updates.enableFailover : current.enableFailover ?? true,
      maxFailoverRetries: updates.maxFailoverRetries ?? current.maxFailoverRetries ?? 3,
      healthMonitoringEnabled: updates.healthMonitoringEnabled !== undefined ? updates.healthMonitoringEnabled : current.healthMonitoringEnabled ?? true,
      healthCheckIntervalMs: updates.healthCheckIntervalMs ?? current.healthCheckIntervalMs ?? 30_000,
      terminalProfiles: updates.terminalProfiles ?? current.terminalProfiles,
      defaultTerminalProfileId: updates.defaultTerminalProfileId ?? current.defaultTerminalProfileId,
      'editor.reviewPolicy': updates['editor.reviewPolicy'] ?? current['editor.reviewPolicy'],
      'lsp.autoStart': updates['lsp.autoStart'] ?? current['lsp.autoStart'],
      editor: { ...current.editor, ...editorResult?.data },
      languageServers: { ...current.languageServers, ...languageServersResult?.data }
    };
    const encryptedKeys: Partial<Record<ProviderType, string>> = {};
    for (const [provider, rawKey] of Object.entries(merged.apiKeys)) {
      if (typeof rawKey === 'string' && rawKey.trim()) encryptedKeys[provider as ProviderType] = encryptSecret(rawKey);
    }

    const stored: StoredSettings = { ...merged, apiKeys: encryptedKeys };
    const temporaryFile = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(temporaryFile, JSON.stringify(stored, null, 2), 'utf-8');
    await fs.rename(temporaryFile, SETTINGS_FILE);
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}
