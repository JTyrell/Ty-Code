/**
 * Provider & Model Catalog self-healing contract tests.
 *
 * Guards the fix for the incident where the baked `ty-code-free` (OpenRouter)
 * catalog silently rotted: a default model was retired upstream and the app
 * kept referencing it, so chat returned a blank bubble with no error.
 *
 * Coverage:
 *  - verifyOpenRouterFreeTier: prunes retired slugs, admits newly-available
 *    `:free` slugs ONLY from trusted publishers, never non-free slugs, and
 *    degrades to a non-mutating FAIL when the public /models call errors.
 *  - healOpenRouterFreeTier: applies the diff through the existing corrections
 *    pipeline AND repoints the active lock off a retired default (s2 guard),
 *    while staying non-destructive to keyed/connected providers.
 *
 * Everything here is real reconcile logic; only the network + disk boundaries
 * and the heavy gateway import graph are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared, hoisted mock state so the vi.mock factories (which run before the
// test body) can read/write the same objects the assertions observe.
const h = vi.hoisted(() => ({
  baked: {} as Record<string, Array<{ modelId: string; name: string; url: string; requiresKey: boolean; providerId: string }>>,
  models: [] as Array<{ modelId: string; providerId: string }>,
  setCalls: [] as Array<Record<string, { added: unknown[]; removed: string[]; renamed: unknown[] }>>,
  lock: null as null | { providerId: string; modelId: string; mode: string },
  lockCalls: [] as Array<{ providerId?: string; modelId?: string; mode?: string }>,
  corrections: {} as Record<string, { added: unknown[]; removed: string[]; renamed: unknown[] }>
}));

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/tmp/catalog-verify-test/${name}`, isReady: () => true, isPackaged: false }
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => { throw new Error('no persisted state'); })
}));
// Neutralise the heavy import graph the verifier shares with the gateway.
vi.mock('../../providers/provider-gateway', () => ({
  ProviderGateway: { listModels: vi.fn(async () => []), getActiveModel: () => ({}) }
}));
vi.mock('../auth/credential-store', () => ({
  credentialStore: { getDecryptedKey: () => undefined, getAllVaultKeys: () => ({}) }
}));
vi.mock('../fcc/catalog-sync', () => ({
  fccCatalogSync: { getDiscoveredModels: () => [], getCandidateProviders: () => [] }
}));
vi.mock('../../config/provider-registry', () => ({
  getAllPreconfiguredProviders: () => []
}));
// Verified-models database: controlled baked expectations + recorded corrections.
vi.mock('../verified-models', () => ({
  exportBakedExpectations: () => h.baked,
  setModelCatalogCorrections: (next: Record<string, { added: unknown[]; removed: string[]; renamed: unknown[] }>) => {
    h.corrections = next || {};
    h.setCalls.push(next || {});
  },
  getModelCatalogCorrections: () => h.corrections,
  getVerifiedModels: async () => h.models
}));
// Active model lock: record repoint calls, feed a controllable current lock.
vi.mock('../../providers/active-model-lock', () => ({
  getModelLock: () => h.lock,
  lockActiveModel: (cfg: { providerId?: string; modelId?: string; mode?: string }) => {
    h.lockCalls.push(cfg);
    return { changed: true };
  }
}));

import { modelCatalogVerifier } from './catalog-verifier';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

function freeEntry(modelId: string) {
  return { modelId, name: modelId, url: CHAT_URL, requiresKey: false, providerId: 'ty-code-free' };
}

function stubOpenRouterModels(ids: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: ids.map((id) => ({ id, name: id })) }),
      text: async () => ''
    }))
  );
}

beforeEach(() => {
  h.baked = {};
  h.models = [];
  h.setCalls = [];
  h.lock = null;
  h.lockCalls = [];
  h.corrections = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog-verifier.verifyOpenRouterFreeTier (self-heal reconcile)', () => {
  it('prunes a baked slug no longer on the live catalog', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/dead-gemma:free'), freeEntry('google/keep:free')] };
    stubOpenRouterModels(['google/keep:free']);

    const result = await modelCatalogVerifier.verifyOpenRouterFreeTier();

    expect(result.status).toBe('PASS');
    expect(result.providerId).toBe('ty-code-free');
    expect(result.removedModelIds).toContain('google/dead-gemma:free');
    expect(result.removedModelIds).not.toContain('google/keep:free');
    expect(result.corrected).toBe(true);
  });

  it('admits a newly-available :free slug from a trusted publisher only', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/keep:free')] };
    stubOpenRouterModels([
      'google/keep:free',
      'openai/fresh-reasoning:free',
      'sketchy-co/unknown-model:free',
      'anthropic/claude-paid-flagship'
    ]);

    const result = await modelCatalogVerifier.verifyOpenRouterFreeTier();

    const addedIds = result.addedModels.map((m) => m.modelId);
    expect(addedIds).toContain('openai/fresh-reasoning:free');
    // Untrusted publisher is never auto-admitted into the agentic rotation.
    expect(addedIds).not.toContain('sketchy-co/unknown-model:free');
    // Non-free slug is never auto-admitted.
    expect(addedIds).not.toContain('anthropic/claude-paid-flagship');
  });

  it('reports FAIL without mutating when the public listing errors', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/keep:free')] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'upstream down', json: async () => ({}) })));

    const result = await modelCatalogVerifier.verifyOpenRouterFreeTier();

    expect(result.status).toBe('FAIL');
    expect(result.error).toBeTruthy();
    expect(result.removedModelIds).toEqual([]);
    expect(result.addedModels).toEqual([]);
  });
});

describe('catalog-verifier.healOpenRouterFreeTier (apply + default repoint)', () => {
  it('routes the retired default through corrections and repoints the lock', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/dead-gemma:free'), freeEntry('google/keep:free')] };
    // Live catalog no longer serves the retired default.
    stubOpenRouterModels(['google/keep:free']);
    // Active lock still points at the dead slug.
    h.lock = { providerId: 'ty-code-free', modelId: 'google/dead-gemma:free', mode: 'resilient' };
    // Healthy free catalog the repoint guard reads via getVerifiedModels().
    h.models = [{ modelId: 'google/keep:free', providerId: 'ty-code-free' }];

    await modelCatalogVerifier.healOpenRouterFreeTier();

    const correction = h.corrections['ty-code-free'];
    expect(correction).toBeTruthy();
    expect(correction.removed).toContain('google/dead-gemma:free');
    expect(h.lockCalls.length).toBe(1);
    expect(h.lockCalls[0].modelId).toBe('google/keep:free');
    expect(h.lockCalls[0].providerId).toBe('ty-code-free');
  });

  it('leaves a connected (keyed) provider lock untouched', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/dead-gemma:free'), freeEntry('google/keep:free')] };
    stubOpenRouterModels(['google/keep:free']);
    // Lock sits on a non-free provider: heal must NOT repoint it.
    h.lock = { providerId: 'openai', modelId: 'gpt-something', mode: 'manual' };
    h.models = [{ modelId: 'google/keep:free', providerId: 'ty-code-free' }];

    await modelCatalogVerifier.healOpenRouterFreeTier();

    expect(h.lockCalls.length).toBe(0);
  });

  it('does not repoint when the locked model is still healthy', async () => {
    h.baked = { 'ty-code-free': [freeEntry('google/keep:free')] };
    stubOpenRouterModels(['google/keep:free', 'google/keep:free']);
    h.lock = { providerId: 'ty-code-free', modelId: 'google/keep:free', mode: 'resilient' };
    h.models = [{ modelId: 'google/keep:free', providerId: 'ty-code-free' }];

    await modelCatalogVerifier.healOpenRouterFreeTier();

    expect(h.lockCalls.length).toBe(0);
  });
});
