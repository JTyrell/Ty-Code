import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase7-'));
const bundleDir = path.join(projectRoot, 'node_modules', '.cache', 'ty-code-phase7');
await fs.mkdir(bundleDir, { recursive: true });

// Bundle TypeScript services for Node execution
const bundleConfig = (entry, outfile) =>
  build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile: path.join(bundleDir, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    external: ['electron', 'simple-git', 'node-pty', 'electron-updater']
  });

await Promise.all([
  bundleConfig('src/main/services/inline-completion-service.ts', 'inline-completion.cjs'),
  bundleConfig('src/main/services/ai-code-review-service.ts', 'code-review.cjs'),
  bundleConfig('src/main/services/project-indexer.ts', 'project-indexer.cjs'),
  bundleConfig('src/main/services/natural-language-service.ts', 'natural-language.cjs'),
  bundleConfig('src/main/services/ai-refactor-service.ts', 'ai-refactor.cjs'),
  bundleConfig('src/main/services/conversation-memory.ts', 'conversation-memory.cjs'),
  bundleConfig('src/main/services/workspace-edit-preview.ts', 'workspace-edit-preview.cjs')
]);

const { InlineCompletionService } = require(path.join(bundleDir, 'inline-completion.cjs'));
const { AiCodeReviewService } = require(path.join(bundleDir, 'code-review.cjs'));
const { ProjectIndexerService } = require(path.join(bundleDir, 'project-indexer.cjs'));
const { NaturalLanguageService } = require(path.join(bundleDir, 'natural-language.cjs'));
const { AiRefactorService } = require(path.join(bundleDir, 'ai-refactor.cjs'));
const { ConversationMemoryService } = require(path.join(bundleDir, 'conversation-memory.cjs'));
const { WorkspaceEditPreviewService } = require(path.join(bundleDir, 'workspace-edit-preview.cjs'));

let passedTests = 0;
let failedTests = 0;

function verify(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    failedTests++;
  }
}

async function runValidation() {
  console.log('================================================================');
  console.log('  TY-CODE PHASE 7: ADVANCED AI FEATURES & DIFFERENTIATION VALIDATION');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Assertion 1: Inline AI Completions (<300ms, multi-line, prefix cache)
  // -------------------------------------------------------------
  console.log('--- Assertion 1: Inline AI Completions Latency & Suggestions ---');
  const completionService = new InlineCompletionService();

  const samplePrefix = `async function fetchUserData(userId: string): Promise<User> {\n  try {\n    `;
  const startTime = Date.now();
  const completionResult = await completionService.getCompletions({
    filePath: 'src/services/user-service.ts',
    language: 'typescript',
    prefix: samplePrefix,
    suffix: '\n}',
    line: 3,
    character: 5,
    triggerKind: 'automatic'
  });
  const durationMs = Date.now() - startTime;

  console.log(`  [Timing] Inline completion generated in ${durationMs}ms (target: < 300ms)`);
  verify(durationMs < 300, `Inline completions appear within 300ms of typing pause (actual: ${durationMs}ms)`);
  verify(completionResult.items.length > 0, 'Generates non-empty inline completion candidates');
  verify(completionResult.items.some((i) => i.text.includes('catch') || i.text.includes('const response')), 'Context-aware multi-line completion generated for try block');

  // Cache hit verification (<5ms)
  const cacheStartTime = Date.now();
  const cachedResult = await completionService.getCompletions({
    filePath: 'src/services/user-service.ts',
    language: 'typescript',
    prefix: samplePrefix,
    suffix: '\n}',
    line: 3,
    character: 5,
    triggerKind: 'automatic'
  });
  const cacheDurationMs = Date.now() - cacheStartTime;
  verify(cacheDurationMs < 15, `Prefix cache returns suggestions instantaneously (actual: ${cacheDurationMs}ms)`);
  verify(cachedResult.items.length === completionResult.items.length, 'Cached items match initial response');

  // React hook completion
  const reactResult = await completionService.getCompletions({
    filePath: 'src/components/Counter.tsx',
    language: 'typescriptreact',
    prefix: `export function Counter() {\n  const [count, setCount] = `,
    suffix: `\n  return <div>{count}</div>;\n}`,
    line: 2,
    character: 28,
    triggerKind: 'automatic'
  });
  verify(reactResult.items.some((i) => i.text.includes('useState')), 'Contextually synthesizes React useState hook completion');

  // -------------------------------------------------------------
  // Assertion 2: AI Code Review (Identifies >= 80% common bugs)
  // -------------------------------------------------------------
  console.log('\n--- Assertion 2: AI Code Review Bug Detection & One-Click Fixes ---');
  const reviewService = new AiCodeReviewService(testDir);

  const buggyCode = `
import React from 'react';

export function ProcessData(user: any) {
  // Bug 1: Loose equality
  if (user == null) {
    return null;
  }

  // Bug 2: Potential null dereference
  const profile = user.profile.address.city;

  // Bug 3: Floating unhandled promise
  fetch('/api/analytics', { method: 'POST' });

  // Bug 4: Dangerous eval execution
  const dynamicVal = eval('1 + 2');

  // Bug 5: XSS vulnerability with innerHTML
  element.innerHTML = '<div>' + user.name + '</div>';

  // Bug 6: SQL injection vulnerability via string concatenation
  const query = "SELECT * FROM users WHERE id = '" + user.id + "'";

  // Bug 7: Timer leak with unreferenced setInterval
  setInterval(() => {
    console.log('tick');
  }, 1000);

  return <div>{profile}</div>;
}
`;

  const reviewResult = await reviewService.reviewCode({
    filePath: 'src/components/ProcessData.tsx',
    content: buggyCode,
    language: 'typescriptreact'
  });

  const targetBugCategories = [
    'null-dereference',
    'unhandled-promise',
    'strict-equality',
    'eval-usage',
    'xss-innerhtml',
    'sql-injection',
    'timer-leak'
  ];

  const detectedCategories = new Set();
  for (const f of reviewResult.findings) {
    if (!f.ruleId) continue;
    detectedCategories.add(f.ruleId);
    detectedCategories.add(f.ruleId.replace(/^rule-/, ''));
    if (f.ruleId.includes('eval')) detectedCategories.add('eval-usage');
    if (f.ruleId.includes('innerhtml')) detectedCategories.add('xss-innerhtml');
    if (f.ruleId.includes('leak')) detectedCategories.add('timer-leak');
  }

  const caughtCount = targetBugCategories.filter((cat) => detectedCategories.has(cat)).length;
  const detectionRate = (caughtCount / targetBugCategories.length) * 100;

  console.log(`  [Detection Rate] Caught ${caughtCount}/${targetBugCategories.length} common bug categories (${detectionRate.toFixed(1)}%)`);
  verify(detectionRate >= 80, `AI code review identifies at least 80% of common bugs (actual: ${detectionRate.toFixed(1)}%)`);
  verify(reviewResult.findings.some((f) => f.ruleId?.includes('null-dereference')), 'Identified null dereference vulnerability');
  verify(reviewResult.findings.some((f) => f.ruleId?.includes('sql-injection') && f.severity === 'error'), 'Identified SQL injection vulnerability');
  verify(reviewResult.findings.some((f) => f.ruleId?.includes('innerhtml') && f.severity === 'error'), 'Identified XSS innerHTML vulnerability');
  verify(reviewResult.findings.some((f) => f.suggestedFix !== undefined), 'Provides one-click actionable fixes for detected findings');

  // Custom rules registration & persistence
  const customRule = {
    id: 'no-console-warn',
    name: 'Disallow console.warn',
    severity: 'warning',
    category: 'style',
    description: 'Use logger service instead of console.warn',
    pattern: 'console\\.warn\\(',
    fixTemplate: 'logger.warn(',
    enabled: true
  };
  await reviewService.saveCustomRule(customRule);
  const rules = await reviewService.getRules();
  verify(rules.some((r) => r.id === 'no-console-warn'), 'Custom review rule saved and loaded successfully');

  // -------------------------------------------------------------
  // Assertion 3: Project Indexing (<10s for 1000 files)
  // -------------------------------------------------------------
  console.log('\n--- Assertion 3: Project Indexing Speed & Cross-File Retrieval ---');
  const indexDir = path.join(testDir, 'benchmark-project');
  await fs.mkdir(indexDir, { recursive: true });

  // Generate 1,000 files with diverse symbols, imports, and frameworks
  console.log('  Generating 1,000 source files for indexing benchmark...');
  const fileCreationPromises = [];
  for (let i = 0; i < 1000; i++) {
    const subFolder = path.join(indexDir, `module_${Math.floor(i / 50)}`);
    const fileContent = `
import { Helper } from '../helpers';
export interface ItemModel${i} {
  id: string;
  index: number;
}
export class WorkerService${i} {
  runTask${i}(arg: string): boolean {
    return arg.length > 0;
  }
}
export function utilityMethod${i}() {
  return ${i} * 2;
}
`;
    fileCreationPromises.push(
      fs.mkdir(subFolder, { recursive: true }).then(() =>
        fs.writeFile(path.join(subFolder, `item_${i}.ts`), fileContent, 'utf-8')
      )
    );
  }
  await Promise.all(fileCreationPromises);

  // Add package.json with framework signals
  await fs.writeFile(
    path.join(indexDir, 'package.json'),
    JSON.stringify({
      name: 'benchmark-app',
      dependencies: { react: '^18.0.0', next: '^14.0.0', tailwindcss: '^3.0.0' }
    }, null, 2),
    'utf-8'
  );

  // Add custom instructions file
  const customInstructionsDir = path.join(indexDir, '.ty-code');
  await fs.mkdir(customInstructionsDir, { recursive: true });
  await fs.writeFile(
    path.join(customInstructionsDir, 'instructions.md'),
    '# Project Conventions\nAlways use strict TypeScript types and avoid any.\n',
    'utf-8'
  );

  const indexer = new ProjectIndexerService();
  const indexStart = Date.now();
  const indexStats = await indexer.indexWorkspace(indexDir);
  const indexDuration = (Date.now() - indexStart) / 1000;

  console.log(`  [Benchmark] Indexed ${indexStats.fileCount} files (${indexStats.symbolCount} symbols) in ${indexDuration.toFixed(2)}s (target: < 10s)`);
  verify(indexDuration < 10.0, `Project indexing completes in under 10 seconds for 1000 files (actual: ${indexDuration.toFixed(2)}s)`);
  verify(indexStats.fileCount >= 1000, `Indexed all created files (actual: ${indexStats.fileCount})`);
  verify(indexStats.symbolCount > 2000, `Extracted rich symbols across project (actual: ${indexStats.symbolCount})`);
  verify(indexStats.frameworks.some((f) => f.toLowerCase().includes('react')) && indexStats.frameworks.some((f) => f.toLowerCase().includes('next')), 'Detected project frameworks accurately');
  verify(indexStats.customInstructions !== undefined && indexStats.customInstructions.includes('Project Conventions'), 'Ingested workspace custom instructions');

  // Search project symbols
  const symbolSearchResults = indexer.searchSymbols('WorkerService500');
  verify(symbolSearchResults.length > 0 && symbolSearchResults[0].name === 'WorkerService500', 'Discovers and locates exact symbol in indexed workspace');

  // Codebase Q&A query
  const qaAnswer = indexer.queryCodebase('What frameworks does this project use?');
  verify(qaAnswer.toLowerCase().includes('react') || qaAnswer.toLowerCase().includes('next'), 'Codebase Q&A synthesizes project architectural facts');

  // -------------------------------------------------------------
  // Assertion 4: Natural Language Command Palette (>=90% accuracy)
  // -------------------------------------------------------------
  console.log('\n--- Assertion 4: Natural Language Commands Parsing (>=90% accuracy) ---');
  const nlService = new NaturalLanguageService();

  const commandTestCases = [
    { input: 'open the settings page', expectedAction: 'open_settings' },
    { input: 'toggle terminal window', expectedAction: 'toggle_terminal' },
    { input: 'find in files for todo comments', expectedAction: 'open_search' },
    { input: 'create a new branch named feature-login', expectedAction: 'git_branch' },
    { input: 'show git commit changes and history', expectedAction: 'git_commit' },
    { input: 'format this current document', expectedAction: 'format_document' },
    { input: 'start automated code review on this file', expectedAction: 'ai_code_review' },
    { input: 'extract this selected block into a function', expectedAction: 'ai_refactor_extract_function' },
    { input: 'generate unit tests for this function', expectedAction: 'generate_tests' },
    { input: 'write documentation docstring for this method', expectedAction: 'generate_docs' },
    { input: 'query users created in the last 7 days', expectedAction: 'generate_sql' },
    { input: 'regex to match valid email addresses', expectedAction: 'generate_regex' }
  ];

  let correctCommands = 0;
  for (const testCase of commandTestCases) {
    const result = await nlService.parseCommand({ input: testCase.input });
    if (result.intent === testCase.expectedAction || result.action === testCase.expectedAction) {
      correctCommands++;
    } else {
      console.error(`    Mismatch for "${testCase.input}": expected ${testCase.expectedAction}, got ${result.intent || result.action}`);
    }
  }

  const nlAccuracy = (correctCommands / commandTestCases.length) * 100;
  console.log(`  [Accuracy] Accurately interpreted ${correctCommands}/${commandTestCases.length} natural language commands (${nlAccuracy.toFixed(1)}%)`);
  verify(nlAccuracy >= 90, `Natural language commands execute correctly 90% of the time (actual: ${nlAccuracy.toFixed(1)}%)`);

  // Natural language generators
  const testGen = await nlService.generateCode({
    type: 'test',
    prompt: 'test utilityMethod',
    language: 'typescript',
    contextCode: 'export function utilityMethod(a: number, b: number): number { return a + b; }'
  });
  verify(testGen.code.includes('describe') && testGen.code.includes('expect('), 'Generated test suite with describe/it/expect assertions');

  const sqlGen = await nlService.generateCode({
    type: 'sql',
    prompt: 'find all active users with role admin ordered by created_at descending'
  });
  verify(sqlGen.code.includes('SELECT') && sqlGen.code.includes('WHERE') && sqlGen.code.includes('ORDER BY'), 'Generated correct SQL query from natural language');

  const regexGen = await nlService.generateCode({
    type: 'regex',
    prompt: 'match valid email addresses'
  });
  verify(regexGen.code.includes('@') && regexGen.explanation.length > 0, 'Generated regex with detailed step-by-step breakdown');

  // -------------------------------------------------------------
  // Assertion 5: Persistent Conversation Memory System
  // -------------------------------------------------------------
  console.log('\n--- Assertion 5: Conversation Memory Persistence & Query Retrieval ---');
  const memoryService = new ConversationMemoryService(testDir);
  await memoryService.initialize();

  await memoryService.saveEntry({
    role: 'user',
    content: 'We decided to use PostgreSQL for relational storage and Redis for caching session tokens.',
    tags: ['database', 'architecture', 'caching']
  });

  await memoryService.saveEntry({
    role: 'assistant',
    content: 'Understood. Authentication tokens are issued as JWTs and verified against Redis revocation lists.',
    tags: ['auth', 'security', 'jwt']
  });

  const memoryResults = await memoryService.searchMemory('PostgreSQL Redis database architecture');
  verify(memoryResults.length > 0, 'Discovered relevant conversation memories via semantic keyword matching');
  verify(memoryResults[0].content.includes('PostgreSQL'), 'Retrieved exact memory content containing previous architectural decisions');

  const allMemories = await memoryService.getAllEntries();
  verify(allMemories.length === 2, 'Stored and retrieved full conversation memory records');

  // -------------------------------------------------------------
  // Assertion 6: AI Refactoring with Myers Diff Preview & Rollback
  // -------------------------------------------------------------
  console.log('\n--- Assertion 6: AI Refactoring Engine & Myers Diff Workspace Edit Preview ---');
  const refactorService = new AiRefactorService();
  const editPreviewService = new WorkspaceEditPreviewService(testDir, undefined, { isTracked: async () => false });

  const initialCode = `function calculateTotal(items: any[]) {\n  const tax = 0.08;\n  const subtotal = items.reduce((acc, item) => acc + item.price, 0);\n  return subtotal + (subtotal * tax);\n}`;
  const refactorResult = await refactorService.refactor({
    type: 'add_types',
    filePath: 'src/utils/calculator.ts',
    content: initialCode,
    language: 'typescript'
  });

  verify(refactorResult.modifiedContent !== initialCode, 'AI Refactoring produced typed modifications');
  verify(refactorResult.explanation.length > 0, 'Provides human-readable refactoring rationale');

  // Create WorkspaceEditPreview for user review
  const testRefactorFile = path.join(testDir, 'calculator.ts');
  await fs.writeFile(testRefactorFile, initialCode, 'utf-8');

  const preview = await editPreviewService.createRefactorPreview(
    testRefactorFile,
    refactorResult.modifiedContent,
    'Add TypeScript Types Refactoring'
  );

  verify(preview.files.length === 1, 'Refactor preview generated with single targeted file');
  verify(preview.files[0].diff && (preview.files[0].diff.hunks?.length > 0 || preview.files[0].diff.edits?.length > 0), 'Myers diff hunks generated for refactoring preview');

  // Apply preview atomically
  const applyResult = await editPreviewService.applyPreview(preview.previewId);
  verify(Boolean(applyResult.transactionId), 'Applied refactoring edit atomically to disk');
  const diskContent = await fs.readFile(testRefactorFile, 'utf-8');
  verify(diskContent === refactorResult.modifiedContent, 'Disk contents match refactored code exactly');

  // Undo transaction atomically
  const undoResult = await editPreviewService.undoTransaction(applyResult.transactionId);
  verify(undoResult.transactionId === applyResult.transactionId, 'Successfully rolled back refactoring transaction');
  const rolledBackContent = await fs.readFile(testRefactorFile, 'utf-8');
  verify(rolledBackContent === initialCode, 'File on disk restored to pristine initial content after rollback');

  // Cleanup test scratch directory
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});

  console.log('\n================================================================');
  console.log(`  VALIDATION SUMMARY: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runValidation().catch((err) => {
  console.error('Validation script crashed with error:', err);
  process.exit(1);
});
