/**
 * Help-menu document reader tests (Prompt 5b Step 5, groups G1/G2).
 *
 * Runs in pure Node against an in-memory filesystem. The real one cannot arrange
 * the cases that matter here: a packaged archive with no `docs/` folder, a repo
 * that renamed its release notes, a licence file that grew past the read cap, a
 * version suffix that sorts wrongly under a plain string compare.
 *
 * The properties proved, in the order the panel depends on them:
 *
 *  - **The renderer's payload cannot reach a path.** The id is a `z.enum` and
 *    the id-to-path table is compiled into main, so traversal is not "guarded
 *    against" — it is unrepresentable. Asserted directly, because that is the
 *    whole reason this is an allowlist rather than a `readFile` over IPC.
 *  - **What is on disk is what the user sees.** No fallback prose, no bundled
 *    copy kept "just in case", no cache from a previous read. A document this
 *    build does not ship comes back as a sentence naming what was tried.
 *  - **Candidates survive a rename.** Two of these files carry a version suffix,
 *    so a hard-coded filename would become a dead click at the next release.
 *  - **Truncation is reported, never silent.** `bytes` stays the real file size
 *    so the panel can say how much it cut.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_DOC_IDS } from '../../shared/types/app-docs';
import { APP_DOC_SOURCES, readAppDoc, type AppDocDeps } from './app-docs-service';

// ---------------------------------------------------------------------------
// An in-memory filesystem
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.sep, 'app');
const PACKAGED_ROOT = path.resolve(path.sep, 'packaged');

/**
 * Deps backed by a map of absolute path to file text.
 *
 * `listDir` is derived from the same map rather than stored separately, so the
 * two cannot disagree — a directory exists exactly when some file lives under
 * it. It rejects when the directory is absent, matching `readdir`'s `ENOENT`,
 * which is how a packaged build with no `docs/` folder has to behave for the
 * candidate walk to move on.
 */
function depsWith(
  files: Record<string, string>,
  roots: readonly string[] = [ROOT]
): AppDocDeps {
  const map = new Map(Object.entries(files));
  return {
    roots,
    readFile: async (absPath: string) => {
      const found = map.get(absPath);
      if (found === undefined) throw new Error(`ENOENT: ${absPath}`);
      return found;
    },
    listDir: async (absPath: string) => {
      const prefix = absPath.endsWith(path.sep) ? absPath : absPath + path.sep;
      const names = new Set<string>();
      for (const key of map.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const segment = rest.split(path.sep)[0];
        if (segment) names.add(segment);
      }
      if (names.size === 0) throw new Error(`ENOENT: ${absPath}`);
      return [...names];
    }
  };
}

/** Absolute path for a repo-relative one under the default root. */
function at(relPath: string): string {
  return path.join(ROOT, ...relPath.split('/'));
}

describe('readAppDoc', () => {
  it('returns the file verbatim, with a repo-relative source', async () => {
    const body = '# Ty-Code\n\nReal prose from the working tree.\n';
    const deps = depsWith({ [at('README.md')]: body });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'documentation',
      title: 'Ty-Code',
      source: 'README.md',
      format: 'markdown',
      content: body,
      truncated: false
    });
    // Not synthesised, not trimmed, not normalised: the panel shows the bytes.
    expect(result.data?.content).toBe(body);
  });

  it('counts bytes, not characters, so a multi-byte document reports its real size', async () => {
    const body = '# 題名\n\ncafé — 日本語\n';
    const deps = depsWith({ [at('README.md')]: body });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.data?.bytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(result.data?.bytes).toBeGreaterThan(body.length);
  });

  it('renders the licence as text, not markdown', async () => {
    // An MIT licence is laid out as fixed-width-ish prose whose all-caps
    // disclaimer paragraphs are meant to read as a wall. A markdown renderer
    // would reflow the line breaks that make it one.
    const deps = depsWith({ [at('LICENSE')]: 'MIT License\n\nCopyright (c) 2026\n' });

    const result = await readAppDoc(deps, { id: 'license' });

    expect(result.data?.format).toBe('text');
  });

  // -------------------------------------------------------------------------
  // The allowlist is the security boundary
  // -------------------------------------------------------------------------

  it('ignores extra keys in the request, so a payload cannot smuggle a path', async () => {
    const deps = depsWith({ [at('LICENSE')]: 'MIT License\n' });

    const result = await readAppDoc(deps, {
      id: 'license',
      path: '../../../../etc/passwd',
      source: '/absolute/elsewhere',
      candidates: ['../../secrets.md']
    });

    expect(result.success).toBe(true);
    expect(result.data?.source).toBe('LICENSE');
  });

  it('rejects an id that is not on the allowlist', async () => {
    const deps = depsWith({ [at('README.md')]: '# Ty-Code\n' });

    for (const bad of ['../../etc/passwd', 'README.md', '', null, 42, undefined]) {
      const result = await readAppDoc(deps, { id: bad });

      expect(result.success, `id ${String(bad)}`).toBe(false);
      expect(result.data, `id ${String(bad)}`).toBeUndefined();
      expect(result.error, `id ${String(bad)}`).toMatch(/validation/i);
      // The refusal names the schema, never a filesystem location — there is no
      // path to leak, because the caller never supplied one.
      expect(result.error, `id ${String(bad)}`).not.toMatch(/etc|passwd/);
    }
  });

  it('rejects a missing payload rather than defaulting to some document', async () => {
    const deps = depsWith({ [at('README.md')]: '# Ty-Code\n' });

    const result = await readAppDoc(deps);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/validation/i);
  });

  // -------------------------------------------------------------------------
  // Candidate resolution
  // -------------------------------------------------------------------------

  it('walks to the next candidate when the first is absent', async () => {
    const deps = depsWith({ [at('docs/GETTING_STARTED_v1.0.0.md')]: '# Getting Started\n' });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.success).toBe(true);
    // Forward slashes even on Windows: the source is displayed, and a path
    // separator from the build machine is noise in a screenshot.
    expect(result.data?.source).toBe('docs/GETTING_STARTED_v1.0.0.md');
  });

  it('picks the newest version when several match a wildcard', async () => {
    const deps = depsWith({
      [at('RELEASE_NOTES_v1.0.0.md')]: '# 1.0.0\n',
      [at('RELEASE_NOTES_v1.2.0.md')]: '# 1.2.0\n',
      [at('RELEASE_NOTES_v1.10.0.md')]: '# 1.10.0\n'
    });

    const result = await readAppDoc(deps, { id: 'release-notes' });

    // A plain string compare puts v1.10.0 *last*, which would silently show
    // last year's release notes under "Show Release Notes".
    expect(result.data?.source).toBe('RELEASE_NOTES_v1.10.0.md');
  });

  it('does not match a file that only shares the pattern prefix', async () => {
    const deps = depsWith({
      [at('RELEASE_NOTES_v1.0.0.md.bak')]: '# stale\n',
      [at('RELEASE_NOTES.md')]: '# Current\n'
    });

    const result = await readAppDoc(deps, { id: 'release-notes' });

    expect(result.data?.source).toBe('RELEASE_NOTES.md');
  });

  it('prefers the first root, so a stale checkout cannot override what shipped', async () => {
    const deps = depsWith(
      {
        [path.join(PACKAGED_ROOT, 'LICENSE')]: 'MIT License (shipped)\n',
        [at('LICENSE')]: 'MIT License (working tree)\n'
      },
      [PACKAGED_ROOT, ROOT]
    );

    const result = await readAppDoc(deps, { id: 'license' });

    expect(result.data?.content).toBe('MIT License (shipped)\n');
  });

  it('keeps looking in the next root when a directory is missing entirely', async () => {
    const deps = depsWith({ [at('docs/PRIVACY_POLICY.md')]: '# Privacy\n' }, [PACKAGED_ROOT, ROOT]);

    const result = await readAppDoc(deps, { id: 'privacy-policy' });

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Privacy');
  });

  it('reports a missing document by naming every path it tried', async () => {
    const deps = depsWith({ [at('README.md')]: '# Ty-Code\n' });

    const result = await readAppDoc(deps, { id: 'license' });

    expect(result.success).toBe(false);
    // The sentence has to be actionable. "Not found" alone leaves a user with no
    // way to tell a packaging bug from a repository that genuinely has no licence.
    expect(result.error).toMatch(/license/i);
    expect(result.error).toMatch(/LICENSE, LICENSE\.md, LICENSE\.txt/);
    expect(result.error).not.toMatch(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  });

  // -------------------------------------------------------------------------
  // Titles
  // -------------------------------------------------------------------------

  it('takes the title from the document rather than from the allowlist', async () => {
    const deps = depsWith({ [at('README.md')]: 'Some preamble\n\n## Real Heading ##\n' });

    const result = await readAppDoc(deps, { id: 'documentation' });

    // Closing hashes stripped: an ATX heading may close itself, and the panel
    // would otherwise show "Real Heading ##" as a window title.
    expect(result.data?.title).toBe('Real Heading');
  });

  it('falls back to a short first line, which is how a licence titles itself', async () => {
    const deps = depsWith({ [at('LICENSE')]: 'MIT License\n\nPermission is hereby granted...\n' });

    const result = await readAppDoc(deps, { id: 'license' });

    expect(result.data?.title).toBe('MIT License');
  });

  it('uses the allowlist label when the first line is a paragraph, not a title', async () => {
    const long = 'x'.repeat(120);
    const deps = depsWith({ [at('LICENSE')]: `${long}\n` });

    const result = await readAppDoc(deps, { id: 'license' });

    // A 120-character opening line is body text. Truncating it into a title bar
    // would produce something that reads like a heading and is not one.
    expect(result.data?.title).toBe('License');
  });

  it('clips a heading to the schema budget instead of failing the parse', async () => {
    const deps = depsWith({ [at('README.md')]: `# ${'y'.repeat(300)}\n` });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.success).toBe(true);
    expect(result.data?.title).toHaveLength(160);
    expect(result.data?.title?.endsWith('…')).toBe(true);
  });

  it('reads an empty file as an empty document rather than as a missing one', async () => {
    const deps = depsWith({ [at('LICENSE')]: '' });

    const result = await readAppDoc(deps, { id: 'license' });

    // The file exists, so saying it does not would be a lie in the other
    // direction. The panel shows an empty document and the title falls back to
    // the label, which is the truth about a zero-byte licence.
    expect(result.success).toBe(true);
    expect(result.data?.content).toBe('');
    expect(result.data?.bytes).toBe(0);
    expect(result.data?.title).toBe('License');
  });

  // -------------------------------------------------------------------------
  // Limits
  // -------------------------------------------------------------------------

  it('truncates an oversized document and says how much it cut', async () => {
    const body = `# Big\n\n${'z'.repeat(300_000)}`;
    const deps = depsWith({ [at('README.md')]: body });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.data?.truncated).toBe(true);
    // Counted in characters, so the cut can never land inside a multi-byte
    // sequence and leave a replacement character at the end of the panel.
    expect(result.data?.content).toHaveLength(256_000);
    expect(result.data?.bytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(result.data?.content).toBe(body.slice(0, 256_000));
  });

  it('does not truncate a document that fits', async () => {
    const body = 'a'.repeat(256_000);
    const deps = depsWith({ [at('README.md')]: body });

    const result = await readAppDoc(deps, { id: 'documentation' });

    expect(result.data?.truncated).toBe(false);
    expect(result.data?.content).toHaveLength(256_000);
  });
});

describe('APP_DOC_SOURCES', () => {
  it('gives every allowlisted id a usable source', () => {
    // A compile-time `Record<AppDocId, …>` already refuses a missing key, but
    // nothing stops that key mapping to an empty candidate list — which would be
    // a menu row that always reports "not found". Cheap to check at runtime.
    for (const id of APP_DOC_IDS) {
      const spec = APP_DOC_SOURCES[id];
      expect(spec, `${id} has no spec`).toBeDefined();
      expect(spec.label.length, `${id} label`).toBeGreaterThan(0);
      expect(spec.candidates.length, `${id} candidates`).toBeGreaterThan(0);
      expect(['markdown', 'text'], `${id} format`).toContain(spec.format);
    }
  });

  it('keeps every candidate inside the root and free of absolute paths', () => {
    for (const [id, spec] of Object.entries(APP_DOC_SOURCES)) {
      for (const candidate of spec.candidates) {
        expect(path.isAbsolute(candidate), `${id}: ${candidate}`).toBe(false);
        expect(candidate.split(/[\\/]/), `${id}: ${candidate}`).not.toContain('..');
        // At most one wildcard, within a single segment: the allowlist is meant
        // to be readable at a glance, and two stars would be a glob engine
        // nobody asked for.
        expect(candidate.split('*').length - 1, `${id}: ${candidate}`).toBeLessThanOrEqual(1);
        // Forward slashes only. `expandPattern` locates the directory part with
        // `head.lastIndexOf('/')`, so a backslash candidate lists the root and
        // then looks for an entry literally named `docs\RELEASE_NOTES_v*.md`.
        // That can never match, and it fails silently as "document not found"
        // rather than as an error — the worst shape for a help menu row.
        expect(candidate, `${id}: ${candidate}`).not.toContain('\\');
        // The "within a single segment" half of the rule above. A wildcard's
        // tail is matched with `endsWith` against one directory entry, so a
        // separator after the star is another pattern that can never match.
        const star = candidate.indexOf('*');
        if (star >= 0) {
          expect(candidate.slice(star + 1), `${id}: ${candidate}`).not.toContain('/');
        }
      }
    }
  });

  it('maps exactly the four documents the Help menu names', () => {
    expect([...APP_DOC_IDS].sort()).toEqual(
      ['documentation', 'license', 'privacy-policy', 'release-notes'].sort()
    );
    expect(Object.keys(APP_DOC_SOURCES).sort()).toEqual([...APP_DOC_IDS].sort());
  });
});
