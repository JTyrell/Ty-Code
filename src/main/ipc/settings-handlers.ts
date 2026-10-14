import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { IpcResponse, ProviderSettings } from '../../preload/types';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ty-claude-settings.json');

const DEFAULT_SETTINGS: ProviderSettings = {
  activeProvider: 'openrouter',
  activeModel: 'deepseek/deepseek-chat',
  apiKeys: {},
  customEndpoints: {
    ollama: 'http://localhost:11434/v1',
    'fcc-proxy': 'http://localhost:8082/v1'
  },
  temperature: 0.2,
  maxTokens: 4096
};

function encryptSecret(secret: string): string {
  if (!secret) return '';
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = safeStorage.encryptString(secret);
      return buffer.toString('base64');
    } catch {
      return Buffer.from(secret).toString('base64');
    }
  }
  return Buffer.from(secret).toString('base64');
}

function decryptSecret(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      try {
        return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
      } catch {
        return '';
      }
    }
  }
  try {
    return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

export async function getSettings(): Promise<IpcResponse<ProviderSettings>> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    // Decrypt keys
    const decryptedKeys: Partial<Record<string, string>> = {};
    if (parsed.apiKeys) {
      for (const [provider, encKey] of Object.entries(parsed.apiKeys)) {
        if (typeof encKey === 'string') {
          decryptedKeys[provider] = decryptSecret(encKey);
        }
      }
    }

    const settings: ProviderSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      apiKeys: decryptedKeys
    };

    return { success: true, data: settings };
  } catch {
    // If not found, return defaults
    return { success: true, data: { ...DEFAULT_SETTINGS } };
  }
}

export async function saveSettings(updates: Partial<ProviderSettings>): Promise<IpcResponse<void>> {
  try {
    const current = (await getSettings()).data || DEFAULT_SETTINGS;
    const merged: ProviderSettings = {
      ...current,
      ...updates
    };

    // Encrypt keys for storage
    const encryptedKeys: Partial<Record<string, string>> = {};
    if (merged.apiKeys) {
      for (const [provider, rawKey] of Object.entries(merged.apiKeys)) {
        if (typeof rawKey === 'string' && rawKey.trim()) {
          encryptedKeys[provider as keyof typeof encryptedKeys] = encryptSecret(rawKey);
        }
      }
    }

    const toStore = {
      ...merged,
      apiKeys: encryptedKeys
    };

    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(toStore, null, 2), 'utf-8');

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}
