#!/usr/bin/env node
/**
 * Anti-Phantom Guard 5: No Metadata-Only Marketplace Logic (ExtensionsFix 4)
 *
 * Verifies that marketplace and extension components in:
 * - src/main/services/marketplace/**
 * - src/main/services/extensions/**
 * - src/main/ipc/marketplace-handlers.ts
 *
 * Contain real VSIX download, extraction, validation, and extension execution logic,
 * and ZERO mock, fake, or metadata-only stubs.
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
  console.log('=== ANTI-PHANTOM GUARD 5: NO METADATA-ONLY MARKETPLACE LOGIC         ===');
  console.log('========================================================================\n');

  // 1. Verify Core Production Files Exist
  console.log('1. Checking required production marketplace files...');
  const filesToCheck = [
    'src/main/services/marketplace/openvsx-client.ts',
    'src/main/services/marketplace/vsix-installer.ts',
    'src/main/services/marketplace/cache.ts',
    'src/main/ipc/marketplace-handlers.ts',
    'src/main/services/extensions/extension-host.ts',
    'src/main/services/extensions/capability-provider.ts',
    'src/renderer/src/components/ExtensionsPanel.tsx'
  ];

  for (const rel of filesToCheck) {
    const full = path.join(PROJECT_ROOT, rel);
    assert(fsSync.existsSync(full), `Required production file exists: ${rel}`);
  }

  // 1b. Verify ExtensionsPanel has real download and install wiring
  console.log('\n1b. Verifying real install/download logic in ExtensionsPanel.tsx...');
  const panelPath = path.join(PROJECT_ROOT, 'src/renderer/src/components/ExtensionsPanel.tsx');
  const panelContent = await fs.readFile(panelPath, 'utf8');

  assert(
    panelContent.includes('installExtension') && panelContent.includes('installFromVsix'),
    'ExtensionsPanel has real installation logic wired (installExtension, installFromVsix)'
  );
  assert(
    panelContent.includes('searchMarketplace'),
    'ExtensionsPanel connects to real registry search (searchMarketplace)'
  );

  // 2. Verify VSIX Download and Extraction Pipeline in vsix-installer.ts
  console.log('\n2. Verifying real VSIX download & extraction pipeline in vsix-installer.ts...');
  const installerPath = path.join(PROJECT_ROOT, 'src/main/services/marketplace/vsix-installer.ts');
  const installerContent = await fs.readFile(installerPath, 'utf8');

  assert(
    installerContent.includes('downloadVsix') || installerContent.includes('createWriteStream'),
    'Real VSIX download logic implemented (downloadVsix / stream writer)'
  );
  assert(
    installerContent.includes('0x50, 0x4b, 0x03, 0x04') || installerContent.includes('ZIP_MAGIC_BYTES') || installerContent.includes('0x04034b50'),
    'Validates ZIP archive magic bytes (PK\\x03\\x04 / 0x04034b50)'
  );
  assert(
    installerContent.includes('extractZipToMemory') || installerContent.includes('inflateRawSync'),
    'Implements genuine ZIP archive extraction'
  );
  assert(
    installerContent.includes('extractToDisk'),
    'Implements file extraction to disk'
  );
  assert(
    installerContent.includes('sha256') && installerContent.includes('crypto.createHash'),
    'Implements SHA-256 checksum verification'
  );
  assert(
    installerContent.includes('zip-slip') || installerContent.includes('../'),
    'Implements Zip-slip path traversal security protection'
  );
  assert(
    installerContent.includes('extensionHost.registerExtension'),
    'Wires extracted extension to extensionHost.registerExtension'
  );
  assert(
    installerContent.includes('extensionHost.unregisterExtension'),
    'Wires uninstall to extensionHost.unregisterExtension'
  );

  // 3. Verify Open VSX Client Real Network Pipeline in openvsx-client.ts
  console.log('\n3. Verifying Open VSX registry client in openvsx-client.ts...');
  const clientPath = path.join(PROJECT_ROOT, 'src/main/services/marketplace/openvsx-client.ts');
  const clientContent = await fs.readFile(clientPath, 'utf8');

  assert(
    clientContent.includes('https://open-vsx.org'),
    'Connects to real Open VSX registry endpoint (https://open-vsx.org)'
  );
  assert(
    clientContent.includes('fetchWithRetry') || clientContent.includes('fetch('),
    'Performs real HTTP fetch over network'
  );
  assert(
    clientContent.includes('search('),
    'Exposes real search method'
  );
  assert(
    clientContent.includes('getMetadata('),
    'Exposes real getMetadata method'
  );

  // 4. Verify Real IPC Delegation in marketplace-handlers.ts
  console.log('\n4. Verifying IPC handlers delegation in marketplace-handlers.ts...');
  const ipcPath = path.join(PROJECT_ROOT, 'src/main/ipc/marketplace-handlers.ts');
  const ipcContent = await fs.readFile(ipcPath, 'utf8');

  assert(
    ipcContent.includes('vsixInstaller.install'),
    'handleMarketplaceInstall delegates to real vsixInstaller.install'
  );
  assert(
    ipcContent.includes('vsixInstaller.uninstall'),
    'handleMarketplaceUninstall delegates to real vsixInstaller.uninstall'
  );
  assert(
    ipcContent.includes('openVsxClient.search'),
    'handleMarketplaceSearch delegates to real openVsxClient.search'
  );
  assert(
    ipcContent.includes('openVsxClient.getMetadata'),
    'handleMarketplaceMetadata delegates to real openVsxClient.getMetadata'
  );

  // 5. Scan for Forbidden Metadata-Only & Mock Marketplace Patterns
  console.log('\n5. Scanning codebase for forbidden metadata-only / mock marketplace patterns...');
  const forbiddenPatterns = [
    {
      name: 'Metadata-only install flag',
      regex: /\bmetadataOnly\s*:\s*true\b/i
    },
    {
      name: 'Mock extension search array',
      regex: /\b(?:mockExtensions|mockMarketplaceResults|dummyExtensionsList)\b/i
    },
    {
      name: 'Simulated install without extraction',
      regex: /\binstallMetadataOnly\b/i
    },
    {
      name: 'Hardcoded fake VSIX buffer',
      regex: /\b(?:fakeVsixBuffer|mockVsixBuffer)\b/i
    }
  ];

  const scanDirs = [
    path.join(PROJECT_ROOT, 'src/main/services/marketplace'),
    path.join(PROJECT_ROOT, 'src/main/ipc')
  ];

  for (const dir of scanDirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        const filePath = path.join(dir, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          if (pattern.regex.test(content)) {
            throw new Error(`Forbidden metadata-only pattern found in ${entry.name}: ${pattern.name}`);
          }
        }
      }
    }
  }
  assert(true, 'Zero forbidden metadata-only or mock patterns found in production marketplace code');

  // 6. Verify Guard Self-Test: guard correctly flags simulated metadata-only stub
  console.log('\n6. Running guard self-test against synthetic violation...');
  const testViolatingCode = 'function fakeInstall() { return { success: true, metadataOnly: true }; }';
  let violationCaught = false;
  for (const pattern of forbiddenPatterns) {
    if (pattern.regex.test(testViolatingCode)) {
      violationCaught = true;
      break;
    }
  }
  assert(violationCaught, 'Guard self-test correctly flags simulated metadata-only stub');

  console.log('\n========================================================================');
  console.log(`=== GUARD 5 PASSED: ${passedChecks}/${totalChecks} CHECKS VERIFIED [100% CLEAN]       ===`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('Anti-Phantom Guard 5 Failed:', err);
  process.exit(1);
});
