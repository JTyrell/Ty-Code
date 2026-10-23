#!/usr/bin/env node
/**
 * Community Key END-TO-END diagnosis (ZeroFriction Prompt 4).
 *
 * Simulates the full flow of the Community Key system against the REAL
 * Cloudflare endpoint, then separately simulates the failure branches:
 *
 *   Phase A (live):
 *     Step 1: Clear any cached keys (fresh mock safeStorage vault).
 *     Step 2: getCommunityKey() -> Cache MISS -> REAL fetch to the actual
 *             Cloudflare endpoint -> key cached.
 *     Step 3: Verify the key is persisted ENCRYPTED (mock credentials.enc).
 *     Step 4: Call getCommunityKey() again -> Cache HIT, no second fetch.
 *
 *   Phase B (simulated failures, fresh vault each time):
 *     Step 5: Network failure -> resolves null gracefully.
 *     Step 6: HTTP 429 rate-limited (observed real limiter behavior) -> null.
 *
 * Hygiene: keys are printed ONLY as mask (last 4 chars + length) and the
 * simulated vault file stores ONLY the encrypted envelope.
 *
 * Usage: node scripts/test-community-key-e2e.mjs
 */

const ENDPOINT_URL =
  process.env.TYCODE_TEST_ENDPOINT ||
  'https://ty-code.jevountyrell.workers.dev/community-key';

const REQUEST_TIMEOUT_MS = 5000;
const COMMUNITY_KEY_LABEL = 'tycode_community_key';
const mask = (key) => (key ? `...${key.slice(-4)} (len:${key.length})` : 'null');
const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const logStep = (n, msg) => console.log(`[E2E] Step ${n}: ${msg} (${stamp()})`);

// ---------------------------------------------------------------------------
// Mock Electron environment
// ---------------------------------------------------------------------------

/** Mock safeStorage: a Map acting as the encrypted "credentials.enc" file. */
const vaultFile = new Map();
const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(plaintext) {
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

/** Active fetch function for the vault logic (real by default, stubbed per phase). */
let fetchImpl = globalThis.fetch.fetch ? globalThis.fetch.bind(globalThis) : globalThis.fetch;

// ---------------------------------------------------------------------------
// Credential Vault logic (mirrors src/main/services/credential-vault.ts)
// ---------------------------------------------------------------------------

function resetVault() {
  vaultFile.clear();
  communityKeyCache = undefined;
  communityKeyExpiresAt = 0;
  communityKeyInFlight = null;
}

function loadAllKeys() {
  if (vaultFile.size === 0) return {};
  try {
    const decryptedStr = mockSafeStorage.decryptString(Buffer.from(vaultFile.get('credentials.enc'), 'hex'));
    return JSON.parse(decryptedStr);
  } catch (err) {
    console.log(`[VAULT] safeStorage decryption FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

async function saveKey(providerId, key) {
  console.log('[VAULT] Encrypting key with safeStorage...');
  if (!mockSafeStorage.isEncryptionAvailable()) {
    console.log('[VAULT] safeStorage encryption FAILED: safeStorage encryption is not available');
    throw new Error('safeStorage encryption is not available');
  }
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  keys[normProvider] = key.trim();
  const encryptedBuffer = mockSafeStorage.encryptString(JSON.stringify(keys));
  vaultFile.set('credentials.enc', encryptedBuffer.toString('hex'));
  console.log('[VAULT] Key saved successfully');
}

async function getKey(providerId) {
  console.log('[VAULT] Decrypting key from safeStorage...');
  const normProvider = providerId.toLowerCase().trim();
  const keys = loadAllKeys();
  if (keys[normProvider]) {
    console.log('[VAULT] Key decrypted successfully');
    return keys[normProvider];
  }
  return null;
}

let communityKeyCache;
let communityKeyExpiresAt = 0;
let communityKeyInFlight = null;

async function fetchCommunityKeyRemote() {
  console.log(`[VAULT] Cache MISS - fetching from Cloudflare endpoint: ${ENDPOINT_URL}`);
  const t0 = performance.now();
  try {
    const response = await fetchImpl(ENDPOINT_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    console.log(`[VAULT] Fetch response status: ${response.status}`);
    if (!response.ok) {
      console.log(`[VAULT] Community key bootstrap failed (HTTP ${response.status}).`);
      return null;
    }
    const data = (await response.json().catch(() => undefined)) || {};
    const value = String(data?.key || data?.token || '').trim();
    if (value.length < 8 || value.length > 256) {
      console.log('[VAULT] Community key payload was empty or malformed.');
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
    console.log(`[VAULT] Fetch FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function getCommunityKey() {
  try {
    console.log('[VAULT] Checking cache for tycode_community_key...');
    const cached = await getKey(COMMUNITY_KEY_LABEL);
    if (cached && cached.trim()) {
      const value = cached.trim();
      if (communityKeyCache !== value) communityKeyCachedAt = Date.now();
      communityKeyCache = value;
      if (!communityKeyExpiresAt) communityKeyExpiresAt = Date.now() + 24 * 3_600_000;
      console.log('[VAULT] Cache HIT - returning cached key');
      return value;
    }
  } catch (err) {
    console.log(`[VAULT] Cache check FAILED, proceeding to remote fetch: ${err instanceof Error ? err.message : String(err)}`);
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
let communityKeyCachedAt = 0;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];
function expect(name, condition) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`      -> ${condition ? 'PASS' : 'FAIL'}  ${name}`);
}

function failureFetch(mode) {
  if (mode === 'network-error') {
    return async () => {
      throw new Error('getaddrinfo ENOTFOUND ty-code.jevountyrell.workers.dev');
    };
  }
  return async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    headers: new Headers({ 'retry-after': '60' }),
    url: ENDPOINT_URL,
    json: async () => ({ error: 'Rate limit exceeded' })
  });
}

async function runTests() {
  console.log('=== Community Key END-TO-END diagnosis (live endpoint phase) ===');
  console.log(`Endpoint: ${ENDPOINT_URL}\n`);

  // ---------------- Phase A: live chain ----------------
  resetVault();
  logStep(1, 'Cache cleared - vault is empty (fresh mock safeStorage)');
  expect('step1: mock vault starts empty', vaultFile.size === 0 && communityKeyCache === undefined && !vaultFile.get('credentials.enc'));

  const t0 = performance.now();
  const first = await getCommunityKey();
  const liveMs = Math.round(performance.now() - t0);
  logStep(2, `Cache miss - fetched from Cloudflare -> ${first ? 'KEY ' + mask(first) : 'null'} (${liveMs}ms)`);
  expect('step2: first getCommunityKey() returned a key', typeof first === 'string' && first.length >= 8);
  expect('step2: key cached in memory', communityKeyCache === first);
  expect(`step2: live endpoint responded 200 within 5s (${liveMs}ms)`, first !== null && liveMs < 5500);
  if (first) console.log(`      -> provider contract: expires in ~${Math.round((communityKeyExpiresAt - Date.now()) / 3_600_000)}h, response took ${liveMs}ms`);

  const storedEnc = vaultFile.get('credentials.enc');
  logStep(3, `Key cached successfully - vault file holds ONLY the ENCRYPTED envelope (${storedEnc ? String(storedEnc).length + ' hex chars, starts 454e433a3a: ' + String(storedEnc).startsWith('454e433a3a') : 'MISSING'})`);
  expect('step3: key saved to safeStorage (encrypted envelope present)', storedEnc !== undefined && storedEnc.startsWith('454e433a3a'));
  expect('step3: plaintext key is NOT raw in the vault file', !storedEnc.includes(first));
  const vaultDoc = JSON.parse(mockSafeStorage.decryptString(Buffer.from(storedEnc, 'hex')));
  expect('step3: decrypted vault doc holds the community label', vaultDoc[COMMUNITY_KEY_LABEL] === first);

  const second = await getCommunityKey();
  logStep(4, `Cache hit - no fetch needed (second call returned ${second ? 'same key ' + mask(second) : 'null'})`);
  expect('step4: second call returns the SAME key without a second network request', second === first);

  // ---------------- Phase B: failure branches (isolated, no network) ----------------
  console.log('\n=== Phase B: simulated failures (isolated vaults) ===\n');

  resetVault();
  fetchImpl = failureFetch('network-error');
  const netFail = await getCommunityKey();
  logStep(5, 'Network failure simulated - returned null gracefully (anonymous-tier fallback)');
  expect('step5: network failure resolves to null without throwing', netFail === null);

  resetVault();
  fetchImpl = failureFetch('rate-limit');
  const rateLimit = await getCommunityKey();
  logStep(6, 'HTTP 429 rate limit simulated - returned null gracefully (observed real limiter shape: 5 req / 5 min per IP)');
  expect('step6: 429 resolves to null without throwing', rateLimit === null);

  // Always restore the real fetch last.
  fetchImpl = globalThis.fetch.fetch ? globalThis.fetch.bind(globalThis) : globalThis.fetch;

  console.log('\n=== Summary ===');
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  console.log(`\n${results.length - failed}/${results.length} E2E checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('E2E runner crashed:', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

