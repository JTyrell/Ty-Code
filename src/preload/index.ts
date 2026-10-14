import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  ElectronAPI,
  ProposedDiff,
  CommandExecutionOptions,
  PtySpawnOptions
} from './types';

const api: ElectronAPI = {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Workspace & File System
  selectWorkspaceFolder: () => ipcRenderer.invoke('fs:select-workspace'),
  getWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('fs:get-tree', rootPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:create-directory', dirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:delete-path', targetPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename-path', oldPath, newPath),
  searchFiles: (query: string) => ipcRenderer.invoke('fs:search-files', query),

  // Settings & SafeStorage
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Agentic AI Engine
  startAgentTask: (params) => ipcRenderer.invoke('agent:start-task', params),
  stopAgentTask: (taskId: string) => ipcRenderer.invoke('agent:stop-task', taskId),
  onAgentStream: (callback) => {
    const listener = (_event: IpcRendererEvent, chunk: any) => callback(chunk);
    ipcRenderer.on('agent:stream', listener);
    return () => {
      ipcRenderer.removeListener('agent:stream', listener);
    };
  },
  applyDiff: (diff: ProposedDiff) => ipcRenderer.invoke('agent:apply-diff', diff),

  // Terminal & Command Execution (One-shot)
  runCommand: (options: CommandExecutionOptions) => ipcRenderer.invoke('pty:run-command', options),

  // Interactive OS PTY Terminal
  getAvailableShells: () => ipcRenderer.invoke('pty:get-shells'),
  spawnPty: (options: PtySpawnOptions) => ipcRenderer.invoke('pty:spawn', options),
  writePty: (ptyId: string, data: string) => ipcRenderer.send('pty:write', { ptyId, data }),
  resizePty: (ptyId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { ptyId, cols, rows }),
  killPty: (ptyId: string) => ipcRenderer.invoke('pty:kill', ptyId),
  onPtyData: (ptyId: string, callback: (data: string) => void) => {
    const channel = `pty:data:${ptyId}`;
    const listener = (_event: IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  onPtyExit: (ptyId: string, callback: (exitCode: number) => void) => {
    const channel = `pty:exit:${ptyId}`;
    const listener = (_event: IpcRendererEvent, exitCode: number) => callback(exitCode);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  // VS Code Open VSX Extensions
  searchExtensions: (query: string) => ipcRenderer.invoke('extensions:search', query),
  getExtensionDetails: (namespace: string, name: string) => ipcRenderer.invoke('extensions:details', { namespace, name }),

  // Antigravity Skills
  getAvailableSkills: (workspacePath: string) => ipcRenderer.invoke('antigravity:get-skills', workspacePath)
};

contextBridge.exposeInMainWorld('electronAPI', api);
