import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  ElectronAPI,
  IpcResponse,
  FileNode,
  ProviderSettings,
  ChatMessage,
  AgentStreamChunk,
  ProposedDiff,
  CommandExecutionOptions,
  CommandResult
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

  // Settings & SafeStorage
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<ProviderSettings>) => ipcRenderer.invoke('settings:save', settings),

  // Agentic AI Engine
  startAgentTask: (params) => ipcRenderer.invoke('agent:start-task', params),
  stopAgentTask: (taskId: string) => ipcRenderer.invoke('agent:stop-task', taskId),
  onAgentStream: (callback: (chunk: AgentStreamChunk) => void) => {
    const listener = (_event: IpcRendererEvent, chunk: AgentStreamChunk) => callback(chunk);
    ipcRenderer.on('agent:stream', listener);
    return () => {
      ipcRenderer.removeListener('agent:stream', listener);
    };
  },
  applyDiff: (diff: ProposedDiff) => ipcRenderer.invoke('agent:apply-diff', diff),

  // Terminal & Shell Execution
  runCommand: (options: CommandExecutionOptions) => ipcRenderer.invoke('pty:run-command', options)
};

contextBridge.exposeInMainWorld('electronAPI', api);
