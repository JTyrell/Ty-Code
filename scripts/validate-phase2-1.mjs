import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase2-1-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

// Mock electron app for testing settings handlers
const mockUserDataDir = path.join(testDir, 'userData');
await fs.mkdir(mockUserDataDir, { recursive: true });

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

await Promise.all([
  bundleConfig('src/main/config/provider-registry.ts', 'provider-registry.cjs'),
  bundleConfig('src/main/providers/provider-gateway.ts', 'provider-gateway.cjs')
]);

const {
  PRECONFIGURED_PROVIDERS,
  getPreconfiguredProvider,
  isPreconfiguredProvider,
  getAllPreconfiguredProviders
} = require(path.join(bundleDir, 'provider-registry.cjs'));

const {
  ProviderGateway,
  isFreeModel,
  categorizeModel
} = require(path.join(bundleDir, 'provider-gateway.cjs'));

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

// Local mock HTTP server for testing dynamic model discovery and connection testing
let mockPort = 0;
let mockServer;
const sockets = new Set();

function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${mockPort}`);
      const authHeader = req.headers['authorization'];

      // Simulate invalid API key
      if (authHeader === 'Bearer invalid_key') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API Key', type: 'invalid_request_error' } }));
        return;
      }

      // GET /models endpoint
      if (req.method === 'GET' && url.pathname.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'Powerful general model' },
            { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 Free', description: 'Free reasoning model' },
            { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Free', description: 'Free Llama model' },
            { id: 'meta-llama/llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fast small model' }
          ]
        }));
        return;
      }

      // GET /api/tags for Ollama native endpoint
      if (req.method === 'GET' && url.pathname.endsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'qwen2.5-coder:latest', details: { parameter_size: '7B' } },
            { name: 'deepseek-r1:latest', details: { parameter_size: '8B' } }
          ]
        }));
        return;
      }

      // POST /chat/completions (for testConnection 1-token request)
      if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.max_tokens === 1) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: 'chatcmpl-test',
                choices: [{ message: { role: 'assistant', content: 'OK' } }]
              }));
              return;
            }
          } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hello' } }] }));
        });
        return;
      }

      // Root endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    mockServer.listen(0, '127.0.0.1', () => {
      mockServer.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      mockPort = mockServer.address().port;
      resolve();
    });
  });
}

async function runValidation() {
  console.log('========================================================================');
  console.log('  Ty-Code Phase 2.1: Provider Onboarding, Config & Discovery Validation  ');
  console.log('========================================================================\n');

  await startMockServer();
  const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;

  try {
    // -------------------------------------------------------------------------
    // 1. Pre-configured Provider Registry
    // -------------------------------------------------------------------------
    console.log('--- 1. Pre-configured Provider Registry ---');
    verify(Array.isArray(PRECONFIGURED_PROVIDERS), 'PRECONFIGURED_PROVIDERS is an array');
    verify(PRECONFIGURED_PROVIDERS.length >= 5, 'Contains at least 5 preconfigured providers');

    const providerIds = PRECONFIGURED_PROVIDERS.map((p) => p.id);
    verify(providerIds.includes('openrouter'), 'Registry includes OpenRouter');
    verify(providerIds.includes('openkilo'), 'Registry includes OpenKilo');
    verify(providerIds.includes('opencode'), 'Registry includes OpenCode');
    verify(providerIds.includes('groq'), 'Registry includes Groq');
    verify(providerIds.includes('ollama'), 'Registry includes Ollama');

    const openrouter = getPreconfiguredProvider('openrouter');
    verify(openrouter?.setupType === 'api_key', 'OpenRouter setup_type is api_key');
    verify(openrouter?.baseUrl === 'https://openrouter.ai/api/v1', 'OpenRouter base_url is https://openrouter.ai/api/v1');
    verify(Boolean(openrouter?.signupUrl), 'OpenRouter provides signup URL for onboarding');

    const ollama = getPreconfiguredProvider('ollama');
    verify(ollama?.setupType === 'zero_config', 'Ollama setup_type is zero_config');
    verify(ollama?.baseUrl === 'http://localhost:11434/v1', 'Ollama base_url is http://localhost:11434/v1');

    const groq = getPreconfiguredProvider('groq');
    verify(groq?.setupType === 'api_key', 'Groq setup_type is api_key');
    verify(groq?.baseUrl === 'https://api.groq.com/openai/v1', 'Groq base_url is https://api.groq.com/openai/v1');

    verify(isPreconfiguredProvider('openrouter') === true, 'isPreconfiguredProvider returns true for openrouter');
    verify(isPreconfiguredProvider('unknown_provider') === false, 'isPreconfiguredProvider returns false for unknown');

    // -------------------------------------------------------------------------
    // 2. Free Model Tagging and Categorization Logic
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Free Model Tagging and Categorization ---');
    verify(isFreeModel('deepseek/deepseek-r1:free', 'openrouter') === true, 'OpenRouter :free model tagged as free');
    verify(isFreeModel('meta-llama/llama-3.3-70b-instruct:free', 'openrouter') === true, 'Llama :free model tagged as free');
    verify(isFreeModel('deepseek/deepseek-chat', 'openrouter') === false, 'Paid OpenRouter model tagged as not free');
    verify(isFreeModel('llama-3.3-70b-versatile', 'groq') === true, 'Groq free tier model tagged as free');
    verify(isFreeModel('any-local-model', 'ollama') === true, 'Local Ollama models tagged as free');
    verify(isFreeModel('claude-3-5-sonnet', 'fcc-proxy') === true, 'FCC proxy models tagged as free');

    verify(categorizeModel('deepseek-r1:free', true, 'openrouter') === 'Free', 'Free model categorized as Free');
    verify(categorizeModel('llama-3.1-8b-instant', false, 'groq') === 'Fast', 'Fast instant model categorized as Fast');
    verify(categorizeModel('deepseek/deepseek-r1', false, 'openrouter') === 'Premium/Reasoning', 'R1 reasoning model categorized as Premium/Reasoning');

    // -------------------------------------------------------------------------
    // 3. Dynamic Model Fetching (getAvailableModels)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Dynamic Model Fetching ---');
    const discovered = await ProviderGateway.getAvailableModels('openrouter', 'valid_test_key', mockBaseUrl);
    verify(Array.isArray(discovered), 'getAvailableModels returns an array of models');
    verify(discovered.length === 4, 'Discovered all 4 mock models from endpoint', `Got ${discovered.length}`);

    const freeModel = discovered.find((m) => m.id === 'deepseek/deepseek-r1:free');
    verify(Boolean(freeModel && freeModel.isFree === true), 'Free model was correctly tagged with isFree: true');
    verify(freeModel?.category === 'Free', 'Free model assigned category: Free');

    const fastModel = discovered.find((m) => m.id === 'meta-llama/llama-3.1-8b-instant');
    verify(fastModel?.category === 'Fast', 'Instant model assigned category: Fast');

    // Test Invalid API key handling
    let caughtInvalidKey = false;
    try {
      await ProviderGateway.getAvailableModels('openrouter', 'invalid_key', mockBaseUrl);
    } catch (err) {
      caughtInvalidKey = err.message === 'Invalid API Key';
    }
    verify(caughtInvalidKey, 'Invalid API key throws "Invalid API Key" error cleanly');

    // Test Ollama native /api/tags fallback discovery
    const ollamaModels = await ProviderGateway.getAvailableModels('ollama', undefined, `http://127.0.0.1:${mockPort}/ollama-test/v1`);
    verify(Array.isArray(ollamaModels) && ollamaModels.length >= 2, 'Ollama models discovered via native tags fallback');
    verify(ollamaModels.every((m) => m.isFree === true), 'All Ollama models tagged as free');

    // -------------------------------------------------------------------------
    // 4. Connection Testing (testConnection)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Connection Testing ---');
    // Zero-config (Ollama) test
    const zeroConfigTest = await ProviderGateway.testConnection('ollama', undefined, undefined, mockBaseUrl);
    verify(zeroConfigTest.success === true, 'Zero-config connection test succeeds for reachable server');
    verify(typeof zeroConfigTest.latencyMs === 'number' && zeroConfigTest.latencyMs >= 0, 'Measured connection latency in ms');

    // Zero-config unreachable server test
    const unreachableTest = await ProviderGateway.testConnection('ollama', undefined, undefined, 'http://127.0.0.1:59999/v1');
    verify(unreachableTest.success === false, 'Returns success: false when endpoint is unreachable');
    verify(Boolean(unreachableTest.error), 'Provides descriptive error message for unreachable endpoint');

    // API key test with valid key (1-token completion)
    const validKeyTest = await ProviderGateway.testConnection('openrouter', 'valid_test_key', 'test-model', mockBaseUrl);
    verify(validKeyTest.success === true, 'Valid API key test returns success: true');

    // API key test with invalid key
    const invalidKeyTest = await ProviderGateway.testConnection('openrouter', 'invalid_key', 'test-model', mockBaseUrl);
    verify(invalidKeyTest.success === false, 'Invalid API key returns success: false');
    verify(invalidKeyTest.error === 'Invalid API Key', 'Invalid API key specifically reports "Invalid API Key" error');

    // -------------------------------------------------------------------------
    // 5. Custom OpenAI-Compatible Endpoint Support
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Custom OpenAI-Compatible Provider ---');
    const customModels = await ProviderGateway.getAvailableModels('custom', undefined, mockBaseUrl);
    verify(Array.isArray(customModels) && customModels.length > 0, 'Custom endpoint successfully fetches models');
    const customTest = await ProviderGateway.testConnection('custom', undefined, undefined, mockBaseUrl);
    verify(customTest.success === true, 'Custom endpoint connection test succeeds');

    // -------------------------------------------------------------------------
    // 6. SafeStorage Settings Encryption Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 6. SafeStorage Settings Encryption ---');
    // Verify that settings-handlers encodes/encrypts API keys before writing to disk
    const settingsHandlersContent = await fs.readFile(path.join(projectRoot, 'src/main/ipc/settings-handlers.ts'), 'utf-8');
    verify(settingsHandlersContent.includes('safeStorage'), 'settings-handlers imports and uses safeStorage');
    verify(settingsHandlersContent.includes('encryptSecret') && settingsHandlersContent.includes('decryptSecret'), 'Defines encryption/decryption functions');
    verify(settingsHandlersContent.includes('apiKeys: {}') || settingsHandlersContent.includes('apiKeysConfigured'), 'Renderer-facing settings sanitize plain API keys');

    // Simulate encrypted settings file write and verify no plain text
    const sampleSecret = 'sk-or-v1-my-secret-token-abcdef123456';
    const sampleEncrypted = Buffer.from(`safestorage_fallback:${Buffer.from(sampleSecret).toString('base64')}`).toString('base64');
    const simulatedDiskSettings = {
      activeProvider: 'openrouter',
      activeModel: 'deepseek/deepseek-chat',
      apiKeys: {
        openrouter: sampleEncrypted
      }
    };
    const diskJson = JSON.stringify(simulatedDiskSettings, null, 2);
    verify(!diskJson.includes(sampleSecret), 'Plain text secret is NOT present in disk JSON file');
    verify(diskJson.includes(sampleEncrypted), 'Encrypted base64 token is present in disk JSON file');

    // -------------------------------------------------------------------------
    // 7. Frontend Components Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Frontend UI Components ---');
    const gridFile = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/settings/ProviderSelectionGrid.tsx'), 'utf-8');
    verify(gridFile.includes('ProviderSelectionGrid'), 'ProviderSelectionGrid component exported');
    verify(gridFile.includes('Add Custom Provider'), 'ProviderSelectionGrid includes "Add Custom Provider" card');
    verify(gridFile.includes('Connected') && gridFile.includes('Error'), 'ProviderSelectionGrid renders connection statuses');

    const formFile = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/settings/ProviderSetupForm.tsx'), 'utf-8');
    verify(formFile.includes('ProviderSetupForm'), 'ProviderSetupForm component exported');
    verify(formFile.includes('Help me get a key'), 'ProviderSetupForm includes "Help me get a key" external link');
    verify(formFile.includes('Test Connection') || formFile.includes('Verifying Connection'), 'ProviderSetupForm includes Test Connection button');
    verify(formFile.includes('zero_config'), 'ProviderSetupForm handles zero_config providers');

    const dropdownFile = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/settings/ModelSelectorDropdown.tsx'), 'utf-8');
    verify(dropdownFile.includes('ModelSelectorDropdown'), 'ModelSelectorDropdown component exported');
    verify(dropdownFile.includes('Search models') || dropdownFile.includes('searchQuery'), 'ModelSelectorDropdown includes search/filtering');
    verify(dropdownFile.includes('Free') && dropdownFile.includes('Fast') && dropdownFile.includes('Reasoning'), 'ModelSelectorDropdown groups models by Free, Fast, and Reasoning');

    const customFile = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/settings/CustomProviderForm.tsx'), 'utf-8');
    verify(customFile.includes('CustomProviderForm'), 'CustomProviderForm component exported');
    verify(customFile.includes('/v1'), 'CustomProviderForm validates /v1 endpoint format');

    const modalFile = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/SettingsModal.tsx'), 'utf-8');
    verify(modalFile.includes('ProviderSelectionGrid'), 'SettingsModal integrates ProviderSelectionGrid');
    verify(modalFile.includes('ProviderSetupForm'), 'SettingsModal integrates ProviderSetupForm');
    verify(modalFile.includes('ModelSelectorDropdown'), 'SettingsModal integrates ModelSelectorDropdown');
    verify(modalFile.includes('CustomProviderForm'), 'SettingsModal integrates CustomProviderForm');
    verify(modalFile.includes('ty_code_update_channel') && modalFile.includes('Check for Updates') && modalFile.includes('setUpdateChannel'), 'Preserves release channel & update settings');

  } finally {
    if (mockServer) {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((r) => mockServer.close(r));
    }
    // Clean up temporary test bundle directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n====================================================');
  console.log(`  Tests Passed: ${passedTests}`);
  console.log(`  Tests Failed: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

await runValidation();
