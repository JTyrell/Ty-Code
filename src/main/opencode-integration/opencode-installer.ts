/**
 * OpenCode CLI Installer — zero-touch installation of the `opencode` CLI so
 * the OpenCode free tier (subprocess bridge) becomes usable without any
 * manual terminal work. Mirrors the FCC installer contract: staged progress
 * streamed to ALL renderer windows on 'opencode:install-progress', an npm
 * install with a strict timeout, and a real verification pass afterwards
 * (PATH re-scan + `opencode --version`).
 */

import { spawn, spawnSync } from 'child_process';

export type OpencodeInstallStage = 'checking' | 'installing' | 'verifying' | 'done' | 'failed';

export interface OpencodeInstallProgress {
  stage: OpencodeInstallStage;
  percent: number;
  message: string;
}

export interface OpencodeInstallResult {
  success: boolean;
  cliPath?: string | null;
  alreadyInstalled?: boolean;
  error?: string;
  output: string[];
}

export interface OpencodeInstallState {
  installing: boolean;
  stage: OpencodeInstallStage | 'idle';
  percent: number;
  message: string;
  lastResult: { success: boolean; cliPath: string | null; error: string | null } | null;
}

const OPENCODE_NPM_PACKAGE = '@opencode-ai/cli';
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export class OpencodeInstaller {
  private installing = false;
  private state: OpencodeInstallState = {
    installing: false,
    stage: 'idle',
    percent: 0,
    message: '',
    lastResult: null
  };

  public isInstalling(): boolean {
    return this.installing;
  }

  public getState(): OpencodeInstallState {
    return { ...this.state };
  }

  public async install(
    onProgress: (progress: OpencodeInstallProgress) => void,
    signal?: AbortSignal
  ): Promise<OpencodeInstallResult> {
    if (this.installing) {
      return { success: false, error: 'An OpenCode installation is already in progress.', output: [] };
    }

    this.installing = true;
    const output: string[] = [];
    const emit = (stage: OpencodeInstallStage, percent: number, message: string) => {
      this.state = { ...this.state, stage, percent, message, installing: this.installing };
      onProgress({ stage, percent, message });
    };

    try {
      emit('checking', 3, 'Checking for an existing opencode CLI...');
      const { opencodeServiceManager } = await import('./opencode-service-manager');
      const existing = opencodeServiceManager.discoverOpencodeCli();
      if (existing) {
        emit('done', 100, `opencode already installed at ${existing}`);
        this.state = { ...this.state, lastResult: { success: true, cliPath: existing, error: null } };
        return { success: true, cliPath: existing, alreadyInstalled: true, output: [] };
      }

      emit('installing', 10, `Running npm install -g ${OPENCODE_NPM_PACKAGE}...`);
      const { code, timedOut } = await this.runNpmInstall((line) => {
        output.push(line);
        if (line) emit('installing', Math.min(80, 14 + output.length), line);
      }, signal);

      if (timedOut) {
        const message = 'OpenCode install timed out after 5 minutes.';
        emit('failed', 100, message);
        this.state = { ...this.state, lastResult: { success: false, cliPath: null, error: message } };
        return { success: false, error: message, output };
      }
      if (code !== 0) {
        const tail = output.slice(-5).join(' | ');
        const message = `npm install -g ${OPENCODE_NPM_PACKAGE} exited with code ${code}. Last output: ${tail || '(none)'}`;
        emit('failed', 100, message);
        this.state = { ...this.state, lastResult: { success: false, cliPath: null, error: message } };
        return { success: false, error: message, output };
      }

      emit('verifying', 88, 'Install finished. Re-scanning PATH for the opencode CLI...');
      const cliPath = opencodeServiceManager.discoverOpencodeCli();
      if (!cliPath) {
        const message =
          'npm install completed, but the opencode CLI was not found on PATH afterwards. ' +
          'It may need a terminal restart (PATH refresh) before Ty-Code can see it.';
        emit('failed', 100, message);
        this.state = { ...this.state, lastResult: { success: false, cliPath: null, error: message } };
        return { success: false, error: message, output };
      }
      const probe = spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      if (probe.status !== 0 && !`${probe.stdout || ''}${probe.stderr || ''}`.trim()) {
        const message = `opencode --version failed after install (exit code ${probe.status}).`;
        emit('failed', 100, message);
        this.state = { ...this.state, lastResult: { success: false, cliPath: null, error: message } };
        return { success: false, error: message, output };
      }

      emit('done', 100, `OpenCode CLI installed at ${cliPath}`);
      this.state = { ...this.state, lastResult: { success: true, cliPath, error: null } };
      return { success: true, cliPath, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('failed', 100, message);
      this.state = { ...this.state, lastResult: { success: false, cliPath: null, error: message } };
      return { success: false, error: message, output };
    } finally {
      this.installing = false;
      this.state = { ...this.state, installing: false };
    }
  }

  /**
   * npm -g install. On Windows npm ships as npm.cmd; spawning it directly
   * (shell:false) keeps output clean and avoids command injection surface.
   */
  private runNpmInstall(
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

      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      this.ensureNpmOnPath();
      processRef = spawn(npmBin, ['install', '-g', OPENCODE_NPM_PACKAGE, '--no-fund', '--no-audit'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });

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
        onLine(
          `failed to launch npm (${err.message}). ` +
            'Install Node.js/npm manually or add the @opencode-ai/cli package to your PATH.'
        );
      });
      processRef.on('close', (code) => finish(code));
    });
  }

  /**
   * The packaged Electron app can inherit a trimmed PATH (GUI launch) that
   * misses the npm global bin dir; graft the conventional locations on so
   * `npm.cmd` resolves for the child process.
   */
  private ensureNpmOnPath(): void {
    const extraDirs =
      process.platform === 'win32'
        ? [process.env.APPDATA ? `${process.env.APPDATA}\\npm` : '']
        : ['/usr/local/bin', '/usr/bin', process.env.HOME ? `${process.env.HOME}/.npm-global/bin` : ''];
    const additions = extraDirs.filter((d) => d);
    const current = process.env.PATH || '';
    const missing = additions.filter((dir) => !current.split(process.platform === 'win32' ? ';' : ':').includes(dir));
    if (missing.length > 0) {
      process.env.PATH = `${current}${process.platform === 'win32' ? ';' : ':'}${missing.join(process.platform === 'win32' ? ';' : ':')}`;
    }
  }
}

export const opencodeInstaller = new OpencodeInstaller();
