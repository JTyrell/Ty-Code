/**
 * Dedicated M3E Canvas window (overhaul).
 *
 * - Always a separate BrowserWindow (never an embedded panel)
 * - Hardened: contextIsolation on, nodeIntegration off, sandbox on
 * - On creation the window is immediately initialized with the current project
 *   context: once its renderer finishes loading we push the CanvasSyncManager
 *   snapshot ('canvas:request-state' equivalent) plus the shared chat history
 * - The renderer additionally calls canvasRequestState() (IPC
 *   'canvas:request-state') on mount, and listens for 'main:sync-message' via
 *   the onCanvasMessageSynced bridge to keep its local chat in sync
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { canvasSyncManager } from '../services/canvas-sync-manager';
import { memoryGovernor } from '../services/memory-governor';

let canvasWindow: BrowserWindow | null = null;

export function getCanvasWindow(): BrowserWindow | null {
  return canvasWindow;
}

export function openCanvasWindow(): BrowserWindow {
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    if (canvasWindow.isMinimized()) canvasWindow.restore();
    canvasWindow.focus();
    return canvasWindow;
  }

  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 620,
    title: 'Ty-Code - UI Canvas (M3E Sketcher)',
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // Hard security boundary for the canvas window
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  canvasWindow = window;

  // Step 3: register canvas surface with the governor (crash instrumentation
  // + 5-minute idle termination).
  memoryGovernor.registerSurface('canvas', 'canvas', window);

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

  // Immediate context initialization: as soon as the canvas page finishes
  // loading, push the full shared snapshot (platform + component tree) and the
  // shared chat history. The renderer will additionally pull state itself via
  // canvas:request-state, so neither order depends on the other.
  webContentsSafe(window, () => {
    const snapshot = canvasSyncManager.getSnapshot();
    window.webContents.send('canvas:state-synced', snapshot);
    if (snapshot.sharedConversationHistory.length > 0) {
      for (const message of snapshot.sharedConversationHistory) {
        window.webContents.send('canvas:message-synced', message);
      }
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}#canvas`);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'canvas' });
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  window.on('closed', () => {
    if (canvasWindow === window) canvasWindow = null;
    memoryGovernor.unregisterSurface('canvas');
  });

  return window;
}

function webContentsSafe(window: BrowserWindow, action: () => void): void {
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try {
        action();
      } catch {
        // Snapshot delivery is best-effort; renderer also pulls state itself.
      }
    }
  });
}
