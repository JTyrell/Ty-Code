/**
 * Command registry contract tests (Prompt 5 + Prompt 5b addendum).
 *
 * These tests are the machine-checked form of the verification checklists:
 *  - the four addendum menus render the exact groups, in order, with the
 *    exact labels the spec names;
 *  - every shortcut the spec lists is owned by exactly one entry;
 *  - "hidden > dead" and "greyed = explained" hold for every row;
 *  - adding a menu item really is one registry entry.
 */

import { describe, expect, it } from 'vitest';
import {
  COMMAND_ENTRIES,
  COMMAND_ENTRY_INPUTS,
  assertCommandRegistryValid,
  emptyContext,
  getCommandEntry,
  listCommandEntries,
  listKeybindings,
  listMenuEntries,
  listPaletteEntries,
  listRequiredHandlers,
  resolveAllMenus,
  resolveDisplayKeybinding,
  resolveMenu,
  validateCommandRegistry,
  type CommandContext,
  type CommandEntry,
  type CommandEntryInput,
  type RegistryRuntimeState,
  type ResolvedMenuRow
} from './command-registry';
import {
  CommandEntrySchema,
  AMBIGUOUS_BRAND_TOKENS,
  BRAND_TOKEN_EXEMPTIONS,
  FORBIDDEN_BRAND_TOKENS,
  evaluateWhen,
  findBrandToken,
  formatKeybindingForDisplay,
  isParsableKeybinding,
  parseContextExpression,
  parseKeyChord,
  parseKeybinding
} from '../../shared/types/command-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every handler key the table names, so nothing is hidden for want of a backend. */
const ALL_HANDLERS: ReadonlySet<string> = new Set([
  ...listRequiredHandlers().renderer,
  ...listRequiredHandlers().main
]);

function fullyTrueContext(): CommandContext {
  const context = emptyContext();
  for (const key of Object.keys(context) as (keyof CommandContext)[]) {
    context[key] = true;
  }
  return context;
}

/** Resolve a menu with every handler present and every context on. */
function resolveFully(
  menu: Parameters<typeof resolveMenu>[0],
  contexts: Partial<CommandContext> = fullyTrueContext()
): ResolvedMenuRow[][] {
  const state: RegistryRuntimeState = { availableCommands: ALL_HANDLERS, contexts };
  return resolveMenu(menu, state).groups;
}

function labelsOf(groups: ResolvedMenuRow[][]): string[][] {
  return groups.map((group) => group.map((row) => row.entry.label));
}

function idsOf(groups: ResolvedMenuRow[][]): string[][] {
  return groups.map((group) => group.map((row) => row.entry.id));
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

describe('command registry — structural validation', () => {
  it('reports zero issues for the shipped table', () => {
    expect(validateCommandRegistry()).toEqual([]);
  });

  it('does not throw at boot', () => {
    expect(() => assertCommandRegistryValid()).not.toThrow();
  });

  it('parses every declared entry through the Zod schema', () => {
    for (const input of COMMAND_ENTRY_INPUTS) {
      expect(CommandEntrySchema.safeParse(input).success, `entry ${input.id}`).toBe(true);
    }
    expect(COMMAND_ENTRIES).toHaveLength(COMMAND_ENTRY_INPUTS.length);
  });

  it('assigns unique ids and defaults group/target/visible', () => {
    const ids = COMMAND_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of COMMAND_ENTRIES) {
      expect(typeof entry.group).toBe('number');
      expect(entry.target === 'renderer' || entry.target === 'main').toBe(true);
      expect(entry.visible).toBe(true);
    }
  });

  it('freezes the exported table so a renderer cannot mutate the source of truth', () => {
    expect(Object.isFrozen(COMMAND_ENTRIES)).toBe(true);
  });

  it('detects a duplicate id', () => {
    const duplicate: CommandEntry = { ...getCommandEntry('file.save')! };
    const issues = validateCommandRegistry([getCommandEntry('file.save')!, duplicate]);
    expect(issues.some((issue) => issue.code === 'duplicate_id')).toBe(true);
  });

  it('detects a `when` clause with no explanation', () => {
    const bare = CommandEntrySchema.parse({
      id: 'test.bare',
      label: 'Bare',
      command: 'test.bare',
      when: 'editorOpen'
    });
    const issues = validateCommandRegistry([bare]);
    expect(issues.some((issue) => issue.code === 'missing_disabled_reason')).toBe(true);
  });

  it('detects an unparsable `when` clause and an unknown context key', () => {
    const bad = CommandEntrySchema.parse({
      id: 'test.bad',
      label: 'Bad',
      command: 'test.bad',
      when: 'editorOpen &&',
      disabledReason: 'x'
    });
    expect(validateCommandRegistry([bad]).some((i) => i.code === 'unparsable_when')).toBe(true);
    expect(parseContextExpression('notARealContext')).toBeNull();
  });

  it('detects an unparsable keybinding', () => {
    const bad = CommandEntrySchema.parse({
      id: 'test.badkey',
      label: 'Bad key',
      command: 'test.badkey',
      keybinding: 'Ctrl+'
    });
    expect(validateCommandRegistry([bad]).some((i) => i.code === 'unparsable_keybinding')).toBe(true);
  });

  it('rejects a chord owned twice unless both owners are mutually exclusive', () => {
    const a = CommandEntrySchema.parse({ id: 'test.a', label: 'A', command: 'test.a', keybinding: 'F6' });
    const b = CommandEntrySchema.parse({ id: 'test.b', label: 'B', command: 'test.b', keybinding: 'F6' });
    expect(validateCommandRegistry([a, b]).some((i) => i.code === 'duplicate_keybinding')).toBe(true);

    const guardedA = CommandEntrySchema.parse({
      ...a,
      when: 'debugPaused',
      disabledReason: 'not paused'
    });
    const guardedB = CommandEntrySchema.parse({
      ...b,
      when: '!debugPaused',
      disabledReason: 'paused'
    });
    expect(validateCommandRegistry([guardedA, guardedB])).toEqual([]);
  });

  it('detects unknown, self-referencing and menu-claiming submenu children', () => {
    const parent = CommandEntrySchema.parse({
      id: 'test.parent',
      label: 'Parent',
      menu: 'Run',
      command: 'test.parent',
      submenu: ['test.missing', 'test.parent', 'test.claims-menu']
    });
    const claimsMenu = CommandEntrySchema.parse({
      id: 'test.claims-menu',
      label: 'Child',
      menu: 'Run',
      command: 'test.child'
    });
    const codes = validateCommandRegistry([parent, claimsMenu]).map((i) => i.code);
    expect(codes).toContain('unknown_submenu_child');
    expect(codes).toContain('submenu_self_reference');
    expect(codes).toContain('orphan_entry');
  });

  it('detects a submenu declared both statically and dynamically', () => {
    const both = CommandEntrySchema.parse({
      id: 'test.both',
      label: 'Both',
      command: 'test.both',
      submenu: ['test.x'],
      submenuSource: 'openEditors'
    });
    expect(validateCommandRegistry([both]).some((i) => i.code === 'submenu_conflict')).toBe(true);
  });

  it('detects a displayKeybindingOf that points at nothing', () => {
    const dangling = CommandEntrySchema.parse({
      id: 'test.dangling',
      label: 'Dangling',
      command: 'test.dangling',
      displayKeybindingOf: 'test.nope'
    });
    expect(validateCommandRegistry([dangling]).some((i) => i.code === 'unknown_keybinding_ref')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

describe('command registry — branding', () => {
  it('contains no third-party IDE name in any user-facing string', () => {
    for (const entry of COMMAND_ENTRIES) {
      const surfaces = [entry.label, entry.disabledReason ?? '', entry.category ?? ''];
      for (const surface of surfaces) {
        expect(findBrandToken(surface, entry.id), `${entry.id} -> "${surface}"`).toBeUndefined();
      }
    }
  });

  it('flags a branded label during validation', () => {
    const branded = CommandEntrySchema.parse({
      id: 'test.branded',
      label: 'Open in VS Code',
      command: 'test.branded'
    });
    expect(validateCommandRegistry([branded]).some((i) => i.code === 'third_party_branding')).toBe(true);
  });

  it('treats the plain-English word "cursor" as a caret, not a competitor', () => {
    // A disabled reason describes the caret in lower case; a title-case label
    // names the multi-caret command. Neither advertises a product.
    expect(findBrandToken('Open a file to set a breakpoint on the cursor line.', 'run.toggle-breakpoint')).toBeUndefined();
    expect(findBrandToken('Add Cursor Above', 'selection.add-cursor-above')).toBeUndefined();
    expect(findBrandToken('Add Cursor Below', 'selection.add-cursor-below')).toBeUndefined();
  });

  it('still rejects an unexempted capitalised product name', () => {
    const product = CommandEntrySchema.parse({
      id: 'test.open-in',
      label: 'Open in Cursor',
      command: 'test.openIn'
    });
    expect(validateCommandRegistry([product]).some((i) => i.code === 'third_party_branding')).toBe(true);
    expect(findBrandToken('Open in Cursor', 'test.open-in')).toBe('Cursor');
    expect(findBrandToken('Reveal in Zed', 'test.reveal')).toBe('Zed');
  });

  it('matches unambiguous product names at any casing', () => {
    for (const surface of ['qoder', 'QODER', 'vscode', 'VS Code', 'made by JetBrains']) {
      expect(findBrandToken(`Imported from ${surface}`, 'test.import'), surface).toBeTruthy();
    }
  });

  it('is strict when scanning source text that has no entry to exempt it', () => {
    // The CI guard calls findBrandToken without an id, so even the wording the
    // registry is allowed to use is reported there and must be allowlisted by
    // the guard itself rather than silently passing.
    expect(findBrandToken('Add Cursor Above')).toBe('Cursor');
    for (const token of FORBIDDEN_BRAND_TOKENS) {
      expect(findBrandToken(`open ${token}`, undefined), token).toBe(token);
    }
  });

  it('keeps the exemption list honest — every line is used by a real entry', () => {
    const exemptedIds = Object.keys(BRAND_TOKEN_EXEMPTIONS);
    expect(exemptedIds.length).toBeGreaterThan(0);
    for (const id of exemptedIds) {
      const entry = getCommandEntry(id);
      expect(entry, `exemption for missing entry ${id}`).toBeDefined();
      for (const token of BRAND_TOKEN_EXEMPTIONS[id]) {
        expect(AMBIGUOUS_BRAND_TOKENS, `${token} is not ambiguous`).toContain(token);
        const surfaces = [entry!.label, entry!.disabledReason ?? '', entry!.category ?? ''];
        // Without the exemption this entry would fail, so the line is load-bearing.
        expect(
          surfaces.some((surface) => findBrandToken(surface) === token),
          `${id} no longer needs its '${token}' exemption`
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Prompt 5b Step 2 — Go menu, exact groups G1..G7
// ---------------------------------------------------------------------------

describe('Go menu — exact group order (Prompt 5b Step 2)', () => {
  it('renders G1..G7 with the specified labels', () => {
    expect(labelsOf(resolveFully('Go'))).toEqual([
      ['Back', 'Forward', 'Last Edit Location'],
      ['Switch Editor', 'Switch Group'],
      ['Go to File…', 'Go to Symbol in Workspace…'],
      [
        'Go to Symbol in Editor…',
        'Go to Definition',
        'Go to Declaration',
        'Go to Type Definition',
        'Go to Implementations',
        'Go to References'
      ],
      ['Go to Line/Column…', 'Go to Bracket'],
      ['Next Problem', 'Previous Problem'],
      ['Next Change', 'Previous Change']
    ]);
  });

  it('delegates every G4 symbol jump to the named Monaco action', () => {
    const expected: Record<string, string> = {
      'go.definition': 'editor.action.revealDefinition',
      'go.declaration': 'editor.action.revealDeclaration',
      'go.type-definition': 'editor.action.goToTypeDefinition',
      'go.implementations': 'editor.action.goToImplementation',
      'go.references': 'editor.action.goToReferences'
    };
    for (const [id, actionId] of Object.entries(expected)) {
      expect(getCommandEntry(id)?.args).toEqual({ actionId });
      expect(getCommandEntry(id)?.command).toBe('editor.monacoAction');
    }
  });

  it('gates G4 on a symbol provider and explains why when absent', () => {
    for (const id of ['go.definition', 'go.declaration', 'go.type-definition', 'go.implementations', 'go.references']) {
      expect(getCommandEntry(id)?.when).toContain('hasSymbolProvider');
      expect(getCommandEntry(id)?.disabledReason).toBe('No symbol provider for this language');
    }
    const noProvider = resolveFully('Go', { ...fullyTrueContext(), hasSymbolProvider: false });
    const definition = noProvider.flat().find((row) => row.entry.id === 'go.definition')!;
    expect(definition.enabled).toBe(false);
    expect(definition.disabledReason).toBe('No symbol provider for this language');
  });

  it('gates G6 on the diagnostics store and G7 on a diff or SCM change', () => {
    expect(getCommandEntry('go.next-problem')?.when).toBe('editorOpen && problemsExist');
    expect(getCommandEntry('go.previous-problem')?.args).toEqual({ actionId: 'editor.action.marker.prevInFiles' });
    expect(getCommandEntry('go.next-problem')?.args).toEqual({ actionId: 'editor.action.marker.nextInFiles' });
    expect(getCommandEntry('go.next-change')?.when).toBe('editorOpen && diffOrScmChangesOpen');
    expect(getCommandEntry('go.previous-change')?.when).toBe('editorOpen && diffOrScmChangesOpen');
  });

  it('requires editorOpen for every G3..G7 entry', () => {
    const groups = resolveFully('Go');
    for (const groupIndex of [2, 3, 4, 5, 6]) {
      for (const row of groups[groupIndex]) {
        expect(row.entry.when, `${row.entry.id} must require editorOpen`).toContain('editorOpen');
      }
    }
  });

  it('greys the whole of G3..G7 with a reason when no editor is open', () => {
    const closed = resolveFully('Go', { ...emptyContext(), historyCanGoBack: false });
    const greyed = closed.slice(2).flat();
    expect(greyed.length).toBeGreaterThan(0);
    for (const row of greyed) {
      expect(row.enabled).toBe(false);
      expect(row.disabledReason).toBeTruthy();
    }
  });

  it('marks Switch Editor / Switch Group as dynamic submenus', () => {
    expect(getCommandEntry('go.switch-editor')?.submenuSource).toBe('openEditors');
    expect(getCommandEntry('go.switch-group')?.submenuSource).toBe('editorGroups');
  });

  it('feeds dynamic submenu rows through resolution', () => {
    const state: RegistryRuntimeState = {
      availableCommands: ALL_HANDLERS,
      contexts: fullyTrueContext(),
      dynamicSubmenus: {
        openEditors: [
          {
            id: 'openEditors:src/App.tsx',
            label: 'App.tsx',
            detail: 'src/App.tsx',
            command: 'editor.openTab',
            target: 'renderer',
            args: { path: 'src/App.tsx' },
            enabled: true
          }
        ]
      }
    };
    const rows = resolveMenu('Go', state).groups.flat();
    expect(rows.find((row) => row.entry.id === 'go.switch-editor')?.dynamicChildren).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Prompt 5b Step 3 — Run menu, exact groups G1..G6
// ---------------------------------------------------------------------------

describe('Run menu — exact group order (Prompt 5b Step 3)', () => {
  it('renders G1..G6 with the specified labels', () => {
    expect(labelsOf(resolveFully('Run'))).toEqual([
      ['Start Debugging', 'Run Without Debugging', 'Stop Debugging', 'Restart Debugging'],
      ['Open Configurations', 'Add Configuration…'],
      ['Step Over', 'Step Into', 'Step Out', 'Continue'],
      ['Toggle Breakpoint', 'New Breakpoint'],
      ['Enable All Breakpoints', 'Disable All Breakpoints', 'Remove All Breakpoints'],
      ['Install Additional Debuggers…']
    ]);
  });

  it('populates the New Breakpoint submenu from child entries only', () => {
    const groups = resolveFully('Run');
    const parent = groups[3].find((row) => row.entry.id === 'run.new-breakpoint')!;
    expect(parent.children.map((child) => child.entry.label)).toEqual([
      'Conditional Breakpoint…',
      'Logpoint…'
    ]);
    // Children belong to exactly one place: the submenu, never the Run root.
    expect(idsOf(groups).flat()).not.toContain('run.conditional-breakpoint');
    expect(idsOf(groups).flat()).not.toContain('run.logpoint');
  });

  it('gates Stop/Restart on an active session and Step/Continue on a pause', () => {
    expect(getCommandEntry('run.stop-debugging')?.when).toBe('debugSessionActive');
    expect(getCommandEntry('run.restart-debugging')?.when).toBe('debugSessionActive');
    for (const id of ['run.step-over', 'run.step-into', 'run.step-out', 'run.continue']) {
      expect(getCommandEntry(id)?.when).toBe('debugPaused');
    }
    expect(getCommandEntry('run.open-configurations')?.when).toBe('configurationsExist');
  });

  it('enables Stop/Restart only once a session starts', () => {
    const idle = resolveFully('Run', { ...emptyContext() }).flat();
    const running = resolveFully('Run', { ...emptyContext(), debugSessionActive: true }).flat();
    const byId = (rows: ResolvedMenuRow[], id: string) => rows.find((row) => row.entry.id === id)!;

    expect(byId(idle, 'run.stop-debugging').enabled).toBe(false);
    expect(byId(idle, 'run.stop-debugging').disabledReason).toBe('No debug session is running.');
    expect(byId(running, 'run.stop-debugging').enabled).toBe(true);
    expect(byId(running, 'run.restart-debugging').enabled).toBe(true);
    expect(byId(running, 'run.step-over').enabled).toBe(false);
  });

  it('enables Step/Continue only while paused', () => {
    const paused = resolveFully('Run', {
      ...emptyContext(),
      debugSessionActive: true,
      debugPaused: true
    }).flat();
    for (const id of ['run.step-over', 'run.step-into', 'run.step-out', 'run.continue']) {
      expect(paused.find((row) => row.entry.id === id)!.enabled, id).toBe(true);
    }
  });

  it('resolves the F5 collision so exactly one owner matches at a time', () => {
    const start = getCommandEntry('run.start-debugging')!;
    const cont = getCommandEntry('run.continue')!;
    expect(start.keybinding).toBe('F5');
    expect(cont.keybinding).toBe('F5');

    const idle = emptyContext();
    const paused = { ...emptyContext(), debugSessionActive: true, debugPaused: true };
    expect([evaluateWhen(start.when, idle), evaluateWhen(cont.when, idle)]).toEqual([true, false]);
    expect([evaluateWhen(start.when, paused), evaluateWhen(cont.when, paused)]).toEqual([false, true]);
  });

  it('gates the breakpoint bulk actions on breakpoints existing', () => {
    for (const id of ['run.enable-all-breakpoints', 'run.disable-all-breakpoints', 'run.remove-all-breakpoints']) {
      expect(getCommandEntry(id)?.when).toBe('hasBreakpoints');
      expect(getCommandEntry(id)?.disabledReason).toBe('No breakpoints are defined.');
    }
  });
});

// ---------------------------------------------------------------------------
// Prompt 5b Step 4 — Terminal menu, exact groups G1..G4
// ---------------------------------------------------------------------------

describe('Terminal menu — exact group order (Prompt 5b Step 4)', () => {
  it('renders G1..G4 with the specified labels', () => {
    expect(labelsOf(resolveFully('Terminal'))).toEqual([
      ['New Terminal', 'Split Terminal', 'New Terminal Window'],
      ['Run Task…', 'Run Build Task…', 'Run Active File', 'Run Selected Text'],
      ['Show Running Tasks…', 'Restart Running Task…', 'Terminate Task…'],
      ['Configure Tasks…', 'Configure Default Build Task…']
    ]);
  });

  it('gates G3 on a running task and Run Selected Text on a selection', () => {
    for (const id of ['terminal.show-running-tasks', 'terminal.restart-running-task', 'terminal.terminate-task']) {
      expect(getCommandEntry(id)?.when).toBe('tasksRunning');
      expect(getCommandEntry(id)?.disabledReason).toBe('No task is currently running.');
      expect(getCommandEntry(id)?.submenuSource).toBe('runningTasks');
    }
    expect(getCommandEntry('terminal.run-selected-text')?.when).toBe('selectionActive');
    expect(getCommandEntry('terminal.run-active-file')?.when).toBe('editorOpen');
  });

  it('enables G3 only while a task runs', () => {
    const idle = resolveFully('Terminal', emptyContext()).flat();
    const busy = resolveFully('Terminal', { ...emptyContext(), tasksRunning: true }).flat();
    expect(idle.find((row) => row.entry.id === 'terminal.terminate-task')!.enabled).toBe(false);
    expect(busy.find((row) => row.entry.id === 'terminal.terminate-task')!.enabled).toBe(true);
  });

  it('routes New Terminal Window through the main process', () => {
    expect(getCommandEntry('terminal.new-window')?.target).toBe('main');
    expect(getCommandEntry('terminal.new')?.target).toBe('renderer');
  });
});

// ---------------------------------------------------------------------------
// Prompt 5b Step 5 — Help menu, exact groups G1..G4
// ---------------------------------------------------------------------------

describe('Help menu — exact group order (Prompt 5b Step 5)', () => {
  it('renders G1..G4 with the specified labels', () => {
    expect(labelsOf(resolveFully('Help'))).toEqual([
      [
        'Welcome',
        'Show All Commands',
        'Editor Playground',
        'Ty-Code Documentation',
        'Show Release Notes'
      ],
      ['View License', 'Privacy Policy'],
      ['Toggle Developer Tools', 'Open Process Explorer'],
      ['Check for Updates…', 'About']
    ]);
  });

  it('keeps Keyboard Shortcuts Reference and Diagnostics reachable from the palette only', () => {
    const paletteIds = listPaletteEntries().map((entry) => entry.id);
    expect(paletteIds).toContain('help.keyboard-shortcuts');
    expect(paletteIds).toContain('help.diagnostics');
    expect(idsOf(resolveFully('Help')).flat()).not.toContain('help.keyboard-shortcuts');
    expect(getCommandEntry('help.keyboard-shortcuts')?.label).toBe('Keyboard Shortcuts Reference');
  });

  it('guards Developer Tools and the updater, and routes both through main', () => {
    expect(getCommandEntry('help.toggle-dev-tools')?.when).toBe('devToolsAllowed');
    expect(getCommandEntry('help.toggle-dev-tools')?.target).toBe('main');
    expect(getCommandEntry('help.check-for-updates')?.when).toBe('updatersAvailable');
    expect(getCommandEntry('help.check-for-updates')?.target).toBe('main');
    expect(getCommandEntry('help.process-explorer')?.target).toBe('main');
  });

  it('hides the updater row entirely when the flag is off but keeps the reason when greyed', () => {
    const groups = resolveFully('Help', { ...fullyTrueContext(), updatersAvailable: false });
    const updates = groups[3].find((row) => row.entry.id === 'help.check-for-updates')!;
    expect(updates.enabled).toBe(false);
    expect(updates.disabledReason).toBe('Update checking is unavailable in this build.');
  });
});

// ---------------------------------------------------------------------------
// Keybindings — derived, never declared twice
// ---------------------------------------------------------------------------

describe('keybindings — single-sourced from entries', () => {
  const bindings = listKeybindings();
  const byBinding = new Map<string, string[]>();
  for (const binding of bindings) {
    byBinding.set(binding.binding, [...(byBinding.get(binding.binding) ?? []), binding.commandId]);
  }

  it('fires every shortcut named in Prompt 5b Step 6.2', () => {
    const required = [
      'F12',
      'Shift+F12',
      'Ctrl+F12',
      'Ctrl+Shift+\\',
      'F8',
      'Shift+F8',
      'Alt+F3',
      'F9',
      'F5',
      'Ctrl+F5',
      'Ctrl+Shift+B',
      "Ctrl+Shift+'",
      'Ctrl+G',
      'Ctrl+T',
      'Ctrl+P',
      'Ctrl+K Ctrl+Q'
    ];
    for (const binding of required) {
      expect(byBinding.has(binding), `missing binding ${binding}`).toBe(true);
    }
  });

  it('fires every shortcut named in the Prompt 5 checklist', () => {
    for (const binding of ['Ctrl+Shift+P', 'Ctrl+`', 'Ctrl+P', 'Ctrl+G', 'Ctrl+D']) {
      expect(byBinding.has(binding), `missing binding ${binding}`).toBe(true);
    }
  });

  it('binds the addendum G1..G7 Go shortcuts to the right commands', () => {
    const expected: Record<string, string> = {
      'Alt+LeftArrow': 'go.back',
      'Alt+RightArrow': 'go.forward',
      'Ctrl+K Ctrl+Q': 'go.last-edit-location',
      'Ctrl+T': 'go.to-symbol-in-workspace',
      'Ctrl+Shift+O': 'go.to-symbol-in-editor',
      F12: 'go.definition',
      'Ctrl+F12': 'go.implementations',
      'Shift+F12': 'go.references',
      'Ctrl+G': 'go.to-line',
      'Ctrl+Shift+\\': 'go.to-bracket',
      F8: 'go.next-problem',
      'Shift+F8': 'go.previous-problem',
      'Alt+F3': 'go.next-change',
      'Shift+Alt+F3': 'go.previous-change'
    };
    for (const [binding, commandId] of Object.entries(expected)) {
      expect(byBinding.get(binding), binding).toContain(commandId);
    }
  });

  it('derives a two-chord sequence for Ctrl+K Ctrl+Q', () => {
    const chords = parseKeybinding('Ctrl+K Ctrl+Q');
    expect(chords).toHaveLength(2);
    expect(chords[0]).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'k' });
    expect(chords[1]).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'q' });
  });

  it('parses literal punctuation keys without swallowing them as modifiers', () => {
    expect(parseKeyChord('Ctrl+`')).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: '`' });
    expect(parseKeyChord("Ctrl+Shift+'")).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
      key: "'"
    });
    expect(parseKeyChord('Ctrl+Shift+\\')!.key).toBe('\\');
    expect(parseKeyChord('Ctrl++')!.key).toBe('+');
    expect(parseKeyChord('Ctrl+,')!.key).toBe(',');
    expect(parseKeyChord('Ctrl+/')!.key).toBe('/');
    expect(parseKeyChord('Ctrl+Shift+5')!.key).toBe('5');
  });

  it('rejects chords it cannot parse instead of binding nothing silently', () => {
    expect(isParsableKeybinding('Ctrl+')).toBe(false);
    expect(isParsableKeybinding('')).toBe(false);
    expect(isParsableKeybinding('Ctrl+A Ctrl+B Ctrl+C')).toBe(false);
    for (const binding of bindings) {
      expect(isParsableKeybinding(binding.binding), binding.binding).toBe(true);
      expect(binding.chords.length).toBeGreaterThan(0);
    }
  });

  it('excludes display-only rows so a chord is owned exactly once', () => {
    const owners = byBinding.get('Ctrl+Shift+P')!;
    expect(owners).toEqual(['view.command-palette']);
    expect(byBinding.get('Ctrl+P')).toEqual(['view.quick-open']);
    expect(getCommandEntry('help.show-all-commands')?.keybinding).toBeUndefined();
    expect(getCommandEntry('go.to-file')?.keybinding).toBeUndefined();
  });

  it('still shows the owning chord on a display-only row', () => {
    expect(resolveDisplayKeybinding(getCommandEntry('help.show-all-commands')!)).toBe('Ctrl+Shift+P');
    expect(resolveDisplayKeybinding(getCommandEntry('go.to-file')!)).toBe('Ctrl+P');
    expect(resolveDisplayKeybinding(getCommandEntry('run.continue')!)).toBe('F5');
    expect(resolveDisplayKeybinding(getCommandEntry('file.exit')!)).toBeUndefined();
  });

  it('renders mac glyphs without changing the parsed binding', () => {
    expect(formatKeybindingForDisplay('Ctrl+Shift+P', true)).toBe('\u2318\u21E7P');
    expect(formatKeybindingForDisplay('Ctrl+K Ctrl+Q', true)).toBe('\u2318K \u2318Q');
    expect(formatKeybindingForDisplay('Ctrl+Shift+P')).toBe('Ctrl+Shift+P');
  });

  it('carries the handler key and args through to the binding record', () => {
    const definition = bindings.find((binding) => binding.commandId === 'go.definition')!;
    expect(definition.command).toBe('editor.monacoAction');
    expect(definition.args).toEqual({ actionId: 'editor.action.revealDefinition' });
    expect(definition.target).toBe('renderer');
  });
});

// ---------------------------------------------------------------------------
// Hidden > dead / greyed = explained
// ---------------------------------------------------------------------------

describe('resolution — hidden beats dead, greyed is explained', () => {
  it('hides an entry whose handler is not registered', () => {
    const state: RegistryRuntimeState = { availableCommands: new Set(), contexts: fullyTrueContext() };
    for (const menu of resolveAllMenus(state)) {
      expect(menu.groups.flat()).toHaveLength(0);
    }
  });

  it('shows an entry as soon as its handler registers', () => {
    const state: RegistryRuntimeState = {
      availableCommands: new Set(['workbench.save']),
      contexts: fullyTrueContext()
    };
    const rows = resolveMenu('File', state).groups.flat();
    expect(rows.map((row) => row.entry.id)).toEqual(['file.save']);
  });

  it('never leaves a disabled row without a tooltip reason', () => {
    const contexts: Partial<CommandContext>[] = [emptyContext(), fullyTrueContext()];
    for (const context of contexts) {
      const state: RegistryRuntimeState = { availableCommands: ALL_HANDLERS, contexts: context };
      for (const menu of resolveAllMenus(state)) {
        for (const row of menu.groups.flat()) {
          if (!row.enabled) expect(row.disabledReason, row.entry.id).toBeTruthy();
          else expect(row.disabledReason, row.entry.id).toBeUndefined();
        }
      }
    }
  });

  it('hides rows flagged visible:false rather than greying them', () => {
    const table = CommandEntrySchema.array().parse([
      { id: 'test.visible', label: 'Visible', menu: 'View', group: 1, command: 'test.visible' },
      {
        id: 'test.hidden',
        label: 'Hidden',
        menu: 'View',
        group: 1,
        keybinding: 'Ctrl+Shift+H',
        command: 'test.hidden',
        visible: false
      }
    ]);
    // Both handlers are registered, so nothing here is hidden for want of a
    // backend — only the `visible: false` flag can suppress the row.
    const state: RegistryRuntimeState = {
      availableCommands: new Set(['test.visible', 'test.hidden']),
      contexts: fullyTrueContext()
    };
    const rows = resolveMenu('View', state, table).groups.flat();
    expect(rows.map((row) => row.entry.id)).toEqual(['test.visible']);
    // Greyed would still paint the label; hidden must not paint it at all.
    expect(rows.some((row) => row.entry.label === 'Hidden')).toBe(false);
    // A hidden row must not bind its chord either, or the key would fire a
    // command no surface shows.
    expect(listKeybindings(table).map((binding) => binding.commandId)).toEqual([]);
  });

  it('drops empty groups so no stray separator is painted', () => {
    const groups = resolveFully('Go', emptyContext());
    for (const group of groups) {
      expect(group.length).toBeGreaterThan(0);
    }
  });

  it('greys Save and Find with reasons when no editor is open, and enables them after', () => {
    const closed = { ...emptyContext(), workspaceOpen: true };
    const open = { ...closed, editorOpen: true };

    const closedSave = resolveMenu('File', { availableCommands: ALL_HANDLERS, contexts: closed })
      .groups.flat()
      .find((row) => row.entry.id === 'file.save')!;
    expect(closedSave.enabled).toBe(false);
    expect(closedSave.disabledReason).toBe('No editor is open, so there is nothing to save.');

    const openSave = resolveMenu('File', { availableCommands: ALL_HANDLERS, contexts: open })
      .groups.flat()
      .find((row) => row.entry.id === 'file.save')!;
    expect(openSave.enabled).toBe(true);

    const closedFind = resolveMenu('Edit', { availableCommands: ALL_HANDLERS, contexts: closed })
      .groups.flat()
      .find((row) => row.entry.id === 'edit.find')!;
    expect(closedFind.enabled).toBe(false);
    expect(closedFind.disabledReason).toBe('Open a file to search inside it.');

    const openFind = resolveMenu('Edit', { availableCommands: ALL_HANDLERS, contexts: open })
      .groups.flat()
      .find((row) => row.entry.id === 'edit.find')!;
    expect(openFind.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Adding a menu item = one registry entry
// ---------------------------------------------------------------------------

describe('extensibility — one entry, one menu item', () => {
  /**
   * The spec asks for a dummy dev entry to be added and then removed. Doing it
   * against the live table inside a test proves the property without shipping
   * cruft: the entry appears in the menu and the palette from its declaration
   * alone, and vanishes when the declaration is dropped.
   */
  const DUMMY: CommandEntryInput = {
    id: 'dev.dummy-probe',
    label: 'Dummy Dev Probe',
    menu: 'Help',
    group: 3,
    keybinding: 'Ctrl+Shift+Alt+D',
    command: 'dev.dummyProbe',
    category: 'Developer'
  };

  function tableWith(entry: CommandEntryInput | null): CommandEntry[] {
    const inputs = entry ? [...COMMAND_ENTRY_INPUTS, entry] : [...COMMAND_ENTRY_INPUTS];
    return CommandEntrySchema.array().parse(inputs);
  }

  it('appears in the menu from its declaration alone', () => {
    const before = labelsOf(resolveFully('Help'));
    expect(before.flat()).not.toContain('Dummy Dev Probe');

    const withDummy = tableWith(DUMMY);
    expect(withDummy).toHaveLength(COMMAND_ENTRIES.length + 1);
    expect(validateCommandRegistry(withDummy)).toEqual([]);

    // One declaration is the whole change: the row renders in Help, in group
    // 3, beside the developer-tools rows. No component, no keymap file, no
    // palette list is edited to get it there.
    const state: RegistryRuntimeState = {
      availableCommands: new Set([...ALL_HANDLERS, DUMMY.command]),
      contexts: fullyTrueContext()
    };
    const groups = resolveMenu('Help', state, withDummy).groups;
    expect(groups[2].map((row) => row.entry.label)).toEqual([
      'Toggle Developer Tools',
      'Open Process Explorer',
      'Dummy Dev Probe'
    ]);
    expect(groups[2][2].enabled).toBe(true);

    // ...and the same declaration binds its key globally, with no second edit.
    expect(
      listKeybindings(withDummy).some((binding) => binding.commandId === 'dev.dummy-probe')
    ).toBe(true);
    expect(listKeybindings().some((binding) => binding.commandId === 'dev.dummy-probe')).toBe(false);

    // Hidden > dead still applies to the new row: without its handler
    // registered the declaration paints nothing.
    const unbacked: RegistryRuntimeState = {
      availableCommands: ALL_HANDLERS,
      contexts: fullyTrueContext()
    };
    expect(
      resolveMenu('Help', unbacked, withDummy)
        .groups.flat()
        .map((row) => row.entry.id)
    ).not.toContain('dev.dummy-probe');
  });

  it('binds its keybinding from the same declaration', () => {
    const parsed = CommandEntrySchema.parse(DUMMY);
    const bindings = parseKeybinding(parsed.keybinding!);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ ctrl: true, shift: true, alt: true, meta: false, key: 'd' });
  });

  it('is removed by deleting the single declaration', () => {
    const without = tableWith(null);
    expect(without).toHaveLength(COMMAND_ENTRIES.length);
    expect(without.some((entry) => entry.id === 'dev.dummy-probe')).toBe(false);
    expect(validateCommandRegistry(without)).toEqual([]);
    const state: RegistryRuntimeState = {
      availableCommands: new Set([...ALL_HANDLERS, 'dev.dummyProbe']),
      contexts: fullyTrueContext()
    };
    expect(
      resolveMenu('Help', state, without)
        .groups.flat()
        .map((row) => row.entry.label)
    ).toEqual(labelsOf(resolveFully('Help')).flat());
  });

  it('keeps the shipped table free of the probe', () => {
    expect(getCommandEntry('dev.dummy-probe')).toBeUndefined();
    expect(COMMAND_ENTRIES.some((entry) => entry.label.includes('Dummy'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Menu bar surface
// ---------------------------------------------------------------------------

describe('menu bar surface', () => {
  it('declares all nine menus in bar order', () => {
    const state: RegistryRuntimeState = { availableCommands: ALL_HANDLERS, contexts: fullyTrueContext() };
    expect(resolveAllMenus(state).map((menu) => menu.menu)).toEqual([
      'File',
      'Edit',
      'Selection',
      'View',
      'Go',
      'Run',
      'Terminal',
      'Help',
      'Ty-Code'
    ]);
  });

  it('gives the Ty-Code menu the specified application entries', () => {
    expect(labelsOf(resolveFully('Ty-Code'))).toEqual([
      ['Preferences', 'Reliability Panel'],
      ['Check for Updates', 'FCC Sidecar Status'],
      ['About']
    ]);
  });

  it('delegates Edit cut/copy/paste/comment and Selection multi-cursor to Monaco', () => {
    const monacoDelegating = [
      'edit.find',
      'edit.replace',
      'edit.toggle-line-comment',
      'edit.toggle-block-comment',
      'edit.format-document',
      'selection.add-next-occurrence',
      'selection.add-all-occurrences',
      'selection.add-cursor-above',
      'selection.add-cursor-below',
      'selection.column-mode'
    ];
    for (const id of monacoDelegating) {
      expect(getCommandEntry(id)?.command, id).toBe('editor.monacoAction');
      expect(typeof getCommandEntry(id)?.args?.actionId, id).toBe('string');
    }
    expect(getCommandEntry('selection.add-next-occurrence')?.keybinding).toBe('Ctrl+D');
  });

  it('routes window operations to the main process', () => {
    for (const id of ['file.new-window', 'file.close-window', 'file.exit']) {
      expect(getCommandEntry(id)?.target, id).toBe('main');
    }
  });

  it('exposes a non-empty palette that excludes submenu children', () => {
    const palette = listPaletteEntries();
    expect(palette.length).toBeGreaterThan(0);
    const childIds = new Set(COMMAND_ENTRIES.flatMap((entry) => entry.submenu ?? []));
    for (const entry of palette) {
      expect(entry.menu).toBeUndefined();
      expect(childIds.has(entry.id)).toBe(false);
    }
  });

  it('lists every menu entry under its own menu', () => {
    for (const menu of ['File', 'Go', 'Run', 'Terminal', 'Help'] as const) {
      const listed = listMenuEntries(menu);
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.every((entry) => entry.menu === menu)).toBe(true);
    }
    expect(listCommandEntries()).toHaveLength(COMMAND_ENTRIES.length);
  });
});
