#!/usr/bin/env node
/**
 * Anti-Phantom Guard: No Third-Party IDE Branding In User-Facing Text
 * (Prompt 5b Step 6 — "branding grep = zero third-party IDE names in UI strings")
 *
 * Ty-Code is its own product. A menu row, tooltip, toast or heading that names
 * another editor either advertises somebody else's work or quietly copies their
 * wording, and both survive precisely because nobody greps for it. This guard
 * makes that grep a build step.
 *
 * Four decisions are load-bearing.
 *
 *  - **One vocabulary.** The token lists are parsed out of
 *    `src/shared/types/command-registry.ts`, the same arrays `findBrandToken()`
 *    uses to validate every registry entry. A guard carrying its own list drifts:
 *    the registry passes while the UI ships a word nobody added to the second
 *    list. The parse is asserted non-empty, so a rename that breaks it fails the
 *    build rather than silently scanning nothing.
 *  - **Every occurrence is classified, none discarded.** Each hit is put in exactly
 *    one region — comment, string literal, JSX text, or code. Comments and
 *    identifiers are not what a user is shown, so they are counted and reported;
 *    a string or JSX text fails the build. A guard that looked only at strings
 *    would hide a name in a JSX block, and one that looked at everything would
 *    drown in `createVscodeShim`.
 *  - **One matching function for the scan and its own self-test.** The self-test
 *    calls the same `scanSource()` the file walk calls. A guard tested against a
 *    copy of its own logic proves nothing about the copy that runs.
 *  - **An exemption is a decision with a stated reason, and it must still be
 *    needed.** Either the registry's own `BRAND_TOKEN_EXEMPTIONS` (matched by the
 *    `id:` written on the same line, which is how registry rows are laid out) or a
 *    trailing `// brand-ok: reason`. A justification left behind by the string it
 *    excused is a lie about a constraint that no longer exists, so a stale marker
 *    fails.
 *
 * Limits, stated rather than pretended away: a tag is recognised as `<` followed by a
 * letter, `/` or `!`, so in a `.tsx` file something like `if (a <b)` opens a tag that
 * never closes and reads the rest of a block as text. That direction fails closed — it
 * reports a line a human then looks at — and `.ts`, `.js`, preload and shared sources
 * cannot enter JSX text at all, which is where most of the false positives were. A
 * template literal whose `${…}` contains another backtick is sliced one literal short
 * of the truth, again failing closed. Classification is therefore a map over every
 * index rather than a set of matched strings: an index always has an answer, and
 * `--trace` shows which one.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Where user-facing text is assembled. Everything else is out of scope by design. */
const SCAN_ROOTS = ['src/renderer/src', 'src/main', 'src/preload', 'src/shared'];

/** The file that defines the ban list is the one place the names appear as data. */
const VOCABULARY_FILE = 'src/shared/types/command-registry.ts';

/**
 * Mentions the guard must let through without an inline marker.
 *
 * Empty on purpose: every exemption found during triage turned out to belong on
 * the line it excuses, where a reviewer can see the sentence beside the reason.
 * A list that grows silently is how a grep stops being a gate.
 */
const BRAND_OK_ALLOWLIST = [];

const MARKER = /brand-ok:\s*(\S.*)$/;

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedChecks++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Branding Guard Violation: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. The shared vocabulary
// ---------------------------------------------------------------------------

/** Parse `export const NAME = [...]` into the strings it lists. */
function parseTokenArray(source, name) {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(source);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((entry) => entry[1] ?? entry[2]);
}

/** Parse `BRAND_TOKEN_EXEMPTIONS` into `{ commandId: [token] }`. */
function parseExemptions(source) {
  const match = /export const BRAND_TOKEN_EXEMPTIONS[\s\S]*?\{([\s\S]*?)\n\};/m.exec(source);
  const body = match?.[1] ?? '';
  const table = {};
  for (const row of body.matchAll(/^\s*'([^']+)':\s*\[([^\]]*)\]/gm)) {
    table[row[1]] = [...row[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  }
  return table;
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 2. Region classification
// ---------------------------------------------------------------------------

const REGION = { code: 0, string: 1, lineComment: 2, blockComment: 3, jsxText: 4 };

const REGION_LABEL = ['code', 'string', 'lineComment', 'blockComment', 'jsxText'];

/** Words after which a `/` opens a regular expression rather than a division. */
const REGEX_PRECEDERS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else',
  'void', 'delete', 'new', 'yield', 'await'
]);

/**
 * Give every character index a region, and every character of a string literal the
 * index of the quote that opened it and the quote that closed it.
 *
 * A map rather than a list of extracted strings, because the promise of this guard
 * is that no occurrence is invisible: whatever the string scanner gets wrong, every
 * index still carries one answer about itself.
 *
 * Three properties of the scan are deliberate:
 *  - JSX text is inferred from tag state, and only in files that can contain JSX at
 *    all. `Promise<void>` and `a > b` are not the start of a text block, and treating
 *    them as one turns a `.ts` file's own identifiers into prose. A `'` and `"` literal
 *    is committed only when its closing quote is found on the same line, because one
 *    apostrophe in prose (`Don't ship it`) otherwise marks every remaining line as
 *    string — and a guard that floods gets silenced with blanket markers, which is the
 *    same as deleting it.
 *  - Regular-expression literals are consumed, so `/['"]/` cannot open a string that
 *    ends two lines later.
 *  - Opening and closing quote indices are recorded, because the rules about what a
 *    string *is* — a package specifier, a font stack, an operand — have to see the
 *    whole literal. A name inside one starts at a character whose predecessor is a
 *    quote, so a rule that only looked at what precedes the *name* would read
 *    `from '` and `fontFamily: "` and recognise neither.
 */
function classify(source, allowJsx) {
  const regions = new Uint8Array(source.length);
  const opens = new Int32Array(source.length).fill(-1);
  const closes = new Int32Array(source.length).fill(-1);

  const literalEnd = (start, quote) => {
    for (let j = start + 1; j < source.length; j++) {
      if (source[j] === '\\') { j++; continue; }
      // A newline cannot be inside a `'` or `"` literal; refusing to commit one
      // keeps a stray apostrophe from swallowing the rest of a file.
      if (source[j] === '\n' && quote !== '`') return -1;
      if (source[j] === quote) return j;
    }
    return -1;
  };

  const regexEnd = (start) => {
    let inClass = false;
    for (let j = start + 1; j < source.length; j++) {
      const ch = source[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '\n') return -1;
      if (inClass) {
        if (ch === ']') inClass = false;
        continue;
      }
      if (ch === '[') {
        inClass = true;
        continue;
      }
      if (ch === '/') return j;
    }
    return -1;
  };

  // `/` and `<` both mean two different things depending on what came before, and the
  // test is the same for both: a character that cannot end an expression. Before
  // `useState<Panel>` a `<` is a generic and before `width / 2` a `/` is a division —
  // read either as the other, and the scanner is wrong for the rest of the file.
  const startsNewExpression = (index) => {
    let k = index - 1;
    while (k >= 0 && /\s/.test(source[k])) k--;
    if (k < 0) return true;
    const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(source.slice(0, k + 1))?.[1] ?? '';
    if (REGEX_PRECEDERS.has(word)) return true;
    return !/[A-Za-z0-9_$)\]]/.test(source[k]);
  };

  // Two states, because the region a user actually reads cannot be inferred from
  // quotes alone: inside a tag, `>` and the quoted attributes around it are markup,
  // and between a tag's `>` and the next `<` every character is copy. `{…}` suspends
  // text so an expression stays code, and its closing `}` resumes it, so a sentence
  // broken by `{name}` is still a sentence.
  let inTag = false;
  let closingTag = false;
  let inText = false;
  let exprDepth = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (inText) {
      if (ch === '{') {
        inText = false;
        exprDepth = 1;
        continue;
      }
      if (ch === '<') {
        // Text ends where a tag begins, including a closing tag — whose `>` is the
        // same character that opens text and must not be read as one.
        inText = false;
        inTag = /[A-Za-z/!]/.test(source[i + 1] ?? '');
        closingTag = source[i + 1] === '/';
        continue;
      }
      regions[i] = REGION.jsxText;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      regions[i] = REGION.lineComment;
      regions[i + 1] = REGION.lineComment;
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        regions[i] = REGION.lineComment;
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      regions[i] = REGION.blockComment;
      regions[i + 1] = REGION.blockComment;
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        regions[i] = REGION.blockComment;
        i++;
      }
      if (i < source.length) {
        regions[i] = REGION.blockComment;
        regions[i + 1] = REGION.blockComment;
        i += 1;
      }
      continue;
    }
    if (ch === '<' && allowJsx && startsNewExpression(i) && /[A-Za-z/!]/.test(source[i + 1] ?? '')) {
      inTag = true;
      closingTag = source[i + 1] === '/';
      continue;
    }
    // `=>` inside an attribute is not the end of a tag, a self-closing `<br />` opens
    // no text block, and `</div>` ends one — only an opening tag's `>` starts copy.
    if (ch === '>' && inTag && source[i - 1] !== '=') {
      inTag = false;
      inText = !closingTag && source[i - 1] !== '/';
      continue;
    }
    if (ch === '{') {
      if (exprDepth > 0) exprDepth++;
      continue;
    }
    if (ch === '}') {
      if (exprDepth > 0 && --exprDepth === 0) inText = true;
      continue;
    }
    if (ch === '/' && !inTag && startsNewExpression(i)) {
      const end = regexEnd(i);
      // Regions default to code, so consuming the body is the whole job: it stops
      // the quotes inside a character class from opening a literal. No close on the
      // line means it was a division, and the `/` is just a character.
      if (end > i) i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = literalEnd(i, ch);
      if (end > i) {
        for (let k = i; k <= end; k++) {
          regions[k] = REGION.string;
          opens[k] = i;
          closes[k] = end;
        }
        i = end;
      }
      continue;
    }
  }
  return { regions, opens, closes };
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Binary search an index down to the line it lives on. */
function lineOf(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low;
}

// ---------------------------------------------------------------------------
// 3. Matching, mirroring `findBrandToken`
// ---------------------------------------------------------------------------

/**
 * Is the text at `index` an occurrence of `token` under the shared rules?
 *
 * Forbidden names match case-insensitively as substrings — `vscode`, `VSCODE` and
 * `VS Code` are all the same mistake. Ambiguous ones are ordinary English words, so
 * they match case-sensitively as whole words and `the cursor line` stays legal.
 * Getting this backwards in either direction is what makes a branding gate either
 * useless or unusable.
 */
function isOccurrence(source, index, token, forbidden) {
  const rest = source.slice(index);
  if (forbidden.includes(token)) {
    return rest.toLowerCase().startsWith(token.toLowerCase());
  }
  const before = index === 0 ? '' : source[index - 1];
  if (/[A-Za-z0-9]/.test(before)) return false;
  return new RegExp(`^${escapeForRegExp(token)}([^A-Za-z0-9]|$)`).test(rest);
}

/** `from 'vscode-languageclient'` names a package, not an editor the user sees. */
function isModuleSpecifier(source, literalStart) {
  if (literalStart < 0) return false;
  const head = source.slice(Math.max(0, literalStart - 24), literalStart);
  return /(from\s*|import\s*\(\s*|require\s*\(\s*)$/.test(head);
}

/**
 * Property names whose values are machine data rather than anything rendered.
 *
 * `fontFamily: 'JetBrains Mono'` is the font's real name and renaming it would break
 * the setting; `id: 'vscode-chat'` is a protocol identifier; `dir: '.vscode'` is a
 * path on disk; `editor: 'vscode'` selects which interop writer runs. These slots are
 * compared, persisted or sent, so flagging them would train everyone to add markers to
 * strings nobody reads — which is how a gate becomes decoration.
 */
const DATA_SLOT_KEYS = new Set([
  'fontFamily', 'family', 'id', 'identifier', 'dir', 'directory', 'path',
  'harness', 'channel', 'scheme', 'commandId', 'actionId', 'extensionId', 'event',
  'editor', 'variant', 'target', 'cliName', 'engine', 'driver', 'slug', 'source'
]);

/**
 * Keys whose value is shown to a person. This is what decides whether a one-word value
 * is a label or an identifier: `label: 'Cursor'` is copy a user reads, while
 * `path.join(home, 'Cursor')` is a directory that happens to share the name.
 */
const DISPLAY_SLOT_KEYS = new Set([
  'label', 'title', 'name', 'description', 'message', 'tooltip', 'text', 'alt',
  'placeholder', 'heading', 'subtitle', 'caption', 'summary', 'detail', 'body',
  'instructions', 'hint', 'help', 'prompt', 'error', 'warning', 'aria-label'
]);

/**
 * The object-key or parameter name immediately before this literal, or null.
 *
 * Quoted and dotted keys are read (`'editor.fontFamily': { default: … }`), and the
 * boundary must be a non-word character so `valid:` does not match the `id` slot.
 */
const SLOT_PATTERN = /(?:^|[^A-Za-z0-9_$.])['"]?([A-Za-z][A-Za-z0-9$.]*)['"]?\s*:\s*$/;

function slotKeyBefore(source, literalStart) {
  if (literalStart < 0) return null;
  const key = SLOT_PATTERN.exec(source.slice(Math.max(0, literalStart - 64), literalStart))?.[1];
  return key ? key.split('.').pop() : null;
}

/** Characters immediately before an index, trailing whitespace removed. */
function headBefore(source, index, count) {
  return source.slice(Math.max(0, index - count), index).replace(/\s+$/, '');
}

/** Characters immediately after a closing quote, leading whitespace removed. */
function tailAfter(source, index) {
  return source.slice(index + 1, index + 9).replace(/^\s+/, '');
}

/**
 * Is this literal in a position where nothing is ever display text?
 *
 * A union member (`editor: 'vscode' | 'jetbrains'`), an operand of a comparison
 * (`exportingEditor === 'vscode-cline'`), a `case` label, an index
 * (`editorConfigs['vscode-continue']`). None of those shapes can hold a sentence, so
 * the rule cannot excuse branding — it only stops the gate from reporting identifiers
 * the program compares.
 */
function isCodePosition(source, open, close) {
  if (open < 0 || close < 0) return false;
  const head = headBefore(source, open, 8);
  const tail = tailAfter(source, close);
  if (tail.startsWith('|') || head.endsWith('|')) return true;
  if (head.endsWith('[')) return true;
  if (/(?:===|!==|==|!=)$/.test(head)) return true;
  if (/(?:^|[^A-Za-z0-9_$])case$/.test(head)) return true;
  if (/^(?:===|!==|==|!=)/.test(tail)) return true;
  return false;
}

/**
 * A CSS font list — `'JetBrains Mono', 'Fira Code', monospace`. It ends in a generic
 * family because that is how the declaration is written, and requiring the comma keeps
 * a one-word sentence from being called a stylesheet.
 */
function isFontStack(content) {
  return content.includes(',')
    && /(?:monospace|sans-serif|serif|cursive|fantasy|system-ui|ui-monospace);?\s*$/.test(content);
}

/**
 * Decide what one occurrence is, and say why in a phrase.
 *
 * One function holds every rule, so `--trace` can explain a decision on the exact
 * occurrence the walk reported rather than a reconstruction of it.
 */
function decide(context, index, token) {
  const { source, regions, opens, closes, vocabulary, lineText } = context;
  const region = regions[index];
  const open = opens[index];
  const close = closes[index];

  if (region === REGION.lineComment || region === REGION.blockComment) {
    return { kind: 'comment', why: 'inside a comment' };
  }
  if (region !== REGION.string && region !== REGION.jsxText) {
    return { kind: 'code', why: 'an identifier or keyword, never rendered' };
  }
  // Registry rows carry their own justification, keyed by the entry id written on the
  // same line — the same table `findBrandToken(value, entryId)` consults.
  const idMatch = /\bid:\s*'([^']+)'/.exec(lineText);
  if (idMatch && !vocabulary.forbidden.includes(token)
    && vocabulary.exemptions[idMatch[1]]?.includes(token)) {
    return { kind: 'code', why: `the registry exempts ${idMatch[1]}` };
  }
  if (region === REGION.jsxText) {
    return { kind: 'userFacing', why: 'JSX text' };
  }
  if (isModuleSpecifier(source, open)) {
    return { kind: 'code', why: 'a module specifier' };
  }
  const slot = slotKeyBefore(source, open);
  if (slot && DATA_SLOT_KEYS.has(slot)) {
    return { kind: 'dataSlot', why: `the value of the ${slot} slot` };
  }
  if (isCodePosition(source, open, close)) {
    return { kind: 'code', why: 'a union member, comparison operand, case label or index' };
  }
  const content = source.slice(open + 1, close);
  if (isFontStack(content)) {
    return { kind: 'dataSlot', why: 'a CSS font stack' };
  }
  // Prose always contains a space, so a one-word value is a slug, path or identifier
  // — unless the key it sits under is the reason it exists to be read.
  if (!/\s/.test(content) && !(slot && DISPLAY_SLOT_KEYS.has(slot))) {
    return { kind: 'dataSlot', why: 'a one-word value in a position that is not a label' };
  }
  return { kind: 'userFacing', why: 'prose in a display position' };
}

// ---------------------------------------------------------------------------
// 4. One scan, used by the walk and by the self-test alike
// ---------------------------------------------------------------------------

/**
 * Classify every guarded occurrence in one source text.
 *
 * Returns the user-facing hits, the per-region counts for anything that is not a
 * failure, and the marker lines that actually excused something — which is what
 * lets a stale marker be reported rather than trusted.
 */
function scanSource(source, vocabulary, fileLabel) {
  const guarded = [...vocabulary.forbidden, ...vocabulary.ambiguous];
  const { regions, opens, closes } = classify(source, /\.(tsx|jsx)$/.test(fileLabel));
  const starts = lineStarts(source);
  const lines = source.split('\n');
  const hits = [];
  const counts = { comment: 0, code: 0, string: 0, jsxText: 0, dataSlot: 0 };
  const usedMarkers = new Set();
  const markedLines = new Set();

  lines.forEach((lineText, lineNumber) => {
    if (MARKER.test(lineText)) markedLines.add(lineNumber);
  });

  const context = { source, regions, opens, closes, vocabulary, lineText: '' };

  for (const token of guarded) {
    const needle = token.toLowerCase();
    const haystack = source.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      if (isOccurrence(source, index, token, vocabulary.forbidden)) {
        const line = lineOf(starts, index);
        context.lineText = lines[line] ?? '';
        const verdict = decide(context, index, token);

        if (verdict.kind !== 'userFacing') {
          counts[verdict.kind]++;
        } else {
          counts[regions[index] === REGION.jsxText ? 'jsxText' : 'string']++;
          // A marker may sit on the occurrence, on the line above it, or above the
          // literal it belongs to. The last one is not a convenience: an occurrence
          // inside a multi-line template literal has no line of its own to comment
          // on without putting the comment inside the text being generated.
          const openLine = opens[index] >= 0 ? lineOf(starts, opens[index]) : -1;
          const excusing = [line, line - 1, openLine - 1].filter((c) => markedLines.has(c));
          for (const candidate of excusing) usedMarkers.add(candidate);
          const allowed = BRAND_OK_ALLOWLIST.find(
            (entry) => entry.file === fileLabel && entry.token === token
              && (lines[line] ?? '').includes(entry.contains ?? '')
          );
          if (excusing.length === 0 && !allowed) {
            hits.push({
              line: line + 1,
              token,
              text: (lines[line] ?? '').trim().slice(0, 150)
            });
          }
        }
      }
      index = haystack.indexOf(needle, index + needle.length);
    }
  }

  return { hits, counts, usedMarkers, markedLines };
}

/**
 * The scan, tested against content written to violate it.
 *
 * Runs before the walk, because a guard that aborts on its first real finding never
 * reaches its own self-test — so a broken classifier could report a clean tree while
 * matching nothing at all. Proving the matcher first is what makes "0 hits" mean
 * something.
 */
function selfTest(vocabulary) {
  console.log('\n2. Running the guard against synthetic branded content...');
  const samples = [
    { name: 'a registry label naming VS Code', expectHit: true, source: "  { id: 'x', label: 'Open in VS Code', command: 'x' },\n" },
    { name: 'a toast naming Qoder', expectHit: true, source: "  toast.success('Imported from Qoder');\n" },
    { name: 'JSX text naming JetBrains', expectHit: true, file: 'self-test.tsx', source: '  return <span>Just like JetBrains editors</span>;\n' },
    { name: 'lowercase template literal, still the real product name', expectHit: true, source: '  const hint = `works like vscode`;\n' },
    { name: 'the registry exemption map applies by entry id on the line', expectHit: false, source: "  { id: 'selection.add-cursor-above', label: 'Add Cursor Above' },\n" },
    { name: 'the same wording on a row with no exemption', expectHit: true, source: "  { id: 'other.row', label: 'Add Cursor Above' },\n" },
    { name: 'a comment quoting the name is documentation', expectHit: false, source: '  // Supports VS Code extensions too.\n' },
    { name: 'a block comment too', expectHit: false, source: '  /* Open it in Cursor if you like. */\n' },
    { name: 'an identifier is not user-facing text', expectHit: false, source: '  function createVscodeShim() { return 1 }\n' },
    { name: 'a package specifier is not user-facing text', expectHit: false, source: "  import { x } from 'vscode-languageclient';\n" },
    { name: 'a font name in a fontFamily slot is the font, not the IDE', expectHit: false, source: "  const theme = { fontFamily: 'JetBrains Mono, monospace' };\n" },
    { name: 'a quoted font stack, where the name does not start the literal', expectHit: false, source: "  const theme = { fontFamily: \"'JetBrains Mono', monospace\" };\n" },
    { name: 'an id slot is data', expectHit: false, source: "  const row = { id: 'vscode-chat', name: 'Chat' };\n" },
    { name: 'the label slot beside it is still copy', expectHit: true, source: "  const row = { id: 'x', label: 'VS Code Chat' };\n" },
    { name: 'the ordinary English caret stays legal in a sentence', expectHit: false, source: "  const why = 'Open a file to set a breakpoint on the cursor line.';\n" },
    { name: 'a marked line with a reason is exempt', expectHit: false, source: "  const label = 'Open in Cursor'; // brand-ok: interop instruction\n" },
    { name: 'a marker with no reason after it is not an exemption', expectHit: true, source: "  const label = 'Open in Cursor'; // brand-ok:\n" },
    { name: 'an apostrophe in prose does not turn later code into a string', expectHit: false, file: 'self-test.tsx', source: '  <p>Don\'t ship it</p>\n  const vscodeShim = createVscodeShim();\n' },
    { name: 'a closing tag ends the text instead of reopening it', expectHit: false, file: 'self-test.tsx', source: '  return <div>Hi</div>;\n  const vscodeShim = createVscodeShim();\n' },
    { name: 'text broken by an expression is still text', expectHit: true, file: 'self-test.tsx', source: '  return <p>Export from {app} — VS Code included</p>;\n' },
    { name: 'a generic in a .tsx file opens no text block', expectHit: false, file: 'self-test.tsx', source: '  const panels = useState<Panel[]>([]);\n  const vscodeShim = createVscodeShim();\n' },
    { name: 'a one-word value is data until a label key makes it copy', expectHit: false, source: "  const dir = path.join(home, 'Cursor');\n" },
    { name: 'the same one-word value under a label key is copy', expectHit: true, source: "  { label: 'Cursor', icon: 'sparkle' },\n" },
    { name: 'a one-word argument is data', expectHit: false, source: "  void handleExportEditorConfig('vscode', 'continue');\n" },
    { name: 'a regex character class does not open a literal', expectHit: false, source: '  const re = /[\'"]/;\n  const vscodeShim = createVscodeShim();\n' },
    { name: 'a member of a string union is a type annotation', expectHit: false, source: "  type Editor = 'vscode' | 'jetbrains';\n" },
    { name: 'a comparison operand is data the program checks', expectHit: false, source: "  if (editor === 'vscode') return write();\n" },
    { name: 'a switch case label is data', expectHit: false, source: "  case 'vscode':\n    return write();\n" },
    { name: 'an index key is data', expectHit: false, source: "  const snip = editorConfigs['vscode-cline'];\n" },
    { name: 'a path or slug is not prose', expectHit: false, source: "  const dir = '.vscode';\n  const ext = 'prettier-vscode';\n" },
    { name: 'a CSS font stack is data whatever key holds it', expectHit: false, source: '  const stacks = {\n  mono: "\'JetBrains Mono\', \'Fira Code\', monospace",\n};\n' },
    { name: 'a literal that is nothing but the brand name is a label', expectHit: true, source: "  { id: 'x', label: 'Cursor' },\n" },
    { name: 'punctuated prose about another editor still fails', expectHit: true, source: "  const how = 'Point VS Code, and any other editor, at Ty-Code.';\n" },
    { name: 'prose inside a template literal still fails', expectHit: true, source: '  const instructions = `Save in .vscode/settings.json to point VS Code at Ty-Code.`;\n' },
    { name: 'a marker above a multi-line literal excuses lines inside it', expectHit: false, source: '  // brand-ok: generated shim source\n  const shim = `window.env = {\n    vscode: 1,\n  };`;\n' }
  ];
  for (const sample of samples) {
    const scanned = scanSource(sample.source, vocabulary, sample.file ?? 'self-test.ts');
    assert(!!scanned.hits.length === sample.expectHit, `self-test ${sample.name}`);
    if (sample.expectHit === false && sample.source.includes('brand-ok')) {
      assert(
        scanned.usedMarkers.size >= 1 && scanned.usedMarkers.size === scanned.markedLines.size,
        `self-test ${sample.name}: the marker was recorded as used`
      );
    }
  }
  const staleProbe = scanSource("  const clean = 'nothing branded here'; // brand-ok: unused\n", vocabulary, 'self-test');
  assert(
    staleProbe.usedMarkers.size === 0 && staleProbe.markedLines.size === 1,
    'self-test: an unused marker is detectable as stale'
  );
}

// ---------------------------------------------------------------------------
// 5. The walk
// ---------------------------------------------------------------------------

/**
 * Explain the classifier's decision about every guarded name in one file.
 *
 * A report saying "string literal" is unfalsifiable from the outside: whether a line
 * counts as a string depends on a quote perhaps a thousand characters earlier, and
 * the natural response to a wrong call is a marker that hides it. `--trace` runs the
 * same `decide()` the walk ran, so a misclassification can be reproduced and fixed.
 */
function traceFile(vocabulary, relative, wantLine) {
  const absolute = path.resolve(PROJECT_ROOT, relative);
  if (!fsSync.existsSync(absolute)) {
    console.error(`No such file: ${relative}`);
    process.exitCode = 1;
    return;
  }
  const source = fsSync.readFileSync(absolute, 'utf8');
  const { regions, opens, closes } = classify(source, /\.(tsx|jsx)$/.test(relative));
  const starts = lineStarts(source);
  const lines = source.split('\n');
  const context = { source, regions, opens, closes, vocabulary, lineText: '' };

  console.log(`\nTrace of ${relative}${wantLine ? `, line ${wantLine}` : ''}:\n`);
  let shown = 0;
  for (const token of [...vocabulary.forbidden, ...vocabulary.ambiguous]) {
    const needle = token.toLowerCase();
    const haystack = source.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      if (isOccurrence(source, index, token, vocabulary.forbidden)) {
        const line = lineOf(starts, index);
        context.lineText = lines[line] ?? '';
        if (!wantLine || line + 1 === wantLine) {
          const verdict = decide(context, index, token);
          const openLine = opens[index] >= 0 ? lineOf(starts, opens[index]) + 1 : 0;
          const from = openLine && openLine !== line + 1 ? ` — literal opened on line ${openLine}` : '';
          console.log(`  ${line + 1}  [${token}]  ${REGION_LABEL[regions[index]]} → ${verdict.kind}: ${verdict.why}${from}`);
          console.log(`      ${(lines[line] ?? '').trim().slice(0, 120)}`);
          shown++;
        }
      }
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  if (shown === 0) console.log('  no guarded name to classify there');
}

function walk(dir, out) {
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(absolute, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(absolute);
    }
  }
  return out;
}

async function main() {
  console.log('========================================================================');
  console.log('=== ANTI-PHANTOM GUARD: NO THIRD-PARTY IDE BRANDING IN UI TEXT       ===');
  console.log('========================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. One vocabulary, read from where the registry reads it
  // ---------------------------------------------------------------------------
  console.log('1. Verifying the guard shares the registry vocabulary...');
  const vocabularySource = await fs.readFile(path.join(PROJECT_ROOT, VOCABULARY_FILE), 'utf8');
  const forbidden = parseTokenArray(vocabularySource, 'FORBIDDEN_BRAND_TOKENS');
  const ambiguous = parseTokenArray(vocabularySource, 'AMBIGUOUS_BRAND_TOKENS');
  const exemptions = parseExemptions(vocabularySource);
  const vocabulary = { forbidden, ambiguous, exemptions };

  assert(forbidden.length > 0, `parsed ${forbidden.length} forbidden brand tokens out of ${VOCABULARY_FILE}`);
  assert(ambiguous.length > 0, `parsed ${ambiguous.length} ambiguous brand tokens out of ${VOCABULARY_FILE}`);
  assert(
    Object.keys(exemptions).length > 0,
    'parsed the registry exemption table, so justified menu wording is not re-listed here'
  );

  selfTest(vocabulary);

  if (process.argv[2] === '--trace') {
    traceFile(vocabulary, process.argv[3], Number(process.argv[4]) || 0);
    return;
  }

  // ---------------------------------------------------------------------------
  // 3. Classify every occurrence in every scanned file
  // ---------------------------------------------------------------------------
  console.log('\n3. Scanning renderer, main, preload and shared sources for guarded names...');
  const files = [];
  for (const root of SCAN_ROOTS) {
    const absolute = path.join(PROJECT_ROOT, root);
    if (fsSync.existsSync(absolute)) walk(absolute, files);
  }
  assert(files.length > 50, `collected ${files.length} source files to scan`);

  const vocabularyAbsolute = path.resolve(PROJECT_ROOT, VOCABULARY_FILE);
  const report = [];
  const totals = { comment: 0, code: 0, string: 0, jsxText: 0, dataSlot: 0 };
  const markedLines = new Map();

  for (const file of files) {
    if (path.resolve(file) === vocabularyAbsolute) continue;
    const source = fsSync.readFileSync(file, 'utf8');
    const lowered = source.toLowerCase();
    if (![...forbidden, ...ambiguous].some((token) => lowered.includes(token.toLowerCase()))) continue;

    const relative = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
    const scanned = scanSource(source, vocabulary, relative);
    for (const key of Object.keys(totals)) totals[key] += scanned.counts[key];
    for (const line of scanned.markedLines) markedLines.set(`${relative}:${line}`, scanned.usedMarkers.has(line));
    if (scanned.hits.length > 0) {
      report.push(...scanned.hits.map((hit) => ({ ...hit, file: relative })));
    }
  }

  console.log(
    `\n   Occurrences by region — user-facing: ${totals.string} string literal, ${totals.jsxText} JSX text;` +
    `\n   not user-facing (counted, never a failure): ${totals.comment} comment, ${totals.code} code/identifier,` +
    `\n   ${totals.dataSlot} machine-data value in a non-display slot (font name, id, path, protocol header).`
  );

  // ---------------------------------------------------------------------------
  // 4. Markers must still be needed
  // ---------------------------------------------------------------------------
  console.log('\n4. Verifying every brand-ok marker still excuses something...');
  let stale = 0;
  for (const [where, used] of markedLines) {
    if (!used) {
      stale++;
      console.error(`  ✗ stale marker: ${where} excuses nothing`);
    }
  }
  assert(stale === 0, `${markedLines.size} inline brand-ok markers, all load-bearing`);
  for (const entry of BRAND_OK_ALLOWLIST) {
    assert(
      report.every((hit) => hit.file !== entry.file || hit.token !== entry.token),
      `allowlist entry ${entry.file} '${entry.token}' is still needed`
    );
  }

  // ---------------------------------------------------------------------------
  // 5. The verdict
  // ---------------------------------------------------------------------------
  console.log('\n5. Reporting guarded names that reach the user...');
  if (report.length > 0) {
    console.error(`\n${report.length} user-facing string(s) name another editor:\n`);
    for (const hit of report) console.error(`  ${hit.file}:${hit.line}  [${hit.token}]  ${hit.text}`);
    console.error(
      '\nRewrite the sentence about Ty-Code. Where the other editor genuinely is the subject —' +
      '\nan interoperability instruction rather than branding — mark that line with' +
      '\n`// brand-ok: <why>` so the decision shows up in review.'
    );
    throw new Error(`Third-party branding found in ${report.length} user-facing string(s)`);
  }
  assert(report.length === 0, 'no user-facing string names a third-party editor');

  console.log('\n========================================================================');
  console.log(`=== GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]             ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Branding Guard (no-third-party-branding) Failed:', err.message);
  process.exit(1);
});
