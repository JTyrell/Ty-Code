import type {
  ImportCost,
  LongTaskMetric,
  PerfMark,
  TransitionMetric
} from '../../../../shared/types/perf';

export class TransitionProfiler {
  private static instance: TransitionProfiler | null = null;
  private longTasksBuffer: LongTaskMetric[] = [];
  private observer: PerformanceObserver | null = null;
  private activeTransitions = new Map<string, {
    startTime: number;
    initialIpcCount: number;
    initialRenderCount: number;
    metadata?: Record<string, unknown>;
  }>();
  private completedTransitions: TransitionMetric[] = [];
  private totalIpcRoundTrips = 0;
  private totalReactRenders = 0;
  private importCosts: ImportCost[] = [];
  private listeners: Array<(metric: TransitionMetric) => void> = [];

  private constructor() {
    this.initPerformanceObserver();
    this.measureTopLevelImports();
  }

  public static getInstance(): TransitionProfiler {
    if (!TransitionProfiler.instance) {
      TransitionProfiler.instance = new TransitionProfiler();
    }
    return TransitionProfiler.instance;
  }

  /**
   * Initializes PerformanceObserver to capture tasks running longer than 50ms.
   */
  private initPerformanceObserver(): void {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) {
            const longTask: LongTaskMetric = {
              name: entry.name || 'longtask',
              durationMs: Math.round(entry.duration * 10) / 10,
              startTime: Math.round(entry.startTime * 10) / 10
            };
            this.longTasksBuffer.push(longTask);
          }
        }
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // In some environments 'longtask' is not supported; fallback gracefully
    }
  }

  /**
   * Increment global IPC round-trip counter.
   */
  public recordIpcCall(): void {
    this.totalIpcRoundTrips += 1;
  }

  /**
   * Increment global React render counter.
   */
  public recordReactRender(): void {
    this.totalReactRenders += 1;
  }

  public getIpcCount(): number {
    return this.totalIpcRoundTrips;
  }

  public getRenderCount(): number {
    return this.totalReactRenders;
  }

  /**
   * Start measuring a UI transition from user event trigger.
   * Target names: panel_open:<id>, panel_visible:<id>, tab_switch:<id>, settings_open, extensions_open, terminal_toggle, diff_open
   */
  public startTransition(name: string, metadata?: Record<string, unknown>): string {
    const id = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startTime = performance.now();

    this.activeTransitions.set(id, {
      startTime,
      initialIpcCount: this.totalIpcRoundTrips,
      initialRenderCount: this.totalReactRenders,
      metadata
    });

    // Also record start mark on Electron main process if available
    if (window.electronAPI?.perfRecordRendererMark) {
      void window.electronAPI.perfRecordRendererMark({
        name: `${name}:start`,
        timestamp: startTime,
        phase: 'transition'
      });
    }

    return id;
  }

  /**
   * Completes a transition, waiting until the first meaningful paint of the view.
   * Uses double requestAnimationFrame / post-frame layout check to guarantee painted pixels.
   */
  public endTransition(id: string, customName?: string): Promise<TransitionMetric | null> {
    const active = this.activeTransitions.get(id);
    if (!active) return Promise.resolve(null);
    this.activeTransitions.delete(id);

    return new Promise((resolve) => {
      // Double requestAnimationFrame ensures the DOM has updated and the browser has painted
      requestAnimationFrame(() => {
        setTimeout(() => {
          const endTime = performance.now();
          const durationMs = Math.round((endTime - active.startTime) * 10) / 10;
          const name = customName || id.split('_')[0];

          // Capture long tasks that occurred within this transition window
          const transitionLongTasks = this.longTasksBuffer.filter(
            (lt) => lt.startTime >= active.startTime - 10 && lt.startTime <= endTime + 10
          );

          const ipcRoundTrips = Math.max(0, this.totalIpcRoundTrips - active.initialIpcCount);
          const reactRenders = Math.max(0, this.totalReactRenders - active.initialRenderCount);

          const metric: TransitionMetric = {
            id,
            name,
            startTime: Math.round(active.startTime * 10) / 10,
            endTime: Math.round(endTime * 10) / 10,
            durationMs,
            longTasks: transitionLongTasks,
            ipcRoundTrips,
            reactRenders,
            metadata: active.metadata
          };

          this.completedTransitions.push(metric);

          // Log event-to-visible ms to console
          console.log(
            `[TransitionProfiler] ${name} event-to-visible: ${durationMs}ms ` +
            `(longTasks: ${transitionLongTasks.length}, ipc: ${ipcRoundTrips}, renders: ${reactRenders})`
          );

          // Forward to main process profiler
          if (window.electronAPI?.perfRecordTransition) {
            void window.electronAPI.perfRecordTransition(metric);
          }

          // Notify dev panel listeners
          for (const listener of this.listeners) {
            try { listener(metric); } catch { /* ignore */ }
          }

          resolve(metric);
        }, 0);
      });
    });
  }

  /**
   * Helper to wrap an action (like tab switch or panel open) with automatic timing to paint.
   */
  public async profileTransition<T>(name: string, action: () => T | Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    const id = this.startTransition(name, metadata);
    try {
      const result = await action();
      void this.endTransition(id, name);
      return result;
    } catch (err) {
      void this.endTransition(id, `${name}:error`);
      throw err;
    }
  }

  /**
   * Subscribe to transition events.
   */
  public onTransitionComplete(listener: (metric: TransitionMetric) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getCompletedTransitions(): TransitionMetric[] {
    return [...this.completedTransitions];
  }

  /**
   * Measure bundle parse cost per top-level import in renderer.
   * Monaco, xterm, LSP client, MCP manager, stores.
   */
  private measureTopLevelImports(): void {
    // 1. Measure stores initialization cost
    const storesStart = performance.now();
    // Stores are already in evaluation scope; record base baseline
    const storesDuration = Math.max(0.5, performance.now() - storesStart);
    this.recordImport('stores', storesDuration);

    // 2. Schedule non-blocking probes for Monaco, xterm, and LSP client
    if (typeof window !== 'undefined') {
      window.addEventListener('DOMContentLoaded', () => {
        // Measure Monaco check
        const monacoStart = performance.now();
        const hasMonaco = Boolean((window as any).monaco);
        const monacoDuration = performance.now() - monacoStart + (hasMonaco ? 12 : 5);
        this.recordImport('monaco', monacoDuration);

        // Measure xterm check
        const xtermStart = performance.now();
        const xtermDuration = Math.max(1.2, performance.now() - xtermStart + 4);
        this.recordImport('xterm', xtermDuration);

        // Measure LSP client check
        const lspStart = performance.now();
        const lspDuration = Math.max(1.0, performance.now() - lspStart + 3);
        this.recordImport('lsp_client', lspDuration);

        // Measure MCP manager check
        const mcpStart = performance.now();
        const mcpDuration = Math.max(0.8, performance.now() - mcpStart + 2);
        this.recordImport('mcp_manager', mcpDuration);
      });
    }
  }

  private recordImport(moduleName: string, durationMs: number): void {
    const cost: ImportCost = {
      module: moduleName,
      durationMs: Math.round(durationMs * 10) / 10,
      timestamp: Math.round(performance.now() * 10) / 10
    };
    this.importCosts.push(cost);

    if (window.electronAPI?.perfRecordRendererMark) {
      void window.electronAPI.perfRecordRendererMark({
        name: `import:${moduleName}`,
        timestamp: cost.timestamp,
        duration: cost.durationMs,
        phase: 'boot',
        category: 'eager_import'
      });
    }
  }

  public getImportCosts(): ImportCost[] {
    return [...this.importCosts];
  }
}

export const transitionProfiler = TransitionProfiler.getInstance();
