/**
 * Electron-backed adapters for the main-process command handlers.
 *
 * `command-main-handlers.ts` holds the logic and is deliberately free of any
 * `electron` import so it runs under plain Node in tests. This module is the
 * other half: the real window manager, updater, FCC sidecar and filesystem,
 * handed to that logic as plain functions.
 *
 * Anything this module cannot see for itself is injected. `mainWindow` and
 * `currentWorkspacePath` are module-scoped inside `index.ts`, so index.ts passes
 * getters rather than this file reaching across for them — which also means the
 * adapter never holds a stale window reference after the primary window is
 * recreated.
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getUpdateManager } from './update-manager';
import { fccManager } from './orchestration/fcc-manager';
import { openEditorWindow, type EditorWindowReveal } from '../windows/editor-window';
import type { MainCommandAdapters } from './command-main-handlers';

/**
 * Where a workspace keeps its debug launch configuration.
 *
 * Exported so the debug-session work reads the same path instead of declaring a
 * second one — two definitions of "where launch configs live" is how a menu row
 * ends up greying out while a configuration the user can see does exist.
 */
export const LAUNCH_CONFIG_RELPATH = path.join('.ty-code', 'launch.json');

export interface MainCommandAdapterDeps {
  /** The primary window. Null before it is created and after it is destroyed. */
  getMainWindow: () => BrowserWindow | null;
  /** The loaded workspace folder, or null when none is open. */
  getWorkspacePath: () => string | null;
}

/**
 * Which window an activation applies to.
 *
 * The sender's own window when it told us its id, otherwise the focused window,
 * otherwise the primary. Falling back to the primary is what makes "Close
 * Window" still do something sensible when a keybinding fires with no window id
 * attached.
 */
function resolveWindow(
  windowId: number | undefined,
  deps: MainCommandAdapterDeps
): BrowserWindow | null {
  if (typeof windowId === 'number') return BrowserWindow.fromId(windowId);
  return BrowserWindow.getFocusedWindow() ?? deps.getMainWindow();
}

/**
 * Does the open workspace have a launch configuration?
 *
 * A synchronous stat on one known path: cheap enough to run on every menu
 * resolution, and `isFile()` rather than `existsSync` so a directory sitting at
 * that path cannot read as a configuration the debugger could never load.
 */
function hasLaunchConfiguration(workspacePath: string | null): boolean {
  if (!workspacePath) return false;
  try {
    return fs.statSync(path.join(workspacePath, LAUNCH_CONFIG_RELPATH)).isFile();
  } catch {
    // No file, unreadable path, or no workspace: all mean the same thing here.
    return false;
  }
}

/** Build the adapters `createMainCommandHandlers` and the context provider need. */
export function createElectronMainCommandAdapters(
  deps: MainCommandAdapterDeps
): MainCommandAdapters {
  return {
    openWindow: (reveal?: EditorWindowReveal) => {
      openEditorWindow(reveal ? { reveal } : {});
    },

    closeWindow: (windowId?: number) => {
      const target = resolveWindow(windowId, deps);
      if (!target || target.isDestroyed()) return false;
      target.close();
      return true;
    },

    quit: () => {
      app.quit();
    },

    toggleDevTools: (windowId?: number) => {
      // Defence in depth. The registry gates this row on `devToolsAllowed`,
      // which is this same condition, so the check is normally redundant — but
      // main layers its own contexts over whatever a window claimed, and a
      // packaged build must never open devtools even if a renderer asserts
      // otherwise.
      if (app.isPackaged) return false;
      const target = resolveWindow(windowId, deps);
      if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return false;
      target.webContents.toggleDevTools();
      return true;
    },

    checkForUpdates: async () => ({
      ...(await getUpdateManager().checkForUpdates()),
      // The manager short-circuits in development and reports "no update"
      // without contacting a server. Tagging the result lets the summary say so
      // instead of claiming an up-to-date verdict no check produced.
      devMode: !app.isPackaged
    }),

    fccStatus: () => fccManager.getStatus(),

    contexts: {
      devToolsAllowed: () => !app.isPackaged,
      updatersAvailable: () => {
        // The manager degrades to a visible result rather than throwing, so the
        // only way this row is genuinely unavailable is if it cannot be built.
        try {
          getUpdateManager();
          return true;
        } catch {
          return false;
        }
      },
      workspaceOpen: () => Boolean(deps.getWorkspacePath()),
      configurationsExist: () => hasLaunchConfiguration(deps.getWorkspacePath())
    }
  };
}
