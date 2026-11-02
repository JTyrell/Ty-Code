/**
 * CheckpointService.restore tests — three-way conflict semantics.
 *
 * After finalize() records the agent's result contents, restore must:
 *  - revert a file the agent changed (current == after) back to its pre-edit
 *    content, in EVERY mode;
 *  - treat a file the user ALSO edited (current differs from both before and
 *    after) as a conflict in 'review' (leave it alone + report it), honor
 *    'keep-mine' (skip) and 'force' (revert);
 *  - remove an agent-created file and re-create an agent-deleted one.
 *  - never touch a file that is already at the checkpoint state (skip).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../session/unified-session-store', () => ({ computeWsHash: () => 'wshash00000000' }));
vi.mock('./git-ref-backend', () => ({
  gitRefBackend: {
    name: 'git-ref',
    isUsable: async () => false,
    captureRef: async () => ({ ref: '', sha: '' }),
    deleteRef: async () => undefined,
    listRefs: async () => [],
    readFileAt: async () => null
  }
}));

import { checkpointService } from './checkpoint-service';

const WS = '/tmp/tycode-ckpt-ws';
const userPath = (rel: string): string => path.resolve(WS, rel).replace(/\\/g, '/');
const seed = (rel: string, contents: string): void => void memfs.files.set(userPath(rel), contents);
const read = (rel: string): string | undefined => memfs.files.get(userPath(rel));

beforeEach(() => memfs.files.clear());

describe('checkpoint-service.restore', () => {
  it('reverts an agent-only change back to the pre-edit content', async () => {
    seed('src/a.ts', 'BEFORE');
    const m = await checkpointService.capture(WS, 't1', [{ path: 'src/a.ts', kind: 'modify' }]);
    seed('src/a.ts', 'AFTER-AGENT');
    await checkpointService.finalize(WS, m, [{ path: 'src/a.ts', content: 'AFTER-AGENT' }]);

    const res = await checkpointService.restore(WS, m.id, 'review');
    expect(res.restored).toContain('src/a.ts');
    expect(res.conflicts).toHaveLength(0);
    expect(read('src/a.ts')).toBe('BEFORE');
  });

  it('surfaces a genuine user edit as a conflict in review, and honors keep-mine / force', async () => {
    seed('src/a.ts', 'BEFORE');
    const m = await checkpointService.capture(WS, 't2', [{ path: 'src/a.ts', kind: 'modify' }]);
    seed('src/a.ts', 'AFTER-AGENT');
    await checkpointService.finalize(WS, m, [{ path: 'src/a.ts', content: 'AFTER-AGENT' }]);
    // The user edits the file after the agent, so current matches neither.
    seed('src/a.ts', 'USER-EDIT');

    const preview = await checkpointService.restorePreview(WS, m.id);
    expect(preview.conflicts.map((c) => c.path)).toContain('src/a.ts');
    expect(preview.conflicts[0].currentContent).toBe('USER-EDIT');
    expect(read('src/a.ts')).toBe('USER-EDIT'); // preview never writes

    const keep = await checkpointService.restore(WS, m.id, 'keep-mine');
    expect(keep.skipped).toContain('src/a.ts');
    expect(read('src/a.ts')).toBe('USER-EDIT'); // keep-mine preserves the user's edit

    const force = await checkpointService.restore(WS, m.id, 'force');
    expect(force.restored).toContain('src/a.ts');
    expect(read('src/a.ts')).toBe('BEFORE'); // force reverts over the user edit
  });

  it('removes an agent-created file on restore', async () => {
    const m = await checkpointService.capture(WS, 't3', [{ path: 'src/new.ts', kind: 'create' }]);
    seed('src/new.ts', 'NEW');
    await checkpointService.finalize(WS, m, [{ path: 'src/new.ts', content: 'NEW' }]);

    const res = await checkpointService.restore(WS, m.id, 'force');
    expect(res.deleted).toContain('src/new.ts');
    expect(read('src/new.ts')).toBeUndefined();
  });

  it('re-creates an agent-deleted file from its pre-edit content', async () => {
    seed('src/gone.ts', 'OLD');
    const m = await checkpointService.capture(WS, 't4', [{ path: 'src/gone.ts', kind: 'delete' }]);
    memfs.files.delete(userPath('src/gone.ts')); // agent deleted it
    await checkpointService.finalize(WS, m, [{ path: 'src/gone.ts', content: null }]);

    const res = await checkpointService.restore(WS, m.id, 'force');
    expect(res.created).toContain('src/gone.ts');
    expect(read('src/gone.ts')).toBe('OLD');
  });

  it('skips a file that is already at the checkpoint state', async () => {
    seed('src/a.ts', 'BEFORE');
    const m = await checkpointService.capture(WS, 't5', [{ path: 'src/a.ts', kind: 'modify' }]);
    await checkpointService.finalize(WS, m, [{ path: 'src/a.ts', content: 'AFTER-AGENT' }]);
    // current still equals BEFORE (nothing changed).
    const res = await checkpointService.restore(WS, m.id, 'force');
    expect(res.skipped).toContain('src/a.ts');
    expect(res.restored).toHaveLength(0);
  });

  it('returns an unsuccessful result for an unknown checkpoint id', async () => {
    const res = await checkpointService.restore(WS, 'ckpt_missing', 'force');
    expect(res.success).toBe(false);
  });
});
