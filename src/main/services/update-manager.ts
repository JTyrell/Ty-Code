import { app, BrowserWindow } from 'electron';
import type { AppUpdater } from 'electron-updater';

export type UpdateChannel = 'stable' | 'beta' | 'nightly';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
}

export interface UpdateManagerOptions {
  /** Injectable updater and app metadata keep update behavior testable without network access. */
  updater?: AppUpdater | null;
  isPackaged?: boolean;
  currentVersion?: string;
}

export class UpdateManager {
  private updater: AppUpdater | null = null;
  private currentChannel: UpdateChannel = 'stable';
  private targetWindow: BrowserWindow | null = null;
  private isChecking = false;
  private isDownloading = false;
  private updateDownloaded = false;
  private readonly isPackagedOverride?: boolean;
  private readonly currentVersionOverride?: string;

  private get isAppPackaged(): boolean {
    return this.isPackagedOverride ?? Boolean(app?.isPackaged);
  }

  constructor(options: UpdateManagerOptions = {}) {
    this.isPackagedOverride = options.isPackaged;
    this.currentVersionOverride = options.currentVersion;
    if (Object.prototype.hasOwnProperty.call(options, 'updater')) {
      this.updater = options.updater || null;
      this.configureUpdater();
      return;
    }
    this.initUpdater();
  }

  private configureUpdater(): void {
    if (!this.updater) return;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.allowPrerelease = this.currentChannel !== 'stable';
    this.setupListeners();
  }

  private initUpdater(): void {
    try {
      // Dynamically require electron-updater
      const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater };
      this.updater = autoUpdater;
      this.configureUpdater();
    } catch (err) {
      console.warn('[UpdateManager] electron-updater not initialized or in test environment:', err);
      this.updater = null;
    }
  }

  public setWindow(window: BrowserWindow | null): void {
    this.targetWindow = window;
  }

  public getChannel(): UpdateChannel {
    return this.currentChannel;
  }

  public setChannel(channel: UpdateChannel): void {
    if (channel !== 'stable' && channel !== 'beta' && channel !== 'nightly') {
      throw new Error('Update channel must be stable, beta, or nightly.');
    }
    this.currentChannel = channel;
    if (this.updater) {
      this.updater.allowPrerelease = channel !== 'stable';
      if (channel === 'nightly') {
        this.updater.channel = 'nightly';
      } else if (channel === 'beta') {
        this.updater.channel = 'beta';
      } else {
        this.updater.channel = 'latest';
      }
    }
  }

  public async checkForUpdates(): Promise<UpdateCheckResult> {
    const currentVersion = this.currentVersionOverride || (app?.getVersion ? app.getVersion() : '1.0.0');

    if (this.isChecking) {
      return { updateAvailable: false, currentVersion, error: 'Update check already in progress' };
    }

    this.isChecking = true;
    this.sendToRenderer('update:checking', { channel: this.currentChannel });

    // In dev mode or without updater binary
    if (!this.updater || !this.isAppPackaged) {
      this.isChecking = false;
      this.sendToRenderer('update:not-available', { currentVersion });
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseNotes: 'Application is running in development mode.'
      };
    }

    try {
      const result = await this.updater.checkForUpdates();
      this.isChecking = false;

      if (result && result.updateInfo) {
        const hasUpdate = Boolean(result.isUpdateAvailable);
        const releaseNotes = typeof result.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : Array.isArray(result.updateInfo.releaseNotes)
          ? result.updateInfo.releaseNotes.map((n) => typeof n === 'string' ? n : n.note).join('\n')
          : undefined;

        if (hasUpdate) {
          this.sendToRenderer('update:available', {
            version: result.updateInfo.version,
            releaseNotes,
            releaseDate: result.updateInfo.releaseDate
          });
        } else {
          this.sendToRenderer('update:not-available', { currentVersion });
        }

        return {
          updateAvailable: hasUpdate,
          currentVersion,
          latestVersion: result.updateInfo.version,
          releaseNotes,
          releaseDate: result.updateInfo.releaseDate
        };
      }

      this.sendToRenderer('update:not-available', { currentVersion });
      return { updateAvailable: false, currentVersion };
    } catch (err) {
      this.isChecking = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { updateAvailable: false, currentVersion, error: errorMsg };
    }
  }

  public async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (this.isDownloading) {
      return { success: false, error: 'Download already in progress' };
    }

    if (!this.updater || !this.isAppPackaged) {
      // Simulate download for testing / dev environment
      this.isDownloading = true;
      let progress = 0;
      const timer = setInterval(() => {
        progress += 25;
        this.sendToRenderer('update:download-progress', {
          percent: progress,
          bytesPerSecond: 2_500_000,
          transferred: progress * 1_000_000,
          total: 100_000_000
        });
        if (progress >= 100) {
          clearInterval(timer);
          this.isDownloading = false;
          this.updateDownloaded = true;
          this.sendToRenderer('update:downloaded', { version: '0.2.0-simulated' });
        }
      }, 150);
      return { success: true };
    }

    try {
      this.isDownloading = true;
      await this.updater.downloadUpdate();
      return { success: true };
    } catch (err) {
      this.isDownloading = false;
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public quitAndInstall(): { success: boolean; error?: string } {
    if (!this.updater || !this.isAppPackaged) {
      console.log('[UpdateManager] Simulated quit and install in development mode.');
      return { success: true };
    }

    try {
      this.updater.quitAndInstall(false, true);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private setupListeners(): void {
    if (!this.updater) return;

    this.updater.on('download-progress', (progressObj) => {
      this.sendToRenderer('update:download-progress', {
        percent: Math.round(progressObj.percent),
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    });

    this.updater.on('update-downloaded', (info) => {
      this.isDownloading = false;
      this.updateDownloaded = true;
      this.sendToRenderer('update:downloaded', {
        version: info.version,
        releaseNotes: String(info.releaseNotes || '')
      });
    });

    this.updater.on('error', (err) => {
      const checkWillReportError = this.isChecking;
      this.isChecking = false;
      this.isDownloading = false;
      if (!checkWillReportError) this.sendToRenderer('update:error', { error: err.message });
    });
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    if (this.targetWindow && !this.targetWindow.isDestroyed()) {
      this.targetWindow.webContents.send(channel, payload);
    }
  }
}

let instance: UpdateManager | null = null;
export function getUpdateManager(): UpdateManager {
  if (!instance) {
    instance = new UpdateManager();
  }
  return instance;
}
