/**
 * FCC Sidecar Lifecycle Manager (Prompt 4: Lifecycle Hardening)
 *
 * Manages the external free-claude-code (FCC) sidecar process:
 * - Single-instance & port adoption: probes port 8765 before spawning. A
 *   healthy listener is ADOPTED (never duplicated); an unhealthy holder is
 *   reclaimed via the local PID file (~/.tycode/fcc/sidecar.pid) and a
 *   bounded port-release poll (max 3s).
 * - Restart policy: exponential backoff + jitter (1s, 2s, 4s … cap 30s),
 *   max 5 attempts per session, then Degrade-Not-Die: the health board is
 *   marked `fcc: down`, ONE info event is emitted, and the ProviderGateway
 *   routes around FCC forever after. The sidecar can NEVER crash-loop
 *   indefinitely and its failure can NEVER exit Electron.
 * - intentionalKill: self-inflicted SIGTERMs (shutdown/restart) are never
 *   counted as crashes and never trigger a restart.
 * - Health monitoring: HTTP GET /health every 30s; restart only on a
 *   non-intentional process exit or 3 consecutive health failures — never
 *   on a single slow boot (the ready wait is generous and slow boots are
 *   left to the monitor to judge).
 * - Vault key handshake: ONE stdin JSON-RPC handshake (Zod-validated ack,
 *   5s timeout). On failure the sidecar continues in keyless/anonymous
 *   mode. No vault retry storm.
 *
 * Lifecycle decoupling: the sidecar is spawned with ELECTRON_RUN_AS_NODE=1
 * so the child is a plain Node process — it never participates in the
 * Electron app lifecycle (no single-instance lock, no app events), its
 * footprint is far smaller, and its death is invisible to Electron.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { z } from 'zod';
import { app, BrowserWindow } from 'electron';
import { getAllVaultKeys } from './credential-vault';
import { providerHealthMonitor } from './providers/health-monitor';
import { classifySidecarLine } from './fcc/sidecar-line-classifier';
import { sidecarLogLedger } from './fcc/sidecar-log-ledger';

// --- Zod Validation Schemas for IPC ---

export const FCCReadySignalSchema = z.object({
  status: z.literal('ready'),
  port: z.number().int().positive()
});

export const FCCHealthSchema = z.object({
  status: z.string(),
  port: z.number().int().positive(),
  version: z.string(),
  uptime: z.number().optional(),
  harnesses: z.array(z.string()).default([]),
  quota: z.object({
    total: z.number(),
    used: z.number(),
    remaining: z.number()
  }).default({
    total: 1_350_000_000,
    used: 0,
    remaining: 1_350_000_000
  })
});
export type FCCHealthStatus = z.infer<typeof FCCHealthSchema>;

export const FCCModelSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  name: z.string().optional(),
  owned_by: z.string().optional(),
  harness: z.string().optional(),
  context_length: z.number().optional()
});

export const FCCModelListSchema = z.object({
  object: z.string().optional(),
  data: z.array(FCCModelSchema)
});
export type FCCModelListResponse = z.infer<typeof FCCModelListSchema>;

export const FCCChatCompletionChunkSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string().optional(),
  harness: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number().optional(),
      delta: z.object({
        role: z.string().optional(),
        content: z.string().optional()
      }),
      finish_reason: z.string().nullable().optional()
    })
  ),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional()
  }).optional(),
  fcc_quota: z.object({
    consumed: z.number().optional(),
    remaining: z.number().optional()
  }).optional()
});
export type FCCChatCompletionChunk = z.infer<typeof FCCChatCompletionChunkSchema>;

export const FCCVoiceTranscriptionSchema = z.object({
  text: z.string(),
  confidence: z.number().optional(),
  language: z.string().optional(),
  durationMs: z.number().optional()
});
export type FCCVoiceTranscription = z.infer<typeof FCCVoiceTranscriptionSchema>;

export const FCCBrowserSessionSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  action: z.string().optional(),
  tosCompliant: z.boolean().optional(),
  reused: z.boolean().optional()
});
export type FCCBrowserSession = z.infer<typeof FCCBrowserSessionSchema>;

export const FCCJsonRpcResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string()
  }).optional()
});

/** Zod-validated ack for the single vault key handshake (keyless fallback). */
export const FCCKeyHandshakeAckSchema = z.object({
  status: z.literal('ok'),
  received: z.number().int().nonnegative(),
  mode: z.enum(['keyed', 'keyless'])
});
export type FCCKeyHandshakeAck = z.infer<typeof FCCKeyHandshakeAckSchema>;

export const FCCPidFileSchema = z.number().int().positive();

export interface FCCSidecarManagerOptions {
  port?: number;
  fccRepoDir?: string;
  autoRestart?: boolean;
}

const PORT_RELEASE_POLL_MS = 250;
const PORT_RELEASE_MAX_WAIT_MS = 3000;
const READY_PROBE_INTERVAL_MS = 500;
const READY_PROBE_MAX_WAIT_MS = 30_000; // generous: slow boots are judged by the health monitor, not killed
const KEY_HANDSHAKE_TIMEOUT_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_HEALTH_FAILURES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const BACKOFF_JITTER_FRACTION = 0.2;
const FCC_HEALTH_BOARD_ID = 'fcc';

export class FCCSidecarManager {
  private static instance: FCCSidecarManager | null = null;
  private childProcess: ChildProcess | null = null;
  private port = 8765;
  private active = false;
  private starting = false;
  private startInFlight: Promise<boolean> | null = null;
  private fccRepoDir: string;
  private pidFilePath: string;
  private autoRestart = true;
  private restartCount = 0;
  private maxRestarts = 5;
  private degraded = false;
  private degradedEventEmitted = false;
  private intentionalKill = false;
  private adoptedInstance = false;
  private healthFailures = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private lastHealthStatus: FCCHealthStatus | null = null;
  private rpcRequestId = 1;
  private pendingRpcCalls = new Map<number | string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();

  public static getInstance(): FCCSidecarManager {
    if (!FCCSidecarManager.instance) {
      FCCSidecarManager.instance = new FCCSidecarManager();
    }
    return FCCSidecarManager.instance;
  }

  constructor(options?: FCCSidecarManagerOptions) {
    this.port = options?.port || 8765;
    this.fccRepoDir = options?.fccRepoDir || path.join(os.homedir(), '.tycode', 'fcc');
    this.pidFilePath = path.join(this.fccRepoDir, 'sidecar.pid');
    this.autoRestart = options?.autoRestart !== false;

    // Clean up on app quit if electron app is available
    if (typeof app !== 'undefined' && app?.on) {
      app.on('before-quit', () => {
        void this.stop();
      });
    }
  }

  public getPort(): number {
    return this.port;
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  /** True when the manager permanently gave up on this sidecar session. */
  public isDegraded(): boolean {
    return this.degraded;
  }

  public isActive(): boolean {
    if (!this.active) return false;
    // An adopted external instance is not our child; presence on the port is
    // proven by the health monitor, not by childProcess.
    if (this.adoptedInstance) return true;
    return this.childProcess !== null && !this.childProcess.killed;
  }

  public getLastHealth(): FCCHealthStatus | null {
    return this.lastHealthStatus;
  }

  /**
   * Clones or pulls the FCC repo into ~/.tycode/fcc/
   */
  public async ensureFCCRepository(): Promise<string> {
    try {
      await fs.mkdir(this.fccRepoDir, { recursive: true });
      const gitDir = path.join(this.fccRepoDir, '.git');
      const hasGit = fsSync.existsSync(gitDir);

      if (!hasGit) {
        console.log(`[FCC-SIDECAR] Cloning FCC repository from https://github.com/Alishahryar1/free-claude-code.git into ${this.fccRepoDir}...`);
        await new Promise<void>((resolve) => {
          const clone = spawn('git', ['clone', '--depth', '1', 'https://github.com/Alishahryar1/free-claude-code.git', this.fccRepoDir], {
            stdio: 'ignore',
            windowsHide: true
          });
          clone.on('close', (code) => {
            if (code === 0) {
              console.log('[FCC-SIDECAR] Repository cloned successfully.');
            } else {
              console.warn(`[FCC-SIDECAR] git clone exited with code ${code}. Operating on managed sidecar script.`);
            }
            resolve();
          });
          clone.on('error', (err) => {
            console.warn(`[FCC-SIDECAR] git clone not available (${err.message}). Operating on managed sidecar script.`);
            resolve();
          });
        });
      } else {
        console.log(`[FCC-SIDECAR] Existing repository verified at ${this.fccRepoDir}`);
      }
    } catch (err) {
      console.warn('[FCC-SIDECAR] Could not clone or verify repo directory; fallback to bundled sidecar:', err);
    }
    return this.fccRepoDir;
  }

  /**
   * Starts (or adopts) the FCC sidecar and waits for the ready signal.
   * Never throws; never crash-loops; returns false on failure.
   */
  public async start(options?: FCCSidecarManagerOptions): Promise<boolean> {
    // Degrade-not-die: after the failure budget is spent, FCC stays down for
    // the whole session and callers route around it. No restart, ever.
    if (this.degraded) return false;
    if (this.isActive()) return true;
    if (options?.port) this.port = options.port;

    // Single-flight: concurrent callers share ONE start attempt.
    if (this.starting) {
      return (await this.startInFlight) ?? this.isActive();
    }
    this.starting = true;
    this.startInFlight = this.performStart();
    try {
      return await this.startInFlight;
    } finally {
      this.starting = false;
      this.startInFlight = null;
    }
  }

  private async performStart(): Promise<boolean> {
    // An explicit start supersedes any armed backoff timer.
    this.clearPendingRestart();
    this.intentionalKill = false;

    try {
      // 1. Port adoption: is a sidecar already listening and healthy?
      const preHealth = await this.checkHealth();
      if (preHealth) {
        console.log(`[FCC-SIDECAR] Existing sidecar is healthy on port ${this.port} — adopting it (no second spawn).`);
        this.active = true;
        this.adoptedInstance = true;
        this.restartCount = 0;
        this.healthFailures = 0;
        this.lastHealthStatus = preHealth;
        providerHealthMonitor.markProviderUp(FCC_HEALTH_BOARD_ID, 0);
        this.startHealthMonitor();
        // The adopted instance never received a key handshake in this
        // session — send exactly one (keyless fallback on failure).
        await this.performKeyHandshake();
        console.log('[FCC-SIDECAR] Sidecar adopted and active.');
        return true;
      }

      // 2. Port occupied but unhealthy: reclaim it from our own stale
      //    sidecar via the local PID file (never kill a foreign process).
      if (await this.isPortOccupied()) {
        const reclaimed = await this.reclaimPortFromStaleSidecar();
        if (!reclaimed && (await this.isPortOccupied())) {
          throw new Error(`Port ${this.port} is held by an unresponsive process that Ty-Code does not manage.`);
        }
      }

      // 3. Clone or ensure repository
      await this.ensureFCCRepository();

      // 4. Resolve sidecar runner script
      const localRunner = path.join(__dirname, 'fcc', 'sidecar-server.mjs');
      const rootRunner = path.join(process.cwd(), 'src', 'main', 'services', 'fcc', 'sidecar-server.mjs');
      const repoRunner = path.join(this.fccRepoDir, 'sidecar-server.mjs');

      let scriptToRun = fsSync.existsSync(localRunner)
        ? localRunner
        : fsSync.existsSync(rootRunner)
        ? rootRunner
        : repoRunner;

      console.log(`[FCC-SIDECAR] Spawning sidecar process using script: ${scriptToRun} on port ${this.port}...`);

      // Lifecycle decoupling: ELECTRON_RUN_AS_NODE=1 makes the child a plain
      // Node process — no Electron app lifecycle, no single-instance lock,
      // no windowing, dramatically smaller footprint.
      const child = spawn(process.execPath, [scriptToRun, '--port', String(this.port)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(this.port),
          ELECTRON_RUN_AS_NODE: '1'
        },
        windowsHide: true
      });

      if (!child.pid) {
        throw new Error('Failed to obtain PID for spawned sidecar process.');
      }

      this.childProcess = child;
      this.adoptedInstance = false;
      this.writePidFile(child.pid);

      // Handle JSON-RPC and ready signal on stdout
      const readyPromise = new Promise<void>((resolve, reject) => {
        let isResolved = false;

        const onData = (data: Buffer) => {
          const text = data.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Detect ready signal on stdout
            if (trimmed.includes('[FCC-SIDECAR] ready on port') || trimmed.includes(`ready on port ${this.port}`)) {
              if (!isResolved) {
                isResolved = true;
                resolve();
              }
            }

            // Stream Hygiene (Prompt 2): only Zod-validated protocol frames may
            // drive RPC resolution; every other stdout line is sidecar log
            // output and is routed to the ledger — never into any token stream.
            const classified = classifySidecarLine(trimmed);
            if (classified.kind === 'log') {
              sidecarLogLedger.record('sidecar-stdout', trimmed);
              continue;
            }

            // Detect JSON-RPC responses
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              try {
                const parsed = JSON.parse(trimmed);
                const rpc = FCCJsonRpcResponseSchema.safeParse(parsed);
                if (rpc.success && rpc.data.id !== null) {
                  const pending = this.pendingRpcCalls.get(rpc.data.id);
                  if (pending) {
                    this.pendingRpcCalls.delete(rpc.data.id);
                    if (rpc.data.error) {
                      pending.reject(new Error(rpc.data.error.message));
                    } else {
                      pending.resolve(rpc.data.result);
                    }
                  }
                }
              } catch {
                // Ignore non-RPC lines
              }
            }
          }
        };

        child.stdout?.on('data', onData);

        child.stderr?.on('data', (data: Buffer) => {
          const stderrText = data.toString().trim();
          if (stderrText) {
            sidecarLogLedger.record('sidecar-stderr', stderrText);
          }
          console.error(`[FCC-SIDECAR][STDERR] ${stderrText}`);
        });

        child.on('error', (err) => {
          console.error('[FCC-SIDECAR] Process error:', err);
          if (!isResolved) {
            isResolved = true;
            reject(err);
          }
        });

        child.on('exit', (code, signal) => {
          console.log(`[FCC-SIDECAR] Process exited with code ${code}, signal ${signal}.`);
          const wasIntentional = this.intentionalKill;
          this.active = false;
          this.adoptedInstance = false;
          if (this.childProcess === child) {
            this.childProcess = null;
          }
          // The PID is gone either way: the file must never advertise a dead process.
          this.removePidFile();
          if (wasIntentional) {
            // Self-inflicted SIGTERM (shutdown / restart): never a crash.
            return;
          }
          this.scheduleRestart(`sidecar process exited unexpectedly (code=${code}, signal=${signal})`);
        });

        // Generous slow-boot tolerance: probe HTTP /health in the background
        // while the stdout ready signal is awaited. A slow first boot is
        // NEVER a restart trigger — if the process is alive but late, the
        // 30s health monitor adopts it as soon as it becomes responsive.
        const deadline = Date.now() + READY_PROBE_MAX_WAIT_MS;
        const probeLoop = (async () => {
          while (Date.now() < deadline && !isResolved) {
            const health = await this.checkHealth();
            if (health && !isResolved) {
              isResolved = true;
              resolve();
              return;
            }
            await new Promise((r) => setTimeout(r, READY_PROBE_INTERVAL_MS));
          }
          if (!isResolved) {
            isResolved = true;
            reject(new Error(`Timeout waiting for FCC sidecar ready signal on port ${this.port}`));
          }
        })();
        void probeLoop;
      });

      try {
        await readyPromise;
      } catch (readyErr) {
        // Slow-boot tolerance: if the process is still alive, keep it and
        // let the health monitor adopt it (restart only after 3 consecutive
        // health failures). If it died, the exit handler already scheduled
        // the backoff restart.
        const alive = this.isChildAlive();
        console.warn(`[FCC-SIDECAR] Ready signal not confirmed (${readyErr instanceof Error ? readyErr.message : String(readyErr)}); child ${alive ? 'alive — deferring to health monitor' : 'dead — exit handler governs restart'}.`);
        if (alive) {
          this.startHealthMonitor();
        }
        return false;
      }

      this.active = true;
      this.restartCount = 0;
      this.healthFailures = 0;
      providerHealthMonitor.markProviderUp(FCC_HEALTH_BOARD_ID, 0);
      this.startHealthMonitor();

      // 5. Vault key handshake: exactly ONE request with a timeout; the
      //    sidecar continues keyless/anonymous on any failure (no retry).
      await this.performKeyHandshake();

      console.log(`[FCC-SIDECAR] Sidecar successfully initialized and active on port ${this.port}.`);
      return true;
    } catch (err) {
      console.error('[FCC-SIDECAR] Failed to start sidecar:', err);
      this.active = false;
      this.startFailed(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  private isChildAlive(): boolean {
    const child = this.childProcess;
    if (!child) return false;
    // exitCode/signalCode are null until the process actually exits.
    return child.exitCode === null && child.signalCode === null;
  }

  // --- Single-instance & port adoption (Prompt 4 Step 1) ---

  /** TCP probe: does something accept connections on the sidecar port? */
  private isPortOccupied(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ port: this.port, host: '127.0.0.1' });
      let settled = false;
      const done = (occupied: boolean) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(occupied);
      };
      socket.setTimeout(500);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(true)); // silent listener counts as occupied
      socket.once('error', () => done(false)); // ECONNREFUSED → port is free
    });
  }

  private readPidFile(): number | null {
    try {
      if (!fsSync.existsSync(this.pidFilePath)) return null;
      const raw = fsSync.readFileSync(this.pidFilePath, 'utf8').trim();
      const parsed = FCCPidFileSchema.safeParse(Number(raw));
      if (!parsed.success) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  private writePidFile(pid: number): void {
    try {
      fsSync.mkdirSync(path.dirname(this.pidFilePath), { recursive: true });
      fsSync.writeFileSync(this.pidFilePath, String(pid), 'utf8');
      console.log(`[FCC-SIDECAR] PID file written: ${this.pidFilePath} (pid ${pid}).`);
    } catch (err) {
      console.warn('[FCC-SIDECAR] Could not write PID file (local-only, non-fatal):', err);
    }
  }

  private removePidFile(): void {
    try {
      if (fsSync.existsSync(this.pidFilePath)) {
        fsSync.rmSync(this.pidFilePath, { force: true });
      }
    } catch {
      // Best-effort local cleanup only.
    }
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM: the process exists but we lack permission to signal it.
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  /**
   * Reclaims the sidecar port from OUR OWN stale sidecar:
   * - PID file names a dead process → stale file, remove it (the occupier is
   *   unknown, so it is never killed blindly).
   * - PID file names a live process → presumed our stale sidecar: SIGTERM,
   *   poll for port release (max 3s), escalate to SIGKILL once.
   */
  private async reclaimPortFromStaleSidecar(): Promise<boolean> {
    const pid = this.readPidFile();
    if (pid === null) return false;
    if (pid === process.pid || pid === process.ppid) return false; // never signal ourselves

    if (!this.isPidAlive(pid)) {
      console.log(`[FCC-SIDECAR] PID file ${this.pidFilePath} is stale (pid ${pid} not alive); removing it.`);
      this.removePidFile();
      return false;
    }

    console.log(`[FCC-SIDECAR] Port ${this.port} is held by an unhealthy stale sidecar (pid ${pid}) — terminating it.`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      console.warn(`[FCC-SIDECAR] SIGTERM for stale sidecar pid ${pid} failed:`, err);
    }

    const deadline = Date.now() + PORT_RELEASE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      if (!(await this.isPortOccupied())) {
        console.log(`[FCC-SIDECAR] Port ${this.port} released after graceful termination.`);
        this.removePidFile();
        return true;
      }
      await new Promise((r) => setTimeout(r, PORT_RELEASE_POLL_MS));
    }

    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    // Brief final poll after the forced kill.
    const forceDeadline = Date.now() + 1000;
    while (Date.now() < forceDeadline) {
      if (!(await this.isPortOccupied())) {
        this.removePidFile();
        return true;
      }
      await new Promise((r) => setTimeout(r, PORT_RELEASE_POLL_MS));
    }
    return false;
  }

  // --- Restart policy & degrade-not-die (Prompt 4 Step 2) ---

  /**
   * Exponential backoff + jitter: 1s, 2s, 4s … capped at 30s. Max 5
   * attempts per session; after that the sidecar degrades permanently.
   */
  private scheduleRestart(reason: string): void {
    if (this.degraded || this.intentionalKill) return;
    this.clearPendingRestart();
    if (this.restartCount >= this.maxRestarts) {
      this.degrade(reason);
      return;
    }
    const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, this.restartCount));
    const jitter = base * BACKOFF_JITTER_FRACTION * (Math.random() * 2 - 1);
    const delay = Math.max(250, Math.round(base + jitter));
    this.restartCount++;
    console.log(`[FCC-SIDECAR] Restarting in ${delay}ms (attempt ${this.restartCount}/${this.maxRestarts}). Reason: ${reason}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
    if (this.restartTimer.unref) {
      this.restartTimer.unref();
    }
  }

  private clearPendingRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /** Non-intentional start failure: consume the backoff budget, then degrade. */
  private startFailed(err: Error): void {
    if (this.degraded || this.intentionalKill) return;
    this.scheduleRestart(`start failed: ${err.message}`);
  }

  /**
   * Degrade-not-die: mark the health board `fcc: down`, emit ONE info event,
   * and stop trying for the rest of the session. The ProviderGateway routes
   * around FCC (keyed providers → anonymous OpenKilo pool). Electron stays
   * alive; the sidecar failure never propagates into app shutdown.
   */
  private degrade(reason: string): void {
    if (this.degraded) return;
    this.degraded = true;
    this.clearPendingRestart();
    this.stopHealthMonitor();
    this.active = false;
    console.warn(`[FCC-SIDECAR] Failure budget exhausted (${this.maxRestarts} attempts) — FCC degraded for this session. Reason: ${reason}`);
    try {
      providerHealthMonitor.markProviderDown(FCC_HEALTH_BOARD_ID, `FCC sidecar degraded: ${reason}`);
    } catch {
      // Health board is best-effort.
    }
    this.emitInfoEventOnce();
  }

  /** Exactly ONE info event for the whole degraded session. */
  private emitInfoEventOnce(): void {
    if (this.degradedEventEmitted) return;
    this.degradedEventEmitted = true;
    const payload = {
      status: 'degraded',
      message: 'FCC sidecar is unavailable after repeated failures. Free-tier chat continues via OpenKilo / Ty-Code Free.',
      attempts: this.maxRestarts
    };
    console.log('[FCC-SIDECAR] Info event: FCC degraded for this session; routing around it.');
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('fcc:sidecar-degraded', payload);
        }
      }
    } catch {
      // Non-blocking in headless/test environments.
    }
  }

  // --- Health monitoring (Prompt 4 Step 2.4) ---

  /**
   * Health checks the sidecar endpoint. Used both for the 30s monitor and
   * for port-adoption probes.
   */
  public async checkHealth(): Promise<FCCHealthStatus | null> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return null;
      const data = await res.json();
      const parsed = FCCHealthSchema.safeParse(data);
      if (parsed.success) {
        this.lastHealthStatus = parsed.data;
        return parsed.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthFailures = 0;
    const tick = async () => {
      // Keep probing whenever we own a child (possibly a slow boot that is
      // not active yet) or an adopted instance — so slow boots can be
      // adopted and lost instances can be detected.
      if (!this.childProcess && !this.adoptedInstance) return;
      const health = await this.checkHealth();
      if (health) {
        this.lastHealthStatus = health;
        this.healthFailures = 0;
        if (!this.active) {
          // Self-healing adoption: a slow-booting child became responsive.
          console.log('[FCC-SIDECAR] Sidecar became responsive — adopting it.');
          this.active = true;
          providerHealthMonitor.markProviderUp(FCC_HEALTH_BOARD_ID, 0);
        }
        return;
      }

      // Unresponsive. Restart only after 3 consecutive failures — a single
      // missed tick or slow response never triggers a restart.
      this.healthFailures++;
      console.warn(`[FCC-SIDECAR] Health check missed on port ${this.port} (${this.healthFailures}/${MAX_CONSECUTIVE_HEALTH_FAILURES}).`);
      if (this.healthFailures >= MAX_CONSECUTIVE_HEALTH_FAILURES) {
        this.healthFailures = 0;
        if (this.childProcess || this.adoptedInstance) {
          // Process managed but not answering (hung or wedged): restart it
          // through the backoff policy. A stale sidecar that holds the port
          // is reclaimed via the PID file inside the next start attempt.
          this.active = false;
          this.adoptedInstance = false;
          this.scheduleRestart('3 consecutive health-check failures');
        }
      }
    };
    this.healthTimer = setInterval(() => {
      void tick();
    }, HEALTH_CHECK_INTERVAL_MS);
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

  // --- Vault key handshake (Prompt 4 Step 3.5) ---

  /**
   * Single handshake with a hard timeout. The sidecar either receives the
   * decrypted vault keys once (Zod-validated ack) or continues in
   * keyless/anonymous mode. Never retried — the vault's own single-flight
   * cache makes this cheap, and a failure is terminal for the session.
   */
  private async performKeyHandshake(): Promise<void> {
    try {
      const keys = getAllVaultKeys();
      const keyCount = Object.keys(keys).length;
      if (keyCount === 0) {
        console.log('[FCC-SIDECAR] Vault hydration produced no keys — sidecar continues in keyless/anonymous mode.');
        return;
      }
      console.log(`[FCC-SIDECAR] Sending vault key handshake (${keyCount} keys, single request, ${KEY_HANDSHAKE_TIMEOUT_MS}ms timeout)...`);
      const ack = await Promise.race([
        this.sendJsonRpc('keys.handshake', { keys }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`key handshake timed out after ${KEY_HANDSHAKE_TIMEOUT_MS}ms`)), KEY_HANDSHAKE_TIMEOUT_MS)
        )
      ]);
      const parsedAck = FCCKeyHandshakeAckSchema.safeParse(ack);
      if (!parsedAck.success) {
        throw new Error('key handshake ack failed validation');
      }
      console.log(`[FCC-SIDECAR] Key handshake acknowledged (${parsedAck.data.received} keys, mode=${parsedAck.data.mode}).`);
    } catch (err) {
      // One clean line, zero retries: keyless/anonymous mode is a supported
      // steady state, not an error condition.
      console.log(`[FCC-SIDECAR] Key handshake failed (${err instanceof Error ? err.message : String(err)}) — sidecar continues in keyless/anonymous mode.`);
    }
  }

  /**
   * Send JSON-RPC command via stdin and wait for stdout response
   */
  public sendJsonRpc(method: string, params: unknown = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.childProcess || !this.childProcess.stdin) {
        return reject(new Error('Sidecar child process stdin is not writable'));
      }
      const id = this.rpcRequestId++;
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };
      this.pendingRpcCalls.set(id, { resolve, reject });
      this.childProcess.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  /**
   * Audio transcription support (Step 4)
   */
  public async transcribeAudio(
    audioData: Buffer | Uint8Array | string,
    mimeType = 'audio/webm'
  ): Promise<FCCVoiceTranscription> {
    const isReady = await this.start();
    if (!isReady) {
      throw new Error('FCC sidecar is not available for voice transcription');
    }

    const payload = {
      audio: typeof audioData === 'string' ? audioData : Buffer.from(audioData).toString('base64'),
      mimeType,
      sampleText: 'FCC voice transcription processed successfully.'
    };

    const res = await fetch(`http://127.0.0.1:${this.port}/v1/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      throw new Error(`Voice transcription HTTP error: ${res.status}`);
    }

    const json = await res.json();
    return FCCVoiceTranscriptionSchema.parse(json);
  }

  /**
   * Browser session orchestration (Step 4: ToS compliance)
   */
  public async manageBrowserSession(action: string, options: Record<string, unknown> = {}): Promise<FCCBrowserSession> {
    const isReady = await this.start();
    if (!isReady) {
      throw new Error('FCC sidecar is not available for browser session');
    }

    const res = await fetch(`http://127.0.0.1:${this.port}/v1/browser/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...options }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      throw new Error(`Browser session HTTP error: ${res.status}`);
    }

    const json = await res.json();
    return FCCBrowserSessionSchema.parse(json);
  }

  /**
   * Graceful process termination and cleanup on app shutdown. Marked
   * intentional so the exit handler never counts it as a crash and never
   * schedules a restart while the app is quitting.
   */
  public async stop(): Promise<void> {
    this.intentionalKill = true;
    this.clearPendingRestart();
    this.stopHealthMonitor();
    this.active = false;

    const proc = this.childProcess;
    this.childProcess = null;
    this.adoptedInstance = false;

    if (proc) {
      console.log('[FCC-SIDECAR] Stopping FCC sidecar child process...');
      try {
        proc.kill('SIGTERM');
      } catch {
        // Already dead.
      }
      await new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead.
          }
          resolve();
        }, 1500);
        proc.once('close', () => {
          clearTimeout(killTimeout);
          resolve();
        });
      });
      console.log('[FCC-SIDECAR] FCC sidecar process cleanly terminated.');
    }

    this.removePidFile();
  }
}

export const fccSidecarManager = FCCSidecarManager.getInstance();
