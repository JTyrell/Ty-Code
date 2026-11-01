/**
 * Process Explorer IPC — the wiring half of `process-explorer-service.ts`.
 *
 * The service decides what a snapshot contains and is free of `electron` so it
 * can be unit-tested under plain Node. This module supplies the four things only
 * main can: Electron's own process metrics, the live window list, the terminal
 * registry, and the FCC sidecar.
 *
 * Two of those are not in `app.getAppMetrics()` and are the reason this module
 * exists at all. The FCC sidecar is a `child_process.spawn`, not a
 * `utilityProcess.fork`, so Electron never reports it. Terminals are the same
 * story: a PTY's shell is spawned by node-pty, so the only place its pid is
 * known is the registry in `ipc/pty-handlers.ts`. Both have to be read directly
 * or the panel would be missing exactly the processes most likely to be leaking.
 *
 * The remaining gap is memory for those external pids. Electron knows the
 * working set only for processes it forked, so resident set for a shell or a
 * sidecar needs a platform read — `ps` on POSIX, `Get-Process` on Windows. That
 * read is batched into one call per snapshot rather than one per pid, capped,
 * time-boxed, and reduced to `{}` on any failure: a panel that shows a pid
 * without a memory column is still useful, whereas one that refuses to render
 * because a shell exited mid-read is not.
 */

import { execFile } from 'node:child_process';
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcResponse } from '../../preload/types';
import {
  PROCESS_EXPLORER_CHANNELS,
  type ProcessExplorerSnapshot
} from '../../shared/types/process-explorer';
import { captureProcessSnapshot, type ProcessExplorerDeps } from '../services/process-explorer-service';
import { listPtyProcesses } from './pty-handlers';
import { fccManager } from '../services/orchestration/fcc-manager';

export { PROCESS_EXPLORER_CHANNELS };

/** Hard ceiling on one platform read; a snapshot is capped at 512 rows anyway. */
const MEMORY_READ_MAX_PIDS = 200;
/** Long enough for a loaded machine, short enough that the panel never hangs. */
const MEMORY_READ_TIMEOUT_MS = 4_000;

/**
 * Only positive safe integers, deduplicated, capped.
 *
 * These pids are interpolated into a shell command, so this is a security
 * boundary and not tidiness: anything that is not an integer cannot be a pid
 * and cannot be trusted to be free of shell metacharacters.
 */
function safePids(pids: number[]): number[] {
  const seen = new Set<number>();
  const rows: number[] = [];
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    rows.push(pid);
    if (rows.length >= MEMORY_READ_MAX_PIDS) break;
  }
  return rows;
}

/** Parse `"<pid> <kb>"` lines, dropping anything that is not two numbers. */
function parsePidMemoryLines(stdout: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const kb = Number(parts[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (!Number.isFinite(kb) || kb < 0) continue;
    out[pid] = kb;
  }
  return out;
}

function runMemoryRead(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: MEMORY_READ_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 512 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : '');
      }
    );
  });
}

/**
 * Resident set in kibibytes for pids Electron does not own.
 *
 * Resolves to `{}` on every failure path — a missing binary, a denied
 * permission, a timeout, a pid that exited between the snapshot and the read.
 * The service reports an unreadable measurement as a notice and carries on;
 * throwing here would turn one dead shell into a blank panel.
 */
async function readExternalMemoryKb(pids: number[]): Promise<Record<number, number>> {
  const targets = safePids(pids);
  if (targets.length === 0) return {};
  const list = targets.join(',');
  try {
    if (process.platform === 'win32') {
      // `Where-Object` drops the rows Windows returns with no readable working
      // set, so a zero is never reported as if it were a measurement.
      const script =
        `Get-Process -Id ${list} -ErrorAction SilentlyContinue | ` +
        'Where-Object { $_.WorkingSet64 -gt 0 } | ' +
        'ForEach-Object { "$($_.Id) $([int]($_.WorkingSet64 / 1024))" }';
      const stdout = await runMemoryRead('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ]);
      return parsePidMemoryLines(stdout);
    }
    const stdout = await runMemoryRead('ps', ['-o', 'pid=,rss=', '-p', list]);
    return parsePidMemoryLines(stdout);
  } catch {
    return {};
  }
}

/** The real Electron bindings, adapted to the service's Electron-free shape. */
export function createElectronProcessExplorerDeps(): ProcessExplorerDeps {
  return {
    appMetrics: () => app.getAppMetrics(),

    windows: () => {
      const rows = [];
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const contents = win.webContents;
        // `getOSProcessId()` is the join key: `getAppMetrics()` reports renderer
        // pids but no window id, so the only way to name a renderer row is to
        // match it back to the window that owns that pid.
        const pid = contents && !contents.isDestroyed() ? safeRendererPid(contents) : undefined;
        rows.push({
          windowId: win.id,
          title: win.isDestroyed() ? '' : safeTitle(win),
          pid: typeof pid === 'number' && pid > 0 ? pid : undefined
        });
      }
      return rows;
    },

    ptyProcesses: () => listPtyProcesses(),

    sidecar: () => {
      const status = fccManager.getStatus();
      return { running: status.running, pid: status.pid, port: status.port };
    },

    externalMemoryKb: readExternalMemoryKb,

    now: () => Date.now()
  };
}

/** A window can be torn down between the `isDestroyed` check and the read. */
function safeTitle(win: BrowserWindow): string {
  try {
    return win.getTitle();
  } catch {
    return '';
  }
}

/**
 * The renderer's OS pid, or `undefined` when it cannot be read.
 *
 * Zero before the renderer has started, which the service already treats as "no
 * pid" — a row keyed on pid 0 would collide with every other window that has not
 * booted yet. Same tearing-down race as `safeTitle`.
 */
function safeRendererPid(contents: BrowserWindow['webContents']): number | undefined {
  try {
    const pid = contents.getOSProcessId();
    return typeof pid === 'number' && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export interface ProcessExplorerHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Override for tests. Defaults to the real Electron bindings. */
  service?: ProcessExplorerDeps;
}

let registered: { dispose(): void } | null = null;

/**
 * Register the snapshot channel. Idempotent, like `registerFileDialogHandlers`:
 * a second call returns the existing disposable instead of double-binding and
 * throwing on an already-registered channel.
 *
 * There is deliberately no push channel and no timer here. The panel polls on a
 * chain, so closing its window is what stops the reads — a main-side interval
 * would keep taking snapshots of a machine nobody is looking at.
 */
export function registerProcessExplorerHandlers(
  deps: ProcessExplorerHandlerDeps
): { dispose(): void } {
  if (registered) return registered;

  const service = deps.service ?? createElectronProcessExplorerDeps();

  const listener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<ProcessExplorerSnapshot>> => {
    if (!deps.isTrustedSender(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    return captureProcessSnapshot(service, payload);
  };

  ipcMain.handle(PROCESS_EXPLORER_CHANNELS.list, listener);

  registered = {
    dispose() {
      ipcMain.removeHandler(PROCESS_EXPLORER_CHANNELS.list);
      registered = null;
    }
  };
  return registered;
}
