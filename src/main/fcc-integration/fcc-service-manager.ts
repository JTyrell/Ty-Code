/**
 * FCC Service Manager
 * Higher-level lifecycle orchestrator around FCCServerManager:
 * - Detects a genuine free-claude-code binary at launch (also after install)
 * - Adopts an already-running FCC server, or spawns the real binary via
 *   FCCServerManager with integrity verification
 * - Bridges combined service state (install progress + server status) to
 *   the renderer so failures surface as actionable Retry / View Logs
 */

import { fccManager } from '../services/orchestration/fcc-manager';
import {
  FCCInstaller,
  discoverFccBinary,
  discoverWrapperCommands,
  type FccInstallProgress,
  type FccInstallResult
} from './fcc-installer';

export interface FCCServiceStatus {
  installed: boolean;
  binaryPath: string | null;
  wrapperCommandsAvailable: string[];
  installing: boolean;
  installProgress: FccInstallProgress | null;
  lastError: string | null;
}

export class FCCServiceManager {
  private installer = new FCCInstaller();
  private binaryPath: string | null = null;
  private lastInstallProgress: FccInstallProgress | null = null;
  private lastError: string | null = null;
  private adoptAttempted = false;
  private ensureRunningPromise: Promise<void> | null = null;
  private stateListeners = new Set<(status: FCCServiceStatus) => void>();

  constructor() {
    fccManager.onStatusChange(() => this.notifyState());
    void discoverFccBinary().then((found) => {
      if (found) {
        this.binaryPath = found;
        fccManager.setInstallDetection(true);
      }
      this.notifyState();
    });
  }

  public getStatus(): FCCServiceStatus {
    return {
      installed: Boolean(this.binaryPath),
      binaryPath: this.binaryPath,
      wrapperCommandsAvailable: discoverWrapperCommands(this.binaryPath),
      installing: this.installer.isInstalling(),
      installProgress: this.lastInstallProgress,
      lastError: this.lastError
    };
  }

  public onServiceState(listener: (status: FCCServiceStatus) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyState(): void {
    const status = this.getStatus();
    for (const listener of this.stateListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener error
      }
    }
  }

  /**
   * Boot-time task: detect the real FCC binary and make sure the sidecar
   * layer is serving traffic through it. Falls back cleanly to the native
   * sidecar / anonymous gateway when no binary is present.
   */
  public async ensureRunning(): Promise<void> {
    if (!this.ensureRunningPromise) {
      this.ensureRunningPromise = this.doEnsureRunning().finally(() => {
        this.ensureRunningPromise = null;
      });
    }
    return this.ensureRunningPromise;
  }

  private async doEnsureRunning(): Promise<void> {
    const detected = await discoverFccBinary();
    if (detected && !this.binaryPath) this.binaryPath = detected;
    fccManager.setInstallDetection(Boolean(this.binaryPath));
    this.notifyState();

    const server = fccManager.getStatus();
    if (!server.enabled) {
      return;
    }

    if (!server.running) {
      await this.startWithBinary();
      return;
    }

    if (server.mode === 'native-sidecar' && !this.adoptAttempted) {
      this.adoptAttempted = true;
      if (this.binaryPath) {
        await this.replaceNativeWithBinary();
      }
    }
    this.notifyState();
  }

  private async startWithBinary(): Promise<void> {
    try {
      await fccManager.start({
        port: 8082,
        sidecarBinaryPath: this.binaryPath || undefined,
        autoRestart: true
      });
      this.lastError = null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.binaryPath && msg.includes('disabled')) {
        return;
      }
      this.lastError = msg;
    }
    this.notifyState();
  }

  private async replaceNativeWithBinary(): Promise<void> {
    try {
      await fccManager.stop();
      await fccManager.start({
        port: 8082,
        sidecarBinaryPath: this.binaryPath || undefined,
        autoRestart: true
      });
      this.lastError = null;
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.notifyState();
  }

  /** Install FCC via the official scripts, then bring the service up. */
  public async install(
    onProgress: (progress: FccInstallProgress) => void,
    signal?: AbortSignal
  ): Promise<FccInstallResult> {
    const result = await this.installer.install(onProgress, signal);
    if (result.binaryPath) {
      this.binaryPath = result.binaryPath;
      fccManager.setInstallDetection(true);
    }
    this.lastError = result.error || null;
    if (result.success) {
      this.adoptAttempted = false;
      await this.ensureRunning();
    }
    this.notifyState();
    return result;
  }

  /** Resilience hook for the renderer's Retry action. */
  public async retry(): Promise<FCCServiceStatus> {
    this.lastError = null;
    this.adoptAttempted = false;
    await this.ensureRunning();
    return this.getStatus();
  }

  public dispose(): void {
    this.stateListeners.clear();
    void fccManager.stop().catch(() => {
      // Best-effort shutdown; process may already be exiting
    });
  }
}

export const fccServiceManager = new FCCServiceManager();
