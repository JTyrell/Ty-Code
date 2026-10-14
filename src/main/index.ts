import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import {
  selectWorkspaceFolder, getWorkspaceTree, readFile, writeFile, createFile,
  createDirectory, deletePath, renamePath, searchWorkspaceFiles,
  searchInWorkspaceFiles, replaceInWorkspaceFiles, type SearchInFilesOptions, type ReplaceInFilesOptions
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
import { startAgentTask, stopAgentTask, applyDiff } from './ipc/agent-handlers';
import {
  runCommand, getAvailableShells, spawnPtySession, attachPty, writePty,
  resizePty, syncPtyCwd, killPty, cleanupAllPtys
} from './ipc/pty-handlers';
import {
  searchOpenVsxExtensions, getOpenVsxExtensionDetails, handleGetInstalledExtensions,
  handleInstallExtension, handleUninstallExtension, handleToggleExtension,
  handleUpdateExtensionSettings, handleInstallExtensionFromVsix
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
import type { CommandExecutionOptions, ExtensionMetadata, ProposedDiff, PtySpawnOptions } from '../preload/types';

let mainWindow: BrowserWindow | null = null;
let currentWorkspacePath = process.cwd();
let ipcRegistered = false;

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
    if (response.success && response.data) currentWorkspacePath = response.data;
    return response;
  });
  ipcMain.handle('fs:get-tree', async (_event, rootPath: string) => {
    currentWorkspacePath = rootPath || currentWorkspacePath;
    return getWorkspaceTree(currentWorkspacePath);
  });
  ipcMain.handle('fs:read-file', (_event, filePath: string) => readFile(filePath));
  ipcMain.handle('fs:write-file', (_event, filePath: string, content: string) => writeFile(filePath, content));
  ipcMain.handle('fs:create-file', (_event, filePath: string) => createFile(filePath));
  ipcMain.handle('fs:create-directory', (_event, dirPath: string) => createDirectory(dirPath));
  ipcMain.handle('fs:delete-path', (_event, targetPath: string) => deletePath(targetPath));
  ipcMain.handle('fs:rename-path', (_event, oldPath: string, newPath: string) => renamePath(oldPath, newPath));
  ipcMain.handle('fs:search-files', (_event, query: string) => searchWorkspaceFiles(currentWorkspacePath, query));
  ipcMain.handle('fs:search-in-files', (_event, options: SearchInFilesOptions) => searchInWorkspaceFiles(currentWorkspacePath, options));
  ipcMain.handle('fs:replace-in-files', (_event, options: ReplaceInFilesOptions) => replaceInWorkspaceFiles(currentWorkspacePath, options));
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_event, updates) => saveSettings(updates));

  ipcMain.handle('agent:start-task', (_event, params) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    return startAgentTask(mainWindow, params);
  });
  ipcMain.handle('agent:stop-task', (_event, taskId: string) => stopAgentTask(taskId));
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

  ipcMain.handle('extensions:search', (_event, query: string) => searchOpenVsxExtensions(query));
  ipcMain.handle('extensions:details', (_event, { namespace, name }) => getOpenVsxExtensionDetails(namespace, name));
  ipcMain.handle('extensions:get-installed', () => handleGetInstalledExtensions());
  ipcMain.handle('extensions:install', (_event, ext: ExtensionMetadata) => handleInstallExtension(ext));
  ipcMain.handle('extensions:uninstall', (_event, id: string) => handleUninstallExtension(id));
  ipcMain.handle('extensions:toggle', (_event, { id, enabled }: { id: string; enabled: boolean }) => handleToggleExtension(id, enabled));
  ipcMain.handle('extensions:update-settings', (_event, { id, settings }: { id: string; settings: Record<string, unknown> }) => handleUpdateExtensionSettings(id, settings));
  ipcMain.handle('extensions:install-vsix', () => handleInstallExtensionFromVsix(mainWindow || undefined));
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
  const window = new BrowserWindow({
    width: 1450,
    height: 920,
    minWidth: 1020,
    minHeight: 680,
    title: 'Ty-Claude - Desktop AI Coding Assistant',
    backgroundColor: '#121316',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', cleanupAllResources);
app.on('window-all-closed', () => {
  cleanupAllResources();
  if (process.platform !== 'darwin') app.quit();
});

