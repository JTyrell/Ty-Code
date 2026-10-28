#!/usr/bin/env node
/**
 * Open-Perf Suite Child Runner
 *
 * The open-perf budgets measure main-thread event-loop blocking during the
 * workspace walk. Suites 1-9 of run-live-e2e run in the same node process and
 * leave live intervals behind (sidecar health checks, gateway pings,
 * keep-alives). Those residue timers contaminate a single-process measurement
 * of open-path blocking (observed inflation from ~24ms in a fresh process to
 * 150-723ms after suites 1-9). A real desktop session performs the open on a
 * main process without that suite-residue constellation, so the perf suite
 * runs in its own child process against the production condition.
 *
 * Usage: node tests/live-e2e/open-perf-child.mjs <compiled-perf-bundle.cjs>
 * Emits a final "PERF_CHILD_RESULT:{...}" JSON line on stdout.
 */
import { pathToFileURL } from 'node:url';

const cjsPath = process.argv[2];
if (!cjsPath) {
  console.error('Usage: node tests/live-e2e/open-perf-child.mjs <compiled-perf-bundle.cjs>');
  process.exit(2);
}

const mod = await import(pathToFileURL(cjsPath).href);
const { runOpenPerfTests } = mod.default || mod;
const result = await runOpenPerfTests();
console.log(`PERF_CHILD_RESULT:${JSON.stringify(result)}`);
process.exit(0);
