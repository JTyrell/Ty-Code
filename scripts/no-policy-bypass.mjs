#!/usr/bin/env node
/**
 * Ty-Code Enterprise Policy Guard (no-policy-bypass.mjs)
 *
 * Enforces architectural invariants:
 * Mode, role, provider, and terminal resolution paths must NEVER bypass Enterprise Policy.
 * All critical policy paths must consult `policyEngine.assertAllowed`, `policyEngine.isRoleAllowed`,
 * `policyEngine.isModeAllowed`, or `policyEngine.getTerminalPolicy`.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CRITICAL_PATHS = [
  {
    file: 'src/main/agent/prompt-assembler/role-registry.ts',
    name: 'Role Registry policy enforcement',
    patterns: [/policyEngine\.(?:isRoleAllowed|assertAllowed)/]
  },
  {
    file: 'src/main/agent/prompt-assembler/intent-classifier.ts',
    name: 'Intent Classifier mode policy enforcement',
    patterns: [/policyEngine\.(?:isModeAllowed|assertAllowed|getDefaultMode)/]
  },
  {
    file: 'src/main/services/security-policy.ts',
    name: 'Security Policy terminal enforcement',
    patterns: [/policyEngine\.(?:getTerminalPolicy|assertAllowed)/]
  },
  {
    file: 'src/main/providers/provider-gateway.ts',
    name: 'Provider Gateway pre-dispatch policy enforcement',
    patterns: [/policyEngine\.(?:assertAllowed|isProviderAllowed)/]
  }
];

async function runCheck() {
  console.log('🛡️  Running Enterprise Policy Guard: Scanning resolution paths for bypasses...');
  let failed = false;

  for (const check of CRITICAL_PATHS) {
    const fullPath = path.join(PROJECT_ROOT, check.file);
    try {
      const source = await fs.readFile(fullPath, 'utf8');
      const allMatched = check.patterns.every((pat) => pat.test(source));
      if (!allMatched) {
        console.error(`❌ [POLICY GUARD] ${check.name} failed! Missing policyEngine traversal in ${check.file}`);
        failed = true;
      } else {
        console.log(`  ✓ ${check.name} verified in ${check.file}`);
      }
    } catch (err) {
      console.error(`❌ [POLICY GUARD] Could not read ${check.file}:`, err);
      failed = true;
    }
  }

  if (failed) {
    console.error('❌ Enterprise Policy Guard FAILED: Bypass detected!');
    process.exit(1);
  } else {
    console.log('✅ Enterprise Policy Guard PASSED: Zero bypasses detected. All paths traverse policy-engine.');
    process.exit(0);
  }
}

runCheck().catch((err) => {
  console.error('[POLICY GUARD] Unexpected failure:', err);
  process.exit(1);
});
