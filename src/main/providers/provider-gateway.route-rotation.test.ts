/**
 * Primary-send sentinel-degraded rotation test (Catalog freshness, amendment 2).
 *
 * When the reliability sentinel marks the baked free default as 'degraded'/
 * 'cooling' (from repeated degenerate output), a FRESH send (handoffCount === 0)
 * must deprioritize that slug and rotate to the first still-healthy free route of
 * the SAME provider — so a retired / rate-limited slug stops being hit first on
 * every message. Handoff hops are already health-filtered by pickHandoffCandidate;
 * this guards only the fresh-send entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: class { },
    app: { isReady: () => true, getPath: (name: string) => `${TMP_ROOT}/${name}`, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => String(v) },
    ipcMain: { handle: () => undefined, on: () => undefined }
}));
vi.mock('../ipc/settings-handlers', () => ({
    readStoredCredentials: async () => ({ keys: {} }),
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
vi.mock('../services/orchestration/quota-tracker', () => ({
    quotaTracker: { getProviderQuota: () => null }
}));
// Sentinel is the subject here: the retired default is unusable, the sibling is
// healthy. Controlled by the shared `unusable` set so the mock factory and the
// assertions observe the same state.
const { h } = vi.hoisted(() => ({
    h: { unusable: new Set<string>() }
}));
vi.mock('../services/reliability/reliability-sentinel', () => ({
    reliabilitySentinel: {
        takeChaosFault: () => null,
        isProviderPoor: () => false,
        isRouteUnusable: (providerId: string, modelId: string) => h.unusable.has(`${providerId}::${modelId}`),
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
    getKey: async () => undefined,
    getCommunityKey: async () => undefined,
    getCommunityKeyCached: () => undefined,
    warmUpCommunityKey: vi.fn(),
    hasCommunityKey: () => false,
    invalidateCommunityKey: vi.fn(),
    emitCommunityKeyStatus: vi.fn(),
    testKey: vi.fn().mockResolvedValue({ valid: false }),
    probeSavedKey: vi.fn().mockResolvedValue({ valid: false }),
    listProvidersWithKeys: () => []
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProviderGateway, sendChatRequest } from './provider-gateway';
import { providerHealthStore } from './provider-health-store';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-rotation');

const DEAD = 'google/dead-gemma:free';
const KEEP = 'google/keep:free';

const { TEST_CATALOG } = vi.hoisted(() => ({
    TEST_CATALOG: [
        { providerId: 'ty-code-free', modelId: 'google/dead-gemma:free', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Retired free default' },
        { providerId: 'ty-code-free', modelId: 'google/keep:free', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Healthy free sibling' }
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
let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;
let requestedModels: string[] = [];

beforeEach(() => {
    providerHealthStore.__forTest(null);
    vi.clearAllMocks();
    h.unusable = new Set();
    requestedModels = [];
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown, init?: unknown) => {
        const body = (init as { body?: string } | undefined)?.body;
        let model = '';
        try { model = String(JSON.parse(body || '{}').model || ''); } catch { /* ignore */ }
        requestedModels.push(model);
        return sseResponse(
            `data: ${JSON.stringify({ choices: [{ delta: { content: `reply from ${model}` } }] })}\n\ndata: [DONE]\n\n`
        );
    });
});

afterEach(() => {
    fetchSpy?.mockRestore();
    consoleSpy?.mockRestore();
    providerHealthStore.__forTest(null);
});

afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function sendFresh() {
    return sendChatRequest(
        'ty-code-free',
        DEAD,
        [{ role: 'user', content: 'hello' }],
        true,
        undefined,
        () => undefined,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'rotation-task',
        'chat'
    );
}

describe('primary-send sentinel-degraded rotation (catalog freshness)', () => {
    it('rotates a fresh send off the sentinel-degraded default onto the healthy free sibling', async () => {
        ProviderGateway.setActiveModel({ providerId: 'ty-code-free', modelId: DEAD, isAutoMode: false });
        h.unusable.add(`ty-code-free::${DEAD}`);

        const text = await sendFresh();

        // The wire actually used the healthy sibling, not the retired default.
        expect(requestedModels).toHaveLength(1);
        expect(requestedModels[0]).toBe(KEEP);
        expect(text).toContain(`reply from ${KEEP}`);
        const logged = consoleSpy?.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n') ?? '';
        expect(logged).toContain(`Free default ${DEAD} is sentinel-degraded`);
    });

    it('leaves the requested route untouched when the default is still healthy', async () => {
        ProviderGateway.setActiveModel({ providerId: 'ty-code-free', modelId: DEAD, isAutoMode: false });
        // No route marked unusable.

        const text = await sendFresh();

        expect(requestedModels).toHaveLength(1);
        expect(requestedModels[0]).toBe(DEAD);
        expect(text).toContain(`reply from ${DEAD}`);
    });

    it('keeps the requested slug when no healthy sibling exists (negative control)', async () => {
        ProviderGateway.setActiveModel({ providerId: 'ty-code-free', modelId: DEAD, isAutoMode: false });
        h.unusable.add(`ty-code-free::${DEAD}`);
        h.unusable.add(`ty-code-free::${KEEP}`);

        const text = await sendFresh();

        // Sibling also degraded → no rotation candidate → sends on the request.
        expect(requestedModels[0]).toBe(DEAD);
        expect(text).toContain(`reply from ${DEAD}`);
    });
});
