/**
 * Command executor + keybinding matcher tests.
 *
 * The matcher cases deliberately feed the event a *browser* would emit rather
 * than the registry's own spelling: for Ctrl+Shift+5 a US keyboard reports
 * `key: '%'` with `code: 'Digit5'`, and for Ctrl+Shift+P it reports `key: 'P'`.
 * Asserting against the real event shape is what proves the bindings survive
 * contact with a keyboard instead of only with a unit test.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createCommandExecutor,
  createKeybindingMatcher,
  chordMatchesEvent,
  keyCandidatesForEvent,
  type CommandExecutionRecord,
  type CommandExecutor,
  type KeyLikeEvent
} from './command-executor';
import {
  COMMAND_ENTRIES,
  listRequiredHandlers,
  resolveMenu,
  type RegistryRuntimeState
} from './command-registry';
import {
  parseKeyChord,
  type CommandContext,
  type ExecuteCommandResult
} from '../../shared/types/command-registry';

/** Every handler key the shipped table names, for both targets. */
const ALL_HANDLERS: ReadonlySet<string> = new Set([
  ...listRequiredHandlers().renderer,
  ...listRequiredHandlers().main
]);

function fullyTrueContext(): CommandContext {
  const base = {} as Record<string, boolean>;
  for (const key of Object.keys({
    editorOpen: 0, selectionActive: 0, debugSessionActive: 0, debugPaused: 0,
    tasksRunning: 0, diffOrScmChangesOpen: 0, problemsExist: 0, configurationsExist: 0,
    updatersAvailable: 0, workspaceOpen: 0, dirtyEditor: 0, terminalOpen: 0,
    devToolsAllowed: 0, hasSymbolProvider: 0, hasBreakpoints: 0, historyCanGoBack: 0,
    historyCanGoForward: 0, hasRunningTasks: 0, hasOpenTabs: 0
  })) {
    base[key] = true;
  }
  return base as CommandContext;
}

function falseContext(): CommandContext {
  const trueContext = fullyTrueContext();
  const base = {} as Record<string, boolean>;
  for (const key of Object.keys(trueContext)) base[key] = false;
  return base as CommandContext;
}

// ---------------------------------------------------------------------------
// Browser-realistic key events
// ---------------------------------------------------------------------------

/** The character a US layout reports when Shift is held over these keys. */
const US_SHIFTED: Record<string, string> = {
  '5': '%',
  "'": '"',
  '\\': '|',
  '/': '?',
  ',': '<',
  '.': '>',
  ';': ':',
  '[': '{',
  ']': '}',
  '=': '+',
  '-': '_',
  '`': '~'
};

/** Physical key -> `KeyboardEvent.code`, for the keys the table binds. */
const PHYSICAL_CODE: Record<string, string> = {
  "'": 'Quote',
  '\\': 'Backslash',
  '`': 'Backquote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  '=': 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight'
};

function codeForKey(key: string): string {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^F\d+$/.test(key)) return key;
  return PHYSICAL_CODE[key] ?? key;
}

/**
 * Reconstruct the event a US-layout browser emits for one registry chord.
 * Letters arrive upper-cased when Shift is held; punctuation arrives as its
 * shifted glyph, with the physical key only recoverable from `code`.
 */
function eventForChord(chord: string): KeyLikeEvent {
  const parsed = parseKeyChord(chord);
  if (!parsed) throw new Error(`test fixture: cannot parse chord '${chord}'`);
  const code = codeForKey(parsed.key);
  const key = parsed.shift
    ? US_SHIFTED[parsed.key] ?? (/^[a-z]$/.test(parsed.key) ? parsed.key.toUpperCase() : parsed.key)
    : parsed.key;
  return {
    key,
    code,
    ctrlKey: parsed.ctrl,
    shiftKey: parsed.shift,
    altKey: parsed.alt,
    metaKey: parsed.meta
  };
}

/** Events for a whole binding, one per space-separated chord. */
function eventsFor(binding: string): KeyLikeEvent[] {
  return binding.trim().split(/\s+/).map(eventForChord);
}

/** Feed a full binding; returns every match result produced along the way. */
function pressBinding(matcher: ReturnType<typeof createKeybindingMatcher>, binding: string, contexts: Partial<CommandContext>) {
  const state = { availableCommands: ALL_HANDLERS, contexts };
  return eventsFor(binding).map((event) => matcher.match(event, state));
}

// ---------------------------------------------------------------------------
// Execution semantics
// ---------------------------------------------------------------------------

describe('command executor — never pretends to have worked', () => {
  function makeExecutor(): { executor: CommandExecutor; calls: string[] } {
    const calls: string[] = [];
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', (args) => { calls.push(`save:${JSON.stringify(args)}`); return { saved: true }; });
    executor.register('editor.monacoAction', (args) => { calls.push(`monaco:${String(args.actionId)}`); return 'ran'; });
    return { executor, calls };
  }

  it('runs a backed, enabled command and returns its data', async () => {
    const { executor, calls } = makeExecutor();
    const result = await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } });
    expect(result).toMatchObject({ ok: true, commandId: 'file.save', reason: 'ok', data: { saved: true } });
    expect(calls).toEqual(['save:{}']);
  });

  it('reports an unknown command id rather than ignoring it', async () => {
    const { executor } = makeExecutor();
    const result = await executor.execute({ commandId: 'nope.does-not-exist' });
    expect(result).toMatchObject({ ok: false, reason: 'unknown_command' });
    expect(result.error).toContain('nope.does-not-exist');
  });

  it('refuses an entry aimed at the other process', async () => {
    const { executor } = makeExecutor();
    // file.exit targets main; a renderer executor must not run it.
    const result = await executor.execute({ commandId: 'file.exit' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_handler');
    expect(result.error).toContain('main process');
  });

  it('reports disabled with the same sentence the tooltip shows', async () => {
    const { executor } = makeExecutor();
    const result = await executor.execute({ commandId: 'file.save', contexts: falseContext() });
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
    expect(result.error).toBe('No editor is open, so there is nothing to save.');
  });

  it('fails closed when the context snapshot is missing entirely', async () => {
    const { executor } = makeExecutor();
    const result = await executor.execute({ commandId: 'file.save' });
    expect(result.reason).toBe('disabled');
  });

  it('reports a command whose handler was never registered', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    const result = await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } });
    expect(result).toMatchObject({ ok: false, reason: 'no_handler' });
    expect(result.error).toContain('workbench.save');
  });

  it('surfaces a throwing handler instead of swallowing it', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => { throw new Error('disk is full'); });
    const result = await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } });
    expect(result).toMatchObject({ ok: false, reason: 'handler_threw', error: 'disk is full' });
  });

  it('merges declared args with call-site args, call site winning', async () => {
    const { executor, calls } = makeExecutor();
    // go.definition declares { actionId: 'editor.action.revealDefinition' }.
    await executor.execute({ commandId: 'go.definition', contexts: fullyTrueContext() });
    expect(calls).toEqual(['monaco:editor.action.revealDefinition']);

    calls.length = 0;
    await executor.execute({
      commandId: 'go.definition',
      args: { actionId: 'editor.action.goToReferences' },
      contexts: fullyTrueContext()
    });
    expect(calls).toEqual(['monaco:editor.action.goToReferences']);
  });

  it('passes the window id and merged contexts to the handler', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    const seen = vi.fn();
    executor.register('workbench.save', seen);
    await executor.execute({
      commandId: 'file.save',
      windowId: 7,
      contexts: { editorOpen: true }
    });
    expect(seen).toHaveBeenCalledTimes(1);
    const context = seen.mock.calls[0][1];
    expect(context.windowId).toBe(7);
    expect(context.contexts.editorOpen).toBe(true);
    // Untouched keys read false, never undefined, so handlers can branch safely.
    expect(context.contexts.debugPaused).toBe(false);
    expect(context.entry.id).toBe('file.save');
  });

  it('restores the previous handler when a registration is disposed', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => 'first');
    const override = executor.register('workbench.save', () => 'second');
    expect((await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } })).data).toBe('second');
    override.dispose();
    expect((await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } })).data).toBe('first');
  });

  it('lists the handler keys the table still needs', () => {
    const executor = createCommandExecutor({ target: 'main' });
    expect(executor.missingHandlers()).toEqual(listRequiredHandlers().main);
    const disposer = executor.registerAll(
      Object.fromEntries(listRequiredHandlers().main.map((key) => [key, () => undefined]))
    );
    expect(executor.missingHandlers()).toEqual([]);
    disposer.dispose();
    expect(executor.missingHandlers()).toEqual(listRequiredHandlers().main);
  });

  it('keeps an audit ledger of every attempt, capped', async () => {
    const executor = createCommandExecutor({ target: 'renderer', auditLimit: 3 });
    executor.register('workbench.save', () => 'ok');
    await executor.execute({ commandId: 'file.save', contexts: falseContext() });
    await executor.execute({ commandId: 'file.save', contexts: { editorOpen: true } });
    await executor.execute({ commandId: 'nope.nope' });
    await executor.execute({ commandId: 'nope.nope' });

    const trail = executor.auditTrail();
    expect(trail).toHaveLength(3);
    expect(trail.map((record: CommandExecutionRecord) => record.reason)).toEqual([
      'ok',
      'unknown_command',
      'unknown_command'
    ]);
    // Metadata only: the ledger must never retain handler arguments.
    expect(JSON.stringify(trail)).not.toContain('args');
  });
});

describe('command executor — IPC validation gate', () => {
  it('rejects a malformed payload without throwing', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => 'ok');

    const result = await executor.executeValidated({ commandId: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('failed validation');

    const noId = await executor.executeValidated({ args: {} });
    expect(noId).toMatchObject({ ok: false, commandId: '<invalid>' });
  });

  it('rejects an unknown context key instead of ignoring it', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => 'ok');
    // A typo'd context must not quietly pass and leave the command disabled.
    const result = await executor.executeValidated({
      commandId: 'file.save',
      contexts: { editorOpenn: true }
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('failed validation');
  });

  it('accepts a well-formed payload and honours its contexts', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => 'ok');
    const result = await executor.executeValidated({
      commandId: 'file.save',
      contexts: { editorOpen: true }
    });
    expect(result).toMatchObject({ ok: true, data: 'ok' });
  });
});

describe('command executor — dynamic submenu rows', () => {
  const item = {
    id: 'openEditors:file-a',
    label: 'file-a.ts',
    detail: 'src/file-a.ts',
    command: 'editor.switchEditor',
    target: 'renderer' as const,
    args: { tabId: 'file-a' },
    enabled: true
  };

  it('runs the row and passes its args through', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    const seen = vi.fn();
    executor.register('editor.switchEditor', seen);
    const result = await executor.executeDynamic(item, 3);
    expect(result.ok).toBe(true);
    expect(seen.mock.calls[0][0]).toEqual({ tabId: 'file-a' });
    expect(seen.mock.calls[0][1].windowId).toBe(3);
  });

  it('honours the row’s own disabled flag and reason', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('editor.switchEditor', () => 'ran');
    const result = await executor.executeDynamic(
      { ...item, enabled: false, disabledReason: 'That editor is already active.' }
    );
    expect(result).toMatchObject({ ok: false, reason: 'disabled', error: 'That editor is already active.' });
  });

  it('reports a dynamic row whose handler is missing', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    const result = await executor.executeDynamic(item);
    expect(result).toMatchObject({ ok: false, reason: 'no_handler' });
    expect(result.error).toContain('editor.switchEditor');
  });

  it('refuses a dynamic row aimed at the other process', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('task.terminate', () => 'ran');
    const result = await executor.executeDynamic({ ...item, command: 'task.terminate', target: 'main' });
    expect(result).toMatchObject({ ok: false, reason: 'no_handler' });
  });
});

describe('command executor — feeds the resolver so a menu cannot out-run it', () => {
  it('hides exactly the rows this executor could not run', async () => {
    const executor = createCommandExecutor({ target: 'renderer' });
    executor.register('workbench.save', () => 'ok');
    executor.register('workbench.newFile', () => 'ok');

    const state: RegistryRuntimeState = {
      availableCommands: executor.availableCommands(),
      contexts: fullyTrueContext()
    };
    const painted = resolveMenu('File', state).groups.flat().map((row) => row.entry.id);
    expect(painted).toEqual(['file.new-file', 'file.save']);

    // Registering one more handler paints one more row — no component edit.
    executor.register('workbench.closeEditor', () => 'ok');
    const after: RegistryRuntimeState = {
      availableCommands: executor.availableCommands(),
      contexts: fullyTrueContext()
    };
    expect(resolveMenu('File', after).groups.flat().map((row) => row.entry.id)).toContain('file.close-editor');
  });
});

// ---------------------------------------------------------------------------
// Key matching primitives
// ---------------------------------------------------------------------------

describe('key matching primitives', () => {
  it('accepts both the shifted glyph and the physical key', () => {
    expect(keyCandidatesForEvent({ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }))
      .toEqual(expect.arrayContaining(['%', '5']));
  });

  it('matches a letter chord however the browser spells the key', () => {
    // Some layouts report `key: 'P'` for Ctrl+Shift+P, others `key: 'p'`. Both
    // must reach the same chord, so assert on the match rather than on the
    // candidate list, which is free to case-fold internally.
    const chord = parseKeyChord('Ctrl+Shift+P')!;
    for (const key of ['P', 'p']) {
      expect(chordMatchesEvent(chord, { key, code: 'KeyP', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }))
        .toBe(true);
    }
  });

  it('still works when code is unavailable', () => {
    expect(keyCandidatesForEvent({ key: 'p', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }))
      .toEqual(['p']);
  });

  it('requires every modifier to line up', () => {
    const chord = parseKeyChord('Ctrl+Shift+P')!;
    const exact = eventForChord('Ctrl+Shift+P');
    expect(chordMatchesEvent(chord, exact)).toBe(true);
    expect(chordMatchesEvent(chord, { ...exact, shiftKey: false })).toBe(false);
    expect(chordMatchesEvent(chord, { ...exact, altKey: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The keybindings the spec requires
// ---------------------------------------------------------------------------

describe('keybinding matcher — the shortcuts the spec names', () => {
  /**
   * Every binding from Prompt 5 and the 5b checklist, mapped to the command it
   * must reach. `context` supplies the state the binding needs to be live.
   */
  const REQUIRED: { binding: string; commandId: string; context?: Partial<CommandContext> }[] = [
    { binding: 'Ctrl+Shift+P', commandId: 'view.command-palette' },
    { binding: 'Ctrl+`', commandId: 'view.toggle-terminal' },
    { binding: 'Ctrl+P', commandId: 'view.quick-open' },
    { binding: 'Ctrl+G', commandId: 'go.to-line', context: { editorOpen: true } },
    { binding: 'Ctrl+D', commandId: 'selection.add-next-occurrence', context: { editorOpen: true } },
    { binding: 'Ctrl+T', commandId: 'go.to-symbol-in-workspace', context: { editorOpen: true } },
    { binding: 'F12', commandId: 'go.definition', context: { editorOpen: true, hasSymbolProvider: true } },
    { binding: 'Shift+F12', commandId: 'go.references', context: { editorOpen: true, hasSymbolProvider: true } },
    { binding: 'Ctrl+F12', commandId: 'go.implementations', context: { editorOpen: true, hasSymbolProvider: true } },
    { binding: 'Ctrl+Shift+\\', commandId: 'go.to-bracket', context: { editorOpen: true } },
    { binding: 'F8', commandId: 'go.next-problem', context: { editorOpen: true, problemsExist: true } },
    { binding: 'Shift+F8', commandId: 'go.previous-problem', context: { editorOpen: true, problemsExist: true } },
    { binding: 'Alt+F3', commandId: 'go.next-change', context: { editorOpen: true, diffOrScmChangesOpen: true } },
    { binding: 'Shift+Alt+F3', commandId: 'go.previous-change', context: { editorOpen: true, diffOrScmChangesOpen: true } },
    { binding: 'F9', commandId: 'run.toggle-breakpoint', context: { editorOpen: true } },
    { binding: 'F5', commandId: 'run.start-debugging', context: { debugPaused: false } },
    { binding: 'Ctrl+F5', commandId: 'run.run-without-debugging' },
    { binding: 'Shift+F5', commandId: 'run.stop-debugging', context: { debugSessionActive: true } },
    { binding: 'Ctrl+Shift+F5', commandId: 'run.restart-debugging', context: { debugSessionActive: true } },
    { binding: 'F10', commandId: 'run.step-over', context: { debugPaused: true } },
    { binding: 'F11', commandId: 'run.step-into', context: { debugPaused: true } },
    { binding: 'Shift+F11', commandId: 'run.step-out', context: { debugPaused: true } },
    { binding: 'Ctrl+Shift+B', commandId: 'terminal.run-build-task' },
    { binding: "Ctrl+Shift+'", commandId: 'terminal.new' },
    { binding: 'Ctrl+Shift+5', commandId: 'terminal.split' },
    { binding: 'Ctrl+Shift+Alt+\'', commandId: 'terminal.new-window' },
    { binding: 'Alt+LeftArrow', commandId: 'go.back', context: { historyCanGoBack: true } },
    { binding: 'Alt+RightArrow', commandId: 'go.forward', context: { historyCanGoForward: true } },
    { binding: 'Ctrl+K Ctrl+Q', commandId: 'go.last-edit-location', context: { editorOpen: true } },
    { binding: 'Ctrl+,', commandId: 'tycode.preferences' }
  ];

  it.each(REQUIRED.map((entry) => [entry.binding, entry] as const))(
    'fires %s from a browser-realistic event',
    (_binding, spec) => {
      const matcher = createKeybindingMatcher();
      const results = pressBinding(matcher, spec.binding, { ...falseContext(), ...spec.context });
      const last = results[results.length - 1];
      expect(last.kind).toBe('fire');
      if (last.kind === 'fire') expect(last.binding.commandId).toBe(spec.commandId);
    }
  );

  it('routes the shared F5 chord by context, in both directions', () => {
    const matcher = createKeybindingMatcher();
    const idle = pressBinding(matcher, 'F5', { ...falseContext(), debugPaused: false })[0];
    expect(idle).toMatchObject({ kind: 'fire' });
    if (idle.kind === 'fire') expect(idle.binding.commandId).toBe('run.start-debugging');

    const paused = pressBinding(matcher, 'F5', { ...falseContext(), debugPaused: true })[0];
    expect(paused.kind).toBe('fire');
    if (paused.kind === 'fire') expect(paused.binding.commandId).toBe('run.continue');
  });

  it('leaves ordinary typing alone', () => {
    const matcher = createKeybindingMatcher();
    const state = { availableCommands: ALL_HANDLERS, contexts: fullyTrueContext() };
    for (const key of ['a', 'p', 'g', 'd', '5', "'", '\\', ',', 'q', 'k']) {
      expect(matcher.match({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, state).kind)
        .toBe('none');
    }
    // A bare modifier press is not a chord either.
    expect(matcher.match({ key: 'Control', code: 'ControlLeft', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, state).kind)
      .toBe('none');
  });
});

describe('keybinding matcher — chord sequences', () => {
  const contexts = { editorOpen: true };

  it('holds the first chord, then fires on the second', () => {
    const matcher = createKeybindingMatcher();
    const results = pressBinding(matcher, 'Ctrl+K Ctrl+Q', contexts);
    expect(results[0]).toMatchObject({ kind: 'pending', remaining: 1 });
    expect(matcher.isAwaitingChord()).toBe(false); // resolved by the second press
    expect(results[1].kind).toBe('fire');
  });

  it('does not latch a sequence whose only continuation is disabled', () => {
    const onlyLastEdit = COMMAND_ENTRIES.filter((entry) => entry.id === 'go.last-edit-location');
    const matcher = createKeybindingMatcher({ entries: onlyLastEdit });
    const results = pressBinding(matcher, 'Ctrl+K Ctrl+Q', { editorOpen: false });
    expect(results[0].kind).toBe('none');
    expect(matcher.isAwaitingChord()).toBe(false);
  });

  it('keeps a shared prefix live for the continuations that are still enabled', () => {
    // Ctrl+K also owns Open Folder, Save All and Zen Mode, so the prefix must
    // still latch with no editor open — but Ctrl+Q must not run a command
    // gated on an open file.
    const matcher = createKeybindingMatcher();
    const results = pressBinding(matcher, 'Ctrl+K Ctrl+Q', { editorOpen: false });
    expect(results[0]).toMatchObject({ kind: 'pending' });
    expect(results[1].kind).toBe('none');
    expect(matcher.isAwaitingChord()).toBe(false);
  });

  it('cancels on a wrong second chord and lets the key start fresh', () => {
    const matcher = createKeybindingMatcher();
    const state = { availableCommands: ALL_HANDLERS, contexts };
    expect(matcher.match(eventForChord('Ctrl+K'), state)).toMatchObject({ kind: 'pending' });
    expect(matcher.match(eventForChord('Ctrl+P'), state).kind).toBe('none'); // wrong partner, cancels
    // ...and Ctrl+P then binds normally on its own.
    expect(matcher.match(eventForChord('Ctrl+P'), state)).toMatchObject({ kind: 'fire' });
  });

  it('expires a half-typed sequence', () => {
    let clock = 1_000;
    const matcher = createKeybindingMatcher({ chordTimeoutMs: 1500, now: () => clock });
    const state = { availableCommands: ALL_HANDLERS, contexts };
    expect(matcher.match(eventForChord('Ctrl+K'), state).kind).toBe('pending');
    clock += 1600;
    // Too late: the second chord is treated as a fresh press, not a completion.
    expect(matcher.match(eventForChord('Ctrl+Q'), state).kind).toBe('none');
    expect(matcher.isAwaitingChord()).toBe(false);
  });

  it('reset() drops a pending chord', () => {
    const matcher = createKeybindingMatcher();
    const state = { availableCommands: ALL_HANDLERS, contexts };
    matcher.match(eventForChord('Ctrl+K'), state);
    expect(matcher.isAwaitingChord()).toBe(true);
    matcher.reset();
    expect(matcher.isAwaitingChord()).toBe(false);
  });
});

describe('keybinding matcher — hidden beats dead for keys too', () => {
  it('skips a binding whose handler is not registered', () => {
    const matcher = createKeybindingMatcher();
    const unbacked = { availableCommands: new Set<string>(), contexts: fullyTrueContext() };
    expect(matcher.match(eventForChord('Ctrl+Shift+P'), unbacked).kind).toBe('none');

    const backed = { availableCommands: new Set(['workbench.commandPalette']), contexts: fullyTrueContext() };
    expect(matcher.match(eventForChord('Ctrl+Shift+P'), backed).kind).toBe('fire');
  });

  it('skips a binding whose context is false instead of firing a dead command', () => {
    const matcher = createKeybindingMatcher();
    const state = { availableCommands: ALL_HANDLERS, contexts: falseContext() };
    // go.definition needs editorOpen && hasSymbolProvider.
    expect(matcher.match(eventForChord('F12'), state).kind).toBe('none');
  });

  it('honours a custom table passed to the matcher', () => {
    const table = COMMAND_ENTRIES.filter((entry) => entry.id !== 'view.command-palette');
    const matcher = createKeybindingMatcher({ entries: table });
    const state = { availableCommands: ALL_HANDLERS, contexts: fullyTrueContext() };
    expect(matcher.match(eventForChord('Ctrl+Shift+P'), state).kind).toBe('none');
  });
});

describe('command executor — end to end from key press to handler', () => {
  it('dispatches the matched binding through the right executor', async () => {
    const renderer = createCommandExecutor({ target: 'renderer' });
    const main = createCommandExecutor({ target: 'main' });
    const ran: string[] = [];
    // Handlers register under the entry's `command` key, not its id: one
    // Monaco handler backs every go.* row, differentiated by `args.actionId`.
    renderer.register('editor.monacoAction', (args) => { ran.push(`renderer:${String(args.actionId)}`); });
    main.register('window.openProcessExplorer', () => { ran.push('main:process-explorer'); });

    const matcher = createKeybindingMatcher();
    const state = { availableCommands: ALL_HANDLERS, contexts: { editorOpen: true, hasSymbolProvider: true } };
    const matched = matcher.match(eventForChord('F12'), state);
    expect(matched.kind).toBe('fire');
    if (matched.kind !== 'fire') return;

    // The runtime picks the executor named by the entry, so a main-target row
    // clicked in the renderer is forwarded rather than dropped.
    const executor = matched.binding.target === 'main' ? main : renderer;
    const result: ExecuteCommandResult = await executor.execute({
      commandId: matched.binding.commandId,
      args: matched.binding.args,
      contexts: state.contexts
    });
    expect(result.ok).toBe(true);
    expect(ran).toEqual(['renderer:editor.action.revealDefinition']);

    const mainResult = await main.execute({ commandId: 'help.process-explorer' });
    expect(mainResult.ok).toBe(true);
    expect(ran).toContain('main:process-explorer');
    // ...and the renderer executor declines it rather than faking it.
    expect((await renderer.execute({ commandId: 'help.process-explorer' })).reason).toBe('no_handler');
  });
});
