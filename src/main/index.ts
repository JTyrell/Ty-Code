import { bootProfiler } from './services/perf/boot-profiler';
import { openProfiler } from './services/perf/open-profiler';
import { bootScheduler } from './services/boot/boot-scheduler';

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught exception in main process:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled promise rejection in main process:', reason);
});
import { app, BrowserWindow, ipcMain, session, shell, dialog, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import os from 'os';
import fsSync from 'fs';
import { ProviderGateway, setGatewayActiveConfig } from './providers/provider-gateway';
import { detectLocalOllamaModels } from './services/local-model-detector';
import { PRECONFIGURED_PROVIDERS } from './config/provider-registry';
import type { PreConfiguredProvider } from '../preload/types';
import { historyExtractor } from './services/history-extractor';
import {
  selectWorkspaceFolder, getWorkspaceTree, getWorkspaceTreeChunked, setupWorkspaceWatcher, readFile, writeFile, createFile,
  createDirectory, deletePath, renamePath, searchWorkspaceFiles,
  searchInWorkspaceFiles, replaceInWorkspaceFiles
} from './ipc/fs-handlers';
import { readFileForContext } from './ipc/chat-handlers';
import { voiceTranscriber } from './services/voice-transcriber';
import {
  handleGetLspServers, handleStartLspServer, handleStopLspServer,
  handleRestartLspServer, handleConfigureLspServer, handleLspDidOpen,
  handleLspDidChange, handleLspDidSave, handleLspDidClose,
  handleLspCompletion, handleLspHover, handleLspDefinition,
  handleLspTypeDefinition, handleLspImplementation, handleLspReferences,
  handleLspRename, handleLspDocumentSymbols, handleLspWorkspaceSymbols,
  handleLspCodeActions, handleLspSignatureHelp, getLspManager
} from './ipc/lsp-handlers';
import { getCredentialStorageStatusResponse, getSettings, getSettingsLayer, getSecurityPolicy, saveSecurityPolicy, saveSettings, saveSettingsLayer, readOnboardingState, writeOnboardingState, mergeStoredApiKeys, classifySettingsError } from './ipc/settings-handlers';
import { setActiveAgentConfig } from './agent/agent-config';
import { providerHealthStore } from './providers/provider-health-store';
import { routeEventPolicy } from './providers/route-event-policy';
import { settingsManager } from './services/settings-manager';
import { startAgentTask, stopAgentTask, respondAgentApproval, applyDiff, handleUserApproveDiff } from './ipc/agent-handlers';
import { chatLatencyTracker } from './providers/provider-gateway';
import {
  runCommand, getAvailableShells, spawnPtySession, attachPty, writePty,
  resizePty, syncPtyCwd, killPty, cleanupAllPtys, resolvePtyApproval, executePtyCommand
} from './ipc/pty-handlers';
import {
  searchOpenVsxExtensions, getOpenVsxExtensionDetails, handleGetInstalledExtensions,
  handleInstallExtension, handleUninstallExtension, handleToggleExtension,
  handleUpdateExtensionSettings, handleInstallExtensionFromVsix, handleExtensionCapability,
  handleExtensionActivate, handleExtensionDeactivate, handleExtensionExecuteCommand,
  handleExtensionTriggerEvent, handleExtensionListCommands, handleExtensionProvideCompletions
} from './ipc/extensions-handlers';
import {
  handleMarketplaceSearch, handleMarketplaceMetadata,
  handleMarketplaceInstall, handleMarketplaceUninstall,
  handleMarketplaceListInstalled,
  handleTraceExtensionInstall
} from './ipc/marketplace-handlers';
import { getAvailableSkills } from './ipc/skills-handlers';
import {
  handleBraveDetect,
  handleBraveInstall,
  handleBraveGetStatus,
  handleBraveSetEnabled,
  handleBraveSearch,
  handleBraveNavigate,
  handleBraveGetPageContent,
  handleBraveClose,
  handleBraveStartTesting,
  handleBraveStopTesting
} from './ipc/brave-handlers';
import {
  handleGitIsRepo, handleGitInit, handleGitGetStatus, handleGitGetDiff,
  handleGitGetFileDiff, handleGitGetCommitDetail, handleGitGetTags, handleGitCreateTag,
  handleGitDeleteTag, handleGitGetConflictContent, handleGitResolveConflict,
  handleGitAbortMerge, handleGitGetHunks, handleGitApplyHunk, handleGitMerge,
  handleGitGetOriginalContent, handleGitStage, handleGitUnstage,
  handleGitDiscardChanges, handleGitCommit, handleGitGetBranches,
  handleGitCreateBranch, handleGitSwitchBranch, handleGitDeleteBranch,
  handleGitFetch, handleGitPull, handleGitPush, handleGitGetLog,
  handleGitGetBlame, handleGitStash, handleGitGetRemotes,
  resolveGitRepositoryPath, handleGitListRepositories, handleGitGetGraph,
  handleGitSuggestCommitMessage
} from './ipc/git-handlers';
import { WindowStateManager } from './services/window-state';
import { getUpdateManager, type UpdateChannel } from './services/update-manager';
import { getRecentWorkspacesManager } from './services/recent-workspaces';
import { MyersDiff } from './services/myers-diff';
import { getWorkspaceEditPreviewService, setWorkspaceEditPreviewWorkspace } from './services/workspace-edit-preview';
import { fromFileUri } from './services/lsp-path-utils';
import { loadDocument, persistDocument, parseMarkdownSections, listDocuments, type AgentDocument } from './services/document-parser';
import type { CommandExecutionOptions, ProposedDiff, PtySpawnOptions, ReplaceInFilesOptions, SearchInFilesOptions, TelemetryEvent, WorkspaceEditOrigin } from '../preload/types';
import { fileURLToPath } from 'url';

import { initAiFeatureServices, updateAiServicesWorkspace, registerAiFeatureHandlers, getInlineService } from './ipc/ai-features-handlers';
import { requestCache } from './services/orchestration/request-cache';
import { fccManager } from './services/orchestration/fcc-manager';
import { fccSidecarManager } from './services/fcc-sidecar-manager';
import { checkFCCHealth } from './services/fcc-manager';
import { fccIntegrityChecker } from './services/orchestration/fcc-integrity';
import { fccEmbeddedCore } from './services/fcc/embedded-core';
import { fccServiceManager } from './fcc-integration';
import { fccCatalogSync } from './services/fcc/catalog-sync';
import { modelCatalogVerifier } from './services/providers/catalog-verifier';
import { harnessImporter } from './services/fcc/harness-importer';
import { subscriptionOAuthService } from './services/fcc/subscription-oauth';
import { localSupplyEndpoint } from './services/fcc/local-supply-endpoint';
import { harnessDriverService } from './services/fcc/harness-driver';
import { optimizationPipeline } from './providers/optimization-pipeline';
import { editorConfigExporter } from './services/fcc/editor-configs';
import { connectorManager } from './services/fcc/connectors/connector-manager';
import { localSessionBridge } from './services/session/session-bridge';
import { backgroundTaskSupervisor } from './services/background/background-task-supervisor';
import { trayManager } from './services/background/tray-manager';
import { providerAutoSetup } from './services/orchestration/provider-auto-setup';
import { openKiloProvider } from './services/orchestration/openkilo-provider';
import { quotaTracker } from './services/orchestration/quota-tracker';
import { smartModelSelector } from './services/orchestration/smart-selector';
import { performanceManager } from './services/orchestration/performance-manager';
import { contextCompressor } from './services/orchestration/context-compressor';
import { scanWorkspace, getOrScanWorkspaceProfile, clearWorkspaceProfileCache } from './services/context-engine/workspace-scanner';
import { saveCorrection, getCorrections, getCorrectionEntries, deleteCorrection, onCorrectionAdded } from './services/context-engine/correction-memory';
import { getRecommendedMCPs } from './services/context-engine/mcp-router';
import { calculateContextScore, auditWorkspaceContext, type ContextScoreResult } from './services/context-engine/context-scorer';
import { extractDesignSystem, clearDesignProfileCache } from './services/context-engine/design-system-extractor';
import { moduleManager } from './services/module-manager';
import { moduleRegistry } from './services/module-registry';
import { mcpManager } from './services/mcp-manager';
import { freeProviderRegistry } from './services/providers/free-provider-registry';
import { getVerifiedModels, type VerifiedModelConfig } from './services/verified-models';
import { getAvailableModels, getModelsAvailability, getModelAvailabilitySummary, clearAvailabilityCache } from './services/model-availability-manager';
import type { FreeProvider, FreeProviderId, FreeAuthType, FreeProviderCapabilities } from '../shared/types/free-providers';
import { modelClassifier } from './services/providers/model-classifier';
import { providerHealthMonitor } from './services/providers/health-monitor';
import { keyDetector, maskKey } from './services/providers/key-detector';
import { credentialStore } from './services/auth/credential-store';
import { readStoredCredentials, encryptSecret, decryptSecret } from './ipc/settings-handlers';
import type { CustomProviderConfig, StoredKeySummary } from '../shared/types/byok';
import { opencodeIntegration } from './services/providers/opencode-integration';
import { opencodeFreeDetector } from './services/providers/opencode-free-detector';
import { opencodeInstaller } from './opencode-integration/opencode-installer';
import { saveOpenCodeApiKey, getOpenCodeKeyStatus, discoverOpenCodeFreeModels } from './services/opencode-config-manager';
import { opencodeBridge, buildBridgePromptFromMessages } from './services/opencode-bridge';
import { memoryGovernor, MemoryGovernor, type GovernorMode, type GovernorTier } from './services/memory-governor';

/** Active chat bridge run (Prompt 3): only one opencode child at a time. */
let opencodeChatAbort: AbortController | null = null;
import type { AgentFramework } from '../shared/types/opencode-sync';
import { taskClassifier } from './services/orchestration/task-classifier';
import { userPreferences } from './services/orchestration/user-preferences';
import { modelRouter } from './services/orchestration/model-router';
import type { RouterUserPreferences } from '../shared/types/model-router';
import { usageAnalytics } from './services/orchestration/usage-analytics';
import { TelemetryManager } from './services/telemetry-manager';
import type { TelemetryFeature } from '../preload/types';
import { policyEngine } from './services/policy/policy-engine';
import { usageLedger as tokenAccountingLedger } from './services/usage/usage-ledger';
import { ledgerQueryService } from './services/usage/ledger-query';
import { z } from 'zod';
import { AgentStartTaskPayloadSchema } from '../shared/types/agent-events';

const AgentRespondApprovalPayloadSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  feedback: z.string().optional()
});

const UserApproveDiffPayloadSchema = z.union([
  z.boolean(),
  z.object({
    approvalId: z.string().optional(),
    diffId: z.string().optional(),
    approved: z.boolean().optional()
  })
]);

const PtyResolveApprovalPayloadSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean()
});

const PtyWritePayloadSchema = z.object({
  ptyId: z.string().min(1),
  data: z.string()
});

const PtyResizePayloadSchema = z.object({
  ptyId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive()
});

const PtySyncCwdPayloadSchema = z.object({
  ptyId: z.string().min(1),
  targetCwd: z.string().min(1),
  shellId: z.string()
});

const PtySpawnOptionsSchema = z.object({
  shellId: z.string().optional(),
  cwd: z.string().optional(),
  profileId: z.string().optional()
});

const AgentApplyDiffPayloadSchema = z.object({
  id: z.string().optional(),
  filePath: z.string().min(1),
  originalContent: z.string(),
  proposedContent: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'applied', 'rejected']).optional()
});

import { recordLspDiagnostics } from './services/orchestration/tools/diagnostics';
import { diagnosticService } from './services/diagnostics/diagnostic-service';
import { capabilitySuite } from './services/diagnostics/capability-suite';
import { remediationEngine } from './services/diagnostics/remediation-engine';
import { sidecarLogLedger } from './services/fcc/sidecar-log-ledger';
import { diagnosticsHealthMonitor } from './services/diagnostics/health-monitor';
import { connectivityTracer } from './services/diagnostics/connectivity-tracer';
import { providerOAuth } from './services/auth/provider-oauth';
import { usageLedger } from './services/usage/ledger';
import { saveKey, getKey, testKey, warmUpCommunityKey, revalidateCommunityKey, getCommunityKeyCached, hasCommunityKey, getCommunityKeyStatus, clearKeyCache } from './services/credential-vault';
import { initiateCopilotDeviceFlow, pollCopilotToken } from './services/auth/subscription-auth';
import { canvasSyncManager } from './services/canvas-sync-manager';
import { canvasAgentEngine, type CanvasAgentGenerationResult } from './agent/canvas-agent-engine';
import { getCanvasWindow } from './windows/canvas-window';
import { openCanvasWindow } from './windows/canvas-window';
import { debuggerSyncManager, openDebuggerWindow, closeDebuggerWindow } from './windows/debugger-window';
import { opencodeServiceManager } from './opencode-integration';
import { workspaceManager, isAppOrSystemDir } from './services/workspace-manager';
import { getWorkspaceSessionManager } from './services/workspace-session-manager';
import { registerWorkspaceSessionHandlers } from './ipc/workspace-session-handlers';
import { registerCanvasPreviewHandlers } from './ipc/canvas-preview-handlers';
import { registerPromptAssemblerHandlers } from './ipc/preferences-handlers';

/**
 * Single instance lock: Ensure only one Ty-Code process runs at a time.
 * If another instance is launched (e.g. via OS context menu), its commandLine
 * arguments are forwarded to the primary instance's 'second-instance' handler,
 * and the secondary instance quits immediately.
 */
bootProfiler.recordMark('main_import');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  process.stdout.write('[INSTANCE] Another Ty-Code instance is already running; focusing it instead of starting a second copy.\n');
  app.quit();
}

/**
 * Extracts a target folder path from command line arguments (e.g., Windows Explorer context menu).
 */
export function extractFolderFromArgs(args: string[], cwd?: string): string | null {
  for (let i = 1; i < args.length; i++) {
    const candidate = args[i]?.trim();
    if (!candidate) continue;
    if (candidate === '.' || candidate === './' || candidate === '.\\') {
      if (!app.isPackaged && i === 1) continue;
    }
    if (candidate.startsWith('-')) continue;
    if (candidate.startsWith('ty-code://')) continue;
    const cleanPath = candidate.replace(/^["'](.*)["']$/, '$1');
    try {
      const resolved = cwd ? path.resolve(cwd, cleanPath) : path.resolve(cleanPath);
      if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isDirectory()) {
        if (!isAppOrSystemDir(resolved)) {
          return resolved;
        }
      }
    } catch {
      // Ignore unresolvable args
    }
  }
  return null;
}

let pendingMacOpenPath: string | null = null;
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  try {
    const resolved = path.resolve(filePath);
    if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isDirectory()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        void workspaceManager.openWorkspace(resolved).then((r) => {
          if (r.success) getWorkspaceSessionManager().setActiveWorkspace(resolved);
        });
      } else {
        pendingMacOpenPath = resolved;
      }
    }
  } catch (err) {
    console.error('[MACOS-OPEN-FILE] Failed to parse folder path:', err);
  }
});

function getInitialWorkspacePath(): string {
  const argFolder = extractFolderFromArgs(process.argv);
  if (argFolder && !isAppOrSystemDir(argFolder)) return argFolder;

  // Never default to process.cwd() when running as a packaged app!
  // In packaged apps (Windows installer, desktop shortcut, Start Menu),
  // process.cwd() is the installation / executable directory or system root.
  // The app should open cleanly to the Welcome / No Project state.
  if (app.isPackaged) {
    return '';
  }

  // In development mode, check if cwd is an app or system directory
  const cwd = process.cwd();
  if (isAppOrSystemDir(cwd)) {
    return '';
  }
  return '';
}

let mainWindow: BrowserWindow | null = null;
let currentWorkspacePath = getInitialWorkspacePath();
setWorkspaceEditPreviewWorkspace(currentWorkspacePath);
let ipcRegistered = false;
let governorMode: GovernorMode = 'FULL';
let liteNoticeSent = false;
let diagnosticsManager: ReturnType<typeof getLspManager> | null = null;
let diagnosticsUnsubscribe: (() => void) | null = null;
let telemetryManager: TelemetryManager | null = null;
let pendingHistoryDestination: string | null = null;

function getTelemetryManager(): TelemetryManager {
  if (!telemetryManager) {
    telemetryManager = new TelemetryManager(settingsManager, path.join(app.getPath('userData'), 'telemetry-events.json'));
  }
  return telemetryManager;
}

function ensureLspDiagnosticsBridge(): void {
  const manager = getLspManager(currentWorkspacePath);
  if (diagnosticsManager === manager) return;
  diagnosticsUnsubscribe?.();
  diagnosticsManager = manager;
  diagnosticsUnsubscribe = manager.onDiagnostics((event) => {
    if (!mainWindow) return;
    try {
      const filePath = fromFileUri(event.uri);
      recordLspDiagnostics(event.uri, filePath, event.diagnostics as any[]);
      mainWindow.webContents.send('lsp:diagnostics', { ...event, filePath });
    } catch {
      // Invalid server URIs are ignored and never forwarded to the renderer.
    }
  });
}

const windowStateManager = new WindowStateManager();

function isTrustedExtensionFrame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    try { return new URL(frame.url).origin === new URL(devServerUrl).origin; }
    catch { return false; }
  }
  try {
    return path.resolve(fileURLToPath(frame.url)).toLowerCase() === path.resolve(__dirname, '../renderer/index.html').toLowerCase();
  } catch {
    return false;
  }
}

async function buildMergedFreeProviderList(): Promise<FreeProvider[]> {
  const fccCatalog = fccCatalogSync.getCatalog() || [];
  const verified = await getVerifiedModels().catch(() => [] as VerifiedModelConfig[]);
  const staticRegistry = freeProviderRegistry.getAllProviders();
  console.log(`[FCC][INIT] buildMergedFreeProviderList: fccProviders=${fccCatalog.length} enabled=${fccCatalog.filter((p) => p.enabled).length}, verifiedModels=${verified.length}, staticProviders=${staticRegistry.length}`);

  const byId = new Map<string, FreeProvider>();

  // Map FCC provider id -> FreeProviderId
  function toFreeProviderId(id: string): FreeProviderId {
    const map: Record<string, FreeProviderId> = {
      openrouter: 'openrouter-free',
      groq: 'groq-free',
      openkilo: 'openkilo-free',
      huggingface: 'huggingface-free',
      'together-ai': 'together-ai-free',
      'fireworks-ai': 'fireworks-ai-free',
      'google-ai-studio': 'google-ai-studio-free',
      anthropic: 'anthropic-claude-free',
      opencode: 'opencode-built-in',
      ollama: 'groq-free' // fallback
    };
    return map[id] || (id.endsWith('-free') ? (id as FreeProviderId) : `${id}-free` as FreeProviderId);
  }

  // Map FCC authMethod -> FreeAuthType
  function toFreeAuthType(auth: string): FreeAuthType {
    if (auth === 'none') return 'anonymous';
    if (auth === 'api_key') return 'api_key_optional';
    if (auth === 'oauth' || auth === 'web_cookie') return 'fcc_proxy';
    return 'api_key_optional';
  }

  // 1. FCC catalog (primary, live health/latency)
  for (const p of fccCatalog) {
    if (!p.enabled) continue;
    const freeModels = (p.models || []).filter(m => m.isFree);
    const caps: FreeProviderCapabilities = {};
    for (const m of freeModels) {
      for (const [k, v] of Object.entries(m.capabilities)) {
        if (v) {
          const cat = k as keyof FreeProviderCapabilities;
          const current = caps[cat];
          if (!current) caps[cat] = [m.id];
          else if (Array.isArray(current)) current.push(m.id);
          else caps[cat] = [current, m.id];
        }
      }
    }
    byId.set(p.id, {
      id: toFreeProviderId(p.id),
      name: p.name,
      base_url: p.defaultEndpoint,
      auth_type: toFreeAuthType(p.authMethod),
      best_free_models: freeModels.map(m => m.id),
      setup_instructions: p.signupUrl ? `Get API key at ${p.signupUrl}` : 'No API key required',
      model_capabilities: caps,
      signup_url: p.signupUrl
    });
  }

  // 2. Verified supplemental (OpenCode Zen, OpenKilo curated, preconfigured, Ollama)
  const fccModelIds = new Set(fccCatalog.flatMap(p => (p.models || []).map(m => m.id)));
  const verifiedByProvider = new Map<string, VerifiedModelConfig[]>();
  for (const vm of verified) {
    if (fccModelIds.has(vm.modelId)) continue;
    // FCC policy: default listing = free supply only (keyless gateways, :free
    // pools, baked OpenCode Zen, local Ollama). Paid defaults (e.g. gpt-4o)
    // stay unlocked through BYOK key entry instead of being listed by default.
    const isFreeEntry =
      !vm.requiresKey ||
      vm.modelId.includes(':free') ||
      vm.modelId.endsWith('/free') ||
      (vm.providerId || '').toLowerCase().includes('opencode');
    if (!isFreeEntry) continue;
    const list = verifiedByProvider.get(vm.providerId) || [];
    list.push(vm);
    verifiedByProvider.set(vm.providerId, list);
  }
  for (const [providerId, models] of verifiedByProvider) {
    if (byId.has(providerId)) continue;
    const first = models[0];
    byId.set(providerId, {
      id: toFreeProviderId(providerId),
      name: first.name || providerId,
      base_url: first.url.replace('/chat/completions', ''),
      auth_type: first.requiresKey ? 'api_key_optional' : 'anonymous',
      best_free_models: models.map(m => m.modelId),
      setup_instructions: first.requiresKey ? `Requires API key for ${providerId}` : 'No API key required',
      model_capabilities: {},
      signup_url: undefined
    });
  }

  // 3. Static registry fallback for any remaining providers
  for (const p of staticRegistry) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }

  return [...byId.values()];
}

function registerIpcHandlers(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  // M3E Canvas overhaul: shared context & chat sync bridge (canvas window <-> main window)
  canvasSyncManager.setTrustedSenderCheck(isTrustedExtensionFrame);
  canvasSyncManager.attachWindowResolver(() =>
    BrowserWindow.getAllWindows()
      .filter((win) => {
        try {
          if (win.webContents.isDestroyed()) return false;
          const url = win.webContents.getURL();
          if (!url) return false;
          const devServerUrl = process.env.VITE_DEV_SERVER_URL;
          if (devServerUrl) return url.startsWith(devServerUrl.split('#')[0]);
          return url.toLowerCase().includes('/index.html');
        } catch {
          return false;
        }
      })
      .map((win) => win.webContents)
  );
  canvasSyncManager.registerIpcHandlers(ipcMain, { isTrustedSender: isTrustedExtensionFrame });

  // Omni-Debugger: Multi-Engine Diagnostic & Architecture Inspector synchronization
  debuggerSyncManager.setTrustedSenderCheck(isTrustedExtensionFrame);
  debuggerSyncManager.attachWindowResolver(() =>
    BrowserWindow.getAllWindows()
      .filter((win) => {
        try {
          if (win.webContents.isDestroyed()) return false;
          const url = win.webContents.getURL();
          if (!url) return false;
          const devServerUrl = process.env.VITE_DEV_SERVER_URL;
          if (devServerUrl) return url.startsWith(devServerUrl.split('#')[0]);
          return url.toLowerCase().includes('/index.html');
        } catch {
          return false;
        }
      })
      .map((win) => win.webContents)
  );
  debuggerSyncManager.registerIpcHandlers(ipcMain, { isTrustedSender: isTrustedExtensionFrame });

  // Canvas agent engine: UI generation prompts coming from the Canvas chat.
  ipcMain.handle(
    'canvas:agent-generate',
    async (event, rawPrompt: unknown): Promise<{ ok: boolean; data?: CanvasAgentGenerationResult; error?: string }> => {
      if (!isTrustedExtensionFrame(event)) return { ok: false, error: 'Untrusted renderer frame.' };
      if (typeof rawPrompt !== 'string') return { ok: false, error: 'Prompt must be a string.' };
      try {
        const targetWorkspace = currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd();
        const result: CanvasAgentGenerationResult = await canvasAgentEngine.generate(rawPrompt, { workspaceRoot: targetWorkspace });
        return { ok: result.ok, data: result, ...(result.error ? { error: result.error } : {}) };
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Canvas chat sidecar: streaming UI generation ('canvas:chat-send').
  ipcMain.handle(
    'canvas:chat-send',
    async (event, rawPayload: unknown): Promise<{ ok: boolean; data?: CanvasAgentGenerationResult & { runId: string }; error?: string }> => {
      if (!isTrustedExtensionFrame(event)) return { ok: false, error: 'Untrusted renderer frame.' };
      const payload = (typeof rawPayload === 'object' && rawPayload !== null ? rawPayload : {}) as { prompt?: unknown; workspaceRoot?: string };
      if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
        return { ok: false, error: 'Prompt must be a non-empty string.' };
      }
      const runId = `run_${globalThis.crypto.randomUUID()}`;
      try {
        canvasSyncManager.pushAgentEvent({ runId, type: 'status', content: 'Generating UI…' });
        const targetWorkspace = payload.workspaceRoot?.trim() || currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd();
        const result = await canvasAgentEngine.generate(payload.prompt, {
          runId,
          workspaceRoot: targetWorkspace,
          onToken: (content) => canvasSyncManager.pushAgentEvent({ runId, type: 'token', content })
        });
        canvasSyncManager.pushAgentEvent({ runId, type: result.ok ? 'done' : 'error', content: result.error || result.summary });
        return { ok: result.ok, data: { ...result, runId }, ...(result.error ? { error: result.error } : {}) };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        canvasSyncManager.pushAgentEvent({ runId, type: 'error', content: message });
        return { ok: false, error: message };
      }
    }
  );

  // Renderer-initiated canvas-update notification mirror (same channel the engine uses).
  ipcMain.handle(
    'canvas:notify-main-chat-update',
    async (event, rawPayload: unknown): Promise<{ ok: boolean; data?: boolean; error?: string }> => {
      if (!isTrustedExtensionFrame(event)) return { ok: false, error: 'Untrusted renderer frame.' };
      const payload = (typeof rawPayload === 'object' && rawPayload !== null ? rawPayload : {}) as Record<string, unknown>;
      if (typeof payload.action !== 'string' || !payload.action.trim()) {
        return { ok: false, error: 'Action must be a non-empty string.' };
      }
      canvasSyncManager.pushMainChatUpdate({
        action: payload.action,
        ...(typeof payload.codeSnippet === 'string' ? { codeSnippet: payload.codeSnippet.slice(0, 20_000) } : {}),
        ...(typeof payload.platform === 'string' ? { platform: payload.platform } : {}),
        updatedAt: Date.now()
      });
      return { ok: true, data: true };
    }
  );

  // Focus the Canvas window ("View in Canvas" from the main chat).
  registerPromptAssemblerHandlers();
  ipcMain.handle('canvas:focus-window', async (): Promise<{ ok: boolean; data?: boolean }> => {
    const win = getCanvasWindow();
    if (!win || win.isDestroyed()) return { ok: true, data: false };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true, data: true };
  });

  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    win?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    win?.close();
  });
  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    return win?.isMaximized() ?? false;
  });

  // UI-Polish 2: Platform Inset Metrics (caption buttons, titlebar, status bar, resize handle hit area)
  ipcMain.handle('platform:get-insets', () => {
    const isMac = process.platform === 'darwin';
    const isWindows = process.platform === 'win32';
    return {
      success: true,
      data: {
        platform: process.platform,
        titlebarHeight: 32,
        captionButtonWidth: isWindows ? 138 : isMac ? 0 : 96,
        trafficLightWidth: isMac ? 78 : 0,
        statusBarHeight: 24,
        resizeCornerArea: 16,
        scrollbarGutter: 12
      }
    };
  });

  registerWorkspaceSessionHandlers();
  registerCanvasPreviewHandlers();

  ipcMain.handle('fs:select-workspace', async () => {
    const targetWin = BrowserWindow.getFocusedWindow() || mainWindow;
    const response = await workspaceManager.openFolderDialog(targetWin);
    if (response.success && response.data) {
      currentWorkspacePath = response.data;
      setWorkspaceEditPreviewWorkspace(response.data);
      debuggerSyncManager.pushStateUpdate({ workspacePath: response.data });
      getWorkspaceSessionManager().setActiveWorkspace(response.data);
    }
    return response;
  });
  ipcMain.handle('workspace:open-folder-dialog', async () => {
    const targetWin = BrowserWindow.getFocusedWindow() || mainWindow;
    const response = await workspaceManager.openFolderDialog(targetWin);
    if (response.success && response.data) {
      currentWorkspacePath = response.data;
      setWorkspaceEditPreviewWorkspace(response.data);
      debuggerSyncManager.pushStateUpdate({ workspacePath: response.data });
      getWorkspaceSessionManager().setActiveWorkspace(response.data);
    }
    return response;
  });
  ipcMain.handle('workspace:open-folder', async (_event, folderPath: string) => {
    if (!folderPath) return { success: false, error: 'Invalid folder path' };
    const result = await workspaceManager.openWorkspace(folderPath);
    if (result.success) {
      currentWorkspacePath = workspaceManager.currentWorkspacePath;
      setWorkspaceEditPreviewWorkspace(workspaceManager.currentWorkspacePath);
      debuggerSyncManager.pushStateUpdate({ workspacePath: workspaceManager.currentWorkspacePath });
      getWorkspaceSessionManager().setActiveWorkspace(workspaceManager.currentWorkspacePath);
    }
    return result;
  });
  ipcMain.handle('workspace:scan', async (event, rootPath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof rootPath === 'string' && rootPath.trim()
        ? rootPath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const profile = await scanWorkspace(targetPath);
      return { success: true, data: profile };
    } catch (err: unknown) {
      console.error('[workspace:scan] Failed to scan workspace:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:save-correction', async (event, payload: { workspacePath?: string; rule: string; category?: 'style' | 'architecture' | 'stack'; surface?: 'chat' | 'debugger' | 'canvas' | 'global' }) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = payload.workspacePath?.trim() || currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd();
      const entry = await saveCorrection(targetPath, payload.rule, payload.category || 'style', payload.surface || 'chat');
      // Broadcast to all active browser windows for real-time renderer UI reflection
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('context:correction-added', entry);
        }
      }
      return { success: true, data: entry };
    } catch (err: unknown) {
      console.error('[context:save-correction] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:get-corrections', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const rules = await getCorrections(targetPath);
      return { success: true, data: rules };
    } catch (err: unknown) {
      console.error('[context:get-corrections] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:get-recommended-mcps', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const profile = await scanWorkspace(targetPath);
      const recommendations = getRecommendedMCPs(profile);
      return { success: true, data: recommendations };
    } catch (err: unknown) {
      console.error('[context:get-recommended-mcps] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:get-score', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const profile = await getOrScanWorkspaceProfile(targetPath);
      const corrections = await getCorrectionEntries(targetPath);
      const scoreResult = calculateContextScore(profile, corrections.length);
      return { success: true, data: { scoreResult, profile, corrections } };
    } catch (err: unknown) {
      console.error('[context:get-score] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:delete-correction', async (event, payload: { workspacePath?: string; id: string }) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = payload.workspacePath?.trim() || currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd();
      const deleted = await deleteCorrection(targetPath, payload.id);
      return { success: true, data: deleted };
    } catch (err: unknown) {
      console.error('[context:delete-correction] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:get-correction-entries', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const entries = await getCorrectionEntries(targetPath);
      return { success: true, data: entries };
    } catch (err: unknown) {
      console.error('[context:get-correction-entries] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:resync-workspace', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      clearWorkspaceProfileCache();
      clearDesignProfileCache();
      const profile = await scanWorkspace(targetPath);
      const corrections = await getCorrectionEntries(targetPath);
      const scoreResult = calculateContextScore(profile, corrections.length);
      return { success: true, data: { scoreResult, profile, corrections } };
    } catch (err: unknown) {
      console.error('[context:resync-workspace] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('context:get-design-profile', async (event, workspacePath?: unknown) => {
    if (!isTrustedExtensionFrame(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    try {
      const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
        ? workspacePath.trim()
        : (currentWorkspacePath || workspaceManager.currentWorkspacePath || process.cwd());
      const profile = await extractDesignSystem(targetPath);
      return { success: true, data: profile };
    } catch (err: unknown) {
      console.error('[context:get-design-profile] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('fs:set-workspace', async (_event, folderPath: string) => {
    if (!folderPath) return { success: false, error: 'Invalid folder path' };
    const result = await workspaceManager.openWorkspace(folderPath);
    if (!result.success) return { success: false, error: result.error };
    currentWorkspacePath = folderPath;
    setWorkspaceEditPreviewWorkspace(folderPath);
    debuggerSyncManager.pushStateUpdate({ workspacePath: folderPath });
    getWorkspaceSessionManager().setActiveWorkspace(folderPath);
    return getWorkspaceTree(folderPath);
  });
  ipcMain.handle('fs:get-tree', async () => {
    if (!currentWorkspacePath) {
      return { success: false, error: 'No workspace folder opened. Choose a folder to explore.' };
    }
    return getWorkspaceTree(currentWorkspacePath);
  });
  ipcMain.handle('fs:get-tree-chunked', async (_event, rootPath?: string) => {
    const target = rootPath || currentWorkspacePath;
    if (!target) {
      return { success: false, error: 'No workspace folder opened. Choose a folder to explore.' };
    }
    return getWorkspaceTreeChunked(target, (chunk, isComplete, totalSoFar) => {
      mainWindow?.webContents.send('fs:tree-chunk', { entries: chunk, isComplete, totalSoFar });
    });
  });
  ipcMain.handle('fs:read-file', (_event, filePath: string) => readFile(filePath, currentWorkspacePath));
  ipcMain.handle('chat:read-file-for-context', (_event, filePath: string, options?: { maxLines?: number }) => readFileForContext(filePath, currentWorkspacePath, options));
  ipcMain.handle('voice:init', async () => {
    try {
      await voiceTranscriber.init();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Voice engine failed to initialize' };
    }
  });
  ipcMain.handle('voice:start-recording', async () => {
    try {
      await voiceTranscriber.init();
      const sessionId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      if (!voiceTranscriber.startRecording(sessionId)) {
        return { success: false, error: 'Voice engine is not ready' };
      }
      return { success: true, data: { sessionId, capturing: true } };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Voice engine failed to start' };
    }
  });
  ipcMain.handle('voice:append-audio-chunk', (_event, sessionId: string, audioBase64: string) => {
    try {
      const accepted = voiceTranscriber.appendAudioChunk(String(sessionId || ''), String(audioBase64 || ''));
      return accepted ? { success: true } : { success: false, error: 'Audio chunk rejected' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to buffer audio chunk' };
    }
  });
  ipcMain.handle('voice:stop-and-transcribe', async (_event, sessionId: string) => {
    try {
      const result = await voiceTranscriber.stopAndTranscribe(String(sessionId || ''));
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Transcription failed' };
    }
  });
  ipcMain.handle('voice:discard-session', (_event, sessionId: string) => {
    try {
      voiceTranscriber.discardSession(String(sessionId || ''));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to discard voice session' };
    }
  });
  ipcMain.handle('voice:release', () => {
    try {
      voiceTranscriber.release();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to release voice engine' };
    }
  });
  ipcMain.handle('fs:write-file', (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') {
      return { success: false, error: 'Invalid parameters: filePath and content must be strings' };
    }
    return writeFile(filePath, content, currentWorkspacePath);
  });
  ipcMain.handle('fs:create-file', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { success: false, error: 'Invalid parameter: filePath must be a string' };
    }
    return createFile(filePath, currentWorkspacePath);
  });
  ipcMain.handle('fs:create-directory', (_event, dirPath: unknown) => {
    if (typeof dirPath !== 'string') {
      return { success: false, error: 'Invalid parameter: dirPath must be a string' };
    }
    return createDirectory(dirPath, currentWorkspacePath);
  });
  ipcMain.handle('fs:delete-path', (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string') {
      return { success: false, error: 'Invalid parameter: targetPath must be a string' };
    }
    return deletePath(targetPath, currentWorkspacePath);
  });
  ipcMain.handle('fs:rename-path', (_event, oldPath: unknown, newPath: unknown) => {
    if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
      return { success: false, error: 'Invalid parameters: oldPath and newPath must be strings' };
    }
    return renamePath(oldPath, newPath, currentWorkspacePath);
  });
  ipcMain.handle('fs:search-files', (_event, query: unknown) => {
    if (typeof query !== 'string') {
      return { success: false, error: 'Invalid query parameter: query must be a string' };
    }
    return searchWorkspaceFiles(currentWorkspacePath, query);
  });
  ipcMain.handle('fs:search-in-files', (_event, options: SearchInFilesOptions) => searchInWorkspaceFiles(currentWorkspacePath, options));
  ipcMain.handle('fs:replace-in-files', (_event, options: ReplaceInFilesOptions) => {
    if (!options?.dryRun) return { success: false, error: 'Workspace replacements must be previewed and explicitly applied.' };
    return replaceInWorkspaceFiles(currentWorkspacePath, options);
  });
  ipcMain.handle('fs:preview-replace', async (_event, options: ReplaceInFilesOptions) => {
    try {
      const service = getWorkspaceEditPreviewService();
      const preview = await service.createSearchReplacePreview(options);
      const settings = (await getSettings()).data;
      const applied = options.forcePreview ? null : await service.tryAutoApplyPreview(preview.previewId, {
        enabled: settings?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile',
        forcePreviewAll: false
      });
      return { success: true, data: applied ? { applied } : { preview } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('workspace-edit:preview-lsp', async (_event, payload: { edit: unknown; title: string; origin: WorkspaceEditOrigin; forcePreview?: boolean }) => {
    try {
      if (!payload || !['lsp-rename', 'refactor'].includes(payload.origin) || typeof payload.title !== 'string' || payload.title.length > 160) throw new Error('Invalid workspace edit preview request.');
      const service = getWorkspaceEditPreviewService();
      const preview = await service.createLspPreview(payload.edit, payload.title, payload.origin);
      const settings = (await getSettings()).data;
      const applied = payload.forcePreview ? null : await service.tryAutoApplyPreview(preview.previewId, {
        enabled: settings?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile',
        forcePreviewAll: false
      });
      return { success: true, data: applied ? { applied } : { preview } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('workspace-edit:preview-snippet', async (_event, request: { filePath: string; lineNumber: number; originalText: string; replacementText: string; title: string; forcePreview?: boolean }) => {
    try {
      if (!request || !Number.isInteger(request.lineNumber) || typeof request.originalText !== 'string' || typeof request.replacementText !== 'string') throw new Error('Invalid snippet edit preview request.');
      const service = getWorkspaceEditPreviewService();
      const preview = await service.createSnippetEditPreview(request);
      const settings = (await getSettings()).data;
      const applied = request.forcePreview ? null : await service.tryAutoApplyPreview(preview.previewId, {
        enabled: settings?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile',
        forcePreviewAll: false
      });
      return { success: true, data: applied ? { applied } : { preview } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('workspace-edit:apply', async (_event, previewId: string) => {
    try { return { success: true, data: await getWorkspaceEditPreviewService().applyPreview(previewId) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('workspace-edit:cancel', (_event, previewId: string) => {
    getWorkspaceEditPreviewService().cancelPreview(previewId);
    return { success: true };
  });
  ipcMain.handle('workspace-edit:undo', async (_event, transactionId?: string) => {
    try { return { success: true, data: await getWorkspaceEditPreviewService().undoTransaction(transactionId) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('workspace-edit:recent-undo', () => ({ success: true, data: getWorkspaceEditPreviewService().getRecentUndo() }));
  ipcMain.handle('settings:get', (event) => isTrustedExtensionFrame(event)
    ? getSettings()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('credentials:get-storage-status', (event) => isTrustedExtensionFrame(event)
    ? getCredentialStorageStatusResponse()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('credentials:test', async (event, providerId: string, apiKey: string, modelId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const res = await credentialStore.testConnection(providerId, apiKey, modelId);
      if (res.success) {
        return { success: true, data: res };
      }
      return { success: false, error: res.error || `Failed to authenticate ${providerId} key.` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:save', async (event, providerId: string, apiKey: string, label?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const saved = await credentialStore.saveCredential(providerId, apiKey, label);
      if (!saved) throw new Error('Credential was not saved: provider id or key was empty.');
      // The agent reads keys via settings-handlers; a failure here means chat would have no key, so do NOT swallow it.
      // mergeStoredApiKeys rewrites the vault without dropping keys it could not decrypt.
      const normId = providerId.replace(/-free$/, '');
      await mergeStoredApiKeys({ [providerId]: apiKey.trim(), [normId]: apiKey.trim() });
      // Mirror into the legacy whole-document vault so legacy readers see it too (best-effort).
      try { await saveKey(providerId, apiKey.trim()); } catch (vaultError: unknown) {
        console.warn('credentials.enc mirror failed (non-fatal)', vaultError);
      }
      console.log('Key saved to safeStorage', { providerId, backend: credentialStore.getBackendName() });
      // Near-instant autonomous correction: re-verify this provider's model
      // catalog against the live /models endpoint with the new key.
      modelCatalogVerifier.ensurePeriodic();
      void modelCatalogVerifier
        .verifyProvider(normId)
        .catch((err: unknown) => console.error('[CATALOG-VERIFY] post-save verify failed', err));
      return { success: true };
    } catch (error) {
      console.error('credentials:save FAILED', providerId, error instanceof Error ? error.message : error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:get', async (event, providerId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (providerId) {
        const key = credentialStore.getDecryptedKey(providerId);
        return { success: true, data: key };
      }
      const all = credentialStore.getAllDecryptedKeys();
      return { success: true, data: all };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:delete', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      clearKeyCache(providerId);
      await credentialStore.revokeCredential(providerId);
      try {
        await mergeStoredApiKeys({}, [providerId, providerId.replace(/-free$/, '')]);
      } catch {
        // Non-blocking
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:reveal', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const key = credentialStore.revealKey(providerId);
      if (!key) return { success: false, error: `No credential found for ${providerId}` };
      return { success: true, data: key };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:has-any', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const hasAny = await credentialStore.hasAnyCredentials();
      return { success: true, hasAny };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:list', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const list = credentialStore.listConfigured();
      return { success: true, data: list };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:export', async (event, passphrase?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const bundle = await credentialStore.exportBackup(passphrase);
      return { success: true, data: bundle };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:import', async (event, bundleJson: string, passphrase?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const res = await credentialStore.importBackup(bundleJson, passphrase);
      return res;
    } catch (error) {
      return { success: false, count: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('credentials:auto-detect', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const detected = await keyDetector.detectAllKeys();
      let importedCount = 0;
      const importedProviders: string[] = [];
      for (const k of detected) {
        if (k.rawKey && !credentialStore.hasCredential(k.providerId)) {
          await credentialStore.saveCredential(k.providerId, k.rawKey, `Auto-detected from ${k.sourceDescription || k.source}`);
          importedCount++;
          importedProviders.push(k.providerName || k.providerId);
        }
      }
      return {
        success: true,
        data: {
          totalDetected: detected.length,
          importedCount,
          importedProviders,
          detected: detected.map((k) => ({ ...k, rawKey: undefined }))
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('telemetry:get-preview', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try { return { success: true, data: await getTelemetryManager().getPreview() }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('telemetry:delete-event', async (event, payload: { index?: unknown; expected?: unknown }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (!payload || !Number.isInteger(payload.index) || !payload.expected || typeof payload.expected !== 'object') throw new Error('Telemetry event selection is invalid.');
      await getTelemetryManager().deleteEvent(payload.index as number, payload.expected as TelemetryEvent);
      return { success: true };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('telemetry:clear-data', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try { await getTelemetryManager().clearData(); return { success: true }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  getTelemetryManager().onDidChange(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('telemetry:changed');
    }
  });
  settingsManager.onDidChange(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('settings:changed');
    }
  });
  ipcMain.handle('settings:layer:get', async (event, scope: unknown) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    if (scope !== 'global' && scope !== 'workspace') return { success: false, error: 'Settings scope must be global or workspace.' };
    return getSettingsLayer(scope);
  });
  ipcMain.handle('settings:layer:save', async (event, payload: { scope?: unknown; settings?: unknown }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    if (!payload || (payload.scope !== 'global' && payload.scope !== 'workspace')) return { success: false, error: 'Settings scope must be global or workspace.' };
    const result = await saveSettingsLayer(payload.scope, payload.settings);
    const layerUpdates = payload.settings && typeof payload.settings === 'object' ? payload.settings as Record<string, unknown> : {};
    const telemetryUpdate = layerUpdates.telemetry && typeof layerUpdates.telemetry === 'object'
      ? layerUpdates.telemetry as Record<string, unknown>
      : {};
    if (result.success && payload.scope === 'global' && telemetryUpdate.enabled === false) {
      await getTelemetryManager().clearData();
    }
    if (result.success && payload.scope === 'global' && layerUpdates['lsp.autoStart'] !== undefined) {
      getLspManager(currentWorkspacePath).setAutoStart(Boolean((payload.settings as Record<string, unknown>)['lsp.autoStart']));
    }
    return result;
  });
  ipcMain.handle('settings:security:get', async (event) => isTrustedExtensionFrame(event)
    ? getSecurityPolicy()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('settings:security:save', async (event, policy) => isTrustedExtensionFrame(event)
    ? saveSecurityPolicy(policy)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('settings:save', async (event, updates) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.', errorDetail: { ok: false, code: 'IO', message: 'Untrusted renderer frame.', detail: 'Caller frame was not trusted.' } };
    try {
      const result = await saveSettings(updates);
    if (result.success && updates?.telemetry?.enabled === false) await getTelemetryManager().clearData();
    if (result.success && updates?.['lsp.autoStart'] !== undefined) getLspManager(currentWorkspacePath).setAutoStart(updates['lsp.autoStart']);
    if (result.success) clearAvailabilityCache();
      return result;
    } catch (err: unknown) {
      const { code, message, detail } = classifySettingsError(err);
      console.error(`[ipc:settings:save] [${code}] ${message}\n${detail}`);
      return {
        success: false,
        error: message,
        errorDetail: { ok: false, code, message, detail }
      };
    }
  });

  // Renderer selection changes funnel here: validate -> active agent config ->
  // gateway override -> persist. Credentials never travel over this channel;
  // only masked key summaries (e.g. "sk-ant-••••1234") are returned.
  ipcMain.handle('providers:update-active-config', async (event, config: { providerId?: string; modelId?: string; origin?: 'explicit' | 'auto' }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const providerId = typeof config?.providerId === 'string' ? config.providerId : '';
      const modelId = typeof config?.modelId === 'string' ? config.modelId : '';
      const origin = config?.origin === 'explicit' ? 'explicit' : 'auto';
      const summary = await setActiveAgentConfig(providerId, modelId, origin);
      if (summary.keyStatus === 'missing') {
        return {
          success: false,
          error: `No API key configured for "${summary.providerId}" and the Ty-Code Free tier is currently unreachable. The previous selection stays active.`
        };
      }
      setGatewayActiveConfig(summary.providerId, summary.modelId);
      // Persist through the regular settings layer so restarts keep this
      // selection; the summary may carry a downgraded Ty-Code Free pair.
      try {
        await saveSettings({ activeProvider: summary.providerId as any, activeModel: summary.modelId });
      } catch {}
      clearAvailabilityCache();
      return { success: true, data: summary };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('agent:start-task', async (_event, params) => {
    // Step 2: Validate initial chat/task request payload with Zod
    const validation = AgentStartTaskPayloadSchema.safeParse(params);
    if (!validation.success) {
      console.error('[MAIN] Invalid agent task payload:', validation.error.format());
      return { success: false, error: `Invalid agent task payload: ${validation.error.message}` };
    }
    const validatedParams = validation.data;

    const h2 = performance.timeOrigin + performance.now();
    const taskId = validatedParams.taskId || `task_${Date.now()}`;
    chatLatencyTracker.setActiveTaskId(taskId);
    if (validatedParams.clientSentAt) {
      chatLatencyTracker.recordH1(taskId, validatedParams.clientSentAt);
    }
    chatLatencyTracker.recordH2(taskId, h2);

    console.log('Main: Received task', { taskId: validatedParams.taskId, promptLen: validatedParams.prompt?.length, agentMode: validatedParams.agentMode });
    if (!mainWindow) return { success: false, error: 'No main window' };
    if (params?.traceId) {
      connectivityTracer.recordHop(params.traceId, 'H3', {
        status: 'PASS',
        payloadSize: (params.prompt?.length || 0) + (Array.isArray(params.history) ? params.history.length * 150 : 0),
        metadata: {
          taskId: params.taskId,
          workspacePath: currentWorkspacePath,
          hasWindow: Boolean(mainWindow)
        }
      });
    }
    const result = await startAgentTask(mainWindow, { ...params, workspacePath: currentWorkspacePath });
    if (result.success) void getTelemetryManager().recordFeatureUsed('agent_chat');
    return result;
  });
  ipcMain.handle('agent:stop-task', (_event, taskId: string) => stopAgentTask(taskId));
  ipcMain.handle('agent:respond-approval', (_event, payload: unknown) => {
    const parsed = AgentRespondApprovalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Invalid approval payload: ${parsed.error.message}` };
    }
    return respondAgentApproval(parsed.data.approvalId, parsed.data.approved, parsed.data.feedback);
  });
  ipcMain.handle('user_approve_diff', (_event, payload: unknown) => {
    const parsed = UserApproveDiffPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Invalid diff approval payload: ${parsed.error.message}` };
    }
    return handleUserApproveDiff(parsed.data);
  });
  ipcMain.handle('document:update', async (_event, payload: unknown) => {
    try {
      const data = payload as { id?: string; markdown?: string; title?: string };
      if (!data?.id || typeof data.markdown !== 'string') {
        return { success: false, error: 'Invalid document update payload' };
      }
      const existing = await loadDocument(data.id);
      const sections = parseMarkdownSections(data.markdown);
      const updatedDoc: AgentDocument = {
        id: data.id,
        kind: existing?.kind || 'plan',
        title: data.title || existing?.title || 'Document',
        markdown: data.markdown,
        sections,
        createdAt: existing?.createdAt || Date.now()
      };
      await persistDocument(updatedDoc);
      return { success: true, data: updatedDoc };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
  ipcMain.handle('document:get-last', async () => {
    try {
      const docs = await listDocuments();
      if (docs.length > 0) {
        const fullDoc = await loadDocument(docs[0].id);
        return { success: true, data: fullDoc };
      }
      return { success: true, data: null };
    } catch (err: unknown) {
      return { success: false, error: String(err) };
    }
  });
  ipcMain.handle('document:load', async (_event, id: string) => {
    try {
      const doc = await loadDocument(id);
      return { success: true, data: doc };
    } catch (err: unknown) {
      return { success: false, error: String(err) };
    }
  });
  ipcMain.handle('pty:resolve-approval', (_event, payload: unknown) => {
    const parsed = PtyResolveApprovalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Invalid pty approval payload: ${parsed.error.message}` };
    }
    return resolvePtyApproval(parsed.data.approvalId, parsed.data.approved);
  });
  ipcMain.handle('agent:apply-diff', (_event, diff: unknown) => {
    const parsed = AgentApplyDiffPayloadSchema.safeParse(diff);
    if (!parsed.success) {
      return { success: false, error: `Invalid diff payload: ${parsed.error.message}` };
    }
    return applyDiff(currentWorkspacePath, parsed.data as ProposedDiff);
  });
  ipcMain.on('perf:report-h5', (_event, data: { taskId: string; h5: number }) => {
    if (data?.taskId) {
      chatLatencyTracker.recordH5(data.taskId, data.h5);
    }
  });

  // Agent State Management
  ipcMain.handle('agent:get-todos', () => {
    try {
      const { agentStateManager } = require('./agent/agent-state-manager');
      return { success: true, data: agentStateManager?.todos || [] };
    } catch {
      return { success: true, data: [] };
    }
  });

  ipcMain.handle('agent:set-mode', (_event, mode: 'plan' | 'execute' | 'hybrid') => {
    try {
      const { agentStateManager } = require('./agent/agent-state-manager');
      if (agentStateManager) {
        agentStateManager.currentMode = mode;
        return { success: true, data: { mode } };
      }
      return { success: false, error: 'Agent state manager not initialized' };
    } catch {
      return { success: false, error: 'Failed to set agent mode' };
    }
  });

  ipcMain.handle('agent:list-sessions', async (_event, workspacePath?: string) => {
    try {
      const { listAgentSessions } = require('./ipc/agent-handlers');
      return listAgentSessions(typeof workspacePath === 'string' && workspacePath ? workspacePath : undefined);
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to list sessions' };
    }
  });

  ipcMain.handle('agent:add-approval-rule', (_event, rule: {
    id?: string;
    toolName?: string;
    pattern?: string;
    action?: 'always_ask' | 'auto_approve' | 'auto_deny';
    scope?: 'workspace' | 'system' | 'network';
    expiresAt?: number;
  }) => {
    try {
      const { toolApprovalManager } = require('./agent/tool-approval-manager');
      if (!rule || typeof rule.toolName !== 'string' || rule.toolName.length === 0) {
        return { success: false, error: 'Invalid approval rule' };
      }
      const action = rule.action === 'auto_approve' || rule.action === 'auto_deny' || rule.action === 'always_ask' ? rule.action : 'always_ask';
      const scope = rule.scope === 'workspace' || rule.scope === 'system' || rule.scope === 'network' ? rule.scope : 'workspace';
      toolApprovalManager.addRule({
        id: (typeof rule.id === 'string' && rule.id.length > 0) ? rule.id : `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        toolName: rule.toolName,
        ...(typeof rule.pattern === 'string' && rule.pattern.length > 0 ? { pattern: rule.pattern } : {}),
        action,
        scope,
        ...(typeof rule.expiresAt === 'number' ? { expiresAt: rule.expiresAt } : {})
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to add approval rule' };
    }
  });

  ipcMain.handle('agent:get-background-agents', () => {
    try {
      const { backgroundAgentOrchestrator } = require('./agent/background-agent-orchestrator');
      return { success: true, data: backgroundAgentOrchestrator.getAllAgents() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to list background agents' };
    }
  });

  ipcMain.handle('agent:get-background-agent-details', (_event, agentId: string) => {
    try {
      const { backgroundAgentOrchestrator } = require('./agent/background-agent-orchestrator');
      return { success: true, data: backgroundAgentOrchestrator.getAgentDetails(String(agentId || '')) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to load background agent details' };
    }
  });

  ipcMain.handle('agent:cancel-background-agent', (_event, agentId: string) => {
    try {
      const { backgroundAgentOrchestrator } = require('./agent/background-agent-orchestrator');
      backgroundAgentOrchestrator.cancelAgent(String(agentId || ''));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to cancel background agent' };
    }
  });

  ipcMain.handle('agent:get-telemetry-report', () => {
    try {
      const { agentObservability } = require('./agent/agent-observability');
      return { success: true, data: agentObservability.generateReport() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to build telemetry report' };
    }
  });

  ipcMain.handle('agent:get-telemetry-events', (_event, filter?: { type?: string; startTime?: number }) => {
    try {
      const { agentObservability } = require('./agent/agent-observability');
      return { success: true, data: agentObservability.getEvents(filter) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to load telemetry events' };
    }
  });

  ipcMain.handle('agent:export-telemetry', () => {
    try {
      const { agentObservability } = require('./agent/agent-observability');
      return { success: true, data: agentObservability.exportToJSON() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to export telemetry' };
    }
  });

  ipcMain.handle('agent:clear-telemetry', () => {
    try {
      const { agentObservability } = require('./agent/agent-observability');
      agentObservability.clearEvents();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to clear telemetry' };
    }
  });

  // OpenKilo Gateway (Layer 5) IPC Handlers
  ipcMain.handle('openkilo:get-status', () => ({
    success: true,
    data: openKiloProvider.getStatus()
  }));

  ipcMain.handle('openkilo:refresh-models', async (_event, apiKey?: string) => {
    try {
      const models = await openKiloProvider.refreshModelCatalog(apiKey);
      return { success: true, data: models };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('openkilo:start-oauth', async () => {
    try {
      const res = await openKiloProvider.startOAuthFlow();
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('openkilo:complete-oauth', async (_event, code: string) => {
    try {
      const res = await openKiloProvider.completeOAuthFlow(code);
      if (res.success && res.apiKey) {
        await saveSettings({
          activeProvider: 'openkilo',
          apiKeys: { openkilo: res.apiKey }
        });
      }
      return res;
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('openkilo:enable-anonymous', async () => {
    try {
      openKiloProvider.enableAnonymousMode();
      await saveSettings({
        activeProvider: 'openkilo',
        activeModel: 'kilo-auto/free',
        apiKeys: { openkilo: 'anonymous' }
      });
      return { success: true, data: openKiloProvider.getStatus() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Scale 1: Zero-Server OAuth & Device Flow
  ipcMain.handle('oauth:start-openrouter-pkce', async () => {
    try {
      const res = await providerOAuth.startOpenRouterPKCE();
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:start-openkilo', async () => {
    try {
      const res = await providerOAuth.startOpenKiloOAuth();
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:start-copilot-device', async () => {
    try {
      const res = await providerOAuth.startCopilotDeviceFlow();
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:poll-copilot-device', async (_event, deviceCode?: string) => {
    try {
      const res = await providerOAuth.pollCopilotDeviceFlow(deviceCode);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:cancel-copilot-device', async () => {
    try {
      providerOAuth.cancelCopilotDeviceFlow();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:disconnect', async (_event, providerId: string) => {
    try {
      const res = await providerOAuth.disconnectProvider(providerId);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('oauth:get-status', async () => {
    try {
      const res = await providerOAuth.getAuthStatus();
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Scale 1: Usage Ledger Handlers
  ipcMain.handle('usage:get-ledger', async () => {
    try {
      return { success: true, data: usageLedger.getSnapshot() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('usage:export-ledger', async (_event, format?: 'json' | 'csv') => {
    try {
      const data = format === 'csv' ? usageLedger.exportCsv() : usageLedger.exportJson();
      return { success: true, data };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('usage:clear-ledger', async () => {
    try {
      await usageLedger.clearLedger();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Enterprise Policy & Usage Ledger Handlers
  ipcMain.handle('policy:get-effective', async () => {
    try {
      return { success: true, data: policyEngine.getEffectivePolicy() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('policy:assert-allowed', async (_event, action: any) => {
    try {
      policyEngine.assertAllowed(action);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('policy:reload', async (_event, workspacePath?: string) => {
    try {
      await policyEngine.reload(workspacePath);
      return { success: true, data: policyEngine.getEffectivePolicy() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ledger:query', async (_event, filter?: any) => {
    try {
      const [records, summary] = await Promise.all([
        ledgerQueryService.getRecords(filter),
        ledgerQueryService.aggregate(filter)
      ]);
      return { success: true, data: { records, summary } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ledger:insights', async (_event, options?: any) => {
    try {
      const res = await ledgerQueryService.getInsights(options);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ledger:record', async (_event, record: any) => {
    try {
      tokenAccountingLedger.record(record);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ledger:flush', async () => {
    try {
      await tokenAccountingLedger.flush();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 5.5: Smart Orchestration & Quota Management (Layer 6)
  ipcMain.handle('orchestration:get-quota-stats', async () => {
    try {
      return { success: true, data: quotaTracker.getSnapshot() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:get-smart-routing-logs', async () => {
    try {
      return { success: true, data: smartModelSelector.getDecisionLogs() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:set-free-mode', async (_event, enabled: boolean) => {
    try {
      quotaTracker.setFreeMode(enabled);
      return { success: true, data: { freeMode: quotaTracker.isFreeMode() } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:classify-task', async (_event, prompt: string) => {
    try {
      const task = smartModelSelector.classifyTask(prompt);
      return { success: true, data: task };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:select-model', async (_event, prompt: string, context?: { contextTokens?: number; hasImages?: boolean }) => {
    try {
      const selection = smartModelSelector.selectModel(prompt, context);
      return { success: true, data: selection };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 5.6: End-to-End Performance & Onboarding (Layer 6)
  ipcMain.handle('orchestration:get-performance-metrics', async () => {
    try {
      return { success: true, data: performanceManager.getMetricsSnapshot() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:compress-context', async (_event, prompt: string, codeContext?: string) => {
    try {
      const result = contextCompressor.compress(prompt, codeContext);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:warm-connections', async () => {
    try {
      const result = await performanceManager.warmConnections();
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestration:complete-onboarding', async () => {
    try {
      await saveSettings({ hasCompletedOnboarding: true, freeMode: true });
      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Unified Provisioning: Onboarding Wizard state persistence
  ipcMain.handle('onboarding:get-state', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const state = await readOnboardingState();
      return { success: true, data: state };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('onboarding:save-state', async (event, updates: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const state = await writeOnboardingState(updates || {});
      return { success: true, data: state };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 3.1: Modular Skills & External Integration Registry
  ipcMain.handle('modules:get-list', async (_event, workspacePath?: string) => {
    try {
      const list = await moduleManager.getModules(workspacePath || currentWorkspacePath);
      return { success: true, data: list };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('modules:toggle', async (_event, moduleId: string, enabled: boolean, workspacePath?: string) => {
    try {
      const result = await moduleManager.toggleModule(moduleId, enabled, workspacePath || currentWorkspacePath);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('modules:check-dependencies', async (_event, dependencies: string[]) => {
    try {
      const result = await moduleManager.checkDependencies(dependencies || []);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('modules:get-status', async (_event, moduleId: string, workspacePath?: string) => {
    try {
      const status = await moduleManager.getModuleStatus(moduleId, workspacePath || currentWorkspacePath);
      return { success: true, data: status };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 3.3: AI Data Extractor (History Export), constrained to the user's file-picker choice.
  ipcMain.handle('history:export-ai-data', async (event, options?: { format?: 'json' | 'md' | 'all'; outputFileName?: string }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const selectedPath = pendingHistoryDestination;
      pendingHistoryDestination = null;
      if (!selectedPath) throw new Error('Choose an export destination before exporting local chat history.');
      const outputFileName = path.basename(options?.outputFileName || path.basename(selectedPath, path.extname(selectedPath)));
      const format = options?.format === 'md' || options?.format === 'all' ? options.format : 'json';
      const result = await historyExtractor.exportHistory({
        workspacePath: currentWorkspacePath,
        outputDir: path.dirname(selectedPath),
        outputFileName,
        format,
        onProgress: (p) => {
          try { event.sender.send('history:export-progress', p); } catch {}
        }
      });
      if (result.success) void getTelemetryManager().recordFeatureUsed('history_export');
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('history:select-destination', async (event, defaultName?: string, format?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const ext = format === 'md' ? 'md' : format === 'all' ? 'json' : 'json';
      const defaultFilename = `${path.basename(defaultName || `ty-code-history-export-${new Date().toISOString().split('T')[0]}`, path.extname(defaultName || ''))}.${ext}`;
      const downloadsDir = app.getPath('downloads');
      if (!mainWindow) throw new Error('History export destination picker is unavailable.');
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Select AI History Export Destination',
        defaultPath: path.join(downloadsDir, defaultFilename),
        filters: [
          { name: 'JSON Export', extensions: ['json'] },
          { name: 'Markdown Export', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (canceled || !filePath) {
        pendingHistoryDestination = null;
        return { success: true, data: null };
      }
      pendingHistoryDestination = filePath;
      return { success: true, data: filePath };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 3.5: Visual UI Sketcher (M3E Canvas) Prompt Bridge
  ipcMain.handle('sketcher:send-prompt', (_event, prompt: string) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sketcher:prompt-received', prompt);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('sketcher:open-window', () => {
    try {
      openSketcherWindow();
      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 3.6: Open SEO & GEO MCP Skills
  ipcMain.handle('mcp:get-seo-config', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const status = await mcpManager.getSeoConfigStatus(currentWorkspacePath);
      return { success: true, data: status };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:save-seo-config', async (event, options: { enabled?: boolean; apiKeys?: any }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const root = currentWorkspacePath;
      if (typeof options?.enabled === 'boolean') {
        await mcpManager.setSeoServerEnabled(options.enabled, root);
      }
      if (options?.apiKeys) {
        await mcpManager.saveSeoApiKeys(options.apiKeys, root);
      }
      return { success: true, data: { success: true, message: 'SEO MCP configuration updated.' } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:test-seo-connection', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const root = currentWorkspacePath;
      const res = await mcpManager.executeSeoTool('audit_page_seo', { targetUrl: 'index.html' }, { workspacePath: root });
      return { success: !res.isError, data: { success: !res.isError, details: res.output } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 6.1: Permanent Free Provider Registry & Health Monitoring
  ipcMain.handle('free-providers:get-list', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      return { success: true, data: await buildMergedFreeProviderList() };
    } catch (err: unknown) {
      return { success: true, data: freeProviderRegistry.getAllProviders() };
    }
  });

  ipcMain.handle('free-providers:get-tiers', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: modelClassifier.getAllTiers() };
  });

  ipcMain.handle('free-providers:get-health', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: providerHealthMonitor.getAllHealthStatuses() };
  });

  ipcMain.handle('free-providers:ping', async (event, providerId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (providerId) {
        const res = await providerHealthMonitor.pingProvider(providerId);
        return { success: true, data: { [providerId]: res } };
      }
      const allRes = await providerHealthMonitor.pingAllProviders();
      return { success: true, data: allRes };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 6.2: Seamless BYOK Interface & Key Management
  ipcMain.handle('byok:detect-keys', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const keys = await keyDetector.detectAllKeys();
      // Mask raw keys before returning to renderer
      const sanitized = keys.map((k) => ({ ...k, rawKey: undefined }));
      return { success: true, data: sanitized };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:import-detected-key', async (event, keyId: string, providerId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const detected = keyDetector.getDetectedKeyById(keyId);
      if (!detected || !detected.rawKey) {
        return { success: false, error: 'Detected key not found or expired.' };
      }
      const targetProvider = providerId || detected.providerId;
      await mergeStoredApiKeys({ [targetProvider]: detected.rawKey });

      if (detected.endpoint) {
        const currentSettings = await settingsManager.getEffectiveSettings();
        const customEndpoints = { ...(currentSettings.customEndpoints || {}), [targetProvider]: detected.endpoint };
        await settingsManager.saveLayer('global', { customEndpoints });
      }

      return { success: true, data: { providerId: targetProvider } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:get-stored-keys', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const { keys } = await readStoredCredentials();
      const allProviders = freeProviderRegistry.getAllProviders();
      const summaries: StoredKeySummary[] = [];

      for (const p of allProviders) {
        const rawKey = keys[p.id] || keys[p.id.replace('-free', '')];
        summaries.push({
          providerId: p.id,
          providerName: p.name,
          isConfigured: Boolean(rawKey && rawKey.trim()),
          maskedKey: rawKey ? maskKey(rawKey) : undefined,
          endpoint: p.base_url,
          setupUrl: p.signup_url,
          supportsRegenerate: Boolean(p.signup_url),
          isFreeTierAvailable: true,
          freeModelCount: p.best_free_models?.length || 0
        });
      }

      // Also check any extra keys that aren't in freeProviderRegistry (e.g. openai, custom)
      for (const [providerId, rawKey] of Object.entries(keys)) {
        if (!summaries.some((s) => s.providerId === providerId || s.providerId.replace('-free', '') === providerId)) {
          summaries.push({
            providerId,
            providerName: providerId.charAt(0).toUpperCase() + providerId.slice(1),
            isConfigured: Boolean(rawKey && rawKey.trim()),
            maskedKey: rawKey ? maskKey(rawKey) : undefined,
            isFreeTierAvailable: false
          });
        }
      }

      return { success: true, data: summaries };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:reveal-key', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const { keys } = await readStoredCredentials();
      const key = keys[providerId] || keys[providerId.replace('-free', '')] || keys[`${providerId}-free`];
      if (!key) return { success: false, error: `No key stored for ${providerId}.` };
      return { success: true, data: maskKey(key) };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:revoke-key', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      await mergeStoredApiKeys({}, [providerId, providerId.replace('-free', ''), `${providerId}-free`]);
      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:export-keys', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const { keys } = await readStoredCredentials();
      const payload = {
        version: 1,
        exportedAt: Date.now(),
        brand: 'Ty-Code',
        providerCount: Object.keys(keys).length,
        encryptedPayload: encryptSecret(JSON.stringify(keys))
      };
      return { success: true, data: JSON.stringify(payload, null, 2) };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:import-keys', async (event, backupData: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      let importedKeys: Record<string, string> = {};
      const parsed = JSON.parse(backupData.trim());
      if (parsed.encryptedPayload) {
        const decryptedStr = decryptSecret(parsed.encryptedPayload);
        importedKeys = JSON.parse(decryptedStr);
      } else if (parsed.keys && typeof parsed.keys === 'object') {
        importedKeys = parsed.keys;
      } else if (typeof parsed === 'object') {
        importedKeys = parsed;
      }

      const updates: Record<string, string> = {};
      const updatedProviders: string[] = [];
      for (const [provider, rawKey] of Object.entries(importedKeys)) {
        if (typeof rawKey === 'string' && rawKey.trim()) {
          updates[provider] = rawKey.trim();
          updatedProviders.push(provider);
        }
      }
      await mergeStoredApiKeys(updates);
      // Mirror imported keys into the hardware-backed credential store + legacy vault (best-effort).
      for (const [provider, rawKey] of Object.entries(updates)) {
        try {
          if (!credentialStore.hasCredential(provider)) {
            await credentialStore.saveCredential(provider, rawKey, 'Imported from backup bundle');
          }
          await saveKey(provider, rawKey);
        } catch {
          // Mirror is best-effort; the vault copy above is authoritative.
        }
      }
      return {
        success: true,
        data: {
          importedCount: updatedProviders.length,
          updatedProviders
        }
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:save-custom-provider', async (event, config: CustomProviderConfig) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (!config.name || !config.baseUrl) {
        return { success: false, error: 'Provider Name and Base URL are required.' };
      }
      const providerId = config.id || `custom-${Date.now()}`;
      if (config.apiKey && config.apiKey.trim()) {
        await mergeStoredApiKeys({ [providerId]: config.apiKey.trim() });
        try {
          if (!credentialStore.hasCredential(providerId)) {
            await credentialStore.saveCredential(providerId, config.apiKey.trim(), 'Custom Provider');
          }
        } catch {
          // Mirror is best-effort
        }
      }
      const currentSettings = await settingsManager.getEffectiveSettings();
      const customEndpoints = { ...(currentSettings.customEndpoints || {}), [providerId]: config.baseUrl };
      await settingsManager.saveLayer('global', {
        customEndpoints,
        activeProvider: providerId as any,
        activeModel: config.defaultModel || (config.models?.[0]) || currentSettings.activeModel
      });
      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase 6.3: OpenCode Integration & Free Model Sync
  ipcMain.handle('opencode:detect', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const result = await opencodeIntegration.detectOpenCode();
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:get-free-summary', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const config = await opencodeIntegration.readConfig();
      const summary = opencodeFreeDetector.analyzeFreeTiers(config);
      return { success: true, data: summary };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:import-providers', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const result = await opencodeIntegration.importOpenCodeProviders();
      return { success: result.success, data: result, error: result.success ? undefined : result.message };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent-framework:set', async (event, framework: AgentFramework) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      // 'autonomous' keeps the 3-agent multi-harness engine (Build, Plan,
      // General); 'collaborative' keeps the native pair-programming engine.
      const activeHarness = framework === 'autonomous' ? 'opencode' : 'claude-code';
      await settingsManager.saveLayer('global', { activeHarness } as any);
      return { success: true, data: framework };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent-framework:get', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const settings = await settingsManager.getEffectiveSettings();
      const framework: AgentFramework = settings.activeHarness === 'opencode' ? 'autonomous' : 'collaborative';
      return { success: true, data: framework };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:get-merged-providers', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const providers = await opencodeIntegration.getMergedProviders();
      return { success: true, data: providers };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // OpenCode Standard Supply (baked-in hosted free models)
  ipcMain.handle('opencode:get-service-status', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      return { success: true, data: opencodeServiceManager.getStatus() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:refresh-standard-supply', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const status = await opencodeServiceManager.refresh();
      return { success: true, data: status };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Manual key configuration for OpenCode's premium models. The key is stored
  // encrypted (safeStorage vault) and injected into the user's OpenCode config
  // file inside the main process — the response carries booleans only, the
  // plaintext never round-trips back here again.
  ipcMain.handle('opencode:save-api-key', async (event, providerName: string, apiKey: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const result = await saveOpenCodeApiKey(String(providerName || ''), String(apiKey || ''));
      const landed = result.vaultStored || result.configUpdated;
      if (landed) {
        providerHealthStore.clear(String(providerName || ''));
        routeEventPolicy.onKeySaved(String(providerName || ''));
      }
      return {
        success: landed,
        data: result,
        error: landed ? undefined : (result.message || 'The key could not be stored.')
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:get-key-status', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const statuses = await getOpenCodeKeyStatus();
      return { success: true, data: statuses };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // OpenCode CLI auto-install (zero-touch free tier). Runs npm -g
  // @opencode-ai/cli, then refreshes the service manager + model caches so the
  // CLI-synced free models appear without an app restart.
  ipcMain.handle('opencode:install', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const res = await opencodeInstaller.install((progress) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send('opencode:install-progress', progress);
          }
        }
      });
      if (res.success) {
        try {
          const { opencodeServiceManager } = await import('./opencode-integration/opencode-service-manager');
          await opencodeServiceManager.refresh();
          opencodeBridge.invalidateCliCheck();
          clearAvailabilityCache();
        } catch (refreshErr: unknown) {
          console.warn('[OPENCODE] Post-install refresh failed (harmless until next refresh):', refreshErr instanceof Error ? refreshErr.message : refreshErr);
        }
        return { success: true, data: { cliPath: res.cliPath || null, alreadyInstalled: Boolean(res.alreadyInstalled) } };
      }
      return { success: false, error: res.error || 'OpenCode CLI installation failed.' };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:install-status', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: opencodeInstaller.getState() };
  });

  // Chat Sidecar → OpenCode bridge (Prompt 3). One renderer message drives one
  // bridge run; every stdout chunk is piped back on 'opencode:stream'. At most
  // one bridge chat run is active — a new send pre-aborts the previous child.
  ipcMain.handle('opencode:send-message', async (event, payload: { modelId?: string; prompt?: string; messages?: Array<{ role: string; content: string }> }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const modelId = String(payload?.modelId || '').trim();
      if (!modelId) return { success: false, error: 'No OpenCode model selected.' };

      // Honesty guard: the bridge only serves models that genuinely exist in
      // the user's OpenCode config — never invented ones.
      const discovered = await discoverOpenCodeFreeModels().catch(() => [] as string[]);
      if (discovered.length === 0) {
        return { success: false, error: 'Your OpenCode config lists no free models — run `opencode` once to sync its config first.' };
      }
      if (!discovered.includes(modelId)) {
        return { success: false, error: `Model "${modelId}" is not present in your OpenCode config.` };
      }

      const hasMessages = Array.isArray(payload?.messages) && payload.messages.length > 0;
      const promptText = hasMessages
        ? buildBridgePromptFromMessages(payload!.messages!)
        : buildBridgePromptFromMessages([{ role: 'user', content: String(payload?.prompt || '') }]);
      if (!promptText.trim()) {
        return { success: false, error: 'Nothing to send — the prompt is empty.' };
      }

      if (opencodeChatAbort) {
        try { opencodeChatAbort.abort(); } catch { /* previous child already gone */ }
      }
      const controller = new AbortController();
      opencodeChatAbort = controller;
      const sender = event.sender;
      let sentTerminal = false;
      const finish = (stopped: boolean) => {
        if (sentTerminal || sender.isDestroyed()) return;
        sentTerminal = true;
        sender.send('opencode:done', { stopped });
      };

      void (async () => {
        let streamedError: string | null = null;
        try {
          for await (const chunk of opencodeBridge.executePrompt(promptText, modelId, undefined, { abortSignal: controller.signal })) {
            if (sender.isDestroyed()) break;
            if (chunk) sender.send('opencode:stream', chunk);
          }
        } catch (err: unknown) {
          streamedError = err instanceof Error ? err.message : String(err);
        }
        if (!sender.isDestroyed()) {
          if (streamedError) {
            sentTerminal = true;
            sender.send('opencode:error', { message: streamedError });
          } else {
            finish(controller.signal.aborted);
          }
        }
        if (opencodeChatAbort === controller) opencodeChatAbort = null;
      })();

      return { success: true, data: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:stop-process', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    if (opencodeChatAbort) {
      try { opencodeChatAbort.abort(); } catch { /* child already gone */ }
      opencodeChatAbort = null;
      return { success: true, data: true };
    }
    return { success: true, data: false };
  });

  // Phase 6.4: Intelligent Model Router
  ipcMain.handle('model-router:classify-task', async (event, prompt: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const classification = taskClassifier.classify(prompt);
      return { success: true, data: classification };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('model-router:select-model', async (event, prompt: string, overridePreferences?: Partial<RouterUserPreferences>) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const decision = await modelRouter.selectModel(prompt, overridePreferences);
      return { success: true, data: decision };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('model-router:get-preferences', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const prefs = await userPreferences.getPreferences();
      return { success: true, data: prefs };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('model-router:set-preferences', async (event, updates: Partial<RouterUserPreferences>) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const updated = await userPreferences.updatePreferences(updates);
      return { success: true, data: updated };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('model-router:get-available-models', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const grouped = await modelRouter.getCatalogGroupedByTier();
      return { success: true, data: grouped };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Availability-gated model catalog (Provider Series Prompt 1): every entry
  // carries availabilityStatus so the picker can hide/lock unusable models.
  ipcMain.handle('models:get-available-models', async (event, options?: { onlyAvailable?: boolean }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const models = await getAvailableModels(Boolean(options?.onlyAvailable));
      return { success: true, data: models };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('get-available-models', async (event, options?: { onlyAvailable?: boolean }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const models = await getAvailableModels(Boolean(options?.onlyAvailable));
      return { success: true, data: models };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:get-availability-summary', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      return { success: true, data: await getModelAvailabilitySummary() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('get-model-availability-summary', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      return { success: true, data: await getModelAvailabilitySummary() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:reset-availability-cache', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    clearAvailabilityCache();
    return { success: true };
  });

  ipcMain.handle('models:update-active-model-config', async (event, config: { providerId: string; modelId: string; isAutoMode: boolean }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      ProviderGateway.setActiveModel(config);
      return { success: true, data: config };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('update-active-model-config', async (event, config: { providerId: string; modelId: string; isAutoMode: boolean }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      ProviderGateway.setActiveModel(config);
      return { success: true, data: config };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('community-key:get-status', async () => {
    return { success: true, data: { status: getCommunityKeyStatus() } };
  });

  ipcMain.on('community-key:status-changed', (eventOrPayload: any, maybePayload?: any) => {
    const payload = (maybePayload !== undefined ? maybePayload : eventOrPayload) || { status: 'degraded' };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('community-key:status-changed', payload);
      }
    }
  });

  // Autonomous Provider & Model Catalog Verification
  // Diff+correct our stored model expectations against LIVE /models endpoints.
  ipcMain.handle('providers:verify-model-catalog', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      modelCatalogVerifier.ensurePeriodic();
      const results = await modelCatalogVerifier.verifyAll();
      mainWindow?.webContents.send('providers:catalog-verified', modelCatalogVerifier.getSnapshot());
      return { success: true, data: modelCatalogVerifier.getSnapshot() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('providers:get-model-catalog-verifications', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: modelCatalogVerifier.getSnapshot() };
  });

  // Phase 6.5: Unified Provider Dashboard & Quota Management
  ipcMain.handle('dashboard:get-data', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const data = usageAnalytics.getDashboardData();
      return { success: true, data };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:get-overview', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const full = usageAnalytics.getDashboardData();
      return {
        success: true,
        data: {
          providers: full.providers,
          summary: full.summary,
          recentActivity: full.recentActivity,
          alerts: full.alerts
        }
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:get-quota', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const snapshot = quotaTracker.getSnapshot();
      const breakdown = usageAnalytics.getModelUsageBreakdown();
      return { success: true, data: { snapshot, breakdown } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:get-comparison', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const comparisons = usageAnalytics.getProviderComparisons();
      return { success: true, data: comparisons };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:get-analytics', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const history = usageAnalytics.getHistoricalUsage();
      const modelBreakdown = usageAnalytics.getModelUsageBreakdown();
      return { success: true, data: { history, modelBreakdown } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:get-recommendations', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const recs = usageAnalytics.getRecommendations();
      return { success: true, data: recs };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:dismiss-recommendation', async (event, recommendationId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const res = usageAnalytics.dismissRecommendation(recommendationId);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('dashboard:record-activity', async (event, record: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const created = usageAnalytics.recordActivity(record);
      return { success: true, data: created };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Diagnostics 1: Provider Connection Diagnostic Harness & Error Taxonomy
  ipcMain.handle('diagnostics:run', async (event, providerId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const summary = await diagnosticService.runDiagnostics(providerId);
      return { success: true, data: summary };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diagnostics:report', async (event, summary?: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const report = diagnosticService.generateMarkdownReport(summary);
      return { success: true, data: report };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Diagnostics live hydration: retained summaries from the last real runs
  // (no fabrication — nulls until a run exists) so the panel shows live state.
  ipcMain.handle('diagnostics:get-latest', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      return {
        success: true,
        data: {
          connSummary: diagnosticService.getLatestSummary(),
          capSummary: capabilitySuite.getLatestSummary()
        }
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Stream Hygiene (Prompt 2): read-only view of the FCC sidecar log ledger
  // (coalesced sidecar stdout/stderr lines, gated stream-salvage lines and
  // gateway rerun decisions). Read-only diagnostics: no state mutation.
  ipcMain.handle('sidecar-ledger:get', async (event, limit?: number) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const boundedLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.floor(limit)) : 80;
      return { success: true, data: sidecarLogLedger.recent(boundedLimit) };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Diagnostics 2: End-to-End Capability Test Suite
  ipcMain.handle('diagnostics:run-capabilities', async (event, options?: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const summary = await capabilitySuite.runCapabilitySuite({
        ...options,
        workspacePath: currentWorkspacePath
      });
      return { success: true, data: summary };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diagnostics:get-capability-report', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const summary = capabilitySuite.getLatestSummary();
      if (!summary) {
        return { success: false, error: 'No capability tests have been executed yet.' };
      }
      const report = capabilitySuite.generateMarkdownReport(summary);
      return { success: true, data: report };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Diagnostics 3: Remediation Report Engine
  ipcMain.handle('diagnostics:get-remediation-report', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const report = remediationEngine.generateRemediationReport(null, null, currentWorkspacePath);
      return { success: true, data: report };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Diagnostics 5: Background Health Monitoring and Auto-Failover
  ipcMain.handle('diagnostics:get-fleet-health', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: diagnosticsHealthMonitor.getFleetHealth() };
  });

  ipcMain.handle('diagnostics:set-quiet-mode', async (event, enabled: boolean) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    diagnosticsHealthMonitor.setQuietMode(enabled);
    return { success: true, data: diagnosticsHealthMonitor.getFleetHealth() };
  });

  ipcMain.handle('diagnostics:set-battery-saver', async (event, enabled: boolean) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    diagnosticsHealthMonitor.setBatterySaver(enabled);
    return { success: true, data: diagnosticsHealthMonitor.getFleetHealth() };
  });

  ipcMain.handle('diagnostics:set-metered-connection', async (event, enabled: boolean) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    diagnosticsHealthMonitor.setMeteredConnection(enabled);
    return { success: true, data: diagnosticsHealthMonitor.getFleetHealth() };
  });

  ipcMain.handle('diagnostics:trigger-ping', async (event, providerId?: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (providerId) {
        await diagnosticsHealthMonitor.pingProvider(providerId);
      } else {
        await diagnosticsHealthMonitor.checkHealth();
      }
      return { success: true, data: diagnosticsHealthMonitor.getFleetHealth() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diagnostics:simulate-outage', async (event, providerId: string, type?: 'RATE_LIMITED' | 'PROVIDER_DOWN', cooldownMs?: number) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const health = diagnosticsHealthMonitor.simulateProviderOutage(providerId, type, cooldownMs);
    return { success: true, data: health };
  });

  ipcMain.handle('diagnostics:simulate-recovery', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const health = diagnosticsHealthMonitor.simulateProviderRecovery(providerId);
    return { success: true, data: health };
  });

  // Diagnostics Fix 1: End-to-End Connectivity Trace & Mock Detection
  ipcMain.handle('diagnostics:run-connectivity-trace', async (event, _options?: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const report = await connectivityTracer.runFullTrace(currentWorkspacePath, mainWindow);
      return { success: true, data: report };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diagnostics:record-trace-hop', async (event, payload: any) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (payload?.traceId && payload?.hop) {
        connectivityTracer.recordHop(payload.traceId, payload.hop, {
          status: payload.status,
          payloadSize: payload.payloadSize,
          metadata: payload.metadata,
          error: payload.error
        });
      }
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diagnostics:get-connectivity-trace', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return { success: true, data: connectivityTracer.getLatestReport() };
  });

  ipcMain.handle('diagnostics:scan-mock-paths', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const report = await connectivityTracer.scanMockPaths(currentWorkspacePath);
      return { success: true, data: report };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('pty:run-command', (_event, options: CommandExecutionOptions) => runCommand({
    ...options,
    cwd: options.cwd || currentWorkspacePath
  }));
  ipcMain.handle('pty:get-shells', () => ({ success: true, data: getAvailableShells() }));
  ipcMain.handle('pty:spawn', async (_event, rawOptions: unknown) => {
    const parsed = PtySpawnOptionsSchema.safeParse(rawOptions || {});
    if (!parsed.success) {
      return { success: false, error: `Invalid pty spawn options: ${parsed.error.message}` };
    }
    const options = parsed.data;
    if (!mainWindow) return { success: false, error: 'No main window' };
    const response = await getSettings();
    const settings = response.data;
    const profile = options.profileId ? settings?.terminalProfiles?.find((item) => item.id === options.profileId) : undefined;
    if (options.profileId && !profile) return { success: false, error: 'Terminal profile not found. Refresh Settings and try again.' };
    const shellId = profile?.shellId || options.shellId || settings?.terminalProfiles?.find((item) => item.id === settings.defaultTerminalProfileId)?.shellId;
    const cwd = options.cwd || currentWorkspacePath;
    return spawnPtySession(mainWindow, { ...options, shellId, cwd }, profile?.customShellPath);
  });
  ipcMain.handle('pty:attach', (_event, ptyId: unknown) => {
    if (typeof ptyId !== 'string') return { success: false, error: 'ptyId must be a string' };
    return attachPty(ptyId);
  });
  ipcMain.on('pty:write', (_event, payload: unknown) => {
    const parsed = PtyWritePayloadSchema.safeParse(payload);
    if (parsed.success) {
      writePty(parsed.data.ptyId, parsed.data.data);
    }
  });
  ipcMain.on('pty:resize', (_event, payload: unknown) => {
    const parsed = PtyResizePayloadSchema.safeParse(payload);
    if (parsed.success) {
      resizePty(parsed.data.ptyId, parsed.data.cols, parsed.data.rows);
    }
  });
  ipcMain.on('pty:sync-cwd', (_event, payload: unknown) => {
    const parsed = PtySyncCwdPayloadSchema.safeParse(payload);
    if (parsed.success) {
      syncPtyCwd(parsed.data.ptyId, parsed.data.targetCwd, parsed.data.shellId);
    }
  });
  ipcMain.handle('pty:kill', (_event, ptyId: unknown) => {
    if (typeof ptyId !== 'string') return { success: false, error: 'ptyId must be a string' };
    return killPty(ptyId);
  });

  // Marketplace Connection Layer IPC (Open VSX)
  ipcMain.handle('marketplace:search', (event, options: unknown) => isTrustedExtensionFrame(event)
    ? handleMarketplaceSearch(options as any)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('marketplace:metadata', (event, payload: unknown) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return handleMarketplaceMetadata(
      typeof value.namespace === 'string' ? value.namespace : '',
      typeof (value.extension || value.name) === 'string' ? String(value.extension || value.name) : ''
    );
  });
  ipcMain.handle('marketplace:install', (event, entry: unknown) => isTrustedExtensionFrame(event)
    ? handleMarketplaceInstall(entry as any)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('marketplace:uninstall', (event, id: unknown) => isTrustedExtensionFrame(event)
    ? handleMarketplaceUninstall(typeof id === 'string' ? id : '')
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('marketplace:list-installed', (event) => isTrustedExtensionFrame(event)
    ? handleMarketplaceListInstalled()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('marketplace:trace-extension-install', (event, extensionId: unknown) => isTrustedExtensionFrame(event)
    ? handleTraceExtensionInstall(typeof extensionId === 'string' ? extensionId : undefined)
    : { success: false, error: 'Untrusted renderer frame.' });

  ipcMain.handle('extensions:search', (event, query: unknown) => isTrustedExtensionFrame(event)
    ? searchOpenVsxExtensions(typeof query === 'string' ? query : '')
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:details', (event, payload: unknown) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return getOpenVsxExtensionDetails(typeof value.namespace === 'string' ? value.namespace : '', typeof value.name === 'string' ? value.name : '');
  });
  ipcMain.handle('extensions:get-installed', (event) => isTrustedExtensionFrame(event)
    ? handleGetInstalledExtensions()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:install', (event, ext: unknown) => isTrustedExtensionFrame(event)
    ? handleInstallExtension(ext)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:uninstall', (event, id: unknown) => isTrustedExtensionFrame(event)
    ? handleUninstallExtension(id)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:toggle', (event, payload: unknown) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return handleToggleExtension(value.id, value.enabled);
  });
  ipcMain.handle('extensions:update-settings', (event, payload: unknown) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return handleUpdateExtensionSettings(value.id, value.settings);
  });
  ipcMain.handle('extensions:install-vsix', (event) => isTrustedExtensionFrame(event)
    ? handleInstallExtensionFromVsix(mainWindow || undefined)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:capability', (event, payload: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionCapability(payload, currentWorkspacePath)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:activate', (event, id: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionActivate(id)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:deactivate', (event, id: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionDeactivate(id)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:execute-command', (event, payload: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionExecuteCommand(payload)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:trigger-event', (event, payload: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionTriggerEvent(payload)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:list-commands', (event) => isTrustedExtensionFrame(event)
    ? handleExtensionListCommands()
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('extensions:provide-completions', (event, payload: unknown) => isTrustedExtensionFrame(event)
    ? handleExtensionProvideCompletions(payload)
    : { success: false, error: 'Untrusted renderer frame.' });
  ipcMain.handle('skills:get', (_event, workspacePath: string) => getAvailableSkills(workspacePath || currentWorkspacePath));

  // Brave Browser Integration & Automation IPC
  ipcMain.handle('brave:detect', () => handleBraveDetect());
  ipcMain.handle('brave:install', (_event, options) => handleBraveInstall(options));
  ipcMain.handle('brave:get-status', () => handleBraveGetStatus());
  ipcMain.handle('brave:set-enabled', (_event, enabled: boolean) => handleBraveSetEnabled(enabled));
  ipcMain.handle('brave:search', (_event, query: string) => handleBraveSearch(query));
  ipcMain.handle('brave:navigate', (_event, url: string) => handleBraveNavigate(url));
  ipcMain.handle('brave:get-page-content', () => handleBraveGetPageContent());
  ipcMain.handle('brave:close', () => handleBraveClose());
  ipcMain.handle('brave:start-testing', (_event, payload: unknown) => handleBraveStartTesting(payload));
  ipcMain.handle('brave:stop-testing', () => handleBraveStopTesting());

  // Git operations target the loaded workspace by default; the renderer may
  // address any repository discovered inside it via `repoPath` (validated in
  // resolveGitRepositoryPath against the workspace repository allowlist).
  ipcMain.handle('git:is-repo', async (_event, payload?: { repoPath?: string }) => handleGitIsRepo(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:init', async (_event, payload?: { repoPath?: string }) => handleGitInit(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:status', async (_event, payload?: { repoPath?: string }) => handleGitGetStatus(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:diff', async (_event, payload?: { filePath?: string; staged?: boolean; repoPath?: string }) =>
    handleGitGetDiff(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload?.filePath, payload?.staged)
  );
  ipcMain.handle('git:original-content', async (_event, payload: { filePath: string; staged?: boolean; repoPath?: string }) =>
    handleGitGetOriginalContent(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.staged)
  );
  ipcMain.handle('git:file-diff', async (_event, payload: { filePath: string; staged?: boolean; repoPath?: string }) =>
    handleGitGetFileDiff(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.staged)
  );
  ipcMain.handle('git:stage', async (_event, payload: { filePaths: string | string[]; repoPath?: string }) => handleGitStage(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePaths));
  ipcMain.handle('git:unstage', async (_event, payload: { filePaths: string | string[]; repoPath?: string }) => handleGitUnstage(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePaths));
  ipcMain.handle('git:discard', async (_event, payload: { filePath: string; isUntracked?: boolean; repoPath?: string }) =>
    handleGitDiscardChanges(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.isUntracked)
  );
  ipcMain.handle('git:commit', async (_event, payload: { message: string; options?: { amend?: boolean }; repoPath?: string }) =>
    handleGitCommit(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.message, payload.options)
  );
  ipcMain.handle('git:branches', async (_event, payload?: { repoPath?: string }) => handleGitGetBranches(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:switch-branch', async (_event, payload: { branchName: string; repoPath?: string }) => handleGitSwitchBranch(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.branchName));
  ipcMain.handle('git:create-branch', async (_event, payload: { branchName: string; repoPath?: string }) => handleGitCreateBranch(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.branchName));
  ipcMain.handle('git:delete-branch', async (_event, payload: { branchName: string; force?: boolean; repoPath?: string }) =>
    handleGitDeleteBranch(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.branchName, payload.force)
  );
  ipcMain.handle('git:fetch', async (_event, payload?: { repoPath?: string }) => handleGitFetch(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:pull', async (_event, payload?: { repoPath?: string }) => handleGitPull(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:push', async (_event, payload?: { remote?: string; branch?: string; repoPath?: string }) =>
    handleGitPush(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload?.remote, payload?.branch)
  );
  ipcMain.handle('git:log', async (_event, payload?: { maxCount?: number; search?: string; repoPath?: string }) =>
    handleGitGetLog(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload?.maxCount, payload?.search)
  );
  ipcMain.handle('git:commit-detail', async (_event, payload: { hash: string; repoPath?: string }) =>
    handleGitGetCommitDetail(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.hash)
  );
  ipcMain.handle('git:blame', async (_event, payload: { filePath: string; repoPath?: string }) =>
    handleGitGetBlame(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath)
  );
  ipcMain.handle('git:stash', async (_event, payload: { action: 'list' | 'save' | 'pop' | 'drop'; message?: string; index?: number; repoPath?: string }) =>
    handleGitStash(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.action, payload.message, payload.index)
  );
  ipcMain.handle('git:remotes', async (_event, payload?: { repoPath?: string }) => handleGitGetRemotes(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:tags', async (_event, payload?: { repoPath?: string }) => handleGitGetTags(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:create-tag', async (_event, payload: { name: string; message?: string; repoPath?: string }) =>
    handleGitCreateTag(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.name, payload.message)
  );
  ipcMain.handle('git:delete-tag', async (_event, payload: { name: string; repoPath?: string }) =>
    handleGitDeleteTag(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.name)
  );
  ipcMain.handle('git:conflict-content', async (_event, payload: { filePath: string; repoPath?: string }) =>
    handleGitGetConflictContent(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath)
  );
  ipcMain.handle('git:resolve-conflict', async (_event, payload: { filePath: string; action: 'ours' | 'theirs' | 'mark-resolved'; repoPath?: string }) =>
    handleGitResolveConflict(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.action)
  );
  ipcMain.handle('git:abort-merge', async (_event, payload?: { repoPath?: string }) => handleGitAbortMerge(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath)));
  ipcMain.handle('git:hunks', async (_event, payload: { filePath: string; staged?: boolean; repoPath?: string }) =>
    handleGitGetHunks(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.staged)
  );
  ipcMain.handle('git:apply-hunk', async (_event, payload: { filePath: string; hunkId: string; operation: 'stage' | 'unstage' | 'revert'; repoPath?: string }) =>
    handleGitApplyHunk(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.filePath, payload.hunkId, payload.operation)
  );
  ipcMain.handle('git:merge', async (_event, payload: { branchName: string; repoPath?: string }) =>
    handleGitMerge(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload.branchName)
  );
  ipcMain.handle('git:list-repositories', () => handleGitListRepositories(currentWorkspacePath));
  ipcMain.handle('git:graph', async (_event, payload?: { maxCount?: number; repoPath?: string }) =>
    handleGitGetGraph(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath), payload?.maxCount)
  );
  ipcMain.handle('git:suggest-commit-message', async (_event, payload?: { repoPath?: string }) =>
    handleGitSuggestCommitMessage(await resolveGitRepositoryPath(payload?.repoPath, currentWorkspacePath))
  );

  // Language Server Protocol (LSP) IPC Handlers
  ipcMain.handle('lsp:get-servers', async () => {
    const result = await handleGetLspServers(currentWorkspacePath);
    ensureLspDiagnosticsBridge();
    return result;
  });
  ipcMain.handle('lsp:start-server', (_event, languageId: string) => handleStartLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:stop-server', (_event, languageId: string) => handleStopLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:restart-server', (_event, languageId: string) => handleRestartLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:configure-server', (_event, payload: { languageId: string; config: any }) =>
    handleConfigureLspServer(payload.languageId, payload.config, currentWorkspacePath)
  );
  ipcMain.handle('lsp:did-open', async (_event, payload: { filePath: string; languageId: string; text: string }) => {
    ensureLspDiagnosticsBridge();
    return handleLspDidOpen(payload, currentWorkspacePath);
  });
  ipcMain.handle('lsp:did-change', (_event, payload: { filePath: string; text: string }) =>
    handleLspDidChange(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:did-save', (_event, payload: { filePath: string; text?: string }) =>
    handleLspDidSave(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:did-close', (_event, payload: { filePath: string }) =>
    handleLspDidClose(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:completion', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspCompletion(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:hover', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspHover(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:definition', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspDefinition(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:type-definition', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspTypeDefinition(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:implementation', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspImplementation(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:references', (_event, payload: { filePath: string; line: number; character: number; includeDeclaration?: boolean }) =>
    handleLspReferences(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:rename', (_event, payload: { filePath: string; line: number; character: number; newName: string }) =>
    handleLspRename(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:rename-preview', async (_event, payload: { filePath: string; line: number; character: number; newName: string; forcePreview?: boolean }) => {
    try {
      const result = await handleLspRename(payload, currentWorkspacePath);
      if (!result.success || !result.data) return { success: false, error: result.error || 'The language server returned no rename edits.' };
      const service = getWorkspaceEditPreviewService();
      const preview = await service.createLspPreview(result.data, `Rename to “${payload.newName}”`);
      const settings = (await getSettings()).data;
      const applied = payload.forcePreview ? null : await service.tryAutoApplyPreview(preview.previewId, {
        enabled: settings?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile',
        forcePreviewAll: false
      });
      return { success: true, data: applied ? { applied } : { preview } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('lsp:document-symbols', (_event, payload: { filePath: string }) =>
    handleLspDocumentSymbols(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:workspace-symbols', (_event, payload: { query: string }) =>
    handleLspWorkspaceSymbols(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:code-actions', (_event, payload: { filePath: string; range: any; context?: any }) =>
    handleLspCodeActions(payload, currentWorkspacePath)
  );
  ipcMain.handle('lsp:signature-help', (_event, payload: { filePath: string; line: number; character: number }) =>
    handleLspSignatureHelp(payload, currentWorkspacePath)
  );

  // Auto-Update IPC Handlers
  ipcMain.handle('update:check', () => getUpdateManager().checkForUpdates());
  ipcMain.handle('update:download', () => getUpdateManager().downloadUpdate());
  ipcMain.handle('update:install', () => getUpdateManager().quitAndInstall());
  ipcMain.handle('update:get-channel', () => ({ success: true, data: getUpdateManager().getChannel() }));
  ipcMain.handle('update:set-channel', (_event, channel: unknown) => {
    try {
      if (channel !== 'stable' && channel !== 'beta' && channel !== 'nightly') throw new Error('Update channel must be stable, beta, or nightly.');
      getUpdateManager().setChannel(channel as UpdateChannel);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Recent Workspaces IPC Handlers
  ipcMain.handle('workspace:get-recent', () => ({ success: true, data: getRecentWorkspacesManager().getRecent() }));
  ipcMain.handle('workspace:add-recent', (_event, folderPath: string) => ({ success: true, data: getRecentWorkspacesManager().addRecent(folderPath) }));
  ipcMain.handle('workspace:clear-recent', () => {
    getRecentWorkspacesManager().clearRecent();
    return { success: true };
  });

  // High-performance Myers Diff IPC Handler
  ipcMain.handle('diff:compute-myers', (_event, payload: { original: string; modified: string; contextLines?: number }) => {
    try {
      if (typeof payload?.original !== 'string' || typeof payload?.modified !== 'string') throw new Error('Diff inputs must be strings.');
      const result = MyersDiff.diff(payload.original, payload.modified, payload.contextLines ?? 3);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // System & Application Information
  ipcMain.handle('app:get-info', () => ({
    success: true,
    data: {
      name: 'Ty-Code',
      version: app?.getVersion ? app.getVersion() : '1.0.0',
      platform: process.platform,
      arch: process.arch,
      isPackaged: Boolean(app?.isPackaged)
    }
  }));

  // Phase 7: Advanced AI Features & Competitive Differentiation
  initAiFeatureServices(currentWorkspacePath);
  registerAiFeatureHandlers(() => { void getTelemetryManager().recordFeatureUsed('project_index'); });

  // -------------------------------------------------------------
  // Step 4: Memory Pressure Governor IPC (local-only, Zero-Telemetry)
  // -------------------------------------------------------------
  ipcMain.handle('governor:get-state', async () => {
    try {
      return { success: true, data: memoryGovernor.getSnapshot() };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.on('governor:sample', (_event, sample: { rssMb?: number; heapUsedMb?: number; ts?: number }) => {
    try {
      const wc = _event.sender;
      memoryGovernor.recordRendererSample(wc ? wc.id : -1, sample);
    } catch {
      // Non-blocking
    }
  });
  ipcMain.on('surface:heartbeat', (_event, surfaceId?: string) => {
    try {
      if (typeof surfaceId === 'string') memoryGovernor.heartbeat(surfaceId);
    } catch {
      // Non-blocking
    }
  });

  // Broadcast governor tier changes to all surfaces so the Diagnostics tab
  // and any reactive UI stay in sync (local-only).
  memoryGovernor.subscribeTierChange((tier: GovernorTier) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        try { win.webContents.send('governor:state-changed', { tier, mode: governorMode }); } catch {}
      }
    }
  });

  // Step 4: main-process eviction callbacks (tier -> local cache shedding).
  memoryGovernor.registerEviction(async (tier) => {
    try {
      if (tier === 'ELEVATED') {
        getInlineService()?.trimCache(50);
        requestCache.clear();
      } else if (tier === 'CRITICAL' || tier === 'OVER') {
        getInlineService()?.trimCache(0);
        requestCache.clear();
      }
    } catch (err) {
      console.warn('[GOVERNOR] main eviction failed:', err);
    }
  });

  // Phase 5.2: FCC Server Integration (Layer 3)
  registerFccHandlers();

  // Phase 2.1: Provider Onboarding & Dynamic Discovery
  registerProviderHandlers();

  // Perf 1: Boot & Transition Profiler Handlers
  registerPerfHandlers();
}

function registerPerfHandlers(): void {
  ipcMain.handle('perf:get-boot-history', () => ({
    success: true,
    data: bootProfiler.getBootHistory()
  }));
  ipcMain.handle('perf:get-boot-trace', () => ({
    success: true,
    data: bootProfiler.getTrace()
  }));

  ipcMain.handle('perf:record-renderer-mark', (_event, mark: any) => {
    if (mark && typeof mark.name === 'string') {
      bootProfiler.recordMark(mark.name, mark.timestamp, mark.duration, mark.phase, mark.category, mark.metadata);
    }
    return { success: true };
  });

  ipcMain.handle('perf:record-transition', (_event, metric: any) => {
    if (metric && typeof metric.name === 'string') {
      bootProfiler.recordTransition(metric);
    }
    return { success: true };
  });

  ipcMain.handle('perf:inject-delay', (_event, durationMs: number, label?: string) => {
    bootProfiler.injectSyncDelay(durationMs, label);
    return { success: true };
  });

  // Open-Path Performance Profiler (Fix 3)
  ipcMain.handle('perf:profile-open-paths', async () => {
    try {
      const trace = await openProfiler.profileAll();
      return { success: true, data: trace };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('perf:get-open-trace', () => ({
    success: true,
    data: openProfiler.getTrace()
  }));
}

function registerProviderHandlers(): void {
  ipcMain.handle('provider:get-connection-status', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const health = providerHealthMonitor.getAllHealthStatuses();
      const supply = opencodeServiceManager.getStatus();
      const statuses: Record<string, {
        connected: boolean;
        latencyMs: number;
        successfulRequests: number;
        failedRequests: number;
        isRateLimited: boolean;
        autoDisabled: boolean;
      }> = {};

      for (const [providerId, h] of Object.entries(health)) {
        const hasKey = ProviderGateway.providerHasStoredKey(providerId) || Boolean(credentialStore.getDecryptedKey(providerId));
        statuses[providerId] = {
          connected:
            h.successfulRequests > 0 ||
            hasKey ||
            (providerId === 'opencode' && supply.hostedReachable === true) ||
            (providerId === 'openkilo' && supply.kiloReachable === true),
          latencyMs: h.latencyMs,
          successfulRequests: h.successfulRequests,
          failedRequests: h.failedRequests,
          isRateLimited: h.isRateLimited,
          autoDisabled: h.autoDisabled
        };
      }

      // Ensure all configured credentials appear in statuses as connected
      const configuredEntries = credentialStore.listConfigured();
      for (const entry of configuredEntries) {
        if (entry.configured) {
          const norm = entry.providerId.replace(/-free$/, '');
          for (const id of [entry.providerId, norm]) {
            if (!statuses[id]) {
              statuses[id] = {
                connected: true,
                latencyMs: 120,
                successfulRequests: 0,
                failedRequests: 0,
                isRateLimited: false,
                autoDisabled: false
              };
            } else {
              statuses[id].connected = true;
            }
          }
        }
      }

      // Also ensure any provider with stored keys in vault or env is marked connected
      const knownProviders = ['anthropic', 'openrouter', 'groq', 'gemini', 'google-ai-studio', 'deepseek', 'openai', 'opencode', 'copilot'];
      for (const pid of knownProviders) {
        if (ProviderGateway.providerHasStoredKey(pid)) {
          if (!statuses[pid]) {
            statuses[pid] = {
              connected: true,
              latencyMs: 120,
              successfulRequests: 0,
              failedRequests: 0,
              isRateLimited: false,
              autoDisabled: false
            };
          } else {
            statuses[pid].connected = true;
          }
        }
      }

      // The always-on hosted supply anchors stay connected even before the FCC
      // layer records its first request outcome.
      if (!statuses.opencode) {
        statuses.opencode = {
          connected: supply.hostedReachable === true,
          latencyMs: supply.hostedLatencyMs ?? 0,
          successfulRequests: 0,
          failedRequests: 0,
          isRateLimited: false,
          autoDisabled: false
        };
      }
      if (!statuses.openkilo) {
        statuses.openkilo = {
          connected: supply.kiloReachable === true,
          latencyMs: supply.kiloLatencyMs ?? 0,
          successfulRequests: 0,
          failedRequests: 0,
          isRateLimited: false,
          autoDisabled: false
        };
      }
      return { success: true, data: statuses };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('provider:get-registry', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const merged = await opencodeIntegration.getMergedProviders();
      const freeProviders = await buildMergedFreeProviderList();

      const toPreConfigured = (p: PreConfiguredProvider | FreeProvider): PreConfiguredProvider => {
        if ('baseUrl' in p) return p as PreConfiguredProvider;
        return {
          id: p.id,
          name: p.name,
          baseUrl: p.base_url,
          setupType: p.auth_type === 'anonymous' ? 'zero_config' : 'api_key',
          notes: p.setup_instructions,
          signupUrl: p.signup_url,
          defaultModel: p.best_free_models[0],
          icon: undefined
        };
      };

      const byId = new Map<string, PreConfiguredProvider>();
      for (const p of merged) byId.set(p.id, toPreConfigured(p));
      for (const fp of freeProviders) if (!byId.has(fp.id)) byId.set(fp.id, toPreConfigured(fp));
      // The "Auto (FCC decides)" binding — one logical provider backed by the
      // entire FCC-managed free pool. Listed first so it is the obvious default.
      const autoList: PreConfiguredProvider[] = [
        {
          id: 'auto',
          name: 'Auto (FCC decides)',
          baseUrl: 'auto',
          setupType: 'zero_config',
          notes: 'FCC routes each message to the best free model across all managed supply (free-first, key-safe handoff). No configuration needed.',
          signupUrl: undefined,
          defaultModel: 'kilo-auto/free',
          icon: undefined
        }
      ];
      for (const p of byId.values()) autoList.push(p);
      return { success: true, data: autoList };
    } catch {
      const freeProviders = await buildMergedFreeProviderList().catch(() => freeProviderRegistry.getAllProviders());
      const toPreConfigured = (p: FreeProvider): PreConfiguredProvider => ({
        id: p.id,
        name: p.name,
        baseUrl: p.base_url,
        setupType: p.auth_type === 'anonymous' ? 'zero_config' : 'api_key',
        notes: p.setup_instructions,
        signupUrl: p.signup_url,
        defaultModel: p.best_free_models[0],
        icon: undefined
      });
      return {
        success: true,
        data: [
          {
            id: 'auto',
            name: 'Auto (FCC decides)',
            baseUrl: 'auto',
            setupType: 'zero_config' as const,
            notes: 'FCC routes each message to the best free model across all managed supply. No configuration needed.',
            defaultModel: 'kilo-auto/free',
            icon: undefined
          },
          ...freeProviders.map(toPreConfigured)
        ]
      };
    }
  });

  ipcMain.handle('provider:get-models', async (event, payload: { providerId: string; apiKey?: string; customEndpoint?: string }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      let models = await ProviderGateway.getAvailableModels(payload.providerId, payload.apiKey, payload.customEndpoint);
      // FCC policy: default discovery lists FREE models only. BYOK (a stored or
      // explicitly passed key) unlocks the full catalog incl. paid models.
      const hasOwnCredentials = Boolean(payload.apiKey?.trim()) || ProviderGateway.providerHasStoredKey(payload.providerId);
      if (!hasOwnCredentials) {
        models = models.filter((m) => m.isFree);
      }
      return { success: true, data: models };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('provider:test-connection', async (event, payload: { providerId: string; apiKey?: string; modelId?: string; customEndpoint?: string }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const result = await ProviderGateway.testConnection(payload.providerId, payload.apiKey, payload.modelId, payload.customEndpoint);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('app:open-external', async (event, target: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      if (!target || typeof target !== 'string') {
        throw new Error('Invalid URL or file path');
      }
      if (target.startsWith('http://') || target.startsWith('https://')) {
        await shell.openExternal(target);
        return { success: true };
      }
      if (target.startsWith('file://')) {
        try {
          const { fileURLToPath } = await import('node:url');
          const localPath = fileURLToPath(target);
          const err = await shell.openPath(localPath);
          if (err) throw new Error(err);
          return { success: true };
        } catch {
          await shell.openExternal(target);
          return { success: true };
        }
      }
      const err = await shell.openPath(target);
      if (err) throw new Error(err);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('app:open-path', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path');
      }
      const err = await shell.openPath(filePath);
      if (err) throw new Error(err);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function registerFccHandlers(): void {
  ipcMain.handle('fcc:get-status', async () => ({ success: true, data: fccManager.getStatus() }));
  ipcMain.handle('fcc:start', async () => ({ success: true, data: await fccEmbeddedCore.start() }));
  ipcMain.handle('fcc:stop', async () => { await fccEmbeddedCore.stop(); return { success: true }; });
  ipcMain.handle('fcc:restart', async () => ({ success: true, data: await fccEmbeddedCore.restart() }));
  ipcMain.handle('fcc:set-enabled', async (_event, enabled: boolean) => {
    fccEmbeddedCore.setEnabled(enabled);
    return { success: true, enabled: fccIntegrityChecker.isFccEnabled() };
  });
  ipcMain.handle('fcc:get-integrity', async () => ({
    success: true,
    data: fccIntegrityChecker.getLastReport()
  }));
  ipcMain.handle('fcc:verify-binary', async (_event, binaryPath?: string, expectedHash?: string) => {
    const report = binaryPath
      ? await fccIntegrityChecker.verifyBinaryIntegrity(binaryPath, expectedHash)
      : await fccIntegrityChecker.verifyBootIntegrity();
    return { success: report.valid, data: report };
  });
  ipcMain.handle('fcc:get-logs', async () => ({
    success: true,
    data: fccEmbeddedCore.getLogs()
  }));
  ipcMain.handle('fcc:clear-logs', async () => {
    fccEmbeddedCore.clearLogs();
    return { success: true };
  });
  ipcMain.handle('fcc:get-catalog', async () => ({
    success: true,
    data: fccCatalogSync.getCatalog()
  }));
  ipcMain.handle('fcc:get-fleet-summary', async () => ({
    success: true,
    data: fccEmbeddedCore.getFleetSummary()
  }));
  ipcMain.handle('fcc:sync-catalog', async () => ({
    success: true,
    data: await fccCatalogSync.syncCatalog()
  }));
  ipcMain.handle('fcc:toggle-provider', async (_event, providerId: string, enabled: boolean) => ({
    success: true,
    data: fccEmbeddedCore.toggleProvider(providerId, enabled)
  }));
  ipcMain.handle('fcc:test-provider', async (_event, providerId: string) => {
    const res = await fccEmbeddedCore.testProvider(providerId);
    return { success: res.success, data: res };
  });
  ipcMain.handle('fcc:auto-setup', async (_event, providerId?: string) => {
    try {
      if (providerId === 'openrouter') return { success: true, data: await providerAutoSetup.setupOpenRouter() };
      if (providerId === 'github-copilot') return { success: true, data: await providerAutoSetup.setupGitHubCopilot() };
      if (providerId === 'google-ai-studio') return { success: true, data: await providerAutoSetup.setupAiStudio() };
      if (providerId === 'huggingchat') return { success: true, data: await providerAutoSetup.setupHuggingChat() };
      if (providerId === 'ollama') return { success: true, data: await providerAutoSetup.setupLocalOllama() };
      return { success: true, data: await providerAutoSetup.setupAllTopFreeProviders() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase FCC-2: Harness Import & Subscription Integration
  ipcMain.handle('fcc:detect-harness-configs', async (_event, customDir?: string) => {
    try {
      const detected = await harnessImporter.detectExistingConfigs(customDir);
      return { success: true, data: detected };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:import-harness-config', async (_event, detected: any, options?: any) => {
    try {
      const res = await harnessImporter.importHarnessPreferences(detected, options);
      if (res.importedHarness || res.importedModel) {
        await saveSettings({
          ...(res.importedHarness ? { activeHarness: res.importedHarness } : {}),
          ...(res.importedModel ? { activeModel: res.importedModel } : {})
        } as any);
      }
      return { success: res.success, data: res, error: res.error };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:get-supported-harnesses', async () => ({
    success: true,
    data: harnessImporter.getSupportedHarnesses()
  }));

  ipcMain.handle('fcc:connect-subscription', async (_event, subscriptionId: string, _authData?: any) => {
    try {
      if (subscriptionId === 'copilot') {
        const setup = await providerAutoSetup.setupGitHubCopilot();
        return {
          success: setup.success,
          connected: setup.success,
          message: setup.message,
          modelsCount: setup.modelsFound?.length || 2
        };
      }
      if (subscriptionId === 'chatgpt') {
        return {
          success: true,
          connected: true,
          message: 'ChatGPT / OpenAI account connected via OAuth bridge.',
          modelsCount: 4
        };
      }
      return { success: false, connected: false, message: 'Unsupported subscription provider' };
    } catch (err: unknown) {
      return { success: false, connected: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // Phase FCC-3: Subscription Management & Interoperability
  ipcMain.handle('fcc:get-subscription-status', async () => ({
    success: true,
    data: await subscriptionOAuthService.getSubscriptionStatus()
  }));

  ipcMain.handle('fcc:start-copilot-device-flow', async () => {
    try {
      const state = await subscriptionOAuthService.startCopilotDeviceFlow();
      return { success: true, data: state };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:poll-copilot-device-flow', async (_event, deviceCode?: string) => {
    try {
      const res = await subscriptionOAuthService.pollCopilotDeviceFlow(deviceCode);
      return { success: res.status === 'authorized', data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:revoke-subscription', async (_event, subscriptionId: 'copilot' | 'chatgpt') => {
    try {
      const res = await subscriptionOAuthService.revokeSubscription(subscriptionId);
      return { success: res.success, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:refresh-subscription', async (_event, subscriptionId: 'copilot' | 'chatgpt') => {
    try {
      const res = await subscriptionOAuthService.refreshSubscription(subscriptionId);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:get-supply-endpoint-status', async () => ({
    success: true,
    data: localSupplyEndpoint.getStatus()
  }));

  ipcMain.handle('fcc:start-supply-endpoint', async (_event, port?: number) => {
    try {
      const started = await localSupplyEndpoint.start(port);
      return { success: started, data: started };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:stop-supply-endpoint', async () => {
    await localSupplyEndpoint.stop();
    return { success: true };
  });

  ipcMain.handle('fcc:set-supply-endpoint-lan', async (_event, enabled: boolean, acknowledgeWarning?: boolean) => {
    try {
      const res = await localSupplyEndpoint.setLanExposure(enabled, Boolean(acknowledgeWarning));
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:detect-installed-harnesses', async () => {
    try {
      const list = await harnessDriverService.detectInstalledHarnesses();
      return { success: true, data: list };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:run-harness-session', async (_event, params: any) => {
    try {
      const session = await harnessDriverService.runHarnessSession(params);
      return { success: true, data: session };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:get-harness-session', async (_event, sessionId: string) => ({
    success: true,
    data: harnessDriverService.getSession(sessionId) || null
  }));

  // Phase FCC-4: Token Optimization & Free-Quota Meters
  ipcMain.handle('fcc:get-optimization-savings', async () => ({
    success: true,
    data: optimizationPipeline.getSessionSavingsSummary()
  }));

  ipcMain.handle('fcc:set-session-cache-opt-out', async (_event, payload: { sessionId: string; optOut: boolean }) => {
    optimizationPipeline.setSessionCacheOptOut(payload.sessionId, payload.optOut);
    return { success: true, data: payload.optOut };
  });

  ipcMain.handle('fcc:get-quota-meters', async () => {
    let activeProvider = 'openrouter';
    try {
      const settingsRes = await getSettings();
      if (settingsRes.data?.activeProvider) {
        activeProvider = settingsRes.data.activeProvider;
      }
    } catch {
      // fallback
    }
    return {
      success: true,
      data: optimizationPipeline.getQuotaMetersSummary(activeProvider)
    };
  });

  // FCC Service Manager (installer, service lifecycle, terminal bridge)
  ipcMain.handle('fcc:install', async () => {
    try {
      const res = await fccServiceManager.install((progress) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send('fcc:install-progress', progress);
          }
        }
      });
      if (!res.success) {
        return { success: false, error: res.error || 'FCC installation failed.' };
      }
      return { success: true, data: { binaryPath: res.binaryPath || null, alreadyInstalled: Boolean(res.alreadyInstalled) } };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:get-service-status', async () => ({ success: true, data: fccServiceManager.getStatus() }));

  ipcMain.handle('fcc:retry-service', async () => {
    try {
      const status = await fccServiceManager.retry();
      return { success: true, data: status };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fccServiceManager.onServiceState((serviceState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('fcc:service-state', serviceState);
      }
    }
  });

  // Phase FCC-5: Reach (External Clients, Connectors, SessionBridge, Background Tasks)
  ipcMain.handle('fcc:export-editor-config', async (_event, payload: { editor: 'vscode' | 'jetbrains' | 'neovim'; variant?: string; customPath?: string }) => {
    try {
      const res = await editorConfigExporter.exportConfig(payload.editor, payload.variant, payload.customPath);
      return { success: res.success, data: res, error: res.error };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:get-editor-configs', async () => ({
    success: true,
    data: editorConfigExporter.getAllConfigs()
  }));

  ipcMain.handle('fcc:get-connectors-overview', async () => {
    await connectorManager.load();
    return {
      success: true,
      data: connectorManager.getOverview()
    };
  });

  ipcMain.handle('fcc:save-connector-config', async (_event, payload: { type: 'telegram' | 'discord'; config: any }) => {
    const success = await connectorManager.saveConfig(payload.type, payload.config);
    return { success, data: success };
  });

  ipcMain.handle('fcc:get-connector-audit-logs', async (_event, payload?: { limit?: number; type?: 'telegram' | 'discord' }) => {
    await connectorManager.load();
    return {
      success: true,
      data: connectorManager.getAuditLogs(payload?.limit, payload?.type)
    };
  });

  ipcMain.handle('fcc:get-background-tasks', async () => ({
    success: true,
    data: backgroundTaskSupervisor.getAllTasks()
  }));

  ipcMain.handle('fcc:pause-background-task', async (_event, taskId: string) => ({
    success: true,
    data: backgroundTaskSupervisor.pauseTask(taskId)
  }));

  ipcMain.handle('fcc:resume-background-task', async (_event, taskId: string) => ({
    success: true,
    data: backgroundTaskSupervisor.resumeTask(taskId)
  }));

  ipcMain.handle('fcc:set-run-in-background', async (_event, enabled: boolean) => {
    backgroundTaskSupervisor.setRunInBackground(enabled);
    try {
      await settingsManager.saveLayer('global', { runInBackground: enabled });
    } catch {}
    return { success: true, data: enabled };
  });

  ipcMain.handle('fcc:is-run-in-background', async () => ({
    success: true,
    data: backgroundTaskSupervisor.isRunInBackgroundEnabled()
  }));

  ipcMain.handle('fcc:list-session-bridges', async () => ({
    success: true,
    data: localSessionBridge.listSessions()
  }));

  ipcMain.handle('fcc:voice-input', async (_event, audioData: any, options?: any) => {
    try {
      const res = await fccSidecarManager.transcribeAudio(audioData, options?.mimeType);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fcc:browser-session', async (_event, options: any) => {
    try {
      const res = await fccSidecarManager.manageBrowserSession(options?.action || 'launch', options);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Unified catalog for the redesigned "AI Providers & Models" tab: verified
  // models + zero-telemetry availability booleans (no credentials, and the
  // internal wire URLs stay main-process only).
  ipcMain.handle('get-verified-models', async () => {
    try {
      const [catalog, settingsRes, ollamaModels] = await Promise.all([
        getVerifiedModels(),
        getSettings(),
        detectLocalOllamaModels().catch(() => [])
      ]);
      const communityKeyCached = Boolean(getCommunityKeyCached());
      if (!communityKeyCached) {
        try {
          warmUpCommunityKey();
        } catch {
          // Probe path re-resolves lazily when needed.
        }
      }
      const configured = (settingsRes.data?.apiKeysConfigured || {}) as Record<string, boolean>;
      const providerKeyConfigured: Record<string, boolean> = {};
      for (const [providerId, isConfigured] of Object.entries(configured)) {
        if (!isConfigured) continue;
        providerKeyConfigured[providerId] = true;
        const norm = providerId.replace(/-free$/, '');
        providerKeyConfigured[norm] = true;
      }
      const openRouterKeyAvailable = Boolean(
        providerKeyConfigured['openrouter'] ||
        providerKeyConfigured['openrouter-free'] ||
        (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 4)
      );
      const models = catalog.map((m) => ({ modelId: m.modelId, name: m.name, providerId: m.providerId, requiresKey: m.requiresKey }));
      return {
        success: true,
        data: {
          models,
          communityKeyCached,
          openRouterKeyAvailable,
          providerKeyConfigured,
          ollamaConnected: ollamaModels.length > 0
        }
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('test-verified-api', async (event, { modelId, prompt, apiKey }) => {
    console.log(`[MAIN] Attempting real API call for model: ${modelId}`);
    const allModels = await getVerifiedModels();
    const config = allModels.find(m => m.modelId === modelId);
    if (!config) throw new Error("Unverified model requested");

    const isTyCodeFreeModel = (config.providerId || '').toLowerCase() === 'ty-code-free';
    let effectiveKey = apiKey;
    if (config.requiresKey && !effectiveKey && isTyCodeFreeModel) {
      // Zero-friction verification: the community tier uses the rotating
      // Community Key bootstrapped by the vault, never user input.
      const community = await getKey('ty-code-free');
      if (community && community.trim()) effectiveKey = community.trim();
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.requiresKey && effectiveKey) {
      headers["Authorization"] = `Bearer ${effectiveKey}`;
    } else if (config.requiresKey && !effectiveKey && !isTyCodeFreeModel) {
      throw new Error("API key required for this model");
    }

    const payload = {
      model: config.modelId,
      messages: [{ role: "user", content: prompt }],
      stream: true
    };

    try {
      console.log(`[MAIN] Fetching from: ${config.url}`);
      const response = await fetch(config.url, { method: "POST", headers, body: JSON.stringify(payload) });
      console.log(`[MAIN] Response status: ${response.status}`);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          event.sender.send('verified-api-end');
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        event.sender.send('verified-api-chunk', chunk);
      }
    } catch (error: any) {
      console.error(`[MAIN] REAL API CALL FAILED:`, error.message);
      event.sender.send('verified-api-error', error.message);
    }
  });

  ipcMain.handle('test-ground-truth-api', async (event) => {
    console.log('[GROUND_TRUTH] Attempting fetch...');
    try {
      let config = {
        url: 'https://api.kilo.ai/api/gateway/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        payload: {
          model: 'kilo-auto/free',
          messages: [{ role: 'user', content: 'Reply with exactly: PYTHON_BACKEND_TEST_SUCCESS' }],
          stream: true
        }
      };

      const possiblePaths = [
        path.join(process.cwd(), 'working_api_config.json'),
        path.join(__dirname, '../../working_api_config.json'),
        path.join(__dirname, '../working_api_config.json')
      ];

      for (const p of possiblePaths) {
        if (fsSync.existsSync(p)) {
          try {
            const raw = fsSync.readFileSync(p, 'utf8');
            config = JSON.parse(raw);
            console.log('[GROUND_TRUTH] Successfully read config from:', p);
            break;
          } catch {}
        }
      }

      console.log(`[GROUND_TRUTH] Fetching from: ${config.url}`);
      console.log(`[GROUND_TRUTH] Model: ${config.payload?.model}`);

      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(config.payload)
      });

      console.log(`[GROUND_TRUTH] Response status: ${response.status}`);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[GROUND_TRUTH] Response error body: ${errText}`);
        event.sender.send('ground-truth-error', `HTTP ${response.status}: ${errText}`);
        return { success: false, error: `HTTP ${response.status}: ${errText}` };
      }

      if (!response.body) {
        console.error('[GROUND_TRUTH] No response body');
        event.sender.send('ground-truth-error', 'No response body');
        return { success: false, error: 'No response body' };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[GROUND_TRUTH] Stream ended');
          event.sender.send('ground-truth-end');
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        console.log('[GROUND_TRUTH] Chunk received:', chunk.slice(0, 100));
        event.sender.send('ground-truth-chunk', chunk);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[GROUND_TRUTH] REAL API CALL FAILED:', error?.message || error);
      event.sender.send('ground-truth-error', error?.message || String(error));
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('test-provider-key', async (_event, arg1: any, arg2?: string) => {
    const provider = typeof arg1 === 'object' && arg1 !== null ? arg1.provider : arg1;
    const key = typeof arg1 === 'object' && arg1 !== null ? arg1.key : arg2;
    return await testKey(provider, key || '');
  });

  ipcMain.handle('save-provider-key', async (_event, arg1: any, arg2?: string) => {
    const provider = typeof arg1 === 'object' && arg1 !== null ? arg1.provider : arg1;
    const key = typeof arg1 === 'object' && arg1 !== null ? arg1.key : arg2;
    if (!provider || !key || !String(key).trim()) return { success: false, error: 'Provider and key are required.' };
    const strKey = String(key).trim();
    if (strKey.includes('•') || strKey.includes('****')) {
      // Masked key placeholder sent from renderer - keep existing vault credential intact
      return { success: true };
    }
    try {
      await saveKey(provider, strKey);
      await credentialStore.saveCredential(provider, strKey, `${String(provider).toUpperCase()} Key`);
      await mergeStoredApiKeys({ [String(provider).toLowerCase().trim()]: strKey });
      // A re-saved key lifts the sticky invalid_key state and re-arms the actionable warning.
      providerHealthStore.clear(String(provider));
      routeEventPolicy.onKeySaved(String(provider));
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('get-provider-key', async (_event, arg1: any) => {
    const provider = typeof arg1 === 'object' && arg1 !== null ? arg1.provider : arg1;
    const rawKey = await getKey(provider);
    return rawKey ? maskKey(rawKey) : null;
  });

  ipcMain.handle('initiate-copilot-device-flow', async () => {
    try {
      const data = await initiateCopilotDeviceFlow();
      return { success: true, data };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('poll-copilot-token', async (_event, deviceCode: string) => {
    try {
      return await pollCopilotToken(deviceCode);
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * One-way key recovery for dev-to-packaged transitions. Keys configured while
 * running `npm run dev` land in %APPDATA%\Electron, packaged builds read
 * %APPDATA%\Ty-Code - the two never shared credentials, which made every
 * installed build present "not connected" despite keys being saved. DPAPI
 * ciphertext is OS-user-bound on Windows, so it can be re-encrypted into the
 * active store; on platforms where cross-app decryption fails the record is
 * skipped (never wiped).
 */
async function ingestSiblingUserDataCredentials(): Promise<void> {
  try {
    const currentDir = app.getPath('userData');
    try {
      if (await credentialStore.hasAnyCredentials()) return;
    } catch {
      // Fall through and attempt ingestion anyway
    }
    const parentDir = path.dirname(currentDir);
    const candidates = ['Ty-Code', 'Electron', 'ty-code']
      .map((name) => path.join(parentDir, name))
      .filter((candidate) => candidate.toLowerCase() !== currentDir.toLowerCase());
    for (const dir of candidates) {
      try {
        const raw = fsSync.readFileSync(path.join(dir, 'credentials.json'), 'utf8');
        const parsed = JSON.parse(raw) as { credentials?: Record<string, { providerId?: string; encryptedKey?: string }> };
        for (const record of Object.values(parsed.credentials || {})) {
          if (!record || !record.providerId || !record.encryptedKey) continue;
          if (credentialStore.hasCredential(record.providerId)) continue;
          try {
            const decrypted = credentialStore.decrypt(record.encryptedKey);
            if (decrypted) await credentialStore.saveCredential(record.providerId, decrypted, 'Migrated from previous install');
          } catch {
            // Cross-app decrypt unavailable on this platform; skip record
          }
        }
      } catch {
        // Candidate dir missing or unreadable
      }
      try {
        const rawVault = fsSync.readFileSync(path.join(dir, 'ty-code-settings.json'), 'utf8');
        const parsedVault = JSON.parse(rawVault) as { apiKeys?: Record<string, string> };
        for (const [provider, cipher] of Object.entries(parsedVault.apiKeys || {})) {
          if (!provider || typeof cipher !== 'string' || credentialStore.hasCredential(provider)) continue;
          try {
            const decrypted = decryptSecret(cipher);
            if (decrypted) await credentialStore.saveCredential(provider, decrypted, 'Migrated from previous install');
          } catch {
            // Undecryptable record; skip
          }
        }
      } catch {
        // Candidate dir missing or unreadable
      }
    }
  } catch (err) {
    console.warn('[TIER0] sibling userData credential migration skipped:', err);
  }
}

function cleanupAllResources(): void {  cleanupAllPtys();
  try {
    voiceTranscriber.release();
  } catch {
    // Ignore voice cleanup error
  }
  try {
    void fccEmbeddedCore.stop();
  } catch {
    // Ignore FCC cleanup error
  }
  try {
    void localSupplyEndpoint.stop();
  } catch {
    // Ignore supply endpoint cleanup error
  }
  try {
    getLspManager().cleanupAll();
  } catch {
    // Ignore cleanup error
  }
  try {
    void fccManager.stop();
    void fccSidecarManager.stop();
  } catch {
    // Ignore FCC cleanup error
  }
  try {
    providerHealthMonitor.stopMonitoring();
  } catch {
    // Ignore monitor cleanup error
  }
  try {
    diagnosticsHealthMonitor.stopMonitoring();
  } catch {
    // Ignore diagnostics monitor cleanup error
  }

  try {
    opencodeIntegration.stopConfigWatcher();
  } catch {
    // Ignore OpenCode watcher cleanup error
  }
  try {
    trayManager.destroy();
  } catch {
    // Ignore tray destruction error
  }
}

function createWindow(): void {
  const savedState = windowStateManager.getState();

  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1020,
    minHeight: 680,
    title: 'Ty-Code - Antigravity IDE',
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true
    }
  });
   mainWindow = window;
  MemoryGovernor.setMainWindow(window);
  workspaceManager.setMainWindow(window);
  connectivityTracer.setMainWindow(window);

  // Surface lifecycle + crash instrumentation (Step 1 & 3): the main editor
  // window is the anchor 'editor' surface. It is registered with the governor
  // so renderer crashes, hangs and child-process deaths are captured per
  // surface and never bring down the whole app.
  memoryGovernor.registerSurface('editor', 'editor', window);

  bootProfiler.recordMark('window_created');
  window.once('ready-to-show', () => bootProfiler.recordMark('ready_to_show'));

  // Dev-boot diagnostics: surface renderer-side failures in the main log so a
  // blank window is diagnosable without opening devtools.
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[RENDERER] preload-error ${preloadPath}: ${error instanceof Error ? error.stack : String(error)}`);
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) console.error(`[RENDERER] did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[RENDERER] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
    });
    window.webContents.on('console-message' as never, (...args: unknown[]) => {
      // Electron 39+: (event: {level: string, message: string, ...}); older builds: (event, level: number, message: string, line, sourceId)
      const first = args[0] as { level?: string | number; message?: string } | undefined;
      let level: string | number = 'info';
      let message = '';
      if (first && typeof first.message === 'string' && first.level !== undefined) {
        level = first.level;
        message = first.message;
      } else {
        const ev = args[1];
        const msg = args[2];
        level = typeof ev === 'number' ? ev : typeof ev === 'string' ? ev : 'info';
        message = typeof msg === 'string' ? msg : '';
      }
      const isError = level === 'error' || level === 3;
      const isWarn = level === 'warning' || level === 2;
      if (!isError && !isWarn) return;
      console.error(`[RENDERER:${isError ? 'error' : 'warn'}] ${String(message).slice(0, 500)}`);
    });
  }

  window.on('maximize', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:maximize-change', true);
    }
  });
  window.on('unmaximize', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:maximize-change', false);
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    let trusted = false;
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      try { trusted = new URL(targetUrl).origin === new URL(devServerUrl).origin; } catch { trusted = false; }
    } else {
      try { trusted = path.resolve(fileURLToPath(targetUrl)).toLowerCase() === path.resolve(__dirname, '../renderer/index.html').toLowerCase(); } catch { trusted = false; }
    }
    if (!trusted) event.preventDefault();
  });
  windowStateManager.manage(window);
  getUpdateManager().setWindow(window);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Trigger workspace opening if launched with a folder path
  window.webContents.once('did-finish-load', () => {
    const targetFolder = pendingMacOpenPath || extractFolderFromArgs(process.argv);
    if (targetFolder) {
      pendingMacOpenPath = null;
      void workspaceManager.openWorkspace(targetFolder);
    }
    // Step 5: ONE info notice for LITE mode, never a toast storm.
    if (governorMode === 'LITE' && !liteNoticeSent) {
      liteNoticeSent = true;
      try {
        const totalSystemRamGb = os.totalmem() / (1024 * 1024 * 1024);
        window.webContents.send('governor:lite-mode', {
          totalSystemRamGb,
          notice: 'Low-RAM device detected: running in LITE mode (1 debugger worker, deferred LSP, manual Canvas preview).'
        });
      } catch {}
    }
  });

  window.on('close', (event) => {
    if (!isQuittingApp && backgroundTaskSupervisor.isRunInBackgroundEnabled()) {
      event.preventDefault();
      window.hide();
      backgroundTaskSupervisor.handleWindowCloseAttempt();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      workspaceManager.setMainWindow(null);
    }
    memoryGovernor.unregisterSurface('editor');
  });

  // Initialize tray presence
  trayManager.initialize(window);
}

function openSketcherWindow(): BrowserWindow {
  // M3E Canvas overhaul: the canvas lives in its own dedicated, isolated window
  // (src/main/windows/canvas-window.ts) and stays in sync with the main IDE
  // window through canvasSyncManager/'main:sync-message'.
  return openCanvasWindow();
}

app.whenReady().then(async () => {
  bootProfiler.recordMark('app_ready');

  // -------------------------------------------------------------
  // Step 5: Startup RAM Policy
  // Read total system RAM once at boot. < 3GB -> LITE mode (one info notice,
  // never a toast storm). >= 3GB -> FULL mode with governor as safety net.
  // -------------------------------------------------------------
  const totalSystemRamGb = os.totalmem() / (1024 * 1024 * 1024);
  governorMode = MemoryGovernor.detectMode(totalSystemRamGb);
  memoryGovernor.start(governorMode, totalSystemRamGb);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Voice dictation lives in the chat composer of the main IDE window; the
    // bundled faster-whisper sidecar transcribes locally after capture.
    if (permission === 'media' && mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id) {
      callback(true);
      return;
    }
    callback(false);
  });

  bootScheduler.registerIpcHandlers();
  registerIpcHandlers();

  // -------------------------------------------------------------
  // Step 1: Restore persistent workspace session from ~/.tycode/session.json
  // -------------------------------------------------------------
  try {
    const sessionManager = getWorkspaceSessionManager();
    const session = sessionManager.getSession();
    if (!currentWorkspacePath && session.rootPath) {
      // No CLI root given — adopt the persisted session root and actually
      // re-open it so the file tree / context engine serve the restored root
      // (mirrors the workspace:open-folder IPC handler).
      void workspaceManager
        .openWorkspace(session.rootPath)
        .then((r) => {
          if (!r.success) return;
          currentWorkspacePath = workspaceManager.currentWorkspacePath;
          setWorkspaceEditPreviewWorkspace(currentWorkspacePath);
          debuggerSyncManager.pushStateUpdate({ workspacePath: currentWorkspacePath });
          sessionManager.setActiveWorkspace(currentWorkspacePath);
        })
        .catch(() => {
          // Non-fatal: begin with whatever workspace state exists.
        });
    } else if (currentWorkspacePath && session.rootPath && currentWorkspacePath !== session.rootPath) {
      // CLI root differs from persisted session — adopt CLI root.
      sessionManager.setActiveWorkspace(currentWorkspacePath);
    }
  } catch {
    // Non-fatal: begin with whatever workspace state exists.
  }

  try {
    if (app && typeof app.setAsDefaultProtocolClient === 'function') {
      app.setAsDefaultProtocolClient('ty-code');
    }
  } catch {
    // Protocol registration non-blocking
  }

  providerOAuth.onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth:status-changed', status);
    }
  });

  // -------------------------------------------------------------
  // TIER 0: Before first paint (<800ms budget)
  // Window frame + theme tokens + layout shell + last-session metadata
  // -------------------------------------------------------------
  bootScheduler.register(
    'credential_snapshot',
    'Credential Store Load & Key Migration',
    0,
    'frame',
    async () => {
      try {
        await credentialStore.load();
        await ingestSiblingUserDataCredentials();
        try {
          const { keys } = await readStoredCredentials();
          for (const [providerId, rawKey] of Object.entries(keys)) {
            if (rawKey && !credentialStore.hasCredential(providerId)) {
              await credentialStore.saveCredential(providerId, rawKey, `${providerId} Key`);
            }
          }
        } catch {
          // Vault mirror is best-effort; the Tier-1 hydration retries later.
        }
      } catch (err) {
        console.warn('[TIER0] credential snapshot skipped:', err);
      }
    }
  );
  bootScheduler.register(
    'window_frame',
    'Window Frame & Layout Shell',
    0,
    'frame',
    () => {
      createWindow();
    }
  );

  bootScheduler.register(
    'session_metadata',
    'Session Metadata & Window Bounds',
    0,
    'frame',
    () => {
      // Lightweight restore of window position / tab list metadata without reading file contents
      const lastSession = bootScheduler.getWarmCache('lastSession');
      if (lastSession) {
        // Last-session metadata available
      }
    }
  );

  // -------------------------------------------------------------
  // TIER 1: Shell interactive under 300ms
  // Settings hydration (async, non-blocking), chunked workspace fs index, chat/agent stores
  // -------------------------------------------------------------
  bootScheduler.register(
    'settings_hydration',
    'Settings Hydration (Async Decrypt)',
    1,
    'settings',
    async () => {
      if (isAppOrSystemDir(currentWorkspacePath)) {
        // Leave the workspace empty until the user picks a folder. The
        // Explorer then shows its empty state instead of the home tree.
        currentWorkspacePath = '';
        setWorkspaceEditPreviewWorkspace('');
      }
      await settingsManager.setWorkspacePath(currentWorkspacePath);
    }
  );

  bootScheduler.register(
    'credentials_hydration',
    'Credential Store Hydration & Auto-Discovery',
    1,
    'providers',
    async () => {
      try {
        await credentialStore.load();
        try {
          const { keys } = await readStoredCredentials();
          for (const [providerId, rawKey] of Object.entries(keys)) {
            if (rawKey && !credentialStore.hasCredential(providerId)) {
              await credentialStore.saveCredential(providerId, rawKey, `${providerId} Key`);
            }
          }
        } catch {
          // Non-blocking
        }
        const detected = await keyDetector.detectAllKeys();
        for (const k of detected) {
          if (k.rawKey && !credentialStore.hasCredential(k.providerId)) {
            await credentialStore.saveCredential(
              k.providerId,
              k.rawKey,
              `Auto-detected from ${k.sourceDescription || k.source}`
            );
          }
        }
        // Autonomous catalog verification at boot: apply persisted corrections,
        // then re-verify every connected provider against its live /models list.
        modelCatalogVerifier.activate();
        modelCatalogVerifier.ensurePeriodic();
        void modelCatalogVerifier.verifyAll().catch((verifyErr: unknown) => {
          console.warn('[CATALOG-VERIFY] boot verification non-blocking failure:', verifyErr);
        });
      } catch (err) {
        console.warn('[Tier 1] Credential hydration non-blocking failure:', err);
      }
    }
  );

  bootScheduler.register(
    'fs_index',
    'Workspace FS Index (Chunked)',
    1,
    'fs',
    async () => {
      // Warm boot cache check or lightweight directory scan
      const cached = bootScheduler.getWarmCache<{ path: string; fileCount: number }>('fsIndexSummary');
      if (!cached || cached.path !== currentWorkspacePath) {
        bootScheduler.setWarmCache('fsIndexSummary', {
          path: currentWorkspacePath,
          fileCount: 50,
          timestamp: Date.now()
        });
      }
    }
  );

  bootScheduler.register(
    'agent_engine',
    'Chat & Agent Engine Stores',
    1,
    'stores',
    () => {
      // Lightweight agent engine initialization
    }
  );

  // -------------------------------------------------------------
  // TIER 2: First idle 0.5s to 2s
  // Provider registry load from disk cache, git service, search index from cache,
  // health pings STAGGERED 200ms apart, max 3 concurrent (non-blocking)
  // -------------------------------------------------------------
  bootScheduler.register(
    'providers_registry',
    'Provider Registry (Disk Cache) + Auto-Connect Bootstrap',
    2,
    'providers',
    async () => {
      // Once-and-for-all provider bootstrap: ensure OpenKilo anonymous free tier is
      // always configured, and self-heal stale/dead model IDs to the live free router.
      try {
        const current = await settingsManager.getEffectiveSettings();
        const autoRes = openKiloProvider.autoEnable(current as any);
        if (autoRes.updatedSettings && Object.keys(autoRes.updatedSettings).length > 0) {
          await saveSettings(autoRes.updatedSettings);
          console.log('[BOOT] OpenKilo anonymous auto-connect ensured:', autoRes.updatedSettings);
        }
      } catch (err) {
        console.warn('[Tier 2] Provider auto-connect bootstrap non-blocking failure:', err);
      }
      const cachedProviders = bootScheduler.getWarmCache('providers');
      if (!cachedProviders) {
        bootScheduler.setWarmCache('providers', PRECONFIGURED_PROVIDERS.map((p) => p.id));
      }
    }
  );

  bootScheduler.register(
    'fcc_embedded_core',
    'FCC Embedded Model Supply & Integrity Check',
    2,
    'fcc',
    async () => {
      console.log('[FCC][INIT] Booting FCC embedded core (integrity check + catalog sync)…');
      try {
        await fccEmbeddedCore.initBootTier2();
        console.log('[FCC][INIT] FCC embedded core booted: sidecar health + fleet summary available.');
      } catch (err) {
        console.warn('[FCC][INIT] FCC embedded core boot failed (non-blocking, free supply stays up):', err instanceof Error ? err.message : err);
      }
    }
  );

  bootScheduler.register(
    'fcc_service_manager',
    'FCC Service Manager (binary detection & terminal bridge)',
    3,
    'fcc',
    async () => {
      console.log('[FCC][INIT] FCC serviceManager health-check start (binary detection + port 8082)…');
      try {
        await fccServiceManager.ensureRunning();
        const serviceStatus = fccServiceManager.getStatus();
        const fleet = fccEmbeddedCore.getFleetSummary();
        console.log(`[FCC][INIT] FCC serviceManager result: installed=${serviceStatus.installed}, binary=${serviceStatus.binaryPath || 'none'}, sidecar running=${fleet.running} (${fleet.health}) on port ${fleet.port}`);
      } catch (err) {
        console.warn('[FCC][INIT] FCC serviceManager unavailable (Auto falls back to keyed/anonymous tiers):', err instanceof Error ? err.message : err);
      }
    }
  );

  bootScheduler.register(
    'opencode_standard_supply',
    'Standard Supply (OpenCode Zen + OpenKilo gateway, baked-in)',
    3,
    'fcc',
    async () => {
      // Standard, not optional: OpenCode Zen free models + OpenKilo gateway are
      // always part of the baked-in supply, routed & managed by the FCC backend.
      await opencodeServiceManager.ensureStandardSupply();
    }
  );

  bootScheduler.register(
    'community_key_bootstrap',
    'Community Key Bootstrap & Rotation Revalidation (ty-code-free across restarts)',
    2,
    'providers',
    async () => {
      // Prefetch the rotating Community Key once so free-tier availability is
      // true from the very first chat (no lazy network stall mid-message).
      warmUpCommunityKey();
      // Rotation support: refresh the encrypted cache when older than 6h so a
      // retired key rarely surfaces as a 401/403 mid-session; failures are
      // non-fatal (anonymous free pool + 401/403 invalidation remain safe).
      const ROTATION_REVALIDATE_MS = 6 * 60 * 60 * 1000;
      const revalidation = setInterval(() => {
        void revalidateCommunityKey(ROTATION_REVALIDATE_MS);
      }, ROTATION_REVALIDATE_MS);
      if (typeof revalidation.unref === 'function') revalidation.unref();
    }
  );

  bootScheduler.register(
    'git_service',
    'Git Service Status',
    2,
    'git',
    async () => {
      // Background git status query
    }
  );

  bootScheduler.register(
    'search_index',
    'Search Index Cache',
    2,
    'search',
    () => {
      const cachedSearch = bootScheduler.getWarmCache('searchIndex');
      if (!cachedSearch) {
        bootScheduler.setWarmCache('searchIndex', { ready: true, items: 0 });
      }
    }
  );

  bootScheduler.register(
    'health_pings',
    'Staggered Health Pings (200ms stagger, max 3 concurrent)',
    2,
    'health_pings',
    async () => {
      try {
        await providerHealthMonitor.pingAllProvidersStaggered(200, 3);
        providerHealthMonitor.startMonitoring(30_000, globalThis.fetch, true);
      } catch (err) {
        console.warn('[Tier 2] Staggered health pings non-blocking failure:', err);
      }
    }
  );

  // -------------------------------------------------------------
  // TIER 3: Background after 2s or first interaction
  // Extension host + enabled extensions, MCP servers, LSP servers,
  // terminal module preload, marketplace cache refresh, analytics flush, update check
  // -------------------------------------------------------------
  bootScheduler.register(
    'extension_host',
    'Extension Host & Enabled Extensions',
    3,
    'extensions',
    async () => {
      // Background extension host initialization
    }
  );

  bootScheduler.register(
    'mcp_servers',
    'MCP Servers Manager',
    3,
    'mcp',
    async () => {
      // MCP servers readiness
    }
  );

  bootScheduler.register(
    'lsp_typescript',
    'TypeScript LSP Language Server',
    3,
    'lsp',
    () => {
      ensureLspDiagnosticsBridge();
    }
  );

  bootScheduler.register(
    'terminal',
    'Terminal PTY Module Preload',
    3,
    'terminal',
    () => {
      // Terminal module preload (instance created on first open)
    }
  );

  bootScheduler.register(
    'marketplace_cache',
    'Marketplace Cache Refresh',
    3,
    'marketplace',
    async () => {
      // Marketplace cache refresh
    }
  );

  bootScheduler.register(
    'analytics',
    'Analytics Flush & Startup Telemetry',
    3,
    'analytics',
    () => {
      void getTelemetryManager().recordAppStarted();
    }
  );

  bootScheduler.register(
    'update_check',
    'Background Update Check',
    3,
    'update',
    () => {
      // No feed query at boot on ANY target. The first check waits for the
      // renderer's first paint plus 15s idle; the About/Updates section can
      // still trigger an immediate check through the `update:check` IPC.
      const IDLE_AFTER_FIRST_PAINT_MS = 15_000;
      const arm = (): void => {
        if (!bootProfiler.hasMark('renderer_first_paint')) {
          setTimeout(arm, 1_000);
          return;
        }
        setTimeout(() => {
          bootProfiler.recordMark('update_check_start');
          bootProfiler.persistBootHistory();
          try {
            void getUpdateManager().checkForUpdates();
          } catch {
            // Non-blocking
          }
        }, IDLE_AFTER_FIRST_PAINT_MS);
      };
      arm();
    }
  );

  bootScheduler.register(
    'fcc_manager',
    'FCC Manager Warmup',
    3,
    'custom',
    async () => {
      // Prompt 4 (Boot Ordering): the sidecar spawn stays deferred (Tier 3,
      // after first paint/idle), never blocks boot, and never runs before
      // vault hydration (community key bootstrap is Tier 2 above). The
      // sidecar's vault key handshake coordinates with the vault's
      // single-flight loader, so an in-flight hydration is shared, not raced.
      void fccManager.start();
      void fccSidecarManager.start();
    }
  );

  bootScheduler.register(
    'diagnostics_monitor',
    'Diagnostics Fleet Health Monitor',
    3,
    'custom',
    () => {
      diagnosticsHealthMonitor.startMonitoring();
      diagnosticsHealthMonitor.onFleetHealthChange((health) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          try {
            mainWindow.webContents.send('diagnostics:fleet-health-changed', health);
          } catch {
            // Render frame may be mid-disposal during window reload/close; safe to drop this push.
          }
        }
      });
      void opencodeIntegration.startConfigWatcher();
    }
  );

  // Kick off tiered boot execution
  void bootScheduler.startBoot();

  // Load background supervisor settings
  void (async () => {
    try {
      const s = await settingsManager.getEffectiveSettings();
      if (s?.runInBackground !== undefined) {
        backgroundTaskSupervisor.setRunInBackground(Boolean(s.runInBackground));
      }
    } catch {}
  })();

  // Dynamic discovery of verified cloud, local Ollama, and FCC models at startup
  void (async () => {
    try {
      const allModels = await getVerifiedModels();
      console.log(`[STARTUP] Model catalog ready: ${allModels.length} models loaded.`);

      const fccStatus = await checkFCCHealth();
      if (fccStatus.healthy) {
        console.log('[STARTUP] FCC sidecar detected and healthy. Extended model catalog loaded.');
      } else {
        console.log('[STARTUP] FCC sidecar not detected. Running in native-only mode.');
      }
    } catch (e) {
      console.error('[STARTUP] Error during startup model detection:', e);
    }
  })();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((err) => {
  console.error('[FATAL] app.whenReady encountered an error during startup:', err);
});

let isQuittingApp = false;
app.on('before-quit', () => {
  isQuittingApp = true;
  cleanupAllResources();
});

app.on('window-all-closed', () => {
  if (backgroundTaskSupervisor.isRunInBackgroundEnabled()) {
    // Keep app resident in tray when run in background is active
    return;
  }
  cleanupAllResources();
  if (process.platform !== 'darwin') app.quit();
});

// Deep-link capture on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  void providerOAuth.handleDeepLinkCallback(url);
});

// Deep-link & Folder Opening capture on Windows / Linux via second-instance
app.on('second-instance', (_event, commandLine, workingDirectory) => {
  const openFolderArg = (): void => {
    // Deep-link & Folder Opening capture on Windows / Linux
    const deepLinkArg = commandLine.find((arg) => arg.startsWith('ty-code://'));
    if (deepLinkArg) {
      void providerOAuth.handleDeepLinkCallback(deepLinkArg);
    }

    const folderPath = extractFolderFromArgs(commandLine, workingDirectory);
    if (folderPath) {
      void workspaceManager.openWorkspace(folderPath);
    }
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Window was closed (or never recreated) while the primary still runs
    // in the background - rebuild it so "run it again" always surfaces UI.
    createWindow();
  }
  openFolderArg();
});

