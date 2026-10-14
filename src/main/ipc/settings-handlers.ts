import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { IpcResponse, ProviderSettings, ProviderType } from '../../preload/types';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-claude-settings.json');

const DEFAULT_SETTINGS: ProviderSettings = {
  activeProvider: 'openrouter',
  activeModel: 'deepseek/deepseek-chat',
  apiKeys: {},
  apiKeysConfigured: {},
  customEndpoints: { ollama: 'http://localhost:11434/v1', 'fcc-proxy': 'http://localhost:8082/v1' },
  temperature: 0.2,
  maxTokens: 4096,
  terminalProfiles: [],
  defaultTerminalProfileId: '',
  thirdPartyRuntimeEnabled: false
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
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredSettings;
    const apiKeys: Partial<Record<ProviderType, string>> = {};
    for (const [provider, value] of Object.entries(parsed.apiKeys || {})) {
      if (typeof value === 'string') apiKeys[provider as ProviderType] = decryptSecret(value);
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      apiKeys,
      thirdPartyRuntimeEnabled: parsed.thirdPartyRuntimeEnabled === true,
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
      terminalProfiles: updates.terminalProfiles ?? current.terminalProfiles,
      defaultTerminalProfileId: updates.defaultTerminalProfileId ?? current.defaultTerminalProfileId
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
