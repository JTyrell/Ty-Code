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
  if (normProvider === 'openrouter' || normProvider === 'openrouter-free') {
    aliases.push('openrouter', 'openrouter-free');
  }
  if (normProvider === 'openkilo' || normProvider === 'openkilo-free') {
    aliases.push('openkilo', 'openkilo-free');
  }
  if (normProvider === 'ty-code-free' || normProvider === 'tycode-free') {
    aliases.push('ty-code-free', 'openrouter', 'openrouter-free');
  }
  for (const alias of aliases) {
    if (keys[alias]) return keys[alias];
  }

  try {
    const { credentialStore } = await import('./auth/credential-store');
    for (const alias of aliases) {
      const fromStore = credentialStore.getDecryptedKey(alias);
      if (fromStore) return fromStore;
    }
  } catch {}

  try {
    const { readStoredCredentials } = await import('../ipc/settings-handlers');
    const { keys: stored } = await readStoredCredentials();
    for (const alias of aliases) {
      if (stored[alias]) return stored[alias];
    }
  } catch {}

  // Zero-Friction Community Key: the 'ty-code-free' virtual provider never
  // requires user input. The rotating Community Key is bootstrapped once from
  // the Ty-Code backend, then cached encrypted at rest via safeStorage
  // (plaintext lives only in memory). Overriding with the user's own
  // OpenRouter key happens through the alias checks above, never here.
  if (normProvider === 'ty-code-free' || normProvider === 'tycode-free') {
    const community = await fetchCommunityKey();
    if (community && community.trim()) return community.trim();
  }

  return null;
}

// ===== Community Key remote bootstrap (ZeroFriction-1) =====
//
// Source of truth: https://api.tycode.dev/v1/community-key — a rotating,
// IP-rate-limited distribution endpoint operated by the project. The client
// boots the key once, stores it ONLY under safeStorage encryption inside the
// existing credentials.enc vault, and afterwards works from the encrypted
// cache with zero latency (and offline). No key is ever written to disk in
// plaintext and no key is ever baked into source code. If the endpoint is
// unreachable (first launch offline), callers recover via the pure-anonymous
// free tiers (OpenKilo pool / local Ollama), so the user is never blocked.

const COMMUNITY_KEY_ENDPOINT = 'https://api.tycode.dev/v1/community-key';
const COMMUNITY_KEY_LABEL = 'tycode_community_key';
let communityKeyCache: string | undefined;
let communityKeyCachedAt = 0;
let communityKeyInFlight: Promise<string | undefined> | null = null;

async function persistCommunityKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available');
  }
  const keys = loadAllKeys();
  keys[COMMUNITY_KEY_LABEL] = key;

  const filePath = getCredentialsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(keys)));
}

/**
 * Returns the Community Key synchronously when it is already known from
 * memory or the encrypted cache. Never performs network requests — used for
 * cheap availability probes (router gating, failover eligibility).
 */
export function getCommunityKeyCached(): string | undefined {
  if (communityKeyCache && communityKeyCache.trim()) return communityKeyCache;
  const keys = loadAllKeys();
  const stored = keys[COMMUNITY_KEY_LABEL];
  if (stored && stored.trim()) {
    communityKeyCache = stored.trim();
    communityKeyCachedAt = Date.now();
    return communityKeyCache;
  }
  return undefined;
}

export function hasCommunityKey(): boolean {
  return Boolean(getCommunityKeyCached());
}

/**
 * Fire-and-forget prefetch used at app boot so the first chat message already
 * sees a provisioned Community Key (and the router treats the free tier as
 * available). Never throws; a cold/unreachable backend just leaves the
 * anonymous free pool as the working fallback.
 */
export function warmUpCommunityKey(): void {
  if (getCommunityKeyCached()) return;
  void fetchCommunityKey().catch(() => undefined);
}

/**
 * Re-fetches the Community Key when the cached copy is older than maxAgeMs.
 * Supports the backend's key rotation: once a distributed key retires
 * (r/f (401/403 upstream), the next resolution path invalidates and this
 * routine restores a fresh key without waiting for the user's next session.
 */
export async function revalidateCommunityKey(maxAgeMs: number): Promise<void> {
  const cached = getCommunityKeyCached();
  if (cached && Date.now() - communityKeyCachedAt < maxAgeMs) return;
  if (communityKeyInFlight) {
    await communityKeyInFlight.catch(() => undefined);
    return;
  }
  await fetchCommunityKey(true).catch(() => undefined);
}

/**
 * Bootstraps the Community Key with a single HTTPS GET. Concurrent callers
 * share one in-flight request. On success the key is encrypted with
 * safeStorage and persisted for offline reuse. Returns undefined when the
 * endpoint is unreachable (offline) or returns an unusable payload.
 * Pass force=true to skip the cache short-circuit (rotation revalidation).
 */
export async function fetchCommunityKey(force = false): Promise<string | undefined> {
  if (!force) {
    const cached = getCommunityKeyCached();
    if (cached) return cached;
  }
  if (communityKeyInFlight) return communityKeyInFlight;

  communityKeyInFlight = (async () => {
    try {
      const response = await fetch(COMMUNITY_KEY_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        console.warn(`[VAULT] Community key bootstrap failed (HTTP ${response.status}).`);
        return undefined;
      }
      const data = (await response.json().catch(() => undefined)) as { key?: string; token?: string } | undefined;
      const value = String(data?.key || data?.token || '').trim();
      if (value.length < 8 || value.length > 256) {
        console.warn('[VAULT] Community key payload was empty or malformed.');
        return undefined;
      }
      try {
        await persistCommunityKey(value);
      } catch (err) {
        // Persistence failure must not block serving the key for this session
        console.warn('[VAULT] Failed persisting community key:', err instanceof Error ? err.message : err);
      }
      communityKeyCache = value;
      communityKeyCachedAt = Date.now();
      console.log('[VAULT] Community key bootstrapped and encrypted in safeStorage cache.');
      return value;
    } catch (err) {
      console.warn('[VAULT] Community bootstrap endpoint unreachable:', err instanceof Error ? err.message : err);
      return undefined;
    } finally {
      communityKeyInFlight = null;
    }
  })();
  return communityKeyInFlight;
}

/**
 * Drops the cached Community Key (memory + encrypted store) after a 401/403
 * so the next attempt bootstraps the current rotation.
 */
export function invalidateCommunityKey(): void {
  communityKeyCache = undefined;
  try {
    const keys = loadAllKeys();
    if (keys[COMMUNITY_KEY_LABEL]) {
      delete keys[COMMUNITY_KEY_LABEL];
      const filePath = getCredentialsFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(keys)));
    }
  } catch {
    // Cache reset in memory is sufficient
  }
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
