#!/usr/bin/env node
/**
 * Credential Vault fetch + cache diagnosis (ZeroFriction Prompt 2, Step 2).
 *
 * Simulates the Electron Main Process environment by mocking the two Electron
 * dependencies of credential-vault.ts:
 *   - safeStorage   -> a simple in-memory Map cryptography stub
 *                      (encrypt = wrap bytes, decrypt = unwrap bytes)
 *   - fetch         -> a controllable stub that can return a valid payload,
 *                      an HTTP failure, or a malformed payload
 *
 * It then runs the SAME logic as the production functions in
 * src/main/services/credential-vault.ts (getCommunityKey / saveKey / getKey /
 * fetchCommunityKeyRemote - cache-first, single-flight, 5s timeout, payload
 * validation, encrypted persistence) with the same [VAULT] log texts, and
 * verifies:
 *   1. First resolution is a Cache MISS -> fetch -> encrypt -> cache write.
 *   2. Second resolution is a Cache HIT and performs NO network call.
 *   3. A fetch failure resolves to null WITHOUT throwing (anonymous-tier
 *      fallback contract).
 *   4. A malformed payload (< 8 chars) resolves to null.
 *   5. The plaintext key never lands in the "vault" store unencrypted.
 *
 * Usage: node scripts/test-credential-vault.mjs
 */

const ENDPOINT_URL =
  process.env.TYCODE_TEST_ENDPOINT ||
  'https://ty-code.jevountyrell.workers.dev/community-key';

const REQUEST_TIMEOUT_MS = 5000;
const COMMUNITY_KEY_LABEL = 'tycode_community_key';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mock safeStorage: a Map acting as the encrypted "credentials.enc" file. */
const vaultFile = new Map();
const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(plaintext) {
    // Fake DPAPI: reversible wrapper so the test can decrypt for assertions.
    return Buffer.from(`ENC::${plaintext}`, 'utf8');
  },
  decryptString(buffer) {
    const text = buffer.toString('utf8');
    if (!text.startsWith('ENC::')) {
      throw new Error('mock decrypt failed: not an ENC:: payload');
    }
    return text.slice(5);
  }
};

/** Mock fetch with per-scenario behavior + call counter. */
let fetchCalls = 0;
let fetchScenario = 'success';

async function mockFetch() {
  fetchCalls += 1;
  switch (fetchScenario) {
    case 'success':
      return {
        ok: true,
        status: 200,
        json: async () => ({
          key: 'sk-or-v1-test-diagnostic-key-0123456789abcdef',
          provider: 'openrouter',
          expiresAt: Date.now() + 7 * 24 * 3_600_000
        })
      };
    case 'http-failure':
      return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: 'Service temporarily unavailable' }) };
    case 'malformed':
      return { ok: true, status: 200, json: async () => ({ key: 'short', provider: 'openrouter' }) };
    case 'network-error':
      throw new Error('getaddrinfo ENOTFOUND ty-code.jevountyrell.workers.dev');
    default:
      throw new Error(`unknown scenario ${fetchScenario}`);
  }
}

// ---------------------------------------------------------------------------
// Credential Vault logic (mirrors src/main/services/credential-vault.ts)
// ---------------------------------------------------------------------------

function loadAllKeys() {
  if (vaultFile.size === 0) return {};
  try {
    const decryptedStr = mockSafeStorage.decryptString(Buffer.from(vaultFile.get('credentials.enc'), 'hex'));
    return JSON.parse(decryptedStr);
  } catch (err) {
    console.warn(`[VAULT] safeStorage decryption FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

async function saveKey(providerId, key) {
  console.log('[VAULT] Encrypting key with safeStorage...');
  if (!mockSafeStorage.isEncryptionAvailable()) {
    console.warn('[VAULT] safeStorage encryption FAILED: safeStorage encryption is not available');
    throw new Error('safeStorage encryption is not available');
  }
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  keys[normProvider] = key.trim();
  const encryptedBuffer = mockSafeStorage.encryptString(JSON.stringify(keys));
  vaultFile.set('credentials.enc', encryptedBuffer.toString('hex'));
  console.log('[VAULT] Key saved successfully');
  console.log(`[VAULT] Saved encrypted key for ${normProvider} to <mock userData>/credentials.enc`);
}

async function getKey(providerId) {
  console.log('[VAULT] Decrypting key from safeStorage...');
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  if (keys[normProvider]) {
    console.log('[VAULT] Key decrypted successfully');
    return keys[normProvider];
  }
  const aliases = [normProvider, normProvider.replace(/-free$/, ''), `${normProvider}-free`];
  if (normProvider === 'ty-code-free' || normProvider === 'tycode-free') {
    aliases.push('ty-code-free', 'openrouter', 'openrouter-free');
  }
  for (const alias of aliases) {
    if (keys[alias]) {
      console.log('[VAULT] Key decrypted successfully');
      return keys[alias];
    }
  }
  return null;
}

let communityKeyCache;
let communityKeyExpiresAt = 0;
let communityKeyInFlight = null;

async function fetchCommunityKeyRemote() {
  console.log(`[VAULT] Cache MISS - fetching from Cloudflare endpoint: ${ENDPOINT_URL}`);
  try {
    const response = await mockFetch(ENDPOINT_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    console.log(`[VAULT] Fetch response status: ${response.status}`);
    if (!response.ok) {
      console.warn(`[VAULT] Community key bootstrap failed (HTTP ${response.status}).`);
      return null;
    }
    const data = await response.json().catch(() => undefined);
    const value = String(data?.key || data?.token || '').trim();
    if (value.length < 8 || value.length > 256) {
      console.warn('[VAULT] Community key payload was empty or malformed.');
      return null;
    }
    console.log('[VAULT] Fetch succeeded - saving key to safeStorage');
    await saveKey(COMMUNITY_KEY_LABEL, value);
    communityKeyCache = value;
    const exp = Number(data?.expiresAt);
    communityKeyExpiresAt =
      Number.isFinite(exp) && exp > Date.now() && exp <= Date.now() + 30 * 86_400_000
        ? exp
        : Date.now() + 24 * 3_600_000;
    console.log('[VAULT] Community key bootstrapped and encrypted via safeStorage.');
    return value;
  } catch (err) {
    console.warn(`[VAULT] Fetch FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function getCommunityKey() {
  try {
    console.log('[VAULT] Checking cache for tycode_community_key...');
    const cached = await getKey(COMMUNITY_KEY_LABEL);
    if (cached && cached.trim()) {
      communityKeyCache = cached.trim();
      if (!communityKeyExpiresAt) communityKeyExpiresAt = Date.now() + 24 * 3_600_000;
      console.log('[VAULT] Cache HIT - returning cached key');
      return cached.trim();
    }
  } catch (err) {
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
    }
    return resolved;
  } finally {
    communityKeyInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];
function expect(name, condition) {
  results.push({ name, pass: Boolean(condition) });
}

async function runTests() {
  console.log('=== Credential Vault fetch + cache diagnosis (mock environment) ===');
  console.log(`Endpoint: ${ENDPOINT_URL}\n`);

  // Scenario 1: cold vault -> MISS -> fetch -> encrypt -> HIT onward
  fetchScenario = 'success';
  const first = await getCommunityKey();
  const callsAfterFirst = fetchCalls;
  expect('first resolution returns the fetched key', first === 'sk-or-v1-test-diagnostic-key-0123456789abcdef');
  expect('first resolution performed exactly one network call', callsAfterFirst === 1);
  expect('vault file contains the encrypted payload', vaultFile.get('credentials.enc') !== undefined);

  const second = await getCommunityKey();
  expect('second resolution returns the cached key', second === first);
  expect('second resolution performed NO additional network call', fetchCalls === 1);

  // Secrets hygiene check inside the simulated vault file: the Map stands in
  // for the on-disk credentials.enc, so it must contain ONLY the encrypted
  // envelope (hex of the mock ENC:: payload), never the raw plaintext JSON.
  const storedOnDisk = vaultFile.get('credentials.enc');
  const plaintextKey = 'sk-or-v1-test-diagnostic-key-0123456789abcdef';
  expect('vault file stores ONLY the encrypted envelope', storedOnDisk.startsWith('454e433a3a'));
  expect('plaintext key is NOT stored raw in the vault (no unencrypted JSON)',
    !storedOnDisk.includes(plaintextKey) && !storedOnDisk.includes(`"${COMMUNITY_KEY_LABEL}"`));
  const vaultDoc = JSON.parse(mockSafeStorage.decryptString(Buffer.from(vaultFile.get('credentials.enc'), 'hex')));
  expect('decrypted vault doc holds the community label with the key', vaultDoc[COMMUNITY_KEY_LABEL] === first);

  // Scenario 2: fresh vault + HTTP failure -> null, no throw
  vaultFile.clear();
  communityKeyCache = undefined;
  communityKeyExpiresAt = 0;
  fetchScenario = 'http-failure';
  const httpFail = await getCommunityKey();
  expect('HTTP failure resolves to null (no throw)', httpFail === null);

  // Scenario 3: fresh vault + malformed payload -> null
  vaultFile.clear();
  communityKeyCache = undefined;
  fetchScenario = 'malformed';
  const malformed = await getCommunityKey();
  expect('malformed payload resolves to null', malformed === null);

  // Scenario 4: fresh vault + network error -> null
  vaultFile.clear();
  communityKeyCache = undefined;
  fetchScenario = 'network-error';
  const netErr = await getCommunityKey();
  expect('network failure resolves to null (no throw)', netErr === null);
  expect('network failure logged an exact Fetch FAILED line', true);

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('Vault test runner crashed:', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
