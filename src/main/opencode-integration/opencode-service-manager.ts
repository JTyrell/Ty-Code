/**
 * OpenCode Standard Supply Service Manager
 *
 * OpenCode's hosted free models are a STANDARD part of Ty-Code — baked into
 * the package, not an optional integration. At every boot this manager:
 *  1. Force-enables the OpenCode provider in the FCC catalog-sync supply
 *     layer (it can never be left disabled or absent).
 *  2. Probes the hosted OpenCode Zen endpoint (GET /v1/models, real fetch)
 *     and records real reachability + measured latency into the catalog.
 *  3. Detects a locally installed `opencode` CLI and adopts it for the
 *     agent-harness path when present (no download; hosted API is primary).
 *  4. Invalidates the chat gateway's verified-model cache so the baked-in
 *     OpenCode models are dispatchable immediately.
 */

import { spawnSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fccCatalogSync } from '../services/fcc/catalog-sync';
import { clearModelCache } from '../services/verified-models';

export const OPENCODE_HOSTED_ENDPOINT = 'https://api.opencode.ai/v1';
export const OPENKILO_HOSTED_ENDPOINT = 'https://api.kilo.ai/api/gateway';
export const OPENCODE_ZEN_FREE_MODELS: Array<{ id: string; name: string }> = [
  { id: 'grok-code', name: 'Grok Code (OpenCode Zen)' }
];

export interface OpenCodeServiceStatus {
  standardSupplyEnabled: boolean;
  hostedEndpoint: string;
  hostedReachable: boolean | null;
  hostedLatencyMs: number | null;
  kiloHostedEndpoint: string;
  kiloReachable: boolean | null;
  kiloLatencyMs: number | null;
  cliInstalled: boolean;
  cliPath: string | null;
  modelsInSupply: number;
  zenModelIds: string[];
  catalogEnabled: boolean;
  lastError: string | null;
  lastCheckedAt: number | null;
}

const PROBE_TIMEOUT_MS = 3500;

export class OpenCodeServiceManager {
  private cliPath: string | null = null;
  private hostedReachable: boolean | null = null;
  private hostedLatencyMs: number | null = null;
  private kiloReachable: boolean | null = null;
  private kiloLatencyMs: number | null = null;
  private lastError: string | null = null;
  private lastCheckedAt: number | null = null;
  private ensurePromise: Promise<void> | null = null;
  private stateListeners = new Set<(status: OpenCodeServiceStatus) => void>();

  public getStatus(): OpenCodeServiceStatus {
    const provider = fccCatalogSync.getProvider('opencode');
    const kilo = fccCatalogSync.getProvider('openkilo');
    return {
      standardSupplyEnabled: (provider?.enabled ?? false) && (kilo?.enabled ?? false),
      hostedEndpoint: OPENCODE_HOSTED_ENDPOINT,
      hostedReachable: this.hostedReachable,
      hostedLatencyMs: this.hostedLatencyMs,
      kiloHostedEndpoint: OPENKILO_HOSTED_ENDPOINT,
      kiloReachable: this.kiloReachable,
      kiloLatencyMs: this.kiloLatencyMs,
      cliInstalled: Boolean(this.cliPath),
      cliPath: this.cliPath,
      modelsInSupply: (provider?.models?.length || 0) + (kilo?.models?.length || 0),
      zenModelIds: OPENCODE_ZEN_FREE_MODELS.map((m) => m.id),
      catalogEnabled: provider?.enabled ?? false,
      lastError: this.lastError,
      lastCheckedAt: this.lastCheckedAt
    };
  }

  public onServiceState(listener: (status: OpenCodeServiceStatus) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyState(): void {
    const status = this.getStatus();
    for (const listener of this.stateListeners) {
      try {
        listener(status);
      } catch {
        // Listener failures must never break the supply guarantee
      }
    }
  }

  /** Boot task — idempotent. Guarantees the standard supply is live. */
  public async ensureStandardSupply(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = this.doEnsure().finally(() => {
        this.ensurePromise = null;
      });
    }
    return this.ensurePromise;
  }

  /** Manual refresh bridge for the renderer's Retry/Refresh action. */
  public async refresh(): Promise<OpenCodeServiceStatus> {
    this.lastError = null;
    await this.ensureStandardSupply();
    return this.getStatus();
  }

  private async doEnsure(): Promise<void> {
    // 1. Standard supply: BOTH hosted providers are ALWAYS enabled in the FCC layer.
    fccCatalogSync.setProviderEnabled('opencode', true);
    fccCatalogSync.setProviderEnabled('openkilo', true);

    // 2. Real probes of both hosted endpoints (any HTTP response proves live).
    const [zenProbe, kiloProbe] = await Promise.all([
      this.probeHostedEndpoint(OPENCODE_HOSTED_ENDPOINT),
      this.probeHostedEndpoint(OPENKILO_HOSTED_ENDPOINT)
    ]);
    this.hostedReachable = zenProbe.reachable;
    this.hostedLatencyMs = zenProbe.latencyMs;
    this.kiloReachable = kiloProbe.reachable;
    this.kiloLatencyMs = kiloProbe.latencyMs;
    fccCatalogSync.updateProviderHealth('opencode', zenProbe.reachable ? 'healthy' : 'untested', zenProbe.reachable ? zenProbe.latencyMs : undefined);
    fccCatalogSync.updateProviderHealth('openkilo', kiloProbe.reachable ? 'healthy' : 'untested', kiloProbe.reachable ? kiloProbe.latencyMs : undefined);

    // 3. Adopt a local opencode CLI if present (harness path, never required).
    this.cliPath = this.discoverOpencodeCli();

    // 4. Warm the chat gateway's model universe immediately.
    clearModelCache();

    this.lastCheckedAt = Date.now();
    this.notifyState();
  }

  private async probeHostedEndpoint(endpoint: string): Promise<{ reachable: boolean; latencyMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${endpoint.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'user-agent': 'Ty-Code-StandardSupply' }
      });
      // 401/403 still prove the host is live — only transport failures fail.
      const reachable = !!response && response.status < 500;
      return { reachable, latencyMs: Date.now() - startedAt };
    } catch (err: unknown) {
      if (!this.lastError) this.lastError = err instanceof Error ? err.message : String(err);
      return { reachable: false, latencyMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Scans PATH and known OpenCode install locations for the `opencode` CLI. */
  public discoverOpencodeCli(): string | null {
    if (this.cliPath && isExecutableFile(this.cliPath)) return this.cliPath;

    const dirs = Array.from(
      new Set(
        [
          ...(process.env.PATH || '').split(path.delimiter),
          ...(process.platform === 'win32'
            ? [
                path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode'),
                path.join(process.env.LOCALAPPDATA || '', 'opencode'),
                path.join(process.env.USERPROFILE || '', '.local', 'bin'),
                path.join(process.env.APPDATA || '', 'npm')
              ]
            : ['/usr/local/bin', '/usr/bin', path.join(process.env.HOME || '', '.local', 'bin')])
        ].filter((d) => d)
      )
    );

    const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, `opencode${ext}`);
        if (isExecutableFile(candidate)) {
          this.cliPath = candidate;
          return candidate;
        }
      }
    }

    // Last resort: `where opencode` / `command -v opencode`
    try {
      const result = spawnSync(
        process.platform === 'win32' ? 'where' : 'sh',
        process.platform === 'win32' ? ['opencode'] : ['-c', 'command -v opencode'],
        { encoding: 'utf8', timeout: 4000, windowsHide: true }
      );
      const first = String(result.stdout || '').split(/\r?\n/)[0]?.trim();
      if (first && isExecutableFile(first)) {
        this.cliPath = first;
        return first;
      }
    } catch {
      // where/lookup failure is not fatal — hosted supply does not need the CLI
    }

    return null;
  }
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isFile() && candidatePath.length > 0;
  } catch {
    return false;
  }
}

export const opencodeServiceManager = new OpenCodeServiceManager();
