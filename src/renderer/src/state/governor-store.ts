/**
 * Governor Store (renderer)
 *
 * Local-only, Zero-Telemetry mirror of the main-process MemoryPressure
 * Governor. Holds the current tier, mode, ring-buffer sparkline samples and
 * surface presence. All telemetry stays on the machine.
 *
 * Atomic selectors: pure selector functions derived from store state so
 * components can subscribe to a single derived value without re-rendering on
 * unrelated updates.
 */

import { create } from 'zustand';

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

interface GovernorState {
  tier: GovernorTier;
  mode: GovernorMode;
  totalSystemRamGb: number;
  mainRssMb: number;
  liteMode: boolean;
  samples: MemorySample[];
  latestSample: MemorySample | null;
  surfaces: SurfacePresence[];
  hydrated: boolean;
  documentHidden: boolean;

  setSnapshot: (snapshot: {
    tier: GovernorTier;
    mode: GovernorMode;
    totalSystemRamGb: number;
    mainRssMb: number;
    samples: MemorySample[];
    latestSample: MemorySample | null;
    surfaces: SurfacePresence[];
    liteMode: boolean;
  }) => void;
  setTier: (tier: GovernorTier) => void;
  setLiteMode: (lite: boolean) => void;
  setDocumentHidden: (hidden: boolean) => void;
  addSample: (sample: MemorySample) => void;
  setSurfaces: (surfaces: SurfacePresence[]) => void;
  heartbeat: (id: string) => void;
}

export const useGovernorStore = create<GovernorState>((set, get) => ({
  tier: 'NOMINAL',
  mode: 'FULL',
  totalSystemRamGb: 0,
  mainRssMb: 0,
  liteMode: false,
  samples: [],
  latestSample: null,
  surfaces: [],
  hydrated: false,
  documentHidden: false,

  setSnapshot: (snapshot) =>
    set((state) => ({
      tier: snapshot.tier,
      mode: snapshot.mode,
      totalSystemRamGb: snapshot.totalSystemRamGb,
      mainRssMb: snapshot.mainRssMb,
      liteMode: snapshot.liteMode,
      samples: snapshot.samples,
      latestSample: snapshot.latestSample,
      surfaces: snapshot.surfaces,
      hydrated: true
    })),

  setTier: (tier) => set({ tier }),

  setLiteMode: (lite) => set({ liteMode: lite, mode: lite ? 'LITE' : 'FULL' }),

  setDocumentHidden: (hidden) => set({ documentHidden: hidden }),

  addSample: (sample) =>
    set((state) => {
      const next = [...state.samples, sample].slice(-144);
      return { samples: next, latestSample: sample, mainRssMb: sample.mainRssMb };
    }),

  setSurfaces: (surfaces) => set({ surfaces }),

  heartbeat: (id) =>
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === id ? { ...s, lastActive: Date.now(), active: true } : s))
    }))
}));

// ---------------------------------------------------------------------------
// Atomic selectors (derived, stable references)
// ---------------------------------------------------------------------------

export const selectGovernorTier = (state: GovernorState): GovernorTier => state.tier;
export const selectGovernorMode = (state: GovernorState): GovernorMode => state.mode;
export const selectGovernorLiteMode = (state: GovernorState): boolean => state.liteMode;
export const selectGovernorMainRssMb = (state: GovernorState): number => state.mainRssMb;
export const selectGovernorTotalRamGb = (state: GovernorState): number => state.totalSystemRamGb;
export const selectGovernorSamples = (state: GovernorState): MemorySample[] => state.samples;
export const selectGovernorLatestSample = (state: GovernorState): MemorySample | null => state.latestSample;
export const selectGovernorSurfaces = (state: GovernorState): SurfacePresence[] => state.surfaces;
export const selectGovernorHydrated = (state: GovernorState): boolean => state.hydrated;
export const selectDocumentHidden = (state: GovernorState): boolean => state.documentHidden;

export const selectGovernorSparkline = (state: GovernorState): number[] =>
  state.samples.map((s) => s.mainRssMb);

export const selectGovernorIsCriticalOrOver = (state: GovernorState): boolean =>
  state.tier === 'CRITICAL' || state.tier === 'OVER';

export const selectGovernorActiveSurfaces = (state: GovernorState): SurfacePresence[] =>
  state.surfaces.filter((s) => s.active);

// ---------------------------------------------------------------------------
// Renderer memory sampler (Step 4)
// Samples performance.memory every 5s and pushes to the main-process governor
// via a fire-and-forget IPC. performance.memory is guarded because it is not
// available in every Electron/Chrome context.
// ---------------------------------------------------------------------------
let governorSampleTimer: ReturnType<typeof setInterval> | null = null;

export function startGovernorSampling(intervalMs = 5000): void {
  if (governorSampleTimer) return;
  const tick = (): void => {
    try {
      const mem = (performance as any).memory;
      if (mem && window.electronAPI?.governorSample) {
        window.electronAPI.governorSample({
          rssMb: typeof mem.totalJSHeapSize === 'number' ? mem.totalJSHeapSize / (1024 * 1024) : undefined,
          heapUsedMb: typeof mem.usedJSHeapSize === 'number' ? mem.usedJSHeapSize / (1024 * 1024) : undefined,
          ts: Date.now()
        });
      }
    } catch {
      // Sampling is best-effort; never throw.
    }
  };
  tick();
  governorSampleTimer = setInterval(tick, intervalMs);
  const timer = governorSampleTimer as unknown as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopGovernorSampling(): void {
  if (governorSampleTimer) {
    clearInterval(governorSampleTimer);
    governorSampleTimer = null;
  }
}
