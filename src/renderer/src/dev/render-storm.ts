/**
 * Render-Storm Tripwire (dev-only, ZERO production cost)
 *
 * Counts component renders in rolling 1-second windows. The first time any
 * tracked component exceeds RENDER_STORM_THRESHOLD renders within one window,
 * it logs exactly ONE console warning naming the component, so infinite
 * render loops (setState-in-render, unstable store snapshots, dep-identity
 * churn) are caught in the console immediately — before they surface as
 * "Maximum update depth exceeded".
 *
 * Usage: call `trackRenders('ComponentName')` in the component body, or mount
 * `<RenderStormWatch name="settings:tab" />` inside a tab panel. The call /
 * component performs NO side effects and NO state writes, so it cannot itself
 * perturb rendering.
 */

const RENDER_STORM_THRESHOLD = 60;
const WINDOW_MS = 1000;

interface StormWindow {
  windowStart: number;
  count: number;
  reported: boolean;
}

const renderWindows = new Map<string, StormWindow>();

export function trackRenders(componentName: string): void {
  if (!import.meta.env.DEV) return;

  const now = performance.now();
  let entry = renderWindows.get(componentName);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { windowStart: now, count: 0, reported: false };
    renderWindows.set(componentName, entry);
  }
  entry.count += 1;
  if (entry.count > RENDER_STORM_THRESHOLD && !entry.reported) {
    entry.reported = true;
    // Logs ONCE per storm window, naming the component.
    console.warn(
      `[RenderStorm] "${componentName}" rendered ${entry.count}x in <1s (threshold ${RENDER_STORM_THRESHOLD}). ` +
        'Inspect for a render loop: setState in render body, unstable selector/effect deps.'
    );
  }
}
