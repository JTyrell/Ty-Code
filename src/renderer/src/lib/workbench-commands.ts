/**
 * Workbench, View and Help command handlers (Prompt 5 / 5b).
 *
 * This is the half of the registry that drives the shell rather than the text:
 * the File menu, the View toggles, the Quick Open family and the two Help rows
 * that open a settings tab. The editor-facing half lives in
 * `editor-commands.ts` and the terminal-facing half in `terminal-commands.ts`;
 * the three share `command-ipc.ts` for bridge and args narrowing and otherwise
 * do not import each other.
 *
 * Three rules shape every handler below.
 *
 *  - **Nothing here claims success it did not earn.** The menu bar this replaces
 *    answered File > Save with `toast.info('File saved')` without writing a
 *    byte, and File > Find in Files with a `CustomEvent` that no component
 *    listened for. Every handler either performs the action, throws a sentence
 *    naming what is missing, or returns nothing at all — and a `false` return
 *    from a store action is treated as a failure rather than being swallowed.
 *  - **A changed mind is not an error.** The file dialogs added for this
 *    registry report cancellation structurally (`data.canceled`), so a
 *    dismissed picker returns silently instead of painting a red toast over a
 *    user who simply decided against it. The older directory picker predates
 *    that contract and reports cancellation as `success: false`, which is why
 *    `openFolder` has to sniff its message text — the one place here that does.
 *  - **Absent capability throws, never no-ops.** `runAction()` on the editor
 *    navigation store is a silent no-op when `EditorArea` is unmounted, so
 *    `runEditorAction()` checks the registration first. Same for the desktop
 *    bridge: a popout or a test frame has no `window.electronAPI`, and saying
 *    so beats doing nothing.
 *
 * Handlers are registered from `MainWorkbench` rather than at module scope, so
 * the shell callbacks they need come in as `deps` and a window with no
 * workbench mounted registers nothing — its rows stay hidden, which is the
 * truth about that window.
 *
 * Deliberately **not** registered here, so their rows stay hidden per
 * Hidden > dead until something real backs them: `workbench.reliabilityPanel`
 * (no such surface exists in the renderer), `help.playground` (this build ships
 * no editor playground) and every `debug.*` key. `help.about` is registered by
 * `TitleBar.tsx`, next to the modal it opens.
 */

import type { CommandHandler } from '../../../main/services/command-executor';
import type { ActivityTab } from '../components/ActivityBar';
import { APP_THEMES, applyAppTheme, getStoredTheme } from '../hooks/useThemeSync';
import { openAppDoc } from '../state/app-docs-store';
import { useEditorNavigationStore, type EditorActionName } from '../state/editor-navigation-store';
import { useOnboardingStore } from '../state/onboarding-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import { useWorkspaceStore } from '../state/workspace-store';
import {
  NO_EDITOR_OPEN,
  assertOk,
  baseName,
  desktopBridge,
  openInTab,
  unwrap
} from './command-ipc';
import { registerRendererCommands, type CommandRuntimeDisposable } from './command-runtime';

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

/**
 * The shell callbacks only `MainWorkbench` can supply, because they close over
 * its `useState` setters. Everything else in this module reaches a zustand
 * store directly and needs no injection.
 */
export interface WorkbenchUiDeps {
  /** Flip the command palette. A chord that both opens and closes is what the pre-registry keydown chain did. */
  toggleCommandPalette: () => void;
  /**
   * Open Quick Open with a mode prefix already typed.
   *
   * `''` lists files, `'#'` searches workspace symbols, `'@'` symbols in the
   * active editor and `':'` jumps to a line. Always opens rather than
   * toggling: the four Go-menu rows share this surface with different
   * prefixes, and toggling would make Ctrl+P followed by Ctrl+G close the
   * overlay the user just asked for.
   */
  openQuickOpen: (prefix: string) => void;
  /**
   * Reveal an activity-bar view, opening the primary sidebar if it is closed.
   *
   * Must not reuse the activity bar's click handler: clicking the already
   * active tab is a *toggle* there, so a menu row wired straight to it would
   * hide the very panel it names. The old Ctrl+Shift+F binding had exactly
   * this bug — it set the tab and left the sidebar shut, so the shortcut
   * looked broken whenever the panel was closed.
   */
  showActivityView: (view: ActivityTab) => void;
  togglePrimarySidebar: () => void;
  toggleAssistantSidebar: () => void;
  toggleTerminal: () => void;
  openBootTimeline: () => void;
  /**
   * Open Settings, optionally on a specific tab.
   *
   * Opens rather than toggles, for the same reason `showActivityView` does:
   * Ty-Code > Preferences must never close Preferences. Routed through
   * `MainWorkbench` so the boot-scheduler promotion that makes the lazily
   * hydrated settings chunk render promptly still happens.
   */
  openPreferences: (tab?: string) => void;
}

// ---------------------------------------------------------------------------
// Failure sentences
// ---------------------------------------------------------------------------
//
// `NO_EDITOR_OPEN` and the bridge/IPC narrowing helpers live in `./command-ipc`,
// shared with the editor and terminal handler modules so the three cannot drift
// apart on a detail like refusing a `success: true` with no payload. What stays
// here is specific to this half of the registry.

const NO_EDITOR_MOUNTED = 'This needs an editor, and none is mounted in this window.';
const NO_DIALOG_BRIDGE = 'This window has no desktop bridge, so it cannot open a native file dialog.';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Run an editor-side action, refusing loudly when nothing registered it.
 *
 * `runAction()` on the store is `get().actions[action]?.()` — a silent no-op.
 * Minimap, Zen Mode and Split Editor have no `when` clause in the registry
 * (they are window-level toggles that outlive the last open tab), so the
 * registration check is the only thing standing between a click and a dead one.
 */
function runEditorAction(action: EditorActionName): void {
  const handler = useEditorNavigationStore.getState().actions[action];
  if (!handler) throw new Error(NO_EDITOR_MOUNTED);
  handler();
}

/**
 * Ask the blame gutter to refetch, if one is mounted.
 *
 * Deliberately softer than `runEditorAction`: the save already succeeded, and
 * failing the whole command because the gutter is not on screen would report a
 * lie in the other direction.
 */
function refreshBlameIfMounted(): void {
  useEditorNavigationStore.getState().actions.refreshBlame?.();
}

/** The active tab's path, or a throw saying there is none. */
function requireActivePath(): string {
  const path = useWorkspaceStore.getState().activeTabPath;
  if (!path) throw new Error(NO_EDITOR_OPEN);
  return path;
}

// ---------------------------------------------------------------------------
// File menu
// ---------------------------------------------------------------------------

/**
 * File > New File.
 *
 * Asks for a path and creates a real empty file rather than opening an
 * "untitled" buffer: the tab model keys every tab by an on-disk path and reads
 * content through `LazyModelManager`, so an in-memory-only file would have
 * nowhere to live and its first save would be a second dialog. The native
 * picker supplies the overwrite confirmation, so choosing an existing file
 * empties it only after the platform has asked.
 */
async function newFile(): Promise<void> {
  const bridge = desktopBridge('New File');
  if (!bridge.savePathDialog) throw new Error(NO_DIALOG_BRIDGE);
  const workspacePath = useWorkspaceStore.getState().workspacePath;
  const chosen = unwrap(
    await bridge.savePathDialog({
      title: 'New File',
      // `defaultPath` is `min(1)` in the dialog contract, so with no workspace
      // open the key has to be omitted rather than sent empty and rejected.
      defaultPath: workspacePath || undefined,
      buttonLabel: 'Create'
    }),
    'The new-file picker'
  );
  if (chosen.canceled || !chosen.filePath) return;
  const destination = chosen.filePath;
  assertOk(await bridge.writeFile(destination, ''), `Creating '${baseName(destination)}'`);
  await openInTab(destination);
  // Without this the explorer keeps showing the directory as it was before the
  // file existed, and the user has no on-screen evidence the click did anything.
  void useWorkspaceStore.getState().refreshFileTree();
}

/** File > Open File… */
async function openFile(): Promise<void> {
  const bridge = desktopBridge('Open File…');
  if (!bridge.openFileDialog) throw new Error(NO_DIALOG_BRIDGE);
  const chosen = unwrap(await bridge.openFileDialog({ title: 'Open File' }), 'The open-file picker');
  if (chosen.canceled || !chosen.filePath) return;
  await openInTab(chosen.filePath);
}

/**
 * File > Open Folder…
 *
 * Replaces the copy that lived inline in `TitleBar.handleOpenFolder`, with one
 * correction: the store's `refreshFileTree` prefers the chunked tree IPC and
 * builds the nested tree from the flat one, where the old code called
 * `getWorkspaceTree` directly and left `flatTree` stale.
 *
 * `summary` is optional so a dismissed picker can return `{}`: `summarise()` in
 * the runtime only toasts a non-empty string, which makes the empty object the
 * silent success a changed mind deserves.
 */
async function openFolder(): Promise<{ summary?: string }> {
  const bridge = desktopBridge('Open Folder…');
  const response = await bridge.selectWorkspaceFolder();
  if (!response.success) {
    // The directory picker collapses "dismissed" and "failed" into one
    // `success: false`, so the message is the only way to tell them apart.
    // `dialog.ts` returns a structural `canceled` flag instead; this handler
    // predates it and is the sole place here that has to read the text.
    if (/cancel/i.test(response.error || '')) return {};
    throw new Error(response.error || 'The folder picker failed.');
  }
  const folderPath = response.data;
  if (!folderPath) return {};

  const store = useWorkspaceStore.getState();
  const alreadyOpen = store.workspacePath === folderPath;
  store.setWorkspacePath(folderPath);
  // `setWorkspacePath` kicks off its own refresh when the path changes, so
  // awaiting one here too would load the tree twice — the slowest thing the
  // workbench does. Only re-read when the path was already the current one.
  if (alreadyOpen) await store.refreshFileTree();
  return { summary: folderPath };
}

/** File > Save. Silent on success, because Ctrl+S fires constantly. */
async function save(): Promise<void> {
  const path = requireActivePath();
  // `saveFile` returns `true` for an already-clean tab and `false` only when
  // the write itself failed, so `false` is a real error worth surfacing — the
  // store just `console.error`s it, which no user ever sees.
  if (!(await useWorkspaceStore.getState().saveFile(path))) {
    throw new Error(`'${baseName(path)}' could not be written to disk.`);
  }
  refreshBlameIfMounted();
}

/** File > Save All. */
async function saveAll(): Promise<{ summary: string }> {
  const store = useWorkspaceStore.getState();
  const dirty = store.openTabs.filter((tab) => tab.isDirty);
  if (dirty.length === 0) throw new Error('No open editor has unsaved changes.');
  const failed: string[] = [];
  let written = 0;
  // Sequential on purpose: these are writes to the same filesystem the editor
  // is reading from, and a partial-failure report needs a definite order.
  for (const tab of dirty) {
    if (await store.saveFile(tab.path)) written += 1;
    else failed.push(tab.name);
  }
  refreshBlameIfMounted();
  if (failed.length > 0) {
    throw new Error(`Saved ${written} of ${dirty.length} files. These failed: ${failed.join(', ')}.`);
  }
  return { summary: written === 1 ? 'Saved 1 file.' : `Saved ${written} files.` };
}

/** File > Save As… */
async function saveAs(): Promise<void> {
  const store = useWorkspaceStore.getState();
  const current = requireActivePath();
  const tab = store.openTabs.find((item) => item.path === current);
  const bridge = desktopBridge('Save As…');
  if (!bridge.savePathDialog) throw new Error(NO_DIALOG_BRIDGE);
  const chosen = unwrap(
    await bridge.savePathDialog({ title: 'Save As…', defaultPath: current, buttonLabel: 'Save' }),
    'The save picker'
  );
  if (chosen.canceled || !chosen.filePath) return;
  const destination = chosen.filePath;
  assertOk(
    await bridge.writeFile(destination, tab?.content ?? ''),
    `Writing '${baseName(destination)}'`
  );

  if (destination === current) {
    // The bytes are already down; save again so the store clears the dirty
    // flag itself rather than this module reaching into its tab list.
    if (!(await useWorkspaceStore.getState().saveFile(current))) {
      throw new Error(`'${baseName(current)}' could not be marked as saved.`);
    }
    refreshBlameIfMounted();
    return;
  }

  // Save As re-points the editor at the new path, as it does everywhere else.
  // The original file keeps the content it had before, which is the point of
  // the operation rather than a side effect of it.
  store.closeTab(current);
  await openInTab(destination);
  refreshBlameIfMounted();
}

/** File > Close Editor. */
function closeEditor(): void {
  const store = useWorkspaceStore.getState();
  const path = requireActivePath();
  const tab = store.openTabs.find((item) => item.path === path);
  // `closeTab` discards without asking and there is no confirmation dialog in
  // the renderer, so refusing beats silently throwing away unsaved work.
  if (tab?.isDirty) {
    throw new Error(`'${tab.name}' has unsaved changes — save it before closing.`);
  }
  store.closeTab(path);
}

// ---------------------------------------------------------------------------
// View, Go and workspace scans
// ---------------------------------------------------------------------------

/** View > Rescan Workspace Files. Lost its `Ctrl+Shift+S` chord to Save As… */
async function rescanWorkspace(): Promise<{ summary: string }> {
  const bridge = desktopBridge('Rescan Workspace Files');
  const workspacePath = useWorkspaceStore.getState().workspacePath;
  const profile = unwrap(
    await bridge.scanWorkspace(workspacePath || undefined),
    'The workspace scan'
  );
  return { summary: `${profile.primaryLanguage} • ${profile.architecture}` };
}

/** Cycle the app theme. Reports the theme it landed on, which is the visible proof. */
function changeTheme(): { summary: string } {
  const current = getStoredTheme();
  const index = APP_THEMES.findIndex((theme) => theme.id === current);
  // `findIndex` returns -1 for a stored value that has since left the list, and
  // -1 + 1 is 0 — the default theme. Wrapping is correct either way.
  const next = APP_THEMES[(index + 1) % APP_THEMES.length];
  applyAppTheme(next.id, true);
  return { summary: next.label };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Build the handler map without touching the global registry.
 *
 * Exported so a test can exercise every handler against stub deps and a stub
 * bridge without installing anything process-wide.
 */
export function buildWorkbenchHandlers(deps: WorkbenchUiDeps): Record<string, CommandHandler> {
  return {
    // File
    'workbench.newFile': () => newFile(),
    'workbench.openFile': () => openFile(),
    'workbench.openFolder': () => openFolder(),
    'workbench.save': () => save(),
    'workbench.saveAs': () => saveAs(),
    'workbench.saveAll': () => saveAll(),
    'workbench.closeEditor': () => closeEditor(),

    // Edit — the only Edit row that moves the shell rather than the text.
    'workbench.findInFiles': () => deps.showActivityView('search'),

    // View
    'workbench.commandPalette': () => deps.toggleCommandPalette(),
    'workbench.quickOpen': () => deps.openQuickOpen(''),
    'workbench.toggleLeftSidebar': () => deps.togglePrimarySidebar(),
    'workbench.toggleRightSidebar': () => deps.toggleAssistantSidebar(),
    'workbench.toggleTerminal': () => deps.toggleTerminal(),
    'workbench.splitEditor': () => runEditorAction('splitVertical'),
    'workbench.toggleMinimap': () => runEditorAction('toggleMinimap'),
    'workbench.toggleWordWrap': () => runEditorAction('toggleWordWrap'),
    'workbench.toggleZenMode': () => runEditorAction('toggleZenMode'),
    'workbench.changeTheme': () => changeTheme(),
    'workbench.usageDashboard': () => useUsageDashboardStore.getState().openDashboard(),
    'workbench.bootTimeline': () => deps.openBootTimeline(),
    'workbench.rescanWorkspace': () => rescanWorkspace(),
    'workbench.showSourceControl': () => deps.showActivityView('source-control'),
    'workbench.showExtensions': () => deps.showActivityView('extensions'),

    // Go — three of the G3..G5 rows are Quick Open with a prefix already typed.
    'workbench.workspaceSymbols': () => deps.openQuickOpen('#'),
    'workbench.editorSymbols': () => deps.openQuickOpen('@'),
    'workbench.gotoLine': () => deps.openQuickOpen(':'),

    // Ty-Code and Help — these three land on a real settings tab.
    'workbench.openSettings': () => deps.openPreferences(),
    'help.keyboardShortcuts': () => deps.openPreferences('shortcuts'),
    'help.diagnostics': () => deps.openPreferences('diagnostics'),

    // Help rows backed by the document viewer (Prompt 5b Step 5, G1 and G2).
    // `openAppDoc` is synchronous — it sets the store and returns, and the
    // panel paints its own loading and error states. Returning a summary here
    // would stack a toast on top of the panel that is already the visible
    // result, and a failure is main's verbatim sentence naming every candidate
    // path it tried, which belongs in the panel rather than paraphrased.
    'help.documentation': () => openAppDoc('documentation'),
    'help.releaseNotes': () => openAppDoc('release-notes'),
    'help.license': () => openAppDoc('license'),
    'help.privacyPolicy': () => openAppDoc('privacy-policy'),

    // Help > Welcome. The step id is named rather than left to `openWizard()`'s
    // default, because that default resolves to `auto_setup` once onboarding
    // has been completed — which is exactly the state a returning user is in,
    // and the row is labelled Welcome.
    'help.welcome': () => useOnboardingStore.getState().openWizard('welcome')
  };
}

/**
 * Register the workbench handlers against the live command runtime.
 *
 * The returned disposable must be held for as long as the workbench is
 * mounted: disposing it removes the handlers, which makes every row above
 * disappear from the menus rather than turning into a dead click.
 */
export function registerWorkbenchCommandHandlers(deps: WorkbenchUiDeps): CommandRuntimeDisposable {
  return registerRendererCommands(buildWorkbenchHandlers(deps));
}
