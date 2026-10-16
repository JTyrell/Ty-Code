#!/usr/bin/env node
/**
 * Ty-Code Desktop IDE - Live Extension Installation Pipeline Trace Runner
 *
 * Runs live probe against Open VSX registry (https://open-vsx.org) for 'ms-python.python'
 * across all 9 hops (E1..E9), classifies the first failing hop, runs static scan
 * for metadata-only patterns, and writes docs/traces/extension-install-trace.json.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function main() {
  console.log('========================================================================');
  console.log('=== TY-CODE: EXTENSION INSTALLATION PIPELINE LIVE TRACE (PHASE 1)    ===');
  console.log('========================================================================');
  console.log('Target extension: ms-python.python');
  console.log('Registry: https://open-vsx.org');
  console.log('Instrumenting hops: E1 through E9\n');

  const tempBundle = path.join(root, 'dist', `tracer-runner-${Date.now()}.cjs`);
  await fs.mkdir(path.dirname(tempBundle), { recursive: true });

  try {
    // 1. Bundle installation-tracer via esbuild
    console.log('1. Compiling installation-tracer via esbuild...');
    execSync(
      `npx esbuild src/main/services/marketplace/installation-tracer.ts --bundle --platform=node --format=cjs --external:electron --outfile="${tempBundle}"`,
      { cwd: root, stdio: 'inherit' }
    );

    // 2. Execute live trace
    console.log('\n2. Executing live 9-hop installation probe against Open VSX...');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const { runInstallationTrace } = req(tempBundle);
    const report = await runInstallationTrace('ms-python.python', { workspaceRoot: root });

    console.log('\n3. Probe Results & Hop Waterfall:');
    console.log('------------------------------------------------------------------------');
    for (const hop of report.hops) {
      const statusIcon = hop.status === 'PASS' ? '✓ PASS' : hop.status === 'FAIL' ? '✗ FAIL' : '⊘ SKIP';
      const duration = `${hop.durationMs}ms`.padStart(8);
      const payload = hop.payloadSize !== undefined
        ? ` (${(hop.payloadSize > 1_000_000 ? (hop.payloadSize / 1_000_000).toFixed(1) + 'MB' : hop.payloadSize > 1000 ? (hop.payloadSize / 1000).toFixed(1) + 'KB' : hop.payloadSize + 'B')})`
        : '';
      console.log(`  [${statusIcon}] ${hop.hop.padEnd(3)} : ${hop.name} [${duration}]${payload}`);
      if (hop.error) {
        console.log(`           Error: ${hop.error.split('\n')[0].slice(0, 120)}`);
      }
    }
    console.log('------------------------------------------------------------------------');

    console.log('\n4. Pipeline Failure Classification:');
    console.log(`  • First Failing Hop       : ${report.firstFailingHop}`);
    console.log(`  • Failure Taxonomy        : ${report.failureClassification}`);
    console.log(`  • Marketplace Architecture: ${report.marketplaceArchitecture}`);
    console.log(`  • Total Latency           : ${report.metrics.totalDurationMs}ms`);
    console.log(`  • VSIX Download Size      : ${report.metrics.downloadSizeBytes} bytes`);
    console.log(`  • Uncompressed File Count : ${report.metrics.extractedFileCount} files`);

    console.log('\n5. Static Scan for Metadata-Only & Execution-Blocked Patterns:');
    console.log(`  • Total Findings: ${report.metadataOnlyScan.totalFindings}`);
    for (const f of report.metadataOnlyScan.findings) {
      console.log(`    - [${f.category}] ${f.file}:${f.line} -> ${f.description}`);
    }

    const traceFile = path.join(root, 'docs', 'traces', 'extension-install-trace.json');
    if (existsSync(traceFile)) {
      const stat = await fs.stat(traceFile);
      console.log(`\n✓ Verified artifact committed to: ${path.relative(root, traceFile)} (${stat.size} bytes)`);
    } else {
      throw new Error(`Trace file was not created at ${traceFile}`);
    }

    console.log('\n========================================================================');
    console.log('=== EXTENSION PIPELINE TRACE COMPLETE: EXACT BREAKPOINT IDENTIFIED   ===');
    console.log('========================================================================\n');
  } finally {
    if (existsSync(tempBundle)) {
      await fs.unlink(tempBundle).catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('\n✗ Pipeline trace failed:', err);
  process.exit(1);
});
