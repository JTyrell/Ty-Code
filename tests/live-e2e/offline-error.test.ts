/**
 * Live E2E Test 5: Offline Behavior
 *
 * Simulates offline/unreachable network condition (dead port / no route).
 * Expected: returns error with taxonomy code (e.g. NETWORK_BLOCKED or TIMEOUT) within 10s without hang.
 *
 * Assertion: error card/taxonomy code visible, completed within 10s
 *
 * Brand: Ty-Code
 */

import { ProviderGateway } from '../../src/main/providers/provider-gateway';
import { classifyDiagnosticError } from '../../src/main/services/diagnostics/error-taxonomy';
import type { ProviderSettings } from '../../src/preload/types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runOfflineErrorTest(): Promise<{
  passed: number;
  total: number;
  elapsedMs: number;
  taxonomyCode: string;
  errorMessage: string;
}> {
  console.log('\n========================================================================');
  console.log('=== TEST 5 — OFFLINE BEHAVIOR: NETWORK_BLOCKED TAXONOMY & NO-HANG    ===');
  console.log('========================================================================');

  // Point to a dead local port where nothing is listening
  const deadPort = 59991;
  const offlineSettings: ProviderSettings = {
    activeProvider: 'fcc-proxy' as any,
    activeModel: 'llama-3.3-70b-versatile',
    routingStrategy: 'manual',
    enableFailover: false,
    apiKeys: {},
    customEndpoints: {
      'fcc-proxy': `http://127.0.0.1:${deadPort}/v1`
    },
    temperature: 0.2,
    maxTokens: 128,
    offlineDemoMode: false
  };

  const startTime = Date.now();
  let caughtError: unknown = null;

  try {
    console.log(`  Sending prompt to unreachable offline endpoint (http://127.0.0.1:${deadPort}/v1)...`);
    await ProviderGateway.streamChat(
      offlineSettings,
      [{ role: 'user', content: 'Offline test probe' }],
      [],
      {}
    );
  } catch (err) {
    caughtError = err;
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`  Request failed cleanly in ${elapsedMs}ms (< 10000ms threshold).`);

  assert(Boolean(caughtError), 'Network failure cleanly caught without silent hanging');
  assert(elapsedMs < 10000, `Completed within 10s (actual: ${elapsedMs}ms, threshold: 10000ms)`);

  const errMsg = caughtError instanceof Error ? caughtError.message : String(caughtError);
  console.log(`  Caught network error message: "${errMsg}"`);

  // Classify with taxonomy engine
  const classification = classifyDiagnosticError('fcc-proxy', errMsg);
  console.log(`  Taxonomy code: [${classification.code}] - ${classification.humanMessage}`);
  console.log(`  Remedy provided: ${classification.remedy}`);

  // Required Assertion: Taxonomy code is NETWORK_BLOCKED or TIMEOUT
  assert(
    classification.code === 'NETWORK_BLOCKED' || classification.code === 'TIMEOUT',
    `Taxonomy code correctly identified as NETWORK_BLOCKED or TIMEOUT (actual: ${classification.code})`
  );
  assert(Boolean(classification.remedy), 'Taxonomy classification includes actionable remedy');

  return {
    passed: passedTests,
    total: totalTests,
    elapsedMs,
    taxonomyCode: classification.code,
    errorMessage: errMsg
  };
}

if (typeof require !== 'undefined' && require.main === module) {
  runOfflineErrorTest()
    .then((res) => {
      console.log(`\nTest 5 Passed: ${res.passed}/${res.total} assertions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
