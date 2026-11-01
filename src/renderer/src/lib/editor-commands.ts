/**
 * Editor, navigation and clipboard command handlers (Prompt 5 / 5b).
 *
 * Every row in the Edit, Selection and Go menus that touches text ends up here.
 * None of them reimplement editor behaviour: the clipboard and multi-cursor ops
 * are forwarded to Monaco's own actions, and the Go-menu jumps are forwarded to
 * the editor service, which is the only thing that knows where the cursor
 * actually was.
 *
 * Two rules shape every handler below.
 *
 *  - **A decline is an answer, not a silence.** The registry greys a row out
 *    with a reason when its `when` context is false, but the world can change
 *    between paint and click — a tab can close, a diff can be discarded, a
 *    group can unmount. When that happens the handler throws with a sentence
 *    that says what is missing, which `reportOutcome()` turns into a visible
 *    toast. A click that does nothing and says nothing is the dead click this
 *    whole exercise exists to remove.
 *  - **Args are narrowed, never assumed.** Registry args cross a Zod
 *    `z.record(z.string(), z.unknown())` boundary, so a handler receives
 *    `unknown` values it did not declare. `stringArg()` converts a malformed
 *    entry into a named failure instead of a `NaN` cursor or a silently
 *    switched-to-undefined tab.
 *
 * This module has no React dependency and reads stores through `getState()`, so
 * the primary window and a popout register the same handlers and each acts on
 * its own window's editor service — which is what Prompt 5 Step 3.3 asks for.
 */

import type { CommandHandler } from '../../../main/services/command-executor';
import {
  focusGroup,
  getEditorServiceState,
  lastEditTarget,
  navigateBack,
  navigateForward,
  nextDiffChange,
  revealDiffChange,
  revealPosition,
  runMonacoAction,
  type NavigationTarget
} from '../services/editor-service';
import { stepScmDiff } from '../services/scm-diff-navigation';
import { undoWorkspaceEditFromEditor } from '../services/workspace-edit-commands';
import { useEditorNavigationStore } from '../state/editor-navigation-store';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { stringArg } from './command-ipc';
import {
  focusedSurface,
  registerRendererCommands,
  setNativeChordPreemption,
  type CommandRuntimeDisposable
} from './command-runtime';

// ---------------------------------------------------------------------------
// Monaco delegation (Edit G3/G4, Selection G1..G4, Go G4/G5/G6)
// ---------------------------------------------------------------------------

/**
 * One handler backs every Monaco-delegated row.
 *
 * The registry carries the action id in the entry's own `args`, so adding a new
 * "Go to X" row is a single declaration and no code here — which is exactly the
 * property Prompt 5's verification checklist asks to be demonstrated.
 */
const monacoAction: CommandHandler = (args) => {
  const actionId = stringArg(args, 'actionId');
  const result = runMonacoAction(actionId);
  if (result.ran) return;

  if (result.failure === 'no-editor') throw new Error('No editor is open.');
  if (result.failure === 'unknown-action') {
    // Monaco does not ship every action in every build, and a language without
    // a provider registers no `goToImplementation`. Say which one is missing
    // rather than reporting a generic failure the user cannot act on.
    throw new Error(`The editor does not provide '${actionId}' in this build.`);
  }
  throw new Error(result.error ?? `The editor action '${actionId}' failed.`);
};

// ---------------------------------------------------------------------------
// Navigation (Go G1)
// ---------------------------------------------------------------------------

/**
 * Land on a navigation target.
 *
 * The history is cross-file, so a target can name a tab that is not the active
 * one. Revealing in that case would move the cursor in the file the user is
 * leaving, so the jump is handed to the navigation store instead: it opens the
 * tab and positions the cursor once the pane has mounted.
 */
function revealTarget(target: NavigationTarget, decline: string): void {
  const snapshot = getEditorServiceState();
  if (target.filePath && target.filePath !== snapshot.filePath) {
    useEditorNavigationStore.getState().navigateTo({
      filePath: target.filePath,
      line: target.lineNumber,
      column: target.column
    });
    return;
  }
  if (!revealPosition({ lineNumber: target.lineNumber, column: target.column })) {
    throw new Error(decline);
  }
}

/**
 * The editor service returns where to go but deliberately does not move the
 * cursor: it cannot know whether the caller wants a reveal in this pane or a
 * tab switch. Both navigation handlers therefore share this shape.
 */
function historyHandler(step: () => NavigationTarget | null, exhausted: string): CommandHandler {
  return () => {
    const target = step();
    if (!target) throw new Error(exhausted);
    revealTarget(target, 'The editor that position belonged to is no longer mounted.');
  };
}

const navigateBackHandler = historyHandler(
  navigateBack,
  'There is no earlier position in the navigation history.'
);

const navigateForwardHandler = historyHandler(
  navigateForward,
  'There is no later position in the navigation history.'
);

/**
 * Go G1's Last Edit Location, backed by the editor service's per-file map.
 *
 * `lastEditTarget()` takes an optional path and defaults to the active file, so
 * a future "last edit in <file>" palette entry needs no new handler.
 */
const gotoLastEditLocation: CommandHandler = () => {
  const target = lastEditTarget();
  if (!target) {
    throw new Error('This file has not been edited in this session, so there is no last edit to return to.');
  }
  revealTarget(target, 'The editor is no longer mounted.');
};

// ---------------------------------------------------------------------------
// Switching (Go G2, driven by the dynamic submenus)
// ---------------------------------------------------------------------------

/**
 * The row's `args.path` comes from `command-contexts.ts`'s `openEditors`
 * submenu, which is republished on every workspace-store change. A submenu can
 * still be painted from a snapshot taken before a tab closed, so the membership
 * check is what turns that race into a sentence instead of a no-op.
 */
const switchEditor: CommandHandler = (args) => {
  const path = stringArg(args, 'path');
  const { openTabs, setActiveTab } = useWorkspaceStore.getState();
  if (!openTabs.some((tab) => tab.path === path)) {
    throw new Error('That editor has since been closed.');
  }
  setActiveTab(path);
};

const switchGroup: CommandHandler = (args) => {
  const groupId = stringArg(args, 'groupId');
  if (!focusGroup(groupId)) throw new Error('That editor group is no longer open.');
};

// ---------------------------------------------------------------------------
// Change navigation (Go G7)
// ---------------------------------------------------------------------------

/**
 * Walk whichever diff is open — the spec's "diff editor when a diff is open,
 * else SCM".
 *
 * The source-control overlay gets first refusal. It publishes a navigator
 * through {@link ../services/scm-diff-navigation} while it is open, and that
 * navigator moves its own `hunkIndex`, which is the index its Stage / Unstage /
 * Revert-hunk buttons act on. Asking the editor service instead would move the
 * cursor over a diff the service has never seen and leave the overlay's index
 * behind — so a following "Revert hunk" would destroy work the user is no
 * longer looking at.
 *
 * The fall-through is the workspace-edit review's diff editor, which *is*
 * registered with the editor service. `nextDiffChange()` reads the hunks Monaco
 * computed for it and wraps at both ends, so repeated Alt+F3 cycles a long diff
 * rather than stopping at the last change. Both halves walk real hunk counts,
 * which is what `diffOrScmChangesOpen` is contributed from: neither surface can
 * enable these rows and then have nothing to step into.
 */
function changeHandler(direction: 1 | -1): CommandHandler {
  const exhausted =
    direction > 0
      ? 'There is no later change in this diff.'
      : 'There is no earlier change in this diff.';
  return () => {
    if (stepScmDiff(direction)) return;
    const target = nextDiffChange(direction);
    if (!target) throw new Error(exhausted);
    if (!revealDiffChange(target)) throw new Error('The diff editor is no longer mounted.');
  };
}

// ---------------------------------------------------------------------------
// Clipboard and undo (Edit G1/G2, Selection G1)
// ---------------------------------------------------------------------------

/** The ops the registry declares on `edit.dispatch`, in menu order. */
const EDIT_OPS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const;
type EditOp = (typeof EDIT_OPS)[number];

/**
 * The Monaco action behind each op.
 *
 * Kept as a table next to the ops rather than inline in a switch so that the
 * mapping is auditable at a glance: the menu, the keybinding and Monaco all end
 * up running the same string, which is the point of delegating at all.
 */
const MONACO_EDIT_ACTIONS: Readonly<Record<EditOp, string>> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction',
  paste: 'editor.action.clipboardPasteAction',
  selectAll: 'editor.action.selectAll'
};

/**
 * What each op is called in a sentence, so a decline reads as English rather
 * than as an identifier lifted out of a table.
 */
const EDIT_OP_NOUNS: Readonly<Record<EditOp, string>> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'select all'
};

/**
 * The terminal keeps its own clipboard keys, and they mean something different
 * from the editor's: Ctrl+C with a selection copies, and without one it is
 * SIGINT. Forwarding a menu click to Monaco would copy editor text the user is
 * not looking at, so the terminal surface is told the truth instead.
 *
 * These strings name the shortcuts `TerminalDrawer` actually binds, verified
 * against its `attachCustomKeyEventHandler` rather than assumed from convention.
 */
const TERMINAL_EDIT_DECLINES: Readonly<Record<EditOp, string>> = {
  undo: 'The terminal has no undo — a command already sent to the shell cannot be taken back.',
  redo: 'The terminal has no redo.',
  cut: 'The terminal has nothing to cut; text written by a program is not editable.',
  copy: 'Select text in the terminal and press Ctrl+C to copy it.',
  paste: 'Click into the terminal and press Ctrl+V to paste into it.',
  selectAll: 'The terminal selects by dragging; there is no select-all.'
};

function editOpArg(args: Record<string, unknown>): EditOp {
  const value = args.op;
  if (typeof value === 'string' && (EDIT_OPS as readonly string[]).includes(value)) {
    return value as EditOp;
  }
  throw new Error(`This command needs an 'op' argument and received '${String(value)}'.`);
}

/**
 * Is the newest thing that happened an agent workspace edit that can still be
 * rolled back?
 *
 * `EditorArea` used to answer this in a capture-phase keydown listener: when it
 * did, Ctrl+Z restored the edited files instead of stepping the cursor back one
 * keystroke. The check lives here now so that retiring that listener in favour
 * of the registry's keybindings does not quietly delete the feature. The
 * revision comparison is what keeps it from firing long after the user has
 * typed over the change.
 */
function canUndoWorkspaceEdit(): boolean {
  const state = useWorkspaceEditStore.getState();
  return (
    Boolean(state.lastAppliedTransactionId) &&
    state.lastAppliedEditorRevision === state.editorRevision
  );
}

/**
 * The one chord Ty-Code takes back from a focused surface.
 *
 * Ctrl+Z with an agent workspace edit still standing has to roll the whole edit
 * back. Monaco's own undo would step the cursor back one keystroke inside a file
 * the agent rewrote, which is not the undo the user meant — so this is a surface
 * that would do something wrong, not merely something different. Everywhere else
 * the chord is left alone and native editing keeps working.
 *
 * The surface test mirrors `editDispatch` because the answer has to agree with
 * what the handler would then do: preempting for a text field would strip that
 * field's own undo and hand it to `document.execCommand`, and the terminal's
 * helper textarea is a plain `<textarea>` that must not read as the editor.
 */
function preemptsNativeChord(command: string, args: Record<string, unknown>): boolean {
  if (command !== 'edit.dispatch' || args.op !== 'undo') return false;
  const surface = focusedSurface();
  if (surface === 'text' || surface === 'terminal') return false;
  return canUndoWorkspaceEdit();
}

/**
 * Route one clipboard/undo op to whatever actually owns the focus.
 *
 * `edit.dispatch` is the one command the global keybinding binder stands aside
 * for, because Ctrl+C in a terminal is SIGINT and Ctrl+A in a form field is not
 * a Monaco selection. That makes this mostly a menu-click handler, and a menu
 * click moves DOM focus to the menu bar — so `focusedSurface()` reporting
 * `'none'` does not mean nothing is editable, only that focus was stolen. With
 * an editor mounted, Monaco is still the right target.
 *
 * The one chord that does arrive from the keyboard is Ctrl+Z with a workspace
 * edit pending, claimed by `preemptsNativeChord` above. It lands here rather
 * than in a second listener so the surface test and the rollback can never
 * disagree about which of them applies.
 */
const editDispatch: CommandHandler = (args) => {
  const op = editOpArg(args);
  const surface = focusedSurface();

  if (surface === 'terminal') throw new Error(TERMINAL_EDIT_DECLINES[op]);

  if (op === 'undo' && surface !== 'text' && canUndoWorkspaceEdit()) {
    // `undoWorkspaceEditFromEditor()` reports its own success and failure
    // toasts, so nothing is returned here: a second toast would be noise, and
    // a fabricated "Undone" would be the canned reply this codebase forbids.
    return undoWorkspaceEditFromEditor();
  }

  if (surface === 'text') {
    // Deprecated, but still the only synchronous way to drive an arbitrary DOM
    // input from a click, and what the previous menu bar used. A field that
    // refuses is reported rather than swallowed.
    if (!document.execCommand(op)) {
      throw new Error(`The focused field refused the ${EDIT_OP_NOUNS[op]} command.`);
    }
    return;
  }

  const result = runMonacoAction(MONACO_EDIT_ACTIONS[op]);
  if (result.ran) return;
  if (result.failure === 'no-editor') {
    throw new Error(`Nothing is focused, so there is nothing to ${EDIT_OP_NOUNS[op]}.`);
  }
  if (result.failure === 'unknown-action') {
    throw new Error(`The editor does not provide '${MONACO_EDIT_ACTIONS[op]}' in this build.`);
  }
  throw new Error(result.error ?? `The ${EDIT_OP_NOUNS[op]} command failed.`);
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register every editor-target command this build can actually perform.
 *
 * Note what is absent: no `debug.*` or `help.*` handler is registered here, so
 * the resolver hides those rows entirely rather than painting a menu item that
 * errors on click. Hidden > dead. The `task.*` and `terminal.*` keys live in
 * `terminal-commands.ts`, which reaches the task bridge rather than the editor.
 *
 * Also installs the Ctrl+Z pre-emption, which is what lets `EditorArea` give up
 * its own capture-phase listener: the chord and the menu row now resolve through
 * this one module instead of two that could disagree.
 */
export function registerEditorCommandHandlers(): CommandRuntimeDisposable {
  const preemption = setNativeChordPreemption(preemptsNativeChord);
  const handlers = registerRendererCommands({
    'edit.dispatch': editDispatch,
    'edit.inline-assist': async () => {
      // Phase 2: dynamically imported so the widget/DOM listener cost is paid
      // only when a user actually presses Ctrl+I on a real selection.
      const { handleInlineAssist } = await import('./inline-assist');
      return handleInlineAssist();
    },
    'editor.monacoAction': monacoAction,
    'editor.navigateBack': navigateBackHandler,
    'editor.navigateForward': navigateForwardHandler,
    'editor.gotoLastEditLocation': gotoLastEditLocation,
    'editor.switchEditor': switchEditor,
    'editor.switchGroup': switchGroup,
    'editor.nextChange': changeHandler(1),
    'editor.previousChange': changeHandler(-1)
  });
  return {
    dispose() {
      handlers.dispose();
      preemption.dispose();
    }
  };
}
