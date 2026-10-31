/**
 * Ty-Code Command Executor — turns a registry entry into a real call, or says
 * plainly that it cannot.
 *
 * The registry ({@link ./command-registry}) declares *what* exists; this module
 * is the only place that decides *whether it ran*. Two invariants carry through
 * every branch:
 *
 *  - Hidden > dead. An entry whose handler key was never registered resolves to
 *    `reason: 'no_handler'` and `ok: false`. It is never a silent no-op, and
 *    the menu resolver hides the row so the user should not reach this branch
 *    by clicking. Reaching it means a surface and the runtime disagree, which
 *    is a bug worth reporting, so it is recorded in the audit ledger.
 *  - Greyed = explained. An entry whose `when` clause is false resolves to
 *    `reason: 'disabled'` carrying its `disabledReason` as the error text, so a
 *    caller can show the same sentence the tooltip shows.
 *
 * This module is free of Electron and DOM imports. Adapters are injected, which
 * is what lets the renderer import the very same executor the main process uses
 * (precedent: `config-schemas.ts`), and what lets the tests below run under the
 * plain-Node `vitest.main.config.ts` environment.
 */

import {
  ExecuteCommandPayloadSchema,
  evaluateWhen,
  type CommandContext,
  type CommandEntry,
  type CommandExecutionRecord,
  type CommandTarget,
  type DynamicSubmenuItem,
  type ExecuteCommandPayload,
  type ExecuteCommandResult,
  type KeyChord,
  type RegistryKeybinding
} from '../../shared/types/command-registry';
import {
  COMMAND_ENTRIES,
  emptyContext,
  getCommandEntry,
  listKeybindings,
  type RegistryRuntimeState
} from './command-registry';

/** Anything with a `dispose()`, matching the house pattern for listeners. */
export interface CommandDisposable {
  dispose(): void;
}

/**
 * What a handler is told about the call. `args` is already merged: the entry's
 * declared args first, then any call-site overrides.
 */
export interface CommandHandlerContext {
  entry: CommandEntry;
  args: Record<string, unknown>;
  contexts: Partial<CommandContext>;
  /** Window that originated the call, when the caller knew it. */
  windowId?: number;
}

export type CommandHandler = (
  args: Record<string, unknown>,
  context: CommandHandlerContext
) => unknown | Promise<unknown>;

/**
 * One execution, kept for the diagnostics surface. Metadata only, no args.
 *
 * Re-exported from the shared schema rather than redeclared here: the ledger
 * crosses IPC to the Reliability Panel, and a second definition in this file
 * could drift from the one that validates it on the wire.
 */
export type { CommandExecutionRecord };

export interface CommandExecutorOptions {
  /** This executor only runs entries targeting this process. */
  target: CommandTarget;
  /** Table to resolve against. Defaults to the shipped registry. */
  entries?: readonly CommandEntry[];
  /** Ring-buffer depth for the audit ledger. 0 disables recording. */
  auditLimit?: number;
  /** Injectable clock, so tests can assert on `durationMs` and chord expiry. */
  now?: () => number;
}

export interface CommandExecutor {
  readonly target: CommandTarget;
  /** Register a handler for a command key. Returns a disposer. */
  register(command: string, handler: CommandHandler): CommandDisposable;
  /** Register many at once; one disposer releases all of them. */
  registerAll(handlers: Record<string, CommandHandler>): CommandDisposable;
  has(command: string): boolean;
  /**
   * Handler keys currently registered. This is the set the menu resolver needs
   * for `RegistryRuntimeState.availableCommands`, so a menu can never paint a
   * row this executor could not run.
   */
  availableCommands(): ReadonlySet<string>;
  /**
   * Command keys the table expects for this target that nothing registered.
   * Surfaced in tests and diagnostics so a gap is found here, not by a user
   * staring at a menu that silently dropped a row.
   */
  missingHandlers(): string[];
  /** Execute a payload already known to be well-formed. */
  execute(payload: ExecuteCommandPayload): Promise<ExecuteCommandResult>;
  /** Zod-gate then execute. Use this at every process boundary. */
  executeValidated(payload: unknown): Promise<ExecuteCommandResult>;
  /**
   * Run a row from a dynamic submenu (Switch Editor, Running Tasks, …). Those
   * carry their own command key and args and are not registry entries, so they
   * bypass entry lookup but not the handler lookup.
   */
  executeDynamic(item: DynamicSubmenuItem, windowId?: number): Promise<ExecuteCommandResult>;
  /** Most recent executions, newest last. */
  auditTrail(): readonly CommandExecutionRecord[];
  dispose(): void;
}

const DEFAULT_AUDIT_LIMIT = 200;

/**
 * Build an executor. Handlers are registered by key, never by command id: one
 * handler (`editor.monacoAction`) backs many entries, which is what keeps the
 * table declarative.
 */
export function createCommandExecutor(options: CommandExecutorOptions): CommandExecutor {
  const { target, entries = COMMAND_ENTRIES } = options;
  const auditLimit = options.auditLimit ?? DEFAULT_AUDIT_LIMIT;
  const now = options.now ?? (() => Date.now());

  const handlers = new Map<string, CommandHandler>();
  const ledger: CommandExecutionRecord[] = [];
  let disposed = false;

  const requiredForTarget = (): string[] => {
    const keys = new Set<string>();
    for (const entry of entries) {
      if (entry.target === target) keys.add(entry.command);
    }
    return [...keys].sort();
  };

  const record = (
    startedAt: number,
    commandId: string,
    command: string,
    result: ExecuteCommandResult,
    windowId?: number
  ): ExecuteCommandResult => {
    if (auditLimit > 0) {
      ledger.push({
        at: startedAt,
        commandId,
        command,
        target,
        ok: result.ok,
        reason: result.reason ?? 'ok',
        error: result.error,
        durationMs: Math.max(0, now() - startedAt),
        windowId
      });
      while (ledger.length > auditLimit) ledger.shift();
    }
    return result;
  };

  const runHandler = async (
    handler: CommandHandler,
    entry: CommandEntry,
    args: Record<string, unknown>,
    contexts: Partial<CommandContext>,
    windowId: number | undefined,
    commandId: string
  ): Promise<ExecuteCommandResult> => {
    const startedAt = now();
    try {
      const data = await handler(args, { entry, args, contexts, windowId });
      return record(startedAt, commandId, entry.command, {
        ok: true,
        commandId,
        reason: 'ok',
        data
      }, windowId);
    } catch (err: unknown) {
      // A throwing handler is reported, never swallowed: the whole point of
      // this module is that nothing pretends to have worked.
      return record(startedAt, commandId, entry.command, {
        ok: false,
        commandId,
        reason: 'handler_threw',
        error: err instanceof Error ? err.message : String(err)
      }, windowId);
    }
  };

  const execute = async (payload: ExecuteCommandPayload): Promise<ExecuteCommandResult> => {
    const startedAt = now();
    const { commandId, windowId } = payload;
    const entry = getCommandEntry(commandId, entries);

    if (!entry) {
      return record(startedAt, commandId, '<unknown>', {
        ok: false,
        commandId,
        reason: 'unknown_command',
        error: `'${commandId}' is not a registered command.`
      }, windowId);
    }

    if (entry.target !== target) {
      return record(startedAt, commandId, entry.command, {
        ok: false,
        commandId,
        reason: 'no_handler',
        error: `'${commandId}' targets the ${entry.target} process and cannot run here.`
      }, windowId);
    }

    // Absent keys read false, so an entry gated on a context nobody reported
    // stays disabled instead of firing on a guess.
    const contexts: Partial<CommandContext> = { ...emptyContext(), ...payload.contexts };

    if (!evaluateWhen(entry.when, contexts)) {
      return record(startedAt, commandId, entry.command, {
        ok: false,
        commandId,
        reason: 'disabled',
        error: entry.disabledReason ?? 'Not available right now.'
      }, windowId);
    }

    const handler = handlers.get(entry.command);
    if (!handler) {
      return record(startedAt, commandId, entry.command, {
        ok: false,
        commandId,
        reason: 'no_handler',
        error: `No handler is registered for '${entry.command}', so '${commandId}' is unavailable.`
      }, windowId);
    }

    // Call-site args win over the declaration, so one handler can serve many
    // entries and still be specialised per invocation.
    return runHandler(handler, entry, { ...entry.args, ...payload.args }, contexts, windowId, commandId);
  };

  const executeValidated = async (payload: unknown): Promise<ExecuteCommandResult> => {
    const parsed = ExecuteCommandPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        commandId: typeof (payload as { commandId?: unknown })?.commandId === 'string'
          ? (payload as { commandId: string }).commandId
          : '<invalid>',
        reason: 'unknown_command',
        error: `Command payload failed validation: ${issue ? `${issue.path.join('.') || 'payload'} ${issue.message}` : 'invalid payload'}`
      };
    }
    return execute(parsed.data);
  };

  const executeDynamic = async (
    item: DynamicSubmenuItem,
    windowId?: number
  ): Promise<ExecuteCommandResult> => {
    const startedAt = now();
    if (item.target !== target) {
      return record(startedAt, item.id, item.command, {
        ok: false,
        commandId: item.id,
        reason: 'no_handler',
        error: `'${item.label}' targets the ${item.target} process and cannot run here.`
      }, windowId);
    }
    if (!item.enabled) {
      return record(startedAt, item.id, item.command, {
        ok: false,
        commandId: item.id,
        reason: 'disabled',
        error: item.disabledReason ?? 'Not available right now.'
      }, windowId);
    }
    const handler = handlers.get(item.command);
    if (!handler) {
      return record(startedAt, item.id, item.command, {
        ok: false,
        commandId: item.id,
        reason: 'no_handler',
        error: `No handler is registered for '${item.command}', so '${item.label}' is unavailable.`
      }, windowId);
    }
    // Dynamic rows are produced by a service that already decided enablement,
    // so there is no `when` to re-check — but there is also no registry entry,
    // so a minimal stand-in is passed to keep the handler signature uniform.
    const standIn = {
      id: item.id,
      label: item.label,
      command: item.command,
      target: item.target,
      group: 0,
      visible: true
    } as CommandEntry;
    return runHandler(handler, standIn, { ...item.args }, emptyContext(), windowId, item.id);
  };

  return {
    target,
    register(command, handler) {
      const previous = handlers.get(command);
      handlers.set(command, handler);
      return {
        dispose() {
          // Restore rather than delete, so a nested registration unwinds
          // instead of leaving the command orphaned.
          if (previous) handlers.set(command, previous);
          else handlers.delete(command);
        }
      };
    },
    registerAll(all) {
      const disposers = Object.entries(all).map(([command, handler]) =>
        this.register(command, handler)
      );
      return { dispose() { for (const disposer of disposers) disposer.dispose(); } };
    },
    has(command) {
      return handlers.has(command);
    },
    availableCommands() {
      return new Set(handlers.keys());
    },
    missingHandlers() {
      return requiredForTarget().filter((command) => !handlers.has(command));
    },
    execute,
    executeValidated,
    executeDynamic,
    auditTrail() {
      return [...ledger];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      handlers.clear();
      ledger.length = 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Keybinding matching
// ---------------------------------------------------------------------------

/**
 * The subset of a DOM `KeyboardEvent` the matcher reads. Structural rather than
 * `KeyboardEvent` so the matcher is testable without a DOM and usable from the
 * terminal's custom key handler, which passes a plain object.
 */
export interface KeyLikeEvent {
  key: string;
  /**
   * `KeyboardEvent.code` is the layout-independent physical key. It is what
   * makes shifted punctuation work: for Ctrl+Shift+5 the browser reports
   * `key: '%'` but `code: 'Digit5'`, and the registry binds `5`.
   */
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type KeybindingMatchResult =
  | { kind: 'none' }
  | { kind: 'fire'; binding: RegistryKeybinding }
  | { kind: 'pending'; binding: RegistryKeybinding; remaining: number };

export interface KeybindingMatcher {
  match(
    event: KeyLikeEvent,
    state: Pick<RegistryRuntimeState, 'availableCommands' | 'contexts'>
  ): KeybindingMatchResult;
  /** True while the first chord of a sequence is awaiting its partner. */
  isAwaitingChord(): boolean;
  reset(): void;
}

export interface KeybindingMatcherOptions {
  entries?: readonly CommandEntry[];
  /** How long a half-typed sequence stays live. */
  chordTimeoutMs?: number;
  now?: () => number;
}

/** A sequence prefix expires so a mistyped chord cannot latch forever. */
const DEFAULT_CHORD_TIMEOUT_MS = 1500;

/**
 * Physical key -> the character the registry would name it by. Covers every
 * chord in the table; an unmapped code simply contributes no candidate and the
 * match falls back to `event.key`.
 */
const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: ' ',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown'
};
for (let digit = 0; digit <= 9; digit += 1) CODE_TO_KEY[`Digit${digit}`] = String(digit);
for (let index = 0; index < 26; index += 1) {
  const upper = String.fromCharCode(65 + index);
  CODE_TO_KEY[`Key${upper}`] = upper.toLowerCase();
}
for (let fn = 1; fn <= 24; fn += 1) CODE_TO_KEY[`F${fn}`] = `F${fn}`;

/**
 * Every spelling of the pressed key that could match a registry chord.
 *
 * A browser reports `key: 'P'` for Ctrl+Shift+P and `key: '%'` for
 * Ctrl+Shift+5, while the registry stores lower-case letters and unshifted
 * punctuation. Accepting both the normalised `key` and the `code`-derived
 * character is what lets one table bind correctly on every layout.
 */
export function keyCandidatesForEvent(event: KeyLikeEvent): string[] {
  const candidates = new Set<string>();
  if (typeof event.key === 'string' && event.key.length > 0) {
    candidates.add(/^[A-Z]$/.test(event.key) ? event.key.toLowerCase() : event.key);
  }
  if (event.code) {
    const mapped = CODE_TO_KEY[event.code];
    if (mapped) candidates.add(mapped);
  }
  return [...candidates];
}

/** True when every modifier and the key itself line up with the chord. */
export function chordMatchesEvent(chord: KeyChord, event: KeyLikeEvent): boolean {
  if (chord.ctrl !== Boolean(event.ctrlKey)) return false;
  if (chord.shift !== Boolean(event.shiftKey)) return false;
  if (chord.alt !== Boolean(event.altKey)) return false;
  if (chord.meta !== Boolean(event.metaKey)) return false;
  return keyCandidatesForEvent(event).includes(chord.key);
}

/**
 * A half-typed sequence, carrying every binding still in play.
 *
 * Not a single binding: the table ships four two-chord bindings and three of
 * them share the `Ctrl+K` prefix, so latching one candidate on the first chord
 * would decide the outcome before the user typed anything. Keeping the set is
 * what lets `Ctrl+K Ctrl+Q` survive alongside `Ctrl+K Ctrl+O` and `Ctrl+K Z`.
 */
interface PendingSequence {
  candidates: RegistryKeybinding[];
  /** Index of the chord every candidate must match next. */
  index: number;
  startedAt: number;
}

/**
 * Build the matcher that turns key events into registry commands.
 *
 * Bindings come from `listKeybindings`, so this never re-declares a shortcut.
 * A binding whose handler is not registered is skipped exactly as its menu row
 * is hidden — pressing the key does nothing rather than raising a no_handler
 * error for a command no surface ever showed.
 */
export function createKeybindingMatcher(options: KeybindingMatcherOptions = {}): KeybindingMatcher {
  const bindings = listKeybindings(options.entries ?? COMMAND_ENTRIES);
  const chordTimeoutMs = options.chordTimeoutMs ?? DEFAULT_CHORD_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  let pending: PendingSequence | null = null;

  const isLive = (
    binding: RegistryKeybinding,
    state: Pick<RegistryRuntimeState, 'availableCommands' | 'contexts'>
  ): boolean =>
    state.availableCommands.has(binding.command) && evaluateWhen(binding.when, state.contexts);

  return {
    match(event, state) {
      const nowMs = now();
      if (pending && nowMs - pending.startedAt > chordTimeoutMs) {
        // Far enough past the first chord that the user has moved on: drop the
        // sequence and judge this key as a fresh press instead.
        pending = null;
      }

      // Finish a sequence first: the second chord of Ctrl+K Ctrl+Q must not be
      // reinterpreted as the start of something else.
      if (pending) {
        const chordIndex = pending.index;
        const survivors: RegistryKeybinding[] = [];
        let fired: RegistryKeybinding | undefined;

        for (const binding of pending.candidates) {
          const chord = binding.chords[chordIndex];
          if (!chord || !chordMatchesEvent(chord, event)) continue;
          const next = chordIndex + 1;
          if (next >= binding.chords.length) {
            // Re-check at fire time: the context may have changed between the
            // chords, and a stale sequence must not act on new state. The
            // first completer still live in declaration order wins.
            if (fired === undefined && isLive(binding, state)) fired = binding;
          } else {
            survivors.push(binding);
          }
        }

        pending = null;
        if (fired) return { kind: 'fire', binding: fired };
        if (survivors.length > 0) {
          const remaining = survivors[0].chords.length - (chordIndex + 1);
          pending = { candidates: survivors, index: chordIndex + 1, startedAt: nowMs };
          return { kind: 'pending', binding: survivors[0], remaining };
        }
        // A wrong second chord is a mistype, so swallow it. The user was
        // composing a sequence; falling through to the table would fire
        // whatever unrelated command happens to own that key, which is a
        // surprise action nobody asked for. The next press starts clean.
        return { kind: 'none' };
      }

      let single: RegistryKeybinding | undefined;
      const sequences: RegistryKeybinding[] = [];

      for (const binding of bindings) {
        if (!state.availableCommands.has(binding.command)) continue;
        if (!chordMatchesEvent(binding.chords[0], event)) continue;

        if (binding.chords.length > 1) {
          // Do not latch a sequence for a command that is currently disabled,
          // or the first chord would be swallowed for nothing.
          if (evaluateWhen(binding.when, state.contexts)) sequences.push(binding);
          continue;
        }

        // Several entries may share a chord when each declares a mutually
        // exclusive `when` (F5 is Start Debugging idle, Continue paused). The
        // first enabled owner in declaration order wins, deterministically.
        if (single === undefined && evaluateWhen(binding.when, state.contexts)) single = binding;
      }

      // A sequence claims its prefix: nothing is bound to `Ctrl+K` alone, so
      // latching is the only way its continuations can ever be reached.
      if (sequences.length > 0) {
        pending = { candidates: sequences, index: 1, startedAt: nowMs };
        return { kind: 'pending', binding: sequences[0], remaining: sequences[0].chords.length - 1 };
      }
      if (single) return { kind: 'fire', binding: single };

      return { kind: 'none' };
    },
    isAwaitingChord() {
      return pending !== null;
    },
    reset() {
      pending = null;
    }
  };
}
