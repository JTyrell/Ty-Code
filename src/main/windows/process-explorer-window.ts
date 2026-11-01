/**
 * Process Explorer window — Prompt 5b, Help menu group 3.
 *
 * The spec asks for "main, per-window renderers, workers, FCC sidecar, PTYs with
 * PID + RSS". That is a list of process *kinds* the panel must show, not a
 * statement about which process hosts it: a memory panel living inside the
 * process it is supposed to be measuring reports a number that includes itself,
 * and the moment main is the thing that is sick the panel goes blank with it. So
 * it gets its own window, like a browser's task manager.
 *
 * It is deliberately NOT registered with the memory governor, which every other
 * secondary window is. Three reasons, in order of weight:
 *
 *  1. `registerSurface` accepts `'editor' | 'debugger' | 'canvas'`. There is no
 *     diagnostics member, and widening that union touches `SurfaceRecord` and
 *     the governor's telemetry snapshot for no gain here.
 *  2. Any non-`editor` surface is terminated after five idle minutes and is the
 *     first thing shed when the tier reaches OVER. Both would close this window
 *     precisely when the user opened it — because memory looks bad. A diagnostic
 *     that disappears under the condition it exists to diagnose is worse than
 *     no diagnostic.
 *  3. What the governor would buy is crash instrumentation for a surface whose
 *     renderer is a table with no editor, no terminal and no webview in it.
 *
 * The window is a plain module-level singleton instead, tracked so a second
 * request focuses the existing one rather than stacking panels.
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** Hash the renderer routes on, matching the `sketcher` and `debugger` popouts. */
export const PROCESS_EXPLORER_HASH = 'process-explorer';

let explorerWindow: BrowserWindow | null = null;

export function getProcessExplorerWindow(): BrowserWindow | null {
  return explorerWindow;
}

export function openProcessExplorerWindow(): BrowserWindow {
  if (explorerWindow && !explorerWindow.isDestroyed()) {
    if (explorerWindow.isMinimized()) explorerWindow.restore();
    explorerWindow.focus();
    return explorerWindow;
  }

  const isMac = process.platform === 'darwin';

  // Same preload resolution as the debugger window: a `preload.js` sitting next
  // to the built window module wins, otherwise fall back to the shared bundle.
  const preloadCandidate = path.join(__dirname, 'preload.js');
  const preloadFallback = path.join(__dirname, '../preload/index.js');
  const resolvedPreload = fs.existsSync(preloadCandidate) ? preloadCandidate : preloadFallback;

  const window = new BrowserWindow({
    width: 940,
    height: 640,
    minWidth: 620,
    minHeight: 420,
    title: 'Ty-Code - Process Explorer',
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: resolvedPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  explorerWindow = window;

  // The panel polls on a chain rather than on an interval, so there is no
  // main-side timer to clear when this closes — dropping the singleton IS the
  // unsubscribe. `window:close` resolves through `fromWebContents(event.sender)`,
  // so the panel's own close button already lands here without new IPC.
  window.on('closed', () => {
    if (explorerWindow === window) explorerWindow = null;
  });

  // The panel draws its own caption buttons because `frame: false`, so the
  // maximize glyph has to be told when the window's state changes underneath it
  // — double-clicking the drag region or Win+Up maximizes without any click on
  // that button. Same forwarding the canvas and debugger popouts do.
  window.on('maximize', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:maximize-change', true);
    }
  });
  window.on('unmaximize', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:maximize-change', false);
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    try {
      if (devServerUrl) {
        if (new URL(targetUrl).origin !== new URL(devServerUrl).origin) event.preventDefault();
        return;
      }
      const resolved = path.resolve(new URL(targetUrl).pathname.replace(/^\/+/, '') || '.');
      if (!resolved.toLowerCase().includes('index.html')) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}#${PROCESS_EXPLORER_HASH}`);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: PROCESS_EXPLORER_HASH
    });
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  return window;
}
