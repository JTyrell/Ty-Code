import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-claude-phase2-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });
const bundleConfig = (entry, outfile) => build({
  entryPoints: [path.join(projectRoot, entry)],
  outfile: path.join(bundleDir, outfile),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'silent'
});
await Promise.all([
  bundleConfig('src/main/agent/tool-executor.ts', 'tool-executor.cjs'),
  bundleConfig('src/main/agent/agent-engine.ts', 'agent-engine.cjs'),
  bundleConfig('src/main/providers/sse-parser.ts', 'sse-parser.cjs')
]);
const { ToolExecutor } = require(path.join(bundleDir, 'tool-executor.cjs'));
const { AgentEngine } = require(path.join(bundleDir, 'agent-engine.cjs'));
const { parseSSELines } = require(path.join(bundleDir, 'sse-parser.cjs'));
let passedTests = 0;
let failedTests = 0;

function verify(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${name}`);
    failedTests++;
  }
}

function responseFromEvents(events) {
  const source = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function runValidation() {
  const originalFetch = globalThis.fetch;
  try {
    console.log('====================================================');
    console.log('  Ty-Claude Phase 2: Agent Loop & Tool Validation   ');
    console.log('====================================================\n');

    const executor = new ToolExecutor(testDir);
    await fs.writeFile(path.join(testDir, 'note.txt'), 'Hello world\n', 'utf-8');
    await fs.writeFile(path.join(testDir, 'other.txt'), 'Hello other\n', 'utf-8');

    const toolCalls = [
      { index: 0, id: 'read-note', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'note.txt' }) } },
      { index: 1, id: 'write-new', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ filePath: 'created.txt', content: 'New file content\n' }) } },
      { index: 2, id: 'replace-note', type: 'function', function: { name: 'replace_file_content', arguments: JSON.stringify({ filePath: 'note.txt', targetContent: 'world', replacementContent: '$& updated' }) } },
      { index: 3, id: 'replace-other', type: 'function', function: { name: 'replace_file_content', arguments: JSON.stringify({ filePath: 'other.txt', targetContent: 'other', replacementContent: 'second file updated' }) } },
      { index: 4, id: 'run-command', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: process.platform === 'win32' ? 'Write-Output "Phase2_CLI_Success"' : 'echo "Phase2_CLI_Success"', timeoutMs: 15000 }) } },
      { index: 5, id: 'missing-file', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'missing-404.txt' }) } }
    ];
    const providerRequests = [];
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body || '{}'));
      providerRequests.push(requestBody);
      if (providerRequests.length === 1) {
        return responseFromEvents([{ choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }] }]);
      }
      return responseFromEvents([{ choices: [{ index: 0, delta: { content: 'All requested checks finished.' }, finish_reason: 'stop' }] }]);
    };

    const streamChunks = [];
    const engine = new AgentEngine(testDir);
    await engine.run({
      prompt: 'Validate the file tools and command execution.',
      workspacePath: testDir,
      history: [],
      settings: {
        activeProvider: 'openrouter',
        activeModel: 'mock-model',
        apiKeys: {},
        customEndpoints: { openrouter: 'http://127.0.0.1:9009/v1' },
        temperature: 0,
        maxTokens: 512
      },
      onChunk: (chunk) => streamChunks.push(chunk)
    });

    verify(providerRequests.length === 2, 'Agent loops through tool calls and returns a final model response');
    const initialMessages = providerRequests[0].messages;
    verify(initialMessages.filter((message) => message.role === 'user' && message.content === 'Validate the file tools and command execution.').length === 1, 'Current user prompt is included exactly once');
    verify(streamChunks.some((chunk) => chunk.type === 'tool_result' && chunk.toolResult?.toolCallId === 'read-note' && chunk.toolResult.output.includes('Hello world')), 'Agent reads and returns file content');
    verify((await fs.readFile(path.join(testDir, 'created.txt'), 'utf-8')) === 'New file content\n', 'Agent creates a new file with exact content');
    verify((await fs.readFile(path.join(testDir, 'note.txt'), 'utf-8')) === 'Hello $& updated\n', 'Agent performs an exact literal replacement in the first file');
    verify((await fs.readFile(path.join(testDir, 'other.txt'), 'utf-8')) === 'Hello second file updated\n', 'Agent replaces content in a second file');
    verify(streamChunks.some((chunk) => chunk.type === 'tool_result' && chunk.toolResult?.toolCallId === 'run-command' && chunk.toolResult.output.includes('Phase2_CLI_Success')), 'Agent executes a shell command and captures output');
    verify(streamChunks.some((chunk) => chunk.type === 'tool_result' && chunk.toolResult?.toolCallId === 'missing-file' && chunk.toolResult.isError), 'Missing file is returned to the agent as a tool error');
    verify(streamChunks.some((chunk) => chunk.type === 'token' && chunk.content === 'All requested checks finished.'), 'Agent streams the final assistant response');
    verify(streamChunks.some((chunk) => chunk.type === 'done'), 'Agent emits a terminal done event');

    console.log('\nScenario: error handling and workspace containment');
    const missing = await executor.execute('read_file', { filePath: 'absent.txt' });
    verify(missing.isError && missing.output.includes('Error executing tool'), 'Invalid file path produces a recoverable tool error');
    const traversal = await executor.execute('read_file', { filePath: '../../Windows/System32/drivers/etc/hosts' });
    verify(traversal.isError && traversal.output.includes('Security Exception'), 'Workspace traversal is rejected');
    const invalidReplace = await executor.execute('replace_file_content', { filePath: 'note.txt', targetContent: 'not present', replacementContent: 'Replacement' });
    verify(invalidReplace.isError && invalidReplace.output.includes('was not found'), 'Missing replacement target is reported without a write');

    console.log('\nScenario: SSE parsing and reasoning-token streaming');
    const sampleSSE = 'data:{"choices":[{"index":0,"delta":{"reasoning_content":"Thinking through the change…"},"finish_reason":null}]}\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"Reasoned answer."},"finish_reason":null}]}\n';
    let parsedContent = '';
    let parsedReasoning = '';
    let buffer = '';
    for (const line of [sampleSSE.slice(0, 41), sampleSSE.slice(41)]) {
      buffer += line;
      buffer = parseSSELines(buffer, (payload) => {
        const delta = payload.choices?.[0]?.delta;
        parsedContent += delta?.content || '';
        parsedReasoning += delta?.reasoning_content || '';
      });
    }
    if (buffer) parseSSELines(`${buffer}\n`, (payload) => {
      const delta = payload.choices?.[0]?.delta;
      parsedContent += delta?.content || '';
      parsedReasoning += delta?.reasoning_content || '';
    });
    verify(parsedReasoning === 'Thinking through the change…', 'Reasoning content survives chunked SSE boundaries');
    verify(parsedContent === 'Reasoned answer.', 'Content survives data lines without a space');

    const reasonChunks = [];
    globalThis.fetch = async () => responseFromEvents([
      { choices: [{ index: 0, delta: { reasoning_content: 'Model reasoning token.' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'Visible response.' }, finish_reason: 'stop' }] }
    ]);
    await new AgentEngine(testDir).run({
      prompt: 'Explain the test.', workspacePath: testDir, history: [], onChunk: (chunk) => reasonChunks.push(chunk),
      settings: { activeProvider: 'openrouter', activeModel: 'mock-reasoner', apiKeys: {}, customEndpoints: {}, temperature: 0, maxTokens: 256 }
    });
    verify(reasonChunks.some((chunk) => chunk.type === 'thought' && chunk.content === 'Model reasoning token.'), 'Agent forwards reasoning tokens to the renderer stream');
    verify(reasonChunks.some((chunk) => chunk.type === 'token' && chunk.content === 'Visible response.'), 'Agent streams visible tokens alongside reasoning');

    const abortController = new AbortController();
    const cancellationChunks = [];
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const cancelledRun = new AgentEngine(testDir).run({
      prompt: 'Stop this run.', workspacePath: testDir, history: [], onChunk: (chunk) => cancellationChunks.push(chunk),
      abortSignal: abortController.signal,
      settings: { activeProvider: 'openrouter', activeModel: 'mock-cancel', apiKeys: {}, customEndpoints: {}, temperature: 0, maxTokens: 128 }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    abortController.abort();
    await cancelledRun;
    verify(cancellationChunks.some((chunk) => chunk.type === 'cancelled'), 'Aborted provider stream emits a cancellation event');

    console.log('\n====================================================');
    console.log(`  Results: ${passedTests} Passed | ${failedTests} Failed`);
    console.log('====================================================\n');
    if (failedTests > 0) process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

runValidation().catch((error) => {
  console.error('Phase 2 validation failed unexpectedly:', error);
  process.exitCode = 1;
}).finally(() => fs.rm(testDir, { recursive: true, force: true }));
