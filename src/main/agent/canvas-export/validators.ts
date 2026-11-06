/**
 * Canvas export validator (Prompt 4 extension, tier 3) — ONE validator, two
 * producers. Both the agent output and the deterministic skeleton are judged by
 * the exact same rules, so a passing skeleton and a passing agent response mean
 * the same thing at the Safe Edit Gate.
 *
 * Checks, in order:
 *   1. every registry `validationMarkers` substring is present,
 *   2. no `bannedMarkers` substring appears (TSX-leak guards for non-React),
 *   3. brackets ( ) [ ] { } are balanced,
 *   4. for tag-based dialects, HTML/JSX tags are balanced.
 *
 * Pure + synchronous — CI-testable offline, no model, no FS.
 */

import type { CanvasPlatformEntry } from '../../../shared/canvas-platform-registry';

export interface DialectValidationResult {
  ok: boolean;
  failures: string[];
}

/** Dialects whose source contains markup tags worth a balance check. */
const TAG_BASED_LANGUAGES = new Set(['tsx', 'html', 'vue', 'svelte', 'typescript']);

const TAG_RE = /<(\/)?([A-Za-z][A-Za-z0-9_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
const VOID_OR_SELF = (closing: boolean, selfClose: boolean): boolean => closing || selfClose;

function countChar(code: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < code.length; i++) if (code[i] === ch) n++;
  return n;
}

function bracketsBalanced(code: string): boolean {
  return (
    countChar(code, '(') === countChar(code, ')') &&
    countChar(code, '[') === countChar(code, ']') &&
    countChar(code, '{') === countChar(code, '}')
  );
}

/** Lightweight tag-balance scan (stack of open element names). */
function tagsBalanced(code: string): boolean {
  const stack: string[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(code)) !== null) {
    const isClosing = match[1] === '/';
    const name = match[2].toLowerCase();
    const isSelfClose = match[4] === '/';
    if (VOID_OR_SELF(isClosing, isSelfClose)) {
      if (isClosing) {
        // Must close the most recent matching open tag.
        const idx = stack.lastIndexOf(name);
        if (idx === -1) return false;
        stack.splice(idx);
      }
      continue;
    }
    stack.push(name);
  }
  return stack.length === 0;
}

export function validateDialect(code: string, entry: CanvasPlatformEntry): DialectValidationResult {
  const failures: string[] = [];

  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, failures: ['Empty export output.'] };
  }

  for (const marker of entry.validationMarkers) {
    if (!code.includes(marker)) failures.push(`Missing required ${entry.label} marker: ${JSON.stringify(marker)}`);
  }
  for (const banned of entry.bannedMarkers) {
    if (code.includes(banned)) failures.push(`${entry.label} must not contain ${JSON.stringify(banned)} (React/TSX leak)`);
  }
  if (!bracketsBalanced(code)) failures.push('Unbalanced brackets ( ) [ ] { }.');
  if (TAG_BASED_LANGUAGES.has(entry.language) && !tagsBalanced(code)) failures.push('Unbalanced markup tags.');

  return { ok: failures.length === 0, failures };
}

/** Human-readable retry-feedback block for the single validation retry. */
export function formatFailuresForRetry(failures: string[]): string {
  return failures.map((f) => `  - ${f}`).join('\n');
}
