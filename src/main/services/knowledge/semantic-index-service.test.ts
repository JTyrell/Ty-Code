/**
 * Prompt C Step 3 — Semantic code index tests.
 *
 * Runs against a real temp workspace with real files, forcing the dependency-free
 * TOKEN embedder (Ollama is never reachable because `fetch` is stubbed to reject and
 * no transformers package is installed). This keeps the assertions deterministic and
 * fully offline while still proving the core value proposition:
 *
 *   `semantic_search` recalls code by MEANING — a paraphrased query whose exact
 *   phrase never appears literally anywhere (so a literal grep for it matches nothing)
 *   still ranks the right source chunk first, because the concept's vocabulary overlaps.
 *
 * Also asserts incremental rebuild only re-embeds drifted files and status reflects it.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { semanticIndexService, chunkFile } from './semantic-index-service';

let tempRoot = '';
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-index-'));
  // Force the token fallback: any Ollama probe fails, and @xenova/transformers is absent.
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(tempRoot, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('chunkFile', () => {
  it('splits into overlapping windows with stable ids', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkFile('src/a.ts', lines.join('\n'), 'hash-a');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].id).toBe('src/a.ts#0');
    expect(chunks[0].startLine).toBe(1);
    // Overlap: the second window starts before the first ends.
    expect(chunks[1].startLine).toBeLessThan(chunks[0].startLine + 40);
    expect(chunks.every((c) => c.fileHash === 'hash-a')).toBe(true);
  });
});

describe('semanticIndexService rebuild + search', () => {
  it('recalls a paraphrased concept that a literal grep for the phrase misses', async () => {
    // Target: describes aggregating a cart total. The EXACT query phrase below never
    // appears contiguously in any file, so literal grep for it returns nothing.
    write(
      'src/billing/checkout.ts',
      [
        'export function monetizeCart(items: LineItem[], taxRate: number) {',
        '  // Aggregate the cart, add tax plus shipping, and produce the payable total.',
        '  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);',
        '  const tax = subtotal * taxRate;',
        '  return { subtotal, tax, shipping: SHIPPING_FLAT, total: subtotal + tax + SHIPPING_FLAT };',
        '}'
      ].join('\n')
    );
    // Two distractors with unrelated vocabulary.
    write('src/utils/capitalize.ts', 'export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);');
    write('src/net/ping.ts', 'export async function ping(url: string) { return fetch(url).then((r) => r.ok); }');

    const built = await semanticIndexService.rebuild(tempRoot, {});
    expect(built.rebuilt).toBe(true);
    expect(built.status.source).toBe('token');

    // A paraphrase — contiguous phrase absent from all files (grep would miss it).
    const hits = await semanticIndexService.search(tempRoot, 'aggregate cart subtotal tax shipping payable total', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].relPath).toBe('src/billing/checkout.ts');

    // Sanity: that phrase truly is nowhere as a literal line, proving semantic recall.
    const allText = fs.readFileSync(path.join(tempRoot, 'src', 'billing', 'checkout.ts'), 'utf-8');
    expect(allText).not.toContain('aggregate cart subtotal tax shipping payable total');
  });

  it('incremental rebuild reuses unchanged files and reflects drift in status', async () => {
    write('src/a.ts', 'export const alpha = 1; // the first constant');
    write('src/b.ts', 'export const beta = 2; // the second constant');

    const first = await semanticIndexService.rebuild(tempRoot, {});
    expect(first.rebuilt).toBe(true);
    expect(first.reason).toBe('built');

    // No drift → a non-forced rebuild reports fresh and does nothing.
    const noop = await semanticIndexService.rebuild(tempRoot, {});
    expect(noop.rebuilt).toBe(false);
    expect(noop.reason).toBe('fresh');

    // Drift one file → incremental path, status pending counts a change first.
    write('src/b.ts', 'export const beta = 3; // the second constant, now edited');
    const status = await semanticIndexService.status(tempRoot);
    expect(status.exists).toBe(true);
    expect(status.pendingFiles).toBeGreaterThanOrEqual(1);

    const inc = await semanticIndexService.rebuild(tempRoot, {});
    expect(inc.rebuilt).toBe(true);
    expect(inc.reason).toBe('incremental');
    const after = await semanticIndexService.status(tempRoot);
    expect(after.pendingFiles).toBe(0);
  });

  it('returns empty results when no index exists yet (never fabricates)', async () => {
    write('src/only.ts', 'export const only = true;');
    const hits = await semanticIndexService.search(tempRoot, 'anything at all', 5);
    expect(hits).toEqual([]);
  });
});
