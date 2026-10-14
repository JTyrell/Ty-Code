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

export type ProviderType = 'openrouter' | 'groq' | 'deepseek' | 'ollama' | 'fcc-proxy' | 'custom';

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

export interface ProviderSettings {
  activeProvider: ProviderType;
  activeModel: string;
  apiKeys: Partial<Record<ProviderType, string>>;
  apiKeysConfigured?: Partial<Record<ProviderType, boolean>>;
  customEndpoints: Partial<Record<ProviderType, string>>;
  temperature: number;
  maxTokens: number;
  terminalProfiles?: TerminalProfile[];
  defaultTerminalProfileId?: string;
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

export interface AgentStreamChunk {
  type: 'token' | 'thought' | 'tool_call' | 'tool_result' | 'diff' | 'status' | 'done' | 'cancelled' | 'error';
  taskId?: string;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  diff?: ProposedDiff;
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

export interface ExtensionManifest {
  name: string;
  publisher: string;
  version: string;
  displayName?: string;
  description?: string;
  main?: string;
  icon?: string;
  categories?: string[];
  engines?: {
    vscode?: string;
    'ty-claude'?: string;
  };
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{
      command: string;
      title: string;
      category?: string;
      icon?: string;
    }>;
    languages?: Array<{
      id: string;
      aliases?: string[];
      extensions?: string[];
      configuration?: string;
    }>;
    configuration?: {
      title?: string;
      properties?: Record<string, {
        type: string;
        default?: unknown;
        description?: string;
        enum?: unknown[];
      }>;
    };
    keybindings?: Array<{
      command: string;
      key: string;
      mac?: string;
      when?: string;
    }>;
  };
}

export interface InstalledExtension {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  installPath: string;
  installedAt: number;
  settings?: Record<string, unknown>;
}

export interface ExtensionCommand {
  id: string;
  title: string;
  category?: string;
  extensionId: string;
  isBuiltIn?: boolean;
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

  // Git Source Control APIs
  gitIsRepo: (workspacePath?: string) => Promise<IpcResponse<boolean>>;
  gitInit: (workspacePath?: string) => Promise<IpcResponse<void>>;
  gitGetStatus: (workspacePath?: string) => Promise<IpcResponse<GitStatusResult>>;
  gitGetDiff: (filePath?: string, staged?: boolean, workspacePath?: string) => Promise<IpcResponse<string>>;
  gitGetOriginalContent: (filePath: string, staged?: boolean, workspacePath?: string) => Promise<IpcResponse<string>>;
  gitStage: (filePaths: string | string[], workspacePath?: string) => Promise<IpcResponse<void>>;
  gitUnstage: (filePaths: string | string[], workspacePath?: string) => Promise<IpcResponse<void>>;
  gitDiscardChanges: (filePath: string, isUntracked?: boolean, workspacePath?: string) => Promise<IpcResponse<void>>;
  gitCommit: (message: string, options?: { amend?: boolean }, workspacePath?: string) => Promise<IpcResponse<string>>;
  gitGetBranches: (workspacePath?: string) => Promise<IpcResponse<GitBranchInfo>>;
  gitSwitchBranch: (branchName: string, workspacePath?: string) => Promise<IpcResponse<void>>;
  gitCreateBranch: (branchName: string, workspacePath?: string) => Promise<IpcResponse<void>>;
  gitDeleteBranch: (branchName: string, force?: boolean, workspacePath?: string) => Promise<IpcResponse<void>>;
  gitFetch: (workspacePath?: string) => Promise<IpcResponse<void>>;
  gitPull: (workspacePath?: string) => Promise<IpcResponse<string>>;
  gitPush: (remote?: string, branch?: string, workspacePath?: string) => Promise<IpcResponse<string>>;
  gitGetLog: (maxCount?: number, search?: string, workspacePath?: string) => Promise<IpcResponse<GitCommitInfo[]>>;
  gitGetBlame: (filePath: string, workspacePath?: string) => Promise<IpcResponse<GitBlameHunk[]>>;
  gitStash: (action: 'list' | 'save' | 'pop' | 'drop', message?: string, index?: number, workspacePath?: string) => Promise<IpcResponse<GitStashInfo[] | string>>;
  gitGetRemotes: (workspacePath?: string) => Promise<IpcResponse<GitRemoteInfo[]>>;
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
  lspDocumentSymbols: (params: { filePath: string }) => Promise<IpcResponse<any>>;
  lspWorkspaceSymbols: (params: { query: string }) => Promise<IpcResponse<any>>;
  lspCodeActions: (params: { filePath: string; range: any; context?: any }) => Promise<IpcResponse<any>>;
  lspSignatureHelp: (params: { filePath: string; line: number; character: number }) => Promise<IpcResponse<any>>;
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
}

export interface ReplaceResult {
  filePath: string;
  relativePath: string;
  replacedCount: number;
  previewDiff?: string;
}

export interface LanguageServerConfig {
  enabled: boolean;
  command?: string;
  args?: string[];
  customPath?: string;
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

