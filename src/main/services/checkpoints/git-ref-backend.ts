/**
 * Phase 3 — GitRefBackend: hidden-ref checkpointing for git workspaces.
 *
 * Creates `refs/tycode/checkpoints/{taskId}/{n}` pointing at a throwaway commit
 * produced by `git stash create` (which snapshots index + worktree WITHOUT
 * touching the branch, index, or working tree). When the tree is clean and
 * `stash create` yields nothing, we fall back to the current HEAD sha — the
 * worktree already matches it. `git update-ref` pins the object so GC cannot
 * collect it, and deleting just drops the ref.
 *
 * This backend NEVER modifies user-visible refs, so `git status` and the index
 * are identical before and after a capture — a hard requirement of the Phase 3
 * verification. It writes NO files itself (only git plumbing), so it is outside
 * the plaintext-bundle guard's concern; the authoritative restore contents still
 * live in the encrypted snapshot bundle the service writes.
 */

import { simpleGit, type SimpleGitOptions } from 'simple-git';
import path from 'node:path';
import { checkpointRefName } from '../../../shared/types/checkpoint';

function gitFor(workspaceRoot: string) {
  const options: Partial<SimpleGitOptions> = {
    baseDir: path.resolve(workspaceRoot),
    maxConcurrentProcesses: 1,
    // simple-git blocks arbitrary env vars unless allow-listed; without this the
    // guard throws and EVERY git-ref checkpoint silently fails into snapshots.
    allowEnvironment: ['GIT_OPTIONAL_LOCKS']
  };
  // GIT_OPTIONAL_LOCKS=0 keeps read-ish plumbing from writing junk locks.
  return simpleGit(options).env({ GIT_OPTIONAL_LOCKS: '0' });
}

const REF_PREFIX = 'refs/tycode/checkpoints';

export interface GitRefInfo {
  ref: string;
  sha: string;
}

/** Repo exists AND a git command succeeds (binary present, not a bare/corrupt dir). */
export async function isUsable(workspaceRoot: string): Promise<boolean> {
  try {
    const git = gitFor(workspaceRoot);
    const ok = await git.checkIsRepo();
    if (!ok) return false;
    await git.raw(['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pin a throwaway commit capturing the current worktree to a hidden ref.
 * Returns the sha. Throws on a git failure so the service can degrade to
 * SnapshotBackend rather than erroring the whole edit batch.
 */
export async function captureRef(
  workspaceRoot: string,
  taskId: string,
  n: number
): Promise<{ ref: string; sha: string }> {
  const git = gitFor(workspaceRoot);
  const ref = checkpointRefName(taskId, n);

  let sha = '';
  try {
    const created = await git.raw(['stash', 'create']);
    sha = (created || '').trim();
  } catch {
    sha = '';
  }
  if (!sha) {
    // Clean tree: HEAD already reflects the worktree we want to restore toward.
    sha = (await git.raw(['rev-parse', 'HEAD'])).trim();
  }
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`git stash create produced an unusable sha: ${sha || '(empty)'}`);
  }
  await git.raw(['update-ref', ref, sha]);
  return { ref, sha };
}

export async function deleteRef(workspaceRoot: string, ref: string): Promise<void> {
  const git = gitFor(workspaceRoot);
  try {
    await git.raw(['update-ref', '-d', ref]);
  } catch {
    /* ref already gone */
  }
}

export async function listRefs(workspaceRoot: string): Promise<GitRefInfo[]> {
  const git = gitFor(workspaceRoot);
  try {
    const out = await git.raw(['for-each-ref', '--format=%(objectname) %(refname)', REF_PREFIX]);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split(' ');
        return { sha, ref: rest.join(' ') };
      })
      .filter((r) => r.ref.startsWith(REF_PREFIX));
  } catch {
    return [];
  }
}

/** Read a file's prior contents from a hidden-ref commit (null if absent). */
export async function readFileAt(
  workspaceRoot: string,
  sha: string,
  relPath: string
): Promise<string | null> {
  const git = gitFor(workspaceRoot);
  try {
    // `git show <sha>:<path>` with --end-of-options guards against path magic.
    return await git.raw(['show', '--end-of-options', `${sha}:${relPath}`]);
  } catch {
    return null;
  }
}

export const gitRefBackend = {
  name: 'git-ref' as const,
  isUsable,
  captureRef,
  deleteRef,
  listRefs,
  readFileAt
};
