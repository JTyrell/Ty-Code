/**
 * Diagnostics & Error Taxonomy Types (Phase Diagnostics 1)
 *
 * Types for the in-app provider connection diagnostic harness,
 * fixed error taxonomy, test sequences, and markdown reports.
 *
 * Brand: Ty-Code
 */

export type DiagnosticErrorCode =
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'MODEL_UNAVAILABLE'
  | 'NETWORK_BLOCKED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'FORMAT_MISMATCH'
  | 'TIMEOUT'
  | 'PROVIDER_DOWN'
  | 'IPC_UNREGISTERED'
  | 'MOCK_PATH_DETECTED';

export type DiagnosticStep =
  | 'reachability'
  | 'auth'
  | 'streaming'
  | 'tool_call'
  | 'latency';

export type DiagnosticStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface StepResult {
  step: DiagnosticStep;
  status: DiagnosticStatus;
  durationMs: number;
  message?: string;
  error?: string;
}

export interface ProviderDiagnosticResult {
  providerId: string;
  providerName: string;
  authType: 'anonymous' | 'api_key' | 'api_key_optional' | 'fcc_proxy' | 'opencode_integration' | string;
  baseUrl: string;
  status: DiagnosticStatus;
  errorCode?: DiagnosticErrorCode;
  failedStep?: DiagnosticStep;
  humanMessage: string;
  remedy: string;
  actionUrl?: string;
  actionLabel?: string;
  suggestedFallback?: string;
  validFreeModels?: string[];
  retryAfterSec?: number;
  timeToFirstTokenMs?: number;
  rawEvidence?: string;
  steps: Record<DiagnosticStep, StepResult>;
  testedModel?: string;
}

export interface DiagnosticRunSummary {
  timestamp: number;
  totalTested: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  zeroKeyOperational: boolean;
  results: ProviderDiagnosticResult[];
}

// Phase Diagnostics 2: End-to-End Capability Test Suite Types
export type CapabilityScenarioId = 'answer' | 'write' | 'edit' | 'tools' | 'reasoning';

export interface ScenarioEvidence {
  providerId: string;
  modelId: string;
  taxonomyCode?: DiagnosticErrorCode;
  rawResponseBytes?: string;
  failedStep?: string;
  errorMessage?: string;
  toolCallName?: string;
  toolCallArgs?: Record<string, unknown>;
  diffPreview?: {
    filePath?: string;
    originalContent?: string;
    proposedContent?: string;
  };
}

export interface ScenarioResult {
  id: CapabilityScenarioId;
  title: string;
  prompt: string;
  passCriteria: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  durationMs: number;
  initialProvider?: string;
  fallbackProvider?: string;
  passedProvider?: string;
  toolUsed?: string;
  diffShown?: boolean;
  fileVerified?: boolean;
  output?: string;
  evidence?: ScenarioEvidence;
}

export interface CapabilitySuiteSummary {
  timestamp: number;
  totalScenarios: number;
  passedCount: number;
  failedCount: number;
  activeProvider: string;
  activeModel: string;
  fallbackEngaged: boolean;
  fallbackProvider?: string;
  scratchWorkspacePath?: string;
  scratchCleanedUp: boolean;
  scenarios: ScenarioResult[];
  reportPath: string;
  markdownReport?: string;
}

// Phase Diagnostics 3: Remediation Report Types
export type RemediationCategory = 'config' | 'code' | 'network' | 'outage';

export interface WorkingNowItem {
  providerId: string;
  providerName: string;
  modelId: string;
  authType: string;
  latencyMs?: number;
  readyImmediately: boolean;
  notes?: string;
}

export interface MissingFromYouItem {
  id: string;
  providerId: string;
  providerName: string;
  code: DiagnosticErrorCode;
  issue: string;
  actionText: string;
  actionUrl?: string;
  actionType: 'open_url' | 'open_settings' | 'switch_provider';
  settingTab?: string;
  oneClickPayload?: Record<string, unknown>;
  aiCoderPrompt?: string;
}

export interface MissingFromCodeItem {
  id: string;
  providerId: string;
  providerName: string;
  code: DiagnosticErrorCode;
  issue: string;
  targetFile: string;
  targetLine?: number;
  fixDescription: string;
  evidenceChunk?: string;
  aiCoderPrompt: string;
}

export interface ExternalOutageItem {
  id: string;
  providerId: string;
  providerName: string;
  code: DiagnosticErrorCode;
  statusUrl?: string;
  retryAfterSec?: number;
  nextRetrySchedule?: string;
  suggestedFallback: string;
  details: string;
  aiCoderPrompt?: string;
}

export interface RecommendedAction {
  title: string;
  description: string;
  category: RemediationCategory;
  actionType: 'open_url' | 'open_settings' | 'copy_prompt' | 'use_provider' | 'switch_provider';
  actionLabel: string;
  actionTarget?: string;
}

export interface RemediationReport {
  timestamp: number;
  hasFailures: boolean;
  workingNow: WorkingNowItem[];
  missingFromYou: MissingFromYouItem[];
  missingFromCode: MissingFromCodeItem[];
  externalOutage: ExternalOutageItem[];
  recommendedNextAction: RecommendedAction;
  aiCoderHandoffPrompt: string;
  markdownReport: string;
  workingPathExplanation?: string;
}

// Phase Diagnostics 4: Manual Smoke-Test Message Script Types & Constants
export interface SmokeTestStep {
  id: string;
  stepNumber: number;
  send: string;
  expect: string;
  timeEstimateSec: number;
  category: 'streaming' | 'write' | 'edit' | 'tools' | 'terminal' | 'reasoning';
}

export const SMOKE_TEST_STEPS: SmokeTestStep[] = [
  {
    id: 'smoke-1-online',
    stepNumber: 1,
    send: 'Reply with exactly: TY-CODE ONLINE',
    expect: 'Exact phrase streams back; status bar shows provider + model',
    timeEstimateSec: 10,
    category: 'streaming'
  },
  {
    id: 'smoke-2-write',
    stepNumber: 2,
    send: 'Create a file named smoke.md containing the line: hello from free AI',
    expect: 'write_file tool card; diff preview; file appears in explorer after Apply',
    timeEstimateSec: 20,
    category: 'write'
  },
  {
    id: 'smoke-3-edit',
    stepNumber: 3,
    send: "In smoke.md replace 'free AI' with 'Ty-Code'",
    expect: 'replace_file_content tool card; surgical diff (one line), not full rewrite',
    timeEstimateSec: 20,
    category: 'edit'
  },
  {
    id: 'smoke-4-tools',
    stepNumber: 4,
    send: 'List the files in this workspace',
    expect: 'list_dir card; response names smoke.md',
    timeEstimateSec: 15,
    category: 'tools'
  },
  {
    id: 'smoke-5-terminal',
    stepNumber: 5,
    send: 'Run: echo smoke-test-ok',
    expect: 'Terminal drawer shows output (respecting your Terminal policy: Ask/Proceed/Restricted)',
    timeEstimateSec: 20,
    category: 'terminal'
  },
  {
    id: 'smoke-6-reasoning',
    stepNumber: 6,
    send: 'Explain in one sentence what a hash map is',
    expect: 'Coherent one-sentence answer; reasoning view if model supports it',
    timeEstimateSec: 15,
    category: 'reasoning'
  }
];

export const SMOKE_TEST_FAILURE_PROTOCOL =
  "If any step fails: open Settings > Diagnostics, run tests, copy the 'What's Needed' block, and paste it to the AI coder verbatim.";

// Phase Diagnostics 5: Background Health Monitoring and Auto-Failover Types
export type FleetHealthState = 'all-healthy' | 'degraded' | 'no-working-provider';

export type ProviderHealthState =
  | 'HEALTHY'
  | 'RATE_LIMITED'
  | 'PROVIDER_DOWN'
  | 'COOLDOWN'
  | 'UNCONFIGURED'
  | 'UNTESTED'
  | 'UNKNOWN';

export interface ProviderHealthDetail {
  providerId: string;
  providerName: string;
  isHealthy: boolean;
  status: ProviderHealthState;
  lastPingTime?: number;
  latencyMs?: number;
  lastError?: string;
  cooldownUntil?: number;
  cooldownRemainingSec?: number;
  consecutiveFailures: number;
  testedModel?: string;
  verifiedAt?: number;
}

export interface DiagnosticsFleetHealth {
  state: FleetHealthState;
  timestamp: number;
  healthyCount: number;
  totalCount: number;
  testedCount: number;
  untestedCount: number;
  degradedCount: number;
  downCount: number;
  quietModeActive: boolean;
  batterySaver: boolean;
  meteredConnection: boolean;
  providers: Record<string, ProviderHealthDetail>;
}

export interface FailoverNoticeInfo {
  attempt: number;
  failedProvider: string;
  nextProvider?: string;
  nextModel?: string;
  error: string;
  timestamp: number;
}

// Phase Diagnostics Fix 1: End-to-End Connectivity Trace Types (H1-H10)
export type HopId =
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'H7'
  | 'H8'
  | 'H9'
  | 'H10';

export interface HopTraceRecord {
  hop: HopId;
  name: string;
  status: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED';
  timestamp: number;
  durationMs?: number;
  payloadSize?: number;
  metadata?: Record<string, unknown>;
  error?: string;
  taxonomyCode?: DiagnosticErrorCode;
}

export interface ProviderConnectivityTrace {
  providerId: string;
  providerName: string;
  modelId: string;
  authType: string;
  status: 'PASS' | 'FAIL' | 'RUNNING' | 'PENDING';
  firstFailingHop?: HopId;
  taxonomyCode?: DiagnosticErrorCode;
  errorSummary?: string;
  remedy?: string;
  hops: Record<HopId, HopTraceRecord>;
  startTime: number;
  endTime?: number;
  totalDurationMs: number;
}

export interface MockScanFinding {
  file: string;
  line: number;
  codeSnippet: string;
  category: 'mock_token' | 'mock_delay' | 'mock_provider' | 'mock_tool' | 'benign_timeout' | 'other';
  isShortCircuit: boolean;
  explanation: string;
}

export interface MockScanReport {
  scannedAt: string;
  filesScanned: number;
  pathsFound: MockScanFinding[];
  hasShortCircuits: boolean;
}

export interface FullConnectivityTraceReport {
  runId: string;
  timestamp: string;
  cannedPrompt: string;
  appVersion: string;
  platform: string;
  overallStatus: 'PASS' | 'FAIL';
  firstFailingProvider?: string;
  firstFailingHop?: HopId;
  summary: {
    totalTested: number;
    passedCount: number;
    failedCount: number;
  };
  providers: Record<string, ProviderConnectivityTrace>;
  mockScan: MockScanReport;
}


