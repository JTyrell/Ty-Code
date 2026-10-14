import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AgentStreamChunk, CommandExecutionOptions, ElectronAPI, ExtensionMetadata, ProposedDiff, PtySpawnOptions } from './types';

const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  selectWorkspaceFolder: () => ipcRenderer.invoke('fs:select-workspace'),
  getWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('fs:get-tree', rootPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:create-directory', dirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:delete-path', targetPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename-path', oldPath, newPath),
  searchFiles: (query: string) => ipcRenderer.invoke('fs:search-files', query),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  startAgentTask: (params) => ipcRenderer.invoke('agent:start-task', params),
  stopAgentTask: (taskId: string) => ipcRenderer.invoke('agent:stop-task', taskId),
  respondAgentApproval: (approvalId: string, approved: boolean) => ipcRenderer.invoke('agent:respond-approval', { approvalId, approved }),
  onAgentStream: (callback) => {
    const listener = (_event: IpcRendererEvent, chunk: AgentStreamChunk) => callback(chunk);
    ipcRenderer.on('agent:stream', listener);
    return () => ipcRenderer.removeListener('agent:stream', listener);
  },
  applyDiff: (diff: ProposedDiff) => ipcRenderer.invoke('agent:apply-diff', diff),
  runCommand: (options: CommandExecutionOptions) => ipcRenderer.invoke('pty:run-command', options),
  getAvailableShells: () => ipcRenderer.invoke('pty:get-shells'),
  spawnPty: (options: PtySpawnOptions) => ipcRenderer.invoke('pty:spawn', options),
  attachPty: (ptyId: string) => ipcRenderer.invoke('pty:attach', ptyId),
  writePty: (ptyId: string, data: string) => ipcRenderer.send('pty:write', { ptyId, data }),
  resizePty: (ptyId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { ptyId, cols, rows }),
  syncPtyCwd: (ptyId: string, targetCwd: string, shellId: string) => ipcRenderer.send('pty:sync-cwd', { ptyId, targetCwd, shellId }),
  killPty: (ptyId: string) => ipcRenderer.invoke('pty:kill', ptyId),
  onPtyData: (ptyId: string, callback: (data: string) => void) => {
    const channel = `pty:data:${ptyId}`;
    const listener = (_event: IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyExit: (ptyId: string, callback: (exitCode: number) => void) => {
    const channel = `pty:exit:${ptyId}`;
    const listener = (_event: IpcRendererEvent, exitCode: number) => callback(exitCode);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  searchExtensions: (query: string) => ipcRenderer.invoke('extensions:search', query),
  getExtensionDetails: (namespace: string, name: string) => ipcRenderer.invoke('extensions:details', { namespace, name }),
  getAvailableSkills: (workspacePath: string) => ipcRenderer.invoke('antigravity:get-skills', workspacePath),
  getInstalledExtensions: () => ipcRenderer.invoke('extensions:get-installed'),
  installExtension: (ext: ExtensionMetadata) => ipcRenderer.invoke('extensions:install', ext),
  uninstallExtension: (id: string) => ipcRenderer.invoke('extensions:uninstall', id),
  toggleExtension: (id: string, enabled: boolean) => ipcRenderer.invoke('extensions:toggle', { id, enabled }),
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => ipcRenderer.invoke('extensions:update-settings', { id, settings }),
  installExtensionFromVsix: () => ipcRenderer.invoke('extensions:install-vsix'),
  extensionCapability: (request) => ipcRenderer.invoke('extensions:capability', request),

  // Git APIs always use the active workspace selected in the main process.
  gitIsRepo: () => ipcRenderer.invoke('git:is-repo'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitGetStatus: () => ipcRenderer.invoke('git:status'),
  gitGetDiff: (filePath?: string, staged?: boolean) => ipcRenderer.invoke('git:diff', { filePath, staged }),
  gitGetOriginalContent: (filePath: string, staged?: boolean) => ipcRenderer.invoke('git:original-content', { filePath, staged }),
  gitStage: (filePaths: string | string[]) => ipcRenderer.invoke('git:stage', { filePaths }),
  gitUnstage: (filePaths: string | string[]) => ipcRenderer.invoke('git:unstage', { filePaths }),
  gitDiscardChanges: (filePath: string, isUntracked?: boolean) => ipcRenderer.invoke('git:discard', { filePath, isUntracked }),
  gitCommit: (message: string, options?: { amend?: boolean }) => ipcRenderer.invoke('git:commit', { message, options }),
  gitGetBranches: () => ipcRenderer.invoke('git:branches'),
  gitSwitchBranch: (branchName: string) => ipcRenderer.invoke('git:switch-branch', { branchName }),
  gitCreateBranch: (branchName: string) => ipcRenderer.invoke('git:create-branch', { branchName }),
  gitDeleteBranch: (branchName: string, force?: boolean) => ipcRenderer.invoke('git:delete-branch', { branchName, force }),
  gitFetch: () => ipcRenderer.invoke('git:fetch'),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPush: (remote?: string, branch?: string) => ipcRenderer.invoke('git:push', { remote, branch }),
  gitGetLog: (maxCount?: number, search?: string) => ipcRenderer.invoke('git:log', { maxCount, search }),
  gitGetBlame: (filePath: string) => ipcRenderer.invoke('git:blame', { filePath }),
  gitStash: (action: 'list' | 'save' | 'pop' | 'drop', message?: string, index?: number) => ipcRenderer.invoke('git:stash', { action, message, index }),
  gitGetRemotes: () => ipcRenderer.invoke('git:remotes'),
  gitGetFileDiff: (filePath: string, staged?: boolean) => ipcRenderer.invoke('git:file-diff', { filePath, staged }),
  gitGetCommitDetail: (hash: string) => ipcRenderer.invoke('git:commit-detail', hash),
  gitGetTags: () => ipcRenderer.invoke('git:tags'),
  gitCreateTag: (name: string, message?: string) => ipcRenderer.invoke('git:create-tag', { name, message }),
  gitDeleteTag: (name: string) => ipcRenderer.invoke('git:delete-tag', name),
  gitGetConflictContent: (filePath: string) => ipcRenderer.invoke('git:conflict-content', filePath),
  gitResolveConflict: (filePath: string, action: 'ours' | 'theirs' | 'mark-resolved') => ipcRenderer.invoke('git:resolve-conflict', { filePath, action }),
  gitAbortMerge: () => ipcRenderer.invoke('git:abort-merge'),
  gitGetHunks: (filePath: string, staged?: boolean) => ipcRenderer.invoke('git:hunks', { filePath, staged }),
  gitApplyHunk: (filePath: string, hunkId: string, operation: 'stage' | 'unstage' | 'revert') => ipcRenderer.invoke('git:apply-hunk', { filePath, hunkId, operation }),
  gitMerge: (branchName: string) => ipcRenderer.invoke('git:merge', branchName),

  // Search & Replace APIs
  searchInFiles: (options: any) => ipcRenderer.invoke('fs:search-in-files', options),
  replaceInFiles: (options: any) => ipcRenderer.invoke('fs:replace-in-files', options),
  previewReplace: (options: any) => ipcRenderer.invoke('fs:preview-replace', options),
  applyWorkspaceEdit: (previewId: string) => ipcRenderer.invoke('workspace-edit:apply', previewId),
  previewLspWorkspaceEdit: (params: { edit: unknown; title: string; origin: 'lsp-rename' | 'refactor'; forcePreview?: boolean }) => ipcRenderer.invoke('workspace-edit:preview-lsp', params),
  cancelWorkspaceEdit: (previewId: string) => ipcRenderer.invoke('workspace-edit:cancel', previewId),
  undoWorkspaceEdit: (transactionId?: string) => ipcRenderer.invoke('workspace-edit:undo', transactionId),
  getRecentWorkspaceEdits: () => ipcRenderer.invoke('workspace-edit:recent-undo'),

  // Language Server Protocol (LSP) APIs
  lspGetServers: () => ipcRenderer.invoke('lsp:get-servers'),
  lspStartServer: (languageId: string) => ipcRenderer.invoke('lsp:start-server', languageId),
  lspStopServer: (languageId: string) => ipcRenderer.invoke('lsp:stop-server', languageId),
  lspRestartServer: (languageId: string) => ipcRenderer.invoke('lsp:restart-server', languageId),
  lspConfigureServer: (languageId: string, config: any) => ipcRenderer.invoke('lsp:configure-server', { languageId, config }),
  lspDidOpen: (params: { filePath: string; languageId: string; text: string }) => ipcRenderer.invoke('lsp:did-open', params),
  lspDidChange: (params: { filePath: string; text: string }) => ipcRenderer.invoke('lsp:did-change', params),
  lspDidSave: (params: { filePath: string; text?: string }) => ipcRenderer.invoke('lsp:did-save', params),
  lspDidClose: (params: { filePath: string }) => ipcRenderer.invoke('lsp:did-close', params),
  lspCompletion: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:completion', params),
  lspHover: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:hover', params),
  lspDefinition: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:definition', params),
  lspTypeDefinition: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:type-definition', params),
  lspImplementation: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:implementation', params),
  lspReferences: (params: { filePath: string; line: number; character: number; includeDeclaration?: boolean }) => ipcRenderer.invoke('lsp:references', params),
  lspRename: (params: { filePath: string; line: number; character: number; newName: string }) => ipcRenderer.invoke('lsp:rename', params),
  lspRenamePreview: (params: { filePath: string; line: number; character: number; newName: string; forcePreview?: boolean }) => ipcRenderer.invoke('lsp:rename-preview', params),
  lspDocumentSymbols: (params: { filePath: string }) => ipcRenderer.invoke('lsp:document-symbols', params),
  lspWorkspaceSymbols: (params: { query: string }) => ipcRenderer.invoke('lsp:workspace-symbols', params),
  lspCodeActions: (params: { filePath: string; range: any; context?: any }) => ipcRenderer.invoke('lsp:code-actions', params),
  lspSignatureHelp: (params: { filePath: string; line: number; character: number }) => ipcRenderer.invoke('lsp:signature-help', params),
  onLspDiagnostics: (callback: (event: any) => void) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on('lsp:diagnostics', listener);
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener);
  },

  // Workspace & Navigation
  setWorkspaceFolder: (folderPath: string) => ipcRenderer.invoke('fs:set-workspace', folderPath),
  getRecentWorkspaces: () => ipcRenderer.invoke('workspace:get-recent'),
  addRecentWorkspace: (folderPath: string) => ipcRenderer.invoke('workspace:add-recent', folderPath),
  clearRecentWorkspaces: () => ipcRenderer.invoke('workspace:clear-recent'),

  // Auto-Update APIs
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateChannel: () => ipcRenderer.invoke('update:get-channel'),
  setUpdateChannel: (channel: string) => ipcRenderer.invoke('update:set-channel', channel),
  onUpdateStatus: (callback: (status: any) => void) => {
    const channels = ['update:checking', 'update:available', 'update:not-available', 'update:downloaded', 'update:error'];
    const listeners: Array<{ channel: string; listener: (event: any, data: any) => void }> = [];
    for (const ch of channels) {
      const type = ch.replace('update:', '');
      const listener = (_event: any, data: any) => callback({ type, ...data });
      ipcRenderer.on(ch, listener);
      listeners.push({ channel: ch, listener });
    }
    return () => {
      for (const { channel, listener } of listeners) {
        ipcRenderer.removeListener(channel, listener);
      }
    };
  },
  onUpdateProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('update:download-progress', listener);
    return () => ipcRenderer.removeListener('update:download-progress', listener);
  },

  // Myers Diff & App Info
  computeMyersDiff: (params: { original: string; modified: string; contextLines?: number }) =>
    ipcRenderer.invoke('diff:compute-myers', params),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),

  // Phase 7: Advanced AI Features & Competitive Differentiation
  getInlineCompletions: (params) => ipcRenderer.invoke('ai:inline-completions', params),
  indexProject: (workspacePath) => ipcRenderer.invoke('ai:index-project', workspacePath),
  getProjectIndexStats: () => ipcRenderer.invoke('ai:get-project-index-stats'),
  queryProjectContext: (query) => ipcRenderer.invoke('ai:query-project-context', query),
  runCodeReview: (params) => ipcRenderer.invoke('ai:run-code-review', params),
  getCodeReviewRules: () => ipcRenderer.invoke('ai:get-code-review-rules'),
  updateCodeReviewRules: (rules) => ipcRenderer.invoke('ai:update-code-review-rules', rules),
  requestRefactorPreview: (request) => ipcRenderer.invoke('ai:request-refactor-preview', request),
  generateCodeFromPrompt: (request) => ipcRenderer.invoke('ai:generate-code', request),
  parseNaturalLanguageCommand: (request) => ipcRenderer.invoke('ai:parse-nl-command', request),
  getConversationMemories: (query) => ipcRenderer.invoke('ai:get-memories', query),
  addConversationMemory: (memory) => ipcRenderer.invoke('ai:add-memory', memory),
  getPairProgrammingSuggestions: (event) => ipcRenderer.invoke('ai:pair-suggestions', event)
};

contextBridge.exposeInMainWorld('electronAPI', api);
