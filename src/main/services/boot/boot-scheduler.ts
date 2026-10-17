import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { bootProfiler } from '../perf/boot-profiler';

export type BootTier = 0 | 1 | 2 | 3;

export type BootTaskCategory =
  | 'frame'
  | 'settings'
  | 'fs'
  | 'stores'
  | 'editor'
  | 'providers'
  | 'fcc'
  | 'health_pings'
  | 'git'
  | 'search'
  | 'extensions'
  | 'mcp'
  | 'lsp'
  | 'terminal'
  | 'marketplace'
  | 'analytics'
  | 'update'
  | 'custom';

export interface BootTask {
  id: string;
  name: string;
  tier: BootTier;
  category: BootTaskCategory;
  run: () => Promise<void> | void;
  promoted?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'promoted';
  startTime?: number;
  durationMs?: number;
  error?: string;
}

export interface WarmBootCache {
  version: string;
  updatedAt: string;
  providers?: unknown;
  searchIndex?: unknown;
  fsIndexSummary?: { path: string; fileCount: number; timestamp: number };
  lastSession?: { activeTab?: string; openTabs?: string[]; workspacePath?: string };
}

export interface BootSchedulerState {
  currentTier: BootTier;
  tierStatus: Record<BootTier, 'pending' | 'running' | 'completed'>;
  completedTasksCount: number;
  totalTasksCount: number;
  tasks: Array<Omit<BootTask, 'run'>>;
  isWarmedUp: boolean;
}

export class BootScheduler {
  private static instance: BootScheduler | null = null;
  private tasks: Map<string, BootTask> = new Map();
  private tierStatus: Record<BootTier, 'pending' | 'running' | 'completed'> = {
    0: 'pending',
    1: 'pending',
    2: 'pending',
    3: 'pending'
  };
  private currentTier: BootTier = 0;
  private isWarmedUp = false;
  private warmCache: WarmBootCache | null = null;
  private cachePath: string;
  private listeners: Array<(state: BootSchedulerState) => void> = [];
  private tier3Timer: NodeJS.Timeout | null = null;
  private lastHealthPingTime = 0;
  private readonly healthPingStaggerMs = 200; // Stagger health pings 200ms apart
  private hasUserInteracted = false;

  private constructor() {
    const userData = app?.getPath ? app.getPath('userData') : process.cwd();
    this.cachePath = path.join(userData, 'cache', 'warm-boot-cache.json');
    this.loadWarmCache();
  }

  public static getInstance(): BootScheduler {
    if (!BootScheduler.instance) {
      BootScheduler.instance = new BootScheduler();
    }
    return BootScheduler.instance;
  }

  /**
   * Register a task in the boot scheduler.
   */
  public register(
    id: string,
    name: string,
    tier: BootTier,
    category: BootTaskCategory,
    run: () => Promise<void> | void
  ): void {
    const task: BootTask = {
      id,
      name,
      tier,
      category,
      run,
      status: 'pending'
    };
    this.tasks.set(id, task);
  }

  /**
   * Register IPC handlers for renderer communication.
   */
  public registerIpcHandlers(): void {
    ipcMain.handle('boot-scheduler:get-state', async () => {
      return { success: true, data: this.getState() };
    });
    ipcMain.handle('boot-scheduler:promote', async (_event, idOrCategory: string) => {
      const result = await this.promote(idOrCategory);
      return { success: true, data: result };
    });
    ipcMain.handle('boot-scheduler:notify-interaction', async () => {
      this.notifyUserInteraction();
      return { success: true };
    });
  }

  /**
   * Promote a task or category to the front of the queue immediately
   * (e.g. when user opens Extensions panel or starts Terminal).
   */
  public async promote(idOrCategory: string): Promise<boolean> {
    for (const task of this.tasks.values()) {
      if (task.id === idOrCategory || task.category === idOrCategory) {
        if (task.status === 'completed' || task.status === 'running') {
          return true;
        }
        task.promoted = true;
        task.status = 'promoted';
        this.notifyProgress();
        // Execute promoted task immediately
        await this.runTask(task);
        return true;
      }
    }
    return false;
  }

  /**
   * Notifies scheduler that user has interacted with the UI, which can trigger Tier 3.
   */
  public notifyUserInteraction(): void {
    if (this.hasUserInteracted) return;
    this.hasUserInteracted = true;
    if (this.tierStatus[3] === 'pending') {
      if (this.tier3Timer) {
        clearTimeout(this.tier3Timer);
        this.tier3Timer = null;
      }
      void this.executeTier3();
    }
  }

  /**
   * Start executing boot sequence according to tiers.
   */
  public async startBoot(): Promise<void> {
    // 1. Tier 0: Critical layout & window frame (immediate, synchronous/instant)
    await this.executeTier0();

    // 2. Tier 1: Shell interactive (<300ms)
    await this.executeTier1();

    // 3. Tier 2: First idle (0.5s to 2s window) with concurrency cap of 3
    setTimeout(() => {
      void this.executeTier2();
    }, 500);

    // 4. Tier 3: Background services after 2s or first interaction
    this.tier3Timer = setTimeout(() => {
      if (this.tierStatus[3] === 'pending') {
        void this.executeTier3();
      }
    }, 2000);
  }

  private async executeTier0(): Promise<void> {
    this.currentTier = 0;
    this.tierStatus[0] = 'running';
    bootProfiler.recordMark('tier_0:started', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();

    const tier0Tasks = Array.from(this.tasks.values()).filter((t) => t.tier === 0);
    for (const task of tier0Tasks) {
      await this.runTask(task);
    }

    this.tierStatus[0] = 'completed';
    bootProfiler.recordMark('tier_0:completed', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();
  }

  private async executeTier1(): Promise<void> {
    this.currentTier = 1;
    this.tierStatus[1] = 'running';
    bootProfiler.recordMark('tier_1:started', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();

    const tier1Tasks = Array.from(this.tasks.values()).filter((t) => t.tier === 1);
    // Concurrency cap 3 for Tier 1
    await this.runConcurrentWithLimit(tier1Tasks, 3);

    this.tierStatus[1] = 'completed';
    bootProfiler.recordMark('tier_1:completed', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();
  }

  private async executeTier2(): Promise<void> {
    this.currentTier = 2;
    this.tierStatus[2] = 'running';
    bootProfiler.recordMark('tier_2:started', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();

    const tier2Tasks = Array.from(this.tasks.values()).filter((t) => t.tier === 2);
    // Concurrency cap 3 for Tier 2, with health ping stagger
    await this.runConcurrentWithLimit(tier2Tasks, 3, (task) => {
      if (task.category === 'health_pings') {
        const now = Date.now();
        const diff = now - this.lastHealthPingTime;
        if (diff < this.healthPingStaggerMs) {
          const waitMs = this.healthPingStaggerMs - diff;
          this.lastHealthPingTime = now + waitMs;
          return new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        this.lastHealthPingTime = now;
      }
      return Promise.resolve();
    });

    this.tierStatus[2] = 'completed';
    bootProfiler.recordMark('tier_2:completed', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();
  }

  private async executeTier3(): Promise<void> {
    if (this.tierStatus[3] === 'completed' || this.tierStatus[3] === 'running') return;
    this.currentTier = 3;
    this.tierStatus[3] = 'running';
    bootProfiler.recordMark('tier_3:started', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();

    const tier3Tasks = Array.from(this.tasks.values()).filter(
      (t) => t.tier === 3 && t.status !== 'completed'
    );
    // Concurrency cap 2 for background Tier 3 tasks to keep UI 60fps
    await this.runConcurrentWithLimit(tier3Tasks, 2);

    this.tierStatus[3] = 'completed';
    this.isWarmedUp = true;
    bootProfiler.recordMark('tier_3:completed', bootProfiler.now(), undefined, 'boot');
    bootProfiler.recordMark('services_ready', bootProfiler.now(), undefined, 'boot');
    this.notifyProgress();

    // Persist final warm cache & boot trace
    void this.persistWarmCache();
    void bootProfiler.persistBootTrace();
  }

  private async runTask(task: BootTask): Promise<void> {
    if (task.status === 'completed') return;
    task.status = 'running';
    task.startTime = bootProfiler.now();
    const start = performance.now();

    try {
      await task.run();
      task.status = 'completed';
      task.durationMs = Math.round((performance.now() - start) * 10) / 10;
      bootProfiler.recordMark(
        `task:${task.id}`,
        task.startTime,
        task.durationMs,
        'boot',
        task.tier >= 2 ? 'process_spawn' : undefined,
        { tier: task.tier, category: task.category }
      );
      bootProfiler.recordServiceReady(task.id);
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      task.durationMs = Math.round((performance.now() - start) * 10) / 10;
      console.warn(`[BootScheduler] Task ${task.id} failed:`, task.error);
    } finally {
      this.notifyProgress();
    }
  }

  private async runConcurrentWithLimit(
    tasks: BootTask[],
    limit: number,
    beforeTask?: (task: BootTask) => Promise<void>
  ): Promise<void> {
    const queue = [...tasks];
    const executing: Array<Promise<void>> = [];

    while (queue.length > 0 || executing.length > 0) {
      while (queue.length > 0 && executing.length < limit) {
        const nextTask = queue.shift()!;
        const promise = (async () => {
          if (beforeTask) await beforeTask(nextTask);
          await this.runTask(nextTask);
        })().finally(() => {
          const index = executing.indexOf(promise);
          if (index >= 0) executing.splice(index, 1);
        });
        executing.push(promise);
      }
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }
  }

  /**
   * Helper utility to chunk a large array yielding every N entries to keep main thread unblocked.
   */
  public static async chunkedYield<T>(
    items: T[],
    chunkSize = 200,
    fn: (chunk: T[], startIndex: number) => Promise<void> | void
  ): Promise<void> {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await fn(chunk, i);
      // Yield to event loop
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Warm Cache Persistence (Provider model lists, search index, fs index).
   */
  public getWarmCache<T = unknown>(key: keyof WarmBootCache): T | undefined {
    return this.warmCache ? (this.warmCache[key] as T) : undefined;
  }

  public setWarmCache<T = unknown>(key: keyof WarmBootCache, data: T): void {
    if (!this.warmCache) {
      this.warmCache = {
        version: '1.0.0',
        updatedAt: new Date().toISOString()
      };
    }
    (this.warmCache as any)[key] = data;
    this.warmCache.updatedAt = new Date().toISOString();
  }

  private loadWarmCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf-8');
        this.warmCache = JSON.parse(raw);
      }
    } catch {
      this.warmCache = null;
    }
  }

  public async persistWarmCache(): Promise<void> {
    if (!this.warmCache) return;
    try {
      await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.promises.writeFile(
        this.cachePath,
        JSON.stringify(this.warmCache, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.warn('[BootScheduler] Could not write warm boot cache:', err);
    }
  }

  public getState(): BootSchedulerState {
    const all = Array.from(this.tasks.values());
    const completed = all.filter((t) => t.status === 'completed').length;
    return {
      currentTier: this.currentTier,
      tierStatus: { ...this.tierStatus },
      completedTasksCount: completed,
      totalTasksCount: all.length,
      tasks: all.map(({ run, ...rest }) => rest),
      isWarmedUp: this.isWarmedUp
    };
  }

  public onProgress(listener: (state: BootSchedulerState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyProgress(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try { listener(state); } catch { /* ignore */ }
    }
    // Broadcast to renderer via WebContents
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('boot-scheduler:progress', state);
      }
    }
  }
}

export const bootScheduler = BootScheduler.getInstance();
