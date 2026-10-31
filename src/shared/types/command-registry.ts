/**
 * Ty-Code Command Registry — shared contracts.
 *
 * Prompt 5 / 5b: the registry is the SINGLE SOURCE for both menus and
 * keybindings. This module holds only pure data + validation so that the main
 * process (which executes main-target commands and validates the table at
 * boot) and the renderer (which paints the menu bar and binds keys) import
 * exactly the same shapes with zero Electron or DOM dependencies.
 *
 * Design rules encoded here:
 *  - An entry is hidden unless something can execute it ("hidden > dead").
 *  - An entry that is present but context-disabled MUST carry a
 *    `disabledReason`, because that string becomes the tooltip.
 *  - Keybindings are derived from entries, never declared twice.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** Menu bar order is fixed; every entry names exactly one of these. */
export const COMMAND_MENU_IDS = [
  'File',
  'Edit',
  'Selection',
  'View',
  'Go',
  'Run',
  'Terminal',
  'Help',
  'Ty-Code'
] as const;

export type CommandMenuId = (typeof COMMAND_MENU_IDS)[number];

export const CommandMenuIdSchema = z.enum(COMMAND_MENU_IDS);

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/**
 * Contexts the app provides.
 *
 * The first nine are the contract named by the spec and are evaluated from
 * live app state. The remainder are Ty-Code extensions needed by the base
 * File/Edit/View menus and by "hidden > dead" checks; they follow the same
 * rules and are resolved by the same context runtime.
 */
export const COMMAND_CONTEXT_KEYS = [
  // --- spec-named contexts -------------------------------------------------
  'editorOpen',
  'selectionActive',
  'debugSessionActive',
  'debugPaused',
  'tasksRunning',
  'diffOrScmChangesOpen',
  'problemsExist',
  'configurationsExist',
  'updatersAvailable',
  // --- Ty-Code extensions --------------------------------------------------
  'workspaceOpen',
  'dirtyEditor',
  'terminalOpen',
  'devToolsAllowed',
  'hasSymbolProvider',
  'hasBreakpoints',
  'historyCanGoBack',
  'historyCanGoForward',
  'hasRunningTasks',
  'hasOpenTabs'
] as const;

export type CommandContextKey = (typeof COMMAND_CONTEXT_KEYS)[number];

export const CommandContextKeySchema = z.enum(COMMAND_CONTEXT_KEYS);

/** Every context resolves to a boolean; unknown keys are a validation error. */
export type CommandContext = Record<CommandContextKey, boolean>;

/**
 * A `when` clause is a boolean expression over context keys:
 *   `editorOpen`, `!editorOpen`, `debugSessionActive && debugPaused`,
 *   `problemsExist || diffOrScmChangesOpen`, `(a || b) && !c`.
 * `&&` binds tighter than `||`; parentheses override. An omitted `when`
 * means "always enabled subject to a handler existing".
 */
export const ContextExpressionSchema = z.string().min(1);

export type ContextExpression = z.infer<typeof ContextExpressionSchema>;

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

/**
 * A keybinding string, e.g. `'Ctrl+Shift+P'`, `` 'Ctrl+`' ``, or a chord
 * sequence `'Ctrl+K Ctrl+Q'` (space-separated). Modifiers are normalised to
 * Ctrl/Shift/Alt/Meta; `Cmd` is accepted as an alias for `Meta`.
 */
export const KeybindingSchema = z.string().min(1);

export type Keybinding = z.infer<typeof KeybindingSchema>;

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Lower-cased `KeyboardEvent.key` for letters, otherwise the raw key. */
  key: string;
}

const MODIFIER_TOKENS: Record<string, keyof Omit<KeyChord, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  win: 'meta',
  super: 'meta',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt'
};

/** Canonical single-key names that differ from `KeyboardEvent.key`. */
const KEY_ALIASES: Record<string, string> = {
  leftarrow: 'ArrowLeft',
  rightarrow: 'ArrowRight',
  uparrow: 'ArrowUp',
  downarrow: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  backslash: '\\',
  backtick: '`',
  graveaccent: '`',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: ' ',
  plus: '+',
  minus: '-',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  brackets: '[',
  bracket: '[',
  delete: 'Delete',
  backspace: 'Backspace',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  tab: 'Tab'
};

/**
 * Canonicalise one key token.
 *
 * ASCII letters are lower-cased because `KeyboardEvent.key` reports `'p'` for
 * Ctrl+P but `'P'` for Ctrl+Shift+P; the matcher lower-cases the DOM key too,
 * so both spellings of a binding resolve to the same chord.
 */
function normalizeChordKey(raw: string): string {
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (raw.length === 1) return /^[A-Za-z]$/.test(raw) ? lower : raw;
  // Multi-character names (F5, Tab, PageDown) take the DOM spelling.
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/**
 * Parse one chord of a keybinding. Returns `null` when the chord is empty or
 * contains an unrecognised modifier, so the registry validator can reject it
 * instead of silently binding nothing.
 *
 * A literal plus key is written as a trailing `'++'` (`'Ctrl++'`), because a
 * single trailing `'+'` is a malformed chord rather than a key.
 */
export function parseKeyChord(chord: string): KeyChord | null {
  const trimmed = chord.trim();
  if (!trimmed) return null;

  const literalPlus = trimmed.endsWith('++');
  const body = literalPlus ? trimmed.slice(0, -1) : trimmed;
  const parts = body.split('+').filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  const result: KeyChord = { ctrl: false, shift: false, alt: false, meta: false, key: '' };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();
    const isLast = index === parts.length - 1;
    const modifierKey = MODIFIER_TOKENS[part.toLowerCase()];
    // A single-character final token is always the key, never a modifier, so
    // 'Ctrl+A' cannot be read as two modifiers.
    if (modifierKey && !(isLast && part.length === 1)) {
      result[modifierKey] = true;
      continue;
    }
    if (!isLast) return null;
    result.key = normalizeChordKey(part);
  }

  if (!result.key) {
    if (literalPlus) result.key = '+';
    else return null;
  }
  return result;
}

/** Parse a full keybinding into an ordered chord sequence (1 or 2 chords). */
export function parseKeybinding(binding: Keybinding): KeyChord[] {
  return binding
    .trim()
    .split(/\s+/)
    .filter((chord) => chord.length > 0)
    .map((chord) => parseKeyChord(chord))
    .filter((chord): chord is KeyChord => chord !== null);
}

/** True when every chord of the binding parsed cleanly. */
export function isParsableKeybinding(binding: Keybinding): boolean {
  const chords = binding.trim().split(/\s+/).filter((chord) => chord.length > 0);
  if (chords.length === 0 || chords.length > 2) return false;
  return chords.every((chord) => parseKeyChord(chord) !== null);
}

/**
 * Render a keybinding for display in the menu bar. Kept separate from the
 * parse path so the label always matches what the binding engine matched.
 */
export function formatKeybindingForDisplay(binding: Keybinding, isMac = false): string {
  return binding
    .trim()
    .split(/\s+/)
    .map((chord) =>
      chord
        .split('+')
        .filter((part) => part.length > 0)
        .map((part) => {
          const lower = part.toLowerCase();
          if (lower === 'ctrl' || lower === 'control') return isMac ? '\u2318' : 'Ctrl';
          if (lower === 'cmd' || lower === 'command' || lower === 'meta') return isMac ? '\u2318' : 'Meta';
          if (lower === 'shift') return isMac ? '\u21E7' : 'Shift';
          if (lower === 'alt' || lower === 'option') return isMac ? '\u2325' : 'Alt';
          return part;
        })
        .join(isMac ? '' : '+')
    )
    .join(' ');
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

type ExprNode =
  | { kind: 'key'; key: CommandContextKey }
  | { kind: 'not'; operand: ExprNode }
  | { kind: 'and'; left: ExprNode; right: ExprNode }
  | { kind: 'or'; left: ExprNode; right: ExprNode };

interface Token {
  type: 'ident' | 'and' | 'or' | 'not' | 'lparen' | 'rparen';
  value: string;
}

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === ' ' || char === '\t' || char === '\n') {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      index += 1;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'not', value: '!' });
      index += 1;
      continue;
    }
    if (char === '&' && expression[index + 1] === '&') {
      tokens.push({ type: 'and', value: '&&' });
      index += 2;
      continue;
    }
    if (char === '|' && expression[index + 1] === '|') {
      tokens.push({ type: 'or', value: '||' });
      index += 2;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index));
    if (!match) return null;
    tokens.push({ type: 'ident', value: match[0] });
    index += match[0].length;
  }
  return tokens;
}

/** Recursive-descent parser: orExpr := andExpr ('||' andExpr)* */
function parseExpression(tokens: Token[]): ExprNode | null {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const isContextKey = (value: string): value is CommandContextKey =>
    (COMMAND_CONTEXT_KEYS as readonly string[]).includes(value);

  function parsePrimary(): ExprNode | null {
    const token = peek();
    if (!token) return null;
    if (token.type === 'not') {
      position += 1;
      const operand = parsePrimary();
      return operand ? { kind: 'not', operand } : null;
    }
    if (token.type === 'lparen') {
      position += 1;
      const inner = parseOr();
      const closing = peek();
      if (!closing || closing.type !== 'rparen') return null;
      position += 1;
      return inner;
    }
    if (token.type === 'ident') {
      if (!isContextKey(token.value)) return null;
      position += 1;
      return { kind: 'key', key: token.value };
    }
    return null;
  }

  function parseAnd(): ExprNode | null {
    let left = parsePrimary();
    if (!left) return null;
    while (peek()?.type === 'and') {
      position += 1;
      const right = parsePrimary();
      if (!right) return null;
      left = { kind: 'and', left, right };
    }
    return left;
  }

  function parseOr(): ExprNode | null {
    let left = parseAnd();
    if (!left) return null;
    while (peek()?.type === 'or') {
      position += 1;
      const right = parseAnd();
      if (!right) return null;
      left = { kind: 'or', left, right };
    }
    return left;
  }

  const root = parseOr();
  if (!root || position !== tokens.length) return null;
  return root;
}

const expressionCache = new Map<string, ExprNode | null>();

/**
 * Parse a `when` clause. Returns `null` for malformed expressions or
 * expressions referencing an unknown context key — both are registry
 * validation errors rather than a silent "always true".
 */
export function parseContextExpression(expression: ContextExpression): ExprNode | null {
  const cached = expressionCache.get(expression);
  if (cached !== undefined) return cached;
  const tokens = tokenize(expression);
  const parsed = tokens ? parseExpression(tokens) : null;
  expressionCache.set(expression, parsed);
  return parsed;
}

/** Evaluate a parsed expression against a context. Unknown keys read false. */
export function evaluateExpression(node: ExprNode, context: Partial<CommandContext>): boolean {
  switch (node.kind) {
    case 'key':
      return context[node.key] === true;
    case 'not':
      return !evaluateExpression(node.operand, context);
    case 'and':
      return evaluateExpression(node.left, context) && evaluateExpression(node.right, context);
    case 'or':
      return evaluateExpression(node.left, context) || evaluateExpression(node.right, context);
    default:
      return false;
  }
}

/**
 * Evaluate a `when` string. An absent clause is "always"; an unparsable clause
 * is treated as "never" so a typo hides the item instead of shipping a dead
 * click. Use {@link parseContextExpression} in validation to catch the typo.
 */
export function evaluateWhen(
  expression: ContextExpression | undefined,
  context: Partial<CommandContext>
): boolean {
  if (!expression) return true;
  const parsed = parseContextExpression(expression);
  if (!parsed) return false;
  return evaluateExpression(parsed, context);
}

// ---------------------------------------------------------------------------
// Command entries
// ---------------------------------------------------------------------------

/** Where the handler lives. `main` entries cross IPC; renderer entries do not. */
export const CommandTargetSchema = z.enum(['renderer', 'main']);
export type CommandTarget = z.infer<typeof CommandTargetSchema>;

/**
 * Runtime-populated submenu sources.
 *
 * `submenu` lists static child ids; these sources let the same parent render
 * children that only exist at runtime (open tabs, editor groups, live tasks).
 * The registry still owns the parent entry and its grouping, so adding a menu
 * item remains a single registry change.
 */
export const DYNAMIC_SUBMENU_SOURCES = [
  'openEditors',
  'editorGroups',
  'runningTasks',
  'availableTasks',
  'breakpoints'
] as const;

export type DynamicSubmenuSource = (typeof DYNAMIC_SUBMENU_SOURCES)[number];

export const DynamicSubmenuSourceSchema = z.enum(DYNAMIC_SUBMENU_SOURCES);

/**
 * One synthesised row of a dynamic submenu, already resolved for painting.
 *
 * These are the rows that only exist at runtime — an open tab, a running task,
 * a detected process. `submenu?: string[]` can name static children; these
 * cannot be named until the user looks.
 *
 * A schema rather than an interface because clicking one crosses IPC when it
 * targets main, and an unvalidated `args` bag from a renderer would otherwise
 * reach a handler that trusts it.
 */
export const DynamicSubmenuItemSchema = z.object({
  /** Stable id, namespaced by source so it can never collide with a static id. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** Optional right-aligned detail, e.g. a task's command line. */
  detail: z.string().optional(),
  command: z.string().min(1),
  target: CommandTargetSchema,
  args: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  disabledReason: z.string().optional()
});
export type DynamicSubmenuItem = z.infer<typeof DynamicSubmenuItemSchema>;

export const CommandEntrySchema = z.object({
  /** Stable, dotted id, e.g. `go.definition`. Also the palette id. */
  id: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/, 'Command ids must be dotted lower-case'),
  label: z.string().min(1),
  /** Omit for entries that are only reachable as a submenu child. */
  menu: CommandMenuIdSchema.optional(),
  /** Separator group within the menu, rendered top to bottom. */
  group: z.number().int().min(0).default(0),
  keybinding: KeybindingSchema.optional(),
  when: ContextExpressionSchema.optional(),
  /** Tooltip shown when the item is greyed. Required whenever `when` is set. */
  disabledReason: z.string().optional(),
  /** Child entry ids; a non-empty submenu makes this entry a parent. */
  submenu: z.array(z.string()).optional(),
  /** Runtime-populated children; mutually exclusive with `submenu`. */
  submenuSource: DynamicSubmenuSourceSchema.optional(),
  /**
   * Show another entry's keybinding on this row without owning the binding.
   * Used by the duplicate menu surfaces (e.g. Help > Show All Commands) so a
   * shortcut is still declared exactly once.
   */
  displayKeybindingOf: z.string().optional(),
  target: CommandTargetSchema.default('renderer'),
  /**
   * Handler key. Registry entries never embed a closure, which keeps the
   * table serialisable across IPC and lets the runtime prove a handler exists
   * before the item is shown.
   */
  command: z.string().min(1),
  /** Static arguments forwarded to the handler unchanged. */
  args: z.record(z.string(), z.unknown()).optional(),
  /** Palette category, reused by the command palette grouping. */
  category: z.string().optional(),
  /** Hide the entry entirely (not merely grey it) when false. */
  visible: z.boolean().default(true)
});

export type CommandEntryInput = z.input<typeof CommandEntrySchema>;
export type CommandEntry = z.infer<typeof CommandEntrySchema>;

/** A menu row after context resolution, ready for the renderer to paint. */
export interface ResolvedMenuRow {
  entry: CommandEntry;
  enabled: boolean;
  /** Present exactly when `enabled` is false; becomes the tooltip. */
  disabledReason?: string;
  /** Resolved children, already filtered for hidden and ordered by group. */
  children: ResolvedMenuRow[];
  /** Rows synthesised from `submenuSource`, appended after static children. */
  dynamicChildren: DynamicSubmenuItem[];
  /** Binding text to display, resolved through `displayKeybindingOf`. */
  displayKeybinding?: Keybinding;
}

/** A whole menu after resolution: rows in group order with separators. */
export interface ResolvedMenu {
  menu: CommandMenuId;
  groups: ResolvedMenuRow[][];
}

/** A keybinding derived from the registry — never declared a second time. */
export interface RegistryKeybinding {
  commandId: string;
  binding: Keybinding;
  chords: KeyChord[];
  when?: ContextExpression;
  target: CommandTarget;
  command: string;
  args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// IPC payloads (Zod-validated on the main side)
// ---------------------------------------------------------------------------

/**
 * A partial context snapshot crossing a process boundary.
 *
 * Keyed by the enum rather than `z.record(z.string(), ...)` so an unknown or
 * misspelt context key is a validation error instead of a silently ignored
 * clause — a typo in a `when` expression must not quietly enable a command.
 *
 * `partialRecord` rather than `record` because a sender reports only the keys
 * it can actually observe, and Zod 4's `z.record` over an enum key would
 * demand all nineteen. Unknown keys are still rejected, so the typo guard
 * above survives the relaxation.
 */
export const CommandContextSnapshotSchema = z.partialRecord(
  CommandContextKeySchema,
  z.boolean()
);
export type CommandContextSnapshot = z.infer<typeof CommandContextSnapshotSchema>;

export const ExecuteCommandPayloadSchema = z.object({
  commandId: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  /** Window that originated the click, so main can act on the right window. */
  windowId: z.number().int().optional(),
  /**
   * The originating window's view of the app state.
   *
   * Main-target commands still honour their `when` clause, but main cannot
   * observe renderer state on its own — it has no idea whether an editor is
   * open or a debug session is paused. The sender therefore ships what it
   * knows. Absent keys read as false, which fails closed: a command whose
   * context is unproven stays disabled rather than firing blind.
   */
  contexts: CommandContextSnapshotSchema.optional()
});
export type ExecuteCommandPayload = z.infer<typeof ExecuteCommandPayloadSchema>;

/**
 * Why an execution ended the way it did.
 *
 * One list feeds both the per-call result and the audit ledger, so a reason the
 * UI learns to render can never be missing from the trail that explains it.
 * `no_handler` is the "hidden > dead" tripwire reaching the user.
 */
export const COMMAND_OUTCOME_REASONS = [
  'ok',
  'no_handler',
  'disabled',
  'handler_threw',
  'unknown_command'
] as const;
export const CommandOutcomeReasonSchema = z.enum(COMMAND_OUTCOME_REASONS);
export type CommandOutcomeReason = z.infer<typeof CommandOutcomeReasonSchema>;

export const ExecuteCommandResultSchema = z.object({
  ok: z.boolean(),
  commandId: z.string(),
  reason: CommandOutcomeReasonSchema.optional(),
  error: z.string().optional(),
  /** Optional payload for handlers that return data (e.g. process explorer). */
  data: z.unknown().optional()
});
export type ExecuteCommandResult = z.infer<typeof ExecuteCommandResultSchema>;

/**
 * One row of the execution audit ledger.
 *
 * Kept as a schema rather than an interface because the ledger crosses IPC to
 * the Reliability Panel: "zero dead clicks" is a claim that has to be checkable
 * against what actually ran, so a malformed record must fail loudly instead of
 * reaching a panel that would render it as a healthy execution.
 */
export const CommandExecutionRecordSchema = z.object({
  /** Epoch milliseconds, from the executor's injectable clock. */
  at: z.number(),
  commandId: z.string(),
  /** Handler key that was (or would have been) invoked. */
  command: z.string(),
  target: CommandTargetSchema,
  ok: z.boolean(),
  reason: CommandOutcomeReasonSchema,
  error: z.string().optional(),
  durationMs: z.number(),
  windowId: z.number().int().optional()
});
export type CommandExecutionRecord = z.infer<typeof CommandExecutionRecordSchema>;

/**
 * What only the main process can tell a window about the command table.
 *
 * A renderer resolves menus from the registry it imports directly, so it needs
 * no IPC to paint — but two things it cannot observe itself: contexts that live
 * in main (is an updater wired up, are developer tools permitted, does a launch
 * configuration exist on disk) and which main-target handlers are actually
 * registered. Without the second, a window would paint rows main cannot run,
 * which is exactly the dead click "hidden > dead" forbids.
 */
export const MainCommandContextSchema = z.object({
  /** Main-observable context keys; merged over the window's own snapshot. */
  contexts: CommandContextSnapshotSchema,
  /** Registry `command` keys main has a live handler for. */
  availableCommands: z.array(z.string()),
  /** Registry handler keys main still lacks, surfaced for diagnostics. */
  missingHandlers: z.array(z.string())
});
export type MainCommandContext = z.infer<typeof MainCommandContextSchema>;

/** A click on a runtime-generated submenu row, e.g. one open tab. */
export const ExecuteDynamicSubmenuPayloadSchema = z.object({
  item: DynamicSubmenuItemSchema,
  windowId: z.number().int().optional(),
  /**
   * The window's view of the app state, same contract as
   * {@link ExecuteCommandPayloadSchema}. A dynamic row carries its own
   * `enabled` flag, but the handler it reaches may still be gated.
   */
  contexts: CommandContextSnapshotSchema.optional()
});
export type ExecuteDynamicSubmenuPayload = z.infer<typeof ExecuteDynamicSubmenuPayloadSchema>;

/** Structural problems found while validating the registry table. */
export interface RegistryValidationIssue {
  commandId: string;
  code:
    | 'duplicate_id'
    | 'unknown_submenu_child'
    | 'submenu_self_reference'
    | 'submenu_conflict'
    | 'unparsable_keybinding'
    | 'duplicate_keybinding'
    | 'unknown_keybinding_ref'
    | 'unparsable_when'
    | 'missing_disabled_reason'
    | 'orphan_entry'
    | 'invalid_entry'
    | 'third_party_branding';
  message: string;
}

/**
 * Third-party IDE names that must never appear in a user-facing string.
 * Ty-Code equivalents replace them; the registry validator and the CI guard
 * both read this list so the two can never drift apart.
 *
 * Every name here is a proper noun with no ordinary English meaning in an
 * editor UI, so it is matched case-insensitively as a substring: "vscode",
 * "VSCODE" and "VS Code" are all caught.
 */
export const FORBIDDEN_BRAND_TOKENS = [
  'Qoder',
  'Visual Studio Code',
  'VS Code',
  'VSCode',
  'JetBrains',
  'IntelliJ'
] as const;

/**
 * Product names that are also ordinary English words an editor legitimately
 * needs. "Add Cursor Above" describes a caret, not a competitor, and a
 * disabled reason may say "the cursor line". These are therefore matched
 * case-sensitively as whole words, and a capitalised use is permitted only
 * for an entry listed in {@link BRAND_TOKEN_EXEMPTIONS}.
 */
export const AMBIGUOUS_BRAND_TOKENS = ['Cursor', 'Windsurf', 'Sublime', 'Zed'] as const;

export type AmbiguousBrandToken = (typeof AMBIGUOUS_BRAND_TOKENS)[number];

/** Every guarded product name, for the CI guard and diagnostics. */
export const ALL_BRAND_TOKENS = [...FORBIDDEN_BRAND_TOKENS, ...AMBIGUOUS_BRAND_TOKENS] as const;

/**
 * Audit trail for the ambiguous tokens: command id -> the tokens that entry may
 * use in their plain-English sense. Adding a line here is a deliberate,
 * reviewable decision; a capitalised use that is not listed fails validation,
 * so the guard fails closed for anything new.
 */
export const BRAND_TOKEN_EXEMPTIONS: Readonly<Record<string, readonly AmbiguousBrandToken[]>> = {
  // Title-case labels for the multi-caret commands: "Cursor" here is the text
  // caret, matching the wording users already know.
  'selection.add-cursor-above': ['Cursor'],
  'selection.add-cursor-below': ['Cursor']
};

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the first third-party product name a user-facing string references,
 * or `undefined` when the string is clean.
 *
 * `entryId` narrows the ambiguous tokens: pass it when scanning a registry
 * entry so its justified wording is allowed. Omit it when scanning arbitrary
 * source text, where no exemption can apply and every capitalised product name
 * is a hit.
 */
export function findBrandToken(value: string, entryId?: string): string | undefined {
  const lowered = value.toLowerCase();
  for (const token of FORBIDDEN_BRAND_TOKENS) {
    if (lowered.includes(token.toLowerCase())) return token;
  }

  const exempt = entryId ? BRAND_TOKEN_EXEMPTIONS[entryId] : undefined;
  for (const token of AMBIGUOUS_BRAND_TOKENS) {
    if (exempt?.includes(token)) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegExp(token)}([^A-Za-z0-9]|$)`);
    if (pattern.test(value)) return token;
  }
  return undefined;
}

/**
 * IPC channel names for the command registry.
 *
 * Declared here rather than beside the main-process handlers because the
 * preload bridge needs the same strings and cannot import a module that pulls
 * in `ipcMain`. One definition keeps a rename from silently orphaning a
 * channel: main would register a name nobody invokes, and every click routed
 * through it would reject instead of failing loudly at compile time.
 */
export const COMMAND_CHANNELS = {
  /** Run a registry entry that targets the main process. */
  execute: 'commands:execute',
  /** Run a runtime-generated submenu row that targets the main process. */
  executeDynamic: 'commands:execute-dynamic',
  /** Main-authoritative contexts plus its live/missing handler keys. */
  mainContext: 'commands:main-context',
  /** Bounded execution ledger for the Reliability Panel. */
  audit: 'commands:audit'
} as const;
export type CommandChannel = (typeof COMMAND_CHANNELS)[keyof typeof COMMAND_CHANNELS];

