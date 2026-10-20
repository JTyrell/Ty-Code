import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}

export interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  blocked?: string;
  timedOut?: boolean;
}

const DEFAULT_MAX_EXECUTION_TIME = 30_000;
const DEFAULT_MAX_OUTPUT_SIZE = 102_400;

export const DEFAULT_ALLOWED_COMMANDS = new Set<string>([
  'node', 'npm', 'npx', 'tsc', 'eslint', 'vite', 'vitest', 'jest', 'git', 'python', 'pip', 'pytest', 'cargo', 'go'
]);

export const DEFAULT_BLOCKED_COMMANDS = new Set<string>([
  'sudo', 'su', 'dd', 'mkfs', 'fdisk', 'diskpart', 'format', 'shutdown', 'reboot', 'poweroff', 'halt',
  'reg', 'regedit', 'regsvr32', 'netsh', 'schtasks', 'bitsadmin', 'certutil', 'attrib', 'icacls', 'chmod', 'chown',
  'taskkill', 'kill', 'wmic', 'rundll32', 'mountvol', 'msiexec', 'mshta', 'control'
]);

const DANGEROUS_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\brm\b[^\n]*-{1,2}(?:rf|fr)\b|\brm\b[^\n]*--recursive[^\n]*(?:--force|-[a-z]*f\b)|\brm\b[^\n]*(?:--force|-[a-z]*f\b)[^\n]*--recursive|\brm\s+-[a-z]*r[a-z]*\s+-[a-z]*f|\brm\s+-[a-z]*f[a-z]*\s+-[a-z]*r/i, reason: 'recursive destructive delete (rm -rf style) is blocked' },
  { regex: /\b(?:del|erase)\b[^\n]*\/(?:s)\b/i, reason: 'recursive destructive delete (del /s) is blocked' },
  { regex: /\bremove-item\b[^\n]*-(?:recurse|-r\b)/i, reason: 'recursive destructive delete (Remove-Item -Recurse) is blocked' },
  { regex: /\b(?:rd|rmdir)\b[^\n]*\/s\b/i, reason: 'recursive destructive delete is blocked' },
  { regex: /\bchmod\s+(?:777|[0-7]{3,4}\s+-R)\b/i, reason: 'permission escalation (chmod 777 style) is blocked' },
  { regex: /\bformat\s+[a-z]:/i, reason: 'disk formatting is blocked' },
  { regex: /\bdd\b[^\n]*if=/i, reason: 'raw disk operations (dd) are blocked' },
  { regex: />+\s*\/dev\/(?:sd|hd|nvme|mapper|vd)/i, reason: 'raw disk writes are blocked' },
  { regex: /\bsudo\b/i, reason: 'privilege escalation is blocked' },
  { regex: /\b(?:npm|pnpm|yarn)\b[^\n]*(?:\s-g\s|\s--global\b)/, reason: 'global package installs are blocked' },
  { regex: /\bcurl\b[^\n]*\|\s*(?:sh|bash|zsh)\b/i, reason: 'pipe-to-shell downloads are blocked' },
  { regex: /:\(\)\s*\{/i, reason: 'fork-bomb style constructs are blocked' },
  { regex: />+\s*(?:\/etc\/|c:\\(?:windows|program files))/i, reason: 'writes to system directories are blocked' },
  { regex: /(?:&&|\|\|)\s*(?:"|')?[^\s]/, reason: 'command chaining is blocked; run one command per call' }
];

const STRICT_PATH_REFERENCE = /^(?:[A-Za-z]:[\\/]|[\\/])\S|\.{1,2}[\\/]\S/;
const DANGEROUS_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ANSI_CONTROL_PATTERN = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]/g;
const CHAIN_OPERATOR_PATTERN = /(?:&&|\|\|)\s*(?:"|')?[^\s]/;

export function sanitizeShellOutput(raw: string, maxBytes: number): string {
  let text = (raw || '')
    .replace(ANSI_CONTROL_PATTERN, '')
    .replace(/\uFEFF/g, '')
    .replace(DANGEROUS_CHARS, '');
  if (text.length > maxBytes) {
    text = `${text.slice(0, maxBytes)}\n[output truncated at ${maxBytes} bytes]`;
  }
  return text;
}

export function isPathSafe(filePath: string, workspaceRoot: string): boolean {
  try {
    if (!filePath || typeof filePath !== 'string') return false;
    if (/^(\\\\|\/\/)/.test(filePath)) return false;
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, filePath);
    const relative = path.relative(root, resolved);
    if (relative === '') return true;
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (process.platform === 'win32') {
      return resolved.toLowerCase().startsWith(rootWithSep.toLowerCase());
    }
    return resolved.startsWith(rootWithSep);
  } catch {
    return false;
  }
}

function splitCommandTokens(command: string): string[] {
  const tokens: string[] = [];
  const quotePattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match = quotePattern.exec(command);
  while (match) {
    tokens.push(match[0]);
    match = quotePattern.exec(command);
  }
  return tokens;
}

function unquoteToken(token: string): string {
  let value = token.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  return value;
}

function extractPathTokens(command: string, tokens: string[]): string[] {
  const found = new Set<string>();
  for (const token of tokens) {
    if (!STRICT_PATH_REFERENCE.test(token)) continue;
    if (isNotPathReference(token)) continue;
    found.add(token);
    const valuePart = token.includes('=') ? token.slice(token.indexOf('=') + 1) : '';
    if (valuePart && STRICT_PATH_REFERENCE.test(valuePart) && !isNotPathReference(valuePart)) found.add(valuePart);
  }
  return Array.from(found);
}

function isNotPathReference(token: string): boolean {
  if (/:\/\//.test(token)) return true;
  if (token.includes('@')) return true;
  return false;
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

export class ShellSandbox {
  allowedCommands: Set<string> = new Set(DEFAULT_ALLOWED_COMMANDS);
  blockedCommands: Set<string> = new Set(DEFAULT_BLOCKED_COMMANDS);
  workspaceRoot: string;
  maxExecutionTime: number = DEFAULT_MAX_EXECUTION_TIME;
  maxOutputSize: number = DEFAULT_MAX_OUTPUT_SIZE;

  constructor(workspaceRoot: string) {
    if (!workspaceRoot || typeof workspaceRoot !== 'string') {
      throw new Error('Security Exception: ShellSandbox requires a workspace root');
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  setAllowedCommands(commands: Iterable<string>): void {
    this.allowedCommands = new Set(Array.from(commands, (name) => String(name)));
  }

  setBlockedCommands(commands: Iterable<string>): void {
    this.blockedCommands = new Set(Array.from(commands, (name) => String(name)));
  }

  private resolveFailure(reason: string, startedAt: number): ShellResult {
    return {
      success: false,
      stdout: '',
      stderr: `Sandbox: ${reason}`,
      exitCode: 126,
      duration: Date.now() - startedAt,
      blocked: reason
    };
  }

  private preflight(command: string, startedAt: number): ShellResult | null {
    const trimmed = command.trim();
    if (!trimmed) return this.resolveFailure('empty command is not allowed', startedAt);
    if (CHAIN_OPERATOR_PATTERN.test(trimmed)) {
      return this.resolveFailure('command chaining operators are not allowed; run one command per call', startedAt);
    }
    const tokens = splitCommandTokens(trimmed);
    if (tokens.length === 0) return this.resolveFailure('empty command is not allowed', startedAt);
    const base = unquoteToken(tokens[0]).toLowerCase();
    const baseName = (/(?:^|[\\\/])([^\\\/]+)$/.exec(base)?.[1] ?? base).replace(/\.exe$/, '').toLowerCase();
    if (this.blockedCommands.has(baseName)) {
      return this.resolveFailure(`command ${baseName} is blocked by the shell sandbox`, startedAt);
    }
    if (this.allowedCommands.size > 0 && !this.allowedCommands.has(baseName)) {
      return this.resolveFailure(`command ${baseName} is not in the sandbox allowed set`, startedAt);
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        return this.resolveFailure(pattern.reason, startedAt);
      }
    }
    for (const pathToken of extractPathTokens(trimmed, tokens)) {
      if (!isPathSafe(pathToken, this.workspaceRoot)) {
        return this.resolveFailure(`path traversal attempt: ${pathToken} resolves outside the workspace`, startedAt);
      }
    }
    return null;
  }

  async executeCommand(command: string, options?: ShellOptions): Promise<ShellResult> {
    const startedAt = Date.now();
    const blocked = this.preflight(command, startedAt);
    if (blocked) return blocked;

    const tokens = splitCommandTokens(command.trim());
    const base = unquoteToken(tokens[0]);
    const args = tokens.slice(1).map(unquoteToken);

    const effectiveTimeout = Math.min(
      Math.max(1_000, options?.timeoutMs ?? DEFAULT_MAX_EXECUTION_TIME),
      this.maxExecutionTime
    );
    const cwd = options?.cwd && isPathSafe(options.cwd, this.workspaceRoot)
      ? path.resolve(this.workspaceRoot, options.cwd)
      : this.workspaceRoot;
    const env: Record<string, string> = {};
    const forwardedKeys = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMDRIVE', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'GOROOT', 'GOPATH'];
    for (const key of forwardedKeys) {
      const value = process.env[key];
      if (typeof value === 'string') env[key] = value;
    }
    if (options?.env) Object.assign(env, options.env);

    const controller = new AbortController();
    const linkedAbort = options?.abortSignal;
    const onExternalAbort = () => controller.abort();
    if (linkedAbort) {
      if (linkedAbort.aborted) {
        controller.abort();
      } else {
        linkedAbort.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const timeoutHandle = setTimeout(() => controller.abort(), effectiveTimeout);

    return new Promise<ShellResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(base, args, { cwd, env, shell: false, windowsHide: true });
      } catch (error: unknown) {
        clearTimeout(timeoutHandle);
        if (linkedAbort) linkedAbort.removeEventListener('abort', onExternalAbort);
        resolve({
          success: false,
          stdout: '',
          stderr: sanitizeShellOutput(error instanceof Error ? error.message : String(error), this.maxOutputSize),
          exitCode: 127,
          duration: Date.now() - startedAt
        });
        return;
      }

      let stdoutRaw = '';
      let stderrRaw = '';
      let timedOut = false;
      let settled = false;
      const finish = (final: ShellResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (linkedAbort) linkedAbort.removeEventListener('abort', onExternalAbort);
        resolve(final);
      };

      child.stdout?.on('data', (chunk: Buffer) => { stdoutRaw += chunk.toString('utf-8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderrRaw += chunk.toString('utf-8'); });

      controller.signal.addEventListener('abort', () => {
        timedOut = true;
        killProcessTree(child.pid);
      }, { once: true });
      if (linkedAbort?.aborted && !timedOut) {
        timedOut = true;
        killProcessTree(child.pid);
      }

      child.on('error', (error: Error) => {
        finish({
          success: false,
          stdout: sanitizeShellOutput(stdoutRaw, this.maxOutputSize),
          stderr: sanitizeShellOutput(`${stderrRaw}\n${error.message}`, this.maxOutputSize),
          exitCode: 127,
          duration: Date.now() - startedAt,
          ...(timedOut ? { timedOut: true } : {})
        });
      });

      child.on('close', (code: number | null) => {
        finish({
          success: code === 0 && !timedOut,
          stdout: sanitizeShellOutput(stdoutRaw, this.maxOutputSize),
          stderr: sanitizeShellOutput(
            timedOut ? `${stderrRaw}\nSandbox: terminated after ${effectiveTimeout}ms` : stderrRaw,
            this.maxOutputSize
          ),
          exitCode: timedOut ? 124 : (typeof code === 'number' ? code : -1),
          duration: Date.now() - startedAt,
          ...(timedOut ? { timedOut: true } : {})
        });
      });
    });
  }
}
