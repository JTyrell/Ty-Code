import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase5-4-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

const mockElectronPath = path.join(testDir, 'mock-electron.cjs');
await fs.writeFile(
  mockElectronPath,
  `const path = require('node:path');
module.exports = {
  app: {
    getPath: (name) => path.join('${testDir.replace(/\\/g, '\\\\')}', 'userdata'),
    getVersion: () => '0.1.0',
    isPackaged: false
  },
  shell: {
    openExternal: async (url) => true
  },
  BrowserWindow: class {}
};`,
  'utf-8'
);

console.log('Compiling TypeScript services with esbuild for Phase 5.4 validation...');
const bundleConfig = (entry, outfile) =>
  build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile: path.join(bundleDir, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    alias: {
      electron: mockElectronPath
    },
    external: ['node-pty', 'simple-git', 'electron-updater']
  });

await Promise.all([
  bundleConfig('src/main/services/orchestration/openkilo-provider.ts', 'openkilo-provider.cjs'),
  bundleConfig('src/main/services/orchestration/provider-registry.ts', 'provider-registry.cjs'),
  bundleConfig('src/main/services/orchestration/router.ts', 'router.cjs')
]);

const {
  OPENKILO_CURATED_FREE_MODELS,
  OpenKiloProviderService,
  openKiloProvider
} = require(path.join(bundleDir, 'openkilo-provider.cjs'));

const {
  providerRegistry
} = require(path.join(bundleDir, 'provider-registry.cjs'));

const {
  OmniRouteRouter,
  omniRouteRouter
} = require(path.join(bundleDir, 'router.cjs'));

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
console.log('=== PHASE 5.4: OPENKILO PLUGIN INTEGRATION (LAYER 5) ===');
console.log('======================================================\n');

// -----------------------------------------------------------------
// 1. Deliverables and File Existence Verification
// -----------------------------------------------------------------
console.log('--- 1. Deliverables Verification ---');
const deliverables = [
  'src/main/services/orchestration/openkilo-provider.ts',
  'src/main/services/orchestration/provider-registry.ts',
  'src/main/config/provider-registry.ts',
  'src/renderer/src/components/settings/OpenKiloSetup.tsx',
  'src/main/services/orchestration/router.ts'
];

for (const relPath of deliverables) {
  const fullPath = path.join(projectRoot, relPath);
  try {
    const stats = await fs.stat(fullPath);
    verify(stats.isFile(), `Deliverable present: ${relPath}`);
  } catch (err) {
    verify(false, `Deliverable present: ${relPath}`, err.message);
  }
}

// -----------------------------------------------------------------
// 2. OpenKilo Auto-Enablement without User Configuration (Criterion 1)
// -----------------------------------------------------------------
console.log('\n--- 2. Auto-Enablement & Zero-Config Access ---');
const service = new OpenKiloProviderService();

const emptySettings = {
  activeProvider: 'openrouter',
  activeModel: 'deepseek/deepseek-chat',
  apiKeys: {},
  apiKeysConfigured: {},
  customEndpoints: {}
};

const autoEnableResult = service.autoEnable(emptySettings);
verify(autoEnableResult.enabled === true, 'Auto-enable returns enabled = true');
verify(
  autoEnableResult.updatedSettings.apiKeys?.openkilo === 'anonymous',
  'Auto-enable sets apiKey to "anonymous" without requiring user API key'
);
verify(
  autoEnableResult.updatedSettings.apiKeysConfigured?.openkilo === true,
  'Auto-enable marks openkilo as configured'
);
verify(
  autoEnableResult.updatedSettings.customEndpoints?.openkilo === 'https://api.openkilo.com/v1',
  'Auto-enable establishes default Kilo Gateway endpoint'
);

const status = service.getStatus();
verify(status.authMode === 'anonymous', 'Auth mode initializes to "anonymous"');
verify(status.freeTierActive === true, 'Free tier is active out-of-the-box');
verify(status.totalModelsAvailable >= 40, `40+ models available (found: ${status.totalModelsAvailable})`);

// Verify custom key is preserved if user has configured one
const customKeySettings = {
  activeProvider: 'openkilo',
  activeModel: 'kilo-1',
  apiKeys: { openkilo: 'kilo_live_custom_key_12345' },
  apiKeysConfigured: { openkilo: true },
  customEndpoints: { openkilo: 'https://custom.kilo.gateway/v1' }
};
const customResult = service.autoEnable(customKeySettings);
verify(
  Object.keys(customResult.updatedSettings).length === 0,
  'Preserves existing custom OpenKilo credentials without overriding'
);

// -----------------------------------------------------------------
// 3. Model Catalog & 5 Priority Free Models (Criterion 2)
// -----------------------------------------------------------------
console.log('\n--- 3. Curated Free Models Catalog (40+ models) ---');
const freeModels = service.getFreeModels();
verify(freeModels.length >= 40, `At least 40 free models available (actual: ${freeModels.length})`);

const priorityModels = service.getPriorityModels();
verify(priorityModels.length === 5, `All 5 priority free models present (count: ${priorityModels.length})`);

const expectedPriorities = [
  { id: 'deepseek/deepseek-r1-0528:free', minContext: 160_000, task: 'reasoning' },
  { id: 'qwen/qwen3-coder:free', minContext: 250_000, task: 'coding' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', minContext: 120_000, task: 'coding' },
  { id: 'google/gemma-3-27b-it:free', minContext: 120_000, task: 'general' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', minContext: 120_000, task: 'fast-edit' }
];

for (const exp of expectedPriorities) {
  const found = priorityModels.find((m) => m.id === exp.id);
  verify(Boolean(found), `Priority model exists: ${exp.id}`);
  if (found) {
    verify(found.isFree === true, `  -> ${exp.id} is marked free`);
    verify(found.contextWindow >= exp.minContext, `  -> ${exp.id} context window >= ${exp.minContext} (${found.contextWindow})`);
    verify(found.primaryTask === exp.task, `  -> ${exp.id} primary task matches: ${found.primaryTask}`);
  }
}

// Check ProviderRegistry integration
const registryProvider = providerRegistry.getProvider('openkilo');
verify(Boolean(registryProvider), 'OpenKilo registered in ProviderRegistry');
verify(registryProvider?.isFreeTierAvailable === true, 'ProviderRegistry marks OpenKilo free tier available');
verify(
  registryProvider?.monthlyFreeTokens >= 500_000_000,
  `ProviderRegistry lists massive free token pool (${registryProvider?.monthlyFreeTokens?.toLocaleString()} tokens)`
);
verify(
  registryProvider?.headersFactory?.('anonymous')?.Authorization === 'Bearer anonymous' ||
  registryProvider?.headersFactory?.({ apiKey: 'anonymous' })?.Authorization === 'Bearer anonymous',
  'headersFactory automatically sets "Authorization: Bearer anonymous"'
);
const keyHeader = registryProvider?.headersFactory?.({ apiKey: 'kilo_live_key' })?.Authorization ||
  registryProvider?.headersFactory?.('kilo_live_key')?.Authorization;
verify(
  keyHeader === 'Bearer kilo_live_key',
  'headersFactory passes authenticated key when provided',
  `Actual: ${keyHeader}`
);

// -----------------------------------------------------------------
// 4. Model Registry Auto-Refresh Mechanism
// -----------------------------------------------------------------
console.log('\n--- 4. Model Registry Dynamic Refresh Mechanism ---');
const refreshedCatalog = await service.refreshModelCatalog('anonymous');
verify(Array.isArray(refreshedCatalog) && refreshedCatalog.length >= 40, 'refreshModelCatalog returns full model list');
verify(
  refreshedCatalog.some((m) => m.id === 'deepseek/deepseek-r1-0528:free' && m.isFree),
  'Refreshed catalog contains DeepSeek R1 0528 as free model'
);
verify(
  refreshedCatalog.every((m) => m.provider === 'openkilo'),
  'All refreshed models carry "openkilo" provider tag'
);

// -----------------------------------------------------------------
// 5. OAuth Flow for Paid Models (Criterion 4)
// -----------------------------------------------------------------
console.log('\n--- 5. OAuth Authentication Flow (350+ Paid Models) ---');
const oauthFlow = await service.startOAuthFlow();
verify(Boolean(oauthFlow.authUrl), 'startOAuthFlow generates authorization URL');
verify(
  oauthFlow.authUrl.includes('https://openkilo.com/oauth/authorize'),
  'OAuth URL targets OpenKilo OAuth endpoint'
);
verify(
  oauthFlow.authUrl.includes('client_id=ty-code-desktop-client'),
  'OAuth URL includes Ty-Code client ID'
);
verify(
  Boolean(oauthFlow.state) && oauthFlow.state.startsWith('openkilo_oauth_'),
  'OAuth flow generates secure random state token'
);

// Complete OAuth flow with authorization code
const oauthCompletion = await service.completeOAuthFlow('auth_code_test_12345');
verify(oauthCompletion.success === true, 'completeOAuthFlow successfully exchanges code');
verify(Boolean(oauthCompletion.apiKey), `Generated/Exchanged API key: ${oauthCompletion.apiKey?.slice(0, 16)}...`);

const statusAfterOAuth = service.getStatus();
verify(statusAfterOAuth.authMode === 'oauth', 'Service switches activeAuthMode to "oauth"');
verify(statusAfterOAuth.isAuthenticated === true, 'Service status is authenticated');

// Switch back to anonymous
service.enableAnonymousMode();
const statusAfterAnonymous = service.getStatus();
verify(statusAfterAnonymous.authMode === 'anonymous', 'enableAnonymousMode reverts back to anonymous');

// -----------------------------------------------------------------
// 6. Router Integration & Automatic Fallback (Criterion 3)
// -----------------------------------------------------------------
console.log('\n--- 6. OmniRoute Router Fallback Integration ---');
const router = new OmniRouteRouter();

// Test candidate generation with no OpenKilo key in settings
const routerSettings = {
  activeProvider: 'openrouter',
  activeModel: 'deepseek/deepseek-chat',
  apiKeys: { openrouter: 'primary_sk_test_key' },
  apiKeysConfigured: { openrouter: true },
  customEndpoints: {
    ollama: 'http://localhost:11434/v1',
    openkilo: 'https://api.openkilo.com/v1'
  },
  routingStrategy: 'manual',
  enableFailover: true,
  maxFailoverRetries: 3
};

const candidates = router.getCandidates(routerSettings);
const openkiloCandidates = candidates.filter((c) => c.provider.id === 'openkilo');
verify(
  openkiloCandidates.length >= 40,
  `Router automatically includes OpenKilo free models as fallback candidates (count: ${openkiloCandidates.length})`
);
verify(
  openkiloCandidates.every((c) => c.apiKey === 'anonymous' || Boolean(c.apiKey)),
  'All OpenKilo candidates have ready-to-use anonymous API key'
);

// Test Automatic Failover to OpenKilo when primary provider fails
console.log('\n--- Simulating Primary Provider Exhaustion & OpenKilo Failover ---');
const testMessages = [
  { role: 'user', content: 'Implement a binary search tree in TypeScript with insert and search.' }
];

let attemptsCount = 0;
const recordedFailovers = [];

const failoverResult = await router.executeWithFailover(
  testMessages,
  routerSettings,
  async (candidate) => {
    attemptsCount++;
    if (candidate.provider.id !== 'openkilo') {
      // Simulate primary provider rate limit (HTTP 429)
      throw new Error(`Provider ${candidate.provider.id} rate limit exceeded: HTTP 429 Too Many Requests`);
    }
    // OpenKilo fallback succeeds
    return {
      id: 'chatcmpl-openkilo-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'class BinarySearchTree<T> { /* OpenKilo Free Implementation */ }'
          }
        }
      ]
    };
  },
  (event) => {
    recordedFailovers.push(event);
  }
);

verify(
  failoverResult.selectedCandidate.provider.id === 'openkilo',
  `Router successfully failed over to OpenKilo (Selected: ${failoverResult.selectedCandidate.provider.id})`
);
verify(
  failoverResult.failoverHistory.length >= 1,
  `Failover history recorded primary provider failure (Events: ${failoverResult.failoverHistory.length})`
);
verify(
  failoverResult.failoverHistory[0].failedProvider === 'openrouter',
  'First failed provider correctly identified as primary provider'
);
verify(
  failoverResult.result.choices[0].message.content.includes('BinarySearchTree'),
  'Result from OpenKilo fallback model received and returned cleanly'
);

// -----------------------------------------------------------------
// 7. Settings & UI Integration Verification
// -----------------------------------------------------------------
console.log('\n--- 7. Settings UI Integration Verification ---');
const settingsModalPath = path.join(projectRoot, 'src/renderer/src/components/SettingsModal.tsx');
const settingsModalContent = await fs.readFile(settingsModalPath, 'utf-8');

verify(
  settingsModalContent.includes("import { OpenKiloSetup } from './settings/OpenKiloSetup'"),
  'SettingsModal.tsx imports OpenKiloSetup component'
);
verify(
  settingsModalContent.includes("type SettingsTab = 'providers' | 'openkilo'"),
  'SettingsModal.tsx adds "openkilo" to SettingsTab'
);
verify(
  settingsModalContent.includes("onClick={() => setActiveTab('openkilo')}"),
  'SettingsModal.tsx renders OpenKilo tab navigation button'
);
verify(
  settingsModalContent.includes("{activeTab === 'openkilo' && <OpenKiloSetup />}"),
  'SettingsModal.tsx renders OpenKiloSetup in settings-body'
);

const setupComponentPath = path.join(projectRoot, 'src/renderer/src/components/settings/OpenKiloSetup.tsx');
const setupContent = await fs.readFile(setupComponentPath, 'utf-8');

verify(
  setupContent.includes('deepseek/deepseek-r1-0528:free') &&
  setupContent.includes('qwen/qwen3-coder:free') &&
  setupContent.includes('meta-llama/llama-3.3-70b-instruct:free') &&
  setupContent.includes('google/gemma-3-27b-it:free') &&
  setupContent.includes('mistralai/mistral-small-3.1-24b-instruct:free'),
  'OpenKiloSetup UI highlights all 5 priority free models'
);
verify(
  setupContent.includes('window.electronAPI.openkiloStartOAuth') &&
  setupContent.includes('window.electronAPI.openkiloCompleteOAuth'),
  'OpenKiloSetup UI wires browser OAuth start and token verification'
);
verify(
  setupContent.includes('window.electronAPI.openkiloEnableAnonymous'),
  'OpenKiloSetup UI provides one-click instant anonymous activation'
);

// Cleanup temporary test artifacts
await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});

console.log('\n======================================================');
console.log(`Phase 5.4 Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('ALL PHASE 5.4 CRITERIA PASSED! 100% SUCCESS.\n');
  process.exit(0);
}
