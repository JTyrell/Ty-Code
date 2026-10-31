import type { z } from 'zod';
import type { ExtensionCapabilitySchema, ExtensionManifestSchema } from './extension-schemas';
import type { ModelLock, ModelLockMode, SecurityPolicySettings, SettingsData, SettingsPatch, SettingsScope, TelemetrySettings, WorkspaceSettingsPatch } from '../shared/types/settings';
import type { WorkspaceProfile } from '../main/services/context-engine/types';
import type { CorrectionCategory, CorrectionEntry, CorrectionSurface } from '../main/services/context-engine/correction-memory';
import type { MCPServerConfig } from '../main/services/context-engine/mcp-router';
import type { ContextScoreResult, ContextScoreBreakdown, ContextScoreCategory } from '../main/services/context-engine/context-scorer';
import type { DesignProfile, DesignComponent } from '../main/services/context-engine/design-system-extractor';
export type { WorkspaceProfile, CorrectionCategory, CorrectionEntry, CorrectionSurface, MCPServerConfig, ContextScoreResult, ContextScoreBreakdown, ContextScoreCategory, DesignProfile, DesignComponent };
import type { FreeProvider, ModelTier, TierClassification, ProviderHealthStatus } from '../shared/types/free-providers';
import type { DetectedApiKey, CustomProviderConfig, StoredKeySummary, ByokExportBundle, ByokImportResult, KeyDetectionSource } from '../shared/types/byok';
import type { OpenCodeDetectionResult, OpenCodeFreeTierSummary, OpenCodeImportResult, AgentFramework } from '../shared/types/opencode-sync';
import type { DevChaosFault, DevChaosRequest, ReliabilityAdvisorPayload, ReliabilityHealthSnapshot } from '../shared/types/agent-events';
import type {
  CommandContext,
  CommandContextKey,
  CommandContextSnapshot,
  CommandEntry,
  CommandExecutionRecord,
  CommandMenuId,
  CommandOutcomeReason,
  DynamicSubmenuItem,
  DynamicSubmenuSource,
  ExecuteCommandPayload,
  ExecuteCommandResult,
  MainCommandContext,
  RegistryKeybinding,
  ResolvedMenu,
  ResolvedMenuRow
} from '../shared/types/command-registry';

// Prompt 5: the command registry. Re-exported so renderer surfaces type their
// menu payloads from here rather than reaching into shared/types directly.
export type {
  CommandContext,
  CommandContextKey,
  CommandContextSnapshot,
  CommandEntry,
  CommandExecutionRecord,
  CommandMenuId,
  CommandOutcomeReason,
  DynamicSubmenuItem,
  DynamicSubmenuSource,
  ExecuteCommandPayload,
  ExecuteCommandResult,
  MainCommandContext,
  RegistryKeybinding,
  ResolvedMenu,
  ResolvedMenuRow
};

// ===== Autonomous Free-Tier Reliability =====
/** Structural mirror of the bounded local reliability ledger record shape. */
export interface ReliabilityLedgerRecord {
  at: number;
  kind: 'probe' | 'ladder_step' | 'cooldown' | 'advisor' | 'recovered' | 'chaos';
  turnId?: string;
  route?: string;
  step?: string;
  outcome?: string;
  latencyMs?: number;
  detail?: string;
}
export interface ReliabilityStatsSummary {
  probeCount: number;
  probeFailures: number;
  ladderSteps: number;
  ladderSucceeded: number;
  cooldownCount: number;
  rotationCount: number;
  advisorCount: number;
  recoveredCount: number;
}
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
  FullConnectivityTraceReport,
  SidecarLedgerEntry
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
  ScopeRejectionCard,
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
export type { FreeProvider, ModelTier, TierClassification, ProviderHealthStatus, ScopeRejectionCard };
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

/**
 * Renderer-safe verified catalog summary. Routes bare facts only: no
 * endpoints, no credentials. Availability booleans back the UI pills.
 */
export interface VerifiedModelCatalogSummary {
  models: Array<{ modelId: string; name: string; providerId: string; requiresKey: boolean }>;
  communityKeyCached: boolean;
  openRouterKeyAvailable: boolean;
  providerKeyConfigured: Record<string, boolean>;
  ollamaConnected: boolean;
}

export type SettingsErrorCode = 'VALIDATION' | 'IO' | 'PARSE' | 'LOCK';

export interface StructuredSettingsError {
  ok: false;
  code: SettingsErrorCode;
  message: string;
  detail: string;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorDetail?: StructuredSettingsError;
}

// Workspace Session Bus (single source of truth for all surfaces)
export type WorkspaceSurfaceId = 'editor' | 'context' | 'debugger' | 'canvas';

export interface WorkspaceSurfacePresence {
  attached: boolean;
  lastActive: number;
}

export interface WorkspaceSessionSnapshot {
  rootPath: string | null;
  openedAt: number | null;
  surfaces: Record<WorkspaceSurfaceId, WorkspaceSurfacePresence>;
}

export type WorkspaceSessionEvent = {
  channel: 'workspace:opened' | 'workspace:changed' | 'workspace:closed' | 'workspace:session-updated';
  session: WorkspaceSessionSnapshot;
};

// ---------------------------------------------------------------------------
// Model availability (Provider Series Prompt 1)
// ---------------------------------------------------------------------------

export type ModelAvailabilityStatus = 'available' | 'key_required' | 'service_unavailable';

export interface VerifiedModelConfig {
  modelId: string;
  name: string;
  url: string;
  requiresKey: boolean;
  providerId: string;
}

export interface AvailableModelConfig extends VerifiedModelConfig {
  availabilityStatus: ModelAvailabilityStatus;
  providerName: string;
  isSelectable: boolean;
}

export interface ModelAvailabilitySummary {
  total: number;
  available: number;
  locked: number;
  /** Seconds left on the Community-Key rate-limit back-off (429 retry-after). */
  communityKeyCooldownSec: number;
}

export type OpencodeInstallStage = 'checking' | 'installing' | 'verifying' | 'done' | 'failed';

export interface OpencodeInstallProgress {
  stage: OpencodeInstallStage;
  percent: number;
  message: string;
}

export interface OpencodeInstallState {
  installing: boolean;
  stage: OpencodeInstallStage | 'idle';
  percent: number;
  message: string;
  lastResult: { success: boolean; cliPath: string | null; error: string | null } | null;
}

/**
 * Masked result of an active provider selection sync. Never carries usable
 * credentials: the renderer only sees a display-safe preview string
 * (e.g. "sk-ant-••••1234") or nothing at all.
 */
export interface ActiveRouteSnapshot {
  modelLock: ModelLock;
  activeRoute: { providerId: string; modelId: string };
  temporary: boolean;
  reason: string | null;
  updatedAt: number;
}

export interface ModelRouteEvent {
  kind: 'lock_changed' | 'deviated' | 'recovered';
  modelLock: ModelLock;
  activeRoute: { providerId: string; modelId: string };
  reason: string;
  timestamp: number;
}

export interface ProviderHealthSnapshot {
  updatedAt: number;
  invalidProviders: string[];
  rateLimitedProviders: Array<{ providerId: string; retryAt: number }>;
}

export interface ActiveProviderConfigSummary {
  providerId: string;
  modelId: string;
  mode: ModelLockMode;
  keyStatus: 'own' | 'community' | 'anonymous' | 'missing';
  maskedKey?: string;
  degraded?: boolean;
  reason?: 'MISSING_KEY' | 'UNRESOLVED_COMMUNITY';
  /** Set by main's RouteEventPolicy only when the user may be told something. */
  notice?: {
    class: 'SILENT' | 'LEDGER_PLUS_ONCE' | 'ACTIONABLE';
    severity: 'info' | 'warning';
    title: string;
    message: string;
    actionUrl?: string;
  };
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
  chatFontFamily?: 'sans' | 'serif' | 'mono' | 'plex';
  chatFontSize?: number;
  matrixDecodeEnabled?: boolean;
  ukPunctuationEnabled?: boolean;
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

// ---------------------------------------------------------------------------
// Memory Pressure Governor (local-only, Zero-Telemetry)
// ---------------------------------------------------------------------------
export type GovernorTier = 'NOMINAL' | 'ELEVATED' | 'CRITICAL' | 'OVER';
export type GovernorMode = 'FULL' | 'LITE';

export interface MemorySample {
  ts: number;
  mainRssMb: number;
  mainHeapTotalMb: number;
  mainHeapUsedMb: number;
  rendererRssMb?: number;
  rendererHeapUsedMb?: number;
}

export interface SurfacePresence {
  id: string;
  type: string;
  lastActive: number;
  active: boolean;
}

export interface GovernorSnapshot {
  tier: GovernorTier;
  mode: GovernorMode;
  totalSystemRamGb: number;
  mainRssMb: number;
  liteMode: boolean;
  samples: MemorySample[];
  latestSample: MemorySample | null;
  surfaces: SurfacePresence[];
}

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
  modelLock: ModelLock;
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
  /** Epoch-ms of the FIRST token flush (route stamping point). */
  firstTokenAt?: number;
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
  proposedDocument?: AgentDocument;
  reasoning?: string;
  thoughts?: string[];
  thoughtDurationSeconds?: number;
  streaming?: boolean;
  renderMode?: 'markdown' | 'plaintext' | 'streaming';
  errorCard?: ChatErrorCard;
  metadata?: AssistantStreamMetadata;
  isCached?: boolean;
  failoverNotice?: string;
  isStreaming?: boolean;
  timestamp: number;
  actions?: string[];
  truncated?: boolean;
  modeEscalation?: { from: string; to: string };
  scopeRejectionCard?: ScopeRejectionCard;
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
  | { type: 'provider_failover'; fromProvider: string; toProvider: string; toModel: string; error?: string }
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

export interface AgentDocumentSection {
  id: string;
  heading: string;
  level: number;
  markdown: string;
}

export interface AgentDocument {
  id: string;
  kind: 'plan' | 'report';
  title: string;
  markdown: string;
  sections: AgentDocumentSection[];
  createdAt: number;
}

export interface AgentStreamChunk {
  type: 'token' | 'thought' | 'tool_call' | 'tool_result' | 'diff' | 'status' | 'approval_request' | 'done' | 'cancelled' | 'error' | 'agent_state' | 'document_proposed';
  taskId?: string;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  diff?: ProposedDiff;
  approvalRequest?: AgentToolApproval;
  error?: string;
  state?: AgentLoopState;
  actions?: string[];
  truncated?: boolean;
  modeEscalation?: { from: string; to: string };
  scopeRejectionCard?: ScopeRejectionCard;
  document?: AgentDocument;
}

export interface DocumentProposedChunk {
  taskId: string;
  type: 'document_proposed';
  document: AgentDocument;
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

/** Options for the readiness-aware terminal command dispatch (Prompt: Terminal Command Dispatch Fix). */
export interface TerminalRunCommandOptions {
  /** Target a specific PTY instead of the ACTIVE visible terminal. */
  terminalId?: string;
  /** true (default): write the command followed by \r so it executes; false: paste-only at the prompt. */
  execute?: boolean;
  /** Create a fresh terminal when no explicit/active terminal can receive the command. */
  createIfMissing?: boolean;
}

export interface TerminalDispatchResult {
  dispatched: boolean;
  terminalId?: string;
  reason?: string;
}

export interface TerminalDispatchLedgerEntry {
  id: number;
  terminalId: string;
  cmd: string;
  readyWaitMs: number;
  outcome: 'executed' | 'created' | 'queued' | 'timeout' | 'failed';
  detail?: string;
  ts: number;
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

export interface GitRepositoryInfo {
  root: string;
  name: string;
  /** workspace = the opened folder itself, parent = repo containing it, child = nested repo inside it. */
  kind: 'workspace' | 'parent' | 'child';
}

export interface GitGraphRefs {
  branches: string[];
  remoteBranches: string[];
  tags: string[];
  isHead: boolean;
}

export interface GitGraphCommit {
  hash: string;
  parents: string[];
  message: string;
  authorName: string;
  /** Unix seconds (from %at). */
  timestamp: number;
  refs: GitGraphRefs;
}

export interface GitGraphResult {
  commits: GitGraphCommit[];
  head?: string;
  currentBranch?: string;
  isRepo: boolean;
}

export interface GitSuggestedCommitMessage {
  type: string;
  scope?: string;
  subject: string;
  body: string;
}

/**
 * Prompt 3: Copy Pipeline — clipboard contracts.
 *
 * `via` reports which path actually landed the copy: the renderer's async
 * clipboard API ('async') or this main-process fallback ('main'). `verified`
 * is false when a write did not throw but could not be confirmed by read-back
 * (e.g. remote session blocking reads); callers may still treat that as a
 * success, but diagnostics stay honest about it.
 */
export type ClipboardFailureReason =
  | 'invalid_payload'
  | 'write_threw'
  | 'unverified'
  | 'read_threw'
  | 'no_backend'
  | 'denied'
  | 'unavailable';

export interface ClipboardWriteOutcome {
  ok: boolean;
  via: 'main';
  chars: number;
  verified: boolean;
  reason?: ClipboardFailureReason;
  error?: string;
}

export interface ClipboardReadOutcome {
  ok: boolean;
  text: string;
  reason?: ClipboardFailureReason;
  error?: string;
}

/** One entry of the bounded clipboard trail. NEVER contains copied content. */
export interface ClipboardAuditEntry {
  timestamp: number;
  op: 'write' | 'read';
  source: string;
  ok: boolean;
  chars: number;
  reason?: ClipboardFailureReason;
  error?: string;
}

export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximizeChange?: (callback: (isMaximized: boolean) => void) => () => void;
  selectWorkspaceFolder: () => Promise<IpcResponse<string>>;
  openFolderDialog: () => Promise<IpcResponse<string>>;
  openFolderInExplorer: (folderPath: string) => Promise<IpcResponse<void>>;
  scanWorkspace: (rootPath?: string) => Promise<IpcResponse<WorkspaceProfile>>;
  saveCorrection: (options: { workspacePath?: string; rule: string; category?: 'style' | 'architecture' | 'stack'; surface?: CorrectionSurface }) => Promise<IpcResponse<CorrectionEntry>>;
  getCorrections: (workspacePath?: string) => Promise<IpcResponse<string[]>>;
  getCorrectionEntries: (workspacePath?: string) => Promise<IpcResponse<CorrectionEntry[]>>;
  deleteCorrection: (options: { workspacePath?: string; id: string }) => Promise<IpcResponse<boolean>>;
  getRecommendedMCPs: (workspacePath?: string) => Promise<IpcResponse<MCPServerConfig[]>>;
  getContextScore: (workspacePath?: string) => Promise<IpcResponse<{ scoreResult: ContextScoreResult; profile: WorkspaceProfile; corrections: CorrectionEntry[] }>>;
  resyncWorkspaceContext: (workspacePath?: string) => Promise<IpcResponse<{ scoreResult: ContextScoreResult; profile: WorkspaceProfile; corrections: CorrectionEntry[] }>>;
  getDesignProfile: (workspacePath?: string) => Promise<IpcResponse<DesignProfile>>;
  onCorrectionAdded?: (callback: (entry: CorrectionEntry) => void) => () => void;
  onWorkspaceReady?: (callback: (data: { path: string }) => void) => () => void;
  onVaultKeysUndecryptable?: (callback: (payload: { message: string }) => void) => () => void;
  onOpenFolder?: (callback: (data: { folderPath: string }) => void) => () => void;
  onWorkspaceRequestOpen?: (callback: (data: unknown) => void) => () => void;
  getWorkspaceSession?: () => Promise<IpcResponse<WorkspaceSessionSnapshot>>;
  setActiveSessionWorkspace?: (rootPath: string) => Promise<IpcResponse<WorkspaceSessionSnapshot>>;
  attachSessionSurface?: (id: WorkspaceSurfaceId) => Promise<IpcResponse<WorkspaceSessionSnapshot>>;
  detachSessionSurface?: (id: WorkspaceSurfaceId) => Promise<IpcResponse<WorkspaceSessionSnapshot>>;
  closeSessionWorkspace?: () => Promise<IpcResponse<WorkspaceSessionSnapshot>>;
  onWorkspaceSession?: (callback: (event: { channel: 'workspace:opened' | 'workspace:changed' | 'workspace:closed' | 'workspace:session-updated'; session: WorkspaceSessionSnapshot }) => void) => () => void;
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
  /** Prompt 3: boot-state hydration gate (first-run decision source = main). */
  getBootState: () => Promise<IpcResponse<{ firstRun: boolean; hasCompletedOnboarding: boolean }>>;
  saveSettings: (settings: Partial<ProviderSettings>) => Promise<IpcResponse<void>>;
  /** Selection -> active agent config sync. Returns masked summaries only. */
  updateActiveProviderConfig: (config: { providerId: string; modelId?: string; mode: ModelLockMode; origin?: 'explicit' | 'auto' }) => Promise<IpcResponse<ActiveProviderConfigSummary>>;
  getActiveRoute: () => Promise<IpcResponse<ActiveRouteSnapshot & { events: ModelRouteEvent[] }>>;
  onActiveRouteChanged: (callback: (snapshot: ActiveRouteSnapshot, event?: ModelRouteEvent) => void) => () => void;
  getProviderHealth: () => Promise<IpcResponse<ProviderHealthSnapshot>>;
  onProviderHealthChanged: (callback: (snapshot: ProviderHealthSnapshot) => void) => () => void;
  getTelemetryPreview: () => Promise<IpcResponse<TelemetryPreview>>;
  deleteTelemetryEvent: (index: number, expected: TelemetryEvent) => Promise<IpcResponse<void>>;
  clearTelemetryData: () => Promise<IpcResponse<void>>;
  getCredentialStorageStatus: () => Promise<IpcResponse<CredentialStorageStatus>>;
  onTelemetryChanged: (callback: () => void) => () => void;
  /**
   * Copy text to the system clipboard via the main process (sandbox-safe).
   * Prompt 3: this is the FALLBACK used by src/renderer/src/lib/clipboard.ts
   * when the async clipboard API is unavailable or denied, and it works in
   * every window (main, Canvas popout, Debugger popout). Main verifies each
   * write against a read-back, so `success:false` always carries a reason.
   */
  copyToClipboard: (payload: string | { text: string; source?: string }) => Promise<IpcResponse<ClipboardWriteOutcome>>;
  /** Read the system clipboard via main; fallback for navigator.clipboard.readText. */
  readFromClipboard: (source?: string) => Promise<IpcResponse<ClipboardReadOutcome>>;
  /** Metadata-only clipboard trail for the diagnostics panel. */
  getClipboardAudit: () => Promise<IpcResponse<ClipboardAuditEntry[]>>;
  // ===== Prompt 5: Command Registry bridge =====
  /**
   * Forward a menu/palette/keybinding activation to the main process.
   *
   * Only needed for entries whose `target` is `main`; renderer-target commands
   * run locally through the renderer executor so a click never waits on IPC.
   * The window's own context snapshot travels with the call because main cannot
   * observe editor or debugger state. Main layers its own authoritative keys
   * over the snapshot, so a window cannot unlock a guarded row by claiming one.
   *
   * `success:false` means the call itself failed (untrusted frame, invalid
   * payload). `success:true` with `data.ok === false` means the call completed
   * and the command declined for a reason the UI can show — that distinction is
   * what lets "zero dead clicks" be reported honestly.
   */
  executeCommand: (payload: ExecuteCommandPayload) => Promise<IpcResponse<ExecuteCommandResult>>;
  /**
   * Click on a runtime-generated submenu row (an open tab, a running task, a
   * detected process). These cannot be named in the registry because they only
   * exist once the user looks.
   */
  executeDynamicCommand: (
    item: DynamicSubmenuItem,
    contexts?: CommandContextSnapshot
  ) => Promise<IpcResponse<ExecuteCommandResult>>;
  /**
   * Main's view of the command table: contexts only main can know, the handler
   * keys it has live, and the ones it still lacks. A window merges this over its
   * own state so it hides rows main could not run rather than painting a click
   * that ends in `no_handler`.
   */
  getMainCommandContext: () => Promise<IpcResponse<MainCommandContext>>;
  /** Bounded execution ledger, metadata only, for the Reliability Panel. */
  getCommandAuditTrail: () => Promise<IpcResponse<CommandExecutionRecord[]>>;
  getSettingsLayer: (scope: SettingsScope) => Promise<IpcResponse<SettingsData | WorkspaceSettingsPatch>>;
  saveSettingsLayer: (scope: SettingsScope, settings: SettingsPatch | WorkspaceSettingsPatch) => Promise<IpcResponse<void>>;
  getSecurityPolicy: () => Promise<IpcResponse<SecurityPolicySettings>>;
  saveSecurityPolicy: (policy: Partial<SecurityPolicySettings>) => Promise<IpcResponse<void>>;
  /** This window's own webContents id (echo suppression); cached, one probe. */
  getWebContentsId: () => number;
  /**
   * settings:changed echo suppression (Prompt: Break the Model-Sync Echo
   * Loop): the payload carries the webContents id of the window that caused
   * the change; null = main-originated. Listeners are disposable.
   */
  onSettingsChanged: (callback: (payload?: { originWebContentsId?: number | null }) => void) => () => void;
  /** Dev-only storm generator probe; rejects in packaged builds. */
  devStormTestSetActiveModel: () => Promise<IpcResponse<{ calls: number; stormDetected: boolean }>>;
  // ===== Autonomous Free-Tier Reliability (Prompts 1-3) =====
  /** Dev-only chaos injector; main refuses in packaged builds. */
  devChaosInject?: (request: DevChaosRequest) => Promise<IpcResponse<{ fault: DevChaosFault }>>;
  getReliabilityHealth?: () => Promise<IpcResponse<ReliabilityHealthSnapshot>>;
  getReliabilityLedgerTail?: (limit?: number) => Promise<IpcResponse<{ records: ReliabilityLedgerRecord[] }>>;
  getReliabilityStats?: () => Promise<IpcResponse<ReliabilityStatsSummary>>;
  /** Advisor one-click actions (non-modal card buttons; never toasts). */
  reliabilityRepairFcc?: () => Promise<IpcResponse<{ started: boolean; isActive: boolean }>>;
  /** Route Truth (Prompt 1 Step 4) / Prompt 2 Step 3: "Re-test & recover routes". */
  reliabilityHealRoutes?: () => Promise<IpcResponse<{ healed: Array<{ providerId: string; modelId?: string }>; remaining: string[] }>>;
  reliabilityRetestProviders?: () => Promise<IpcResponse<ReliabilityHealthSnapshot>>;
  reliabilityStartOllama?: () => Promise<IpcResponse<{ running: boolean; error?: string }>>;
  /** Disposable subscriptions; versioned snapshots, advisor cards/recovery. */
  onReliabilityHealth?: (callback: (snapshot: ReliabilityHealthSnapshot) => void) => () => void;
  onReliabilityAdvisor?: (callback: (payload: ReliabilityAdvisorPayload) => void) => () => void;
  // Prompt Assembler & Role Preferences (Deliverable 1 & 2)
  getAssemblyHistory?: () => Promise<IpcResponse<AssemblyResult[]>>;
  getAssemblyInfo?: (taskId: string) => Promise<IpcResponse<AssemblyResult | null>>;
  onAssemblyUpdate?: (callback: (assembly: AssemblyResult) => void) => () => void;
  getRolePreferences?: (customRoot?: string) => Promise<IpcResponse<RolePreferences>>;
  setRolePreferences?: (prefs: RolePreferences, customRoot?: string) => Promise<IpcResponse<RolePreferences>>;
  resetRolePreferences?: (customRoot?: string) => Promise<IpcResponse<RolePreferences>>;
  onPreferencesChanged?: (callback: (prefs: RolePreferences) => void) => () => void;
  // Feature 1 & 2: Token Accounting Ledger & Enterprise Policy
  getEffectivePolicy?: () => Promise<IpcResponse<any>>;
  queryLedger?: (filter?: any) => Promise<IpcResponse<{ records: any[]; summary: any }>>;
  getLedgerInsights?: (filter?: any) => Promise<IpcResponse<any[]>>;
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
    clientSentAt?: number;
  }) => Promise<IpcResponse<string>>;
  stopAgentTask: (taskId: string) => Promise<IpcResponse<void>>;
  respondAgentApproval: (approvalId: string, approved: boolean, feedback?: string) => Promise<IpcResponse<void>>;
  sendApprovalResponse: (approvalId: string, response: 'APPROVED' | 'REVISED', feedback?: string) => Promise<IpcResponse<void>>;
  userApproveDiff?: (payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean) => Promise<IpcResponse<void>>;
  onAgentStream: (callback: (chunk: AgentStreamChunk) => void) => () => void;
  onAgentStreamBatch?: (callback: (chunks: AgentStreamChunk[]) => void) => () => void;
  onAgentStreamToken?: (callback: (payload: AgentStreamTokenPayload) => void) => () => void;
  onAgentReasoningToken?: (callback: (payload: AgentReasoningTokenPayload) => void) => () => void;
  onAgentToolStart?: (callback: (payload: AgentToolStartPayload) => void) => () => void;
  onAgentToolResult?: (callback: (payload: AgentToolResultPayload) => void) => () => void;
  onAgentDiffProposed?: (callback: (payload: AgentDiffProposedPayload) => void) => () => void;
  onAgentDocumentProposed?: (callback: (payload: { taskId: string; document: AgentDocument }) => void) => () => void;
  onDocumentProposed?: (callback: (payload: { taskId: string; document: AgentDocument }) => void) => () => void;
  updateDocument?: (payload: { id: string; markdown: string; title?: string }) => Promise<IpcResponse<AgentDocument>>;
  getLastDocument?: () => Promise<IpcResponse<AgentDocument | null>>;
  loadDocument?: (id: string) => Promise<IpcResponse<AgentDocument | null>>;
  onAgentDone?: (callback: (payload: AgentDonePayload) => void) => () => void;
  onAgentError?: (callback: (payload: AgentErrorPayload) => void) => () => void;
  perfReportH5?: (data: { taskId: string; h5: number }) => void;

  // Memory Pressure Governor (local-only, Zero-Telemetry)
  governorGetState: () => Promise<IpcResponse<GovernorSnapshot>>;
  governorSample: (sample: { rssMb?: number; heapUsedMb?: number; ts?: number }) => void;
  surfaceHeartbeat: (surfaceId: string) => void;
  onGovernorStateChanged: (callback: (payload: { tier: GovernorTier; mode: GovernorMode }) => void) => () => void;
  onGovernorSurfaceCrashed: (callback: (payload: { surfaceId: string; notice: string; reload: boolean }) => void) => () => void;
  onGovernorSurfaceShed: (callback: (payload: { surfaceId: string; notice: string }) => void) => () => void;
  onGovernorLiteMode: (callback: (payload: { totalSystemRamGb: number; notice: string }) => void) => () => void;
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
  discardVoiceSession: (sessionId: string) => Promise<IpcResponse<void>>;
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
  terminalRunCommand: (cmd: string, opts?: TerminalRunCommandOptions) => Promise<IpcResponse<TerminalDispatchResult>>;
  reportActiveTerminal: (ptyId: string) => void;
  ackTerminalAttached: (ptyId: string) => void;
  getTerminalDispatchLedger: (limit?: number) => Promise<IpcResponse<TerminalDispatchLedgerEntry[]>>;
  onTerminalCommandDispatched: (callback: (data: { terminalId: string; cmd: string; execute: boolean }) => void) => () => void;
  onTerminalDispatchFailed: (callback: (data: { cmd: string; reason: string; opts?: TerminalRunCommandOptions; terminalId?: string }) => void) => () => void;
  onPtySessionCreated: (callback: (data: PtySessionInfo & { cwd?: string }) => void) => () => void;
  searchExtensions: (query: string) => Promise<IpcResponse<ExtensionMetadata[]>>;
  getExtensionDetails: (namespace: string, name: string) => Promise<IpcResponse<Record<string, unknown>>>;
  getAvailableSkills: (workspacePath: string) => Promise<IpcResponse<SkillDefinition[]>>;

  // Open VSX Marketplace APIs
  marketplaceSearch: (options: MarketplaceSearchOptions | string) => Promise<IpcResponse<MarketplaceSearchResult>>;
  marketplaceMetadata: (namespace: string, extension: string) => Promise<IpcResponse<MarketplaceExtensionEntry | null>>;
  marketplaceInstall: (entry: MarketplaceExtensionEntry | { id: string; downloadUrl?: string; sha256?: string;[key: string]: unknown }) => Promise<IpcResponse<InstallResult>>;
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
  gitIsRepo: (payload?: { repoPath?: string }) => Promise<IpcResponse<boolean>>;
  gitInit: (payload?: { repoPath?: string }) => Promise<IpcResponse<void>>;
  gitGetStatus: (payload?: { repoPath?: string }) => Promise<IpcResponse<GitStatusResult>>;
  gitGetDiff: (payload?: { filePath?: string; staged?: boolean; repoPath?: string }) => Promise<IpcResponse<string>>;
  gitGetOriginalContent: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => Promise<IpcResponse<string>>;
  gitStage: (payload: { filePaths: string | string[]; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitUnstage: (payload: { filePaths: string | string[]; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitDiscardChanges: (payload: { filePath: string; isUntracked?: boolean; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitCommit: (payload: { message: string; options?: { amend?: boolean }; repoPath?: string }) => Promise<IpcResponse<string>>;
  gitGetBranches: (payload?: { repoPath?: string }) => Promise<IpcResponse<GitBranchInfo>>;
  gitSwitchBranch: (payload: { branchName: string; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitCreateBranch: (payload: { branchName: string; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitDeleteBranch: (payload: { branchName: string; force?: boolean; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitFetch: (payload?: { repoPath?: string }) => Promise<IpcResponse<void>>;
  gitPull: (payload?: { repoPath?: string }) => Promise<IpcResponse<string>>;
  gitPush: (payload?: { remote?: string; branch?: string; repoPath?: string }) => Promise<IpcResponse<string>>;
  gitGetLog: (payload?: { maxCount?: number; search?: string; repoPath?: string }) => Promise<IpcResponse<GitCommitInfo[]>>;
  gitGetBlame: (payload: { filePath: string; repoPath?: string }) => Promise<IpcResponse<GitBlameHunk[]>>;
  gitStash: (payload: { action: 'list' | 'save' | 'pop' | 'drop'; message?: string; index?: number; repoPath?: string }) => Promise<IpcResponse<GitStashInfo[] | string>>;
  gitGetRemotes: (payload?: { repoPath?: string }) => Promise<IpcResponse<GitRemoteInfo[]>>;
  gitGetFileDiff: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => Promise<IpcResponse<GitFileDiff>>;
  gitGetCommitDetail: (payload: { hash: string; repoPath?: string }) => Promise<IpcResponse<GitCommitDetail>>;
  gitGetTags: (payload?: { repoPath?: string }) => Promise<IpcResponse<GitTagInfo[]>>;
  gitCreateTag: (payload: { name: string; message?: string; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitDeleteTag: (payload: { name: string; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitGetConflictContent: (payload: { filePath: string; repoPath?: string }) => Promise<IpcResponse<GitConflictContent>>;
  gitResolveConflict: (payload: { filePath: string; action: 'ours' | 'theirs' | 'mark-resolved'; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitAbortMerge: (payload?: { repoPath?: string }) => Promise<IpcResponse<void>>;
  gitGetHunks: (payload: { filePath: string; staged?: boolean; repoPath?: string }) => Promise<IpcResponse<GitHunk[]>>;
  gitApplyHunk: (payload: { filePath: string; hunkId: string; operation: 'stage' | 'unstage' | 'revert'; repoPath?: string }) => Promise<IpcResponse<void>>;
  gitMerge: (payload: { branchName: string; repoPath?: string }) => Promise<IpcResponse<{ success: boolean; conflicts?: string[]; message?: string }>>;
  gitListRepositories: (payload?: { workspacePath?: string }) => Promise<IpcResponse<GitRepositoryInfo[]>>;
  gitGraph: (payload?: { maxCount?: number; repoPath?: string }) => Promise<IpcResponse<GitGraphResult>>;
  gitSuggestCommitMessage: (payload?: { repoPath?: string }) => Promise<IpcResponse<GitSuggestedCommitMessage>>;

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
  onUpdateStatus: (callback: (status: { type: string;[key: string]: any }) => void) => () => void;
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
  fccVoiceInput: (audioData: ArrayBuffer | Uint8Array | string, options?: { mimeType?: string; language?: string }) => Promise<IpcResponse<{ text: string; confidence?: number; language?: string; durationMs?: number }>>;
  fccBrowserSession: (options: { action: string; url?: string; script?: string; reuseSession?: boolean }) => Promise<IpcResponse<any>>;

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

  // M3E Canvas Live Project Editor (Prompt 4)
  canvasPreviewStart?: () => Promise<IpcResponse<CanvasPreviewStatusPayload>>;
  canvasPreviewStatus?: () => Promise<IpcResponse<CanvasPreviewStatusPayload>>;
  canvasPreviewStop?: () => Promise<IpcResponse<CanvasPreviewStatusPayload>>;
  canvasPreviewDisposeAll?: () => Promise<IpcResponse<void>>;
  applyCanvasEdits?: (payload: { intents: CanvasEditIntent[] }) => Promise<IpcResponse<CanvasEditApplyResultData>>;
  dispatchCanvasStructural?: (payload: CanvasStructuralIntentPayload) => Promise<IpcResponse<void>>;
  onCanvasPreviewStatus?: (callback: (payload: CanvasPreviewStatusPayload) => void) => () => void;
  onCanvasEditApplied?: (callback: (payload: CanvasEditAppliedPayload) => void) => () => void;
  onCanvasEditPreviewProposed?: (callback: (payload: CanvasPreviewProposedPayload) => void) => () => void;

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
  onDebuggerAiStream?: (callback: (frame: { runId: string; role: AnalysisRole; phase: 'token' | 'done' | 'error'; chunk?: string; parseMode?: string }) => void) => () => void;
  setDebuggerModelMode?: (mode: 'auto' | 'manual', modelId?: string, providerId?: string) => Promise<IpcResponse<{ mode: 'auto' | 'manual'; auto?: boolean; manualModelId?: string; manualProviderId?: string }>>;
  getDebuggerModelPreferences?: () => Promise<IpcResponse<{ mode: 'auto' | 'manual'; auto?: boolean; manualModelId?: string; manualProviderId?: string; lastActiveModel?: { modelId: string; name: string; providerId: string; taskType: string } }>>;
  getDebuggerTaskModels?: () => Promise<IpcResponse<Record<string, { modelId: string; name: string; url: string; requiresKey: boolean; providerId: string }>>>;
  onDebuggerModelPreferencesChanged?: (callback: (prefs: { mode: 'auto' | 'manual'; auto?: boolean; manualModelId?: string; manualProviderId?: string }) => void) => () => void;

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

  // OpenCode CLI auto-install (zero-touch free tier)
  opencodeInstall?: () => Promise<IpcResponse<{ cliPath: string | null; alreadyInstalled: boolean }>>;
  opencodeInstallStatus?: () => Promise<IpcResponse<OpencodeInstallState>>;
  onOpencodeInstallProgress?: (callback: (progress: OpencodeInstallProgress) => void) => () => void;

  // Manual key configuration for OpenCode's premium models (vault + config injection)
  saveOpenCodeApiKey?: (provider: string, key: string) => Promise<IpcResponse<OpenCodeApiKeySaveResult>>;
  getOpenCodeKeyStatus?: () => Promise<IpcResponse<OpenCodeKeyStatus[]>>;

  // OpenCode Free Tier chat bridge (direct CLI subprocess streaming)
  sendOpenCodeMessage?: (payload: OpenCodeChatPayload) => Promise<IpcResponse<boolean>>;
  onOpenCodeStream?: (callback: (chunk: string) => void) => () => void;
  onOpenCodeDone?: (callback: (payload?: { stopped?: boolean }) => void) => () => void;
  onOpenCodeError?: (callback: (payload: { message: string }) => void) => () => void;
  stopOpenCodeProcess?: () => Promise<IpcResponse<boolean>>;

  // Phase 6.4: Intelligent Model Router
  modelRouterClassifyTask?: (prompt: string) => Promise<IpcResponse<TaskClassificationResult>>;
  modelRouterSelectModel?: (prompt: string, overridePreferences?: Partial<RouterUserPreferences>) => Promise<IpcResponse<ModelRoutingDecision>>;
  modelRouterGetPreferences?: () => Promise<IpcResponse<RouterUserPreferences>>;
  modelRouterSetPreferences?: (updates: Partial<RouterUserPreferences>) => Promise<IpcResponse<RouterUserPreferences>>;
  modelRouterGetAvailableModels?: () => Promise<IpcResponse<Record<ModelTier, RankedModelCandidate[]>>>;
  getAvailableModels?: () => Promise<IpcResponse<AvailableModelConfig[]>>;
  getModelAvailabilitySummary?: () => Promise<IpcResponse<ModelAvailabilitySummary>>;
  resetModelsAvailabilityCache?: () => Promise<IpcResponse<void>>;
  updateActiveModelConfig?: (config: { providerId: string; modelId: string; isAutoMode: boolean; mode: ModelLockMode }) => Promise<IpcResponse<ActiveRouteSnapshot>>;
  getCommunityKeyStatus?: () => Promise<IpcResponse<{ status: 'active' | 'degraded' | 'missing' }>>;
  onCommunityKeyStatusChanged?: (callback: (data: { status: 'active' | 'degraded' | 'missing' }) => void) => () => void;

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

  // Stream Hygiene (Prompt 2): FCC sidecar log ledger (coalesced sidecar
  // stdout/stderr lines, gated stream-salvage lines and gateway rerun
  // decisions). Read-only diagnostics surface.
  getSidecarLedger?: (limit?: number) => Promise<IpcResponse<SidecarLedgerEntry[]>>;

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
  perfGetBootHistory?: () => Promise<IpcResponse<Array<{
    bootId: string;
    at: string;
    target: 'portable' | 'installed' | 'dev';
    version: string;
    preMainImportMs: number;
    marks: Record<string, { atMs: number; deltaMs: number }>;
  }>>>;
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
  ledgerQuery?: (filter?: any) => Promise<IpcResponse<any>>;
  ledgerGetInsights?: (options?: any) => Promise<IpcResponse<any>>;
  ledgerFlush?: () => Promise<IpcResponse<void>>;
  policyGetEffective?: () => Promise<IpcResponse<any>>;
  policyAssertAllowed?: (action: any) => Promise<IpcResponse<void>>;
  policyReload?: (workspacePath?: string) => Promise<IpcResponse<any>>;

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

  /** Unified verified catalog + availability flags for the AI Providers tab. */
  getVerifiedModels?: () => Promise<IpcResponse<VerifiedModelCatalogSummary>>;
  testVerifiedApi?: (data: { modelId: string; prompt: string; apiKey?: string }) => Promise<any>;
  onVerifiedApiChunk?: (cb: (chunk: string) => void) => () => void;
  onVerifiedApiEnd?: (cb: () => void) => () => void;
  onVerifiedApiError?: (cb: (err: string) => void) => () => void;

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

  // Brave Browser Integration & Automation
  detectBraveBrowser?: () => Promise<IpcResponse<{ installed: boolean; executablePath: string | null }>>;
  installBraveBrowser?: (options?: { silent?: boolean }) => Promise<IpcResponse<{ success: boolean; installed: boolean; executablePath: string | null; error?: string }>>;
  getBraveStatus?: () => Promise<IpcResponse<{ installed: boolean; executablePath: string | null; enabled: boolean }>>;
  setBraveEnabled?: (enabled: boolean) => Promise<IpcResponse<{ enabled: boolean }>>;
  braveSearch?: (query: string) => Promise<IpcResponse<any>>;
  braveNavigate?: (url: string) => Promise<IpcResponse<{ url: string; title: string; status: number; ok: boolean }>>;
  braveGetPageContent?: () => Promise<IpcResponse<{ content: string }>>;
  braveClose?: () => Promise<IpcResponse<{ closed: boolean }>>;
  startBraveTesting?: (url: string, options?: { openVisibleWindow?: boolean }) => Promise<IpcResponse<{ active: boolean; url: string; title?: string; status?: number }>>;
  stopBraveTesting?: () => Promise<IpcResponse<{ active: boolean }>>;
  onBraveTestingUpdate?: (callback: (data: { active: boolean; url: string; title?: string; status?: number; error?: string }) => void) => () => void;
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

// ---------------------------------------------------------------------------
// M3E Canvas Live Project Editor (Prompt 4)
// ---------------------------------------------------------------------------

/** One visual edit produced by the canvas interaction surface. */
export interface CanvasEditIntent {
  intentId: string;
  kind: 'style' | 'text' | 'structural';
  /** CSS property (style), replacement text (text) or operation value (structural). */
  property: string;
  value: string;
  /** Raw CSS selector path from the preview host interaction layer. */
  targetSelector: string;
  componentName?: string;
  sourceFileHint?: string;
  /** Text content captured by the inspector for text-loop patching. */
  originalInnerText?: string;
}

/** Result payload for a batch of canvas intents (canvas:edit:apply). */
export interface CanvasEditApplyResultData {
  autoApplied: boolean;
  files: string[];
}

/** Status payload for a live preview boot attempt. */
export interface CanvasPreviewStatusPayload {
  status: {
    mode: 'dev' | 'static' | 'none';
    state: 'idle' | 'booting' | 'ready' | 'error' | 'stopped' | 'unavailable';
    url: string | null;
    error: string | null;
    adapter: string;
  };
  workspacePath: string;
}

/** Broadcast after a canvas edit is applied to disk (canvas-edit:applied). */
export interface CanvasEditAppliedPayload {
  files: string[];
  at: number;
}

/** Main-window notification that a canvas edit needs review in the Monaco gate. */
export interface CanvasPreviewProposedPayload {
  canvas: {
    selector: string;
    component: string | null;
    property: string;
  };
  preview: WorkspaceEditPreview;
}

/** Structural request routed to the canvas agent engine's DesignProfile fence. */
export interface CanvasStructuralIntentPayload {
  operation: 'add' | 'move' | 'delete';
  componentName?: string;
  targetSelector: string;
  value?: string;
  details?: string;
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

// Manual key configuration for OpenCode's premium models. Booleans only —
// plaintext keys never cross the IPC boundary back to the renderer.
export interface OpenCodeApiKeySaveResult {
  provider: string;
  vaultStored: boolean;
  configUpdated: boolean;
  configPath: string | null;
  message?: string;
}

export interface OpenCodeKeyStatus {
  provider: string;
  vaultConfigured: boolean;
  opencodeConfigured: boolean;
}

export interface OpenCodeChatPayload {
  modelId: string;
  prompt?: string;
  /** Chat history (user/assistant turns) flattened on the main-process side. */
  messages?: Array<{ role: string; content: string }>;
}

// Omni-Debugger: Multi-Engine Diagnostic & Architecture Inspector
export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AnalysisEngine = 'static' | 'dynamic' | 'arch' | 'ai';
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
  theme?: string;
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

export interface AssemblyLayer {
  id: string;
  kind: 'core' | 'profile' | 'mode' | 'role' | 'quest' | 'env';
  label: string;
  tokens: number;
  pinned: boolean;
  tier?: 'FULL' | 'COMPACT' | 'MICRO';
  scope?: 'all' | 'read-only' | 'docs-only';
  dropped: boolean;
  reason?: string;
  text?: string;
}

export interface AssemblyResult {
  taskId: string;
  timestamp?: number;
  systemPrompt: string;
  pinnedSections: string[];
  roles: string[];
  mode: string;
  taskClass: string;
  scope?: 'all' | 'read-only' | 'docs-only';
  tokenEstimate: number;
  budget: number;
  degraded: boolean;
  assemblyMs: number;
  cache: 'hit' | 'miss';
  layers: AssemblyLayer[];
}

export interface RolePreferences {
  version: 1;
  updatedAt?: string;
  defaultMode: 'BUILD' | 'REVIEW' | 'EXPLAIN' | 'DESIGN' | 'SHIP';
  roleOverrides?: {
    pin: string[];
    ban: string[];
    prefer?: Record<string, number>;
  };
  scopeOverrides?: Record<string, 'all' | 'read-only' | 'docs-only'>;
  questGate?: {
    autoApproveMedium: boolean;
    requireApprovalFrom: 'Trivial' | 'Small' | 'Medium' | 'Large' | 'Epic';
  };
  tokenBudget?: {
    systemPromptFraction: number;
    maxRoles: number;
  };
  conventions?: {
    autoExtract: boolean;
    refreshOnHeadChange: boolean;
  };
  modeBySignal?: Record<string, string>;
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


