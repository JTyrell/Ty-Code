/**
 * Renderer command runtime (Prompt 5).
 *
 * The registry ({@link ../../../main/services/command-registry}) declares what
 * exists; the executor ({@link ../../../main/services/command-executor}) decides
 * whether it ran. This module is the window-side half of that contract: it owns
 * the renderer's handler table, gathers the contexts this window can actually
 * observe, resolves menus, and binds the registry's keybindings globally.
 *
 * Two invariants carry through every branch here, exactly as they do in main:
 *
 *  - **Hidden > dead.** `getRegistryRuntimeState()` unions the renderer's own
 *    handler keys with the ones main reported, and the resolver hides any row
 *    whose `command` is absent. A row that cannot run is never painted.
 *  - **Greyed = explained.** `executeCommandEntry()` re-checks `when` at click
 *    time and returns the entry's own `disabledReason`, so a click that races a
 *    state change still tells the user why nothing happened.
 *
 * Main-owned contexts are merged OVER the window's own, in the same order main
 * uses. A window therefore cannot unlock a guarded row by claiming a context it
 * does not own, and main cannot clobber what only the window can see.
 *
 * This module is imported by both the primary window and every popout: each
 * builds its own state from its own contributors, which is what lets a popout
 * render the same menu bar bound to its own window context.
 */

import {
  createCommandExecutor,
  createKeybindingMatcher,
  type CommandDisposable,
  type CommandHandler,
  type KeyLikeEvent
} from '../../../main/services/command-executor';
import {
  COMMAND_ENTRIES,
  emptyContext,
  getCommandEntry,
  isEntryBacked,
  resolveAllMenus,
  resolveMenu,
  type RegistryRuntimeState
} from '../../../main/services/command-registry';
// Type-only: the reveal vocabulary is declared where the window is created, so
// `Record<EditorWindowReveal, string>` below fails to compile if main adds a
// reveal this module has not mapped. Erased at build time, so no Electron code
// is ever pulled into the renderer bundle.
import type { EditorWindowReveal } from '../../../main/windows/editor-window';
import { evaluateWhen } from '../../../shared/types/command-registry';
import type {
  CommandContext,
  CommandContextKey,
  CommandEntry,
  CommandMenuId,
  DynamicSubmenuItem,
  ExecuteCommandResult,
  ResolvedMenu
} from '../../../preload/types';
import { useCommandRuntimeStore } from '../state/command-runtime-store';
import { toast } from '../state/toast-store';

export type CommandRuntimeDisposable = CommandDisposable;

/**
 * The window's own executor. Renderer-target entries run here; main-target
 * entries cross IPC. Handlers are keyed by `command`, never by entry `id`, so
 * one handler (`editor.monacoAction`) backs every Go-menu row that delegates to
 * a Monaco action.
 */
const runtimeExecutor = createCommandExecutor({ target: 'renderer' });

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/**
 * A feature area's honest view of the contexts it can observe.
 *
 * Reports only the keys it genuinely knows; anything unreported resolves to
 * `false` through `emptyContext()`, which fails closed — a command whose
 * context is unproven stays disabled rather than firing on a guess.
 */
export type CommandContextContributor = () => Partial<CommandContext>;

const contextContributors = new Set<CommandContextContributor>();

/**
 * Register a context source. Returns a disposable that removes it and
 * re-collects, so an unmounted feature area stops asserting contexts it can no
 * longer observe.
 */
export function registerContextContributor(
  contributor: CommandContextContributor
): CommandRuntimeDisposable {
  contextContributors.add(contributor);
  refreshCommandContexts();
  return {
    dispose() {
      if (contextContributors.delete(contributor)) refreshCommandContexts();
    }
  };
}

/**
 * Flatten every contributor into one snapshot.
 *
 * Each contributor is isolated in its own try/catch: a throwing feature area
 * must not take the menu bar down with it, so its keys simply stay unreported.
 * Two contributors disagreeing on a key is a wiring bug, not a user problem, so
 * it is warned about rather than silently resolved.
 */
export function collectRendererContexts(): Partial<CommandContext> {
  const merged: Partial<CommandContext> = {};
  for (const contributor of contextContributors) {
    let partial: Partial<CommandContext>;
    try {
      partial = contributor();
    } catch (err) {
      console.error('[command-runtime] context contributor threw', err);
      continue;
    }
    for (const [key, value] of Object.entries(partial) as Array<[CommandContextKey, boolean]>) {
      const previous = merged[key];
      if (previous !== undefined && previous !== value) {
        console.warn(
          `[command-runtime] two contributors disagree on '${key}' (${String(previous)} vs ${String(value)}); the later one wins`
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}

function sameContexts(a: Partial<CommandContext>, b: Partial<CommandContext>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key as CommandContextKey] === b[key as CommandContextKey]);
}

/**
 * Re-collect and publish. Cheap enough to call from a store subscription, and
 * it skips the write when nothing moved so menu subscribers are not re-rendered
 * by an equal snapshot.
 */
export function refreshCommandContexts(): void {
  const next = collectRendererContexts();
  const store = useCommandRuntimeStore.getState();
  if (sameContexts(store.contexts, next)) return;
  store.setContexts(next);
}

// ---------------------------------------------------------------------------
// What main owns
// ---------------------------------------------------------------------------

let mainContextInFlight: Promise<void> | null = null;

/**
 * Ask main which contexts it owns and which main-target handlers are live.
 *
 * Single-flight: menus resolve on boot and again on focus, and two concurrent
 * fetches would let the older answer land last. Without the handler list a
 * window would paint rows main cannot run — the dead click "hidden > dead"
 * forbids.
 */
export async function refreshMainCommandContext(): Promise<void> {
  if (mainContextInFlight) return mainContextInFlight;
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.getMainCommandContext) return;

  mainContextInFlight = (async () => {
    try {
      const response = await api.getMainCommandContext();
      if (response?.success && response.data) {
        useCommandRuntimeStore.getState().setMainCommandContext(response.data);
        flushPendingReveal();
      } else if (response && !response.success) {
        console.warn('[command-runtime] main command context unavailable:', response.error);
      }
    } catch (err) {
      console.error('[command-runtime] failed to read main command context', err);
    } finally {
      mainContextInFlight = null;
    }
  })();
  return mainContextInFlight;
}

/** This window's own id, so the audit ledger can attribute an execution. */
function currentWindowId(): number | undefined {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  try {
    return api?.getWebContentsId?.();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * The snapshot the shared resolver reads.
 *
 * `availableCommands` is the union of both processes' handler keys, because a
 * row is backed if EITHER side can run it. Contexts merge renderer-first,
 * main-last — the same authority order main applies to the snapshot a window
 * sends it.
 */
export function getRegistryRuntimeState(): RegistryRuntimeState {
  const store = useCommandRuntimeStore.getState();
  return {
    availableCommands: new Set([
      ...runtimeExecutor.availableCommands(),
      ...store.mainCommands
    ]),
    contexts: { ...emptyContext(), ...store.contexts, ...store.mainContexts },
    dynamicSubmenus: store.dynamicSubmenus
  };
}

/** Resolve one menu bar menu into separator groups. */
export function resolveCommandMenu(menu: CommandMenuId): ResolvedMenu {
  return resolveMenu(menu, getRegistryRuntimeState(), COMMAND_ENTRIES);
}

/** Resolve every menu, in menu-bar order. */
export function resolveCommandMenus(): ResolvedMenu[] {
  return resolveAllMenus(getRegistryRuntimeState(), COMMAND_ENTRIES);
}

/** Handler keys this window has registered itself. */
export function rendererAvailableCommands(): ReadonlySet<string> {
  return runtimeExecutor.availableCommands();
}

/**
 * Registry handler keys this target expects but nothing registered. Surfaced by
 * the Diagnostics view so a gap is found there rather than by a user staring at
 * a menu that silently dropped a row.
 */
export function rendererMissingHandlers(): string[] {
  return runtimeExecutor.missingHandlers();
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

/**
 * Register a renderer handler for a registry `command` key.
 *
 * Registration changes what a menu can show, so the store's revision is bumped
 * even though no context moved — otherwise a menu resolved before the handler
 * arrived would keep the row hidden until something else happened to re-render.
 */
export function registerRendererCommand(
  command: string,
  handler: CommandHandler
): CommandRuntimeDisposable {
  const disposer = runtimeExecutor.register(command, handler);
  useCommandRuntimeStore.getState().bumpRevision();
  flushPendingReveal();
  return {
    dispose() {
      disposer.dispose();
      useCommandRuntimeStore.getState().bumpRevision();
    }
  };
}

/** Register many at once; one disposer releases all of them, newest first. */
export function registerRendererCommands(
  handlers: Record<string, CommandHandler>
): CommandRuntimeDisposable {
  const disposers = Object.entries(handlers).map(([command, handler]) =>
    runtimeExecutor.register(command, handler)
  );
  useCommandRuntimeStore.getState().bumpRevision();
  flushPendingReveal();
  return {
    dispose() {
      // Reverse order so a nested registration unwinds the way it was built.
      for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i].dispose();
      useCommandRuntimeStore.getState().bumpRevision();
    }
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Handlers that owe the user a visible verdict return `{ summary }`; everything
 * else returns nothing and stays quiet. A toast per keystroke is noise, not
 * feedback, but "Check for Updates" reporting nothing at all is the canned
 * success this codebase forbids.
 */
function summarise(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'summary' in data) {
    const value = (data as { summary?: unknown }).summary;
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * Tell the user what happened. Every branch says something, because a click
 * that produces no visible result is indistinguishable from a dead click.
 */
function reportOutcome(label: string, result: ExecuteCommandResult): void {
  if (result.ok) {
    const summary = summarise(result.data);
    if (summary) toast.success(label, summary);
    return;
  }
  if (result.reason === 'disabled') {
    // Not an error: the command explained itself, which is the whole point of
    // carrying `disabledReason` through the registry.
    toast.info(label, result.error ?? 'Not available right now.');
    return;
  }
  toast.error(label, result.error ?? 'The command did not run.');
}

async function executeOnMain(
  entry: CommandEntry,
  args?: Record<string, unknown>
): Promise<ExecuteCommandResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.executeCommand) {
    return {
      ok: false,
      commandId: entry.id,
      reason: 'no_handler',
      error: `'${entry.label}' needs the desktop bridge, which this window does not have.`
    };
  }
  try {
    // Only this window's own observations cross the wire. Main merges its
    // authoritative keys over them, so echoing main's own contexts back would
    // just invite a stale value to be argued about.
    const response = await api.executeCommand({
      commandId: entry.id,
      args,
      windowId: currentWindowId(),
      contexts: useCommandRuntimeStore.getState().contexts
    });
    if (!response?.success) {
      return {
        ok: false,
        commandId: entry.id,
        reason: 'unknown_command',
        error: response?.error ?? `The main process rejected '${entry.label}'.`
      };
    }
    if (!response.data) {
      return {
        ok: false,
        commandId: entry.id,
        reason: 'no_handler',
        error: `The main process returned no result for '${entry.label}'.`
      };
    }
    return response.data;
  } catch (err) {
    return {
      ok: false,
      commandId: entry.id,
      reason: 'handler_threw',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Run a registry entry.
 *
 * Both gates are re-checked here rather than trusted from the row that was
 * painted: the world can change between `resolveCommandMenu()` and the click,
 * and "zero dead clicks" means a declined click still explains itself.
 */
export async function executeCommandEntry(
  entryOrId: CommandEntry | string,
  args?: Record<string, unknown>
): Promise<ExecuteCommandResult> {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  const entry = typeof entryOrId === 'string' ? getCommandEntry(entryOrId, COMMAND_ENTRIES) : entryOrId;

  if (!entry) {
    const result: ExecuteCommandResult = {
      ok: false,
      commandId: id,
      reason: 'unknown_command',
      error: `'${id}' is not a registered command.`
    };
    reportOutcome(id, result);
    return result;
  }

  const state = getRegistryRuntimeState();
  if (!isEntryBacked(entry, state)) {
    const result: ExecuteCommandResult = {
      ok: false,
      commandId: entry.id,
      reason: 'no_handler',
      error: `'${entry.label}' has no handler in this window.`
    };
    reportOutcome(entry.label, result);
    return result;
  }
  if (!evaluateWhen(entry.when, state.contexts)) {
    const result: ExecuteCommandResult = {
      ok: false,
      commandId: entry.id,
      reason: 'disabled',
      error: entry.disabledReason ?? 'Not available right now.'
    };
    reportOutcome(entry.label, result);
    return result;
  }

  const result =
    entry.target === 'main'
      ? await executeOnMain(entry, args)
      : await runtimeExecutor.execute({
          commandId: entry.id,
          args,
          windowId: currentWindowId(),
          contexts: state.contexts
        });

  reportOutcome(entry.label, result);
  return result;
}

async function executeDynamicOnMain(item: DynamicSubmenuItem): Promise<ExecuteCommandResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.executeDynamicCommand) {
    return {
      ok: false,
      commandId: item.id,
      reason: 'no_handler',
      error: `'${item.label}' needs the desktop bridge, which this window does not have.`
    };
  }
  try {
    const response = await api.executeDynamicCommand(item, useCommandRuntimeStore.getState().contexts);
    if (!response?.success) {
      return {
        ok: false,
        commandId: item.id,
        reason: 'unknown_command',
        error: response?.error ?? `The main process rejected '${item.label}'.`
      };
    }
    if (!response.data) {
      return {
        ok: false,
        commandId: item.id,
        reason: 'no_handler',
        error: `The main process returned no result for '${item.label}'.`
      };
    }
    return response.data;
  } catch (err) {
    return {
      ok: false,
      commandId: item.id,
      reason: 'handler_threw',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Run a row from a dynamic submenu (Switch Editor, Running Tasks, …).
 *
 * Those carry their own command key, args and enablement, so they bypass entry
 * lookup — but not the handler lookup, and not the report.
 */
export async function executeDynamicSubmenuItem(
  item: DynamicSubmenuItem
): Promise<ExecuteCommandResult> {
  const result =
    item.target === 'main'
      ? await executeDynamicOnMain(item)
      : await runtimeExecutor.executeDynamic(item, currentWindowId());
  reportOutcome(item.label, result);
  return result;
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

/**
 * Commands the focused surface already performs natively and correctly.
 *
 * Derived from the registry's handler keys rather than a second list of chords,
 * so the table stays the single source of truth. `edit.dispatch` is the
 * cut/copy/paste/undo/select-all family, and every text surface in the app —
 * Monaco's input area, the chat box, xterm's helper textarea — handles those
 * itself. Claiming them in a capture-phase listener would strip native editing
 * from every field in the product. They remain reachable from the Edit and
 * Selection menus, whose handler is focus-aware.
 */
const NATIVE_SURFACE_COMMANDS: ReadonlySet<string> = new Set(['edit.dispatch']);

/**
 * Commands Monaco implements with its own focus and widget contexts, and that
 * xterm or a plain text field would rather keep.
 *
 * These ARE claimed while Monaco has focus — that is what makes the registry
 * binding the thing that fires for F12, Ctrl+D and friends — and are left alone
 * everywhere else, so Ctrl+D still reaches the shell as EOF and Ctrl+/ still
 * belongs to the chat box.
 */
const EDITOR_SCOPED_COMMANDS: ReadonlySet<string> = new Set(['editor.monacoAction']);

/** Which surface, if any, currently owns the keyboard. */
export type FocusedSurface = 'monaco' | 'terminal' | 'text' | 'none';

/**
 * Classify the focused element.
 *
 * The terminal is tested before the editor because xterm's helper textarea is a
 * plain `<textarea>`: without that order it would be misread as a text field.
 * Monaco's input surface is a `<textarea class="inputarea">` inside
 * `.monaco-editor`, which is why the editor test is a container lookup rather
 * than a tag check.
 */
export function focusedSurface(): FocusedSurface {
  if (typeof document === 'undefined') return 'none';
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return 'none';
  if (active.closest('.xterm') !== null) return 'terminal';
  if (active.closest('.monaco-editor') !== null) return 'monaco';
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  ) {
    return 'text';
  }
  return 'none';
}

/** Whether the global binder leaves this chord to the focused surface. */
export function shouldStandAside(command: string): boolean {
  if (NATIVE_SURFACE_COMMANDS.has(command)) return true;
  const surface = focusedSurface();
  if (surface === 'none') return false;
  return EDITOR_SCOPED_COMMANDS.has(command) && surface !== 'monaco';
}

/**
 * Bind every keybinding in the registry, globally, from the same entries the
 * menus render from.
 *
 * One capture-phase listener on `window`. Capture is deliberate: it runs before
 * Monaco, xterm and any input can see the chord, so `preventDefault` plus
 * `stopPropagation` guarantees a claimed binding fires exactly once rather than
 * once here and again in the editor.
 */
export function installCommandKeybindings(): CommandRuntimeDisposable {
  if (typeof window === 'undefined') return { dispose() {} };

  const matcher = createKeybindingMatcher({ entries: COMMAND_ENTRIES });

  const onKeyDown = (event: KeyboardEvent): void => {
    // Auto-repeat would re-run a command per key repeat; a held Ctrl+S must
    // save once. Returning before `match` also leaves any pending chord intact.
    if (event.repeat) return;

    const keyEvent: KeyLikeEvent = {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    };

    const match = matcher.match(keyEvent, getRegistryRuntimeState());
    if (match.kind === 'none') return;

    if (shouldStandAside(match.binding.command)) {
      // Reset so a half-typed sequence is not left latched swallowing whatever
      // the user types next.
      matcher.reset();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (match.kind === 'pending') return;
    void executeCommandEntry(match.binding.commandId, match.binding.args);
  };

  window.addEventListener('keydown', onKeyDown, true);
  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      matcher.reset();
    }
  };
}

// ---------------------------------------------------------------------------
// Window reveal
// ---------------------------------------------------------------------------

/**
 * The hash a secondary window is loaded with, mapped to the registry entry it
 * should dispatch once that entry is backed.
 *
 * The reveal travels in the load hash rather than an event because a hash
 * survives the renderer's boot ordering, whereas a `webContents.send` fired
 * before this module subscribes is simply lost.
 */
const REVEAL_COMMANDS: Record<EditorWindowReveal, string> = {
  terminal: 'view.toggle-terminal'
};

let pendingReveal: EditorWindowReveal | null = null;

/**
 * Read and clear this window's reveal hash, arming it for dispatch.
 *
 * Cleared immediately so a reload does not re-fire it: the mapped entries are
 * toggles, and toggling twice on every reload would leave the surface shut.
 */
export function consumeWindowReveal(): EditorWindowReveal | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw || !(raw in REVEAL_COMMANDS)) return null;

  // Preserve the rest of the URL: App's hash router reads this same location,
  // and an unrecognised hash already falls through to the workbench.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  pendingReveal = raw as EditorWindowReveal;
  flushPendingReveal();
  return pendingReveal;
}

/**
 * Dispatch an armed reveal once its entry is actually backed.
 *
 * Registration order is not something this module can dictate — the workbench
 * registers its handlers when it mounts, which may be after boot — so the
 * reveal waits for the handler rather than firing into `no_handler`. Waiting is
 * the honest option: a window that opened without revealing its terminal is a
 * cosmetic miss, whereas a click that reports a handler exists when it does not
 * is a lie.
 */
function flushPendingReveal(): void {
  if (!pendingReveal) return;
  const commandId = REVEAL_COMMANDS[pendingReveal];
  const entry = getCommandEntry(commandId, COMMAND_ENTRIES);
  if (!entry || !isEntryBacked(entry, getRegistryRuntimeState())) return;

  pendingReveal = null;
  void executeCommandEntry(entry);
}

// ---------------------------------------------------------------------------
// Boot and teardown
// ---------------------------------------------------------------------------

/**
 * Wire the runtime into a window.
 *
 * Call AFTER `installCommandContextSources()` from `./command-contexts`, so the
 * first resolution already sees this window's own observations. Returns one
 * disposable that releases everything it installed.
 */
export function installCommandRuntime(): CommandRuntimeDisposable {
  refreshCommandContexts();
  void refreshMainCommandContext();
  const keybindings = installCommandKeybindings();
  consumeWindowReveal();

  return {
    dispose() {
      keybindings.dispose();
      pendingReveal = null;
    }
  };
}

/**
 * Release everything this module holds: handlers, contributors, the audit
 * ledger and any armed reveal. Used by window teardown and by tests that need a
 * clean table between cases.
 */
export function disposeCommandRuntime(): void {
  runtimeExecutor.dispose();
  contextContributors.clear();
  pendingReveal = null;
  useCommandRuntimeStore.setState({
    contexts: {},
    mainContexts: {},
    mainCommands: new Set<string>(),
    missingMainHandlers: [],
    dynamicSubmenus: {},
    revision: 0
  });
}

/** This window's recent executions, for the Reliability Panel's local view. */
export function rendererAuditTrail() {
  return runtimeExecutor.auditTrail();
}
