/**
 * Prompt C Step 4 — Auto-Memory service tests.
 *
 * Covers the deterministic, no-LLM logic (the distillation LLM call is exercised by
 * its own honesty contract separately; here we seed the queue file directly to test
 * the confirmation → correction-memory pipeline without a model route):
 *  - pending() reads the locally-persisted queue;
 *  - approve() writes the (optionally edited) rule into Correction Memory with the
 *    chosen scope and removes it from the queue; project vs global land in different
 *    buckets that listStored() reports with the right scope;
 *  - dismiss() drops a candidate and records its hash so it is never re-proposed;
 *  - update() edits a still-pending candidate in place;
 *  - buildRelevantInjection() embeds global rules with the forced TOKEN provider and
 *    injects only the top-K most relevant to the query (bounded, never empty-fabricated).
 *
 * Global-scope rules persist under a fixed sentinel hash, so afterEach clears that
 * bucket to keep the developer's real `~/.tycode` clean.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoMemoryService, GLOBAL_MEMORY_SCOPE } from './auto-memory-service';
import { MEMORY_DIR } from '../../../shared/types/memory';
import { clearCorrections, closeDatabaseConnections } from '../context-engine/correction-memory';

let tempRoot = '';
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-mem-'));
  fs.mkdirSync(path.join(tempRoot, MEMORY_DIR), { recursive: true });
  // Force the token embedder for relevance selection (Ollama probe fails; no wasm pkg).
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test');
  }) as unknown as typeof globalThis.fetch;
});

async function purgeWithRetry(bucket: string): Promise<void> {
  // Windows intermittently locks the atomic-rename target (AV/indexer); retry briefly.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await clearCorrections(bucket);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  // Purge both buckets written under real `~/.tycode`: the fixed global hash and this
  // run's temp-workspace project hash, so tests never leak into the developer's memory.
  await purgeWithRetry(GLOBAL_MEMORY_SCOPE);
  await purgeWithRetry(tempRoot);
  closeDatabaseConnections();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function seedQueue(candidates: Array<{ id: string; title: string; rule: string; category: string; scope: string }>): void {
  const queue = { v: 1, candidates, dismissed: [] };
  fs.writeFileSync(path.join(tempRoot, MEMORY_DIR, 'pending.json'), JSON.stringify(queue, null, 2), 'utf-8');
}

const CAND = {
  id: 'mem_1',
  title: 'Use pnpm',
  rule: 'ALWAYS prefer pnpm over npm for installs.',
  category: 'stack',
  scope: 'project',
  rationale: 'User corrected the agent twice.',
  taskSlug: 'install-deps',
  createdAt: Date.now()
};

describe('autoMemoryService queue + approval', () => {
  it('reads a seeded pending queue', async () => {
    seedQueue([CAND]);
    const pending = await autoMemoryService.pending(tempRoot);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('mem_1');
  });

  it('approves into project correction memory with an edit, then clears the queue', async () => {
    seedQueue([CAND]);
    const res = await autoMemoryService.approve(tempRoot, 'mem_1', 'project', 'ALWAYS use pnpm.');
    expect(res.ok).toBe(true);
    expect(await autoMemoryService.pending(tempRoot)).toHaveLength(0);

    const stored = await autoMemoryService.listStored(tempRoot);
    expect(stored.some((m) => m.scope === 'project' && m.rule.includes('pnpm'))).toBe(true);
  });

  it('routes a global approval into the shared scope bucket', async () => {
    seedQueue([{ ...CAND, scope: 'global' }]);
    const res = await autoMemoryService.approve(tempRoot, 'mem_1', 'global');
    expect(res.ok).toBe(true);

    const stored = await autoMemoryService.listStored(tempRoot);
    const globalHit = stored.find((m) => m.scope === 'global');
    expect(globalHit).toBeDefined();
    expect(globalHit!.rule).toContain('pnpm');
  });

  it('dismisses a candidate and records its hash', async () => {
    seedQueue([CAND]);
    const ok = await autoMemoryService.dismiss(tempRoot, 'mem_1');
    expect(ok).toBe(true);
    expect(await autoMemoryService.pending(tempRoot)).toHaveLength(0);
    const queue = JSON.parse(fs.readFileSync(path.join(tempRoot, MEMORY_DIR, 'pending.json'), 'utf-8'));
    expect(queue.dismissed.length).toBeGreaterThan(0);
  });

  it('updates a pending candidate in place', async () => {
    seedQueue([CAND]);
    const updated = await autoMemoryService.update(tempRoot, 'mem_1', { rule: 'NEVER use npm.', scope: 'global' });
    expect(updated?.rule).toBe('NEVER use npm.');
    expect(updated?.scope).toBe('global');
  });
});

describe('autoMemoryService relevance injection', () => {
  it('injects the most-relevant global rule for a matching query, bounded', async () => {
    seedQueue([{ ...CAND, scope: 'global' }]);
    await autoMemoryService.approve(tempRoot, 'mem_1', 'global');

    const block = await autoMemoryService.buildRelevantInjection('which package manager should I use pnpm or npm for installs', 5);
    expect(block).toContain('GLOBAL LEARNED PREFERENCES');
    expect(block).toContain('pnpm');
  });

  it('returns an empty block when there are no global memories', async () => {
    const block = await autoMemoryService.buildRelevantInjection('anything', 5);
    expect(block).toBe('');
  });
});
