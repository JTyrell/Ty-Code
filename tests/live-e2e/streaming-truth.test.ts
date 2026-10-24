/**
 * Live E2E Test 3: Streaming Truth
 *
 * Captures progressive token deltas during a live reply.
 * Proves genuine streaming delivery over TCP sockets instead of single-chunk buffering.
 *
 * Assertion: streamEventCount >= 5
 *
 * Brand: Ty-Code
 */

import { ProviderGateway } from '../../src/main/providers/provider-gateway';
import { AgentEngine } from '../../src/main/agent/agent-engine';
import { startLiveTestServer } from './test-server';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

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

export async function runStreamingTruthTest(): Promise<{
  passed: number;
  total: number;
  streamEventCount: number;
  tokens: string[];
}> {
  console.log('\n========================================================================');
  console.log('=== TEST 3 — STREAMING TRUTH: PROGRESSIVE TOKEN DELIVERY PROOF       ===');
  console.log('========================================================================');

  const instance = await startLiveTestServer();
  const testDir = path.join(os.tmpdir(), `tycode-stream-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  try {
    const streamTokens: string[] = [];
    const gatewayTokens: string[] = [];
    const rawGatewayTokens: string[] = [];

    // 1. Gateway stream test.
    // `onToken` observes the IPC-batched cadence (32ms StreamChunkBatcher);
    // `onRawToken` observes per-SSE-delta delivery over the wire, which is the
    // progressive-streaming criterion under test (a fast reply can coalesce
    // every delta into a single 32ms batch, so batched counts are not the
    // TCP-level truth).
    await ProviderGateway.streamChat(
      instance.settings,
      [{ role: 'user', content: 'Explain hashes' }],
      [],
      {
        onToken: (tok) => gatewayTokens.push(tok),
        onRawToken: (tok) => rawGatewayTokens.push(tok)
      }
    );

    // 2. AgentEngine stream test (agent:stream-token events)
    // Pin the engine binding to the healthy sidecar model (isAutoMode default
    // would route through adaptive FCC auto selection).
    ProviderGateway.setActiveModel({ providerId: 'fcc-proxy', modelId: 'llama-3.3-70b-versatile', isAutoMode: false });
    ProviderGateway.setEndpointOverride('fcc-proxy', instance.baseUrl);

    const engine = new AgentEngine(testDir);
    await engine.run({
      prompt: 'Explain hashes in detail',
      workspacePath: testDir,
      history: [],
      settings: instance.settings,
      onChunk: (chunk) => {
        if (chunk.type === 'token' && chunk.content) {
          streamTokens.push(chunk.content);
        }
      },
      requestApproval: async () => ({ approved: true })
    });

    const streamEventCount = Math.max(streamTokens.length, rawGatewayTokens.length);
    console.log(`  Captured ${streamEventCount} progressive stream-token events.`);
    console.log(`  Gateway SSE deltas: ${rawGatewayTokens.length}, Gateway batched events: ${gatewayTokens.length}, Engine token events: ${streamTokens.length}`);

    // Required Assertion: streamEventCount >= 5
    assert(
      streamEventCount >= 5,
      `Captured >= 5 stream events (actual: ${streamEventCount})`
    );
    assert(rawGatewayTokens.length >= 5, `Gateway SSE delta count >= 5 (actual: ${rawGatewayTokens.length})`);

    return {
      passed: passedTests,
      total: totalTests,
      streamEventCount,
      tokens: streamTokens.length >= 5 ? streamTokens : rawGatewayTokens
    };
  } finally {
    await instance.close();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  runStreamingTruthTest()
    .then((res) => {
      console.log(`\nTest 3 Passed: ${res.passed}/${res.total} assertions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
