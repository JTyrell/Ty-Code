/**
 * Key-pool rotation BEFORE provider rotation (Step 2.1 / checklist #3).
 *
 * A multi-key provider whose FIRST key 401s must advance to the SECOND key in
 * the pool and succeed WITHOUT ever leaving the provider. The reliability ledger
 * records a key_rotation event; the provider is never handed off.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class { },
  app: { isReady: () => true, getPath: (name: string) => `${TMP_ROOT}/${name}`, isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => String(v) },
  ipcMain: { handle: () => undefined, on: () => undefined }
}));
vi.mock('../ipc/settings-handlers', () => ({
  readStoredCredentials: async () => ({ keys: { openrouter: 'sk-or-BAD' } }),
  getProviderSettings: async () => ({ success: true, data: { apiKeys: {} } })
}));
vi.mock('../services/orchestration/user-preferences', () => ({
  userPreferences: { updatePreferences: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../services/policy/policy-engine', () => ({
  policyEngine: { assertAllowed: () => ({ allowed: true }) }
}));
vi.mock('../services/auth/credential-store', () => ({
  credentialStore: { getDecryptedKey: () => undefined, getAllVaultKeys: () => ({}), saveCredential: vi.fn().mockResolvedValue(undefined), touchCredential: vi.fn() }
}));
vi.mock('../services/orchestration/quota-tracker', () => ({ quotaTracker: { getProviderQuota: () => null } }));
vi.mock('../services/reliability/reliability-sentinel', () => ({
  reliabilitySentinel: {
    takeChaosFault: () => null,
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
    reportRecoveryOutcome: vi.fn(), onRouteRecovered: vi.fn(), onProviderKeyInvalidated: vi.fn()
  }
}));
vi.mock('../services/reliability/reliability-ledger', () => ({ reliabilityLedger: { record: vi.fn() } }));
vi.mock('../services/providers/catalog-verifier', () => ({
  modelCatalogVerifier: { healOpenRouterFreeTier: vi.fn().mockResolvedValue({ pruned: 0, admitted: 0 }) }
}));
vi.mock('../services/credential-vault', () => ({
  getKey: async (providerId: string) => (providerId === 'openrouter' ? 'sk-or-BAD' : undefined),
  // Two-key pool: primary (BAD) + one extra (GOOD).
  getKeyPool: async (providerId: string) => (providerId === 'openrouter' ? ['sk-or-BAD', 'sk-or-GOOD'] : []),
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
import { ProviderGateway, sendChatRequest, __resetTurnRemediation } from './provider-gateway';
import { providerHealthStore } from './provider-health-store';
import { reliabilityLedger } from '../services/reliability/reliability-ledger';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-keypool');

vi.mock('../services/verified-models', () => ({
  getVerifiedModels: async () => [
    { providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, name: 'OpenRouter' },
    { providerId: 'ty-code-free', modelId: 'openai/gpt-4o-mini', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Ty-Code Free' }
  ]
}));

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let authSeen: string[] = [];
let openrouterDials = 0;

beforeEach(() => {
  providerHealthStore.__forTest(null);
  vi.clearAllMocks();
  authSeen = [];
  openrouterDials = 0;
  for (const v of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[v];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown, init?: RequestInit) => {
    const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = String(headers['Authorization'] ?? headers['authorization'] ?? '');
    authSeen.push(auth);
    if (url.includes('openrouter.ai')) {
      openrouterDials += 1;
      // The BAD key 401s; the GOOD key streams a real reply.
      if (auth.includes('sk-or-BAD')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 });
      }
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'reply from second key' } }] })}\n\ndata: [DONE]\n\n`;
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    // Any other provider must never be dialled: provider was never left.
    return new Response(JSON.stringify({ error: { message: 'should not rotate provider' } }), { status: 500 });
  });
});

afterEach(() => {
  fetchSpy?.mockRestore();
  providerHealthStore.__forTest(null);
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  __resetTurnRemediation();
});

describe('key-pool rotation before provider rotation', () => {
  it('401 on the first key rotates to the second key and succeeds without leaving the provider', async () => {
    ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });

    const text = await sendChatRequest(
      'openrouter', 'openai/gpt-4o-mini', [{ role: 'user', content: 'hi' }], true, undefined,
      () => undefined, 0, undefined, undefined, undefined, undefined, undefined, 'keypool-task-1', 'chat'
    );

    expect(text).toContain('reply from second key');
    // Only OpenRouter was dialled — the provider was never left.
    expect(openrouterDials).toBe(2);
    expect(authSeen.some((a) => a.includes('sk-or-BAD'))).toBe(true);
    expect(authSeen.some((a) => a.includes('sk-or-GOOD'))).toBe(true);

    // A key_rotation ledger event was emitted (never with a raw secret).
    const keyRots = vi
      .mocked(reliabilityLedger.record)
      .mock.calls
      .map((c) => c[0] as { kind?: string; detail?: string; from?: string; to?: string })
      .filter((r) => r?.kind === 'key_rotation');
    expect(keyRots.length).toBeGreaterThanOrEqual(1);
    expect(keyRots[0].detail).toMatch(/trigger=auth/);
    expect(JSON.stringify(keyRots)).not.toMatch(/sk-or-(BAD|GOOD)/);
  });
});
