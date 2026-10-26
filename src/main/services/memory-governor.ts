/**
 * Memory Pressure Governor - The 3GB Contract
 *
 * Enforces a local memory contract for Ty-Code surfaces (editor, debugger,
 * canvas). Samples main-process RSS + renderer-reported heap every 5s into a
 * local ring buffer and derives a tier:
 *
 *   NOMINAL   (< 1.2 GB)  full features
 *   ELEVATED  (< 2.0 GB)  evict cold caches
 *   CRITICAL  (< 3.0 GB)  pause background workers, disable matrix decode
 *                           animation, switch Canvas to manual refresh,
 *                           aggressive eviction
 *   OVER      (>= 3.0 GB) shed the least-recently-active surface, never OOM
 *
 * Zero telemetry: the ring buffer and crash ledger live only on disk in
 * userData. Nothing leaves the machine.
 */

import { app, BrowserWindow, type WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type GovernorTier = 'NOMINAL' | 'ELEVATED' | 'CRITICAL' | 'OVER';
export type GovernorMode = 'FULL' | 'LITE';

const GB = 1024 * 1024 * 1024;

const NOMINAL_MAX_MB = 1.2 * 1024;
const ELEVATED_MAX_MB = 2.0 * 1024;
const CRITICAL_MAX_MB = 3.0 * 1024;

const SAMPLE_INTERVAL_MS = 5000;
const RING_BUFFER_CAPACITY = 144; // ~12 minutes at 5s
const IDLE_TERMINATE_MS = 5 * 60 * 1000; // 5 minutes

export interface MemorySample {
  ts: number;
  mainRssMb: number;
  mainHeapTotalMb: number;
  mainHeapUsedMb: number;
  rendererRssMb?: number;
  rendererHeapUsedMb?: number;
}

export interface SurfaceRecord {
  id: string;
  type: 'editor' | 'debugger' | 'canvas';
  webContentsId: number;
  lastActive: number;
  window: BrowserWindow;
}

export interface GovernorSnapshot {
  tier: GovernorTier;
  mode: GovernorMode;
  totalSystemRamGb: number;
  mainRssMb: number;
  latestSample: MemorySample | null;
  samples: MemorySample[];
  surfaces: Array<{ id: string; type: string; lastActive: number; active: boolean }>;
  liteMode: boolean;
}

type EvictionCallback = (tier: GovernorTier) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Crash ledger (local-only, Zero-Telemetry)
// ---------------------------------------------------------------------------
let crashLedgerPath: string | null = null;

function getCrashLedgerPath(): string {
  if (crashLedgerPath) return crashLedgerPath;
  const userData = app.getPath('userData');
  crashLedgerPath = path.join(userData, 'crash-ledger.json');
  return crashLedgerPath;
}

export interface CrashLedgerEntry {
  ts: number;
  surfaceId: string;
  surfaceType: string;
  reason: 'render-process-gone' | 'unresponsive' | 'child-process-gone';
  exitCode: number | null;
  reasonString: string | null;
  mainRssMb: number;
  detail: Record<string, unknown>;
}

function appendCrashLedger(entry: Omit<CrashLedgerEntry, 'ts'>): void {
  try {
    const file = getCrashLedgerPath();
    let existing: CrashLedgerEntry[] = [];
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
    const full: CrashLedgerEntry = { ...entry, ts: Date.now() };
    existing.push(full);
    // Keep ledger bounded to last 500 entries.
    if (existing.length > 500) existing = existing.slice(-500);
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  } catch {
    // Ledger writes are best-effort; never throw from crash handlers.
  }
}

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------
export class MemoryGovernor {
  private mode: GovernorMode = 'FULL';
  private tier: GovernorTier = 'NOMINAL';
  private totalSystemRamGb = 0;
  private timer: NodeJS.Timeout | null = null;
  private ring: MemorySample[] = [];
  private latestRenderer: { [webContentsId: number]: MemorySample } = {};
  private surfaces = new Map<string, SurfaceRecord>();
  private evictions = new Set<EvictionCallback>();
  private tierListeners = new Set<(tier: GovernorTier) => void>();
  private disposed = false;
  private liteNoticeShown = false;
  private shedGuard = false;

  private get mainWindowRef(): BrowserWindow | null {
    return MemoryGovernor._mainWindow;
  }
  static _mainWindow: BrowserWindow | null = null;
  static setMainWindow(win: BrowserWindow | null): void {
    MemoryGovernor._mainWindow = win;
  }

  start(mode: GovernorMode, totalSystemRamGb: number): void {
    this.mode = mode;
    this.totalSystemRamGb = totalSystemRamGb;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    // Immediate first sample.
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.disposed = true;
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    const usage = process.memoryUsage();
    const mainRssMb = usage.rss / (1024 * 1024);
    const sample: MemorySample = {
      ts: Date.now(),
      mainRssMb,
      mainHeapTotalMb: usage.heapTotal / (1024 * 1024),
      mainHeapUsedMb: usage.heapUsed / (1024 * 1024)
    };
    // Merge latest renderer samples into the ring for diagnostics sparkline.
    const rendererSamples = Object.values(this.latestRenderer);
    const latestRenderer = rendererSamples.length > 0
      ? rendererSamples.reduce((a, b) => (a.ts > b.ts ? a : b))
      : undefined;
    if (latestRenderer) {
      sample.rendererRssMb = latestRenderer.rendererRssMb;
      sample.rendererHeapUsedMb = latestRenderer.rendererHeapUsedMb;
    }

    this.ring.push(sample);
    if (this.ring.length > RING_BUFFER_CAPACITY) this.ring = this.ring.slice(-RING_BUFFER_CAPACITY);

    const prevTier = this.tier;
    this.tier = this.computeTier(mainRssMb);

    if (this.tier !== prevTier) {
      console.log(`[GOVERNOR] tier ${prevTier} -> ${this.tier} (main RSS ${mainRssMb.toFixed(1)} MB, mode ${this.mode})`);
      void this.runEvictions(this.tier);
      for (const cb of this.tierListeners) {
        try { cb(this.tier); } catch {}
      }
    }

    if (this.tier === 'OVER' && !this.shedGuard) {
      await this.shedLeastRecentSurface();
    }
  }

  private computeTier(mainRssMb: number): GovernorTier {
    if (mainRssMb >= CRITICAL_MAX_MB) return 'OVER';
    if (mainRssMb >= ELEVATED_MAX_MB) return 'CRITICAL';
    if (mainRssMb >= NOMINAL_MAX_MB) return 'ELEVATED';
    return 'NOMINAL';
  }

  private async runEvictions(tier: GovernorTier): Promise<void> {
    for (const cb of this.evictions) {
      try {
        await cb(tier);
      } catch (err) {
        console.warn('[GOVERNOR] eviction callback failed:', err);
      }
    }
  }

  /** Register a surface (editor / debugger / canvas) window for lifecycle tracking. */
  registerSurface(id: string, type: 'editor' | 'debugger' | 'canvas', window: BrowserWindow): void {
    const record: SurfaceRecord = {
      id,
      type,
      webContentsId: window.webContents.id,
      lastActive: Date.now(),
      window
    };
    this.surfaces.set(id, record);

    // Crash instrumentation (Step 1).
    this.instrumentWindow(window, id, type);

    // Idle reclamation (Step 3): terminate surface after 5 min idle.
    const resetIdle = (): void => {
      record.lastActive = Date.now();
    };
    window.webContents.on('focus', resetIdle);
    window.on('focus', resetIdle);

    const idleTimer = setInterval(() => {
      // The editor is the anchor surface — never idle-terminate it.
      if (record.type === 'editor') return;
      if (Date.now() - record.lastActive > IDLE_TERMINATE_MS) {
        console.log(`[GOVERNOR] surface ${id} idle >5min, terminating`);
        this.terminateSurface(id);
      }
    }, 60_000);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
    (record as any).__idleTimer = idleTimer;
  }

  /** Mark a surface as recently active. */
  heartbeat(id: string): void {
    const record = this.surfaces.get(id);
    if (record) record.lastActive = Date.now();
  }

  /**
   * Idle reclamation (Step 3): close an idle secondary surface. Only
   * debugger/canvas surfaces can be terminated this way; the editor is the
   * anchor and is exempt.
   */
  terminateSurface(id: string): void {
    const record = this.surfaces.get(id);
    if (!record) return;
    if (record.type === 'editor') return;
    this.unregisterSurface(id);
    try {
      if (!record.window.isDestroyed()) {
        record.window.close();
      }
    } catch (err) {
      console.warn(`[GOVERNOR] failed to terminate idle surface ${id}:`, err);
    }
  }

  unregisterSurface(id: string): void {
    const record = this.surfaces.get(id);
    if (record) {
      try {
        const timer = (record as any).__idleTimer as NodeJS.Timeout | undefined;
        if (timer) clearInterval(timer);
      } catch {}
      this.surfaces.delete(id);
    }
  }

  /** Push a renderer memory sample (called via IPC from each renderer). */
  recordRendererSample(webContentsId: number, sample: { rssMb?: number; heapUsedMb?: number; ts?: number }): void {
    this.latestRenderer[webContentsId] = {
      ts: sample.ts ?? Date.now(),
      mainRssMb: 0,
      mainHeapTotalMb: 0,
      mainHeapUsedMb: 0,
      rendererRssMb: sample.rssMb,
      rendererHeapUsedMb: sample.heapUsedMb
    };
  }

  registerEviction(cb: EvictionCallback): void {
    this.evictions.add(cb);
  }

  unregisterEviction(cb: EvictionCallback): void {
    this.evictions.delete(cb);
  }

  subscribeTierChange(cb: (tier: GovernorTier) => void): () => void {
    this.tierListeners.add(cb);
    return () => this.tierListeners.delete(cb);
  }

  private instrumentWindow(window: BrowserWindow, surfaceId: string, surfaceType: string): void {
    const wc = window.webContents;

    wc.on('render-process-gone', (event, details) => {
      const entry: Omit<CrashLedgerEntry, 'ts'> = {
        surfaceId,
        surfaceType,
        reason: 'render-process-gone',
        exitCode: details.exitCode ?? null,
        reasonString: details.reason ?? null,
        mainRssMb: process.memoryUsage().rss / (1024 * 1024),
        detail: { frames: (details as any).frames ?? undefined, destroyer: (details as any).destroyer ?? undefined }
      };
      appendCrashLedger(entry);
      console.error(`[GOVERNOR][CRASH] render-process-gone surface=${surfaceId} exitCode=${details.exitCode} reason=${details.reason}`);
      // Reload ONLY this surface; the app must never die because one surface died.
      this.reloadSurface(window, surfaceId, 'The renderer process crashed. Reloading this surface…');
    });

    // This Electron version's WebContents typings lack the unresponsive /
    // child-process-gone overloads; both events exist at runtime.
    const wcAny = wc as any;
    wcAny.on('unresponsive', (event: { stack?: string } | undefined) => {
      const stack = event?.stack ?? new Error().stack;
      const entry: Omit<CrashLedgerEntry, 'ts'> = {
        surfaceId,
        surfaceType,
        reason: 'unresponsive',
        exitCode: null,
        reasonString: 'main-thread block >5s',
        mainRssMb: process.memoryUsage().rss / (1024 * 1024),
        detail: { stack: stack ? String(stack).slice(0, 4000) : undefined }
      };
      appendCrashLedger(entry);
      console.warn(`[GOVERNOR][BLOCK] surface=${surfaceId} unresponsive (main-thread block). Stack sample: ${stack ? String(stack).slice(0, 500) : 'none'}`);
    });

    wc.on('responsive', () => {
      console.log(`[GOVERNOR] surface=${surfaceId} responsive again; auto-continue.`);
    });

    wcAny.on('child-process-gone', (event: unknown, details: { exitCode?: number; reason?: string }) => {
      const entry: Omit<CrashLedgerEntry, 'ts'> = {
        surfaceId,
        surfaceType,
        reason: 'child-process-gone',
        exitCode: details.exitCode ?? null,
        reasonString: details.reason ?? null,
        mainRssMb: process.memoryUsage().rss / (1024 * 1024),
        detail: {}
      };
      appendCrashLedger(entry);
      console.error(`[GOVERNOR][CRASH] child-process-gone surface=${surfaceId} exitCode=${details.exitCode}`);
    });
  }

  private reloadSurface(window: BrowserWindow, surfaceId: string, notice: string): void {
    // A crashed renderer cannot receive IPC — route the notice to the editor
    // surface (the anchor) so the user sees what happened.
    const anchor = this.mainWindowRef;
    try {
      if (anchor && !anchor.isDestroyed() && !anchor.webContents.isDestroyed()) {
        anchor.webContents.send('governor:surface-crashed', { surfaceId, notice, reload: true });
      }
    } catch {}
    // Reload the same URL/hash so the surface returns to its route.
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        void window.webContents.reload();
      }
    } catch {
      // If reload fails, surface is left in a safe state; app keeps running.
    }
  }

  private async shedLeastRecentSurface(): Promise<void> {
    this.shedGuard = true;
    // Find least-recently-active surface that is NOT the editor (editor is
    // the anchor surface; never shed it unless it is the only one).
    let victim: SurfaceRecord | null = null;
    for (const record of this.surfaces.values()) {
      if (record.type === 'editor') continue;
      if (!victim || record.lastActive < victim.lastActive) victim = record;
    }
    // If only the editor remains and we are still OVER, shed nothing further
    // (editor is the last resort; evictions already ran).
    if (!victim) {
      console.warn('[GOVERNOR] OVER tier but no shedable surface; editor is the anchor.');
      return;
    }
    console.warn(`[GOVERNOR][OVER] shedding least-recently-active surface ${victim.id} (${victim.type}) to avoid OS OOM`);
    // Route the notice to the editor surface (the anchor) — the victim is
    // being closed immediately, so it may never render the message.
    try {
      const anchor = this.mainWindowRef;
      if (anchor && !anchor.isDestroyed() && !anchor.webContents.isDestroyed()) {
        anchor.webContents.send('governor:surface-shed', {
          surfaceId: victim.id,
          notice: `${victim.type} surface was unloaded to free memory. Reopen it from the activity bar.`
        });
      }
    } catch {}
    try {
      if (!victim.window.isDestroyed() && !victim.window.webContents.isDestroyed()) {
        victim.window.close();
      }
    } catch (err) {
      console.error('[GOVERNOR] failed to shed surface:', err);
    }
    this.unregisterSurface(victim.id);
    this.shedGuard = false;
  }

  getSnapshot(): GovernorSnapshot {
    const now = Date.now();
    const surfaces = Array.from(this.surfaces.values()).map((r) => ({
      id: r.id,
      type: r.type,
      lastActive: r.lastActive,
      active: now - r.lastActive < IDLE_TERMINATE_MS
    }));
    return {
      tier: this.tier,
      mode: this.mode,
      totalSystemRamGb: this.totalSystemRamGb,
      mainRssMb: this.ring.length > 0 ? this.ring[this.ring.length - 1].mainRssMb : 0,
      latestSample: this.ring.length > 0 ? this.ring[this.ring.length - 1] : null,
      samples: this.ring,
      surfaces,
      liteMode: this.mode === 'LITE'
    };
  }

  getTier(): GovernorTier {
    return this.tier;
  }

  getMode(): GovernorMode {
    return this.mode;
  }

  isLiteMode(): boolean {
    return this.mode === 'LITE';
  }

  /** Startup RAM policy (Step 5): returns LITE mode when total RAM < 3GB. */
  static detectMode(totalSystemRamGb: number): GovernorMode {
    return totalSystemRamGb < 3 ? 'LITE' : 'FULL';
  }
}

export const memoryGovernor = new MemoryGovernor();
