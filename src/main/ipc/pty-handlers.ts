import { spawn as childSpawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { CommandExecutionOptions, CommandResult, IpcResponse, PtySessionInfo, PtySpawnOptions, ShellInfo } from '../../preload/types';
import { SecurityPolicyEngine, buildSanitizedPtyEnv } from '../services/security-policy';
import { settingsManager } from '../services/settings-manager';
import { terminalDispatchLedger } from '../services/terminal-dispatch-ledger';
import { buildFccTerminalEnv } from '../fcc-integration';

interface ActivePty {
  process: pty.IPty;
  shellPath: string;
  /**
   * The registry id of the shell that was spawned (`powershell`, `cmd`, `bash`,
   * `custom`, …), kept alongside `shellPath` because a task's completion
   * sentinel has to be spelled differently per shell and `custom` says nothing
   * about which syntax the executable actually accepts.
   */
  shellId: string;
  window: BrowserWindow;
  outputBuffer: string;
  attached: boolean;
  exited?: number;
  subscriptions: Array<{ dispose: () => void }>;
  /** Resolved when the spawn has fired AND the renderer XTerm acked attach. */
  whenReady: Promise<void>;
  resolveReady: () => void;
  /** Commands dispatched before readiness; flushed (not dropped) on attach. */
  queue: Array<{ cmd: string; execute: boolean; flushed?: boolean }>;
}

const activePtys = new Map<string, ActivePty>();
const MAX_UNATTACHED_OUTPUT = 256_000;

// ---------------------------------------------------------------------------
// Output and exit observers (Prompt 5b Step 4: task completion tracking)
// ---------------------------------------------------------------------------

/**
 * Raw PTY output, observed outside the window.
 *
 * A task's completion is not observable from the shell's lifecycle:
 * `dispatchRunCommand` writes `cmd\r` into a *persistent interactive* shell,
 * which stays alive and prints a fresh prompt after the command ends. Nothing
 * about the PTY says "the task finished". The task runner therefore appends a
 * per-run sentinel to every command it writes and watches for it here.
 *
 * Notified unconditionally, BEFORE the `attached` branch in `onData`. That
 * ordering is load-bearing: a task started while the terminal drawer is closed
 * has its output buffered rather than forwarded, and buffering is exactly the
 * case where a sentinel checked only on the forwarded path would be missed —
 * leaving the task reported as running forever.
 */
export type PtyOutputListener = (ptyId: string, data: string) => void;
export type PtyExitListener = (ptyId: string, exitCode: number) => void;

const outputObservers = new Set<PtyOutputListener>();
const exitObservers = new Set<PtyExitListener>();

function notifyPtyOutput(ptyId: string, data: string): void {
  // Copied before iterating: an observer is allowed to unsubscribe itself the
  // first time it sees its own sentinel, and mutating a Set mid-iteration skips
  // the listener after it.
  for (const listener of [...outputObservers]) {
    try {
      listener(ptyId, data);
    } catch (err: unknown) {
      // An observer must never be able to break the terminal it watches.
      console.warn('[PTY] output observer failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

function notifyPtyExit(ptyId: string, exitCode: number): void {
  for (const listener of [...exitObservers]) {
    try {
      listener(ptyId, exitCode);
    } catch (err: unknown) {
      console.warn('[PTY] exit observer failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Subscribe to output from every PTY. Returns a disposer.
 *
 * Every listener receives every terminal's bytes, so a caller must filter on the
 * `ptyId` it cares about. That is deliberate: the alternative — a per-PTY
 * listener list — would have to be torn down when a PTY dies, and a listener
 * registered for a terminal that exited a moment later would leak.
 */
export function observePtyOutput(listener: PtyOutputListener): () => void {
  outputObservers.add(listener);
  return () => { outputObservers.delete(listener); };
}

/**
 * Subscribe to terminal exits. Returns a disposer.
 *
 * Fires for every way a terminal can stop being observable: the child exiting on
 * its own, and {@link killPty} closing one. The kill path has to notify
 * explicitly — it disposes the PTY's subscriptions synchronously while
 * `process.kill()` delivers its exit event asynchronously, so the child's own
 * `onExit` never runs. Without that, a task running in a terminal the user
 * closed would stay in the running list forever.
 */
export function observePtyExit(listener: PtyExitListener): () => void {
  exitObservers.add(listener);
  return () => { exitObservers.delete(listener); };
}

/** One terminal in the registry, described well enough to be listed as a process. */
export interface PtyProcessInfo {
  ptyId: string;
  /** The shell's OS pid, straight off the node-pty handle. */
  pid: number;
  shellId: string;
  shellPath: string;
  /** Exit code, once the child is gone. Absent while it is still running. */
  exited?: number;
}

/**
 * Every terminal in the registry, alive or not.
 *
 * A PTY's child is spawned with `child_process` semantics, not forked by
 * Electron, so it never appears in `app.getAppMetrics()` — this is the only
 * place its pid is known at all, which is why the process explorer reads it
 * here rather than trying to recognise a shell among the utility processes.
 *
 * Exited sessions are returned rather than filtered out here, because leaving
 * them in the registry is already this module's own doing: `onExit` only
 * deletes a session that was `attached`, so a terminal that finished with its
 * drawer closed keeps its row until the drawer next looks at it. A caller that
 * means "what is running" must check `exited` itself — and the process
 * explorer does, so a dead shell cannot be presented as a live one.
 */
export function listPtyProcesses(): PtyProcessInfo[] {
  const rows: PtyProcessInfo[] = [];
  for (const [ptyId, session] of activePtys) {
    rows.push({
      ptyId,
      pid: session.process.pid,
      shellId: session.shellId,
      shellPath: session.shellPath,
      exited: session.exited
    });
  }
  return rows;
}

function shellExists(shellPath: string): boolean {
  try { return fs.statSync(shellPath).isFile(); } catch { return false; }
}

function findOnPath(command: string): string | undefined {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, command.includes('.') ? command : `${command}${extension}`);
      if (shellExists(candidate)) return candidate;
    }
  }
  return undefined;
}

export function getAvailableShells(): ShellInfo[] {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const candidates: ShellInfo[] = [
      { id: 'powershell', name: 'Windows PowerShell', path: path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), isDefault: true },
      { id: 'cmd', name: 'Command Prompt', path: process.env.ComSpec || path.join(root, 'System32', 'cmd.exe') }
    ];
    const shells = candidates.filter((shell) => shellExists(shell.path));
    const pwshPath = findOnPath('pwsh');
    if (pwshPath) shells.splice(1, 0, { id: 'pwsh', name: 'PowerShell 7', path: pwshPath });
    const gitBash = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
    ].find(shellExists);
    if (gitBash) shells.push({ id: 'git-bash', name: 'Git Bash', path: gitBash });
    const wsl = path.join(root, 'System32', 'wsl.exe');
    if (shellExists(wsl)) shells.push({ id: 'wsl', name: 'WSL (Linux)', path: wsl });
    return shells;
  }

  const candidates = process.platform === 'darwin'
    ? [{ id: 'zsh', name: 'zsh', path: '/bin/zsh', isDefault: true }, { id: 'bash', name: 'bash', path: '/bin/bash' }]
    : [{ id: 'bash', name: 'bash', path: '/bin/bash', isDefault: true }, { id: 'zsh', name: 'zsh', path: '/bin/zsh' }, { id: 'sh', name: 'sh', path: '/bin/sh' }];
  const shells = candidates.filter((shell) => shellExists(shell.path));
  const userShell = process.env.SHELL;
  if (userShell && path.isAbsolute(userShell) && shellExists(userShell) && !shells.some((shell) => shell.path === userShell)) {
    shells.unshift({ id: 'user-shell', name: path.basename(userShell), path: userShell, isDefault: shells.length === 0 });
  }
  return shells;
}

export function spawnPtySession(mainWindow: BrowserWindow, options: PtySpawnOptions, customShellPath?: string): IpcResponse<PtySessionInfo> {
  try {
    const availableShells = getAvailableShells();
    let selectedShell: ShellInfo | undefined;
    if (options.shellId === 'custom') {
      if (!customShellPath || !path.isAbsolute(customShellPath) || !shellExists(customShellPath)) {
        return { success: false, error: 'The custom shell path must point to an existing executable.' };
      }
      selectedShell = { id: 'custom', name: path.basename(customShellPath), path: customShellPath };
    } else if (options.shellId) {
      selectedShell = availableShells.find((shell) => shell.id === options.shellId);
      if (!selectedShell) return { success: false, error: `Shell '${options.shellId}' is not available on this system.` };
    } else {
      selectedShell = availableShells.find((shell) => shell.isDefault) || availableShells[0];
    }
    if (!selectedShell) return { success: false, error: 'No supported shell was detected on this system.' };

    const ptyId = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const cols = Number.isInteger(options.cols) && options.cols && options.cols > 0 ? Math.min(options.cols, 500) : 80;
    const rows = Number.isInteger(options.rows) && options.rows && options.rows > 0 ? Math.min(options.rows, 300) : 24;
    const cwd = options.cwd && fs.existsSync(options.cwd) && fs.statSync(options.cwd).isDirectory() ? path.resolve(options.cwd) : process.cwd();
    const ptyEnv = buildSanitizedPtyEnv(process.env);
    ptyEnv.COLORTERM = 'truecolor';
    ptyEnv.TERM = 'xterm-256color';
    if (process.platform !== 'win32') {
      ptyEnv.LANG ||= 'en_US.UTF-8';
      ptyEnv.LC_ALL ||= ptyEnv.LANG;
    }

    // FCC injection: agent wrappers on PATH + loopback proxy discovery.
    try {
      buildFccTerminalEnv(ptyEnv);
    } catch {
      // FCC layer is optional; terminal still opens cleanly without it
    }

    const processHandle = pty.spawn(selectedShell.path, [], { name: 'xterm-256color', cols, rows, cwd, env: ptyEnv });
    let resolveReady: () => void = () => undefined;
    const whenReady = new Promise<void>((resolve) => { resolveReady = resolve; });
    const session: ActivePty = {
      process: processHandle, shellPath: selectedShell.path, shellId: selectedShell.id, window: mainWindow,
      outputBuffer: '', attached: false, subscriptions: [],
      whenReady, resolveReady, queue: []
    };
    activePtys.set(ptyId, session);
    session.subscriptions.push(processHandle.onData((data) => {
      notifyPtyOutput(ptyId, data);
      if (session.attached) {
        if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) session.window.webContents.send(`pty:data:${ptyId}`, data);
      } else {
        session.outputBuffer = (session.outputBuffer + data).slice(-MAX_UNATTACHED_OUTPUT);
      }
    }));
    session.subscriptions.push(processHandle.onExit(({ exitCode }) => {
      session.exited = exitCode;
      clearReportedActiveIfGone(ptyId);
      notifyPtyExit(ptyId, exitCode);
      if (session.attached) {
        if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) session.window.webContents.send(`pty:exit:${ptyId}`, exitCode);
        activePtys.delete(ptyId);
      }
    }));
    if (options.autoRunCommand) {
      const autoRun = options.autoRunCommand;
      let autoRunWritten = false;
      const writeAutoRun = () => {
        if (autoRunWritten) return;
        autoRunWritten = true;
        try {
          processHandle.write(`${autoRun}\r`);
        } catch {
          // Session may have already exited
          return;
        }
      };
      const autoRunTimer = setTimeout(writeAutoRun, 1500);
      if (typeof autoRunTimer.unref === 'function') autoRunTimer.unref();
      session.subscriptions.push(processHandle.onData(() => writeAutoRun()));
    }
    return { success: true, data: { ptyId, shellId: selectedShell.id, shellName: selectedShell.name } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PTY] Error spawning PTY:', msg);
    return { success: false, error: msg };
  }
}

/** Flush PTY output generated before the renderer registered its per-session listeners. */
export function attachPty(ptyId: string): IpcResponse<void> {
  const session = activePtys.get(ptyId);
  if (!session) return { success: false, error: 'PTY session not found.' };
  if (session.attached) return { success: true };
  session.attached = true;
  if (session.outputBuffer && !session.window.isDestroyed() && !session.window.webContents.isDestroyed()) {
    session.window.webContents.send(`pty:data:${ptyId}`, session.outputBuffer);
  }
  session.outputBuffer = '';
  if (session.exited !== undefined) {
    if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) session.window.webContents.send(`pty:exit:${ptyId}`, session.exited);
    activePtys.delete(ptyId);
    return { success: true };
  }
  // Prompt (Terminal Command Dispatch Fix): the renderer XTerm instance has
  // attached — the readiness barrier lifts and queued commands are flushed,
  // never dropped. Flush happens BEFORE resolving whenReady so awaiting
  // dispatchers observe the write as already delivered.
  const queued = session.queue.splice(0);
  for (const item of queued) {
    item.flushed = true;
    try { session.process.write(item.execute ? `${item.cmd}\r` : item.cmd); } catch { /* Process exited. */ }
  }
  session.resolveReady();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Readiness-aware command dispatch (Prompt: Terminal Command Dispatch Fix)
// ---------------------------------------------------------------------------

/** The PTY the renderer last reported as the ACTIVE visible terminal tab. */
let lastReportedActivePtyId: string | null = null;

export function reportActivePty(ptyId: string): void {
  if (activePtys.has(ptyId)) lastReportedActivePtyId = ptyId;
}

/** Forget a reported active terminal when its PTY leaves the registry. */
function clearReportedActiveIfGone(ptyId: string): void {
  if (lastReportedActivePtyId === ptyId) lastReportedActivePtyId = null;
}

export interface RunInTerminalOptions {
  terminalId?: string;
  execute?: boolean;
  createIfMissing?: boolean;
}

export interface RunInTerminalResult {
  dispatched: boolean;
  terminalId?: string;
  reason?: string;
}

const READY_WAIT_TIMEOUT_MS = 5_000;

function sendToWindow(window: BrowserWindow | undefined, channel: string, payload: unknown): void {
  try {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  } catch {
    /* Window raced shutdown; the ledger still records the outcome. */
  }
}

export interface ResolvedTaskTerminal {
  terminalId: string;
  /** The registry shell id: `powershell`, `cmd`, `bash`, `git-bash`, `custom`, … */
  shellId: string;
  /** Absolute path of the shell executable, for sniffing syntax when `shellId` is `custom`. */
  shellPath: string;
}

/**
 * Resolve — creating if necessary — the terminal a task will run in, WITHOUT
 * writing anything to it.
 *
 * This exists because a task command must be wrapped in a shell-specific
 * completion sentinel, and the correct wrapper cannot be chosen until the shell
 * is known. {@link dispatchRunCommand} resolves and writes in one step and
 * reports only a `terminalId`, which arrives too late: by the time it returns,
 * the unwrapped command is already sitting in the shell's input buffer. Splitting
 * resolution out lets the task runner resolve, pick the wrapper for the shell it
 * was handed, then call `dispatchRunCommand` with an explicit `terminalId` — so
 * the real write still rides the existing readiness/queue machinery rather than
 * a second, weaker one that drops commands typed before the terminal attaches.
 *
 * Resolution order matches `dispatchRunCommand` exactly: explicit id, then the
 * active terminal the renderer reported, then a fresh one. That is what makes
 * "Run Task…" land in the terminal the user is looking at instead of silently
 * spawning a fourth one behind the drawer.
 */
export function resolveTaskTerminal(
  opts: { terminalId?: string; cwd?: string },
  mainWindow: BrowserWindow | null
): IpcResponse<ResolvedTaskTerminal> {
  let ptyId: string | undefined;
  let session: ActivePty | undefined;

  if (opts.terminalId) {
    session = activePtys.get(opts.terminalId);
    if (!session) return { success: false, error: `Terminal '${opts.terminalId}' does not exist or has exited.` };
    ptyId = opts.terminalId;
  } else if (lastReportedActivePtyId) {
    session = activePtys.get(lastReportedActivePtyId);
    if (!session) {
      clearReportedActiveIfGone(lastReportedActivePtyId);
      lastReportedActivePtyId = null;
    } else {
      ptyId = lastReportedActivePtyId;
    }
  }

  if (!session || !ptyId) {
    if (!mainWindow) return { success: false, error: 'No main window is available to host a new terminal.' };
    const taskCwd = opts.cwd || process.cwd();
    const spawnResponse = spawnPtySession(mainWindow, { cwd: taskCwd });
    if (!spawnResponse.success || !spawnResponse.data) {
      return { success: false, error: spawnResponse.error || 'Terminal creation failed.' };
    }
    ptyId = spawnResponse.data.ptyId;
    session = activePtys.get(ptyId);
    if (!session) return { success: false, error: 'Terminal creation failed.' };
    terminalDispatchLedger.record({
      terminalId: ptyId,
      cmd: '(task terminal)',
      readyWaitMs: 0,
      outcome: 'created',
      detail: `New ${spawnResponse.data.shellName} terminal for a task`
    });
    // Same emission `dispatchRunCommand` makes, so `TerminalDrawer` adopts the
    // new PTY and the user sees the terminal the task is about to run in.
    sendToWindow(mainWindow, 'pty:session-created', {
      ptyId,
      shellId: spawnResponse.data.shellId,
      shellName: spawnResponse.data.shellName,
      cwd: taskCwd
    });
  }

  return { success: true, data: { terminalId: ptyId, shellId: session.shellId, shellPath: session.shellPath } };
}

/**
 * Readiness-aware dispatch of a command into a live, visible PTY.
 *
 * Resolution order: explicit terminalId → the ACTIVE terminal reported by the
 * renderer → create a fresh terminal when `createIfMissing`. Commands that
 * arrive before the PTY is ready are QUEUED and flushed on attach — nothing is
 * silently dropped; every failure emits `terminal:dispatch-failed` so the
 * renderer can surface a retryable toast. Execution writes use `\r`
 * (carriage return), paste-only writes omit it.
 */
export async function dispatchRunCommand(
  cmd: string,
  opts: RunInTerminalOptions,
  mainWindow: BrowserWindow | null,
  cwd?: string
): Promise<IpcResponse<RunInTerminalResult>> {
  const execute = opts.execute !== false;
  const startedAt = Date.now();
  const failVisible = (reason: string): IpcResponse<RunInTerminalResult> => {
    terminalDispatchLedger.record({ terminalId: opts.terminalId || lastReportedActivePtyId || '(none)', cmd, readyWaitMs: Date.now() - startedAt, outcome: 'failed', detail: reason });
    sendToWindow(mainWindow || undefined, 'terminal:dispatch-failed', { cmd, opts, reason });
    return { success: false, error: reason };
  };

  let ptyId: string | undefined;
  let session: ActivePty | undefined;

  if (opts.terminalId) {
    session = activePtys.get(opts.terminalId);
    if (!session) return failVisible(`Terminal '${opts.terminalId}' does not exist or has exited.`);
    ptyId = opts.terminalId;
  } else if (lastReportedActivePtyId) {
    session = activePtys.get(lastReportedActivePtyId);
    if (!session) {
      clearReportedActiveIfGone(lastReportedActivePtyId);
      lastReportedActivePtyId = null;
    } else {
      ptyId = lastReportedActivePtyId;
    }
  }

  if (!session && opts.createIfMissing) {
    if (!mainWindow) return failVisible('No main window is available to host a new terminal.');
    const spawnResponse = spawnPtySession(mainWindow, { cwd: cwd || process.cwd() });
    if (!spawnResponse.success || !spawnResponse.data) return failVisible(spawnResponse.error || 'Terminal creation failed.');
    ptyId = spawnResponse.data.ptyId;
    session = activePtys.get(ptyId);
    if (!session) return failVisible('Terminal creation failed.');
    terminalDispatchLedger.record({ terminalId: ptyId, cmd, readyWaitMs: 0, outcome: 'created', detail: `New ${spawnResponse.data.shellName} terminal` });
    sendToWindow(mainWindow, 'pty:session-created', { ptyId, shellId: spawnResponse.data.shellId, shellName: spawnResponse.data.shellName, cwd: cwd || process.cwd() });
  }

  if (!session || !ptyId) {
    return failVisible('No active terminal to receive the command.');
  }

  const writeNow = (): boolean => {
    // node-pty lifecycle safety: never write to a disposed/exited PTY.
    if (session.exited !== undefined || activePtys.get(ptyId) !== session) return false;
    try {
      session.process.write(execute ? `${cmd}\r` : cmd);
      return true;
    } catch {
      return false;
    }
  };

  let readyWaitMs = 0;
  if (session.attached) {
    if (!writeNow()) return failVisible('Terminal exited before the command could be written.');
  } else {
    const queued = { cmd, execute, flushed: false };
    session.queue.push(queued);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, READY_WAIT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      await session.whenReady;
    } catch {
      /* whenReady never rejects today; guard anyway. */
    }
    clearTimeout(timer);
    if (timedOut && !queued.flushed) {
      session.queue = session.queue.filter((item) => item !== queued);
      const reason = `Terminal did not become ready within ${READY_WAIT_TIMEOUT_MS / 1000}s. The command was not dropped silently — press Retry.`;
      terminalDispatchLedger.record({ terminalId: ptyId, cmd, readyWaitMs: Date.now() - startedAt, outcome: 'timeout', detail: reason });
      sendToWindow(session.window, 'terminal:dispatch-failed', { cmd, opts, reason, terminalId: ptyId });
      return { success: false, error: reason };
    }
    readyWaitMs = Date.now() - startedAt;
    if (!queued.flushed && !writeNow()) return failVisible('Terminal exited before the command could be written.');
  }

  terminalDispatchLedger.record({ terminalId: ptyId, cmd, readyWaitMs, outcome: 'executed' });
  sendToWindow(session.window, 'terminal:command-dispatched', { terminalId: ptyId, cmd, execute });
  return { success: true, data: { dispatched: true, terminalId: ptyId } };
}

interface PendingPtyApproval {
  ptyId: string;
  command: string;
  data: string;
  window: BrowserWindow;
  timer: ReturnType<typeof setTimeout>;
}

const pendingPtyApprovals = new Map<string, PendingPtyApproval>();
const ptyInputBuffers = new Map<string, string>();

export function writePty(ptyId: string, data: string): void {
  if (data.length > 64_000) return;
  const session = activePtys.get(ptyId);
  if (!session) return;

  // Direct manual user typing is never blocked by AI policy
  try {
    session.process.write(data);
  } catch {
    /* Process exited. */
  }
}

export function resolvePtyApproval(approvalId: string, approved: boolean): IpcResponse<void> {
  const pending = pendingPtyApprovals.get(approvalId);
  if (!pending) return { success: false, error: 'Approval request not found or expired.' };
  clearTimeout(pending.timer);
  pendingPtyApprovals.delete(approvalId);
  const session = activePtys.get(pending.ptyId);

  if (session) {
    if (approved) {
      try {
        session.process.write(pending.data);
      } catch {
        return { success: false, error: 'Failed to write to terminal.' };
      }
    } else {
      try {
        session.process.write('\x03\r\n\x1b[33mCommand rejected by user\x1b[0m\r\n');
      } catch {}
    }
  }
  return { success: true };
}

export async function executePtyCommand(
  ptyId: string,
  cmd: string,
  win?: BrowserWindow
): Promise<{ executed: boolean; status: 'executed' | 'blocked' | 'ask'; reason?: string; approvalId?: string }> {
  const session = activePtys.get(ptyId);
  const targetWin = win || session?.window;
  const policy = new SecurityPolicyEngine(process.cwd(), settingsManager);
  const check = await policy.checkTerminalCommand(cmd);

  if (check.blocked || check.status === 'BLOCK') {
    if (targetWin && !targetWin.isDestroyed() && !targetWin.webContents.isDestroyed()) {
      targetWin.webContents.send('toast:show', {
        type: 'error',
        title: 'Command Blocked',
        message: 'Command blocked by Restricted Mode'
      });
      targetWin.webContents.send('pty:command-blocked', { ptyId, command: cmd, reason: check.reason });
    }
    return { executed: false, status: 'blocked', reason: check.reason };
  }

  if (check.ask || check.status === 'ASK') {
    const approvalId = `pty_approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (targetWin && !targetWin.isDestroyed() && !targetWin.webContents.isDestroyed()) {
      targetWin.webContents.send('pty:approval-required', {
        approvalId,
        ptyId,
        command: cmd,
        reason: check.reason
      });
    }
    pendingPtyApprovals.set(approvalId, {
      ptyId,
      command: cmd,
      data: `${cmd}\r`,
      window: targetWin as BrowserWindow,
      timer: setTimeout(() => resolvePtyApproval(approvalId, false), 120_000)
    });
    return { executed: false, status: 'ask', reason: check.reason, approvalId };
  }

  if (session) {
    try {
      session.process.write(`${cmd}\r`);
    } catch {}
  }
  return { executed: true, status: 'executed' };
}

export async function checkTerminalCommand(
  command: string,
  cwd?: string
): Promise<{ decision: 'allow' | 'ask' | 'block'; status: 'ALLOW' | 'ASK' | 'BLOCK'; reason: string; allowed: boolean; blocked: boolean; ask: boolean }> {
  const policy = new SecurityPolicyEngine(cwd || process.cwd(), settingsManager);
  return policy.checkTerminalCommand(command);
}

export function syncPtyCwd(ptyId: string, targetCwd: string, shellId: string): void {
  const session = activePtys.get(ptyId);
  if (!session || !path.isAbsolute(targetCwd)) return;
  try { if (!fs.statSync(targetCwd).isDirectory()) return; } catch { return; }
  const customShellName = path.basename(session.shellPath).toLowerCase();
  const actualShell = shellId === 'custom' && process.platform === 'win32'
    ? customShellName === 'cmd.exe' ? 'cmd' : customShellName.startsWith('powershell') || customShellName.startsWith('pwsh') ? 'powershell' : 'posix'
    : shellId;
  let command: string;
  if (actualShell === 'cmd') command = `cd /d "${targetCwd.replace(/"/g, '""')}"\r`;
  else if (actualShell === 'powershell' || actualShell === 'pwsh') command = `Set-Location -LiteralPath '${targetCwd.replace(/'/g, "''")}'\r`;
  else command = `cd -- '${targetCwd.replace(/'/g, "'\\''")}'\r`;
  try { session.process.write(command); } catch { /* Process exited. */ }
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  const session = activePtys.get(ptyId);
  if (!session || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
  try { session.process.resize(Math.min(cols, 500), Math.min(rows, 300)); } catch { /* Process exited. */ }
}

export function killPty(ptyId: string): IpcResponse<void> {
  const session = activePtys.get(ptyId);
  if (!session) return { success: false, error: 'PTY session not found' };
  clearReportedActiveIfGone(ptyId);
  try { session.process.kill(); } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    session.subscriptions.forEach((subscription) => subscription.dispose());
    activePtys.delete(ptyId);
    // Notify last, after the session is out of `activePtys`: an observer is free
    // to call back into this module synchronously, and resolving a terminal must
    // not find the one being torn down. `session.exited` is set only by the
    // child's own `onExit`, which already notified, so an already-dead shell is
    // not reported twice. `-1` stands for "killed, no code", which is how a shell
    // reads a SIGKILL.
    if (session.exited === undefined) notifyPtyExit(ptyId, -1);
  }
  return { success: true };
}

export function cleanupAllPtys(): void {
  lastReportedActivePtyId = null;
  for (const session of activePtys.values()) {
    session.subscriptions.forEach((subscription) => subscription.dispose());
    try { session.process.kill(); } catch { /* Process already exited. */ }
  }
  activePtys.clear();
}

export async function runCommand(options: CommandExecutionOptions): Promise<IpcResponse<CommandResult>> {
  const cwd = options.cwd || process.cwd();
  const policy = new SecurityPolicyEngine(cwd, settingsManager);
  const check = await policy.checkTerminalCommand(options.command);

  if (check.blocked) {
    return {
      success: false,
      error: `Command blocked by Restricted Mode: ${check.reason}`
    };
  }

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/bash';
    const args = isWin ? ['-NoProfile', '-Command', options.command] : ['-c', options.command];
    const timeout = options.timeoutMs || 45000;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (response: IpcResponse<CommandResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const child = childSpawn(shell, args, { cwd, env: { ...buildSanitizedPtyEnv(process.env), PAGER: 'cat' }, windowsHide: true });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.on('error', (err) => finish({ success: false, error: `Failed to spawn shell process: ${err.message}` }));
    child.on('close', (code) => timedOut
      ? finish({ success: false, error: `Command execution timed out after ${timeout}ms` })
      : finish({ success: true, data: { stdout, stderr, exitCode: code ?? 0 } }));
  });
}
