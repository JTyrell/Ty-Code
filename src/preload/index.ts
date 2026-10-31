import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AgentStreamChunk, CanvasAgentEventPayloadData, CanvasEditAppliedPayload, CanvasEditIntent, CanvasMessageData, CanvasPreviewProposedPayload, CanvasPreviewStatusPayload, CanvasSnapshotData, CanvasStructuralIntentPayload, CanvasUpdateNotificationData, CommandExecutionOptions, ElectronAPI, ExtensionMetadata, ProposedDiff, PtySessionInfo, PtySpawnOptions, TerminalRunCommandOptions } from './types';
import { AgentDonePayloadSchema } from '../shared/types/agent-events';
import { COMMAND_CHANNELS } from '../shared/types/command-registry';
import type { ReliabilityAdvisorPayload, ReliabilityHealthSnapshot } from '../shared/types/agent-events';

// Echo suppression (Prompt: Break the Model-Sync Echo Loop): each renderer
// needs its own webContents id to ignore settings:changed echoes it caused
// itself. Probed ONCE via sendSync and cached for the window's lifetime.
let cachedWebContentsId: number | null = null;
function getOwnWebContentsId(): number {
  if (cachedWebContentsId === null) {
    try {
      const value = ipcRenderer.sendSync('window:whoami');
      cachedWebContentsId = typeof value === 'number' ? value : -1;
    } catch {
      cachedWebContentsId = -1;
    }
  }
  return cachedWebContentsId;
}

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
  openFolderDialog: () => ipcRenderer.invoke('workspace:open-folder-dialog'),
  openFolderInExplorer: (folderPath: string) => ipcRenderer.invoke('workspace:open-folder', folderPath),
  scanWorkspace: (rootPath?: string) => ipcRenderer.invoke('workspace:scan', rootPath),
  saveCorrection: (options: { workspacePath?: string; rule: string; category?: 'style' | 'architecture' | 'stack'; surface?: 'chat' | 'debugger' | 'canvas' | 'global' }) =>
    ipcRenderer.invoke('context:save-correction', options),
  getCorrections: (workspacePath?: string) =>
    ipcRenderer.invoke('context:get-corrections', workspacePath),
  getCorrectionEntries: (workspacePath?: string) =>
    ipcRenderer.invoke('context:get-correction-entries', workspacePath),
  deleteCorrection: (options: { workspacePath?: string; id: string }) =>
    ipcRenderer.invoke('context:delete-correction', options),
  getRecommendedMCPs: (workspacePath?: string) =>
    ipcRenderer.invoke('context:get-recommended-mcps', workspacePath),
  getContextScore: (workspacePath?: string) =>
    ipcRenderer.invoke('context:get-score', workspacePath),
  resyncWorkspaceContext: (workspacePath?: string) =>
    ipcRenderer.invoke('context:resync-workspace', workspacePath),
  getDesignProfile: (workspacePath?: string) =>
    ipcRenderer.invoke('context:get-design-profile', workspacePath),
  onCorrectionAdded: (callback: (entry: import('./types').CorrectionEntry) => void) => {
    const handler = (_: IpcRendererEvent, entry: import('./types').CorrectionEntry) => callback(entry);
    ipcRenderer.on('context:correction-added', handler);
    return () => ipcRenderer.removeListener('context:correction-added', handler);
  },
  onWorkspaceReady: (callback: (data: { path: string }) => void) => {
    const handler = (_: IpcRendererEvent, data: { path: string }) => callback(data);
    ipcRenderer.on('workspace:ready', handler);
    return () => ipcRenderer.removeListener('workspace:ready', handler);
  },
  onVaultKeysUndecryptable: (callback: (payload: { message: string }) => void) => {
    const handler = (_: IpcRendererEvent, payload: { message: string }) => callback(payload);
    ipcRenderer.on('vault:keys-undecryptable', handler);
    return () => ipcRenderer.removeListener('vault:keys-undecryptable', handler);
  },
  onOpenFolder: (callback: (data: { folderPath: string }) => void) => {
    const handler = (_: IpcRendererEvent, data: { folderPath: string }) => callback(data);
    ipcRenderer.on('window:open-folder', handler);
    return () => ipcRenderer.removeListener('window:open-folder', handler);
  },
  onWorkspaceRequestOpen: (callback: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, _data: unknown) => callback(_data);
    ipcRenderer.on('workspace:request-open-dialog', handler);
    return () => ipcRenderer.removeListener('workspace:request-open-dialog', handler);
  },
  getWorkspaceSession: () => ipcRenderer.invoke('workspace:session:get'),
  setActiveSessionWorkspace: (rootPath: string) => ipcRenderer.invoke('workspace:session:set-active', { rootPath }),
  attachSessionSurface: (id: import('./types').WorkspaceSurfaceId) =>
    ipcRenderer.invoke('workspace:session:attach', { id }),
  detachSessionSurface: (id: import('./types').WorkspaceSurfaceId) =>
    ipcRenderer.invoke('workspace:session:detach', { id }),
  closeSessionWorkspace: () => ipcRenderer.invoke('workspace:session:close'),
  onWorkspaceSession: (
    callback: (event: import('./types').WorkspaceSessionEvent) => void
  ) => {
    const channels = ['workspace:opened', 'workspace:changed', 'workspace:closed', 'workspace:session-updated'] as const;
    const handlers = new Map<string, (event: IpcRendererEvent, session: import('./types').WorkspaceSessionSnapshot) => void>();
    for (const channel of channels) {
      const handler = (_: IpcRendererEvent, session: import('./types').WorkspaceSessionSnapshot) =>
        callback({ channel, session });
      handlers.set(channel, handler);
      ipcRenderer.on(channel, handler);
    }
    return () => {
      for (const [channel, handler] of handlers) {
        ipcRenderer.removeListener(channel, handler);
      }
      handlers.clear();
    };
  },
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
  readFileForContext: (filePath: string, options?: { maxLines?: number }) =>
    ipcRenderer.invoke('chat:read-file-for-context', filePath, options),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:create-directory', dirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs:delete-path', targetPath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename-path', oldPath, newPath),
  searchFiles: (query: string) => ipcRenderer.invoke('fs:search-files', query),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  // Prompt 3: boot-state hydration gate (first-run decision source = main).
  getBootState: () => ipcRenderer.invoke('app:get-boot-state'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  updateActiveProviderConfig: (config) => ipcRenderer.invoke('providers:update-active-config', config),
  getActiveRoute: () => ipcRenderer.invoke('providers:get-active-route'),
  onActiveRouteChanged: (callback) => {
    const listener = (_: IpcRendererEvent, payload: { snapshot: Parameters<typeof callback>[0]; event?: Parameters<typeof callback>[1] }) => {
      callback(payload.snapshot, payload.event);
    };
    ipcRenderer.on('providers:active-route-changed', listener);
    return () => ipcRenderer.removeListener('providers:active-route-changed', listener);
  },
  getProviderHealth: () => ipcRenderer.invoke('providers:get-health'),
  onProviderHealthChanged: (callback) => {
    const listener = (_: IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
    ipcRenderer.on('providers:health-changed', listener);
    return () => ipcRenderer.removeListener('providers:health-changed', listener);
  },
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
  getWebContentsId: () => getOwnWebContentsId(),
  onSettingsChanged: (callback) => {
    // Payload carries { originWebContentsId } (null = main-originated) so the
    // renderer can suppress its own echo. Disposable subscription.
    const listener = (_: IpcRendererEvent, payload: { originWebContentsId?: number | null }) => callback(payload);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  // Dev-only storm GENERATOR probe (main registers the handler unpackaged
  // builds only; in production this invoke simply rejects).
  devStormTestSetActiveModel: () => ipcRenderer.invoke('dev:storm:set-active-model'),
  // Prompt 3: Copy Pipeline. Main-process fallback for every window; the
  // renderer lib (src/renderer/src/lib/clipboard.ts) tries the async clipboard
  // API first and falls back here. Payload may be a bare string (back-compat)
  // or { text, source } so the audit trail can name the originating surface.
  copyToClipboard: (payload) => ipcRenderer.invoke('clipboard:write', payload),
  readFromClipboard: (source) => ipcRenderer.invoke('clipboard:read', { source }),
  getClipboardAudit: () => ipcRenderer.invoke('clipboard:audit'),
  // ===== Prompt 5: Command Registry bridge =====
  // Menus and keybindings are painted by the renderer straight from the shared
  // registry (it is Electron-free), so only main-target activations cross here.
  // Channel names come from the shared contract rather than being retyped, so a
  // rename cannot orphan a handler and turn a click into a rejection.
  executeCommand: (payload) => ipcRenderer.invoke(COMMAND_CHANNELS.execute, payload),
  executeDynamicCommand: (item, contexts) =>
    ipcRenderer.invoke(COMMAND_CHANNELS.executeDynamic, { item, contexts }),
  getMainCommandContext: () => ipcRenderer.invoke(COMMAND_CHANNELS.mainContext),
  getCommandAuditTrail: () => ipcRenderer.invoke(COMMAND_CHANNELS.audit),
  // ===== Autonomous Free-Tier Reliability (Prompts 1-3) =====
  // Dev-only chaos injector (main registers the handler unpackaged builds
  // only; in production this invoke simply rejects).
  devChaosInject: (request) => ipcRenderer.invoke('devChaos:fire', request),
  getReliabilityHealth: () => ipcRenderer.invoke('reliability:get-health'),
  getReliabilityLedgerTail: (limit) => ipcRenderer.invoke('reliability:get-ledger-tail', limit),
  getReliabilityStats: () => ipcRenderer.invoke('reliability:get-stats'),
  reliabilityRepairFcc: () => ipcRenderer.invoke('reliability:repair-fcc'),
  reliabilityHealRoutes: () => ipcRenderer.invoke('reliability:heal-routes'),
  reliabilityRetestProviders: () => ipcRenderer.invoke('reliability:retest-providers'),
  reliabilityStartOllama: () => ipcRenderer.invoke('reliability:start-ollama'),
  onReliabilityHealth: (callback) => {
    const handler = (_: IpcRendererEvent, snapshot: unknown) => callback(snapshot as ReliabilityHealthSnapshot);
    ipcRenderer.on('reliability:health-snapshot', handler);
    return () => ipcRenderer.removeListener('reliability:health-snapshot', handler);
  },
  onReliabilityAdvisor: (callback) => {
    const handler = (_: IpcRendererEvent, payload: unknown) => callback(payload as ReliabilityAdvisorPayload);
    ipcRenderer.on('reliability:advisor', handler);
    return () => ipcRenderer.removeListener('reliability:advisor', handler);
  },
  // Prompt Assembler & Role Preferences
  getAssemblyHistory: () => ipcRenderer.invoke('prompt:get-assembly-history'),
  getAssemblyInfo: (taskId: string) => ipcRenderer.invoke('prompt:get-assembly-info', taskId),
  onAssemblyUpdate: (callback) => {
    const handler = (_: IpcRendererEvent, assembly: any) => callback(assembly);
    ipcRenderer.on('prompt:assembly-update', handler);
    return () => ipcRenderer.removeListener('prompt:assembly-update', handler);
  },
  getRolePreferences: (customRoot) => ipcRenderer.invoke('preferences:get', customRoot),
  setRolePreferences: (prefs, customRoot) => ipcRenderer.invoke('preferences:set', prefs, customRoot),
  resetRolePreferences: (customRoot) => ipcRenderer.invoke('preferences:reset', customRoot),
  onPreferencesChanged: (callback) => {
    const handler = (_: IpcRendererEvent, prefs: any) => callback(prefs);
    ipcRenderer.on('preferences:changed', handler);
    return () => ipcRenderer.removeListener('preferences:changed', handler);
  },
  startAgentTask: (params) => {
    console.log('Preload: Forwarding to main', params?.taskId);
    if (params?.traceId) {
      ipcRenderer.invoke('diagnostics:record-trace-hop', {
        traceId: params.traceId,
        hop: 'H2',
        status: 'PASS',
        payloadSize: (params.prompt?.length || 0) + (Array.isArray(params.history) ? params.history.length * 150 : 0),
        metadata: {
          taskId: params.taskId,
          promptSize: params.prompt?.length || 0,
          workspacePath: params.workspacePath
        }
      }).catch(() => { });
    }
    return ipcRenderer.invoke('agent:start-task', params);
  },
  stopAgentTask: (taskId: string) => ipcRenderer.invoke('agent:stop-task', taskId),
  respondAgentApproval: (approvalId: string, approved: boolean, feedback?: string) =>
    ipcRenderer.invoke('agent:respond-approval', { approvalId, approved, ...(feedback !== undefined ? { feedback } : {}) }),
  sendApprovalResponse: (approvalId: string, response: 'APPROVED' | 'REVISED', feedback?: string) =>
    ipcRenderer.invoke('agent:respond-approval', { approvalId, approved: response === 'APPROVED', ...(feedback !== undefined ? { feedback } : {}) }),
  userApproveDiff: (payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean) => ipcRenderer.invoke('user_approve_diff', payload),
  onAgentStream: (callback) => {
    const listener = (_event: IpcRendererEvent, chunk: AgentStreamChunk) => {
      // Step 2: Lightweight manual check bypassing Zod for high-frequency stream tokens
      if (chunk && typeof chunk === 'object') {
        if (chunk.type === 'token' || chunk.type === 'thought') {
          if (typeof chunk.content === 'string') {
            callback(chunk);
          }
        } else {
          callback(chunk);
        }
      }
    };
    ipcRenderer.on('agent:stream', listener);
    return () => ipcRenderer.removeListener('agent:stream', listener);
  },
  onAgentStreamBatch: (callback) => {
    const listener = (_event: IpcRendererEvent, chunks: AgentStreamChunk[]) => {
      // Step 2: Lightweight manual check bypassing Zod for high-frequency stream tokens
      if (!Array.isArray(chunks)) return;
      const valid: AgentStreamChunk[] = [];
      for (const chunk of chunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (chunk.type === 'token' || chunk.type === 'thought') {
          if (typeof chunk.content === 'string') {
            valid.push(chunk);
          }
        } else {
          valid.push(chunk);
        }
      }
      if (valid.length > 0) callback(valid);
    };
    ipcRenderer.on('agent:stream-batch', listener);
    return () => ipcRenderer.removeListener('agent:stream-batch', listener);
  },
  onAgentStreamToken: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => {
      // Step 2: Lightweight manual check (typeof payload.token === 'string') bypassing Zod
      if (payload && typeof payload === 'object' && typeof payload.token === 'string') {
        callback(payload);
      }
    };
    ipcRenderer.on('agent:stream-token', listener);
    return () => ipcRenderer.removeListener('agent:stream-token', listener);
  },
  onAgentReasoningToken: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => {
      // Step 2: Lightweight manual check (typeof payload.token === 'string') bypassing Zod
      if (payload && typeof payload === 'object' && typeof payload.token === 'string') {
        callback(payload);
      }
    };
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
  onAgentDocumentProposed: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:document-proposed', listener);
    return () => ipcRenderer.removeListener('agent:document-proposed', listener);
  },
  onDocumentProposed: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:document-proposed', listener);
    return () => ipcRenderer.removeListener('agent:document-proposed', listener);
  },
  updateDocument: (payload: { id: string; markdown: string; title?: string }) =>
    ipcRenderer.invoke('document:update', payload),
  getLastDocument: () => ipcRenderer.invoke('document:get-last'),
  loadDocument: (id: string) => ipcRenderer.invoke('document:load', id),
  onAgentDone: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => {
      // Step 2: Retain full Zod validation for terminal 'done' event
      const parsed = AgentDonePayloadSchema.safeParse(payload);
      if (parsed.success) {
        callback(parsed.data);
      } else {
        callback(payload);
      }
    };
    ipcRenderer.on('agent:done', listener);
    return () => ipcRenderer.removeListener('agent:done', listener);
  },
  onAgentError: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agent:error', listener);
    return () => ipcRenderer.removeListener('agent:error', listener);
  },
  perfReportH5: (data: { taskId: string; h5: number }) => {
    ipcRenderer.send('perf:report-h5', data);
  },

  // Memory Pressure Governor (local-only, Zero-Telemetry)
  governorGetState: () => ipcRenderer.invoke('governor:get-state'),
  governorSample: (sample) => ipcRenderer.send('governor:sample', sample),
  surfaceHeartbeat: (surfaceId) => ipcRenderer.send('surface:heartbeat', surfaceId),
  onGovernorStateChanged: (callback) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on('governor:state-changed', listener);
    return () => ipcRenderer.removeListener('governor:state-changed', listener);
  },
  onGovernorSurfaceCrashed: (callback) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on('governor:surface-crashed', listener);
    return () => ipcRenderer.removeListener('governor:surface-crashed', listener);
  },
  onGovernorSurfaceShed: (callback) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on('governor:surface-shed', listener);
    return () => ipcRenderer.removeListener('governor:surface-shed', listener);
  },
  onGovernorLiteMode: (callback) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on('governor:lite-mode', listener);
    return () => ipcRenderer.removeListener('governor:lite-mode', listener);
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
  // Prompt (Terminal Command Dispatch Fix): readiness-aware dispatch surface.
  terminalRunCommand: (cmd: string, opts?: TerminalRunCommandOptions) => ipcRenderer.invoke('terminal:run-command', { cmd, opts }),
  reportActiveTerminal: (ptyId: string) => ipcRenderer.send('terminal:report-active', { ptyId }),
  ackTerminalAttached: (ptyId: string) => ipcRenderer.send('terminal:attached', { id: ptyId }),
  getTerminalDispatchLedger: (limit?: number) => ipcRenderer.invoke('terminal-dispatch-ledger:get', { limit }),
  onTerminalCommandDispatched: (callback: (data: { terminalId: string; cmd: string; execute: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, data: { terminalId: string; cmd: string; execute: boolean }) => callback(data);
    ipcRenderer.on('terminal:command-dispatched', listener);
    return () => ipcRenderer.removeListener('terminal:command-dispatched', listener);
  },
  onTerminalDispatchFailed: (callback: (data: { cmd: string; reason: string; opts?: TerminalRunCommandOptions; terminalId?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, data: { cmd: string; reason: string; opts?: TerminalRunCommandOptions; terminalId?: string }) => callback(data);
    ipcRenderer.on('terminal:dispatch-failed', listener);
    return () => ipcRenderer.removeListener('terminal:dispatch-failed', listener);
  },
  onPtySessionCreated: (callback: (data: PtySessionInfo & { cwd?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, data: PtySessionInfo & { cwd?: string }) => callback(data);
    ipcRenderer.on('pty:session-created', listener);
    return () => ipcRenderer.removeListener('pty:session-created', listener);
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
  gitIsRepo: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:is-repo', payload),
  gitInit: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:init', payload),
  gitGetStatus: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:status', payload),
  gitGetDiff: (payload?: { filePath?: string; staged?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:diff', payload),
  gitGetOriginalContent: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:original-content', payload),
  gitStage: (payload: { filePaths: string | string[]; repoPath?: string }) => ipcRenderer.invoke('git:stage', payload),
  gitUnstage: (payload: { filePaths: string | string[]; repoPath?: string }) => ipcRenderer.invoke('git:unstage', payload),
  gitDiscardChanges: (payload: { filePath: string; isUntracked?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:discard', payload),
  gitCommit: (payload: { message: string; options?: { amend?: boolean }; repoPath?: string }) => ipcRenderer.invoke('git:commit', payload),
  gitGetBranches: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:branches', payload),
  gitSwitchBranch: (payload: { branchName: string; repoPath?: string }) => ipcRenderer.invoke('git:switch-branch', payload),
  gitCreateBranch: (payload: { branchName: string; repoPath?: string }) => ipcRenderer.invoke('git:create-branch', payload),
  gitDeleteBranch: (payload: { branchName: string; force?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:delete-branch', payload),
  gitFetch: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:fetch', payload),
  gitPull: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:pull', payload),
  gitPush: (payload?: { remote?: string; branch?: string; repoPath?: string }) => ipcRenderer.invoke('git:push', payload),
  gitGetLog: (payload?: { maxCount?: number; search?: string; repoPath?: string }) => ipcRenderer.invoke('git:log', payload),
  gitGetBlame: (payload: { filePath: string; repoPath?: string }) => ipcRenderer.invoke('git:blame', payload),
  gitStash: (payload: { action: 'list' | 'save' | 'pop' | 'drop'; message?: string; index?: number; repoPath?: string }) => ipcRenderer.invoke('git:stash', payload),
  gitGetRemotes: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:remotes', payload),
  gitGetFileDiff: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:file-diff', payload),
  gitGetCommitDetail: (payload: { hash: string; repoPath?: string }) => ipcRenderer.invoke('git:commit-detail', payload),
  gitGetTags: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:tags', payload),
  gitCreateTag: (payload: { name: string; message?: string; repoPath?: string }) => ipcRenderer.invoke('git:create-tag', payload),
  gitDeleteTag: (payload: { name: string; repoPath?: string }) => ipcRenderer.invoke('git:delete-tag', payload),
  gitGetConflictContent: (payload: { filePath: string; repoPath?: string }) => ipcRenderer.invoke('git:conflict-content', payload),
  gitResolveConflict: (payload: { filePath: string; action: 'ours' | 'theirs' | 'mark-resolved'; repoPath?: string }) => ipcRenderer.invoke('git:resolve-conflict', payload),
  gitAbortMerge: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:abort-merge', payload),
  gitGetHunks: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => ipcRenderer.invoke('git:hunks', payload),
  gitApplyHunk: (payload: { filePath: string; hunkId: string; operation: 'stage' | 'unstage' | 'revert'; repoPath?: string }) => ipcRenderer.invoke('git:apply-hunk', payload),
  gitMerge: (payload: { branchName: string; repoPath?: string }) => ipcRenderer.invoke('git:merge', payload),
  gitListRepositories: (payload?: { workspacePath?: string }) => ipcRenderer.invoke('git:list-repositories', payload),
  gitGraph: (payload?: { maxCount?: number; repoPath?: string }) => ipcRenderer.invoke('git:graph', payload),
  gitSuggestCommitMessage: (payload?: { repoPath?: string }) => ipcRenderer.invoke('git:suggest-commit-message', payload),

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

  // FCC Service Manager (installer, service lifecycle, terminal bridge)
  fccInstall: () => ipcRenderer.invoke('fcc:install'),
  fccGetServiceStatus: () => ipcRenderer.invoke('fcc:get-service-status'),
  fccRetryService: () => ipcRenderer.invoke('fcc:retry-service'),
  onFccInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('fcc:install-progress', handler);
    return () => { ipcRenderer.removeListener('fcc:install-progress', handler); };
  },
  onFccServiceState: (callback: (status: any) => void) => {
    const handler = (_event: unknown, status: any) => callback(status);
    ipcRenderer.on('fcc:service-state', handler);
    return () => { ipcRenderer.removeListener('fcc:service-state', handler); };
  },

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
  fccVoiceInput: (audioData, options) => ipcRenderer.invoke('fcc:voice-input', audioData, options),
  fccBrowserSession: (options) => ipcRenderer.invoke('fcc:browser-session', options),

  // Phase 5.4: OpenKilo Plugin Integration (Layer 5)
  openkiloGetStatus: () => ipcRenderer.invoke('openkilo:get-status'),
  openkiloRefreshModels: (apiKey?: string) => ipcRenderer.invoke('openkilo:refresh-models', apiKey),
  openkiloStartOAuth: () => ipcRenderer.invoke('openkilo:start-oauth'),
  openkiloCompleteOAuth: (code: string) => ipcRenderer.invoke('openkilo:complete-oauth', code),
  openkiloEnableAnonymous: () => ipcRenderer.invoke('openkilo:enable-anonymous'),

  // Phase 2.1: Provider Onboarding & Dynamic Discovery
  providerGetRegistry: () => ipcRenderer.invoke('provider:get-registry'),
  providerGetConnectionStatus: () => ipcRenderer.invoke('provider:get-connection-status'),
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
  sketcherOpenWindow: () => ipcRenderer.invoke('sketcher:open-window'),
  onSketcherPrompt: (callback: (prompt: string) => void) => {
    const listener = (_event: unknown, prompt: string) => callback(prompt);
    ipcRenderer.on('sketcher:prompt-received', listener);
    return () => {
      ipcRenderer.removeListener('sketcher:prompt-received', listener);
    };
  },

  // M3E Canvas overhaul: shared context & chat sync bridge
  canvasUpdateState: (payload: unknown) => ipcRenderer.invoke('canvas:update-state', payload),
  canvasRequestState: () => ipcRenderer.invoke('canvas:request-state'),
  canvasSyncMessage: (payload: unknown) => ipcRenderer.invoke('main:sync-message', payload),
  canvasAgentGenerate: (prompt: string) => ipcRenderer.invoke('canvas:agent-generate', prompt),
  canvasChatSend: (payload: unknown) => ipcRenderer.invoke('canvas:chat-send', payload),
  notifyMainChatOfCanvasUpdate: (payload: unknown) => ipcRenderer.invoke('canvas:notify-main-chat-update', payload),
  focusCanvasWindow: () => ipcRenderer.invoke('canvas:focus-window'),
  onCanvasStateSynced: (callback: (state: CanvasSnapshotData) => void) => {
    const listener = (_event: unknown, state: CanvasSnapshotData) => callback(state);
    ipcRenderer.on('canvas:state-synced', listener);
    return () => {
      ipcRenderer.removeListener('canvas:state-synced', listener);
    };
  },
  onCanvasMessageSynced: (callback: (message: CanvasMessageData) => void) => {
    const listener = (_event: unknown, message: CanvasMessageData) => callback(message);
    ipcRenderer.on('canvas:message-synced', listener);
    return () => {
      ipcRenderer.removeListener('canvas:message-synced', listener);
    };
  },
  onCanvasAgentEvent: (callback: (event: CanvasAgentEventPayloadData) => void) => {
    const listener = (_event: unknown, payload: CanvasAgentEventPayloadData) => callback(payload);
    ipcRenderer.on('canvas:agent-event', listener);
    return () => {
      ipcRenderer.removeListener('canvas:agent-event', listener);
    };
  },
  onCanvasUpdate: (callback: (update: CanvasUpdateNotificationData) => void) => {
    const listener = (_event: unknown, update: CanvasUpdateNotificationData) => callback(update);
    ipcRenderer.on('canvas:main-chat-update', listener);
    return () => {
      ipcRenderer.removeListener('canvas:main-chat-update', listener);
    };
  },

  // M3E Canvas Live Project Editor (Prompt 4)
  canvasPreviewStart: () => ipcRenderer.invoke('canvas:preview:start'),
  canvasPreviewStatus: () => ipcRenderer.invoke('canvas:preview:status'),
  canvasPreviewStop: () => ipcRenderer.invoke('canvas:preview:stop'),
  canvasPreviewDisposeAll: () => ipcRenderer.invoke('canvas:preview:dispose-all'),
  applyCanvasEdits: (payload: { intents: CanvasEditIntent[] }) => ipcRenderer.invoke('canvas:edit:apply', payload),
  dispatchCanvasStructural: (payload: CanvasStructuralIntentPayload) => ipcRenderer.invoke('canvas:structural:dispatch', payload),
  onCanvasPreviewStatus: (callback: (payload: CanvasPreviewStatusPayload) => void) => {
    const listener = (_event: unknown, payload: CanvasPreviewStatusPayload) => callback(payload);
    ipcRenderer.on('canvas:preview:status', listener);
    return () => {
      ipcRenderer.removeListener('canvas:preview:status', listener);
    };
  },
  onCanvasEditApplied: (callback: (payload: CanvasEditAppliedPayload) => void) => {
    const listener = (_event: unknown, payload: CanvasEditAppliedPayload) => callback(payload);
    ipcRenderer.on('canvas-edit:applied', listener);
    return () => {
      ipcRenderer.removeListener('canvas-edit:applied', listener);
    };
  },
  onCanvasEditPreviewProposed: (callback: (payload: CanvasPreviewProposedPayload) => void) => {
    const listener = (_event: unknown, payload: CanvasPreviewProposedPayload) => callback(payload);
    ipcRenderer.on('workspace-edit:preview-proposed', listener);
    return () => {
      ipcRenderer.removeListener('workspace-edit:preview-proposed', listener);
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

  // Omni-Debugger: Multi-Engine Diagnostic & Architecture Inspector
  debuggerOpenWindow: () => ipcRenderer.invoke('debugger:open-window'),
  debuggerCloseWindow: () => ipcRenderer.invoke('debugger:close-window'),
  debuggerSyncState: (payload: any) => ipcRenderer.invoke('debugger:sync-state', payload),
  debuggerRequestState: () => ipcRenderer.invoke('debugger:request-state'),
  debuggerRunAnalysis: (payload?: any) => ipcRenderer.invoke('debugger:run-analysis', payload),
  onDebuggerUpdate: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('debugger:update', listener);
    return () => {
      ipcRenderer.removeListener('debugger:update', listener);
    };
  },
  onDebuggerStateSynced: (callback: (state: any) => void) => {
    const listener = (_event: unknown, state: any) => callback(state);
    ipcRenderer.on('debugger:state-synced', listener);
    return () => {
      ipcRenderer.removeListener('debugger:state-synced', listener);
    };
  },
  onDebuggerAiStream: (callback: (frame: any) => void) => {
    const listener = (_event: unknown, frame: any) => callback(frame);
    ipcRenderer.on('debugger:ai-stream', listener);
    return () => {
      ipcRenderer.removeListener('debugger:ai-stream', listener);
    };
  },
  setDebuggerModelMode: (mode: 'auto' | 'manual', modelId?: string, providerId?: string) =>
    ipcRenderer.invoke('debugger:set-model-mode', { mode, modelId, providerId }),
  getDebuggerModelPreferences: () => ipcRenderer.invoke('debugger:get-model-preferences'),
  getDebuggerTaskModels: () => ipcRenderer.invoke('debugger:get-task-models'),
  onDebuggerModelPreferencesChanged: (callback: (prefs: any) => void) => {
    const listener = (_event: unknown, prefs: any) => callback(prefs);
    ipcRenderer.on('debugger:model-preferences-changed', listener);
    return () => {
      ipcRenderer.removeListener('debugger:model-preferences-changed', listener);
    };
  },

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
  agentFrameworkSet: (framework: string) => ipcRenderer.invoke('agent-framework:set', framework),
  agentFrameworkGet: () => ipcRenderer.invoke('agent-framework:get'),
  opencodeGetMergedProviders: () => ipcRenderer.invoke('opencode:get-merged-providers'),
  opencodeGetServiceStatus: () => ipcRenderer.invoke('opencode:get-service-status'),
  opencodeRefreshStandardSupply: () => ipcRenderer.invoke('opencode:refresh-standard-supply'),
  opencodeInstall: () => ipcRenderer.invoke('opencode:install'),
  opencodeInstallStatus: () => ipcRenderer.invoke('opencode:install-status'),
  onOpencodeInstallProgress: (callback: (progress: any) => void) => {
    const listener = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('opencode:install-progress', listener);
    return () => {
      ipcRenderer.removeListener('opencode:install-progress', listener);
    };
  },

  // Phase 6.4: Intelligent Model Router
  modelRouterClassifyTask: (prompt: string) => ipcRenderer.invoke('model-router:classify-task', prompt),
  modelRouterSelectModel: (prompt: string, overridePreferences?: any) => ipcRenderer.invoke('model-router:select-model', prompt, overridePreferences),
  modelRouterGetPreferences: () => ipcRenderer.invoke('model-router:get-preferences'),
  modelRouterSetPreferences: (updates: any) => ipcRenderer.invoke('model-router:set-preferences', updates),
  modelRouterGetAvailableModels: () => ipcRenderer.invoke('model-router:get-available-models'),
  getAvailableModels: () => ipcRenderer.invoke('models:get-available-models'),
  getModelAvailabilitySummary: () => ipcRenderer.invoke('models:get-availability-summary'),
  resetModelsAvailabilityCache: () => ipcRenderer.invoke('models:reset-availability-cache'),
  updateActiveModelConfig: (config) => ipcRenderer.invoke('models:update-active-model-config', config),
  getCommunityKeyStatus: () => ipcRenderer.invoke('community-key:get-status'),
  onCommunityKeyStatusChanged: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('community-key:status-changed', listener);
    return () => ipcRenderer.removeListener('community-key:status-changed', listener);
  },
  verifyModelCatalog: () => ipcRenderer.invoke('providers:verify-model-catalog'),
  getModelCatalogVerifications: () => ipcRenderer.invoke('providers:get-model-catalog-verifications'),
  onModelCatalogVerified: (callback: (snapshot: any) => void) => {
    const listener = (_event: any, snapshot: any) => callback(snapshot);
    ipcRenderer.on('providers:catalog-verified', listener);
    return () => ipcRenderer.removeListener('providers:catalog-verified', listener);
  },

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
  getDiagnosticsLatest: () => ipcRenderer.invoke('diagnostics:get-latest'),

  // Stream Hygiene (Prompt 2): FCC sidecar log ledger
  getSidecarLedger: (limit?: number) => ipcRenderer.invoke('sidecar-ledger:get', limit),

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
  perfGetBootHistory: () => ipcRenderer.invoke('perf:get-boot-history'),
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
  usageGetStats: () => ipcRenderer.invoke('usage:get-ledger'),
  usageExportLedger: (format?: 'json' | 'csv') => ipcRenderer.invoke('usage:export-ledger', format),
  usageExport: (format?: 'json' | 'csv') => ipcRenderer.invoke('usage:export-ledger', format),
  usageClearLedger: () => ipcRenderer.invoke('usage:clear-ledger'),
  ledgerQuery: (filter?: any) => ipcRenderer.invoke('ledger:query', filter),
  ledgerGetInsights: (options?: any) => ipcRenderer.invoke('ledger:insights', options),
  ledgerFlush: () => ipcRenderer.invoke('ledger:flush'),
  policyGetEffective: () => ipcRenderer.invoke('policy:get-effective'),
  policyAssertAllowed: (action: any) => ipcRenderer.invoke('policy:assert-allowed', action),
  policyReload: (workspacePath?: string) => ipcRenderer.invoke('policy:reload', workspacePath),

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
  onboardingSaveState: (updates: any) => ipcRenderer.invoke('onboarding:save-state', updates),

  getVerifiedModels: () => ipcRenderer.invoke('get-verified-models'),
  saveOpenCodeApiKey: (provider: string, key: string) => ipcRenderer.invoke('opencode:save-api-key', provider, key),
  getOpenCodeKeyStatus: () => ipcRenderer.invoke('opencode:get-key-status'),

  // OpenCode Free Tier chat bridge (Prompt 3): dedicated stream + stop channel
  sendOpenCodeMessage: (payload: { modelId: string; prompt?: string; messages?: Array<{ role: string; content: string }> }) =>
    ipcRenderer.invoke('opencode:send-message', payload),
  onOpenCodeStream: (callback: (chunk: string) => void) => {
    const listener = (_event: unknown, chunk: string) => callback(chunk);
    ipcRenderer.on('opencode:stream', listener);
    return () => {
      ipcRenderer.removeListener('opencode:stream', listener);
    };
  },
  onOpenCodeDone: (callback: (payload?: { stopped?: boolean }) => void) => {
    const listener = (_event: unknown, payload?: { stopped?: boolean }) => callback(payload);
    ipcRenderer.on('opencode:done', listener);
    return () => {
      ipcRenderer.removeListener('opencode:done', listener);
    };
  },
  onOpenCodeError: (callback: (payload: { message: string }) => void) => {
    const listener = (_event: unknown, payload: { message: string }) => callback(payload);
    ipcRenderer.on('opencode:error', listener);
    return () => {
      ipcRenderer.removeListener('opencode:error', listener);
    };
  },
  stopOpenCodeProcess: () => ipcRenderer.invoke('opencode:stop-process'),
  testVerifiedApi: (data: { modelId: string; prompt: string; apiKey?: string }) =>
    ipcRenderer.invoke('test-verified-api', data),
  onVerifiedApiChunk: (cb: (chunk: string) => void) => {
    const listener = (_e: any, chunk: string) => cb(chunk);
    ipcRenderer.on('verified-api-chunk', listener);
    return () => ipcRenderer.removeListener('verified-api-chunk', listener);
  },
  onVerifiedApiEnd: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('verified-api-end', listener);
    return () => ipcRenderer.removeListener('verified-api-end', listener);
  },
  onVerifiedApiError: (cb: (err: string) => void) => {
    const listener = (_e: any, err: string) => cb(err);
    ipcRenderer.on('verified-api-error', listener);
    return () => ipcRenderer.removeListener('verified-api-error', listener);
  },

  testGroundTruthApi: () => ipcRenderer.invoke('test-ground-truth-api'),
  onGroundTruthChunk: (cb: (chunk: string) => void) => {
    const listener = (_e: any, chunk: string) => cb(chunk);
    ipcRenderer.on('ground-truth-chunk', listener);
    return () => ipcRenderer.removeListener('ground-truth-chunk', listener);
  },
  onGroundTruthEnd: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('ground-truth-end', listener);
    return () => ipcRenderer.removeListener('ground-truth-end', listener);
  },
  onGroundTruthError: (cb: (err: string) => void) => {
    const listener = (_e: any, err: string) => cb(err);
    ipcRenderer.on('ground-truth-error', listener);
    return () => ipcRenderer.removeListener('ground-truth-error', listener);
  },

  testProviderKey: (provider: string, key: string) => ipcRenderer.invoke('test-provider-key', provider, key),
  saveProviderKey: (provider: string, key: string) => ipcRenderer.invoke('save-provider-key', provider, key),
  getProviderKey: (provider: string) => ipcRenderer.invoke('get-provider-key', provider),

  initiateCopilotDeviceFlow: () => ipcRenderer.invoke('initiate-copilot-device-flow'),
  pollCopilotToken: (deviceCode: string) => ipcRenderer.invoke('poll-copilot-token', deviceCode),

  onProviderHandoff: (cb: (data: { fromProvider: string; toProvider: string; newModel: string }) => void) => {
    const handler = (_event: any, data: any) => cb(data);
    ipcRenderer.on('agent:provider-handoff', handler);
    return () => {
      ipcRenderer.removeListener('agent:provider-handoff', handler);
    };
  },

  // Agent State Management
  getAgentTodos: () => ipcRenderer.invoke('agent:get-todos'),
  setAgentMode: (mode: 'plan' | 'execute' | 'hybrid') => ipcRenderer.invoke('agent:set-mode', mode),
  getRecentSessions: (workspacePath?: string) => ipcRenderer.invoke('agent:list-sessions', workspacePath),
  addApprovalRule: (rule: { id?: string; toolName: string; pattern?: string; action: 'always_ask' | 'auto_approve' | 'auto_deny'; scope: 'workspace' | 'system' | 'network'; expiresAt?: number }) => ipcRenderer.invoke('agent:add-approval-rule', rule),
  getBackgroundAgents: () => ipcRenderer.invoke('agent:get-background-agents'),
  getBackgroundAgentDetails: (agentId: string) => ipcRenderer.invoke('agent:get-background-agent-details', agentId),
  cancelBackgroundAgent: (agentId: string) => ipcRenderer.invoke('agent:cancel-background-agent', agentId),
  getAgentTelemetryReport: () => ipcRenderer.invoke('agent:get-telemetry-report'),
  getAgentTelemetryEvents: (filter?: { type?: string; startTime?: number }) => ipcRenderer.invoke('agent:get-telemetry-events', filter),
  exportAgentTelemetry: () => ipcRenderer.invoke('agent:export-telemetry'),
  clearAgentTelemetry: () => ipcRenderer.invoke('agent:clear-telemetry'),
  ensureVoiceReady: () => ipcRenderer.invoke('voice:init'),
  startVoiceRecording: () => ipcRenderer.invoke('voice:start-recording'),
  appendVoiceChunk: (sessionId: string, audioBase64: string) => ipcRenderer.invoke('voice:append-audio-chunk', sessionId, audioBase64),
  stopVoiceRecording: (sessionId: string) => ipcRenderer.invoke('voice:stop-and-transcribe', sessionId),
  discardVoiceSession: (sessionId: string) => ipcRenderer.invoke('voice:discard-session', sessionId),
  releaseVoiceRecording: () => ipcRenderer.invoke('voice:release'),
  onAgentStateUpdate: (callback: (state: { todos: any[]; mode: string; iteration: number }) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.removeListener('agent:state', handler);
  },

  // Brave Browser Integration & Automation
  detectBraveBrowser: () => ipcRenderer.invoke('brave:detect'),
  installBraveBrowser: (options) => ipcRenderer.invoke('brave:install', options),
  getBraveStatus: () => ipcRenderer.invoke('brave:get-status'),
  setBraveEnabled: (enabled: boolean) => ipcRenderer.invoke('brave:set-enabled', enabled),
  braveSearch: (query: string) => ipcRenderer.invoke('brave:search', query),
  braveNavigate: (url: string) => ipcRenderer.invoke('brave:navigate', url),
  braveGetPageContent: () => ipcRenderer.invoke('brave:get-page-content'),
  braveClose: () => ipcRenderer.invoke('brave:close'),
  startBraveTesting: (url: string, options?: { openVisibleWindow?: boolean }) =>
    ipcRenderer.invoke('brave:start-testing', { url, ...(options || {}) }),
  stopBraveTesting: () => ipcRenderer.invoke('brave:stop-testing'),
  onBraveTestingUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('brave:testing-update', handler);
    return () => ipcRenderer.removeListener('brave:testing-update', handler);
  },
  getEffectivePolicy: () => ipcRenderer.invoke('policy:get-effective'),
  queryLedger: (filter?: any) => ipcRenderer.invoke('ledger:query', filter),
  getLedgerInsights: (filter?: any) => ipcRenderer.invoke('ledger:insights', filter)
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
