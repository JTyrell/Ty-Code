/**
 * Help-menu document reader (Prompt 5b Step 5, groups G1/G2).
 *
 * Free of `electron` so it can be unit-tested under plain Node: it reads files
 * through two injected functions and knows nothing about `app.isPackaged` or
 * `process.resourcesPath`. The bindings that supply those live in
 * `ipc/app-docs-handlers.ts`.
 *
 * The module answers one question — *given a document id, where is the real file
 * and what does it say?* — and refuses to answer any other. Three rules follow
 * from that.
 *
 *  - **Nothing is synthesised.** There is no fallback prose, no bundled copy of
 *    the privacy policy kept "just in case", and no cached snapshot from a
 *    previous read. If the file is not on disk, the caller gets a sentence
 *    naming the paths that were tried. A panel showing stale text about what
 *    Ty-Code does with your data is worse than a panel saying it cannot find the
 *    policy.
 *  - **The id never becomes a path in the renderer.** `APP_DOC_SOURCES` is the
 *    only place a document id meets a filesystem location, and it is typed
 *    `Record<AppDocId, AppDocSpec>` so adding an id to the contract without
 *    giving it a source is a compile error rather than a dead menu row.
 *  - **Candidates, not filenames.** Two of these files carry a version suffix,
 *    so each id lists patterns in preference order and the first one that
 *    resolves wins. `RELEASE_NOTES_v*.md` keeps matching after the next release
 *    renames the file, and the newest version sorts first when a repo happens to
 *    keep several.
 */

import path from 'node:path';
import type { IpcResponse } from '../../preload/types';
import {
  AppDocRequestSchema,
  AppDocSchema,
  type AppDoc,
  type AppDocFormat,
  type AppDocId
} from '../../shared/types/app-docs';

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export interface AppDocSpec {
  /** Used as the title only when the document has no heading of its own. */
  label: string;
  format: AppDocFormat;
  /** Repo-relative, tried in order. At most one `*`, within a single segment. */
  candidates: readonly string[];
}

/**
 * Every document the Help menu can open, and where to look for it.
 *
 * `README.md` heads the documentation list rather than `docs/GETTING_STARTED_*`
 * because the README is the document that actually describes the product; the
 * getting-started page is a two-minute install note and reads as a stub when a
 * user clicks "Documentation" expecting to learn what the thing does. Both are
 * listed so a repo that ships only one still resolves.
 *
 * The licence is `text`, not `markdown`: an MIT licence is laid out as
 * fixed-width-ish prose whose all-caps disclaimer paragraphs are meant to read
 * as a wall, and a markdown renderer would reflow the line breaks that make it
 * one.
 */
export const APP_DOC_SOURCES: Readonly<Record<AppDocId, AppDocSpec>> = {
  documentation: {
    label: 'Ty-Code Documentation',
    format: 'markdown',
    candidates: ['README.md', 'docs/GETTING_STARTED_v*.md', 'docs/GETTING_STARTED.md']
  },
  'release-notes': {
    label: 'Release Notes',
    format: 'markdown',
    candidates: ['RELEASE_NOTES_v*.md', 'RELEASE_NOTES.md', 'docs/RELEASE_NOTES_v*.md']
  },
  license: {
    label: 'License',
    format: 'text',
    candidates: ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
  },
  'privacy-policy': {
    label: 'Privacy Policy',
    format: 'markdown',
    candidates: ['docs/PRIVACY_POLICY.md', 'PRIVACY_POLICY.md']
  }
};

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface AppDocDeps {
  /**
   * Directories the allowlist's relative paths resolve against, tried in order.
   *
   * More than one because the same relative path has to work in two layouts: an
   * installed build, where the documents are packed alongside the bundle, and a
   * dev checkout, where they are the working tree the user is editing. Ordering
   * matters — the packaged copy goes first so a stale repo checkout cannot
   * override what actually shipped.
   */
  roots: readonly string[];
  /** UTF-8 text of an absolute path. Rejects when the file is absent. */
  readFile(absPath: string): Promise<string>;
  /** Entry names in an absolute directory. Rejects when it is absent. */
  listDir(absPath: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Longest document sent over IPC, in characters.
 *
 * Every file on the allowlist is a few kilobytes today, so this is not a
 * performance knob — it is the reason a future 40 MB `THIRD-PARTY.md` generated
 * from a lockfile cannot stall the renderer's main thread while `react-markdown`
 * walks it. Truncation is reported rather than silent: `bytes` stays the real
 * file size so the panel can say how much it cut.
 *
 * Counted in characters, not bytes, so the cut can never land inside a
 * multi-byte sequence and leave a replacement character at the end.
 */
const MAX_DOC_CHARS = 256_000;

/** Only this much of a file is scanned for a title. A heading below it is a section, not the title. */
const TITLE_SCAN_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Turn one allowlist pattern into the relative paths it could name.
 *
 * A pattern without `*` is returned unchanged and its existence is decided by
 * the read that follows, so the common case costs no directory listing. Two
 * wildcards resolve to nothing at all: the allowlist is meant to be readable at
 * a glance, and `a*b*c` is a glob engine nobody asked for.
 */
async function expandPattern(
  deps: AppDocDeps,
  root: string,
  pattern: string
): Promise<string[]> {
  const star = pattern.indexOf('*');
  if (star < 0) return [pattern];
  if (pattern.indexOf('*', star + 1) >= 0) return [];

  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  const slash = head.lastIndexOf('/');
  const dirRel = slash < 0 ? '' : head.slice(0, slash);
  const nameHead = slash < 0 ? head : head.slice(slash + 1);

  let entries: string[];
  try {
    entries = await deps.listDir(path.join(root, dirRel));
  } catch {
    // A missing directory is not an error here: it is how a packaged build says
    // "I have no docs/ folder", and the next root gets its turn.
    return [];
  }

  const matches = entries.filter(
    (name) =>
      name.length >= nameHead.length + tail.length &&
      name.startsWith(nameHead) &&
      name.endsWith(tail)
  );
  // Newest first, so a repo keeping both v1.0.0 and v1.1.0 release notes shows
  // the one the user means.
  matches.sort(compareVersionedDesc);
  return matches.map((name) => (dirRel ? `${dirRel}/${name}` : name));
}

/**
 * Descending order by embedded version numbers.
 *
 * Splits on digit runs and compares numerically where both sides have a number,
 * lexically otherwise. That is enough for `v1.0.0` vs `v1.10.0`, which a plain
 * string compare gets backwards — and getting it backwards would silently show
 * last year's release notes under "Show Release Notes".
 */
function compareVersionedDesc(a: string, b: string): number {
  const partsA = a.split(/(\d+)/).filter((part) => part.length > 0);
  const partsB = b.split(/(\d+)/).filter((part) => part.length > 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const left = partsA[i] ?? '';
    const right = partsB[i] ?? '';
    if (left === right) continue;
    const numLeft = Number(left);
    const numRight = Number(right);
    const bothNumeric =
      left.length > 0 && right.length > 0 && Number.isFinite(numLeft) && Number.isFinite(numRight);
    if (bothNumeric) return numRight - numLeft;
    return right < left ? -1 : 1;
  }
  return 0;
}

/**
 * Absolute path for a relative one, or `null` when it escapes the root.
 *
 * The relative path always comes from `APP_DOC_SOURCES` and never from a caller,
 * so this cannot be reached by a malicious renderer — the id is a `z.enum` and
 * the table is compiled in. It is here for the edit that comes later: someone
 * adding `'../secrets/keys.md'` to the table gets a refusal instead of a leak,
 * and the two checks (segment scan plus resolved-prefix) disagree on nothing but
 * each other's blind spots, so both are cheap insurance.
 */
function resolveContained(root: string, rel: string): string | null {
  if (rel.length === 0 || rel.includes('\0')) return null;
  if (rel.split(/[\\/]/).some((segment) => segment === '..')) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/**
 * The document's own title, or the allowlist label when it has none.
 *
 * Taken from the file rather than hard-coded so the panel cannot disagree with
 * what it is showing: an ATX heading first, then a short first non-empty line
 * (which is how `MIT License` titles itself), then the label. A label used as
 * the title is a fallback, not a substitute — the body underneath is still the
 * real file.
 */
function titleOf(content: string, fallback: string): string {
  const head = content.slice(0, TITLE_SCAN_CHARS);
  for (const line of head.split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && heading[1]) return clip(heading[1].trim(), 160);
  }
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    return trimmed.length <= 80 ? clip(trimmed, 160) : fallback;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read one allowlisted document.
 *
 * Returns the house envelope: `success: false` with a sentence when the request
 * is malformed or no candidate exists, `success: true` with the file's text
 * otherwise. A file that exists but cannot be decoded is reported as missing
 * rather than as empty — an empty document panel and an absent one look the same
 * to a user, and only one of those is true.
 */
export async function readAppDoc(
  deps: AppDocDeps,
  payload?: unknown
): Promise<IpcResponse<AppDoc>> {
  const parsed = AppDocRequestSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: `Document request failed validation: ${describeIssues(parsed.error)}`
    };
  }

  const id: AppDocId = parsed.data.id;
  const spec = APP_DOC_SOURCES[id];
  const tried: string[] = [];

  for (const root of deps.roots) {
    for (const pattern of spec.candidates) {
      tried.push(pattern);
      for (const rel of await expandPattern(deps, root, pattern)) {
        const abs = resolveContained(root, rel);
        if (!abs) continue;

        let content: string;
        try {
          content = await deps.readFile(abs);
        } catch {
          // Absent, unreadable, or a directory that happened to match the
          // pattern. All three mean "try the next candidate", and distinguishing
          // them would only add a way for this menu to fail loudly over
          // something the user cannot act on.
          continue;
        }

        const bytes = Buffer.byteLength(content, 'utf8');
        const truncated = content.length > MAX_DOC_CHARS;
        const doc: AppDoc = {
          id,
          title: titleOf(content, spec.label),
          // Repo-relative, so the panel can name its source without printing the
          // build machine's directory layout.
          source: rel,
          format: spec.format,
          content: truncated ? content.slice(0, MAX_DOC_CHARS) : content,
          bytes,
          truncated
        };

        const validated = AppDocSchema.safeParse(doc);
        if (!validated.success) {
          return {
            success: false,
            error: `Document "${id}" was read but failed validation: ${describeIssues(validated.error)}`
          };
        }
        return { success: true, data: validated.data };
      }
    }
  }

  return {
    success: false,
    error:
      `This build ships no copy of the ${spec.label.toLowerCase()} — ` +
      `looked for ${tried.join(', ')}.`
  };
}
