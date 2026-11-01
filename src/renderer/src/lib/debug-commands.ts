/**
 * Run-menu debug command handlers (Prompt 5b, Run menu G1–G6).
 *
 * The registry has carried eighteen `run.*` rows against `debug.*` commands since
 * Prompt 5 and every one of them stayed hidden, because the resolver drops a row
 * whose command has no handler. This module registers seventeen. The eighteenth,
 * `debug.installDebuggers`, is deliberately *not* registered: there is no debugger
 * installer in Ty-Code, and the only honest way to express that is to leave the row
 * invisible rather than paint a click that fails. It is listed in the gap report
 * beside `help.playground` and `workbench.reliabilityPanel`.
 *
 * The rules are the ones {@link ./terminal-commands} established, unchanged: a
 * decline is an answer, args are narrowed rather than assumed, and the bridge is
 * reached through `requireBridgeMethod` so a window without the surface reports the
 * missing capability instead of throwing a TypeError.
 *
 * Five decisions here depart from the obvious reading, so each is recorded.
 *
 *  - **The configuration to launch is chosen here, the process is spawned in
 *    main.** The renderer reads the list only to decide *which* configuration to
 *    name in the start request. The entry file, its arguments and its working
 *    directory are resolved in main, so Run Without Debugging cannot quietly
 *    assemble a different command line from the one Start Debugging would have
 *    run — and cannot hand a launch.json argument list to a shell, which rewrites
 *    quoting and globbing. `noDebug` is a field on the request for exactly that
 *    reason: the only difference between the two rows is the inspector flag.
 *  - **No launch configuration falls back to the file under the cursor, and says
 *    so.** Declining with "add a launch configuration" would be technically true
 *    and useless: the user is looking at a file they want to debug. Running it is
 *    honest as long as the toast names the file that was launched.
 *  - **An empty condition is main's refusal to voice.** The conditional-breakpoint
 *    and logpoint handlers submit `condition`/`logMessage` as `undefined` when the
 *    box was left blank, so the sentence comes from `breakpoint-service.ts` rather
 *    than from a second copy here. Pre-checking would duplicate a rule that can
 *    then drift.
 *  - **Every breakpoint row reports a line number.** No part of the editor paints
 *    a gutter dot yet, so a successful toggle with no toast would be a click whose
 *    effect the user cannot see at all. The summary is the feedback, and it is
 *    derived from the list main actually returned rather than from a count taken
 *    before the call, which a second window could have changed.
 *  - **A cancelled prompt is silence, not a decline.** Dismissing the configuration
 *    picker or the condition box closes a dialog the user watched appear; a toast
 *    saying "cancelled" would narrate something already obvious. Returning nothing
 *    makes the execution a success with no summary, which `reportOutcome` renders
 *    as quiet.
 */

import type { CommandHandler } from '../../../main/services/command-executor';
import type {
  Breakpoint,
  BreakpointToggleRequest,
  DebugConfigurationList,
  DebugSession,
  DebugStartRequest,
  NewBreakpointRequest
} from '../../../preload/types';
import { LAUNCH_DIR_NAME, LAUNCH_FILE_NAME } from '../../../shared/types/debug-session';
import {
  getActiveFilePath,
  getCursorLine
} from '../services/editor-service';
import { useExtensionPromptStore } from '../state/extension-prompt-store';
import {
  NO_EDITOR_OPEN,
  baseName,
  openInTab,
  requireBridgeMethod,
  unwrap
} from './command-ipc';
import { extensionOf } from './terminal-commands';
import { registerRendererCommands, type CommandRuntimeDisposable } from './command-runtime';

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * What a debug session needs before it can attach.
 *
 * Mentions Add Configuration… because that row is the one always visible in the
 * same menu, and pointing at a real row is the difference between a dead end and
 * an instruction.
 */
const NO_LAUNCH_TARGET =
  `Start Debugging needs a program to run. Add Configuration… creates a ${LAUNCH_FILE_NAME} in the ${LAUNCH_DIR_NAME} folder, or put the cursor in a JavaScript or TypeScript file and try again.`;

/** Extensions Node can execute, and therefore the inspector can attach to. */
const DEBUGGABLE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']);

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/** Whatever `.ty-code/launch.json` offered, beside any note about reading it. */
async function readConfigurations(): Promise<DebugConfigurationList> {
  const read = requireBridgeMethod('debugConfigurations', 'Reading the launch configurations');
  return unwrap(await read(), 'Reading the launch configurations');
}

/**
 * Send a session command that takes no argument.
 *
 * `debugRestart` declares its request as optional, so one call site covers the
 * whole family: main keeps the last start request and re-plays it, which is why
 * Restart needs nothing from here. `debugPause` is deliberately absent — no
 * registry row asks for a manual pause, and a helper for an unbound command is
 * the dead surface this file's header exists to forbid.
 */
async function sendSessionCommand(
  method:
    | 'debugStop'
    | 'debugRestart'
    | 'debugResume'
    | 'debugStepOver'
    | 'debugStepInto'
    | 'debugStepOut',
  what: string
): Promise<DebugSession> {
  const call = requireBridgeMethod(method, what);
  return unwrap(await call(), what);
}

/**
 * The four breakpoint edits, each named.
 *
 * One generic `sendBreakpointCommand(method, ...request)` would have needed a cast
 * to call differently-typed payloads through one `keyof` lookup, and a cast here
 * buys nothing: the four request shapes are what the contract declares, so naming
 * them at the call site is the type checking, not a ceremony around it.
 */
async function toggleBreakpoints(request: BreakpointToggleRequest, what: string): Promise<Breakpoint[]> {
  const call = requireBridgeMethod('breakpointsToggle', what);
  return unwrap(await call(request), what);
}

async function addBreakpoint(request: NewBreakpointRequest, what: string): Promise<Breakpoint[]> {
  const call = requireBridgeMethod('breakpointsAdd', what);
  return unwrap(await call(request), what);
}

async function setAllBreakpointsEnabled(enabled: boolean, what: string): Promise<Breakpoint[]> {
  const call = requireBridgeMethod('breakpointsSetEnabled', what);
  return unwrap(await call({ enabled }), what);
}

async function listBreakpointSet(what: string): Promise<Breakpoint[]> {
  const call = requireBridgeMethod('breakpointsList', what);
  return unwrap(await call(), what);
}

async function clearBreakpointSet(what: string): Promise<Breakpoint[]> {
  const call = requireBridgeMethod('breakpointsRemoveAll', what);
  return unwrap(await call(), what);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The file and line a gutter command applies to. */
function cursorTarget(): { filePath: string; lineNumber: number } {
  const filePath = getActiveFilePath();
  if (!filePath) throw new Error(NO_EDITOR_OPEN);
  return { filePath, lineNumber: getCursorLine() };
}

/**
 * Whether a returned list still holds this line.
 *
 * The renderer cannot recompute main's breakpoint id — that would be a second
 * implementation of the normalisation the id is derived from, which is precisely
 * how two spellings of one file end up with two dots. So the check is by line plus
 * a comparison-folded path, and the folding is only ever used for equality, never
 * to build a value that leaves this module.
 */
function holdsLine(list: Breakpoint[], filePath: string, lineNumber: number): boolean {
  const fold = (value: string): string => value.split(/[\\/]/).join('/').toLowerCase();
  const wanted = fold(filePath);
  return list.some((bp) => bp.lineNumber === lineNumber && fold(bp.filePath) === wanted);
}

/** Why this file cannot be handed to Node, or `null` when it can. */
function unddebuggableSentence(filePath: string): string | null {
  const extension = extensionOf(filePath);
  const name = baseName(filePath);
  if (DEBUGGABLE_EXTENSIONS.has(extension)) return null;
  if (!extension) {
    return `'${name}' has no file extension, so Ty-Code cannot tell whether the debugger can run it.`;
  }
  return (
    `'${name}' is a '.${extension}' file, and Ty-Code's debugger attaches to Node, which cannot execute it. ` +
    'Start Debugging works on .js, .mjs, .cjs, .ts, .mts and .cts files.'
  );
}

/** `'Launch entry' (pid 4321)`, the way main described it back to us. */
function sessionSubject(session: DebugSession): string {
  const named = session.configurationLabel
    ? `'${session.configurationLabel}'`
    : session.entryPath
      ? `'${baseName(session.entryPath)}'`
      : 'the program';
  return typeof session.pid === 'number' ? `${named} (pid ${session.pid})` : named;
}

/**
 * Turn the workspace's configurations into a start request.
 *
 * One configuration is passed as an empty request rather than by name: main falls
 * back to the sole entry itself, so naming it here would be a second copy of that
 * resolution rule. Many configurations are the user's choice to make, and none is
 * a `default` field this format defines. Zero configurations fall back to the file
 * under the cursor, which is the thing the user is looking at.
 *
 * Returns `null` when the user dismissed the picker — a cancellation, not a failure.
 */
async function buildStartRequest(): Promise<DebugStartRequest | null> {
  const list = await readConfigurations();

  if (list.configurations.length > 1) {
    const labels = list.configurations.map((config) => config.label);
    const typed = await useExtensionPromptStore
      .getState()
      .requestInput(
        `This workspace has ${labels.length} launch configurations. Type the name of the one to start: ${labels.map((label) => `'${label}'`).join(', ')}.`,
        labels[0],
        'Choose a launch configuration'
      );
    if (typed === undefined) return null;
    const wanted = typed.trim().toLowerCase();
    const match = labels.find((label) => label.toLowerCase() === wanted);
    if (!match) {
      throw new Error(
        `'${typed.trim()}' is not one of this workspace's launch configurations (${labels.map((label) => `'${label}'`).join(', ')}).`
      );
    }
    return { configuration: match };
  }

  if (list.configurations.length === 1) return {};

  const filePath = getActiveFilePath();
  if (!filePath) throw new Error(NO_LAUNCH_TARGET);
  const refusal = unddebuggableSentence(filePath);
  if (refusal) throw new Error(refusal);
  return { entryPath: filePath };
}

/**
 * Launch, either with or without the inspector attached.
 *
 * Both rows share everything except the `noDebug` flag, which is the point of
 * putting them through one function: two handlers that each resolve a configuration
 * are two chances for "Run Without Debugging" to end up running something else.
 */
async function launch(noDebug: boolean, what: string): Promise<{ summary: string } | undefined> {
  const request = await buildStartRequest();
  if (request === null) return undefined;
  const start = requireBridgeMethod('debugStart', what);
  const session = unwrap(await start({ ...request, ...(noDebug ? { noDebug: true } : {}) }), what);
  return {
    summary: noDebug
      ? `Running ${sessionSubject(session)} without a debugger.`
      : `Debugging ${sessionSubject(session)}.`
  };
}

// ---------------------------------------------------------------------------
// G1 — start, stop, restart
// ---------------------------------------------------------------------------

const startDebugging: CommandHandler = () => launch(false, 'Starting the debugger');

const runWithoutDebugging: CommandHandler = () => launch(true, 'Running the program');

const stopDebugging: CommandHandler = async () => {
  await sendSessionCommand('debugStop', 'Stopping the debug session');
  // A sentence rather than silence: stopping has no on-screen effect at all once
  // the menus grey themselves out, and nothing else tells the user the process is
  // gone rather than still running somewhere.
  return { summary: 'Debug session stopped.' };
};

const restartDebugging: CommandHandler = async () => {
  const session = await sendSessionCommand('debugRestart', 'Restarting the debug session');
  // Read from the reply, not from what was asked: a restart of a plainly-running
  // program attaches a debugger, and saying so is the difference between reporting
  // the same relaunch and reporting the change in mode.
  return {
    summary: session.debuggerUrl
      ? `Restarted ${sessionSubject(session)} with the debugger attached.`
      : `Restarted ${sessionSubject(session)} without a debugger.`
  };
};

// ---------------------------------------------------------------------------
// G3 — stepping
// ---------------------------------------------------------------------------

/**
 * Execution-control rows, all silent on success.
 *
 * The visible effect is the caret moving to the line the runtime reported, which
 * the session subscription in {@link ./command-contexts} performs. A toast per
 * F10 would bury that. The pre-checks that keep a stepping command off a running
 * target live in main, so a declined step still arrives as `disabledReason` or as
 * main's own sentence.
 */
const stepOver: CommandHandler = () => sendSessionCommand('debugStepOver', 'Stepping over');
const stepInto: CommandHandler = () => sendSessionCommand('debugStepInto', 'Stepping into');
const stepOut: CommandHandler = () => sendSessionCommand('debugStepOut', 'Stepping out');
const continueExecution: CommandHandler = () => sendSessionCommand('debugResume', 'Resuming execution');

// ---------------------------------------------------------------------------
// G2 — launch configuration files
// ---------------------------------------------------------------------------

/**
 * Open the file that decides what gets debugged.
 *
 * Opens rather than creates, and reports main's parse note if there was one: a
 * launch.json the service could not read is a file the user needs to see, and the
 * note beside it is more actionable than anything written here.
 */
const openConfigurations: CommandHandler = async () => {
  const list = await readConfigurations();
  if (!list.sourcePath) {
    throw new Error(`No folder is open, so there is no ${LAUNCH_FILE_NAME} to show.`);
  }
  await openInTab(list.sourcePath);
  return list.error ? { summary: list.error } : undefined;
};

/**
 * Create the launch configuration, or report the one that already exists.
 *
 * Main never overwrites: appending to a file we did not write is how a menu row
 * destroys someone's debug setup, so an existing file is opened with its own note
 * attached instead. The created-case summary is required, not decorative — a file
 * appearing in a folder the user was not looking at is otherwise invisible.
 */
const addConfiguration: CommandHandler = async () => {
  const add = requireBridgeMethod('debugAddConfiguration', 'Adding a launch configuration');
  const list = unwrap(await add(), 'Adding a launch configuration');
  if (!list.sourcePath) {
    throw new Error('No folder is open, so there is nowhere to put a launch configuration.');
  }
  await openInTab(list.sourcePath);
  return {
    summary:
      list.error ??
      `Created ${LAUNCH_FILE_NAME} with one configuration that runs index.js. Set its "program" to your entry file.`
  };
};

// ---------------------------------------------------------------------------
// G4 — breakpoints
// ---------------------------------------------------------------------------

/**
 * F9: add or remove a breakpoint on the cursor line.
 *
 * Add versus remove is read out of the list main returned rather than counted from
 * a list fetched first, so a second window editing the same set cannot make this
 * one report the wrong verb.
 */
const toggleBreakpoint: CommandHandler = async () => {
  const { filePath, lineNumber } = cursorTarget();
  const list = await toggleBreakpoints({ filePath, lineNumber }, 'Toggling a breakpoint');
  const name = baseName(filePath);
  return {
    summary: holdsLine(list, filePath, lineNumber)
      ? `Breakpoint set at line ${lineNumber} of '${name}'.`
      : `Breakpoint removed from line ${lineNumber} of '${name}'.`
  };
};

/** The palette-shaped half of the submenu parent row. */
const newBreakpoint: CommandHandler = async () => {
  const { filePath, lineNumber } = cursorTarget();
  await addBreakpoint({ filePath, lineNumber, kind: 'unconditional' }, 'Adding a breakpoint');
  return { summary: `Breakpoint set at line ${lineNumber} of '${baseName(filePath)}'.` };
};

/**
 * A breakpoint that stops only when an expression holds.
 *
 * An empty box is sent as no condition at all, which main refuses in its own words
 * — see the third load-bearing decision in this file's header.
 */
const conditionalBreakpoint: CommandHandler = async () => {
  const { filePath, lineNumber } = cursorTarget();
  const typed = await useExtensionPromptStore
    .getState()
    .requestInput(`Break at line ${lineNumber} only when this expression is true:`, '', 'Conditional Breakpoint');
  if (typed === undefined) return undefined;
  const condition = typed.trim();
  await addBreakpoint(
    { filePath, lineNumber, kind: 'conditional', ...(condition ? { condition } : {}) },
    'Adding a conditional breakpoint'
  );
  return { summary: `Conditional breakpoint set at line ${lineNumber} of '${baseName(filePath)}'.` };
};

/** A line that prints instead of stopping. */
const logpoint: CommandHandler = async () => {
  const { filePath, lineNumber } = cursorTarget();
  const typed = await useExtensionPromptStore
    .getState()
    .requestInput(`Print this message when line ${lineNumber} is reached:`, '', 'Logpoint');
  if (typed === undefined) return undefined;
  const logMessage = typed.trim();
  await addBreakpoint(
    { filePath, lineNumber, kind: 'logpoint', ...(logMessage ? { logMessage } : {}) },
    'Adding a logpoint'
  );
  return { summary: `Logpoint set at line ${lineNumber} of '${baseName(filePath)}'.` };
};

// ---------------------------------------------------------------------------
// G5 — the whole set
// ---------------------------------------------------------------------------

/**
 * Enable or disable every breakpoint, and say how many were affected.
 *
 * The count comes from the list returned *after* the change, so it describes the
 * set the user now has. `enable-all` on an already-enabled set is still a success
 * worth one sentence, because the row was clicked and something was expected.
 */
async function enableOrDisableAll(enabled: boolean): Promise<{ summary: string }> {
  const what = enabled ? 'Enabling all breakpoints' : 'Disabling all breakpoints';
  const list = await setAllBreakpointsEnabled(enabled, what);
  const matched = list.filter((bp) => bp.enabled === enabled).length;
  if (matched === 0) {
    return { summary: enabled ? 'There are no breakpoints to enable.' : 'There are no breakpoints to disable.' };
  }
  const already = list.every((bp) => bp.enabled === enabled);
  return {
    summary: already
      ? `All ${matched} breakpoint(s) ${enabled ? 'are enabled' : 'are disabled'}.`
      : `${enabled ? 'Enabled' : 'Disabled'} ${matched} breakpoint(s).`
  };
}

const enableAllBreakpoints: CommandHandler = () => enableOrDisableAll(true);
const disableAllBreakpoints: CommandHandler = () => enableOrDisableAll(false);

/**
 * Delete the whole set.
 *
 * Reads the count first because the response to removing everything is an empty
 * list, which says nothing about what was lost. A click that clears twelve dots
 * should name the twelve.
 */
const removeBreakpoints: CommandHandler = async () => {
  const before = await listBreakpointSet('Reading breakpoints');
  if (before.length === 0) return { summary: 'There are no breakpoints to remove.' };
  await clearBreakpointSet('Removing all breakpoints');
  return { summary: `Removed ${before.length} breakpoint(s).` };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register every Run-menu command this window can perform.
 *
 * Seventeen of the registry's eighteen `debug.*` keys. The missing one is
 * `debug.installDebuggers`, left unregistered on purpose so that
 * `run.install-additional-debuggers` stays hidden: Ty-Code has no debugger
 * installer, and a row that opens nothing is the exact failure mode the Run menu
 * was rebuilt to remove.
 *
 * The two `run.runWithoutDebugging` / `run.start-debugging` rows both need a
 * session, and both are backed even when no folder is open — the decline comes
 * with a sentence naming the row to use instead, which is what makes it a decline
 * rather than a dead click.
 */
export function registerDebugCommandHandlers(): CommandRuntimeDisposable {
  return registerRendererCommands({
    'debug.start': startDebugging,
    'debug.runWithoutDebugging': runWithoutDebugging,
    'debug.stop': stopDebugging,
    'debug.restart': restartDebugging,
    'debug.openConfigurations': openConfigurations,
    'debug.addConfiguration': addConfiguration,
    'debug.stepOver': stepOver,
    'debug.stepInto': stepInto,
    'debug.stepOut': stepOut,
    'debug.continue': continueExecution,
    'debug.toggleBreakpoint': toggleBreakpoint,
    'debug.newBreakpoint': newBreakpoint,
    'debug.conditionalBreakpoint': conditionalBreakpoint,
    'debug.logpoint': logpoint,
    'debug.enableAllBreakpoints': enableAllBreakpoints,
    'debug.disableAllBreakpoints': disableAllBreakpoints,
    'debug.removeAllBreakpoints': removeBreakpoints
  });
}
