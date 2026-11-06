/**
 * Output Validity Gate — end-to-end CONTRACT test (Step 5.2).
 *
 * One user turn against a route pool where A returns an empty 200 and B returns
 * real content must yield:
 *   1. exactly ONE good reply (from the rotated route, never a hollow bubble),
 *   2. a consolidated trail line "A(degenerate) -> B(ok)",
 *   3. the health board fed a DEGENERATE failure for A (so repeated empties
 *      degrade it — the threshold marking itself is covered by
 *      reliability-sentinel.quality.test.ts),
 *   4. a structured `degenerate_output` ledger event for A.
 *
 * Real routeEventPolicy is exercised (beginTurn → gateway hops → finishTurn);
 * the sentinel/ledger/vault are stubbed so the assertion set is deterministic
 * and network-free (Zero Telemetry).
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
    getKeyPool: async (providerId: string) => (providerId === 'openrouter' ? ['sk-openrouter-test'] : []),
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
import { reliabilityLadder } from '../services/reliability/remediation-ladder';
import { reliabilityLedger } from '../services/reliability/reliability-ledger';
import { reliabilitySentinel } from '../services/reliability/reliability-sentinel';
import { modelCatalogVerifier } from '../services/providers/catalog-verifier';
import { routeEventPolicy } from './route-event-policy';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-contract');

const { TEST_CATALOG } = vi.hoisted(() => ({
    TEST_CATALOG: [
        { providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, name: 'OpenRouter gpt-4o-mini' },
        { providerId: 'ty-code-free', modelId: 'openai/gpt-4o-mini', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Ty-Code Free' }
    ]
}));

vi.mock('../services/verified-models', () => ({
    getVerifiedModels: async () => TEST_CATALOG
}));

function sseResponse(body: string): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
        }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchedUrls: string[] = [];

beforeEach(() => {
    providerHealthStore.__forTest(null);
    vi.clearAllMocks();
    routeEventPolicy.__resetForTest();
    __resetTurnRemediation();
    vi.mocked(reliabilityLadder.acquireCooldownRetry).mockResolvedValue(false);
    vi.mocked(reliabilityLadder.onChainExhausted).mockResolvedValue(null);
    vi.mocked(modelCatalogVerifier.healOpenRouterFreeTier).mockResolvedValue({ pruned: 0, admitted: 0 } as never);
    for (const envVar of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        delete process.env[envVar];
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
    fetchedUrls = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown) => {
        const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
        fetchedUrls.push(url);
        if (url.includes('openrouter.ai')) return sseResponse('data: [DONE]\n\n'); // A: empty 200
        return sseResponse(`data: ${JSON.stringify({ choices: [{ delta: { content: 'single good reply' } }] })}\n\ndata: [DONE]\n\n`); // B: content
    });
});

afterEach(() => {
    fetchSpy?.mockRestore();
    providerHealthStore.__forTest(null);
    routeEventPolicy.__resetForTest();
    __resetTurnRemediation();
});

afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('Output Validity Gate — A(empty) -> B(content) contract', () => {
    it('one user turn yields ONE good reply, an A(degenerate)->B(ok) trail, and feeds the health board', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
        const turnId = 'contract-empty-to-ok';
        routeEventPolicy.beginTurn(turnId);

        const text = await sendChatRequest(
            'openrouter', 'openai/gpt-4o-mini',
            [{ role: 'user', content: 'Hey there' }],
            true, undefined, () => undefined, 0, undefined, undefined, undefined, undefined, undefined,
            turnId, 'chat'
        );

        const trail = routeEventPolicy.finishTurn(turnId, 'ty-code-free');

        // 1. Single good reply from the rotated route; never hollow, never duplicated.
        expect(text).toBe('single good reply');
        expect((text.match(/single good reply/g) || []).length).toBe(1);

        // 2. Consolidated trail names A as degenerate and lands on B(ok).
        expect(trail).toMatch(/\[ROUTE\]/);
        expect(trail).toContain('openrouter(degenerate');
        expect(trail).toContain('ty-code-free(ok)');

        // 3. Health board fed a DEGENERATE failure for the empty route A.
        expect(reliabilitySentinel.recordRequestResult).toHaveBeenCalledWith(
            expect.stringContaining('openrouter'),
            expect.any(String),
            false,
            undefined,
            expect.stringContaining('degenerate_output')
        );

        // 4. Structured degenerate_output ledger event for A.
        const degRecords = vi
            .mocked(reliabilityLedger.record)
            .mock.calls
            .map((c) => c[0] as { kind?: string; route?: string; bytes?: number })
            .filter((rec) => rec?.kind === 'degenerate');
        expect(degRecords.length).toBeGreaterThanOrEqual(1);
        expect(degRecords[0].route).toContain('openrouter');
        expect(degRecords[0].bytes).toBe(0);

        // A was dialled first, then B recovered the turn.
        expect(fetchedUrls[0]).toContain('openrouter.ai');
        expect(fetchedUrls.some((u) => u.includes('tycode.example'))).toBe(true);
        // Rotation restored service: the ladder never reached exhaustion.
        expect(reliabilityLadder.onChainExhausted).not.toHaveBeenCalled();
    });
});
