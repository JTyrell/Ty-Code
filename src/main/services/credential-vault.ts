import { safeStorage, app } from 'electron';
import fs from 'fs';
import path from 'path';

function getCredentialsFilePath(): string {
  return path.join(app.getPath('userData'), 'credentials.enc');
}

function loadAllKeys(): Record<string, string> {
  const filePath = getCredentialsFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const fileBuffer = fs.readFileSync(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decryptedStr = safeStorage.decryptString(fileBuffer);
        return JSON.parse(decryptedStr);
      } catch {
        return {};
      }
    } else {
      console.warn('[VAULT] safeStorage is not available on this platform/configuration.');
      return {};
    }
  } catch (err) {
    console.error('[VAULT] Failed reading credentials:', err);
    return {};
  }
}

export async function saveKey(providerId: string, key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available');
  }

  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  keys[normProvider] = key.trim();

  const filePath = getCredentialsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const encryptedBuffer = safeStorage.encryptString(JSON.stringify(keys));
  fs.writeFileSync(filePath, encryptedBuffer);
  console.log(`[VAULT] Saved encrypted key for ${normProvider} to ${filePath}`);
}

export async function getKey(providerId: string): Promise<string | null> {
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  return keys[normProvider] || null;
}

export async function testKey(
  providerId: string,
  key: string
): Promise<{ success: boolean; message: string }> {
  const p = providerId.toLowerCase().trim();
  const trimmedKey = key.trim();

  console.log(`[VAULT] Testing ${providerId} key...`);

  let url = '';
  const headers: Record<string, string> = {};

  if (p === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/auth/key';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else if (p === 'groq') {
    url = 'https://api.groq.com/openai/v1/models';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else if (p === 'anthropic' || p === 'claude') {
    url = 'https://api.anthropic.com/v1/models';
    headers['x-api-key'] = trimmedKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (p === 'openai') {
    url = 'https://api.openai.com/v1/models';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else if (p === 'deepseek') {
    url = 'https://api.deepseek.com/models';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else if (p === 'openkilo' || p === 'kilo') {
    url = 'https://api.kilo.ai/api/gateway/models';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else {
    url = 'https://openrouter.ai/api/v1/auth/key';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  }

  try {
    console.log(`[VAULT] Fetching ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    console.log(`[VAULT] Response status: ${response.status}`);

    if (response.status === 200) {
      console.log(`[VAULT] Key for ${providerId} is valid.`);
      return { success: true, message: 'Key is valid' };
    } else {
      const errText = await response.text().catch(() => '');
      console.warn(`[VAULT] Key verification failed (${response.status}):`, errText);
      return { success: false, message: 'Invalid key or network error' };
    }
  } catch (err: any) {
    console.error(`[VAULT] Network error testing ${providerId} key:`, err?.message || err);
    return { success: false, message: 'Invalid key or network error' };
  }
}
