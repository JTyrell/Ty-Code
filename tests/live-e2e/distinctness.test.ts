/**
 * Live E2E Test 2: Distinctness
 *
 * Sends 3 different prompts ('Hi', 'Explain hashes', 'What is 17*23?')
 * Expected: 3 distinct non-identical responses (proves dynamic generation, not canned static stub).
 *
 * Assertion: response1 !== response2 && response2 !== response3 && response1 !== response3
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

export async function runDistinctnessTest(): Promise<{
  passed: number;
  total: number;
  response1: string;
  response2: string;
  response3: string;
}> {
  console.log('\n========================================================================');
  console.log('=== TEST 2 — DISTINCTNESS: 3 DIFFERENT PROMPTS DIVERGENCE             ===');
  console.log('========================================================================');

  const instance = await startLiveTestServer();

  try {
    const prompt1 = 'Hi';
    const prompt2 = 'Explain hashes';
    const prompt3 = 'What is 17*23?';

    console.log(`  Prompt 1: "${prompt1}"...`);
    const res1 = (
      await ProviderGateway.streamChat(
        instance.settings,
        [{ role: 'user', content: prompt1 }],
        [],
        {}
      )
    ).fullText.trim();

    console.log(`  Prompt 2: "${prompt2}"...`);
    const res2 = (
      await ProviderGateway.streamChat(
        instance.settings,
        [{ role: 'user', content: prompt2 }],
        [],
        {}
      )
    ).fullText.trim();

    console.log(`  Prompt 3: "${prompt3}"...`);
    const res3 = (
      await ProviderGateway.streamChat(
        instance.settings,
        [{ role: 'user', content: prompt3 }],
        [],
        {}
      )
    ).fullText.trim();

    console.log(`  Response 1: "${res1}"`);
    console.log(`  Response 2: "${res2}"`);
    console.log(`  Response 3: "${res3}"`);

    // Required Assertion: response1 !== response2 && response2 !== response3 && response1 !== response3
    assert(res1 !== res2, 'response1 !== response2');
    assert(res2 !== res3, 'response2 !== response3');
    assert(res1 !== res3, 'response1 !== response3');
    assert(res1.length > 0 && res2.length > 0 && res3.length > 0, 'All three responses are non-empty');

    return {
      passed: passedTests,
      total: totalTests,
      response1: res1,
      response2: res2,
      response3: res3
    };
  } finally {
    await instance.close();
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  runDistinctnessTest()
    .then((res) => {
      console.log(`\nTest 2 Passed: ${res.passed}/${res.total} assertions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
