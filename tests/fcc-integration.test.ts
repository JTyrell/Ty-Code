/**
 * FCC Integration & Multi-Harness Routing Test Suite
 *
 * Validates:
 * 1. FCCSidecarManager lifecycle, Zod schema validations, and process spawning contracts.
 * 2. FCCModelMapper model discovery across all 11 harnesses and VerifiedModelConfig mapping.
 * 3. ModelRotationManager fallback chain (ty-code-free -> fcc -> openkilo -> ...) and harness rotation.
 * 4. ProviderGateway FCC adapter, multi-harness routing, and quota tracking.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FCCSidecarManager,
  FCCHealthSchema,
  FCCModelListSchema,
  FCCChatCompletionChunkSchema,
  FCCVoiceTranscriptionSchema,
  FCCBrowserSessionSchema
} from '../src/main/services/fcc-sidecar-manager';
import { FCCModelMapper } from '../src/main/services/fcc-model-mapper';
import {
  ModelRotationManager,
  FALLBACK_CHAIN,
  FCC_HARNESSES
} from '../src/main/services/model-rotation-manager';
import { ProviderGateway, getFccSidecarChatUrl } from '../src/main/providers/provider-gateway';

describe('FCC Integration & Multi-Harness Architecture', () => {
  describe('Step 1: FCCSidecarManager & Zod Validation Contracts', () => {
    it('validates health check payload against Zod schema', () => {
      const validHealth = {
        status: 'ready',
        port: 8765,
        version: '0.9.4-fcc',
        uptime: 120,
        harnesses: ['claude-code', 'codex', 'vscode', 'pi', 'opencode'],
        quota: {
          total: 1350000000,
          used: 50000,
          remaining: 1349950000
        }
      };

      const parsed = FCCHealthSchema.safeParse(validHealth);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.port).toBe(8765);
        expect(parsed.data.version).toBe('0.9.4-fcc');
        expect(parsed.data.quota.total).toBe(1350000000);
      }
    });

    it('rejects invalid health payload with missing required fields', () => {
      const invalidHealth = {
        status: 'ready'
        // missing port, version
      };
      const parsed = FCCHealthSchema.safeParse(invalidHealth);
      expect(parsed.success).toBe(false);
    });

    it('validates models discovery payload against Zod schema', () => {
      const sampleModels = {
        object: 'list',
        data: [
          { id: 'fcc:claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', harness: 'claude-code', context_length: 200000 },
          { id: 'fcc:gpt-4o', name: 'GPT-4o', harness: 'codex', context_length: 128000 }
        ]
      };
      const parsed = FCCModelListSchema.safeParse(sampleModels);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.data).toHaveLength(2);
        expect(parsed.data.data[0].harness).toBe('claude-code');
        expect(parsed.data.data[1].harness).toBe('codex');
      }
    });

    it('validates streaming chunk payload with quota tracking', () => {
      const chunkWithQuota = {
        id: 'chatcmpl-test-123',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello from FCC!' },
            finish_reason: null
          }
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 5,
          total_tokens: 20
        },
        fcc_quota: {
          consumed: 20,
          remaining: 1349999980
        }
      };
      const parsed = FCCChatCompletionChunkSchema.safeParse(chunkWithQuota);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.choices[0].delta.content).toBe('Hello from FCC!');
        expect(parsed.data.fcc_quota?.consumed).toBe(20);
      }
    });

    it('validates voice transcription response schema', () => {
      const voiceResult = {
        text: 'Deploy application to production',
        confidence: 0.98,
        language: 'en',
        durationMs: 450
      };
      const parsed = FCCVoiceTranscriptionSchema.safeParse(voiceResult);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.text).toBe('Deploy application to production');
        expect(parsed.data.confidence).toBe(0.98);
      }
    });

    it('validates browser session orchestration schema for ToS compliance', () => {
      const sessionResult = {
        sessionId: 'browser-sess-abc1234',
        status: 'active',
        action: 'launch',
        tosCompliant: true,
        reused: true
      };
      const parsed = FCCBrowserSessionSchema.safeParse(sessionResult);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.tosCompliant).toBe(true);
        expect(parsed.data.reused).toBe(true);
      }
    });

    it('sidecar manager exposes default port 8765 and /v1 base URL', () => {
      const manager = new FCCSidecarManager({ port: 8765 });
      expect(manager.getPort()).toBe(8765);
      expect(manager.getBaseUrl()).toBe('http://127.0.0.1:8765/v1');
    });
  });

  describe('Step 2 & Step 3: FCC Model Discovery & Multi-Harness Mapping', () => {
    it('maps all 11 supported harnesses in fallback catalog', async () => {
      const mapper = new FCCModelMapper();
      const models = await mapper.getDiscoveredModels();

      expect(models.length).toBeGreaterThanOrEqual(11);
      const harnessesFound = new Set(models.map((m) => m.harness));

      // Verify all 11 core harnesses are represented
      expect(harnessesFound.has('claude-code')).toBe(true);
      expect(harnessesFound.has('codex')).toBe(true);
      expect(harnessesFound.has('vscode')).toBe(true);
      expect(harnessesFound.has('pi')).toBe(true);
      expect(harnessesFound.has('opencode')).toBe(true);
      expect(harnessesFound.has('cline')).toBe(true);
      expect(harnessesFound.has('aider')).toBe(true);
      expect(harnessesFound.has('hermes')).toBe(true);
      expect(harnessesFound.has('deepseek')).toBe(true);
      expect(harnessesFound.has('grok-build')).toBe(true);
      expect(harnessesFound.has('muse-code')).toBe(true);
    });

    it('resolves model harness accurately based on model ID', () => {
      const mapper = new FCCModelMapper();
      expect(mapper.getHarnessForModel('fcc:claude-3-5-sonnet-20241022')).toBe('claude-code');
      expect(mapper.getHarnessForModel('fcc:gpt-4o')).toBe('codex');
      expect(mapper.getHarnessForModel('fcc:github-copilot')).toBe('vscode');
      expect(mapper.getHarnessForModel('fcc:deepseek-coder')).toBe('deepseek');
      expect(mapper.getHarnessForModel('fcc:pi-coder')).toBe('pi');
      expect(mapper.getHarnessForModel('fcc:opencode-zen')).toBe('opencode');
      expect(mapper.getHarnessForModel('fcc:grok-build')).toBe('grok-build');

      // Manual override respected
      expect(mapper.getHarnessForModel('fcc:claude-3-5-sonnet-20241022', 'codex')).toBe('codex');
    });

    it('sets keyless providerId fcc with sidecar URL in VerifiedModelConfig', async () => {
      const mapper = new FCCModelMapper();
      const claude = await mapper.getModel('fcc:claude-3-5-sonnet-20241022');
      expect(claude).toBeDefined();
      if (claude) {
        expect(claude.providerId).toBe('fcc');
        expect(claude.requiresKey).toBe(false);
        expect(claude.url).toContain('/chat/completions');
        expect(claude.harness).toBe('claude-code');
      }
    });
  });

  describe('Step 5: ModelRotationManager & Failover Chains', () => {
    let rotationManager: ModelRotationManager;

    beforeEach(() => {
      rotationManager = new ModelRotationManager();
      rotationManager.clearCooldowns();
    });

    it('places ty-code-free then fcc at the top of the provider fallback chain', () => {
      const chain = rotationManager.getFallbackChain();
      expect(chain[0]).toBe('ty-code-free');
      expect(chain[1]).toBe('fcc');
      expect(chain[2]).toBe('openkilo');
      expect(chain[3]).toBe('openrouter-free');
    });

    it('rotates to next healthy harness when a specific harness fails', () => {
      const next1 = rotationManager.getNextHarness('claude-code');
      expect(next1).toBe('codex');

      rotationManager.recordHarnessFailure('codex', 'Rate limit 429');
      const next2 = rotationManager.getNextHarness('claude-code');
      // skips failed codex
      expect(next2).toBe('vscode');
    });

    it('falls back from FCC to OpenKilo when all harnesses fail or quota is exhausted', () => {
      const nextProv = rotationManager.getNextProvider('fcc');
      expect(nextProv).toBe('openkilo');

      const nextAfterKilo = rotationManager.getNextProvider('openkilo');
      expect(nextAfterKilo).toBe('openrouter-free');
    });

    it('resets harness failure record upon success', () => {
      rotationManager.recordHarnessFailure('codex', 'Timeout');
      rotationManager.recordHarnessSuccess('codex');
      const next = rotationManager.getNextHarness('claude-code');
      expect(next).toBe('codex');
    });
  });

  describe('Step 2 & Provider Gateway Wire Resolution', () => {
    it('returns FCC sidecar endpoint for fcc and fcc-proxy provider IDs', () => {
      const endpoint = ProviderGateway.getEndpoint('fcc');
      expect(endpoint).toContain(':8765/v1');

      const proxyEndpoint = ProviderGateway.getEndpoint('fcc-proxy');
      expect(proxyEndpoint).toContain(':8765/v1');
    });

    it('provides correct sidecar chat completions URL', () => {
      const chatUrl = getFccSidecarChatUrl();
      expect(chatUrl).toContain('/chat/completions');
      expect(chatUrl).toContain('8765');
    });
  });
});
