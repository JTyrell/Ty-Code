import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase5-3-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

console.log('Compiling TypeScript services with esbuild for Phase 5.3 validation...');
const bundleConfig = (entry, outfile) =>
  build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile: path.join(bundleDir, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    external: ['electron']
  });

await Promise.all([
  bundleConfig('src/main/services/orchestration/tools/index.ts', 'tools.cjs'),
  bundleConfig('src/main/services/orchestration/session-store.ts', 'session-store.cjs'),
  bundleConfig('src/main/services/orchestration/agent-manager.ts', 'agent-manager.cjs'),
  bundleConfig('src/main/services/orchestration/harnesses/index.ts', 'harnesses.cjs')
]);

const {
  OPENCODE_TOOLS,
  OPENCODE_TOOL_DEFINITIONS,
  executeOpenCodeTool,
  recordLspDiagnostics,
  clearDiagnosticsCache
} = require(path.join(bundleDir, 'tools.cjs'));

const { SessionStore } = require(path.join(bundleDir, 'session-store.cjs'));
const { OpenCodeAgentManager, AGENT_MODES } = require(path.join(bundleDir, 'agent-manager.cjs'));
const { getHarness, OpenCodeHarness } = require(path.join(bundleDir, 'harnesses.cjs'));

let passedTests = 0;
let failedTests = 0;

function verify(condition, name, details = '') {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${name}${details ? ` -> ${details}` : ''}`);
    failedTests++;
  }
}

console.log('\n======================================================');
console.log('=== PHASE 5.3: OPENCODE AGENT FRAMEWORK VALIDATION ===');
console.log('======================================================\n');

const workspaceRoot = path.join(testDir, 'workspace');
await fs.mkdir(workspaceRoot, { recursive: true });

// -----------------------------------------------------------------
// 1. Tool System Verification (10 Tools)
// -----------------------------------------------------------------
console.log('--- 1. OpenCode Tool Suite & Definitions ---');
verify(Object.keys(OPENCODE_TOOLS).length === 10, 'All 10 OpenCode tools registered', `Count: ${Object.keys(OPENCODE_TOOLS).length}`);
verify(OPENCODE_TOOL_DEFINITIONS.length === 10, '10 OpenCode tool JSON-schema definitions exported');

const requiredTools = ['view', 'write', 'edit', 'patch', 'bash', 'grep', 'glob', 'ls', 'fetch', 'diagnostics'];
for (const t of requiredTools) {
  verify(Boolean(OPENCODE_TOOLS[t]), `Tool "${t}" exists in OpenCode tool registry`);
}

// -----------------------------------------------------------------
// 2. End-to-End Tool Execution in a Real Coding Task
// -----------------------------------------------------------------
console.log('\n--- 2. End-to-End Tools in Real Coding Task ---');

// Tool 1: write
const sampleFile = 'src/calculator.ts';
const initialCode = `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n`;
const writeRes = await executeOpenCodeTool('write', {
  filePath: sampleFile,
  content: initialCode
}, { workspaceRoot, agentMode: 'build' });

verify(!writeRes.isError && writeRes.output.includes('Successfully wrote'), 'Tool write: Created src/calculator.ts');
const fileExists = await fs.readFile(path.join(workspaceRoot, sampleFile), 'utf-8');
verify(fileExists.includes('add(a: number'), 'Tool write: Content verified on disk');

// Tool 2: view
const viewRes = await executeOpenCodeTool('view', {
  filePath: sampleFile,
  offset: 1,
  limit: 5
}, { workspaceRoot, agentMode: 'build' });
verify(!viewRes.isError && viewRes.output.includes('1: export function add'), 'Tool view: Read lines with offset/limit', viewRes.output);

// Tool 3: edit
const editRes = await executeOpenCodeTool('edit', {
  filePath: sampleFile,
  oldString: 'return a + b;',
  newString: 'return Math.floor(a + b);'
}, { workspaceRoot, agentMode: 'build' });
verify(!editRes.isError && editRes.output.includes('Successfully applied edit'), 'Tool edit: Applied precise string replacement');
const editedContent = await fs.readFile(path.join(workspaceRoot, sampleFile), 'utf-8');
verify(editedContent.includes('Math.floor(a + b)'), 'Tool edit: Verified replacement in file on disk');

// Tool 4: patch
const patchContent = `@@ -5,3 +5,4 @@
 export function multiply(a: number, b: number): number {
+  // Scaled multiply
   return a * b;
`;
const patchRes = await executeOpenCodeTool('patch', {
  filePath: sampleFile,
  patch: patchContent
}, { workspaceRoot, agentMode: 'build' });
verify(!patchRes.isError && patchRes.output.includes('Successfully applied patch'), 'Tool patch: Applied unified diff hunk');
const patchedContent = await fs.readFile(path.join(workspaceRoot, sampleFile), 'utf-8');
verify(patchedContent.includes('// Scaled multiply'), 'Tool patch: Verified hunk content in file on disk');

// Tool 5: bash
const bashRes = await executeOpenCodeTool('bash', {
  command: 'node -e "console.log(\'OpenCode-Execution-Success-\' + (2 + 2))"'
}, { workspaceRoot, agentMode: 'build' });
verify(!bashRes.isError && bashRes.output.includes('OpenCode-Execution-Success-4'), 'Tool bash: Executed command and captured stdout');

// Tool 6: grep
const grepRes = await executeOpenCodeTool('grep', {
  pattern: 'Scaled multiply'
}, { workspaceRoot, agentMode: 'build' });
verify(!grepRes.isError && grepRes.output.includes('src/calculator.ts'), 'Tool grep: Found search pattern in workspace files');

// Tool 7: glob
const globRes = await executeOpenCodeTool('glob', {
  pattern: '**/*.ts'
}, { workspaceRoot, agentMode: 'build' });
verify(!globRes.isError && globRes.output.includes('src/calculator.ts'), 'Tool glob: Found files matching pattern');

// Tool 8: ls
const lsRes = await executeOpenCodeTool('ls', {
  path: 'src'
}, { workspaceRoot, agentMode: 'build' });
verify(!lsRes.isError && lsRes.output.includes('calculator.ts'), 'Tool ls: Listed directory contents');

// Tool 9: diagnostics
recordLspDiagnostics(
  'file:///src/calculator.ts',
  path.join(workspaceRoot, 'src/calculator.ts'),
  [
    {
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
      severity: 1,
      message: 'Type error: implicit any in calculation',
      code: 'TS7006'
    }
  ]
);

const diagRes = await executeOpenCodeTool('diagnostics', {
  filePath: 'src/calculator.ts'
}, { workspaceRoot, agentMode: 'build' });
verify(!diagRes.isError && diagRes.output.includes('ERROR') && diagRes.output.includes('TS7006'), 'Tool diagnostics: Retrieved recorded LSP diagnostics from cache');

// -----------------------------------------------------------------
// 3. Plan Agent Refusal & Guarded Permissions
// -----------------------------------------------------------------
console.log('\n--- 3. Plan Agent (Read-Only) Enforcement ---');

// Plan Agent must refuse write
const planWriteRes = await executeOpenCodeTool('write', {
  filePath: 'src/forbidden.ts',
  content: 'console.log("forbidden");'
}, { workspaceRoot, agentMode: 'plan' });
verify(planWriteRes.isError && planWriteRes.output.includes('Plan Agent is in read-only exploration mode and cannot modify files'), 'Plan Agent: Refused write tool');

// Plan Agent must refuse edit
const planEditRes = await executeOpenCodeTool('edit', {
  filePath: sampleFile,
  oldString: 'return a * b;',
  newString: 'return 0;'
}, { workspaceRoot, agentMode: 'plan' });
verify(planEditRes.isError && planEditRes.output.includes('Plan Agent is in read-only exploration mode and cannot modify files'), 'Plan Agent: Refused edit tool');

// Plan Agent must refuse patch
const planPatchRes = await executeOpenCodeTool('patch', {
  filePath: sampleFile,
  patch: patchContent
}, { workspaceRoot, agentMode: 'plan' });
verify(planPatchRes.isError && planPatchRes.output.includes('Plan Agent is in read-only exploration mode and cannot modify files'), 'Plan Agent: Refused patch tool');

// Plan Agent requires permission for bash
let approvalRequested = false;
let requestedReason = '';
const mockApprovalHandler = async (approval) => {
  approvalRequested = true;
  requestedReason = approval.reason;
  return false; // User denies
};

const planBashDenied = await executeOpenCodeTool('bash', {
  command: 'echo "hello"'
}, { workspaceRoot, agentMode: 'plan', requestApproval: mockApprovalHandler });

verify(approvalRequested, 'Plan Agent: Prompted for user approval before executing bash');
verify(requestedReason.includes('Plan Agent requires explicit user confirmation'), 'Plan Agent: Correct approval reason provided');
verify(planBashDenied.isError && planBashDenied.output.includes('Command execution denied by user'), 'Plan Agent: Denied bash was not executed');

// Plan Agent executes bash only when user approves
const mockApproveHandler = async () => true;
const planBashApproved = await executeOpenCodeTool('bash', {
  command: 'node -e "console.log(\'Plan-Bash-Approved\')"'
}, { workspaceRoot, agentMode: 'plan', requestApproval: mockApproveHandler });
verify(!planBashApproved.isError && planBashApproved.output.includes('Plan-Bash-Approved'), 'Plan Agent: Executed bash after user approval');

// -----------------------------------------------------------------
// 4. Auto-Compact at 95% Context Window Usage
// -----------------------------------------------------------------
console.log('\n--- 4. Context Window Auto-Compact (95% Rule) ---');

const sessionStore = new SessionStore(workspaceRoot);
const testSession = await sessionStore.getOrCreateSession('compact_test_session', {
  title: 'Auto Compact Test Session',
  agentMode: 'build',
  contextLimit: 100_000
});

// Under 95% threshold: 50,000 / 100,000 = 50%
testSession.metadata.totalTokensUsed = 50_000;
const checkUnder = sessionStore.checkAutoCompact(testSession);
verify(!checkUnder.shouldCompact && checkUnder.ratio === 0.5, 'Auto-compact: Does NOT trigger at 50% usage');

// Right at or above 95% threshold: 95,000 / 100,000 = 95%
testSession.metadata.totalTokensUsed = 95_500;
const checkOver = sessionStore.checkAutoCompact(testSession);
verify(checkOver.shouldCompact && checkOver.ratio >= 0.95, 'Auto-compact: TRIGGERS at 95.5% context window usage', `Ratio: ${(checkOver.ratio * 100).toFixed(1)}%`);

// Populate conversation history with multiple turns and verbose tool results
testSession.messages = [
  { id: 'm1', role: 'user', content: 'Build an authentication module with JWT and refresh tokens.', timestamp: 1000 },
  { id: 'm2', role: 'assistant', content: 'Analyzing architecture...', timestamp: 1100 },
  { id: 'm3', role: 'tool', content: 'A'.repeat(800), timestamp: 1200 },
  { id: 'm4', role: 'assistant', content: 'Writing initial models...', timestamp: 1300 },
  { id: 'm5', role: 'tool', content: 'B'.repeat(800), timestamp: 1400 },
  { id: 'm6', role: 'user', content: 'Ensure tokens expire in 15 minutes.', timestamp: 1500 },
  { id: 'm7', role: 'assistant', content: 'Configuring expiry...', timestamp: 1600 }
];
testSession.metadata.modifiedFiles = ['src/auth.ts', 'src/tokens.ts'];

const compactedSession = await sessionStore.autoCompactSession(testSession);
verify(compactedSession.metadata.compacted === true, 'Auto-compact: Marked session as compacted');
verify(compactedSession.metadata.compactCount === 1, 'Auto-compact: Incremented compactCount');
verify(compactedSession.metadata.totalTokensUsed === 35_000, 'Auto-compact: Re-estimated token usage to 35% of limit');

const systemCompactMsg = compactedSession.messages.find((m) => m.content.includes('[Auto-compacted session history'));
verify(Boolean(systemCompactMsg), 'Auto-compact: Injected auto-compact system marker into history');
verify(systemCompactMsg.content.includes('95% limit') && systemCompactMsg.content.includes('src/auth.ts'), 'Auto-compact: Marker retains 95% limit notice and active modified files');

// -----------------------------------------------------------------
// 5. Session Persistence & Multi-File Change Tracking
// -----------------------------------------------------------------
console.log('\n--- 5. Session Persistence Across Restarts ---');

await sessionStore.recordFileChange(testSession.metadata.id, 'src/calculator.ts', 'diff_123', 'Updated math logic');
const sessionList = await sessionStore.listSessions();
verify(sessionList.some((s) => s.id === 'compact_test_session'), 'SessionStore: Saved session listed in workspace');

// Fresh session store instance simulating app restart
const freshStore = new SessionStore(workspaceRoot);
const reloaded = await freshStore.loadSession('compact_test_session');
verify(reloaded !== null, 'SessionStore: Successfully reloaded session after app restart');
verify(reloaded.metadata.modifiedFiles.includes('src/calculator.ts'), 'SessionStore: Multi-file change history persisted');
verify(reloaded.metadata.changeHistory.length > 0, 'SessionStore: Change records persisted');

const searchRes = await freshStore.searchSessions('calculator');
verify(searchRes.length > 0 && searchRes[0].id === 'compact_test_session', 'SessionStore: Search sessions by modified file name');

// -----------------------------------------------------------------
// 6. Harness & Agent Manager Integration
// -----------------------------------------------------------------
console.log('\n--- 6. OpenCode Agent Manager & Harness Integration ---');

const opencodeHarness = getHarness('opencode');
verify(opencodeHarness instanceof OpenCodeHarness, 'Harness registry: opencode maps to OpenCodeHarness');
verify(opencodeHarness.metadata.supportedFeatures.includes('auto-compact-95'), 'Harness metadata: Declares auto-compact-95 capability');

const manager = new OpenCodeAgentManager(workspaceRoot);
const buildPrompt = manager.buildSystemPrompt('build', workspaceRoot, 'src/calc.ts');
const planPrompt = manager.buildSystemPrompt('plan', workspaceRoot, 'src/calc.ts');

verify(buildPrompt.includes('Build Agent') && buildPrompt.includes('full access'), 'AgentManager: Build Agent prompt configured');
verify(planPrompt.includes('Plan Agent') && planPrompt.includes('CRITICAL READ-ONLY RESTRICTIONS'), 'AgentManager: Plan Agent prompt enforces read-only mode');

console.log('\n======================================================');
console.log(`Results: ${passedTests} passed, ${failedTests} failed.`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('PHASE 5.3 VALIDATION SUCCESSFUL: All OpenCode Layer 4 requirements verified.');
}
