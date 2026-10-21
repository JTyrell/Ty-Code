import { fork } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import util from 'node:util';

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

interface SandboxExitReport {
  exitCode: number;
  timedOut: boolean;
  errors: Array<{ message: string; stack?: string }>;
  rejections: Array<{ message: string; stack?: string }>;
  stdout: string[];
  stderr: string[];
}

const SYNC_DEADLINE_MS = 4500;
const ASYNC_DEADLINE_MS = 4500;
const EXIT_GRACE_MS = 400;
const MAX_CAPTURED_LINES = 200;
const MAX_LINE_LENGTH = 500;

class SandboxExitSignal {
  readonly code: number;

  constructor(code: number) {
    this.code = code;
  }
}

function collectGc(): void {
  const scope = globalThis as typeof globalThis & { gc?: () => void };
  try {
    scope.gc?.();
  } catch {
    // gc is optional; requires --expose-gc
  }
}

function currentMemory(): MemorySnapshot {
  return {
    rss: process.memoryUsage().rss,
    heapUsed: process.memoryUsage().heapUsed,
    external: process.memoryUsage().external,
    arrayBuffers: process.memoryUsage().arrayBuffers
  };
}

function sendChildFrame(frame: Record<string, unknown>): void {
  try {
    process.send?.(frame);
  } catch {
    // IPC may be gone during teardown; parent resolves via the exit handler
  }
}

function formatConsoleValue(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === 'string') return value;
      try {
        return util.inspect(value, { depth: 2, breakLength: 120, compact: true });
      } catch {
        return String(value);
      }
    })
    .join(' ')
    .slice(0, MAX_LINE_LENGTH);
}

interface SandboxContext {
  stderr: string[];
  errors: Array<{ message: string; stack?: string }>;
  rejections: Array<{ message: string; stack?: string }>;
}

function runChildProtocol(): void {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: Array<{ message: string; stack?: string }> = [];
  const rejections: Array<{ message: string; stack?: string }> = [];

  process.on('unhandledRejection', (reason) => {
    if (rejections.length >= MAX_CAPTURED_LINES) return;
    if (reason instanceof Error) {
      rejections.push({ message: reason.message, stack: String(reason.stack) });
      return;
    }
    rejections.push({ message: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    if (errors.length >= MAX_CAPTURED_LINES) return;
    errors.push({ message: error.message, stack: String(error.stack) });
  });

  process.on('message', async (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const frame = message as { frameType?: unknown; code?: unknown; fileName?: unknown };
    if (frame.frameType !== 'run' || typeof frame.code !== 'string') return;
    const payload: SandboxRunPayload = {
      code: frame.code,
      fileName: typeof frame.fileName === 'string' ? frame.fileName : '<sandbox>'
    };

    sendChildFrame({ frameType: 'memory', phase: 'before', usage: currentMemory() });

    const context: SandboxContext = { stderr, errors, rejections };
    const report = await runSandboxedScript(payload, context, stdout, stderr);

    collectGc();
    sendChildFrame({ frameType: 'memory', phase: 'after', usage: currentMemory() });
    sendChildFrame({
      frameType: 'result' as const,
      exitCode: report.exitCode,
      timedOut: report.timedOut,
      errors: report.errors.slice(0, MAX_CAPTURED_LINES),
      rejections: report.rejections.slice(0, MAX_CAPTURED_LINES),
      stdout: report.stdout.slice(0, MAX_CAPTURED_LINES),
      stderr: report.stderr.slice(0, MAX_CAPTURED_LINES)
    });

    setTimeout(() => process.exit(0), EXIT_GRACE_MS);
  });
}

function runSandboxedScript(
  payload: SandboxRunPayload,
  context: SandboxContext,
  stdoutLines: string[],
  stderrLines: string[]
): Promise<SandboxExitReport> {
  return new Promise<SandboxExitReport>((resolve) => {
    let exitCode = 0;
    let timedOut = false;

    const pushStdout = (line: string): void => {
      if (stdoutLines.length >= MAX_CAPTURED_LINES) return;
      stdoutLines.push(line.slice(0, MAX_LINE_LENGTH));
    };

    const consoleTargets: Record<string, string[]> = { log: [], info: [], debug: [], trace: [], warn: [], error: [] };
    const mockConsole: Record<string, (...args: unknown[]) => void> = {};
    for (const method of Object.keys(consoleTargets)) {
      mockConsole[method] = (...args: unknown[]) => {
        pushStdout(`${method === 'log' ? '' : `[${method}] `}${formatConsoleValue(args)}`);
      };
    }

    const sandboxProcess = Object.freeze({
      exit: (code?: number) => {
        exitCode = typeof code === 'number' ? code : 0;
        throw new SandboxExitSignal(exitCode);
      },
      memoryUsage: () => process.memoryUsage(),
      hrtime: process.hrtime.bigint,
      platform: process.platform,
      env: Object.freeze({}),
      argv: Object.freeze([]),
      nextTick: (callback: () => void) => queueMicrotask(callback),
      on: () => sandboxProcess,
      emit: () => false,
      cwd: () => process.cwd()
    });

    const sandboxGlobals: Record<string, unknown> = {
      console: Object.freeze(mockConsole),
      process: sandboxProcess,
      require: undefined,
      module: Object.freeze({ exports: {} }),
      exports: Object.freeze({}),
      setTimeout: (handler: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
        setTimeout(handler, ms, ...rest),
      setInterval: (handler: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
        setInterval(handler, ms, ...rest),
      clearTimeout,
      clearInterval,
      queueMicrotask,
      performance: Object.freeze({ now: () => Date.now() }),
      Buffer: undefined,
      fetch: undefined,
      structuredClone: undefined
    };
    sandboxGlobals.globalThis = sandboxGlobals;

    const vmContext = vm.createContext(sandboxGlobals);

    const finish = (): SandboxExitReport => ({
      exitCode,
      timedOut,
      errors: context.errors,
      rejections: context.rejections,
      stdout: stdoutLines,
      stderr: stderrLines
    });

    let pendingScriptResult: unknown;
    try {
      const script = new vm.Script(payload.code, { filename: payload.fileName });
      pendingScriptResult = script.runInContext(vmContext, { timeout: SYNC_DEADLINE_MS, breakOnSigint: true });
    } catch (syncError) {
      if (syncError instanceof SandboxExitSignal) {
        exitCode = syncError.code;
        resolve(finish());
        return;
      }
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      // Node creates the "Script execution timed out" exception in the host
      // realm, so `instanceof Error` fails on recent Node builds; classify by
      // message content instead.
      if (/script execution/i.test(message)) {
        timedOut = true;
        stderrLines.push(`[sandbox] sync execution exceeded the ${SYNC_DEADLINE_MS}ms deadline (infinite loop or blocked event loop)`);
        resolve(finish());
        return;
      }
      if (syncError instanceof Error) {
        context.errors.push({ message: syncError.message, stack: String(syncError.stack) });
      } else {
        context.errors.push({ message });
      }
      resolve(finish());
      return;
    }

    if (!isPromiseLike(pendingScriptResult)) {
      resolve(finish());
      return;
    }

    const deadlinePromise = new Promise<'deadline' | 'settled'>((resolveSignal) => {
      const timer = setTimeout(() => resolveSignal('deadline'), ASYNC_DEADLINE_MS);
      timer.unref?.();
    });
    void Promise.race([Promise.resolve(pendingScriptResult), deadlinePromise]).then(
      (settled) => {
        if (settled === 'deadline') {
          timedOut = true;
          stderrLines.push(`[sandbox] async result exceeded the ${ASYNC_DEADLINE_MS}ms deadline (pending promise never resolved)`);
        }
        resolve(finish());
      },
      (asyncError) => {
        const message = asyncError instanceof Error ? asyncError.message : String(asyncError);
        context.errors.push({ message });
        resolve(finish());
      }
    );
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

async function runSelftest(): Promise<void> {
  const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ty-sandbox-'));
  const fixturePath = path.join(fixtureDir, 'infinite-loop.js');
  const marker = 'sandbox-selftest-marker';
  await fsp.writeFile(
    fixturePath,
    `console.log(${JSON.stringify(marker)});\nconst startedAt = Date.now(); while (Date.now() - startedAt < 20000) { /* blocked */ }\nconsole.log('after-loop');\n`,
    'utf8'
  );

  const startedAt = Date.now();
  const child = fork(__filename, [], {
    execArgv: ['--expose-gc', '--max-old-space-size=256'],
    env: { ...process.env, TY_CODE_SANDBOX: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  let sawBeforeMemory = false;
  let sawAfterMemory = false;
  let resultFrame: SandboxExitReport | null = null;
  let stderrSnapshot = '';
  let timedOutReported = false;

  await new Promise<void>((resolveSelftest) => {
    const hardTimer = setTimeout(() => {
      child.kill('SIGKILL');
      console.error(JSON.stringify({ selftest: 'fail', reason: 'timeout waiting for sandbox', elapsedMs: Date.now() - startedAt }));
      resolveSelftest();
    }, 10000);

    child.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const frame = message as { frameType?: unknown; phase?: unknown };
      if (frame.frameType === 'memory' && frame.phase === 'before') sawBeforeMemory = true;
      if (frame.frameType === 'memory' && frame.phase === 'after') sawAfterMemory = true;
      if (frame.frameType !== 'result') return;
      const candidate = message as { exitCode?: number; timedOut?: boolean; errors?: unknown; stdout?: unknown };
      resultFrame = {
        exitCode: typeof candidate.exitCode === 'number' ? candidate.exitCode : 0,
        timedOut: Boolean(candidate.timedOut),
        errors: Array.isArray(candidate.errors) ? (candidate.errors as SandboxExitReport['errors']) : [],
        rejections: [],
        stdout: Array.isArray(candidate.stdout) ? (candidate.stdout as string[]) : [],
        stderr: []
      };
      timedOutReported = resultFrame.timedOut;
      clearTimeout(hardTimer);
      child.kill('SIGKILL');
      resolveSelftest();
    });

    child.stderr?.on('data', (chunk: unknown) => {
      stderrSnapshot += typeof chunk === 'string' ? chunk : String(chunk);
    });

    child.on('exit', () => {
      const markerHit = resultFrame?.stdout?.includes(marker) ?? false;
      const verdictPass = Boolean(resultFrame) && markerHit && sawBeforeMemory && sawAfterMemory && timedOutReported;
      const verdictDetail = JSON.stringify(
        {
          selftest: verdictPass ? 'pass' : 'fail',
          sawBeforeMemory,
          sawAfterMemory,
          markerHit,
          timedOutReported,
          result: resultFrame ? { exitCode: resultFrame.exitCode, errors: resultFrame.errors, stdout: resultFrame.stdout } : null,
          stderrSnapshot: stderrSnapshot.slice(0, 300)
        },
        null,
        2
      );
      console.log(verdictDetail);
      resolveSelftest();
      setTimeout(() => process.exit(verdictPass ? 0 : 1), 50);
    });

    (async () => {
      const source = await fsp.readFile(fixturePath, 'utf8');
      child.send({ frameType: 'run', code: source, fileName: fixturePath });
    })();
  });
}

async function main(): Promise<void> {
  if (process.env.TY_CODE_SANDBOX === '1') {
    runChildProtocol();
    return;
  }
  if (process.argv[2] === 'selftest') {
    await runSelftest();
    return;
  }
  console.error('usage: node dynamic-sandbox.js selftest');
  process.exit(2);
}

void main();
