import type { z } from 'zod';
import type { ExtensionCapabilitySchema, ExtensionManifestSchema } from './extension-schemas';

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FileNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  children?: FileNode[];
}

export type RoutingStrategyType = 'auto' | 'free-first' | 'fastest' | 'balanced' | 'manual';

export type ProviderType = 'openrouter' | 'groq' | 'deepseek' | 'ollama' | 'fcc-proxy' | 'custom' | (string & {});

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderType;
  contextLength?: number;
  isFree?: boolean;
  description?: string;
}

export interface TerminalProfile {
  id: string;
  name: string;
  shellId: string;
  customShellPath?: string;
}

export type TerminalSplitOrientation = 'horizontal' | 'vertical';
export type ToolExecutionStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface EditorPreferences {
  fontSize?: number;
  tabSize?: number;
  minimap?: boolean;
  bracketPairs?: boolean;
  autoSave?: 'off' | 'afterDelay' | 'onFocusChange';
  autoSaveDelay?: number;
  wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  formatOnSave?: boolean;
}

export type AgentHarnessType =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'pi'
  | 'cline'
  | 'aider'
  | 'hermes'
  | 'deepseek'
  | 'grok-build'
  | 'muse-code'
  | 'vscode-chat';

export interface ProviderSettings {
  activeProvider: ProviderType;
  activeModel: string;
  activeHarness?: AgentHarnessType;
  apiKeys: Partial<Record<ProviderType, string>>;
  apiKeysConfigured?: Partial<Record<ProviderType, boolean>>;
  customEndpoints: Partial<Record<ProviderType, string>>;
  temperature: number;
  maxTokens: number;
  routingStrategy?: RoutingStrategyType;
  enableFailover?: boolean;
  maxFailoverRetries?: number;
  healthMonitoringEnabled?: boolean;
  healthCheckIntervalMs?: number;
  terminalProfiles?: TerminalProfile[];
  defaultTerminalProfileId?: string;
  thirdPartyRuntimeEnabled?: boolean;
  'editor.reviewPolicy'?: EditReviewPolicy;
  'lsp.autoStart'?: boolean;
  editor?: EditorPreferences;
  languageServers?: Record<string, LanguageServerConfig>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCall?: ToolCall;
  toolStatus?: ToolExecutionStatus;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  proposedDiffs?: ProposedDiff[];
  reasoning?: string;
  timestamp: number;
}

export interface ProposedDiff {
  id: string;
  filePath: string;
  originalContent: string;
  proposedContent: string;
  description: string;
  status: 'pending' | 'applied' | 'rejected';
}

export interface AgentToolApproval {
  id: string;
  toolCall: ToolCall;
  reason: string;
  affectedPaths?: string[];
}

export interface AgentStreamChunk {
  type: 'token' | 'thought' | 'tool_call' | 'tool_result' | 'diff' | 'status' | 'approval_request' | 'done' | 'cancelled' | 'error';
  taskId?: string;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  diff?: ProposedDiff;
  approvalRequest?: AgentToolApproval;
  error?: string;
}

export interface CommandExecutionOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellInfo {
  id: string;
  name: string;
  path: string;
  isDefault?: boolean;
}

export interface PtySpawnOptions {
  shellId?: string;
  profileId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface PtySessionInfo {
  ptyId: string;
  shellId: string;
  shellName: string;
}

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;
export type ExtensionCapability = z.infer<typeof ExtensionCapabilitySchema>;
export type ExtensionExecutionState = 'built-in' | 'metadata-only';

export interface InstalledExtension {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  installPath: string;
  installedAt: number;
  settings?: Record<string, unknown>;
  executionState?: ExtensionExecutionState;
}

export interface ExtensionCommand {
  id: string;
  title: string;
  category?: string;
  extensionId: string;
  isBuiltIn?: boolean;
}

export interface ExtensionCapabilityRequest {
  extensionId: string;
  capability: ExtensionCapability;
  method: 'workspace.read-file' | 'workspace.write-file';
  relativePath: string;
  content?: string;
}

export interface ExtensionMetadata {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  iconUrl?: string;
  downloadCount?: number;
  rating?: number;
  publishedDate?: string;
  repository?: string;
  downloadUrl?: string;
  categories?: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  content?: string;
}

export interface GitFileChange {
  path: string;
  originalPath?: string;
  status: 'M' | 'A' | 'D' | 'U' | 'C' | 'R' | '?';
  staged: boolean;
  workingTree: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  repositoryRoot?: string;
  currentBranch: string;
  trackingBranch?: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  stagedFiles: GitFileChange[];
  unstagedFiles: GitFileChange[];
  untrackedFiles: GitFileChange[];
  conflictedFiles: GitFileChange[];
  userName?: string;
  userEmail?: string;
  remoteUrl?: string;
}

export interface GitBranchInfo {
  current: string;
  all: string[];
  branches: Record<string, { current: boolean; name: string; commit: string; label: string }>;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
  refs?: string;
}

export interface GitBlameHunk {
  commitHash: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  dateString: string;
  summary: string;
  lineStart: number;
  lineCount: number;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
  provider?: 'github' | 'gitlab' | 'bitbucket' | 'other';
}

export interface GitFileDiff {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  patch: string;
}

export interface GitCommitDetail {
  commit: GitCommitInfo;
  files: GitFileChange[];
  diff: string;
}

export interface GitTagInfo {
  name: string;
  commit: string;
}

export interface GitStashInfo {
  index: number;
  hash: string;
  date: string;
  message: string;
}

export interface GitConflictContent {
  filePath: string;
  baseContent?: string;
  oursContent?: string;
  theirsContent?: string;
  workingContent: string;
}

export interface GitHunk {
  id: string;
  header: string;
  patch: string;
  oldStart: number;
  newStart: number;
}

export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  selectWorkspaceFolder: () => Promise<IpcResponse<string>>;
  getWorkspaceTree: (rootPath: string) => Promise<IpcResponse<FileNode>>;
  readFile: (filePath: string) => Promise<IpcResponse<string>>;
  writeFile: (filePath: string, content: string) => Promise<IpcResponse<void>>;
  createFile: (filePath: string) => Promise<IpcResponse<void>>;
  createDirectory: (dirPath: string) => Promise<IpcResponse<void>>;
  deletePath: (targetPath: string) => Promise<IpcResponse<void>>;
  renamePath: (oldPath: string, newPath: string) => Promise<IpcResponse<void>>;
  searchFiles: (query: string) => Promise<IpcResponse<string[]>>;
  getSettings: () => Promise<IpcResponse<ProviderSettings>>;
  saveSettings: (settings: Partial<ProviderSettings>) => Promise<IpcResponse<void>>;
  startAgentTask: (params: {
    taskId?: string;
    prompt: string;
    workspacePath: string;
    history: ChatMessage[];
    activeFilePath?: string;
    activeFileContent?: string;
    skills?: SkillDefinition[];
  }) => Promise<IpcResponse<string>>;
  stopAgentTask: (taskId: string) => Promise<IpcResponse<void>>;
  respondAgentApproval: (approvalId: string, approved: boolean) => Promise<IpcResponse<void>>;
  onAgentStream: (callback: (chunk: AgentStreamChunk) => void) => () => void;
  applyDiff: (diff: ProposedDiff) => Promise<IpcResponse<void>>;
  runCommand: (options: CommandExecutionOptions) => Promise<IpcResponse<CommandResult>>;
  getAvailableShells: () => Promise<IpcResponse<ShellInfo[]>>;
  spawnPty: (options: PtySpawnOptions) => Promise<IpcResponse<PtySessionInfo>>;
  attachPty: (ptyId: string) => Promise<IpcResponse<void>>;
  writePty: (ptyId: string, data: string) => void;
  resizePty: (ptyId: string, cols: number, rows: number) => void;
  syncPtyCwd: (ptyId: string, targetCwd: string, shellId: string) => void;
  killPty: (ptyId: string) => Promise<IpcResponse<void>>;
  onPtyData: (ptyId: string, callback: (data: string) => void) => () => void;
  onPtyExit: (ptyId: string, callback: (exitCode: number) => void) => () => void;
  searchExtensions: (query: string) => Promise<IpcResponse<ExtensionMetadata[]>>;
  getExtensionDetails: (namespace: string, name: string) => Promise<IpcResponse<Record<string, unknown>>>;
  getAvailableSkills: (workspacePath: string) => Promise<IpcResponse<SkillDefinition[]>>;

  // Extension Management APIs
  getInstalledExtensions: () => Promise<IpcResponse<InstalledExtension[]>>;
  installExtension: (ext: ExtensionMetadata) => Promise<IpcResponse<InstalledExtension>>;
  uninstallExtension: (id: string) => Promise<IpcResponse<void>>;
  toggleExtension: (id: string, enabled: boolean) => Promise<IpcResponse<InstalledExtension>>;
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => Promise<IpcResponse<void>>;
  installExtensionFromVsix: () => Promise<IpcResponse<InstalledExtension>>;
  extensionCapability: (request: ExtensionCapabilityRequest) => Promise<IpcResponse<unknown>>;

  // Git Source Control APIs
  gitIsRepo: () => Promise<IpcResponse<boolean>>;
  gitInit: () => Promise<IpcResponse<void>>;
  gitGetStatus: () => Promise<IpcResponse<GitStatusResult>>;
  gitGetDiff: (filePath?: string, staged?: boolean) => Promise<IpcResponse<string>>;
  gitGetOriginalContent: (filePath: string, staged?: boolean) => Promise<IpcResponse<string>>;
  gitStage: (filePaths: string | string[]) => Promise<IpcResponse<void>>;
  gitUnstage: (filePaths: string | string[]) => Promise<IpcResponse<void>>;
  gitDiscardChanges: (filePath: string, isUntracked?: boolean) => Promise<IpcResponse<void>>;
  gitCommit: (message: string, options?: { amend?: boolean }) => Promise<IpcResponse<string>>;
  gitGetBranches: () => Promise<IpcResponse<GitBranchInfo>>;
  gitSwitchBranch: (branchName: string) => Promise<IpcResponse<void>>;
  gitCreateBranch: (branchName: string) => Promise<IpcResponse<void>>;
  gitDeleteBranch: (branchName: string, force?: boolean) => Promise<IpcResponse<void>>;
  gitFetch: () => Promise<IpcResponse<void>>;
  gitPull: () => Promise<IpcResponse<string>>;
  gitPush: (remote?: string, branch?: string) => Promise<IpcResponse<string>>;
  gitGetLog: (maxCount?: number, search?: string) => Promise<IpcResponse<GitCommitInfo[]>>;
  gitGetBlame: (filePath: string) => Promise<IpcResponse<GitBlameHunk[]>>;
  gitStash: (action: 'list' | 'save' | 'pop' | 'drop', message?: string, index?: number) => Promise<IpcResponse<GitStashInfo[] | string>>;
  gitGetRemotes: () => Promise<IpcResponse<GitRemoteInfo[]>>;
  gitGetFileDiff: (filePath: string, staged?: boolean) => Promise<IpcResponse<GitFileDiff>>;
  gitGetCommitDetail: (hash: string) => Promise<IpcResponse<GitCommitDetail>>;
  gitGetTags: () => Promise<IpcResponse<GitTagInfo[]>>;
  gitCreateTag: (name: string, message?: string) => Promise<IpcResponse<void>>;
  gitDeleteTag: (name: string) => Promise<IpcResponse<void>>;
  gitGetConflictContent: (filePath: string) => Promise<IpcResponse<GitConflictContent>>;
  gitResolveConflict: (filePath: string, action: 'ours' | 'theirs' | 'mark-resolved') => Promise<IpcResponse<void>>;
  gitAbortMerge: () => Promise<IpcResponse<void>>;
  gitGetHunks: (filePath: string, staged?: boolean) => Promise<IpcResponse<GitHunk[]>>;
  gitApplyHunk: (filePath: string, hunkId: string, operation: 'stage' | 'unstage' | 'revert') => Promise<IpcResponse<void>>;
  gitMerge: (branchName: string) => Promise<IpcResponse<{ success: boolean; conflicts?: string[]; message?: string }>>;

  // Search & Replace APIs
  searchInFiles: (options: SearchInFilesOptions) => Promise<IpcResponse<FileSearchResult[]>>;
  replaceInFiles: (options: ReplaceInFilesOptions) => Promise<IpcResponse<{ replacedCount: number; filesChanged: number; results: ReplaceResult[] }>>;
  previewReplace: (options: ReplaceInFilesOptions) => Promise<IpcResponse<WorkspaceEditFlowResult>>;
  applyWorkspaceEdit: (previewId: string) => Promise<IpcResponse<WorkspaceEditTransactionResult>>;
  previewLspWorkspaceEdit: (params: { edit: unknown; title: string; origin: 'lsp-rename' | 'refactor'; forcePreview?: boolean }) => Promise<IpcResponse<WorkspaceEditFlowResult>>;
  previewSnippetEdit: (params: SnippetEditPreviewRequest) => Promise<IpcResponse<WorkspaceEditFlowResult>>;
  cancelWorkspaceEdit: (previewId: string) => Promise<IpcResponse<void>>;
  undoWorkspaceEdit: (transactionId?: string) => Promise<IpcResponse<WorkspaceEditTransactionResult>>;
  getRecentWorkspaceEdits: () => Promise<IpcResponse<Array<{ transactionId: string; origin: WorkspaceEditOrigin; createdAt: number; fileCount: number; autoApplied: true }>>>;

  // Language Server Protocol (LSP) APIs
  lspGetServers: () => Promise<IpcResponse<LanguageServerStatus[]>>;
  lspStartServer: (languageId: string) => Promise<IpcResponse<boolean>>;
  lspStopServer: (languageId: string) => Promise<IpcResponse<void>>;
  lspRestartServer: (languageId: string) => Promise<IpcResponse<boolean>>;
  lspConfigureServer: (languageId: string, config: LanguageServerConfig) => Promise<IpcResponse<void>>;
  lspDidOpen: (params: { filePath: string; languageId: string; text: string }) => Promise<IpcResponse<void>>;
  lspDidChange: (params: { filePath: string; text: string }) => Promise<IpcResponse<void>>;
  lspDidSave: (params: { filePath: string; text?: string }) => Promise<IpcResponse<void>>;
  lspDidClose: (params: { filePath: string }) => Promise<IpcResponse<void>>;
  lspCompletion: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  lspHover: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  lspDefinition: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  lspTypeDefinition: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  lspImplementation: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  lspReferences: (params: { filePath: string; line: number; character: number; includeDeclaration?: boolean }) => Promise<IpcResponse<any>>;
  lspRename: (params: { filePath: string; line: number; character: number; newName: string }) => Promise<IpcResponse<any>>;
  lspRenamePreview: (params: { filePath: string; line: number; character: number; newName: string; forcePreview?: boolean }) => Promise<IpcResponse<WorkspaceEditFlowResult>>;
  lspDocumentSymbols: (params: { filePath: string }) => Promise<IpcResponse<any>>;
  lspWorkspaceSymbols: (params: { query: string }) => Promise<IpcResponse<any>>;
  lspCodeActions: (params: { filePath: string; range: any; context?: any }) => Promise<IpcResponse<any>>;
  lspSignatureHelp: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
  onLspDiagnostics: (callback: (event: LspDiagnosticsEvent) => void) => () => void;

  // Workspace & Navigation
  setWorkspaceFolder: (folderPath: string) => Promise<IpcResponse<FileNode>>;
  getRecentWorkspaces: () => Promise<IpcResponse<RecentWorkspace[]>>;
  addRecentWorkspace: (folderPath: string) => Promise<IpcResponse<RecentWorkspace[]>>;
  clearRecentWorkspaces: () => Promise<IpcResponse<void>>;

  // Auto-Update APIs
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
  getUpdateChannel: () => Promise<IpcResponse<string>>;
  setUpdateChannel: (channel: string) => Promise<IpcResponse<void>>;
  onUpdateStatus: (callback: (status: { type: string; [key: string]: any }) => void) => () => void;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;

  // Myers Diff & App Info
  computeMyersDiff: (params: { original: string; modified: string; contextLines?: number }) => Promise<IpcResponse<MyersDiffResult>>;
  getAppInfo: () => Promise<IpcResponse<AppInfo>>;

  // Phase 7: Advanced AI Features & Competitive Differentiation
  getInlineCompletions: (params: InlineCompletionRequest) => Promise<IpcResponse<InlineCompletionResponse>>;
  indexProject: (workspacePath?: string) => Promise<IpcResponse<ProjectIndexStats>>;
  getProjectIndexStats: () => Promise<IpcResponse<ProjectIndexStats | null>>;
  queryProjectContext: (query: ProjectContextQuery) => Promise<IpcResponse<ProjectContextResult>>;
  runCodeReview: (params: CodeReviewRequest) => Promise<IpcResponse<CodeReviewResult>>;
  getCodeReviewRules: () => Promise<IpcResponse<CodeReviewRule[]>>;
  updateCodeReviewRules: (rules: CodeReviewRule[]) => Promise<IpcResponse<void>>;
  requestRefactorPreview: (request: RefactorRequest) => Promise<IpcResponse<RefactorResult>>;
  generateCodeFromPrompt: (request: GenerateCodeRequest) => Promise<IpcResponse<GenerateCodeResult>>;
  parseNaturalLanguageCommand: (request: NaturalLanguageCommandRequest) => Promise<IpcResponse<NaturalLanguageCommandResult>>;
  getConversationMemories: (query?: MemoryQuery) => Promise<IpcResponse<ConversationMemoryEntry[]>>;
  addConversationMemory: (memory: Partial<ConversationMemoryEntry>) => Promise<IpcResponse<ConversationMemoryEntry>>;
  getPairProgrammingSuggestions: (event: PairProgrammingEvent) => Promise<IpcResponse<PairProgrammingSuggestion[]>>;

  // Phase 5.2: FCC Server Integration (Layer 3)
  fccGetStatus: () => Promise<IpcResponse<FCCServerStatus>>;
  fccStart: () => Promise<IpcResponse<boolean>>;
  fccStop: () => Promise<IpcResponse<void>>;
  fccRestart: () => Promise<IpcResponse<boolean>>;
  fccAutoSetup: (providerId?: string) => Promise<IpcResponse<FCCAutoSetupResult | FCCAutoSetupResult[]>>;
}

export interface FCCServerStatus {
  running: boolean;
  port: number;
  pid?: number;
  health: 'healthy' | 'degraded' | 'stopped';
  restartCount: number;
  uptimeSeconds: number;
  version: string;
  mode: 'native-sidecar' | 'external-process';
  providersCount: number;
  freeTokensAllocated: number;
  freeTokensUsed: number;
  lastPingTimestamp: number;
}

export interface FCCAutoSetupResult {
  providerId: string;
  providerName: string;
  success: boolean;
  message: string;
  apiKey?: string;
  endpoint?: string;
  modelsFound?: string[];
  freeMonthlyTokens?: number;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: number;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
}

export interface MyersDiffResult {
  edits: Array<{ operation: 'equal' | 'insert' | 'delete'; text: string; oldLineNumber?: number; newLineNumber?: number }>;
  unifiedDiff: string;
  hunks: Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; header: string; lines: string[] }>;
  additions: number;
  deletions: number;
  isIdentical: boolean;
}

export interface SearchInFilesOptions {
  query: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  matchWholeWord?: boolean;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchLength: number;
  preview: string;
}

export interface FileSearchResult {
  filePath: string;
  relativePath: string;
  matches: SearchMatch[];
}

export interface ReplaceInFilesOptions extends SearchInFilesOptions {
  replacement: string;
  dryRun?: boolean;
  filePaths?: string[];
  forcePreview?: boolean;
}

export interface ReplaceResult {
  filePath: string;
  relativePath: string;
  replacedCount: number;
  previewDiff?: string;
}

export type WorkspaceEditOrigin = 'lsp-rename' | 'search-replace' | 'refactor';
export type EditReviewPolicy = 'alwaysReview' | 'autoApplySafeSingleFile';

export interface WorkspaceEditPreviewFile {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  diff: MyersDiffResult;
  editCount: number;
  documentVersion?: number;
  isDirty?: boolean;
}

export interface WorkspaceEditPreview {
  previewId: string;
  origin: WorkspaceEditOrigin;
  title: string;
  files: WorkspaceEditPreviewFile[];
  totalEdits: number;
  expiresAt: number;
  blockedReason?: string;
}

export interface WorkspaceEditFlowResult {
  preview?: WorkspaceEditPreview;
  applied?: WorkspaceEditTransactionResult;
}

export interface SnippetEditPreviewRequest {
  filePath: string;
  lineNumber: number;
  originalText: string;
  replacementText: string;
  title: string;
  forcePreview?: boolean;
}

export interface WorkspaceEditTransactionResult {
  transactionId: string;
  origin: WorkspaceEditOrigin;
  autoApplied?: boolean;
  files: Array<{ filePath: string; content: string; isDirty: boolean }>;
  fileCount: number;
  editCount: number;
}

export interface LanguageServerConfig {
  enabled: boolean;
  args?: string[];
  path?: string;
}

export interface LanguageServerInstallCommand {
  platform: 'win32' | 'darwin' | 'linux';
  command?: string;
  guidance: string;
  sourceUrl: string;
}

export interface WorkspaceServerCandidate {
  path: string;
  source: 'node_modules' | 'cargo-target' | 'python-venv' | 'workspace-bin';
}

export interface LspDiagnosticItem {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspDiagnosticsEvent {
  filePath: string;
  uri: string;
  languageId: string;
  diagnostics: LspDiagnosticItem[];
}

export interface LanguageServerStatus {
  languageId: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'disabled';
  isAvailable: boolean;
  command: string;
  args: string[];
  extensions: string[];
  installInstructions: string;
  error?: string;
  resolvedPath?: string;
  version?: string;
  workspaceCandidates?: WorkspaceServerCandidate[];
  installCommands?: LanguageServerInstallCommand[];
  isExplicitPath?: boolean;
  configuredPath?: string;
}

// Phase 7: Advanced AI Features & Competitive Differentiation Interfaces

export interface InlineCompletionRequest {
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
  line: number;
  character: number;
  triggerKind?: 'automatic' | 'manual';
}

export interface InlineCompletionItem {
  text: string;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  command?: string;
  source?: 'llm' | 'cache' | 'heuristic';
}

export interface InlineCompletionResponse {
  items: InlineCompletionItem[];
  cached?: boolean;
  latencyMs?: number;
}

export interface ProjectSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'type' | 'method';
  filePath: string;
  line: number;
  documentation?: string;
  signature?: string;
}

export interface ProjectIndexStats {
  fileCount: number;
  symbolCount: number;
  exportCount: number;
  indexedInMs: number;
  frameworks: string[];
  languages: Record<string, number>;
  lastIndexedAt: number;
  customInstructions?: string;
}

export interface ProjectContextQuery {
  query: string;
  limit?: number;
  activeFilePath?: string;
}

export interface ProjectContextResult {
  files: string[];
  symbols: ProjectSymbol[];
  instructions?: string;
  summary: string;
  frameworks: string[];
  relevantSnippets: Array<{ filePath: string; lineStart: number; content: string }>;
}

export interface ConversationMemoryEntry {
  id: string;
  timestamp: number;
  topic: string;
  summary: string;
  keyDecisions: string[];
  relevantFiles: string[];
  tags: string[];
}

export interface MemoryQuery {
  query: string;
  limit?: number;
}

export interface CodeReviewRule {
  id: string;
  name: string;
  category: 'bug' | 'security' | 'performance' | 'style';
  severity: 'error' | 'warning' | 'info';
  description: string;
  pattern?: string;
  fixTemplate?: string;
  enabled: boolean;
}

export interface CodeReviewFinding {
  id: string;
  ruleId?: string;
  filePath: string;
  line: number;
  endLine?: number;
  category: 'bug' | 'security' | 'performance' | 'style';
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  codeSnippet?: string;
  suggestedFix?: {
    originalText: string;
    replacementText: string;
  };
}

export interface CodeReviewRequest {
  filePath?: string;
  content?: string;
  allWorkspace?: boolean;
  customRules?: CodeReviewRule[];
}

export interface CodeReviewResult {
  findings: CodeReviewFinding[];
  summary: {
    total: number;
    bugs: number;
    security: number;
    performance: number;
    style: number;
  };
  reviewedFiles: string[];
  timestamp: number;
}

export type RefactorType =
  | 'extract-function'
  | 'extract-variable'
  | 'inline-variable'
  | 'ai-rename'
  | 'convert-to-functional'
  | 'add-error-handling'
  | 'add-typescript-types';

export interface RefactorRequest {
  type: RefactorType;
  filePath: string;
  selectedText: string;
  selectionRange: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  targetName?: string;
  customPrompt?: string;
  forcePreview?: boolean;
}

export interface RefactorResult {
  preview: WorkspaceEditPreview;
  applied?: WorkspaceEditTransactionResult;
  suggestions?: string[];
  explanation?: string;
}

export interface GenerateCodeRequest {
  type: 'comment-to-code' | 'test-generation' | 'documentation' | 'sql-query' | 'regex';
  prompt: string;
  language?: string;
  filePath?: string;
  contextCode?: string;
}

export interface GenerateCodeResult {
  code: string;
  explanation: string;
  language: string;
  targetFilePath?: string;
}

export interface NaturalLanguageCommandRequest {
  input: string;
  context?: {
    activeFilePath?: string;
    selection?: string;
    language?: string;
  };
}

export interface NaturalLanguageCommandResult {
  action: 'execute-command' | 'generate-code' | 'review-code' | 'navigate' | 'chat';
  commandId?: string;
  commandTitle?: string;
  intent?: string;
  args?: unknown[];
  generatedCode?: string;
  message: string;
}

export interface PairProgrammingEvent {
  type: 'cursor-moved' | 'content-changed' | 'file-saved';
  filePath: string;
  language: string;
  line: number;
  content: string;
}

export interface PairProgrammingSuggestion {
  id: string;
  type: 'next-step' | 'bug-alert' | 'refactor-hint' | 'tdd-step';
  title: string;
  message: string;
  codeSnippet?: string;
  actionLabel?: string;
  actionCommand?: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

