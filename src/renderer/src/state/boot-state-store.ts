import { create } from 'zustand';

/**
 * Boot State Store (Prompt 3: Kill Boot Skeleton Flash)
 *
 * Tri-state hydration gate consumed by App.tsx before any boot-time Suspense
 * tree is allowed to mount:
 *   `undefined` — boot-state IPC has not resolved yet. Gate CLOSED: nothing
 *                 unconditional may mount, so no lazy chunk can suspend and
 *                 flash a ViewSkeleton ("skeleton first, content second").
 *   `true`      — resolved: the window IS first-run (onboarding may show).
 *   `false`     — resolved: NOT first-run, or the read failed (fail-safe —
 *                 never auto-open onboarding because a read errored).
 */

export type BootHydration = boolean | undefined;

interface BootStateState {
  hydration: BootHydration;
  firstRun: boolean;
  hasCompletedOnboarding: boolean;
  hydrate: () => Promise<void>;
}

let hydrateGeneration = 0;

export const useBootStateStore = create<BootStateState>((set) => ({
  hydration: undefined,
  firstRun: false,
  hasCompletedOnboarding: true,

  hydrate: async () => {
    const generation = ++hydrateGeneration;
    const electronAPI = window.electronAPI;
    if (!electronAPI?.getBootState) {
      // Bridge unavailable (test harness / plain browser): fail-safe resolution.
      set({ hydration: false, firstRun: false, hasCompletedOnboarding: true });
      return;
    }
    try {
      const res = await electronAPI.getBootState();
      // StrictMode-safe generation guard: ignore a resolution superseded by a
      // newer hydrate() call (mount/unmount/mount replays in dev).
      if (generation !== hydrateGeneration) return;
      const data = res && res.success && res.data ? res.data : null;
      if (!data) {
        set({ hydration: false, firstRun: false, hasCompletedOnboarding: true });
        return;
      }
      set({
        hydration: Boolean(data.firstRun),
        firstRun: Boolean(data.firstRun),
        hasCompletedOnboarding: Boolean(data.hasCompletedOnboarding)
      });
    } catch {
      if (generation !== hydrateGeneration) return;
      set({ hydration: false, firstRun: false, hasCompletedOnboarding: true });
    }
  }
}));
