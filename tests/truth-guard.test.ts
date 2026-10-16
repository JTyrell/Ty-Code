/**
 * Truth Guard Unit Tests (RealConnect 1)
 *
 * Verifies that:
 * 1. chat-store rejects any assistant message without proper metadata {source, providerId, modelId, streamEventCount}
 * 2. Canned fixture strings are structurally rejected with RENDER_SOURCE_VIOLATION
 * 3. Diagnostic error cards pass through without requiring stream metadata
 * 4. Dev mode warns when streamEventCount < 5
 * 5. Valid streamed assistant messages pass validation
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { validateAssistantMessage, type AssistantStreamMetadata } from '../src/renderer/src/state/chat-store';
import type { ChatMessage, ChatErrorCard } from '../src/preload/types';

export async function runTruthGuardTests(): Promise<void> {
  console.log('🔒 Testing Truth Guard: chat-store assistant message validation...\n');

  // Load forbidden strings from tests/fixtures.json
  const fixturesPath = path.resolve(__dirname, '..', 'tests', 'fixtures.json');
  const fixturesData = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const forbiddenStrings: string[] = fixturesData.forbiddenStrings;

  console.log(`Loaded ${forbiddenStrings.length} forbidden fixture strings from fixtures.json.`);

  // Test 1: Reject assistant message without metadata
  {
    const msgWithoutMeta: ChatMessage = {
      id: 'asst-1',
      role: 'assistant',
      content: 'Hello, this message was generated without stream metadata.',
      timestamp: Date.now()
    };
    const res = validateAssistantMessage(msgWithoutMeta, forbiddenStrings);
    assert.strictEqual(res.valid, false, 'Message without metadata must be rejected');
    assert.ok(
      res.violation?.includes('RENDER_SOURCE_VIOLATION'),
      `Expected violation to contain RENDER_SOURCE_VIOLATION, got: ${res.violation}`
    );
    console.log('  ✓ Assistant message without metadata rejected with RENDER_SOURCE_VIOLATION');
  }

  // Test 2: Reject assistant message with fake source
  {
    const msgWithFakeSource: ChatMessage = {
      id: 'asst-2',
      role: 'assistant',
      content: 'Here is some text.',
      metadata: {
        source: 'mock' as any,
        providerId: 'openrouter',
        modelId: 'deepseek',
        streamEventCount: 10
      },
      timestamp: Date.now()
    };
    const res = validateAssistantMessage(msgWithFakeSource, forbiddenStrings);
    assert.strictEqual(res.valid, false, 'Message with non-provider-stream source must be rejected');
    assert.ok(res.violation?.includes('RENDER_SOURCE_VIOLATION'));
    console.log('  ✓ Assistant message with non-provider-stream source rejected');
  }

  // Test 3: Reject assistant message with missing providerId or modelId
  {
    const msgMissingProvider: ChatMessage = {
      id: 'asst-3',
      role: 'assistant',
      content: 'Missing provider.',
      metadata: {
        source: 'provider-stream',
        providerId: '',
        modelId: 'gpt-4o',
        streamEventCount: 10
      },
      timestamp: Date.now()
    };
    const res1 = validateAssistantMessage(msgMissingProvider, forbiddenStrings);
    assert.strictEqual(res1.valid, false, 'Message with empty providerId must be rejected');

    const msgMissingModel: ChatMessage = {
      id: 'asst-4',
      role: 'assistant',
      content: 'Missing model.',
      metadata: {
        source: 'provider-stream',
        providerId: 'openai',
        modelId: '',
        streamEventCount: 10
      },
      timestamp: Date.now()
    };
    const res2 = validateAssistantMessage(msgMissingModel, forbiddenStrings);
    assert.strictEqual(res2.valid, false, 'Message with empty modelId must be rejected');
    console.log('  ✓ Assistant message with missing providerId or modelId rejected');
  }

  // Test 4: Reject assistant message with negative streamEventCount
  {
    const msgNegativeEvents: ChatMessage = {
      id: 'asst-5',
      role: 'assistant',
      content: 'Negative events.',
      metadata: {
        source: 'provider-stream',
        providerId: 'openai',
        modelId: 'gpt-4o',
        streamEventCount: -1
      },
      timestamp: Date.now()
    };
    const res = validateAssistantMessage(msgNegativeEvents, forbiddenStrings);
    assert.strictEqual(res.valid, false, 'Message with negative streamEventCount must be rejected');
    console.log('  ✓ Assistant message with negative streamEventCount rejected');
  }

  // Test 5: Reject any message containing fixture strings (even if metadata is fabricated)
  {
    for (const fixture of forbiddenStrings) {
      const msgWithFixture: ChatMessage = {
        id: 'asst-6',
        role: 'assistant',
        content: `Here is the response: ${fixture}`,
        metadata: {
          source: 'provider-stream',
          providerId: 'fcc-proxy',
          modelId: 'claude-3-5-sonnet',
          streamEventCount: 12
        },
        timestamp: Date.now()
      };
      const res = validateAssistantMessage(msgWithFixture, forbiddenStrings);
      assert.strictEqual(res.valid, false, `Fixture string "${fixture}" must be rejected`);
      assert.ok(
        res.violation?.includes('RENDER_SOURCE_VIOLATION'),
        `Expected RENDER_SOURCE_VIOLATION for fixture "${fixture}"`
      );
    }
    console.log(`  ✓ All ${forbiddenStrings.length} forbidden fixture strings rejected with RENDER_SOURCE_VIOLATION`);
  }

  // Test 6: Accept valid assistant message with authentic metadata and content
  {
    const validMsg: ChatMessage = {
      id: 'asst-7',
      role: 'assistant',
      content: 'I have analyzed your repository and the issue is resolved.',
      metadata: {
        source: 'provider-stream',
        providerId: 'openrouter',
        modelId: 'anthropic/claude-3.5-sonnet',
        streamEventCount: 24
      },
      timestamp: Date.now()
    };
    const res = validateAssistantMessage(validMsg, forbiddenStrings);
    assert.strictEqual(res.valid, true, 'Valid streamed message must pass validation');
    assert.strictEqual(res.violation, undefined);
    console.log('  ✓ Valid streamed assistant message with authentic metadata accepted');
  }

  // Test 7: Non-assistant messages (user, tool) pass without metadata requirement
  {
    const userMsg: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: 'What is the status of the project?',
      timestamp: Date.now()
    };
    const resUser = validateAssistantMessage(userMsg, forbiddenStrings);
    assert.strictEqual(resUser.valid, true, 'User messages must pass without metadata');

    const toolMsg: ChatMessage = {
      id: 'tool-1',
      role: 'tool',
      content: '{"exitCode": 0}',
      timestamp: Date.now()
    };
    const resTool = validateAssistantMessage(toolMsg, forbiddenStrings);
    assert.strictEqual(resTool.valid, true, 'Tool messages must pass without metadata');
    console.log('  ✓ User and tool messages pass without metadata requirement');
  }

  // Test 8: ErrorCard messages pass without metadata (diagnostic records)
  {
    const errorCard: ChatErrorCard = {
      taxonomyCode: 'CONFIG_MISSING',
      message: 'No API key configured for OpenRouter.',
      remedy: 'Add API key in Settings > Providers'
    };
    const errorMsg: ChatMessage = {
      id: 'err-1',
      role: 'assistant',
      content: '**[CONFIG_MISSING]** No API key configured.',
      errorCard,
      timestamp: Date.now()
    };
    const res = validateAssistantMessage(errorMsg, forbiddenStrings);
    assert.strictEqual(res.valid, true, 'Error cards are diagnostic records and must pass without stream metadata');
    console.log('  ✓ Diagnostic ErrorCard messages pass through without requiring stream metadata');
  }

  // Test 9: Dev mode warning on streamEventCount < 5
  {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let warned = false;
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.includes('[TruthGuard] Dev Streaming Warning')) {
        warned = true;
      }
      origWarn(...args);
    };

    try {
      const lowStreamMsg: ChatMessage = {
        id: 'asst-8',
        role: 'assistant',
        content: 'This is a long enough message that should trigger the dev warning if stream event count is too low.',
        metadata: {
          source: 'provider-stream',
          providerId: 'groq',
          modelId: 'llama-3.3-70b',
          streamEventCount: 2 // < 5
        },
        timestamp: Date.now()
      };
      const res = validateAssistantMessage(lowStreamMsg, forbiddenStrings);
      assert.strictEqual(res.valid, true, 'Message is still structurally valid');
      assert.strictEqual(warned, true, 'Dev mode warning must be logged when streamEventCount < 5');
      console.log('  ✓ Dev streaming warning verified when streamEventCount < 5');
    } finally {
      process.env.NODE_ENV = origEnv;
      console.warn = origWarn;
    }
  }

  console.log('\n========================================================================');
  console.log('=== TRUTH GUARD UNIT SUITE PASSED: 9/9 TESTS                        ===');
  console.log('========================================================================\n');
}

// Direct execution
if (require.main === module) {
  runTruthGuardTests().catch((err) => {
    console.error('Truth guard tests failed:', err);
    process.exit(1);
  });
}
