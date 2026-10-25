import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  BootTrace,
  GapWarning,
  ImportCost,
  OffenderCategory,
  OffenderItem,
  PerfMark,
  ProviderHealthPing,
  SyncIoCall,
  TransitionMetric
} from '../../../shared/types/perf';

export interface BootHistoryEntry {
  /** Stable per-process id; persisting twice in one boot updates the same entry. */
  bootId: string;
  at: string;
  target: 'portable' | 'installed' | 'dev';
  version: string;
  /**
   * Time from this process's start to main_import. For portable builds the
   * stub's temp-extraction wait happens in the parent stub BEFORE this process
   * exists, so it can not be seen here: every timeline starts after extraction
   * and portable vs installed deltas are therefore extraction-free by design.
   */
  preMainImportMs: number;
  marks: Record<string, { atMs: number; deltaMs: number }>;
}

export class BootProfiler {
  private static instance: BootProfiler | null = null;
  private readonly processStartTime: number;
  private marks: PerfMark[] = [];
  private syncIoCalls: SyncIoCall[] = [];
  private importCosts: ImportCost[] = [];
  private healthPings: ProviderHealthPing[] = [];
  private transitions: TransitionMetric[] = [];
  private isWindowCreated = false;
  private isPreWindowPatched = false;
  private originalFsMethods: Record<string, unknown> = {};
  private originalSafeStorageMethods: Record<string, unknown> = {};

  private constructor() {
    // High-resolution process start estimate
    const uptimeMs = typeof process.uptime === 'function' ? process.uptime() * 1000 : 0;
    this.processStartTime = Date.now() - uptimeMs;

    // Immediately record process_start mark
    this.recordMark('process_start', 0, undefined, 'boot');

    // Instrument synchronous calls before window creation
    this.patchPreWindowSyncCalls();
  }

  public static getInstance(): BootProfiler {
    if (!BootProfiler.instance) {
      BootProfiler.instance = new BootProfiler();
    }
    return BootProfiler.instance;
  }

  /**
   * Elapsed milliseconds since process start.
   */
  public now(): number {
    return Math.max(0, performance.now());
  }

  /**
   * Record a lifecycle or service mark.
   */
  public recordMark(
    name: string,
    timestamp = this.now(),
    duration?: number,
    phase: 'boot' | 'transition' | 'service' = 'boot',
    category?: OffenderCategory,
    metadata?: Record<string, unknown>
  ): PerfMark {
    // Check if mark already exists with exact name (unless it's an event or service)
    const existingIndex = this.marks.findIndex((m) => m.name === name);
    const mark: PerfMark = {
      name,
      timestamp: Math.round(timestamp * 10) / 10,
      duration: duration !== undefined ? Math.round(duration * 10) / 10 : undefined,
      phase,
      category,
      metadata
    };

    if (existingIndex >= 0 && !name.startsWith('transition:') && !name.startsWith('service:')) {
      this.marks[existingIndex] = mark;
    } else {
      this.marks.push(mark);
    }

    if (name === 'window_created') {
      this.isWindowCreated = true;
      this.unpatchPreWindowSyncCalls();
    }

    return mark;
  }

  /**
   * Helper to measure execution time of a synchronous or asynchronous function block.
   */
  public async measureSpan<T>(
    markName: string,
    phase: 'boot' | 'transition' | 'service',
    category: OffenderCategory,
    fn: () => T | Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = this.now();
    try {
      const result = await fn();
      const duration = this.now() - start;
      this.recordMark(markName, start, duration, phase, category, metadata);
      return result;
    } catch (err) {
      const duration = this.now() - start;
      this.recordMark(markName, start, duration, phase, category, { ...metadata, error: String(err) });
      throw err;
    }
  }

  /**
   * Record ready mark for an internal service.
   */
  public recordServiceReady(serviceName: string, durationMs?: number, metadata?: Record<string, unknown>): void {
    const timestamp = this.now();
    const duration = durationMs !== undefined ? durationMs : undefined;
    this.recordMark(serviceName, timestamp, duration, 'service', 'process_spawn', metadata);
  }

  /**
   * Record renderer bundle parse/import cost.
   */
  public recordImportCost(moduleName: string, durationMs: number): void {
    const timestamp = this.now();
    this.importCosts.push({
      module: moduleName,
      durationMs: Math.round(durationMs * 10) / 10,
      timestamp: Math.round(timestamp * 10) / 10
    });
    this.recordMark(`import:${moduleName}`, timestamp, durationMs, 'boot', 'eager_import');
  }

  /**
   * Record time-to-first-response for a provider health ping at boot.
   */
  public recordHealthPing(provider: string, durationMs: number, status: string): void {
    const timestamp = this.now();
    this.healthPings.push({
      provider,
      durationMs: Math.round(durationMs * 10) / 10,
      status,
      timestamp: Math.round(timestamp * 10) / 10
    });
    this.recordMark(
      `health_ping:${provider}`,
      timestamp,
      durationMs,
      'service',
      'network_wait',
      { status }
    );
  }

  /**
   * Record a UI transition metric (from user click to paint).
   */
  public recordTransition(metric: TransitionMetric): void {
    this.transitions.push(metric);
    this.recordMark(
      metric.name,
      metric.startTime,
      metric.durationMs,
      'transition',
      metric.longTasks.length > 0 ? 'render_storm' : undefined,
      {
        longTasksCount: metric.longTasks.length,
        ipcRoundTrips: metric.ipcRoundTrips,
        reactRenders: metric.reactRenders
      }
    );
  }

  /**
   * Injects a deliberate synchronous delay (busy-wait) to validate top offender detection.
   */
  public injectSyncDelay(durationMs: number, label = 'injected_sync_sleep'): void {
    const start = this.now();
    const targetEnd = start + durationMs;
    // Real busy wait to simulate blocking synchronous work
    while (this.now() < targetEnd) {
      // Busy wait
    }
    const elapsed = this.now() - start;
    this.syncIoCalls.push({
      operation: 'sync_sleep',
      target: label,
      durationMs: Math.round(elapsed * 10) / 10,
      timestamp: Math.round(start * 10) / 10
    });
    this.recordMark(label, start, elapsed, 'boot', 'sync_io', { injected: true });
  }

  /**
   * Patch synchronous fs and safeStorage calls that occur before the window is created.
   */
  private patchPreWindowSyncCalls(): void {
    if (this.isPreWindowPatched) return;
    this.isPreWindowPatched = true;

    const fsMethodsToWrap: Array<keyof typeof fs> = [
      'readFileSync',
      'writeFileSync',
      'statSync',
      'existsSync',
      'readdirSync',
      'mkdirSync'
    ];

    for (const method of fsMethodsToWrap) {
      const original = fs[method];
      if (typeof original === 'function') {
        this.originalFsMethods[method] = original;
        (fs as any)[method] = (...args: any[]) => {
          if (this.isWindowCreated) {
            return (original as any).apply(fs, args);
          }
          const start = this.now();
          try {
            return (original as any).apply(fs, args);
          } finally {
            const elapsed = this.now() - start;
            const target = typeof args[0] === 'string' ? path.basename(args[0]) : undefined;
            this.syncIoCalls.push({
              operation: `fs.${String(method)}`,
              target,
              durationMs: Math.round(elapsed * 10) / 10,
              timestamp: Math.round(start * 10) / 10
            });
            if (elapsed >= 5) {
              this.recordMark(
                `sync_io:fs.${String(method)}:${target || 'unknown'}`,
                start,
                elapsed,
                'boot',
                'sync_io'
              );
            }
          }
        };
      }
    }

    // Wrap safeStorage if available
    try {
      if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function') {
        const origEncAvail = safeStorage.isEncryptionAvailable;
        this.originalSafeStorageMethods['isEncryptionAvailable'] = origEncAvail;
        safeStorage.isEncryptionAvailable = () => {
          if (this.isWindowCreated) return origEncAvail.call(safeStorage);
          const start = this.now();
          try {
            return origEncAvail.call(safeStorage);
          } finally {
            const elapsed = this.now() - start;
            this.syncIoCalls.push({
              operation: 'safeStorage.isEncryptionAvailable',
              durationMs: Math.round(elapsed * 10) / 10,
              timestamp: Math.round(start * 10) / 10
            });
          }
        };
      }
    } catch {
      // SafeStorage wrapping is optional in test environments
    }
  }

  /**
   * Restore original methods after window creation.
   */
  private unpatchPreWindowSyncCalls(): void {
    for (const [method, original] of Object.entries(this.originalFsMethods)) {
      (fs as any)[method] = original;
    }
    this.originalFsMethods = {};

    for (const [method, original] of Object.entries(this.originalSafeStorageMethods)) {
      if (safeStorage) (safeStorage as any)[method] = original;
    }
    this.originalSafeStorageMethods = {};
  }

  /**
   * Analyze all captured marks for unmarked gaps exceeding thresholdMs (default 100ms).
   */
  public findGaps(thresholdMs = 100): GapWarning[] {
    const warnings: GapWarning[] = [];
    const sorted = [...this.marks].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentEnd = current.timestamp + (current.duration ?? 0);
      const gap = next.timestamp - currentEnd;

      if (gap > thresholdMs) {
        warnings.push({
          afterMark: current.name,
          beforeMark: next.name,
          gapMs: Math.round(gap * 10) / 10
        });
      }
    }

    return warnings;
  }

  /**
   * Calculate and rank the Top 10 Offenders across boot and transitions.
   */
  public getTopOffenders(limit = 10): OffenderItem[] {
    const candidates: OffenderItem[] = [];

    // 1. Significant marks with duration
    for (const mark of this.marks) {
      if (mark.duration !== undefined && mark.duration > 0) {
        candidates.push({
          item: mark.name,
          ms: mark.duration,
          phase: mark.phase || 'boot',
          category: mark.category || (mark.name.startsWith('sync_io') ? 'sync_io' : 'process_spawn'),
          details: mark.metadata ? JSON.stringify(mark.metadata) : undefined
        });
      }
    }

    // 2. Sync IO calls before window creation (include calls > 2ms)
    for (const call of this.syncIoCalls) {
      if (call.durationMs >= 2) {
        candidates.push({
          item: `${call.operation} (${call.target || 'pre-window'})`,
          ms: call.durationMs,
          phase: 'boot',
          category: 'sync_io',
          details: `Synchronous call before window created at ${call.timestamp}ms`
        });
      }
    }

    // 3. Renderer Import Costs
    for (const imp of this.importCosts) {
      candidates.push({
        item: `import:${imp.module}`,
        ms: imp.durationMs,
        phase: 'boot',
        category: 'eager_import',
        details: `Top-level bundle parse cost in renderer`
      });
    }

    // 4. Provider Health Pings
    for (const ping of this.healthPings) {
      candidates.push({
        item: `health_ping:${ping.provider}`,
        ms: ping.durationMs,
        phase: 'service',
        category: 'network_wait',
        details: `Status: ${ping.status}`
      });
    }

    // 5. Transitions
    for (const trans of this.transitions) {
      candidates.push({
        item: `transition:${trans.name}`,
        ms: trans.durationMs,
        phase: 'transition',
        category: trans.longTasks.length > 0 ? 'render_storm' : 'layout_thrash',
        details: `IPC: ${trans.ipcRoundTrips}, Renders: ${trans.reactRenders}, LongTasks: ${trans.longTasks.length}`
      });
    }

    // Deduplicate candidates with identical item name by picking highest duration
    const dedupedMap = new Map<string, OffenderItem>();
    for (const cand of candidates) {
      const existing = dedupedMap.get(cand.item);
      if (!existing || cand.ms > existing.ms) {
        dedupedMap.set(cand.item, cand);
      }
    }

    // Sort descending by ms
    return Array.from(dedupedMap.values())
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit);
  }

  /**
   * Generates a complete BootTrace snapshot.
   */
  public getTrace(): BootTrace {
    const sortedMarks = [...this.marks].sort((a, b) => a.timestamp - b.timestamp);
    const lastMark = sortedMarks[sortedMarks.length - 1];
    const totalBootMs = lastMark
      ? Math.round((lastMark.timestamp + (lastMark.duration || 0)) * 10) / 10
      : Math.round(this.now() * 10) / 10;

    return {
      timestamp: new Date().toISOString(),
      processStartTime: this.processStartTime,
      marks: sortedMarks,
      syncIoCalls: [...this.syncIoCalls],
      importCosts: [...this.importCosts],
      healthPings: [...this.healthPings],
      transitions: [...this.transitions],
      topOffenders: this.getTopOffenders(10),
      totalBootMs,
      gapWarnings: this.findGaps(100)
    };
  }

  public hasMark(name: string): boolean {
    return this.marks.some((m) => m.name === name);
  }

  /**
   * portable: PORTABLE_EXECUTABLE_DIR is set by electron-builder's portable stub.
   * dev: unpackaged. installed: packaged without the portable variable (NSIS).
   */
  public getDistributionTarget(): 'portable' | 'installed' | 'dev' {
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
    if (!app?.isPackaged) return 'dev';
    return 'installed';
  }

  private historyPath(): string | null {
    try {
      return path.join(app.getPath('userData'), 'boot-history.json');
    } catch {
      return null;
    }
  }

  public getBootHistory(): BootHistoryEntry[] {
    const file = this.historyPath();
    if (!file) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as BootHistoryEntry[];
      return Array.isArray(parsed) ? parsed.slice(-5) : [];
    } catch {
      return [];
    }
  }

  /**
   * Appends this boot to the local boot-history file (last 5 kept). Local-only:
   * no network, no telemetry. Per-mark durations are deltas from the previous
   * mark, so portable vs installed regressions compare directly (see
   * BootHistoryEntry.preMainImportMs for what is and is not measurable).
   */
  public persistBootHistory(): void {
    const file = this.historyPath();
    if (!file) return;
    try {
      const wanted = ['main_import', 'app_ready', 'window_created', 'ready_to_show', 'renderer_first_paint', 'deferred_tasks_start', 'update_check_start'];
      const byName = new Map(this.marks.map((m) => [m.name, m.timestamp]));
      const marks: Record<string, { atMs: number; deltaMs: number }> = {};
      let prev = byName.get('main_import') ?? 0;
      for (const name of wanted) {
        const at = byName.get(name);
        if (at === undefined) continue;
        marks[name] = { atMs: at, deltaMs: Math.round((at - prev) * 10) / 10 };
        prev = at;
      }
      const mainImportAt = byName.get('main_import') ?? 0;
      const target = this.getDistributionTarget();
      const entry: BootHistoryEntry = {
        bootId: String(this.processStartTime),
        at: new Date().toISOString(),
        target,
        version: app?.getVersion ? app.getVersion() : 'unknown',
        preMainImportMs: Math.round(mainImportAt * 10) / 10,
        marks
      };
      const history = [...this.getBootHistory().filter((h) => h.bootId !== entry.bootId), entry].slice(-5);
      fs.writeFileSync(file, JSON.stringify(history, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[BootProfiler] Failed to persist boot history:', err);
    }
  }

  /**
   * Persists the boot trace to docs/perf/boot-trace.json (cold start, dev mode only).
   */
  public async persistBootTrace(projectRoot?: string): Promise<string | null> {
    const isDev = process.env.NODE_ENV !== 'production' && (!app?.isPackaged);
    if (!isDev && process.env.TY_CODE_FORCE_PERF_TRACE !== '1') {
      return null;
    }

    try {
      const root = projectRoot || path.resolve(__dirname, '../../../');
      const perfDir = path.join(root, 'docs', 'perf');
      await fs.promises.mkdir(perfDir, { recursive: true });

      const tracePath = path.join(perfDir, 'boot-trace.json');
      const trace = this.getTrace();
      await fs.promises.writeFile(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
      return tracePath;
    } catch (err) {
      console.warn('[BootProfiler] Failed to write docs/perf/boot-trace.json:', err);
      return null;
    }
  }
}

export const bootProfiler = BootProfiler.getInstance();
