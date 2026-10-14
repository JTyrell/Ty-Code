import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import {
  selectWorkspaceFolder,
  getWorkspaceTree,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deletePath,
  renamePath,
  searchWorkspaceFiles
} from './ipc/fs-handlers';
import { getSettings, saveSettings } from './ipc/settings-handlers';
import { startAgentTask, stopAgentTask, applyDiff } from './ipc/agent-handlers';
import {
  runCommand,
  getAvailableShells,
  spawnPtySession,
  writePty,
  resizePty,
  killPty,
  cleanupAllPtys
} from './ipc/pty-handlers';
import { searchOpenVsxExtensions, getOpenVsxExtensionDetails } from './ipc/extensions-handlers';
import { getAvailableSkills } from './ipc/skills-handlers';
import type { CommandExecutionOptions, ProposedDiff, PtySpawnOptions } from '../preload/types';

let mainWindow: BrowserWindow | null = null;
let currentWorkspacePath = process.cwd();

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Workspace & FS IPC
  ipcMain.handle('fs:select-workspace', async () => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    const res = await selectWorkspaceFolder(mainWindow);
    if (res.success && res.data) {
      currentWorkspacePath = res.data;
    }
    return res;
  });

  ipcMain.handle('fs:get-tree', async (_event, rootPath: string) => {
    const target = rootPath || currentWorkspacePath;
    currentWorkspacePath = target;
    return getWorkspaceTree(target);
  });

  ipcMain.handle('fs:read-file', (_event, filePath: string) => readFile(filePath));
  ipcMain.handle('fs:write-file', (_event, filePath: string, content: string) => writeFile(filePath, content));
  ipcMain.handle('fs:create-file', (_event, filePath: string) => createFile(filePath));
  ipcMain.handle('fs:create-directory', (_event, dirPath: string) => createDirectory(dirPath));
  ipcMain.handle('fs:delete-path', (_event, targetPath: string) => deletePath(targetPath));
  ipcMain.handle('fs:rename-path', (_event, oldPath: string, newPath: string) => renamePath(oldPath, newPath));
  ipcMain.handle('fs:search-files', (_event, query: string) => searchWorkspaceFiles(currentWorkspacePath, query));

  // Settings IPC
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_event, updates) => saveSettings(updates));

  // Agent IPC
  ipcMain.handle('agent:start-task', (_event, params) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    return startAgentTask(mainWindow, params);
  });
  ipcMain.handle('agent:stop-task', (_event, taskId: string) => stopAgentTask(taskId));
  ipcMain.handle('agent:apply-diff', (_event, diff: ProposedDiff) => applyDiff(currentWorkspacePath, diff));

  // Terminal (One-shot)
  ipcMain.handle('pty:run-command', (_event, options: CommandExecutionOptions) => {
    return runCommand({
      ...options,
      cwd: options.cwd || currentWorkspacePath
    });
  });

  // Interactive OS PTY Terminal
  ipcMain.handle('pty:get-shells', () => {
    return { success: true, data: getAvailableShells() };
  });

  ipcMain.handle('pty:spawn', (_event, options: PtySpawnOptions) => {
    if (!mainWindow) return { success: false, error: 'No main window' };
    return spawnPtySession(mainWindow, {
      ...options,
      cwd: options.cwd || currentWorkspacePath
    });
  });

  ipcMain.on('pty:write', (_event, { ptyId, data }) => writePty(ptyId, data));
  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => resizePty(ptyId, cols, rows));
  ipcMain.handle('pty:kill', (_event, ptyId: string) => killPty(ptyId));

  // VS Code Open VSX Extensions
  ipcMain.handle('extensions:search', (_event, query: string) => searchOpenVsxExtensions(query));
  ipcMain.handle('extensions:details', (_event, { namespace, name }) => getOpenVsxExtensionDetails(namespace, name));

  // Antigravity Skills
  ipcMain.handle('antigravity:get-skills', (_event, wsPath: string) => getAvailableSkills(wsPath || currentWorkspacePath));

  // Load renderer
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupAllPtys();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
