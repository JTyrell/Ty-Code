/**
 * composeAcceptedHunks tests (Phase 4).
 *
 * Property-flavored: no I/O, no fixture files, every case is a straight
 * string in → string out assertion. The critical invariants we hold:
 *  - Accept-all is a no-op on the ordering: applying every hunk produces the
 *    full-diff text, not a scrambled one.
 *  - Reject-all is identity: passing an empty accept set returns the input
 *    verbatim, byte-for-byte (including EOL and any trailing newline).
 *  - Ordering/overlap errors fire loudly; a silent mis-merge is worse.
 */

import { describe, expect, it } from 'vitest';
import { composeAcceptedHunks, type ComposeHunk } from './git-hunk-compose';

const hunk = (
  id: string,
  oldStart: number,
  oldLines: number,
  newLines: string[]
): ComposeHunk => ({ id, oldStart, oldLines, newLines });

describe('composeAcceptedHunks', () => {
  it('empty accept set returns the input verbatim (reject-all is identity)', () => {
    const src = 'line1\nline2\nline3\n';
    const hunks = [hunk('a', 1, 1, ['X']), hunk('b', 3, 1, ['Y'])];
    expect(composeAcceptedHunks(src, hunks, new Set())).toBe(src);
  });

  it('accept-all produces the fully patched text', () => {
    const src = 'line1\nline2\nline3\n';
    const hunks = [
      hunk('a', 1, 1, ['LINE ONE']),
      hunk('b', 3, 1, ['LINE THREE'])
    ];
    const out = composeAcceptedHunks(src, hunks, new Set(['a', 'b']));
    expect(out).toBe('LINE ONE\nline2\nLINE THREE\n');
  });

  it('accepting only the first hunk leaves the untouched lines intact', () => {
    const src = 'a\nb\nc\nd\ne\n';
    const hunks = [
      hunk('h1', 1, 1, ['A']),
      hunk('h2', 5, 1, ['E'])
    ];
    const out = composeAcceptedHunks(src, hunks, new Set(['h1']));
    expect(out).toBe('A\nb\nc\nd\ne\n');
  });

  it('a hunk that inserts lines increases the file length', () => {
    const src = 'x\ny\n';
    const hunks = [hunk('ins', 1, 0, ['before-x'])];
    const out = composeAcceptedHunks(src, hunks, new Set(['ins']));
    expect(out).toBe('before-x\nx\ny\n');
  });

  it('a hunk that deletes lines contracts the file', () => {
    const src = 'keep\ndrop\ndrop\ntail\n';
    const hunks = [hunk('del', 2, 2, [])];
    const out = composeAcceptedHunks(src, hunks, new Set(['del']));
    expect(out).toBe('keep\ntail\n');
  });

  it('preserves CRLF when the original file was CRLF', () => {
    const src = 'a\r\nb\r\nc\r\n';
    const hunks = [hunk('a', 2, 1, ['B'])];
    const out = composeAcceptedHunks(src, hunks, new Set(['a']));
    expect(out).toBe('a\r\nB\r\nc\r\n');
  });

  it('preserves a missing trailing newline (no fabricated one)', () => {
    const src = 'a\nb\nc';
    const hunks = [hunk('c', 3, 1, ['C'])];
    const out = composeAcceptedHunks(src, hunks, new Set(['c']));
    expect(out).toBe('a\nb\nC');
  });

  it('throws on overlapping hunks instead of silently scrambling the file', () => {
    const src = 'a\nb\nc\n';
    const hunks = [
      hunk('first', 1, 2, ['X']),
      hunk('second', 2, 2, ['Y']) // overlaps `first`
    ];
    expect(() => composeAcceptedHunks(src, hunks, new Set(['first', 'second']))).toThrow(/overlapping|out-of-order/);
  });

  it('throws when a hunk extends past the end of the file', () => {
    const src = 'a\nb\n';
    const hunks = [hunk('too-far', 1, 10, ['X'])];
    expect(() => composeAcceptedHunks(src, hunks, new Set(['too-far']))).toThrow(/extends past end of file/);
  });

  it('applies hunks bottom-up so an accepted earlier hunk does not shift a later one', () => {
    // Line 1 replaced AND line 3 replaced; a naive top-down splice would make
    // the second edit fall off the file if the first edit grew the buffer.
    const src = 'one\ntwo\nthree\n';
    const hunks = [
      hunk('a', 1, 1, ['ONE', 'EXTRA']),
      hunk('b', 3, 1, ['THREE'])
    ];
    const out = composeAcceptedHunks(src, hunks, new Set(['a', 'b']));
    expect(out).toBe('ONE\nEXTRA\ntwo\nTHREE\n');
  });
});
