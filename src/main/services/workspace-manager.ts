import { app, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getWorkspaceTreeChunked, setupWorkspaceWatcher } from '../ipc/fs-handlers';
import { settingsManager } from './settings-manager';
import { getRecentWorkspacesManager } from './recent-workspaces';
import { updateAiServicesWorkspace } from '../ipc/ai-features-handlers';
import type { IpcResponse } from '../../preload/types';

import { isAppOrSystemDir } from './workspace-security';
export { isAppOrSystemDir };

/**
 * WorkspaceManager: Explorer-First Workspace Gatekeeper
 * Ensures that all background systems (M3E Canvas, Git Versioning, Omni-Debugger)
 * do not perform file read operations or initialize until the Explorer has 100%
 * completed indexing the workspace.
 */
export class WorkspaceManager {
  private currentPath: string = '';
  private isReady: boolean = false;
  private readyPromise: Promise<void>;
  private resolveReadyPromise!: () => void;
  private mainWindow: BrowserWindow | null = null;
  private activeScanId: number = 0;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReadyPromise = resolve;
    });
  }

  public setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  public get currentWorkspacePath(): string {
    return this.currentPath;
  }

  public setCurrentPath(newPath: string): void {
    this.currentPath = newPath;
  }

  public get workspaceRoot(): string {
    return this.currentPath;
  }

  public set workspaceRoot(newPath: string) {
    this.currentPath = newPath;
  }

  public get isWorkspaceReady(): boolean {
    return this.isReady;
  }

  public get workspaceReadyPromise(): Promise<void> {
    return this.readyPromise;
  }

  private broadcast(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        try {
          win.webContents.send(channel, payload);
        } catch {
          // safe skip
        }
      }
    }
  }

  /**
   * Resets the workspace readiness promise when a new folder begins indexing.
   */
  public resetWorkspacePromise(): void {
    this.isReady = false;
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReadyPromise = resolve;
    });
    this.broadcast('workspace:status', {
      path: this.currentPath,
      isReady: false
    });
  }

  /**
   * Resolves the workspace ready promise and emits the workspace:ready IPC event.
   */
  public setWorkspaceReady(workspacePath: string): void {
    this.isReady = true;
    this.resolveReadyPromise();
    this.broadcast('workspace:ready', { path: workspacePath });
    this.broadcast('workspace:status', {
      path: workspacePath,
      isReady: true
    });
  }

  /**
   * Opens the native OS directory selection dialog and loads the workspace into Explorer.
   * Resolves the selected path, updates workspaceRoot, and emits workspace:ready asynchronously.
   * Completely non-blocking on the Main Event loop.
   */
  public async openFolderDialog(customWindow?: BrowserWindow | null): Promise<IpcResponse<string>> {
    try {
      const win = customWindow || BrowserWindow.getFocusedWindow() || this.mainWindow || undefined;
      const { dialog } = await import('electron');
      const dialogOptions = {
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
        title: 'Select Project Directory'
      };
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, error: 'User canceled directory selection' };
      }

      const selectedPath = path.resolve(result.filePaths[0]);
      const openResult = await this.openWorkspace(selectedPath);
      if (!openResult.success) {
        return { success: false, error: openResult.error };
      }

      return { success: true, data: selectedPath };
    } catch (err: unknown) {
      console.error('[WORKSPACE-MANAGER] openFolderDialog error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Handles opening a workspace folder: updates state, resets promise,
   * configures watcher, runs indexer, and resolves ready state.
   */
  public async openWorkspace(folderPath: string): Promise<{ success: boolean; error?: string }> {
    if (!folderPath) {
      return { success: false, error: 'Path is required' };
    }

    try {
      const resolved = path.resolve(folderPath);
      if (isAppOrSystemDir(resolved)) {
        return { success: false, error: 'Cannot open application or system directory as a workspace.' };
      }

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        return { success: false, error: `Directory does not exist: ${resolved}` };
      }

      if (!stat.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${resolved}` };
      }

      this.currentPath = resolved;
      this.resetWorkspacePromise();
      const scanId = ++this.activeScanId;

      // Update settings, recent workspaces, and AI services
      await settingsManager.setWorkspacePath(resolved);
      try {
        getRecentWorkspacesManager().addRecent(resolved);
      } catch {}
      try {
        updateAiServicesWorkspace(resolved);
      } catch {}

      // Setup file system watcher
      setupWorkspaceWatcher(resolved, (type, relPath) => {
        this.broadcast('fs:tree-updated', { type, relPath });
      });

      // Notify all renderers of folder change so Explorer begins loading
      this.broadcast('window:open-folder', { folderPath: resolved });

      // Index the workspace via chunked scanner (non-blocking)
      await getWorkspaceTreeChunked(resolved, (chunk, isComplete, totalSoFar) => {
        if (scanId !== this.activeScanId) return; // Stale scan superseded by a new one
        this.broadcast('fs:tree-chunk', {
          entries: chunk,
          isComplete,
          totalSoFar
        });
        if (isComplete) {
          this.setWorkspaceReady(resolved);
        }
      });

      return { success: true };
    } catch (err: any) {
      console.error('[WORKSPACE-MANAGER] Failed to open workspace:', err);
      return { success: false, error: err?.message || String(err) };
    }
  }
}

export const workspaceManager = new WorkspaceManager();
