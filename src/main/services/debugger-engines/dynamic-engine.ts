import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as TypeScript from 'typescript';
import type { AnalysisResult } from '../../windows/debugger-window';
import { resolveWorkerRuntimeFile } from './runtime-paths';

export interface DynamicRuntimeResult {
  stdout: string[];
  stderr: string[];
  runtimeErrors: Array<{ message: string; stack?: string }>;
  unhandledRejections: Array<{ message: string; stack?: string }>;
  memoryBefore: MemorySnapshot | null;
  memoryAfter: MemorySnapshot | null;
  memorySpikeBytes: number;
  exitCode: number | null;
  timedOut: boolean;
  crashed: boolean;
  durationMs: number;
}

interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface SandboxRunPayload {
  code: string;
  fileName: string;
}

interface SandboxErrorMessage {
  message: string;
  stack?: string;
}

type SandboxChildMessage =
  | { frameType: 'memory'; phase: 'before' | 'after'; usage: MemorySnapshot }
  | {
      frameType: 'result';
      exitCode: number | null;
      timedOut: boolean;
      errors: SandboxErrorMessage[];
      rejections: SandboxErrorMessage[];
      stdout: string[];
      stderr: string[];
    }
  | { frameType: 'fatal'; message: string };

export const DYNAMIC_EXECUTION_BUDGET_MS = 5000;

interface SandboxForkOptions extends ForkOptions {
  resourceLimits?: {
    maxOldGenerationSizeMb: number;
    maxYoungGenerationSizeMb: number;
    codeRangeSizeMb: number;
  };
}

const SANDBOX_FORK_OPTIONS: SandboxForkOptions = {
  execArgv: ['--expose-gc', '--max-old-space-size=256'],
  env: { NODE_ENV: 'production', TY_CODE_SANDBOX: '1' },
  resourceLimits: {
    maxOldGenerationSizeMb: 256,
    maxYoungGenerationSizeMb: 32,
    codeRangeSizeMb: 16
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc']
};
export const DYNAMIC_MEMORY_SPIKE_BYTES = 50 * 1024 * 1024;

const GRACE_KILL_MS = 1000;
const MAX_CAPTURED_OUTPUT_LINES = 200;
const MAX_CRASH_DIAGNOSTIC_CHARS = 4000;

export async function runDynamicAnalysis(filePath: string): Promise<DynamicRuntimeResult> {
  const absolute = path.resolve(filePath);
  const raw = await fsp.readFile(absolute, 'utf8');
  const needsTranspile = /\.(?:m?tsx?|mts|cts)$/i.test(absolute) && !/\.d\.ts$/i.test(absolute);
  const payload: SandboxRunPayload = needsTranspile
    ? { code: transpileForSandbox(raw, absolute), fileName: absolute }
    : { code: raw, fileName: absolute };
  return executeInSandbox(payload);
}

function transpileForSandbox(source: string, fileName: string): string {
  const output = TypeScript.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: TypeScript.ScriptTarget.ES2020,
      module: TypeScript.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: TypeScript.JsxEmit.React
    }
  });
  if (output.diagnostics && output.diagnostics.length > 0) {
    const first = output.diagnostics[0];
    const message = `Transpile failed: ${TypeScript.flattenDiagnosticMessageText(first.messageText, '\n')}`;
    return `throw new Error(${JSON.stringify(message)});`;
  }
  return output.outputText;
}

function executeInSandbox(payload: SandboxRunPayload): Promise<DynamicRuntimeResult> {
  return new Promise<DynamicRuntimeResult>((resolve) => {
    const result: DynamicRuntimeResult = {
      stdout: [],
      stderr: [],
      runtimeErrors: [],
      unhandledRejections: [],
      memoryBefore: null,
      memoryAfter: null,
      memorySpikeBytes: 0,
      exitCode: null,
      timedOut: false,
      crashed: false,
      durationMs: 0
    };

    const startedAt = Date.now();
    let settled = false;
    let child: ChildProcess | null = null;
    let hardKillTimer: NodeJS.Timeout | null = null;
    let crashDiagnostics = '';

    const combineTimers = (): void => {
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = null;
      }
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      combineTimers();
      if ((result.crashed || result.exitCode !== 0) && crashDiagnostics.trim().length > 0) {
        const tail = crashDiagnostics.split('\n').filter((entry) => entry.trim().length > 0).slice(-MAX_CAPTURED_OUTPUT_LINES);
        for (const line of tail) {
          if (result.stderr.length < MAX_CAPTURED_OUTPUT_LINES) result.stderr.push(line);
        }
      }
      if (result.memoryBefore && result.memoryAfter) {
        result.memorySpikeBytes = result.memoryAfter.rss - result.memoryBefore.rss;
      }
      result.durationMs = Date.now() - startedAt;
      resolve(result);
    };

    const scheduleHardKill = (): void => {
      hardKillTimer = setTimeout(() => {
        result.timedOut = true;
        try {
          child?.kill('SIGKILL');
        } catch {
          // kill is best-effort; the exit handler resolves regardless
        }
      }, DYNAMIC_EXECUTION_BUDGET_MS);
    };

    try {
      child = fork(resolveWorkerRuntimeFile('dynamic-sandbox.js'), [], SANDBOX_FORK_OPTIONS);
    } catch (error) {
      result.crashed = true;
      result.runtimeErrors.push({
        message: `Failed to spawn sandbox worker: ${error instanceof Error ? error.message : String(error)}`
      });
      finish();
      return;
    }

    scheduleHardKill();

    child.stderr?.on('data', (chunk: unknown) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      if (crashDiagnostics.length < MAX_CRASH_DIAGNOSTIC_CHARS) {
        crashDiagnostics = `${crashDiagnostics}${text}`.slice(0, MAX_CRASH_DIAGNOSTIC_CHARS);
      }
    });

    child.on('message', (message: unknown) => {
      if (settled) return;
      if (!isSandboxChildMessage(message)) return;

      if (message.frameType === 'fatal') {
        result.crashed = true;
        result.runtimeErrors.push({ message: message.message });
        finish();
        return;
      }

      if (message.frameType === 'memory') {
        if (message.phase === 'before' && result.memoryBefore === null) {
          result.memoryBefore = message.usage;
        } else if (message.phase === 'after' && result.memoryAfter === null) {
          result.memoryAfter = message.usage;
        }
        return;
      }

      result.exitCode = message.exitCode;
      result.timedOut = message.timedOut;
      for (const runtimeError of message.errors) {
        if (result.runtimeErrors.length < MAX_CAPTURED_OUTPUT_LINES) result.runtimeErrors.push(runtimeError);
      }
      for (const rejection of message.rejections) {
        if (result.unhandledRejections.length < MAX_CAPTURED_OUTPUT_LINES) result.unhandledRejections.push(rejection);
      }
      for (const line of message.stdout) {
        if (result.stdout.length < MAX_CAPTURED_OUTPUT_LINES) result.stdout.push(line);
      }
      for (const line of message.stderr) {
        if (result.stderr.length < MAX_CAPTURED_OUTPUT_LINES) result.stderr.push(line);
      }
      combineTimers();
      try {
        child?.kill();
      } catch {
        // graceful stop; exit handler follows
      }
      finish();
    });

    child.on('exit', (code, signal) => {
      result.exitCode = result.exitCode ?? code;
      if (signal === 'SIGKILL') result.timedOut = true;
      combineTimers();
      finish();
    });

    child.on('error', (error) => {
      result.crashed = true;
      result.runtimeErrors.push({ message: `Sandbox worker error: ${error.message}` });
      combineTimers();
      finish();
    });

    child.send({ frameType: 'run', code: payload.code, fileName: payload.fileName });
  });
}

function isSandboxChildMessage(message: unknown): message is SandboxChildMessage {
  if (typeof message !== 'object' || message === null) return false;
  const frameType = (message as { frameType?: unknown }).frameType;
  return typeof frameType === 'string' && ['memory', 'result', 'fatal'].includes(frameType);
}

export function mapDynamicResultToFindings(result: DynamicRuntimeResult, filePath: string): AnalysisResult[] {
  const findings: AnalysisResult[] = [];
  const timestamp = Date.now();
  const baseLine = extractFirstStackLine(result, filePath);

  const push = (
    ruleId: string,
    severity: AnalysisResult['severity'],
    message: string,
    line?: number,
    suggestedFix?: string
  ): void => {
    findings.push({
      id: `dynamic:${ruleId}:${line ?? 0}:${findings.length}`,
      severity,
      engine: 'dynamic',
      role: 'dev',
      message,
      line,
      codeSnippet: undefined,
      filePath,
      ruleId,
      suggestedFix,
      timestamp
    });
  };

  if (result.timedOut) {
    push(
      'dyn-execution-timeout',
      'high',
      `Execution aborted after ${DYNAMIC_EXECUTION_BUDGET_MS}ms in the sandbox; the script likely contains an infinite loop or a blocked event loop.`,
      undefined,
      'Break the loop, add a deadline guard, or move long-running IO into an async worker with cancellation.'
    );
  }

  for (const runtimeError of result.runtimeErrors.slice(0, 10)) {
    const stackLine = parseStackLine(runtimeError.stack, filePath);
    push(
      'dyn-runtime-error',
      'high',
      `Runtime error while executing: ${runtimeError.message}`,
      stackLine?.line ?? baseLine?.line,
      'Fix the runtime error, or guard the throwing boundary with a typeof/instanceof check.'
    );
  }

  for (const rejection of result.unhandledRejections.slice(0, 10)) {
    const stackLine = parseStackLine(rejection.stack, filePath);
    push(
      'dyn-unhandled-rejection',
      'high',
      `Unhandled promise rejection while executing: ${rejection.message}`,
      stackLine?.line ?? baseLine?.line,
      'Attach a .catch(...) or wrap the awaited call in try/catch.'
    );
  }

  if (result.crashed) {
    push(
      'dyn-crash',
      'high',
      'Sandbox worker crashed with a nonzero exit code; captured diagnostics are included as stderr.',
      undefined,
      'Inspect the captured stderr for the segfault, OOM, or syntax error that killed the sandbox.'
    );
  }

  if (result.memoryBefore && result.memoryAfter && result.memorySpikeBytes >= DYNAMIC_MEMORY_SPIKE_BYTES) {
    push(
      'dyn-memory-spike',
      'medium',
      `Memory spike: RSS grew by ${(result.memorySpikeBytes / 1024 / 1024).toFixed(1)}MB during execution (heap before ${(result.memoryBefore.heapUsed / 1024 / 1024).toFixed(1)}MB, after ${(result.memoryAfter.heapUsed / 1024 / 1024).toFixed(1)}MB).`,
      undefined,
      'Look for unbounded array growth, large buffers, or missing cleanup between iterations.'
    );
  }

  if (findings.length === 0) {
    push(
      'dyn-execution-trace',
      'info',
      `Execution trace completed in ${result.durationMs}ms with ${result.stdout.length} stdout lines, ${result.stderr.length} stderr lines, no runtime errors.`,
      undefined,
      undefined
    );
  }

  return findings;
}

function parseStackLine(stack: string | undefined, fileName: string): { line: number } | null {
  if (!stack) return null;
  const baseName = path.basename(fileName);
  const matcher = new RegExp(`(?:${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|<anonymous>):(\\d+):(\\d+)`);
  const match = matcher.exec(stack);
  if (match && match[1]) return { line: Number(match[1]) };
  return null;
}

function extractFirstStackLine(result: DynamicRuntimeResult, fileName: string): { line: number } | null {
  const first = [...result.runtimeErrors, ...result.unhandledRejections][0];
  if (first) return parseStackLine(first.stack, fileName);
  return null;
}
