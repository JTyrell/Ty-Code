/**
 * Live E2E Test 1: Nonce Echo
 *
 * Sends 'Repeat this code exactly: 7Q4X9' to live provider.
 * Proves real model round-trip over TCP, not a hardcoded fixture.
 *
 * Assertion: response.includes('7Q4X9') === true
 *
 * Brand: Ty-Code
 */

import { ProviderGateway } from '../../src/main/providers/provider-gateway';
import { startLiveTestServer } from './test-server';

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

export async function runNonceEchoTest(): Promise<{ passed: number; total: number; nonce: string; response: string }> {
  console.log('\n========================================================================');
  console.log('=== TEST 1 — NONCE ECHO: REAL MODEL ROUND-TRIP PROOF                 ===');
  console.log('========================================================================');

  const instance = await startLiveTestServer();
  const nonce = '7Q4X9';

  try {
    const prompt = `Repeat this code exactly: ${nonce}`;
    console.log(`  Sending live prompt: "${prompt}"...`);

    const streamResult = await ProviderGateway.streamChat(
      instance.settings,
      [{ role: 'user', content: prompt }],
      [],
      {}
    );

    const fullResponse = streamResult.fullText;
    console.log(`  Live response received: "${fullResponse.trim()}"`);

    // Required Assertion: response.includes('7Q4X9') === true
    assert(fullResponse.includes(nonce), `Response contains exact nonce "${nonce}" (proves live round-trip)`);
    assert(fullResponse.length > 5, 'Response length > 5 characters');

    return {
      passed: passedTests,
      total: totalTests,
      nonce,
      response: fullResponse
    };
  } finally {
    await instance.close();
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  runNonceEchoTest()
    .then((res) => {
      console.log(`\nTest 1 Passed: ${res.passed}/${res.total} assertions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
