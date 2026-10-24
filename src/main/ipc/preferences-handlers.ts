/**
 * Ty-Code IPC Handlers — Role Preferences & Prompt Assembly Telemetry
 *
 * Implements:
 * - preferences:get, preferences:set, preferences:reset (Zod-validated)
 * - prompt:get-assembly-history, prompt:get-assembly-info
 * - Broadcasts 'prompt:assembly-update' and 'preferences:changed' via Disposable pattern
 *
 * Brand: Ty-Code
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  loadPreferences,
  savePreferences,
  resetPreferences,
  RolePreferencesSchema,
  containsSecretShape,
  invalidateAssemblyCache,
  getAssemblyHistory,
  getAssemblyInfo,
  assemblyEmitter,
  type RolePreferences,
  type AssemblyResult
} from '../agent/prompt-assembler';
import { workspaceManager } from '../services/workspace-manager';
import type { IpcResponse } from '../../preload/types';

function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// Subscribe assembly emitter to forward events to renderer
assemblyEmitter.on('assembly', (result: AssemblyResult) => {
  broadcastToWindows('prompt:assembly-update', result);
});

export function registerPromptAssemblerHandlers(): void {
  // ─── Preferences Handlers ────────────────────────────────────────────────
  ipcMain.handle('preferences:get', async (_event, customRoot?: string): Promise<IpcResponse<RolePreferences>> => {
    try {
      const root = customRoot || workspaceManager.currentWorkspacePath || process.cwd();
      const prefs = await loadPreferences(root);
      return { success: true, data: prefs };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('preferences:set', async (_event, rawPrefs: unknown, customRoot?: string): Promise<IpcResponse<RolePreferences>> => {
    try {
      if (containsSecretShape(rawPrefs)) {
        return {
          success: false,
          error: 'PREF_ERR_SECRET_SHAPE: Preferences reject secret-shaped strings (sk-..., Bearer tokens).'
        };
      }

      const parseResult = RolePreferencesSchema.safeParse(rawPrefs);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Validation error: ${parseResult.error.message}`
        };
      }

      const root = customRoot || workspaceManager.currentWorkspacePath || process.cwd();
      const saved = await savePreferences(root, parseResult.data);
      invalidateAssemblyCache();
      broadcastToWindows('preferences:changed', saved);

      return { success: true, data: saved };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('preferences:reset', async (_event, customRoot?: string): Promise<IpcResponse<RolePreferences>> => {
    try {
      const root = customRoot || workspaceManager.currentWorkspacePath || process.cwd();
      const reset = await resetPreferences(root);
      invalidateAssemblyCache();
      broadcastToWindows('preferences:changed', reset);

      return { success: true, data: reset };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ─── Telemetry Ring Handlers ─────────────────────────────────────────────
  ipcMain.handle('prompt:get-assembly-history', async (): Promise<IpcResponse<AssemblyResult[]>> => {
    try {
      const history = getAssemblyHistory();
      return { success: true, data: history };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('prompt:get-assembly-info', async (_event, taskId: string): Promise<IpcResponse<AssemblyResult | null>> => {
    try {
      const info = getAssemblyInfo(taskId);
      return { success: true, data: info };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
