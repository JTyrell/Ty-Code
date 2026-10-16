export type OffenderCategory =
  | 'sync_io'
  | 'eager_import'
  | 'network_wait'
  | 'process_spawn'
  | 'render_storm'
  | 'layout_thrash';

export type PerfPhase = 'boot' | 'transition' | 'service';

export interface PerfMark {
  name: string;
  timestamp: number; // ms elapsed since process_start
  duration?: number; // ms duration if this mark represents a span
  category?: OffenderCategory;
  metadata?: Record<string, unknown>;
  phase?: PerfPhase;
}

export interface SyncIoCall {
  operation: string;
  target?: string;
  durationMs: number;
  timestamp: number;
  stack?: string;
}

export interface ImportCost {
  module: string;
  durationMs: number;
  timestamp: number;
}

export interface ProviderHealthPing {
  provider: string;
  durationMs: number;
  status: string;
  timestamp: number;
}

export interface LongTaskMetric {
  name: string;
  durationMs: number;
  startTime: number;
}

export interface TransitionMetric {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  longTasks: LongTaskMetric[];
  reactRenders: number;
  ipcRoundTrips: number;
  metadata?: Record<string, unknown>;
}

export interface OffenderItem {
  item: string;
  ms: number;
  phase: string;
  category: OffenderCategory;
  details?: string;
}

export interface GapWarning {
  afterMark: string;
  beforeMark: string;
  gapMs: number;
}

export interface BootTrace {
  timestamp: string;
  processStartTime: number;
  marks: PerfMark[];
  syncIoCalls: SyncIoCall[];
  importCosts: ImportCost[];
  healthPings: ProviderHealthPing[];
  transitions: TransitionMetric[];
  topOffenders: OffenderItem[];
  totalBootMs: number;
  gapWarnings: GapWarning[];
}

// -----------------------------------------------------------------------------
// Fix 3: Open-Path Performance Trace Types
// -----------------------------------------------------------------------------

export type FolderStageId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export type FileStageId = 'F1' | 'F2' | 'F3' | 'F4';
export type OpenStageId = FolderStageId | FileStageId;

export interface OpenStageMetric {
  stage: OpenStageId;
  name: string;
  durationMs: number;
  entryCount?: number;
  payloadBytes?: number;
  bytes?: number;
  isSync?: boolean;
  metadata?: Record<string, unknown>;
}

export interface FolderOpenStages {
  S1: OpenStageMetric & { stage: 'S1'; name: 'dialog returns path' };
  S2: OpenStageMetric & { stage: 'S2'; name: 'main: recursive directory walk'; entryCount: number; isSync: boolean };
  S3: OpenStageMetric & { stage: 'S3'; name: 'main: tree structure build + JSON serialization'; payloadBytes: number };
  S4: OpenStageMetric & { stage: 'S4'; name: 'IPC transfer' };
  S5: OpenStageMetric & { stage: 'S5'; name: 'renderer: store update + first tree paint' };
  S6: OpenStageMetric & { stage: 'S6'; name: 'background: index/cache write' };
}

export interface FileOpenStages {
  F1: OpenStageMetric & { stage: 'F1'; name: 'row click' };
  F2: OpenStageMetric & { stage: 'F2'; name: 'IPC fs:read-file'; bytes: number; isSync: boolean };
  F3: OpenStageMetric & { stage: 'F3'; name: 'Monaco model creation' };
  F4: OpenStageMetric & { stage: 'F4'; name: 'tab render + editor visible' };
}

export interface FolderBenchmarkResult {
  scenario: '100-file folder' | '10k-file folder';
  entryCount: number;
  stages: FolderOpenStages;
  totalMs: number;
}

export interface FileBenchmarkResult {
  scenario: '1KB file' | '1MB file';
  sizeBytes: number;
  stages: FileOpenStages;
  totalMs: number;
}

export type OpenOffenderCategory =
  | 'SYNC_IO'
  | 'SYNC_FS_HANDLER'
  | 'HUGE_IPC_PAYLOAD'
  | 'MAIN_FS_WALK'
  | 'RENDERER_MAIN_THREAD'
  | 'RENDERER_TREE_FLATTEN'
  | 'UNVIRTUALIZED_RENDER'
  | 'SYNC_STORAGE'
  | 'SYNC_WATCHER_ATTACH'
  | 'SYNC_AUTOSAVE'
  | 'MONACO_MODEL_CREATION'
  | 'BACKGROUND_INDEX';

export interface SyncBlockerFinding {
  file: string;
  line: number;
  call: string;
  context: string;
  inOpenPath: boolean;
  suspectedCauseCategory: 'SYNC_IO' | 'SYNC_FS_HANDLER';
  impact: string;
}

export interface HugeIpcPayloadFinding {
  target: string;
  sizeBytes: number;
  thresholdBytes: number;
  shape: 'nested_json_tree' | 'monolithic_string';
  suspectedCauseCategory: 'HUGE_IPC_PAYLOAD';
  impact: string;
  recommendation: string;
}

export interface RendererMainThreadFinding {
  component: string;
  issue: string;
  suspectedCauseCategory: 'RENDERER_MAIN_THREAD' | 'UNVIRTUALIZED_RENDER' | 'SYNC_STORAGE' | 'RENDERER_TREE_FLATTEN';
  impact: string;
  recommendation: string;
}

export interface SyncWatcherOrAutoSaveFinding {
  source: string;
  event: string;
  suspectedCauseCategory: 'SYNC_WATCHER_ATTACH' | 'SYNC_AUTOSAVE';
  impact: string;
  recommendation: string;
}

export interface BlockerHuntReport {
  syncBlockers: SyncBlockerFinding[];
  hugeIpcPayloads: HugeIpcPayloadFinding[];
  rendererMainThreadWork: RendererMainThreadFinding[];
  syncWatchersAndAutoSave: SyncWatcherOrAutoSaveFinding[];
}

export interface OpenOffenderItem {
  rank: number;
  item: string;
  stage: string;
  ms: number;
  category: OpenOffenderCategory;
  fileLine?: string;
  suspectedCause: string;
  recommendation: string;
}

export interface ReproducibilityVerification {
  run1Folder10kMs: number;
  run2Folder10kMs: number;
  folderVariancePercent: number;
  run1File1MBMs: number;
  run2File1MBMs: number;
  fileVariancePercent: number;
  maxVariancePercent: number;
  thresholdPercent: number; // 15
  isReproducible: boolean;
}

export interface OpenPerfTraceReport {
  runId: string;
  timestamp: string;
  appVersion: string;
  platform: string;
  benchmarks: {
    folder100: FolderBenchmarkResult;
    folder10k: FolderBenchmarkResult;
    file1KB: FileBenchmarkResult;
    file1MB: FileBenchmarkResult;
  };
  blockerHunt: BlockerHuntReport;
  topOffenders: OpenOffenderItem[];
  reproducibility: ReproducibilityVerification;
  analysis: {
    primaryLagLocation: 'MAIN_PROCESS_FS' | 'IPC_PAYLOAD' | 'RENDERER_PAINT';
    explanation: string;
    breakdown: {
      mainProcessFsMs: number;
      ipcPayloadMs: number;
      rendererPaintMs: number;
    };
    findingsBySubsystem: {
      mainProcessFs: string;
      ipcPayload: string;
      rendererPaint: string;
    };
  };
  fix4Comparison?: {
    stageComparisons: Array<{
      stage: string;
      description: string;
      beforeMs: number;
      afterMs: number;
      deltaMs: number;
      percentImprovement: number;
    }>;
    folder10k: {
      coldMs: number;
      warmMs: number;
      speedupFactor: number;
      firstTreePaintMs: number;
      fullIndexBackgroundMs: number;
      budgetsMet: {
        folder_10k_first_tree_paint_under_1500ms: boolean;
        folder_10k_full_index_background_under_5s: boolean;
        second_open_ge_3x_faster: boolean;
        no_main_thread_block_over_50ms: boolean;
      };
    };
    file1KB: {
      coldMs: number;
      warmMs: number;
      budgetsMet: {
        warm_under_150ms: boolean;
        cold_under_400ms: boolean;
      };
    };
    file1MB: {
      progressiveMs: number;
      fullLoadMs: number;
      budgetsMet: {
        file_open_1mb_under_1200ms: boolean;
      };
    };
  };
}

