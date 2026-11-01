/**
 * Debug session service — the Electron-free half of the Run menu's debug rows
 * (Prompt 5b Step 3).
 *
 * The registry has carried eighteen `run.*` rows against `debug.*` commands since
 * Prompt 5 and none of them were visible, because a row whose handler does not
 * exist is skipped by the executor exactly as its menu row is hidden. This module
 * supplies the thing that made those rows a promise rather than a lie: it spawns
 * a real child process under Node's inspector, speaks the Chrome DevTools
 * Protocol to it over the debugger WebSocket, and reports pauses the process
 * actually took.
 *
 * It follows the split `task-runner-service.ts` established: every effect is
 * injected — spawning, opening a socket, reading a file, telling the time — so
 * the whole thing runs under plain Node in tests against a fake transport that
 * records the exact CDP traffic, while `ipc/debug-handlers.ts` hands it the real
 * `child_process`, the real `WebSocket`, and the workspace root.
 *
 * Six decisions are load-bearing, and four of them were measured rather than
 * assumed — the measurements are recorded here because each one is a silent
 * failure mode that a later edit would otherwise reintroduce.
 *
 *  - **Plain `--inspect`, never `--inspect-brk`, unless the user asked for
 *    entry.** Probing a real spawned child showed that with `-brk` the entry
 *    break fires *before* any client can send `Debugger.enable`, so
 *    `Debugger.paused` is emitted into a session that cannot receive it: enable
 *    answers ok, no pause ever arrives, a breakpoint set on the not-yet-parsed
 *    user script resolves zero locations, and `Debugger.resume` replies "Can
 *    only perform operation while paused" while the target sits frozen at a line
 *    the UI believes is running. Without `-brk` the same probe resolved one
 *    location, paused with three frames, stepped and resumed. So `stopOnEntry`
 *    spawns with `-brk` *and* resumes as soon as the domain is enabled — the
 *    target is genuinely frozen at entry, which is what makes it safe to treat
 *    as running — rather than pretending the pause was observed.
 *  - **The debugger URL is parsed from both stdout and stderr.** Node prints
 *    `Debugger listening on ws://127.0.0.1:<port>/<uuid>`, and it lands on
 *    stderr. Watching only stdout would time out on a perfectly healthy session.
 *    The address is asked for as `127.0.0.1:0`, so the OS hands out a free port
 *    and two debug sessions cannot collide on a hardcoded one.
 *  - **A pause is located through the `scriptId → url` map, not through the
 *    frame's own url.** Measured: the top call frame's `location.url` came back
 *    empty for a script reached through a wrapper. A pause the UI cannot locate
 *    is a pause the user cannot use, so `Debugger.scriptParsed` builds the map
 *    and the top frame's `scriptId` looks up the file. Internal `node:internal/*`
 *    scripts — `Debugger.enable` replays about seventy-five of them, which is
 *    why breakpoints are only ever installed for the entry file and for files the
 *    runtime reported parsing — are dropped from the map rather than offered as
 *    source locations.
 *  - **Protocol lines are 0-based; everything leaving this file is 1-based.**
 *    Monaco numbers its gutter from one. Converting in both directions at this
 *    single boundary is what keeps a highlighted line from sitting one above the
 *    statement that actually paused.
 *  - **Stepping and resuming are gated on the observed state, not the requested
 *    one.** `Debugger.stepOver` on a running target replies "Can only perform
 *    operation while paused". Translating that protocol complaint into "the
 *    program is not stopped at a breakpoint" is the difference between a toast
 *    the user can act on and a stack trace they cannot.
 *  - **`verified` is the runtime's answer, never ours.** `setBreakpointByUrl`
 *    returns the locations it bound; zero locations means the breakpoint is
 *    registered but nothing has claimed it. Reporting a gutter dot as verified
 *    because we asked for one is precisely the failure this whole feature was
 *    audited for.
 */

import path from 'path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { IpcResponse } from '../../preload/types';
import {
  DebugConfigurationListSchema,
  DebugConfigurationSchema,
  DebugSessionSchema,
  DebugStartRequestSchema,
  LAUNCH_DIR_NAME,
  LAUNCH_FILE_NAME,
  MAX_TRACKED_BREAKPOINTS,
  isSessionActive,
  type Breakpoint,
  type DebugConfiguration,
  type DebugConfigurationList,
  type DebugPausedLocation,
  type DebugSession,
  type DebugSessionStatus,
  type DebugStartRequest
} from '../../shared/types/debug-session';

// ---------------------------------------------------------------------------
// Injected surface
// ---------------------------------------------------------------------------

/**
 * Structural stand-in for the `ChildProcess` a spawned debuggee returns.
 *
 * Declared rather than imported from `node:child_process` so a test can hand the
 * service an object that prints a debugger URL on command, instead of waiting on
 * a real Node process that may or may not bind a port in this test run.
 */
export interface DebuggeeProcess {
  readonly pid?: number;
  stdout: { on(event: 'data', listener: (chunk: string | Uint8Array) => void): void };
  stderr: { on(event: 'data', listener: (chunk: string | Uint8Array) => void): void };
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill(signal?: string): boolean;
}

/** The subset of a WebSocket the protocol layer uses. */
export interface DebugTransport {
  send(payload: string): void;
  close(): void;
}

/**
 * The breakpoint store, seen from the side that talks the protocol.
 *
 * Declared as a port rather than imported from `breakpoint-service.ts` for the
 * same reason the terminal surface is a port in the task runner: the session and
 * the store own different facts — the runtime's answer and the user's intent —
 * and a direct import would make one a cycle in the other's graph. Verification
 * flows store-ward through `report`, and the store's edits flow session-ward when
 * `ipc/debug-handlers.ts` calls `onBreakpointsChanged`.
 */
export interface DebugBreakpointPort {
  list(): Breakpoint[];
  /** `verified` is what the runtime said; `note` is what it said it could not do. */
  report(id: string, verified: boolean, note?: string): void;
  clearVerifications(): void;
}

/** What `connectDebugger` produces: a socket plus the two events it reports. */
export interface DebugSocket {
  transport: DebugTransport;
  onMessage(listener: (raw: string) => void): void;
  onClose(listener: () => void): void;
}

export interface DebugSessionDeps {
  /** Spawn the debuggee. `args` already carries the inspector flag. */
  spawnTarget(options: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  }): DebuggeeProcess | Promise<DebuggeeProcess>;
  /** Open the debugger WebSocket. Resolves once the socket can carry traffic. */
  connectDebugger(url: string): DebugSocket | Promise<DebugSocket>;
  /** Read a UTF-8 text file, or `null` when missing or unreadable. */
  readFileOrNull(absolutePath: string): string | null;
  /** Optional so Add Configuration… can be declined rather than guessed at. */
  writeFileOrNull?(absolutePath: string, contents: string): string | null;
  /** The breakpoints to install on every launch and re-apply on every edit. */
  breakpoints?: DebugBreakpointPort;
  /**
   * Node-compatible executable to launch. `process.execPath` in production,
   * because inside Electron that is the Electron binary and the handler pairs it
   * with `ELECTRON_RUN_AS_NODE=1` — which is why the env is built here rather
   * than there.
   */
  nodeExecutable?(): string;
  now?(): number;
  delay?(ms: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Keep a value inside a schema bound instead of letting `parse` reject the result. */
function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull the debugger WebSocket address out of a chunk of inspector output.
 *
 * Exported and pure because this single regex is the handoff between a process
 * that is alive and a session that can talk to it: Node writes the line to
 * stderr, an EADDRINUSE writes a different line to the same stream, and a
 * caller that looked only at stdout would conclude the debugger was broken.
 */
export function extractDebuggerUrl(text: string): string | null {
  return text.match(/ws:\/\/\S+/)?.[0] ?? null;
}

/** Does this chunk carry the inspector's refusal to bind? */
function addressesBindFailure(text: string): boolean {
  return /address already in use|EADDRINUSE/i.test(text);
}

/**
 * Build the argument vector for a debuggee.
 *
 * `--inspect=127.0.0.1:0` rather than a fixed port or a bare `--inspect`: port 0
 * asks the operating system for a free one, which is the only way two windows, two
 * workspaces, or a leftover session can debug simultaneously without one of them
 * silently failing to bind. Loopback only, because a debugger port open on a
 * network interface lets any host on the network evaluate code in the user's
 * process.
 *
 * `noInspect` is Run Without Debugging: the same argv with the flag omitted. Both
 * spellings come from this one function so the only difference between the two
 * rows is the presence of a debugger, which is what the two rows claim.
 */
export function buildNodeArgs(
  entryPath: string,
  opts: { stopOnEntry: boolean; cwd?: string; args?: string[]; noInspect?: boolean }
): string[] {
  const prefix = opts.cwd ? [`--experimental-working-dir=${opts.cwd}`] : [];
  if (opts.noInspect) return [...prefix, entryPath, ...(opts.args ?? [])];
  const flag = opts.stopOnEntry ? '--inspect-brk=127.0.0.1:0' : '--inspect=127.0.0.1:0';
  return [...prefix, flag, entryPath, ...(opts.args ?? [])];
}

/** Convert a `file://` url back to a path. Non-file schemes have no path. */
export function urlToPath(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/**
 * Translate a breakpoint into the `Debugger.setBreakpointByUrl` coordinates.
 *
 * Three kinds, one line of code each, because the protocol already spells them:
 * a conditional break carries `condition`, and a logpoint is an instrumented
 * breakpoint that formats instead of pausing. Clamping the line here is the
 * 1-based-to-0-based conversion, so it belongs to this function and nowhere else.
 */
export function describeBreakpointForProtocol(bp: Breakpoint): Record<string, unknown> {
  const lineNumber = Math.max(0, bp.lineNumber - 1);
  if (bp.logMessage) {
    return {
      lineNumber,
      action: { type: 'logPoint', logMessage: bp.logMessage },
      isReattachEnabled: true
    };
  }
  if (bp.condition) {
    return { lineNumber, condition: bp.condition, isReattachEnabled: true };
  }
  return { lineNumber, isReattachEnabled: true };
}

// ---------------------------------------------------------------------------
// Launch configuration discovery
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turn one `configurations[]` entry into a configuration, or a reason it is not
 * usable.
 *
 * `label` is the field the menu shows, and a launch.json written for another
 * editor names that field `name`. Reading only `label` would make every imported
 * configuration vanish from Open Configurations… while sitting visibly in the
 * user's file, so `name` is accepted as the fallback — a synonym, not a guess.
 */
function entryToConfiguration(
  raw: unknown,
  workspacePath: string
): { config?: DebugConfiguration; skipped?: string } {
  if (!isRecord(raw)) return { skipped: 'a malformed entry' };
  const named =
    (typeof raw.label === 'string' && raw.label.trim()) ||
    (typeof raw.name === 'string' && raw.name.trim()) ||
    '';
  if (!named) return { skipped: 'an entry with no label' };
  if (typeof raw.program !== 'string' || !raw.program.trim()) {
    return { skipped: `'${named}' (no program)` };
  }

  const program = path.isAbsolute(raw.program)
    ? raw.program
    : path.resolve(workspacePath, substituteWorkspace(raw.program, workspacePath));

  const config: DebugConfiguration = {
    label: clamp(named, 200),
    program: clamp(program, 4096),
    stopOnEntry: raw.stopOnEntry === true
  };
  if (isRecord(raw.options) && typeof raw.options.cwd === 'string') {
    config.cwd = clamp(substituteWorkspace(raw.options.cwd, workspacePath), 4096);
  } else if (typeof raw.cwd === 'string' && raw.cwd.trim()) {
    config.cwd = clamp(substituteWorkspace(raw.cwd, workspacePath), 4096);
  }
  if (Array.isArray(raw.args)) {
    const args = raw.args
      .filter((arg): arg is string => typeof arg === 'string')
      .slice(0, 64)
      .map((arg) => substituteWorkspace(arg, workspacePath));
    if (args.length > 0) config.args = args.map((arg) => clamp(arg, 500));
  }
  return { config };
}

/** Only `${workspaceFolder}` is substituted; anything else is reported, not invented. */
function substituteWorkspace(value: string, workspacePath: string): string {
  return value.replace(/\$\{workspaceFolder\}/g, workspacePath);
}

/**
 * Read `.ty-code/launch.json`, keeping whatever was readable.
 *
 * A malformed file yields an empty list *and* the parse error beside the path,
 * exactly as task discovery does: the menu still has something to say, and
 * Open Configurations… can still point at the file the user needs to fix.
 */
export function readDebugConfigurations(
  deps: DebugSessionDeps,
  workspacePath: string | null
): DebugConfigurationList {
  if (!workspacePath) return { configurations: [] };

  const sourcePath = path.join(workspacePath, LAUNCH_DIR_NAME, LAUNCH_FILE_NAME);
  const text = deps.readFileOrNull(sourcePath);
  if (text === null) return { configurations: [], sourcePath };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    return {
      configurations: [],
      sourcePath,
      error: clamp(`${path.join(LAUNCH_DIR_NAME, LAUNCH_FILE_NAME)} could not be parsed: ${describeError(err)}`, 400)
    };
  }

  const rawEntries = isRecord(parsed) && Array.isArray(parsed.configurations) ? parsed.configurations : [];
  const configurations: DebugConfiguration[] = [];
  const skipped: string[] = [];
  let hasUnresolvedVariable = false;

  for (const raw of rawEntries) {
    const result = entryToConfiguration(raw, workspacePath);
    if (result.config) {
      configurations.push(result.config);
      const haystack = `${result.config.program} ${result.config.cwd ?? ''} ${(result.config.args ?? []).join(' ')}`;
      if (/\$\{(?!workspaceFolder\})/.test(haystack)) hasUnresolvedVariable = true;
    } else if (result.skipped) {
      skipped.push(result.skipped);
    }
  }

  const notes: string[] = [];
  if (skipped.length > 0) notes.push(`${skipped.length} configuration(s) skipped: ${skipped.slice(0, 4).join(', ')}`);
  if (hasUnresolvedVariable) {
    notes.push('a path uses a variable Ty-Code does not substitute (only ${workspaceFolder} is)');
  }
  return {
    configurations: configurations.slice(0, 100),
    sourcePath,
    error: notes.length > 0 ? clamp(notes.join('; '), 400) : undefined
  };
}

// ---------------------------------------------------------------------------
// The protocol layer
// ---------------------------------------------------------------------------

/** One in-flight request, resolved by the matching `id` in the reply. */
interface PendingCall {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

interface ScriptParsedEvent {
  scriptId?: string;
  url?: string;
}

interface CallFrame {
  url?: string;
  functionName?: string;
  location?: { scriptId?: string; lineNumber?: number; columnNumber?: number; url?: string };
}

interface PausedEvent {
  callFrames?: CallFrame[];
  reason?: string;
}

interface SetBreakpointResult {
  breakpointId?: string;
  locations?: unknown[];
}

/**
 * JSON-RPC over the debugger socket, with one permanent reader.
 *
 * The reader is installed before anything is sent and never removed, because CDP
 * interleaves events with replies: a client that read one reply per send would
 * consume a `Debugger.paused` as though it were the answer to
 * `Debugger.enable` and resolve it to an event body. Replies are matched by
 * number and everything else is dispatched to an event handler.
 */
class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly eventHandlers = new Map<string, (params: unknown) => void>();
  private closed = false;

  constructor(
    private readonly socket: DebugTransport,
    events: DebugSocket,
    private readonly callTimeoutMs: number
  ) {
    events.onMessage((raw: string) => this.receive(raw));
    events.onClose(() => this.failAll(new Error('The debugger connection closed.')));
  }

  on(method: string, handler: (params: unknown) => void): void {
    this.eventHandlers.set(method, handler);
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The debugger connection is closed.'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const entry: PendingCall = { resolve, reject };
      entry.timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} did not answer within ${this.callTimeoutMs} ms.`));
      }, this.callTimeoutMs);
      this.pending.set(id, entry);
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (err: unknown) {
        this.settle(id, { reason: new Error(`${method} could not be sent: ${describeError(err)}`) });
      }
    });
  }

  /**
   * Drop every outstanding call when the peer goes away.
   *
   * Without this a caller awaiting `Debugger.continue` would hang for the full
   * timeout after the program exited, and the menu row would sit looking like a
   * hung application rather than a finished one.
   */
  private failAll(reason: Error): void {
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.settle(id, { reason });
  }

  private settle(id: number, outcome: { value?: unknown; reason?: Error }): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (outcome.reason) entry.reject(outcome.reason);
    else entry.resolve(outcome.value);
  }

  private receive(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    if (typeof message.id === 'number') {
      if (isRecord(message.error)) {
        this.settle(message.id, {
          reason: new Error(clamp(String(message.error.message ?? 'the debugger rejected the request'), 400))
        });
      } else {
        this.settle(message.id, { value: message.result ?? {} });
      }
      return;
    }

    if (typeof message.method === 'string') {
      this.eventHandlers.get(message.method)?.(message.params);
    }
  }
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

const CALL_TIMEOUT_MS = 10_000;
const URL_WAIT_MS = 8_000;

/** Breakpoints as the runtime reported them, so re-applying can un-verify. */
interface InstalledBreakpoint {
  breakpointId: string;
  url: string;
  lineNumber: number;
}

interface ActiveSession {
  proc: DebuggeeProcess;
  socket: DebugTransport;
  client: CdpClient;
  /** scriptId → url, from `Debugger.scriptParsed`. Empty for `node:internal/*`. */
  scriptUrls: Map<string, string>;
  /** Absolute paths the runtime told us it parsed. */
  parsedPaths: Set<string>;
  installed: Map<string, InstalledBreakpoint>;
  /**
   * Breakpoints asked of the runtime and not yet handed a location, kept by id so
   * a lazily-imported module can still claim them when it is parsed.
   */
  pending: Map<string, Breakpoint>;
  /** The protocol says `paused`/`resumed`; this is what we last observed. */
  stopped: boolean;
  stoppedReason: string | null;
  stoppedLocation: DebugPausedLocation | null;
  killed: boolean;
}

export interface DebugSessionService {
  /** What `.ty-code/launch.json` offers, with any note about reading it. */
  configurations(workspacePath: string | null): DebugConfigurationList;
  /** Spawn under the inspector, enable the Debugger domain, install breakpoints. */
  start(payload: unknown, workspacePath: string | null, breakpoints?: Breakpoint[]): Promise<IpcResponse<DebugSession>>;
  /** Detach and terminate. A session that already ended is reported, not reaped twice. */
  stop(payload?: unknown): IpcResponse<DebugSession>;
  /** Stop and start the same request. Breakpoints survive because the store owns them. */
  restart(payload: unknown, workspacePath: string | null, breakpoints?: Breakpoint[]): Promise<IpcResponse<DebugSession>>;
  pause(): Promise<IpcResponse<DebugSession>>;
  resume(): Promise<IpcResponse<DebugSession>>;
  stepOver(): Promise<IpcResponse<DebugSession>>;
  stepInto(): Promise<IpcResponse<DebugSession>>;
  stepOut(): Promise<IpcResponse<DebugSession>>;
  /** Live sessions only: re-install the whole set after the store changed. */
  onBreakpointsChanged(breakpoints?: Breakpoint[]): void;
  snapshot(): DebugSession;
  hasActiveSession(): boolean;
  subscribe(listener: (session: DebugSession) => void): () => void;
  dispose(): void;
}

export function createDebugSessionService(deps: DebugSessionDeps): DebugSessionService {
  const listeners = new Set<(session: DebugSession) => void>();
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? defaultDelay;
  const executable = deps.nodeExecutable ?? (() => process.execPath);

  /**
   * The last thing `start` was asked to run, so Restart can re-run it without the
   * renderer having to remember its own request across a menu refresh.
   */
  let lastRequest: { request: DebugStartRequest; workspacePath: string | null } | null = null;

  /**
   * The whole session, in the shape the contract publishes. `inactive` at rest:
   * no session has been observed, so nothing is claimed.
   */
  let session: DebugSession = { status: 'inactive' };
  let active: ActiveSession | null = null;

  /**
   * A process running under Run Without Debugging.
   *
   * Kept apart from `active` rather than as a session with a null protocol client,
   * because every protocol path would then need a null check and the one thing
   * that must never happen — a stepping command reaching a socket that does not
   * exist — would become a runtime branch instead of a type error. Two variables,
   * and `hasActiveSession` reads both.
   */
  let plain: DebuggeeProcess | null = null;

  let disposed = false;

  function publish(next: DebugSession): void {
    // Re-parsing on the way out is what makes `status` trustworthy: a future edit
    // that set `paused` without a location would fail here instead of reaching a
    // menu that greys the wrong rows.
    session = DebugSessionSchema.parse(next);
    for (const listener of listeners) {
      try {
        listener(session);
      } catch {
        /* One bad observer must not stop the others seeing the state change. */
      }
    }
  }

  function snapshot(): DebugSession {
    return session;
  }

  /**
   * Tear the session down exactly once.
   *
   * `status` is passed rather than inferred, because the three ways a session
   * ends say different things: the user stopped it, the program finished, or the
   * socket died under us. Guessing one of those from the other two is how a crash
   * gets reported as a clean exit.
   */
  function teardown(kind: 'stopped' | 'exited' | 'failed', detail?: { error?: string; exitCode?: number }): void {
    const dying = active;
    active = null;

    if (dying) {
      try {
        dying.client.call('Debugger.disable').catch(() => undefined);
      } catch {
        /* Already gone. */
      }
      try {
        dying.socket.close();
      } catch {
        /* Already gone. */
      }
      if (!dying.killed) {
        dying.killed = true;
        try {
          dying.proc.kill();
        } catch {
          /* A process that will not die is reported by its exit event, not here. */
        }
      }
    }

    const status: DebugSessionStatus = kind === 'exited' ? 'exited' : kind === 'failed' ? 'failed' : 'inactive';
    publish({
      ...session,
      status,
      pausedReason: undefined,
      pausedLocation: undefined,
      error: detail?.error ? clamp(detail.error, 600) : undefined,
      exitCode: detail?.exitCode
    });
  }

  function waitForDebuggerUrl(proc: DebuggeeProcess, deadlineMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let text = '';
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      const feed = (chunk: string | Uint8Array): void => {
        text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        // Both streams, and a bounded tail: an inspector that never binds must
        // not grow this string for as long as the program runs.
        if (text.length > 64_000) text = text.slice(-32_000);

        const url = extractDebuggerUrl(text);
        if (url) {
          finish(() => resolve(url));
          return;
        }
        if (addressesBindFailure(text)) {
          finish(() =>
            reject(new Error('The inspector could not bind a debug port — something is already using it.'))
          );
        }
      };

      proc.stdout.on('data', feed);
      proc.stderr.on('data', feed);
      // The most common early exit by far is a missing entry file, whose whole
      // message is the text accumulated so far. Surfacing it beats any generic
      // timeout, which would describe a race that never happened.
      proc.on('exit', (code) => {
        if (done) return;
        const firstLine = text.trim().split('\n').find((line) => line.trim().length > 0) ?? 'no output';
        finish(() =>
          reject(
            new Error(
              clamp(
                `The debuggee exited before its debugger came up (code ${code ?? 'unknown'}): ${firstLine}`,
                600
              )
            )
          )
        );
      });

      timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              `No debugger address appeared within ${deadlineMs} ms, so the process never started inspecting.`
            )
          )
        );
      }, deadlineMs);
    });
  }

  /** Which breakpoints the store currently holds. */
  function listBreakpoints(): Breakpoint[] {
    try {
      return deps.breakpoints?.list() ?? [];
    } catch {
      // A store that throws is a store with no usable answer. Installing nothing
      // is honest; installing a half-read list is not.
      return [];
    }
  }

  /**
   * Hand one breakpoint to the runtime and record what it said.
   *
   * The two outcomes that are not "verified" are deliberately different: a reply
   * with zero locations is a promise about a script that has not been parsed yet,
   * so the entry is kept pending; a rejected request is the runtime refusing, so
   * the entry is dropped from pending and the store carries the reason. Collapsing
   * those two into one greyed dot would hide the difference between "wait for it"
   * and "this can never work".
   */
  async function applyOne(current: ActiveSession, bp: Breakpoint): Promise<void> {
    const url = pathToFileURL(bp.filePath).href;
    try {
      const result = (await current.client.call('Debugger.setBreakpointByUrl', {
        url,
        ...describeBreakpointForProtocol(bp)
      })) as SetBreakpointResult;

      const resolved = Array.isArray(result.locations) && result.locations.length > 0;
      if (resolved && typeof result.breakpointId === 'string') {
        current.installed.set(bp.id, {
          breakpointId: result.breakpointId,
          url,
          lineNumber: Math.max(0, bp.lineNumber - 1)
        });
      }
      if (resolved) current.pending.delete(bp.id);
      else current.pending.set(bp.id, bp);
      deps.breakpoints?.report(bp.id, resolved);
    } catch (err: unknown) {
      current.pending.delete(bp.id);
      deps.breakpoints?.report(bp.id, false, describeError(err));
    }
  }

  /**
   * Apply the whole breakpoint set to the live session.
   *
   * Called at start and whenever the set changes. Removing first is deliberate:
   * the protocol's `breakpointId` is only valid for the session that produced it,
   * and leaving stale registrations behind would mean a breakpoint the user
   * unchecked still stops execution — the single most confusing thing a debugger
   * can do.
   */
  async function applyBreakpoints(breakpoints: Breakpoint[]): Promise<void> {
    const current = active;
    if (!current) return;

    for (const entry of current.installed.values()) {
      try {
        await current.client.call('Debugger.removeBreakpoint', { breakpointId: entry.breakpointId });
      } catch {
        /* Already gone; the re-add below reports anything that matters. */
      }
    }
    current.installed.clear();
    current.pending.clear();
    deps.breakpoints?.clearVerifications();

    const usable = breakpoints.filter((bp) => bp.enabled).slice(0, MAX_TRACKED_BREAKPOINTS);
    for (const bp of usable) {
      await applyOne(current, bp);
    }
  }

  /**
   * Re-apply the unresolved breakpoints whose file the runtime just parsed.
   *
   * Only pending entries for that exact path are re-sent, because otherwise every
   * one of the ~75 internal scripts `Debugger.enable` replays would trigger a full
   * re-application — and a breakpoint that already resolved would be answered a
   * second time, un-verifying work it had just done.
   */
  async function reapplyForPath(filePath: string): Promise<void> {
    const current = active;
    if (!current) return;
    const due = [...current.pending.values()].filter((bp) => samePath(bp.filePath, filePath));
    if (due.length === 0) return;
    for (const bp of due) {
      await applyOne(current, bp);
    }
  }

  /** Report a verification outcome for a breakpoint that no longer exists. */
  function reportVerifications(entries: Breakpoint[], verified: boolean): void {
    for (const bp of entries) deps.breakpoints?.report(bp.id, verified);
  }

  /**
   * Locate a pause in the coordinates the editor speaks.
   *
   * The lookup order is the measured one: the frame's `location.url` is often
   * empty, so the `scriptId` from the `Debugger.scriptParsed` map is tried first
   * and the frame's own urls are only fallbacks. The line is converted from the
   * protocol's 0-based numbering to the gutter's 1-based numbering here and nowhere
   * else, because a second conversion anywhere down the chain is a highlight one
   * line off — which reads as a wrong debugger rather than a wrong arithmetic.
   */
  function resolvePausedLocation(frames: CallFrame[] | undefined): DebugPausedLocation | null {
    const current = active;
    if (!current) return null;
    const frame = frames?.[0];
    if (!frame) return null;

    const scriptId = frame.location?.scriptId;
    const url =
      (scriptId ? current.scriptUrls.get(scriptId) : undefined) ?? frame.location?.url ?? frame.url ?? '';
    const filePath = urlToPath(url);
    if (!filePath) return null;

    const zeroBased = frame.location?.lineNumber;
    if (typeof zeroBased !== 'number' || !Number.isFinite(zeroBased)) return null;

    const functionName = frame.functionName ? clamp(frame.functionName, 200) : undefined;
    // `<anonymous>` is what the protocol calls a top-level script and what a
    // wrapper reports for generated code; showing it reads like a bug in the UI.
    return {
      filePath: clamp(filePath, 4096),
      lineNumber: zeroBased + 1,
      functionName: functionName && functionName !== '<anonymous>' ? functionName : undefined
    };
  }

  function samePath(a: string, b: string): boolean {
    const norm = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
    return norm(a) === norm(b);
  }

  async function start(
    payload: unknown,
    workspacePath: string | null,
    breakpoints?: Breakpoint[]
  ): Promise<IpcResponse<DebugSession>> {
    if (disposed) {
      return { success: false, error: 'The debug session service has been shut down.' };
    }
    const parsed = DebugStartRequestSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { success: false, error: `Start-debugging request failed validation: ${describeIssues(parsed.error)}` };
    }
    const request = parsed.data;

    if (active || plain) {
      return {
        success: false,
        error: session.status === 'paused'
          ? 'A debug session is already stopped at a breakpoint. Stop it before starting another.'
          : `Something is already running (${session.status}). Stop it before starting another.`
      };
    }
    if (!workspacePath) {
      return { success: false, error: 'No folder is open, so there is nothing to debug.' };
    }

    // Resolve what to run before claiming `starting`, so an unanswerable request
    // leaves the previous status in place rather than showing a session that was
    // never possible.
    let config: DebugConfiguration | null = null;
    const listed = readDebugConfigurations(deps, workspacePath).configurations;
    if (request.configuration) {
      config = listed.find((entry) => entry.label === request.configuration) ?? null;
      if (!config) {
        return {
          success: false,
          error: `launch.json has no configuration called '${clamp(request.configuration, 120)}'. Reopen the Run menu to read the file again.`
        };
      }
    } else if (request.entryPath) {
      config = { label: path.basename(request.entryPath), program: request.entryPath };
    } else if (listed.length === 1) {
      config = listed[0];
    } else if (listed.length > 1) {
      return {
        success: false,
        error: `launch.json has ${listed.length} configurations, so there is no obvious one to run. Pick one under Run > Start Debugging.`
      };
    }

    if (!config) {
      return {
        success: false,
        error: `Nothing to debug: no configuration was named and ${path.join(LAUNCH_DIR_NAME, LAUNCH_FILE_NAME)} has none. Use Run > Add Configuration… to create one.`
      };
    }

    const entryPath = config.program;
    if (deps.readFileOrNull(entryPath) === null) {
      return {
        success: false,
        error: `The program '${clamp(entryPath, 200)}' could not be read, so it cannot be debugged.`
      };
    }

    const stopOnEntry = request.stopOnEntry ?? config.stopOnEntry ?? false;
    // `noDebug` subsumes `stopOnEntry`: there is no debugger to break into, so a
    // configuration that asks for both runs plainly rather than failing.
    const noDebug = request.noDebug === true;
    publish({ ...session, status: 'starting', configurationLabel: config.label, entryPath, error: undefined, exitCode: undefined, pausedLocation: undefined, pausedReason: undefined });
    lastRequest = { request, workspacePath };

    let proc: DebuggeeProcess;
    try {
      proc = await deps.spawnTarget({
        command: executable(),
        args: buildNodeArgs(entryPath, { stopOnEntry: !noDebug && stopOnEntry, noInspect: noDebug, cwd: config.cwd, args: config.args }),
        cwd: config.cwd ?? workspacePath,
        // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node,
        // which is what `process.execPath` is inside this application. Without it
        // a debugged script would try to open a second GUI.
        env: { ELECTRON_RUN_AS_NODE: '1' }
      });
    } catch (err: unknown) {
      publish({ ...session, status: 'failed', error: clamp(`The debuggee could not be launched: ${describeError(err)}`, 600) });
      return { success: false, error: session.error };
    }

    if (noDebug) {
      // No inspector, no socket, no breakpoints. The process is tracked only so
      // Stop Debugging can reach it and so `debugSessionActive` holds — which is
      // precisely what the row claims: the program runs, and nothing is stopped.
      plain = proc;
      proc.on('exit', (code, signal) => {
        if (plain !== proc) return;
        plain = null;
        publish({
          ...session,
          status: 'exited',
          exitCode: typeof code === 'number' ? code : undefined,
          error: signal
            ? clamp(`The program was terminated by ${signal}.`, 600)
            : code === 0
              ? undefined
              : clamp(`The program exited with code ${code ?? 'unknown'}.`, 600),
          pausedReason: undefined,
          pausedLocation: undefined
        });
      });
      proc.on('error', (err) => {
        if (plain !== proc) return;
        plain = null;
        publish({ ...session, status: 'failed', error: clamp(`The program failed: ${describeError(err)}`, 600) });
      });
      publish({ ...session, status: 'running', pid: proc.pid, startedAt: now(), debuggerUrl: undefined });
      return { success: true, data: snapshot() };
    }

    let debuggerUrl: string;
    try {
      debuggerUrl = await waitForDebuggerUrl(proc, URL_WAIT_MS);
    } catch (err: unknown) {
      const error = clamp(describeError(err), 600);
      try {
        proc.kill();
      } catch {
        /* Already exited — which is what produced this message. */
      }
      publish({ ...session, status: 'failed', error });
      return { success: false, error };
    }

    let socket: DebugSocket;
    try {
      socket = await deps.connectDebugger(debuggerUrl);
    } catch (err: unknown) {
      try {
        proc.kill();
      } catch {
        /* Nothing to clean up if it is already gone. */
      }
      const error = clamp(`Could not reach the debugger at ${debuggerUrl}: ${describeError(err)}`, 600);
      publish({ ...session, status: 'failed', debuggerUrl, error });
      return { success: false, error };
    }

    const client = new CdpClient(socket.transport, socket, CALL_TIMEOUT_MS);
    const live: ActiveSession = {
      proc,
      socket: socket.transport,
      client,
      scriptUrls: new Map(),
      parsedPaths: new Set(),
      installed: new Map(),
      pending: new Map(),
      stopped: false,
      stoppedReason: null,
      stoppedLocation: null,
      killed: false
    };
    active = live;

    proc.on('exit', (code, signal) => {
      // Any exit ends the session, including one that arrives while stopped: the
      // process finishing is not the user resuming.
      if (active !== live) return;
      live.killed = true;
      if (signal) {
        teardown('exited', { error: clamp(`The debuggee was terminated by ${signal}.`, 600) });
      } else {
        teardown('exited', {
          exitCode: typeof code === 'number' ? code : undefined,
          error: code === 0 ? undefined : clamp(`The program exited with code ${code ?? 'unknown'}.`, 600)
        });
      }
    });
    proc.on('error', (err) => {
      if (active !== live) return;
      teardown('failed', { error: clamp(`The debuggee failed: ${describeError(err)}`, 600) });
    });

    client.on('Debugger.scriptParsed', (params) => {
      const event = params as ScriptParsedEvent;
      if (typeof event.scriptId !== 'string' || typeof event.url !== 'string') return;
      const filePath = urlToPath(event.url);
      if (!filePath) {
        // `node:internal/*` and `devtools://` have no user-visible file. Mapping
        // them anyway would let a pause inside Node's module loader look like a
        // pause in the user's source.
        return;
      }
      live.scriptUrls.set(event.scriptId, event.url);
      live.parsedPaths.add(filePath);
      void reapplyForPath(filePath);
    });

    client.on('Debugger.paused', (params) => {
      const event = params as PausedEvent;
      live.stopped = true;
      live.stoppedLocation = resolvePausedLocation(event.callFrames);
      live.stoppedReason = describePauseReason(event.reason);
      publish({
        ...session,
        status: 'paused',
        pausedReason: live.stoppedReason,
        pausedLocation: live.stoppedLocation ?? undefined,
        error: live.stoppedLocation ? session.error : clamp('Execution stopped, but the runtime reported no source location for it.', 600)
      });
    });

    client.on('Debugger.resumed', () => {
      live.stopped = false;
      live.stoppedLocation = null;
      live.stoppedReason = null;
      publish({ ...session, status: 'running', pausedReason: undefined, pausedLocation: undefined });
    });

    try {
      await client.call('Debugger.enable');
    } catch (err: unknown) {
      teardown('failed', { error: clamp(`The debugger domain could not be enabled: ${describeError(err)}`, 600) });
      return { success: false, error: session.error };
    }

    // One publication, carrying everything a live session is known by. Splitting
    // this into a status write and then a metadata write would let a subscriber see
    // `running` with no `pid` and no address, which is a session it cannot describe
    // to the user — and `publish` re-parses, so a partial write is a real state
    // rather than a transient one that happens to be unprovable.
    publish({
      ...session,
      status: 'running',
      debuggerUrl,
      pid: proc.pid,
      startedAt: now(),
      pausedReason: undefined,
      pausedLocation: undefined
    });

    if (stopOnEntry) {
      // The target is frozen at its first statement and no pause was ever
      // delivered for it (measured — see the header). Resuming is the only
      // honest way to reach a state the UI can describe: running, breakpoints
      // installed, execution actually stopping on them.
      client.call('Debugger.resume').catch(() => undefined);
    }

    // Breakpoints are installed after `running` is published on purpose: an
    // unresolved breakpoint is a note about the gutter, not a failed launch, and
    // a launch that waited on every `setBreakpointByUrl` round trip would look
    // like a hang for the length of the user's breakpoint list.
    void applyBreakpoints(breakpoints ?? listBreakpoints());

    return { success: true, data: snapshot() };
  }

  function stop(_payload?: unknown): IpcResponse<DebugSession> {
    if (disposed) return { success: false, error: 'The debug session service has been shut down.' };
    if (plain) {
      // A plainly-running process is stopped the same way: null the handle first,
      // so its own exit event cannot publish `exited` over the `inactive` this
      // call is reporting. The user stopped it; the program did not finish.
      const dying = plain;
      plain = null;
      try {
        dying.kill();
      } catch {
        /* A process that will not die reports its own exit later. */
      }
      publish({ ...session, status: 'inactive', pausedReason: undefined, pausedLocation: undefined, error: undefined });
      return { success: true, data: snapshot() };
    }
    if (!active) {
      return {
        success: false,
        error: session.status === 'exited' || session.status === 'failed'
          ? 'There is no live session — the program already ended.'
          : 'There is no debug session to stop.'
      };
    }
    // Read the pending set *before* tearing down: `teardown` nulls the session, and
    // clearing verifications afterwards would report an empty list — leaving every
    // gutter dot in the store claiming a verification the dead process gave.
    forgetVerificationsForDyingSession(active);
    teardown('stopped');
    return { success: true, data: snapshot() };
  }

  async function restart(
    payload: unknown,
    workspacePath: string | null,
    breakpoints?: Breakpoint[]
  ): Promise<IpcResponse<DebugSession>> {
    if (disposed) return { success: false, error: 'The debug session service has been shut down.' };
    const request = DebugStartRequestSchema.safeParse(payload ?? lastRequest?.request ?? {});
    if (!request.success) {
      return { success: false, error: `Restart request failed validation: ${describeIssues(request.error)}` };
    }
    const scope = workspacePath ?? lastRequest?.workspacePath ?? null;
    if (plain) {
      // Run Without Debugging restarts too, and its restart normally attaches: the
      // request being restarted here is whichever one the user picked, so killing
      // the plain process is the whole of the teardown — there is no socket to
      // close and no verification to forget.
      const dying = plain;
      plain = null;
      try {
        dying.kill();
      } catch {
        /* Already gone. */
      }
      publish({ ...session, status: 'inactive', pausedReason: undefined, pausedLocation: undefined, error: undefined });
      await delay(50);
      return start(request.data, scope, breakpoints);
    }
    if (active) {
      // Verification is a fact about the process that is about to die, so it is
      // cleared before the new one starts — otherwise a gutter dot stays bright
      // through a restart that has not yet bound anything.
      forgetVerificationsForDyingSession(active);
      teardown('stopped');
      // Give the killed process a moment to leave the port behind. It asks for
      // port 0 so a collision is unlikely, but an exit that has not been reaped
      // yet can still hold the address of a *previous* session's socket.
      await delay(50);
      // `undefined` rather than the caller's list: the cleared store is the truth
      // now, and re-reading it is the only way to pick up the clearing.
      return start(request.data, scope, undefined);
    }
    return start(request.data, scope, breakpoints);
  }

  /**
   * Send a stepping or resume command, subject to what was observed.
   *
   * The pre-check exists because the protocol's complaint — "Can only perform
   * operation while paused" — is true but unhelpful, and because reaching the
   * protocol at all costs a round trip whose failure looks like a crash. A
   * declined command is still an answer: the row was disabled in the menu, and
   * this is the message for whoever invoked it from the palette.
   */
  async function command(
    method: 'pause' | 'resume' | 'stepOver' | 'stepInto' | 'stepOut',
    requiresStopped: boolean
  ): Promise<IpcResponse<DebugSession>> {
    if (disposed) return { success: false, error: 'The debug session service has been shut down.' };
    const current = active;
    if (!current) {
      return {
        success: false,
        error: plain
          ? 'The program is running without a debugger attached, so there is nothing to control. Start Debugging will attach one.'
          : 'There is no debug session running, so there is nothing to control.'
      };
    }
    if (method === 'pause' && current.stopped) {
      return { success: false, error: 'Execution is already stopped at a breakpoint.' };
    }
    if (requiresStopped && !current.stopped) {
      return { success: false, error: 'The program is not stopped at a breakpoint, so there is nowhere to step from.' };
    }

    const params =
      method === 'stepOver' ? { direction: 'over' }
      : method === 'stepInto' ? { direction: 'into' }
      : method === 'stepOut' ? { direction: 'out' }
      : undefined;
    const rpc = method === 'pause' ? 'Debugger.pause' : method === 'resume' ? 'Debugger.resume' : 'Debugger.step';

    if (method === 'pause') {
      // The pause lands as an event. Reporting it as done would be a claim about
      // a state we have not observed, so the reply is only a receipt.
      try {
        await current.client.call(rpc);
        return { success: true, data: snapshot() };
      } catch (err: unknown) {
        return { success: false, error: clamp(`Pausing failed: ${describeError(err)}`, 600) };
      }
    }

    if (requiresStopped) {
      // Optimistically clear the stopped flags: the runtime is about to move, and
      // a second stepOver sent because the first one's event has not arrived yet
      // would be rejected by the protocol as a duplicate.
      current.stopped = false;
      current.stoppedLocation = null;
    }
    try {
      await current.client.call(rpc, params);
      // Execution is moving again by the definition of every command that reaches
      // here — `pause` returned above — so the reported state says so. Leaving
      // `paused` in place while the internal `stopped` flag is false is how the menu
      // keeps Continue enabled and the service then declines the next step with
      // "not stopped at a breakpoint": two gates, one fact, two answers.
      publish({ ...session, status: 'running', pausedReason: undefined, pausedLocation: undefined });
      return { success: true, data: snapshot() };
    } catch (err: unknown) {
      if (requiresStopped) current.stopped = true;
      return { success: false, error: clamp(`The runtime refused the command: ${describeError(err)}`, 600) };
    }
  }

  /**
   * Tell the store that nothing is verified any more.
   *
   * Two separate calls rather than one loop, because they are two different
   * claims: `clearVerifications` resets every breakpoint the store holds, and the
   * per-entry report is what tells a subscriber *why* a specific dot went dim. A
   * store that only implemented one of them still converges.
   */
  function forgetVerificationsForDyingSession(current: ActiveSession): void {
    const unresolved = [...current.pending.values()];
    deps.breakpoints?.clearVerifications();
    reportVerifications(unresolved, false);
  }

  const service: DebugSessionService = {
    configurations: (workspacePath) => {
      const listed = readDebugConfigurations(deps, workspacePath);
      return DebugConfigurationListSchema.parse(listed);
    },
    start,
    stop,
    restart,
    pause: () => command('pause', false),
    resume: () => command('resume', true),
    stepOver: () => command('stepOver', true),
    stepInto: () => command('stepInto', true),
    stepOut: () => command('stepOut', true),
    onBreakpointsChanged(breakpoints) {
      if (!active) return;
      void applyBreakpoints(breakpoints ?? listBreakpoints());
    },
    snapshot,
    hasActiveSession() {
      return active !== null || plain !== null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) {
        const dying = active;
        active = null;
        dying.killed = true;
        forgetVerificationsForDyingSession(dying);
        try {
          dying.socket.close();
        } catch {
          /* Already closed. */
        }
        try {
          dying.proc.kill();
        } catch {
          /* Already gone. */
        }
      }
      if (plain) {
        const dyingPlain = plain;
        plain = null;
        try {
          dyingPlain.kill();
        } catch {
          /* Already gone. */
        }
      }
      listeners.clear();
      session = { status: 'inactive' };
    }
  };

  return service;
}

/** Turn the protocol's bare reason into a sentence the panel can show. */
function describePauseReason(reason: string | undefined): string {
  switch (reason) {
    case 'breakpoint':
      return 'Stopped on a breakpoint';
    case 'command':
      return 'Stopped after a pause request';
    case 'exception':
      return 'Stopped on an uncaught exception';
    case 'assert':
      return 'Stopped on a failed assertion';
    case 'instrumentation':
      return 'Stopped by the debugger itself';
    case 'other':
      return 'Execution stopped';
    default:
      return 'Execution stopped';
  }
}

export { isSessionActive };
