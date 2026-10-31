/**
 * Secondary Ty-Code workbench windows — File > New Window and Terminal > New
 * Terminal Window.
 *
 * The primary window is built by `createWindow()` in `index.ts`, which also
 * rebinds the process-wide singletons (`mainWindow`, the workspace manager's
 * main window, the governor's anchor surface). Calling that a second time would
 * steal those references from the window the user is already looking at, so a
 * secondary window is created here instead: same hardened webPreferences, same
 * renderer bundle, no singleton rebinding.
 *
 * Prompt 5, Wiring Rule 3 — "Popout windows render the same menu bar bound to
 * their own window context" — is satisfied structurally rather than by code
 * here: the renderer imports the command registry directly and resolves menus
 * from its own window state, so a second workbench paints the same menu bar
 * with its own enablement without this module knowing anything about commands.
 */

import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { memoryGovernor } from '../services/memory-governor';

/**
 * Surface a new window should reveal once its renderer has booted.
 *
 * Carried in the load hash rather than sent as an event: a hash survives a
 * renderer reload, whereas a one-shot `webContents.send` is lost if it fires
 * before the renderer subscribes. The renderer's command runtime reads it on
 * boot and dispatches the matching registry entry.
 */
export type EditorWindowReveal = 'terminal';

export interface OpenEditorWindowOptions {
  reveal?: EditorWindowReveal;
}

/** Live secondary windows, keyed by their governor surface id. */
const secondaryWindows = new Map<string, BrowserWindow>();

let nextOrdinal = 2;

/** Every secondary window, for diagnostics and the process explorer. */
export function listSecondaryWindows(): BrowserWindow[] {
  return [...secondaryWindows.values()].filter((win) => !win.isDestroyed());
}

/** Placement for a new window; omitted coordinates let Electron centre it. */
interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/**
 * Where to place a new window.
 *
 * Offset from the focused window so the two are visibly distinct instead of
 * stacked pixel-perfect, then clamped into the display's work area so an offset
 * window can never open with its title bar off-screen and become unclosable.
 * With no window to measure against the coordinates are left out entirely,
 * which centres the new window on the primary display.
 */
function nextWindowBounds(): WindowBounds {
  const anchor = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!anchor || anchor.isDestroyed()) return { width: 1440, height: 900 };

  const workArea = screen.getDisplayMatching(anchor.getBounds()).workArea;
  const source = anchor.getBounds();
  const width = Math.min(source.width, workArea.width);
  const height = Math.min(source.height, workArea.height);
  // Cascade by a fixed step, wrapping when the window would leave the display.
  const step = 36 * (secondaryWindows.size + 1);
  const x = source.x + step > workArea.x + workArea.width - width ? workArea.x : source.x + step;
  const y = source.y + step > workArea.y + workArea.height - height ? workArea.y : source.y + step;
  return { x, y, width, height };
}

/**
 * Open a new workbench window. Always creates one: unlike the Canvas and
 * Debugger popouts, which are singletons focused on repeat invocation, "New
 * Window" means a second independent workspace view and re-focusing the first
 * would silently do nothing the user asked for.
 */
export function openEditorWindow(options: OpenEditorWindowOptions = {}): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const bounds = nextWindowBounds();
  const surfaceId = `editor-${nextOrdinal}`;
  nextOrdinal += 1;

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 1020,
    minHeight: 680,
    title: 'Ty-Code - Antigravity IDE',
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true
    }
  });

  secondaryWindows.set(surfaceId, window);

  // A unique id per window matters: the governor keys surfaces by id, so reusing
  // one would overwrite the earlier record and orphan its idle-termination
  // timer, leaving a window that is never reclaimed.
  memoryGovernor.registerSurface(surfaceId, 'editor', window);

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
  // Same navigation guard as the primary and canvas windows: in dev only the
  // dev server origin may load, in production only the packaged index.html.
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

  const hash = options.reveal ? options.reveal : '';
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(hash ? `${devServerUrl}#${hash}` : devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  window.on('closed', () => {
    secondaryWindows.delete(surfaceId);
    memoryGovernor.unregisterSurface(surfaceId);
  });

  return window;
}
