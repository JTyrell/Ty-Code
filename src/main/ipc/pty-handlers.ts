import { spawn as childSpawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type {
  CommandExecutionOptions,
  CommandResult,
  IpcResponse,
  PtySessionInfo,
  PtySpawnOptions,
  ShellInfo
} from '../../preload/types';

// Active PTY process registry
const activePtys = new Map<string, pty.IPty>();

/**
 * Detect all available terminal shells based on the host Operating System
 */
export function getAvailableShells(): ShellInfo[] {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const shells: ShellInfo[] = [
      {
        id: 'powershell',
        name: 'PowerShell',
        path: process.env.SystemRoot
          ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          : 'powershell.exe',
        isDefault: true
      },
      {
        id: 'cmd',
        name: 'Command Prompt',
        path: process.env.SystemRoot
          ? path.join(process.env.SystemRoot, 'System32', 'cmd.exe')
          : 'cmd.exe'
      }
    ];

    // Check Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
    ];
    for (const p of gitBashPaths) {
      if (fs.existsSync(p)) {
        shells.push({ id: 'git-bash', name: 'Git Bash', path: p });
        break;
      }
    }

    // Check WSL
    const wslPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    if (fs.existsSync(wslPath)) {
      shells.push({ id: 'wsl', name: 'WSL (Linux)', path: wslPath });
    }

    return shells;
  }

  if (isMac) {
    return [
      { id: 'zsh', name: 'zsh', path: '/bin/zsh', isDefault: true },
      { id: 'bash', name: 'bash', path: '/bin/bash' }
    ];
  }

  // Linux
  const linuxShells: ShellInfo[] = [
    { id: 'bash', name: 'bash', path: '/bin/bash', isDefault: true }
  ];
  if (fs.existsSync('/bin/zsh') || fs.existsSync('/usr/bin/zsh')) {
    linuxShells.push({
      id: 'zsh',
      name: 'zsh',
      path: fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/usr/bin/zsh'
    });
  }
  if (fs.existsSync('/bin/sh')) {
    linuxShells.push({ id: 'sh', name: 'sh', path: '/bin/sh' });
  }

  return linuxShells;
}

/**
 * Spawn an interactive PTY session
 */
export function spawnPtySession(
  mainWindow: BrowserWindow,
  options: PtySpawnOptions
): IpcResponse<PtySessionInfo> {
  try {
    const availableShells = getAvailableShells();
    let selectedShell = availableShells.find((s) => s.id === options.shellId) || availableShells.find((s) => s.isDefault) || availableShells[0];

    const ptyId = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || process.cwd();

    // Inherit full parent environment with UTF-8 encoding flags
    const ptyEnv = {
      ...process.env,
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8'
    };

    // Node-pty spawn with truecolor terminal emulation
    const ptyProcess = pty.spawn(selectedShell.path, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: ptyEnv
    });

    activePtys.set(ptyId, ptyProcess);

    // Stream stdout to renderer
    ptyProcess.onData((data) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty:data:${ptyId}`, data);
      }
    });

    // Notify renderer on exit
    ptyProcess.onExit(({ exitCode }) => {
      activePtys.delete(ptyId);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty:exit:${ptyId}`, exitCode);
      }
    });

    return {
      success: true,
      data: {
        ptyId,
        shellId: selectedShell.id,
        shellName: selectedShell.name
      }
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PTY] Error spawning PTY:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Send user keystrokes / input to PTY process
 */
export function writePty(ptyId: string, data: string): void {
  const ptyProcess = activePtys.get(ptyId);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

/**
 * Synchronize terminal working directory with active file directory
 */
export function syncPtyCwd(ptyId: string, targetCwd: string, shellId: string): void {
  const ptyProcess = activePtys.get(ptyId);
  if (!ptyProcess) return;

  if (shellId === 'cmd') {
    ptyProcess.write(`cd /d "${targetCwd}"\r\n`);
  } else if (shellId === 'powershell') {
    ptyProcess.write(`Set-Location -LiteralPath '${targetCwd}'\r\n`);
  } else {
    ptyProcess.write(`cd '${targetCwd}'\r\n`);
  }
}


/**
 * Resize PTY dimensions
 */
export function resizePty(ptyId: string, cols: number, rows: number): void {
  const ptyProcess = activePtys.get(ptyId);
  if (ptyProcess && cols > 0 && rows > 0) {
    try {
      ptyProcess.resize(cols, rows);
    } catch {
      // ignore resize error on process death
    }
  }
}

/**
 * Terminate PTY session
 */
export function killPty(ptyId: string): IpcResponse<void> {
  const ptyProcess = activePtys.get(ptyId);
  if (ptyProcess) {
    ptyProcess.kill();
    activePtys.delete(ptyId);
    return { success: true };
  }
  return { success: false, error: 'PTY session not found' };
}

/**
 * Clean up all active PTYs on app shutdown
 */
export function cleanupAllPtys(): void {
  for (const [_, ptyProcess] of activePtys) {
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  }
  activePtys.clear();
}

/**
 * Non-interactive one-shot command runner for Agent tools
 */
export async function runCommand(options: CommandExecutionOptions): Promise<IpcResponse<CommandResult>> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/bash';
    const args = isWin ? ['-NoProfile', '-Command', options.command] : ['-c', options.command];

    const cwd = options.cwd || process.cwd();
    const timeout = options.timeoutMs || 45000;

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = childSpawn(shell, args, {
      cwd,
      env: { ...process.env, PAGER: 'cat' },
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Failed to spawn shell process: ${err.message}`
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          success: false,
          error: `Command execution timed out after ${timeout}ms`
        });
      } else {
        resolve({
          success: true,
          data: {
            stdout,
            stderr,
            exitCode: code ?? 0
          }
        });
      }
    });
  });
}
