/**
 * Terminal command seam (Prompt 5b, Terminal menu group G1).
 *
 * `components/TerminalDrawer.tsx` owns every piece of terminal UI state — the
 * tab list, which tab is active, whether a second pane is showing — in local
 * `useState` rather than in a store, because none of it outlives the drawer and
 * nothing else in the app needed it. The Terminal menu changed that: New
 * Terminal and Split Terminal have to reach into the drawer from a click in the
 * menu bar, which is a different component tree.
 *
 * This module is the seam. The drawer publishes a controller while it is
 * mounted and withdraws it on unmount; the command layer asks for a terminal or
 * a split and gets a `boolean` back. Nothing here imports React and nothing
 * here holds terminal state — it forwards.
 *
 * A seam rather than a `CustomEvent` bus, deliberately. The menu bar this
 * replaces fired four `workbench:*` events that **no component listened for**,
 * so four rows looked wired and did nothing; an event with no listener is
 * indistinguishable from one that was handled, and no test fails. A missing
 * controller is not: `createTerminal()` returns false, the handler throws a
 * sentence, and `reportOutcome()` paints it. Same argument, same shape as
 * {@link ./scm-diff-navigation}.
 *
 * Shaped as a module-level singleton with an explicit listener set, mirroring
 * {@link ./monaco-runtime}, {@link ./editor-service} and
 * {@link ./scm-diff-navigation}, so a popout window and the primary window each
 * publish their own controller and tear it down without leaking a subscription
 * into a store that outlives them.
 */

/** Drives the terminal drawer of whichever window published it. */
export interface TerminalController {
  /** Tabs the drawer currently holds. Zero means no terminal exists yet. */
  terminalCount(): number;
  /** A second pane is showing. The drawer supports exactly two, never three. */
  hasSplit(): boolean;
  /**
   * Spawn a shell, reveal the drawer and focus it.
   *
   * Resolves true only when a tab really appeared. The drawer's spawn helper
   * returns `void` and swallows its failures into an inline error banner, so
   * the publisher has to prove the effect by counting tabs rather than report
   * what the helper told it.
   */
  createTerminal(): Promise<boolean>;
  /**
   * Make sure a second pane is showing.
   *
   * Resolves true when a split is visible afterwards — including when one
   * already was, which is not an error and must not be reported as one:
   * `reportOutcome()` has no informational branch for a handler that succeeded,
   * so "already split" is either a truthful silent success or a lie. False
   * means the drawer genuinely could not produce a second pane.
   *
   * Not a toggle. The drawer's own split button toggles, and routing the menu
   * row through it would make Ctrl+Shift+5 twice leave the user with one pane
   * and no explanation.
   */
  openSplit(): Promise<boolean>;
  /**
   * Bring the tab bound to `ptyId` to the front and focus it.
   *
   * What Terminal > Show Running Tasks… needs: main knows which PTY a run lives
   * in, and only the drawer knows which tab that is. False when no tab owns the
   * id — the terminal was closed after the task started, which is an answer the
   * handler has to be able to say out loud.
   */
  revealTerminal(ptyId: string): boolean;
}

export interface TerminalControllerDisposable {
  dispose(): void;
}

let activeController: TerminalController | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[terminal-controller] a listener failed', error);
    }
  }
}

/**
 * Publish a controller, replacing any current one.
 *
 * Disposing restores the *previous* controller rather than clearing it, so two
 * overlapping surfaces — StrictMode's double mount, or a popout closing over
 * the primary window — leave the command layer pointed at something real
 * instead of at nothing.
 *
 * Registering and disposing both notify listeners, because the tab count is a
 * menu-relevant fact: without a notification the Terminal rows would keep
 * reading the stale count of a drawer that has since unmounted.
 */
export function registerTerminalController(next: TerminalController): TerminalControllerDisposable {
  const previous = activeController;
  activeController = next;
  emit();

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (activeController === next) activeController = previous;
      emit();
    }
  };
}

/** Observe controller changes. Returns an unsubscribe function. */
export function subscribeTerminalController(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------
//
// Defensive on purpose, and the asymmetry with the actions below is deliberate:
// these are read while resolving menu enablement, where a throw would take the
// whole menu bar down over one surface's bug. The actions are not caught, so a
// genuine failure reaches `reportOutcome()` as a visible toast.

/**
 * Tabs the published controller holds, or zero when none is published.
 *
 * Zero is the fail-closed answer: a window with no drawer has no terminal, and
 * a controller that cannot count its tabs has no business claiming otherwise.
 */
export function terminalCount(): number {
  if (!activeController) return 0;
  try {
    const count = activeController.terminalCount();
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch (error) {
    console.warn('[terminal-controller] terminalCount() failed', error);
    return 0;
  }
}

/** Whether a second pane is showing. False when no controller is published. */
export function hasTerminalSplit(): boolean {
  if (!activeController) return false;
  try {
    return activeController.hasSplit() === true;
  } catch (error) {
    console.warn('[terminal-controller] hasSplit() failed', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A drawer is mounted in this window and can be driven. */
export function hasTerminalController(): boolean {
  return activeController !== null;
}

/**
 * Spawn a terminal in the published drawer.
 *
 * Returns false when no drawer is mounted *or* when the spawn did not produce a
 * tab; the caller decides which sentence those deserve, because only it knows
 * which command the user clicked.
 */
export async function createTerminal(): Promise<boolean> {
  if (!activeController) return false;
  return (await activeController.createTerminal()) === true;
}

/** Ensure a second pane is showing. See {@link TerminalController.openSplit}. */
export async function openTerminalSplit(): Promise<boolean> {
  if (!activeController) return false;
  return (await activeController.openSplit()) === true;
}

/** Focus the tab bound to `ptyId`. False when nothing owns it. */
export function revealTerminalPane(ptyId: string): boolean {
  if (!activeController) return false;
  return activeController.revealTerminal(ptyId) === true;
}
