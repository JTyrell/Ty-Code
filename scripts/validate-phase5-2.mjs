import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase5-2-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

// Bundle TypeScript services for Node testing
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

console.log('Compiling TypeScript services with esbuild...');
await Promise.all([
  bundleConfig('src/main/services/orchestration/fcc-manager.ts', 'fcc-manager.cjs'),
  bundleConfig('src/main/services/orchestration/fcc-proxy.ts', 'fcc-proxy.cjs'),
  bundleConfig('src/main/services/orchestration/provider-auto-setup.ts', 'provider-auto-setup.cjs'),
  bundleConfig('src/main/services/orchestration/provider-registry.ts', 'provider-registry.cjs'),
  bundleConfig('src/main/services/orchestration/router.ts', 'router.cjs'),
  bundleConfig('src/main/services/orchestration/harnesses/index.ts', 'harnesses.cjs'),
  bundleConfig('src/main/agent/agent-engine.ts', 'agent-engine.cjs'),
  bundleConfig('src/main/providers/provider-gateway.ts', 'provider-gateway.cjs')
]);

const { FCCServerManager, fccManager } = require(path.join(bundleDir, 'fcc-manager.cjs'));
const { FCCProxyClient, fccProxyClient } = require(path.join(bundleDir, 'fcc-proxy.cjs'));
const { ProviderAutoSetupService, providerAutoSetup } = require(path.join(bundleDir, 'provider-auto-setup.cjs'));
const { ProviderRegistry, providerRegistry } = require(path.join(bundleDir, 'provider-registry.cjs'));
const { OmniRouteRouter } = require(path.join(bundleDir, 'router.cjs'));
const { getHarness, getAllHarnesses, ClaudeCodeHarness, CodexHarness } = require(path.join(bundleDir, 'harnesses.cjs'));
const { AgentEngine } = require(path.join(bundleDir, 'agent-engine.cjs'));
const { ProviderGateway } = require(path.join(bundleDir, 'provider-gateway.cjs'));

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

async function runValidation() {
  console.log('========================================================');
  console.log('  Ty-Code Phase 5.2: FCC Server Integration Validation  ');
  console.log('========================================================\n');

  // ---------------------------------------------------------
  // Test Suite 1: FCC Server Lifecycle Management (Layer 3)
  // ---------------------------------------------------------
  console.log('--- Suite 1: FCC Server Lifecycle & Health Management ---');

  const testPort = 8089;
  const manager = new FCCServerManager();

  verify(manager.getStatus().running === false, 'Manager starts in stopped state');
  verify(manager.getStatus().health === 'stopped', 'Initial health is stopped');
  verify(manager.getStatus().freeTokensAllocated >= 1_300_000_000, 'Allocates 1.3B+ monthly free tokens budget');

  // Start server on dedicated test port
  const startStatus = await manager.start({ port: testPort, autoRestart: true, maxRestarts: 3 });
  verify(startStatus.running === true, 'Server successfully starts and reports running');
  verify(startStatus.port === testPort, `Server binds to configured port ${testPort}`);
  verify(startStatus.health === 'healthy', 'Server reports healthy immediately after startup');
  verify(startStatus.mode === 'native-sidecar' || startStatus.mode === 'external-process', `Active mode identified: ${startStatus.mode}`);

  // Test live HTTP endpoints
  try {
    const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
    verify(healthRes.status === 200, 'HTTP GET /health responds with HTTP 200');
    const healthJson = await healthRes.json();
    verify(healthJson.status === 'healthy', 'Health response payload confirms status: healthy');
    verify(typeof healthJson.uptime === 'number', 'Health response includes uptime');
  } catch (err) {
    verify(false, 'HTTP GET /health responds', String(err));
  }

  try {
    const modelsRes = await fetch(`http://127.0.0.1:${testPort}/v1/models`);
    verify(modelsRes.status === 200, 'HTTP GET /v1/models responds with HTTP 200');
    const modelsJson = await modelsRes.json();
    verify(Array.isArray(modelsJson.data) && modelsJson.data.length > 0, `Models endpoint returns models list (${modelsJson.data?.length} models)`);
  } catch (err) {
    verify(false, 'HTTP GET /v1/models responds', String(err));
  }

  // Health check polling
  const isHealthy = await manager.checkHealth();
  verify(isHealthy === true, 'manager.checkHealth() verifies port responsiveness');

  // Token usage recording
  const prevUsage = manager.getStatus().freeTokensUsed;
  manager.recordTokenUsage(2500);
  verify(manager.getStatus().freeTokensUsed === prevUsage + 2500, 'recordTokenUsage increments consumed tokens correctly');

  // Restart server
  const restartStatus = await manager.restart();
  verify(restartStatus.running === true, 'manager.restart() succeeds and keeps server running');
  verify(restartStatus.restartCount === 1, 'Restart counter properly incremented to 1');

  // Stop server
  await manager.stop();
  verify(manager.getStatus().running === false, 'manager.stop() successfully stops server');
  verify(manager.getStatus().health === 'stopped', 'Health resets to stopped upon clean exit');

  // ---------------------------------------------------------
  // Test Suite 2: Provider Auto-Setup (One-Click Flows)
  // ---------------------------------------------------------
  console.log('\n--- Suite 2: Provider Auto-Setup (Top 5 Free Providers) ---');

  const setupService = new ProviderAutoSetupService();

  // 1. OpenRouter
  const orResult = await setupService.setupOpenRouter();
  verify(orResult.success === true, 'OpenRouter auto-setup succeeds');
  verify(orResult.freeMonthlyTokens === 200_000_000, 'OpenRouter grants 200M free tokens/month');

  // 2. GitHub Copilot
  const copilotResult = await setupService.setupGitHubCopilot();
  verify(copilotResult.providerId === 'github-copilot', 'GitHub Copilot setup identifies provider');
  verify(copilotResult.freeMonthlyTokens === 50_000_000, 'GitHub Copilot grants 50M tokens/month');

  // 3. Google AI Studio
  const geminiResult = await setupService.setupGoogleAIStudio();
  verify(geminiResult.providerId === 'google-ai-studio', 'Google AI Studio setup identifies provider');
  verify(geminiResult.freeMonthlyTokens === 300_000_000, 'Google AI Studio grants 300M tokens/month (Gemini 2.0 Flash 1M context)');

  // 4. HuggingChat
  const hcResult = await setupService.setupHuggingChat();
  verify(hcResult.providerId === 'huggingchat', 'HuggingChat setup identifies provider');
  verify(hcResult.freeMonthlyTokens === 100_000_000, 'HuggingChat grants 100M tokens/month');

  // 5. Local Ollama
  const ollamaResult = await setupService.setupLocalOllama();
  verify(ollamaResult.providerId === 'ollama', 'Local Ollama setup identifies provider');
  verify(ollamaResult.endpoint.includes('11434'), 'Local Ollama defaults to standard port 11434 endpoint');

  // Aggregate one-click setup
  const allResults = await setupService.setupAllTopFreeProviders();
  verify(Array.isArray(allResults) && allResults.length === 5, `setupAllTopFreeProviders() sets up all 5 top free providers (${allResults.length}/5)`);

  const totalFreeTokens = allResults.reduce((acc, r) => acc + (r.freeMonthlyTokens || 0), 0);
  verify(totalFreeTokens >= 650_000_000, `Aggregated individual flows account for ${totalFreeTokens.toLocaleString()} tokens/mo`);

  // ---------------------------------------------------------
  // Test Suite 3: Request Proxying & ToS Compliance
  // ---------------------------------------------------------
  console.log('\n--- Suite 3: Request Proxying & ToS Compliance ---');

  // Launch FCC server for proxy tests
  const proxyPort = 8091;
  const proxyManager = new FCCServerManager();
  await proxyManager.start({ port: proxyPort });

  const proxyClient = new FCCProxyClient();
  const endpoint = `http://127.0.0.1:${proxyPort}/v1`;

  const tokensReceived = [];
  const streamResult = await proxyClient.streamChat(
    {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hello FCC sidecar!' }],
      fccEndpoint: endpoint
    },
    {
      onToken: (tok) => tokensReceived.push(tok)
    }
  );

  verify(streamResult.fullText.length > 0, `Streamed text received through FCC proxy: "${streamResult.fullText.trim()}"`);
  verify(tokensReceived.length > 0, `onToken callback invoked (${tokensReceived.length} token chunks)`);
  verify(streamResult.provider === 'fcc-proxy', 'Response identifies provider as fcc-proxy');
  verify(streamResult.tokensUsed > 0, `Token consumption tracked (${streamResult.tokensUsed} tokens)`);

  await proxyManager.stop();

  // ---------------------------------------------------------
  // Test Suite 4: 11 FCC Coding Agent Harnesses
  // ---------------------------------------------------------
  console.log('\n--- Suite 4: FCC 11 Coding Agent Harnesses ---');

  const allHarnesses = getAllHarnesses();
  verify(allHarnesses.length === 11, `All 11 FCC agent harnesses registered (${allHarnesses.length}/11)`);

  const expectedHarnessIds = [
    'claude-code', 'codex', 'opencode', 'pi', 'cline',
    'aider', 'hermes', 'deepseek', 'grok-build', 'muse-code', 'vscode-chat'
  ];
  for (const id of expectedHarnessIds) {
    const h = getHarness(id);
    verify(h.metadata.id === id, `Harness "${id}" retrieved correctly (${h.metadata.name})`);
  }

  // Deep inspection: Claude Code Harness
  const claudeHarness = getHarness('claude-code');
  const claudePrompt = claudeHarness.formatSystemPrompt('/workspace/app', 'src/main.ts', 'console.log("hello");');
  verify(claudePrompt.includes('Claude Code'), 'Claude Code harness formats prompt with agent identity');
  verify(claudePrompt.includes('/workspace/app'), 'Claude Code harness includes workspace root in prompt');
  verify(claudePrompt.includes('src/main.ts'), 'Claude Code harness includes active file path');

  // Test XML tool call parsing in Claude Code Harness
  const xmlSample = `I will run a command to list files:
<tool_call>
<name>run_command</name>
<arguments>{"command":"npm test"}</arguments>
</tool_call>`;
  const parsedClaude = claudeHarness.parseResponse(xmlSample, []);
  verify(parsedClaude.toolCalls.length === 1, 'Claude Code harness parses inline <tool_call> XML blocks');
  verify(parsedClaude.toolCalls[0].name === 'run_command', 'Parsed tool call name matches run_command');
  verify(parsedClaude.toolCalls[0].arguments.command === 'npm test', 'Parsed tool call arguments preserve command string');
  verify(!parsedClaude.text.includes('<tool_call>'), 'Clean text strips XML tags');

  // Deep inspection: Codex Harness
  const codexHarness = getHarness('codex');
  const codexPrompt = codexHarness.formatSystemPrompt('/workspace/app', 'test.py', 'def test(): pass');
  verify(codexPrompt.includes('Codex'), 'Codex harness formats prompt with Codex identity');
  verify(codexPrompt.includes('test.py'), 'Codex harness includes target file context');
  verify(codexHarness.metadata.toolProtocol === 'json-function', 'Codex harness uses json-function tool protocol');

  // ---------------------------------------------------------
  // Test Suite 5: AgentEngine End-to-End Integration
  // ---------------------------------------------------------
  console.log('\n--- Suite 5: AgentEngine Execution with Harnesses ---');

  const testWorkspace = path.join(testDir, 'agent-workspace');
  await fs.mkdir(testWorkspace, { recursive: true });
  await fs.writeFile(path.join(testWorkspace, 'hello.txt'), 'Hello from Ty-Code Agent!');

  const agent = new AgentEngine(testWorkspace);

  // Mock ProviderGateway.streamChat to simulate model responses
  const originalStreamChat = ProviderGateway.streamChat;

  // Test 1: Run AgentEngine with Claude Code Harness
  let claudeStatusSeen = false;
  let claudeDoneSeen = false;
  ProviderGateway.streamChat = async (settings, messages, tools, callbacks) => {
    callbacks.onToken?.('I will finish the task.');
    return { fullText: 'I will finish the task.', fullThought: '', toolCalls: [] };
  };

  await agent.run({
    prompt: 'Check files and complete',
    workspacePath: testWorkspace,
    history: [],
    settings: {
      activeProvider: 'fcc-proxy',
      activeModel: 'claude-3-5-sonnet-20241022',
      activeHarness: 'claude-code',
      apiKeys: {},
      customEndpoints: {},
      routingStrategy: 'balanced',
      autoFailover: true,
      maxFailoverRetries: 3
    },
    harness: 'claude-code',
    onChunk: (chunk) => {
      if (chunk.type === 'status' && chunk.content.includes('Claude Code CLI')) claudeStatusSeen = true;
      if (chunk.type === 'done') claudeDoneSeen = true;
    }
  });

  verify(claudeStatusSeen === true, 'AgentEngine activates Claude Code CLI harness status notice');
  verify(claudeDoneSeen === true, 'AgentEngine completes execution successfully with Claude Code harness');

  // Test 2: Run AgentEngine with Codex Harness
  let codexStatusSeen = false;
  let codexDoneSeen = false;

  await agent.run({
    prompt: 'Generate unit test for hello.txt',
    workspacePath: testWorkspace,
    history: [],
    settings: {
      activeProvider: 'fcc-proxy',
      activeModel: 'claude-3-5-sonnet-20241022',
      activeHarness: 'codex',
      apiKeys: {},
      customEndpoints: {},
      routingStrategy: 'balanced',
      autoFailover: true,
      maxFailoverRetries: 3
    },
    harness: 'codex',
    onChunk: (chunk) => {
      if (chunk.type === 'status' && chunk.content.includes('Codex CLI')) codexStatusSeen = true;
      if (chunk.type === 'done') codexDoneSeen = true;
    }
  });

  verify(codexStatusSeen === true, 'AgentEngine activates Codex CLI harness status notice');
  verify(codexDoneSeen === true, 'AgentEngine completes execution successfully with Codex harness');

  // Restore ProviderGateway.streamChat
  ProviderGateway.streamChat = originalStreamChat;

  // ---------------------------------------------------------
  // Test Suite 6: Provider Registry FCC Support
  // ---------------------------------------------------------
  console.log('\n--- Suite 6: Provider Registry & OmniRoute Integration ---');

  const registry = new ProviderRegistry();
  const fccProxyProv = registry.getProvider('fcc-proxy');
  verify(Boolean(fccProxyProv), 'Provider "fcc-proxy" registered in ProviderRegistry');
  verify(fccProxyProv.isFccSupported === true, 'Provider "fcc-proxy" marked isFccSupported: true');
  verify(fccProxyProv.monthlyFreeTokens === 1_350_000_000, 'Provider "fcc-proxy" configured with 1.35B monthly free tokens');
  verify(fccProxyProv.supportedModels.length >= 4, `Provider "fcc-proxy" includes ${fccProxyProv.supportedModels.length} models`);

  const fccProviders = registry.getFccProviders();
  verify(fccProviders.length >= 61, `getFccProviders() returns ${fccProviders.length} ToS-friendly / free providers (>= 61)`);

  const router = new OmniRouteRouter(registry);
  const candidates = router.getCandidates({
    activeProvider: 'fcc-proxy',
    activeModel: 'claude-3-5-sonnet-20241022',
    apiKeys: {},
    customEndpoints: {}
  });

  const fccCandidate = candidates.find((c) => c.provider.id === 'fcc-proxy');
  verify(Boolean(fccCandidate), 'OmniRoute router resolves fcc-proxy as an available candidate');
  verify(fccCandidate.model.id === 'claude-3-5-sonnet-20241022', 'Resolved model matches claude-3-5-sonnet-20241022');

  // Cleanup test workspace and stop active servers
  await fccManager.stop();
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup
  }

  // Summary
  console.log('\n========================================================');
  console.log(`  Phase 5.2 Test Summary: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('========================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runValidation().catch((err) => {
  console.error('Unhandled validation error:', err);
  process.exit(1);
});
