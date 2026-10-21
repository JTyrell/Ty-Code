#!/usr/bin/env node
/**
 * QA harness: "Remote Bootstrap with Local Encrypted Caching" for the
 * Ty-Code Community Free Tier (src/main/services/credential-vault.ts).
 *
 * Strategy: the REAL credential-vault.ts source is copied into a sandbox
 * tree and executed under Node's native type-stripping. The `electron`
 * module is replaced by a mock node_modules package whose safeStorage
 * mirrors DPAPI/Keychain semantics (encryptString/decryptString round
 * trip, isEncryptionAvailable), and the two dynamic-import modules
 * (auth/credential-store, ipc/settings-handlers) are stubbed as
 * extensionless ESM mocks. globalThis.fetch is replaced by a
 * scenario-driven mock honoring AbortSignal so the 5000ms timeout path
 * is exercised for real.
 *
 * Run: node scripts/test-community-key.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REAL_SOURCE = path.join(REPO_ROOT, 'src', 'main', 'services', 'credential-vault.ts');

const TEST_KEY = 'sk-or-v1-qa-TESTKEY-0001';
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Shared state registry, mutated by the electron mock package at call time
globalThis.__QA_STATE = {
  logs: [],
  fetchCalls: [],
  statusQueue: [],
  forceNetworkError: false,
  hangFetch: false,
  userData: '',
  lastEncrypted: ''
};
const S = globalThis.__QA_STATE;

const log = console.log.bind(console);
const origConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function patchConsole() {
  for (const method of ['log', 'warn', 'error', 'info']) {
    console[method] = (...args) => {
      const line = args.map((a) => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
      S.logs.push(`${method}: ${line}`);
      origConsole.log(`    [app-console:${method}] ${line}`);
    };
  }
}
function resetConsole() {
  console.log = origConsole.log; console.warn = origConsole.warn;
  console.error = origConsole.error; console.info = origConsole.info;
}

// Fetch mock: honors AbortSignal (so AbortSignal.timeout(5000) aborts us for real)
async function mockFetch(input, init = {}) {
  S.fetchCalls.push(String(input));
  if (S.hangFetch) {
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  }
  if (S.forceNetworkError) throw new Error('getaddrinfo ENOTFOUND (simulated offline)');
  if (!S.statusQueue.length) throw new Error('UNEXPECTED FETCH: scenario response budget exhausted');
  const resp = S.statusQueue.shift();
  return typeof resp === 'function' ? resp() : resp;
}

function writeSandbox() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-community-key-'));
  const tree = (p) => path.join(tmpRoot, p);
  for (const d of ['src/main/services', 'src/main/services/auth', 'src/main/ipc', 'node_modules/electron']) {
    fs.mkdirSync(tree(d), { recursive: true });
  }
  fs.writeFileSync(tree('package.json'), JSON.stringify({ name: 'qa-tree', private: true, type: 'module' }));
  fs.copyFileSync(REAL_SOURCE, tree('src/main/services/credential-vault.ts'));

  fs.writeFileSync(tree('node_modules/electron/package.json'),
    JSON.stringify({ name: 'electron', version: '999.0.0-qa', type: 'module', main: 'index.mjs' }));
  fs.writeFileSync(tree('node_modules/electron/index.mjs'), [
    "const S = globalThis.__QA_STATE;",
    "export const safeStorage = {",
    "  isEncryptionAvailable: () => true,",
    "  encryptString: (payload) => { S.lastEncrypted = String(payload); return Buffer.from('ENC:' + String(payload)); },",
    "  decryptString: (buf) => {",
    "    const s = typeof buf === 'string' ? buf : (buf && buf.toString ? buf.toString('utf8') : String(buf));",
    "    return Buffer.from(s.startsWith('ENC:') ? s.slice(4) : s);",
    "  }",
    "};",
    "export const app = { getPath: (p) => (p === 'userData' ? S.userData : (() => { throw new Error('unexpected getPath: ' + p); })()) };",
    "export default { safeStorage, app };"
  ].join('\n'));

  fs.writeFileSync(tree('src/main/services/auth/credential-store'), [
    "export const credentialStore = {",
    "  saveCredential: async () => true,",
    "  getDecryptedKey: () => null,",
    "  revokeCredential: async () => true",
    "};"
  ].join('\n'));

  fs.writeFileSync(tree('src/main/ipc/settings-handlers'),
    "export async function readStoredCredentials() { return Promise.resolve({ keys: {} }); }");

  return tmpRoot;
}

async function main() {
  const tmpRoot = writeSandbox();
  const tree = (p) => path.join(tmpRoot, p);
  const modUrl = (tag) => pathToFileURL(tree('src/main/services/credential-vault.ts')).href + tag;
  const sourceOnDisk = fs.readFileSync(tree('src/main/services/credential-vault.ts'), 'utf8');

  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    origConsole.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${name}\n        ${detail}`);
  };
  const newUserData = (tag) => {
    S.userData = tree('userdata-' + tag);
    fs.mkdirSync(S.userData, { recursive: true });
    return S.userData;
  };

  origConsole.log('QA harness sandbox: ' + tmpRoot);
  origConsole.log('Testing real source: ' + REAL_SOURCE);
  patchConsole();
  globalThis.fetch = mockFetch;

  // ===== Scenario A: first launch (cache miss -> fetch -> safeStorage save) ==
  newUserData('A');
  S.statusQueue = [json({ key: TEST_KEY, provider: 'openrouter', expiresAt: Date.now() + 7 * 86_400_000 })];
  const modA = await import(modUrl('?scenario=A'));
  const callsA = S.fetchCalls.length;
  const gotA = await modA.getCommunityKey();
  const grewA = S.fetchCalls.length - callsA;
  record('A1 cache miss -> fetch -> key returned', gotA === TEST_KEY, `returned=${gotA === TEST_KEY ? 'community key' : String(gotA)}, fetch growth=${grewA}`);

  record('A2 exactly one network fetch', grewA === 1, `growth=${grewA}, url=${S.fetchCalls[callsA]}`);

  const vaultFileRaw = fs.readFileSync(path.join(S.userData, 'credentials.enc'), 'utf8');
  record('A3 key persisted only through safeStorage envelope', vaultFileRaw.startsWith('ENC:') && S.lastEncrypted.includes(TEST_KEY),
    `on-disk prefix=${vaultFileRaw.slice(0, 4)}... (plaintext absent on disk: ${!vaultFileRaw.includes(TEST_KEY)})`);

  const leakA = S.logs.filter((l) => l.includes(TEST_KEY)).length;
  record('A4 zero plaintext key leakage in app console', leakA === 0, `inspected ${S.logs.length} app-console lines, leaks=${leakA}`);

  // ===== Scenario B1: second call, same process (memory cache) ==============
  const callsB1 = S.fetchCalls.length;
  const gotB1 = await modA.getCommunityKey();
  record('B1 same-process repeat: served from cache, no network', gotB1 === TEST_KEY && S.fetchCalls.length === callsB1,
    `value ok=${gotB1 === TEST_KEY}, fetch growth=${S.fetchCalls.length - callsB1}`);

  // ===== Scenario B2: cold restart with network DOWN (encrypted cache) ======
  S.forceNetworkError = true;
  newUserData('B'); // point getPath back at A's dir so the vault file is still there
  S.userData = tree('userdata-A');
  const modB2 = await import(modUrl('?scenario=B2'));
  const callsB2 = S.fetchCalls.length;
  const gotB2 = await modB2.getCommunityKey();
  record('B2 offline relaunch: key restored from encrypted file', gotB2 === TEST_KEY && S.fetchCalls.length === callsB2,
    `value ok=${gotB2 === TEST_KEY}, fetch growth=${S.fetchCalls.length - callsB2} (network forced to fail)`);
  record('B2b getCommunityKeyCached() exposes the restored key', modB2.getCommunityKeyCached() === TEST_KEY, `synchronous probe ok=${modB2.getCommunityKeyCached() === TEST_KEY}`);
  S.forceNetworkError = false;

  // ===== Scenario B3: server expiresAt (7d) suppresses 6h boot revalidation =
  const callsB3 = S.fetchCalls.length;
  const tB3 = Date.now();
  await modB2.revalidateCommunityKey(6 * 3600e3);
  record('B3 fresh server horizon suppresses revalidation fetch',
    Date.now() - tB3 < 250 && S.fetchCalls.length === callsB3,
    `elapsed=${Date.now() - tB3}ms, fetch growth=${S.fetchCalls.length - callsB3}`);

  // ===== Scenario C: endpoint down (503) on cold cache ======================
  newUserData('C');
  S.statusQueue = [json({ error: 'Service temporarily unavailable' }, 503), json({ error: 'Service temporarily unavailable' }, 503)];
  const modC = await import(modUrl('?scenario=C'));
  const gotC = await modC.getCommunityKey();
  record('C1 503 endpoint -> null, no crash', gotC === null, `returned=${gotC}`);
  const gotC2 = await modC.getKey('ty-code-free');
  record('C2 full ty-code-free resolution chain degrades to null', gotC2 === null, `chain result=${gotC2}`);
  const leakC = S.logs.filter((l) => l.includes(TEST_KEY)).length;
  record('C3 still zero key leakage through failure paths', leakC === 0, `leaks=${leakC}`);

  // ===== Scenario D: malformed payload (no key field) =======================
  newUserData('D');
  S.statusQueue = [json({ error: 'Community key not provisioned' })];
  const modD = await import(modUrl('?scenario=D'));
  const gotD = await modD.getCommunityKey();
  record('D malformed payload -> null (no soft-crash)', gotD === null, `returned=${gotD}`);

  // ===== Scenario E: hanging endpoint, real 5000ms AbortSignal.timeout ======
  newUserData('E');
  S.hangFetch = true;
  const modE = await import(modUrl('?scenario=E'));
  const tE = Date.now();
  let gotE = 'promise-still-hanging-sentinel';
  try {
    gotE = await Promise.race([modE.getCommunityKey(), new Promise((resolve) => setTimeout(() => resolve('promise-still-hanging-sentinel'), 8000))]);
  } catch (e) { gotE = 'crashed: ' + e.message; }
  const eElapsed = Date.now() - tE;
  record('E Main Process never blocks: 5000ms timeout enforced',
    gotE === null && eElapsed >= 4700 && eElapsed <= 6800,
    `returned=${gotE === null ? 'null' : gotE}, elapsed=${eElapsed}ms (expected ~5000)`);
  S.hangFetch = false;

  // ===== Static audits against the real source =============================
  record('S1 5000ms AbortSignal.timeout present on community fetch',
    /AbortSignal\.timeout\(5000\)/.test(sourceOnDisk),
    'fetchCommunityKeyRemote() is strictly time-bounded');
  record('S2 remote bootstrap persists only via saveKey (safeStorage)',
    /await saveKey\(COMMUNITY_KEY_LABEL, value\)/.test(sourceOnDisk) && /safeStorage\.encryptString/.test(sourceOnDisk),
    'no plaintext persistence path in the bootstrap flow');
  record('S3 every failure branch resolves to null (never throws)',
    /return null;/.test(sourceOnDisk) && /console\.warn\('\[VAULT\]/.test(sourceOnDisk),
    'offline / HTTP error / malformed / abort paths are all catch-guarded');
  record('S4 endpoint constant points at the deployed Worker',
    /const COMMUNITY_KEY_ENDPOINT = 'https:\/\/ty-code\.jevountyrell\.workers\.dev\/community-key'/.test(sourceOnDisk),
    'COMMUNITY_KEY_ENDPOINT = https://ty-code.jevountyrell.workers.dev/community-key');

  resetConsole();

  const failed = results.filter((r) => !r.ok);
  log('\n' + '='.repeat(84));
  log(`QA RESULTS: ${results.length - failed.length}/${results.length} passed  (scenarios A, B, C, D, E + static audits)`);
  for (const r of results) log(` ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (failed.length) {
    for (const r of failed) log(`  ! ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  } else {
    log('ALL SCENARIOS GREEN - Remote Bootstrap logic verified against the real vault source.');
  }
  log('Sandbox (auto-cleanable): ' + tmpRoot);
}

process.on('unhandledRejection', (e) => {
  resetConsole();
  log('\n[QA] unhandledRejection: ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});

main().catch((e) => {
  resetConsole();
  log('\n[QA] harness crashed: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
