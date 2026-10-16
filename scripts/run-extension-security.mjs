#!/usr/bin/env node
/**
 * Extension Security Hardening Live Probe (ExtensionsFix 5)
 *
 * Runs tests/live-e2e/extension-security.test.ts:
 *   1. Capability-based permission enforcement (blocking undeclared capabilities)
 *   2. Out-of-workspace write protection (prompting user before escaping containment)
 *   3. Webview sandbox & nonce handshake (strictly allow-scripts, no allow-same-origin)
 *   4. Dangerous code pattern scanner (eval, new Function, remote imports, process escapes)
 *   5. Emits verified trace to docs/traces/extension-security.json
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const bundleDir = path.join(projectRoot, '.tmp-live-e2e');

async function main() {
  console.log('🚀 Running Ty-Code Extension Security Hardening Probe (ExtensionsFix 5)...\n');
  await fs.mkdir(bundleDir, { recursive: true });

  const testFile = path.join(projectRoot, 'tests', 'live-e2e', 'extension-security.test.ts');
  const bundleCjs = path.join(bundleDir, 'extension-security.bundle.cjs');

  console.log('Bundling extension security test suite with esbuild...');
  await build({
    entryPoints: [testFile],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: bundleCjs,
    external: ['electron', 'worker_threads', 'zlib']
  });

  const { runExtensionSecurityTests } = require(bundleCjs);
  const report = await runExtensionSecurityTests();

  if (report.summary.status !== 'PASS') {
    console.error('Extension security test suite reported failures.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in extension security probe:', err);
  process.exit(1);
});
