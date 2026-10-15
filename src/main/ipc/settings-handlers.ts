import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { IpcResponse, ProviderSettings, ProviderType } from '../../preload/types';
import {
  SecurityPolicySettingsSchema,
  SettingsPatchSchema,
  type SecurityPolicySettings,
  type SettingsData,
  type SettingsScope,
  type WorkspaceSettingsPatch
} from '../../shared/types/settings';
import { migrateProviderSettings } from '../services/orchestration/migration';
import { settingsManager } from '../services/settings-manager';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-code-settings.json');
const LEGACY_SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-claude-settings.json');
const LanguageServerConfigSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string().max(500)).max(64).optional(),
  path: z.string().max(4096).optional()
}).strict();
const LanguageServersSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), LanguageServerConfigSchema);

type StoredCredentialSettings = { apiKeys?: Partial<Record<ProviderType, string>> };

function encryptSecret(secret: string): string {
  if (!secret) return '';
  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(secret).toString('base64');
  }
  return Buffer.from(`safestorage_fallback:${Buffer.from(secret).toString('base64')}`).toString('base64');
}

function decryptSecret(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64')); }
    catch { /* Try the explicit test/headless fallback below. */ }
  }
  try {
    const raw = Buffer.from(encryptedBase64, 'base64').toString('utf8');
    return raw.startsWith('safestorage_fallback:')
      ? Buffer.from(raw.slice('safestorage_fallback:'.length), 'base64').toString('utf8')
      : '';
  } catch {
    return '';
  }
}

async function readStoredCredentials(): Promise<{ parsed: Record<string, unknown>; keys: Record<string, string> }> {
  let raw: string | null = null;
  for (const filePath of [SETTINGS_FILE, LEGACY_SETTINGS_FILE]) {
    try { raw = await fs.readFile(filePath, 'utf8'); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!raw) return { parsed: {}, keys: {} };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Legacy settings document must be a JSON object.');
  const parsed = value as Record<string, unknown>;
  const storedKeys = parsed.apiKeys && typeof parsed.apiKeys === 'object' && !Array.isArray(parsed.apiKeys)
    ? parsed.apiKeys as StoredCredentialSettings['apiKeys']
    : {};
  const keys: Record<string, string> = {};
  for (const [provider, secret] of Object.entries(storedKeys || {})) {
    if (typeof secret === 'string') keys[provider] = decryptSecret(secret);
  }
  return { parsed, keys };
}

async function writeStoredCredentials(apiKeys: Record<string, string>): Promise<void> {
  const encrypted: Record<string, string> = {};
  for (const [provider, secret] of Object.entries(apiKeys)) {
    if (typeof secret === 'string' && secret.trim()) encrypted[provider] = encryptSecret(secret.trim());
  }
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  const temporaryFile = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify({ apiKeys: encrypted }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, SETTINGS_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readEffectiveSettings(): Promise<ProviderSettings> {
  const { parsed, keys } = await readStoredCredentials();
  const legacySettings = migrateProviderSettings({ ...parsed, apiKeys: keys });
  await settingsManager.initializeFromLegacySettings(legacySettings);
  const effective: SettingsData = await settingsManager.getEffectiveSettings();
  return { ...effective, apiKeys: keys, apiKeysConfigured: undefined };
}

/** Renderer-safe settings: API key values are never returned over IPC. */
export async function getSettings(): Promise<IpcResponse<ProviderSettings>> {
  try {
    const settings = await readEffectiveSettings();
    const apiKeysConfigured: Partial<Record<ProviderType, boolean>> = {};
    for (const [provider, key] of Object.entries(settings.apiKeys)) apiKeysConfigured[provider as ProviderType] = Boolean(key);
    return { success: true, data: { ...settings, apiKeys: {}, apiKeysConfigured } };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Main-process-only provider settings, including decrypted credentials. */
export async function getProviderSettings(): Promise<IpcResponse<ProviderSettings>> {
  try { return { success: true, data: await readEffectiveSettings() }; }
  catch (error: unknown) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function getSettingsLayer(scope: SettingsScope): Promise<IpcResponse<SettingsData | WorkspaceSettingsPatch>> {
  try {
    await readEffectiveSettings();
    return { success: true, data: await settingsManager.getLayerSettings(scope) as SettingsData | WorkspaceSettingsPatch };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveSettingsLayer(scope: SettingsScope, updates: unknown): Promise<IpcResponse<void>> {
  try {
    await settingsManager.saveLayer(scope, updates);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSecurityPolicy(): Promise<IpcResponse<SecurityPolicySettings>> {
  try {
    const settings = await settingsManager.getEffectiveSettings();
    return { success: true, data: settings.security };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveSecurityPolicy(policy: Partial<SecurityPolicySettings>): Promise<IpcResponse<void>> {
  try {
    const current = await settingsManager.getLayerSettings('global') as SettingsData;
    const candidate = SecurityPolicySettingsSchema.safeParse({ ...current.security, ...policy });
    if (!candidate.success) throw new Error(candidate.error.issues[0]?.message || 'Security policy settings are invalid.');
    await settingsManager.saveLayer('global', { security: candidate.data });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveSettings(updates: Partial<ProviderSettings>): Promise<IpcResponse<void>> {
  try {
    const parsedPatch = SettingsPatchSchema.safeParse(updates);
    if (!parsedPatch.success) throw new Error(`Settings failed schema validation: ${parsedPatch.error.issues[0]?.message || 'invalid settings'}`);
    const { apiKeys, ...globalUpdates } = parsedPatch.data;
    await settingsManager.saveLayer('global', globalUpdates);

    if (apiKeys !== undefined) {
      const { keys } = await readStoredCredentials();
      const mergedKeys = { ...keys };
      for (const [provider, rawKey] of Object.entries(apiKeys)) {
        if (typeof rawKey === 'string' && rawKey.trim()) mergedKeys[provider as ProviderType] = rawKey.trim();
      }
      await writeStoredCredentials(mergedKeys);
    }
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
