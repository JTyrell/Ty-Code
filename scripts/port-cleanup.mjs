/**
 * Dev Server Port Collision Auto-Cleanup (RealConnect 4)
 *
 * Detects stale/orphaned dev servers (Vite, Electron, Esbuild) occupying port 5173,
 * terminates them gracefully (SIGTERM -> SIGKILL after 5s), and reclaims the port
 * before new dev server instantiation. Non-dev user processes are preserved.
 *
 * Brand: Ty-Code
 */

import net from 'node:net';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DEV_PORT = 5173;

/**
 * Checks if a TCP port is currently listening / bound.
 */
export function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    try {
      server.listen(port, host);
    } catch {
      resolve(true);
    }
  });
}

/**
 * Discovers PIDs listening on the specified port.
 */
export function getPidsOnPort(port, options = {}) {
  const includeCurrent = options.includeCurrent ?? true;
  const isWin = process.platform === 'win32';
  const pids = new Set();

  try {
    if (isWin) {
      const res = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const output = res.stdout || '';
      const lines = output.split('\n');

      const portRegex = new RegExp(`[:.]${port}\\s+.*\\s+LISTENING\\s+(\\d+)`, 'i');
      for (const line of lines) {
        const match = line.match(portRegex);
        if (match) {
          const pid = parseInt(match[1], 10);
          if (pid > 4 && (includeCurrent || pid !== process.pid)) {
            pids.add(pid);
          }
        }
      }
    } else {
      // Unix: lsof or fuser
      const res = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      if (res.status === 0 && res.stdout) {
        for (const line of res.stdout.trim().split('\n')) {
          const pid = parseInt(line.trim(), 10);
          if (!isNaN(pid) && (includeCurrent || pid !== process.pid)) {
            pids.add(pid);
          }
        }
      }
    }
  } catch {
    // Non-blocking query fallback
  }

  return Array.from(pids);
}

/**
 * Retrieves the command line and process name for a given PID.
 */
export function getProcessInfo(pid) {
  const isWin = process.platform === 'win32';

  if (isWin) {
    // 1. Try wmic first (extremely fast on Windows, <400ms, zero CLR/PowerShell startup lag)
    try {
      const wmicRes = spawnSync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      );
      if (wmicRes.status === 0 && wmicRes.stdout) {
        const match = wmicRes.stdout.match(/CommandLine=(.+)/s);
        if (match && match[1]?.trim()) {
          const command = match[1].trim().replace(/[\r\n]+/g, ' ');
          return { pid, command, name: command.split(' ')[0] || '' };
        }
      }
    } catch {
      // fallback to powershell
    }

    try {
      // 2. Fallback to PowerShell CimInstance with 8000ms timeout
      const psScript = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
      const psRes = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }
      );
      const command = (psRes.stdout || '').trim();
      if (command) {
        return { pid, command, name: command.split(' ')[0] || '' };
      }
    } catch {
      // fallback to tasklist
    }

    try {
      // 3. Fallback to tasklist
      const tlRes = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const match = (tlRes.stdout || '').match(/^"([^"]+)"/);
      const name = match ? match[1] : '';
      return { pid, command: name, name };
    } catch {
      return { pid, command: '', name: '' };
    }
  } else {
    try {
      const psRes = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const command = (psRes.stdout || '').trim();
      return { pid, command, name: command.split(' ')[0] || '' };
    } catch {
      return { pid, command: '', name: '' };
    }
  }
}

/**
 * Determines whether a process is an orphaned dev server based on command pattern.
 */
export function isDevProcess(command, name = '') {
  const combined = `${command} ${name}`.toLowerCase();
  return (
    combined.includes('vite') ||
    combined.includes('electron') ||
    combined.includes('esbuild') ||
    combined.includes('dev.mjs')
  );
}

/**
 * Checks if a process is alive.
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Terminates a process (gracefully or forcefully).
 */
export function terminateProcess(pid, force = false) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const args = ['/PID', String(pid), '/T'];
      if (force) args.push('/F');
      spawnSync('taskkill.exe', args, { stdio: 'ignore' });
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch {
    // Process might have exited already
  }
}

/**
 * Appends a log entry to scripts/dev-cleanup.log.
 */
export function logCleanupAction(rootDir, action, message) {
  const logFile = path.resolve(rootDir, 'scripts/dev-cleanup.log');
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${action}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    // non-blocking
  }
}

/**
 * Sleeps for a specified number of milliseconds.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orchestrates port cleanup before dev server launch.
 *
 * @param {number} port - Port to check and clean (default: 5173)
 * @param {object} options - Options { force: boolean, rootDir: string }
 * @returns {Promise<{ success: boolean, killedPids: number[], message?: string }>}
 */
export async function cleanPortConflict(port = DEFAULT_DEV_PORT, options = {}) {
  const force = Boolean(options.force);
  const rootDir = options.rootDir || process.cwd();

  const inUse = await isPortInUse(port);
  if (!inUse) {
    return { success: true, killedPids: [] };
  }

  logCleanupAction(rootDir, 'PORT_OCCUPIED', `Port ${port} is occupied. Scanning listening processes...`);
  const pids = getPidsOnPort(port, { includeCurrent: false });

  if (pids.length === 0) {
    logCleanupAction(rootDir, 'WAIT', `Port ${port} in use, waiting for socket release...`);
    await sleep(500);
    const stillInUse = await isPortInUse(port);
    if (!stillInUse) {
      return { success: true, killedPids: [] };
    }
    return {
      success: false,
      killedPids: [],
      message: `Port ${port} is in use but listening PID could not be determined. Try running with --port.`
    };
  }

  const killedPids = [];

  for (const pid of pids) {
    const info = getProcessInfo(pid);
    const isDev = isDevProcess(info.command, info.name);

    if (isDev) {
      const mode = force ? 'FORCE_AUTOKILL' : 'AUTO_CLEANUP';
      console.log(`[Dev Cleanup] Detected orphaned dev process on port ${port} (PID: ${pid}). Terminating...`);
      logCleanupAction(
        rootDir,
        mode,
        `Terminating orphaned dev process PID ${pid} (${info.command || info.name}) on port ${port}.`
      );

      if (force) {
        // Immediate termination when --force flag is passed
        terminateProcess(pid, true);
        await sleep(300);
      } else {
        // 1. Graceful termination (SIGTERM)
        terminateProcess(pid, false);

        // 2. Wait up to 5s for exit
        let waitedMs = 0;
        let alive = isProcessAlive(pid);
        while (alive && waitedMs < 5000) {
          await sleep(250);
          waitedMs += 250;
          alive = isProcessAlive(pid);
        }

        // 3. Force kill if still alive after 5s
        if (alive) {
          console.log(`[Dev Cleanup] PID ${pid} did not exit after 5s. Escalating to SIGKILL...`);
          logCleanupAction(rootDir, 'ESCALATE_SIGKILL', `PID ${pid} alive after 5s. Escalating to SIGKILL.`);
          terminateProcess(pid, true);
          await sleep(500);
        }
      }

      killedPids.push(pid);
      logCleanupAction(rootDir, 'TERMINATED', `PID ${pid} terminated.`);
    } else {
      // Non-dev user process: protect and warn
      const warning = `Port ${port} in use by process ${pid} (${info.command || info.name || 'user process'}). Use --port to choose different port.`;
      console.warn(`\n⚠️  [Dev Cleanup] ${warning}\n`);
      logCleanupAction(
        rootDir,
        'USER_PROCESS_PRESERVED',
        `Port ${port} in use by non-dev user process PID ${pid} (${info.command || info.name}). Preserved.`
      );
      return {
        success: false,
        killedPids: [],
        message: warning
      };
    }
  }

  // Poll for port release up to 3s
  let releaseWaited = 0;
  while (await isPortInUse(port) && releaseWaited < 3000) {
    await sleep(200);
    releaseWaited += 200;
  }

  const isFree = !(await isPortInUse(port));
  if (isFree) {
    console.log(`[Dev Cleanup] Port ${port} successfully reclaimed.\n`);
    logCleanupAction(rootDir, 'RECLAIMED', `Port ${port} successfully reclaimed and ready.`);
    return { success: true, killedPids };
  } else {
    logCleanupAction(rootDir, 'ERROR', `Port ${port} remained bound after termination.`);
    return {
      success: false,
      killedPids,
      message: `Port ${port} could not be freed. Please check system socket state or use --port.`
    };
  }
}
