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
