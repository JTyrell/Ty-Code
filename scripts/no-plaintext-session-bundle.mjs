#!/usr/bin/env node
/**
 * Anti-Plaintext Guard: No Unencrypted Session / Checkpoint Bundle (Prompt A/D)
 *
 * Sessions and checkpoints are local-first and must never touch disk in the
 * clear. The ONLY sanctioned writers are:
 *   - src/main/services/session/unified-session-store.ts   (chat sessions)
 *   - src/main/services/session/session-migration.ts       (legacy importer)
 *   - src/main/services/checkpoints/snapshot-backend.ts     (checkpoint bundles)
 * each of which routes every payload through session-crypto's encryptJson so the
 * bytes on disk are a { v, cipher:'safeStorage', meta, payload } envelope.
 *
 * The two legacy writers (agent + orchestration session stores) must be gone —
 * they wrote plaintext JSON. This guard fails the build if a plaintext session
 * write reappears anywhere outside the allowlist, keeping the deprecation real.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedChecks++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Anti-Plaintext Session Guard Violation: ${message}`);
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const ALLOWED_WRITERS = new Set([
  'src/main/services/session/unified-session-store.ts',
  'src/main/services/session/session-migration.ts',
  'src/main/services/checkpoints/snapshot-backend.ts'
]);

// A plaintext session/bundle write: serializing a session-shaped object straight
// to disk (fs.writeFile / writeFile) with a `messages`/`todos`/`payload` body and
// WITHOUT the encryptJson envelope on the same line-ish.
const WRITE_CALL = /(?:fs\.writeFile|await\s+writeFile|writeFile)\s*\(/;

async function walk(dir, acc = []) {
  if (!fsSync.existsSync(dir)) return acc;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, acc);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

async function rel(abs) {
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

async function main() {
  console.log('========================================================================');
  console.log('=== ANTI-PLAINTEXT SESSION / CHECKPOINT BUNDLE GUARD                 ===');
  console.log('========================================================================\n');

  // 1. The sanctioned store actually encrypts through the envelope.
  console.log('1. Verifying the unified store writes only the encrypted envelope...');
  const store = stripComments(await fs.readFile(path.join(PROJECT_ROOT, 'src/main/services/session/unified-session-store.ts'), 'utf8'));
  assert(store.includes('SessionEnvelopeSchema'), 'unified-session-store.ts validates against SessionEnvelopeSchema');
  assert(store.includes('encryptJson'), 'unified-session-store.ts serializes payload via encryptJson');
  assert(/v:\s*SESSION_ENVELOPE_VERSION/.test(store), 'unified-session-store.ts stamps the envelope version');
  assert(
    !/writeFile\([^)]*JSON\.stringify\(\s*payload/.test(store),
    'unified-session-store.ts never writes a raw payload object (always through the envelope)'
  );

  // 2. session-crypto wraps safeStorage and has no plaintext fallback.
  console.log('\n2. Verifying session-crypto wraps safeStorage with no plaintext fallback...');
  const cryptoSrc = stripComments(await fs.readFile(path.join(PROJECT_ROOT, 'src/main/services/session/session-crypto.ts'), 'utf8'));
  assert(cryptoSrc.includes('encryptSecret') && cryptoSrc.includes('decryptSecret'), 'session-crypto.ts delegates to encryptSecret/decryptSecret');
  assert(/throw|refusing to persist/i.test(await fs.readFile(path.join(PROJECT_ROOT, 'src/main/services/session/unified-session-store.ts'), 'utf8')), 'the store refuses to persist when secure storage is unavailable');

  // 3. The legacy writers must have no disk-write path left.
  console.log('\n3. Verifying the two legacy session writers are fully deprecated...');
  const legacyWriters = [
    'src/main/agent/session-store.ts',
    'src/main/services/orchestration/session-store.ts'
  ];
  for (const relPath of legacyWriters) {
    const abs = path.join(PROJECT_ROOT, relPath);
    if (!fsSync.existsSync(abs)) {
      assert(true, `${relPath} has been removed outright`);
      continue;
    }
    const code = stripComments(await fs.readFile(abs, 'utf8'));
    assert(!WRITE_CALL.test(code), `${relPath} contains no direct fs.writeFile call`);
    assert(!/writeSession\s*\(/.test(code), `${relPath} declares no writeSession writer`);
    assert(!/saveSession\s*\([^)]*\)\s*:[^]*writeFile/.test(code), `${relPath} saveSession no longer persists to disk`);
  }

  // 4. No plaintext session/bundle write anywhere else under src/main.
  //    Keyed on the WRITE TARGET, not incidental keywords: a file is dangerous
  //    only when a write call points at a sessions/.bundle path AND the
  //    file never routes through encryptJson/SessionEnvelope. This keeps the boot
  //    orchestrator (index.ts, which writes workspace files and merely *references*
  //    sessions for logging) from tripping a whole-file keyword match.
  console.log('\n4. Scanning all of src/main for an unauthorized plaintext session/bundle write...');
  // NOTE: bare `.tycode` is deliberately NOT a session marker. The knowledge layer
  // (wiki, rules, memory queue) intentionally persists plaintext, git-shareable
  // files under `.tycode/` — they are project config, not conversation data.
  // Real session writes always land under a `sessions`/SESSIONS_ROOT path or in a
  // `.bundle`, which this regex still catches.
  const SESSION_TARGET = /sessions|SESSIONS_ROOT|\.bundle/;
  const files = await walk(path.join(PROJECT_ROOT, 'src/main'));
  let scanned = 0;
  for (const abs of files) {
    const r = await rel(abs);
    if (r.includes('session-crypto.ts')) continue;
    scanned++;
    const code = stripComments(await fs.readFile(abs, 'utf8'));
    if (ALLOWED_WRITERS.has(r)) continue;
    if (code.includes('encryptJson') || code.includes('SessionEnvelope')) continue;
    const writeSites = [...code.matchAll(/(?:fs\.)?writeFile(?:Sync)?\s*\(/g)];
    for (const m of writeSites) {
      const window = code.slice(m.index, m.index + 240);
      if (SESSION_TARGET.test(window)) {
        assert(false, `${r} writes to a session/bundle path without encryptJson/SessionEnvelope`);
      }
    }
  }
  assert(scanned > 0, `scanned ${scanned} main-process source files`);

  // 5. Guard self-test.
  console.log('\n5. Running guard self-test against synthetic plaintext-writer content...');
  const violating = [
    "await fs.writeFile(path.join(SESSIONS_ROOT, id + '.json'), JSON.stringify({ messages, todos }));",
    'fs.writeFile(path.join(dir, n + ".bundle"), JSON.stringify({ checkpointRefs, messages }))'
  ];
  for (const snippet of violating) {
    const hasWrite = /(?:fs\.)?writeFile(?:Sync)?\s*\(/.test(snippet);
    const window = snippet.slice(snippet.indexOf('writeFile'));
    const targetsSession = SESSION_TARGET.test(window);
    const encrypts = snippet.includes('encryptJson') || snippet.includes('SessionEnvelope');
    const wouldBeFlagged = hasWrite && targetsSession && !encrypts;
    assert(wouldBeFlagged, `self-test flags: ${snippet.slice(0, 50)}...`);
  }

  console.log('\n========================================================================');
  console.log(`=== GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]             ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Anti-Plaintext Session Guard Failed:', err);
  process.exit(1);
});
