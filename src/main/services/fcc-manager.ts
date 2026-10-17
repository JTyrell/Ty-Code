import { spawn, type ChildProcess } from 'child_process';
import { settingsManager } from './settings-manager';

let sidecarProcess: ChildProcess | null = null;
const FCC_PORT = 8082;
const HEALTH_URL = `http://localhost:${FCC_PORT}/health`;
const PING_URL = `http://localhost:${FCC_PORT}/v1/models`;

export interface FCCHealthResult {
  healthy: boolean;
  version: string;
}

/**
 * Pings the FCC local API with a 2-second timeout to verify health and responsiveness.
 */
export async function checkFCCHealth(): Promise<FCCHealthResult> {
  try {
    let response: Response;
    try {
      response = await fetch(HEALTH_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(2000)
      });
    } catch {
      response = await fetch(PING_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(2000)
      });
    }

    if (response.ok) {
      let version = '0.9.4-fcc';
      try {
        const json = (await response.json()) as { version?: string };
        if (json.version) version = json.version;
      } catch {}
      console.log(`[FCC] Health check passed (version: ${version}).`);
      return { healthy: true, version };
    }

    console.log(`[FCC] Health check failure: endpoint responded with status ${response.status}.`);
    return { healthy: false, version: 'unknown' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`[FCC] Health check failure: ${errorMsg}`);
    return { healthy: false, version: 'unknown' };
  }
}

/**
 * Checks if the FCC binary/process is running. If not, and if the user has enabled it in settings, spawns it.
 * Non-blocking: background check and execution.
 */
export async function startFCCSidecar(): Promise<boolean> {
  console.log('[FCC] Checking FCC sidecar status for startup...');

  // 1. Check if FCC is already running
  const health = await checkFCCHealth();
  if (health.healthy) {
    console.log('[FCC] Sidecar process is already running and healthy.');
    return true;
  }

  // 2. Check if user has enabled it in settings
  try {
    const settings = await settingsManager.getEffectiveSettings();
    const isEnabled = (settings as any)?.fccEnabled ?? true;
    if (!isEnabled) {
      console.log('[FCC] FCC sidecar is disabled in user settings. Skipping launch.');
      return false;
    }
  } catch {
    // If settings check fails, proceed with default enabled
  }

  // 3. Resolve binary path
  const binaryPath = process.env.FCC_SERVER_PATH;
  if (!binaryPath) {
    console.log('[FCC] No external FCC binary configured (FCC_SERVER_PATH unset).');
    return false;
  }

  try {
    console.log(`[FCC] Spawning FCC sidecar process: ${binaryPath}`);
    sidecarProcess = spawn(binaryPath, ['--port', String(FCC_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, PORT: String(FCC_PORT) }
    });

    sidecarProcess.stdout?.on('data', (chunk) => {
      console.log(`[FCC-STDOUT] ${chunk.toString().trim()}`);
    });

    sidecarProcess.stderr?.on('data', (chunk) => {
      console.error(`[FCC-STDERR] ${chunk.toString().trim()}`);
    });

    sidecarProcess.on('exit', (code, signal) => {
      console.log(`[FCC] Sidecar process exited with code ${code}, signal ${signal}.`);
      sidecarProcess = null;
    });

    // Wait briefly up to 500ms for process to initialize without blocking main loop
    await new Promise((resolve) => setTimeout(resolve, 500));
    const postHealth = await checkFCCHealth();
    if (postHealth.healthy) {
      console.log('[FCC] Sidecar successfully spawned and verified healthy.');
      return true;
    }
    return false;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[FCC] Failed to spawn sidecar process: ${errorMsg}`);
    return false;
  }
}

/**
 * Gracefully terminates the FCC sidecar process.
 */
export async function stopFCCSidecar(): Promise<void> {
  if (!sidecarProcess) {
    console.log('[FCC] No managed sidecar process running.');
    return;
  }

  console.log('[FCC] Stopping FCC sidecar process...');
  const proc = sidecarProcess;
  sidecarProcess = null;

  try {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch {}
        resolve();
      }, 1500);

      proc.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    console.log('[FCC] FCC sidecar process terminated.');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[FCC] Error terminating sidecar process: ${errorMsg}`);
  }
}
