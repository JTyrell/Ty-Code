/**
 * Build identity for Help > About (Prompt 5b Step 5, group G4).
 *
 * The spec asks About to show *version, commit, Electron/Node/Chromium*. Three
 * of those four are available at runtime from `app.getVersion()` and
 * `process.versions`; the commit is not, because an installed app ships no
 * `.git` directory and a bundled file does not remember how it was built. This
 * module is the whole answer to that: it looks in the places a commit could
 * honestly have been left, in order, and returns nothing when none of them has
 * one.
 *
 * Free of `electron` so it can be unit-tested under plain Node. The two things
 * it needs from the outside — where the bundle lives and how to read a file —
 * come in as deps.
 *
 * Three rules shape it.
 *
 *  - **Absent, never invented.** There is no `'unknown'`, `'dev'` or `'0000000'`
 *    fallback anywhere in this file. About renders a missing commit by leaving
 *    the row out. A placeholder that looks like a SHA is worse than no row: it
 *    invites a user to paste it into a bug report and then sends whoever reads
 *    that report looking for a commit that does not exist.
 *  - **Everything is validated, nothing is trusted.** The stamp file is JSON
 *    parsed inside a `try`, the commit is matched against a hex pattern, and a
 *    git ref is checked before it is ever joined onto a path. The stamp is
 *    written by our own build script, but this module is also the thing that
 *    reads `.git/HEAD`, and a `ref:` line in there is a path.
 *  - **No process is spawned.** The dev fallback reads `.git` as a directory
 *    rather than shelling out to `git rev-parse`. Spawning git from the main
 *    process to decorate an About dialog would add a startup dependency on a
 *    binary the app does not otherwise need at that moment, and would be the
 *    second place in the codebase that knows how to ask git for HEAD.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Where the commit came from. Reported so About can be trusted to say which. */
export type BuildStampSource = 'env' | 'stamp-file' | 'git-dir' | 'none';

export interface BuildStamp {
  /** Lowercase hex, 7-40 characters. Absent when nothing resolved. */
  commit?: string;
  /**
   * True only when the stamp was taken from a working tree with uncommitted
   * changes. Absent rather than `false` when cleanliness could not be checked,
   * because `false` would assert something this build never looked at.
   */
  dirty?: boolean;
  /** ISO timestamp from the build stamp, when there was one. */
  generatedAt?: string;
  source: BuildStampSource;
}

export interface BuildInfoDeps {
  /**
   * The directory the running bundle lives in — `__dirname` of `dist/main`.
   *
   * Two levels up is the root the allowlist and the dev `.git` fallback are both
   * relative to: the repository working tree in dev, the asar root when
   * packaged. Passing it in rather than reading `__dirname` here is what makes
   * the resolution order testable without building anything.
   */
  bundleDir: string;
  env: Readonly<Record<string, string | undefined>>;
  /** UTF-8 text of an absolute path, or `null` on any failure. */
  readFileText(absPath: string): string | null;
}

/**
 * What a commit may look like.
 *
 * The value is rendered into a dialog a user may screenshot into a bug report,
 * so a captured error line must not be able to become it. Rejecting is cheap and
 * the failure mode is exactly the one this module is written to prefer: no row.
 */
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/**
 * A git ref that is safe to join onto a path.
 *
 * `.git/HEAD` is a file this module reads and then treats as a filename. A
 * `ref:` line pointing at `../../etc/passwd` would not leak anything here — the
 * result is only ever matched against `COMMIT_RE` and discarded if it does not
 * look like hex — but refusing the shape outright means the containment does not
 * depend on that second check being remembered by whoever edits this next.
 */
const SAFE_REF_RE = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function normaliseCommit(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim().toLowerCase();
  return COMMIT_RE.test(candidate) ? candidate : null;
}

function stampCommitFromEnv(env: BuildInfoDeps['env']): string | null {
  return normaliseCommit(env.TYCODE_COMMIT) || normaliseCommit(env.GITHUB_SHA);
}

/**
 * The stamp `scripts/stamp-build-info.mjs` writes next to the bundle.
 *
 * Read with `JSON.parse` rather than imported, which keeps `resolveJsonModule`
 * out of `tsconfig.json` and — more usefully — keeps a malformed or half-written
 * stamp from being a build error. It is a decoration on an About dialog; if it
 * cannot be parsed, the dialog shows one row fewer.
 */
function stampFromFile(deps: BuildInfoDeps): BuildStamp | null {
  const raw = deps.readFileText(path.join(deps.bundleDir, 'build-info.json'));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const commit = normaliseCommit(record.commit);
  if (!commit) return null;

  const stamp: BuildStamp = { commit, source: 'stamp-file' };
  if (typeof record.dirty === 'boolean') stamp.dirty = record.dirty;
  if (typeof record.generatedAt === 'string' && record.generatedAt.length > 0) {
    stamp.generatedAt = record.generatedAt;
  }
  return stamp;
}

/**
 * `.git` as a directory path, following the indirection file a worktree or a
 * submodule leaves behind. Returns `null` when there is no repository here,
 * which is the normal case in an installed build.
 */
function gitDirOf(deps: BuildInfoDeps, repoRoot: string): string | null {
  const candidate = path.join(repoRoot, '.git');
  const raw = deps.readFileText(candidate);
  if (raw === null) {
    // `readFileText` fails on a directory the same way it fails on an absent
    // file, so this is "not a gitdir pointer", not "no repository".
    return candidate;
  }
  const match = /^gitdir:\s*(.+)$/m.exec(raw);
  if (!match) return null;
  const target = match[1].trim();
  return path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
}

/** The commit a loose or packed ref names, or `null`. */
function refTarget(deps: BuildInfoDeps, gitDir: string, ref: string): string | null {
  const loose = deps.readFileText(path.join(gitDir, ...ref.split('/')));
  const fromLoose = normaliseCommit(loose);
  if (fromLoose) return fromLoose;

  // A fresh clone keeps every branch in `packed-refs` and writes loose refs only
  // when they move, so the loose file being absent is the common case rather than
  // an error. Lines are `<sha> <ref>`; `#` starts a comment and a leading `^`
  // marks an annotated tag's parent, neither of which names a commit we want.
  const packed = deps.readFileText(path.join(gitDir, 'packed-refs'));
  if (!packed) return null;
  for (const line of packed.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
    const space = trimmed.indexOf(' ');
    if (space <= 0) continue;
    if (trimmed.slice(space + 1).trim() !== ref) continue;
    const commit = normaliseCommit(trimmed.slice(0, space));
    if (commit) return commit;
  }
  return null;
}

/**
 * The dev fallback: resolve HEAD straight out of `.git`.
 *
 * Only reached when there is no build stamp, which means a developer running
 * from a checkout — exactly the case where reading the repository is both
 * correct and cheap.
 */
function stampFromGitDir(deps: BuildInfoDeps): BuildStamp | null {
  const repoRoot = path.resolve(deps.bundleDir, '..', '..');
  const gitDir = gitDirOf(deps, repoRoot);
  if (!gitDir) return null;

  const head = deps.readFileText(path.join(gitDir, 'HEAD'));
  if (!head) return null;

  const firstLine = head.split(/\r?\n/)[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;

  // A detached HEAD holds the commit itself rather than a ref to it.
  const refMatch = /^ref:\s*(.+)$/.exec(firstLine);
  if (!refMatch) {
    const commit = normaliseCommit(firstLine);
    return commit ? { commit, source: 'git-dir' } : null;
  }

  const ref = refMatch[1].trim();
  if (!SAFE_REF_RE.test(ref) || ref.split('/').includes('..')) return null;
  const commit = refTarget(deps, gitDir, ref);
  return commit ? { commit, source: 'git-dir' } : null;
}

/**
 * Resolve this build's identity.
 *
 * Order is `env` → stamp file → `.git`, first hit wins. The override comes first
 * so a build driven outside git — a release pipeline that knows its own SHA —
 * can state it, and the stamp file beats the working tree because the stamp is
 * what the shipped bundle was actually made from while `.git` is merely what
 * happens to be checked out now.
 */
export function resolveBuildStamp(deps: BuildInfoDeps): BuildStamp {
  const fromEnv = stampCommitFromEnv(deps.env);
  if (fromEnv) return { commit: fromEnv, source: 'env' };

  const fromFile = stampFromFile(deps);
  if (fromFile) return fromFile;

  return stampFromGitDir(deps) ?? { source: 'none' };
}

/** The real bindings, for `src/main/index.ts`. */
export function createNodeBuildInfoDeps(bundleDir: string): BuildInfoDeps {
  return {
    bundleDir,
    env: process.env,
    readFileText(absPath) {
      try {
        return fs.readFileSync(absPath, 'utf8');
      } catch {
        // Absent, a directory, unreadable, or inside an asar that does not have
        // it. All four mean "try the next source", and none is worth reporting:
        // the caller's whole job is to degrade to no commit.
        return null;
      }
    }
  };
}

/**
 * The stamp for the running bundle.
 *
 * Called from the `app:get-info` handler, which fires once per window mount and
 * once per About open, so there is deliberately no cache: two small file reads
 * are cheaper than a value that goes stale when a developer commits and rebuilds
 * without restarting.
 */
export function readBuildStamp(bundleDir: string = __dirname): BuildStamp {
  return resolveBuildStamp(createNodeBuildInfoDeps(bundleDir));
}

/**
 * A commit shortened for display.
 *
 * Twelve characters, because that is what `git rev-parse --short=12` produces and
 * what the build script stamps; a 40-character `GITHUB_SHA` is trimmed to match so
 * About shows the same length whichever source resolved. Shortening is display
 * only — nothing here needs the full form.
 */
export function shortCommit(commit: string, length: number = 12): string {
  return commit.length > length ? commit.slice(0, length) : commit;
}
