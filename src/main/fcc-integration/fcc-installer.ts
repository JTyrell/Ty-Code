/**
 * FCC Installer
 * Silent, cross-platform installation of the free-claude-code (FCC) engine
 * using the project's official install scripts, streamed to the renderer
 * via progress callbacks. All progress mirrors real script output.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export type FccInstallStage = 'checking' | 'downloading' | 'installing' | 'verifying' | 'done' | 'failed';

export interface FccInstallProgress {
  stage: FccInstallStage;
  percent: number;
  message: string;
}

export interface FccInstallResult {
  success: boolean;
  binaryPath?: string;
  alreadyInstalled?: boolean;
  error?: string;
  output: string[];
}

export const FCC_SERVER_COMMAND_CANDIDATES = ['fcc-server', 'fcc'];
export const FCC_WRAPPER_CONFIGS: Array<{ file: string; command: string; desc: string }> = [
  { file: 'fcc-claude', command: 'fcc-claude', desc: 'FCC Claude Code agent' },
  { file: 'fcc-codex', command: 'fcc-codex', desc: 'FCC Codex agent' },
  { file: 'fcc-cline', command: 'fcc-cline', desc: 'FCC Cline agent' }
];

const FCC_INSTALL_PS1 = 'https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1';
const FCC_INSTALL_SH = 'https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.sh';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function executableExts(): string[] {
  return process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

/** Scans PATH and known FCC install locations for the FCC server binary. */
export async function discoverFccBinary(): Promise<string | null> {
  const envOverride = process.env.FCC_SERVER_PATH;
  if (envOverride && isExecutableFile(envOverride)) return envOverride;

  const dirs = Array.from(
    new Set(
      [
        ...(process.env.PATH || '').split(path.delimiter),
        ...(process.platform === 'win32'
          ? [
              path.join(process.env.LOCALAPPDATA || '', 'Programs', 'free-claude-code'),
              path.join(process.env.LOCALAPPDATA || '', 'free-claude-code'),
              path.join(process.env.USERPROFILE || '', '.local', 'bin'),
              path.join(process.env.APPDATA || '', 'npm')
            ]
          : [
              '/usr/local/bin',
              '/usr/bin',
              path.join(process.env.HOME || '', '.local', 'bin'),
              path.join(process.env.HOME || '', '.fcc', 'bin')
            ])
      ].filter((d) => d)
    )
  );

  for (const dir of dirs) {
    for (const base of FCC_SERVER_COMMAND_CANDIDATES) {
      for (const ext of executableExts()) {
        const candidate = path.join(dir, base + ext);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** Wrappers (fcc-claude / fcc-codex / fcc-cline) found next to the binary or on PATH. */
export function discoverWrapperCommands(binaryPath: string | null): string[] {
  const wrappers: string[] = [];
  for (const wrapper of FCC_WRAPPER_CONFIGS) {
    let found = false;
    for (const dir of [
      ...(binaryPath ? [path.dirname(binaryPath)] : []),
      ...(process.env.PATH || '').split(path.delimiter)
    ]) {
      if (!dir) continue;
      for (const ext of executableExts()) {
        if (isExecutableFile(path.join(dir, wrapper.file + ext))) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) wrappers.push(wrapper.command);
  }
  return wrappers;
}

export class FCCInstaller {
  private installing = false;

  public isInstalling(): boolean {
    return this.installing;
  }

  public async install(
    onProgress: (progress: FccInstallProgress) => void,
    signal?: AbortSignal
  ): Promise<FccInstallResult> {
    if (this.installing) {
      return { success: false, error: 'An FCC installation is already in progress.', output: [] };
    }

    onProgress({ stage: 'checking', percent: 3, message: 'Checking for an existing free-claude-code installation...' });
    const existing = await discoverFccBinary();
    if (existing) {
      onProgress({ stage: 'done', percent: 100, message: `free-claude-code already installed at ${existing}` });
      return { success: true, binaryPath: existing, alreadyInstalled: true, output: [] };
    }
    this.installing = true;
    const output: string[] = [];
    try {
      onProgress({ stage: 'downloading', percent: 8, message: 'Downloading free-claude-code via the official install script...' });
      const { code, timedOut } = await this.runInstallScript((line) => {
        output.push(line);
        if (line) {
          onProgress({ stage: 'installing', percent: Math.min(90, 12 + output.length * 2), message: line });
        }
      }, signal);

      if (timedOut) {
        const message = 'FCC install script timed out after 10 minutes.';
        onProgress({ stage: 'failed', percent: 100, message });
        return { success: false, error: message, output };
      }
      if (code !== 0) {
        const tail = output.slice(-5).join(' | ');
        const message = `FCC install script exited with code ${code}. Last output: ${tail || '(none)'}`;
        onProgress({ stage: 'failed', percent: 100, message });
        return { success: false, error: message, output };
      }

      onProgress({ stage: 'verifying', percent: 94, message: 'Install script finished. Locating the FCC binary...' });
      const binaryPath = await discoverFccBinary();
      if (!binaryPath) {
        const message =
          'FCC install script completed, but no FCC binary was found on PATH afterwards. ' +
          'Check the install output and set the FCC_SERVER_PATH environment variable if FCC installed to a custom location.';
        onProgress({ stage: 'failed', percent: 100, message });
        return { success: false, error: message, output };
      }

      onProgress({ stage: 'done', percent: 100, message: `free-claude-code installed at ${binaryPath}` });
      return { success: true, binaryPath, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ stage: 'failed', percent: 100, message });
      return { success: false, error: message, output };
    } finally {
      this.installing = false;
    }
  }

  private runInstallScript(
    onLine: (line: string) => void,
    signal?: AbortSignal
  ): Promise<{ code: number | null; timedOut: boolean }> {
    return new Promise((resolve) => {
      let processRef: ReturnType<typeof spawn> | null = null;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          processRef?.kill();
        } catch {
          // Process already exited
        }
      }, INSTALL_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();

      const finish = (code: number | null): void => {
        clearTimeout(timer);
        resolve({ code, timedOut });
      };

      if (process.platform === 'win32') {
        const command =
          `& ([scriptblock]::Create((irm '${FCC_INSTALL_PS1}')))`;
        processRef = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        processRef = spawn('/bin/sh', ['-c', `curl -fsSL '${FCC_INSTALL_SH}' | sh`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      }

      if (signal) {
        if (signal.aborted) {
          try {
            processRef.kill();
          } catch {
            // Already exited
          }
        } else {
          signal.addEventListener('abort', () => {
            try {
              processRef?.kill();
            } catch {
              // Already exited
            }
          }, { once: true });
        }
      }

      processRef.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) onLine(line.trim());
        }
      });
      processRef.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) onLine(line.trim());
        }
      });
      processRef.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, timedOut });
        onLine(`failed to launch FCC install script: ${err.message}`);
      });
      processRef.on('close', (code) => finish(code));
    });
  }
}
