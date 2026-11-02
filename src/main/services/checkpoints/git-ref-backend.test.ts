/**
 * GitRefBackend temp-repo tests (Phase 3 verification).
 *
 * Unlike the service tests, these run the REAL git binary via `simple-git`
 * against a throwaway repository in a temp dir (no Electron, no mocks), because
 * the single most important Phase 3 guarantee can only be proven against git
 * itself: pinning a checkpoint to `refs/tycode/checkpoints/...` must NEVER touch
 * the user's branch, HEAD, index, working tree, or stash list.
 *
 * Asserted per the plan's Phase 3 verification:
 *  - a hidden ref is created and resolves to a real commit object;
 *  - `git status --porcelain`, HEAD sha, branch list and `git stash list` are
 *    byte-identical before and after the capture;
 *  - prior file contents are readable from the pinned commit;
 *  - deleting the checkpoint removes only the hidden ref;
 *  - a directory that is not a repo reports "not usable".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { captureRef, deleteRef, isUsable, listRefs, readFileAt } from './git-ref-backend';

let repoDir = '';
let git: SimpleGit;

async function snapshotState(): Promise<{ status: string; head: string; branches: string; stash: string }> {
  // Sequential reads with maxConcurrentProcesses=1 + GIT_OPTIONAL_LOCKS=0 (set on
  // the git instance above): concurrent git subprocesses against the same repo can
  // race on .git/index.lock under heavy CI parallelism, and optional-locks status
  // refreshes mutate the index. Serializing + disabling optional locks keeps the
  // before/after comparison deterministic without weakening the guarantee.
  const status = (await git.raw(['status', '--porcelain'])).trim();
  const head = (await git.raw(['rev-parse', 'HEAD'])).trim();
  const branches = (await git.raw(['branch', '--list', '--format=%(refname)'])).trim();
  const stash = (await git.raw(['stash', 'list'])).trim();
  return { status, head, branches, stash };
}

beforeAll(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-gitref-'));
  git = simpleGit({
    baseDir: repoDir,
    maxConcurrentProcesses: 1,
    allowEnvironment: ['GIT_OPTIONAL_LOCKS']
  }).env({ GIT_OPTIONAL_LOCKS: '0' });
  await git.init();
  await git.addConfig('user.email', 'checkpoint-test@ty-code.local');
  await git.addConfig('user.name', 'Ty-Code Checkpoint Test');
  // A committed baseline so HEAD exists and a modification can be stashed-created.
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n', 'utf8');
  fs.writeFileSync(path.join(repoDir, 'b.txt'), 'keep\n', 'utf8');
  await git.add(['a.txt', 'b.txt']);
  await git.commit('initial');
  // Dirty the tree: this is the state `git stash create` snapshots without a ref.
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'two (agent edit pending)\n', 'utf8');
}, 60_000);

afterAll(() => {
  try {
    fs.rmSync(repoDir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup is best-effort */
  }
});

// These exercise the REAL git binary, spawning ~10 subprocesses per test. Under
// full-suite parallelism (dozens of workers each spawning git) individual
// commands slow down enough to blow the default 5s per-test timeout, so grant a
// generous budget. The logic itself is unchanged — it only needs realistic time.
describe('git-ref-backend', { timeout: 60_000 }, () => {
  it('reports a real repo usable and a plain directory not usable', async () => {
    await expect(isUsable(repoDir)).resolves.toBe(true);
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-norepo-'));
    try {
      await expect(isUsable(nonRepo)).resolves.toBe(false);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('pins a hidden ref to a real commit while leaving ALL user-visible git state identical', async () => {
    const before = await snapshotState();

    const { ref, sha } = await captureRef(repoDir, 'task-alpha', 0);
    expect(ref).toBe('refs/tycode/checkpoints/task-alpha/0');
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/i);

    // The ref resolves to a real commit object.
    const resolved = (await git.raw(['rev-parse', '--verify', ref])).trim();
    expect(resolved).toBe(sha);
    await expect(git.raw(['cat-file', '-t', sha])).resolves.toMatch(/commit/);

    // HARD guarantee: nothing the user sees changed.
    const after = await snapshotState();
    expect(after.status).toBe(before.status);
    expect(after.head).toBe(before.head);
    expect(after.branches).toBe(before.branches);
    expect(after.stash).toBe(before.stash); // stash create never adds to the stash list

    // The hidden ref is enumerated by the backend and lives under our prefix only.
    const refs = await listRefs(repoDir);
    expect(refs.map((r) => r.ref)).toContain(ref);
  });

  it('reads a file\'s prior contents from the pinned commit', async () => {
    const { sha } = await captureRef(repoDir, 'task-read', 1);
    // At capture time a.txt was dirty ("two ..."), so the stashed commit holds that
    // pending content; b.txt was committed and unchanged.
    const bContent = await readFileAt(repoDir, sha, 'b.txt');
    expect(bContent).toContain('keep');
    const missing = await readFileAt(repoDir, sha, 'does/not/exist.txt');
    expect(missing).toBeNull();
  });

  it('deleting a checkpoint removes only the hidden ref (user state still untouched)', async () => {
    const before = await snapshotState();
    const { ref } = await captureRef(repoDir, 'task-delete', 2);
    await deleteRef(repoDir, ref);
    await expect(git.raw(['rev-parse', '--verify', ref])).rejects.toBeTruthy();
    const after = await snapshotState();
    expect(after.status).toBe(before.status);
    expect(after.head).toBe(before.head);
    expect(after.branches).toBe(before.branches);
  });

  it('deleteRef on an already-absent ref is a harmless no-op', async () => {
    await expect(deleteRef(repoDir, 'refs/tycode/checkpoints/task-ghost/99')).resolves.toBeUndefined();
  });
});
