#!/usr/bin/env node
/**
 * Anti-Phantom Guard: No Fake Debugger Findings (Prompt 5b Run-menu integrity work)
 *
 * The Omni-Debugger panel used to present four things that were not observations:
 *   1. Eight invented findings seeded as the store's initial state, complete with
 *      file/line pairs asserted about the user's own code, visible on first open.
 *   2. An "All Diagnostics Passing Cleanly" empty state reachable without a sweep,
 *      so deleting the seed would have swapped one fabrication for its opposite.
 *   3. A fixed file tree of seven checked-in paths, merged into the findings tree.
 *   4. Three readiness bars hardcoded to 82% / 74% / 89%, reporting a steady health
 *      index for any workspace — including one never analysed.
 * Plus an Engines tab whose rule names and capability claims were prose written
 * beside the code, none of which existed in any engine.
 *
 * This guard keeps them from coming back, and ties the remaining descriptive text to
 * the engine sources it describes.
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
 * Strip comments before pattern matching.
 *
 * Non-negotiable: the files that document these removals quote the strings being
 * removed. `engineCapabilities.ts` names every invented rule so a reader knows what
 * was fixed, and a naive content scan would fail the build over that explanation.
 * A guard that flags the file which fixes the problem gets deleted rather than
 * obeyed, so the scan looks at code only.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

async function readSource(relativePath) {
  return fs.readFile(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

/** Every quoted string literal matching `key: 'value'` in a code block. */
function extractRuleIds(block) {
  const ids = [];
  const pattern = /ruleId:\s*'([^']+)'/g;
  let match;
  while ((match = pattern.exec(block)) !== null) ids.push(match[1]);
  return ids;
}

async function main() {
  console.log('========================================================================');
  console.log('=== ANTI-PHANTOM GUARD: NO FAKE DEBUGGER FINDINGS                    ===');
  console.log('========================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. The store starts empty and says so
  // ---------------------------------------------------------------------------
  console.log('1. Verifying the debugger store seeds no findings...');
  const storePath = 'src/renderer/src/state/debugger-store.ts';
  const storeCode = stripComments(await readSource(storePath));

  assert(
    !storeCode.includes('INITIAL_ANALYSIS_RESULTS'),
    'debugger-store.ts declares no INITIAL_ANALYSIS_RESULTS seed'
  );
  assert(
    !/\b(?:res-static|res-dyn|res-arch|res-qa|res-pm)-\d+\b/.test(storeCode),
    'debugger-store.ts contains no invented finding ids (res-<engine>-NN pattern)'
  );
  assert(
    /analysisResults:\s*\[\]/.test(storeCode),
    'debugger-store.ts initializes analysisResults to an empty list'
  );
  assert(
    /activeFile:\s*null/.test(storeCode),
    'debugger-store.ts leaves activeFile null rather than a checked-in path'
  );

  // ---------------------------------------------------------------------------
  // 2. A failed sweep cannot be mistaken for a result
  // ---------------------------------------------------------------------------
  console.log('\n2. Verifying a failed sweep reports instead of quietly keeping stale findings...');
  assert(
    !/simulated sweep/i.test(storeCode),
    'debugger-store.ts contains no simulated-sweep fallback'
  );
  assert(
    storeCode.includes('analysisError') && storeCode.includes('hasRunAnalysis'),
    'debugger-store.ts tracks both a sweep error and whether any sweep completed'
  );
  assert(
    /hasRunAnalysis:\s*true/.test(storeCode),
    'debugger-store.ts marks the swept state only where results are actually applied'
  );

  // ---------------------------------------------------------------------------
  // 3. Proof of sweep belongs to main, and a renderer cannot forge it
  // ---------------------------------------------------------------------------
  console.log('\n3. Verifying proof-of-sweep is owned by main and unforgeable from a renderer...');
  const windowPath = 'src/main/windows/debugger-window.ts';
  const windowCode = stripComments(await readSource(windowPath));

  assert(
    windowCode.includes('lastSweepAt'),
    'debugger-window.ts records when a sweep last completed'
  );
  assert(
    /this\.lastSweepAt\s*=\s*Date\.now\(\)/.test(windowCode),
    'debugger-window.ts stamps the sweep inside pushResults, where engine output lands'
  );
  // The renderer->main sync payload is Zod-validated, and Zod strips unknown keys.
  // Leaving lastSweepAt out of that schema is therefore what makes it unforgeable,
  // so the assertion is about the schema and not about the snapshot type.
  const schemaBody = windowCode.match(/DebuggerSyncStatePayloadSchema[\s\S]*?\}\)/)?.[0] ?? '';
  assert(schemaBody.length > 0, 'debugger-window.ts declares the renderer sync payload schema');
  assert(
    !schemaBody.includes('lastSweepAt'),
    'DebuggerSyncStatePayloadSchema omits lastSweepAt, so mirroring state cannot claim a sweep ran'
  );

  // ---------------------------------------------------------------------------
  // 4. Clean claims require evidence
  // ---------------------------------------------------------------------------
  console.log('\n4. Verifying every reassuring message is gated on a completed sweep...');
  const debuggerDir = path.join(PROJECT_ROOT, 'src/renderer/src/components/debugger');
  const debuggerFiles = (await fs.readdir(debuggerDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => entry.name);

  const omniRaw = await fs.readFile(path.join(debuggerDir, 'OmniDebugger.tsx'), 'utf8');
  const omniCode = stripComments(omniRaw);

  assert(
    omniCode.includes("'All Diagnostics Passing Cleanly'"),
    'OmniDebugger.tsx still offers the clean message (it is legitimate after an empty sweep)'
  );
  assert(
    /emptyFindingsState[\s\S]{0,400}'clean'/.test(omniCode) &&
      omniCode.includes('hasRunAnalysis'),
    'the clean message sits behind a sweep-completed state rather than an empty list alone'
  );
  assert(
    !/width:\s*'\d+(?:\.\d+)?%'/.test(omniCode.replace(/width:\s*'100%'/g, '')),
    'OmniDebugger.tsx contains no hardcoded bar width other than full-width layout'
  );

  // ---------------------------------------------------------------------------
  // 5. Capability claims are checked against the engines that supposedly ship them
  // ---------------------------------------------------------------------------
  console.log('\n5. Verifying engine capability claims resolve to real rule ids in engine source...');
  const capPath = 'src/renderer/src/components/debugger/engineCapabilities.ts';
  const capCode = await readSource(capPath);

  const cardPattern = /sourceFile:\s*'([^']+)'[\s\S]*?rules:\s*\[([\s\S]*?)\]/g;
  let cardMatch;
  let verifiedRules = 0;
  while ((cardMatch = cardPattern.exec(capCode)) !== null) {
    const [, sourceFile, rulesBlock] = cardMatch;
    const absolute = path.join(PROJECT_ROOT, sourceFile);
    assert(fsSync.existsSync(absolute), `${sourceFile} exists as named by its capability card`);
    const engineCode = stripComments(await fs.readFile(absolute, 'utf8'));
    for (const ruleId of extractRuleIds(rulesBlock)) {
      const present =
        engineCode.includes(`'${ruleId}'`) ||
        engineCode.includes(`"${ruleId}"`) ||
        engineCode.includes(`\`${ruleId}`);
      assert(present, `${sourceFile} actually emits rule id "${ruleId}"`);
      verifiedRules++;
    }
  }
  assert(verifiedRules > 0, 'capability cards declare rule ids for the guard to check');

  // ---------------------------------------------------------------------------
  // 6. The specific invented capabilities stay dead
  // ---------------------------------------------------------------------------
  console.log('\n6. Scanning the debugger UI for capabilities no engine implements...');
  const forbiddenPatterns = [
    { name: 'Invented static-engine race rule', regex: /race-condition-guard/ },
    { name: 'Invented static-engine dead-code rule', regex: /unreachable-branches/ },
    { name: 'Invented profiler leak rule', regex: /no-listener-leaks/ },
    { name: 'Invented frame-rate rule', regex: /24ms micro-batching/ },
    { name: 'Invented animation-frame rule', regex: /rAF synchronization/ },
    { name: 'Claimed process-isolation enforcement', regex: /contextBridge IPC|safeStorage keyring|no-plaintext-keys/ },
    { name: 'Claimed frame-rate guarantee', regex: /60 FPS|re-render velocity|garbage collection pressure/ },
    { name: 'Claimed accessibility compliance checking', regex: /WCAG/ },
    { name: 'Seed findings array', regex: /INITIAL_ANALYSIS_RESULTS/ },
    { name: 'Invented finding id', regex: /\b(?:res-static|res-dyn|res-arch|res-qa|res-pm)-\d+\b/ },
    { name: 'Readiness score heading', regex: /(?:DEV|QA|PM) Readiness|(?:Readiness|Coverage) Breakdown/ }
  ];

  const scanDirs = [
    path.join(PROJECT_ROOT, 'src/renderer/src/components/debugger'),
    path.join(PROJECT_ROOT, 'src/renderer/src/state')
  ];

  let scanned = 0;
  for (const dir of scanDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!(entry.isFile() && /\.(ts|tsx)$/.test(entry.name))) continue;
      scanned++;
      const content = stripComments(await fs.readFile(path.join(dir, entry.name), 'utf8'));
      for (const pattern of forbiddenPatterns) {
        if (pattern.regex.test(content)) {
          throw new Error(`Fabricated debugger claim found in ${entry.name}: ${pattern.name}`);
        }
      }
    }
  }
  assert(scanned > 0, `scanned ${scanned} debugger and state source files for fabricated claims`);

  // ---------------------------------------------------------------------------
  // 7. Guard self-test
  // ---------------------------------------------------------------------------
  console.log('\n7. Running guard self-test against synthetic fabricated debugger content...');
  const violatingSnippets = [
    "const INITIAL_ANALYSIS_RESULTS = [{ id: 'res-static-01', severity: 'critical' }];",
    "<div style={{ height: '100%', width: '82%', background: 'blue' }} />",
    '<strong>race-condition-guard</strong>',
    'Autonomous LLM analyzer detecting WCAG AA accessibility compliance issues.',
    '// Fallback local simulated sweep if offline'
  ];
  for (const snippet of violatingSnippets) {
    let caught = forbiddenPatterns.some((pattern) => pattern.regex.test(snippet));
    if (!caught && /width: '\d+%'/ .test(snippet.replace(/width: '100%'/, ''))) caught = true;
    if (!caught && /simulated sweep/i.test(snippet)) caught = true;
    assert(caught, `self-test flags: ${snippet.slice(0, 52)}...`);
  }

  console.log('\n========================================================================');
  console.log(`=== GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]             ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Anti-Phantom Guard (no-fake-debugger-findings) Failed:', err);
  process.exit(1);
});
