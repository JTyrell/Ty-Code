/**
 * Renderer context sources (Prompt 5).
 *
 * The command registry decides whether a row is enabled from a bag of boolean
 * contexts, and every key in that bag has to come from somewhere honest. This
 * module is that "somewhere" for the keys only a window can observe: which tab
 * is open, whether text is selected, whether the cursor history can still go
 * back, whether the active language has a symbol provider, whether a task is
 * running.
 *
 * It exists as its own module rather than living inside
 * {@link ./command-runtime} for one reason: `command-runtime` must not import
 * this file. App installs the sources first and the runtime second, so the
 * dependency only ever points one way and neither module loads the other
 * half-initialised.
 *
 * Three rules hold throughout:
 *
 *  - **One owner per key.** `editorOpen` is reported here by the workspace
 *    store and nowhere else — in particular the editor service does not also
 *    claim it. Two contributors reporting one key makes the runtime warn and,
 *    worse, makes the winner depend on Set iteration order.
 *  - **Fail closed.** A key with no real source in this build is simply not
 *    contributed, so it resolves to `false` through `emptyContext()` and its
 *    row greys out with the registry's own `disabledReason`. The debug keys are
 *    deliberately absent until their services land: Run's Stop greys with "No
 *    debug session is running." rather than firing into nothing. A window with
 *    no desktop bridge fails closed the same way — the task reads below return
 *    nothing and `tasksRunning` stays false, so Terminal's G3 group greys out
 *    instead of throwing during install.
 *  - **Never publish a lie about a diff.** `diffOrScmChangesOpen` is driven by a
 *    real hunk count — the diff editor registered with the editor service, or
 *    the source-control overlay's own git hunks — not by "a diff panel is
 *    mounted". A diff of two identical files has nothing for Alt+F3 to walk, so
 *    it stays greyed.
 */

import type {
  CommandContext,
  CommandMenuId,
  DynamicSubmenuItem,
  DynamicSubmenuSource,
  RunningTask,
  TaskListResult
} from '../../../preload/types';
import {
  MONACO_BUILTIN_SYMBOL_LANGUAGES,
  getEditorServiceState,
  hasActiveSymbolProvider,
  listEditorGroups,
  setSymbolProviderResolver,
  subscribeEditorService
} from '../services/editor-service';
import { LSP_PROVIDER_LANGUAGES } from '../services/monaco-lsp-adapter';
import { scmDiffHunkCount, subscribeScmDiffNavigation } from '../services/scm-diff-navigation';
import { useLspStore } from '../state/lsp-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { useCommandRuntimeStore } from '../state/command-runtime-store';
import {
  baseName,
  noDiscoveredTasksSentence,
  requireBridgeMethod,
  unwrap
} from './command-ipc';
import {
  refreshCommandContexts,
  registerContextContributor,
  type CommandRuntimeDisposable
} from './command-runtime';

// ---------------------------------------------------------------------------
// Symbol providers
// ---------------------------------------------------------------------------

/**
 * The LSP adapter registers providers under the *server's* language id, which
 * is not always the id a tab carries: Monaco calls JavaScript files
 * `javascript` while the TypeScript server answers for both, and `c` files are
 * served by the C++ server. `EditorArea`'s status pill applies the same mapping,
 * so without it here TypeScript and C files would grey out Go's G4 group while
 * a server that could answer was in fact running.
 */
const LSP_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  javascript: 'typescript',
  c: 'cpp'
};

/**
 * Copied into a Set because `LSP_PROVIDER_LANGUAGES` is an `as const` tuple,
 * and `Array#includes` on a tuple refuses a plain `string` argument.
 */
const LSP_SYMBOL_LANGUAGES: ReadonlySet<string> = new Set<string>(LSP_PROVIDER_LANGUAGES);

/**
 * Does this language have something that can answer "go to definition"?
 *
 * Registered is not the same as live. The adapter registers a provider for all
 * eight languages regardless of whether its server ever started, and that
 * provider proxies to IPC which returns nothing when the server is down — so a
 * naive `LSP_SYMBOL_LANGUAGES.has(id)` would enable F12 for a Python file with
 * no pyright installed and produce a dead click. Only a *running* server counts.
 */
function resolveSymbolProvider(languageId: string): boolean {
  if (MONACO_BUILTIN_SYMBOL_LANGUAGES.has(languageId)) return true;
  if (!LSP_SYMBOL_LANGUAGES.has(languageId)) return false;
  const serverLanguageId = LSP_LANGUAGE_ALIASES[languageId] ?? languageId;
  return useLspStore
    .getState()
    .servers.some((server) => server.languageId === serverLanguageId && server.status === 'running');
}

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

/**
 * Tabs and dirty state. The workspace store owns these because it is what
 * survives an editor unmount: a tab can be open while no Monaco instance is
 * mounted yet, and `editorOpen` has to be true in that window of time or Save
 * greys out mid-load.
 */
function workspaceContexts(): Partial<CommandContext> {
  const { activeTabPath, openTabs } = useWorkspaceStore.getState();
  return {
    editorOpen: activeTabPath !== null,
    // Go G2's Switch Editor lists every tab, so it needs "any tab at all",
    // not "an editor is mounted".
    hasOpenTabs: openTabs.length > 0,
    dirtyEditor: openTabs.some((tab) => tab.isDirty)
  };
}

/** Diagnostics, for Go G6's problem navigation. */
function lspContexts(): Partial<CommandContext> {
  const { diagnostics } = useLspStore.getState();
  let problemsExist = false;
  for (const filePath of Object.keys(diagnostics)) {
    if ((diagnostics[filePath]?.diagnostics.length ?? 0) > 0) {
      problemsExist = true;
      break;
    }
  }
  return { problemsExist };
}

/**
 * Live editor state. Everything here comes from the editor service snapshot,
 * which only ever reports what a registered Monaco instance actually said —
 * plus the source-control overlay's hunk count, which is the one diff the
 * editor service never sees.
 */
function editorContexts(): Partial<CommandContext> {
  const snapshot = getEditorServiceState();
  return {
    selectionActive: snapshot.selectionActive,
    hasSymbolProvider: hasActiveSymbolProvider(),
    historyCanGoBack: snapshot.historyCanGoBack,
    historyCanGoForward: snapshot.historyCanGoForward,
    // Go G7 walks whichever diff is open: the workspace-edit review's diff
    // editor, registered with the editor service, or the source-control
    // overlay's git hunks. Both are real counts, so a diff with nothing to walk
    // still greys out with the registry's own reason instead of firing a step
    // that cannot move.
    diffOrScmChangesOpen: snapshot.diffChangeCount > 0 || scmDiffHunkCount() > 0
  };
}

// ---------------------------------------------------------------------------
// Dynamic submenus
// ---------------------------------------------------------------------------

function sameArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function sameItems(next: DynamicSubmenuItem[], previous: DynamicSubmenuItem[] | undefined): boolean {
  if (!previous || next.length !== previous.length) return false;
  return next.every((item, index) => {
    const other = previous[index];
    return (
      item.id === other.id &&
      item.label === other.label &&
      item.detail === other.detail &&
      item.command === other.command &&
      item.target === other.target &&
      item.enabled === other.enabled &&
      item.disabledReason === other.disabledReason &&
      sameArgs(item.args, other.args)
    );
  });
}

const lastPublished: Partial<Record<DynamicSubmenuSource, DynamicSubmenuItem[]>> = {};

/**
 * Write a submenu's rows only when they really changed.
 *
 * `setDynamicSubmenu` stores the array by reference and zustand compares by
 * reference, so rebuilding an equal list on every keystroke would re-render the
 * menu bar continuously. The workspace store fires per character typed; this
 * guard is what keeps that from reaching React.
 */
function publishItems(source: DynamicSubmenuSource, items: DynamicSubmenuItem[]): void {
  if (sameItems(items, lastPublished[source])) return;
  lastPublished[source] = items;
  useCommandRuntimeStore.getState().setDynamicSubmenu(source, items);
}

function openEditorItems(): DynamicSubmenuItem[] {
  const { openTabs, activeTabPath } = useWorkspaceStore.getState();
  return openTabs.map((tab) => ({
    id: `openEditors:${tab.path}`,
    label: tab.name,
    detail: tab.path,
    command: 'editor.switchEditor',
    target: 'renderer' as const,
    args: { path: tab.path },
    // The active tab is listed rather than omitted, so the submenu always
    // accounts for every open file — but greyed with a reason, because
    // switching to where you already are is not an action.
    enabled: tab.path !== activeTabPath,
    disabledReason: tab.path === activeTabPath ? 'This editor is already active.' : undefined
  }));
}

function groupLabel(groupId: string, index: number): string {
  if (groupId === 'primary') return 'Primary Editor';
  if (groupId === 'secondary') return 'Split Editor';
  return `Editor Group ${index + 1}`;
}

function editorGroupItems(): DynamicSubmenuItem[] {
  const snapshot = getEditorServiceState();
  return listEditorGroups().map((groupId, index) => ({
    id: `editorGroups:${groupId}`,
    label: groupLabel(groupId, index),
    detail: groupId === snapshot.activeGroupId ? 'Active' : undefined,
    command: 'editor.switchGroup',
    target: 'renderer' as const,
    args: { groupId },
    enabled: true
  }));
}

function publishEditorSubmenus(): void {
  publishItems('openEditors', openEditorItems());
  publishItems('editorGroups', editorGroupItems());
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Main's two task snapshots, mirrored here so a contributor can read them
 * synchronously.
 *
 * `refreshCommandContexts()` walks its contributors with no `await` anywhere,
 * and the only source for either list is an IPC round-trip, so the honest shape
 * is a cache — updated by main's push, primed by a read on install — rather than
 * a contributor that returns a promise nobody awaits. The two lists are not
 * symmetric: `runningTasks` arrives whole on every `tasks:changed`, while
 * discovery only answers when asked, which is why one of them has a refresh path
 * and the other does not.
 */
let runningTasks: RunningTask[] = [];
let discoveredTasks: TaskListResult = { tasks: [], source: 'none' };

/**
 * Whether anything is running, which is what enables the Terminal menu's three
 * G3 rows.
 *
 * Main owns exactly four context keys — `devToolsAllowed`, `updatersAvailable`,
 * `workspaceOpen`, `configurationsExist` — and `tasksRunning` is not among them,
 * so this contributor's answer survives the merge instead of being overwritten
 * by main's snapshot arriving last.
 *
 * `hasRunningTasks` is deliberately left unreported. Both keys are declared in
 * `COMMAND_CONTEXT_KEYS`, no registry entry gates on the second, and two names
 * for one fact is how a menu starts disagreeing with itself about whether a task
 * is running.
 */
function taskContexts(): Partial<CommandContext> {
  return { tasksRunning: runningTasks.length > 0 };
}

/** Read main's running list, or `null` when this window has no way to ask. */
async function readRunningTasks(): Promise<RunningTask[] | null> {
  const what = 'Reading the running tasks';
  try {
    const taskRunning = requireBridgeMethod('taskRunning', what);
    return unwrap(await taskRunning(), what);
  } catch (error) {
    console.warn('[command-contexts] the running-task snapshot is unavailable', error);
    return null;
  }
}

/** Read main's discovery, or `null` when this window has no way to ask. */
async function readDiscoveredTasks(): Promise<TaskListResult | null> {
  const what = 'Reading the task list';
  try {
    const taskList = requireBridgeMethod('taskList', what);
    return unwrap(await taskList(), what);
  } catch (error) {
    console.warn('[command-contexts] task discovery is unavailable', error);
    return null;
  }
}

/**
 * One running-task list, addressed three ways.
 *
 * Show, Restart and Terminate see the same runs and differ only in the command
 * they fire and in what names the target: Show addresses a *terminal*, because
 * revealing a pane is the drawer's business, while Restart and Terminate address
 * a *run*, because that is what main can interrupt. `RunningTaskSchema` supplies
 * the reason a row id is `runId`-keyed rather than label-keyed — "restarting the
 * same task produces a distinct row" — so two runs of one label stay two rows
 * instead of colliding into one.
 */
function runningTaskItems(
  source: DynamicSubmenuSource,
  command: string,
  argOf: (run: RunningTask) => Record<string, unknown>
): DynamicSubmenuItem[] {
  return runningTasks.map((run) => ({
    id: `${source}:${run.runId}`,
    label: run.definition.label,
    // `DynamicSubmenuItemSchema`'s own example for `detail` is "a task's command
    // line", and that is exactly what tells two runs of one label apart. An
    // elapsed time was considered and rejected: it would be computed here and
    // then freeze while the menu stays open, which is a small lie.
    detail: run.definition.command,
    command,
    target: 'renderer' as const,
    args: argOf(run),
    enabled: true
  }));
}

function publishRunningTaskSubmenus(): void {
  publishItems(
    'runningTasks',
    runningTaskItems('runningTasks', 'task.showRunning', (run) => ({ terminalId: run.terminalId }))
  );
  publishItems(
    'runningTasksRestart',
    runningTaskItems('runningTasksRestart', 'task.restartRunning', (run) => ({ runId: run.runId }))
  );
  publishItems(
    'runningTasksTerminate',
    runningTaskItems('runningTasksTerminate', 'task.terminate', (run) => ({ runId: run.runId }))
  );
}

/**
 * The Run Task… rows — the one list that has to survive being empty.
 *
 * The three running lists may be empty because their parents gate on
 * `tasksRunning`, so a greyed parent never discloses them. Run Task… has no such
 * gate, and `resolveRow` defaults an unpublished source to `[]` while still
 * painting the parent enabled with its chevron: an empty list would open a popup
 * with nothing in it, which is a dead click wearing a disclosure arrow — the one
 * thing the whole registry exists to prevent. A single greyed row carrying the
 * reason keeps the popup honest, since `CommandMenuBar` renders a dynamic row's
 * `disabledReason` as its tooltip and refuses its click.
 */
function availableTaskItems(): DynamicSubmenuItem[] {
  const list = discoveredTasks;
  if (list.tasks.length === 0) {
    return [
      {
        id: 'availableTasks:none',
        label: 'No tasks to run',
        // Naming the file is more useful than the generic case, and discovery
        // reports `sourcePath` for exactly the states worth naming — a
        // `tasks.json` that failed to parse, or the `package.json` it fell back
        // to and found no scripts in.
        detail: list.sourcePath ? baseName(list.sourcePath) : undefined,
        command: 'task.runPicker',
        target: 'renderer' as const,
        args: {},
        enabled: false,
        disabledReason: noDiscoveredTasksSentence(list)
      }
    ];
  }
  return list.tasks.map((task) => ({
    id: `availableTasks:${task.id}`,
    label: task.label,
    detail: task.command,
    command: 'task.runPicker',
    target: 'renderer' as const,
    args: { taskId: task.id },
    enabled: true
  }));
}

/** Take main's push and repaint everything derived from it. */
function applyRunningTasks(runs: RunningTask[]): void {
  runningTasks = runs;
  publishRunningTaskSubmenus();
  // `tasksRunning` is the one key here that no store subscription covers, so
  // the push has to ask for the re-evaluation itself.
  refreshCommandContexts();
}

function applyDiscoveredTasks(list: TaskListResult): void {
  discoveredTasks = list;
  publishItems('availableTasks', availableTaskItems());
}

/**
 * Re-read both snapshots from main.
 *
 * Discovery is why this exists at all. The running list is pushed, so it is
 * already current by the time a menu opens; discovery is not, so a `tasks.json`
 * written after boot — including by Configure Tasks… itself — would leave Run
 * Task… listing the previous world until the window reloaded. A read that finds
 * nothing changed costs one comparison, because `publishItems` drops an equal
 * list, so calling this on every menu open does not repaint an open popup.
 */
async function refreshTaskSnapshots(): Promise<void> {
  const running = await readRunningTasks();
  if (running) applyRunningTasks(running);
  const list = await readDiscoveredTasks();
  if (list) applyDiscoveredTasks(list);
}

/**
 * Main's push subscription, or `null` when this window has no bridge.
 *
 * `null` rather than a throw, so that installing in a renderer unit test or in a
 * frame without the preload leaves the task rows greyed — the fail-closed
 * outcome — with nothing to tear down on the way out.
 */
function subscribeTaskChanges(): (() => void) | null {
  const what = 'Watching running tasks';
  try {
    const onTasksChanged = requireBridgeMethod('onTasksChanged', what);
    return onTasksChanged((runs) => applyRunningTasks(runs));
  } catch (error) {
    console.warn('[command-contexts] this window has no task-change feed', error);
    return null;
  }
}

/**
 * A menu just opened.
 *
 * Called by `CommandMenuBar` from the effect that installs its click-outside
 * and Escape listeners, which runs exactly once per open and covers all three
 * ways a menu opens — a click, a hover while one is already open, and ArrowDown
 * on a focused button — without any of them having to know this exists. Only
 * the Terminal menu has anything to ask main about; every other menu's rows come
 * from stores this module already observes.
 */
export function notifyCommandMenuOpened(menu: CommandMenuId): void {
  if (menu !== 'Terminal') return;
  void refreshTaskSnapshots();
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Start observing every store a command context depends on.
 *
 * Call this from App **before** `installCommandRuntime()`: the runtime reads
 * the contributor set when it resolves menus, and installing sources first
 * means the very first paint already knows whether an editor is open instead of
 * greying everything out and then flickering it back on.
 *
 * The returned disposable unwinds all of it — contributors, the symbol-provider
 * resolver and every store subscription — so a popout window can tear its
 * sources down without leaking a listener into a store that outlives it.
 */
export function installCommandContextSources(): CommandRuntimeDisposable {
  const teardowns: Array<() => void> = [];

  const workspaceRegistration = registerContextContributor(workspaceContexts);
  teardowns.push(() => workspaceRegistration.dispose());

  const lspRegistration = registerContextContributor(lspContexts);
  teardowns.push(() => lspRegistration.dispose());

  const editorRegistration = registerContextContributor(editorContexts);
  teardowns.push(() => editorRegistration.dispose());

  const taskRegistration = registerContextContributor(taskContexts);
  teardowns.push(() => taskRegistration.dispose());

  // Disposing restores the conservative default resolver, so an uninstalled
  // window claims only Monaco's own TypeScript worker again.
  const resolver = setSymbolProviderResolver(resolveSymbolProvider);
  teardowns.push(() => resolver.dispose());

  // zustand's plain `subscribe` fires on every `set`, and the editor service
  // fires on every cursor move. Both paths end in `refreshCommandContexts()`,
  // which drops the write when the collected contexts are unchanged, so the
  // cost of observing coarsely is a comparison rather than a re-render.
  //
  // Observing the LSP store is what keeps `hasSymbolProvider` honest over time:
  // server status arrives asynchronously, so a language whose server starts ten
  // seconds after boot has to re-enable Go's G4 group without a reload.
  const refresh = (): void => {
    refreshCommandContexts();
    publishEditorSubmenus();
  };
  teardowns.push(useWorkspaceStore.subscribe(refresh));
  teardowns.push(useLspStore.subscribe(refresh));
  teardowns.push(subscribeEditorService(refresh));
  // The source-control overlay publishes its hunk stepper when a git diff opens
  // and withdraws it when the overlay closes, and its hunks arrive in a second
  // store write after the diff itself. Observing the navigator rather than the
  // git store is what keeps `diffOrScmChangesOpen` aligned with the hunks
  // Alt+F3 can actually walk, instead of with a panel merely being mounted.
  teardowns.push(subscribeScmDiffNavigation(refresh));

  // The task surface has no store to observe: main owns both lists and pushes
  // one of them. The subscription is what turns Terminal's G3 group on while a
  // task runs and off the moment it ends, and the priming read is what stops the
  // first paint from greying G3 out in a window that reloaded mid-task.
  const taskFeed = subscribeTaskChanges();
  if (taskFeed) teardowns.push(taskFeed);

  refresh();
  void refreshTaskSnapshots();

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      while (teardowns.length > 0) {
        const teardown = teardowns.pop();
        try {
          teardown?.();
        } catch (error) {
          console.warn('[command-contexts] a context source failed to unwind', error);
        }
      }
      // Withdraw the rows this module published. Leaving them behind would let
      // a disposed window's menu still offer tabs that no longer exist, or runs
      // it can no longer show, restart or terminate.
      publishItems('openEditors', []);
      publishItems('editorGroups', []);
      publishItems('availableTasks', []);
      publishItems('runningTasks', []);
      publishItems('runningTasksRestart', []);
      publishItems('runningTasksTerminate', []);
      refreshCommandContexts();
    }
  };
}
