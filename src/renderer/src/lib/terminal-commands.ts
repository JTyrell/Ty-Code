/**
 * Terminal and task command handlers (Prompt 5b, Terminal menu G1–G4).
 *
 * The eleven renderer-target rows of the Terminal menu live here. The twelfth,
 * New Terminal Window, targets main and is registered in
 * `main/services/command-main-handlers.ts`.
 *
 * This module obeys the same two rules as {@link ./editor-commands}: a decline
 * is an answer rather than a silence, and args are narrowed rather than
 * assumed. Both are implemented once in {@link ./command-ipc} and reused here,
 * so the sentences below are about *what* is missing, never about how to check.
 *
 * Four decisions shape the handlers, and each is a departure from the obvious
 * reading of the spec, so each is recorded here rather than left to look like
 * an oversight.
 *
 *  - **Silent success where the effect is already on screen.** `reportOutcome()`
 *    has three visible branches and no informational one: a success with a
 *    summary is a green toast, a success without one is silent. New Terminal,
 *    Split Terminal, Show Running Task, Run Selected Text and Configure Tasks…
 *    each produce an immediate visible change — a panel opens, a pane appears,
 *    a tab comes forward, text is typed, a file opens — so a toast would only
 *    narrate what the user is already looking at. The run/restart/terminate
 *    handlers *do* return summaries, because the toast is the only thing that
 *    names which task was affected.
 *  - **Stale submenu rows are main's to answer for.** A `runningTasks*` submenu
 *    is painted from a push snapshot, and main drops a run the moment it
 *    finishes, so a row can outlive its task by a repaint. These handlers do
 *    not re-check: main already returns a precise sentence ("That task is no
 *    longer running, so there is nothing to restart. Use Run Task… to start it
 *    again."), and a renderer-side `taskRunning()` round-trip would race the
 *    same way while adding a second copy of the truth. `unwrap()` passes main's
 *    error through verbatim, which is the whole point of it.
 *  - **Configure Default Build Task… reports and opens; it does not persist.**
 *    Choosing a default means editing the file that decides it, and writing that
 *    edit from here would need either JSONC surgery on a file that may carry
 *    comments (main's reader strips them, so a JSON round-trip would destroy
 *    them) or a second renderer-side notion of "default" that could disagree
 *    with main's `isBuildDefault`. Opening the file and saying what the current
 *    default is does not lie, and it cannot corrupt anything.
 *  - **Run Active File refuses a dirty buffer.** The terminal runs the copy on
 *    disk, so running an unsaved file executes code the user is not looking at
 *    — silently, and during a demo that is indistinguishable from the runner
 *    being broken. Saving first would mutate a file from a menu click.
 *    Refusing with a sentence does neither.
 */

import type { CommandHandler } from '../../../main/services/command-executor';
import type {
  TaskDefinition,
  TaskListResult,
  TaskRunRequest,
  TaskRunResult
} from '../../../preload/types';
import { TASKS_DIR_NAME, TASKS_FILE_NAME, TASKS_SCAFFOLD } from '../../../shared/types/tasks';
import { getSelectedText } from '../services/editor-service';
import {
  createTerminal,
  hasTerminalController,
  openTerminalSplit,
  revealTerminalPane
} from '../services/terminal-controller';
import { useWorkspaceStore } from '../state/workspace-store';
import {
  NO_EDITOR_OPEN,
  assertOk,
  baseName,
  desktopBridge,
  noDiscoveredTasksSentence,
  openInTab,
  requireBridgeMethod,
  stringArg,
  unwrap
} from './command-ipc';
import { registerRendererCommands, type CommandRuntimeDisposable } from './command-runtime';

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * Shared by both G1 rows.
 *
 * The drawer lives in the main workbench, and a popout editor window renders the
 * same menu bar bound to its own context — so this is a real state, not a bug,
 * and it needs a sentence that says where to go rather than one that implies
 * the click was ignored.
 */
const NO_TERMINAL_SURFACE =
  'This window has no terminal panel. Terminals live in the main workbench window.';

// ---------------------------------------------------------------------------
// Paths and shell quoting
// ---------------------------------------------------------------------------

/**
 * Join a workspace-relative path using the separator the workspace already uses.
 *
 * The renderer cannot import Node's `path`. A hardcoded `/` would work — Node's
 * `fs` accepts either separator on Windows — but the resulting string is what
 * gets compared against `openTabs[].path` to prove the file landed, and a
 * mixed-separator path would never match a tab opened by any other route.
 */
function joinPath(root: string, ...segments: string[]): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

/**
 * Quote one argument for a shell.
 *
 * Deliberately not main's `quoteArg`, which is correct for `tasks.json` `args`
 * arrays and wrong for file paths: its safe-character class excludes `\` and its
 * escape doubles backslashes, so `C:\Users\me\app.js` would come back as
 * `"C:\\Users\\me\\app.js"` — and `\` is a literal character in both cmd.exe and
 * PowerShell, not an escape, so the path would no longer exist. Here `\` is safe
 * and `"` is doubled, which is how both Windows shells spell a literal quote,
 * and POSIX shells are never handed these strings because the runner commands
 * below are all single-token.
 */
function quoteForShell(value: string): string {
  if (value === '') return '""';
  if (/^[\w./\\:@+=,-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

/**
 * How to run a file, by extension.
 *
 * The Terminal-menu spec says "node/tsx for js/ts". `tsx` is not used, and that
 * is deliberate: neither `tsx` nor `ts-node` is a dependency of this project, so
 * `npx tsx` would reach out to the npm registry at the moment the user clicked —
 * a menu row that needs the network to run a local file, and one that hangs
 * rather than failing during an offline demo. Node's own type stripping is used
 * instead. The engines floor is Node 22.12, where stripping needs the
 * `--experimental-strip-types` flag; from Node 23.6 it is on by default and the
 * flag is still accepted, so one spelling covers both.
 *
 * Stripping is erasure-only, so a file using `enum` or `namespace` fails in the
 * terminal with Node's own explanation. That is a truthful outcome: the error is
 * visible, named, and about the user's file rather than about Ty-Code.
 */
const RUNNERS: Record<string, string> = {
  js: 'node',
  mjs: 'node',
  cjs: 'node',
  ts: 'node --experimental-strip-types',
  mts: 'node --experimental-strip-types',
  cts: 'node --experimental-strip-types',
  py: 'python'
};

/** Extensions that look runnable from a file list but are modules, not entry points. */
const COMPONENT_EXTENSIONS = new Set(['tsx', 'jsx']);

/** The lower-cased extension, or `''` when the name has none. */
function extensionOf(filePath: string): string {
  const name = baseName(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The command prefix that runs `filePath`, or a throw explaining why none does. */
function runnerFor(filePath: string): string {
  const extension = extensionOf(filePath);
  const runner = RUNNERS[extension];
  if (runner) return runner;
  const name = baseName(filePath);
  if (COMPONENT_EXTENSIONS.has(extension)) {
    throw new Error(
      `'${name}' is a component module rather than a script, so there is nothing for it to do on its own. Run the entry point that imports it.`
    );
  }
  if (!extension) {
    throw new Error(`'${name}' has no file extension, so Ty-Code cannot tell how to run it.`);
  }
  throw new Error(
    `Ty-Code has no runner for '.${extension}' files. Run Task… will run anything a tasks file declares, in any shell.`
  );
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/** The discoverable tasks, or a sentence explaining why the list is unavailable. */
async function listTasks(): Promise<TaskListResult> {
  const taskList = requireBridgeMethod('taskList', 'Reading the task list');
  return unwrap(await taskList(), 'Reading the task list');
}

/** Start one task. `request` names either a discovered id or a raw command. */
async function runTask(request: TaskRunRequest): Promise<TaskRunResult> {
  const taskRun = requireBridgeMethod('taskRun', 'Starting the task');
  return unwrap(await taskRun(request), 'Starting the task');
}

/**
 * Bring a task's terminal forward without failing the command if it cannot.
 *
 * Every caller has already started, restarted or revealed something real by the
 * time this runs, so a throw here would report failure for a success. The drawer
 * adopts PTY sessions on its own, which means this is usually redundant — it
 * exists for the case where the drawer is showing a different tab and the user
 * has no other way to know which one their task landed in.
 */
function revealQuietly(terminalId: string): void {
  try {
    revealTerminalPane(terminalId);
  } catch (error) {
    console.warn('[terminal-commands] revealing the task terminal failed', error);
  }
}

// ---------------------------------------------------------------------------
// G1 — terminals
// ---------------------------------------------------------------------------

/**
 * Spawn a shell and reveal the drawer.
 *
 * Silent on success: a terminal appearing is its own confirmation. The
 * controller check is separate from the result check because `createTerminal()`
 * returns false for both "no drawer" and "the spawn failed", and those deserve
 * different sentences — one sends the user to another window, the other to the
 * drawer's own error banner.
 */
const terminalNew: CommandHandler = async () => {
  if (!hasTerminalController()) throw new Error(NO_TERMINAL_SURFACE);
  if (!(await createTerminal())) {
    throw new Error(
      'The terminal did not open. The shell may have failed to start — the terminal panel shows its error.'
    );
  }
};

/**
 * Ensure a second pane is showing.
 *
 * Not a toggle, and `openSplit()` resolving true when a split already existed is
 * correct rather than sloppy: the drawer's own button toggles, and routing this
 * row through a toggle would leave Ctrl+Shift+5 pressed twice with one pane and
 * no explanation of where the second went.
 */
const terminalSplit: CommandHandler = async () => {
  if (!hasTerminalController()) throw new Error(NO_TERMINAL_SURFACE);
  if (!(await openTerminalSplit())) {
    throw new Error(
      'A second terminal pane did not open. The shell may have failed to start — the terminal panel shows its error.'
    );
  }
};

// ---------------------------------------------------------------------------
// G2 — running things
// ---------------------------------------------------------------------------

/**
 * Run one discovered task.
 *
 * Only ever reached from a row of the Run Task… submenu, which supplies
 * `args.taskId`; the parent entry's own `command` is what makes the row visible
 * at all, and clicking a parent opens its submenu rather than firing. A call
 * with no id — the command palette, say — is answered with a sentence pointing
 * at the submenu instead of guessing a task to run.
 */
const runPicker: CommandHandler = async (args) => {
  const taskId = args.taskId;
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('Pick a task from the Run Task… submenu; this command runs one named task.');
  }
  const result = await runTask({ taskId });
  revealQuietly(result.terminalId);
  return { summary: `Started ${result.label}.` };
};

/** Why there is no default build task, naming what the user can do instead. */
function noBuildDefaultSentence(list: TaskListResult): string {
  // The empty case is the Run Task… submenu's placeholder row verbatim, so the
  // sentence lives where both reach it rather than being written twice.
  if (list.tasks.length === 0) return noDiscoveredTasksSentence(list);
  const shown = list.tasks
    .slice(0, 3)
    .map((task) => `'${task.label}'`)
    .join(', ');
  const rest = list.tasks.length > 3 ? ` and ${list.tasks.length - 3} more` : '';
  return `No task is marked as the default build task. Run Task… lists what is available (${shown}${rest}).`;
}

/**
 * Run the task marked as the build default.
 *
 * Main promotes a lone build-group task when nothing carries `isDefault`, so
 * `isBuildDefault` on the discovered list is the honest answer to "what will
 * Ctrl+Shift+B run" — reading the file here to double-check would reimplement
 * that promotion rule in a second place and the two would drift.
 */
const runBuild: CommandHandler = async () => {
  const list = await listTasks();
  const build = list.tasks.find((task) => task.isBuildDefault);
  if (!build) throw new Error(noBuildDefaultSentence(list));
  const result = await runTask({ taskId: build.id });
  revealQuietly(result.terminalId);
  return { summary: `Started ${result.label}.` };
};

/**
 * Run the active file through an ad-hoc task rather than a bare terminal write.
 *
 * Ad-hoc is what makes the G3 rows apply: main tracks it exactly like a declared
 * task, so Show/Restart/Terminate Running Task… all see it, and it gets an exit
 * code from the sentinel instead of leaving the user to guess whether it worked.
 */
const runActiveFile: CommandHandler = async () => {
  const { activeTabPath, openTabs, workspacePath } = useWorkspaceStore.getState();
  if (!activeTabPath) throw new Error(NO_EDITOR_OPEN);
  const tab = openTabs.find((candidate) => candidate.path === activeTabPath);
  if (tab?.isDirty) {
    throw new Error(
      `'${tab.name}' has unsaved changes and the terminal runs the copy on disk. Save it first so you run what you are looking at.`
    );
  }
  const runner = runnerFor(activeTabPath);
  const result = await runTask({
    command: `${runner} ${quoteForShell(activeTabPath)}`,
    label: `Run ${baseName(activeTabPath)}`,
    cwd: workspacePath || undefined
  });
  revealQuietly(result.terminalId);
  return { summary: `Started ${result.label}.` };
};

/**
 * Type the selection into the active terminal and execute it.
 *
 * This one goes through `terminalRunCommand` rather than `runTask`, and that is
 * the point of the row: a selection is a fragment, not a task. Wrapping it as an
 * ad-hoc task would give it a label, a tracked run and an exit-code sentinel —
 * machinery for something the user expects to land in front of them like typed
 * input. `createIfMissing` means the row works with no terminal open, which is
 * the state it is most often clicked from.
 */
const runSelectedText: CommandHandler = async () => {
  const text = getSelectedText();
  if (!text.trim()) {
    throw new Error('Nothing is selected in the editor. Select the lines to run and try again.');
  }
  const terminalRunCommand = desktopBridge('Running the selection').terminalRunCommand;
  const dispatch = unwrap(
    await terminalRunCommand(text, { execute: true, createIfMissing: true }),
    'Running the selection'
  );
  if (!dispatch.dispatched) {
    throw new Error(dispatch.reason || 'The selection never reached a terminal.');
  }
};

// ---------------------------------------------------------------------------
// G3 — the running tasks
// ---------------------------------------------------------------------------

/**
 * Bring one running task's terminal to the front.
 *
 * `args.terminalId` comes from the `runningTasks` submenu publisher. The drawer
 * is the only thing that knows which tab owns a PTY, so a false return means the
 * tab was closed after the task started — said out loud rather than shrugged at,
 * because the alternative is a click that appears to do nothing.
 */
const showRunning: CommandHandler = (args) => {
  const terminalId = stringArg(args, 'terminalId');
  if (!revealTerminalPane(terminalId)) {
    throw new Error("That task's terminal is no longer open, so there is nothing to show.");
  }
};

/** Restart one running task, addressed by the `runId` its submenu row carries. */
const restartRunning: CommandHandler = async (args) => {
  const runId = stringArg(args, 'runId');
  const taskRestart = requireBridgeMethod('taskRestart', 'Restarting the task');
  const result = unwrap(await taskRestart({ runId }), 'Restarting the task');
  revealQuietly(result.terminalId);
  return { summary: `Restarted ${result.label}.` };
};

/**
 * Interrupt one running task.
 *
 * Main writes a bare Ctrl+C and drops the run immediately, so the row
 * disappears on the next push without waiting for the process to notice — the
 * summary names what was terminated because by the time it is read, the menu no
 * longer does.
 */
const terminateTask: CommandHandler = async (args) => {
  const runId = stringArg(args, 'runId');
  const taskTerminate = requireBridgeMethod('taskTerminate', 'Terminating the task');
  const run = unwrap(await taskTerminate({ runId }), 'Terminating the task');
  // `taskTerminate` hands back the whole run, not a run *result*, so the label is
  // one level down — the same shape the `runningTasks*` submenu publishers read.
  return { summary: `Terminated ${run.definition.label}.` };
};

// ---------------------------------------------------------------------------
// G4 — configuring
// ---------------------------------------------------------------------------

/**
 * Create `.vscode/tasks.json` and hand back the path that was written.
 *
 * The content is {@link TASKS_SCAFFOLD} from the shared contract rather than a
 * string declared here, because the party that has to accept it is main's task
 * discovery — living beside the schemas it must satisfy is what lets a test
 * prove the two still agree. The path is absolute and built from the renderer's
 * own workspace root rather than sent as a relative one, so that a disagreement
 * with main about which folder is open fails loudly at the containment check
 * instead of quietly writing into a different workspace. `writeFile` creates
 * missing parents, so `.vscode/` needs no separate call — and `createFile` is
 * the wrong primitive here anyway, because its exclusive-write flag turns
 * "already configured" into an error.
 */
async function scaffoldTasksFile(): Promise<string> {
  const { workspacePath } = useWorkspaceStore.getState();
  if (!workspacePath) {
    throw new Error(
      'Open a folder first. Tasks are configured per workspace, so there is nowhere to put the file yet.'
    );
  }
  const target = joinPath(workspacePath, TASKS_DIR_NAME, TASKS_FILE_NAME);
  const what = `Creating ${TASKS_FILE_NAME}`;
  const writeFile = desktopBridge(what).writeFile;
  assertOk(await writeFile(target, TASKS_SCAFFOLD), what);
  return target;
}

/**
 * Open the file that decides this workspace's tasks.
 *
 * `sourcePath` is set by discovery exactly when a config file exists —
 * `tasks.json` even if it failed to parse, else `package.json` — which makes it
 * the right discriminator and honours the spec's "tasks.json if present, else
 * package.json scripts". Opening a `package.json` that failed to parse is more
 * useful than scaffolding over it: the user's own file is the thing to fix.
 */
const configureTasks: CommandHandler = async () => {
  const list = await listTasks();
  await openInTab(list.sourcePath ?? (await scaffoldTasksFile()));
};

/** What Configure Default Build Task… reports on the way to opening the file. */
function defaultBuildSentence(current: TaskDefinition | undefined, list: TaskListResult): string {
  if (current) {
    return `The default build task is '${current.label}'. Mark another with "isDefault": true in its group to change it.`;
  }
  if (list.tasks.length === 0) {
    return 'No tasks are declared yet. Add one and mark its group with "isDefault": true to make it the build default.';
  }
  return 'No task is marked as the build default. Set "isDefault": true in one task\'s group and Run Build Task… will run it.';
}

/**
 * Report the current build default and open the file that decides it.
 *
 * The summary is the point: this is the one handler whose finding would be lost
 * without one, since opening a file shows the user *where* the answer lives but
 * not *what* it currently is.
 */
const configureDefaultBuild: CommandHandler = async () => {
  const list = await listTasks();
  const current = list.tasks.find((task) => task.isBuildDefault);
  await openInTab(list.sourcePath ?? (await scaffoldTasksFile()));
  return { summary: defaultBuildSentence(current, list) };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register every Terminal-menu command this window can perform.
 *
 * All eleven renderer-target keys, which is what makes their registry entries
 * paint at all: the resolver hides a row whose command has no handler, so an
 * omitted key would not be a dead click but an invisible menu item. `debug.*`
 * stays absent until the debug services land, and Run's rows stay hidden with it.
 */
export function registerTerminalCommandHandlers(): CommandRuntimeDisposable {
  return registerRendererCommands({
    'terminal.new': terminalNew,
    'terminal.split': terminalSplit,
    'task.runPicker': runPicker,
    'task.runBuild': runBuild,
    'task.runActiveFile': runActiveFile,
    'task.runSelectedText': runSelectedText,
    'task.showRunning': showRunning,
    'task.restartRunning': restartRunning,
    'task.terminate': terminateTask,
    'task.configure': configureTasks,
    'task.configureDefaultBuild': configureDefaultBuild
  });
}
