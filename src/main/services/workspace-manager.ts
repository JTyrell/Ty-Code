import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getWorkspaceTreeChunked, setupWorkspaceWatcher } from '../ipc/fs-handlers';
import { settingsManager } from './settings-manager';
import { getRecentWorkspacesManager } from './recent-workspaces';
import { updateAiServicesWorkspace } from '../ipc/ai-features-handlers';

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

  public get isWorkspaceReady(): boolean {
    return this.isReady;
  }

  public get workspaceReadyPromise(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Resets the workspace readiness promise when a new folder begins indexing.
   */
  public resetWorkspacePromise(): void {
    this.isReady = false;
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReadyPromise = resolve;
    });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('workspace:status', {
        path: this.currentPath,
        isReady: false
      });
    }
  }

  /**
   * Resolves the workspace ready promise and emits the workspace:ready IPC event.
   */
  public setWorkspaceReady(workspacePath: string): void {
    this.isReady = true;
    this.resolveReadyPromise();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('workspace:ready', { path: workspacePath });
      this.mainWindow.webContents.send('workspace:status', {
        path: workspacePath,
        isReady: true
      });
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
      if (!fsSync.existsSync(resolved)) {
        return { success: false, error: `Directory does not exist: ${resolved}` };
      }
      const stat = await fs.stat(resolved);
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
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('fs:tree-updated', { type, relPath });
        }
      });

      // Notify renderer of folder change so Explorer begins loading
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window:open-folder', { folderPath: resolved });
      }

      // Index the workspace via chunked scanner
      await getWorkspaceTreeChunked(resolved, (chunk, isComplete, totalSoFar) => {
        if (scanId !== this.activeScanId) return; // Stale scan superseded by a new one
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('fs:tree-chunk', {
            entries: chunk,
            isComplete,
            totalSoFar
          });
        }
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
