#!/usr/bin/env node
/**
 * CI Truth Guard: No Fixture Replies in Production Code
 *
 * 1. Verifies that zero mock fixture strings or canned response stubs
 *    from tests/fixtures.json appear in any file under src/.
 * 2. Bans ASSISTANT-SHAPED SKELETON REPLIES from the renderer message
 *    content render path (ChatMessage.tsx, chat/* message components,
 *    chat-store.ts). A zero-token assistant bubble must render the Thinking
 *    shimmer / status chunks — never a canned sentence that resembles a
 *    reply. Any reintroduction fails the build.
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

/**
 * Assistant-shaped placeholder constants forbidden in the message content
 * render path. These read like assistant replies; empty states must render
 * shimmer/status chunks instead (see Prompt 2, no-fixture-reply policy).
 */
const ASSISTANT_PLACEHOLDER_PATTERNS = [
  'I am ready to help',
  'Please provide your task or prompt',
  'Please provide your prompt',
  'Please provide your task',
  'How can I assist you',
  'standing by for your task',
  'awaiting your instructions'
];

/** Files that constitute the renderer message content render path. */
const MESSAGE_RENDER_PATH_FILES = [
  'src/renderer/src/components/ChatMessage.tsx',
  'src/renderer/src/state/chat-store.ts'
];

/** Never render the literal "default" as a route/badge fallback. */
const DEFAULT_BADGE_PATTERN = /metadata\?\.(providerId|modelId)\s*\|\|\s*['"]default['"]/;

/**
 * Hard-coded success text may never be emitted as a provider token. Completion
 * must be derived from live tool evidence, not a production reply fixture.
 */
const TOKEN_LITERAL_SINK = /onChunk\s*\(\s*\{\s*type\s*:\s*['"]token['"][\s\S]{0,240}?content\s*:\s*(['"`])([\s\S]{1,300}?)\1[\s\S]{0,80}?\}\s*\)/g;
const SUCCESS_CLAIM = /\b(?:(?:implementation|task|work)\s+(?:is\s+)?(?:complete|completed|done)|all\s+(?:tests?|checks?)\s+(?:pass|passed|passing)|successfully\s+(?:implemented|completed|verified))\b/i;

async function collectFiles(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip tests/ or mocks/ folders per specification ("outside tests/ or mocks/")
        if (['tests', 'mocks', '__tests__', '__mocks__'].includes(entry.name.toLowerCase())) {
          continue;
        }
        results.push(...(await collectFiles(fullPath)));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Skip test files if colocated
        if (/\.(test|spec)\.[a-z0-9]+$/i.test(entry.name)) {
          continue;
        }
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

  // Reject assistant success sentences wired directly into token emission.
  // Dynamic provider chunks and evidence-derived status/error cards are allowed.
  for (const file of srcFiles) {
    const content = await fs.readFile(file, 'utf-8');
    for (const match of content.matchAll(TOKEN_LITERAL_SINK)) {
      const literal = match[2];
      if (!SUCCESS_CLAIM.test(literal)) continue;
      const relPath = path.relative(projectRoot, file).replace(/\\/g, '/');
      const lineNumber = content.slice(0, match.index).split('\n').length;
      console.error('✗ VIOLATION: Hard-coded successful assistant reply emitted as a token!');
      console.error(`  File: ${relPath}:${lineNumber}`);
      console.error(`  Literal: "${literal.trim()}"`);
      console.error('  Policy: success must come from live completion evidence and provider output, never a canned production token.\n');
      violationCount++;
    }
  }

  if (violationCount > 0) {
    console.error(`\n❌ FAILED: ${violationCount} forbidden fixture or canned-success violation(s) found in src/.`);
    console.error('Production code must connect to real providers and derive success from real evidence.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Phase 2: assistant-shaped placeholder replies in the message content path
  // ---------------------------------------------------------------------------
  let messagePathViolations = 0;

  for (const relFile of MESSAGE_RENDER_PATH_FILES) {
    const absFile = path.join(projectRoot, relFile);
    let content;
    try {
      content = await fs.readFile(absFile, 'utf-8');
    } catch {
      continue; // File may be renamed; Phase 1 global scan still applies.
    }
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      const lower = line.toLowerCase();
      for (const placeholder of ASSISTANT_PLACEHOLDER_PATTERNS) {
        if (lower.includes(placeholder.toLowerCase())) {
          console.error(`✗ VIOLATION: Assistant-shaped placeholder reply in message render path!`);
          console.error(`  File: ${relFile}:${i + 1}`);
          console.error(`  Phrase: "${placeholder}"`);
          console.error(`  Line: ${line.trim()}`);
          console.error(`  Policy: an empty assistant bubble must render the Thinking shimmer/status chunks (Routing/Thinking), never a canned reply.\n`);
          messagePathViolations++;
        }
      }
      if (DEFAULT_BADGE_PATTERN.test(line)) {
        console.error(`✗ VIOLATION: Route badge renders the literal "default" fallback!`);
        console.error(`  File: ${relFile}:${i + 1}`);
        console.error(`  Line: ${line.trim()}`);
        console.error(`  Policy: an unknown live route must render "routing…" — never "default".\n`);
        messagePathViolations++;
      }
    });
  }

  if (messagePathViolations > 0) {
    console.error(`\n❌ FAILED: ${messagePathViolations} canned-reply violation(s) in the renderer message path.`);
    console.error('Zero canned assistant text may exist in renderer message components.');
    process.exit(1);
  }

  console.log(`✓ Truth Guard Passed: Verified ${srcFiles.length} source files in src/.`);
  console.log(`  Zero forbidden fixture strings or hard-coded successful token replies detected.`);
  console.log(`  Message content path clean: no assistant-shaped placeholder replies, no "default" badge fallback.\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error during Truth Guard run:', err);
  process.exit(1);
});
