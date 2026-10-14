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

export interface ProviderSettings {
  activeProvider: ProviderType;
  activeModel: string;
  apiKeys: Partial<Record<ProviderType, string>>;
  customEndpoints: Partial<Record<ProviderType, string>>;
  temperature: number;
  maxTokens: number;
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
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  proposedDiffs?: ProposedDiff[];
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
  type: 'token' | 'thought' | 'tool_call' | 'tool_result' | 'diff' | 'status' | 'done' | 'error';
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

// Shell & Interactive PTY
export interface ShellInfo {
  id: string;
  name: string;
  path: string;
  isDefault?: boolean;
}

export interface PtySpawnOptions {
  shellId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface PtySessionInfo {
  ptyId: string;
  shellId: string;
  shellName: string;
}

// Open VSX Extensions
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
}

// Antigravity Skills & Customs
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  content?: string;
}

export interface ElectronAPI {
  // Window controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // Workspace & File System
  selectWorkspaceFolder: () => Promise<IpcResponse<string>>;
  getWorkspaceTree: (rootPath: string) => Promise<IpcResponse<FileNode>>;
  readFile: (filePath: string) => Promise<IpcResponse<string>>;
  writeFile: (filePath: string, content: string) => Promise<IpcResponse<void>>;
  createFile: (filePath: string) => Promise<IpcResponse<void>>;
  createDirectory: (dirPath: string) => Promise<IpcResponse<void>>;
  deletePath: (targetPath: string) => Promise<IpcResponse<void>>;
  renamePath: (oldPath: string, newPath: string) => Promise<IpcResponse<void>>;
  searchFiles: (query: string) => Promise<IpcResponse<string[]>>;

  // Settings & SafeStorage
  getSettings: () => Promise<IpcResponse<ProviderSettings>>;
  saveSettings: (settings: Partial<ProviderSettings>) => Promise<IpcResponse<void>>;

  // Agentic AI Engine
  startAgentTask: (params: {
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

  // Terminal & Shell Execution (One-shot)
  runCommand: (options: CommandExecutionOptions) => Promise<IpcResponse<CommandResult>>;

  // Interactive OS PTY Terminal
  getAvailableShells: () => Promise<IpcResponse<ShellInfo[]>>;
  spawnPty: (options: PtySpawnOptions) => Promise<IpcResponse<PtySessionInfo>>;
  writePty: (ptyId: string, data: string) => void;
  resizePty: (ptyId: string, cols: number, rows: number) => void;
  killPty: (ptyId: string) => Promise<IpcResponse<void>>;
  onPtyData: (ptyId: string, callback: (data: string) => void) => () => void;
  onPtyExit: (ptyId: string, callback: (exitCode: number) => void) => () => void;

  // VS Code Open VSX Extensions
  searchExtensions: (query: string) => Promise<IpcResponse<ExtensionMetadata[]>>;
  getExtensionDetails: (namespace: string, name: string) => Promise<IpcResponse<Record<string, unknown>>>;

  // Antigravity Skills
  getAvailableSkills: (workspacePath: string) => Promise<IpcResponse<SkillDefinition[]>>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
