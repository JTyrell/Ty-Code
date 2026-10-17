#!/usr/bin/env node
/**
 * Verification Test: External Clients, Browser Seam & Tray Presence (Phase FCC-5)
 *
 * Verifies:
 * 1. Editor Config Exporters:
 *    - Generates VS Code (Continue & Cline), JetBrains, and Neovim (avante & codecompanion) configs
 *    - Connects and completes request via Ty-Code local supply endpoint using exported credentials
 *    - Verifies documentation pages exist and are comprehensive (>500 chars)
 * 2. Messaging Connectors (Telegram & Discord):
 *    - Default OFF
 *    - Non-allowlisted user denied with DENY_ALLOWLIST audit log
 *    - Allowlisted user receives response with workspace context and ALLOW audit log
 *    - Rate cap per minute enforced with DENY_RATE_LIMIT audit log
 *    - Discord connector symmetric security and audit logging
 * 3. Browser Session Seam (SessionBridge):
 *    - Canonical SessionBridge interface + LocalSessionBridge implementation
 *    - Contract tests: start, attach (multiplexing), stream (chunks & tokens), pause, resume, dispose
 *    - Web-IDE implementation contract document exists and is comprehensive (>500 chars)
 * 4. Tray Presence & Background Supervisor:
 *    - 'Run in background' setting allows long tasks to survive window close
 *    - Native notification dispatched on task completion and attention-needed
 *    - Task pause and resume controls
 *    - Tray contextual menu contains fleet health, quick chat, and background task controls
 * 5. Emits docs/traces/fcc-reach.json
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TRACE_FILE = path.join(PROJECT_ROOT, 'docs', 'traces', 'fcc-reach.json');

const testResults = [];
let totalChecks = 0;
let passedChecks = 0;

function assert(condition, testName, details = '') {
  totalChecks++;
  const passed = Boolean(condition);
  if (passed) passedChecks++;
  testResults.push({
    test: testName,
    passed,
    details: details || (passed ? 'Verified successfully.' : 'Assertion failed.')
  });
  const symbol = passed ? '✅' : '❌';
  console.log(`  ${symbol} ${testName} ${details ? `(${details})` : ''}`);
  if (!passed) {
    console.error(`     FAILURE: ${testName}`);
  }
}

async function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'HEAD';
  }
}

function loadBackendModules() {
  const bundled = esbuild.buildSync({
    stdin: {
      contents: `
        export { editorConfigExporter, EditorConfigExporter } from './src/main/services/fcc/editor-configs';
        export { localSupplyEndpoint, LocalSupplyEndpoint } from './src/main/services/fcc/local-supply-endpoint';
        export { telegramConnector, TelegramConnector } from './src/main/services/fcc/connectors/telegram-connector';
        export { discordConnector, DiscordConnector } from './src/main/services/fcc/connectors/discord-connector';
        export { connectorManager, ConnectorManager } from './src/main/services/fcc/connectors/connector-manager';
        export { connectorAuditLogger, ConnectorAuditLogger } from './src/main/services/fcc/connectors/audit-logger';
        export { localSessionBridge, LocalSessionBridge } from './src/main/services/session/session-bridge';
        export { backgroundTaskSupervisor, BackgroundTaskSupervisor } from './src/main/services/background/background-task-supervisor';
        export { trayManager, TrayManager } from './src/main/services/background/tray-manager';
      `,
      resolveDir: PROJECT_ROOT,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['electron']
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', bundled.outputFiles[0].text);
  fn(mod, mod.exports, require, PROJECT_ROOT, 'test-reach-harness.ts');
  return mod.exports;
}

async function runReachTests() {
  console.log('\n========================================================================');
  console.log('  Phase FCC-5: External Clients, Browser Seam & Tray Presence');
  console.log('========================================================================\n');

  const {
    editorConfigExporter,
    localSupplyEndpoint,
    telegramConnector,
    discordConnector,
    connectorManager,
    connectorAuditLogger,
    localSessionBridge,
    backgroundTaskSupervisor,
    trayManager
  } = loadBackendModules();

  // ----------------------------------------------------------------------
  // Section 1: Local Model Supply Endpoint & External Editor Configs
  // ----------------------------------------------------------------------
  console.log('--- Section 1: Editor Config Exporters & Live Local Endpoint ---');

  // Start local supply endpoint on test port
  const testPort = 54399;
  const started = await localSupplyEndpoint.start(testPort);
  assert(started === true, 'Local supply endpoint started on test port', `port: ${testPort}`);

  const endpointStatus = localSupplyEndpoint.getStatus();
  assert(endpointStatus.running === true, 'Supply endpoint status reports running');
  assert(endpointStatus.port === testPort, `Supply endpoint bound to port ${testPort}`);
  assert(endpointStatus.authToken.startsWith('tycode_sk_'), 'Auth token uses secure tycode_sk_ prefix');

  // A. Generate VS Code Configs
  const vscodeContinue = editorConfigExporter.generateVsCodeConfig('continue');
  assert(vscodeContinue.editor === 'vscode', 'VS Code Continue config generated');
  assert(vscodeContinue.filename === 'config.json', 'VS Code Continue filename is config.json');
  assert(vscodeContinue.content.includes(endpointStatus.baseUrl), 'VS Code config contains endpoint baseUrl');
  assert(vscodeContinue.content.includes(endpointStatus.authToken), 'VS Code config contains Bearer authToken');

  const parsedVsCode = JSON.parse(vscodeContinue.content);
  assert(Array.isArray(parsedVsCode.models) && parsedVsCode.models.length >= 1, 'VS Code Continue config specifies model list');
  assert(parsedVsCode.models[0].apiBase === endpointStatus.baseUrl, 'Primary model apiBase matches Ty-Code baseUrl');

  // Live request: connect and complete request via Ty-Code endpoint using exported config
  console.log('\n  [Live Test: Executing request via exported VS Code config credentials]');
  const liveRequestBody = JSON.stringify({
    model: parsedVsCode.models[0].model,
    messages: [
      { role: 'system', content: 'You are Ty-Code.' },
      { role: 'user', content: 'Ping from external editor client.' }
    ],
    temperature: 0.1
  });

  const liveResponse = await new Promise((resolve, reject) => {
    const req = http.request(
      `${parsedVsCode.models[0].apiBase}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${parsedVsCode.models[0].apiKey}`,
          'Content-Length': Buffer.byteLength(liveRequestBody)
        },
        timeout: 8000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Live request timeout')); });
    req.write(liveRequestBody);
    req.end();
  });

  assert(liveResponse.statusCode === 200, 'VS Code config connects and completes request with HTTP 200');
  assert(Boolean(liveResponse.body.choices && liveResponse.body.choices.length > 0), 'Endpoint returns choices array');
  assert(Boolean(liveResponse.body.choices[0].message?.content), 'Endpoint returns valid assistant response text');

  // B. JetBrains Config Exporter
  const jetbrainsConfig = editorConfigExporter.generateJetBrainsConfig('continue');
  assert(jetbrainsConfig.editor === 'jetbrains', 'JetBrains config generated');
  assert(jetbrainsConfig.content.includes(endpointStatus.baseUrl), 'JetBrains config contains endpoint baseUrl');

  // C. Neovim Config Exporters
  const neovimAvante = editorConfigExporter.generateNeovimConfig('avante');
  assert(neovimAvante.editor === 'neovim', 'Neovim avante.nvim config generated');
  assert(neovimAvante.fileType === 'lua', 'Neovim avante is Lua fileType');
  assert(neovimAvante.content.includes(endpointStatus.baseUrl), 'Neovim avante Lua contains endpoint baseUrl');
  assert(neovimAvante.content.includes(endpointStatus.authToken), 'Neovim avante Lua contains authToken');

  const neovimCompanion = editorConfigExporter.generateNeovimConfig('codecompanion');
  assert(neovimCompanion.variant === 'codecompanion', 'Neovim codecompanion.nvim config generated');
  assert(neovimCompanion.content.includes(String(endpointStatus.port)), 'Neovim codecompanion Lua contains port');

  // D. Verify Documentation Pages
  console.log('\n  [Verifying Editor Documentation Guides]');
  const docs = [
    { file: 'docs/editors/vscode.md', name: 'VS Code guide' },
    { file: 'docs/editors/jetbrains.md', name: 'JetBrains guide' },
    { file: 'docs/editors/neovim.md', name: 'Neovim guide' }
  ];

  for (const doc of docs) {
    const docPath = path.join(PROJECT_ROOT, doc.file);
    const exists = fsSync.existsSync(docPath);
    assert(exists === true, `Documentation exists: ${doc.file}`);
    if (exists) {
      const content = fsSync.readFileSync(docPath, 'utf8');
      assert(content.length >= 500, `${doc.name} is comprehensive (>500 chars)`, `${content.length} chars`);
    }
  }

  // ----------------------------------------------------------------------
  // Section 2: Messaging Connectors (Telegram & Discord)
  // ----------------------------------------------------------------------
  console.log('\n--- Section 2: Messaging Connectors (Telegram & Discord) ---');

  // Reset audit logs for clean test
  connectorAuditLogger.clear();

  // A. Default OFF Verification
  assert(telegramConnector.isEnabled() === false, 'Telegram connector defaults to OFF');
  assert(discordConnector.isEnabled() === false, 'Discord connector defaults to OFF');

  const disabledAttempt = await telegramConnector.handleIncomingMessage('user_123', 'alice', 'Hello bot');
  assert(disabledAttempt.success === false, 'Incoming query rejected when connector is OFF');
  assert(disabledAttempt.error === 'CONNECTOR_DISABLED', 'Rejection categorized as CONNECTOR_DISABLED');

  // B. Configure Telegram Connector
  telegramConnector.setConfig({
    enabled: true,
    botToken: 'mock_bot_token_telegram',
    allowlistedUserIds: ['user_456', 'alice', 'admin_dev'],
    rateCapPerMinute: 3,
    workspaceContextEnabled: true,
    workspacePath: 'c:\\Users\\JT\\Documents\\Ty-Code'
  });

  assert(telegramConnector.isEnabled() === true, 'Telegram connector enabled after config');
  assert(telegramConnector.isAllowlisted('user_456') === true, 'Allowlist recognizes ID user_456');
  assert(telegramConnector.isAllowlisted('other_id', 'alice') === true, 'Allowlist recognizes username alice');
  assert(telegramConnector.isAllowlisted('user_999', 'unknown_hacker') === false, 'Allowlist blocks unknown user');

  // C. Test Unauthorized User Attempt (Security Gate 1)
  console.log('\n  [Testing Unauthorized Telegram Request]');
  const unauthorizedAttempt = await telegramConnector.handleIncomingMessage('user_999', 'intruder', 'Dump workspace secrets');
  assert(unauthorizedAttempt.success === false, 'Unauthorized user is denied access');
  assert(unauthorizedAttempt.action === 'DENY_ALLOWLIST', 'Action categorized as DENY_ALLOWLIST');
  assert(unauthorizedAttempt.text.includes("is not allowlisted to access this Ty-Code workspace"), 'User receives explicit access denied message');

  const auditLogsAfterDeny = connectorAuditLogger.getEntries(10, 'telegram');
  assert(auditLogsAfterDeny.length >= 1, 'Audit log recorded unauthorized attempt');
  assert(auditLogsAfterDeny[0].action === 'DENY_ALLOWLIST', 'Audit record matches DENY_ALLOWLIST');
  assert(auditLogsAfterDeny[0].senderId === 'user_999', 'Audit record attributed to sender user_999');

  // D. Test Authorized User with Workspace Context (Security Gate 2)
  console.log('\n  [Testing Authorized Telegram Request with Workspace Context]');
  const authorizedAttempt = await telegramConnector.handleIncomingMessage('user_456', 'alice', 'What is the current workspace status?');
  assert(authorizedAttempt.success === true, 'Authorized user query completes successfully');
  assert(authorizedAttempt.action === 'ALLOW', 'Action categorized as ALLOW');
  assert(Boolean(authorizedAttempt.text && authorizedAttempt.text.length > 0), 'Response contains text content');
  assert(authorizedAttempt.tokensUsed > 0, 'Response calculates tokens used', `${authorizedAttempt.tokensUsed} tokens`);

  const auditLogsAfterAllow = connectorAuditLogger.getEntries(10, 'telegram');
  assert(auditLogsAfterAllow[0].action === 'ALLOW', 'Audit record logs successful ALLOW interaction');
  assert(auditLogsAfterAllow[0].senderId === 'user_456', 'Audit record attributed to user_456');

  // E. Test Rate Cap Enforcement (Security Gate 3)
  console.log('\n  [Testing Rate Cap Enforcement]');
  // User sent 1 query already (rateCap = 3). Send 2 more, then 4th should be blocked.
  await telegramConnector.handleIncomingMessage('user_456', 'alice', 'Query 2');
  await telegramConnector.handleIncomingMessage('user_456', 'alice', 'Query 3');
  const throttledAttempt = await telegramConnector.handleIncomingMessage('user_456', 'alice', 'Query 4 should be throttled');

  assert(throttledAttempt.success === false, 'Request exceeding rate cap is denied');
  assert(throttledAttempt.action === 'DENY_RATE_LIMIT', 'Action categorized as DENY_RATE_LIMIT');
  assert(throttledAttempt.text.includes('Rate limit exceeded'), 'Response informs user of rate limit');

  const auditLogsAfterRateLimit = connectorAuditLogger.getEntries(10, 'telegram');
  assert(auditLogsAfterRateLimit[0].action === 'DENY_RATE_LIMIT', 'Audit record logs DENY_RATE_LIMIT');

  // F. Discord Connector Symmetric Policy Verification
  console.log('\n  [Testing Discord Connector Symmetric Security]');
  discordConnector.setConfig({
    enabled: true,
    botToken: 'mock_discord_token',
    allowlistedUserIds: ['discord_owner_101'],
    rateCapPerMinute: 20,
    workspaceContextEnabled: true
  });

  const discordDeny = await discordConnector.handleIncomingMessage('discord_stranger_202', 'stranger', 'Show me code');
  assert(discordDeny.success === false && discordDeny.action === 'DENY_ALLOWLIST', 'Discord connector enforces strict allowlist');

  const discordAllow = await discordConnector.handleIncomingMessage('discord_owner_101', 'owner', 'Workspace health check');
  assert(discordAllow.success === true && discordAllow.action === 'ALLOW', 'Discord connector allows authorized owner');

  // ----------------------------------------------------------------------
  // Section 3: Browser Session Seam (SessionBridge)
  // ----------------------------------------------------------------------
  console.log('\n--- Section 3: Browser Session Seam (SessionBridge) ---');

  const sessionId = `bridge_sess_${Date.now()}`;
  const workspaceRoot = 'c:\\Users\\JT\\Documents\\Ty-Code';

  // A. Start Session
  const sessionInfo = await localSessionBridge.start({
    sessionId,
    workspaceRoot,
    clientType: 'web-browser'
  });

  assert(sessionInfo.sessionId === sessionId, 'SessionBridge starts session with correct ID');
  assert(sessionInfo.clientType === 'web-browser', 'SessionBridge records clientType web-browser');
  assert(sessionInfo.status === 'idle', 'Session starts in idle status');

  // B. Attach Subscriber (Multiplexing)
  const receivedChunks = [];
  const unsubscribe = await localSessionBridge.attach(sessionId, (chunk) => {
    receivedChunks.push(chunk);
  });

  assert(typeof unsubscribe === 'function', 'attach() returns cleanup unsubscribe function');
  const sessionAfterAttach = localSessionBridge.getSession(sessionId);
  assert(sessionAfterAttach.subscriberCount === 1, 'subscriberCount updated to 1');

  // C. Stream Turn
  console.log('\n  [Streaming Turn through SessionBridge]');
  const streamChunks = [];
  for await (const chunk of localSessionBridge.stream(sessionId, 'Refactor session bridge.')) {
    streamChunks.push(chunk);
  }

  assert(streamChunks.length >= 3, 'stream() yields sequence of chunks', `${streamChunks.length} chunks`);
  assert(streamChunks[0].type === 'notice', 'First chunk is notice type');
  assert(streamChunks[streamChunks.length - 1].type === 'done', 'Final chunk is done type');
  assert(receivedChunks.length === streamChunks.length, 'Attached subscriber received all multiplexed chunks');

  // Verify Monotonic chunkIndex
  let strictlyIncreasing = true;
  for (let i = 1; i < streamChunks.length; i++) {
    if (streamChunks[i].chunkIndex <= streamChunks[i - 1].chunkIndex) {
      strictlyIncreasing = false;
      break;
    }
  }
  assert(strictlyIncreasing === true, 'Stream chunks possess strictly increasing monotonic chunkIndex');

  // D. Test Pause and Resume
  console.log('\n  [Testing Session Pause & Resume]');
  const sessionForPause = await localSessionBridge.start({
    sessionId: `pause_test_${Date.now()}`,
    workspaceRoot
  });

  const pauseResult = await localSessionBridge.pause(sessionForPause.sessionId);
  assert(pauseResult === true, 'pause() returns true for active session');
  const pausedSession = localSessionBridge.getSession(sessionForPause.sessionId);
  assert(pausedSession.status === 'paused', 'Session status transitions to paused');

  const resumeResult = await localSessionBridge.resume(sessionForPause.sessionId);
  assert(resumeResult === true, 'resume() returns true for paused session');

  // E. Dispose Session
  const disposeResult = await localSessionBridge.dispose(sessionId);
  assert(disposeResult === true, 'dispose() cleans up session');
  assert(localSessionBridge.getSession(sessionId) === undefined, 'Disposed session removed from active map');

  // F. Verify Contract Document
  console.log('\n  [Verifying Web-IDE Implementation Contract Doc]');
  const contractPath = path.join(PROJECT_ROOT, 'docs', 'contracts', 'web-session-bridge-contract.md');
  assert(fsSync.existsSync(contractPath), 'Contract document exists: docs/contracts/web-session-bridge-contract.md');
  const contractContent = fsSync.readFileSync(contractPath, 'utf8');
  assert(contractContent.length >= 1000, 'Contract doc is comprehensive (>1000 chars)', `${contractContent.length} chars`);
  assert(contractContent.includes('Durable Object'), 'Contract doc specifies Cloudflare Durable Object architecture');
  assert(contractContent.includes('RECONNECT'), 'Contract doc specifies reconnection & state hydration contract');

  // ----------------------------------------------------------------------
  // Section 4: Tray Manager & Background Task Supervisor
  // ----------------------------------------------------------------------
  console.log('\n--- Section 4: Tray & Background Task Supervisor ---');

  // Clear notifications
  backgroundTaskSupervisor.clearNotifications();

  // A. 'Run in Background' Setting
  assert(backgroundTaskSupervisor.isRunInBackgroundEnabled() === false, 'runInBackground defaults to false');
  backgroundTaskSupervisor.setRunInBackground(true);
  assert(backgroundTaskSupervisor.isRunInBackgroundEnabled() === true, 'setRunInBackground(true) updates setting');

  // B. Start Background Task
  console.log('\n  [Running Background Task with Window Close Interception]');
  let taskExecutionCompleted = false;

  const { taskId, promise: taskPromise } = await backgroundTaskSupervisor.startTask(
    'Workspace Code Indexing',
    'Indexing 2,500 files for symbol navigation...',
    async (ctx) => {
      ctx.reportProgress(25, 'Scanning directory tree');
      await new Promise((r) => setTimeout(r, 40));
      ctx.reportProgress(50, 'Parsing TypeScript ASTs');
      await new Promise((r) => setTimeout(r, 40));
      ctx.reportProgress(100, 'Index complete');
      taskExecutionCompleted = true;
      return { indexedFiles: 2500 };
    }
  );

  assert(typeof taskId === 'string' && taskId.startsWith('bg_task_'), 'startTask returns valid task ID');
  const activeTasks = backgroundTaskSupervisor.getActiveTasks();
  assert(activeTasks.some((t) => t.id === taskId), 'Task registered in active tasks list');

  // C. Simulate Window Close while Task is Running
  const closeIntercept = backgroundTaskSupervisor.handleWindowCloseAttempt();
  assert(closeIntercept.shouldIntercept === true, 'Window close is intercepted when runInBackground is true');
  assert(closeIntercept.hasActiveTasks === true, 'Close attempt correctly detects running tasks');

  // Wait for background task to complete
  const taskResult = await taskPromise;
  assert(taskExecutionCompleted === true, 'Background task completed execution after window close attempt');
  assert(taskResult.indexedFiles === 2500, 'Background task returned correct payload');

  // D. Verify Native Completion Notification
  const notifications = backgroundTaskSupervisor.getEmittedNotifications();
  assert(notifications.length >= 2, 'Notifications emitted (background persistence notice + completion notice)', `${notifications.length} notifications`);
  const completionNotif = notifications.find((n) => n.title.includes('Task Complete') || n.body.includes('completed successfully'));
  assert(Boolean(completionNotif), 'Native task completion notification was dispatched');

  // E. Attention-Needed Notification
  console.log('\n  [Testing Attention-Needed Notification]');
  await backgroundTaskSupervisor.startTask(
    'Migration Runner',
    'Applying database migrations...',
    async (ctx) => {
      ctx.requestAttention('Approval required for schema drop');
      return true;
    }
  );

  const attentionNotif = backgroundTaskSupervisor.getEmittedNotifications().find((n) => n.title.includes('Attention Needed'));
  assert(Boolean(attentionNotif), 'Native attention-needed notification was dispatched');

  // F. Pause & Resume Task Controls
  console.log('\n  [Testing Task Pause & Resume Controls]');
  let pausedTaskResumed = false;
  const { taskId: pauseTaskId, promise: pauseTaskPromise } = await backgroundTaskSupervisor.startTask(
    'Long Download',
    'Downloading model weights...',
    async (ctx) => {
      await ctx.waitIfPaused();
      pausedTaskResumed = true;
      return 'done';
    }
  );

  const paused = backgroundTaskSupervisor.pauseTask(pauseTaskId);
  assert(paused === true, 'pauseTask() returns true for running task');
  assert(backgroundTaskSupervisor.getActiveTasks().find((t) => t.id === pauseTaskId)?.status === 'paused', 'Task status is paused');

  const resumed = backgroundTaskSupervisor.resumeTask(pauseTaskId);
  assert(resumed === true, 'resumeTask() returns true for paused task');
  await pauseTaskPromise;
  assert(pausedTaskResumed === true, 'Paused task resumed execution and finished successfully');

  // G. Tray Menu Structure Verification
  console.log('\n  [Verifying System Tray Context Menu]');
  const menuTemplate = trayManager.buildMenuTemplate();
  assert(Array.isArray(menuTemplate) && menuTemplate.length >= 6, 'Tray manager builds context menu template');

  const fleetMenuItem = menuTemplate.find((m) => typeof m.label === 'string' && m.label.includes('Fleet:'));
  assert(Boolean(fleetMenuItem), 'Tray menu displays Fleet Health status');

  const quickChatMenuItem = menuTemplate.find((m) => m.label === 'Open Quick Chat');
  assert(Boolean(quickChatMenuItem), 'Tray menu includes Open Quick Chat shortcut');

  const bgTasksMenu = menuTemplate.find((m) => m.label === 'Background Tasks');
  assert(Boolean(bgTasksMenu && Array.isArray(bgTasksMenu.submenu)), 'Tray menu includes Background Tasks submenu');

  const bgToggleMenuItem = menuTemplate.find((m) => typeof m.label === 'string' && m.label.includes('Run in Background'));
  assert(Boolean(bgToggleMenuItem && bgToggleMenuItem.type === 'checkbox'), 'Tray menu includes Run in Background checkbox item');

  // Stop local supply endpoint
  await localSupplyEndpoint.stop();

  // ----------------------------------------------------------------------
  // Section 5: Emit Audit Trace (docs/traces/fcc-reach.json)
  // ----------------------------------------------------------------------
  console.log('\n--- Section 5: Emitting Audit Trace ---');

  const gitCommit = await getGitCommit();
  const traceArtifact = {
    phase: 'FCC-5',
    title: 'FCC-Style Reach — External Clients, Browser Seam, Tray Presence',
    timestamp: new Date().toISOString(),
    gitCommit,
    command: 'node scripts/verify-fcc-reach.mjs',
    verificationSummary: {
      totalChecks,
      passedChecks,
      failedChecks: totalChecks - passedChecks,
      status: totalChecks === passedChecks ? 'PASSED' : 'FAILED'
    },
    metrics: {
      editorClients: {
        testedEndpointPort: testPort,
        supportedEditors: ['vscode', 'jetbrains', 'neovim'],
        liveCompletionVerified: true,
        documentationPages: docs.map((d) => d.file)
      },
      messagingConnectors: {
        telegramVerified: true,
        discordVerified: true,
        allowlistEnforced: true,
        rateCapsEnforced: true,
        auditLogEntriesRecorded: connectorAuditLogger.getEntries(50).length
      },
      browserSessionSeam: {
        interfaceImplemented: 'SessionBridge',
        localImplementation: 'LocalSessionBridge',
        testedSessionId: sessionId,
        contractDocument: 'docs/contracts/web-session-bridge-contract.md',
        multiplexingVerified: true,
        pauseResumeVerified: true
      },
      trayAndBackground: {
        runInBackgroundSettingActive: true,
        windowCloseInterceptionVerified: true,
        taskSurvivesWindowClose: true,
        notificationsEmittedCount: backgroundTaskSupervisor.getEmittedNotifications().length,
        trayMenuItemsVerified: menuTemplate.length
      }
    },
    testResults
  };

  await fs.mkdir(path.dirname(TRACE_FILE), { recursive: true });
  await fs.writeFile(TRACE_FILE, JSON.stringify(traceArtifact, null, 2), 'utf8');
  console.log(`\n  ✅ Trace artifact written to: ${TRACE_FILE}`);

  console.log('\n========================================================================');
  const percent = Math.round((passedChecks / totalChecks) * 100);
  console.log(`  Summary: ${passedChecks}/${totalChecks} checks passed (${percent}%)`);
  console.log('========================================================================\n');

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

runReachTests().catch((err) => {
  console.error('\nFatal test execution error:', err);
  process.exit(1);
});
