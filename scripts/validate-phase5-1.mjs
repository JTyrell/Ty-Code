import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase5-1-'));
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

await Promise.all([
  bundleConfig('src/main/services/orchestration/provider-registry.ts', 'provider-registry.cjs'),
  bundleConfig('src/main/services/orchestration/connection-pool.ts', 'connection-pool.cjs'),
  bundleConfig('src/main/services/orchestration/strategies/index.ts', 'strategies.cjs'),
  bundleConfig('src/main/services/orchestration/router.ts', 'router.cjs'),
  bundleConfig('src/main/services/orchestration/migration.ts', 'migration.cjs'),
  bundleConfig('src/main/providers/provider-gateway.ts', 'provider-gateway.cjs')
]);

const { ProviderRegistry, providerRegistry } = require(path.join(bundleDir, 'provider-registry.cjs'));
const { ConnectionPool, connectionPool } = require(path.join(bundleDir, 'connection-pool.cjs'));
const { getRoutingStrategy } = require(path.join(bundleDir, 'strategies.cjs'));
const { OmniRouteRouter, omniRouteRouter } = require(path.join(bundleDir, 'router.cjs'));
const { migrateProviderSettings, DEFAULT_OMNIROUTE_SETTINGS } = require(path.join(bundleDir, 'migration.cjs'));
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
  console.log('====================================================');
  console.log('  Ty-Code Phase 5.1: OmniRoute Router Validation    ');
  console.log('====================================================\n');

  try {
    // -------------------------------------------------------------------------
    // CRITERION 1: Router successfully routes requests across 3+ providers
    // -------------------------------------------------------------------------
    console.log('[Criterion 1] Router Multi-Provider Routing & Strategy Tests:');

    const totalProviders = providerRegistry.getProviderCount();
    verify(totalProviders >= 350, `OmniRoute provider registry contains 350+ providers (Found: ${totalProviders})`);

    const apiProviders = providerRegistry.getProvidersByCategory('api_key');
    const oauthProviders = providerRegistry.getProvidersByCategory('oauth');
    const cookieProviders = providerRegistry.getProvidersByCategory('web_cookie');
    const localProviders = providerRegistry.getProvidersByCategory('local');

    verify(apiProviders.length >= 200, `API key providers cataloged (Found: ${apiProviders.length})`);
    verify(oauthProviders.length >= 30, `OAuth providers cataloged (Found: ${oauthProviders.length})`);
    verify(cookieProviders.length >= 30, `Web cookie providers cataloged (Found: ${cookieProviders.length})`);
    verify(localProviders.length >= 25, `Local offline providers cataloged (Found: ${localProviders.length})`);

    // Test multi-provider routing setup
    const router = new OmniRouteRouter(providerRegistry, new ConnectionPool());
    const mockSettings = {
      ...DEFAULT_OMNIROUTE_SETTINGS,
      apiKeys: {
        openrouter: 'sk-or-test-key',
        groq: 'gsk-test-key',
        deepseek: 'sk-deepseek-key'
      },
      customEndpoints: {
        ollama: 'http://localhost:11434/v1'
      }
    };

    // 1. Auto strategy: coding task
    const codingRoute = router.route({ taskType: 'coding' }, { ...mockSettings, routingStrategy: 'auto' });
    verify(
      codingRoute !== null && ['openrouter', 'deepseek', 'groq', 'ollama'].includes(codingRoute.provider.id),
      `Auto strategy routes coding task to capable provider (Selected: ${codingRoute?.provider.id} / ${codingRoute?.model.id})`
    );

    // 2. Auto strategy: reasoning task
    const reasoningRoute = router.route({ taskType: 'reasoning' }, { ...mockSettings, routingStrategy: 'auto' });
    verify(
      reasoningRoute !== null && (reasoningRoute.model.capabilities.reasoning === true || reasoningRoute.provider.id === 'deepseek'),
      `Auto strategy routes reasoning task to reasoning model (Selected: ${reasoningRoute?.provider.id} / ${reasoningRoute?.model.id})`
    );

    // 3. Free-First strategy
    const freeRoute = router.route({ taskType: 'coding' }, { ...mockSettings, routingStrategy: 'free-first' });
    verify(
      freeRoute !== null && (freeRoute.provider.category === 'local' || freeRoute.model.capabilities.isFree || freeRoute.provider.isFreeTierAvailable),
      `Free-First strategy routes to zero-cost provider (Selected: ${freeRoute?.provider.id} / ${freeRoute?.model.id})`
    );

    // 4. Fastest strategy
    // Setup latencies in a dedicated pool
    const speedPool = new ConnectionPool();
    speedPool.initProviderStats('openrouter');
    speedPool.recordSuccess('openrouter', 450);
    speedPool.initProviderStats('groq');
    speedPool.recordSuccess('groq', 35); // Groq is ultra-fast
    speedPool.initProviderStats('deepseek');
    speedPool.recordSuccess('deepseek', 280);

    const speedRouter = new OmniRouteRouter(providerRegistry, speedPool);
    const fastestRoute = speedRouter.route({ taskType: 'coding' }, { ...mockSettings, routingStrategy: 'fastest' });
    verify(
      fastestRoute !== null && fastestRoute.provider.id === 'groq',
      `Fastest strategy selects lowest-latency provider (Selected: ${fastestRoute?.provider.id} with ~35ms)`
    );

    // 5. Manual strategy
    const manualRoute = speedRouter.route(
      { manualSelection: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
      { ...mockSettings, routingStrategy: 'manual', activeProvider: 'deepseek', activeModel: 'deepseek-chat' }
    );
    verify(
      manualRoute !== null && manualRoute.provider.id === 'deepseek',
      `Manual strategy routes directly to user specified provider (Selected: ${manualRoute?.provider.id})`
    );

    // 6. Context Window Reconciliation
    const shortMessages = [{ role: 'user', content: 'Hello world' }];
    const reconciledShort = router.reconcileContextWindow(shortMessages, 8192);
    verify(reconciledShort.length === 1, 'Reconcile context preserves messages within limit');

    const hugeMessages = [
      { role: 'system', content: 'System instruction' },
      ...Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Long conversational turn ${i} with substantial token data `.repeat(30)
      })),
      { role: 'user', content: 'Final question to answer' }
    ];
    const reconciledLong = router.reconcileContextWindow(hugeMessages, 2048, 512);
    verify(
      reconciledLong[0].role === 'system' &&
      reconciledLong[reconciledLong.length - 1].content === 'Final question to answer' &&
      reconciledLong.length < hugeMessages.length,
      `Context reconciliation prunes intermediate turns while preserving system and latest user prompt (Reduced from ${hugeMessages.length} to ${reconciledLong.length} messages)`
    );

    console.log();

    // -------------------------------------------------------------------------
    // CRITERION 2: Automatic failover works when primary provider is down
    // -------------------------------------------------------------------------
    console.log('[Criterion 2] Automatic Multi-Provider Failover Tests:');

    const failoverPool = new ConnectionPool();
    const failoverRouter = new OmniRouteRouter(providerRegistry, failoverPool);

    const failoverSettings = {
      ...DEFAULT_OMNIROUTE_SETTINGS,
      activeProvider: 'openrouter',
      activeModel: 'deepseek/deepseek-chat',
      customEndpoints: {},
      apiKeys: {
        openrouter: 'sk-or-primary-down',
        groq: 'gsk-secondary-backup',
        deepseek: 'sk-tertiary-backup'
      },
      enableFailover: true,
      maxFailoverRetries: 3
    };

    let executionCalls = 0;
    const executedProviders = [];

    const failoverResult = await failoverRouter.executeWithFailover({
      context: { taskType: 'coding' },
      settings: failoverSettings,
      messages: [{ role: 'user', content: 'Write a sorting algorithm' }],
      execute: async (candidate) => {
        executionCalls++;
        executedProviders.push(candidate.provider.id);
        if (candidate.provider.id === 'openrouter') {
          // Simulate 429 Rate Limit on primary provider
          throw new Error('[openrouter] API Error (429): Rate limit exceeded. Too many requests per minute.');
        }
        return { output: `Success from ${candidate.provider.id}` };
      }
    });

    verify(executionCalls === 2, `Failover retried request (Total execution attempts: ${executionCalls})`);
    verify(executedProviders[0] === 'openrouter', `First attempt was primary provider (openrouter)`);
    verify(
      ['groq', 'deepseek'].includes(executedProviders[1]),
      `Secondary attempt switched to healthy backup provider (${executedProviders[1]})`
    );
    verify(
      failoverResult.result.output.includes(executedProviders[1]),
      `Received valid output from secondary provider (${failoverResult.result.output})`
    );
    verify(
      failoverResult.failoverHistory.length === 1 && failoverResult.failoverHistory[0].failedProvider === 'openrouter',
      `Failover event accurately logged in routing history (Failed: ${failoverResult.failoverHistory[0].failedProvider})`
    );

    // Verify cooldown is active on failed primary provider
    verify(
      failoverPool.isAvailable('openrouter') === false,
      'Failed provider is placed into exponential cooldown and unavailable for immediate subsequent requests'
    );

    // Immediate next request should bypass openrouter and route straight to alternative
    const nextRoute = failoverRouter.route({ taskType: 'coding' }, failoverSettings);
    verify(
      nextRoute !== null && nextRoute.provider.id !== 'openrouter',
      `Subsequent request immediately skips cooling down provider (Routed to: ${nextRoute?.provider.id})`
    );

    console.log();

    // -------------------------------------------------------------------------
    // CRITERION 3: Health monitoring detects unhealthy providers within 30s
    // -------------------------------------------------------------------------
    console.log('[Criterion 3] Health Monitoring & 30s Health Scoring Tests:');

    const monitorPool = new ConnectionPool();

    // 1. Verify monitoring timer starts with 30s interval
    monitorPool.startMonitoring(30_000);
    verify(monitorPool.isMonitoring() === true, 'Health monitor started with 30-second polling interval');

    monitorPool.stopMonitoring();
    verify(monitorPool.isMonitoring() === false, 'Health monitor stopped cleanly on shutdown');

    // 2. Health check ping simulation
    monitorPool.setCustomPingExecutor(async (providerId) => {
      if (providerId === 'failing-provider') {
        return { success: false, latencyMs: 3000, error: 'Connection refused / 503 Server Unavailable' };
      }
      return { success: true, latencyMs: 45 };
    });

    // Healthy ping test
    const healthyPing = await monitorPool.pingProvider('groq');
    verify(healthyPing.success === true && healthyPing.latencyMs === 45, 'Ping succeeds on healthy provider');
    const healthyStats = monitorPool.getStats('groq');
    verify(
      healthyStats !== undefined && healthyStats.isHealthy === true && healthyStats.healthScore >= 80,
      `Healthy provider receives top health score (Score: ${healthyStats?.healthScore}/100)`
    );

    // Unhealthy ping test
    const unhealthyPing = await monitorPool.pingProvider('failing-provider');
    verify(unhealthyPing.success === false, 'Ping fails on unhealthy provider');
    // Simulate second consecutive failure to trigger degraded state
    await monitorPool.pingProvider('failing-provider');

    const unhealthyStats = monitorPool.getStats('failing-provider');
    verify(
      unhealthyStats !== undefined && (unhealthyStats.isHealthy === false || unhealthyStats.healthScore < 50),
      `Unhealthy provider detected and health score degraded (Score: ${unhealthyStats?.healthScore}/100, isHealthy: ${unhealthyStats?.isHealthy})`
    );
    verify(
      monitorPool.isAvailable('failing-provider') === false,
      'Unhealthy provider is marked unavailable by ConnectionPool'
    );

    // Recovery test
    monitorPool.setCustomPingExecutor(async () => ({ success: true, latencyMs: 50 }));
    await monitorPool.pingProvider('failing-provider');
    const recoveredStats = monitorPool.getStats('failing-provider');
    verify(
      recoveredStats?.isHealthy === true && recoveredStats.healthScore > 50,
      `Recovered provider restored to healthy state (Score: ${recoveredStats?.healthScore}/100)`
    );

    console.log();

    // -------------------------------------------------------------------------
    // CRITERION 4: All existing user configurations preserved after migration
    // -------------------------------------------------------------------------
    console.log('[Criterion 4] Configuration Migration & Key Preservation Tests:');

    // Simulate realistic legacy v1 user settings
    const legacyUserSettings = {
      activeProvider: 'groq',
      activeModel: 'llama-3.3-70b-versatile',
      apiKeys: {
        openrouter: 'sk-or-v1-00000000000000000000000000000000',
        groq: 'gsk_abcdef1234567890abcdef1234567890',
        deepseek: 'sk-deepseek-user-secret-key-12345'
      },
      customEndpoints: {
        ollama: 'http://127.0.0.1:11434/v1',
        'fcc-proxy': 'http://127.0.0.1:8082/v1',
        custom: 'http://my-gpu-rig:8000/v1'
      },
      temperature: 0.7,
      maxTokens: 8192,
      terminalProfiles: [
        { id: 'profile-1', name: 'PowerShell 7', shellId: 'pwsh' },
        { id: 'profile-2', name: 'WSL Ubuntu', shellId: 'wsl' }
      ],
      defaultTerminalProfileId: 'profile-1',
      thirdPartyRuntimeEnabled: true,
      'editor.reviewPolicy': 'autoApplySafeSingleFile',
      'lsp.autoStart': false,
      editor: {
        fontSize: 15,
        tabSize: 4,
        minimap: false,
        bracketPairs: true,
        autoSave: 'onFocusChange',
        autoSaveDelay: 2000,
        wordWrap: 'bounded',
        formatOnSave: true
      },
      languageServers: {
        typescript: { enabled: true, path: 'C:\\tools\\tsserver.cmd' }
      }
    };

    const migrated = migrateProviderSettings(legacyUserSettings);

    // Assert 100% preservation of all existing API keys
    verify(
      migrated.apiKeys.openrouter === legacyUserSettings.apiKeys.openrouter,
      'Preserved OpenRouter API key'
    );
    verify(
      migrated.apiKeys.groq === legacyUserSettings.apiKeys.groq,
      'Preserved Groq API key'
    );
    verify(
      migrated.apiKeys.deepseek === legacyUserSettings.apiKeys.deepseek,
      'Preserved DeepSeek API key'
    );

    // Assert 100% preservation of custom endpoints
    verify(
      migrated.customEndpoints.ollama === legacyUserSettings.customEndpoints.ollama,
      'Preserved Ollama custom endpoint'
    );
    verify(
      migrated.customEndpoints['fcc-proxy'] === legacyUserSettings.customEndpoints['fcc-proxy'],
      'Preserved Free-Claude-Code proxy custom endpoint'
    );
    verify(
      migrated.customEndpoints.custom === legacyUserSettings.customEndpoints.custom,
      'Preserved custom GPU rig endpoint'
    );

    // Assert active model and provider
    verify(
      migrated.activeProvider === 'groq' && migrated.activeModel === 'llama-3.3-70b-versatile',
      'Preserved active provider and model preferences'
    );

    // Assert temperature and maxTokens
    verify(
      migrated.temperature === 0.7 && migrated.maxTokens === 8192,
      'Preserved temperature and token limits'
    );

    // Assert editor & terminal settings
    verify(
      migrated.editor?.fontSize === 15 && migrated.editor?.tabSize === 4 && migrated.editor?.minimap === false,
      'Preserved editor configuration (fontSize: 15, tabSize: 4, minimap: false)'
    );
    verify(
      migrated.terminalProfiles?.length === 2 && migrated.defaultTerminalProfileId === 'profile-1',
      'Preserved user terminal profiles'
    );

    // Assert OmniRoute additions are safely backfilled
    verify(
      migrated.routingStrategy === 'manual',
      'Defaulted routingStrategy to manual for existing users'
    );
    verify(
      migrated.enableFailover === true,
      'Backfilled enableFailover = true'
    );
    verify(
      migrated.maxFailoverRetries === 3,
      'Backfilled maxFailoverRetries = 3'
    );
    verify(
      migrated.healthMonitoringEnabled === true,
      'Backfilled healthMonitoringEnabled = true'
    );
    verify(
      migrated.healthCheckIntervalMs === 30_000,
      'Backfilled healthCheckIntervalMs = 30000 (30 seconds)'
    );

    // Assert Idempotency
    const reMigrated = migrateProviderSettings(migrated);
    verify(
      JSON.stringify(migrated) === JSON.stringify(reMigrated),
      'Migration is strictly idempotent (re-migrating produces identical configuration)'
    );

    console.log();
  } catch (err) {
    console.error('Unexpected error in validation suite:', err);
    failedTests++;
  } finally {
    // Cleanup temporary bundle directory
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log('====================================================');
  console.log(`Validation Finished: ${passedTests} passed, ${failedTests} failed.`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

void runValidation();
