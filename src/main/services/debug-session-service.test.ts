/**
 * Debug session contract tests (Prompt 5b Step 3: Run menu).
 *
 * These exist to keep five *measured* facts from being reintroduced as guesses.
 * Each one was learned by running a real spawned child and observing what the
 * Chrome DevTools Protocol actually did, and each one is a silent failure that
 * type checking cannot see:
 *
 *  - **`--inspect`, never `--inspect-brk`, unless entry was asked for.** With
 *    `-brk` the entry break fires before `Debugger.enable` can be sent, so no
 *    `Debugger.paused` is ever delivered, a breakpoint on the not-yet-parsed user
 *    script resolves zero locations, and the target sits frozen at a line the UI
 *    believes is running.
 *  - **There is no `Debugger.continue`.** The method is `Debugger.resume`, and a
 *    call to the invented name answers with a protocol error the user sees as a
 *    dead F5.
 *  - **The top frame's `location.url` is empty for a script reached through a
 *    wrapper**, so a pause is located through the `Debugger.scriptParsed` map.
 *  - **Protocol lines are 0-based and the gutter's are 1-based**, converted at
 *    this boundary in both directions.
 *  - **`verified` is the runtime's answer.** Zero locations is pending, a rejected
 *    request is a refusal, and neither is ever reported as a binding.
 *
 * No Electron, no network, no child process: `spawnTarget` hands back an object
 * that prints a debugger URL on command and `connectDebugger` hands back a socket
 * that records the exact JSON-RPC traffic, so the assertions below are about the
 * protocol conversation itself.
 */

import path from 'path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IpcResponse } from '../../preload/types';
import {
  LAUNCH_DIR_NAME,
  LAUNCH_FILE_NAME,
  type Breakpoint,
  type DebugConfigurationList,
  type DebugSession
} from '../../shared/types/debug-session';
import {
  buildNodeArgs,
  createDebugSessionService,
  describeBreakpointForProtocol,
  extractDebuggerUrl,
  readDebugConfigurations,
  urlToPath,
  type DebugBreakpointPort,
  type DebugSessionDeps,
  type DebugSessionService,
  type DebuggeeProcess,
  type DebugSocket
} from './debug-session-service';

const WORKSPACE = path.resolve('/repo');
const ENTRY = path.join(WORKSPACE, 'app.js');
const LAUNCH_PATH = path.join(WORKSPACE, LAUNCH_DIR_NAME, LAUNCH_FILE_NAME);
const DEBUGGER_URL = 'ws://127.0.0.1:9229/0f6d0c1a-0000-4000-8000-0123456789ab';
const NOW = 1_700_000_000_000;

/** Drain the queued microtasks and the 0-ms timers the service awaits on. */
async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Yield until `condition` holds, and name the thing that never happened.
 *
 * The service reaches the socket through work that is deliberately not awaited
 * (breakpoints install after `running` is published, so a launch never waits on a
 * round trip), and several assertions need a request answered before the awaited
 * call can settle. Counting microtask flushes would be either flaky or silently
 * wrong; waiting on the observable fact makes a failure read as "the request never
 * arrived" instead of a timeout in an unrelated assertion.
 */
async function waitUntil(what: string, condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting until ${what}.`);
}

function breakpoint(overrides: Partial<Breakpoint> & { id: string }): Breakpoint {
  return {
    filePath: ENTRY,
    lineNumber: 12,
    enabled: true,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// The fake debuggee
// ---------------------------------------------------------------------------

interface FakeProcess extends DebuggeeProcess {
  emitStderr(chunk: string): void;
  emitStdout(chunk: string): void;
  exit(code: number | null, signal: string | null): void;
  fail(err: Error): void;
  killCount(): number;
}

/**
 * A child process that keeps whatever was printed before anyone listened.
 *
 * The buffer-and-replay matters: the service attaches its `data` listeners one
 * microtask after `spawnTarget` returns, so a test that hands over the inspector
 * line immediately would otherwise have it vanish into a pipe nobody had joined.
 * That is also what a real pipe does — the output is not lost just because the
 * reader attached a moment late.
 */
function makeFakeProcess(pid = 4321): FakeProcess {
  const listeners = {
    stdout: [] as Array<(chunk: string | Uint8Array) => void>,
    stderr: [] as Array<(chunk: string | Uint8Array) => void>,
    exit: [] as Array<(code: number | null, signal: string | null) => void>,
    error: [] as Array<(err: Error) => void>
  };
  const buffers = { stdout: [] as Array<string | Uint8Array>, stderr: [] as Array<string | Uint8Array> };
  let kills = 0;

  const emit = (stream: 'stdout' | 'stderr', chunk: string): void => {
    buffers[stream].push(chunk);
    for (const listener of [...listeners[stream]]) listener(chunk);
  };

  return {
    pid,
    stdout: {
      on: (_event, listener) => {
        listeners.stdout.push(listener);
        for (const chunk of buffers.stdout) listener(chunk);
      }
    },
    stderr: {
      on: (_event, listener) => {
        listeners.stderr.push(listener);
        for (const chunk of buffers.stderr) listener(chunk);
      }
    },
    on: (event, listener) => {
      if (event === 'exit') {
        listeners.exit.push(listener as (code: number | null, signal: string | null) => void);
      } else {
        listeners.error.push(listener as (err: Error) => void);
      }
    },
    kill: () => {
      kills += 1;
      return true;
    },
    emitStderr: (chunk) => emit('stderr', chunk),
    emitStdout: (chunk) => emit('stdout', chunk),
    exit: (code, signal) => {
      for (const listener of [...listeners.exit]) listener(code, signal);
    },
    fail: (err) => {
      for (const listener of [...listeners.error]) listener(err);
    },
    killCount: () => kills
  };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

interface Sent {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

interface Report {
  id: string;
  verified: boolean;
  note?: string;
}

interface Harness {
  service: DebugSessionService;
  proc: FakeProcess;
  sent: Sent[];
  spawns: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string> }>;
  connections: string[];
  reports: Report[];
  clears: number[];
  socketClosed: boolean;
  /** Answer the newest request for `method` and hand back its id. */
  reply(method: string, result: unknown): void;
  /** Refuse the newest request for `method`. */
  refuse(method: string, message: string): void;
  /** Deliver a protocol event. */
  fire(method: string, params: unknown): void;
  methodsSent(): string[];
  /** How many requests for `method` have reached the socket so far. */
  callsFor(method: string): number;
}

function makeHarness(
  files: Record<string, string> = {},
  store: Breakpoint[] = []
): Harness {
  // The entry file exists unless a test overrides it. `start` refuses to spawn a
  // program it cannot read, so a harness without one answers every launch with
  // "could not be read" and the protocol assertions never see a socket at all.
  const map = new Map<string, string>([[ENTRY, '// the debuggee\n'], ...Object.entries(files)]);
  const proc = makeFakeProcess();
  const sent: Sent[] = [];
  const spawns: Harness['spawns'] = [];
  const connections: string[] = [];
  const reports: Report[] = [];
  const clears: number[] = [];

  let messageListener: ((raw: string) => void) | null = null;
  let closeListener: (() => void) | null = null;
  const state = { socketClosed: false };

  const socket: DebugSocket = {
    transport: {
      send: (payload: string) => {
        sent.push(JSON.parse(payload) as Sent);
      },
      close: () => {
        state.socketClosed = true;
        closeListener?.();
      }
    },
    onMessage: (listener: (raw: string) => void) => {
      messageListener = listener;
    },
    onClose: (listener: () => void) => {
      closeListener = listener;
    }
  };

  const port: DebugBreakpointPort = {
    list: () => store,
    report: (id, verified, note) => {
      reports.push(note ? { id, verified, note } : { id, verified });
    },
    clearVerifications: () => {
      clears.push(clears.length);
    }
  };

  const deps: DebugSessionDeps = {
    spawnTarget: (options) => {
      spawns.push(options);
      return proc;
    },
    connectDebugger: (url) => {
      connections.push(url);
      return socket;
    },
    readFileOrNull: (absolutePath) => map.get(absolutePath) ?? null,
    breakpoints: port,
    nodeExecutable: () => 'node',
    now: () => NOW,
    delay: async () => undefined
  };

  const newest = (method: string): Sent | undefined => {
    for (let i = sent.length - 1; i >= 0; i -= 1) {
      if (sent[i].method === method) return sent[i];
    }
    return undefined;
  };

  const harness: Harness = {
    service: createDebugSessionService(deps),
    proc,
    sent,
    spawns,
    connections,
    reports,
    clears,
    get socketClosed() {
      return state.socketClosed;
    },
    reply: (method, result) => {
      const message = newest(method);
      if (!message || typeof message.id !== 'number') throw new Error(`nothing was sent for '${method}'`);
      messageListener?.(JSON.stringify({ id: message.id, result }));
    },
    refuse: (method, error) => {
      const message = newest(method);
      if (!message || typeof message.id !== 'number') throw new Error(`nothing was sent for '${method}'`);
      messageListener?.(JSON.stringify({ id: message.id, error: { message: error } }));
    },
    fire: (method, params) => {
      messageListener?.(JSON.stringify({ method, params }));
    },
    methodsSent: () => sent.map((entry) => entry.method ?? ''),
    callsFor: (method) => sent.filter((entry) => entry.method === method).length
  };

  return harness;
}

/** Bring a session all the way up: URL, connect, `Debugger.enable` answered. */
async function launch(
  h: Harness,
  request: Record<string, unknown> = { entryPath: ENTRY }
): Promise<IpcResponse<DebugSession>> {
  const starting = h.service.start(request, WORKSPACE);
  await waitUntil('the debuggee was spawned', () => h.spawns.length > 0);
  h.proc.emitStderr(`Debugger listening on ${DEBUGGER_URL}\n`);
  await waitUntil('the debugger domain was enabled', () => h.callsFor('Debugger.enable') === 1);
  h.reply('Debugger.enable', {});
  return await starting;
}

// ---------------------------------------------------------------------------

describe('debug session service (Prompt 5b Step 3)', () => {
  describe('the measured protocol facts', () => {
    it('finds the debugger address in either stream', () => {
      expect(extractDebuggerUrl(`Debugger listening on ${DEBUGGER_URL}`)).toBe(DEBUGGER_URL);
      expect(extractDebuggerUrl(`waiting for ${DEBUGGER_URL} to connect`)).toBe(DEBUGGER_URL);
      expect(extractDebuggerUrl('address already in use')).toBeNull();
    });

    it('defaults to plain --inspect on a loopback port the OS picks', () => {
      const args = buildNodeArgs(ENTRY, { stopOnEntry: false });
      expect(args).toContain('--inspect=127.0.0.1:0');
      // The trap: `-brk` freezes the target before the domain can be enabled.
      expect(args.join(' ')).not.toContain('-brk');
      expect(args[args.length - 1]).toBe(ENTRY);
    });

    it('asks for entry only when the configuration did', () => {
      expect(buildNodeArgs(ENTRY, { stopOnEntry: true }).join(' ')).toContain('--inspect-brk=127.0.0.1:0');
    });

    it('omits the inspector entirely for Run Without Debugging', () => {
      const args = buildNodeArgs(ENTRY, { stopOnEntry: false, noInspect: true, args: ['--fast'] });
      expect(args.join(' ')).not.toContain('--inspect');
      expect(args).toEqual([ENTRY, '--fast']);
    });

    it('resumes with Debugger.resume and never invents Debugger.continue', async () => {
      const h = makeHarness();
      await launch(h);
      h.fire('Debugger.paused', {
        reason: 'breakpoint',
        callFrames: [{ functionName: 'run', location: { scriptId: '7', lineNumber: 11 } }]
      });
      await waitUntil('the pause was observed', () => h.service.snapshot().status === 'paused');
      h.sent.length = 0;
      // The reply has to arrive before the call is awaited: `resume` waits for the
      // runtime's answer, so awaiting first would sit out the full call timeout.
      const resuming = h.service.resume();
      await waitUntil('the resume request reached the socket', () => h.callsFor('Debugger.resume') === 1);
      h.reply('Debugger.resume', {});
      await resuming;
      expect(h.methodsSent()).toContain('Debugger.resume');
      expect(h.methodsSent()).not.toContain('Debugger.continue');
    });

    it('maps a script id to a file so a pause with an empty frame url is still located', async () => {
      const h = makeHarness();
      await launch(h);
      h.fire('Debugger.scriptParsed', { scriptId: '7', url: pathToFileURL(ENTRY).href });
      h.fire('Debugger.paused', {
        reason: 'breakpoint',
        // Measured: `location.url` is empty here and `frame.url` is not the file.
        callFrames: [{ url: '', functionName: '<anonymous>', location: { scriptId: '7', lineNumber: 4 } }]
      });
      await waitUntil('the pause was located', () => h.service.snapshot().status === 'paused');
      const location = h.service.snapshot().pausedLocation;
      expect(location?.filePath).toBe(ENTRY);
      // 0-based protocol line 4 → gutter line 5, and `<anonymous>` is not a name.
      expect(location?.lineNumber).toBe(5);
      expect(location?.functionName).toBeUndefined();
    });

    it('drops internal node: scripts from the map so they are never offered as source', async () => {
      const h = makeHarness();
      await launch(h);
      expect(urlToPath('node:internal/modules/cjs/loader')).toBeNull();
      h.fire('Debugger.scriptParsed', { scriptId: '99', url: 'node:internal/bootstrap/realm' });
      h.fire('Debugger.paused', {
        reason: 'other',
        callFrames: [{ url: '', location: { scriptId: '99', lineNumber: 3 } }]
      });
      await waitUntil('the pause arrived with no usable source', () => h.service.snapshot().status === 'paused');
      expect(h.service.snapshot().pausedLocation).toBeUndefined();
      expect(h.service.snapshot().error).toContain('no source location');
    });

    it('converts gutter lines to protocol lines in both directions', () => {
      expect(describeBreakpointForProtocol(breakpoint({ id: 'a', lineNumber: 1 })).lineNumber).toBe(0);
      expect(describeBreakpointForProtocol(breakpoint({ id: 'a', lineNumber: 12 })).lineNumber).toBe(11);
      expect(describeBreakpointForProtocol(breakpoint({ id: 'a', condition: 'i === 2' }))).toMatchObject({
        condition: 'i === 2'
      });
      expect(describeBreakpointForProtocol(breakpoint({ id: 'a', logMessage: 'hit' }))).toMatchObject({
        action: { type: 'logPoint', logMessage: 'hit' }
      });
    });
  });

  describe('launch configuration discovery', () => {
    function readWith(body: string | null): DebugConfigurationList {
      const deps: DebugSessionDeps = {
        spawnTarget: () => makeFakeProcess(),
        connectDebugger: () => {
          throw new Error('unused');
        },
        readFileOrNull: (absolutePath) => (absolutePath === LAUNCH_PATH ? body : null)
      };
      return readDebugConfigurations(deps, WORKSPACE);
    }

    it('accepts name as well as label, because an imported file uses the other', () => {
      const list = readWith(JSON.stringify({ configurations: [{ name: ' Imported ', program: 'app.js' }] }));
      expect(list.configurations).toHaveLength(1);
      expect(list.configurations[0].label).toBe('Imported');
      expect(list.configurations[0].program).toBe(ENTRY);
    });

    it('substitutes only the variable it actually knows', () => {
      const list = readWith(
        JSON.stringify({
          configurations: [
            { label: 'a', program: '${workspaceFolder}/app.js' },
            { label: 'b', program: '${env:HOME}/app.js' }
          ]
        })
      );
      expect(list.configurations[1].program).toContain('${env:HOME}');
      expect(list.error).toContain('does not substitute');
    });

    it('reports an unparseable file beside the path, rather than an empty menu', () => {
      const list = readWith('{ not json');
      expect(list.configurations).toEqual([]);
      expect(list.sourcePath).toBe(LAUNCH_PATH);
      expect(list.error).toContain('could not be parsed');
    });

    it('names the entries it skipped instead of dropping them quietly', () => {
      const list = readWith(JSON.stringify({ configurations: [{ label: 'no program' }, 'garbage'] }));
      expect(list.configurations).toEqual([]);
      expect(list.error).toContain('skipped');
    });

    it('says there is nothing when no folder is open', () => {
      expect(readDebugConfigurations(
        { spawnTarget: () => makeFakeProcess(), connectDebugger: () => { throw new Error('x'); }, readFileOrNull: () => null },
        null
      ).configurations).toEqual([]);
    });
  });

  describe('declines are sentences', () => {
    it('refuses with no folder, and says what to do', async () => {
      const h = makeHarness();
      const result = await h.service.start({}, null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('No folder is open, so there is nothing to debug.');
    });

    it('refuses to guess between two configurations', async () => {
      const h = makeHarness({
        [LAUNCH_PATH]: JSON.stringify({
          configurations: [
            { label: 'one', program: ENTRY },
            { label: 'two', program: ENTRY }
          ]
        })
      });
      const result = await h.service.start({}, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('2 configurations');
      expect(h.spawns).toHaveLength(0);
    });

    it('refuses a configuration name the file does not have', async () => {
      const h = makeHarness({
        [LAUNCH_PATH]: JSON.stringify({ configurations: [{ label: 'one', program: ENTRY }] })
      });
      const result = await h.service.start({ configuration: 'missing' }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toContain("has no configuration called 'missing'");
    });

    it('refuses a program it cannot read, before claiming anything started', async () => {
      const h = makeHarness();
      const result = await h.service.start({ entryPath: path.join(WORKSPACE, 'gone.js') }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('could not be read');
      expect(h.service.snapshot().status).toBe('inactive');
    });

    it('refuses a second launch while one is live', async () => {
      const h = makeHarness();
      await launch(h);
      const again = await h.service.start({}, WORKSPACE);
      expect(again.success).toBe(false);
      expect(again.error).toContain('already running');
    });
  });

  describe('a live session', () => {
    it('reports running with the address it actually connected to', async () => {
      const h = makeHarness();
      const result = await launch(h);
      expect(result.success).toBe(true);
      expect(h.connections).toEqual([DEBUGGER_URL]);
      expect(h.spawns[0].args).toContain('--inspect=127.0.0.1:0');
      expect(h.spawns[0].env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
      const session = h.service.snapshot();
      expect(session.status).toBe('running');
      expect(session.pid).toBe(4321);
      expect(session.debuggerUrl).toBe(DEBUGGER_URL);
    });

    it('binds a breakpoint only when the runtime says it did', async () => {
      const bp = breakpoint({ id: 'a', lineNumber: 12 });
      const h = makeHarness({}, [bp]);
      await launch(h);
      await waitUntil('the runtime was asked to bind it', () => h.callsFor('Debugger.setBreakpointByUrl') === 1);
      const request = h.sent.find((entry) => entry.method === 'Debugger.setBreakpointByUrl');
      // Gutter line 12 leaves as protocol line 11 — the only place the conversion
      // is allowed to happen.
      expect(request?.params?.lineNumber).toBe(11);
      h.reply('Debugger.setBreakpointByUrl', { breakpointId: 'bk-1', locations: [{ lineNumber: 11 }] });
      await waitUntil('the binding was reported', () => h.reports.length === 1);
      expect(h.reports).toEqual([{ id: 'a', verified: true }]);
    });

    it('keeps a zero-location breakpoint pending and re-tries it when the script appears', async () => {
      const bp = breakpoint({ id: 'a', lineNumber: 12 });
      const h = makeHarness({}, [bp]);
      await launch(h);
      await waitUntil('the first bind request', () => h.callsFor('Debugger.setBreakpointByUrl') === 1);
      h.reply('Debugger.setBreakpointByUrl', { breakpointId: 'bk-1', locations: [] });
      await waitUntil('the pending answer', () => h.reports.length === 1);
      // Not a refusal and not a binding: the script has not been parsed yet.
      expect(h.reports).toEqual([{ id: 'a', verified: false }]);

      h.fire('Debugger.scriptParsed', { scriptId: '7', url: pathToFileURL(ENTRY).href });
      await waitUntil('the pending entry was re-sent', () => h.callsFor('Debugger.setBreakpointByUrl') === 2);
      h.reply('Debugger.setBreakpointByUrl', { breakpointId: 'bk-2', locations: [{ lineNumber: 11 }] });
      await waitUntil('the second answer', () => h.reports.length === 2);
      expect(h.reports[1]).toEqual({ id: 'a', verified: true });
    });

    it('reports a refusal as a refusal, with the runtime\'s words attached', async () => {
      const bp = breakpoint({ id: 'a' });
      const h = makeHarness({}, [bp]);
      await launch(h);
      await waitUntil('the bind request', () => h.callsFor('Debugger.setBreakpointByUrl') === 1);
      h.refuse('Debugger.setBreakpointByUrl', 'Breakpoint not found');
      await waitUntil('the refusal was reported', () => h.reports.length === 1);
      expect(h.reports[0].verified).toBe(false);
      expect(h.reports[0].note).toBe('Breakpoint not found');
    });

    it('never installs a disabled breakpoint', async () => {
      const h = makeHarness({}, [breakpoint({ id: 'off', enabled: false })]);
      await launch(h);
      await tick();
      expect(h.callsFor('Debugger.setBreakpointByUrl')).toBe(0);
    });

    it('refuses to step from a running target instead of relaying the protocol complaint', async () => {
      const h = makeHarness();
      await launch(h);
      const result = await h.service.stepOver();
      expect(result.success).toBe(false);
      expect(result.error).toContain('not stopped at a breakpoint');
    });

    it('steps by direction once the runtime says it stopped', async () => {
      const h = makeHarness();
      await launch(h);
      h.fire('Debugger.paused', { reason: 'breakpoint', callFrames: [{ location: { scriptId: '7', lineNumber: 11 } }] });
      await waitUntil('the pause was observed', () => h.service.snapshot().status === 'paused');
      h.sent.length = 0;
      const stepping = h.service.stepInto();
      await waitUntil('the step request reached the socket', () => h.callsFor('Debugger.step') === 1);
      expect(h.sent[0]).toMatchObject({ method: 'Debugger.step', params: { direction: 'into' } });
      h.reply('Debugger.step', {});
      const result = await stepping;
      expect(result.success).toBe(true);
      // The pause is over as far as the menus are concerned: a second step would be
      // rejected by the protocol, so the observed state moves on its own.
      expect(h.service.snapshot().status).toBe('running');
    });

    it('survives the program ending and says who ended it', async () => {
      const h = makeHarness();
      await launch(h);
      h.proc.exit(1, null);
      await waitUntil('the exit was observed', () => h.service.snapshot().status === 'exited');
      const session = h.service.snapshot();
      expect(session.status).toBe('exited');
      expect(session.exitCode).toBe(1);
      expect(session.error).toContain('exited with code 1');
      expect(h.service.hasActiveSession()).toBe(false);
    });

    it('does not credit the user with stopping a program that already finished', async () => {
      const h = makeHarness();
      await launch(h);
      h.proc.exit(0, null);
      await waitUntil('the exit was observed', () => h.service.snapshot().status === 'exited');
      const result = h.service.stop();
      expect(result.success).toBe(false);
      expect(result.error).toContain('already ended');
    });

    it('forgets verifications belonging to a dying session before the next one starts', async () => {
      const bp = breakpoint({ id: 'a' });
      const h = makeHarness({}, [bp]);
      await launch(h);
      await waitUntil('the bind request', () => h.callsFor('Debugger.setBreakpointByUrl') === 1);
      h.reply('Debugger.setBreakpointByUrl', { breakpointId: 'bk-1', locations: [] });
      await waitUntil('the pending answer', () => h.reports.length === 1);
      h.reports.length = 0;
      const clearsBefore = h.clears.length;
      h.service.stop();
      // Both halves of the forgetting: the blanket clear, then an explicit un-verify
      // for the entry that was still pending. A dot that stayed bright through a
      // stop would claim a binding the dead process no longer has.
      expect(h.clears.length).toBe(clearsBefore + 1);
      expect(h.reports).toEqual([{ id: 'a', verified: false }]);
    });

    it('surfaces the debuggee\'s own error when it dies before inspecting', async () => {
      const h = makeHarness();
      const starting = h.service.start({ entryPath: ENTRY }, WORKSPACE);
      await waitUntil('the debuggee was spawned', () => h.spawns.length > 0);
      h.proc.emitStderr('Error: Cannot find module \'./app.js\'\n');
      h.proc.exit(1, null);
      const result = await starting;
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot find module');
    });

    it('runs without a debugger when asked to, and says so when stepped', async () => {
      const h = makeHarness();
      const result = await h.service.start({ entryPath: ENTRY, noDebug: true }, WORKSPACE);
      expect(result.success).toBe(true);
      expect(h.spawns[0].args.join(' ')).not.toContain('--inspect');
      expect(h.connections).toEqual([]);
      expect(h.service.snapshot().debuggerUrl).toBeUndefined();
      expect(h.service.hasActiveSession()).toBe(true);

      const stepped = await h.service.stepOver();
      expect(stepped.success).toBe(false);
      expect(stepped.error).toContain('without a debugger attached');

      const stopped = h.service.stop();
      expect(stopped.success).toBe(true);
      expect(h.proc.killCount()).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('kills the process, closes the socket and then refuses everything', async () => {
      const h = makeHarness();
      await launch(h);
      h.service.dispose();
      expect(h.proc.killCount()).toBe(1);
      expect(h.socketClosed).toBe(true);
      expect(h.service.snapshot().status).toBe('inactive');
      const later = await h.service.start({}, WORKSPACE);
      expect(later.success).toBe(false);
      expect(later.error).toContain('shut down');
    });

    it('releases a subscriber without breaking the next one', async () => {
      const h = makeHarness();
      const seen: string[] = [];
      const off = h.service.subscribe((session) => seen.push(`first:${session.status}`));
      off();
      h.service.subscribe((session) => seen.push(`second:${session.status}`));
      await launch(h);
      // What the returned function is for: the retired listener stops hearing, and
      // retiring it must not silently unsubscribe whoever is left.
      expect(seen.filter((entry) => entry.startsWith('first:'))).toEqual([]);
      expect(seen).toContain('second:running');
    });
  });
});
