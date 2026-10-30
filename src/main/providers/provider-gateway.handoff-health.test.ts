/**
 * Health-aware rotation contract test (Route Truth, Prompt 1 Step 3).
 *
 * Scenario: openrouter and google-ai-studio hold CLASSIFIER-sticky invalid_key
 * entries (401 with an auth-specific body). The failing request must:
 *   1. never re-target a provider with a sticky invalid key (google-ai-studio
 *      holding a known-bad key can never be the handoff target), and
 *   2. land on the healthy keyless route (ty-code-free) FIRST, and
 *   3. COMPLETE (stream through), so the user-visible result is continuity,
 *      and
 *   4. never reach the advisor card (no ladder exhaustion fired).
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// The gateway's import graph pulls Electron-touched modules; the existing
// gateway test suite mocks at these module boundaries.
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
        getDecryptedKey: (providerId: string) => (providerId === 'google-ai-studio' ? 'sk-google-test' : undefined),
        getAllVaultKeys: () => ({}),
        saveCredential: vi.fn().mockResolvedValue(undefined)
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
    listProvidersWithKeys: () => ['openrouter', 'google-ai-studio']
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProviderGateway, sendChatRequest, pickHandoffCandidate } from './provider-gateway';
import { providerHealthStore } from './provider-health-store';
import { reliabilityLadder } from '../services/reliability/remediation-ladder';

const TMP_ROOT = path.join(os.tmpdir(), 'ty-gw-test-hh');

// Hoisted so the module factory below can reference it (vi.mock hoists).
const { TEST_CATALOG } = vi.hoisted(() => ({
    TEST_CATALOG: [
        { providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, name: 'OpenRouter gpt-4o-mini' },
        { providerId: 'openrouter', modelId: 'google/gemma-4-31b-it:free', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true, name: 'OpenRouter gemma free' },
        { providerId: 'google-ai-studio', modelId: 'openai/gpt-4o-mini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', requiresKey: true, name: 'Gemini mirror' },
        { providerId: 'ty-code-free', modelId: 'openai/gpt-4o-mini', url: 'https://team-free.tycode.example/v1/chat/completions', requiresKey: false, name: 'Ty-Code Free' }
    ]
}));

vi.mock('../services/verified-models', () => ({
    getVerifiedModels: async () => TEST_CATALOG
}));

function sseResponse(body: string, init?: { status?: number; headers?: Record<string, string> }): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
        }
    });
    return new Response(stream, {
        status: init?.status ?? 200,
        headers: init?.headers ?? { 'content-type': 'text/event-stream' }
    });
}

// Raw spy handle so tests can inspect the request trail; the mock is mounted
// in beforeEach and restored in afterEach.
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchedUrls: string[] = [];

beforeEach(() => {
    // Fresh sticky board per test; mock call registers cleared too.
    providerHealthStore.__forTest(null);
    vi.clearAllMocks();
    // Re-mount the ladder factory defaults that clearAllMocks may have wiped.
    vi.mocked(reliabilityLadder.acquireCooldownRetry).mockResolvedValue(false);
    vi.mocked(reliabilityLadder.onChainExhausted).mockResolvedValue(null);
    // Environment-injected provider keys would silently satisfy
    // providerHasOwnKey; the test pins the vault state instead.
    for (const envVar of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        delete process.env[envVar];
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_ROOT, 'userData'), { recursive: true });
    fetchedUrls = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown) => {
        const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
        fetchedUrls.push(url);
        if (url.includes('openrouter.ai')) {
            return sseResponse(JSON.stringify({
                error: { code: 'invalid_api_key', message: 'Invalid API key provided for this account.' }
            }), { status: 401 });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
            return sseResponse(JSON.stringify({
                error: { code: 'invalid_api_key', message: 'Invalid API key provided for this account.' }
            }), { status: 401 });
        }
        // ty-code-free: the healthy keyless route streams normally.
        return sseResponse(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello from ty-code-free' } }] })}\n\ndata: [DONE]\n\n`
        );
    });
});

afterEach(() => {
    fetchSpy?.mockRestore();
    providerHealthStore.__forTest(null);
});

afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('health-aware handoff (Prompt 1 Step 3 contract)', () => {
    it('a failing request lands on the healthy keyless route and completes; no advisor card', async () => {
        ProviderGateway.setActiveModel({ providerId: 'openrouter', modelId: 'openai/gpt-4o-mini', isAutoMode: false });
        providerHealthStore.markInvalidKey('google-ai-studio', 401, 'invalid_key');

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
            'contract-task',
            'chat'
        );

        expect(text).toContain('hello from ty-code-free');
        expect(tokens.join('')).toContain('hello from ty-code-free');
        // Never targeted the known-bad keyed route; landed on ty-code-free.
        expect(fetchedUrls).toHaveLength(2);
        expect(fetchedUrls[0]).toContain('openrouter.ai');
        expect(fetchedUrls[1]).toContain('tycode.example');
        // Malformed-after-error handling: openrouter became sticky invalid_key.
        expect(providerHealthStore.getState('openrouter')).toBe('invalid_key');
        expect(providerHealthStore.getState('google-ai-studio')).toBe('invalid_key');
        // Advisor must NOT fire: the request completed, no exhaustion happened.
        expect(reliabilityLadder.onChainExhausted).not.toHaveBeenCalled();
        expect(reliabilityLadder.reportRecoveryOutcome).not.toHaveBeenCalled();
    });

    it('the selector never proposes a sticky invalid_key route (direct sweep)', async () => {
        providerHealthStore.markInvalidKey('openrouter', 401, 'invalid_key');
        providerHealthStore.markInvalidKey('ty-code-free', 403, 'invalid_key');

        const candidate = pickHandoffCandidate(TEST_CATALOG as never, 'fcc-proxy', 'openai/gpt-4o-mini');
        // openrouter AND ty-code-free ('ty-code' normalised) are dead; the only
        // eligible keyed provider is google-ai-studio with its own stored key.
        expect(candidate?.providerId).toBe('google-ai-studio');
    });

    it('the selector prefers keyless healthy routes over keyed ones', async () => {
        providerHealthStore.__forTest(null);

        const candidate = pickHandoffCandidate(TEST_CATALOG as never, 'openrouter', 'openai/gpt-4o-mini');
        // ty-code-free is keyless and healthy; same-model keyed mirrors lose.
        expect(candidate?.providerId).toBe('ty-code-free');
        expect(candidate?.modelId).toBe('openai/gpt-4o-mini');
    });
});
