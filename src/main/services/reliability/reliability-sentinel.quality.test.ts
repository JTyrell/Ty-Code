/**
 * Health Board Quality Signals (Output Validity Gate, Step 3).
 *
 * Proves that DEGENERATE output is a first-class failure that drives health:
 *  - Step 3.2: a route whose degenerate rate exceeds 30% over the last 10
 *    attempts is marked 'degraded' and is therefore unusable (deprioritized in
 *    chain order via isRouteUnusable), even though every call returned HTTP 200.
 *  - A healthy stream (ok results) does NOT trip the degenerate rule.
 *
 * Only the pure stats machine is exercised; all I/O collaborators are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../verified-models', () => ({ getVerifiedModels: async () => [] }));
vi.mock('../fcc-sidecar-manager', () => ({ fccSidecarManager: { isActive: () => false, getBaseUrl: () => '' } }));
vi.mock('../credential-vault', () => ({
  getCommunityKeyCached: () => null,
  listProvidersWithKeys: () => [],
  probeSavedKey: vi.fn().mockResolvedValue({ valid: true })
}));
vi.mock('../../providers/provider-health-store', () => ({
  providerHealthStore: { markRateLimited: vi.fn(), clear: vi.fn(), isDead: () => false }
}));
vi.mock('../providers/health-monitor', () => ({
  providerHealthMonitor: { recordRequestOutcome: vi.fn() }
}));
vi.mock('../../providers/provider-gateway', () => ({
  chatLatencyTracker: { isActive: () => false, getActiveTaskId: () => undefined }
}));
vi.mock('./reliability-ledger', () => ({ reliabilityLedger: { record: vi.fn() } }));
vi.mock('../../providers/error-classifier', () => ({
  classifyProviderFailure: () => ({ failureClass: 'upstream_5xx' })
}));
vi.mock('./bus', () => ({ broadcastReliability: vi.fn(), isPackagedBuild: () => false }));

import { reliabilitySentinel } from './reliability-sentinel';

describe('reliability sentinel — quality signals (Step 3)', () => {
  beforeEach(() => {
    reliabilitySentinel.__resetForTest();
  });

  it('marks a route degraded once its degenerate rate exceeds 30% over the window', () => {
    // 4 of 6 attempts degenerate (HTTP 200 hollow) = 66% > 30%.
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', true);
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', false, undefined, 'degenerate_output:empty_content');
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', false, undefined, 'degenerate_output:zero_data_events');
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', false, undefined, 'degenerate_output:error_in_200');
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', true);
    reliabilitySentinel.recordRequestResult('openrouter', 'glm:free', false, undefined, 'degenerate_output:empty_content');

    expect(reliabilitySentinel.getRouteStatus('openrouter', 'glm:free')).toBe('degraded');
    expect(reliabilitySentinel.isRouteUnusable('openrouter', 'glm:free')).toBe(true);
  });

  it('a healthy route (no degenerates) is not degraded by the rate rule', () => {
    for (let i = 0; i < 6; i++) {
      reliabilitySentinel.recordRequestResult('groq', 'llama:free', true);
    }
    // Well within the degenerate threshold (zero degenerates).
    expect(reliabilitySentinel.getRouteStatus('groq', 'llama:free')).not.toBe('degraded');
  });

  it('a low degenerate rate (<= 30%) with a high success rate is not degraded', () => {
    // 9 ok + 1 degenerate = 10% degenerate (<= 30%) and 90% success (>= 85%).
    for (let i = 0; i < 10; i++) {
      if (i === 4) {
        reliabilitySentinel.recordRequestResult('mistral', 'm:free', false, undefined, 'degenerate_output:empty_content');
      } else {
        reliabilitySentinel.recordRequestResult('mistral', 'm:free', true);
      }
    }
    expect(reliabilitySentinel.getRouteStatus('mistral', 'm:free')).not.toBe('degraded');
  });
});
