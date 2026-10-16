#!/usr/bin/env node
/**
 * Anti-Phantom Guard: No Fake Extension Data (ExtensionsFix 5)
 *
 * Enforces that extension lists are NEVER hardcoded into source files.
 * Extension data MUST originate from:
 *   1. Real registry API queries (Open VSX REST API)
 *   2. Real local filesystem directory scan of installed extensions
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

async function main() {
  console.log('========================================================================');
  console.log('=== ANTI-PHANTOM GUARD: NO FAKE EXTENSION DATA                       ===');
  console.log('========================================================================\n');

  // 1. Verify Installed Extensions come from real filesystem scan
  console.log('1. Verifying installed extensions originate from filesystem directory scan...');
  const installerPath = path.join(PROJECT_ROOT, 'src/main/services/marketplace/vsix-installer.ts');
  const installerCode = await fs.readFile(installerPath, 'utf8');

  assert(
    installerCode.includes('fs.readdir') && installerCode.includes('package.json'),
    'vsix-installer.ts scans installed directory on disk and reads package.json manifests'
  );
  assert(
    installerCode.includes('extensionsDir') || installerCode.includes('getExtensionsDir'),
    'vsix-installer.ts resolves dynamic disk directory for installed extensions'
  );

  // 2. Verify Marketplace Extensions come from live Open VSX API
  console.log('\n2. Verifying marketplace search queries live registry API...');
  const clientPath = path.join(PROJECT_ROOT, 'src/main/services/marketplace/openvsx-client.ts');
  const clientCode = await fs.readFile(clientPath, 'utf8');

  assert(
    clientCode.includes('/api/-/search') || clientCode.includes('open-vsx.org/api'),
    'openvsx-client.ts queries real Open VSX search endpoint'
  );
  assert(
    !clientCode.includes('const mockExtensions') && !clientCode.includes('const dummyExtensions'),
    'openvsx-client.ts contains no hardcoded mock extension datasets'
  );

  // 3. Scan codebase for forbidden hardcoded extension data patterns
  console.log('\n3. Scanning production codebase for hardcoded extension catalogs...');
  const forbiddenPatterns = [
    {
      name: 'Hardcoded mock extension array',
      regex: /\b(?:const|let|var)\s+(?:mockExtensions|fakeExtensions|dummyExtensions|stubExtensions|hardcodedExtensions|SAMPLE_EXTENSIONS)\s*=/i
    },
    {
      name: 'Hardcoded marketplace fallback array with extension items',
      regex: /\bconst\s+DEFAULT_MARKETPLACE_LIST\s*=\s*\[\s*\{.*displayName/i
    },
    {
      name: 'Simulated fake extension catalog',
      regex: /\b(?:fakeCatalog|mockCatalog|stubCatalog)\s*:\s*\[/i
    }
  ];

  const scanDirs = [
    path.join(PROJECT_ROOT, 'src/main/services/marketplace'),
    path.join(PROJECT_ROOT, 'src/main/services/extensions'),
    path.join(PROJECT_ROOT, 'src/main/ipc'),
    path.join(PROJECT_ROOT, 'src/renderer/src/state'),
    path.join(PROJECT_ROOT, 'src/renderer/src/components/extensions')
  ];

  for (const dir of scanDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js'))) {
        const filePath = path.join(dir, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          if (pattern.regex.test(content)) {
            throw new Error(`Hardcoded fake extension data found in ${entry.name}: ${pattern.name}`);
          }
        }
      }
    }
  }
  assert(true, 'Zero hardcoded extension catalogs or mock extension arrays in production code');

  // 4. Verify Guard Self-Test: guard catches simulated hardcoded extension array
  console.log('\n4. Running guard self-test against synthetic hardcoded data violation...');
  const violatingSnippet = 'const mockExtensions = [{ id: "fake.ext", displayName: "Fake Extension" }];';
  let caught = false;
  for (const pattern of forbiddenPatterns) {
    if (pattern.regex.test(violatingSnippet)) {
      caught = true;
      break;
    }
  }
  assert(caught, 'Guard self-test correctly flags synthetic hardcoded extension array');

  console.log('\n========================================================================');
  console.log(`=== GUARD PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]             ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Anti-Phantom Guard (no-fake-extension-data) Failed:', err);
  process.exit(1);
});
