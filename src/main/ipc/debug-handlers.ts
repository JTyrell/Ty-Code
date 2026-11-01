/**
 * Debug IPC — the wiring half of `debug-session-service.ts` and
 * `breakpoint-service.ts` (Prompt 5b Step 3).
 *
 * The services hold the decisions and are free of `electron`, so they run under
 * plain Node in tests against a fake transport. This module supplies the four
 * things only main can: a real spawned process, a real WebSocket, the workspace
 * root launch discovery reads from, and the frame trust gate.
 *
 * Three shapes here are worth explaining.
 *
 *  - **Both pushes carry the whole state, never a delta.** A debug session started
 *    from a popout has to disable that popout's Continue row and the primary
 *    window's Continue row at the same moment. A receiver that missed one message
 *    would otherwise be permanently wrong about whether `debugPaused` holds, and a
 *    greyed-out menu that disagrees with a running process is worse than no menu.
 *  - **Breakpoint verification is wired through a port, not an import.** The
 *    session reports into the store and the store's edits flow back into the
 *    session, so a direct import between them would be a cycle. This module is
 *    where both are in scope, which makes it the only place that is allowed to
 *    know about the other.
 *  - **`spawn` is not handed a shell.** A debuggee is launched directly with the
 *    Node-compatible executable, because the argument vector this service builds
 *    — inspector flag, entry file, script arguments — has to reach the runtime
 *    exactly. Routing it through a shell would let the user's quoting rules and
 *    glob expansion rewrite what launch.json asked for, which is the same reason
 *    the task runner refuses `process`-type tasks rather than run them wrongly.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcResponse } from '../../preload/types';
import {
  DEBUG_CHANNELS,
  LAUNCH_DIR_NAME,
  LAUNCH_FILE_NAME,
  LAUNCH_SCAFFOLD,
  type Breakpoint,
  type DebugConfigurationList,
  type DebugSession
} from '../../shared/types/debug-session';
import {
  createDebugSessionService,
  type DebugSessionDeps,
  type DebugSessionService,
  type DebugSocket,
  type DebuggeeProcess,
  type DebugTransport
} from '../services/debug-session-service';
import { createBreakpointStore, type BreakpointStore } from '../services/breakpoint-service';

export { DEBUG_CHANNELS };

/**
 * The slice of a connected WebSocket this service uses.
 *
 * Written down rather than taken from `lib.dom` because the DOM declaration types
 * `onmessage` as receiving a `MessageEvent` whose `data` is `unknown`, which would
 * put a cast in the middle of the protocol reader — the one place in this feature
 * where a wrong assumption about the payload type becomes a silently dropped
 * `Debugger.paused`.
 */
interface InspectorSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface DebugHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Primary window, read lazily because index.ts rebinds it on recreation. */
  getMainWindow(): BrowserWindow | null;
  /** Workspace root `.ty-code/launch.json` is read from. */
  getWorkspacePath(): string | null;
  /** Override for tests. Defaults to the real spawn/WebSocket surface. */
  sessionDeps?: DebugSessionDeps;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run a piece of handler work and turn a throw into an envelope.
 *
 * The session's async paths already catch internally, so this only guards the
 * synchronous reads — where a Zod `parse` on the way out is the realistic failure,
 * and an unhandled throw would reach the renderer as a rejected promise carrying a
 * stack instead of a sentence.
 */
function guard<T>(label: string, work: () => T): IpcResponse<T> {
  try {
    return { success: true, data: work() };
  } catch (err: unknown) {
    return { success: false, error: `${label}: ${describeError(err)}` };
  }
}

/** The real debuggee: a direct spawn, stdio piped so the URL can be read. */
function spawnDebuggee(options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): DebuggeeProcess {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Windows would otherwise open a console window for every debug launch, and a
    // second window that steals focus is not what "Start Debugging" means.
    windowsHide: true
  });
  return child as unknown as DebuggeeProcess;
}

/**
 * Open the debugger WebSocket.
 *
 * Rejects rather than hanging forever: the socket's own failure paths are
 * `onerror` and `close` with no handshake, and a promise that never settles would
 * leave the menu's Start Debugging row looking like a frozen application.
 */
function connectInspector(url: string): Promise<DebugSocket> {
  return new Promise<DebugSocket>((resolve, reject) => {
    const Ctor = (globalThis as { WebSocket?: unknown }).WebSocket as
      | (new (address: string) => InspectorSocket)
      | undefined;
    if (!Ctor) {
      reject(new Error('No WebSocket is available in this runtime, so the debugger cannot connect.'));
      return;
    }

    let socket: InspectorSocket;
    try {
      socket = new Ctor(url);
    } catch (err: unknown) {
      reject(new Error(`Opening the debugger socket failed: ${describeError(err)}`));
      return;
    }

    const messageListeners = new Set<(raw: string) => void>();
    const closeListeners = new Set<() => void>();
    let settled = false;

    const transport: DebugTransport = {
      // `send` is fire-and-forget by contract; a socket that has already died
      // throws, and the protocol layer turns that into a rejected call.
      send: (payload: string) => socket.send(payload),
      close: () => {
        try {
          socket.close();
        } catch {
          /* Already closed. */
        }
      }
    };

    socket.onmessage = (event: { data: unknown }) => {
      // Only text frames are meaningful here. Node sends JSON; a binary frame
      // would be a different protocol and must not be coerced into a string that
      // the reader then silently fails to parse.
      if (typeof event.data !== 'string') return;
      for (const listener of messageListeners) listener(event.data);
    };
    socket.onclose = () => {
      for (const listener of closeListeners) listener();
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error('The debugger socket reported an error before the handshake completed.'));
      }
      for (const listener of closeListeners) listener();
    };
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      resolve({
        transport,
        onMessage: (listener: (raw: string) => void) => {
          messageListeners.add(listener);
        },
        onClose: (listener: () => void) => {
          closeListeners.add(listener);
        }
      });
    };
  });
}

/** The production surface, adapted to the service's Electron-free signatures. */
export function createElectronDebugSessionDeps(): DebugSessionDeps {
  return {
    spawnTarget: spawnDebuggee,
    connectDebugger: connectInspector,
    readFileOrNull: (absolutePath) => {
      try {
        return fs.readFileSync(absolutePath, 'utf8');
      } catch {
        // Missing, a directory, or unreadable: the service treats all three as
        // "no such file" and says which one it was looking for.
        return null;
      }
    },
    writeFileOrNull: (absolutePath, contents) => {
      try {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, contents, 'utf8');
        return null;
      } catch (err: unknown) {
        return describeError(err);
      }
    },
    // The Electron binary in production and plain Node in tests. Pairing this with
    // `ELECTRON_RUN_AS_NODE=1` (set by the service) is what makes a debugged
    // script run as a script rather than opening a second Ty-Code window.
    nodeExecutable: () => process.execPath
  };
}

let registered: { dispose(): void } | null = null;

/** Set while handlers are registered, cleared on dispose. */
let registeredWorkspaceClear: ((workspacePath: string | null) => void) | null = null;

/**
 * Drop the breakpoints belonging to a workspace nobody is looking at any more.
 *
 * Takes both paths because re-opening the same folder is not a workspace change,
 * and clearing on it would silently delete the dots the user had just set — the
 * most destructive thing this module could do to their session. A no-op before
 * `registerDebugHandlers` has run: startup can open a folder before IPC wiring
 * finishes, and there is no store yet to clear.
 */
export function retireDebugBreakpointsFor(previous: string | null, next: string | null): void {
  if (!previous || !registeredWorkspaceClear) return;
  if (path.resolve(previous) === path.resolve(next ?? '')) return;
  registeredWorkspaceClear(previous);
}

/**
 * Register the debug and breakpoint channels and start pushing changes.
 *
 * Idempotent for the same reason `registerTaskHandlers` is: a second call returns
 * the existing disposable instead of double-binding and throwing on an
 * already-registered channel.
 */
export function registerDebugHandlers(deps: DebugHandlerDeps): { dispose(): void } {
  if (registered) return registered;

  const store: BreakpointStore = createBreakpointStore();

  // The session reports verification into the store through a port rather than an
  // import, because each side owns a different fact — the runtime's answer and the
  // user's intent — and a direct import between them is a cycle. This module is the
  // only place both are in scope, so it is the only place allowed to wire them.
  const baseDeps: DebugSessionDeps = deps.sessionDeps ?? createElectronDebugSessionDeps();
  const wiredDeps: DebugSessionDeps = {
    ...baseDeps,
    breakpoints: {
      list: () => store.list(),
      report: (id, verified, note) => store.verify(id, verified, note),
      clearVerifications: () => store.clearVerifications()
    }
  };
  const session: DebugSessionService = createDebugSessionService(wiredDeps);

  // The store answers for verification and the session asks for the set. Two
  // one-way calls, each owned by the side that holds the fact: the session never
  // edits a breakpoint, and the store never speaks the protocol.
  store.subscribe((breakpoints) => session.onBreakpointsChanged(breakpoints));

  const broadcastSession = (state: DebugSession): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send(DEBUG_CHANNELS.sessionChanged, state);
      } catch {
        /* Window raced shutdown; the next change reaches it or it is gone. */
      }
    }
  };

  const broadcastBreakpoints = (breakpoints: Breakpoint[]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send(DEBUG_CHANNELS.breakpointsChanged, breakpoints);
      } catch {
        /* As above. */
      }
    }
  };

  const unsubscribeSession = session.subscribe(broadcastSession);
  const unsubscribeBreakpoints = store.subscribe(broadcastBreakpoints);
  registeredWorkspaceClear = (workspacePath) => store.clearWorkspace(workspacePath);

  // Request handlers, one per channel. Each begins with the trust gate: these
  // channels can spawn a process and terminate one, which a frame the application
  // did not load has no business asking for.
  const listeners: Array<[string, (event: IpcMainInvokeEvent, payload: unknown) => unknown]> = [
    [
      DEBUG_CHANNELS.session,
      (event) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return guard('Reading the debug session failed', () => session.snapshot());
      }
    ],
    [
      DEBUG_CHANNELS.start,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.start(payload, deps.getWorkspacePath(), store.list());
      }
    ],
    [
      DEBUG_CHANNELS.stop,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return session.stop(payload);
      }
    ],
    [
      DEBUG_CHANNELS.restart,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.restart(payload, deps.getWorkspacePath(), store.list());
      }
    ],
    [
      DEBUG_CHANNELS.pause,
      (event) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.pause();
      }
    ],
    [
      DEBUG_CHANNELS.resume,
      (event) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.resume();
      }
    ],
    [
      DEBUG_CHANNELS.stepOver,
      (event) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.stepOver();
      }
    ],
    [
      DEBUG_CHANNELS.stepInto,
      (event) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.stepInto();
      }
    ],
    [
      DEBUG_CHANNELS.stepOut,
      (event) => {
        if (!deps.isTrustedSender(event)) return Promise.resolve({ success: false, error: 'Untrusted renderer frame.' });
        return session.stepOut();
      }
    ],
    [
      DEBUG_CHANNELS.configurations,
      (event) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return guard('Reading launch configurations failed', () => session.configurations(deps.getWorkspacePath()));
      }
    ],
    [
      DEBUG_CHANNELS.addConfiguration,
      (event): IpcResponse<DebugConfigurationList> => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        const workspacePath = deps.getWorkspacePath();
        if (!workspacePath) {
          return { success: false, error: 'No folder is open, so there is nowhere to put a launch configuration.' };
        }
        const relPath = path.join(LAUNCH_DIR_NAME, LAUNCH_FILE_NAME);
        const target = path.join(workspacePath, LAUNCH_DIR_NAME, LAUNCH_FILE_NAME);
        try {
          // Never overwrite. A workspace that already has configurations is asked to
          // edit the file it owns, because appending to JSONC we did not write is how
          // a menu row ends up destroying someone's debug setup.
          if (fs.existsSync(target)) {
            return {
              success: true,
              data: {
                ...session.configurations(workspacePath),
                error: `${relPath} already exists — add a configuration to that file.`
              }
            };
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, LAUNCH_SCAFFOLD, 'utf8');
        } catch (err: unknown) {
          return { success: false, error: `Could not create the launch configuration: ${describeError(err)}` };
        }
        return guard('Creating the launch configuration failed', () => session.configurations(workspacePath));
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsList,
      (event) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return guard('Reading breakpoints failed', () => store.list());
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsToggle,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return store.toggle(payload);
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsAdd,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return store.add(payload);
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsRemove,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return store.remove(payload);
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsSetEnabled,
      (event, payload) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return store.setAllEnabled(payload);
      }
    ],
    [
      DEBUG_CHANNELS.breakpointsRemoveAll,
      (event) => {
        if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
        return store.removeAll();
      }
    ]
  ];

  for (const [channel, listener] of listeners) {
    ipcMain.handle(channel, listener as (...args: unknown[]) => unknown);
  }

  registered = {
    dispose() {
      unsubscribeSession();
      unsubscribeBreakpoints();
      registeredWorkspaceClear = null;
      session.dispose();
      store.dispose();
      for (const [channel] of listeners) ipcMain.removeHandler(channel);
      registered = null;
    }
  };
  return registered;
}
