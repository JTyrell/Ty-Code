import { spawn as childSpawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { CommandExecutionOptions, CommandResult, IpcResponse, PtySessionInfo, PtySpawnOptions, ShellInfo } from '../../preload/types';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager } from '../services/settings-manager';

interface ActivePty {
  process: pty.IPty;
  shellPath: string;
  window: BrowserWindow;
  outputBuffer: string;
  attached: boolean;
  exited?: number;
  subscriptions: Array<{ dispose: () => void }>;
}

const activePtys = new Map<string, ActivePty>();
const MAX_UNATTACHED_OUTPUT = 256_000;

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
    const ptyEnv: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
    ptyEnv.COLORTERM = 'truecolor';
    ptyEnv.TERM = 'xterm-256color';
    if (process.platform !== 'win32') {
      ptyEnv.LANG ||= 'en_US.UTF-8';
      ptyEnv.LC_ALL ||= ptyEnv.LANG;
    }

    const processHandle = pty.spawn(selectedShell.path, [], { name: 'xterm-256color', cols, rows, cwd, env: ptyEnv });
    const session: ActivePty = { process: processHandle, shellPath: selectedShell.path, window: mainWindow, outputBuffer: '', attached: false, subscriptions: [] };
    activePtys.set(ptyId, session);
    session.subscriptions.push(processHandle.onData((data) => {
      if (session.attached) {
        if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) session.window.webContents.send(`pty:data:${ptyId}`, data);
      } else {
        session.outputBuffer = (session.outputBuffer + data).slice(-MAX_UNATTACHED_OUTPUT);
      }
    }));
    session.subscriptions.push(processHandle.onExit(({ exitCode }) => {
      session.exited = exitCode;
      if (session.attached) {
        if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) session.window.webContents.send(`pty:exit:${ptyId}`, exitCode);
        activePtys.delete(ptyId);
      }
    }));
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
  }
  return { success: true };
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

  // Intercept submitted commands against security policy
  const hasNewline = data.includes('\r') || data.includes('\n');
  if (hasNewline) {
    const buffered = ptyInputBuffers.get(ptyId) || '';
    ptyInputBuffers.delete(ptyId);
    const lineCandidate = (buffered + data).split(/[\r\n]/)[0].trim();
    if (lineCandidate) {
      const policy = new SecurityPolicyEngine(process.cwd(), settingsManager);
      void policy.checkTerminalCommand(lineCandidate).then((check) => {
        if (check.blocked || check.status === 'BLOCK') {
          if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) {
            session.window.webContents.send('toast:show', {
              type: 'error',
              title: 'Command Blocked',
              message: 'Command blocked by Restricted Mode'
            });
            session.window.webContents.send('pty:command-blocked', { ptyId, command: lineCandidate, reason: check.reason });
          }
          try {
            session.process.write('\x03\r\n\x1b[31mCommand blocked by Restricted Mode\x1b[0m\r\n');
          } catch {}
          return;
        }

        if (check.ask || check.status === 'ASK') {
          const approvalId = `pty_approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) {
            session.window.webContents.send('pty:approval-required', {
              approvalId,
              ptyId,
              command: lineCandidate,
              reason: check.reason
            });
          }
          pendingPtyApprovals.set(approvalId, {
            ptyId,
            command: lineCandidate,
            data,
            window: session.window,
            timer: setTimeout(() => resolvePtyApproval(approvalId, false), 120_000)
          });
          return;
        }

        try {
          session.process.write(data);
        } catch {}
      }).catch(() => {
        try { session.process.write(data); } catch {}
      });
      return;
    }
  } else {
    const current = (ptyInputBuffers.get(ptyId) || '') + data;
    ptyInputBuffers.set(ptyId, current);
  }

  try { session.process.write(data); } catch { /* Process exited. */ }
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
  try { session.process.kill(); } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    session.subscriptions.forEach((subscription) => subscription.dispose());
    activePtys.delete(ptyId);
  }
  return { success: true };
}

export function cleanupAllPtys(): void {
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
    const child = childSpawn(shell, args, { cwd, env: { ...process.env, PAGER: 'cat' }, windowsHide: true });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.on('error', (err) => finish({ success: false, error: `Failed to spawn shell process: ${err.message}` }));
    child.on('close', (code) => timedOut
      ? finish({ success: false, error: `Command execution timed out after ${timeout}ms` })
      : finish({ success: true, data: { stdout, stderr, exitCode: code ?? 0 } }));
  });
}
