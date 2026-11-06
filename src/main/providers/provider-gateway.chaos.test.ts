/**
 * Dev chaos Output-Validity faults (Step 5.1) end-to-end through the gateway.
 *
 * `emptyResponse` (200 + zero-content stream) and `errorIn200` (200 whose first
 * chunk carries an `error` key) must NOT pass as successes. They preset a
 * synthetic HTTP 200 whose body is degenerate, so the real Output Validity Gate
 * classifies them (zero_data_events / error_in_200), records the health-board
 * strike, and throws into the remediation ladder — rotating to the healthy
 * route and producing a single good reply, never a hollow bubble.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class { },
  app: { isReady: () => true, getPath: (name: string) => `${TMP_ROOT}/${name}`, isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => String(v) },
  ipcMain: { handle: () => undefined, on: () => undefined }
}));
vi.mock('../ipc/settings-handlers', () => ({
  readStoredCredentials: async () => ({ keys: { openrouter: 'sk-settings-openrouter' } }),
  getProviderSettings: async () => ({ success: true, data: { apiKeys: {} } })
}));
vi.mock('../services/orchestration/user-preferences', () => ({
  userPreferences: { updatePreferences: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../services/policy/policy-engine', () => ({
  policyEngine: { assertAllowed: () => ({ allowed: true }) }
}));
vi.mock('../services/auth/credential-store', () => ({
  credentialStore: {
    getDecryptedKey: () => undefined,
    getAllVaultKeys: () => ({}),
    saveCredential: vi.fn().mockResolvedValue(undefined),
    touchCredential: vi.fn()
  }
}));
vi.mock('../services/orchestration/quota-tracker', () => ({
  quotaTracker: { getProviderQuota: () => null }
}));
// Chaos is DRIVEN here: takeChaosFault returns the queued fault for the primary
// route (openrouter) only, so the handoff to ty-code-free reaches the real fetch.
const chaosState = vi.hoisted(() => ({ fault: null as null | 'emptyResponse' | 'errorIn200' }));
vi.mock('../services/reliability/reliability-sentinel', () => ({
  reliabilitySentinel: {
    takeChaosFault: (providerId: string) =>
      providerId === 'openrouter' && chaosState.fault ? { fault: chaosState.fault, durationMs: 0 } : null,
    isProviderPoor: () => false,
    isRouteUnusable: () => false,
    getCooldownRemainingSec: () => 0,
    getHealthSnapshot: () => ({ version: 1, updatedAt: 0, routes: [] }),
    recordRequestResult: vi.fn()
  }
}));
vi.mock('../services/reliability/remediation-ladder', () => ({
  reliabilityLadder: {
    acquireCooldownRetry: vi.fn().mockResolvedValue(false),
    onChainExhausted: vi.fn().mockResolvedValue(null),
    reportRecoveryOutcome: vi.fn(),
    onRouteRecovered: vi.fn(),
    onProviderKeyInvalidated: vi.fn()
  }
}));
vi.mock('../services/reliability/reliability-ledger', () => ({
  reliabilityLedger: { record: vi.fn() }
}));
vi.mock('../services/providers/catalog-verifier', () => ({
  modelCatalogVerifier: { healOpenRouterFreeTier: vi.fn().mockResolvedValue({ pruned: 0, admitted: 0 }) }
}));
vi.mock('../services/credential-vault', () => ({
  getKey: async (providerId: string) => (providerId === 'openrouter' ? 'sk-openrouter-test' : undefined),
  getCommunityKey: async () => 'community-key-card-value',
  getCommunityKeyCached: () => 'community-key-card-value',
  warmUpCommunityKey: vi.fn(),
  hasCommunityKey: () => true,
  invalidateCommunityKey: vi.fn(),
  emitCommunityKeyStatus: vi.fn(),
  testKey: vi.fn().mockResolvedValue({ valid: true }),
  probeSavedKey: vi.fn().mockResolvedValue({ valid: true }),
  listProvidersWithKeys: () => ['openrouter']
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProviderGateway, sendChatRequest } from './provider-gateway';
import { providerHealthStore } from './provider-health-store';
import { reliabilityLedger } from '../services/reliability/reliability-ledger';
import { reliabilitySentinel } from '../services/reliability/reliability-sentinel';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-chaos');

const { TEST_CATALOG } = vi.hoisted(() => ({
  TEST_CATALOG: [
    { providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, name: 'OpenRouter gpt-4o-mini' },
    { providerId: 'ty-code-free', modelId: 'openai/gpt-4o-mini', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Ty-Code Free' }
  ]
}));

vi.mock('../services/verified-models', () => ({
  getVerifiedModels: async () => TEST_CATALOG
}));

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  providerHealthStore.__forTest(null);
  vi.clearAllMocks();
  chaosState.fault = null;
  for (const envVar of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    delete process.env[envVar];
  }
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
  // Only the handoff (ty-code-free) actually hits fetch; the primary openrouter
  // send is served the preset degenerate 200 (chaosPresetResponse), bypassing fetch.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown) => {
    const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'healthy fallback reply' } }] })}\n\ndata: [DONE]\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      }
    });
    void url;
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
});

afterEach(() => {
  fetchSpy?.mockRestore();
  providerHealthStore.__forTest(null);
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function callSend(taskId: string) {
  return sendChatRequest(
    'openrouter',
    'openai/gpt-4o-mini',
    [{ role: 'user', content: 'Hey there' }],
    true,
    undefined,
    () => undefined,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    taskId,
    'chat'
  );
}

function degenerateRecords() {
  return vi
    .mocked(reliabilityLedger.record)
    .mock.calls
    .map((c) => c[0] as { kind?: string; detail?: string })
    .filter((rec) => rec?.kind === 'degenerate');
}

describe('dev chaos Output-Validity faults (emptyResponse / errorIn200)', () => {
  it('emptyResponse trips the gate, marks the route failed, and rotates to a good reply', async () => {
    ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
    chaosState.fault = 'emptyResponse';

    const text = await callSend('chaos-empty-task');

    expect(text).toContain('healthy fallback reply');
    const recs = degenerateRecords();
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].detail).toMatch(/reason=zero_data_events/);
    expect(reliabilitySentinel.recordRequestResult).toHaveBeenCalledWith(
      expect.stringContaining('openrouter'),
      expect.any(String),
      false,
      undefined,
      expect.stringContaining('degenerate_output')
    );
  });

  it('errorIn200 trips the gate as error_in_200 and rotates to a good reply', async () => {
    ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
    chaosState.fault = 'errorIn200';

    const text = await callSend('chaos-err200-task');

    expect(text).toContain('healthy fallback reply');
    const recs = degenerateRecords();
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].detail).toMatch(/reason=error_in_200/);
  });
});
