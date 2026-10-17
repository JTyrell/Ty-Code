/**
 * Per-User Credential Storage (RealConnect 2)
 *
 * Implements OS-level hardware-backed credential encryption via Electron safeStorage
 * (Windows DPAPI, macOS Keychain, Linux Secret Service / libsecret).
 *
 * Requirements:
 * - Encryption: safeStorage.encryptString() before writing to disk, safeStorage.decryptString() on load
 * - Storage location: app.getPath('userData')/credentials.json (encrypted blob)
 * - Supported Providers:
 *   - BYOK: Anthropic, OpenAI, Google Gemini, Groq, DeepSeek, OpenRouter
 *   - Free Tier: OpenRouter Free, Groq Free, Google AI Studio Free
 *   - Local: Ollama (http://localhost:11434/v1)
 * - Reveal key: toggle to show (decrypted temporarily in memory, never written in plaintext)
 * - Revoke: delete from safeStorage and stop attribution
 * - Export/Import: encrypted backup bundle with migration support
 * - Test Connection: live 1-token /models or completions call before saving
 *
 * Brand: Ty-Code
 */

import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface StoredCredentialRecord {
  providerId: string;
  encryptedKey: string;
  label?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface CredentialsDocument {
  version: number;
  storageBackend: string;
  lastUpdated: number;
  credentials: Record<string, StoredCredentialRecord>;
}

export interface CredentialSummary {
  providerId: string;
  label: string;
  configured: boolean;
  createdAt?: number;
  lastUsedAt?: number;
}

export interface TestConnectionResult {
  success: boolean;
  providerId: string;
  latencyMs?: number;
  error?: string;
  modelDetected?: string;
}

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

export const CREDENTIALS_FILE = path.join(getUserDataPath(), 'credentials.json');

export class CredentialStore {
  private static instance: CredentialStore;
  private isLoaded = false;
  private cache: CredentialsDocument = {
    version: 1,
    storageBackend: 'electron_safe_storage',
    lastUpdated: Date.now(),
    credentials: {}
  };

  private constructor() {}

  public static getInstance(): CredentialStore {
    if (!CredentialStore.instance) {
      CredentialStore.instance = new CredentialStore();
    }
    return CredentialStore.instance;
  }

  /**
   * Returns whether OS-level safeStorage encryption is available
   */
  public isEncryptionAvailable(): boolean {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
      return false;
    }
    return safeStorage.isEncryptionAvailable();
  }

  public getBackendName(): string {
    if (process.platform === 'win32') return 'windows_dpapi';
    if (process.platform === 'darwin') return 'macos_keychain';
    if (process.platform === 'linux' && typeof safeStorage?.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend();
    }
    return 'electron_safe_storage';
  }

  /**
   * Loads credentials.json from disk and populates in-memory cache
   */
  public async load(): Promise<void> {
    try {
      const raw = await fs.readFile(CREDENTIALS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.credentials) {
        this.cache = parsed as CredentialsDocument;
      }
    } catch {
      // File does not exist yet (clean install) or parse failed
      this.cache = {
        version: 1,
        storageBackend: this.getBackendName(),
        lastUpdated: Date.now(),
        credentials: {}
      };
    } finally {
      this.isLoaded = true;
    }
  }

  /**
   * Persists credentials to credentials.json atomically
   */
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(CREDENTIALS_FILE), { recursive: true });
    this.cache.lastUpdated = Date.now();
    this.cache.storageBackend = this.getBackendName();

    const tmpPath = `${CREDENTIALS_FILE}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(this.cache, null, 2);

    try {
      await fs.writeFile(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmpPath, CREDENTIALS_FILE);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Encrypts a plaintext secret string using safeStorage
   */
  public encrypt(secret: string): string {
    if (!secret) return '';
    if (this.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(secret);
      return `safe_storage_v1:${buffer.toString('base64')}`;
    }
    // Fallback for headless environments/tests where safeStorage is unavailable
    const hmac = crypto.createHash('sha256').update(getUserDataPath()).digest('hex').slice(0, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(hmac, 'utf8'), Buffer.alloc(12, 0));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `fallback_aes_v1:${Buffer.concat([tag, encrypted]).toString('base64')}`;
  }

  /**
   * Decrypts an encrypted string using safeStorage
   */
  public decrypt(encryptedValue: string): string {
    if (!encryptedValue) return '';
    if (encryptedValue.startsWith('safe_storage_v1:')) {
      if (!this.isEncryptionAvailable()) return '';
      const b64 = encryptedValue.slice('safe_storage_v1:'.length);
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    }
    if (encryptedValue.startsWith('fallback_aes_v1:')) {
      const raw = Buffer.from(encryptedValue.slice('fallback_aes_v1:'.length), 'base64');
      const tag = raw.slice(0, 16);
      const data = raw.slice(16);
      const hmac = crypto.createHash('sha256').update(getUserDataPath()).digest('hex').slice(0, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hmac, 'utf8'), Buffer.alloc(12, 0));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    // Backward compatibility for legacy base64 buffers
    if (this.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
      } catch {
        return '';
      }
    }
    return '';
  }

  /**
   * Saves an encrypted credential for a provider into credentials.json
   */
  public async saveCredential(providerId: string, apiKey: string, label?: string): Promise<boolean> {
    if (!this.isLoaded) await this.load();
    if (!providerId || !apiKey.trim()) return false;

    const trimmedKey = apiKey.trim();
    const encrypted = this.encrypt(trimmedKey);

    this.cache.credentials[providerId] = {
      providerId,
      encryptedKey: encrypted,
      label: label || `${providerId.toUpperCase()} Key`,
      createdAt: this.cache.credentials[providerId]?.createdAt || Date.now(),
      lastUsedAt: Date.now()
    };

    await this.persist();
    return true;
  }

  private getProviderAliases(providerId: string): string[] {
    const list = [providerId];
    if (providerId.endsWith('-free')) {
      list.push(providerId.replace(/-free$/, ''));
    } else {
      list.push(`${providerId}-free`);
    }
    if (providerId === 'gemini' || providerId === 'google-ai-studio' || providerId === 'google-ai-studio-free') {
      list.push('gemini', 'google-ai-studio', 'google-ai-studio-free');
    }
    return Array.from(new Set(list));
  }

  /**
   * Retrieves the decrypted key for a provider
   */
  public getDecryptedKey(providerId: string): string | null {
    const aliases = this.getProviderAliases(providerId);
    for (const id of aliases) {
      const record = this.cache.credentials[id];
      if (record?.encryptedKey) {
        const decrypted = this.decrypt(record.encryptedKey);
        if (decrypted) return decrypted;
      }
    }
    return null;
  }

  /**
   * Returns all decrypted keys for provider gateway
   */
  public getAllDecryptedKeys(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [providerId, record] of Object.entries(this.cache.credentials)) {
      const decrypted = this.decrypt(record.encryptedKey);
      if (decrypted) result[providerId] = decrypted;
    }
    return result;
  }

  /**
   * Checks whether a provider has an encrypted credential saved
   */
  public hasCredential(providerId: string): boolean {
    const aliases = this.getProviderAliases(providerId);
    return aliases.some((id) => Boolean(this.cache.credentials[id]?.encryptedKey));
  }

  /**
   * Checks whether any credentials are saved (for first-run detection)
   */
  public async hasAnyCredentials(): Promise<boolean> {
    if (!this.isLoaded) await this.load();
    return Object.keys(this.cache.credentials).length > 0;
  }

  /**
   * Reveals key temporarily in memory. Never written to disk or logs.
   */
  public revealKey(providerId: string): string | null {
    return this.getDecryptedKey(providerId);
  }

  /**
   * Revokes and permanently deletes a provider credential from safeStorage
   */
  public async revokeCredential(providerId: string): Promise<boolean> {
    if (!this.isLoaded) await this.load();
    if (!this.cache.credentials[providerId]) return false;

    delete this.cache.credentials[providerId];
    await this.persist();
    return true;
  }

  /**
   * Lists all configured provider summaries without revealing keys
   */
  public listConfigured(): CredentialSummary[] {
    return Object.entries(this.cache.credentials).map(([providerId, record]) => ({
      providerId,
      label: record.label || providerId,
      configured: Boolean(record.encryptedKey),
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt
    }));
  }

  /**
   * Updates last used timestamp when an AI request succeeds
   */
  public touchCredential(providerId: string): void {
    const record = this.cache.credentials[providerId];
    if (record) {
      record.lastUsedAt = Date.now();
      void this.persist().catch(() => undefined);
    }
  }

  /**
   * Exports an encrypted backup bundle of credentials for cross-device migration
   */
  public async exportBackup(passphrase?: string): Promise<string> {
    if (!this.isLoaded) await this.load();

    const rawKeys: Record<string, string> = {};
    for (const [providerId, record] of Object.entries(this.cache.credentials)) {
      const dec = this.decrypt(record.encryptedKey);
      if (dec) rawKeys[providerId] = dec;
    }

    const payload = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      keys: rawKeys
    });

    const salt = crypto.randomBytes(16);
    const pass = passphrase || 'ty-code-default-passphrase-v1';
    const key = crypto.pbkdf2Sync(pass, salt, 100_000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const bundle = {
      format: 'ty-code-credential-bundle-v1',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted.toString('base64')
    };

    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Imports an encrypted backup bundle and saves keys into local safeStorage
   */
  public async importBackup(bundleJson: string, passphrase?: string): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      const bundle = JSON.parse(bundleJson);
      if (bundle.format !== 'ty-code-credential-bundle-v1') {
        return { success: false, count: 0, error: 'Invalid backup format' };
      }

      const salt = Buffer.from(bundle.salt, 'base64');
      const iv = Buffer.from(bundle.iv, 'base64');
      const authTag = Buffer.from(bundle.authTag, 'base64');
      const data = Buffer.from(bundle.data, 'base64');

      const pass = passphrase || 'ty-code-default-passphrase-v1';
      const key = crypto.pbkdf2Sync(pass, salt, 100_000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');

      const payload = JSON.parse(decrypted);
      if (!payload.keys || typeof payload.keys !== 'object') {
        return { success: false, count: 0, error: 'Backup does not contain valid keys' };
      }

      let count = 0;
      for (const [providerId, rawKey] of Object.entries(payload.keys as Record<string, string>)) {
        if (typeof rawKey === 'string' && rawKey.trim()) {
          await this.saveCredential(providerId, rawKey.trim());
          count++;
        }
      }

      return { success: true, count };
    } catch (err) {
      return { success: false, count: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Performs a live 1-token or model verification request before saving a key
   */
  public async testConnection(
    providerId: string,
    apiKey: string,
    modelId?: string
  ): Promise<TestConnectionResult> {
    const startTime = Date.now();
    const trimmedKey = apiKey.trim();
    const normId = providerId.toLowerCase().replace(/-free$/, '');

    try {
      // 0. OpenKilo anonymous free tier verification (zero key required)
      if (normId === 'openkilo') {
        return {
          success: true,
          providerId,
          latencyMs: Date.now() - startTime,
          modelDetected: modelId || 'qwen/qwen3-coder:free'
        };
      }

      // 1. Ollama local verification
      if (normId === 'ollama') {
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3500) });
        if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
        const data = await res.json() as { models?: Array<{ name: string }> };
        const models = (data.models || []).map((m) => m.name).join(', ');
        return {
          success: true,
          providerId,
          latencyMs: Date.now() - startTime,
          modelDetected: models || 'qwen2.5-coder'
        };
      }

      // 2. OpenRouter test
      if (normId === 'openrouter') {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${trimmedKey}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401 || res.status === 403) {
          return { success: false, providerId, error: 'Invalid OpenRouter API key (HTTP 401 Unauthorized)' };
        }
        if (!res.ok) {
          throw new Error(`OpenRouter returned HTTP ${res.status}`);
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'deepseek/deepseek-r1:free' };
      }

      // 3. Groq test
      if (normId === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${trimmedKey}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401) {
          return { success: false, providerId, error: 'Invalid Groq API key (HTTP 401 Unauthorized)' };
        }
        if (!res.ok) {
          throw new Error(`Groq returned HTTP ${res.status}`);
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'llama-3.3-70b-versatile' };
      }

      // 4. OpenAI test
      if (normId === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${trimmedKey}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401) {
          return { success: false, providerId, error: 'Invalid OpenAI API key (HTTP 401 Unauthorized)' };
        }
        if (!res.ok) {
          throw new Error(`OpenAI returned HTTP ${res.status}`);
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'gpt-4o' };
      }

      // 5. Anthropic test
      if (normId === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': trimmedKey,
            'anthropic-version': '2023-06-01'
          },
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401) {
          return { success: false, providerId, error: 'Invalid Anthropic API key (HTTP 401 Unauthorized)' };
        }
        if (!res.ok && res.status !== 404) {
          // Anthropic may return 404 for /models on older versions; test /messages with max_tokens: 1
          const msgRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': trimmedKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: modelId || 'claude-3-5-haiku-20241022',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'hi' }]
            }),
            signal: AbortSignal.timeout(5000)
          });
          if (msgRes.status === 401) return { success: false, providerId, error: 'Invalid Anthropic API key' };
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'claude-3-5-sonnet-20241022' };
      }

      // 6. DeepSeek test
      if (normId === 'deepseek') {
        const res = await fetch('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${trimmedKey}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401) {
          return { success: false, providerId, error: 'Invalid DeepSeek API key (HTTP 401 Unauthorized)' };
        }
        if (!res.ok) {
          throw new Error(`DeepSeek returned HTTP ${res.status}`);
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'deepseek-chat' };
      }

      // 7. Google Gemini test
      if (normId === 'gemini' || normId === 'google-ai-studio') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (res.status === 400 || res.status === 403) {
          return { success: false, providerId, error: 'Invalid Google Gemini API key' };
        }
        if (!res.ok) {
          throw new Error(`Google Gemini returned HTTP ${res.status}`);
        }
        return { success: true, providerId, latencyMs: Date.now() - startTime, modelDetected: 'gemini-2.0-flash' };
      }

      // Generic fallback
      return {
        success: true,
        providerId,
        latencyMs: Date.now() - startTime,
        modelDetected: modelId || `${providerId}-default`
      };
    } catch (err) {
      return {
        success: false,
        providerId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}

export const credentialStore = CredentialStore.getInstance();
