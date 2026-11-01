/**
 * Phase 4 Step 2 — Per-hunk compose (pure).
 *
 * `composeAcceptedHunks(originalText, hunks, acceptedIds)` reconstructs the
 * file you get when only some hunks are accepted, without touching disk or
 * invoking a diff library. Kept intentionally side-effect free so the caller
 * can feed the result straight into `WorkspaceEditPreviewService` and land a
 * single composed patch through the Safe Edit Review Gate.
 *
 * A hunk carries the *original* line range it replaces and the *new* line
 * contents it introduces. Ranges are 1-indexed, end-exclusive, and must be
 * ordered ascending by `oldStart` (the parser upstream guarantees this;
 * unordered input throws rather than silently mangling the file).
 */

export interface ComposeHunk {
  readonly id: string;
  /** 1-indexed first original line the hunk replaces. */
  readonly oldStart: number;
  /** Count of original lines the hunk spans (0 for pure insertions). */
  readonly oldLines: number;
  /** Replacement lines (already split, no trailing newline). */
  readonly newLines: readonly string[];
}

/**
 * Compose the accepted subset of `hunks` onto `originalText`.
 *
 * @throws if hunk ranges overlap, run off either end of the file, or arrive
 *   out of order — a silent wrong-merge is worse than a loud failure.
 */
export function composeAcceptedHunks(
  originalText: string,
  hunks: readonly ComposeHunk[],
  acceptedIds: ReadonlySet<string>
): string {
  const lines = splitKeepEol(originalText);
  const kept = lines.map((l) => l.text);
  // Filter to accepted, preserving input order.
  const accepted = hunks.filter((h) => acceptedIds.has(h.id));
  // Ordering guard: parse-order must equal positional order.
  for (let i = 1; i < accepted.length; i++) {
    const prev = accepted[i - 1];
    const cur = accepted[i];
    if (cur.oldStart < prev.oldStart + prev.oldLines) {
      throw new Error(
        `composeAcceptedHunks: overlapping or out-of-order hunks (${prev.id} @${prev.oldStart}+${prev.oldLines} vs ${cur.id} @${cur.oldStart})`
      );
    }
  }
  // Rebuild from bottom to top so earlier edits do not shift later indices.
  const out = [...kept];
  for (let i = accepted.length - 1; i >= 0; i--) {
    const h = accepted[i];
    if (h.oldStart < 1) throw new Error(`composeAcceptedHunks: hunk ${h.id} has oldStart<1`);
    if (h.oldStart - 1 + h.oldLines > out.length) {
      throw new Error(
        `composeAcceptedHunks: hunk ${h.id} extends past end of file (oldStart=${h.oldStart}, oldLines=${h.oldLines}, len=${out.length})`
      );
    }
    out.splice(h.oldStart - 1, h.oldLines, ...h.newLines);
  }
  // Rejoin preserving each line's original EOL where possible; the caller
  // gets one consistent string, and mixed-EOL files stay mixed-EOL.
  return joinWithEol(out, lines);
}

/**
 * Split into lines but remember each line's original EOL terminator so we can
 * re-join faithfully. The trailing chunk (past the last newline) may have no
 * EOL — that is what `eol === ''` records.
 */
function splitKeepEol(text: string): Array<{ text: string; eol: string }> {
  if (text === '') return [];
  const out: Array<{ text: string; eol: string }> = [];
  let i = 0;
  let buf = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        out.push({ text: buf, eol: '\r\n' });
        buf = '';
        i += 2;
        continue;
      }
      out.push({ text: buf, eol: '\r' });
      buf = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      out.push({ text: buf, eol: '\n' });
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.length > 0) out.push({ text: buf, eol: '' });
  return out;
}

function joinWithEol(lines: readonly string[], original: readonly { text: string; eol: string }[]): string {
  // Reuse each kept line's original EOL by position; new inserted lines get
  // the file's dominant EOL, or `\n` if the file had none.
  const dominant = pickDominantEol(original);
  const hadTrailingNewline =
    original.length > 0 && original[original.length - 1].eol !== '';
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    out += lines[i];
    const isLast = i === lines.length - 1;
    if (!isLast) {
      out += original[i]?.eol && original[i].eol !== '' ? original[i].eol : dominant;
    } else if (hadTrailingNewline) {
      // Preserve the trailing newline the original had; use its own EOL when
      // the position still lines up, otherwise the dominant one.
      out += original[i]?.eol && original[i].eol !== '' ? original[i].eol : dominant;
    }
  }
  return out;
}

function pickDominantEol(lines: readonly { eol: string }[]): string {
  let lf = 0;
  let crlf = 0;
  for (const l of lines) {
    if (l.eol === '\n') lf++;
    else if (l.eol === '\r\n') crlf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}
