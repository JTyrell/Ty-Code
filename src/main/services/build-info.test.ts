/**
 * Build identity tests (Prompt 5b Step 5, group G4 — Help > About).
 *
 * Runs in pure Node. There is no repository, no `dist/main` and no build stamp
 * anywhere near these tests: every file read is answered from a map, which is
 * the only way to arrange the cases that matter. The interesting ones are all
 * *absences* — a packaged build with no `.git`, a stamp the build script wrote
 * half of, a fresh clone whose branches live only in `packed-refs` — and none of
 * them can be produced on demand in a live checkout.
 *
 * The property the whole module exists to protect is asserted first and then
 * re-asserted from every direction below it: **when the commit cannot be
 * determined, it is absent.** Not `'unknown'`, not `'dev'`, not `'0000000'`.
 * About drops the row. A placeholder shaped like a SHA gets pasted into a bug
 * report and sends whoever reads it looking for a commit that never existed,
 * which is a worse outcome than a dialog with one line fewer.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveBuildStamp,
  shortCommit,
  type BuildInfoDeps
} from './build-info';

// ---------------------------------------------------------------------------
// A fake filesystem
// ---------------------------------------------------------------------------

/**
 * The bundle directory, and the repo root two levels above it.
 *
 * `resolveBuildStamp` derives the root from `bundleDir` with `'..', '..'`, which
 * is the same relative shape `dist/main` has both in a checkout and inside the
 * asar. Built with `path.resolve` rather than written as a literal so the
 * expectations hold on Windows and POSIX alike.
 */
const BUNDLE_DIR = path.resolve(path.sep, 'repo', 'dist', 'main');
const REPO_ROOT = path.resolve(path.sep, 'repo');

/** Absolute path for a repo-relative one. */
function at(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

/**
 * Deps backed by a map of absolute path to file text.
 *
 * `readFileText` returns `null` for anything absent, exactly as the real binding
 * does — including for directories, which is why `gitDirOf` can treat "reading
 * `.git` failed" as "`.git` is a directory". A path that is read is recorded, so
 * a test can prove the module did not go looking somewhere it should not have.
 */
function depsWith(
  files: Record<string, string> = {},
  env: Record<string, string | undefined> = {}
): { deps: BuildInfoDeps; reads: string[] } {
  const map = new Map(Object.entries(files));
  const reads: string[] = [];
  return {
    reads,
    deps: {
      bundleDir: BUNDLE_DIR,
      env,
      readFileText(absPath: string): string | null {
        reads.push(absPath);
        const found = map.get(absPath);
        return found === undefined ? null : found;
      }
    }
  };
}

/** The 40-hex form CI provides as `GITHUB_SHA`. */
const FULL_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const LOOSE_SHA = 'deadbeefcafe1234567890abcdef0123456789';

describe('resolveBuildStamp', () => {
  it('omits the commit entirely when nothing could be determined', () => {
    // An installed build: no stamp inside the archive, no `.git` beside it.
    const { deps } = depsWith();

    const stamp = resolveBuildStamp(deps);

    expect(stamp).toEqual({ source: 'none' });
    expect(stamp.commit).toBeUndefined();
    // And not a placeholder wearing a commit's clothes.
    expect(JSON.stringify(stamp)).not.toMatch(/unknown|dev|HEAD|0{7}/i);
  });

  it('reads TYCODE_COMMIT from the environment before anything else', () => {
    const { deps, reads } = depsWith(
      {
        [path.join(BUNDLE_DIR, 'build-info.json')]: JSON.stringify({ commit: LOOSE_SHA }),
        [at('.git', 'HEAD')]: `ref: refs/heads/master\n`
      },
      { TYCODE_COMMIT: FULL_SHA, GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff' }
    );

    const stamp = resolveBuildStamp(deps);

    expect(stamp).toEqual({ commit: FULL_SHA, source: 'env' });
    // Proves the ordering rather than just the outcome: neither the stamp file
    // nor `.git` was opened, so a build pipeline that states its own SHA cannot
    // be quietly overridden by whatever the runner happens to have checked out.
    expect(reads).toEqual([]);
  });

  it('falls back to GITHUB_SHA and accepts the uppercase form CI emits', () => {
    const { deps } = depsWith({}, { GITHUB_SHA: FULL_SHA.toUpperCase() });

    expect(resolveBuildStamp(deps)).toEqual({ commit: FULL_SHA, source: 'env' });
  });

  it('rejects an environment value that is not a commit', () => {
    // A captured error line, a branch name and a too-short abbreviation all fail
    // the hex pattern. Falling through to the next source is the point: an
    // unusable override must not cost the build its real identity.
    for (const bad of ['not-a-sha', 'master', 'abc123', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']) {
      const { deps } = depsWith(
        { [at('.git', 'HEAD')]: 'ref: refs/heads/master\n', [at('.git', 'refs', 'heads', 'master')]: `${LOOSE_SHA}\n` },
        { TYCODE_COMMIT: bad }
      );

      const stamp = resolveBuildStamp(deps);

      expect(stamp.source, `env value ${bad}`).toBe('git-dir');
      expect(stamp.commit, `env value ${bad}`).toBe(LOOSE_SHA);
    }
  });

  it('prefers the build stamp over the working tree', () => {
    const { deps } = depsWith({
      [path.join(BUNDLE_DIR, 'build-info.json')]: JSON.stringify({
        commit: LOOSE_SHA,
        dirty: true,
        generatedAt: '2026-10-31T12:00:00.000Z'
      }),
      [at('.git', 'HEAD')]: `ref: refs/heads/master\n`,
      [at('.git', 'refs', 'heads', 'master')]: `${FULL_SHA}\n`
    });

    const stamp = resolveBuildStamp(deps);

    // The stamp is what the shipped bundle was made from; `.git` is merely what
    // is checked out now, and in a release build those two are not the same.
    expect(stamp).toEqual({
      commit: LOOSE_SHA,
      dirty: true,
      generatedAt: '2026-10-31T12:00:00.000Z',
      source: 'stamp-file'
    });
  });

  it('carries dirty and generatedAt only when the stamp actually states them', () => {
    const { deps } = depsWith({
      [path.join(BUNDLE_DIR, 'build-info.json')]: JSON.stringify({
        commit: LOOSE_SHA,
        dirty: 'yes',
        generatedAt: ''
      })
    });

    const stamp = resolveBuildStamp(deps);

    expect(stamp.commit).toBe(LOOSE_SHA);
    // `dirty: false` would assert a clean tree this build never inspected, and
    // an empty timestamp is not a time. Both are dropped rather than coerced.
    expect(stamp.dirty).toBeUndefined();
    expect(stamp.generatedAt).toBeUndefined();
  });

  it('survives a malformed or half-written stamp file', () => {
    const cases: Array<[string, string]> = [
      ['truncated JSON', '{"commit":"deadbeef"'],
      ['a JSON array', '["deadbeefdeadbeef"]'],
      ['a bare string', '"deadbeefdeadbeef"'],
      ['null', 'null'],
      ['a non-hex commit', JSON.stringify({ commit: 'HEAD -> master' })]
    ];

    for (const [label, raw] of cases) {
      const { deps } = depsWith({ [path.join(BUNDLE_DIR, 'build-info.json')]: raw });

      const stamp = resolveBuildStamp(deps);

      // No repository here either, so the honest answer is "no commit". A stamp
      // the build script botched must not become a build error or a crash in the
      // `app:get-info` handler — it is a decoration on an About dialog.
      expect(stamp, label).toEqual({ source: 'none' });
    }
  });

  it('resolves a symbolic HEAD through the loose ref file', () => {
    const { deps } = depsWith({
      [at('.git', 'HEAD')]: 'ref: refs/heads/master\n',
      [at('.git', 'refs', 'heads', 'master')]: `${LOOSE_SHA}\n`
    });

    expect(resolveBuildStamp(deps)).toEqual({ commit: LOOSE_SHA, source: 'git-dir' });
  });

  it('resolves a detached HEAD, which holds the commit itself', () => {
    const { deps } = depsWith({
      [at('.git', 'HEAD')]: `${FULL_SHA}\n`
    });

    expect(resolveBuildStamp(deps)).toEqual({ commit: FULL_SHA, source: 'git-dir' });
  });

  it('reads packed-refs when the loose ref was never written', () => {
    // The normal state of a fresh clone: every branch is packed and loose refs
    // appear only once a branch moves. Skipping this would leave About blank on
    // the machine most likely to be running a dev build.
    const packed = [
      '# pack-refs with: peeled fully-peeled sorted ',
      `${FULL_SHA} refs/heads/main`,
      `${LOOSE_SHA} refs/tags/v1.0.0`,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v1.0.0^{}',
      `${'b'.repeat(40)} refs/heads/master`
    ].join('\n');
    const { deps } = depsWith({
      [at('.git', 'HEAD')]: 'ref: refs/heads/master\n',
      [at('.git', 'packed-refs')]: packed
    });

    expect(resolveBuildStamp(deps)).toEqual({ commit: 'b'.repeat(40), source: 'git-dir' });
  });

  it('ignores comments, peeled tags and malformed packed-ref lines', () => {
    const { deps } = depsWith({
      [at('.git', 'HEAD')]: 'ref: refs/heads/master\n',
      [at('.git', 'packed-refs')]: [
        '# a comment naming refs/heads/master',
        '^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'not-a-sha refs/heads/master',
        'refs/heads/master',
        ''
      ].join('\n')
    });

    // Every line either does not name the ref or does not name a commit, so
    // nothing is guessed at.
    expect(resolveBuildStamp(deps)).toEqual({ source: 'none' });
  });

  it('follows the gitdir pointer a worktree or submodule leaves behind', () => {
    const commonDir = path.resolve(path.sep, 'wt', 'common');
    const { deps } = depsWith({
      [at('.git')]: `gitdir: ${commonDir}\n`,
      [path.join(commonDir, 'HEAD')]: 'ref: refs/heads/feature\n',
      [path.join(commonDir, 'refs', 'heads', 'feature')]: `${LOOSE_SHA}\n`
    });

    expect(resolveBuildStamp(deps)).toEqual({ commit: LOOSE_SHA, source: 'git-dir' });
  });

  it('resolves a relative gitdir pointer against the repo root', () => {
    const { deps } = depsWith({
      [at('.git')]: 'gitdir: ../.git/worktrees/feature\n',
      [path.resolve(path.sep, '.git', 'worktrees', 'feature', 'HEAD')]: `${LOOSE_SHA}\n`
    });

    expect(resolveBuildStamp(deps)).toEqual({ commit: LOOSE_SHA, source: 'git-dir' });
  });

  it('gives up on a .git file that points nowhere', () => {
    const { deps } = depsWith({ [at('.git')]: 'this is not a gitdir line\n' });

    expect(resolveBuildStamp(deps)).toEqual({ source: 'none' });
  });

  it('refuses a HEAD ref shaped like a traversal', () => {
    // `.git/HEAD` is read from disk and then used as a filename, so its contents
    // are a path. `normaliseCommit` would discard the result anyway, but the
    // shape is rejected before it is ever joined — the containment does not
    // depend on whoever edits this next remembering that second check.
    const { deps, reads } = depsWith({
      [at('.git', 'HEAD')]: 'ref: refs/../../outside\n'
    });

    expect(resolveBuildStamp(deps)).toEqual({ source: 'none' });
    expect(reads.some((p) => p.includes('outside'))).toBe(false);
  });

  it('returns nothing when HEAD names a ref that does not exist', () => {
    const { deps } = depsWith({
      [at('.git', 'HEAD')]: 'ref: refs/heads/deleted-branch\n'
    });

    expect(resolveBuildStamp(deps)).toEqual({ source: 'none' });
  });

  it('returns nothing when HEAD is empty', () => {
    const { deps } = depsWith({ [at('.git', 'HEAD')]: '\n' });

    expect(resolveBuildStamp(deps)).toEqual({ source: 'none' });
  });
});

describe('shortCommit', () => {
  it('trims a full SHA to the length the build script stamps', () => {
    expect(shortCommit(FULL_SHA)).toBe(FULL_SHA.slice(0, 12));
    expect(shortCommit(FULL_SHA)).toHaveLength(12);
  });

  it('leaves an already-short commit alone', () => {
    // A 7-character dev abbreviation must not be padded or rejected: About
    // shows the same value whichever source resolved. Nor is a commit already
    // at the display length touched, so the two sources that produce a 12-char
    // form keep it.
    expect(shortCommit('abc1234')).toBe('abc1234');
    expect(shortCommit('abc123456789')).toBe('abc123456789');
    expect(shortCommit('abc123456789')).toHaveLength(12);
  });

  it('trims one character past the display length rather than keeping it', () => {
    // The boundary, stated because it is the one that reads as a typo either
    // way: 13 characters is longer than the length every other source is
    // normalised to, so showing it would make About's commit column change
    // width depending on where the stamp came from.
    expect(shortCommit('abc1234567890')).toBe('abc123456789');
    expect(shortCommit('abc1234567890')).toHaveLength(12);
  });

  it('honours an explicit length', () => {
    expect(shortCommit(FULL_SHA, 7)).toBe(FULL_SHA.slice(0, 7));
  });
});
