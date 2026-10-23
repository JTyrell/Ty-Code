#!/usr/bin/env node
/**
 * Test Runner for Brave Engine & Ephemeral Guest Mode Isolation Suite
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
  console.log('🚀 Running Brave Engine & Ephemeral Guest Mode Suite...\n');
  await fs.mkdir(bundleDir, { recursive: true });

  const testFile = path.join(projectRoot, 'tests', 'brave-engine.test.ts');
  const bundleCjs = path.join(bundleDir, 'brave-engine.bundle.cjs');

  console.log('Bundling brave engine test suite with esbuild...');
  await build({
    entryPoints: [testFile],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundleCjs,
    external: ['electron', 'playwright-core']
  });

  const { runBraveEngineTests } = require(bundleCjs);
  const result = await runBraveEngineTests();

  console.log('\n========================================================================');
  console.log('  TEST RESULT:', result.passed ? 'PASSED' : 'FAILED');
  console.log('  DETAILS:', JSON.stringify(result.details, null, 2));
  console.log('========================================================================\n');

  if (!result.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error in Brave Engine runner:', err);
  process.exit(1);
});
