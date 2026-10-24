#!/usr/bin/env node
/**
 * Zero-Network & Pure-RAM Guard for Prompt Assembler
 *
 * Enforces architectural constraints:
 * 1. project-scanner.ts must NOT import network modules (net, http, https, tls, fetch, etc.)
 * 2. telemetry-ring.ts must NOT import file system (fs) or network modules (net, http, tls, etc.)
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCANNER_FILE = path.join(PROJECT_ROOT, 'src', 'main', 'agent', 'prompt-assembler', 'project-scanner.ts');
const RING_FILE = path.join(PROJECT_ROOT, 'src', 'main', 'agent', 'prompt-assembler', 'telemetry-ring.ts');

const FORBIDDEN_NETWORK_PATTERNS = [
  /\bfrom\s+['"](?:node:)?(?:net|http|https|tls|dgram|dns|undici|axios|got|node-fetch)['"]/i,
  /\brequire\s*\(\s*['"](?:node:)?(?:net|http|https|tls|dgram|dns|undici|axios|got|node-fetch)['"]\s*\)/i,
  /\b(?:fetch|WebSocket|XMLHttpRequest)\b/
];

const FORBIDDEN_FS_PATTERNS = [
  /\bfrom\s+['"](?:node:)?(?:fs|fs\/promises)['"]/i,
  /\brequire\s*\(\s*['"](?:node:)?(?:fs|fs\/promises)['"]\s*\)/i
];

async function runCheck() {
  console.log('[GUARD] Checking zero-network and pure-RAM constraints on prompt-assembler...');
  let failed = false;

  // 1. Check project-scanner.ts
  try {
    const scannerSource = await fs.readFile(SCANNER_FILE, 'utf8');
    for (const pattern of FORBIDDEN_NETWORK_PATTERNS) {
      if (pattern.test(scannerSource)) {
        console.error(`❌ [GUARD] project-scanner.ts violates zero-network rule: matched ${pattern}`);
        failed = true;
      }
    }
  } catch (err) {
    console.error(`❌ [GUARD] Could not read ${SCANNER_FILE}:`, err);
    failed = true;
  }

  // 2. Check telemetry-ring.ts
  try {
    const ringSource = await fs.readFile(RING_FILE, 'utf8');
    for (const pattern of [...FORBIDDEN_NETWORK_PATTERNS, ...FORBIDDEN_FS_PATTERNS]) {
      if (pattern.test(ringSource)) {
        console.error(`❌ [GUARD] telemetry-ring.ts violates pure-RAM / zero-telemetry rule: matched ${pattern}`);
        failed = true;
      }
    }
  } catch (err) {
    console.error(`❌ [GUARD] Could not read ${RING_FILE}:`, err);
    failed = true;
  }

  if (failed) {
    console.error('[GUARD] Prompt Assembler Guard FAILED.');
    process.exit(1);
  } else {
    console.log('✅ [GUARD] Prompt Assembler Guard passed: project-scanner and telemetry-ring are strictly compliant.');
    process.exit(0);
  }
}

runCheck().catch((err) => {
  console.error('[GUARD] Unexpected error:', err);
  process.exit(1);
});
