import { app, BrowserWindow, ipcMain, session, shell, dialog, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import os from 'os';
import { ProviderGateway } from './providers/provider-gateway';
import { PRECONFIGURED_PROVIDERS } from './config/provider-registry';
import { historyExtractor } from './services/history-extractor';
import {
  selectWorkspaceFolder, getWorkspaceTree, readFile, writeFile, createFile,
  createDirectory, deletePath, renamePath, searchWorkspaceFiles,
  searchInWorkspaceFiles, replaceInWorkspaceFiles
} from './ipc/fs-handlers';
import {
  handleGetLspServers, handleStartLspServer, handleStopLspServer,
  handleRestartLspServer, handleConfigureLspServer, handleLspDidOpen,
  handleLspDidChange, handleLspDidSave, handleLspDidClose,
  handleLspCompletion, handleLspHover, handleLspDefinition,
  handleLspTypeDefinition, handleLspImplementation, handleLspReferences,
  handleLspRename, handleLspDocumentSymbols, handleLspWorkspaceSymbols,
  handleLspCodeActions, handleLspSignatureHelp, getLspManager
} from './ipc/lsp-handlers';
import { getCredentialStorageStatusResponse, getSettings, getSettingsLayer, getSecurityPolicy, saveSecurityPolicy, saveSettings, saveSettingsLayer } from './ipc/settings-handlers';
import { settingsManager } from './services/settings-manager';
import { startAgentTask, stopAgentTask, respondAgentApproval, applyDiff, handleUserApproveDiff } from './ipc/agent-handlers';
import {
  runCommand, getAvailableShells, spawnPtySession, attachPty, writePty,
  resizePty, syncPtyCwd, killPty, cleanupAllPtys, resolvePtyApproval, executePtyCommand
} from './ipc/pty-handlers';
import {
  searchOpenVsxExtensions, getOpenVsxExtensionDetails, handleGetInstalledExtensions,
  handleInstallExtension, handleUninstallExtension, handleToggleExtension,
  handleUpdateExtensionSettings, handleInstallExtensionFromVsix, handleExtensionCapability
} from './ipc/extensions-handlers';
import { getAvailableSkills } from './ipc/skills-handlers';
import {
  handleGitIsRepo, handleGitInit, handleGitGetStatus, handleGitGetDiff,
  handleGitGetFileDiff, handleGitGetCommitDetail, handleGitGetTags, handleGitCreateTag,
  handleGitDeleteTag, handleGitGetConflictContent, handleGitResolveConflict,
  handleGitAbortMerge, handleGitGetHunks, handleGitApplyHunk, handleGitMerge,
  handleGitGetOriginalContent, handleGitStage, handleGitUnstage,
  handleGitDiscardChanges, handleGitCommit, handleGitGetBranches,
  handleGitCreateBranch, handleGitSwitchBranch, handleGitDeleteBranch,
  handleGitFetch, handleGitPull, handleGitPush, handleGitGetLog,
  handleGitGetBlame, handleGitStash, handleGitGetRemotes
} from './ipc/git-handlers';
import { WindowStateManager } from './services/window-state';
import { getUpdateManager, type UpdateChannel } from './services/update-manager';
import { getRecentWorkspacesManager } from './services/recent-workspaces';
import { MyersDiff } from './services/myers-diff';
import { WorkspaceEditPreviewService } from './services/workspace-edit-preview';
import { fromFileUri } from './services/lsp-path-utils';
import type { CommandExecutionOptions, ProposedDiff, PtySpawnOptions, ReplaceInFilesOptions, SearchInFilesOptions, TelemetryEvent, WorkspaceEditOrigin } from '../preload/types';
import { fileURLToPath } from 'url';

import { initAiFeatureServices, updateAiServicesWorkspace, registerAiFeatureHandlers } from './ipc/ai-features-handlers';
import { fccManager } from './services/orchestration/fcc-manager';
import { providerAutoSetup } from './services/orchestration/provider-auto-setup';
import { openKiloProvider } from './services/orchestration/openkilo-provider';
import { quotaTracker } from './services/orchestration/quota-tracker';
import { smartModelSelector } from './services/orchestration/smart-selector';
import { performanceManager } from './services/orchestration/performance-manager';
import { contextCompressor } from './services/orchestration/context-compressor';
import { moduleManager } from './services/module-manager';
import { moduleRegistry } from './services/module-registry';
import { mcpManager } from './services/mcp-manager';
import { freeProviderRegistry } from './services/providers/free-provider-registry';
import { modelClassifier } from './services/providers/model-classifier';
import { providerHealthMonitor } from './services/providers/health-monitor';
import { keyDetector, maskKey } from './services/providers/key-detector';
import { readStoredCredentials, writeStoredCredentials, encryptSecret, decryptSecret } from './ipc/settings-handlers';
import type { CustomProviderConfig, StoredKeySummary } from '../shared/types/byok';
import { opencodeIntegration } from './services/providers/opencode-integration';
import { opencodeFreeDetector } from './services/providers/opencode-free-detector';
import type { AgentFramework } from '../shared/types/opencode-sync';
import { taskClassifier } from './services/orchestration/task-classifier';
import { userPreferences } from './services/orchestration/user-preferences';
import { modelRouter } from './services/orchestration/model-router';
import type { RouterUserPreferences } from '../shared/types/model-router';
import { usageAnalytics } from './services/orchestration/usage-analytics';
import { TelemetryManager } from './services/telemetry-manager';
import type { TelemetryFeature } from '../preload/types';

import { recordLspDiagnostics } from './services/orchestration/tools/diagnostics';

let mainWindow: BrowserWindow | null = null;
let currentWorkspacePath = process.cwd();
let workspaceEditPreviewService: WorkspaceEditPreviewService | null = null;
let workspaceEditPreviewWorkspace = '';
let ipcRegistered = false;
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

export function getWorkspaceEditPreviewService(): WorkspaceEditPreviewService {
  if (!workspaceEditPreviewService || workspaceEditPreviewWorkspace !== currentWorkspacePath) {
    workspaceEditPreviewWorkspace = currentWorkspacePath;
    workspaceEditPreviewService = new WorkspaceEditPreviewService(currentWorkspacePath, getLspManager(currentWorkspacePath));
  }
  return workspaceEditPreviewService;
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

function registerIpcHandlers(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  ipcMain.handle('fs:select-workspace', async () => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    const response = await selectWorkspaceFolder(mainWindow);
    if (response.success && response.data) {
      currentWorkspacePath = response.data;
      await settingsManager.setWorkspacePath(currentWorkspacePath);
      updateAiServicesWorkspace(currentWorkspacePath);
      getRecentWorkspacesManager().addRecent(response.data);
    }
    return response;
  });
  ipcMain.handle('fs:set-workspace', async (_event, folderPath: string) => {
    if (!folderPath) return { success: false, error: 'Invalid folder path' };
    currentWorkspacePath = folderPath;
    await settingsManager.setWorkspacePath(currentWorkspacePath);
    updateAiServicesWorkspace(currentWorkspacePath);
    getRecentWorkspacesManager().addRecent(folderPath);
    return getWorkspaceTree(folderPath);
  });
  ipcMain.handle('fs:get-tree', async () => getWorkspaceTree(currentWorkspacePath));
  ipcMain.handle('fs:read-file', (_event, filePath: string) => readFile(filePath, currentWorkspacePath));
  ipcMain.handle('fs:write-file', (_event, filePath: string, content: string) => writeFile(filePath, content, currentWorkspacePath));
  ipcMain.handle('fs:create-file', (_event, filePath: string) => createFile(filePath, currentWorkspacePath));
  ipcMain.handle('fs:create-directory', (_event, dirPath: string) => createDirectory(dirPath, currentWorkspacePath));
  ipcMain.handle('fs:delete-path', (_event, targetPath: string) => deletePath(targetPath, currentWorkspacePath));
  ipcMain.handle('fs:rename-path', (_event, oldPath: string, newPath: string) => renamePath(oldPath, newPath, currentWorkspacePath));
  ipcMain.handle('fs:search-files', (_event, query: string) => searchWorkspaceFiles(currentWorkspacePath, query));
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
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    const result = await saveSettings(updates);
    if (result.success && updates?.telemetry?.enabled === false) await getTelemetryManager().clearData();
    if (result.success && updates?.['lsp.autoStart'] !== undefined) getLspManager(currentWorkspacePath).setAutoStart(updates['lsp.autoStart']);
    return result;
  });

  ipcMain.handle('agent:start-task', async (_event, params) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    const result = await startAgentTask(mainWindow, { ...params, workspacePath: currentWorkspacePath });
    if (result.success) void getTelemetryManager().recordFeatureUsed('agent_chat');
    return result;
  });
  ipcMain.handle('agent:stop-task', (_event, taskId: string) => stopAgentTask(taskId));
  ipcMain.handle('agent:respond-approval', (_event, payload: { approvalId: string; approved: boolean }) => respondAgentApproval(payload.approvalId, payload.approved));
  ipcMain.handle('user_approve_diff', (_event, payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean) => handleUserApproveDiff(payload));
  ipcMain.handle('pty:resolve-approval', (_event, payload: { approvalId: string; approved: boolean }) => resolvePtyApproval(payload.approvalId, payload.approved));
  ipcMain.handle('agent:apply-diff', (_event, diff: ProposedDiff) => applyDiff(currentWorkspacePath, diff));

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
        activeModel: 'deepseek/deepseek-r1-0528:free',
        apiKeys: { openkilo: 'anonymous' }
      });
      return { success: true, data: openKiloProvider.getStatus() };
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
      }
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
    return { success: true, data: freeProviderRegistry.getAllProviders() };
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
      const { keys } = await readStoredCredentials();
      keys[targetProvider] = detected.rawKey;
      await writeStoredCredentials(keys);

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
      return { success: true, data: key };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('byok:revoke-key', async (event, providerId: string) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const { keys } = await readStoredCredentials();
      delete keys[providerId];
      delete keys[providerId.replace('-free', '')];
      delete keys[`${providerId}-free`];
      await writeStoredCredentials(keys);
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

      const { keys } = await readStoredCredentials();
      const updatedProviders: string[] = [];
      for (const [provider, rawKey] of Object.entries(importedKeys)) {
        if (typeof rawKey === 'string' && rawKey.trim()) {
          keys[provider] = rawKey.trim();
          updatedProviders.push(provider);
        }
      }
      await writeStoredCredentials(keys);
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
        const { keys } = await readStoredCredentials();
        keys[providerId] = config.apiKey.trim();
        await writeStoredCredentials(keys);
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

  ipcMain.handle('opencode:set-framework', async (event, framework: AgentFramework) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const activeHarness = framework === 'opencode' ? 'opencode' : 'claude-code';
      await settingsManager.saveLayer('global', { activeHarness } as any);
      return { success: true, data: framework };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('opencode:get-framework', async (event) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const settings = await settingsManager.getEffectiveSettings();
      const framework: AgentFramework = settings.activeHarness === 'opencode' ? 'opencode' : 'native';
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
      const grouped = modelRouter.getCatalogGroupedByTier();
      return { success: true, data: grouped };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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

  ipcMain.handle('pty:run-command', (_event, options: CommandExecutionOptions) => runCommand({
    ...options,
    cwd: options.cwd || currentWorkspacePath
  }));
  ipcMain.handle('pty:get-shells', () => ({ success: true, data: getAvailableShells() }));
  ipcMain.handle('pty:spawn', async (_event, options: PtySpawnOptions) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    const response = await getSettings();
    const settings = response.data;
    const profile = options.profileId ? settings?.terminalProfiles?.find((item) => item.id === options.profileId) : undefined;
    if (options.profileId && !profile) return { success: false, error: 'Terminal profile not found. Refresh Settings and try again.' };
    const shellId = profile?.shellId || options.shellId || settings?.terminalProfiles?.find((item) => item.id === settings.defaultTerminalProfileId)?.shellId;
    const cwd = options.cwd || currentWorkspacePath;
    return spawnPtySession(mainWindow, { ...options, shellId, cwd }, profile?.customShellPath);
  });
  ipcMain.handle('pty:attach', (_event, ptyId: string) => attachPty(ptyId));
  ipcMain.on('pty:write', (_event, payload: { ptyId: string; data: string }) => writePty(payload.ptyId, payload.data));
  ipcMain.on('pty:resize', (_event, payload: { ptyId: string; cols: number; rows: number }) => resizePty(payload.ptyId, payload.cols, payload.rows));
  ipcMain.on('pty:sync-cwd', (_event, payload: { ptyId: string; targetCwd: string; shellId: string }) => syncPtyCwd(payload.ptyId, payload.targetCwd, payload.shellId));
  ipcMain.handle('pty:kill', (_event, ptyId: string) => killPty(ptyId));

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
  ipcMain.handle('skills:get', (_event, workspacePath: string) => getAvailableSkills(workspacePath || currentWorkspacePath));

  // Git operations always target the active workspace selected in the main process.
  // Renderer-supplied workspace paths are intentionally ignored.
  ipcMain.handle('git:is-repo', () => handleGitIsRepo(currentWorkspacePath));
  ipcMain.handle('git:init', () => handleGitInit(currentWorkspacePath));
  ipcMain.handle('git:status', () => handleGitGetStatus(currentWorkspacePath));
  ipcMain.handle('git:diff', (_event, payload?: { filePath?: string; staged?: boolean }) =>
    handleGitGetDiff(currentWorkspacePath, payload?.filePath, payload?.staged)
  );
  ipcMain.handle('git:original-content', (_event, payload: { filePath: string; staged?: boolean }) =>
    handleGitGetOriginalContent(currentWorkspacePath, payload.filePath, payload.staged)
  );
  ipcMain.handle('git:file-diff', (_event, payload: { filePath: string; staged?: boolean }) =>
    handleGitGetFileDiff(currentWorkspacePath, payload.filePath, payload.staged)
  );
  ipcMain.handle('git:stage', (_event, payload: { filePaths: string | string[] }) => handleGitStage(currentWorkspacePath, payload.filePaths));
  ipcMain.handle('git:unstage', (_event, payload: { filePaths: string | string[] }) => handleGitUnstage(currentWorkspacePath, payload.filePaths));
  ipcMain.handle('git:discard', (_event, payload: { filePath: string; isUntracked?: boolean }) =>
    handleGitDiscardChanges(currentWorkspacePath, payload.filePath, payload.isUntracked)
  );
  ipcMain.handle('git:commit', (_event, payload: { message: string; options?: { amend?: boolean } }) =>
    handleGitCommit(currentWorkspacePath, payload.message, payload.options)
  );
  ipcMain.handle('git:branches', () => handleGitGetBranches(currentWorkspacePath));
  ipcMain.handle('git:switch-branch', (_event, payload: { branchName: string }) => handleGitSwitchBranch(currentWorkspacePath, payload.branchName));
  ipcMain.handle('git:create-branch', (_event, payload: { branchName: string }) => handleGitCreateBranch(currentWorkspacePath, payload.branchName));
  ipcMain.handle('git:delete-branch', (_event, payload: { branchName: string; force?: boolean }) =>
    handleGitDeleteBranch(currentWorkspacePath, payload.branchName, payload.force)
  );
  ipcMain.handle('git:fetch', () => handleGitFetch(currentWorkspacePath));
  ipcMain.handle('git:pull', () => handleGitPull(currentWorkspacePath));
  ipcMain.handle('git:push', (_event, payload?: { remote?: string; branch?: string }) =>
    handleGitPush(currentWorkspacePath, payload?.remote, payload?.branch)
  );
  ipcMain.handle('git:log', (_event, payload?: { maxCount?: number; search?: string }) =>
    handleGitGetLog(currentWorkspacePath, payload?.maxCount, payload?.search)
  );
  ipcMain.handle('git:commit-detail', (_event, hash: string) => handleGitGetCommitDetail(currentWorkspacePath, hash));
  ipcMain.handle('git:blame', (_event, payload: { filePath: string }) => handleGitGetBlame(currentWorkspacePath, payload.filePath));
  ipcMain.handle('git:stash', (_event, payload: { action: 'list' | 'save' | 'pop' | 'drop'; message?: string; index?: number }) =>
    handleGitStash(currentWorkspacePath, payload.action, payload.message, payload.index)
  );
  ipcMain.handle('git:remotes', () => handleGitGetRemotes(currentWorkspacePath));
  ipcMain.handle('git:tags', () => handleGitGetTags(currentWorkspacePath));
  ipcMain.handle('git:create-tag', (_event, payload: { name: string; message?: string }) => handleGitCreateTag(currentWorkspacePath, payload.name, payload.message));
  ipcMain.handle('git:delete-tag', (_event, name: string) => handleGitDeleteTag(currentWorkspacePath, name));
  ipcMain.handle('git:conflict-content', (_event, filePath: string) => handleGitGetConflictContent(currentWorkspacePath, filePath));
  ipcMain.handle('git:resolve-conflict', (_event, payload: { filePath: string; action: 'ours' | 'theirs' | 'mark-resolved' }) =>
    handleGitResolveConflict(currentWorkspacePath, payload.filePath, payload.action)
  );
  ipcMain.handle('git:abort-merge', () => handleGitAbortMerge(currentWorkspacePath));
  ipcMain.handle('git:hunks', (_event, payload: { filePath: string; staged?: boolean }) => handleGitGetHunks(currentWorkspacePath, payload.filePath, payload.staged));
  ipcMain.handle('git:apply-hunk', (_event, payload: { filePath: string; hunkId: string; operation: 'stage' | 'unstage' | 'revert' }) =>
    handleGitApplyHunk(currentWorkspacePath, payload.filePath, payload.hunkId, payload.operation)
  );
  ipcMain.handle('git:merge', (_event, branchName: string) => handleGitMerge(currentWorkspacePath, branchName));

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
      version: app?.getVersion ? app.getVersion() : '0.1.0',
      platform: process.platform,
      arch: process.arch,
      isPackaged: Boolean(app?.isPackaged)
    }
  }));

  // Phase 7: Advanced AI Features & Competitive Differentiation
  initAiFeatureServices(currentWorkspacePath);
  registerAiFeatureHandlers(() => { void getTelemetryManager().recordFeatureUsed('project_index'); });

  // Phase 5.2: FCC Server Integration (Layer 3)
  registerFccHandlers();

  // Phase 2.1: Provider Onboarding & Dynamic Discovery
  registerProviderHandlers();
}

function registerProviderHandlers(): void {
  ipcMain.handle('provider:get-registry', async () => {
    try {
      const merged = await opencodeIntegration.getMergedProviders();
      return { success: true, data: merged };
    } catch {
      return { success: true, data: PRECONFIGURED_PROVIDERS };
    }
  });

  ipcMain.handle('provider:get-models', async (event, payload: { providerId: string; apiKey?: string; customEndpoint?: string }) => {
    if (!isTrustedExtensionFrame(event)) return { success: false, error: 'Untrusted renderer frame.' };
    try {
      const models = await ProviderGateway.getAvailableModels(payload.providerId, payload.apiKey, payload.customEndpoint);
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
  ipcMain.handle('fcc:start', async () => ({ success: true, data: await fccManager.start() }));
  ipcMain.handle('fcc:stop', async () => { await fccManager.stop(); return { success: true }; });
  ipcMain.handle('fcc:restart', async () => ({ success: true, data: await fccManager.restart() }));
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
}

function cleanupAllResources(): void {
  cleanupAllPtys();
  try {
    getLspManager().cleanupAll();
  } catch {
    // Ignore cleanup error
  }
  try {
    void fccManager.stop();
  } catch {
    // Ignore FCC cleanup error
  }
  try {
    providerHealthMonitor.stopMonitoring();
  } catch {
    // Ignore monitor cleanup error
  }
  try {
    opencodeIntegration.stopConfigWatcher();
  } catch {
    // Ignore OpenCode watcher cleanup error
  }
}

function createWindow(): void {
  const savedState = windowStateManager.getState();

  const window = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1020,
    minHeight: 680,
    title: 'Ty-Code - Desktop AI Coding Assistant',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
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
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await settingsManager.setWorkspacePath(currentWorkspacePath);
  void getTelemetryManager().recordAppStarted();
  registerIpcHandlers();
  createWindow();
  void fccManager.start();
  providerHealthMonitor.startMonitoring();
  void opencodeIntegration.startConfigWatcher();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', cleanupAllResources);
app.on('window-all-closed', () => {
  cleanupAllResources();
  if (process.platform !== 'darwin') app.quit();
});

