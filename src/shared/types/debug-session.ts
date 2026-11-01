import { z } from 'zod';

/**
 * Request, result and push contracts for the Run menu's debug system
 * (Prompt 5b Step 3).
 *
 * The registry has carried eighteen `run.*` rows against `debug.*` commands since
 * Prompt 5, and every one of them has stayed hidden because there was no handler
 * to register — a row whose handler does not exist is skipped by the executor
 * exactly as its menu row is hidden. This contract is what lets those rows exist
 * in truth: a debug session that spawns a real process under `--inspect`, speaks
 * the Chrome DevTools Protocol over it, and can genuinely stop on a breakpoint.
 *
 * Four properties shape the shapes below.
 *
 *  - **`status` is what the menus gate on, so it may only hold states something
 *    observed.** `starting` is distinct from `running` because a session between
 *    spawn and `Debugger.enable` cannot accept a stepping command yet, and
 *    `failed` is distinct from `inactive` because the user pressed Start Debugging
 *    and deserves to be told the attempt happened and why it did not land.
 *  - **`pausedLocation.lineNumber` is 1-based.** The protocol numbers lines from
 *    zero and Monaco numbers them from one. Converting at the boundary — inside
 *    the service, which is the only party that has seen the protocol — is what
 *    keeps a renderer from rendering a line that is one above the pause. Every
 *    line crossing this contract in either direction is 1-based.
 *  - **`verified` on a breakpoint is the runtime's answer, not ours.** A dot in
 *    the gutter that the engine never accepted is the failure mode this whole
 *    feature exists to avoid, so the field is optional and unset means "no session
 *    has reported on it", which is a different claim from `false`.
 *  - **The launch configuration lives under `.ty-code`, and one module names the
 *    path.** `command-main-adapters.ts` answers `configurationsExist` from it and
 *    the session service reads configurations from it. Two literals would agree
 *    until one moved, and the failure would be a greyed-out Open Configurations…
 *    row beside a file the user can see.
 */

/**
 * IPC channel names, shared for the reason `TASK_CHANNELS` is: preload needs the
 * identical strings and must not import from `src/main`.
 */
export const DEBUG_CHANNELS = {
  session: 'debug:session',
  start: 'debug:start',
  stop: 'debug:stop',
  restart: 'debug:restart',
  pause: 'debug:pause',
  resume: 'debug:resume',
  stepOver: 'debug:stepOver',
  stepInto: 'debug:stepInto',
  stepOut: 'debug:stepOut',
  configurations: 'debug:configurations',
  addConfiguration: 'debug:add-configuration',
  /** Main → renderer push. Carries the whole session, never a delta. */
  sessionChanged: 'debug:session-changed',
  breakpointsList: 'breakpoints:list',
  breakpointsToggle: 'breakpoints:toggle',
  breakpointsAdd: 'breakpoints:add',
  breakpointsRemove: 'breakpoints:remove',
  breakpointsSetEnabled: 'breakpoints:set-enabled',
  breakpointsRemoveAll: 'breakpoints:remove-all',
  /** Main → renderer push. Carries the whole list, for the same reason as above. */
  breakpointsChanged: 'breakpoints:changed'
} as const;

/** Where the workspace keeps its debug launch configuration. */
export const LAUNCH_DIR_NAME = '.ty-code';
export const LAUNCH_FILE_NAME = 'launch.json';

/**
 * What a session is doing.
 *
 * `exited` is separate from `stopped`: the program ran to completion, which the
 * Stop row must not claim credit for, and it is the state that turns Start
 * Debugging back on. `failed` keeps the entry and the reason attached so the
 * panel can say what was attempted.
 */
export const DEBUG_SESSION_STATUSES = ['inactive', 'starting', 'running', 'paused', 'exited', 'failed'] as const;

export const DebugSessionStatusSchema = z.enum(DEBUG_SESSION_STATUSES);
export type DebugSessionStatus = z.infer<typeof DebugSessionStatusSchema>;

/**
 * Where execution stopped, in the coordinates the editor speaks.
 *
 * `filePath` is resolved rather than the protocol's `url`, because the protocol's
 * top frame frequently reports an empty url for a script reached through a
 * wrapper — measured while building this — and a pause the UI cannot locate is a
 * pause the user cannot use.
 */
export const DebugPausedLocationSchema = z.object({
  filePath: z.string().min(1).max(4096),
  lineNumber: z.number().int().min(1),
  functionName: z.string().max(200).optional()
});

export type DebugPausedLocation = z.infer<typeof DebugPausedLocationSchema>;

export const DebugSessionSchema = z.object({
  status: DebugSessionStatusSchema,
  /** Name of the launch configuration in play, when one was used. */
  configurationLabel: z.string().min(1).max(200).optional(),
  /** Absolute path of the entry file the child process was given. */
  entryPath: z.string().min(1).max(4096).optional(),
  pid: z.number().int().optional(),
  /** The DevTools address the session connected to, kept so a failure is diagnosable. */
  debuggerUrl: z.string().min(1).max(400).optional(),
  startedAt: z.number().optional(),
  /** Set only while `status === 'paused'`. */
  pausedReason: z.string().min(1).max(120).optional(),
  pausedLocation: DebugPausedLocationSchema.optional(),
  /**
   * Why the session ended or never started, phrased for the user rather than the
   * log. Present on `failed` and usually on `exited` with a non-zero code.
   */
  error: z.string().min(1).max(600).optional(),
  exitCode: z.number().int().optional()
});

export type DebugSession = z.infer<typeof DebugSessionSchema>;

/** The session every window mirrors, and the two context keys are derived from. */
export const isSessionActive = (status: DebugSessionStatus): boolean =>
  status === 'starting' || status === 'running' || status === 'paused';

/**
 * What Start Debugging was asked to run.
 *
 * `configuration` names a launch.json entry; `entryPath` is a single file the
 * renderer resolved from the active editor. Both optional because the service
 * falls back to the workspace's sole configuration, or to nothing — and answers
 * with a sentence rather than guessing at a program to run.
 *
 * `stopOnEntry` defaults to false deliberately. Node's `--inspect-brk` breaks
 * before any client has enabled the Debugger domain, so the pause is emitted into
 * a session that cannot receive it and the target is left frozen at a line the UI
 * believes it is running. Breaking on entry therefore has to be requested, and is
 * implemented by pausing the running target instead of by holding it at entry.
 */
export const DebugStartRequestSchema = z.object({
  configuration: z.string().min(1).max(200).optional(),
  entryPath: z.string().min(1).max(4096).optional(),
  stopOnEntry: z.boolean().optional(),
  /**
   * Run Without Debugging.
   *
   * A field on this request rather than a separate command the renderer builds,
   * because the renderer would then have to assemble a *shell* command line for a
   * program whose arguments launch.json spelled as a list — and a shell rewrites
   * quoting and globbing. Main spawns the same argv it would have debugged, minus
   * the inspector flag.
   */
  noDebug: z.boolean().optional()
});

export type DebugStartRequest = z.infer<typeof DebugStartRequestSchema>;

/** One `configurations[]` entry from `.ty-code/launch.json`. */
export const DebugConfigurationSchema = z.object({
  label: z.string().min(1).max(200),
  /** Entry file, relative to the workspace root or absolute. */
  program: z.string().min(1).max(4096),
  cwd: z.string().min(1).max(4096).optional(),
  args: z.array(z.string().max(500)).max(64).optional(),
  stopOnEntry: z.boolean().optional()
});

export type DebugConfiguration = z.infer<typeof DebugConfigurationSchema>;

/**
 * What launch-configuration reading produced.
 *
 * Shaped exactly like `TaskListResult` for one reason: a launch.json the user can
 * see and the service cannot parse is a note to deliver, not a menu to blank out.
 * `error` sits beside whatever else was readable.
 */
export const DebugConfigurationListSchema = z.object({
  configurations: z.array(DebugConfigurationSchema).max(100),
  sourcePath: z.string().min(1).max(4096).optional(),
  /** Present when the file existed but could not be read, or held unusable entries. */
  error: z.string().min(1).max(400).optional()
});

export type DebugConfigurationList = z.infer<typeof DebugConfigurationListSchema>;

/**
 * A line execution should stop at.
 *
 * `id` is `filePath:lineNumber` rather than random, so toggling the same line from
 * two windows converges on one breakpoint instead of stacking two on the same
 * line — which the runtime would happily accept as two and report as one hit.
 */
export const BreakpointSchema = z.object({
  id: z.string().min(1).max(130),
  filePath: z.string().min(1).max(4096),
  /** 1-based, matching the editor gutter. */
  lineNumber: z.number().int().min(1).max(1_000_000),
  enabled: z.boolean(),
  /** Expression evaluated by the runtime; the break is skipped when it is false. */
  condition: z.string().min(1).max(500).optional(),
  /**
   * Template printed in place of stopping. Mutually exclusive with `condition` at
   * the request edge: a logpoint does not pause, so it cannot also be a break that
   * sometimes pauses.
   */
  logMessage: z.string().min(1).max(500).optional(),
  /**
   * The runtime's own answer. Absent means no session has ever reported on it.
   */
  verified: z.boolean().optional(),
  /**
   * Why the runtime refused to bind this breakpoint, carried on the record it
   * belongs to. A dim dot the user cannot explain reads as a broken gutter, and a
   * side table keyed by id is a second source of truth about the same refusal.
   */
  note: z.string().min(1).max(400).optional()
});

export type Breakpoint = z.infer<typeof BreakpointSchema>;

export const BreakpointToggleRequestSchema = z.object({
  filePath: z.string().min(1).max(4096),
  lineNumber: z.number().int().min(1).max(1_000_000)
});

export type BreakpointToggleRequest = z.infer<typeof BreakpointToggleRequestSchema>;

/**
 * The three gutter kinds the Run menu offers.
 *
 * `kind` rather than two optional fields, so the service can reject the
 * contradictory request — a conditional logpoint — instead of silently dropping
 * one half of it.
 */
export const BREAKPOINT_KINDS = ['unconditional', 'conditional', 'logpoint'] as const;

export const NewBreakpointRequestSchema = z.object({
  filePath: z.string().min(1).max(4096),
  lineNumber: z.number().int().min(1).max(1_000_000),
  kind: z.enum(BREAKPOINT_KINDS),
  condition: z.string().min(1).max(500).optional(),
  logMessage: z.string().min(1).max(500).optional()
});

export type NewBreakpointRequest = z.infer<typeof NewBreakpointRequestSchema>;

export const BreakpointsEnabledRequestSchema = z.object({
  enabled: z.boolean()
});

export type BreakpointsEnabledRequest = z.infer<typeof BreakpointsEnabledRequestSchema>;

export const BreakpointIdRequestSchema = z.object({
  id: z.string().min(1).max(130)
});

export type BreakpointIdRequest = z.infer<typeof BreakpointIdRequestSchema>;

/**
 * How many breakpoints one workspace may hold.
 *
 * The runtime accepts an unbounded number, so this is a guard against a scripted
 * loop or a paste of a very large list turning every paused frame into a long
 * round trip — not a limit anyone reaches by clicking in a gutter.
 */
export const MAX_TRACKED_BREAKPOINTS = 500;

/**
 * The launch configuration created when a workspace has none and the user asked
 * for one.
 *
 * Lives in the shared contract for the same reason the path constants do: the
 * renderer writes it, the service reads it, and a divergence between the two is a
 * silent failure — Add Configuration… would produce a file that Start Debugging
 * still reports no configurations for.
 *
 * Two constraints shape it. It has to name a file that exists in a plain Node
 * workspace, so `index.js` at the root is the least presumptuous guess; and it
 * must not pretend to know a program the user has not named, which is why the
 * document it produces is one entry long and the entry says what it is.
 */
export const LAUNCH_SCAFFOLD = `{
  "version": "0.2.0",
  "configurations": [
    {
      "label": "Launch entry",
      "type": "node",
      "request": "launch",
      "program": "index.js",
      "stopOnEntry": false
    }
  ]
}
`;
