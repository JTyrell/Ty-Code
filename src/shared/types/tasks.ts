import { z } from 'zod';

/**
 * Request and result contracts for the Terminal menu's task system (Prompt 5b
 * Step 4).
 *
 * Ty-Code had a terminal and no tasks. `dispatchRunCommand` could write a
 * command into a PTY, but nothing could answer "what can I run?", "is anything
 * running?" or "when did that finish?" — so Terminal > Run Task… and the whole
 * of group G3 (`Show Running Tasks…`, `Restart Running Task…`, `Terminate
 * Task…`) had nothing to call and stayed hidden. Adding them means adding a
 * process boundary, and a new boundary gets a schema.
 *
 * Three properties matter here, and all three are the reason the shapes below
 * look the way they do.
 *
 *  - **Discovery is allowed to fail without failing the menu.** A `tasks.json`
 *    with a trailing comma is a user error, not a crash: `TaskListResult`
 *    carries an optional `error` alongside whatever it did manage to read, so
 *    the submenu can list the package.json scripts it found *and* tell the user
 *    why their tasks.json was skipped. An envelope-level `success: false` would
 *    hide both.
 *  - **A task is a command plus provenance, nothing else.** There is no
 *    `windows`/`osx`/`linux` override map, no `problemMatcher`, no
 *    `dependsOn`. VS Code's schema has all of them; honouring a subset while
 *    accepting the whole file would silently run the wrong command on the wrong
 *    platform, which is worse than refusing. Fields this build does not
 *    implement are dropped by `z.object` rather than parsed and ignored.
 *  - **`state` is a task fact, not a terminal fact.** A task ends when its
 *    completion sentinel appears in the output stream or its terminal exits —
 *    never merely because a PTY is still alive. `TaskState` therefore includes
 *    `terminated` as a distinct outcome from `failed`: the user pressed
 *    Terminate, and reporting that as a failure would be a lie about who
 *    stopped it.
 */

/**
 * IPC channel names.
 *
 * Declared here rather than in the main handler module for the same reason
 * `FILE_DIALOG_CHANNELS` lives in the shared contract: the preload bridge needs
 * the identical strings, and it must not import from `src/main` or it would
 * pull `ipcMain` into the sandboxed preload context.
 */
export const TASK_CHANNELS = {
  list: 'tasks:list',
  run: 'tasks:run',
  terminate: 'tasks:terminate',
  restart: 'tasks:restart',
  running: 'tasks:running',
  /** Main → renderer push. Carries the full running list, not a delta. */
  changed: 'tasks:changed'
} as const;

/**
 * Where a task definition came from.
 *
 * `ad-hoc` covers the rows the registry synthesises rather than reads from a
 * file — Run Active File and Run Selected Text — so a running task always has a
 * source to name in the UI even when no tasks.json exists.
 */
export const TASK_SOURCES = ['tasks.json', 'package.json', 'ad-hoc'] as const;

export const TaskSourceSchema = z.enum(TASK_SOURCES);

export type TaskSource = z.infer<typeof TaskSourceSchema>;

/** A runnable task, as discovered from the workspace or synthesised by a menu row. */
export const TaskDefinitionSchema = z.object({
  /**
   * Stable identity within a discovery pass: the tasks.json `label` or
   * `package:<script>` for an npm script. Namespaced so a script called
   * `build` cannot collide with a tasks.json task called `build`.
   */
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  /** The exact string written to the shell, before any sentinel wrapping. */
  command: z.string().min(1).max(2000),
  source: TaskSourceSchema,
  /** Absolute directory to run in. Omitted means the workspace root. */
  cwd: z.string().min(1).max(4096).optional(),
  /** Set from tasks.json's `"group": { "kind": "build", "isDefault": true }`. */
  isBuildDefault: z.boolean().optional()
});

export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

/**
 * What discovery produced.
 *
 * `source` names the file that won the precedence rule — `.vscode/tasks.json`
 * when it exists, `package.json` scripts otherwise, `none` when neither does.
 * It describes where `tasks` came from, not whether the list is empty: a
 * well-formed tasks.json with `"tasks": []` reports `source: 'tasks.json'` and
 * an empty list, which is a true statement rather than a missing file.
 */
export const TaskListResultSchema = z.object({
  tasks: z.array(TaskDefinitionSchema).max(500),
  source: z.enum(['tasks.json', 'package.json', 'none']),
  /** Absolute path of the file `source` names, when there is one. */
  sourcePath: z.string().min(1).max(4096).optional(),
  /**
   * What discovery could not honour, when it read the file but not all of it:
   * why tasks.json was skipped outright, which entries were dropped and why, or
   * that a command still contains a variable only the user's shell can expand.
   *
   * Deliberately a note rather than a failure — `tasks` next to it may still be
   * perfectly runnable, and an envelope-level `success: false` would hide both.
   */
  error: z.string().min(1).max(400).optional()
});

export type TaskListResult = z.infer<typeof TaskListResultSchema>;

export const TASK_STATES = ['running', 'succeeded', 'failed', 'terminated'] as const;

export const TaskStateSchema = z.enum(TASK_STATES);

export type TaskState = z.infer<typeof TaskStateSchema>;

/** A task run, tracked from dispatch until its sentinel or terminal exit. */
export const RunningTaskSchema = z.object({
  /** Unique per run, so restarting the same task produces a distinct row. */
  runId: z.string().min(1).max(80),
  definition: TaskDefinitionSchema,
  terminalId: z.string().min(1).max(80),
  startedAt: z.number(),
  state: TaskStateSchema,
  /** Present once the sentinel reported a code, or the terminal exited. */
  exitCode: z.number().int().optional()
});

export type RunningTask = z.infer<typeof RunningTaskSchema>;

/**
 * What to run.
 *
 * Either `taskId` (look it up in discovery) or an explicit `command`, never
 * both required: the two Run Task… sources differ. `taskId` covers the submenu
 * rows; `command` covers Run Active File and Run Selected Text, whose commands
 * are built in the renderer from the editor state and exist in no file. A
 * payload with neither is a validation failure rather than a silent no-op.
 */
export const TaskRunRequestSchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  command: z.string().min(1).max(2000).optional(),
  /** Display name for an ad-hoc command; defaults to a truncated command. */
  label: z.string().min(1).max(200).optional(),
  cwd: z.string().min(1).max(4096).optional()
});

export type TaskRunRequest = z.infer<typeof TaskRunRequestSchema>;

export const TaskRunResultSchema = z.object({
  runId: z.string().min(1).max(80),
  terminalId: z.string().min(1).max(80),
  label: z.string().min(1).max(200)
});

export type TaskRunResult = z.infer<typeof TaskRunResultSchema>;

/** Terminate and restart both address one run, so both take one field. */
export const TaskRunIdRequestSchema = z.object({
  runId: z.string().min(1).max(80)
});

export type TaskRunIdRequest = z.infer<typeof TaskRunIdRequestSchema>;

/**
 * How many runs a single `tasks:running` query returns.
 *
 * The registry's `runningTasks` submenu is the consumer, and it renders one row
 * per run. Runs are dropped from the list once they finish, so this bound is a
 * guard against an unbounded loop of self-restarting tasks rather than a limit
 * a user would hit by hand.
 */
export const MAX_TRACKED_TASK_RUNS = 50;

/**
 * Where task discovery looks, split so each side joins it with its own
 * separator.
 *
 * Main reads this path and the renderer's `task.configure` writes it. Two
 * literals in two processes would agree until the day one moved, and the
 * failure would be silent in the worst way: Configure Tasks… would create a
 * file that Run Task… never discovers, so the menu would keep reporting no
 * tasks after the user had just written some.
 */
export const TASKS_DIR_NAME = '.vscode';
export const TASKS_FILE_NAME = 'tasks.json';

/**
 * The file Configure Tasks… creates when a workspace declares no tasks.
 *
 * It lives in the shared contract rather than in the renderer handler that
 * writes it for the same reason {@link TASKS_DIR_NAME} does: two copies would
 * agree until the day one of them was prettified, and the failure is silent in
 * the worst way — Configure Tasks… would create a file that Run Task… still
 * reports as empty. Keeping the string here is what lets
 * `task-runner-service.test.ts` feed exactly what the renderer writes through
 * exactly what main reads, and fail the build if discovery stops accepting it.
 *
 * Three constraints shape it:
 *
 *  - Discovery keeps an entry only when it is a `shell` task with a non-empty
 *    `command`, or an `npm` task with a `script`. One `shell`/`echo` task is
 *    therefore the smallest scaffold that proves itself runnable.
 *  - `echo` behaves identically in cmd.exe, PowerShell, bash and zsh, so the
 *    scaffolded row runs on every platform rather than only on the machine that
 *    created it.
 *  - No comment, and no invented build task. A comment would make the reader
 *    repair a file on first impression, and telling a workspace with no build
 *    that it has one is a lie — Configure Default Build Task… explains how to
 *    mark one instead.
 */
export const TASKS_SCAFFOLD = `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "echo",
      "type": "shell",
      "command": "echo Ty-Code task runner is working",
      "problemMatcher": []
    }
  ]
}
`;
