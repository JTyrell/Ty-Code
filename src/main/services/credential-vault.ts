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

export function getAllVaultKeys(): Record<string, string> {
  return loadAllKeys();
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

  // Bi-directional sync: ensure key is also saved in credentialStore
  try {
    const { credentialStore } = await import('./auth/credential-store');
    await credentialStore.saveCredential(normProvider, key.trim(), `${normProvider.toUpperCase()} Key`);
  } catch (err) {
    console.warn('[VAULT] Failed syncing key to credentialStore:', err);
  }
}

export async function getKey(providerId: string): Promise<string | null> {
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  if (keys[normProvider]) return keys[normProvider];

  const aliases = [
    normProvider,
    normProvider.replace(/-free$/, ''),
    `${normProvider}-free`
  ];
  if (normProvider.includes('google') || normProvider === 'gemini') {
    aliases.push('gemini', 'google-ai-studio', 'google-ai-studio-free', 'google');
  }
  if (normProvider === 'anthropic' || normProvider === 'claude') {
    aliases.push('anthropic', 'claude', 'anthropic-claude', 'anthropic-claude-free');
  }
  if (normProvider.includes('copilot')) {
    aliases.push('copilot', 'github-copilot', 'copilot-subscription');
  }
  for (const alias of aliases) {
    if (keys[alias]) return keys[alias];
  }

  try {
    const { credentialStore } = await import('./auth/credential-store');
    const fromStore = credentialStore.getDecryptedKey(normProvider);
    if (fromStore) return fromStore;
  } catch {}

  return null;
}

export async function testKey(
  providerId: string,
  key: string
): Promise<{ success: boolean; message: string }> {
  const p = providerId.toLowerCase().trim();
  let trimmedKey = (key || '').trim();
  if (!trimmedKey) {
    const resolved = await getKey(providerId);
    if (resolved) trimmedKey = resolved.trim();
  }

  if (!trimmedKey && p !== 'openkilo' && p !== 'kilo') {
    return { success: false, message: 'API key is required.' };
  }

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
    if (trimmedKey) headers['Authorization'] = `Bearer ${trimmedKey}`;
  } else if (p === 'gemini' || p.includes('google') || p === 'google-ai-studio') {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
  } else {
    url = 'https://openrouter.ai/api/v1/auth/key';
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  }

  try {
    console.log(`[VAULT] Fetching ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000)
    });

    console.log(`[VAULT] Response status: ${response.status}`);

    if (response.status === 200) {
      console.log(`[VAULT] Key for ${providerId} is valid.`);
      return { success: true, message: 'Key is valid' };
    } else if ((p === 'anthropic' || p === 'claude') && response.status === 404) {
      const msgRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': trimmedKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (msgRes.ok) {
        return { success: true, message: 'Key is valid' };
      }
      return { success: false, message: 'Invalid Anthropic key' };
    } else {
      const errText = await response.text().catch(() => '');
      console.warn(`[VAULT] Key verification failed (${response.status}):`, errText);
      return {
        success: false,
        message: response.status === 401 || response.status === 403
          ? 'Invalid API Key'
          : `Verification failed (HTTP ${response.status})`
      };
    }
  } catch (err: any) {
    console.error(`[VAULT] Network error testing ${providerId} key:`, err?.message || err);
    return { success: false, message: err instanceof Error ? err.message : 'Network error verifying key' };
  }
}
