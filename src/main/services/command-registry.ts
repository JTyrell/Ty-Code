/**
 * Ty-Code Command Registry — the single source of truth for menus AND
 * keybindings (Prompt 5 + Prompt 5b addendum).
 *
 * Every menu row, every separator group, every shortcut and every enablement
 * rule is declared once, here. The renderer paints the menu bar from this
 * table and binds global keys from this same table; the main process executes
 * `target: 'main'` handlers and validates the table at boot.
 *
 * Adding a menu item is exactly one entry in {@link COMMAND_ENTRIES}. The
 * structural validator ({@link validateCommandRegistry}) plus the registry
 * tests prove that property, and the CI branding guard proves no third-party
 * IDE name reaches a user-facing string.
 *
 * Two rules shape the whole table:
 *  - Hidden > dead: an entry with no registered handler is filtered out at
 *    render time rather than shown as a no-op click.
 *  - Greyed = explained: any entry with a `when` clause also carries a
 *    `disabledReason`, because that string becomes the tooltip.
 *
 * This module is intentionally free of Electron and DOM imports so the
 * renderer can import it directly (same precedent as `config-schemas.ts`).
 */

import { z } from 'zod';
import {
  COMMAND_MENU_IDS,
  CommandEntrySchema,
  evaluateWhen,
  findBrandToken,
  formatKeybindingForDisplay,
  isParsableKeybinding,
  parseContextExpression,
  parseKeybinding,
  type CommandContext,
  type CommandEntry,
  type CommandEntryInput,
  type CommandMenuId,
  type DynamicSubmenuItem,
  type DynamicSubmenuSource,
  type RegistryKeybinding,
  type RegistryValidationIssue,
  type ResolvedMenu,
  type ResolvedMenuRow
} from '../../shared/types/command-registry';

export {
  COMMAND_MENU_IDS,
  COMMAND_CONTEXT_KEYS,
  ALL_BRAND_TOKENS,
  AMBIGUOUS_BRAND_TOKENS,
  BRAND_TOKEN_EXEMPTIONS,
  FORBIDDEN_BRAND_TOKENS,
  evaluateWhen,
  findBrandToken,
  formatKeybindingForDisplay,
  parseContextExpression,
  parseKeybinding
} from '../../shared/types/command-registry';

export type {
  AmbiguousBrandToken,
  CommandContext,
  CommandContextKey,
  CommandEntry,
  CommandEntryInput,
  CommandMenuId,
  CommandTarget,
  DynamicSubmenuItem,
  DynamicSubmenuSource,
  KeyChord,
  RegistryKeybinding,
  RegistryValidationIssue,
  ResolvedMenu,
  ResolvedMenuRow
} from '../../shared/types/command-registry';

// ---------------------------------------------------------------------------
// Entry table
// ---------------------------------------------------------------------------

/**
 * The complete menu table.
 *
 * `command` is a handler key, never a closure: that keeps the table
 * serialisable across IPC and lets the runtime prove a handler exists before
 * the row is shown. Renderer handlers live in
 * `src/renderer/src/lib/command-runtime.ts`; main handlers live in
 * `src/main/ipc/command-handlers.ts`.
 */
export const COMMAND_ENTRY_INPUTS: CommandEntryInput[] = [
  // =========================================================================
  // File
  // =========================================================================
  { id: 'file.new-file', label: 'New File', menu: 'File', group: 1, keybinding: 'Ctrl+N', command: 'workbench.newFile', category: 'File' },
  { id: 'file.new-window', label: 'New Window', menu: 'File', group: 1, keybinding: 'Ctrl+Shift+N', target: 'main', command: 'window.newWindow', category: 'File' },
  { id: 'file.open-file', label: 'Open File…', menu: 'File', group: 2, keybinding: 'Ctrl+O', command: 'workbench.openFile', category: 'File' },
  { id: 'file.open-folder', label: 'Open Folder…', menu: 'File', group: 2, keybinding: 'Ctrl+K Ctrl+O', command: 'workbench.openFolder', category: 'File' },
  { id: 'file.save', label: 'Save', menu: 'File', group: 3, keybinding: 'Ctrl+S', when: 'editorOpen', disabledReason: 'No editor is open, so there is nothing to save.', command: 'workbench.save', category: 'File' },
  { id: 'file.save-as', label: 'Save As…', menu: 'File', group: 3, keybinding: 'Ctrl+Shift+S', when: 'editorOpen', disabledReason: 'No editor is open, so there is nothing to save.', command: 'workbench.saveAs', category: 'File' },
  { id: 'file.save-all', label: 'Save All', menu: 'File', group: 3, keybinding: 'Ctrl+K S', when: 'dirtyEditor', disabledReason: 'No open editor has unsaved changes.', command: 'workbench.saveAll', category: 'File' },
  { id: 'file.close-editor', label: 'Close Editor', menu: 'File', group: 4, keybinding: 'Ctrl+W', when: 'editorOpen', disabledReason: 'No editor is open.', command: 'workbench.closeEditor', category: 'File' },
  { id: 'file.close-window', label: 'Close Window', menu: 'File', group: 4, keybinding: 'Alt+F4', target: 'main', command: 'window.close', category: 'File' },
  { id: 'file.exit', label: 'Exit', menu: 'File', group: 5, target: 'main', command: 'app.quit', category: 'File' },

  // =========================================================================
  // Edit — every operation delegates to Monaco when an editor is focused, so
  // the behaviour matches editor semantics rather than the DOM.
  // =========================================================================
  { id: 'edit.undo', label: 'Undo', menu: 'Edit', group: 1, keybinding: 'Ctrl+Z', command: 'edit.dispatch', args: { op: 'undo' }, category: 'Edit' },
  { id: 'edit.redo', label: 'Redo', menu: 'Edit', group: 1, keybinding: 'Ctrl+Y', command: 'edit.dispatch', args: { op: 'redo' }, category: 'Edit' },
  { id: 'edit.cut', label: 'Cut', menu: 'Edit', group: 2, keybinding: 'Ctrl+X', command: 'edit.dispatch', args: { op: 'cut' }, category: 'Edit' },
  { id: 'edit.copy', label: 'Copy', menu: 'Edit', group: 2, keybinding: 'Ctrl+C', command: 'edit.dispatch', args: { op: 'copy' }, category: 'Edit' },
  { id: 'edit.paste', label: 'Paste', menu: 'Edit', group: 2, keybinding: 'Ctrl+V', command: 'edit.dispatch', args: { op: 'paste' }, category: 'Edit' },
  { id: 'edit.find', label: 'Find', menu: 'Edit', group: 3, keybinding: 'Ctrl+F', when: 'editorOpen', disabledReason: 'Open a file to search inside it.', command: 'editor.monacoAction', args: { actionId: 'actions.find' }, category: 'Edit' },
  { id: 'edit.replace', label: 'Replace', menu: 'Edit', group: 3, keybinding: 'Ctrl+H', when: 'editorOpen', disabledReason: 'Open a file to replace inside it.', command: 'editor.monacoAction', args: { actionId: 'editor.action.startFindReplaceAction' }, category: 'Edit' },
  { id: 'edit.find-in-files', label: 'Find in Files', menu: 'Edit', group: 3, keybinding: 'Ctrl+Shift+F', command: 'workbench.findInFiles', category: 'Edit' },
  { id: 'edit.toggle-line-comment', label: 'Toggle Line Comment', menu: 'Edit', group: 4, keybinding: 'Ctrl+/', when: 'editorOpen', disabledReason: 'Open a file to comment lines.', command: 'editor.monacoAction', args: { actionId: 'editor.action.commentLine' }, category: 'Edit' },
  { id: 'edit.toggle-block-comment', label: 'Toggle Block Comment', menu: 'Edit', group: 4, keybinding: 'Shift+Alt+A', when: 'editorOpen', disabledReason: 'Open a file to comment a block.', command: 'editor.monacoAction', args: { actionId: 'editor.action.blockComment' }, category: 'Edit' },
  { id: 'edit.format-document', label: 'Format Document', menu: 'Edit', group: 4, keybinding: 'Shift+Alt+F', when: 'editorOpen', disabledReason: 'Open a file to format.', command: 'editor.monacoAction', args: { actionId: 'editor.action.formatDocument' }, category: 'Edit' },

  // =========================================================================
  // Selection — multi-cursor and column mode delegate to Monaco actions.
  // =========================================================================
  { id: 'selection.select-all', label: 'Select All', menu: 'Selection', group: 1, keybinding: 'Ctrl+A', command: 'edit.dispatch', args: { op: 'selectAll' }, category: 'Selection' },
  { id: 'selection.expand', label: 'Expand Selection', menu: 'Selection', group: 1, keybinding: 'Alt+Shift+Right', when: 'editorOpen', disabledReason: 'Open a file to expand a selection.', command: 'editor.monacoAction', args: { actionId: 'editor.action.smartSelect.expand' }, category: 'Selection' },
  { id: 'selection.shrink', label: 'Shrink Selection', menu: 'Selection', group: 1, keybinding: 'Alt+Shift+Left', when: 'editorOpen', disabledReason: 'Open a file to shrink a selection.', command: 'editor.monacoAction', args: { actionId: 'editor.action.smartSelect.shrink' }, category: 'Selection' },
  { id: 'selection.copy-line-up', label: 'Copy Line Up', menu: 'Selection', group: 2, keybinding: 'Alt+Shift+Up', when: 'editorOpen', disabledReason: 'Open a file to duplicate a line.', command: 'editor.monacoAction', args: { actionId: 'editor.action.copyLinesUpAction' }, category: 'Selection' },
  { id: 'selection.copy-line-down', label: 'Copy Line Down', menu: 'Selection', group: 2, keybinding: 'Alt+Shift+Down', when: 'editorOpen', disabledReason: 'Open a file to duplicate a line.', command: 'editor.monacoAction', args: { actionId: 'editor.action.copyLinesDownAction' }, category: 'Selection' },
  { id: 'selection.move-line-up', label: 'Move Line Up', menu: 'Selection', group: 2, keybinding: 'Alt+Up', when: 'editorOpen', disabledReason: 'Open a file to move a line.', command: 'editor.monacoAction', args: { actionId: 'editor.action.moveLinesUpAction' }, category: 'Selection' },
  { id: 'selection.move-line-down', label: 'Move Line Down', menu: 'Selection', group: 2, keybinding: 'Alt+Down', when: 'editorOpen', disabledReason: 'Open a file to move a line.', command: 'editor.monacoAction', args: { actionId: 'editor.action.moveLinesDownAction' }, category: 'Selection' },
  { id: 'selection.add-next-occurrence', label: 'Add Next Occurrence', menu: 'Selection', group: 3, keybinding: 'Ctrl+D', when: 'editorOpen', disabledReason: 'Open a file to multi-select occurrences.', command: 'editor.monacoAction', args: { actionId: 'editor.action.addSelectionToNextFindMatch' }, category: 'Selection' },
  { id: 'selection.add-all-occurrences', label: 'Select All Occurrences', menu: 'Selection', group: 3, keybinding: 'Ctrl+Shift+L', when: 'editorOpen', disabledReason: 'Open a file to multi-select occurrences.', command: 'editor.monacoAction', args: { actionId: 'editor.action.selectHighlights' }, category: 'Selection' },
  { id: 'selection.add-cursor-above', label: 'Add Cursor Above', menu: 'Selection', group: 3, keybinding: 'Ctrl+Alt+Up', when: 'editorOpen', disabledReason: 'Open a file to add a cursor.', command: 'editor.monacoAction', args: { actionId: 'editor.action.insertCursorAbove' }, category: 'Selection' },
  { id: 'selection.add-cursor-below', label: 'Add Cursor Below', menu: 'Selection', group: 3, keybinding: 'Ctrl+Alt+Down', when: 'editorOpen', disabledReason: 'Open a file to add a cursor.', command: 'editor.monacoAction', args: { actionId: 'editor.action.insertCursorBelow' }, category: 'Selection' },
  { id: 'selection.column-mode', label: 'Column Selection Mode', menu: 'Selection', group: 4, when: 'editorOpen', disabledReason: 'Open a file to use column selection.', command: 'editor.monacoAction', args: { actionId: 'editor.action.toggleColumnSelectionMode' }, category: 'Selection' },

  // =========================================================================
  // View
  // =========================================================================
  { id: 'view.command-palette', label: 'Command Palette…', menu: 'View', group: 1, keybinding: 'Ctrl+Shift+P', command: 'workbench.commandPalette', category: 'View' },
  { id: 'view.quick-open', label: 'Quick Open…', menu: 'View', group: 1, keybinding: 'Ctrl+P', command: 'workbench.quickOpen', category: 'View' },
  { id: 'view.toggle-sidebar', label: 'Toggle Primary Sidebar', menu: 'View', group: 2, keybinding: 'Ctrl+B', command: 'workbench.toggleLeftSidebar', category: 'View' },
  { id: 'view.toggle-terminal', label: 'Toggle Terminal', menu: 'View', group: 2, keybinding: 'Ctrl+`', command: 'workbench.toggleTerminal', category: 'View' },
  { id: 'view.toggle-ai-assistant', label: 'Toggle AI Assistant', menu: 'View', group: 2, keybinding: 'Ctrl+Alt+B', command: 'workbench.toggleRightSidebar', category: 'View' },
  { id: 'view.split-editor', label: 'Split Editor', menu: 'View', group: 3, keybinding: 'Ctrl+\\', when: 'editorOpen', disabledReason: 'Open a file to split the editor.', command: 'workbench.splitEditor', category: 'View' },
  { id: 'view.toggle-minimap', label: 'Toggle Minimap', menu: 'View', group: 3, keybinding: 'Ctrl+Shift+M', command: 'workbench.toggleMinimap', category: 'View' },
  { id: 'view.toggle-word-wrap', label: 'Toggle Word Wrap', menu: 'View', group: 3, keybinding: 'Alt+Z', when: 'editorOpen', disabledReason: 'Open a file to wrap its text.', command: 'workbench.toggleWordWrap', category: 'View' },
  { id: 'view.toggle-zen-mode', label: 'Toggle Zen Mode', menu: 'View', group: 3, keybinding: 'Ctrl+K Z', command: 'workbench.toggleZenMode', category: 'View' },
  { id: 'view.change-theme', label: 'Appearance & Theme…', menu: 'View', group: 4, command: 'workbench.changeTheme', category: 'View' },
  { id: 'view.usage-dashboard', label: 'Usage & Quota Dashboard', menu: 'View', group: 4, command: 'workbench.usageDashboard', category: 'View' },
  { id: 'view.boot-timeline', label: 'Boot Timeline', menu: 'View', group: 4, command: 'workbench.bootTimeline', category: 'View' },

  // =========================================================================
  // Go — Prompt 5b Step 2, groups G1..G7 exactly, top to bottom.
  // =========================================================================
  // G1: navigation history + per-file last-edit position.
  { id: 'go.back', label: 'Back', menu: 'Go', group: 1, keybinding: 'Alt+LeftArrow', when: 'historyCanGoBack', disabledReason: 'No earlier position in the navigation history.', command: 'editor.navigateBack', category: 'Go' },
  { id: 'go.forward', label: 'Forward', menu: 'Go', group: 1, keybinding: 'Alt+RightArrow', when: 'historyCanGoForward', disabledReason: 'No later position in the navigation history.', command: 'editor.navigateForward', category: 'Go' },
  { id: 'go.last-edit-location', label: 'Last Edit Location', menu: 'Go', group: 1, keybinding: 'Ctrl+K Ctrl+Q', when: 'editorOpen', disabledReason: 'Open a file to jump to its last edit.', command: 'editor.gotoLastEditLocation', category: 'Go' },
  // G2: dynamic submenus populated from the live editor service.
  { id: 'go.switch-editor', label: 'Switch Editor', menu: 'Go', group: 2, submenuSource: 'openEditors', when: 'hasOpenTabs', disabledReason: 'No other editor is open.', command: 'editor.switchEditor', category: 'Go' },
  { id: 'go.switch-group', label: 'Switch Group', menu: 'Go', group: 2, submenuSource: 'editorGroups', when: 'editorOpen', disabledReason: 'Only one editor group exists.', command: 'editor.switchGroup', category: 'Go' },
  // G3
  { id: 'go.to-file', label: 'Go to File…', menu: 'Go', group: 3, when: 'editorOpen', disabledReason: 'Open a file to use the Go menu.', displayKeybindingOf: 'view.quick-open', command: 'workbench.quickOpen', category: 'Go' },
  { id: 'go.to-symbol-in-workspace', label: 'Go to Symbol in Workspace…', menu: 'Go', group: 3, keybinding: 'Ctrl+T', when: 'editorOpen', disabledReason: 'Open a file to use the Go menu.', command: 'workbench.workspaceSymbols', category: 'Go' },
  // G4 — Monaco symbol navigation; enabled only when a provider exists.
  { id: 'go.to-symbol-in-editor', label: 'Go to Symbol in Editor…', menu: 'Go', group: 4, keybinding: 'Ctrl+Shift+O', when: 'editorOpen', disabledReason: 'Open a file to use the Go menu.', command: 'workbench.editorSymbols', category: 'Go' },
  { id: 'go.definition', label: 'Go to Definition', menu: 'Go', group: 4, keybinding: 'F12', when: 'editorOpen && hasSymbolProvider', disabledReason: 'No symbol provider for this language', command: 'editor.monacoAction', args: { actionId: 'editor.action.revealDefinition' }, category: 'Go' },
  { id: 'go.declaration', label: 'Go to Declaration', menu: 'Go', group: 4, when: 'editorOpen && hasSymbolProvider', disabledReason: 'No symbol provider for this language', command: 'editor.monacoAction', args: { actionId: 'editor.action.revealDeclaration' }, category: 'Go' },
  { id: 'go.type-definition', label: 'Go to Type Definition', menu: 'Go', group: 4, when: 'editorOpen && hasSymbolProvider', disabledReason: 'No symbol provider for this language', command: 'editor.monacoAction', args: { actionId: 'editor.action.goToTypeDefinition' }, category: 'Go' },
  { id: 'go.implementations', label: 'Go to Implementations', menu: 'Go', group: 4, keybinding: 'Ctrl+F12', when: 'editorOpen && hasSymbolProvider', disabledReason: 'No symbol provider for this language', command: 'editor.monacoAction', args: { actionId: 'editor.action.goToImplementation' }, category: 'Go' },
  { id: 'go.references', label: 'Go to References', menu: 'Go', group: 4, keybinding: 'Shift+F12', when: 'editorOpen && hasSymbolProvider', disabledReason: 'No symbol provider for this language', command: 'editor.monacoAction', args: { actionId: 'editor.action.goToReferences' }, category: 'Go' },
  // G5
  { id: 'go.to-line', label: 'Go to Line/Column…', menu: 'Go', group: 5, keybinding: 'Ctrl+G', when: 'editorOpen', disabledReason: 'Open a file to jump to a line.', command: 'workbench.gotoLine', category: 'Go' },
  { id: 'go.to-bracket', label: 'Go to Bracket', menu: 'Go', group: 5, keybinding: 'Ctrl+Shift+\\', when: 'editorOpen', disabledReason: 'Open a file to jump to a bracket.', command: 'editor.monacoAction', args: { actionId: 'editor.action.jumpToBracket' }, category: 'Go' },
  // G6 — diagnostics-store navigation.
  { id: 'go.next-problem', label: 'Next Problem', menu: 'Go', group: 6, keybinding: 'F8', when: 'editorOpen && problemsExist', disabledReason: 'No problems are reported for this workspace.', command: 'editor.monacoAction', args: { actionId: 'editor.action.marker.nextInFiles' }, category: 'Go' },
  { id: 'go.previous-problem', label: 'Previous Problem', menu: 'Go', group: 6, keybinding: 'Shift+F8', when: 'editorOpen && problemsExist', disabledReason: 'No problems are reported for this workspace.', command: 'editor.monacoAction', args: { actionId: 'editor.action.marker.prevInFiles' }, category: 'Go' },
  // G7 — diff navigation when a diff is open, else SCM change navigation.
  { id: 'go.next-change', label: 'Next Change', menu: 'Go', group: 7, keybinding: 'Alt+F3', when: 'editorOpen && diffOrScmChangesOpen', disabledReason: 'No diff or pending source-control change to jump to.', command: 'editor.nextChange', category: 'Go' },
  { id: 'go.previous-change', label: 'Previous Change', menu: 'Go', group: 7, keybinding: 'Shift+Alt+F3', when: 'editorOpen && diffOrScmChangesOpen', disabledReason: 'No diff or pending source-control change to jump to.', command: 'editor.previousChange', category: 'Go' },

  // =========================================================================
  // Run — Prompt 5b Step 3, wired to the Omni-Debugger orchestrator.
  // =========================================================================
  { id: 'run.start-debugging', label: 'Start Debugging', menu: 'Run', group: 1, keybinding: 'F5', when: '!debugPaused', disabledReason: 'The debugger is paused — use Continue to resume.', command: 'debug.start', category: 'Run' },
  { id: 'run.run-without-debugging', label: 'Run Without Debugging', menu: 'Run', group: 1, keybinding: 'Ctrl+F5', command: 'debug.runWithoutDebugging', category: 'Run' },
  { id: 'run.stop-debugging', label: 'Stop Debugging', menu: 'Run', group: 1, keybinding: 'Shift+F5', when: 'debugSessionActive', disabledReason: 'No debug session is running.', command: 'debug.stop', category: 'Run' },
  { id: 'run.restart-debugging', label: 'Restart Debugging', menu: 'Run', group: 1, keybinding: 'Ctrl+Shift+F5', when: 'debugSessionActive', disabledReason: 'No debug session is running.', command: 'debug.restart', category: 'Run' },
  { id: 'run.open-configurations', label: 'Open Configurations', menu: 'Run', group: 2, when: 'configurationsExist', disabledReason: 'No launch configuration exists yet — use Add Configuration…', command: 'debug.openConfigurations', category: 'Run' },
  { id: 'run.add-configuration', label: 'Add Configuration…', menu: 'Run', group: 2, command: 'debug.addConfiguration', category: 'Run' },
  { id: 'run.step-over', label: 'Step Over', menu: 'Run', group: 3, keybinding: 'F10', when: 'debugPaused', disabledReason: 'The debugger is not paused at a breakpoint.', command: 'debug.stepOver', category: 'Run' },
  { id: 'run.step-into', label: 'Step Into', menu: 'Run', group: 3, keybinding: 'F11', when: 'debugPaused', disabledReason: 'The debugger is not paused at a breakpoint.', command: 'debug.stepInto', category: 'Run' },
  { id: 'run.step-out', label: 'Step Out', menu: 'Run', group: 3, keybinding: 'Shift+F11', when: 'debugPaused', disabledReason: 'The debugger is not paused at a breakpoint.', command: 'debug.stepOut', category: 'Run' },
  { id: 'run.continue', label: 'Continue', menu: 'Run', group: 3, keybinding: 'F5', when: 'debugPaused', disabledReason: 'The debugger is not paused at a breakpoint.', command: 'debug.continue', category: 'Run' },
  { id: 'run.toggle-breakpoint', label: 'Toggle Breakpoint', menu: 'Run', group: 4, keybinding: 'F9', when: 'editorOpen', disabledReason: 'Open a file to set a breakpoint on the cursor line.', command: 'debug.toggleBreakpoint', category: 'Run' },
  { id: 'run.new-breakpoint', label: 'New Breakpoint', menu: 'Run', group: 4, submenu: ['run.conditional-breakpoint', 'run.logpoint'], when: 'editorOpen', disabledReason: 'Open a file to add a breakpoint.', command: 'debug.newBreakpoint', category: 'Run' },
  { id: 'run.conditional-breakpoint', label: 'Conditional Breakpoint…', group: 4, when: 'editorOpen', disabledReason: 'Open a file to add a conditional breakpoint.', command: 'debug.conditionalBreakpoint', category: 'Run' },
  { id: 'run.logpoint', label: 'Logpoint…', group: 4, when: 'editorOpen', disabledReason: 'Open a file to add a logpoint.', command: 'debug.logpoint', category: 'Run' },
  { id: 'run.enable-all-breakpoints', label: 'Enable All Breakpoints', menu: 'Run', group: 5, when: 'hasBreakpoints', disabledReason: 'No breakpoints are defined.', command: 'debug.enableAllBreakpoints', category: 'Run' },
  { id: 'run.disable-all-breakpoints', label: 'Disable All Breakpoints', menu: 'Run', group: 5, when: 'hasBreakpoints', disabledReason: 'No breakpoints are defined.', command: 'debug.disableAllBreakpoints', category: 'Run' },
  { id: 'run.remove-all-breakpoints', label: 'Remove All Breakpoints', menu: 'Run', group: 5, when: 'hasBreakpoints', disabledReason: 'No breakpoints are defined.', command: 'debug.removeAllBreakpoints', category: 'Run' },
  { id: 'run.install-additional-debuggers', label: 'Install Additional Debuggers…', menu: 'Run', group: 6, command: 'debug.installDebuggers', category: 'Run' },

  // =========================================================================
  // Terminal — Prompt 5b Step 4, wired to the terminal manager + task system.
  // =========================================================================
  { id: 'terminal.new', label: 'New Terminal', menu: 'Terminal', group: 1, keybinding: "Ctrl+Shift+'", command: 'terminal.new', category: 'Terminal' },
  { id: 'terminal.split', label: 'Split Terminal', menu: 'Terminal', group: 1, keybinding: 'Ctrl+Shift+5', command: 'terminal.split', category: 'Terminal' },
  { id: 'terminal.new-window', label: 'New Terminal Window', menu: 'Terminal', group: 1, keybinding: "Ctrl+Shift+Alt+'", target: 'main', command: 'terminal.newWindow', category: 'Terminal' },
  { id: 'terminal.run-task', label: 'Run Task…', menu: 'Terminal', group: 2, submenuSource: 'availableTasks', command: 'task.runPicker', category: 'Terminal' },
  { id: 'terminal.run-build-task', label: 'Run Build Task…', menu: 'Terminal', group: 2, keybinding: 'Ctrl+Shift+B', command: 'task.runBuild', category: 'Terminal' },
  { id: 'terminal.run-active-file', label: 'Run Active File', menu: 'Terminal', group: 2, when: 'editorOpen', disabledReason: 'Open a file to run it.', command: 'task.runActiveFile', category: 'Terminal' },
  { id: 'terminal.run-selected-text', label: 'Run Selected Text', menu: 'Terminal', group: 2, when: 'selectionActive', disabledReason: 'Select text in the editor first.', command: 'task.runSelectedText', category: 'Terminal' },
  { id: 'terminal.show-running-tasks', label: 'Show Running Tasks…', menu: 'Terminal', group: 3, when: 'tasksRunning', disabledReason: 'No task is currently running.', submenuSource: 'runningTasks', command: 'task.showRunning', category: 'Terminal' },
  { id: 'terminal.restart-running-task', label: 'Restart Running Task…', menu: 'Terminal', group: 3, when: 'tasksRunning', disabledReason: 'No task is currently running.', submenuSource: 'runningTasks', command: 'task.restartRunning', category: 'Terminal' },
  { id: 'terminal.terminate-task', label: 'Terminate Task…', menu: 'Terminal', group: 3, when: 'tasksRunning', disabledReason: 'No task is currently running.', submenuSource: 'runningTasks', command: 'task.terminate', category: 'Terminal' },
  { id: 'terminal.configure-tasks', label: 'Configure Tasks…', menu: 'Terminal', group: 4, command: 'task.configure', category: 'Terminal' },
  { id: 'terminal.configure-default-build-task', label: 'Configure Default Build Task…', menu: 'Terminal', group: 4, command: 'task.configureDefaultBuild', category: 'Terminal' },

  // =========================================================================
  // Help — Prompt 5b Step 5, groups G1..G4, rebranded to Ty-Code.
  // =========================================================================
  { id: 'help.welcome', label: 'Welcome', menu: 'Help', group: 1, command: 'help.welcome', category: 'Help' },
  { id: 'help.show-all-commands', label: 'Show All Commands', menu: 'Help', group: 1, displayKeybindingOf: 'view.command-palette', command: 'workbench.commandPalette', category: 'Help' },
  { id: 'help.editor-playground', label: 'Editor Playground', menu: 'Help', group: 1, command: 'help.playground', category: 'Help' },
  { id: 'help.documentation', label: 'Ty-Code Documentation', menu: 'Help', group: 1, command: 'help.documentation', category: 'Help' },
  { id: 'help.release-notes', label: 'Show Release Notes', menu: 'Help', group: 1, command: 'help.releaseNotes', category: 'Help' },
  { id: 'help.view-license', label: 'View License', menu: 'Help', group: 2, command: 'help.license', category: 'Help' },
  { id: 'help.privacy-policy', label: 'Privacy Policy', menu: 'Help', group: 2, command: 'help.privacyPolicy', category: 'Help' },
  { id: 'help.toggle-dev-tools', label: 'Toggle Developer Tools', menu: 'Help', group: 3, keybinding: 'Ctrl+Shift+I', when: 'devToolsAllowed', disabledReason: 'Developer tools are only available in development builds.', target: 'main', command: 'window.toggleDevTools', category: 'Help' },
  { id: 'help.process-explorer', label: 'Open Process Explorer', menu: 'Help', group: 3, target: 'main', command: 'window.openProcessExplorer', category: 'Help' },
  { id: 'help.check-for-updates', label: 'Check for Updates…', menu: 'Help', group: 4, when: 'updatersAvailable', disabledReason: 'Update checking is unavailable in this build.', target: 'main', command: 'app.checkForUpdates', category: 'Help' },
  { id: 'help.about', label: 'About', menu: 'Help', group: 4, command: 'help.about', category: 'Help' },

  // Palette-only (no menu): keeps the Help groups exactly as specified while
  // leaving these surfaces reachable from Show All Commands.
  { id: 'help.keyboard-shortcuts', label: 'Keyboard Shortcuts Reference', command: 'help.keyboardShortcuts', category: 'Help' },
  { id: 'help.diagnostics', label: 'Diagnostics', command: 'help.diagnostics', category: 'Help' },

  // =========================================================================
  // Ty-Code — application menu.
  // =========================================================================
  { id: 'tycode.preferences', label: 'Preferences', menu: 'Ty-Code', group: 1, keybinding: 'Ctrl+,', command: 'workbench.openSettings', category: 'Ty-Code' },
  { id: 'tycode.reliability-panel', label: 'Reliability Panel', menu: 'Ty-Code', group: 1, command: 'workbench.reliabilityPanel', category: 'Ty-Code' },
  { id: 'tycode.check-for-updates', label: 'Check for Updates', menu: 'Ty-Code', group: 2, when: 'updatersAvailable', disabledReason: 'Update checking is unavailable in this build.', target: 'main', command: 'app.checkForUpdates', category: 'Ty-Code' },
  { id: 'tycode.fcc-sidecar-status', label: 'FCC Sidecar Status', menu: 'Ty-Code', group: 2, target: 'main', command: 'fcc.sidecarStatus', category: 'Ty-Code' },
  { id: 'tycode.about', label: 'About', menu: 'Ty-Code', group: 3, command: 'help.about', category: 'Ty-Code' }
];

/**
 * The parsed, immutable registry. Parsing eagerly means a malformed entry
 * fails at import time in tests and at boot in production rather than
 * producing a silently dead menu row.
 */
export const COMMAND_ENTRIES: readonly CommandEntry[] = Object.freeze(
  CommandEntrySchema.array().parse(COMMAND_ENTRY_INPUTS)
);

const ENTRY_INDEX: ReadonlyMap<string, CommandEntry> = new Map(
  COMMAND_ENTRIES.map((entry) => [entry.id, entry])
);

/**
 * Index for a table. The shipped table reuses the module-level index; a custom
 * table (used by the registry tests to prove that one declaration is all it
 * takes to add a menu item) builds its own.
 */
function indexOf(entries: readonly CommandEntry[]): ReadonlyMap<string, CommandEntry> {
  if (entries === COMMAND_ENTRIES) return ENTRY_INDEX;
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/** Look up an entry by id. */
export function getCommandEntry(
  id: string,
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): CommandEntry | undefined {
  return indexOf(entries).get(id);
}

/** All entries, in declaration order. */
export function listCommandEntries(): readonly CommandEntry[] {
  return COMMAND_ENTRIES;
}

/** Entries that appear in a menu bar dropdown, in declaration order. */
export function listMenuEntries(
  menu: CommandMenuId,
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): readonly CommandEntry[] {
  return entries.filter((entry) => entry.menu === menu);
}

/** Entries with no menu and no submenu parent — the command palette set. */
export function listPaletteEntries(
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): readonly CommandEntry[] {
  const childIds = new Set<string>();
  for (const entry of entries) {
    for (const childId of entry.submenu ?? []) childIds.add(childId);
  }
  return entries.filter((entry) => !entry.menu && !childIds.has(entry.id));
}

// ---------------------------------------------------------------------------
// Keybindings — derived from the same entries, never declared twice.
// ---------------------------------------------------------------------------

let cachedKeybindings: RegistryKeybinding[] | null = null;

/**
 * Every global keybinding, derived from the entry table.
 *
 * Entries that merely display another entry's binding
 * (`displayKeybindingOf`) are excluded so a chord is owned exactly once.
 */
export function listKeybindings(
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): RegistryKeybinding[] {
  const isShipped = entries === COMMAND_ENTRIES;
  if (isShipped && cachedKeybindings) return cachedKeybindings;

  const derived: RegistryKeybinding[] = [];
  for (const entry of entries) {
    if (!entry.keybinding || !entry.visible) continue;
    const chords = parseKeybinding(entry.keybinding);
    if (chords.length === 0) continue;
    derived.push({
      commandId: entry.id,
      binding: entry.keybinding,
      chords,
      when: entry.when,
      target: entry.target,
      command: entry.command,
      args: entry.args
    });
  }

  if (!isShipped) return derived;
  cachedKeybindings = Object.freeze(derived) as RegistryKeybinding[];
  return cachedKeybindings;
}

/** Display text for an entry's shortcut, honouring `displayKeybindingOf`. */
export function resolveDisplayKeybinding(
  entry: CommandEntry,
  isMac = false,
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): string | undefined {
  const owner = entry.displayKeybindingOf ? indexOf(entries).get(entry.displayKeybindingOf) : undefined;
  const binding = entry.keybinding ?? owner?.keybinding;
  if (!binding) return undefined;
  return formatKeybindingForDisplay(binding, isMac);
}

// ---------------------------------------------------------------------------
// Menu resolution
// ---------------------------------------------------------------------------

/**
 * Everything the resolver needs from the live app besides the boolean
 * contexts: which handlers exist (for "hidden > dead") and the rows of each
 * dynamic submenu source.
 */
export interface RegistryRuntimeState {
  /**
   * Handler keys that are actually registered. An entry whose `command` is
   * absent here is HIDDEN, never rendered as a no-op.
   */
  availableCommands: ReadonlySet<string>;
  contexts: Partial<CommandContext>;
  /** Rows for each dynamic submenu source, resolved by the owning runtime. */
  dynamicSubmenus?: Partial<Record<DynamicSubmenuSource, DynamicSubmenuItem[]>>;
}

/** Empty context: every key false. Used as the resolver's default. */
export function emptyContext(): CommandContext {
  const base = {} as Record<string, boolean>;
  for (const key of [
    'editorOpen', 'selectionActive', 'debugSessionActive', 'debugPaused',
    'tasksRunning', 'diffOrScmChangesOpen', 'problemsExist', 'configurationsExist',
    'updatersAvailable', 'workspaceOpen', 'dirtyEditor', 'terminalOpen',
    'devToolsAllowed', 'hasSymbolProvider', 'hasBreakpoints', 'historyCanGoBack',
    'historyCanGoForward', 'hasRunningTasks', 'hasOpenTabs'
  ]) {
    base[key] = false;
  }
  return base as CommandContext;
}

/** True when the entry can be shown at all (handler exists and not hidden). */
export function isEntryBacked(entry: CommandEntry, state: RegistryRuntimeState): boolean {
  if (!entry.visible) return false;
  return state.availableCommands.has(entry.command);
}

function resolveRow(
  entry: CommandEntry,
  state: RegistryRuntimeState,
  index: ReadonlyMap<string, CommandEntry>
): ResolvedMenuRow | null {
  if (!isEntryBacked(entry, state)) return null;

  const enabled = evaluateWhen(entry.when, state.contexts);
  const children: ResolvedMenuRow[] = [];
  for (const childId of entry.submenu ?? []) {
    const child = index.get(childId);
    if (!child) continue;
    const resolved = resolveRow(child, state, index);
    if (resolved) children.push(resolved);
  }

  const dynamicChildren = entry.submenuSource
    ? state.dynamicSubmenus?.[entry.submenuSource] ?? []
    : [];

  return {
    entry,
    enabled,
    // A reason is only meaningful when greyed; keeping it absent otherwise
    // stops a stale tooltip leaking onto an enabled row.
    disabledReason: enabled ? undefined : entry.disabledReason ?? 'Not available right now.',
    children,
    dynamicChildren,
    displayKeybinding: entry.displayKeybindingOf
      ? index.get(entry.displayKeybindingOf)?.keybinding
      : entry.keybinding
  };
}

/**
 * Resolve one menu into separator groups. Groups are rendered top to bottom
 * in ascending `group` order; empty groups disappear so no stray separator is
 * ever painted.
 */
export function resolveMenu(
  menu: CommandMenuId,
  state: RegistryRuntimeState,
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): ResolvedMenu {
  const index = indexOf(entries);
  const rows: ResolvedMenuRow[] = [];
  for (const entry of entries) {
    if (entry.menu !== menu) continue;
    const row = resolveRow(entry, state, index);
    if (row) rows.push(row);
  }
  // Array#sort is stable, so declaration order survives within a group.
  rows.sort((a, b) => a.entry.group - b.entry.group);

  const groups: ResolvedMenuRow[][] = [];
  let currentGroup: number | null = null;
  for (const row of rows) {
    if (row.entry.group !== currentGroup) {
      currentGroup = row.entry.group;
      groups.push([]);
    }
    groups[groups.length - 1].push(row);
  }
  return { menu, groups };
}

/** Resolve every menu bar menu, in menu-bar order. */
export function resolveAllMenus(
  state: RegistryRuntimeState,
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): ResolvedMenu[] {
  return COMMAND_MENU_IDS.map((menu) => resolveMenu(menu, state, entries));
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/**
 * Validate the table itself. This runs in the registry tests and at main boot
 * so a bad entry is caught before a user can click it.
 *
 * Checks performed:
 *  - unique ids, and every entry parses against the Zod schema
 *  - submenu children exist, are not the parent itself, and do not also claim
 *    a top-level menu slot (a child belongs to exactly one place)
 *  - `submenu` and `submenuSource` are mutually exclusive
 *  - every keybinding parses, and no chord is owned by two entries unless both
 *    declare a `when` clause (then the first match in group order wins)
 *  - `displayKeybindingOf` points at an entry that really owns a binding
 *  - every `when` expression parses and references only known context keys
 *  - every entry with a `when` also carries a `disabledReason`, because a
 *    greyed item without a reason is exactly the "dead click" we ban
 *  - no third-party IDE branding in any user-facing string
 */
export function validateCommandRegistry(
  entries: readonly CommandEntry[] = COMMAND_ENTRIES
): RegistryValidationIssue[] {
  const issues: RegistryValidationIssue[] = [];
  const byId = new Map<string, CommandEntry>();
  const bindingOwners = new Map<string, CommandEntry[]>();

  const containsBranding = (value: string, entryId: string): string | undefined =>
    findBrandToken(value, entryId);

  for (const entry of entries) {
    const parsed = CommandEntrySchema.safeParse(entry);
    if (!parsed.success) {
      issues.push({ commandId: entry.id, code: 'invalid_entry', message: parsed.error.message });
    }

    if (byId.has(entry.id)) {
      issues.push({ commandId: entry.id, code: 'duplicate_id', message: `Duplicate command id '${entry.id}'.` });
    }
    byId.set(entry.id, entry);

    // label, disabledReason (a tooltip) and category (a palette heading) are
    // all user-facing, so all three are scanned.
    const branded =
      containsBranding(entry.label, entry.id) ??
      (entry.disabledReason ? containsBranding(entry.disabledReason, entry.id) : undefined) ??
      (entry.category ? containsBranding(entry.category, entry.id) : undefined);
    if (branded) {
      issues.push({
        commandId: entry.id,
        code: 'third_party_branding',
        message: `User-facing string references a third-party product ('${branded}'). Use the Ty-Code equivalent.`
      });
    }

    if (entry.when) {
      if (!parseContextExpression(entry.when)) {
        issues.push({ commandId: entry.id, code: 'unparsable_when', message: `'when' is not a valid context expression: ${entry.when}` });
      }
      if (!entry.disabledReason) {
        issues.push({
          commandId: entry.id,
          code: 'missing_disabled_reason',
          message: 'An entry with a `when` clause must explain itself via `disabledReason`; otherwise the greyed row is a dead click.'
        });
      }
    }

    if (entry.submenu && entry.submenuSource) {
      issues.push({ commandId: entry.id, code: 'submenu_conflict', message: 'Use either `submenu` or `submenuSource`, never both.' });
    }

    if (entry.keybinding) {
      if (!isParsableKeybinding(entry.keybinding)) {
        issues.push({ commandId: entry.id, code: 'unparsable_keybinding', message: `Keybinding cannot be parsed: '${entry.keybinding}'.` });
      } else {
        const owners = bindingOwners.get(entry.keybinding) ?? [];
        owners.push(entry);
        bindingOwners.set(entry.keybinding, owners);
      }
    }
  }

  for (const entry of entries) {
    for (const childId of entry.submenu ?? []) {
      if (childId === entry.id) {
        issues.push({ commandId: entry.id, code: 'submenu_self_reference', message: `Submenu '${entry.id}' lists itself as a child.` });
        continue;
      }
      const child = byId.get(childId);
      if (!child) {
        issues.push({ commandId: entry.id, code: 'unknown_submenu_child', message: `Submenu child '${childId}' is not a registered entry.` });
        continue;
      }
      if (child.menu) {
        issues.push({
          commandId: entry.id,
          code: 'orphan_entry',
          message: `Submenu child '${childId}' also declares menu '${child.menu}'. A child belongs to exactly one place.`
        });
      }
    }

    if (entry.displayKeybindingOf) {
      const owner = byId.get(entry.displayKeybindingOf);
      if (!owner || !owner.keybinding) {
        issues.push({
          commandId: entry.id,
          code: 'unknown_keybinding_ref',
          message: `displayKeybindingOf '${entry.displayKeybindingOf}' does not reference an entry that owns a keybinding.`
        });
      }
    }
  }

  for (const [binding, owners] of bindingOwners) {
    if (owners.length < 2) continue;
    // Sharing a chord is only legal when every owner guards it with a `when`
    // clause, so at most one can ever match; otherwise the first registered
    // entry would silently swallow the others.
    if (owners.some((owner) => !owner.when)) {
      issues.push({
        commandId: owners.map((owner) => owner.id).join(', '),
        code: 'duplicate_keybinding',
        message: `'${binding}' is claimed by ${owners.map((o) => o.id).join(', ')} without a mutually exclusive 'when'.`
      });
    }
  }

  return issues;
}

/** Throws when the table is structurally invalid. Used at main boot. */
export function assertCommandRegistryValid(): void {
  const issues = validateCommandRegistry();
  if (issues.length > 0) {
    const detail = issues.map((issue) => `[${issue.code}] ${issue.commandId}: ${issue.message}`).join('\n');
    throw new Error(`Ty-Code command registry is invalid:\n${detail}`);
  }
}

/**
 * Every handler key the table expects, split by execution target. The runtimes
 * compare their registered maps against this so a missing handler surfaces in
 * tests instead of as a hidden menu row nobody notices.
 */
export function listRequiredHandlers(): { renderer: string[]; main: string[] } {
  const renderer = new Set<string>();
  const main = new Set<string>();
  for (const entry of COMMAND_ENTRIES) {
    (entry.target === 'main' ? main : renderer).add(entry.command);
  }
  return { renderer: [...renderer].sort(), main: [...main].sort() };
}

/** Convenience for tests: the Zod schema is re-exported for IPC reuse. */
export const CommandEntryArraySchema = z.array(CommandEntrySchema);
