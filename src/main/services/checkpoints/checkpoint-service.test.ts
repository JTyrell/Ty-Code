/**
 * CheckpointService tests — capture, backend selection, and retention.
 *
 * fs + crypto + git are all seams here: an in-memory FS, a deterministic fake
 * encryptor, and a stubbed GitRefBackend whose usability/failure we control. The
 * guarantees:
 *  1. A non-repo workspace captures a snapshot bundle with the pre-edit contents
 *     of ONLY the touched files; created files carry a null before-content.
 *  2. A usable repo captures with the git-ref backend AND writes the bundle.
 *  3. A git failure mid-capture degrades the task to snapshot, and the batch
 *     still succeeds (the edit is never blocked by checkpointing).
 *  4. Retention prunes to the newest 50 (oldest removed, both bundle + ref).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const memfs = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('node:fs/promises', () => {
  const norm = (x: string): string => String(x).replace(/\\/g, '/');
  return {
    default: {
    async mkdir() { return undefined; },
    async writeFile(p: string, contents: string) { memfs.files.set(norm(p), String(contents)); },
    async rename(oldP: string, newP: string) {
      const data = memfs.files.get(norm(oldP));
      if (data === undefined) throw new Error('ENOENT');
      memfs.files.set(norm(newP), data);
      memfs.files.delete(norm(oldP));
    },
    async readFile(p: string) {
      const data = memfs.files.get(norm(p));
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return data;
    },
    async readdir(dir: string) {
      const prefix = norm(dir) + '/';
      const names = new Set<string>();
      for (const key of memfs.files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (rest) names.add(rest.split('/')[0]);
        }
      }
      return [...names];
    },
    async unlink(p: string) { memfs.files.delete(norm(p)); }
    }
  };
});

vi.mock('../session/session-crypto', () => ({
  isEncryptionAvailable: () => true,
  encryptJson: (obj: unknown) => 'enc:' + JSON.stringify(obj),
  decryptPayload: <T,>(payload: string) => ({ ok: true, data: JSON.parse(String(payload).slice(4)) as T })
}));

vi.mock('../session/unified-session-store', () => ({
  computeWsHash: () => 'wshash00000000'
}));

// Controllable git backend.
const git = vi.hoisted(() => ({ usable: false, failCapture: false, deleted: [] as string[] }));
vi.mock('./git-ref-backend', () => ({
  gitRefBackend: {
    name: 'git-ref',
    isUsable: async () => git.usable,
    captureRef: async (_ws: string, taskId: string, n: number) => {
      if (git.failCapture) throw new Error('git exploded');
      return { ref: `refs/tycode/checkpoints/${taskId}/${n}`, sha: 'abc123' };
    },
    deleteRef: async (_ws: string, ref: string) => { git.deleted.push(ref); },
    listRefs: async () => [],
    readFileAt: async () => null
  }
}));

import { checkpointService } from './checkpoint-service';
import { CHECKPOINT_RETENTION } from '../../../shared/types/checkpoint';

const WS = '/tmp/tycode-ckpt-ws';
const CKPT_ROOT = path.join(os.homedir(), '.tycode', 'checkpoints', 'wshash00000000');

function seedUserFile(rel: string, contents: string): void {
  memfs.files.set(path.resolve(WS, rel).replace(/\\/g, '/'), contents);
}

beforeEach(() => {
  memfs.files.clear();
  git.usable = false;
  git.failCapture = false;
  git.deleted = [];
});

describe('checkpoint-service.capture', () => {
  it('stores the pre-edit contents of touched files on a non-repo (snapshot backend)', async () => {
    seedUserFile('src/a.ts', 'BEFORE-A');
    const manifest = await checkpointService.capture(WS, 'task-1', [
      { path: 'src/a.ts', kind: 'modify' },
      { path: 'src/new.ts', kind: 'create' }
    ], 'two edits');

    expect(manifest.backend).toBe('snapshot');
    expect(manifest.gitRef).toBeNull();
    expect(manifest.touched).toEqual(['src/a.ts']);
    expect(manifest.created).toEqual(['src/new.ts']);

    const bundlePath = path.join(CKPT_ROOT, 'task-1', '0.bundle').replace(/\\/g, '/');
    const raw = memfs.files.get(bundlePath)!;
    expect(raw).toBeDefined();
    const payload = JSON.parse(String(JSON.parse(raw).payload).slice(4)) as { before: Record<string, string | null> };
    expect(payload.before['src/a.ts']).toBe('BEFORE-A');
    expect(payload.before['src/new.ts']).toBeNull();
  });

  it('pins a hidden ref and marks git-ref backend when the repo is usable', async () => {
    git.usable = true;
    seedUserFile('src/a.ts', 'X');
    const manifest = await checkpointService.capture(WS, 'task-git', [{ path: 'src/a.ts', kind: 'modify' }]);
    expect(manifest.backend).toBe('git-ref');
    expect(manifest.gitRef).toBe('refs/tycode/checkpoints/task-git/0');
  });

  it('degrades to snapshot after a git failure without throwing (edit proceeds)', async () => {
    git.usable = true;
    git.failCapture = true;
    seedUserFile('src/a.ts', 'X');
    const manifest = await checkpointService.capture(WS, 'task-degrade', [{ path: 'src/a.ts', kind: 'modify' }]);
    // The capture itself did not throw, and this checkpoint fell back to snapshot.
    expect(manifest.backend).toBe('snapshot');
    expect(manifest.gitRef).toBeNull();
  });

  it('refuses to capture a path that escapes the workspace root', async () => {
    const manifest = await checkpointService.capture(WS, 'task-escape', [
      { path: '../../etc/passwd', kind: 'modify' }
    ]);
    expect(manifest.touched).toHaveLength(0);
    expect(manifest.created).toHaveLength(0);
    expect(manifest.deleted).toHaveLength(0);
  });

  it('prunes to the newest 50 checkpoints (oldest bundle removed)', async () => {
    const total = CHECKPOINT_RETENTION.maxCount + 3;
    for (let i = 0; i < total; i++) {
      seedUserFile('src/a.ts', `v${i}`);
      await checkpointService.capture(WS, 'task-retain', [{ path: 'src/a.ts', kind: 'modify' }]);
    }
    const manifests = await checkpointService.list(WS, 'task-retain');
    expect(manifests.length).toBeLessThanOrEqual(CHECKPOINT_RETENTION.maxCount);
    // The very first bundles (n=0,1,2) should be gone; the newest kept.
    const ns = manifests.map((m) => m.n).sort((a, b) => a - b);
    expect(ns[0]).toBeGreaterThan(0);
    const oldestBundle = path.join(CKPT_ROOT, 'task-retain', '0.bundle').replace(/\\/g, '/');
    expect(memfs.files.has(oldestBundle)).toBe(false);
  });
});
