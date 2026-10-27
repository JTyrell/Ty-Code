import { safeStorage, app, ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

function getCredentialsFilePath(): string {
  if (typeof (app as { getPath?: unknown } | undefined)?.getPath !== 'function') {
    throw new Error('CREDENTIAL_VAULT_UNAVAILABLE');
  }
  return path.join(app.getPath('userData'), 'credentials.enc');
}

/**
 * True only when running inside the Electron main process with safeStorage
 * AND the app is ready (Prompt 4: readiness gate — safeStorage is never
 * touched before app.whenReady()). Outside Electron (e.g. bundled E2E
 * harnesses in plain Node) the vault has no secure OS storage, so read paths
 * degrade to an empty keyring instead of crashing the caller.
 */
function isVaultAvailable(): boolean {
  try {
    if (typeof (app as { getPath?: unknown } | undefined)?.getPath !== 'function') return false;
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

/**
 * Readiness gate (Prompt 4 Step 3.4): the vault only touches safeStorage
 * once the Electron app is ready AND the OS encryption backend reports
 * available. Before readiness (or outside Electron) reads return an empty
 * keyring WITHOUT marking a permanent failure — the app simply is not in a
 * state where decryption is meaningful yet.
 */
function isVaultReady(): boolean {
  try {
    const appLike = app as unknown as { isReady?: () => boolean; getPath?: unknown } | undefined;
    if (!appLike || typeof appLike.getPath !== 'function' || typeof appLike.isReady !== 'function') return false;
    if (!appLike.isReady()) return false;
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

/**
 * In-memory decryption cache to ensure safeStorage.decryptString is only called ONCE
 * per app session per key, serving subsequent requests with 0ms latency from RAM.
 */
const decryptedKeyCache = new Map<string, string>();

/**
 * Session-wide memo of the decrypted keyring (Prompt 4 Step 3: the whole
 * credentials blob decrypts AT MOST ONCE per session; every later read —
 * including concurrent getKey callers — is served from memory).
 */
let decryptedFileSnapshot: Record<string, string> | null = null;

/**
 * Single-flight: concurrent getKey callers share ONE in-flight load instead
 * of issuing parallel safeStorage decryptions.
 */
let vaultLoadInFlight: Promise<Record<string, string>> | null = null;

/**
 * "[VAULT] Decrypting key" is logged at most once per key per session
 * (cache-miss only).
 */
const decryptLogOnce = new Set<string>();

/**
 * Permanent decrypt failure for this session (Prompt 4 Step 3.4): a foreign
 * DPAPI context (portable build moved between Windows users) or an
 * unavailable OS encryption backend. Once set, the vault returns null
 * immediately and NEVER retries — no retry storm, ever.
 */
let vaultDecryptFailed = false;
let vaultFailureEmitted = false;

const VAULT_DECRYPT_WARNING = 'Stored keys could not be decrypted on this machine; re-save them in Settings.';

/** Emit exactly ONE warning event per session, to every live window. */
function emitVaultDecryptWarning(): void {
  if (vaultFailureEmitted) return;
  vaultFailureEmitted = true;
  console.warn(`[VAULT] ${VAULT_DECRYPT_WARNING}`);
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('vault:keys-undecryptable', { message: VAULT_DECRYPT_WARNING });
      }
    }
  } catch {
    // Non-blocking in headless/test environments.
  }
}

/** Test hook: resets the session-wide decrypt memoization/failure state. */
export function resetVaultSessionStateForTests(): void {
  decryptedFileSnapshot = null;
  vaultLoadInFlight = null;
  decryptLogOnce.clear();
  vaultDecryptFailed = false;
  vaultFailureEmitted = false;
}

/** True when the vault is in the permanent no-retry failure state. */
export function isVaultDecryptFailed(): boolean {
  return vaultDecryptFailed;
}

export function clearKeyCache(providerId?: string): void {
  if (providerId) {
    decryptedKeyCache.delete(providerId.toLowerCase().trim());
  } else {
    decryptedKeyCache.clear();
  }
}

/**
 * Synchronous keyring read with session memoization. The safeStorage
 * decrypt happens AT MOST ONCE per session: the first successful (or
 * permanently failed) attempt fixes the snapshot; all later calls are RAM
 * reads. A not-yet-ready app returns an empty keyring WITHOUT consuming the
 * one-shot decrypt, so the gate simply defers to a later call.
 */
function loadAllKeys(): Record<string, string> {
  if (vaultDecryptFailed) return {};
  if (decryptedFileSnapshot) return decryptedFileSnapshot;
  if (!isVaultReady()) return {};
  let filePath: string;
  try {
    filePath = getCredentialsFilePath();
  } catch {
    return {};
  }
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const fileBuffer = fs.readFileSync(filePath);
    try {
      const decryptedStr = safeStorage.decryptString(fileBuffer);
      const parsed = JSON.parse(decryptedStr) as Record<string, string>;
      const snapshot = parsed && typeof parsed === 'object' ? parsed : {};
      for (const [k, v] of Object.entries(snapshot)) {
        if (typeof v === 'string') {
          decryptedKeyCache.set(k.toLowerCase().trim(), v);
        }
      }
      decryptedFileSnapshot = snapshot;
      return snapshot;
    } catch (err) {
      // Prompt 4 Step 3.4: decrypt throw (e.g. DPAPI context mismatch from a
      // portable build moved between Windows users) — ONE warning, no retry,
      // ever. The failure is permanent for this session.
      vaultDecryptFailed = true;
      console.warn(`[VAULT] safeStorage decryption FAILED: ${err instanceof Error ? err.message : String(err)}`);
      emitVaultDecryptWarning();
      decryptedFileSnapshot = {};
      return {};
    }
  } catch (err) {
    console.error('[VAULT] Failed reading credentials:', err);
    return {};
  }
}

/**
 * Single-flight wrapper around the synchronous loadAllKeys(): concurrent
 * callers share one in-flight load; the decrypt log line is emitted at most
 * once per triggering key per session and only when a decrypt will actually
 * happen.
 */
async function loadAllKeysSingleFlight(triggerProviderId?: string): Promise<Record<string, string>> {
  if (decryptedFileSnapshot) return decryptedFileSnapshot;
  if (vaultDecryptFailed) return {};
  if (vaultLoadInFlight) return vaultLoadInFlight;
  if (triggerProviderId && !decryptLogOnce.has(triggerProviderId) && isVaultReady()) {
    decryptLogOnce.add(triggerProviderId);
    console.log(`[VAULT] Decrypting key from safeStorage (provider: ${triggerProviderId})...`);
  }
  vaultLoadInFlight = Promise.resolve().then(() => loadAllKeys());
  try {
    return await vaultLoadInFlight;
  } finally {
    vaultLoadInFlight = null;
  }
}

export function getAllVaultKeys(): Record<string, string> {
  return loadAllKeys();
}

export async function saveKey(providerId: string, key: string): Promise<void> {
  console.log('[VAULT] Encrypting key with safeStorage...');
  if (!isVaultReady()) {
    throw new Error('safeStorage encryption is not available');
  }

  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  keys[normProvider] = key.trim();

  // In-Memory Key Cache update: keep RAM in sync with written key
  decryptedKeyCache.set(normProvider, key.trim());
  // Keep the session keyring snapshot coherent with the write (a later
  // vault miss must see the saved key without re-decrypting).
  if (decryptedFileSnapshot) {
    decryptedFileSnapshot[normProvider] = key.trim();
  }

  const filePath = getCredentialsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    const encryptedBuffer = safeStorage.encryptString(JSON.stringify(keys));
    fs.writeFileSync(filePath, encryptedBuffer);
  } catch (err) {
    console.warn(`[VAULT] safeStorage encryption FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  console.log('[VAULT] Key saved successfully');
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

  // 1. In-memory decryption cache check (0ms latency)
  if (decryptedKeyCache.has(normProvider)) {
    return decryptedKeyCache.get(normProvider)!;
  }

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
    if (decryptedKeyCache.has(alias)) {
      const cached = decryptedKeyCache.get(alias)!;
      decryptedKeyCache.set(normProvider, cached);
      return cached;
    }
  }

  // 2. Not in cache: decrypt via the single-flight keyring loader.
  //    Prompt 4 Step 3.4: a permanent decrypt failure (foreign DPAPI
  //    context, unavailable OS encryption) fails FAST here — null, one
  //    warning event already emitted, no fallback probing, no retry storm.
  if (vaultDecryptFailed) {
    return null;
  }
  const keys = await loadAllKeysSingleFlight(normProvider);
  if (keys[normProvider]) {
    const keyVal = keys[normProvider];
    decryptedKeyCache.set(normProvider, keyVal);
    console.log(`[VAULT] Key decrypted and cached in memory for ${normProvider}`);
    return keyVal;
  }

  for (const alias of aliases) {
    if (keys[alias]) {
      const keyVal = keys[alias];
      decryptedKeyCache.set(normProvider, keyVal);
      decryptedKeyCache.set(alias, keyVal);
      console.log(`[VAULT] Key decrypted and cached in memory for ${normProvider}`);
      return keyVal;
    }
  }

  try {
    const { credentialStore } = await import('./auth/credential-store');
    for (const alias of aliases) {
      const fromStore = credentialStore.getDecryptedKey(alias);
      if (fromStore) {
        decryptedKeyCache.set(normProvider, fromStore);
        decryptedKeyCache.set(alias, fromStore);
        console.log(`[VAULT] Key decrypted and cached in memory for ${normProvider}`);
        return fromStore;
      }
    }
  } catch {}

  try {
    const { readStoredCredentials } = await import('../ipc/settings-handlers');
    const { keys: stored } = await readStoredCredentials();
    for (const alias of aliases) {
      if (stored[alias]) {
        decryptedKeyCache.set(normProvider, stored[alias]);
        decryptedKeyCache.set(alias, stored[alias]);
        console.log(`[VAULT] Key decrypted and cached in memory for ${normProvider}`);
        return stored[alias];
      }
    }
  } catch {}

  // Zero-Friction Community Key: the 'ty-code-free' virtual provider never
  // requires user input. The rotating Community Key is bootstrapped once from
  // the Ty-Code backend, then cached encrypted at rest via safeStorage.
  if (normProvider === 'ty-code-free' || normProvider === 'tycode-free') {
    const community = await getCommunityKey();
    if (community && community.trim()) {
      const clean = community.trim();
      decryptedKeyCache.set(normProvider, clean);
      console.log(`[VAULT] Key decrypted and cached in memory for ${normProvider}`);
      return clean;
    }
  }

  return null;
}

// ===== Community Key remote bootstrap (ZeroFriction, Cloudflare KV edition) ==
//
// Source of truth: https://api.tycode.dev/community-key - a Cloudflare Worker
// (tycode-community-worker/) that serves the rotating key from the KV
// namespace TYCODE_KEYS (stored under 'community_free_tier_key'). The client
// boots the key once, stores it ONLY under safeStorage encryption through the
// standard saveKey()/getKey() vault functions, and afterwards works from the
// encrypted cache with zero latency (and offline). No key is ever written to
// disk in plaintext and no key is ever baked into source code. If the
// endpoint is unreachable (first launch offline), callers recover via the
// pure-anonymous free tiers (OpenKilo pool / local Ollama), so the user is
// never blocked.

const COMMUNITY_KEY_ENDPOINT = 'https://ty-code.jevountyrell.workers.dev/community-key';
// TODO(custom-domain): once https://api.tycode.dev is attached to the Worker
// (Worker "ty-code" -> Settings -> Domains & Routes -> Custom Domain), swap
// the endpoint back to https://api.tycode.dev/community-key - safeStorage
// cached keys keep existing users running across the transition.
const COMMUNITY_KEY_LABEL = 'tycode_community_key';
let communityKeyCache: string | undefined;
let communityKeyCachedAt = 0;
// Horizon after which the cached Community Key is considered stale. When the
// Worker payload carries a plausible expiresAt (7 days), revalidation waits
// that long - keeping the client at roughly one endpoint hit per week per
// user, which is what keeps the free-tier KV budget effectively unbounded.
let communityKeyExpiresAt = 0;
let communityKeyInFlight: Promise<string | null> | null = null;
export type CommunityKeyStatus = 'active' | 'degraded' | 'missing';
let currentCommunityKeyStatus: CommunityKeyStatus = 'active';

// Rate-limit back-off: after a 429 from the Worker no further remote fetches
// run until this timestamp passes (honoring retry-after from Cloudflare Worker, default 600s).
let communityKeyRetryNotBefore = 0;

export function getCommunityKeyStatus(): CommunityKeyStatus {
  if (Date.now() < communityKeyRetryNotBefore) {
    return 'degraded';
  }
  return currentCommunityKeyStatus;
}

export function emitCommunityKeyStatus(status: CommunityKeyStatus): void {
  currentCommunityKeyStatus = status;
  try {
    ipcMain.emit('community-key:status-changed', { status });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('community-key:status-changed', { status });
      }
    }
  } catch {
    // Non-blocking in headless/test environments
  }
}

/** Wire contract served by the Ty-Code community Cloudflare Worker. */
interface CommunityKeyPayload {
  key?: string;
  token?: string;
  provider?: string;
  expiresAt?: number;
}

/**
 * Remote fetch portion of the Community Key bootstrap (5s strict timeout so a
 * hanging backend can never stall the Main Process event loop). On success the
 * key is persisted through the standard saveKey() path (safeStorage
 * encryption + credentialStore sync) and mirrored into the memory cache.
 */
async function fetchCommunityKeyRemote(): Promise<string | null> {
  if (Date.now() < communityKeyRetryNotBefore) {
    console.log(`[VAULT] Rate-limit back-off active - skipping remote fetch for another ${Math.ceil((communityKeyRetryNotBefore - Date.now()) / 1000)}s.`);
    emitCommunityKeyStatus('degraded');
    return null;
  }
  // ZeroFriction diagnosis (Prompt 2): this log shows the EXACT endpoint being
  // fetched whenever the encrypted cache produced no key.
  console.log(`[VAULT] Cache MISS - fetching from Cloudflare endpoint: ${COMMUNITY_KEY_ENDPOINT}`);
  try {
    const response = await fetch(COMMUNITY_KEY_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    console.log(`[VAULT] Fetch response status: ${response.status}`);
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const parsedSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
        const retryAfterSeconds = Number.isFinite(parsedSec) && parsedSec > 0 ? parsedSec : 600;
        communityKeyRetryNotBefore = Date.now() + (retryAfterSeconds * 1000);
        console.log(`[VAULT] 429 Rate Limited. Cooldown active until ${new Date(communityKeyRetryNotBefore).toISOString()}`);
        console.warn(`[VAULT] 429 Rate Limited. Cooldown active until ${new Date(communityKeyRetryNotBefore).toISOString()}`);
        emitCommunityKeyStatus('degraded');
        return null;
      }
      console.warn(`[VAULT] Community key bootstrap failed (HTTP ${response.status}).`);
      emitCommunityKeyStatus('degraded');
      return null;
    }
    const data = (await response.json().catch(() => undefined)) as CommunityKeyPayload | undefined;
    const value = String(data?.key || data?.token || '').trim();
    if (value.length < 8 || value.length > 256) {
      console.warn('[VAULT] Community key payload was empty or malformed.');
      emitCommunityKeyStatus('degraded');
      return null;
    }
    console.log('[VAULT] Fetch succeeded - saving key to safeStorage');
    await saveKey(COMMUNITY_KEY_LABEL, value);
    communityKeyCache = value;
    communityKeyCachedAt = Date.now();
    const exp = Number(data?.expiresAt);
    communityKeyExpiresAt =
      Number.isFinite(exp) && exp > Date.now() && exp <= Date.now() + 30 * 86_400_000
        ? exp
        : Date.now() + 24 * 3_600_000;
    console.log('[VAULT] Community key bootstrapped and encrypted via safeStorage.');
    emitCommunityKeyStatus('active');
    return value;
  } catch (err) {
    console.warn(`[VAULT] Fetch FAILED: ${err instanceof Error ? err.message : String(err)}`);
    emitCommunityKeyStatus('degraded');
    return null;
  }
}

/**
 * Community Key resolution, cache-first (Remote Bootstrap with Local
 * Encrypted Caching):
 *   1. Encrypted local cache via getKey('tycode_community_key') - zero
 *      latency, fully offline after the first successful launch.
 *   2. Single HTTPS GET to the Worker endpoint (5s AbortSignal.timeout),
 *      routed once for concurrent callers via the shared in-flight promise.
 *   3. Persist with saveKey() (safeStorage DPAPI/Keychain/Secret Service).
 *   4. Any failure (offline, endpoint down, malformed payload) resolves to
 *      null - never throws, the app calls never crash on this path.
 */
export async function getCommunityKey(): Promise<string | null> {
  // 1. In-memory cache check (0ms latency, zero decryption, zero network)
  if (communityKeyCache && communityKeyCache.trim()) {
    return communityKeyCache.trim();
  }
  if (decryptedKeyCache.has(COMMUNITY_KEY_LABEL)) {
    const val = decryptedKeyCache.get(COMMUNITY_KEY_LABEL)!.trim();
    if (val) {
      communityKeyCache = val;
      return val;
    }
  }

  // Cooldown guard: prevent unnecessary network calls while Cloudflare rate limit is active
  if (Date.now() < communityKeyRetryNotBefore) {
    emitCommunityKeyStatus('degraded');
    return null;
  }

  try {
    console.log('[VAULT] Checking cache for tycode_community_key...');
    const cached = await getKey(COMMUNITY_KEY_LABEL);
    if (cached && cached.trim()) {
      const value = cached.trim();
      if (communityKeyCache !== value) communityKeyCachedAt = Date.now();
      communityKeyCache = value;
      decryptedKeyCache.set(COMMUNITY_KEY_LABEL, value);
      // Expired-at is module memory only (never persisted, so it cannot leak
      // into any settings or credential UI). Across app restarts a restored
      // cache gets a conservative 24h horizon: at worst one revalidation per
      // user per day - still far inside the free-tier KV write budget.
      if (!communityKeyExpiresAt) communityKeyExpiresAt = Date.now() + 24 * 3_600_000;
      console.log('[VAULT] Cache HIT - returning cached key');
      emitCommunityKeyStatus('active');
      return value;
    }
  } catch (err) {
    // Vault read failure -> proceed to the remote fetch
    console.warn(`[VAULT] Cache check FAILED, proceeding to remote fetch: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (communityKeyInFlight) {
    console.log('[VAULT] Remote fetch already in flight - reusing shared promise');
    return communityKeyInFlight;
  }
  communityKeyInFlight = fetchCommunityKeyRemote();
  try {
    const resolved = await communityKeyInFlight;
    if (!resolved) {
      console.log('[VAULT] Returning null - falling back to anonymous tier');
      emitCommunityKeyStatus('degraded');
    } else {
      emitCommunityKeyStatus('active');
    }
    return resolved;
  } finally {
    communityKeyInFlight = null;
  }
}

/**
 * Returns the Community Key synchronously when it is already known from
 * memory or the encrypted cache. Never performs network requests - used for
 * cheap availability probes (router gating, failover eligibility).
 */
export function getCommunityKeyCached(): string | undefined {
  if (communityKeyCache && communityKeyCache.trim()) return communityKeyCache;
  if (decryptedKeyCache.has(COMMUNITY_KEY_LABEL)) {
    const val = decryptedKeyCache.get(COMMUNITY_KEY_LABEL)?.trim();
    if (val) {
      communityKeyCache = val;
      return val;
    }
  }
  const keys = loadAllKeys();
  const stored = keys[COMMUNITY_KEY_LABEL];
  if (stored && stored.trim()) {
    communityKeyCache = stored.trim();
    communityKeyCachedAt = Date.now();
    decryptedKeyCache.set(COMMUNITY_KEY_LABEL, communityKeyCache);
    return communityKeyCache;
  }
  return undefined;
}

export function hasCommunityKey(): boolean {
  return Boolean(getCommunityKeyCached());
}

/**
 * Seconds left before the Community-Key remote fetch is allowed again after a
 * 429 (rate-limit back-off). Zero when the chain is fetchable right now.
 */
export function getCommunityKeyCooldownRemainingSec(): number {
  if (Date.now() >= communityKeyRetryNotBefore) return 0;
  return Math.ceil((communityKeyRetryNotBefore - Date.now()) / 1000);
}

/**
 * Fire-and-forget prefetch used at app boot so the first chat message already
 * sees a provisioned Community Key (and the router treats the free tier as
 * available). Never throws; a cold/unreachable backend just leaves the
 * anonymous free pool as the working fallback.
 */
export function warmUpCommunityKey(): void {
  if (getCommunityKeyCached()) {
    // ZeroFriction diagnosis (Prompt 2): a warm boot skips the whole chain -
    // make that visible (logging only, resolution behavior unchanged)
    console.log('[VAULT] Warm boot: community key found in encrypted cache - skipping remote fetch');
    return;
  }
  void getCommunityKey().catch(() => undefined);
}

/**
 * Re-fetches the Community Key when the cached copy is older than maxAgeMs.
 * Supports key rotation: once a distributed key retires upstream (401/403),
 * the next resolution path invalidates and this routine restores a fresh key
 * without waiting for the user's next session.
 */
export async function revalidateCommunityKey(maxAgeMs: number): Promise<void> {
  const cached = getCommunityKeyCached();
  // Horizon: the server-provided expiry wins when known (weekly cadence);
  // otherwise fall back to the caller's maxAgeMs (6h boot poll).
  const horizon = communityKeyExpiresAt || communityKeyCachedAt + maxAgeMs;
  if (cached && Date.now() < horizon) return;
  if (communityKeyInFlight) {
    await communityKeyInFlight.catch(() => undefined);
    return;
  }
  // force=true bypasses the encrypted-cache short-circuit so a rotated key
  // actually replaces the retired one
  await fetchCommunityKey(true).catch(() => undefined);
}

/**
 * Back-compat wrapper over getCommunityKey(): legacy call sites (credential
 * alias chains) keep their boolean contract. force=true skips the cache
 * short-circuit (rotation revalidation).
 */
export async function fetchCommunityKey(force = false): Promise<string | undefined> {
  if (force) {
    communityKeyCache = undefined;
    decryptedKeyCache.delete(COMMUNITY_KEY_LABEL);
    return (await fetchCommunityKeyRemote()) || undefined;
  }
  return (await getCommunityKey()) || undefined;
}

/**
 * Drops the cached Community Key (memory + encrypted vault + credentialStore
 * sync) after a 401/403 so the next attempt bootstraps the current rotation.
 */
export function invalidateCommunityKey(): void {
  communityKeyCache = undefined;
  decryptedKeyCache.delete(COMMUNITY_KEY_LABEL);
  communityKeyCachedAt = 0;
  communityKeyExpiresAt = 0;
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
  try {
    void import('./auth/credential-store').then(({ credentialStore }) =>
      credentialStore.revokeCredential(COMMUNITY_KEY_LABEL).catch(() => undefined)
    );
  } catch {
    // Memory reset above is sufficient for this session
  }
}

export async function testKey(
  providerId: string,
  key: string
): Promise<{ success: boolean; message: string }> {
  const p = providerId.toLowerCase().trim();
  let trimmedKey = (key || '').trim();
  if (!trimmedKey || trimmedKey.includes('•') || trimmedKey.includes('****')) {
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
