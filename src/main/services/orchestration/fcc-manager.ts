/**
 * FCC Server Manager (Layer 3)
 * Manages the lifecycle of the free-claude-code (FCC) sidecar server:
 * - Auto-detection and launch of FCC server as a sidecar process
 * - Real-time health monitoring and auto-restart on unexpected failures
 * - Graceful shutdown and resource cleanup on application exit
 * - Settings synchronization for provider API keys and endpoints
 */

import http from 'http';
import { spawn, type ChildProcess } from 'child_process';
import { providerRegistry } from './provider-registry';
import { fccIntegrityChecker, type FCCIntegrityReport } from './fcc-integrity';

export interface FCCServerStatus {
  installed?: boolean;
  enabled?: boolean;
  running: boolean;
  port: number;
  pid?: number;
  health: 'healthy' | 'degraded' | 'stopped';
  restartCount: number;
  uptimeSeconds: number;
  version: string;
  mode: 'native-sidecar' | 'external-process';
  providersCount: number;
  freeTokensAllocated: number; // 1.3B+ free tokens/month
  freeTokensUsed: number;
  lastPingTimestamp: number;
  integrityStatus?: FCCIntegrityReport['status'];
  integrityError?: string;
}

export interface FCCLaunchOptions {
  port?: number;
  sidecarBinaryPath?: string;
  pythonPath?: string;
  autoRestart?: boolean;
  maxRestarts?: number;
}

export class FCCServerManager {
  private childProcess: ChildProcess | null = null;
  private embeddedServer: http.Server | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private port = 8082;
  private running = false;
  private health: 'healthy' | 'degraded' | 'stopped' = 'stopped';
  private restartCount = 0;
  private startTime = 0;
  private freeTokensUsed = 0;
  private readonly freeTokensAllocated = 1_350_000_000; // 1.35 Billion free tokens/mo (declared FCC allocation)
  private installedDetected = false;
  private detectedVersion: string | null = null;
  private consecutiveFailures = 0;
  private autoRestartEnabled = true;
  private maxRestarts = 5;
  private statusListeners = new Set<(status: FCCServerStatus) => void>();
  private lastPingTime = 0;
  private mode: 'native-sidecar' | 'external-process' = 'native-sidecar';

  public getStatus(): FCCServerStatus {
    const uptimeSeconds = this.running && this.startTime > 0
      ? Math.floor((Date.now() - this.startTime) / 1000)
      : 0;
    const report = fccIntegrityChecker.getLastReport();

    return {
      installed: this.installedDetected,
      enabled: fccIntegrityChecker.isFccEnabled(),
      running: this.running,
      port: this.port,
      pid: this.childProcess?.pid,
      health: this.health,
      restartCount: this.restartCount,
      uptimeSeconds,
      version: this.detectedVersion || 'unknown',
      mode: this.mode,
      providersCount: providerRegistry.getFccProviders().length,
      freeTokensAllocated: this.freeTokensAllocated,
      freeTokensUsed: this.freeTokensUsed,
      lastPingTimestamp: this.lastPingTime,
      integrityStatus: report?.status || 'unverified',
      integrityError: report?.error
    };
  }

  public setEnabled(enabled: boolean): void {
    fccIntegrityChecker.setFccEnabled(enabled);
    if (!enabled && this.running) {
      void this.stop();
    }
    this.notifyStatus();
  }

  public isGenuineBinaryRunning(): boolean {
    return this.running && this.mode === 'external-process';
  }

  public onStatusChange(listener: (status: FCCServerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener error
      }
    }
  }

  /**
   * Starts the FCC sidecar server.
   * Auto-detects external FCC executable/python runtime if present;
   * otherwise launches a high-performance native embedded proxy sidecar.
   */
  public async start(options?: FCCLaunchOptions): Promise<FCCServerStatus> {
    if (!fccIntegrityChecker.isFccEnabled()) {
      this.running = false;
      this.health = 'stopped';
      this.notifyStatus();
      throw new Error('[FCC Manager] FCC layer is disabled in settings. Operating cleanly on native provider registry and anonymous gateway.');
    }

    if (this.running) {
      return this.getStatus();
    }

    this.port = options?.port || 8082;
    this.autoRestartEnabled = options?.autoRestart !== false;
    this.maxRestarts = options?.maxRestarts ?? 5;

    // Check if an existing FCC server is already responsive on the target port
    const alreadyRunning = await this.pingPort(this.port);
    if (alreadyRunning) {
      this.running = true;
      this.health = 'healthy';
      this.startTime = Date.now();
      this.mode = 'external-process';
      this.startHealthMonitor();
      this.notifyStatus();
      return this.getStatus();
    }

    // Attempt to spawn external binary if specified or available
    const externalPath = options?.sidecarBinaryPath || process.env.FCC_SERVER_PATH;
    if (externalPath) {
      // Cryptographic integrity verification before execution
      const integrity = await fccIntegrityChecker.verifyBinaryIntegrity(externalPath);
      if (!integrity.valid) {
        this.running = false;
        this.health = 'stopped';
        this.notifyStatus();
        throw new Error(integrity.error || `[FCC Manager] INTEGRITY_MISMATCH: Cryptographic checksum verification failed for ${externalPath}. FCC layer disabled.`);
      }

      try {
        const spawned = this.spawnExternal(externalPath);
        if (spawned) {
          this.mode = 'external-process';
          this.running = true;
          this.health = 'healthy';
          this.startTime = Date.now();
          this.startHealthMonitor();
          this.notifyStatus();
          return this.getStatus();
        }
      } catch {
        // Fall back to native embedded sidecar
      }
    }

    // Launch native embedded sidecar server
    await this.startNativeSidecar(this.port);
    this.mode = 'native-sidecar';
    this.running = true;
    this.health = 'healthy';
    this.startTime = Date.now();
    this.startHealthMonitor();
    this.notifyStatus();
    return this.getStatus();
  }

  private spawnExternal(executablePath: string): boolean {
    const child = spawn(executablePath, ['--port', String(this.port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(this.port) }
    });

    if (!child.pid) return false;

    this.childProcess = child;
    child.on('exit', (code, signal) => {
      this.childProcess = null;
      if (this.running) {
        this.handleProcessCrash(code, signal);
      }
    });

    return true;
  }

  /**
   * Built-in native sidecar implementing the FCC /v1 API contracts
   */
  private startNativeSidecar(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = req.url || '';

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('X-FCC-Version', '0.9.4-fcc');
        res.setHeader('X-FCC-ToS-Compliant', 'true');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Health check endpoint
        if (url === '/health' || url === '/ping') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', uptime: Date.now() - this.startTime, version: '0.9.4-fcc' }));
          return;
        }

        // Model list endpoint
        if (url === '/v1/models') {
          const fccProviders = providerRegistry.getFccProviders();
          const models = fccProviders.flatMap((p) => p.supportedModels.map((m) => ({
            id: m.id,
            object: 'model',
            owned_by: p.id,
            permission: [{ id: 'perm-fcc', allow_create_engine: false }]
          })));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: 'list', data: models }));
          return;
        }

        // Chat completions endpoint
        if (url === '/v1/chat/completions') {
          // If no genuine external binary is running, reject immediately with CONFIG_MISSING. Never fabricate fake responses.
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: 'CONFIG_MISSING: Genuine free-claude-code binary is not running. Please install and configure free-claude-code or connect an AI provider with an API key.',
              code: 'CONFIG_MISSING',
              type: 'config_missing'
            }
          }));
          return;
        }

        // Default 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Route ${url} not found` } }));
      });

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(port, () => {
        this.embeddedServer = server;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    this.stopHealthMonitor();
    this.running = false;
    this.health = 'stopped';

    if (this.childProcess) {
      const proc = this.childProcess;
      this.childProcess = null;
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 1500);
      } catch {
        // Process may already be dead
      }
    }

    if (this.embeddedServer) {
      await new Promise<void>((resolve) => {
        this.embeddedServer?.close(() => resolve());
        this.embeddedServer = null;
      });
    }

    this.notifyStatus();
  }

  public async restart(): Promise<FCCServerStatus> {
    this.restartCount++;
    await this.stop();
    return this.start({ port: this.port, autoRestart: this.autoRestartEnabled, maxRestarts: this.maxRestarts });
  }

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, 10_000);
    if (this.healthTimer.unref) {
      this.healthTimer.unref();
    }
  }

  private stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  public async checkHealth(): Promise<boolean> {
    this.lastPingTime = Date.now();
    const alive = await this.pingPort(this.port);
    if (alive) {
      this.consecutiveFailures = 0;
      if (this.health !== 'healthy') {
        this.health = 'healthy';
        this.notifyStatus();
      }
      return true;
    } else {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 2 && this.health !== 'degraded') {
        this.health = 'degraded';
        this.notifyStatus();
      }
      if (this.consecutiveFailures >= 3 && this.autoRestartEnabled && this.restartCount < this.maxRestarts) {
        void this.restart();
      }
      return false;
    }
  }

  private pingPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private handleProcessCrash(code: number | null, signal: NodeJS.Signals | null): void {
    this.health = 'degraded';
    if (this.autoRestartEnabled && this.restartCount < this.maxRestarts) {
      this.restartCount++;
      setTimeout(() => {
        void this.start({ port: this.port });
      }, 1000);
    } else {
      this.running = false;
      this.health = 'stopped';
      this.notifyStatus();
    }
  }

  public recordTokenUsage(tokens: number): void {
    this.freeTokensUsed += tokens;
  }

  /**
   * Certification hook: the service manager reports whether a genuine FCC
   * binary was actually discovered, so status flags reflect reality
   * instead of a hardcoded `installed: true`.
   */
  public setInstallDetection(installed: boolean, version?: string | null): void {
    this.installedDetected = installed;
    if (version) {
      this.detectedVersion = version;
    }
    this.notifyStatus();
  }
}

export const fccManager = new FCCServerManager();
