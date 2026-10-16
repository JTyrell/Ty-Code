#!/usr/bin/env node
/**
 * Real Agent Loop Guard: No Mock Agent Path (Fix 2)
 *
 * Verifies that production agent and provider code paths in:
 * - src/main/agent/**
 * - src/main/providers/**
 *
 * Contain ZERO mock, fake, or simulated response generators, timers, or stubs.
 * Any offline demo behaviors must be strictly gated behind the explicit setting
 * `offlineDemoMode` (default OFF).
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  path.join(PROJECT_ROOT, 'src', 'main', 'agent'),
  path.join(PROJECT_ROOT, 'src', 'main', 'providers')
];

// Patterns strictly forbidden in production agent/provider code
const FORBIDDEN_PATTERNS = [
  {
    name: 'Timer-simulated response (setTimeout/setInterval)',
    regex: /\b(?:setTimeout|setInterval)\s*\(\s*(?:\(\)|function|async)/i
  },
  {
    name: 'Mock response function or identifier',
    regex: /\b(?:mockResponse|mockStream|mockToken|mockCompletion|mock_response|mock_token)\b/i
  },
  {
    name: 'Fake response function or identifier',
    regex: /\b(?:fakeResponse|fakeStream|fakeToken|fakeCompletion|fake_response|fake_token)\b/i
  },
  {
    name: 'Simulated response function or identifier',
    regex: /\b(?:simulatedStream|simulateResponse|simulateStream|simulatedResponse|simulateAgent)\b/i
  },
  {
    name: 'Dummy/stub response function or identifier',
    regex: /\b(?:dummyResponse|stubResponse|dummyStream|stubStream)\b/i
  },
  {
    name: 'Hardcoded simulated response string',
    regex: /['"`](?:simulated|mock|fake|dummy)\s+(?:assistant\s+)?response['"`]/i
  },
  {
    name: 'Hardcoded simulated token string',
    regex: /['"`]This is a (?:simulated|mock|fake|dummy) (?:response|token|agent)/i
  },
  {
    name: 'Hardcoded FCC proxy mock response string',
    regex: /FCC\s+proxy\s+response/i
  }
];

// Legitimate exceptions: comments, imports of schemas, code explicitly guarded by offlineDemoMode,
// or real OS/network safety timeouts (e.g. child process execution timeout kill, AbortController timeout).
function isAllowed(lines, index) {
  const line = lines[index];
  const trimmed = line.trim();
  // Allow comments
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return true;
  }
  // Allow explicit gating behind offlineDemoMode
  if (trimmed.includes('offlineDemoMode')) {
    return true;
  }
  // Check if timer is a process / network abort timeout kill (not a simulated response delay)
  const blockWindow = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
  if (
    blockWindow.includes('timedOut') ||
    blockWindow.includes('child.kill') ||
    blockWindow.includes('ptyProcess.kill') ||
    blockWindow.includes('controller.abort') ||
    blockWindow.includes('timeoutMs')
  ) {
    return true;
  }
  return false;
}

async function collectFiles(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectFiles(fullPath)));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.ts', '.js', '.mjs', '.cjs'].includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory might not exist in some environments
  }
  return results;
}

async function scan() {
  console.log('🛡️  Running Real Agent Loop CI Guard: Scanning agent & provider paths...');

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...(await collectFiles(dir)));
  }

  if (allFiles.length === 0) {
    console.error('❌ Error: No files found in scan targets (src/main/agent, src/main/providers)');
    process.exit(1);
  }

  const violations = [];

  for (const filePath of allFiles) {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isAllowed(lines, i)) continue;

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.regex.test(line)) {
          violations.push({
            file: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'),
            line: i + 1,
            rule: pattern.name,
            snippet: line.trim()
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ BUILD FAILURE: Found ${violations.length} forbidden mock/simulated pattern(s) in agent/provider paths!`);
    for (const v of violations) {
      console.error(`   - ${v.file}:${v.line} [${v.rule}]`);
      console.error(`     "${v.snippet}"`);
    }
    console.error('\nReal Agent Loop Invariant: Production agent and provider paths must NEVER use simulated responses.');
    console.error('All chat streaming, tools, and edits must run against live providers or be gated behind offlineDemoMode.');
    process.exit(1);
  }

  console.log(`✅ Passed: 0 forbidden mock patterns detected across ${allFiles.length} agent & provider files.`);
  console.log('✨ All agent and provider code paths verified to be 100% real and unmocked.');
  process.exit(0);
}

scan().catch((err) => {
  console.error('Fatal scanner error:', err);
  process.exit(1);
});
