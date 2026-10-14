import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { ToolExecutor } from '../src/main/agent/tool-executor.ts';
import { parseSSELines } from '../src/main/providers/sse-parser.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const testDir = path.resolve(rootDir, 'test-sandbox');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failedTests++;
  }
}

async function runValidation() {
  console.log('====================================================');
  console.log('  Ty-Claude Phase 2: Agent Loop & Tool Validation   ');
  console.log('====================================================\n');

  // Prepare sandbox
  await fs.mkdir(testDir, { recursive: true });
  const executor = new ToolExecutor(testDir);

  // Scenario 1: write_file
  console.log('Scenario 1: write_file (Create new file)');
  const writeRes = await executor.execute('write_file', {
    filePath: 'sample.txt',
    content: 'Line 1: Hello from Ty-Claude\nLine 2: Autonomous Agentic Loop\nLine 3: Phase 2 Validation\n'
  });
  assert(!writeRes.isError && writeRes.proposedDiff !== undefined, 'write_file executes and produces proposed diff');
  const written = await fs.readFile(path.join(testDir, 'sample.txt'), 'utf-8');
  assert(written.includes('Line 2: Autonomous Agentic Loop'), 'File content verified on disk');

  // Scenario 2: read_file
  console.log('\nScenario 2: read_file (Read file with line slicing)');
  const readRes = await executor.execute('read_file', {
    filePath: 'sample.txt',
    startLine: 1,
    endLine: 2
  });
  assert(!readRes.isError && readRes.output.includes('Line 1: Hello from Ty-Claude'), 'read_file returns sliced line range');

  // Scenario 3: replace_file_content (find-and-replace)
  console.log('\nScenario 3: replace_file_content (Exact block replacement)');
  const replaceRes = await executor.execute('replace_file_content', {
    filePath: 'sample.txt',
    targetContent: 'Line 2: Autonomous Agentic Loop',
    replacementContent: 'Line 2: Verified Robust Agentic Loop'
  });
  assert(!replaceRes.isError && replaceRes.proposedDiff !== undefined, 'replace_file_content succeeds without error');
  const modified = await fs.readFile(path.join(testDir, 'sample.txt'), 'utf-8');
  assert(modified.includes('Verified Robust Agentic Loop'), 'Modified content verified on disk');

  // Scenario 4: run_command
  console.log('\nScenario 4: run_command (Shell command execution)');
  const isWin = process.platform === 'win32';
  const testCmd = isWin ? 'Write-Output "Phase2_CLI_Success"' : 'echo "Phase2_CLI_Success"';
  const cmdRes = await executor.execute('run_command', {
    command: testCmd,
    timeoutMs: 15000
  });
  assert(!cmdRes.isError && cmdRes.output.includes('Phase2_CLI_Success'), 'run_command executes and captures stdout');

  // Scenario 5: Error handling (Non-existent file)
  console.log('\nScenario 5: Error Handling (Missing file & invalid content)');
  const missingRes = await executor.execute('read_file', {
    filePath: 'non-existent-file-404.txt'
  });
  assert(missingRes.isError && missingRes.output.includes('Error executing tool'), 'read_file returns graceful error for missing file');

  const invalidReplace = await executor.execute('replace_file_content', {
    filePath: 'sample.txt',
    targetContent: 'This string definitely does not exist',
    replacementContent: 'Replacement'
  });
  assert(invalidReplace.isError && invalidReplace.output.includes('was not found'), 'replace_file_content returns targetContent missing error');

  // Scenario 6: Security path traversal protection
  console.log('\nScenario 6: Path Traversal Security');
  const traversalRes = await executor.execute('read_file', {
    filePath: '../../Windows/System32/drivers/etc/hosts'
  });
  assert(traversalRes.isError && traversalRes.output.includes('Security Exception'), 'Access outside workspace blocked');

  // Scenario 7: DeepSeek R1 Reasoning Tokens & SSE Parser
  console.log('\nScenario 7: SSE Stream & DeepSeek R1 Reasoning Extraction');
  const sampleSSE = `
data: {"choices":[{"delta":{"reasoning_content":"Thinking about file modifications..."}}]}
data: {"choices":[{"delta":{"content":"Here is the updated file."}}]}
data: [DONE]
`;
  let parsedContent = '';
  let parsedReasoning = '';
  parseSSELines(sampleSSE, (payload) => {
    const delta = payload.choices?.[0]?.delta;
    if (delta?.content) parsedContent += delta.content;
    if (delta?.reasoning_content) parsedReasoning += delta.reasoning_content;
  });
  assert(parsedReasoning === 'Thinking about file modifications...', 'DeepSeek R1 reasoning tokens extracted');
  assert(parsedContent === 'Here is the updated file.', 'Assistant content tokens extracted');

  // Cleanup sandbox
  await fs.rm(testDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log(`  Results: ${passedTests} Passed | ${failedTests} Failed  `);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runValidation().catch((err) => {
  console.error('Validation script error:', err);
  process.exit(1);
});
