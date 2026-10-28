/**
 * Reliability event bus (Autonomous Free-Tier Reliability).
 *
 * The ONLY transport from the Main Process reliability modules to the
 * renderer. Lazy electron require keeps this module importable from unit
 * tests without Electron. Zero telemetry: every payload stays local.
 */

let electronApi: typeof import('electron') | null | undefined;

function electron(): typeof import('electron') | null {
  if (electronApi !== undefined) return electronApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    electronApi = require('electron') as typeof import('electron');
  } catch {
    electronApi = null;
  }
  return electronApi;
}

/** Fan-out a reliability event to every live window. Never throws. */
export function broadcastReliability(channel: string, payload: unknown): void {
  const e = electron();
  if (!e?.BrowserWindow) return;
  try {
    for (const win of e.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  } catch {
    // Non-blocking in headless/test environments.
  }
}

/** True when running in a packaged (production) build. */
export function isPackagedBuild(): boolean {
  const e = electron();
  return Boolean(e?.app?.isPackaged);
}
