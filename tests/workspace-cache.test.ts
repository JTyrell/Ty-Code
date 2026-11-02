import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  WorkspaceCacheService,
  workspaceCache,
  workspaceCacheKey,
  normalizeWorkspaceRoot,
  WORKSPACE_CACHE_TTL_MS
} from '../src/main/services/workspace-cache-service';

/**
 * Stage 6e — Workspace cache invalidation tests.
 *
 * Covers every invalidation scenario the plan requires for the shared
 * `WorkspaceCacheService` (6b) that both the Omni-Debugger (workspace profile)
 * and the M3E Canvas (design prompt) rely on:
 *  - hit within TTL / miss after TTL expiry
 *  - invalidation on `workspace:changed` (session-bus hook)
 *  - invalidation on a file-watcher event for monitored files
 *  - a disposable invalidation subscription
 *  - concurrent compute deduplication
 *  - Debugger + Canvas observing ONE shared instance (same key → same value)
 *
 * Pure Node module (only `node:path`), so it runs with no Electron/network.
 */

describe('WorkspaceCacheService (Stage 6b/6e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    workspaceCache.clear();
  });

  it('hits the cache on the second call within TTL (computes once)', async () => {
    const svc = new WorkspaceCacheService();
    let calls = 0;
    const compute = async () => ++calls;

    const first = await svc.getOrCompute('k', WORKSPACE_CACHE_TTL_MS, compute);
    const second = await svc.getOrCompute('k', WORKSPACE_CACHE_TTL_MS, compute);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
  });

  it('misses after the TTL expires and recomputes', async () => {
    const svc = new WorkspaceCacheService();
    let calls = 0;
    const compute = async () => ++calls;

    expect(await svc.getOrCompute('k', 1000, compute)).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(await svc.getOrCompute('k', 1000, compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it('invalidates the whole root namespace on workspace:changed', async () => {
    const svc = new WorkspaceCacheService();
    const root = 'C:\\repo\\alpha';
    const key = workspaceCacheKey(root, 'workspace-profile');
    let calls = 0;
    await svc.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => ++calls);

    let invalidations = 0;
    svc.subscribeToInvalidation(`${normalizeWorkspaceRoot(root)}:`, () => {
      invalidations++;
    });

    svc.handleWorkspaceChanged(root);
    expect(svc.size).toBe(0);

    await svc.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => ++calls);
    expect(calls).toBe(2);
    expect(invalidations).toBe(1);
  });

  it('invalidates on a file-watcher event for a monitored file', async () => {
    const svc = new WorkspaceCacheService();
    const root = '/repo/beta';
    const key = workspaceCacheKey(root, 'canvas-design-prompt');
    let calls = 0;
    await svc.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => ++calls);

    svc.handleFileEvent(root, 'src/App.tsx');

    await svc.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => ++calls);
    expect(calls).toBe(2);
    expect(svc.size).toBe(1);
  });

  it('does not notify non-matching subscribers and disposes cleanly', async () => {
    const svc = new WorkspaceCacheService();
    await svc.getOrCompute('alpha:profile', WORKSPACE_CACHE_TTL_MS, async () => 1);

    let alphaHits = 0;
    let betaHits = 0;
    const dispose = svc.subscribeToInvalidation('alpha:', () => {
      alphaHits++;
    });
    svc.subscribeToInvalidation('beta:', () => {
      betaHits++;
    });

    svc.invalidate('alpha:profile');
    expect(alphaHits).toBe(1);
    expect(betaHits).toBe(0);

    dispose();
    await svc.getOrCompute('alpha:profile', WORKSPACE_CACHE_TTL_MS, async () => 2);
    svc.invalidate('alpha:profile');
    expect(alphaHits).toBe(1); // disposed → no further notifications
  });

  it('deduplicates concurrent computations for the same key', async () => {
    const svc = new WorkspaceCacheService();
    let calls = 0;
    let release!: (value: number) => void;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });
    const compute = async () => {
      calls++;
      return gate;
    };

    const p1 = svc.getOrCompute('k', WORKSPACE_CACHE_TTL_MS, compute);
    const p2 = svc.getOrCompute('k', WORKSPACE_CACHE_TTL_MS, compute);
    release(42);

    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(calls).toBe(1);
  });

  it('shares one cache instance between surfaces (same key → same value)', async () => {
    const root = '/shared/repo';
    const key = workspaceCacheKey(root, 'workspace-profile');
    let calls = 0;
    const compute = async () => {
      calls++;
      return { marker: 'shared-profile' };
    };

    // Debugger pass and Canvas pass hit the SAME singleton with the SAME key.
    const fromDebugger = await workspaceCache.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, compute);
    const fromCanvas = await workspaceCache.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, compute);

    expect(fromCanvas).toBe(fromDebugger);
    expect(calls).toBe(1);
  });
});
