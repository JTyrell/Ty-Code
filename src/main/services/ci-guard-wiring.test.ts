/**
 * Guard-wiring contract tests (Prompt 5 verification: "branding grep = zero
 * third-party IDE names in UI strings", plus the rule that made it necessary).
 *
 * A guard that nothing invokes is worse than no guard: it reads as coverage and
 * is none. `no-fake-debugger-findings.mjs` sat in `scripts/` for many turns
 * before this session noticed that no CI step and no `npm test` path ran it, and
 * `no-network-scanner.mjs` was reachable only through `npm run guards`. These
 * tests read the packaging — which scripts exist, which of them CI runs, and
 * where the branding guard gets its ban list — so an orphaned guard fails the
 * suite instead of quietly doing nothing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_BRAND_TOKENS,
  BRAND_TOKEN_EXEMPTIONS,
  FORBIDDEN_BRAND_TOKENS
} from './command-registry';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const read = (relative: string): string => readFileSync(path.join(PROJECT_ROOT, relative), 'utf8');

/** All .mjs entry points under scripts/, sorted so failures read the same twice. */
const ALL_SCRIPTS = readdirSync(path.join(PROJECT_ROOT, 'scripts'))
  .filter((name) => name.endsWith('.mjs'))
  .sort();

/**
 * The anti-phantom family: scripts whose entire job is to fail the build when a
 * claim in the product has no implementation behind it. They are the ones a
 * reviewer trusts to be enforced, so they are the ones that must not be orphaned.
 */
const GUARD_SCRIPTS = ALL_SCRIPTS.filter((name) => name.startsWith('no-'));

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
};
const buildWorkflow = read('.github/workflows/build.yml');

/** Every `scripts/<name>.mjs` invoked by a shell command string. */
function directScripts(command: string): string[] {
  return [...command.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)].map((match) => match[1]);
}

/**
 * Scripts a named npm script reaches, following `npm run <other>` references.
 * Without this, splitting one chain into `guards` + `guards:static` would look
 * like a guard went missing.
 */
function reachableScripts(name: string, seen: Set<string> = new Set()): Set<string> {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const command = packageJson.scripts[name] ?? '';
  const found = new Set(directScripts(command));
  for (const match of command.matchAll(/npm run ([a-z0-9:-]+)/g)) {
    for (const nested of reachableScripts(match[1], seen)) found.add(nested);
  }
  return found;
}

// ---------------------------------------------------------------------------
// CI wiring
// ---------------------------------------------------------------------------

describe('anti-phantom guards are wired into CI', () => {
  it('finds the guard scripts it is meant to police', () => {
    // If this list ever empties out, the tests below assert nothing.
    expect(GUARD_SCRIPTS.length).toBeGreaterThanOrEqual(8);
    for (const name of ['no-third-party-branding.mjs', 'no-fake-debugger-findings.mjs']) {
      expect(GUARD_SCRIPTS, name).toContain(name);
    }
  });

  it('runs every guard as a named CI step', () => {
    const inCi = new Set(directScripts(buildWorkflow));
    for (const name of GUARD_SCRIPTS) {
      expect(inCi.has(name), `scripts/${name} exists but no CI step runs it — it can only ever fail locally`).toBe(true);
    }
  });

  it('gives each guard a step name that says what it protects', () => {
    // "node scripts/x.mjs" without a title is undiagnosable in a red job.
    const steps = [...buildWorkflow.matchAll(/- name: (.+)\n\s+run: node scripts\/([a-z0-9-]+\.mjs)/g)];
    const titled = new Map(steps.map((match) => [match[2], match[1]]));
    for (const name of GUARD_SCRIPTS) {
      const title = titled.get(name);
      expect(title, `scripts/${name} runs in CI with no descriptive step name`).toBeTruthy();
      expect(title, `step name "${title}" does not say what the guard protects`).toMatch(/verify/i);
    }
  });

  it('covers the same ground with one local command', () => {
    // `npm run guards` is what a developer runs before pushing; CI must not know
    // about a guard the local chain skips, or the local chain becomes a lie.
    const local = reachableScripts('guards');
    for (const name of GUARD_SCRIPTS) {
      expect(local.has(name), `scripts/${name} is enforced in CI but missing from "npm run guards"`).toBe(true);
    }
  });

  it('makes the full test chain run every guard too', () => {
    // `npm test` used to hand-copy the guard list, and the copy drifted: it ran
    // eleven of the guards and skipped no-network-scanner. Delegating to the
    // static chain is what keeps the two honest about each other.
    const viaTest = reachableScripts('test');
    for (const name of GUARD_SCRIPTS) {
      expect(viaTest.has(name), `scripts/${name} is missing from "npm test"`).toBe(true);
    }
  });
});

describe('evidence artifacts are verified after the suites that write them', () => {
  it('keeps the artifact verifiers out of the pre-test guard chain', () => {
    // `npm run test:live` refreshes docs/traces/*.json, and verify-audit-artifacts
    // fails any trace older than the last commit that touched agent code. Running
    // it before the live suite would report yesterday's evidence as today's.
    const staticChain = packageJson.scripts['guards:static'] ?? '';
    expect(staticChain).not.toContain('verify-audit-artifacts.mjs');
    expect(staticChain).not.toContain('verify-extension-artifacts.mjs');
    const testChain = packageJson.scripts.test ?? '';
    expect(testChain.indexOf('npm run test:live')).toBeLessThan(testChain.indexOf('verify-audit-artifacts.mjs'));
  });
});

describe('guard wiring is not pointing at nothing', () => {
  it('runs the guard chain from the full test chain instead of copying it', () => {
    // The two chains used to be hand-maintained duplicates, which is how
    // no-network-scanner ended up in one and not the other. One chain delegating
    // to the other cannot drift.
    expect(packageJson.scripts.test).toContain('npm run guards:static');
  });

  it('invokes only scripts that still exist', () => {
    const referenced = new Set([
      ...directScripts(buildWorkflow),
      ...reachableScripts('guards'),
      ...reachableScripts('test'),
      ...Object.values(packageJson.scripts).flatMap((command) => directScripts(command))
    ]);
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(existsSync(path.join(PROJECT_ROOT, 'scripts', name)), `scripts/${name} is referenced but missing`).toBe(true);
    }
  });
});

describe('every guard script at least parses', () => {
  it('loads each scripts/*.mjs under this Node version', () => {
    // `stamp-build-info.mjs` shipped a block comment containing a glob whose `*/`
    // closed the comment early, and nothing noticed until `npm run build` died on
    // it. A guard that cannot be parsed cannot guard anything, and it is cheaper
    // to parse all of them here than to find out in a packaging step.
    //
    // One Node process per script (~40 of them), so this needs far more than the
    // default 5s; it is a packaging check, not a hot path.
    for (const name of ALL_SCRIPTS) {
      const file = path.join(PROJECT_ROOT, 'scripts', name);
      let parsed = true;
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        parsed = false;
      }
      expect(parsed, `scripts/${name} does not parse under ${process.version}`).toBe(true);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// One vocabulary
// ---------------------------------------------------------------------------

describe('the branding guard does not keep its own ban list', () => {
  const guardSource = read('scripts/no-third-party-branding.mjs');

  it('reads the vocabulary out of the registry file', () => {
    expect(guardSource).toContain(`const VOCABULARY_FILE = 'src/shared/types/command-registry.ts';`);
    for (const constant of ['FORBIDDEN_BRAND_TOKENS', 'AMBIGUOUS_BRAND_TOKENS', 'BRAND_TOKEN_EXEMPTIONS']) {
      expect(guardSource, `the guard never parses ${constant}`).toContain(constant);
    }
  });

  it('is the only consumer of a list declared exactly once', () => {
    // The registry exports the names, the test below re-reads the source the guard
    // re-reads, and neither may keep a copy: a second list is a second opinion,
    // and the two drift.
    expect(FORBIDDEN_BRAND_TOKENS.length).toBeGreaterThan(0);
    expect(AMBIGUOUS_BRAND_TOKENS.length).toBeGreaterThan(0);
    const declarations = read('src/shared/types/command-registry.ts').match(
      /export const (FORBIDDEN_BRAND_TOKENS|AMBIGUOUS_BRAND_TOKENS) =/g,
    );
    expect(declarations).toHaveLength(2);
  });

  it('parses the same tables the guard will assert against', () => {
    // Proof that the regexes in the .mjs still match how the TypeScript is laid
    // out: reformatting the arrays must not silently yield an empty ban list.
    const source = read('src/shared/types/command-registry.ts');
    for (const token of FORBIDDEN_BRAND_TOKENS) {
      expect(source.includes(`'${token}'`), `${token} is no longer spelled plainly in the source`).toBe(true);
    }
    for (const [id, tokens] of Object.entries(BRAND_TOKEN_EXEMPTIONS)) {
      expect(source.includes(`'${id}'`), `exemption for ${id} is not keyed by a quoted id`).toBe(true);
      for (const token of tokens) {
        expect(AMBIGUOUS_BRAND_TOKENS, `${token} under ${id} is not an ambiguous token`).toContain(token);
      }
    }
  });
});
