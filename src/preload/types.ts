import type { z } from 'zod';
import type { ExtensionCapabilitySchema, ExtensionManifestSchema } from './extension-schemas';
import type { SecurityPolicySettings, SettingsData, SettingsPatch, SettingsScope, TelemetrySettings, WorkspaceSettingsPatch } from '../shared/types/settings';
import type { FreeProvider, ModelTier, TierClassification, ProviderHealthStatus } from '../shared/types/free-providers';
import type { DetectedApiKey, CustomProviderConfig, StoredKeySummary, ByokExportBundle, ByokImportResult, KeyDetectionSource } from '../shared/types/byok';
import type { OpenCodeDetectionResult, OpenCodeFreeTierSummary, OpenCodeImportResult, AgentFramework } from '../shared/types/opencode-sync';
import type {
  BootTrace,
  PerfMark,
  TransitionMetric,
  OpenPerfTraceReport,
  FolderBenchmarkResult,
  FileBenchmarkResult,
  BlockerHuntReport,
  OpenOffenderItem,
  SyncBlockerFinding,
  HugeIpcPayloadFinding,
  RendererMainThreadFinding,
  SyncWatcherOrAutoSaveFinding,
  OpenOffenderCategory,
  FolderOpenStages,
  FileOpenStages,
  OpenStageMetric,
  ReproducibilityVerification
} from '../shared/types/perf';
import type {
  TaskType,
  TaskClassificationResult,
  RoutingPreferenceMode,
  RouterUserPreferences,
  RankedModelCandidate,
  ModelRoutingDecision,
  ModelCatalogCorrection,
  CatalogVerificationResult,
  ModelCatalogVerificationSnapshot
} from '../shared/types/model-router';
import type {
  ProviderConnectionStatus,
  ProviderCategory,
  ConnectedProviderInfo,
  FreeTierSummary,
  RecentActivityRecord,
  HistoricalUsageBucket,
  ModelUsageStat,
  RecommendationType,
  OptimizationRecommendation,
  ProviderComparisonMetric,
  ProviderDashboardData,
  QuotaAlertItem
} from '../shared/types/quota-dashboard';
import type {
  DiagnosticErrorCode,
  DiagnosticStep,
  DiagnosticStatus,
  StepResult,
  ProviderDiagnosticResult,
  DiagnosticRunSummary,
  CapabilityScenarioId,
  ScenarioEvidence,
  ScenarioResult,
  CapabilitySuiteSummary,
  RemediationCategory,
  WorkingNowItem,
  MissingFromYouItem,
  MissingFromCodeItem,
  ExternalOutageItem,
  RecommendedAction,
  RemediationReport,
  SmokeTestStep,
  SMOKE_TEST_STEPS,
  SMOKE_TEST_FAILURE_PROTOCOL,
  FleetHealthState,
  ProviderHealthState,
  ProviderHealthDetail,
  DiagnosticsFleetHealth,
  FailoverNoticeInfo,
  HopId,
  HopTraceRecord,
  ProviderConnectivityTrace,
  MockScanReport,
  FullConnectivityTraceReport
} from '../shared/types/diagnostics';
export type {
  AgentStreamTokenPayload,
  AgentReasoningTokenPayload,
  AgentToolStartPayload,
  AgentToolResultPayload,
  AgentDiffProposedPayload,
  AgentDonePayload,
  ChatErrorCard,
  AgentErrorPayload
} from '../shared/types/agent-events';
import type {
  AgentStreamTokenPayload,
  AgentReasoningTokenPayload,
  AgentToolStartPayload,
  AgentToolResultPayload,
  AgentDiffProposedPayload,
  AgentDonePayload,
  ChatErrorCard,
  AgentErrorPayload
} from '../shared/types/agent-events';
import type {
  MarketplaceExtensionEntry,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  InstallProgressEvent,
  InstallStep,
  ExtensionInstallState,
  ExtensionEnabledState
} from '../shared/types/marketplace';
export type {
  MarketplaceExtensionEntry,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  InstallProgressEvent,
  InstallStep,
  ExtensionInstallState,
  ExtensionEnabledState
};
export type { FreeProvider, ModelTier, TierClassification, ProviderHealthStatus };
export type {
  DiagnosticErrorCode,
  DiagnosticStep,
  DiagnosticStatus,
  StepResult,
  ProviderDiagnosticResult,
  DiagnosticRunSummary,
  CapabilityScenarioId,
  ScenarioEvidence,
  ScenarioResult,
  CapabilitySuiteSummary,
  RemediationCategory,
  WorkingNowItem,
  MissingFromYouItem,
  MissingFromCodeItem,
  ExternalOutageItem,
  RecommendedAction,
  RemediationReport,
  SmokeTestStep,
  FleetHealthState,
  ProviderHealthState,
  ProviderHealthDetail,
  DiagnosticsFleetHealth,
  FailoverNoticeInfo
};
export { SMOKE_TEST_STEPS, SMOKE_TEST_FAILURE_PROTOCOL };

export type { DetectedApiKey, CustomProviderConfig, StoredKeySummary, ByokExportBundle, ByokImportResult, KeyDetectionSource };
export type { OpenCodeDetectionResult, OpenCodeFreeTierSummary, OpenCodeImportResult, AgentFramework };
export type {
  TaskType,
  TaskClassificationResult,
  RoutingPreferenceMode,
  RouterUserPreferences,
  RankedModelCandidate,
  ModelRoutingDecision,
  ModelCatalogCorrection,
  CatalogVerificationResult,
  ModelCatalogVerificationSnapshot
};
export type {
  ProviderConnectionStatus,
  ProviderCategory,
  ConnectedProviderInfo,
  FreeTierSummary,
  RecentActivityRecord,
  HistoricalUsageBucket,
  ModelUsageStat,
  RecommendationType,
  OptimizationRecommendation,
  ProviderComparisonMetric,
  ProviderDashboardData,
  QuotaAlertItem
};

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

export interface FlatFileNodeEntry {
  path: string;
  depth: number;
  type: 'file' | 'directory';
  name: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  relativePath?: string;
}

export interface TreeChunkPayload {
  entries: FlatFileNodeEntry[];
  isComplete: boolean;
  totalSoFar: number;
  fromCache?: boolean;
}

export interface ChatFileContext {
  path: string;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  totalLines: number;
}

export type RoutingStrategyType = 'auto' | 'free-first' | 'fastest' | 'balanced' | 'manual';

export type ProviderSetupType = 'api_key' | 'zero_config';

/** Live provider connectivity snapshot for the model picker grouping. */
export interface ProviderConnectivitySnapshot {
  connected: boolean;
  latencyMs: number;
  successfulRequests: number;
  failedRequests: number;
  isRateLimited: boolean;
  autoDisabled: boolean;
}

export interface PreConfiguredProvider {
  id: string;
  name: string;
  baseUrl: string;
  setupType: ProviderSetupType;
  notes?: string;
  signupUrl?: string;
  defaultModel?: string;
  icon?: string;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  isFree?: boolean;
  category?: 'Free' | 'Fast' | 'Premium/Reasoning';
  contextLength?: number;
  description?: string;
}

export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  modelsFound?: number;
}

export type ProviderType = 'openrouter' | 'openkilo' | 'opencode' | 'groq' | 'deepseek' | 'ollama' | 'fcc-proxy' | 'custom' | (string & {});

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

export type AgentMode = 'build' | 'plan' | 'general';

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

export type TelemetryFeature = 'agent_chat' | 'project_index' | 'history_export';

export type TelemetryEvent =
  | { event: 'app_started'; timestamp: string }
  | { event: 'feature_used'; feature: TelemetryFeature; timestamp: string };

export interface TelemetryPreview {
  recordingEnabled: boolean;
  storageAvailable: boolean;
  storageMessage: string;
  storageError?: string;
  destinationConfigured: false;
  queuedCount: number;
  sentCount: 0;
  failedCount: 0;
  transmittedEvents: 0;
  events: TelemetryEvent[];
}

export interface CredentialStorageStatus {
  available: boolean;
  platform: string;
  backend: string;
  message: string;
}

export interface ProviderSettings {
  activeProvider: ProviderType;
  activeModel: string;
  activeHarness?: AgentHarnessType;
  apiKeys: Record<string, string | undefined>;
  apiKeysConfigured?: Partial<Record<ProviderType, boolean>>;
  customEndpoints: Record<string, string | undefined>;
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
  security?: SecurityPolicySettings;
  freeMode?: boolean;
  quotaAlertThreshold?: number;
  autoRotateProviders?: boolean;
  hasCompletedOnboarding?: boolean;
  performanceOptimization?: {
    requestCachingEnabled?: boolean;
    contextCompressionEnabled?: boolean;
    predictivePrefetchEnabled?: boolean;
    connectionPoolingEnabled?: boolean;
  };
  integrations?: Record<string, boolean>;
  modules?: Record<string, { enabled: boolean; installedAt?: number; customConfig?: Record<string, unknown> }>;
  telemetry?: TelemetrySettings;
  offlineDemoMode?: boolean;
  fccEnabled?: boolean;
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

export interface AssistantStreamMetadata {
  source: 'provider-stream';
  providerId: string;
  modelId: string;
  streamEventCount: number;
}

export interface ToolExecutionRecord {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  status: ToolExecutionStatus;
  output?: string;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  taskId?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  toolCall?: ToolCall;
  toolStatus?: ToolExecutionStatus;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  toolExecutions?: ToolExecutionRecord[];
  statusText?: string;
  proposedDiffs?: ProposedDiff[];
  reasoning?: string;
  errorCard?: ChatErrorCard;
  metadata?: AssistantStreamMetadata;
  isCached?: boolean;
  failoverNotice?: string;
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

export type AgentApprovalKind = 'tool_permission' | 'plan_review';

export interface AgentApprovalDecision {
  approved: boolean;
  feedback?: string;
}

export interface AgentToolApproval {
  id: string;
  toolCall: ToolCall;
  reason: string;
  affectedPaths?: string[];
  reviewDiff?: ProposedDiff;
  addedLines?: number;
  removedLines?: number;
  approvalKind?: AgentApprovalKind;
  planReport?: string;
  checkpoint?: string;
}

export interface AgentTodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  context?: string;
}

export interface AgentLoopState {
  todos: AgentTodoItem[];
  mode: string;
  iteration: number;
  maxIterations?: number;
}

export interface AgentSessionSummary {
  sessionId: string;
  workspacePath: string;
  mode: 'plan' | 'execute' | 'hybrid';
  todoCount: number;
  updatedAt: number;
}

export interface BackgroundAgentSnapshot {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  task: string;
  progress: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface BackgroundAgentDetails {
  agent: BackgroundAgentSnapshot;
  transcript: Array<{ role: string; content: string }>;
}

export interface VoiceTranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface VoiceTranscriptionResult {
  text: string;
  language: string;
  durationSec: number;
  segments: VoiceTranscriptionSegment[];
}

export type AgentTelemetryEvent =
  | { type: 'tool_call'; toolName: string; args: any; duration: number; success: boolean }
  | { type: 'llm_call'; provider: string; model: string; tokensIn: number; tokensOut: number; duration: number }
  | { type: 'agent_iteration'; iteration: number; todosCompleted: number; todosRemaining: number }
  | { type: 'context_compaction'; tokensBefore: number; tokensAfter: number }
  | { type: 'error'; message: string; stack?: string };

export type AgentTelemetryRecord = AgentTelemetryEvent & { timestamp: number };

export interface AgentToolPerformanceMetric {
  toolName: string;
  count: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDuration: number;
}

export interface AgentPerformanceReport {
  generatedAt: number;
  totalEvents: number;
  toolCalls: {
    totalCount: number;
    overallSuccessRate: number;
    averageDuration: number;
    perTool: AgentToolPerformanceMetric[];
  };
  llmCalls: {
    count: number;
    tokensIn: number;
    tokensOut: number;
    averageDuration: number;
  };
  agentIterations: {
    count: number;
    averageTodosCompleted: number;
    averageTodosRemaining: number;
  };
  contextCompactions: {
    count: number;
    averageTokensBefore: number;
    averageTokensAfter: number;
    totalTokensSaved: number;
  };
  errors: {
    count: number;
    recentMessages: string[];
  };
}

export interface AgentStreamChunk {
  type: 'token' | 'thought' | 'tool_call' | 'tool_result' | 'diff' | 'status' | 'approval_request' | 'done' | 'cancelled' | 'error' | 'agent_state';
  taskId?: string;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  diff?: ProposedDiff;
  approvalRequest?: AgentToolApproval;
  error?: string;
  state?: AgentLoopState;
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
  autoRunCommand?: string;
}

export interface PtySessionInfo {
  ptyId: string;
  shellId: string;
  shellName: string;
}

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;
export type ExtensionCapability = z.infer<typeof ExtensionCapabilitySchema>;
export type ExtensionExecutionState = 'built-in' | 'metadata-only' | 'installed';

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

export type TraceHopId = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9';

export type ErrorTaxonomy =
  | 'REGISTRY_UNREACHABLE'
  | 'VSIX_DOWNLOAD_FAILED'
  | 'VSIX_CORRUPT'
  | 'MANIFEST_INVALID'
  | 'HOST_REGISTRATION_FAILED'
  | 'ACTIVATION_FAILED'
  | 'API_CALL_FAILED'
  | 'UI_NOT_VISIBLE';

export interface TraceHop {
  hop: TraceHopId;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  timestamp: string;
  durationMs: number;
  payloadSize?: number;
  error?: string;
  taxonomy?: ErrorTaxonomy;
  details?: Record<string, unknown>;
}

export interface MetadataOnlyFinding {
  file: string;
  line: number;
  pattern: string;
  description: string;
  category: 'DISPLAY_ONLY' | 'EXECUTION_BLOCKED' | 'REGISTRATION_FILTER' | 'METADATA_ONLY_STATE';
  snippet: string;
}

export interface ExtensionInstallTraceReport {
  version: number;
  timestamp: string;
  gitCommit: string;
  command: string;
  targetExtension: string;
  registryUrl: string;
  hops: TraceHop[];
  firstFailingHop: TraceHopId | null;
  failureClassification: ErrorTaxonomy | null;
  marketplaceArchitecture: 'METADATA_ONLY' | 'PARTIALLY_FUNCTIONAL' | 'FULLY_FUNCTIONAL';
  summary: string;
  metrics: {
    totalDurationMs: number;
    passedHops: number;
    failedHops: number;
    skippedHops: number;
    downloadSizeBytes?: number;
    extractedFileCount?: number;
  };
  metadataOnlyScan: {
    totalFindings: number;
    findings: MetadataOnlyFinding[];
  };
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
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximizeChange?: (callback: (isMaximized: boolean) => void) => () => void;
  selectWorkspaceFolder: () => Promise<IpcResponse<string>>;
  getFilePathForDroppedFile: (file: File) => string;
  getWorkspaceTree: (rootPath: string) => Promise<IpcResponse<FileNode>>;
  getWorkspaceTreeChunked?: (rootPath: string) => Promise<IpcResponse<{ flatTree: FlatFileNodeEntry[]; fromCache: boolean; cacheKey?: string }>>;
  onTreeChunk?: (callback: (payload: TreeChunkPayload) => void) => () => void;
  onTreeUpdated?: (callback: (event: { type: 'change' | 'add' | 'unlink'; relPath: string }) => void) => () => void;
  readFile: (filePath: string) => Promise<IpcResponse<string>>;
  readFileForContext: (filePath: string, options?: { maxLines?: number }) => Promise<IpcResponse<ChatFileContext>>;
  writeFile: (filePath: string, content: string) => Promise<IpcResponse<void>>;
  createFile: (filePath: string) => Promise<IpcResponse<void>>;
  createDirectory: (dirPath: string) => Promise<IpcResponse<void>>;
  deletePath: (targetPath: string) => Promise<IpcResponse<void>>;
  renamePath: (oldPath: string, newPath: string) => Promise<IpcResponse<void>>;
  searchFiles: (query: string) => Promise<IpcResponse<string[]>>;
  getSettings: () => Promise<IpcResponse<ProviderSettings>>;
  saveSettings: (settings: Partial<ProviderSettings>) => Promise<IpcResponse<void>>;
  getTelemetryPreview: () => Promise<IpcResponse<TelemetryPreview>>;
  deleteTelemetryEvent: (index: number, expected: TelemetryEvent) => Promise<IpcResponse<void>>;
  clearTelemetryData: () => Promise<IpcResponse<void>>;
  getCredentialStorageStatus: () => Promise<IpcResponse<CredentialStorageStatus>>;
  onTelemetryChanged: (callback: () => void) => () => void;
  getSettingsLayer: (scope: SettingsScope) => Promise<IpcResponse<SettingsData | WorkspaceSettingsPatch>>;
  saveSettingsLayer: (scope: SettingsScope, settings: SettingsPatch | WorkspaceSettingsPatch) => Promise<IpcResponse<void>>;
  getSecurityPolicy: () => Promise<IpcResponse<SecurityPolicySettings>>;
  saveSecurityPolicy: (policy: Partial<SecurityPolicySettings>) => Promise<IpcResponse<void>>;
  onSettingsChanged: (callback: () => void) => () => void;
  startAgentTask: (params: {
    taskId?: string;
    traceId?: string;
    prompt: string;
    images?: string[];
    workspacePath: string;
    history: ChatMessage[];
    agentMode?: AgentMode;
    sessionId?: string;
    activeFilePath?: string;
    activeFileContent?: string;
    openFilePaths?: string[];
    providerOverride?: ProviderType;
    modelOverride?: string;
    skills?: SkillDefinition[];
    resumeSessionId?: string;
  }) => Promise<IpcResponse<string>>;
  stopAgentTask: (taskId: string) => Promise<IpcResponse<void>>;
  respondAgentApproval: (approvalId: string, approved: boolean, feedback?: string) => Promise<IpcResponse<void>>;
  sendApprovalResponse: (approvalId: string, response: 'APPROVED' | 'REVISED', feedback?: string) => Promise<IpcResponse<void>>;
  userApproveDiff?: (payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean) => Promise<IpcResponse<void>>;
  onAgentStream: (callback: (chunk: AgentStreamChunk) => void) => () => void;
  onAgentStreamToken?: (callback: (payload: AgentStreamTokenPayload) => void) => () => void;
  onAgentReasoningToken?: (callback: (payload: AgentReasoningTokenPayload) => void) => () => void;
  onAgentToolStart?: (callback: (payload: AgentToolStartPayload) => void) => () => void;
  onAgentToolResult?: (callback: (payload: AgentToolResultPayload) => void) => () => void;
  onAgentDiffProposed?: (callback: (payload: AgentDiffProposedPayload) => void) => () => void;
  onAgentDone?: (callback: (payload: AgentDonePayload) => void) => () => void;
  onAgentError?: (callback: (payload: AgentErrorPayload) => void) => () => void;
  applyDiff: (diff: ProposedDiff) => Promise<IpcResponse<void>>;
  getAgentTodos: () => Promise<IpcResponse<AgentTodoItem[]>>;
  setAgentMode: (mode: 'plan' | 'execute' | 'hybrid') => Promise<IpcResponse<void>>;
  getRecentSessions: (workspacePath?: string) => Promise<IpcResponse<AgentSessionSummary[]>>;
  addApprovalRule: (rule: { id?: string; toolName: string; pattern?: string; action: 'always_ask' | 'auto_approve' | 'auto_deny'; scope: 'workspace' | 'system' | 'network'; expiresAt?: number }) => Promise<IpcResponse<void>>;
  getBackgroundAgents: () => Promise<IpcResponse<BackgroundAgentSnapshot[]>>;
  getBackgroundAgentDetails: (agentId: string) => Promise<IpcResponse<BackgroundAgentDetails | null>>;
  cancelBackgroundAgent: (agentId: string) => Promise<IpcResponse<void>>;
  getAgentTelemetryReport: () => Promise<IpcResponse<AgentPerformanceReport>>;
  getAgentTelemetryEvents: (filter?: { type?: string; startTime?: number }) => Promise<IpcResponse<AgentTelemetryRecord[]>>;
  exportAgentTelemetry: () => Promise<IpcResponse<string>>;
  clearAgentTelemetry: () => Promise<IpcResponse<void>>;
  ensureVoiceReady: () => Promise<IpcResponse<void>>;
  startVoiceRecording: () => Promise<IpcResponse<{ sessionId: string; capturing: boolean }>>;
  appendVoiceChunk: (sessionId: string, audioBase64: string) => Promise<IpcResponse<void>>;
  stopVoiceRecording: (sessionId: string) => Promise<IpcResponse<VoiceTranscriptionResult>>;
  releaseVoiceRecording: () => Promise<IpcResponse<void>>;
  onAgentStateUpdate: (callback: (state: AgentLoopState) => void) => () => void;
  resolvePtyApproval?: (approvalId: string, approved: boolean) => Promise<IpcResponse<void>>;
  onPtyApprovalRequired?: (callback: (data: { approvalId: string; ptyId: string; command: string; reason: string }) => void) => () => void;
  onPtyCommandBlocked?: (callback: (data: { ptyId: string; command: string; reason: string }) => void) => () => void;
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

  // Open VSX Marketplace APIs
  marketplaceSearch: (options: MarketplaceSearchOptions | string) => Promise<IpcResponse<MarketplaceSearchResult>>;
  marketplaceMetadata: (namespace: string, extension: string) => Promise<IpcResponse<MarketplaceExtensionEntry | null>>;
  marketplaceInstall: (entry: MarketplaceExtensionEntry | { id: string; downloadUrl?: string; sha256?: string; [key: string]: unknown }) => Promise<IpcResponse<InstallResult>>;
  marketplaceUninstall: (id: string) => Promise<IpcResponse<boolean>>;
  marketplaceListInstalled: () => Promise<IpcResponse<InstalledExtension[]>>;
  onMarketplaceInstallProgress: (callback: (event: InstallProgressEvent) => void) => () => void;
  marketplaceTraceInstall: (extensionId?: string) => Promise<IpcResponse<ExtensionInstallTraceReport>>;

  // Extension Management APIs
  getInstalledExtensions: () => Promise<IpcResponse<InstalledExtension[]>>;
  installExtension: (ext: ExtensionMetadata) => Promise<IpcResponse<InstalledExtension>>;
  uninstallExtension: (id: string) => Promise<IpcResponse<void>>;
  toggleExtension: (id: string, enabled: boolean) => Promise<IpcResponse<InstalledExtension>>;
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => Promise<IpcResponse<void>>;
  installExtensionFromVsix: () => Promise<IpcResponse<InstalledExtension>>;
  extensionCapability: (request: ExtensionCapabilityRequest) => Promise<IpcResponse<unknown>>;
  extensionActivate: (id: string) => Promise<IpcResponse<boolean>>;
  extensionDeactivate: (id: string) => Promise<IpcResponse<boolean>>;
  extensionExecuteCommand: (commandId: string, ...args: unknown[]) => Promise<IpcResponse<unknown>>;
  extensionTriggerEvent: (event: string, payload?: unknown) => Promise<IpcResponse<string[]>>;
  extensionListCommands: () => Promise<IpcResponse<any[]>>;
  extensionProvideCompletions: (query: { language: string; filePath: string; line: number; character: number }) => Promise<IpcResponse<any[]>>;

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
  fccSetEnabled: (enabled: boolean) => Promise<IpcResponse<{ enabled: boolean }>>;
  fccGetIntegrity: () => Promise<IpcResponse<FCCIntegrityReport | null>>;
  fccVerifyBinary: (binaryPath?: string, expectedHash?: string) => Promise<IpcResponse<FCCIntegrityReport>>;
  fccGetLogs: () => Promise<IpcResponse<string[]>>;
  fccClearLogs: () => Promise<IpcResponse<void>>;
  fccGetCatalog: () => Promise<IpcResponse<FCCProviderHealthInfo[]>>;
  fccGetFleetSummary: () => Promise<IpcResponse<FCCFleetSummary>>;
  fccSyncCatalog: () => Promise<IpcResponse<{ count: number; timestamp: number }>>;
  fccToggleProvider: (providerId: string, enabled: boolean) => Promise<IpcResponse<{ providerId: string; enabled: boolean }>>;
  fccTestProvider: (providerId: string) => Promise<IpcResponse<{ providerId: string; success: boolean; latencyMs: number; error?: string }>>;
  fccDetectHarnessConfigs: (customDir?: string) => Promise<IpcResponse<DetectedHarnessConfig[]>>;
  fccImportHarnessConfig: (
    detected: DetectedHarnessConfig,
    options?: { importModel?: boolean; importHarness?: boolean; importCredentials?: boolean }
  ) => Promise<IpcResponse<HarnessImportResult>>;
  fccGetSupportedHarnesses: () => Promise<IpcResponse<HarnessMetadata[]>>;
  fccConnectSubscription: (
    subscriptionId: 'copilot' | 'chatgpt',
    authData?: Record<string, unknown>
  ) => Promise<IpcResponse<{ success: boolean; message: string; connected: boolean; modelsCount?: number }>>;
  fccGetSubscriptionStatus: () => Promise<IpcResponse<SubscriptionInfo[]>>;
  fccStartCopilotDeviceFlow: () => Promise<IpcResponse<CopilotDeviceCodeState>>;
  fccPollCopilotDeviceFlow: (deviceCode?: string) => Promise<IpcResponse<{ status: string; token?: string; error?: string }>>;
  fccRevokeSubscription: (subscriptionId: 'copilot' | 'chatgpt') => Promise<IpcResponse<{ success: boolean; message: string }>>;
  fccRefreshSubscription: (subscriptionId: 'copilot' | 'chatgpt') => Promise<IpcResponse<boolean>>;
  fccGetSupplyEndpointStatus: () => Promise<IpcResponse<LocalSupplyEndpointStatus>>;
  fccStartSupplyEndpoint: (port?: number) => Promise<IpcResponse<boolean>>;
  fccStopSupplyEndpoint: () => Promise<IpcResponse<void>>;
  fccSetSupplyEndpointLan: (enabled: boolean, acknowledgeWarning?: boolean) => Promise<IpcResponse<boolean>>;
  fccDetectInstalledHarnesses: () => Promise<IpcResponse<HarnessInstallStatus[]>>;
  fccRunHarnessSession: (params: {
    harnessId: AgentHarnessType;
    workspacePath?: string;
    initialPrompt?: string;
  }) => Promise<IpcResponse<HarnessSessionInfo>>;
  fccGetHarnessSession: (sessionId: string) => Promise<IpcResponse<HarnessSessionInfo | null>>;
  fccGetOptimizationSavings: () => Promise<IpcResponse<FccOptimizationSavings>>;
  fccSetSessionCacheOptOut: (sessionId: string, optOut: boolean) => Promise<IpcResponse<boolean>>;
  fccGetQuotaMeters: () => Promise<IpcResponse<FccQuotaMetersSummary>>;

  // FCC Service Manager (installer, service lifecycle, terminal bridge)
  fccInstall: () => Promise<IpcResponse<{ binaryPath: string | null; alreadyInstalled: boolean }>>;
  fccGetServiceStatus: () => Promise<IpcResponse<FCCServiceStatus>>;
  fccRetryService: () => Promise<IpcResponse<FCCServiceStatus>>;
  onFccInstallProgress: (callback: (progress: FCCInstallProgress) => void) => () => void;
  onFccServiceState: (callback: (status: FCCServiceStatus) => void) => () => void;

  // Phase FCC-5: External Clients, Connectors, SessionBridge, and Background Supervisor
  fccExportEditorConfig: (editor: 'vscode' | 'jetbrains' | 'neovim', variant?: string, customPath?: string) => Promise<IpcResponse<{ success: boolean; snippet: EditorConfigSnippet; savedToPath?: string }>>;
  fccGetEditorConfigs: () => Promise<IpcResponse<Record<string, EditorConfigSnippet>>>;
  fccGetConnectorsOverview: () => Promise<IpcResponse<ConnectorsOverview>>;
  fccSaveConnectorConfig: (type: 'telegram' | 'discord', config: Partial<MessagingConnectorConfig>) => Promise<IpcResponse<boolean>>;
  fccGetConnectorAuditLogs: (limit?: number, type?: 'telegram' | 'discord') => Promise<IpcResponse<ConnectorAuditLogEntry[]>>;
  fccGetBackgroundTasks: () => Promise<IpcResponse<BackgroundTaskInfo[]>>;
  fccPauseBackgroundTask: (taskId: string) => Promise<IpcResponse<boolean>>;
  fccResumeBackgroundTask: (taskId: string) => Promise<IpcResponse<boolean>>;
  fccSetRunInBackground: (enabled: boolean) => Promise<IpcResponse<boolean>>;
  fccIsRunInBackground: () => Promise<IpcResponse<boolean>>;
  fccListSessionBridges: () => Promise<IpcResponse<SessionBridgeInfo[]>>;

  // Phase 5.4: OpenKilo Plugin Integration (Layer 5)
  openkiloGetStatus: () => Promise<IpcResponse<OpenKiloStatus>>;
  openkiloRefreshModels: (apiKey?: string) => Promise<IpcResponse<DiscoveredModel[]>>;
  openkiloStartOAuth: () => Promise<IpcResponse<{ authUrl: string; state: string }>>;
  openkiloCompleteOAuth: (code: string) => Promise<IpcResponse<{ success: boolean; apiKey?: string; error?: string }>>;
  openkiloEnableAnonymous: () => Promise<IpcResponse<OpenKiloStatus>>;

  // Phase 2.1: Provider Onboarding & Dynamic Discovery
  providerGetRegistry: () => Promise<IpcResponse<PreConfiguredProvider[]>>;
  providerGetConnectionStatus: () => Promise<IpcResponse<Record<string, ProviderConnectivitySnapshot>>>;
  providerGetModels: (params: { providerId: string; apiKey?: string; customEndpoint?: string }) => Promise<IpcResponse<DiscoveredModel[]>>;
  providerTestConnection: (params: { providerId: string; apiKey?: string; modelId?: string; customEndpoint?: string }) => Promise<IpcResponse<TestConnectionResult>>;
  openExternal: (url: string) => Promise<IpcResponse<void>>;
  openPath?: (filePath: string) => Promise<IpcResponse<void>>;

  // Phase 5.5: Smart Orchestration & Quota Management (Layer 6)
  orchestrationGetQuotaStats: () => Promise<IpcResponse<QuotaSnapshot>>;
  orchestrationGetSmartRoutingLogs: () => Promise<IpcResponse<RoutingDecisionLog[]>>;
  orchestrationSetFreeMode: (enabled: boolean) => Promise<IpcResponse<boolean>>;
  orchestrationClassifyTask: (prompt: string) => Promise<IpcResponse<{ task: SmartTaskType; confidence: number; rationale: string }>>;
  orchestrationSelectModel: (prompt: string, context?: unknown) => Promise<IpcResponse<SmartModelSelection>>;

  // Phase 5.6: End-to-End Performance & Onboarding
  orchestrationGetPerformanceMetrics: () => Promise<IpcResponse<PerformanceMetricsSnapshot>>;
  orchestrationCompressContext: (prompt: string, codeContext?: string) => Promise<IpcResponse<ContextCompressionResult>>;
  orchestrationWarmConnections: () => Promise<IpcResponse<{ success: boolean; warmed: string[] }>>;
  orchestrationCompleteOnboarding: () => Promise<IpcResponse<boolean>>;

  // Phase 3.1: Modular Skills & External Integration Registry
  modulesGetList: (workspacePath?: string) => Promise<IpcResponse<ExternalModuleInfo[]>>;
  modulesToggle: (moduleId: string, enabled: boolean, workspacePath?: string) => Promise<IpcResponse<ModuleActivationResult>>;
  modulesCheckDependencies: (dependencies: string[]) => Promise<IpcResponse<{ available: boolean; missing: string[]; details: Record<string, boolean> }>>;
  modulesGetStatus: (moduleId: string, workspacePath?: string) => Promise<IpcResponse<ExternalModuleInfo>>;

  // Phase 3.3: AI Data Extractor (History Export)
  historyExportAiData: (options?: HistoryExportIpcOptions) => Promise<IpcResponse<HistoryExportResult>>;
  historySelectExportDestination: (defaultName?: string, format?: 'json' | 'md' | 'all') => Promise<IpcResponse<string | null>>;
  onHistoryExportProgress: (callback: (progress: HistoryExportProgress) => void) => () => void;

  // Phase 3.5: Visual UI Sketcher (M3E Canvas)
  sketcherSendPrompt?: (prompt: string) => Promise<IpcResponse<boolean>>;
  onSketcherPrompt?: (callback: (prompt: string) => void) => () => void;
  sketcherOpenWindow?: () => Promise<IpcResponse<boolean>>;

  // M3E Canvas overhaul: shared context & chat sync bridge
  canvasUpdateState?: (payload: {
    activePlatform?: 'react' | 'flutter' | 'swiftui' | 'web' | 'other';
    canvasComponents?: CanvasComponentNodeData[];
    reason?: string;
  }) => Promise<IpcResponse<CanvasSnapshotData>>;
  canvasRequestState?: () => Promise<IpcResponse<CanvasSnapshotData>>;
  canvasSyncMessage?: (payload: { message: CanvasMessageData }) => Promise<IpcResponse<CanvasMessageData>>;
  canvasAgentGenerate?: (prompt: string) => Promise<IpcResponse<CanvasAgentGenerationResultData>>;
  canvasChatSend?: (payload: CanvasChatSendData) => Promise<IpcResponse<CanvasAgentGenerationResultData & { runId: string }>>;
  notifyMainChatOfCanvasUpdate?: (payload: CanvasUpdateNotificationData) => Promise<IpcResponse<boolean>>;
  focusCanvasWindow?: () => Promise<IpcResponse<boolean>>;
  onCanvasStateSynced?: (callback: (state: CanvasSnapshotData) => void) => () => void;
  onCanvasMessageSynced?: (callback: (message: CanvasMessageData) => void) => () => void;
  onCanvasAgentEvent?: (callback: (event: CanvasAgentEventPayloadData) => void) => () => void;
  onCanvasUpdate?: (callback: (update: CanvasUpdateNotificationData) => void) => () => void;

  // Phase 3.6: Open SEO & GEO MCP Skills
  mcpGetSeoConfig?: (workspacePath?: string) => Promise<IpcResponse<McpSeoConfigStatus>>;
  mcpSaveSeoConfig?: (options: McpSaveSeoOptions) => Promise<IpcResponse<{ success: boolean; message: string }>>;
  mcpTestSeoConnection?: (workspacePath?: string) => Promise<IpcResponse<{ success: boolean; details: string }>>;

  // Phase 6.1: Permanent Free Provider Registry & Model Curation
  freeProvidersGetList?: () => Promise<IpcResponse<FreeProvider[]>>;
  freeProvidersGetTiers?: () => Promise<IpcResponse<Record<ModelTier, TierClassification>>>;
  freeProvidersGetHealth?: () => Promise<IpcResponse<Record<string, ProviderHealthStatus>>>;
  freeProvidersPing?: (providerId?: string) => Promise<IpcResponse<Record<string, ProviderHealthStatus>>>;

  // Omni-Debugger: Multi-Engine Diagnostic & Architecture Inspector
  debuggerOpenWindow?: () => Promise<IpcResponse<boolean>>;
  debuggerCloseWindow?: () => Promise<IpcResponse<boolean>>;
  debuggerSyncState?: (payload: Partial<DebuggerStateSnapshotData>) => Promise<IpcResponse<DebuggerStateSnapshotData>>;
  debuggerRequestState?: () => Promise<IpcResponse<DebuggerStateSnapshotData>>;
  debuggerRunAnalysis?: (payload?: { filePath?: string; role?: AnalysisRole }) => Promise<IpcResponse<AnalysisResultData[]>>;
  onDebuggerUpdate?: (callback: (data: AnalysisResultData[] | { results: AnalysisResultData[] }) => void) => () => void;
  onDebuggerStateSynced?: (callback: (state: DebuggerStateSnapshotData) => void) => () => void;

  // Phase 6.2: Seamless BYOK Interface & Key Management
  byokDetectKeys?: () => Promise<IpcResponse<DetectedApiKey[]>>;
  byokImportDetectedKey?: (keyId: string, providerId?: string) => Promise<IpcResponse<{ providerId: string }>>;
  byokGetStoredKeys?: () => Promise<IpcResponse<StoredKeySummary[]>>;
  byokRevealKey?: (providerId: string) => Promise<IpcResponse<string>>;
  byokRevokeKey?: (providerId: string) => Promise<IpcResponse<boolean>>;
  byokExportKeys?: () => Promise<IpcResponse<string>>;
  byokImportKeys?: (backupData: string) => Promise<IpcResponse<ByokImportResult>>;
  byokSaveCustomProvider?: (config: CustomProviderConfig) => Promise<IpcResponse<boolean>>;

  // Phase 6.3: OpenCode Integration & Free Model Sync
  opencodeDetect?: () => Promise<IpcResponse<OpenCodeDetectionResult>>;
  opencodeGetFreeSummary?: () => Promise<IpcResponse<OpenCodeFreeTierSummary>>;
  opencodeImportProviders?: () => Promise<IpcResponse<OpenCodeImportResult>>;
  agentFrameworkSet?: (framework: AgentFramework) => Promise<IpcResponse<AgentFramework>>;
  agentFrameworkGet?: () => Promise<IpcResponse<AgentFramework>>;
  opencodeGetMergedProviders?: () => Promise<IpcResponse<PreConfiguredProvider[]>>;

  // OpenCode Standard Supply (baked-in hosted free models)
  opencodeGetServiceStatus?: () => Promise<IpcResponse<OpenCodeServiceStatusData>>;
  opencodeRefreshStandardSupply?: () => Promise<IpcResponse<OpenCodeServiceStatusData>>;

  // Phase 6.4: Intelligent Model Router
  modelRouterClassifyTask?: (prompt: string) => Promise<IpcResponse<TaskClassificationResult>>;
  modelRouterSelectModel?: (prompt: string, overridePreferences?: Partial<RouterUserPreferences>) => Promise<IpcResponse<ModelRoutingDecision>>;
  modelRouterGetPreferences?: () => Promise<IpcResponse<RouterUserPreferences>>;
  modelRouterSetPreferences?: (updates: Partial<RouterUserPreferences>) => Promise<IpcResponse<RouterUserPreferences>>;
  modelRouterGetAvailableModels?: () => Promise<IpcResponse<Record<ModelTier, RankedModelCandidate[]>>>;

  // Autonomous Provider & Model Catalog Verification
  verifyModelCatalog?: () => Promise<IpcResponse<ModelCatalogVerificationSnapshot>>;
  getModelCatalogVerifications?: () => Promise<IpcResponse<ModelCatalogVerificationSnapshot>>;
  onModelCatalogVerified?: (callback: (snapshot: ModelCatalogVerificationSnapshot) => void) => () => void;

  // Phase 6.5: Unified Provider Dashboard & Quota Management
  dashboardGetData?: () => Promise<IpcResponse<ProviderDashboardData>>;
  dashboardGetOverview?: () => Promise<IpcResponse<{ providers: ConnectedProviderInfo[]; summary: FreeTierSummary; recentActivity: RecentActivityRecord[]; alerts: QuotaAlertItem[] }>>;
  dashboardGetQuota?: () => Promise<IpcResponse<{ snapshot: QuotaSnapshot; breakdown: ModelUsageStat[] }>>;
  dashboardGetComparison?: () => Promise<IpcResponse<ProviderComparisonMetric[]>>;
  dashboardGetAnalytics?: () => Promise<IpcResponse<{ history: { daily: HistoricalUsageBucket[]; weekly: HistoricalUsageBucket[]; monthly: HistoricalUsageBucket[] }; modelBreakdown: ModelUsageStat[] }>>;
  dashboardGetRecommendations?: () => Promise<IpcResponse<OptimizationRecommendation[]>>;
  dashboardDismissRecommendation?: (recommendationId: string) => Promise<IpcResponse<boolean>>;
  dashboardRecordActivity?: (record: any) => Promise<IpcResponse<RecentActivityRecord>>;

  // Diagnostics 1: Provider Connection Diagnostic Harness & Error Taxonomy
  runDiagnostics?: (providerId?: string) => Promise<IpcResponse<DiagnosticRunSummary>>;
  getDiagnosticReport?: (summary?: DiagnosticRunSummary) => Promise<IpcResponse<string>>;
  getDiagnosticsLatest?: () => Promise<IpcResponse<{ connSummary: DiagnosticRunSummary | null; capSummary: CapabilitySuiteSummary | null }>>;

  // Diagnostics 2: End-to-End Capability Test Suite
  runCapabilitySuite?: (options?: { providerId?: string; modelId?: string }) => Promise<IpcResponse<CapabilitySuiteSummary>>;
  getCapabilityReport?: () => Promise<IpcResponse<string>>;

  // Diagnostics 3: Remediation Report Engine
  getRemediationReport?: () => Promise<IpcResponse<RemediationReport>>;

  // Diagnostics 5: Background Health Monitoring and Auto-Failover
  diagnosticsGetFleetHealth?: () => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsSetQuietMode?: (enabled: boolean) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsSetBatterySaver?: (enabled: boolean) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsSetMeteredConnection?: (enabled: boolean) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsTriggerPing?: (providerId?: string) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsSimulateOutage?: (providerId: string, type?: 'RATE_LIMITED' | 'PROVIDER_DOWN', cooldownMs?: number) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  diagnosticsSimulateRecovery?: (providerId: string) => Promise<IpcResponse<DiagnosticsFleetHealth>>;
  onDiagnosticsFleetHealthChanged?: (callback: (health: DiagnosticsFleetHealth) => void) => () => void;

  // Diagnostics Fix 1: End-to-End Connectivity Trace
  runConnectivityTrace?: (options?: { providerId?: string }) => Promise<IpcResponse<FullConnectivityTraceReport>>;
  recordTraceHop?: {
    (payload: { traceId: string; hop: HopId; status: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'; payloadSize?: number; metadata?: Record<string, unknown>; error?: string }): Promise<IpcResponse<void>>;
    (traceId: string, hop: HopId, details?: { status?: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'; payloadSize?: number; metadata?: Record<string, unknown>; error?: string }): Promise<IpcResponse<void>>;
  };
  getConnectivityTrace?: () => Promise<IpcResponse<FullConnectivityTraceReport | null>>;
  scanMockPaths?: () => Promise<IpcResponse<MockScanReport>>;
  onConnectivityTraceUpdate?: (callback: (data: { traceId: string; trace: ProviderConnectivityTrace }) => void) => () => void;


  // Performance Profiler APIs (Perf 1)
  perfGetBootTrace?: () => Promise<IpcResponse<BootTrace>>;
  perfRecordRendererMark?: (mark: PerfMark) => Promise<IpcResponse<void>>;
  perfRecordTransition?: (metric: TransitionMetric) => Promise<IpcResponse<void>>;
  perfInjectDelay?: (durationMs: number, label?: string) => Promise<IpcResponse<void>>;

  // Open-Path Performance Trace (Fix 3)
  perfProfileOpenPaths?: () => Promise<IpcResponse<OpenPerfTraceReport>>;
  perfGetOpenTrace?: () => Promise<IpcResponse<OpenPerfTraceReport | null>>;

  // Tiered Boot Scheduler APIs (Perf 2)
  bootSchedulerGetState?: () => Promise<IpcResponse<BootSchedulerStatePayload>>;
  bootSchedulerPromote?: (idOrCategory: string) => Promise<IpcResponse<boolean>>;
  bootSchedulerNotifyInteraction?: () => Promise<IpcResponse<void>>;
  onBootSchedulerProgress?: (callback: (state: BootSchedulerStatePayload) => void) => () => void;

  // UI-Polish 2: Platform Inset Metrics
  getPlatformInsets?: () => Promise<IpcResponse<PlatformInsets>>;

  // Scale 1: Zero-Server OAuth & Device Flow
  oauthStartOpenRouterPKCE?: () => Promise<IpcResponse<{ authUrl: string; redirectUri: string; state: string }>>;
  oauthStartOpenKilo?: () => Promise<IpcResponse<{ authUrl: string; redirectUri: string; state: string }>>;
  oauthStartCopilotDevice?: () => Promise<IpcResponse<any>>;
  oauthPollCopilotDevice?: (deviceCode?: string) => Promise<IpcResponse<{ status: string; accessToken?: string; error?: string }>>;
  oauthCancelCopilotDevice?: () => Promise<IpcResponse<void>>;
  oauthDisconnect?: (providerId: string) => Promise<IpcResponse<boolean>>;
  oauthGetStatus?: () => Promise<IpcResponse<Record<string, any>>>;
  onOAuthStatusChanged?: (callback: (status: Record<string, any>) => void) => () => void;

  // Scale 1: Usage Ledger
  usageGetLedger?: () => Promise<IpcResponse<any>>;
  usageGetStats?: () => Promise<IpcResponse<any>>;
  usageExportLedger?: (format?: 'json' | 'csv') => Promise<IpcResponse<string>>;
  usageExport?: (format?: 'json' | 'csv') => Promise<IpcResponse<string>>;
  usageClearLedger?: () => Promise<IpcResponse<void>>;

  // RealConnect 2: Per-User Credential Storage
  credentialsSave?: (providerId: string, apiKey: string, label?: string) => Promise<IpcResponse<void>>;
  credentialsGet?: (providerId?: string) => Promise<IpcResponse<any>>;
  credentialsDelete?: (providerId: string) => Promise<IpcResponse<boolean> | boolean>;
  credentialsReveal?: (providerId: string) => Promise<{ success: boolean; key: string | null }>;
  credentialsTest?: (providerId: string, apiKey: string, modelId?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  credentialsExport?: (passphrase?: string) => Promise<IpcResponse<string>>;
  credentialsImport?: (bundleJson: string, passphrase?: string) => Promise<{ success: boolean; count: number; error?: string }>;
  credentialsHasAny?: () => Promise<{ success: boolean; hasAny: boolean }>;
  credentialsList?: () => Promise<IpcResponse<Array<{ providerId: string; label: string; configured: boolean; createdAt?: number; lastUsedAt?: number }>>>;
  credentialsAutoDetect?: () => Promise<{ success: boolean; data?: { totalDetected: number; importedCount: number; importedProviders: string[]; detected: any[] }; error?: string }>;
  onboardingGetState?: () => Promise<IpcResponse<any>>;
  onboardingSaveState?: (updates: any) => Promise<IpcResponse<any>>;

  getVerifiedModels?: () => Promise<IpcResponse<any[]>>;
  testVerifiedApi?: (data: { modelId: string; prompt: string; apiKey?: string }) => Promise<any>;
  onVerifiedApiChunk?: (cb: (chunk: string) => void) => any;
  onVerifiedApiEnd?: (cb: () => void) => any;
  onVerifiedApiError?: (cb: (err: string) => void) => any;

  testGroundTruthApi?: () => Promise<{ success: boolean; error?: string }>;
  onGroundTruthChunk?: (cb: (chunk: string) => void) => () => void;
  onGroundTruthEnd?: (cb: () => void) => () => void;
  onGroundTruthError?: (cb: (err: string) => void) => () => void;

  testProviderKey?: (provider: string, key: string) => Promise<{ success: boolean; message: string }>;
  saveProviderKey?: (provider: string, key: string) => Promise<{ success: boolean }>;
  getProviderKey?: (provider: string) => Promise<string | null>;

  initiateCopilotDeviceFlow?: () => Promise<{ success: boolean; data?: { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }; error?: string }>;
  pollCopilotToken?: (deviceCode: string) => Promise<{ success: boolean; token?: string; error?: string }>;
  onProviderHandoff?: (cb: (data: { fromProvider: string; toProvider: string; newModel: string }) => void) => () => void;
}

export interface BootSchedulerTaskPayload {
  id: string;
  name: string;
  tier: 0 | 1 | 2 | 3;
  category: string;
  promoted?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'promoted';
  startTime?: number;
  durationMs?: number;
  error?: string;
}

export interface BootSchedulerStatePayload {
  currentTier: 0 | 1 | 2 | 3;
  tierStatus: Record<0 | 1 | 2 | 3, 'pending' | 'running' | 'completed'>;
  completedTasksCount: number;
  totalTasksCount: number;
  tasks: BootSchedulerTaskPayload[];
  isWarmedUp: boolean;
}

export interface PlatformInsets {
  platform: 'win32' | 'darwin' | 'linux';
  titlebarHeight: number;
  captionButtonWidth: number;
  trafficLightWidth: number;
  statusBarHeight: number;
  resizeCornerArea: number;
  scrollbarGutter: number;
}

export interface McpSeoConfigStatus {
  enabled: boolean;
  hasKeys: { google_search_console: boolean; ahrefs: boolean; generic_search: boolean };
  storageStatus: string;
  serverInfo?: {
    command: string;
    args: string[];
    disabled: boolean;
    description?: string;
  };
}

export interface McpSaveSeoOptions {
  enabled?: boolean;
  apiKeys?: {
    google_search_console?: string;
    ahrefs?: string;
    generic_search?: string;
  };
  workspacePath?: string;
}

export interface HistoryExportIpcOptions {
  customHome?: string;
  workspacePath?: string;
  scanLocations?: string[];
  outputDir?: string;
  outputFileName?: string;
  format?: 'json' | 'md' | 'all';
}

export interface HistoryExportProgress {
  stage: 'discovering' | 'reading' | 'normalizing' | 'writing' | 'completed' | 'error';
  current: number;
  total: number;
  percent: number;
  message: string;
  currentSource?: string;
}

// M3E Canvas overhaul: shared context & chat sync bridge types
export interface CanvasComponentNodeData {
  id: string;
  type: string;
  name?: string;
  props?: Record<string, unknown>;
  children?: CanvasComponentNodeData[];
}

export interface CanvasMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  origin: 'canvas' | 'main';
}

// Canvas agent engine generation result (M3E Canvas)
export interface CanvasAgentGenerationResultData {
  ok: boolean;
  platform: 'react' | 'flutter' | 'swiftui' | 'web' | 'other';
  code?: string;
  language?: string;
  nodesPushed?: number;
  replaced?: boolean;
  summary?: string;
  error?: string;
}

// Streaming agent event pushed to the Canvas chat UI ('canvas:agent-event')
export interface CanvasAgentEventPayloadData {
  runId: string;
  type: 'token' | 'status' | 'done' | 'error';
  content?: string;
}

// Canvas-update notification for the main IDE chat ('canvas:main-chat-update')
export interface CanvasUpdateNotificationData {
  action: string;
  codeSnippet?: string;
  platform?: string;
  updatedAt?: number;
}

// Payload accepted by sendCanvasChatMessage
export interface CanvasChatSendData {
  prompt: string;
  currentCanvasState?: {
    activePlatform?: 'react' | 'flutter' | 'swiftui' | 'web' | 'other';
    canvasComponents?: CanvasComponentNodeData[];
  };
}

export interface CanvasSnapshotData {
  activePlatform: 'react' | 'flutter' | 'swiftui' | 'web' | 'other';
  canvasComponents: CanvasComponentNodeData[];
  sharedConversationHistory: CanvasMessageData[];
  updatedAt: number;
}

export interface HistoryExportResult {
  success: boolean;
  exportPath: string;
  format: 'json' | 'md' | 'all';
  totalSessions: number;
  totalMessages: number;
  sourcesFound: Record<string, number>;
  outputPath: string;
  filesGenerated: string[];
  error?: string;
}

// OpenCode Standard Supply (baked-in hosted free models, incl. OpenKilo gateway)
export interface OpenCodeServiceStatusData {
  standardSupplyEnabled: boolean;
  hostedEndpoint: string;
  hostedReachable: boolean | null;
  hostedLatencyMs: number | null;
  kiloHostedEndpoint: string;
  kiloReachable: boolean | null;
  kiloLatencyMs: number | null;
  cliInstalled: boolean;
  cliPath: string | null;
  modelsInSupply: number;
  zenModelIds: string[];
  catalogEnabled: boolean;
  lastError: string | null;
  lastCheckedAt: number | null;
}

// Omni-Debugger: Multi-Engine Diagnostic & Architecture Inspector
export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AnalysisEngine = 'static' | 'dynamic' | 'arch';
export type AnalysisRole = 'dev' | 'qa' | 'pm';

export interface AnalysisResultData {
  id: string;
  severity: AnalysisSeverity;
  engine: AnalysisEngine;
  role: AnalysisRole;
  message: string;
  line?: number;
  codeSnippet?: string;
  filePath?: string;
  ruleId?: string;
  suggestedFix?: string;
  timestamp?: number;
}

export interface DebuggerStateSnapshotData {
  activeFile: string | null;
  analysisResults: AnalysisResultData[];
  isPopOutMode: boolean;
  selectedRole: AnalysisRole;
  updatedAt?: number;
}

export type ModuleLlmCompatibility = 'hosted' | 'local' | 'both';

export interface ExternalModuleInfo {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  llm_compatibility: ModuleLlmCompatibility;
  dependencies: string[];
  missingDependencies?: string[];
  isConfigured?: boolean;
  category?: string;
  version?: string;
}

export interface ModuleActivationResult {
  success: boolean;
  moduleId: string;
  isEnabled: boolean;
  message?: string;
  filesCreated?: string[];
  warning?: string;
}

export interface RequestCacheStats {
  hits: number;
  misses: number;
  totalEntries: number;
  tokensSaved: number;
  latencySavedMs: number;
  hitRatePercent: number;
}

export interface ContextCompressionResult {
  originalLength: number;
  compressedLength: number;
  originalEstimatedTokens: number;
  compressedEstimatedTokens: number;
  tokensSaved: number;
  compressionRatioPercent: number;
  compressedPrompt: string;
}

export interface PerformanceMetricsSnapshot {
  averageLatencyMs: number;
  p95LatencyMs: number;
  memoryUsageMb: number;
  uptimeSeconds: number;
  cache: RequestCacheStats;
  compression: {
    totalOriginalTokens: number;
    totalCompressedTokens: number;
    tokensSaved: number;
    averageCompressionRatio: number;
  };
  connectionPool: {
    activeSockets: number;
    pooledProviders: string[];
    warmedEndpoints: string[];
  };
  freeTokensUsed: number;
  freeTokensAvailable: number;
}

export type SmartTaskType = 'coding' | 'reasoning' | 'fast-response' | 'large-context' | 'multimodal' | 'simple-query';

export interface SmartModelSelection {
  task: SmartTaskType;
  providerId: string;
  modelId: string;
  modelName: string;
  isFree: boolean;
  rationale: string;
  contextWindow: number;
  confidence: number;
  quotaHeadroomPercent?: number;
  alternatives?: Array<{ providerId: string; modelId: string; rationale: string }>;
}

export interface RoutingDecisionLog {
  id: string;
  timestamp: number;
  promptSnippet: string;
  detectedTask: SmartTaskType;
  selectedProvider: string;
  selectedModel: string;
  isFree: boolean;
  rationale: string;
  latencyMs?: number;
  tokensUsed?: number;
  failoverOccurred?: boolean;
}

export interface ProviderQuotaInfo {
  providerId: string;
  providerName: string;
  monthlyFreeTokens: number;
  consumedTokens: number;
  remainingTokens: number;
  percentUsed: number;
  isApproachingLimit: boolean;
  isRateLimited: boolean;
  requestsCount: number;
  lastResetTimestamp: number;
  estimatedCostUsd: number;
  costSavedUsd: number;
  healthStatus: 'healthy' | 'degraded' | 'cooling_down' | 'exhausted' | 'untested';
}

export interface QuotaSnapshot {
  totalFreeTokensAvailable: number;
  totalTokensConsumed: number;
  totalCostSavedUsd: number;
  freeModeActive: boolean;
  activeProviderRotation: string;
  providers: Record<string, ProviderQuotaInfo>;
  recentAlerts: Array<{ id: string; providerId: string; message: string; severity: 'info' | 'warning' | 'critical'; timestamp: number }>;
}

export interface OpenKiloStatus {
  authMode: 'anonymous' | 'oauth' | 'api_key';
  isAuthenticated: boolean;
  apiKey?: string;
  userEmail?: string;
  freeTierActive: boolean;
  totalModelsAvailable: number;
}

export interface FCCIntegrityReport {
  valid: boolean;
  hash?: string;
  expectedHash?: string;
  status: 'verified' | 'mismatch' | 'missing' | 'disabled' | 'unverified';
  error?: string;
  code?: 'INTEGRITY_MISMATCH' | 'FILE_NOT_FOUND' | 'LAYER_DISABLED' | 'VERIFIED' | 'UNVERIFIED';
  timestamp: number;
  platform: string;
  targetPath?: string;
  degradationTarget?: 'native-registry' | 'anonymous-gateway';
}

export interface FCCServerStatus {
  installed?: boolean;
  enabled?: boolean;
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
  integrityStatus?: FCCIntegrityReport['status'];
  integrityError?: string;
}

export interface FCCInstallProgress {
  stage: 'checking' | 'downloading' | 'installing' | 'verifying' | 'done' | 'failed';
  percent: number;
  message: string;
}

export interface FCCServiceStatus {
  installed: boolean;
  binaryPath: string | null;
  wrapperCommandsAvailable: string[];
  installing: boolean;
  installProgress: FCCInstallProgress | null;
  lastError: string | null;
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

export type FCCToSStatus = 'compliant' | 'verified' | 'conditional' | 'risky';

export interface FCCModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  isFree: boolean;
  capabilities: {
    reasoning?: boolean;
    coding?: boolean;
    tools?: boolean;
    vision?: boolean;
    fast?: boolean;
    largeContext?: boolean;
    speedTokensPerSec?: number;
  };
  provenance: 'FCC' | 'your key' | 'anonymous' | 'subscription';
  costTier: 'free' | 'low' | 'medium' | 'high';
  description?: string;
}

export interface FCCProviderHealthInfo {
  id: string;
  name: string;
  category: 'api_key' | 'oauth' | 'web_cookie' | 'local';
  authMethod: 'api_key' | 'oauth' | 'web_cookie' | 'none';
  health: 'healthy' | 'degraded' | 'stopped' | 'untested';
  latencyMs: number;
  successRate: number;
  quotaRemainingPercent: number;
  probedAt?: number;
  monthlyFreeTokens: number;
  isFreeTierAvailable: boolean;
  tosStatus: FCCToSStatus;
  tosExplanation?: string;
  enabled: boolean;
  defaultEndpoint: string;
  signupUrl?: string;
  models: FCCModelInfo[];
}

export interface FCCFleetSummary {
  running: boolean;
  health: 'healthy' | 'degraded' | 'stopped';
  statusText: string;
  port: number;
  version: string;
  providersCount: number;
  healthyProvidersCount: number;
  degradedProvidersCount: number;
  stoppedProvidersCount: number;
  totalFreeModels: number;
  aggregateFreeTokens: number;
  usedTokens: number;
  integrityStatus: FCCIntegrityReport['status'];
  fallbackActive: boolean;
}

export interface DetectedHarnessConfig {
  id: string;
  name: string;
  configPath: string;
  harnessType: AgentHarnessType;
  modelPreference?: string;
  hasCredentials: boolean;
  credentialSummary?: string;
  apiKey?: string;
  customInstructions?: string;
  rawPreferences: Record<string, unknown>;
}

export interface HarnessImportResult {
  success: boolean;
  importedHarness?: AgentHarnessType;
  importedModel?: string;
  importedCredentials: string[];
  importedInstructions?: boolean;
  error?: string;
}

export interface SubscriptionInfo {
  id: 'copilot' | 'chatgpt';
  name: string;
  connected: boolean;
  connectedAt?: number;
  models: {
    id: string;
    name: string;
    contextWindow: number;
    badge: string;
  }[];
  attributionBadge: string;
  authMethod: 'device_code' | 'pkce_oauth' | 'config_bridge';
}

export interface CopilotDeviceCodeState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  status: 'pending' | 'authorized' | 'expired' | 'error' | 'cancelled';
  error?: string;
}

export interface LocalSupplyEndpointStatus {
  running: boolean;
  host: string;
  port: number;
  baseUrl: string;
  lanEnabled: boolean;
  authToken: string;
  totalModels: number;
  requestsHandled: number;
}

export interface HarnessInstallStatus {
  id: AgentHarnessType;
  name: string;
  cliName: string;
  installed: boolean;
  binaryPath?: string;
  version?: string;
  configSnippet: string;
}

export interface StructuredDiffBlock {
  filePath?: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface StructuredToolEvent {
  toolName: string;
  arguments: Record<string, unknown> | string;
  status: 'started' | 'completed' | 'error';
  result?: string;
}

export interface HarnessSessionInfo {
  sessionId: string;
  harnessId: AgentHarnessType;
  pid?: number;
  status: 'running' | 'completed' | 'error';
  logs: string[];
  parsedDiffs: StructuredDiffBlock[];
  parsedToolEvents: StructuredToolEvent[];
  startedAt: number;
}

export interface FccOptimizationSavings {
  savedTokens: number;
  rawTokens: number;
  optimizedTokens: number;
  percent: number;
  label: string; // 'Optimization saved X tokens (Y%) this session'
  rtkSavedTokens: number;
  headroomSavedTokens: number;
  cacheSavedTokens: number;
}

export interface FccProviderQuotaBar {
  providerId: string;
  providerName: string;
  isFreeTier: boolean;
  remainingTokens?: number;
  limitTokens?: number;
  remainingRequests?: number;
  limitRequests?: number;
  percentUsed: number;
  resetHuman: string;
  resetsInSeconds?: number;
  isExhausted: boolean;
}

export interface FccQuotaMetersSummary {
  aggregateFreeTokensRemainingToday: number;
  aggregateFreeTokensDailyBudget: number;
  providers: FccProviderQuotaBar[];
  hasAnyExhausted: boolean;
  activeProviderExhausted: boolean;
  recommendedAlternative?: {
    providerId: string;
    modelId: string;
    reason: string;
  };
}

export interface EditorConfigSnippet {
  editor: 'vscode' | 'jetbrains' | 'neovim';
  variant: string;
  filename: string;
  targetPath: string;
  content: string;
  instructions: string;
  fileType: 'json' | 'lua' | 'xml';
}

export interface MessagingConnectorConfig {
  enabled: boolean;
  botToken: string;
  allowlistedUserIds: string[];
  rateCapPerMinute: number;
  workspaceContextEnabled: boolean;
  workspacePath?: string;
  preferredModel?: string;
}

export interface MessagingConnectorStatus {
  type: 'telegram' | 'discord';
  enabled: boolean;
  connected: boolean;
  botUsername?: string;
  allowlistedCount: number;
  rateCapPerMinute: number;
  requestsHandled: number;
  requestsDenied: number;
  lastActive?: number;
  lastError?: string;
}

export interface ConnectorAuditLogEntry {
  id: string;
  timestamp: number;
  connectorType: 'telegram' | 'discord';
  senderId: string;
  senderUsername?: string;
  action: 'ALLOW' | 'DENY_ALLOWLIST' | 'DENY_RATE_LIMIT' | 'ERROR';
  promptSnippet: string;
  responseSnippet?: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface ConnectorsOverview {
  telegram: MessagingConnectorStatus;
  discord: MessagingConnectorStatus;
  recentAuditLogs: ConnectorAuditLogEntry[];
}

export interface BackgroundTaskInfo {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'needs-attention';
  startTime: number;
  endTime?: number;
  attentionReason?: string;
}

export interface SessionBridgeInfo {
  sessionId: string;
  workspaceRoot: string;
  clientType: string;
  status: 'idle' | 'streaming' | 'paused' | 'disposed';
  subscriberCount: number;
  createdAt: number;
  lastActiveAt: number;
  tokensStreamed: number;
  turnCount: number;
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

export interface DetectedHarnessConfig {
  id: string;
  name: string;
  configPath: string;
  harnessType: AgentHarnessType;
  modelPreference?: string;
  hasCredentials: boolean;
  credentialSummary?: string;
  apiKey?: string;
  customInstructions?: string;
  rawPreferences: Record<string, unknown>;
}

export interface HarnessImportResult {
  success: boolean;
  importedHarness?: AgentHarnessType;
  importedModel?: string;
  importedCredentials: string[];
  importedInstructions?: boolean;
  error?: string;
}

export interface HarnessMetadata {
  id: AgentHarnessType;
  name: string;
  cliName: string;
  description: string;
  defaultModel: string;
  promptFormat: string;
  toolProtocol: string;
  systemPromptRole: string;
  supportedFeatures: string[];
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export type {
  OpenPerfTraceReport,
  FolderBenchmarkResult,
  FileBenchmarkResult,
  BlockerHuntReport,
  OpenOffenderItem,
  SyncBlockerFinding,
  HugeIpcPayloadFinding,
  RendererMainThreadFinding,
  SyncWatcherOrAutoSaveFinding,
  OpenOffenderCategory,
  FolderOpenStages,
  FileOpenStages,
  OpenStageMetric,
  ReproducibilityVerification
};


