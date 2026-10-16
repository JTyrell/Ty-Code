#!/usr/bin/env node
/**
 * CI Truth Guard: No Fixture Replies in Production Code
 *
 * Verifies that zero mock fixture strings or canned response stubs
 * from tests/fixtures.json appear in any file under src/.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const FIXTURES_FILE = path.join(projectRoot, 'tests', 'fixtures.json');
const SRC_DIR = path.join(projectRoot, 'src');

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
        if (['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs'].includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return results;
}

async function run() {
  console.log('🔒 Running Truth Guard: Scanning src/ for forbidden fixture strings...\n');

  let fixturesData;
  try {
    const raw = await fs.readFile(FIXTURES_FILE, 'utf-8');
    fixturesData = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ Failed to load fixtures file: ${FIXTURES_FILE}`, err);
    process.exit(1);
  }

  const forbiddenStrings = fixturesData.forbiddenStrings || [];
  if (!forbiddenStrings.length) {
    console.error('✗ No forbidden strings found in fixtures.json');
    process.exit(1);
  }

  const srcFiles = await collectFiles(SRC_DIR);
  let violationCount = 0;

  for (const file of srcFiles) {
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const forbidden of forbiddenStrings) {
        if (line.includes(forbidden)) {
          const relPath = path.relative(projectRoot, file).replace(/\\/g, '/');
          console.error(`✗ VIOLATION: Forbidden fixture string detected in production code!`);
          console.error(`  File: ${relPath}:${i + 1}`);
          console.error(`  Forbidden: "${forbidden}"`);
          console.error(`  Line: ${line.trim()}\n`);
          violationCount++;
        }
      }
    }
  }

  if (violationCount > 0) {
    console.error(`\n❌ FAILED: ${violationCount} forbidden fixture string violation(s) found in src/.`);
    console.error('Production code must connect to real providers or fail transparently. Mock text is forbidden.');
    process.exit(1);
  }

  console.log(`✓ Truth Guard Passed: Verified ${srcFiles.length} source files in src/.`);
  console.log(`  Zero forbidden fixture strings detected. All responses must originate from real providers.\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error during Truth Guard run:', err);
  process.exit(1);
});
