#!/usr/bin/env node
/**
 * Nightly LIVE platform-conformance runner (Prompt 4 extension, amendment 6).
 *
 * Mirrors scripts/run-live-e2e.mjs. Bundles tests/live-e2e/platform-conformance-live.test.ts
 * and drives a REAL agent export for each of the 9 registry targets, then writes
 * the drift report to docs/traces/platform-conformance-live.json (a workflow
 * artifact). The provider key comes from repo secrets via env — this NEVER runs
 * in PR CI, only on the scheduled workflow. Exit code is non-zero ONLY on a
 * marker/banned-token failure (dialect drift), never on latency.
 *
 * Env (from secrets / vars):
 *   OPENROUTER_API_KEY            provider key (required; skips with exit 0 if absent)
 *   PLATFORM_CONFORMANCE_PROVIDER provider id          (default: openrouter)
 *   PLATFORM_CONFORMANCE_MODEL    locked capable model (default: the model below)
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const bundleDir = path.join(projectRoot, '.tmp-platform-conformance');

const DEFAULT_PROVIDER = 'openrouter';
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet'; // locked, capable of exact dialect output

async function run() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const provider = process.env.PLATFORM_CONFORMANCE_PROVIDER || DEFAULT_PROVIDER;
  const model = process.env.PLATFORM_CONFORMANCE_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    console.warn('⚠ No OPENROUTER_API_KEY secret present — skipping the nightly live conformance run.');
    console.warn('  (Intentional: this job only alerts on dialect drift when a live route is available.)');
    process.exit(0);
  }

  console.log('🚀 Running Ty-Code NIGHTLY live platform conformance (9 registry targets)...\n');
  await fs.mkdir(bundleDir, { recursive: true });

  const harnessTs = path.join(projectRoot, 'tests', 'live-e2e', 'platform-conformance-live.test.ts');
  const harnessCjs = path.join(bundleDir, 'platform-conformance-live.test.cjs');

  try {
    await build({
      entryPoints: [harnessTs],
      outfile: harnessCjs,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron', 'node-pty', 'simple-git', 'playwright-core', 'typescript']
    });

    const settings = {
      activeProvider: provider,
      activeModel: model,
      modelLock: { providerId: provider, modelId: model, mode: 'strict' },
      routingStrategy: 'manual',
      enableFailover: false,
      apiKeys: { [provider]: apiKey },
      customEndpoints: {},
      temperature: 0,
      maxTokens: 2048,
      offlineDemoMode: false
    };

    let gitCommit = '';
    try {
      const { execSync } = await import('node:child_process');
      gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: projectRoot }).trim();
    } catch {}

    const mod = await import(pathToFileURL(harnessCjs).href);
    const runLive = mod.runPlatformConformanceLive || (mod.default && mod.default.runPlatformConformanceLive);
    if (typeof runLive !== 'function') {
      throw new Error('Harness did not export runPlatformConformanceLive');
    }

    const report = await runLive(settings, provider, model, gitCommit);

    const outDir = path.join(projectRoot, 'docs', 'traces');
    await fs.mkdir(outDir, { recursive: true });
    const reportPath = path.join(outDir, 'platform-conformance-live.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n✓ Wrote live conformance drift report: docs/traces/platform-conformance-live.json`);

    console.log('========================================================================');
    console.log(`=== ${report.summary.passed}/${report.summary.total} targets conformant · marker/ban failures: ${report.summary.markerOrBanFailures} ===`);
    console.log('========================================================================');

    // Alert ONLY on marker/banned drift — never on latency or a transport blip.
    if (report.summary.markerOrBanFailures > 0) {
      console.error(`\n❌ Dialect drift detected (${report.summary.markerOrBanFailures} marker/ban failure(s)).`);
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Nightly live platform conformance failed:', err);
    process.exit(1);
  } finally {
    try {
      await fs.rm(bundleDir, { recursive: true, force: true });
    } catch {}
  }
}

run();
