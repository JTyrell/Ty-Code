/**
 * Stage 5d — explicit first-token/idle watchdog contract test.
 *
 * Scenario: the primary route (openrouter) returns a 200 SSE response whose body
 * opens but NEVER delivers a token (a stalled-but-open stream). Without the
 * watchdog this request idles until the hard `AbortSignal.timeout(120_000)`.
 * With the watchdog (TYCODE_FIRST_TOKEN_TIMEOUT_MS) it aborts at the timeout,
 * which flows into the router's existing failover path and hands off to the
 * healthy keyless route (ty-code-free), which streams to completion.
 *
 * Asserts:
 *   1. `[GATEWAY] Watchdog abort: first_token_timeout` is logged, and
 *   2. the request handoffs and completes on the fallback provider, and
 *   3. the whole thing resolves in well under the 120s hard timeout.
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
        getCooldownRemainingSec: () => 0,
        getHealthSnapshot: () => ({ version: 1, updatedAt: 0, routes: [] })
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

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-watchdog');

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

// A stalled SSE body: opens (200) but never enqueues a token. Mirrors real fetch
// semantics where aborting the request signal errors the response body — the
// watchdog's abort is bound to the SAME signal handed to fetch, so erroring the
// controller here is what unblocks the pending reader.read().
function stalledResponse(signal?: AbortSignal): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            if (signal && !signal.aborted) {
                signal.addEventListener('abort', () => {
                    controller.error(new Error('[gateway-watchdog] first_token_timeout'));
                }, { once: true });
            }
            // no enqueue, no close → the reader blocks until the signal aborts
        }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchedUrls: string[] = [];

beforeEach(() => {
    providerHealthStore.__forTest(null);
    vi.clearAllMocks();
    vi.mocked(reliabilityLadder.acquireCooldownRetry).mockResolvedValue(false);
    vi.mocked(reliabilityLadder.onChainExhausted).mockResolvedValue(null);
    for (const envVar of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        delete process.env[envVar];
    }
    // Mandatory watchdog defaults are 30s/10s; shrink the first-token budget so
    // the stalled route aborts fast and the test proves the abort path, not the
    // 120s hard timeout.
    process.env.TYCODE_FIRST_TOKEN_TIMEOUT_MS = '200';
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
    fetchedUrls = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown, init?: unknown) => {
        const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
        fetchedUrls.push(url);
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        if (url.includes('openrouter.ai')) {
            // Primary route: 200 but silent forever → watchdog aborts.
            return stalledResponse(signal);
        }
        // ty-code-free: the healthy keyless fallback streams to completion.
        return sseResponse(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'recovered from watchdog' } }] })}\n\ndata: [DONE]\n\n`
        );
    });
});

afterEach(() => {
    fetchSpy?.mockRestore();
    consoleSpy?.mockRestore();
    providerHealthStore.__forTest(null);
    delete process.env.TYCODE_FIRST_TOKEN_TIMEOUT_MS;
});

afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('Stage 5d first-token watchdog (stalled stream)', () => {
    it('aborts a stalled-but-open stream at the timeout and hands off to the healthy route', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });

        const startedAt = Date.now();
        const tokens: string[] = [];
        const text = await sendChatRequest(
            'openrouter',
            'openai/gpt-4o-mini',
            [{ role: 'user', content: 'hello' }],
            true,
            undefined,
            (chunk) => tokens.push(chunk),
            0,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'watchdog-task',
            'chat'
        );
        const elapsed = Date.now() - startedAt;

        // The watchdog fired and logged the abort reason.
        const logged = consoleSpy?.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n') ?? '';
        expect(logged).toContain('[GATEWAY] Watchdog abort: first_token_timeout');

        // Handoff completed on the fallback provider.
        expect(text).toContain('recovered from watchdog');
        expect(tokens.join('')).toContain('recovered from watchdog');

        // Primary stalled route was dialled, then the healthy fallback.
        expect(fetchedUrls[0]).toContain('openrouter.ai');
        expect(fetchedUrls.some((u) => u.includes('tycode.example'))).toBe(true);

        // The abort path resolved far faster than the 120s hard timeout.
        expect(elapsed).toBeLessThan(5_000);
    }, 15_000);
});
