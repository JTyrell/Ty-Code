/**
 * FCC Embedded Core Orchestration Service (Phase FCC-1)
 *
 * Implements the baked-in FCC supply layer:
 * - Packages and runs FCC server component per FCC-0 mode over local loopback (127.0.0.1:8082)
 * - Auto-starts at boot Tier-2 (non-blocking) with real-time health ping and SHA-256 integrity check
 * - Maintains an in-memory circular log buffer for the admin logs viewer
 * - Surfaces full lifecycle controls: running/stopped/restart, disable toggle
 * - Automatic fallback: when FCC is unavailable, sets status to 'FCC offline — native supply active'
 *   and gracefully routes to native provider registry and OpenKilo anonymous gateway
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import http from 'http';
import { fccManager, type FCCServerStatus } from '../orchestration/fcc-manager';
import { fccIntegrityChecker, type FCCIntegrityReport } from '../orchestration/fcc-integrity';
import { fccCatalogSync, type FCCProviderHealthInfo } from './catalog-sync';

export interface FCCLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface FCCFleetSummary {
  running: boolean;
  health: 'healthy' | 'degraded' | 'stopped';
  statusText: string;
  port: number;
  version: string;
  providersCount: number;
  healthyProvidersCount: number;
  degradedProvidersCount: number;
  stoppedProvidersCount: number;
  totalFreeModels: number;
  aggregateFreeTokens: number;
  usedTokens: number;
  integrityStatus: FCCIntegrityReport['status'];
  fallbackActive: boolean;
}

export class FCCEmbeddedCore {
  private static instance: FCCEmbeddedCore | null = null;
  private logBuffer: FCCLogEntry[] = [];
  private readonly maxLogLines = 500;
  private bootCompleted = false;
  private bootTimestamp = 0;

  private constructor() {
    this.addLog('info', 'FCC Embedded Core initialized per FCC-0 decoupled process mode.');
  }

  public static getInstance(): FCCEmbeddedCore {
    if (!FCCEmbeddedCore.instance) {
      FCCEmbeddedCore.instance = new FCCEmbeddedCore();
    }
    return FCCEmbeddedCore.instance;
  }

  /**
   * Appends an entry to the circular log buffer.
   */
  public addLog(level: 'info' | 'warn' | 'error', message: string): void {
    const entry: FCCLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
  }

  /**
   * Retrieves the current log entries.
   */
  public getLogs(): string[] {
    return this.logBuffer.map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`);
  }

  /**
   * Clears the log buffer.
   */
  public clearLogs(): void {
    this.logBuffer = [];
    this.addLog('info', 'Log buffer cleared by user.');
  }

  /**
   * Non-blocking Tier-2 boot initialization.
   * Auto-starts the FCC server and runs initial integrity and health checks.
   */
  public async initBootTier2(): Promise<FCCServerStatus> {
    this.bootTimestamp = Date.now();
    this.addLog('info', 'Tier-2 boot: Initializing FCC Free Model Supply Layer...');

    // 1. Run cryptographic integrity verification
    try {
      const integrityReport = await fccIntegrityChecker.verifyBootIntegrity();
      if (!integrityReport.valid && integrityReport.code === 'INTEGRITY_MISMATCH') {
        this.addLog('error', `Boot verification failed: ${integrityReport.error}`);
        throw new Error(integrityReport.error);
      }
      this.addLog('info', `Integrity check status: ${integrityReport.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('error', `Integrity check exception: ${msg}`);
    }

    // 2. Start sidecar server if enabled
    if (!fccIntegrityChecker.isFccEnabled()) {
      this.addLog('warn', 'FCC layer is disabled by user settings. Operating on native/anonymous providers.');
      this.bootCompleted = true;
      return fccManager.getStatus();
    }

    try {
      const status = await fccManager.start({ port: 8082, autoRestart: true });
      this.bootCompleted = true;
      this.addLog('info', `FCC Sidecar listening on port ${status.port} (status: ${status.health}).`);
      return status;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('warn', `FCC server start note: ${msg}. Native registry and OpenKilo anonymous gateway active as automatic fallback.`);
      this.bootCompleted = true;
      return fccManager.getStatus();
    }
  }

  /**
   * Returns whether boot initialization has finished.
   */
  public isBootCompleted(): boolean {
    return this.bootCompleted;
  }

  /**
   * Retrieves comprehensive fleet dashboard summary.
   */
  public getFleetSummary(): FCCFleetSummary {
    const status = fccManager.getStatus();
    const providers = fccCatalogSync.getCatalog();

    const healthyCount = providers.filter((p) => p.enabled && p.health === 'healthy').length;
    const degradedCount = providers.filter((p) => p.enabled && p.health === 'degraded').length;
    const stoppedCount = providers.filter((p) => !p.enabled || p.health === 'stopped').length;
    const totalFreeModels = fccCatalogSync.getFreeModelsCount();
    const aggregateFreeTokens = fccCatalogSync.getAggregateFreeTokens();

    const isFccOffline = !status.running || status.health === 'stopped' || !fccIntegrityChecker.isFccEnabled();
    const statusText = isFccOffline
      ? 'FCC offline — native supply active'
      : status.health === 'healthy'
      ? 'Active & Healthy'
      : 'Degraded';

    return {
      running: status.running && fccIntegrityChecker.isFccEnabled(),
      health: status.health,
      statusText,
      port: status.port,
      version: status.version,
      providersCount: providers.length,
      healthyProvidersCount: healthyCount,
      degradedProvidersCount: degradedCount,
      stoppedProvidersCount: stoppedCount,
      totalFreeModels,
      aggregateFreeTokens,
      usedTokens: status.freeTokensUsed,
      integrityStatus: status.integrityStatus || 'unverified',
      fallbackActive: isFccOffline
    };
  }

  /**
   * Starts the FCC server layer.
   */
  public async start(): Promise<FCCServerStatus> {
    this.addLog('info', 'Starting FCC sidecar server...');
    const status = await fccManager.start();
    this.addLog('info', `FCC sidecar started: health=${status.health}, port=${status.port}`);
    return status;
  }

  /**
   * Stops the FCC server layer.
   */
  public async stop(): Promise<void> {
    this.addLog('warn', 'Stopping FCC sidecar server. Falling back to native/anonymous providers.');
    await fccManager.stop();
    this.addLog('info', 'FCC sidecar stopped. Native supply layer active.');
  }

  /**
   * Restarts the FCC server layer.
   */
  public async restart(): Promise<FCCServerStatus> {
    this.addLog('info', 'Restarting FCC sidecar server...');
    const status = await fccManager.restart();
    this.addLog('info', `FCC sidecar restarted: health=${status.health}, port=${status.port}`);
    return status;
  }

  /**
   * Enables or disables the FCC layer entirely.
   */
  public setEnabled(enabled: boolean): void {
    this.addLog(enabled ? 'info' : 'warn', `FCC layer ${enabled ? 'enabled' : 'disabled'} by user setting.`);
    fccManager.setEnabled(enabled);
  }

  /**
   * Tests connectivity to a specific provider.
   */
  public async testProvider(providerId: string): Promise<{ providerId: string; success: boolean; latencyMs: number; error?: string }> {
    const startTime = performance.now();
    const provider = fccCatalogSync.getProvider(providerId);

    if (!provider) {
      return { providerId, success: false, latencyMs: 0, error: 'Provider not found in FCC catalog' };
    }

    this.addLog('info', `Testing provider connectivity: ${provider.name} (${provider.defaultEndpoint})...`);

    // For local providers, check loopback endpoint
    if (provider.category === 'local') {
      try {
        const res = await fetch(provider.defaultEndpoint.replace(/\/v1$/, ''), {
          method: 'GET',
          signal: AbortSignal.timeout(1500)
        });
        const latencyMs = Math.round(performance.now() - startTime);
        const success = res.ok || res.status === 404; // 404 on root is responsive server
        fccCatalogSync.updateProviderHealth(providerId, success ? 'healthy' : 'stopped', latencyMs);
        this.addLog('info', `Provider ${provider.name} test complete: ${success ? 'OK' : 'FAIL'} (${latencyMs}ms)`);
        return { providerId, success, latencyMs };
      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - startTime);
        fccCatalogSync.updateProviderHealth(providerId, 'stopped', latencyMs);
        return { providerId, success: false, latencyMs, error: 'Local service is not running on target port.' };
      }
    }

    // For remote providers, ping health endpoint or check reachability
    try {
      const pingUrl = provider.defaultEndpoint;
      const res = await fetch(pingUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2500)
      }).catch(() => fetch(pingUrl, { method: 'GET', signal: AbortSignal.timeout(2500) }));

      const latencyMs = Math.round(performance.now() - startTime);
      const success = res !== undefined && res.status < 500;
      fccCatalogSync.updateProviderHealth(providerId, success ? 'healthy' : 'degraded', latencyMs);
      this.addLog('info', `Provider ${provider.name} ping result: HTTP ${res?.status || 'ERR'} (${latencyMs}ms)`);
      return { providerId, success, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      fccCatalogSync.updateProviderHealth(providerId, 'degraded', latencyMs);
      return {
        providerId,
        success: false,
        latencyMs,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Toggles a provider on/off in the catalog.
   */
  public toggleProvider(providerId: string, enabled: boolean): { providerId: string; enabled: boolean } {
    fccCatalogSync.setProviderEnabled(providerId, enabled);
    this.addLog('info', `Provider ${providerId} ${enabled ? 'enabled' : 'disabled'}.`);
    return { providerId, enabled };
  }
}

export const fccEmbeddedCore = FCCEmbeddedCore.getInstance();
