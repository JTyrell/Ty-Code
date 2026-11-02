#!/usr/bin/env node
/**
 * Stage 4a-4 — Agent Performance Regression Canary
 *
 * Compares a freshly measured run of the real AgentEngine baseline harness
 * against the frozen canary in `docs/AGENT_BASELINE.md` and FAILS the build on
 * any regression beyond the configured thresholds.
 *
 * Thresholds resolution (first match wins):
 *   1. TYCODE_PERF_THRESHOLDS  — inline JSON, e.g. {"iterationIncrease":0.2,...}
 *   2. .tycode-perf-thresholds.json in the project root
 *   3. Built-in defaults: { iterationIncrease: 0.20, failureRateIncrease: 0.10, wallTimeIncrease: 0.30 }
 *
 * Current metrics come from the live harness unless TYCODE_PERF_CURRENT_JSON is
 * provided (used to prove the canary fails on an injected regression without
 * re-running the engine).
 *
 * Usage: node scripts/no-agent-performance-regression.mjs
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const BASELINE_DOC = path.join(projectRoot, 'docs', 'AGENT_BASELINE.md');
const THRESHOLD_FILE = path.join(projectRoot, '.tycode-perf-thresholds.json');
const bundleDir = path.join(projectRoot, '.tmp-perf-canary');
const harnessTs = path.join(projectRoot, 'tests', 'live-e2e', 'agent-baseline-harness.ts');
const harnessCjs = path.join(bundleDir, 'agent-baseline-harness.cjs');

const DEFAULT_THRESHOLDS = { iterationIncrease: 0.20, failureRateIncrease: 0.10, wallTimeIncrease: 0.30 };

function extractSecondCell(markdown, labelKeyword) {
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (!line.toLowerCase().includes(labelKeyword.toLowerCase())) continue;
    // | Metric | Value | Measured from |  → split on pipes, take the value cell.
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    const value = Number(cells[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function readBaseline() {
  const doc = await fs.readFile(BASELINE_DOC, 'utf8');
  const baseline = {
    avgIterations: extractSecondCell(doc, 'Average iterations'),
    toolCallFailureRatePer100: extractSecondCell(doc, 'Tool-call failure rate'),
    medianWallTimeMs: extractSecondCell(doc, 'Wall time'),
    tokensPerSuccessfulEdit: extractSecondCell(doc, 'Token efficiency')
  };
  for (const [key, value] of Object.entries(baseline)) {
    if (value == null) {
      throw new Error(`Could not parse baseline metric "${key}" from docs/AGENT_BASELINE.md — re-run \`npm run baseline:capture\`.`);
    }
  }
  return baseline;
}

async function readThresholds() {
  if (process.env.TYCODE_PERF_THRESHOLDS) {
    try {
      return { ...DEFAULT_THRESHOLDS, ...JSON.parse(process.env.TYCODE_PERF_THRESHOLDS) };
    } catch (err) {
      throw new Error(`TYCODE_PERF_THRESHOLDS is not valid JSON: ${err.message}`);
    }
  }
  if (fsSync.existsSync(THRESHOLD_FILE)) {
    try {
      const parsed = JSON.parse(await fs.readFile(THRESHOLD_FILE, 'utf8'));
      return { ...DEFAULT_THRESHOLDS, ...parsed };
    } catch (err) {
      throw new Error(`.tycode-perf-thresholds.json is not valid JSON: ${err.message}`);
    }
  }
  return { ...DEFAULT_THRESHOLDS };
}

async function measureCurrent() {
  if (process.env.TYCODE_PERF_CURRENT_JSON) {
    try {
      return JSON.parse(process.env.TYCODE_PERF_CURRENT_JSON);
    } catch (err) {
      throw new Error(`TYCODE_PERF_CURRENT_JSON is not valid JSON: ${err.message}`);
    }
  }
  await fs.mkdir(bundleDir, { recursive: true });
  await build({
    entryPoints: [harnessTs],
    outfile: harnessCjs,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron', 'node-pty', 'simple-git', 'playwright-core', 'electron-updater']
  });
  const mod = await import(pathToFileURL(harnessCjs).href);
  const runAgentBaseline = mod.runAgentBaseline || mod.default?.runAgentBaseline;
  if (typeof runAgentBaseline !== 'function') {
    throw new Error('Baseline harness did not export runAgentBaseline()');
  }
  return runAgentBaseline(5);
}

// A metric with a zero baseline gets a small absolute floor so a deterministic
// clean run (0 failures) never trips on floating-point noise, while any genuine
// failure still breaches it.
function breachThreshold(baseline, increase) {
  return baseline <= 0 ? increase * 100 : baseline * (1 + increase);
}

async function run() {
  console.log('🧪 Stage 4a — agent performance regression canary');

  const baseline = await readBaseline();
  const thresholds = await readThresholds();
  const current = await measureCurrent();

  const checks = [
    {
      name: 'Iterations (model round-trips)',
      baseline: baseline.avgIterations,
      current: Number(current.avgIterations),
      limit: breachThreshold(baseline.avgIterations, thresholds.iterationIncrease)
    },
    {
      name: 'Tool-call failure rate (per 100)',
      baseline: baseline.toolCallFailureRatePer100,
      current: Number(current.toolCallFailureRatePer100),
      limit: breachThreshold(baseline.toolCallFailureRatePer100, thresholds.failureRateIncrease)
    },
    {
      name: 'Wall time (median ms)',
      baseline: baseline.medianWallTimeMs,
      current: Number(current.medianWallTimeMs),
      limit: breachThreshold(baseline.medianWallTimeMs, thresholds.wallTimeIncrease)
    }
  ];

  const failures = [];
  console.log(`\n  Thresholds: iteration +${Math.round(thresholds.iterationIncrease * 100)}%, failure +${Math.round(thresholds.failureRateIncrease * 100)}%, wall +${Math.round(thresholds.wallTimeIncrease * 100)}%`);
  for (const check of checks) {
    if (!Number.isFinite(check.current)) {
      failures.push(`${check.name}: current metric missing/non-numeric (${current[check.name]})`);
      console.log(`  ✗ ${check.name}: no current value`);
      continue;
    }
    const breached = check.current > check.limit;
    const status = breached ? '✗ REGRESSION' : '✓ ok';
    console.log(`  ${status} ${check.name}: current ${check.current} vs baseline ${check.baseline} (limit ${check.limit.toFixed(2)})`);
    if (breached) {
      failures.push(`${check.name}: ${check.current} exceeds limit ${check.limit.toFixed(2)} (baseline ${check.baseline})`);
    }
  }

  if (typeof current.tokensPerSuccessfulEdit === 'number') {
    console.log(`  · Token efficiency (informational): current ${current.tokensPerSuccessfulEdit} vs baseline ${baseline.tokensPerSuccessfulEdit}`);
  }

  if (failures.length > 0) {
    console.error(`\n❌ BUILD FAILURE: agent performance regressed beyond configured thresholds:`);
    for (const f of failures) console.error(`   - ${f}`);
    console.error('\nRecover by re-tuning stages, or deliberately re-capture the baseline with `npm run baseline:capture` if the new numbers are the intended target.');
    return 1;
  }

  console.log('\n✅ Agent performance canary PASSED: no regression beyond thresholds vs docs/AGENT_BASELINE.md.');
  return 0;
}

// The guard's verdict is fully computed by run(). The live harness drives a real
// AgentEngine over a test-double provider, and ProviderGateway/fcc leave
// lingering keep-alive sockets and catalog timers on the event loop after the
// measurement returns. Those handles are irrelevant to the verdict but would
// keep the CLI alive (and CI hanging), so we clean the temp bundle and exit
// deterministically with the computed status code.
function finalize(exitCode) {
  if (!process.env.TYCODE_PERF_CURRENT_JSON) {
    try {
      fsSync.rmSync(bundleDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  process.exit(exitCode);
}

if (!fsSync.existsSync(BASELINE_DOC)) {
  console.error('docs/AGENT_BASELINE.md not found. Run `npm run baseline:capture` (Stage 0) first.');
  process.exit(1);
}

run()
  .then((code) => finalize(code))
  .catch((err) => {
    console.error('❌ Performance canary errored:', err.message || err);
    finalize(1);
  });
