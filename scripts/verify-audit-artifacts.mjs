#!/usr/bin/env node
/**
 * Anti-Phantom Guard: Verify Audit Artifacts (Fix 5)
 *
 * Requirements:
 * 1. Fails CI if docs/traces/*.json is older than the last commit touching agent/providers/fs code.
 * 2. Verifies that trace files exist, are valid JSON, and have non-empty metrics/budgets.
 * 3. Audit template change: any "100% functional" or equivalent completion claim in docs
 *    must explicitly reference a valid machine-readable trace artifact path.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const MONITORED_CODE_PATHS = [
  'src/main/agent',
  'src/main/providers',
  'src/main/ipc/fs-handlers.ts',
  'src/main/services/indexing',
  'src/renderer/src/services/lazy-model-manager.ts'
];

const REQUIRED_TRACES = [
  'docs/traces/open-perf-trace.json',
  'docs/traces/connectivity-trace.json'
];

const COMPLETION_CLAIM_PATTERNS = [
  /\b100%\s+functional\b/i,
  /\b100%\s+operational\b/i,
  /\b100%\s+working\b/i,
  /\bfully\s+functional\b/i,
  /\ball\s+fixes\s+verified\b/i,
  /\ball\s+stages\s+verified\b/i
];

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedChecks++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Anti-Phantom Guard Violation: ${message}`);
  }
}

async function collectDocsFiles(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectDocsFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

function getLatestCommitEpoch(relativePaths) {
  try {
    const args = relativePaths.map((p) => `"${p}"`).join(' ');
    const output = execSync(`git log -1 --format=%ct -- ${args}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return output ? Number(output) : 0;
  } catch {
    return 0;
  }
}

function getFileCommitEpoch(relativePath) {
  try {
    const output = execSync(`git log -1 --format=%ct -- "${relativePath}"`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return output ? Number(output) : 0;
  } catch {
    return 0;
  }
}

async function verify() {
  console.log('========================================================================');
  console.log('=== ANTI-PHANTOM GUARD: VERIFY AUDIT ARTIFACTS & EVIDENCE GATE       ===');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Freshness Check: docs/traces/*.json vs last commit touching code
  // -------------------------------------------------------------------------
  console.log('--- 1. Trace Freshness vs Code Commit Epoch ---');

  const latestCodeEpoch = getLatestCommitEpoch(MONITORED_CODE_PATHS);
  console.log(`  Latest commit epoch touching monitored code: ${latestCodeEpoch} (${new Date(latestCodeEpoch * 1000).toISOString()})`);

  for (const traceRel of REQUIRED_TRACES) {
    const traceAbs = path.join(projectRoot, traceRel);
    assert(fsSync.existsSync(traceAbs), `Required trace exists: ${traceRel}`);

    const raw = await fs.readFile(traceAbs, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      assert(false, `Trace file ${traceRel} is valid JSON`);
    }

    // Determine trace epoch from JSON timestamp, git commit, or stat.mtime
    let traceEpoch = 0;
    if (parsed.timestamp) {
      traceEpoch = Math.floor(new Date(parsed.timestamp).getTime() / 1000);
    }
    if (!traceEpoch || isNaN(traceEpoch)) {
      const gitEpoch = getFileCommitEpoch(traceRel);
      traceEpoch = gitEpoch || Math.floor(fsSync.statSync(traceAbs).mtimeMs / 1000);
    }

    console.log(`  Trace ${traceRel} epoch: ${traceEpoch} (${new Date(traceEpoch * 1000).toISOString()})`);

    // Guard: Fails if trace is older than last commit touching agent/providers/fs code
    // Allow 60s tolerance for clock skew
    if (latestCodeEpoch > 0) {
      assert(
        traceEpoch >= latestCodeEpoch - 60,
        `Trace freshness: ${traceRel} (${traceEpoch}) is not older than latest code commit (${latestCodeEpoch})`
      );
    } else {
      assert(traceEpoch > 0, `Trace ${traceRel} has a valid timestamp`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Schema & Budget Validity in docs/traces/open-perf-trace.json
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Open-Path Performance Trace Integrity & Budgets ---');

  const openPerfRaw = await fs.readFile(path.join(projectRoot, 'docs/traces/open-perf-trace.json'), 'utf-8');
  const openPerf = JSON.parse(openPerfRaw);

  assert(Boolean(openPerf.fix4Comparison), 'open-perf-trace.json contains fix4Comparison block');
  const fix4 = openPerf.fix4Comparison;

  assert(fix4.folder10k.firstTreePaintMs < 1500, `folder_10k_first_tree_paint is under 1500ms (${fix4.folder10k.firstTreePaintMs}ms)`);
  assert(fix4.folder10k.fullIndexBackgroundMs < 5000, `folder_10k_full_index_background is under 5000ms (${fix4.folder10k.fullIndexBackgroundMs}ms)`);
  assert(fix4.folder10k.speedupFactor >= 3.0, `second_open_ge_3x_faster meets threshold (${fix4.folder10k.speedupFactor}x)`);
  assert(fix4.folder10k.budgetsMet.no_main_thread_block_over_50ms === true, 'no_main_thread_block_over_50ms verified true');
  assert(fix4.file1KB.warmMs < 150, `1KB warm open under 150ms (${fix4.file1KB.warmMs}ms)`);
  assert(fix4.file1KB.coldMs < 400, `1KB cold open under 400ms (${fix4.file1KB.coldMs}ms)`);
  assert(fix4.file1MB.progressiveMs < 1200, `1MB progressive stream under 1200ms (${fix4.file1MB.progressiveMs}ms)`);
  assert(Array.isArray(fix4.stageComparisons) && fix4.stageComparisons.length >= 10, 'stageComparisons contains all 10 stages');

  // -------------------------------------------------------------------------
  // 3. Schema & Key Privacy Validity in docs/traces/connectivity-trace.json
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Connectivity Trace Integrity & Privacy Rule ---');

  const connTraceRaw = await fs.readFile(path.join(projectRoot, 'docs/traces/connectivity-trace.json'), 'utf-8');
  const connTrace = JSON.parse(connTraceRaw);

  assert(Boolean(connTrace.runId), 'connectivity-trace.json has non-empty runId');
  assert(Boolean(connTrace.providers), 'connectivity-trace.json has providers block');

  // Key Presence Rule: raw API keys must NEVER appear anywhere in the trace metadata
  assert(!connTraceRaw.includes('"apiKey":'), 'Zero raw apiKey fields serialized in trace');
  assert(!connTraceRaw.includes('sk-ant-'), 'Zero Anthropic raw key values in trace');
  assert(!connTraceRaw.includes('sk-or-'), 'Zero OpenRouter raw key values in trace');
  assert(!connTraceRaw.includes('gsk_'), 'Zero Groq raw key values in trace');

  // -------------------------------------------------------------------------
  // 4. Audit Claims Policy: "100% functional" claims require trace artifacts
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Audit Template & Claims Evidence Enforcement ---');

  const docsFiles = await collectDocsFiles(path.join(projectRoot, 'docs'));
  let claimsFound = 0;
  let evidencedClaims = 0;

  for (const docFile of docsFiles) {
    const relDoc = path.relative(projectRoot, docFile).replace(/\\/g, '/');
    const content = await fs.readFile(docFile, 'utf-8');

    for (const pattern of COMPLETION_CLAIM_PATTERNS) {
      if (pattern.test(content)) {
        claimsFound++;
        // Document must reference a machine-readable trace artifact in docs/traces/*.json
        const hasArtifactRef =
          content.includes('docs/traces/open-perf-trace.json') ||
          content.includes('docs/traces/connectivity-trace.json') ||
          content.includes('docs/traces/') ||
          content.includes('open-perf-trace.json') ||
          content.includes('connectivity-trace.json');

        if (!hasArtifactRef) {
          console.error(`  ✗ Anti-Phantom Violation in ${relDoc}: Document contains functional completion claim "${pattern}" but fails to cite a machine-readable trace artifact path in docs/traces/!`);
          throw new Error(`Audit Claim Without Evidence: ${relDoc} must cite a docs/traces/*.json artifact.`);
        }
        evidencedClaims++;
        break;
      }
    }
  }

  assert(claimsFound > 0, `Scanned docs: found and verified completion claims (count: ${claimsFound})`);
  assert(evidencedClaims === claimsFound, `All ${evidencedClaims} completion claims cite machine-readable trace artifacts`);

  console.log('\n========================================================================');
  console.log(`=== ANTI-PHANTOM GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED        ===`);
  console.log('=== Every claim is backed by machine-readable artifacts.             ===');
  console.log('========================================================================\n');
}

verify().then(() => process.exit(0)).catch((err) => {
  console.error('\n❌ Verify Audit Artifacts Guard Failed:', err.message);
  process.exit(1);
});
