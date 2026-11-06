/**
 * DEGENERATE-turn contract test (stuck "Thinking…" / blank-bubble fix).
 *
 * Root cause: an HTTP 200 SSE stream that closes with 0 content, 0 reasoning and
 * 0 tool calls is a DEGENERATE turn — NOT a valid empty answer. Previously the
 * gateway only failed over when ANOTHER provider existed, so a lone free route
 * returned '' and the renderer froze on a blank "Thinking…" bubble with no error.
 *
 * Now the empty-200 branch is a validity gate: it (1) records a structured
 * `degenerate_output` ledger event, (2) feeds the sentinel so repeated
 * degenerates mark the route degraded, (3) triggers the free-tier catalog heal,
 * and (4) ALWAYS throws into the existing handoff → remediation-ladder chain.
 *
 * Asserts:
 *   1. empty-200 on the primary route rotates to a healthy route and completes,
 *      with the degenerate ledger event + sentinel failure recorded;
 *   2. negative control — a valid stream never trips the gate (no degenerate
 *      record, no rotation, one route dialled);
 *   3. exhaustion — when every route is degenerate the request REJECTS (the
 *      ladder + agent produce an error card) instead of resolving to '' blank.
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
import { reliabilityLadder } from '../services/reliability/remediation-ladder';
import { reliabilityLedger } from '../services/reliability/reliability-ledger';
import { reliabilitySentinel } from '../services/reliability/reliability-sentinel';
import { modelCatalogVerifier } from '../services/providers/catalog-verifier';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-degenerate');

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

// An HTTP 200 SSE stream that opens and closes cleanly but delivers NOTHING —
// the exact degenerate shape that used to freeze the renderer on a blank bubble.
function emptyStreamResponse(): Response {
    return sseResponse('data: [DONE]\n\n');
}

function contentStreamResponse(text: string): Response {
    return sseResponse(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    );
}

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchedUrls: string[] = [];

function setRouteBehavior(behaviors: Record<string, 'empty' | 'content'>) {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown) => {
        const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
        fetchedUrls.push(url);
        const kind = url.includes('openrouter.ai') ? behaviors.openrouter : behaviors['ty-code-free'];
        if (kind === 'empty') return emptyStreamResponse();
        return contentStreamResponse(url.includes('tycode.example') ? 'recovered on healthy route' : 'primary reply');
    });
}

beforeEach(() => {
    providerHealthStore.__forTest(null);
    vi.clearAllMocks();
    vi.mocked(reliabilityLadder.acquireCooldownRetry).mockResolvedValue(false);
    vi.mocked(reliabilityLadder.onChainExhausted).mockResolvedValue(null);
    vi.mocked(modelCatalogVerifier.healOpenRouterFreeTier).mockResolvedValue({ pruned: 0, admitted: 0 } as never);
    for (const envVar of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        delete process.env[envVar];
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
    fetchedUrls = [];
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
        taskId,
        'chat'
    );
}

function degenerateLedgerRecords() {
    return vi
        .mocked(reliabilityLedger.record)
        .mock.calls
        .map((c) => c[0] as { kind?: string; route?: string; bytes?: number; finishReason?: string })
        .filter((rec) => rec?.kind === 'degenerate');
}

describe('DEGENERATE-turn validity gate', () => {
    it('empty-200 on the primary route rotates to the healthy route and records the degenerate event', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
        setRouteBehavior({ openrouter: 'empty', 'ty-code-free': 'content' });

        const text = await callSend('degenerate-rotate-task');

        // Continuity: the turn completes on the healthy fallback, not blank.
        expect(text).toContain('recovered on healthy route');
        // Primary empty route dialled first, then healthy fallback.
        expect(fetchedUrls[0]).toContain('openrouter.ai');
        expect(fetchedUrls.some((u) => u.includes('tycode.example'))).toBe(true);

        // Structured degenerate_output ledger event emitted for the dead route.
        const recs = degenerateLedgerRecords();
        expect(recs.length).toBeGreaterThanOrEqual(1);
        expect(recs[0].route).toContain('openrouter');
        expect(recs[0].bytes).toBe(0);

        // Sentinel fed a failure so repeated degenerates degrade the route.
        // The error tag is reason-tagged (degenerate_output:<reason>).
        expect(reliabilitySentinel.recordRequestResult).toHaveBeenCalledWith(
            expect.stringContaining('openrouter'),
            expect.any(String),
            false,
            undefined,
            expect.stringContaining('degenerate_output')
        );

        // Free-tier catalog self-heal triggered off the openrouter degenerate.
        // (fire-and-forget dynamic import → flush pending micro/macrotasks).
        await new Promise((r) => setImmediate(r));
        expect(modelCatalogVerifier.healOpenRouterFreeTier).toHaveBeenCalled();

        // Rotation restored service: the ladder never reached exhaustion.
        expect(reliabilityLadder.onChainExhausted).not.toHaveBeenCalled();
    });

    it('negative control: a valid stream never trips the degenerate gate', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
        setRouteBehavior({ openrouter: 'content', 'ty-code-free': 'content' });

        const text = await callSend('degenerate-valid-task');

        expect(text).toContain('primary reply');
        // Single route dialled; no rotation.
        expect(fetchedUrls).toHaveLength(1);
        expect(fetchedUrls[0]).toContain('openrouter.ai');
        // No degenerate ledger event, no sentinel failure, no heal.
        expect(degenerateLedgerRecords()).toHaveLength(0);
        expect(reliabilitySentinel.recordRequestResult).not.toHaveBeenCalled();
        expect(modelCatalogVerifier.healOpenRouterFreeTier).not.toHaveBeenCalled();
    });

    it('exhaustion: when every route is degenerate the request rejects (no blank resolve)', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
        setRouteBehavior({ openrouter: 'empty', 'ty-code-free': 'empty' });

        // The pre-fix bug resolved to '' (blank bubble). Now the throw feeds the
        // ladder and, on exhaustion, REJECTS so the agent renders an error card.
        await expect(callSend('degenerate-exhaust-task')).rejects.toThrow();

        // Every degenerate route recorded before the final throw.
        expect(degenerateLedgerRecords().length).toBeGreaterThanOrEqual(1);
    });
});
