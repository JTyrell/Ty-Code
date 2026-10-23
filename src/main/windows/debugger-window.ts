/**
 * Omni-Debugger Pop-Out Window Orchestrator & State Synchronization Manager
 *
 * Requirements:
 * 1. Mirror the openSketcherWindow() / openCanvasWindow() pattern from Ty-Code.
 * 2. Create a BrowserWindow with:
 *    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
 * 3. Load the app with the '#debugger' hash route.
 * 4. Implement debuggerSyncManager to sync state between the main window and the debugger window via IPC.
 */

import { app, BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runFullAnalysis } from '../services/debugger-orchestrator';
import { debuggerModelRouter, type DebuggerModelPreferences } from '../services/debugger-engines/debugger-model-router';

export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AnalysisEngine = 'static' | 'dynamic' | 'arch' | 'ai';
export type AnalysisRole = 'dev' | 'qa' | 'pm';

export interface AnalysisResult {
  id: string;
  severity: AnalysisSeverity;
  engine: AnalysisEngine;
  role: AnalysisRole;
  message: string;
  line?: number;
  codeSnippet?: string;
  filePath?: string;
  ruleId?: string;
  suggestedFix?: string;
  timestamp?: number;
}

export interface DebuggerStateSnapshot {
  activeFile: string | null;
  analysisResults: AnalysisResult[];
  isPopOutMode: boolean;
  selectedRole: AnalysisRole;
  updatedAt: number;
}

export interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type TrustedSenderCheck = (event: IpcMainInvokeEvent) => boolean;

// ---------------------------------------------------------------------------
// DebuggerSyncManager: Multi-Window Synchronization & Analysis Engine
// ---------------------------------------------------------------------------
export class DebuggerSyncManager {
  private activeFile: string | null = null;
  private analysisResults: AnalysisResult[] = [];
  private isPopOutMode = true;
  private selectedRole: AnalysisRole = 'dev';
  private updatedAt = Date.now();
  private windowResolver: (() => WebContents[]) | null = null;
  private isTrustedSender: TrustedSenderCheck | null = null;
  private registered = false;

  attachWindowResolver(resolver: () => WebContents[]): void {
    this.windowResolver = resolver;
  }

  setTrustedSenderCheck(check: TrustedSenderCheck): void {
    this.isTrustedSender = check;
  }

  getSnapshot(): DebuggerStateSnapshot {
    return {
      activeFile: this.activeFile,
      analysisResults: [...this.analysisResults],
      isPopOutMode: this.isPopOutMode,
      selectedRole: this.selectedRole,
      updatedAt: this.updatedAt
    };
  }

  setPopOutMode(popOut: boolean, exclude?: WebContents): void {
    this.isPopOutMode = popOut;
    this.updatedAt = Date.now();
    this.broadcast('debugger:state-synced', this.getSnapshot(), exclude);
  }

  applyUpdate(partial: Partial<DebuggerStateSnapshot>): void {
    if (partial.activeFile !== undefined) this.activeFile = partial.activeFile;
    if (partial.analysisResults !== undefined) this.analysisResults = partial.analysisResults;
    if (partial.isPopOutMode !== undefined) this.isPopOutMode = partial.isPopOutMode;
    if (partial.selectedRole !== undefined) this.selectedRole = partial.selectedRole;
    this.updatedAt = Date.now();
  }

  pushStateUpdate(partial: Partial<DebuggerStateSnapshot>, exclude?: WebContents): DebuggerStateSnapshot {
    this.applyUpdate(partial);
    const snapshot = this.getSnapshot();
    this.broadcast('debugger:state-synced', snapshot, exclude);
    return snapshot;
  }

  pushResults(results: AnalysisResult[], exclude?: WebContents): void {
    this.analysisResults = results;
    this.updatedAt = Date.now();
    this.broadcast('debugger:update', results, exclude);
    this.broadcast('debugger:state-synced', this.getSnapshot(), exclude);
  }

  /**
   * Run full diagnostics sweep across requested file/module or entire project.
   *
   * Delegates to the debugger-orchestrator, which spawns the static (AST),
   * dynamic (sandboxed fork), and architectural engines in parallel worker
   * threads, aggregates + dedupes their findings, and returns the payload.
   * The sweep is entirely real: worker threads parse the target file with the
   * TypeScript compiler API, the sandbox forks an isolated Node child, and the
   * arch engine walks the dependency graph on disk. The manager broadcasts the
   * aggregated results once (pushResults) so renderer windows receive
   * 'debugger:update' plus a uniform 'debugger:state-synced' snapshot.
   */
  async runAnalysis(filePath?: string, role?: AnalysisRole): Promise<AnalysisResult[]> {
    if (role) {
      this.selectedRole = role;
      this.updatedAt = Date.now();
    }

    const requested = filePath || this.activeFile || undefined;

    let results: AnalysisResult[];
    try {
      const payload = await runFullAnalysis(requested, {
        broadcast: false,
        role: this.selectedRole,
        // Engines + AI insights push into the snapshot at both stages so the
        // renderer sees engine findings instantly and AI insights live.
        onResultsSnapshot: (snapshot) => {
          this.pushResults(snapshot);
        },
        // AI analyst token relay: keyword-level frames flow to every debugger
        // window in real time while the model is still generating.
        onRoleReportToken: (frame) => {
          this.broadcast('debugger:ai-stream', frame);
        }
      });
      results = payload.results;
    } catch (error) {
      results = [
        {
          id: `debugger-orchestrator-failure:${Date.now()}`,
          severity: 'medium',
          engine: 'static',
          role: this.selectedRole,
          message: `Full analysis sweep failed: ${error instanceof Error ? error.message : String(error)}`,
          filePath: requested,
          ruleId: 'debugger-orchestrator-failure',
          suggestedFix: 'Re-run the sweep; if the failure persists, check the main process console for engine diagnostics.',
          timestamp: Date.now()
        }
      ];
      this.pushResults(results);
    }

    return results;
  }

  private broadcast(channel: string, payload: unknown, exclude?: WebContents): void {
    let targets: WebContents[] = [];
    try {
      if (this.windowResolver) {
        targets = this.windowResolver();
      } else {
        targets = BrowserWindow.getAllWindows().map((w) => w.webContents);
      }
    } catch {
      targets = [];
    }

    for (const wc of targets) {
      try {
        if (wc.isDestroyed() || wc === exclude) continue;
        wc.send(channel, payload);
      } catch {
        // Safe skip if window is closing
      }
    }
  }

  registerIpcHandlers(
    ipcMain: IpcMain,
    options?: { isTrustedSender?: TrustedSenderCheck }
  ): void {
    if (this.registered) return;
    this.registered = true;
    if (options?.isTrustedSender) {
      this.isTrustedSender = options.isTrustedSender;
    }

    // 1. Open Pop-Out Window
    ipcMain.handle('debugger:open-window', async (event): Promise<IpcResult<boolean>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        openDebuggerWindow();
        return { success: true, data: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // 2. Close Pop-Out Window
    ipcMain.handle('debugger:close-window', async (event): Promise<IpcResult<boolean>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        closeDebuggerWindow();
        return { success: true, data: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // 3. Sync State between windows
    ipcMain.handle('debugger:sync-state', async (event, rawPayload: unknown): Promise<IpcResult<DebuggerStateSnapshot>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        if (typeof rawPayload === 'object' && rawPayload !== null) {
          const snapshot = this.pushStateUpdate(rawPayload as Partial<DebuggerStateSnapshot>, event.sender);
          return { success: true, data: snapshot };
        }
        return { success: false, error: 'Payload must be an object' };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // 4. Request initial State snapshot
    ipcMain.handle('debugger:request-state', async (event): Promise<IpcResult<DebuggerStateSnapshot>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      return { success: true, data: this.getSnapshot() };
    });

    // 5. Run Full Analysis sweep
    ipcMain.handle('debugger:run-analysis', async (event, rawPayload: unknown): Promise<IpcResult<AnalysisResult[]>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as {
          filePath?: string;
          role?: AnalysisRole;
        };
        const results = await this.runAnalysis(payload.filePath, payload.role);
        return { success: true, data: results };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // 6. Get Debugger Model Preferences
    ipcMain.handle('debugger:get-model-preferences', async (event): Promise<IpcResult<DebuggerModelPreferences>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      return { success: true, data: debuggerModelRouter.getDebuggerModelPreferences() };
    });

    // 7. Set Debugger Model Mode (Auto vs Manual)
    ipcMain.handle('debugger:set-model-mode', async (event, rawPayload: unknown): Promise<IpcResult<DebuggerModelPreferences>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as {
          mode: 'auto' | 'manual';
          modelId?: string;
          providerId?: string;
        };
        const prefs = debuggerModelRouter.setDebuggerModelPreferences(
          payload.mode || 'auto',
          payload.modelId,
          payload.providerId
        );
        this.broadcast('debugger:model-preferences-changed', prefs);
        return { success: true, data: prefs };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // 8. Get Debugger Task Model Selections (Current resolved models per task)
    ipcMain.handle('debugger:get-task-models', async (event): Promise<IpcResult<any>> => {
      if (this.isTrustedSender && !this.isTrustedSender(event)) {
        return { success: false, error: 'Untrusted renderer frame.' };
      }
      try {
        const models = await debuggerModelRouter.getAllTaskModelSelections();
        return { success: true, data: models };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }
}

export const debuggerSyncManager = new DebuggerSyncManager();

// ---------------------------------------------------------------------------
// Pop-Out Window Orchestration
// ---------------------------------------------------------------------------
let debuggerWindow: BrowserWindow | null = null;

export function getDebuggerWindow(): BrowserWindow | null {
  return debuggerWindow;
}

export function closeDebuggerWindow(): void {
  if (debuggerWindow && !debuggerWindow.isDestroyed()) {
    debuggerWindow.close();
    debuggerWindow = null;
  }
  debuggerSyncManager.setPopOutMode(false);
}

/**
 * Creates and opens the dedicated pop-out window for Omni-Debugger.
 * Strictly adheres to Electron BrowserWindow API without window.open().
 */
export function openDebuggerWindow(): BrowserWindow {
  if (debuggerWindow && !debuggerWindow.isDestroyed()) {
    if (debuggerWindow.isMinimized()) debuggerWindow.restore();
    debuggerWindow.focus();
    debuggerSyncManager.setPopOutMode(true);
    return debuggerWindow;
  }

  const isMac = process.platform === 'darwin';

  // Resolve preload script: check 'preload.js' in __dirname or fallback to '../preload/index.js'
  const preloadCandidate = path.join(__dirname, 'preload.js');
  const preloadFallback = path.join(__dirname, '../preload/index.js');
  const resolvedPreload = fs.existsSync(preloadCandidate) ? preloadCandidate : preloadFallback;

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 620,
    title: 'Ty-Code - Omni-Debugger',
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#121316',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvedPreload,
      sandbox: true
    }
  });

  debuggerWindow = window;
  debuggerSyncManager.setPopOutMode(true);

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

  // Push immediate state snapshot once the window finishes loading
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try {
        const snapshot = debuggerSyncManager.getSnapshot();
        window.webContents.send('debugger:state-synced', snapshot);
      } catch {
        // Renderer also requests state on mount
      }
    }
  });

  // Load app with #debugger hash route
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}#debugger`);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'debugger' });
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  window.on('closed', () => {
    if (debuggerWindow === window) {
      debuggerWindow = null;
    }
    debuggerSyncManager.setPopOutMode(false);
  });

  return window;
}
