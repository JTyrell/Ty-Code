/**
 * OpenCode Bridge — real `opencode` CLI subprocess bridge (Prompt 2).
 *
 * Executes prompts through the user's installed `opencode` CLI instead of an
 * HTTP endpoint, streaming stdout as an async iterable. This makes locally
 * synced OpenCode free models first-class chat citizens:
 *  - no HTTP request is ever issued for this tier
 *  - no node-pty / no fake TTY: stdout/stderr are plain pipes (a TUI IS a
 *    misroute — non-interactive `run` mode is the only supported surface)
 *  - API keys, when present, are injected via environment variables only —
 *    they never appear on the argv line or in spawned-process listings
 *  - ANSI styling / control sequences are stripped before chunks are consumed
 *  - external abort (AbortSignal) is honored mid-stream and kills the child
 */

import { spawn, spawnSync } from 'child_process';

/** Thrown when the local opencode CLI is absent (or not runnable). */
export class OpenCodeNotInstalledError extends Error {
  constructor(message?: string) {
    super(message || 'OpenCode CLI not found — install it with `npm install -g @opencode-ai/cli` (or curl -fsSL https://opencode.ai/install | bash) and run `opencode` once sync its config.');
    this.name = 'OpenCodeNotInstalledError';
  }
}

export interface ExecutePromptOptions {
  abortSignal?: AbortSignal;
  cwd?: string;
}

export interface OpenCodeBridgeStatus {
  cliAvailable: boolean;
  cliPath: string | null;
  lastError: string | null;
  lastCheckedAt: number | null;
}

const CLI_CHECK_TTL_MS = 10 * 60 * 1000;

/** Matches CSI sequences, OSC sequences (title/final term), and stray CRs. */
const ANSI_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-_]|\r/g;

export function stripAnsiAndNormalize(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

/**
 * Flattens a chat message array into a single prompt string the CLI's
 * non-interactive `run` mode can consume. System context is preserved
 * explicitly instead of being dropped.
 */
export function buildBridgePromptFromMessages(messages: any[]): string {
  const parts: string[] = [];
  for (const message of messages || []) {
    const role = String(message?.role || 'user').toLowerCase();
    const rawContent = message?.content;
    const text = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
          .filter((part: any) => part && part.type === 'text')
          .map((part: any) => part.text || '')
          .join('\n')
        : '';
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (role === 'system') parts.push(`[Instructions]\n${trimmed}\n`);
    else if (role === 'assistant') parts.push(`[Previous assistant reply]\n${trimmed}\n`);
    else parts.push(`[User]\n${trimmed}\n`);
  }
  // Stay comfortably under the OS CreateProcess argv limit on Windows.
  const joined = parts.join('\n').trim();
  return joined.length > 24_000 ? joined.slice(0, 24_000) : joined;
}

/** Maps the model id's provider prefix onto the CLI's expected env var. */
function envVarForModelPrefix(modelId: string): string | null {
  const prefix = (modelId || '').toLowerCase().split('/')[0];
  if (!prefix || (modelId || '').split('/').length < 2) return null;
  switch (prefix) {
    case 'openrouter': return 'OPENROUTER_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'openai': return 'OPENAI_API_KEY';
    case 'google': return 'GEMINI_API_KEY';
    case 'groq': return 'GROQ_API_KEY';
    case 'deepseek': return 'DEEPSEEK_API_KEY';
    default: return `${prefix.toUpperCase()}_API_KEY`.replace(/[^A-Z0-9_]/g, '_');
  }
}

interface CliCheck {
  available: boolean;
  cliPath: string | null;
  checkedAt: number;
  lastError: string | null;
}

export class OpenCodeBridge {
  private cliCheck: CliCheck | null = null;
  private statusListeners = new Set<(status: OpenCodeBridgeStatus) => void>();

  public getStatus(): OpenCodeBridgeStatus {
    const check = this.cliCheck;
    return {
      cliAvailable: check?.available ?? false,
      cliPath: check?.cliPath ?? null,
      lastError: check?.lastError ?? null,
      lastCheckedAt: check?.checkedAt ?? null
    };
  }

  /** Subscription point for status reveals (used by the sync panel later). */
  public subscribe(listener: (status: OpenCodeBridgeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Listener failures must never break the bridge.
      }
    }
  }

  /**
   * Drops the cached CLI probe (10-minute TTL) so a freshly installed opencode
   * binary is detected immediately after the auto-installer completes.
   */
  public invalidateCliCheck(): void {
    this.cliCheck = null;
  }

  /**
   * Verifies the opencode CLI is present AND runnable. Cached for 10 minutes.
   * Uses the shared OS-level discovery (PATH + known install locations) and
   * then executes `opencode --version` once to prove the binary actually runs.
   */
  public async isCliAvailable(): Promise<boolean> {
    const cached = this.cliCheck;
    if (cached && Date.now() - cached.checkedAt < CLI_CHECK_TTL_MS) {
      return cached.available;
    }

    let available = false;
    let cliPath: string | null = null;
    let lastError: string | null = null;
    try {
      // Lazy import avoids a static cycle with the service manager's imports.
      const { opencodeServiceManager } = await import('../opencode-integration/opencode-service-manager');
      const discovered = opencodeServiceManager.discoverOpencodeCli();
      cliPath = discovered;
      if (discovered) {
        const versionProbe = spawnSync(discovered, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true
        });
        const outputText = `${versionProbe.stdout || ''}${versionProbe.stderr || ''}`.trim();
        if (versionProbe.status === 0 || outputText) {
          available = true;
        } else {
          lastError = `opencode --version exited with code ${versionProbe.status}`;
        }
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    this.cliCheck = { available, cliPath, checkedAt: Date.now(), lastError };
    this.notifyStatus();
    return available;
  }

  /**
   * Streams a single completed prompt through the opencode CLI.
   * Yields ANSI-stripped stdout chunks; throws OpenCodeNotInstalledError when
   * the CLI is absent, and a descriptive Error on non-zero exit.
   */
  public async *executePrompt(
    prompt: string,
    modelId: string,
    apiKey?: string,
    options?: ExecutePromptOptions
  ): AsyncGenerator<string, void, undefined> {
    const available = await this.isCliAvailable();
    if (!available) throw new OpenCodeNotInstalledError();

    // The `run` subcommand is OpenCode's non-interactive surface; a bare
    // `opencode` invocation would boot the TUI and misroute the stream.
    const args = ['run', '--model', modelId, prompt];

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (apiKey && apiKey.trim()) {
      const trimmedKey = apiKey.trim();
      env.OPENCODE_API_KEY = trimmedKey;
      const providerEnvVar = envVarForModelPrefix(modelId);
      if (providerEnvVar) env[providerEnvVar] = trimmedKey;
    }

    const child = spawn(this.cliCheck!.cliPath!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env,
      ...(options?.cwd ? { cwd: options.cwd } : {})
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data);
      if (stderrChunks.reduce((n, c) => n + c.length, 0) > 16_000 && stderrChunks.length) {
        stderrChunks.splice(0, stderrChunks.length - 1);
      }
    });

    const failure: { err: Error | null } = { err: null };
    child.on('error', (err: Error) => {
      failure.err = err;
    });

    let exitCode: number | null = null;
    const exitPromise = new Promise<number>((resolve) => {
      child.on('close', (code: number) => {
        exitCode = code;
        resolve(code);
      });
    });

    let aborted = false;
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Child already gone.
          }
        }, 2000).unref?.();
      } catch {
        // Child already gone.
      }
    };
    options?.abortSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      if (options?.abortSignal?.aborted) {
        onAbort();
        return;
      }

      for await (const stdoutChunk of child.stdout!) {
        if (failure.err) {
          const err = failure.err as Error & { code?: string };
          throw err.code === 'ENOENT'
            ? new OpenCodeNotInstalledError()
            : new Error(`OpenCode CLI failed to start: ${err.message}`);
        }
        if (options?.abortSignal?.aborted) break;
        const text = stripAnsiAndNormalize(String(stdoutChunk));
        if (text.trim()) yield text;
      }

      const stderrText = stderrChunks.join('');
      if (!aborted) {
        await exitPromise;
        if (exitCode !== null && exitCode !== 0) {
          const stderrTail = stripAnsiAndNormalize(stderrText).trim().slice(-600);
          throw new Error(
            `OpenCode CLI exited with code ${exitCode}${stderrTail ? `: ${stderrTail}` : ''}`
          );
        }
      }
    } finally {
      options?.abortSignal?.removeEventListener('abort', onAbort);
      try {
        if (child.exitCode === null && !child.killed && !aborted) child.kill('SIGTERM');
      } catch {
        // Child already gone.
      }
    }
  }
}

export const opencodeBridge = new OpenCodeBridge();
