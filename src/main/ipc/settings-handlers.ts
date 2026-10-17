import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CredentialStorageStatus, IpcResponse, ProviderSettings, ProviderType } from '../../preload/types';
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

const getUserDataPath = (): string => {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // fallback if app is not yet initialized
  }
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Ty-Code')
    : path.join(process.env.HOME || process.cwd(), '.ty-code');
};

const SETTINGS_FILE = path.join(getUserDataPath(), 'ty-code-settings.json');
const LEGACY_SETTINGS_FILE = path.join(getUserDataPath(), 'ty-claude-settings.json');
const LanguageServerConfigSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string().max(500)).max(64).optional(),
  path: z.string().max(4096).optional()
}).strict();
const LanguageServersSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), LanguageServerConfigSchema);

type StoredCredentialSettings = { apiKeys?: Partial<Record<ProviderType, string>> };

export function getCredentialStorageStatus(): CredentialStorageStatus {
  let backend = process.platform === 'win32' ? 'windows_dpapi' : process.platform === 'darwin' ? 'macos_keychain' : 'unknown';
  if (process.platform === 'linux' && typeof safeStorage?.getSelectedStorageBackend === 'function') {
    backend = safeStorage.getSelectedStorageBackend();
  }
  const secureLinuxBackend = process.platform !== 'linux' || (backend !== 'basic_text' && backend !== 'unknown');
  const available = Boolean(safeStorage?.isEncryptionAvailable?.()) && secureLinuxBackend;
  const message = available
    ? 'Credentials are protected by the operating system credential store.'
    : process.platform === 'linux'
      ? 'Credential protection is unavailable. Install and configure libsecret (GNOME Secret Service) or a supported KWallet service, then restart Ty-Code. Credentials will not be saved until secure storage is available.'
      : 'Credential protection is unavailable. Credentials will not be saved until operating-system secure storage is available.';
  return { available, platform: process.platform, backend, message };
}

export function encryptSecret(secret: string): string {
  if (!secret) return '';
  if (!getCredentialStorageStatus().available) throw new Error(getCredentialStorageStatus().message);
  return `electron_safe_storage_v1:${safeStorage.encryptString(secret).toString('base64')}`;
}

function isLegacyBase64Fallback(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').toString('utf8').startsWith('safestorage_fallback:');
  } catch {
    return false;
  }
}

export function decryptSecret(encryptedValue: string): string {
  if (!encryptedValue) return '';
  const storage = getCredentialStorageStatus();
  if (!storage.available) return '';
  if (encryptedValue.startsWith('electron_safe_storage_v1:')) {
    return safeStorage.decryptString(Buffer.from(encryptedValue.slice('electron_safe_storage_v1:'.length), 'base64'));
  }
  if (isLegacyBase64Fallback(encryptedValue)) {
    const decoded = Buffer.from(encryptedValue, 'base64').toString('utf8');
    return Buffer.from(decoded.slice('safestorage_fallback:'.length), 'base64').toString('utf8');
  }
  // Older Electron safeStorage values were stored as untagged base64 buffers.
  return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
}

async function removeLegacyBase64Credentials(filePath: string, parsed: Record<string, unknown>): Promise<Record<string, unknown>> {
  const storedKeys = parsed.apiKeys && typeof parsed.apiKeys === 'object' && !Array.isArray(parsed.apiKeys)
    ? parsed.apiKeys as Record<string, unknown>
    : {};
  const retainedKeys = Object.fromEntries(Object.entries(storedKeys)
    .filter(([, value]) => typeof value !== 'string' || !isLegacyBase64Fallback(value)));
  const safeSettings = { ...parsed, apiKeys: retainedKeys };
  const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(safeSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, filePath);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
  return safeSettings;
}

export async function readStoredCredentials(): Promise<{ parsed: Record<string, unknown>; keys: Record<string, string> }> {
  let raw: string | null = null;
  let sourcePath = SETTINGS_FILE;
  for (const filePath of [SETTINGS_FILE, LEGACY_SETTINGS_FILE]) {
    try { raw = await fs.readFile(filePath, 'utf8'); sourcePath = filePath; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!raw) return { parsed: {}, keys: {} };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Legacy settings document must be a JSON object.');
  let parsed = value as Record<string, unknown>;
  const storedKeys = parsed.apiKeys && typeof parsed.apiKeys === 'object' && !Array.isArray(parsed.apiKeys)
    ? parsed.apiKeys as StoredCredentialSettings['apiKeys']
    : {};
  const keys: Record<string, string> = {};
  let migrateLegacyFallback = false;
  let removeLegacyFallback = false;
  const secureStorageAvailable = getCredentialStorageStatus().available;
  for (const [provider, secret] of Object.entries(storedKeys || {})) {
    if (typeof secret !== 'string') continue;
    if (isLegacyBase64Fallback(secret)) {
      if (secureStorageAvailable) {
        migrateLegacyFallback = true;
        keys[provider] = decryptSecret(secret);
      } else {
        removeLegacyFallback = true;
      }
      continue;
    }
    keys[provider] = decryptSecret(secret);
  }
  if (removeLegacyFallback) parsed = await removeLegacyBase64Credentials(sourcePath, parsed);
  if (migrateLegacyFallback) {
    if (sourcePath !== SETTINGS_FILE) parsed = await removeLegacyBase64Credentials(sourcePath, parsed);
    await writeStoredCredentials(keys);
  }
  return { parsed, keys };
}

export async function writeStoredCredentials(apiKeys: Record<string, string>): Promise<void> {
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
export async function getCredentialStorageStatusResponse(): Promise<IpcResponse<CredentialStorageStatus>> {
  try { return { success: true, data: getCredentialStorageStatus() }; }
  catch (error: unknown) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

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
    if (parsedPatch.data.security !== undefined) throw new Error('Security policy must be changed through the trusted security settings channel.');
    const { apiKeys, ...globalUpdates } = parsedPatch.data;
    if (apiKeys !== undefined && !getCredentialStorageStatus().available) {
      throw new Error(getCredentialStorageStatus().message);
    }
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

const ONBOARDING_FILE = path.join(getUserDataPath(), 'ty-code-onboarding.json');

export interface OnboardingStatePayload {
  completed: boolean;
  selectedPath?: 'free_accounts' | 'local' | 'anonymous' | null;
  currentStep: string;
  connectedProviders: string[];
  skipped: boolean;
  firstSeenAt: number;
  completedAt?: number | null;
  lastReminderAt?: number | null;
  reminderDismissedForever?: boolean;
  anonymousRateLimitEncountered?: boolean;
}

export async function readOnboardingState(): Promise<OnboardingStatePayload> {
  try {
    const raw = await fs.readFile(ONBOARDING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      completed: false,
      selectedPath: null,
      currentStep: 'welcome',
      connectedProviders: [],
      skipped: false,
      firstSeenAt: Date.now(),
      completedAt: null,
      lastReminderAt: null,
      reminderDismissedForever: false,
      anonymousRateLimitEncountered: false
    };
  }
}

export async function writeOnboardingState(state: Partial<OnboardingStatePayload>): Promise<OnboardingStatePayload> {
  const current = await readOnboardingState();
  const merged: OnboardingStatePayload = {
    ...current,
    ...state
  };
  await fs.mkdir(path.dirname(ONBOARDING_FILE), { recursive: true });
  await fs.writeFile(ONBOARDING_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
