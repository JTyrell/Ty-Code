/**
 * Task runner service — the Electron-free half of the Terminal menu's task rows
 * (Prompt 5b Step 4).
 *
 * Ty-Code could write a command into a PTY but had no notion of a *task*:
 * nothing to list under Run Task…, nothing to gate Show/Restart/Terminate on,
 * and no way to tell when a command finished. This module supplies all three.
 *
 * It follows the same split as `file-dialog-service.ts` and
 * `command-main-handlers.ts`: every effect is injected — resolving a terminal,
 * writing to it, interrupting it, reading a file, telling the time — so the whole
 * thing runs under plain Node in tests, and `ipc/task-handlers.ts` is the thin
 * wiring that hands it the real `pty-handlers` functions.
 *
 * Four decisions are load-bearing and easy to lose in a later edit.
 *
 *  - **Completion is detected with a sentinel, not a process exit.** Tasks run in
 *    a *persistent interactive* shell: it prints a fresh prompt when the command
 *    ends and stays alive, so there is no exit event to wait for. Every command
 *    is therefore wrapped with `; echo "__TYCODE_TASK_DONE_<runId>__:$?"` (or the
 *    shell's equivalent) and the PTY output stream is watched for it. The `runId`
 *    is random per run, which is what stops a task's *own* output from being
 *    mistaken for completion — it cannot guess the marker. The shell echoing the
 *    command line back is a different problem, because that echo carries the same
 *    runId; {@link scanForSentinel} tells the two apart and its docstring says how.
 *  - **The sentinel is visible, not an OSC escape.** Marking it with OSC 133
 *    would hide it from the user, but `cmd.exe` cannot emit one at all and xterm
 *    would swallow it before it reached the screen while main still saw it, so
 *    the terminal would show output the runner disagreed with. A visible line
 *    that the user can read and correlate is uglier and honest; correctness and
 *    honesty beat prettiness here.
 *  - **Terminate interrupts, it does not kill the terminal.** The task is the
 *    shell's foreground job, so the shell equivalent of "stop this task" is
 *    Ctrl+C. Killing the PTY instead would destroy the user's shell history and
 *    any other task sharing that terminal. The limit this creates is stated in
 *    {@link TaskRunner.terminate} rather than papered over.
 *  - **No security-policy gate.** `executePtyCommand` routes AI-proposed commands
 *    through `SecurityPolicyEngine`; this does not, because a task the user
 *    picked from their own tasks.json is the same act as typing it — the path
 *    `writePty` already takes for the same reason. The dispatch is still recorded
 *    in `terminalDispatchLedger`, so it is auditable.
 */

import path from 'path';
import type { IpcResponse } from '../../preload/types';
import {
  MAX_TRACKED_TASK_RUNS,
  RunningTaskSchema,
  TASKS_DIR_NAME,
  TASKS_FILE_NAME,
  TaskDefinitionSchema,
  TaskListResultSchema,
  TaskRunIdRequestSchema,
  TaskRunRequestSchema,
  TaskRunResultSchema,
  type RunningTask,
  type TaskDefinition,
  type TaskListResult,
  type TaskRunResult,
  type TaskState
} from '../../shared/types/tasks';

// ---------------------------------------------------------------------------
// Injected surface
// ---------------------------------------------------------------------------

/**
 * Structural stand-in for the handle `pty-handlers.resolveTaskTerminal` returns.
 *
 * Declared rather than imported so this module stays free of `electron`:
 * importing from `ipc/pty-handlers` would pull `BrowserWindow` and `node-pty`
 * into a test that only wants to check how a sentinel is spelled.
 */
export interface TaskTerminalLike {
  terminalId: string;
  shellId: string;
  shellPath: string;
}

/** The subset of `RunInTerminalResult` this service reads. */
export interface TaskDispatchResult {
  dispatched: boolean;
  terminalId?: string;
  reason?: string;
}

export interface TaskRunnerDeps {
  /** Resolve — creating if needed — the terminal a task runs in, and name its shell. */
  resolveTerminal(opts: { cwd?: string }): IpcResponse<TaskTerminalLike>;
  /** Write through the existing readiness/queue machinery. `execute: false` writes without a trailing `\r`. */
  dispatchCommand(command: string, opts: { terminalId: string; execute?: boolean; cwd?: string }): Promise<IpcResponse<TaskDispatchResult>>;
  observeTerminalOutput(listener: (terminalId: string, data: string) => void): () => void;
  observeTerminalExit(listener: (terminalId: string, exitCode: number) => void): () => void;
  /** Read a UTF-8 text file, or `null` when it is missing or unreadable. Injected so tests need no temp dirs. */
  readFileOrNull(absolutePath: string): string | null;
  /** Milliseconds to let an interrupt land before a restart writes. Stubbed to 0 in tests. */
  delay?(ms: number): Promise<void>;
  now?(): number;
  randomRunId?(): string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** First Zod issue, so a validation failure reads as a diagnosis not a dump. */
function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Keep a value inside a schema bound instead of letting `parse` reject the whole result. */
function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * How many trailing characters of PTY output are searched for a sentinel.
 *
 * A PTY delivers output in arbitrary chunks, so a sentinel can be split across
 * two of them; keeping a tail rather than scanning each chunk alone is what
 * makes that survivable. 4 KB is far more than any sentinel plus its exit code,
 * and small enough that a task streaming megabytes per second does not turn the
 * observer into a copy loop.
 */
const SENTINEL_TAIL_CHARS = 4_000;

/** How long a restart waits for Ctrl+C to land before writing the new command. */
const RESTART_SETTLE_MS = 250;

const SENTINEL_PREFIX = '__TYCODE_TASK_DONE_';

export function sentinelFor(runId: string): string {
  return `${SENTINEL_PREFIX}${runId}__`;
}

export type ShellFlavour = 'cmd' | 'powershell' | 'posix';

/**
 * Which command syntax a shell accepts.
 *
 * `shellId` alone is not enough: `custom` names a path, not a syntax, so the
 * executable's own basename is sniffed exactly the way `syncPtyCwd` sniffs it.
 * Everything unrecognised falls to `posix`, which is right for `git-bash`,
 * `wsl`, `user-shell`, `zsh`, `bash` and `sh` — the six remaining registry ids.
 */
export function resolveShellFlavour(shellId: string, shellPath: string): ShellFlavour {
  if (shellId === 'cmd') return 'cmd';
  if (shellId === 'powershell' || shellId === 'pwsh') return 'powershell';
  if (shellId !== 'custom') return 'posix';
  const name = baseName(shellPath).toLowerCase();
  if (name === 'cmd' || name === 'cmd.exe') return 'cmd';
  if (name.startsWith('powershell') || name.startsWith('pwsh')) return 'powershell';
  return 'posix';
}

/**
 * Append a completion sentinel to a command.
 *
 * Single-line commands take an inline separator, and the separator is chosen so
 * the echo runs *whatever the command did*: `&` in `cmd` and `;` in the others.
 * `&&` would be wrong — it short-circuits, so a failing build would print no
 * sentinel and the task would sit in the running list forever.
 *
 * Multi-line commands (Run Selected Text is the usual source) put the sentinel on
 * its own line instead, because `;` only binds to the last line and the reader
 * for the previous lines has already moved on. `$?`, `%errorlevel%` and
 * `$LASTEXITCODE` all still refer to the last command executed, so the reported
 * code is the selection's.
 */
export function wrapWithSentinel(command: string, flavour: ShellFlavour, runId: string): string {
  const sentinel = sentinelFor(runId);
  const normalised = command.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const multiline = normalised.includes('\n');

  if (flavour === 'cmd') {
    return multiline
      ? `${normalised}\necho ${sentinel}:%errorlevel%`
      : `${normalised} & echo ${sentinel}:%errorlevel%`;
  }
  if (flavour === 'powershell') {
    return multiline
      ? `${normalised}\nWrite-Host "${sentinel}:$LASTEXITCODE"`
      : `${normalised}; Write-Host "${sentinel}:$LASTEXITCODE"`;
  }
  return multiline
    ? `${normalised}\necho "${sentinel}:$?"`
    : `${normalised}; echo "${sentinel}:$?"`;
}

/**
 * Look for a sentinel in buffered output.
 *
 * Returns `null` for "not yet" and an object once the marker is resolved. The
 * exit code is `undefined` when the marker printed without one — which our own
 * wrappers never do on `cmd` or a POSIX shell, but PowerShell does whenever
 * `$LASTEXITCODE` is still unset — and that is reported as an unknown code
 * rather than waited on forever.
 *
 * The marker normally appears in the buffer **twice**, and picking the wrong one
 * is the whole difficulty here. `dispatchRunCommand` writes into a live PTY with
 * echo on, so the shell prints the command line back before running it: the
 * first occurrence is that echo, followed by the *name* of the exit-code
 * variable, and the second is the shell's own output, followed by its *value*.
 */
export function scanForSentinel(
  buffer: string,
  sentinel: string
): { exitCode: number | undefined } | null {
  const marker = `${sentinel}:`;

  // Every occurrence, earliest first. Reading only the first one would find the
  // echo, see no digits after it, and then — as soon as the task had printed 32
  // characters of its own output — conclude "marker with no code" and report a
  // run as finished while it was still going. Every build longer than a line
  // would have ended that way.
  const occurrences: number[] = [];
  for (
    let at = buffer.indexOf(marker);
    at >= 0;
    at = buffer.indexOf(marker, at + marker.length)
  ) {
    occurrences.push(at);
  }
  if (occurrences.length === 0) return null;

  // A code anywhere settles it: only the shell's own output can put digits
  // after the marker, since the echo carries the variable's name.
  for (const at of occurrences) {
    const digits = /^(\d{1,10})/.exec(buffer.slice(at + marker.length));
    if (digits) return { exitCode: Number(digits[1]) };
  }

  const after = buffer.slice(occurrences[occurrences.length - 1] + marker.length);
  // Nothing carried a code, so the only question left is whether the last
  // occurrence is real output or still the echo. `$` and `%` are the two
  // characters that introduce a variable in every shell Ty-Code supports, so a
  // marker followed by one is unexpanded wrapper text and must be waited
  // through. Stated as a property of the shells rather than as the three
  // variable names, so a fourth flavour does not silently reintroduce the bug.
  if (/^[$%]/.test(after)) return null;
  // Marker seen, no code yet. Give the next chunk a chance to deliver one — a
  // PTY can split `:__` from the `0` — but only briefly. A shell that printed the
  // marker always prints something next (its prompt), so 32 characters is a
  // bounded wait, and concluding "no code" beats a task stuck as running.
  if (after.length < 32) return null;
  return { exitCode: undefined };
}

// ---------------------------------------------------------------------------
// Loose JSON (tasks.json is JSONC)
// ---------------------------------------------------------------------------

/**
 * Strip `//` and `/* *\/` comments, tracking string state as it goes.
 *
 * VS Code writes `tasks.json` with comments and users add them by hand, so a
 * bare `JSON.parse` would reject a file the user believes is valid and Run Task…
 * would show an empty submenu. Walking characters rather than using a regex is
 * what keeps a `//` inside a command string — `node scripts//dev.js`, a URL —
 * from being eaten.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    if (inString) {
      out += char;
      if (char === '\\') {
        // Copy the escaped character verbatim so `\"` cannot end the string.
        index += 1;
        if (index < text.length) out += text[index];
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Drop a comma whose next non-space character closes the object or array. */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      out += char;
      if (char === '\\') {
        index += 1;
        if (index < text.length) out += text[index];
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    out += char;
  }
  return out;
}

/** Parse JSONC. Throws whatever `JSON.parse` throws when the text is not JSON at all. */
export function parseJsonLoose(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Where discovery reads, built from the shared constants the renderer's
 * `task.configure` writes through. Joining them here rather than repeating the
 * two names means the menu can never offer a task list that Configure Tasks…
 * does not produce.
 */
const TASKS_FILE_RELPATH = path.join(TASKS_DIR_NAME, TASKS_FILE_NAME);

/** Only `${workspaceFolder}` is substituted; anything else is left for the shell to fail on. */
function substituteWorkspace(text: string, workspacePath: string): string {
  return text.split('${workspaceFolder}').join(workspacePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBuildGroup(group: unknown): boolean {
  if (group === 'build') return true;
  return isRecord(group) && group.kind === 'build';
}

function isMarkedBuildDefault(group: unknown): boolean {
  return isRecord(group) && group.kind === 'build' && group.isDefault === true;
}

/** Quote one argument for a shell, for tasks.json `args` arrays. */
function quoteArg(arg: string): string {
  if (arg === '') return '""';
  if (/^[\w./:@+=,-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Turn one tasks.json entry into a task, or `null` when it cannot be honoured.
 *
 * `shell` tasks and `npm` tasks are supported. `process` tasks are not: they ask
 * for a direct spawn with no shell, and Ty-Code always writes into a shell, so
 * offering one would run a command whose argument quoting and glob expansion
 * differ from what the file asked for. Refusing is better than being subtly
 * wrong, and the caller reports what was skipped.
 */
function tasksJsonEntryToTask(
  raw: unknown,
  workspacePath: string
): { task?: TaskDefinition; skipped?: string } {
  if (!isRecord(raw)) return { skipped: 'a malformed entry' };
  const type = typeof raw.type === 'string' ? raw.type : 'shell';
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;

  if (type === 'npm') {
    const script = typeof raw.script === 'string' ? raw.script.trim() : '';
    if (!script) return { skipped: 'an npm task with no script' };
    const name = label ?? script;
    return {
      task: {
        id: clamp(name, 200),
        label: clamp(name, 200),
        command: `npm run ${quoteArg(script)}`,
        source: 'tasks.json',
        isBuildDefault: isMarkedBuildDefault(raw.group)
      }
    };
  }

  if (type !== 'shell') return { skipped: `a task of type '${type}'` };
  if (typeof raw.command !== 'string' || !raw.command.trim()) {
    return { skipped: label ? `'${label}' (no command)` : 'a task with no command' };
  }

  const parts = [substituteWorkspace(raw.command.trim(), workspacePath)];
  if (Array.isArray(raw.args)) {
    for (const arg of raw.args) {
      if (typeof arg === 'string') parts.push(substituteWorkspace(arg, workspacePath));
      else if (typeof arg === 'number' || typeof arg === 'boolean') parts.push(String(arg));
    }
  }
  const command = parts.map((part, index) => (index === 0 ? part : quoteArg(part))).join(' ');
  const name = label ?? command;

  let cwd: string | undefined;
  if (isRecord(raw.options) && typeof raw.options.cwd === 'string') {
    cwd = substituteWorkspace(raw.options.cwd, workspacePath);
  }

  return {
    task: {
      id: clamp(name, 200),
      label: clamp(name, 200),
      command: clamp(command, 2000),
      source: 'tasks.json',
      cwd,
      isBuildDefault: isMarkedBuildDefault(raw.group)
    }
  };
}

/**
 * Read `.vscode/tasks.json` when it exists, else `package.json` scripts, else
 * nothing.
 *
 * Precedence rather than merge, per the Terminal-menu spec: a workspace that
 * declares tasks has said what it wants run, and mixing npm scripts into that
 * list would offer two rows that do nearly the same thing with different
 * working directories.
 */
function discoverTasks(deps: TaskRunnerDeps, workspacePath: string | null): TaskListResult {
  if (!workspacePath) return { tasks: [], source: 'none' };

  const tasksPath = path.join(workspacePath, TASKS_FILE_RELPATH);
  const tasksText = deps.readFileOrNull(tasksPath);
  if (tasksText !== null) {
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(tasksText);
    } catch (err: unknown) {
      return {
        tasks: [],
        source: 'none',
        sourcePath: tasksPath,
        error: clamp(`${TASKS_FILE_RELPATH} could not be parsed: ${describeError(err)}`, 400)
      };
    }
    const rawTasks = isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasks: TaskDefinition[] = [];
    const skipped: string[] = [];
    let hasUnresolvedVariable = false;
    for (const raw of rawTasks) {
      const result = tasksJsonEntryToTask(raw, workspacePath);
      if (result.task) {
        tasks.push(result.task);
        if (result.task.command.includes('${')) hasUnresolvedVariable = true;
      } else if (result.skipped) {
        skipped.push(result.skipped);
      }
    }
    // VS Code marks a build task default with `isDefault: true`. A file with a
    // single build task and no `isDefault` anywhere is unambiguous, so that one
    // is promoted rather than leaving Run Build Task… with nothing to run.
    if (!tasks.some((task) => task.isBuildDefault)) {
      const buildTasks = tasks.filter((task) => {
        const raw = rawTasks.find((entry) => isRecord(entry) && entry.label === task.label);
        return raw ? isBuildGroup(raw.group) : false;
      });
      if (buildTasks.length === 1) buildTasks[0].isBuildDefault = true;
    }
    const notes: string[] = [];
    if (skipped.length > 0) {
      notes.push(`${skipped.length} task(s) skipped: ${skipped.slice(0, 4).join(', ')}`);
    }
    if (hasUnresolvedVariable) {
      notes.push('a command uses a variable Ty-Code does not substitute (only ${workspaceFolder} is)');
    }
    return {
      tasks: tasks.slice(0, 500),
      source: 'tasks.json',
      sourcePath: tasksPath,
      error: notes.length > 0 ? clamp(notes.join('; '), 400) : undefined
    };
  }

  const packagePath = path.join(workspacePath, 'package.json');
  const packageText = deps.readFileOrNull(packagePath);
  if (packageText === null) return { tasks: [], source: 'none' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(packageText);
  } catch (err: unknown) {
    return {
      tasks: [],
      source: 'none',
      sourcePath: packagePath,
      error: clamp(`package.json could not be parsed: ${describeError(err)}`, 400)
    };
  }
  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  const tasks: TaskDefinition[] = Object.keys(scripts)
    .filter((name) => typeof scripts[name] === 'string')
    .slice(0, 500)
    .map((name) => ({
      id: clamp(`package:${name}`, 200),
      label: clamp(name, 200),
      command: `npm run ${quoteArg(name)}`,
      source: 'package.json' as const,
      // npm's own convention: `npm run build` is the build.
      isBuildDefault: name === 'build'
    }));
  return { tasks, source: 'package.json', sourcePath: packagePath };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** A run plus the two fields only the sentinel scanner needs. */
interface TrackedRun extends RunningTask {
  sentinel: string;
  tail: string;
}

export interface TaskRunner {
  /** What can be run, and where it came from. */
  list(workspacePath: string | null): TaskListResult;
  /** Start a discovered task (`taskId`) or an ad-hoc command. */
  run(payload: unknown, workspacePath: string | null): Promise<IpcResponse<TaskRunResult>>;
  /**
   * Stop a running task by interrupting its shell.
   *
   * The run leaves the tracked list immediately, which is the truth about
   * Ty-Code's bookkeeping but not a guarantee about the process: a program that
   * ignores SIGINT keeps running in a terminal the user can still see and still
   * Ctrl+C again. Killing the PTY would have been a stronger guarantee and a
   * worse product — it would take the user's shell, its history and every other
   * task in that terminal with it.
   */
  terminate(payload: unknown): IpcResponse<RunningTask>;
  /** Interrupt a running task, let it land, then start the same definition again. */
  restart(payload: unknown, workspacePath: string | null): Promise<IpcResponse<TaskRunResult>>;
  listRunning(): RunningTask[];
  hasRunning(): boolean;
  /** Fired on every state change with the full list, never a delta. */
  subscribe(listener: (tasks: RunningTask[]) => void): () => void;
  /** Detach the PTY observers. Call on shutdown so a test's PTY stubs can be collected. */
  dispose(): void;
}

function summariseCommand(command: string): string {
  const firstLine = command.split('\n')[0]?.trim() || command.trim() || 'task';
  return clamp(firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine, 200);
}

export function createTaskRunner(deps: TaskRunnerDeps): TaskRunner {
  const runs = new Map<string, TrackedRun>();
  const listeners = new Set<(tasks: RunningTask[]) => void>();
  /**
   * Set by `dispose()`.
   *
   * A runner whose PTY observers are detached can still be asked to start
   * something — the IPC handlers outlive it by a frame during shutdown — and a
   * run with nothing watching its output has no way to finish, so its row would
   * sit in the menu until the process died. Refusing with a sentence is the same
   * rule the rest of the module follows: a decline is an answer.
   */
  let disposed = false;

  const timestamp = (): number => (deps.now ? deps.now() : Date.now());
  const wait = (ms: number): Promise<void> =>
    deps.delay ? deps.delay(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  const nextRunId = (): string =>
    deps.randomRunId
      ? deps.randomRunId()
      : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

  function publicRun(run: TrackedRun): RunningTask {
    return RunningTaskSchema.parse({
      runId: run.runId,
      definition: run.definition,
      terminalId: run.terminalId,
      startedAt: run.startedAt,
      state: run.state,
      exitCode: run.exitCode
    });
  }

  function listRunning(): RunningTask[] {
    return [...runs.values()].map(publicRun);
  }

  function notifyChanged(): void {
    if (listeners.size === 0) return;
    const snapshot = listRunning();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch (err: unknown) {
        console.warn('[tasks] a change listener failed:', describeError(err));
      }
    }
  }

  /**
   * Move a run out of the tracked set and tell everyone the list changed.
   *
   * What crosses the wire about a finished task is the *absence* of its row,
   * not its final state: the pushed list is the running list, which is exactly
   * what `tasksRunning` gates on. The state and code are therefore logged here
   * rather than dropped — they are the one part of the outcome no menu can
   * show, and a task that vanished silently is indistinguishable from one that
   * never started. `terminated` is skipped because the user pressed the button
   * that caused it and already knows.
   */
  function finish(run: TrackedRun, state: TaskState, exitCode: number | undefined): void {
    run.state = state;
    run.exitCode = exitCode;
    runs.delete(run.runId);
    if (state !== 'terminated') {
      const code = exitCode === undefined ? 'an unknown exit code' : `exit code ${exitCode}`;
      console.info(`[tasks] '${run.definition.label}' ${state} with ${code}.`);
    }
    notifyChanged();
  }

  // -----------------------------------------------------------------------
  // PTY observers
  // -----------------------------------------------------------------------

  const disposeOutput = deps.observeTerminalOutput((terminalId, data) => {
    for (const run of [...runs.values()]) {
      if (run.terminalId !== terminalId || run.state !== 'running') continue;
      run.tail = (run.tail + data).slice(-SENTINEL_TAIL_CHARS);
      const found = scanForSentinel(run.tail, run.sentinel);
      if (!found) continue;
      // An absent code means the shell printed the marker without one. The
      // command did finish, so this is a completion; guessing a failure would
      // turn a successful build red.
      const code = found.exitCode;
      finish(run, code === undefined || code === 0 ? 'succeeded' : 'failed', code);
    }
  });

  const disposeExit = deps.observeTerminalExit((terminalId, exitCode) => {
    for (const run of [...runs.values()]) {
      if (run.terminalId !== terminalId || run.state !== 'running') continue;
      // The shell died with the task still in it and printed no sentinel, so
      // the command's own result is unknowable. Reporting success would be a
      // guess; a failure with the shell's code attached is the honest reading.
      finish(run, 'failed', exitCode);
    }
  });

  // -----------------------------------------------------------------------
  // Starting
  // -----------------------------------------------------------------------

  async function startRun(
    definition: TaskDefinition,
    workspacePath: string | null
  ): Promise<IpcResponse<TaskRunResult>> {
    if (disposed) {
      return { success: false, error: 'The task runner has shut down, so it cannot start anything new.' };
    }
    const runId = nextRunId();
    const cwd = definition.cwd ?? workspacePath ?? undefined;

    const terminal = deps.resolveTerminal({ cwd });
    if (!terminal.success || !terminal.data) {
      return { success: false, error: terminal.error || 'No terminal is available to run the task in.' };
    }
    if (runs.size >= MAX_TRACKED_TASK_RUNS) {
      return {
        success: false,
        error: `${MAX_TRACKED_TASK_RUNS} tasks are already being tracked. Terminate one before starting another.`
      };
    }

    const flavour = resolveShellFlavour(terminal.data.shellId, terminal.data.shellPath);
    const wrapped = wrapWithSentinel(definition.command, flavour, runId);

    const dispatched = await deps.dispatchCommand(wrapped, {
      terminalId: terminal.data.terminalId,
      execute: true,
      cwd
    });
    if (!dispatched.success || !dispatched.data?.dispatched) {
      return {
        success: false,
        error:
          dispatched.error ||
          dispatched.data?.reason ||
          `'${definition.label}' could not be written to the terminal.`
      };
    }

    runs.set(runId, {
      runId,
      definition,
      terminalId: terminal.data.terminalId,
      startedAt: timestamp(),
      state: 'running',
      sentinel: sentinelFor(runId),
      tail: ''
    });
    notifyChanged();

    return {
      success: true,
      data: TaskRunResultSchema.parse({
        runId,
        terminalId: terminal.data.terminalId,
        label: definition.label
      })
    };
  }

  async function run(payload: unknown, workspacePath: string | null): Promise<IpcResponse<TaskRunResult>> {
    const parsed = TaskRunRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Run-task request failed validation: ${describeIssues(parsed.error)}` };
    }
    const request = parsed.data;
    if (!request.taskId && !request.command) {
      return { success: false, error: 'Nothing to run: the request named neither a task nor a command.' };
    }

    try {
      let definition: TaskDefinition;
      if (request.taskId) {
        const discovered = discoverTasks(deps, workspacePath).tasks;
        const found = discovered.find((task) => task.id === request.taskId);
        if (!found) {
          return {
            success: false,
            error: `No task called '${clamp(request.taskId, 120)}' was found. The tasks file may have changed — reopen the submenu to refresh it.`
          };
        }
        definition = found;
      } else {
        const command = request.command as string;
        definition = TaskDefinitionSchema.parse({
          id: `ad-hoc:${Date.now().toString(36)}`,
          label: clamp(request.label?.trim() || summariseCommand(command), 200),
          command,
          source: 'ad-hoc',
          cwd: request.cwd
        });
      }
      return await startRun(definition, workspacePath);
    } catch (err: unknown) {
      return { success: false, error: `The task could not be started: ${describeError(err)}` };
    }
  }

  // -----------------------------------------------------------------------
  // Stopping
  // -----------------------------------------------------------------------

  /**
   * Write a bare Ctrl+C into the task's terminal.
   *
   * `execute: false` is what makes this an interrupt rather than a command: the
   * dispatcher appends `\r` only when executing, and `\x03\r` would interrupt
   * and then submit whatever was sitting on the prompt line.
   */
  async function sendInterrupt(run: TrackedRun): Promise<void> {
    try {
      await deps.dispatchCommand('\x03', { terminalId: run.terminalId, execute: false });
    } catch {
      // A terminal that is already gone cannot be interrupted; the run is being
      // removed either way.
    }
  }

  function terminate(payload: unknown): IpcResponse<RunningTask> {
    const parsed = TaskRunIdRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Terminate request failed validation: ${describeIssues(parsed.error)}` };
    }
    const run = runs.get(parsed.data.runId);
    if (!run) return { success: false, error: 'That task is no longer running.' };

    const snapshot = publicRun(run);
    // Mark terminated before the interrupt is even written: `finish` removes the
    // run, so the sentinel the interrupted command may still print afterwards is
    // ignored rather than resurrecting a row the user just dismissed.
    finish(run, 'terminated', undefined);
    void sendInterrupt(run);
    return { success: true, data: snapshot };
  }

  async function restart(payload: unknown, workspacePath: string | null): Promise<IpcResponse<TaskRunResult>> {
    const parsed = TaskRunIdRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Restart request failed validation: ${describeIssues(parsed.error)}` };
    }
    const run = runs.get(parsed.data.runId);
    if (!run) {
      return {
        success: false,
        error: 'That task is no longer running, so there is nothing to restart. Use Run Task… to start it again.'
      };
    }
    const definition = run.definition;
    finish(run, 'terminated', undefined);
    await sendInterrupt(run);
    // Let the interrupt land before writing. Without this the new command can be
    // consumed as stdin by the program that is still shutting down, which looks
    // exactly like a restart that silently did nothing.
    await wait(RESTART_SETTLE_MS);
    try {
      return await startRun(definition, workspacePath);
    } catch (err: unknown) {
      return { success: false, error: `The task could not be restarted: ${describeError(err)}` };
    }
  }

  return {
    list(workspacePath: string | null): TaskListResult {
      const discovered = discoverTasks(deps, workspacePath);
      const parsed = TaskListResultSchema.safeParse(discovered);
      // Discovery clamps every field to its schema bound, so this is a net for a
      // future edit rather than a live path — but a throw out of an IPC handler
      // is a red toast with a stack in it, and an empty list with the reason is
      // something the user can act on.
      if (!parsed.success) {
        return {
          tasks: [],
          source: 'none',
          error: clamp(`Task discovery produced an invalid result: ${describeIssues(parsed.error)}`, 400)
        };
      }
      return parsed.data;
    },
    run,
    terminate,
    restart,
    listRunning,
    hasRunning(): boolean {
      return runs.size > 0;
    },
    subscribe(listener: (tasks: RunningTask[]) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      // Idempotent: shutting down twice must not detach the same observer twice,
      // which on the real PTY would mean removing a listener someone else has
      // since re-registered.
      if (disposed) return;
      disposed = true;
      disposeOutput();
      disposeExit();
      runs.clear();
      listeners.clear();
    }
  };
}
