#!/usr/bin/env node
/**
 * Anti-Phantom Guard: One Copy Path (Prompt 3 — Copy Pipeline)
 *
 * Prompt 3 replaced "call navigator.clipboard and hope" with a single renderer
 * pipeline: the async API, then the main-process clipboard, then a failure that
 * reports a concrete reason and offers Retry. A pipeline only protects the user if
 * the surfaces that copy actually route through it, and the recurring pattern in
 * this codebase is a new component re-adding a local
 * `navigator.clipboard.writeText(...)` because that is the first answer online.
 *
 * This guard checks two things:
 *  - No renderer source touches `navigator.clipboard` directly. `lib/clipboard.ts`
 *    is the only file allowed to, and it is verified to really implement both
 *    paths — being the exempted file is not the same as being the pipeline.
 *  - `document.execCommand('copy')` is gone. Copying through a hidden textarea
 *    "succeeds" while the system clipboard keeps whatever was copied before, which
 *    is exactly the defect that read as "copy response is broken".
 *
 * Exempted on purpose: `lib/editor-commands.ts` routes Ctrl+C / Ctrl+X / Ctrl+V /
 * Ctrl+Z to whatever owns DOM focus, and for a plain form field that means
 * `document.execCommand(op)`. That is native editing, not a copy surface — the
 * payload never leaves the field, so there is nothing for this guard to assert
 * about the system clipboard.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PIPELINE_FILE = 'src/renderer/src/lib/clipboard.ts';
const SCAN_DIR = path.join(PROJECT_ROOT, 'src/renderer/src');
const SOURCE_EXT = /\.(ts|tsx)$/;

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedChecks++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Anti-Phantom Guard Violation: ${message}`);
  }
}

/**
 * Bypass patterns, matched against code with comments removed.
 *
 * `navigator.clipboard` needs the dot: a sentence inside a comment explaining why
 * a surface moved off it would otherwise fail the build over its own fix — and a
 * guard that fails the file which fixes it gets deleted rather than obeyed.
 */
const BYPASS_PATTERNS = [
  { name: 'direct async clipboard write', regex: /navigator\.clipboard\.writeText\s*\(/ },
  { name: 'direct async clipboard read', regex: /navigator\.clipboard\.readText\s*\(/ },
  { name: 'direct async clipboard access', regex: /navigator\.clipboard\s*\./ },
  { name: 'execCommand copy against a hidden textarea', regex: /document\.execCommand\s*\(\s*['"]copy['"]\s*\)/ }
];

/**
 * Comment stripper that keeps every other character offset intact.
 *
 * It walks string literals as well, because `'https://example.com'` contains the
 * two characters that would otherwise open a line comment and blank the rest of
 * the line — including a real clipboard call sitting after the URL. A matcher that
 * can be disarmed by a string is not a matcher.
 */
function blankComments(source) {
  const out = source.split('');
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];
    if (state === 'code' && two === '//') {
      state = 'line';
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (state === 'code' && two === '/*') {
      state = 'block';
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (ch === '\\') i += 2;
      else if (ch === "'" && state === 'single') state = 'code';
      else if (ch === '"' && state === 'double') state = 'code';
      else if (ch === '`' && state === 'template') state = 'code';
      else i += 1;
      continue;
    }
    if (state === 'line' && ch === '\n') state = 'code';
    if (state === 'block' && two === '*/') {
      state = 'code';
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (state === 'code' && (ch === "'" || ch === '"' || ch === '`')) {
      state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'template';
      i += 1;
      continue;
    }
    if (state !== 'code' && ch !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** Every bypass hit in one file, with the line it is actually on. */
function findBypasses(codeOnly) {
  const hits = [];
  const lines = codeOnly.split('\n');
  for (const pattern of BYPASS_PATTERNS) {
    for (let line = 0; line < lines.length; line++) {
      if (pattern.regex.test(lines[line])) hits.push({ line: line + 1, name: pattern.name, text: lines[line].trim() });
    }
  }
  return hits;
}

async function collectSources(dir) {
  const found = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...(await collectSources(absolute)));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    if (entry.name.includes('.test.')) continue;
    found.push(absolute);
  }
  return found;
}

/** Count call sites of the shared helpers, so the pipeline cannot be exempted and unused. */
function countPipelineCalls(source) {
  const codeOnly = blankComments(source);
  const names = ['copyText(', 'copyTextOrNotify(', 'readClipboardText(', 'useCopyFeedback('];
  let count = 0;
  for (const name of names) {
    let index = codeOnly.indexOf(name);
    while (index !== -1) {
      count++;
      index = codeOnly.indexOf(name, index + name.length);
    }
  }
  return count;
}

async function main() {
  console.log('========================================================================');
  console.log('=== ANTI-PHANTOM GUARD: ONE COPY PATH FOR THE RENDERER                 ===');
  console.log('========================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. The exempted file really is a two-path pipeline
  // ---------------------------------------------------------------------------
  console.log(`1. Verifying ${PIPELINE_FILE} implements what it is exempted for...`);
  const pipelineSource = await fs.readFile(path.join(PROJECT_ROOT, PIPELINE_FILE), 'utf8');
  assert(/navigator\.clipboard\.writeText\s*\(/.test(pipelineSource), 'the pipeline attempts the async clipboard API');
  assert(/copyToClipboard\s*\(/.test(pipelineSource), 'the pipeline falls back to the main-process clipboard');
  assert(/navigator\.clipboard\.readText\s*\(/.test(pipelineSource), 'the pipeline reads through the async API');
  assert(/readFromClipboard\s*\(/.test(pipelineSource), 'the pipeline falls back to main for reads');
  assert(
    !/document\.execCommand\s*\(\s*['"]copy['"]\s*\)/.test(pipelineSource),
    'the pipeline itself does not copy through a hidden textarea'
  );

  // ---------------------------------------------------------------------------
  // 2. No other renderer source touches the clipboard APIs
  // ---------------------------------------------------------------------------
  console.log('\n2. Scanning renderer sources for clipboard bypasses...');
  const pipelineAbsolute = path.resolve(PROJECT_ROOT, PIPELINE_FILE);
  const files = await collectSources(SCAN_DIR);
  assert(files.length > 50, `collected ${files.length} renderer source files to scan`);

  const violations = [];
  let pipelineCallSites = 0;
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const relative = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
    if (path.resolve(file) === pipelineAbsolute) continue;
    const hits = findBypasses(blankComments(raw));
    for (const hit of hits) violations.push(`${relative}:${hit.line} — ${hit.name}: ${hit.text}`);
    pipelineCallSites += countPipelineCalls(raw);
  }

  for (const violation of violations) console.error(`  ✗ ${violation}`);
  assert(
    violations.length === 0,
    `${violations.length} clipboard bypass(es) found outside ${PIPELINE_FILE}`
  );
  console.log(`  ✓ ${files.length - 1} renderer sources use no clipboard API directly`);

  // ---------------------------------------------------------------------------
  // 3. The pipeline is in use, not merely present
  // ---------------------------------------------------------------------------
  console.log('\n3. Verifying copy surfaces actually call the pipeline...');
  assert(
    pipelineCallSites >= 20,
    `found ${pipelineCallSites} call sites of copyText / copyTextOrNotify / readClipboardText / useCopyFeedback`
  );

  // ---------------------------------------------------------------------------
  // 4. Guard self-test — prove the matcher can fail, and what it declines to
  // ---------------------------------------------------------------------------
  console.log('\n4. Running guard self-test against synthetic bypass code...');
  const mustFlag = [
    "await navigator.clipboard.writeText('payload');",
    'const t = await navigator.clipboard.readText();',
    "navigator.clipboard.writeText(code).then(() => setCopied(true));",
    "const ok = document.execCommand('copy');",
    "if (document.execCommand( \"copy\" )) return;"
  ];
  for (const snippet of mustFlag) {
    const caught = findBypasses(snippet).length > 0;
    assert(caught, `self-test flags: ${snippet.slice(0, 46)}`);
  }

  const mustNotFlag = [
    '// Prompt 3\'s shared pipeline, not a local `navigator.clipboard` call: it',
    '/* document.execCommand used to live here and reported success falsely */',
    'if (!document.execCommand(op)) {',
    'await copyTextOrNotify(text, "chat.code-shelf");'
  ];
  for (const snippet of mustNotFlag) {
    const caught = findBypasses(blankComments(snippet)).length > 0;
    assert(!caught, `self-test ignores: ${snippet.slice(0, 46)}`);
  }

  // The comment blanking must not shift offsets, or reported line numbers lie.
  const probe = "const a = 1; // navigator.clipboard.writeText(x)\nconst b = navigator.clipboard.writeText(y);";
  const blankedProbe = blankComments(probe);
  assert(
    blankedProbe.length === probe.length && blankedProbe.split('\n')[1] === probe.split('\n')[1],
    'blanking comments preserves line numbers and content of code lines'
  );
  const probeHits = findBypasses(blankedProbe);
  const probeLines = [...new Set(probeHits.map((hit) => hit.line))];
  assert(
    probeLines.length === 1 && probeLines[0] === 2,
    `the only line reported is the real call on line 2, not the comment on line 1 (got lines ${probeLines.join(', ') || 'none'})`
  );

  // The disarm case: a URL string before the call must not hide it.
  const urlProbe = "const url = 'https://example.com'; await navigator.clipboard.writeText(url);";
  assert(
    findBypasses(blankComments(urlProbe)).length > 0,
    'a clipboard call after a URL literal is still reported, not blanked as a comment'
  );

  console.log('\n========================================================================');
  console.log(`=== GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]             ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Anti-Phantom Guard (no-copy-bypass) Failed:', err);
  process.exit(1);
});
