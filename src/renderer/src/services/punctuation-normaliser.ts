/**
 * Code-Safe UK English Punctuation Normaliser (Prompt 2)
 *
 * Eliminates "AI punctuation" (em dashes, spaced en dashes, ellipsis characters)
 * from assistant chat responses and enforces standard UK English style without
 * corrupting code blocks, inline code spans, or numeric ranges.
 *
 * Invariant: Fenced code blocks and inline code are preserved byte-for-byte.
 * Segmentation occurs before transformation so regexes never touch code tokens.
 *
 * Brand: Ty-Code
 */

export interface MarkdownSegment {
  type: 'code' | 'prose';
  text: string;
}

export interface NormaliseOptions {
  enabled?: boolean;
}

/**
 * Splits raw markdown into fenced code blocks, inline code spans, and prose segments.
 * Handles both complete blocks and unclosed streaming blocks at end of buffer.
 */
export function segmentMarkdown(markdown: string): MarkdownSegment[] {
  if (!markdown) return [];

  const segments: MarkdownSegment[] = [];

  // Match:
  // 1. Triple-backtick fenced blocks: ```...``` (or unclosed at end of buffer)
  // 2. Triple-tilde fenced blocks: ~~~...~~~ (or unclosed at end of buffer)
  // 3. Multi/single backtick inline code: `...` or ``...``
  const codeRegex = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]+`+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'prose',
        text: markdown.slice(lastIndex, match.index)
      });
    }
    segments.push({
      type: 'code',
      text: match[0]
    });
    lastIndex = codeRegex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    segments.push({
      type: 'prose',
      text: markdown.slice(lastIndex)
    });
  }

  return segments;
}

/**
 * Transforms a prose segment according to standard UK English punctuation:
 * - Replaces "…" with "..."
 * - Protects unspaced en dashes in numeric ranges (e.g. 1999–2005, 10–20, 2020–2026)
 * - Replaces spaced em dashes " — " with ", "
 * - Replaces paired / unspaced parenthetical em dashes with commas
 * - Replaces spaced en dashes " – " with ", "
 * - Restores protected numeric range en dashes
 * - Cleans up spacing artifacts and collapses double spaces (preserving newlines)
 */
export function transformProseLine(line: string): string {
  if (!line) return '';

  // 1. Replace ellipsis '…' with '...'
  let res = line.replace(/…/g, '...');

  // 2. Guard: a line-LEADING em/en dash is a decorative marker, not sentence
  //    punctuation; strip it instead of producing a leading comma artifact.
  res = res.replace(/^[—–]\s*/, '');

  // 3. Protect unspaced en dashes inside numeric ranges (e.g. 1999–2005, 10–20, 2024–2026)
  res = res.replace(/(\d+)–(\d+)/g, (_, start, end) => `${start}@@TYCODE_NUM_RANGE@@${end}`);

  // 4. Replace spaced em dash ' — ' with ', '
  // Also replace unspaced em dash '—' (as sentence punctuation or parenthetical aside) with ', '
  res = res.replace(/\s*—\s*/g, ', ');

  // 5. Replace spaced en dash ' – ' with ', '
  res = res.replace(/\s+–\s+/g, ', ');

  // 6. Restore protected numeric ranges
  res = res.replace(/@@TYCODE_NUM_RANGE@@/g, '–');

  // 7. Clean up spacing and punctuation artifacts:
  // Remove whitespace preceding commas (e.g. 'word ,' -> 'word,')
  res = res.replace(/\s+,/g, ',');
  // Collapse duplicate commas (e.g. ',,' or ', ,' -> ', ')
  res = res.replace(/,(?:\s*,)+/g, ',');
  // Comma immediately preceding sentence terminators or colons (e.g. ',.' -> '.')
  res = res.replace(/,\s*\./g, '.');
  res = res.replace(/,\s*;/g, ';');
  res = res.replace(/,\s*:/g, ':');
  // Collapse double horizontal spaces between two visible characters only.
  // This preserves markdown trailing hard-breaks (two trailing spaces) and
  // leading indentation while removing replacement artifacts.
  res = res.replace(/([\S])[^\S\r\n]{2,}(?=\S)/g, '$1 ');

  return res;
}

export function transformProse(prose: string): string {
  if (!prose) return '';

  // Process line by line: skip any line beginning with '|' (table rows) byte-for-byte
  const lines = prose.split('\n');
  const transformed = lines.map((line) => {
    // Skip table rows beginning with '|' (or optional leading whitespace then '|')
    if (/^\s*\|/.test(line)) {
      return line;
    }
    return transformProseLine(line);
  });

  return transformed.join('\n');
}

/**
 * Enforce standard UK English punctuation on a markdown string.
 * Code blocks and inline code spans are guaranteed 100% byte-for-byte identical.
 */
export function normalisePunctuation(markdown: string, options?: NormaliseOptions): string {
  if (!markdown) return '';
  if (options && options.enabled === false) return markdown;

  const segments = segmentMarkdown(markdown);
  return segments
    .map((seg) => (seg.type === 'code' ? seg.text : transformProse(seg.text)))
    .join('');
}
