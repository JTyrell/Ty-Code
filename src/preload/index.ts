import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AgentStreamChunk, CommandExecutionOptions, ElectronAPI, ExtensionMetadata, ProposedDiff, PtySpawnOptions } from './types';

const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_: IpcRendererEvent, isMax: boolean) => callback(isMax);
    ipcRenderer.on('window:maximize-change', handler);
    return () => ipcRenderer.removeListener('window:maximize-change', handler);
  },
  selectWorkspaceFolder: () => ipcRenderer.invoke('fs:select-workspace'),
  getFilePathForDroppedFile: (file) => webUtils.getPathForFile(file),
  getWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('fs:get-tree', rootPath),
  getWorkspaceTreeChunked: (rootPath: string) => ipcRenderer.invoke('fs:get-tree-chunked', rootPath),
  onTreeChunk: (callback) => {
    const handler = (_: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('fs:tree-chunk', handler);
    return () => ipcRenderer.removeListener('fs:tree-chunk', handler);
  },
  onTreeUpdated: (callback) => {
    const handler = (_: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('fs:tree-updated', handler);
    return () => ipcRenderer.removeListener('fs:tree-updated', handler);
  },
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:create-directory', dirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:delete-path', targetPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename-path', oldPath, newPath),
  searchFiles: (query: string) => ipcRenderer.invoke('fs:search-files', query),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getTelemetryPreview: () => ipcRenderer.invoke('telemetry:get-preview'),
  deleteTelemetryEvent: (index, expected) => ipcRenderer.invoke('telemetry:delete-event', { index, expected }),
  clearTelemetryData: () => ipcRenderer.invoke('telemetry:clear-data'),
  getCredentialStorageStatus: () => ipcRenderer.invoke('credentials:get-storage-status'),
  onTelemetryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('telemetry:changed', listener);
    return () => ipcRenderer.removeListener('telemetry:changed', listener);
  },
  getSettingsLayer: (scope) => ipcRenderer.invoke('settings:layer:get', scope),
  saveSettingsLayer: (scope, settings) => ipcRenderer.invoke('settings:layer:save', { scope, settings }),
  getSecurityPolicy: () => ipcRenderer.invoke('settings:security:get'),
  saveSecurityPolicy: (policy) => ipcRenderer.invoke('settings:security:save', policy),
  onSettingsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  startAgentTask: (params) => {
    console.log('Preload: Forwarding to main', params?.taskId);
    if (params?.traceId) {
      ipcRenderer.invoke('diagnostics:record-trace-hop', {
        traceId: params.traceId,
        hop: 'H2',
        status: 'PASS',
        payloadSize: JSON.stringify(params).length,
        metadata: {
          taskId: params.taskId,
          promptSize: params.prompt?.length || 0,
          workspacePath: params.workspacePath
        }
      }).catch(() => {});
    }
    return ipcRenderer.invoke('agent:start-task', params);
  },
  stopAgentTask: (taskId: string) => ipcRenderer.invoke('agent:stop-task', taskId),
  respondAgentApproval: (approvalId: string, approved: boolean) => ipcRenderer.invoke('agent:respond-approval', { approvalId, approved }),
  userApproveDiff: (payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean) => ipcRenderer.invoke('user_approve_diff', payload),
  onAgentStream: (callback) => {
    const listener = (_event: IpcRendererEvent, chunk: AgentStreamChunk) => callback(chunk);
    ipcRenderer.on('agent:stream', listener);
    return () => ipcRenderer.removeListener('agent:stream', listener);
  },
  onAgentStreamToken: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:stream-token', listener);
    return () => ipcRenderer.removeListener('agent:stream-token', listener);
  },
  onAgentReasoningToken: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:reasoning-token', listener);
    return () => ipcRenderer.removeListener('agent:reasoning-token', listener);
  },
  onAgentToolStart: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:tool-start', listener);
    return () => ipcRenderer.removeListener('agent:tool-start', listener);
  },
  onAgentToolResult: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:tool-result', listener);
    return () => ipcRenderer.removeListener('agent:tool-result', listener);
  },
  onAgentDiffProposed: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:diff-proposed', listener);
    return () => ipcRenderer.removeListener('agent:diff-proposed', listener);
  },
  onAgentDone: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:done', listener);
    return () => ipcRenderer.removeListener('agent:done', listener);
  },
  onAgentError: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:error', listener);
    return () => ipcRenderer.removeListener('agent:error', listener);
  },
  applyDiff: (diff: ProposedDiff) => ipcRenderer.invoke('agent:apply-diff', diff),
  resolvePtyApproval: (approvalId: string, approved: boolean) => ipcRenderer.invoke('pty:resolve-approval', { approvalId, approved }),
  onPtyApprovalRequired: (callback: (data: { approvalId: string; ptyId: string; command: string; reason: string }) => void) => {
    const listener = (_event: IpcRendererEvent, data: { approvalId: string; ptyId: string; command: string; reason: string }) => callback(data);
    ipcRenderer.on('pty:approval-required', listener);
    return () => ipcRenderer.removeListener('pty:approval-required', listener);
  },
  onPtyCommandBlocked: (callback: (data: { ptyId: string; command: string; reason: string }) => void) => {
    const listener = (_event: IpcRendererEvent, data: { ptyId: string; command: string; reason: string }) => callback(data);
    ipcRenderer.on('pty:command-blocked', listener);
    return () => ipcRenderer.removeListener('pty:command-blocked', listener);
  },
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
  getAvailableSkills: (workspacePath: string) => ipcRenderer.invoke('skills:get', workspacePath),

  // Open VSX Marketplace APIs
  marketplaceSearch: (options) => ipcRenderer.invoke('marketplace:search', options),
  marketplaceMetadata: (namespace, extension) => ipcRenderer.invoke('marketplace:metadata', { namespace, extension }),
  marketplaceInstall: (entry) => ipcRenderer.invoke('marketplace:install', entry),
  marketplaceUninstall: (id) => ipcRenderer.invoke('marketplace:uninstall', id),
  marketplaceListInstalled: () => ipcRenderer.invoke('marketplace:list-installed'),
  onMarketplaceInstallProgress: (callback) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('marketplace:install-progress', listener);
    return () => ipcRenderer.removeListener('marketplace:install-progress', listener);
  },
  marketplaceTraceInstall: (extensionId?: string) => ipcRenderer.invoke('marketplace:trace-extension-install', extensionId),
  getInstalledExtensions: () => ipcRenderer.invoke('extensions:get-installed'),
  installExtension: (ext: ExtensionMetadata) => ipcRenderer.invoke('extensions:install', ext),
  uninstallExtension: (id: string) => ipcRenderer.invoke('extensions:uninstall', id),
  toggleExtension: (id: string, enabled: boolean) => ipcRenderer.invoke('extensions:toggle', { id, enabled }),
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => ipcRenderer.invoke('extensions:update-settings', { id, settings }),
  installExtensionFromVsix: () => ipcRenderer.invoke('extensions:install-vsix'),
  extensionCapability: (request) => ipcRenderer.invoke('extensions:capability', request),
  extensionActivate: (id: string) => ipcRenderer.invoke('extensions:activate', id),
  extensionDeactivate: (id: string) => ipcRenderer.invoke('extensions:deactivate', id),
  extensionExecuteCommand: (commandId: string, ...args: unknown[]) => ipcRenderer.invoke('extensions:execute-command', { commandId, args }),
  extensionTriggerEvent: (event: string, payload?: unknown) => ipcRenderer.invoke('extensions:trigger-event', { event, payload }),
  extensionListCommands: () => ipcRenderer.invoke('extensions:list-commands'),
  extensionProvideCompletions: (query: { language: string; filePath: string; line: number; character: number }) => ipcRenderer.invoke('extensions:provide-completions', query),

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
  previewSnippetEdit: (params: any) => ipcRenderer.invoke('workspace-edit:preview-snippet', params),
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
  getPairProgrammingSuggestions: (event) => ipcRenderer.invoke('ai:pair-suggestions', event),

  // Phase 5.2 / FCC-0 / FCC-1: FCC Server Integration (Layer 3)
  fccGetStatus: () => ipcRenderer.invoke('fcc:get-status'),
  fccStart: () => ipcRenderer.invoke('fcc:start'),
  fccStop: () => ipcRenderer.invoke('fcc:stop'),
  fccRestart: () => ipcRenderer.invoke('fcc:restart'),
  fccAutoSetup: (providerId?: string) => ipcRenderer.invoke('fcc:auto-setup', providerId),
  fccSetEnabled: (enabled: boolean) => ipcRenderer.invoke('fcc:set-enabled', enabled),
  fccGetIntegrity: () => ipcRenderer.invoke('fcc:get-integrity'),
  fccVerifyBinary: (binaryPath?: string, expectedHash?: string) => ipcRenderer.invoke('fcc:verify-binary', binaryPath, expectedHash),
  fccGetLogs: () => ipcRenderer.invoke('fcc:get-logs'),
  fccClearLogs: () => ipcRenderer.invoke('fcc:clear-logs'),
  fccGetCatalog: () => ipcRenderer.invoke('fcc:get-catalog'),
  fccGetFleetSummary: () => ipcRenderer.invoke('fcc:get-fleet-summary'),
  fccSyncCatalog: () => ipcRenderer.invoke('fcc:sync-catalog'),
  fccToggleProvider: (providerId: string, enabled: boolean) => ipcRenderer.invoke('fcc:toggle-provider', providerId, enabled),
  fccTestProvider: (providerId: string) => ipcRenderer.invoke('fcc:test-provider', providerId),
  fccDetectHarnessConfigs: (customDir?: string) => ipcRenderer.invoke('fcc:detect-harness-configs', customDir),
  fccImportHarnessConfig: (detected: any, options?: any) => ipcRenderer.invoke('fcc:import-harness-config', detected, options),
  fccGetSupportedHarnesses: () => ipcRenderer.invoke('fcc:get-supported-harnesses'),
  fccConnectSubscription: (subscriptionId: string, authData?: any) => ipcRenderer.invoke('fcc:connect-subscription', subscriptionId, authData),
  fccGetSubscriptionStatus: () => ipcRenderer.invoke('fcc:get-subscription-status'),
  fccStartCopilotDeviceFlow: () => ipcRenderer.invoke('fcc:start-copilot-device-flow'),
  fccPollCopilotDeviceFlow: (deviceCode?: string) => ipcRenderer.invoke('fcc:poll-copilot-device-flow', deviceCode),
  fccRevokeSubscription: (subscriptionId: string) => ipcRenderer.invoke('fcc:revoke-subscription', subscriptionId),
  fccRefreshSubscription: (subscriptionId: string) => ipcRenderer.invoke('fcc:refresh-subscription', subscriptionId),
  fccGetSupplyEndpointStatus: () => ipcRenderer.invoke('fcc:get-supply-endpoint-status'),
  fccStartSupplyEndpoint: (port?: number) => ipcRenderer.invoke('fcc:start-supply-endpoint', port),
  fccStopSupplyEndpoint: () => ipcRenderer.invoke('fcc:stop-supply-endpoint'),
  fccSetSupplyEndpointLan: (enabled: boolean, acknowledgeWarning?: boolean) => ipcRenderer.invoke('fcc:set-supply-endpoint-lan', enabled, acknowledgeWarning),
  fccDetectInstalledHarnesses: () => ipcRenderer.invoke('fcc:detect-installed-harnesses'),
  fccRunHarnessSession: (params: any) => ipcRenderer.invoke('fcc:run-harness-session', params),
  fccGetHarnessSession: (sessionId: string) => ipcRenderer.invoke('fcc:get-harness-session', sessionId),
  fccGetOptimizationSavings: () => ipcRenderer.invoke('fcc:get-optimization-savings'),
  fccSetSessionCacheOptOut: (sessionId: string, optOut: boolean) => ipcRenderer.invoke('fcc:set-session-cache-opt-out', { sessionId, optOut }),
  fccGetQuotaMeters: () => ipcRenderer.invoke('fcc:get-quota-meters'),

  // Phase FCC-5: Reach (External Clients, Connectors, SessionBridge, Background Tasks)
  fccExportEditorConfig: (editor: any, variant?: string, customPath?: string) => ipcRenderer.invoke('fcc:export-editor-config', { editor, variant, customPath }),
  fccGetEditorConfigs: () => ipcRenderer.invoke('fcc:get-editor-configs'),
  fccGetConnectorsOverview: () => ipcRenderer.invoke('fcc:get-connectors-overview'),
  fccSaveConnectorConfig: (type: any, config: any) => ipcRenderer.invoke('fcc:save-connector-config', { type, config }),
  fccGetConnectorAuditLogs: (limit?: number, type?: any) => ipcRenderer.invoke('fcc:get-connector-audit-logs', { limit, type }),
  fccGetBackgroundTasks: () => ipcRenderer.invoke('fcc:get-background-tasks'),
  fccPauseBackgroundTask: (taskId: string) => ipcRenderer.invoke('fcc:pause-background-task', taskId),
  fccResumeBackgroundTask: (taskId: string) => ipcRenderer.invoke('fcc:resume-background-task', taskId),
  fccSetRunInBackground: (enabled: boolean) => ipcRenderer.invoke('fcc:set-run-in-background', enabled),
  fccIsRunInBackground: () => ipcRenderer.invoke('fcc:is-run-in-background'),
  fccListSessionBridges: () => ipcRenderer.invoke('fcc:list-session-bridges'),

  // Phase 5.4: OpenKilo Plugin Integration (Layer 5)
  openkiloGetStatus: () => ipcRenderer.invoke('openkilo:get-status'),
  openkiloRefreshModels: (apiKey?: string) => ipcRenderer.invoke('openkilo:refresh-models', apiKey),
  openkiloStartOAuth: () => ipcRenderer.invoke('openkilo:start-oauth'),
  openkiloCompleteOAuth: (code: string) => ipcRenderer.invoke('openkilo:complete-oauth', code),
  openkiloEnableAnonymous: () => ipcRenderer.invoke('openkilo:enable-anonymous'),

  // Phase 2.1: Provider Onboarding & Dynamic Discovery
  providerGetRegistry: () => ipcRenderer.invoke('provider:get-registry'),
  providerGetModels: (params) => ipcRenderer.invoke('provider:get-models', params),
  providerTestConnection: (params) => ipcRenderer.invoke('provider:test-connection', params),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  openPath: (filePath: string) => ipcRenderer.invoke('app:open-path', filePath),

  // Phase 5.5: Smart Orchestration & Quota Management (Layer 6)
  orchestrationGetQuotaStats: () => ipcRenderer.invoke('orchestration:get-quota-stats'),
  orchestrationGetSmartRoutingLogs: () => ipcRenderer.invoke('orchestration:get-smart-routing-logs'),
  orchestrationSetFreeMode: (enabled) => ipcRenderer.invoke('orchestration:set-free-mode', enabled),
  orchestrationClassifyTask: (prompt) => ipcRenderer.invoke('orchestration:classify-task', prompt),
  orchestrationSelectModel: (prompt, context) => ipcRenderer.invoke('orchestration:select-model', prompt, context),

  // Phase 5.6: End-to-End Performance & Onboarding
  orchestrationGetPerformanceMetrics: () => ipcRenderer.invoke('orchestration:get-performance-metrics'),
  orchestrationCompressContext: (prompt, codeContext) => ipcRenderer.invoke('orchestration:compress-context', prompt, codeContext),
  orchestrationWarmConnections: () => ipcRenderer.invoke('orchestration:warm-connections'),
  orchestrationCompleteOnboarding: () => ipcRenderer.invoke('orchestration:complete-onboarding'),

  // Phase 3.1: Modular Skills & External Integration Registry
  modulesGetList: (workspacePath?: string) => ipcRenderer.invoke('modules:get-list', workspacePath),
  modulesToggle: (moduleId: string, enabled: boolean, workspacePath?: string) => ipcRenderer.invoke('modules:toggle', moduleId, enabled, workspacePath),
  modulesCheckDependencies: (dependencies: string[]) => ipcRenderer.invoke('modules:check-dependencies', dependencies),
  modulesGetStatus: (moduleId: string, workspacePath?: string) => ipcRenderer.invoke('modules:get-status', moduleId, workspacePath),

  // Phase 3.3: AI Data Extractor (History Export)
  historyExportAiData: (options) => ipcRenderer.invoke('history:export-ai-data', options),
  historySelectExportDestination: (defaultName, format) => ipcRenderer.invoke('history:select-destination', defaultName, format),
  onHistoryExportProgress: (callback) => {
    const listener = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('history:export-progress', listener);
    return () => {
      ipcRenderer.removeListener('history:export-progress', listener);
    };
  },

  // Phase 3.5: Visual UI Sketcher (M3E Canvas)
  sketcherSendPrompt: (prompt: string) => ipcRenderer.invoke('sketcher:send-prompt', prompt),
  onSketcherPrompt: (callback: (prompt: string) => void) => {
    const listener = (_event: unknown, prompt: string) => callback(prompt);
    ipcRenderer.on('sketcher:prompt-received', listener);
    return () => {
      ipcRenderer.removeListener('sketcher:prompt-received', listener);
    };
  },

  // Phase 3.6: Open SEO & GEO MCP Skills
  mcpGetSeoConfig: (workspacePath?: string) => ipcRenderer.invoke('mcp:get-seo-config', workspacePath),
  mcpSaveSeoConfig: (options: any) => ipcRenderer.invoke('mcp:save-seo-config', options),
  mcpTestSeoConnection: (workspacePath?: string) => ipcRenderer.invoke('mcp:test-seo-connection', workspacePath),

  // Phase 6.1: Permanent Free Provider Registry & Model Curation
  freeProvidersGetList: () => ipcRenderer.invoke('free-providers:get-list'),
  freeProvidersGetTiers: () => ipcRenderer.invoke('free-providers:get-tiers'),
  freeProvidersGetHealth: () => ipcRenderer.invoke('free-providers:get-health'),
  freeProvidersPing: (providerId?: string) => ipcRenderer.invoke('free-providers:ping', providerId),

  // Phase 6.2: Seamless BYOK Interface & Key Management
  byokDetectKeys: () => ipcRenderer.invoke('byok:detect-keys'),
  byokImportDetectedKey: (keyId: string, providerId?: string) => ipcRenderer.invoke('byok:import-detected-key', keyId, providerId),
  byokGetStoredKeys: () => ipcRenderer.invoke('byok:get-stored-keys'),
  byokRevealKey: (providerId: string) => ipcRenderer.invoke('byok:reveal-key', providerId),
  byokRevokeKey: (providerId: string) => ipcRenderer.invoke('byok:revoke-key', providerId),
  byokExportKeys: () => ipcRenderer.invoke('byok:export-keys'),
  byokImportKeys: (backupData: string) => ipcRenderer.invoke('byok:import-keys', backupData),
  byokSaveCustomProvider: (config: any) => ipcRenderer.invoke('byok:save-custom-provider', config),

  // Phase 6.3: OpenCode Integration & Free Model Sync
  opencodeDetect: () => ipcRenderer.invoke('opencode:detect'),
  opencodeGetFreeSummary: () => ipcRenderer.invoke('opencode:get-free-summary'),
  opencodeImportProviders: () => ipcRenderer.invoke('opencode:import-providers'),
  opencodeSetFramework: (framework: string) => ipcRenderer.invoke('opencode:set-framework', framework),
  opencodeGetFramework: () => ipcRenderer.invoke('opencode:get-framework'),
  opencodeGetMergedProviders: () => ipcRenderer.invoke('opencode:get-merged-providers'),

  // Phase 6.4: Intelligent Model Router
  modelRouterClassifyTask: (prompt: string) => ipcRenderer.invoke('model-router:classify-task', prompt),
  modelRouterSelectModel: (prompt: string, overridePreferences?: any) => ipcRenderer.invoke('model-router:select-model', prompt, overridePreferences),
  modelRouterGetPreferences: () => ipcRenderer.invoke('model-router:get-preferences'),
  modelRouterSetPreferences: (updates: any) => ipcRenderer.invoke('model-router:set-preferences', updates),
  modelRouterGetAvailableModels: () => ipcRenderer.invoke('model-router:get-available-models'),

  // Phase 6.5: Unified Provider Dashboard & Quota Management
  dashboardGetData: () => ipcRenderer.invoke('dashboard:get-data'),
  dashboardGetOverview: () => ipcRenderer.invoke('dashboard:get-overview'),
  dashboardGetQuota: () => ipcRenderer.invoke('dashboard:get-quota'),
  dashboardGetComparison: () => ipcRenderer.invoke('dashboard:get-comparison'),
  dashboardGetAnalytics: () => ipcRenderer.invoke('dashboard:get-analytics'),
  dashboardGetRecommendations: () => ipcRenderer.invoke('dashboard:get-recommendations'),
  dashboardDismissRecommendation: (recommendationId: string) => ipcRenderer.invoke('dashboard:dismiss-recommendation', recommendationId),
  dashboardRecordActivity: (record: any) => ipcRenderer.invoke('dashboard:record-activity', record),

  // Diagnostics 1: Provider Connection Diagnostic Harness & Error Taxonomy
  runDiagnostics: (providerId?: string) => ipcRenderer.invoke('diagnostics:run', providerId),
  getDiagnosticReport: (summary?: any) => ipcRenderer.invoke('diagnostics:report', summary),

  // Diagnostics 2: End-to-End Capability Test Suite
  runCapabilitySuite: (options?: any) => ipcRenderer.invoke('diagnostics:run-capabilities', options),
  getCapabilityReport: () => ipcRenderer.invoke('diagnostics:get-capability-report'),

  // Diagnostics 3: Remediation Report Engine
  getRemediationReport: () => ipcRenderer.invoke('diagnostics:get-remediation-report'),

  // Diagnostics 5: Background Health Monitoring and Auto-Failover
  diagnosticsGetFleetHealth: () => ipcRenderer.invoke('diagnostics:get-fleet-health'),
  diagnosticsSetQuietMode: (enabled: boolean) => ipcRenderer.invoke('diagnostics:set-quiet-mode', enabled),
  diagnosticsSetBatterySaver: (enabled: boolean) => ipcRenderer.invoke('diagnostics:set-battery-saver', enabled),
  diagnosticsSetMeteredConnection: (enabled: boolean) => ipcRenderer.invoke('diagnostics:set-metered-connection', enabled),
  diagnosticsTriggerPing: (providerId?: string) => ipcRenderer.invoke('diagnostics:trigger-ping', providerId),
  diagnosticsSimulateOutage: (providerId: string, type?: 'RATE_LIMITED' | 'PROVIDER_DOWN', cooldownMs?: number) =>
    ipcRenderer.invoke('diagnostics:simulate-outage', providerId, type, cooldownMs),
  diagnosticsSimulateRecovery: (providerId: string) => ipcRenderer.invoke('diagnostics:simulate-recovery', providerId),
  onDiagnosticsFleetHealthChanged: (callback: (health: any) => void) => {
    const listener = (_event: any, health: any) => callback(health);
    ipcRenderer.on('diagnostics:fleet-health-changed', listener);
    return () => ipcRenderer.removeListener('diagnostics:fleet-health-changed', listener);
  },

  // Diagnostics Fix 1: End-to-End Connectivity Trace
  runConnectivityTrace: (options?: any) => ipcRenderer.invoke('diagnostics:run-connectivity-trace', options),
  recordTraceHop: (arg1: any, arg2?: any, arg3?: any) => {
    if (typeof arg1 === 'string') {
      return ipcRenderer.invoke('diagnostics:record-trace-hop', { traceId: arg1, hop: arg2, ...(arg3 || {}) });
    }
    return ipcRenderer.invoke('diagnostics:record-trace-hop', arg1);
  },
  getConnectivityTrace: () => ipcRenderer.invoke('diagnostics:get-connectivity-trace'),
  scanMockPaths: () => ipcRenderer.invoke('diagnostics:scan-mock-paths'),
  onConnectivityTraceUpdate: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('diagnostics:trace-update', listener);
    return () => ipcRenderer.removeListener('diagnostics:trace-update', listener);
  },


  // Performance Profiler APIs (Perf 1)
  perfGetBootTrace: () => ipcRenderer.invoke('perf:get-boot-trace'),
  perfRecordRendererMark: (mark: any) => ipcRenderer.invoke('perf:record-renderer-mark', mark),
  perfRecordTransition: (metric: any) => ipcRenderer.invoke('perf:record-transition', metric),
  perfInjectDelay: (durationMs: number, label?: string) => ipcRenderer.invoke('perf:inject-delay', durationMs, label),

  // Open-Path Performance Trace (Fix 3)
  perfProfileOpenPaths: () => ipcRenderer.invoke('perf:profile-open-paths'),
  perfGetOpenTrace: () => ipcRenderer.invoke('perf:get-open-trace'),

  // Tiered Boot Scheduler APIs (Perf 2)
  bootSchedulerGetState: () => ipcRenderer.invoke('boot-scheduler:get-state'),
  bootSchedulerPromote: (idOrCategory: string) => ipcRenderer.invoke('boot-scheduler:promote', idOrCategory),
  bootSchedulerNotifyInteraction: () => ipcRenderer.invoke('boot-scheduler:notify-interaction'),
  onBootSchedulerProgress: (callback: (state: any) => void) => {
    const listener = (_event: any, state: any) => callback(state);
    ipcRenderer.on('boot-scheduler:progress', listener);
    return () => ipcRenderer.removeListener('boot-scheduler:progress', listener);
  },

  // UI-Polish 2: Platform Inset Metrics
  getPlatformInsets: () => ipcRenderer.invoke('platform:get-insets'),

  // Scale 1: Zero-Server OAuth & Device Flow
  oauthStartOpenRouterPKCE: () => ipcRenderer.invoke('oauth:start-openrouter-pkce'),
  oauthStartOpenKilo: () => ipcRenderer.invoke('oauth:start-openkilo'),
  oauthStartCopilotDevice: () => ipcRenderer.invoke('oauth:start-copilot-device'),
  oauthPollCopilotDevice: (deviceCode?: string) => ipcRenderer.invoke('oauth:poll-copilot-device', deviceCode),
  oauthCancelCopilotDevice: () => ipcRenderer.invoke('oauth:cancel-copilot-device'),
  oauthDisconnect: (providerId: string) => ipcRenderer.invoke('oauth:disconnect', providerId),
  oauthGetStatus: () => ipcRenderer.invoke('oauth:get-status'),
  onOAuthStatusChanged: (callback: (status: any) => void) => {
    const listener = (_event: any, status: any) => callback(status);
    ipcRenderer.on('oauth:status-changed', listener);
    return () => ipcRenderer.removeListener('oauth:status-changed', listener);
  },

  // Scale 1 & RealConnect 2: Usage Ledger
  usageGetLedger: () => ipcRenderer.invoke('usage:get-ledger'),
  usageGetStats: () => ipcRenderer.invoke('usage:get-stats'),
  usageExportLedger: (format?: 'json' | 'csv') => ipcRenderer.invoke('usage:export-ledger', format),
  usageExport: (format?: 'json' | 'csv') => ipcRenderer.invoke('usage:export', format),
  usageClearLedger: () => ipcRenderer.invoke('usage:clear-ledger'),

  // RealConnect 2: Per-User Credential Storage
  credentialsSave: (providerId: string, apiKey: string, label?: string) => ipcRenderer.invoke('credentials:save', providerId, apiKey, label),
  credentialsGet: (providerId?: string) => ipcRenderer.invoke('credentials:get', providerId),
  credentialsDelete: (providerId: string) => ipcRenderer.invoke('credentials:delete', providerId),
  credentialsReveal: (providerId: string) => ipcRenderer.invoke('credentials:reveal', providerId),
  credentialsTest: (providerId: string, apiKey: string, modelId?: string) => ipcRenderer.invoke('credentials:test', providerId, apiKey, modelId),
  credentialsExport: (passphrase?: string) => ipcRenderer.invoke('credentials:export', passphrase),
  credentialsImport: (bundleJson: string, passphrase?: string) => ipcRenderer.invoke('credentials:import', bundleJson, passphrase),
  credentialsHasAny: () => ipcRenderer.invoke('credentials:has-any'),
  credentialsList: () => ipcRenderer.invoke('credentials:list'),
  credentialsAutoDetect: () => ipcRenderer.invoke('credentials:auto-detect'),

  // Unified Provisioning: Onboarding State
  onboardingGetState: () => ipcRenderer.invoke('onboarding:get-state'),
  onboardingSaveState: (updates: any) => ipcRenderer.invoke('onboarding:save-state', updates)
};

contextBridge.exposeInMainWorld('electronAPI', api);

// Signal preload_done to the performance profiler
try {
  void ipcRenderer.invoke('perf:record-renderer-mark', {
    name: 'preload_done',
    timestamp: performance.now(),
    phase: 'boot'
  });
} catch {
  // Preload mark is non-blocking
}
