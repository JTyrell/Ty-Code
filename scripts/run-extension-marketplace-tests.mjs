#!/usr/bin/env node
/**
 * Extension Marketplace Live Verification Runner (ExtensionsFix 4)
 *
 * Compiles tests/live-e2e/extension-marketplace.test.ts with esbuild and executes
 * all 7 live verification tests against real Open VSX (https://open-vsx.org).
 *
 * Emits: docs/traces/extension-verification.json
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
  console.log('🚀 Bundling and executing Ty-Code Extension Marketplace Live Tests...\n');
  await fs.mkdir(bundleDir, { recursive: true });

  const testTs = path.join(projectRoot, 'tests', 'live-e2e', 'extension-marketplace.test.ts');
  const bundleCjs = path.join(bundleDir, 'extension-marketplace.bundle.cjs');

  try {
    await build({
      entryPoints: [testTs],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: bundleCjs,
      external: ['electron', 'worker_threads', 'zlib', 'node-pty', 'simple-git']
    });

    const { runExtensionMarketplaceTests } = require(bundleCjs);
    const report = await runExtensionMarketplaceTests();

    if (report.summary.status !== 'PASS') {
      console.error(`❌ Suite failed: ${report.summary.failedTests}/${report.summary.totalTests} tests failed.`);
      process.exit(1);
    }

    console.log('🎉 All 7 extension functionality live tests passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Extension marketplace test suite failed with error:', err);
    process.exit(1);
  }
}

main();
