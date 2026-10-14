import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import {
  selectWorkspaceFolder, getWorkspaceTree, readFile, writeFile, createFile,
  createDirectory, deletePath, renamePath, searchWorkspaceFiles,
  searchInWorkspaceFiles, replaceInWorkspaceFiles, type ReplaceInFilesOptions
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
import { getSettings, saveSettings } from './ipc/settings-handlers';
import { startAgentTask, stopAgentTask, respondAgentApproval, applyDiff } from './ipc/agent-handlers';
import {
  runCommand, getAvailableShells, spawnPtySession, attachPty, writePty,
  resizePty, syncPtyCwd, killPty, cleanupAllPtys
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
import type { CommandExecutionOptions, ProposedDiff, PtySpawnOptions, SearchInFilesOptions, WorkspaceEditOrigin } from '../preload/types';
import { fileURLToPath } from 'url';

let mainWindow: BrowserWindow | null = null;
let currentWorkspacePath = process.cwd();
let workspaceEditPreviewService: WorkspaceEditPreviewService | null = null;
let workspaceEditPreviewWorkspace = '';
let ipcRegistered = false;

function getWorkspaceEditPreviewService(): WorkspaceEditPreviewService {
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
      getRecentWorkspacesManager().addRecent(response.data);
    }
    return response;
  });
  ipcMain.handle('fs:set-workspace', async (_event, folderPath: string) => {
    if (!folderPath) return { success: false, error: 'Invalid folder path' };
    currentWorkspacePath = folderPath;
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
      return { success: true, data: await getWorkspaceEditPreviewService().createSearchReplacePreview(options) };
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
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_event, updates) => saveSettings(updates));

  ipcMain.handle('agent:start-task', (_event, params) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    return startAgentTask(mainWindow, { ...params, workspacePath: currentWorkspacePath });
  });
  ipcMain.handle('agent:stop-task', (_event, taskId: string) => stopAgentTask(taskId));
  ipcMain.handle('agent:respond-approval', (_event, payload: { approvalId: string; approved: boolean }) => respondAgentApproval(payload.approvalId, payload.approved));
  ipcMain.handle('agent:apply-diff', (_event, diff: ProposedDiff) => applyDiff(currentWorkspacePath, diff));

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
  ipcMain.handle('antigravity:get-skills', (_event, workspacePath: string) => getAvailableSkills(workspacePath || currentWorkspacePath));

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
  ipcMain.handle('lsp:get-servers', () => handleGetLspServers(currentWorkspacePath));
  ipcMain.handle('lsp:start-server', (_event, languageId: string) => handleStartLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:stop-server', (_event, languageId: string) => handleStopLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:restart-server', (_event, languageId: string) => handleRestartLspServer(languageId, currentWorkspacePath));
  ipcMain.handle('lsp:configure-server', (_event, payload: { languageId: string; config: any }) =>
    handleConfigureLspServer(payload.languageId, payload.config, currentWorkspacePath)
  );
  ipcMain.handle('lsp:did-open', (_event, payload: { filePath: string; languageId: string; text: string }) =>
    handleLspDidOpen(payload, currentWorkspacePath)
  );
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
  ipcMain.handle('lsp:rename-preview', async (_event, payload: { filePath: string; line: number; character: number; newName: string }) => {
    try {
      const result = await handleLspRename(payload, currentWorkspacePath);
      if (!result.success || !result.data) return { success: false, error: result.error || 'The language server returned no rename edits.' };
      const preview = await getWorkspaceEditPreviewService().createLspPreview(result.data, `Rename to “${payload.newName}”`);
      return { success: true, data: preview };
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
  ipcMain.handle('update:set-channel', (_event, channel: UpdateChannel) => {
    getUpdateManager().setChannel(channel);
    return { success: true };
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
    const result = MyersDiff.diff(payload.original || '', payload.modified || '', payload.contextLines ?? 3);
    return { success: true, data: result };
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
}

function cleanupAllResources(): void {
  cleanupAllPtys();
  try {
    getLspManager().cleanupAll();
  } catch {
    // Ignore cleanup error
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', cleanupAllResources);
app.on('window-all-closed', () => {
  cleanupAllResources();
  if (process.platform !== 'darwin') app.quit();
});

