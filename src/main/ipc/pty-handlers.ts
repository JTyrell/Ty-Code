import { spawn } from 'child_process';
import type { CommandExecutionOptions, CommandResult, IpcResponse } from '../../preload/types';

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

    const child = spawn(shell, args, {
      cwd,
      env: { ...process.env, PAGER: 'cat' },
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

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
