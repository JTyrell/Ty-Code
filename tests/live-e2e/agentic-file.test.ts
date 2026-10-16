/**
 * Live E2E Test 4: Agentic File Creation
 *
 * Sends: 'Create file live-check.md with line verified'
 * Expected: tool card / tool_call chunk emitted, and file created on disk with exact content.
 *
 * Assertion: fs.existsSync('live-check.md') && fs.readFileSync('live-check.md').trim() === 'verified'
 *
 * Brand: Ty-Code
 */

import { AgentEngine } from '../../src/main/agent/agent-engine';
import { startLiveTestServer } from './test-server';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import type { AgentStreamChunk, ToolCall } from '../../src/preload/types';

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

export async function runAgenticFileTest(): Promise<{
  passed: number;
  total: number;
  filePath: string;
  content: string;
  toolCallReceived: boolean;
}> {
  console.log('\n========================================================================');
  console.log('=== TEST 4 — AGENTIC FILE CREATION: REAL DISK TOOL EXECUTION         ===');
  console.log('========================================================================');

  const instance = await startLiveTestServer();
  const testDir = path.join(os.tmpdir(), `tycode-agentic-file-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  const targetFilePath = path.join(testDir, 'live-check.md');

  try {
    // Initial condition: file does not exist
    assert(!fsSync.existsSync(targetFilePath), 'live-check.md does not exist prior to agent task');

    const emittedChunks: AgentStreamChunk[] = [];
    let toolCallReceived = false;

    const engine = new AgentEngine(testDir);
    console.log(`  Executing agent prompt: "Create file live-check.md with line verified"...`);

    await engine.run({
      prompt: 'Create file live-check.md with line verified',
      workspacePath: testDir,
      history: [],
      settings: instance.settings,
      onChunk: (chunk) => {
        emittedChunks.push(chunk);
        if (chunk.type === 'tool_call') {
          toolCallReceived = true;
          console.log(`  Tool card received: ${chunk.toolCall.name}(${JSON.stringify(chunk.toolCall.arguments)})`);
        }
      },
      requestApproval: async () => true
    });

    // Verify on disk using both fsSync and fs promises
    const fileExists = fsSync.existsSync(targetFilePath);
    assert(fileExists, 'fs.existsSync confirms live-check.md created on disk');

    const content = fileExists ? fsSync.readFileSync(targetFilePath, 'utf-8') : '';
    console.log(`  File content on disk: "${content.trim()}"`);

    // Required Assertion: fs.existsSync('live-check.md') && fs.readFileSync('live-check.md').trim() === 'verified'
    assert(
      fileExists && content.trim() === 'verified',
      `fs.existsSync('live-check.md') && fs.readFileSync('live-check.md').trim() === 'verified'`
    );
    assert(toolCallReceived, 'Agent emitted a tool_call event for file creation');

    return {
      passed: passedTests,
      total: totalTests,
      filePath: targetFilePath,
      content: content.trim(),
      toolCallReceived
    };
  } finally {
    await instance.close();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  runAgenticFileTest()
    .then((res) => {
      console.log(`\nTest 4 Passed: ${res.passed}/${res.total} assertions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
