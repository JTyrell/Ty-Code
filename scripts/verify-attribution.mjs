#!/usr/bin/env node
/**
 * Permanent Attribution CI Guard: scripts/verify-attribution.mjs (Phase FCC-6)
 *
 * Enforces that attribution to upstream `free-claude-code` (FCC) can NEVER
 * silently disappear from any of the four core user surfaces:
 * 1. About dialog / modal (src/renderer/src/components/TitleBar.tsx)
 * 2. Settings modal / Supply tab (src/renderer/src/components/SettingsModal.tsx)
 * 3. README (README.md)
 * 4. Website footer (website/src/components/SiteFooter.tsx)
 *
 * Verbatim Credit Invariant:
 * "Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code"
 *
 * Also verifies refactor resilience: credit checks are resilient to file refactoring
 * while strictly guaranteeing that credit strings remain intact in user-facing surfaces.
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

export const VERBATIM_CREDIT_STRING =
  'Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code';

export const REQUIRED_SURFACES = [
  {
    id: 'about',
    name: 'About Dialog / Modal',
    file: path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'TitleBar.tsx'),
    searchPatterns: [
      /Free-model\s+supply\s+layer\s+powered\s+by\s+free-claude-code\s+\(FCC\)/,
      /https:\/\/github\.com\/Alishahryar1\/free-claude-code/,
      /AGPL-3\.0\s*\/\s*MIT/
    ]
  },
  {
    id: 'settings',
    name: 'Settings Supply / Model Integrations',
    file: path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'SettingsModal.tsx'),
    searchPatterns: [
      /Free-model\s+supply\s+layer\s+powered\s+by\s+free-claude-code\s+\(FCC\)/,
      /https:\/\/github\.com\/Alishahryar1\/free-claude-code/,
      /AGPL-3\.0\s*\/\s*MIT/
    ]
  },
  {
    id: 'readme',
    name: 'Repository README Documentation',
    file: path.join(PROJECT_ROOT, 'README.md'),
    searchPatterns: [
      /Free-model\s+supply\s+layer\s+powered\s+by\s+free-claude-code\s+\(FCC\)/,
      /https:\/\/github\.com\/Alishahryar1\/free-claude-code/,
      /AGPL-3\.0\s*\/\s*MIT/
    ]
  },
  {
    id: 'website_footer',
    name: 'Website Public Footer',
    file: path.join(PROJECT_ROOT, 'website', 'src', 'components', 'SiteFooter.tsx'),
    searchPatterns: [
      /Free-model\s+supply\s+layer\s+powered\s+by\s+free-claude-code\s+\(FCC\)/,
      /https:\/\/github\.com\/Alishahryar1\/free-claude-code/,
      /AGPL-3\.0\s*\/\s*MIT/
    ]
  }
];

// Additional protected surfaces
export const SECONDARY_SURFACES = [
  {
    id: 'onboarding',
    name: 'Onboarding Wizard Supply Tier',
    file: path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'OnboardingWizard.tsx')
  },
  {
    id: 'dashboard',
    name: 'Provider Health Dashboard',
    file: path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'dashboard', 'ProviderHealthDashboard.tsx')
  }
];

/**
 * Validate a surface content against required attribution invariants
 */
export function checkSurfaceAttribution(surfaceId, content) {
  const violations = [];

  // Check 1: FCC project mention
  if (!/free-claude-code/i.test(content)) {
    violations.push('Missing "free-claude-code" identifier');
  }

  // Check 2: Upstream GitHub URL
  if (!content.includes('https://github.com/Alishahryar1/free-claude-code')) {
    violations.push('Missing upstream repository link (https://github.com/Alishahryar1/free-claude-code)');
  }

  // Check 3: Dual license designation
  if (!/(?:AGPL-3\.0\s*\/\s*MIT|AGPL-3\.0|MIT)/i.test(content)) {
    violations.push('Missing license notice (AGPL-3.0 / MIT)');
  }

  // Check 4: Verbatim phrase
  const normalizedContent = content.replace(/\s+/g, ' ');
  const normalizedVerbatim = VERBATIM_CREDIT_STRING.replace(/\s+/g, ' ');
  // In JSX, links may be split across tags `<a href="...">...</a>`
  const hasVerbatimOrJsxSplit =
    normalizedContent.includes(normalizedVerbatim) ||
    (normalizedContent.includes('Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT') &&
      normalizedContent.includes('https://github.com/Alishahryar1/free-claude-code'));

  if (!hasVerbatimOrJsxSplit) {
    violations.push(`Missing core credit phrase: "${VERBATIM_CREDIT_STRING}"`);
  }

  return {
    surfaceId,
    passed: violations.length === 0,
    violations
  };
}

/**
 * Run attribution verification across all required surfaces
 */
export async function verifyAllSurfaces() {
  console.log('\n========================================================================');
  console.log('  Permanent Attribution Guard: Verifying Upstream FCC Credit');
  console.log('========================================================================\n');
  console.log(`Invariant: "${VERBATIM_CREDIT_STRING}"\n`);

  let failures = 0;
  const results = [];

  for (const surface of REQUIRED_SURFACES) {
    const relPath = path.relative(PROJECT_ROOT, surface.file).replace(/\\/g, '/');
    try {
      if (!fsSync.existsSync(surface.file)) {
        console.error(`❌ FAILED: Required surface file does not exist: ${relPath}`);
        failures++;
        results.push({ surface: surface.name, file: relPath, passed: false, error: 'File not found' });
        continue;
      }

      const content = await fs.readFile(surface.file, 'utf8');
      const check = checkSurfaceAttribution(surface.id, content);

      if (check.passed) {
        console.log(`  ✅ [${surface.id.toUpperCase()}] ${surface.name}`);
        console.log(`     File: ${relPath}`);
        console.log(`     Credit intact: upstream URL + AGPL-3.0/MIT + verbatim supply layer phrase`);
        results.push({ surface: surface.name, file: relPath, passed: true });
      } else {
        console.error(`  ❌ [${surface.id.toUpperCase()}] ${surface.name} ATTRIBUTION MISSING OR CORRUPTED!`);
        console.error(`     File: ${relPath}`);
        for (const v of check.violations) {
          console.error(`     - Violation: ${v}`);
        }
        failures++;
        results.push({ surface: surface.name, file: relPath, passed: false, violations: check.violations });
      }
    } catch (err) {
      console.error(`  ❌ Error inspecting ${relPath}:`, err);
      failures++;
      results.push({ surface: surface.name, file: relPath, passed: false, error: String(err) });
    }
  }

  // Also check secondary surfaces
  for (const secondary of SECONDARY_SURFACES) {
    const relPath = path.relative(PROJECT_ROOT, secondary.file).replace(/\\/g, '/');
    if (fsSync.existsSync(secondary.file)) {
      const content = await fs.readFile(secondary.file, 'utf8');
      const check = checkSurfaceAttribution(secondary.id, content);
      if (check.passed) {
        console.log(`  ✅ [SECONDARY] ${secondary.name} (${relPath}) credit intact.`);
      }
    }
  }

  // Refactor Resilience Self-Test:
  // Verify that an injected mutation or missing string is guaranteed to fail the guard
  console.log('\n--- Refactor-Resilience & Anti-Tamper Self-Test ---');
  const mockTamperedContent = '<div>Ty-Code IDE - Copyright 2026 Ty-Code Team</div>';
  const selfTestCheck = checkSurfaceAttribution('tampered_test', mockTamperedContent);
  if (!selfTestCheck.passed && selfTestCheck.violations.length > 0) {
    console.log('  ✅ Self-test passed: Guard correctly flags tampered/missing credit strings.');
  } else {
    console.error('  ❌ Self-test FAILED: Guard failed to detect missing credit strings in tampered content!');
    failures++;
  }

  // Refactor test: verify that credit survives renaming or wrapper changes
  const refactoredMockComponent = `
    export function RenamedAboutModalV2() {
      return (
        <section className="about-v2">
          <span>Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT</span>
          <a href="https://github.com/Alishahryar1/free-claude-code">https://github.com/Alishahryar1/free-claude-code</a>
        </section>
      );
    }
  `;
  const refactorCheck = checkSurfaceAttribution('refactor_test', refactoredMockComponent);
  if (refactorCheck.passed) {
    console.log('  ✅ Refactor test passed: Guard accepts refactored AST/component structure if credit is preserved.');
  } else {
    console.error('  ❌ Refactor test FAILED: Guard rejected valid refactored credit structure!');
    failures++;
  }

  console.log('\n========================================================================');
  if (failures === 0) {
    console.log('=== ATTRIBUTION GUARD PASSED: 100% PERMANENT CREDIT VERIFIED         ===');
    console.log('========================================================================\n');
    return { passed: true, results };
  } else {
    console.error(`=== ATTRIBUTION GUARD FAILED: ${failures} FAILURE(S) DETECTED            ===`);
    console.error('========================================================================\n');
    return { passed: false, failures, results };
  }
}

// Direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { passed } = await verifyAllSurfaces();
  process.exit(passed ? 0 : 1);
}
