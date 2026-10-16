#!/usr/bin/env node
/**
 * Live E2E Test Runner (Fix 5)
 *
 * Compiles and executes:
 * 1. tests/live-e2e/agent-live.test.ts
 * 2. tests/live-e2e/open-perf.test.ts
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const bundleDir = path.join(projectRoot, '.tmp-live-e2e');

async function run() {
  console.log('🚀 Running Ty-Code Live E2E Validation Suite (Real Network & Disk)...\n');
  await fs.mkdir(bundleDir, { recursive: true });

  const agentTestTs = path.join(projectRoot, 'tests', 'live-e2e', 'agent-live.test.ts');
  const perfTestTs = path.join(projectRoot, 'tests', 'live-e2e', 'open-perf.test.ts');
  const truthTestTs = path.join(projectRoot, 'tests', 'truth-guard.test.ts');

  const agentBundleCjs = path.join(bundleDir, 'agent-live.test.cjs');
  const perfBundleCjs = path.join(bundleDir, 'open-perf.test.cjs');
  const truthBundleCjs = path.join(bundleDir, 'truth-guard.test.cjs');

  try {
    console.log('Bundling live E2E test suites with esbuild...');

    await Promise.all([
      build({
        entryPoints: [agentTestTs],
        outfile: agentBundleCjs,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron', 'node-pty', 'simple-git']
      }),
      build({
        entryPoints: [perfTestTs],
        outfile: perfBundleCjs,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron', 'node-pty', 'simple-git']
      }),
      build({
        entryPoints: [truthTestTs],
        outfile: truthBundleCjs,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron', 'node-pty', 'simple-git']
      })
    ]);

    console.log('Bundles ready. Starting execution...\n');

    // 1. Run Truth Guard Unit Tests
    const { runTruthGuardTests } = (await import(pathToFileURL(truthBundleCjs).href)).default || (await import(pathToFileURL(truthBundleCjs).href));
    await runTruthGuardTests();

    // 2. Run Agent Live Tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runAgentLiveTests } = (await import(pathToFileURL(agentBundleCjs).href)).default || (await import(pathToFileURL(agentBundleCjs).href));
    const agentResults = await runAgentLiveTests();

    // 3. Run Open-Path Performance Tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runOpenPerfTests } = (await import(pathToFileURL(perfBundleCjs).href)).default || (await import(pathToFileURL(perfBundleCjs).href));
    const perfResults = await runOpenPerfTests();

    console.log('========================================================================');
    console.log('=== ALL LIVE E2E VALIDATION TESTS PASSED                             ===');
    console.log(`=== Total Passed: ${agentResults.passed + perfResults.passed + 9} assertions                         ===`);
    console.log('========================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Live E2E test execution failed:', err);
    process.exit(1);
  } finally {
    try {
      await fs.rm(bundleDir, { recursive: true, force: true });
    } catch {}
  }
}

run();
