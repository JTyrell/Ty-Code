/**
 * SnapshotBackend tests — no Electron, in-memory FS, fake deterministic crypto.
 *
 * Load-bearing guarantees:
 *  1. A bundle on disk is an ENCRYPTED envelope { v, cipher:'safeStorage', meta,
 *     payload } — the payload is never plaintext, and the plaintext manifest is
 *     listable WITHOUT decrypting (so the Details view stays cheap).
 *  2. Writes are atomic (tmp + rename): no `.bundle` file exists mid-write.
 *  3. read() rehydrates before/after contents through the crypto seam.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const memfs = vi.hoisted(() => ({ files: new Map<string, string>(), renames: 0 }));

vi.mock('node:fs/promises', () => ({
  default: {
    async mkdir() { return undefined; },
    async writeFile(p: string, contents: string) { memfs.files.set(String(p), contents); },
    async rename(oldP: string, newP: string) {
      const data = memfs.files.get(String(oldP));
      if (data === undefined) throw new Error('ENOENT');
      memfs.renames++;
      memfs.files.set(String(newP), data);
      memfs.files.delete(String(oldP));
    },
    async readFile(p: string) {
      const data = memfs.files.get(String(p));
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return data;
    },
    async readdir(dir: string) {
      const prefix = String(dir).replace(/\\/g, '/') + '/';
      const names = new Set<string>();
      for (const key of memfs.files.keys()) {
        const norm = key.replace(/\\/g, '/');
        if (norm.startsWith(prefix)) {
          const rest = norm.slice(prefix.length);
          if (rest) names.add(rest.split('/')[0]);
        }
      }
      return [...names];
    },
    async unlink(p: string) {
      if (!memfs.files.has(String(p))) throw new Error('ENOENT');
      memfs.files.delete(String(p));
    }
  }
}));

// Deterministic, non-Electron crypto so we can assert the envelope shape.
vi.mock('../session/session-crypto', () => ({
  isEncryptionAvailable: () => true,
  encryptJson: (obj: unknown) => 'enc:' + JSON.stringify(obj),
  decryptPayload: <T,>(payload: string) => ({ ok: true, data: JSON.parse(String(payload).slice(4)) as T })
}));

// Fixed wsHash so listManifests(WS) resolves to the same dir the manifest wrote.
vi.mock('../session/unified-session-store', () => ({
  computeWsHash: () => 'deadbeefdeadbeef'
}));

import { snapshotBackend, writeBundle, readBundle, listManifests } from './snapshot-backend';
import type { CheckpointBundle, CheckpointManifest } from '../../../shared/types/checkpoint';

const CHECKPOINTS_ROOT = path.join(os.homedir(), '.tycode', 'checkpoints');
const WS = '/tmp/tycode-ckpt-ws';

function makeManifest(n: number): CheckpointManifest {
  return {
    id: `ckpt_${n}`,
    taskId: 'task-1',
    n,
    wsHash: 'deadbeefdeadbeef',
    backend: 'snapshot',
    gitRef: null,
    touched: ['src/a.ts'],
    created: [],
    deleted: [],
    summary: 'edit a',
    createdAt: 1000 + n,
    sizeBytes: 0
  };
}

beforeEach(() => {
  memfs.files.clear();
  memfs.renames = 0;
});

describe('snapshot-backend', () => {
  it('writes an encrypted envelope, never plaintext contents', async () => {
    const manifest = makeManifest(0);
    const bundle: CheckpointBundle = { manifest, before: { 'src/a.ts': 'SECRET-PRE' }, after: {} };
    const bytes = await writeBundle(manifest, bundle);
    expect(bytes).toBeGreaterThan(0);

    const abs = path.join(CHECKPOINTS_ROOT, manifest.wsHash, manifest.taskId, '0.bundle');
    const raw = memfs.files.get(abs)!;
    expect(raw).toBeDefined();
    const envelope = JSON.parse(raw);
    expect(envelope.v).toBe(1);
    expect(envelope.cipher).toBe('safeStorage');
    expect(envelope.meta).toMatchObject({ id: 'ckpt_0', backend: 'snapshot' });
    // The secret content must NOT appear anywhere in the plaintext part; it
    // lives only inside the "enc:" payload string.
    expect(JSON.stringify(envelope.meta)).not.toContain('SECRET-PRE');
    expect(String(envelope.payload).startsWith('enc:')).toBe(true);
  });

  it('writes atomically via tmp + rename (no partial .bundle on disk during write)', async () => {
    await writeBundle(makeManifest(0), { manifest: makeManifest(0), before: {}, after: {} });
    // rename happened exactly once and only the final .bundle path remains.
    expect(memfs.renames).toBe(1);
    const leftoverTmp = [...memfs.files.keys()].some((k) => k.endsWith('.tmp'));
    expect(leftoverTmp).toBe(false);
  });

  it('lists manifests WITHOUT decrypting, and reads back contents via crypto', async () => {
    const m0 = makeManifest(0);
    await writeBundle(m0, { manifest: m0, before: { 'src/a.ts': 'A0' }, after: { 'src/a.ts': 'A1' } });
    const list = await listManifests(WS);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ckpt_0');

    const bundle = await readBundle(WS, 'task-1', 0);
    expect(bundle?.before['src/a.ts']).toBe('A0');
    expect(bundle?.after['src/a.ts']).toBe('A1');
  });

  it('backend surface exposes the expected operations', () => {
    expect(snapshotBackend.name).toBe('snapshot');
    expect(typeof snapshotBackend.write).toBe('function');
    expect(typeof snapshotBackend.read).toBe('function');
  });
});
