/**
 * Shared plumbing for renderer command handlers (Prompt 5 / 5b).
 *
 * Three handler modules — {@link ./workbench-commands}, {@link ./editor-commands}
 * and {@link ./terminal-commands} — all cross the same two boundaries: the
 * preload bridge, and the registry's `z.record(z.string(), z.unknown())` args
 * bag. Each needs the same handful of narrowing helpers, and each helper
 * carries a load-bearing detail that would silently rot if it were written
 * three times:
 *
 *  - `unwrap()` refuses a `success: true` with no payload, because
 *    `IpcResponse` is not a discriminated union and that state is
 *    representable. A copy that omitted the check would hand `undefined` to a
 *    caller that then reports a path that does not exist.
 *  - `openInTab()` proves the tab landed rather than trusting `openFile`, which
 *    swallows its own read failures.
 *  - `stringArg()` turns a malformed registry entry into a named failure
 *    instead of a `NaN` cursor.
 *
 * So they live here once, along with the failure sentences more than one
 * surface says: a sentence two menus both need is the same duplication problem
 * as a check two handlers both need, and it rots the same way. Nothing here
 * knows what any command *does*; it only knows how to talk to the bridge, how
 * to refuse to guess, and how to say no in words the registry agrees with.
 */

import type { ElectronAPI, IpcResponse, TaskListResult } from '../../../preload/types';
import { TASKS_FILE_NAME } from '../../../shared/types/tasks';
import { useWorkspaceStore } from '../state/workspace-store';

// ---------------------------------------------------------------------------
// Failure sentences
// ---------------------------------------------------------------------------

/**
 * Shared because three menus grey rows out for this same reason, and the
 * registry's own `disabledReason` strings are written to match it.
 */
export const NO_EDITOR_OPEN = 'No editor is open.';

/**
 * Why a task row has nothing to offer, in main's own words when main has any.
 *
 * Shared because two surfaces answer the same question about the same
 * workspace: Run Build Task… declines with it, and the Run Task… submenu's
 * placeholder row carries it as the reason it is greyed. A second sentence for
 * one fact is how a menu starts saying two different things about a workspace.
 * `list.error` is discovery's own note — an unparseable file, or the entries it
 * had to skip — which is more actionable than anything written here could be.
 */
export function noDiscoveredTasksSentence(list: TaskListResult): string {
  if (list.error) return `No tasks were found: ${list.error}`;
  return `No tasks are declared in this workspace. Configure Tasks… creates a ${TASKS_FILE_NAME} to start from.`;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** The last path segment, on either separator, for messages that name a file. */
export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/**
 * The desktop bridge, or a throw explaining its absence.
 *
 * `window.electronAPI` is declared non-optional in the preload contract, but
 * renderer unit tests and non-preload frames genuinely lack it, and the house
 * access pattern is defensive for that reason.
 */
export function desktopBridge(what: string): ElectronAPI {
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!bridge) {
    throw new Error(`${what} needs the desktop bridge, which this window does not have.`);
  }
  return bridge;
}

/**
 * One bridge method, narrowed to non-optional.
 *
 * The preload contract marks newer surfaces optional — `taskRun?`,
 * `onTasksChanged?` — so that a build whose main process predates them still
 * type-checks. Every call site therefore has to narrow, and the two ways to do
 * that badly are a cast (`api.taskRun!(…)`, which turns a missing method into a
 * `TypeError` the user sees as a crash) and a non-null assertion. This throws a
 * sentence naming the capability instead, which `reportOutcome()` paints.
 *
 * The cast on the return is unavoidable: TypeScript cannot narrow
 * `ElectronAPI[K]` for a generic `K`, and the runtime check above is what
 * actually guarantees it.
 */
export function requireBridgeMethod<K extends keyof ElectronAPI>(
  method: K,
  what: string
): NonNullable<ElectronAPI[K]> {
  const bridge = desktopBridge(what);
  const candidate: unknown = bridge[method];
  if (typeof candidate !== 'function') {
    throw new Error(`${what} needs the bridge's '${String(method)}', which this window does not expose.`);
  }
  return candidate as NonNullable<ElectronAPI[K]>;
}

// ---------------------------------------------------------------------------
// IPC envelopes
// ---------------------------------------------------------------------------

/** Assert an IPC round-trip succeeded, for the calls that return no payload. */
export function assertOk(response: IpcResponse<unknown> | undefined, what: string): void {
  if (!response) throw new Error(`${what} did not respond.`);
  if (!response.success) throw new Error(response.error || `${what} failed.`);
}

/** Assert an IPC round-trip succeeded and hand back its payload. */
export function unwrap<T>(response: IpcResponse<T> | undefined, what: string): T {
  assertOk(response, what);
  const data = (response as IpcResponse<T>).data;
  // `IpcResponse` is not a discriminated union, so a `success: true` with no
  // `data` is representable. Treating it as a value would push `undefined`
  // into callers that then report a path or a tree that does not exist.
  if (data === undefined) throw new Error(`${what} succeeded but returned no data.`);
  return data;
}

// ---------------------------------------------------------------------------
// Registry args
// ---------------------------------------------------------------------------

/**
 * Read a required string argument.
 *
 * The message names the key rather than the command, because the command is
 * already the toast title: "Switch Editor — this command needs a 'path'
 * argument" reads as a diagnosis, where repeating the label twice does not.
 */
export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`This command needs a '${key}' argument and did not receive one.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Opening files
// ---------------------------------------------------------------------------

/**
 * Open a path in a tab and prove it landed.
 *
 * `workspace-store.openFile` catches its own read failures and logs them, so a
 * path that cannot be read resolves exactly like one that opened. The tab list
 * is the only honest witness.
 */
export async function openInTab(filePath: string): Promise<void> {
  const name = baseName(filePath);
  await useWorkspaceStore.getState().openFile(filePath, name);
  if (!useWorkspaceStore.getState().openTabs.some((tab) => tab.path === filePath)) {
    throw new Error(`'${name}' could not be opened. Check that the file still exists and is readable.`);
  }
}
