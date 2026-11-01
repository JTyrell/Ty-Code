#!/usr/bin/env node
/**
 * Build stamp: write `dist/main/build-info.json` (Prompt 5b Step 5, Help > About).
 *
 * About has to name the commit it was built from. There is no honest way to get
 * that at runtime in an installed app — the archive ships no `.git`, and the
 * binary does not remember how it was made — so the value has to be captured
 * while the build machine still knows it and written somewhere the bundle can
 * read back.
 *
 * Why `dist/main/` and not a committed file or an `extraResources` entry:
 * `electron-builder.yml` already packs everything under `dist/main/` into the
 * archive, so a
 * file written here ships for free. Nothing is added to version control (a
 * committed stamp would be wrong the moment anyone built from a different
 * checkout), and no second packaging rule has to be kept in step with the first.
 * The reader is `src/main/services/build-info.ts`, which falls back to
 * `.git/HEAD` when this file is absent — that is the dev path, where
 * `scripts/dev.mjs` runs esbuild directly and never invokes this script.
 *
 * Resolution order, first hit wins:
 *   1. `TYCODE_COMMIT`  — explicit override, for a build driven outside git.
 *   2. `GITHUB_SHA`     — set by Actions in every step, full 40 characters.
 *   3. `git rev-parse`  — a local build from a working checkout.
 *
 * The stamp never fails the build. A missing or unknown commit is an absent
 * field, and About renders an absent commit by leaving the row out; inventing a
 * placeholder would put a SHA-shaped string on screen that points at nothing.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist', 'main');
const OUT_FILE = path.join(OUT_DIR, 'build-info.json');

/**
 * What a commit is allowed to look like.
 *
 * Narrow on purpose: the value ends up rendered in the About dialog, so a
 * stray shell error message or a `fatal: not a git repository` line captured
 * from stdout must not become the thing a user reads as the build identity.
 * Anything that is not hex is discarded rather than truncated.
 */
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

function normaliseCommit(raw) {
  const candidate = String(raw ?? '').trim().toLowerCase();
  return COMMIT_RE.test(candidate) ? candidate : null;
}

function envCommit() {
  return normaliseCommit(process.env.TYCODE_COMMIT) || normaliseCommit(process.env.GITHUB_SHA);
}

/**
 * The local checkout's HEAD, without a shell.
 *
 * `execFileSync` with an argument array and no `shell` option, so nothing here
 * is interpolated into a command line. Failure is ordinary — no git binary, a
 * source tarball, a detached sandbox — and returns null so the caller can stamp
 * a build that simply has no commit to name.
 */
function gitCommit() {
  try {
    const stdout = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      windowsHide: true
    });
    return normaliseCommit(stdout);
  } catch {
    return null;
  }
}

const commit = envCommit() ?? gitCommit();

const info = {
  // Stamped at build time, so About can distinguish "built from this commit"
  // from "this commit was checked out when the stamp ran". They differ on a
  // dirty working tree, and the dirty flag below is what says so.
  generatedAt: new Date().toISOString(),
  schemaVersion: 1
};

if (commit) info.commit = commit;

try {
  // A dirty tree is recorded rather than hidden: a build made from uncommitted
  // edits carries a commit that does not fully describe it, and About saying
  // "abc1234 (modified)" is the difference between a reproducible report and a
  // misleading one.
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    windowsHide: true
  });
  info.dirty = status.trim().length > 0;
} catch {
  // No git, so no opinion on cleanliness. Omitted, not defaulted to false —
  // `dirty: false` would assert something this build could not check.
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

const relative = path.relative(ROOT, OUT_FILE).replace(/\\/g, '/');
console.log(
  `[stamp-build-info] ${relative}: ${
    commit ? `${commit}${info.dirty ? ' (modified working tree)' : ''}` : 'no commit resolved'
  }`
);
