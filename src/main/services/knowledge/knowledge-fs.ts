/**
 * Prompt C — Knowledge-layer filesystem foundation.
 *
 * Shared, strictly-local helpers used by the Wiki generator, Rules engine and
 * Semantic index. Responsibilities:
 *  - honor `.tycodeignore` (user patterns) on top of the Context Engine's built-in
 *    ignore set (IGNORED_DIRECTORIES / SKIP_PATTERNS),
 *  - collect a bounded snapshot of source files with content hashes so callers can
 *    detect drift cheaply and incrementally,
 *  - never read past a per-file / per-scan byte budget (a huge monorepo must not
 *    freeze the main process or blow memory).
 *
 * No network. No Electron. Everything stays inside the workspace / ~/.tycode.
 */

import fsp from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  walkWorkspace,
  IGNORED_DIRECTORIES,
  SKIP_PATTERNS,
  SOURCE_EXTENSIONS
} from '../context-engine/fingerprint';

/** Files whose content we ever hash/embed. Dot-directories and built assets are excluded upstream. */
const MAX_SCAN_FILES = 4000;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file for hashing/reading
const TYCODE_DIR = '.tycode';

/**
 * Reads `.tycodeignore` at the workspace root (if present) and returns the raw
 * patterns (comments/blank lines dropped). Missing file → empty list.
 */
export async function loadTycodeIgnore(workspaceRoot: string): Promise<string[]> {
  try {
    const text = await fsp.readFile(path.join(workspaceRoot, '.tycodeignore'), 'utf-8');
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Compiles the non-negated patterns in a `.tycodeignore` list into a matcher.
 * Supports: basename match (`*.log`), directory prefix (`build/`), path glob with
 * `*` (single segment) and `**` (any depth). Negation (`!`) is intentionally not
 * applied to keep the semantics conservative — an ignored path stays ignored.
 */
export function buildIgnoreMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  const normalized = patterns
    .filter((p) => p && !p.startsWith('!'))
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (normalized.length === 0) return () => false;

  const regexes: RegExp[] = normalized.map((p) => new RegExp(`^${patternToRegexSource(p)}$`, 'i'));
  return (relPath: string): boolean => {
    const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = rel.split('/');
    for (const re of regexes) {
      if (re.test(rel)) return true;
    }
    // A directory pattern like `dist/` also matches anything beneath it; test each
    // ancestor path segment so nested files are covered even for bare `name` entries.
    for (let i = 0; i < segments.length - 1; i++) {
      const ancestor = segments.slice(0, i + 1).join('/') + '/';
      for (const raw of normalized) {
        if (raw.endsWith('/') && (ancestor === raw || ancestor.startsWith(raw) || raw.replace(/\/$/, '') === segments[i])) {
          return true;
        }
      }
    }
    return false;
  };
}

function patternToRegexSource(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**` → any chars including `/`
        out += '.*';
        i++; // consume the second star
        if (pattern[i + 1] === '/') i++; // collapse `**/`
      } else {
        // `*` → any chars except `/`
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  // A bare pattern with no separator matches on basename anywhere in the tree.
  if (!pattern.includes('/')) {
    return `(?:.*/)?${out}`;
  }
  return out;
}

/** Built-in exclusions shared by every knowledge consumer (never .tycode itself, which holds our output). */
function isBuiltInIgnored(relPath: string): boolean {
  const rel = relPath.replace(/\\/g, '/');
  const segments = rel.split('/');
  if (segments.some((s) => IGNORED_DIRECTORIES.has(s))) return true;
  if (segments[0] === TYCODE_DIR) return true;
  const name = segments[segments.length - 1] || '';
  return SKIP_PATTERNS.some((re) => re.test(name));
}

export interface SourceFileSnapshot {
  /** workspace-relative, forward-slash path */
  relPath: string;
  /** sha1 hex of the file bytes */
  hash: string;
  /** byte length */
  size: number;
}

export interface SnapshotOptions {
  /** restrict to SOURCE_EXTENSIONS only (default true); false includes manifests/docs too */
  sourceOnly?: boolean;
  maxFiles?: number;
}

/**
 * Walks the workspace and returns a content-hash snapshot of the files the
 * knowledge layer cares about, honoring built-in ignores + `.tycodeignore`.
 * Deterministic (sorted by path) so a snapshot hash is stable across runs.
 */
export async function snapshotWorkspace(
  workspaceRoot: string,
  ignorePatterns: readonly string[],
  options: SnapshotOptions = {}
): Promise<SourceFileSnapshot[]> {
  const resolved = path.resolve(workspaceRoot);
  const { files } = await walkWorkspace(resolved, 8);
  const isIgnored = buildIgnoreMatcher(ignorePatterns);
  const sourceOnly = options.sourceOnly !== false;
  const maxFiles = options.maxFiles ?? MAX_SCAN_FILES;

  const out: SourceFileSnapshot[] = [];
  for (const f of files) {
    if (out.length >= maxFiles) break;
    if (isBuiltInIgnored(f.relativePath)) continue;
    if (isIgnored(f.relativePath)) continue;
    const ext = path.extname(f.name).toLowerCase();
    if (sourceOnly && !SOURCE_EXTENSIONS.has(ext)) continue;
    const snap = await hashFile(path.join(resolved, f.relativePath));
    if (snap) out.push({ relPath: f.relativePath, ...snap });
  }
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;
}

async function hashFile(abs: string): Promise<{ hash: string; size: number } | null> {
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const buf = await fsp.readFile(abs);
    return { hash: crypto.createHash('sha1').update(buf).digest('hex'), size: stat.size };
  } catch {
    return null;
  }
}

/** Aggregate hash over a snapshot (path→hash pairs), stable regardless of ordering. */
export function aggregateSnapshotHash(snapshot: readonly SourceFileSnapshot[]): string {
  const h = crypto.createHash('sha256');
  for (const f of snapshot) h.update(`${f.relPath}\u0000${f.hash}\n`);
  return h.digest('hex').slice(0, 32);
}

/**
 * Diffs two snapshots and reports added / removed / changed relative paths.
 * Used for wiki drift detection and incremental index updates.
 */
export function diffSnapshots(
  previous: readonly SourceFileSnapshot[],
  current: readonly SourceFileSnapshot[]
): { added: string[]; removed: string[]; changed: string[] } {
  const prev = new Map(previous.map((f) => [f.relPath, f.hash]));
  const curr = new Map(current.map((f) => [f.relPath, f.hash]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [p, hash] of curr) {
    if (!prev.has(p)) added.push(p);
    else if (prev.get(p) !== hash) changed.push(p);
  }
  for (const p of prev.keys()) if (!curr.has(p)) removed.push(p);
  return { added, removed, changed };
}

/** Safe small-file reader (bounded) reused for building generation context packs. */
export async function readCapped(abs: string, maxBytes = MAX_FILE_BYTES): Promise<string | null> {
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await fsp.readFile(abs, 'utf-8');
  } catch {
    return null;
  }
}

export function ensureDirSync(dir: string): void {
  fsSync.mkdirSync(dir, { recursive: true });
}
