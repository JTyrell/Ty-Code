/**
 * Editor service (Prompt 5 / Prompt 5b).
 *
 * Monaco instances used to live inside `EditorArea`'s local `useRef`, reachable
 * by the rest of the app only through the ten fixed names in
 * `useEditorNavigationStore.registerActions()`. That was enough for a context
 * menu and nowhere near enough for a command registry: the Go menu alone needs
 * ~24 distinct Monaco action ids, `Run Selected Text` needs to know a selection
 * exists, `Toggle Breakpoint` needs the cursor line, and Go G1 needs a
 * navigation history with a per-file last-edit map — which the spec places here.
 *
 * So this module is the single holder of live editor instances and the honest
 * source for everything the registry can observe about the editor:
 *
 *  - which editor is active, in which group, showing which file and language,
 *  - whether a selection exists (and how large, without holding the text),
 *  - the navigation history stack and the per-file last-edit position map,
 *  - open diff changes, for `go.next-change` / `go.previous-change`.
 *
 * Two deliberate boundaries keep this testable and honest:
 *
 *  - **Structural types, not Monaco's.** Everything an editor must supply is
 *    declared here as a small interface, so the history and selection logic runs
 *    under plain Node with a fake editor and no `monaco-editor` import.
 *  - **Symbol-provider detection is injected.** Whether a language has a
 *    definition/reference provider is a fact about the LSP fleet, which this
 *    module does not own. `setSymbolProviderResolver()` lets the wiring layer
 *    supply it; the default only claims Monaco's own TypeScript worker, so the
 *    honest answer for an unbacked language is `false` and Go G4 greys out with
 *    "No symbol provider for this language" instead of firing a dead action.
 *
 * `editorOpen` is deliberately NOT published here. The workspace store already
 * owns that truth (`activeTabPath`), and two contributors asserting one key is a
 * wiring bug the command runtime warns about rather than silently resolving.
 */

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Structural view of the parts of Monaco this service touches
// ---------------------------------------------------------------------------

export interface EditorPositionLike {
  lineNumber: number;
  column: number;
}

export interface EditorRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  isEmpty?(): boolean;
}

export interface EditorDisposable {
  dispose(): void;
}

export interface EditorActionLike {
  run(...args: unknown[]): unknown;
}

export interface EditorModelLike {
  getLanguageId(): string;
  getValueInRange(range: EditorRangeLike): string;
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
}

export interface MonacoEditorLike {
  getPosition(): EditorPositionLike | null;
  getSelection(): EditorRangeLike | null;
  getModel(): EditorModelLike | null;
  getAction(id: string): EditorActionLike | null;
  setPosition(position: EditorPositionLike): void;
  revealPositionInCenter(position: EditorPositionLike): void;
  focus(): void;
  onDidChangeCursorPosition(
    listener: (event: { position: EditorPositionLike }) => void
  ): EditorDisposable;
  onDidChangeCursorSelection(
    listener: (event: { selection: EditorRangeLike }) => void
  ): EditorDisposable;
  onDidFocusEditorText(listener: () => void): EditorDisposable;
  isDisposed?(): boolean;
}

export interface DiffLineChangeLike {
  originalStartLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface MonacoDiffEditorLike {
  getModifiedEditor(): MonacoEditorLike;
  getLineChanges(): DiffLineChangeLike[] | null;
  onDidUpdateDiff(listener: () => void): EditorDisposable;
  isDisposed?(): boolean;
}

/** A place the user can be sent to, possibly in a file that is not open yet. */
export interface NavigationTarget {
  filePath: string | null;
  lineNumber: number;
  column: number;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface EditorServiceSnapshot {
  /** A Monaco editor is registered at all (split or single). */
  hasEditor: boolean;
  /** Registered editor groups, in registration order. */
  groupIds: readonly string[];
  /** Group of the editor that most recently had focus. */
  activeGroupId: string | null;
  /** File the active editor is showing, as the workspace store knows it. */
  filePath: string | null;
  languageId: string | null;
  position: EditorPositionLike;
  selectionActive: boolean;
  /** Characters in the selection. Count, not text: the snapshot stays cheap. */
  selectedCharCount: number;
  /** A diff editor is mounted, so change navigation has something to walk. */
  diffOpen: boolean;
  /** Diff hunks currently known, so callers can say why navigation is greyed. */
  diffChangeCount: number;
  historyCanGoBack: boolean;
  historyCanGoForward: boolean;
  /** Bumped on every publish so `useSyncExternalStore` never serves a stale read. */
  revision: number;
}

const INITIAL_POSITION: EditorPositionLike = { lineNumber: 1, column: 1 };

function initialSnapshot(): EditorServiceSnapshot {
  return {
    hasEditor: false,
    groupIds: [],
    activeGroupId: null,
    filePath: null,
    languageId: null,
    position: INITIAL_POSITION,
    selectionActive: false,
    selectedCharCount: 0,
    diffOpen: false,
    diffChangeCount: 0,
    historyCanGoBack: false,
    historyCanGoForward: false,
    revision: 0
  };
}

let snapshot: EditorServiceSnapshot = initialSnapshot();
const listeners = new Set<() => void>();

/**
 * Publish only when something a menu or a component reads actually moved.
 * Cursor movement fires constantly; rebuilding an equal snapshot would re-render
 * the menu bar on every keystroke for no reason.
 */
function publish(patch: Partial<EditorServiceSnapshot>): void {
  let changed = false;
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof EditorServiceSnapshot, unknown]
  >) {
    const previous = snapshot[key];
    if (key === 'position') {
      const nextPosition = value as EditorPositionLike;
      const currentPosition = previous as EditorPositionLike;
      if (
        currentPosition.lineNumber !== nextPosition.lineNumber ||
        currentPosition.column !== nextPosition.column
      ) {
        changed = true;
      }
      continue;
    }
    if (key === 'groupIds') {
      const next = value as readonly string[];
      const current = previous as readonly string[];
      if (current.length !== next.length || current.some((id, i) => id !== next[i])) {
        changed = true;
      }
      continue;
    }
    if (previous !== value) changed = true;
  }
  if (!changed) return;
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}

/**
 * Subscribe to snapshot changes from outside React.
 *
 * `lib/command-contexts.ts` republishes command contexts from a plain module,
 * where `useSyncExternalStore` is unavailable, and it has to learn the moment
 * the cursor or the history moves — otherwise Go's Back/Forward rows stay
 * greyed after a jump that just made them valid.
 */
export function subscribeEditorService(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEditorService(): EditorServiceSnapshot {
  return useSyncExternalStore(subscribeEditorService, () => snapshot, () => snapshot);
}

export function getEditorServiceState(): EditorServiceSnapshot {
  return snapshot;
}

// ---------------------------------------------------------------------------
// Instance registry
// ---------------------------------------------------------------------------

interface Registration {
  groupId: string;
  disposables: EditorDisposable[];
}

const registrations = new Map<MonacoEditorLike, Registration>();
let activeEditor: MonacoEditorLike | null = null;
let activeDiff: MonacoDiffEditorLike | null = null;
let diffDisposable: EditorDisposable | null = null;

function isAlive(editor: MonacoEditorLike | null): editor is MonacoEditorLike {
  if (!editor) return false;
  try {
    return editor.isDisposed ? !editor.isDisposed() : true;
  } catch {
    return false;
  }
}

function groupIds(): string[] {
  const seen: string[] = [];
  for (const registration of registrations.values()) {
    if (!seen.includes(registration.groupId)) seen.push(registration.groupId);
  }
  return seen;
}

function activeGroupId(): string | null {
  return activeEditor ? registrations.get(activeEditor)?.groupId ?? null : null;
}

function syncInstanceSnapshot(): void {
  publish({
    hasEditor: isAlive(activeEditor),
    groupIds: groupIds(),
    activeGroupId: activeGroupId()
  });
}

function readSelection(editor: MonacoEditorLike): { active: boolean; count: number } {
  const selection = editor.getSelection();
  if (!selection) return { active: false, count: 0 };
  const empty =
    typeof selection.isEmpty === 'function'
      ? selection.isEmpty()
      : selection.startLineNumber === selection.endLineNumber &&
        selection.startColumn === selection.endColumn;
  if (empty) return { active: false, count: 0 };
  const text = readSelectionText(editor, selection);
  return { active: true, count: text.length };
}

function readSelectionText(editor: MonacoEditorLike, range?: EditorRangeLike | null): string {
  const selection = range ?? editor.getSelection();
  if (!selection) return '';
  const model = editor.getModel();
  if (!model) return '';
  try {
    return model.getValueInRange(selection);
  } catch {
    // A disposed or detached model reports no text rather than throwing upward.
    return '';
  }
}

function syncCursorSnapshot(editor: MonacoEditorLike): void {
  const position = editor.getPosition() ?? INITIAL_POSITION;
  const selection = readSelection(editor);
  publish({
    position: { lineNumber: position.lineNumber, column: position.column },
    selectionActive: selection.active,
    selectedCharCount: selection.count
  });
}

/**
 * Adopt a live Monaco editor.
 *
 * Called from `EditorArea`'s mount hook for the primary pane and again for the
 * split pane, each with its own `groupId`. The returned disposable releases the
 * instance and every listener attached to it, so an unmounted pane stops
 * asserting cursor state it can no longer observe.
 */
export function registerEditor(
  editor: MonacoEditorLike,
  options: { groupId: string }
): EditorDisposable {
  if (registrations.has(editor)) {
    registrations.get(editor)!.groupId = options.groupId;
  } else {
    const disposables: EditorDisposable[] = [
      editor.onDidChangeCursorPosition((event) => {
        if (activeEditor !== editor) return;
        syncCursorSnapshot(editor);
        observePosition(currentTarget(event.position));
      }),
      editor.onDidChangeCursorSelection(() => {
        if (activeEditor !== editor) return;
        syncCursorSnapshot(editor);
      }),
      editor.onDidFocusEditorText(() => {
        setActiveEditor(editor);
      })
    ];
    registrations.set(editor, { groupId: options.groupId, disposables });
  }

  setActiveEditor(editor);
  syncInstanceSnapshot();

  let released = false;
  return {
    dispose() {
      if (released) return;
      released = true;
      const registration = registrations.get(editor);
      if (registration) {
        for (const disposable of registration.disposables) {
          try {
            disposable.dispose();
          } catch {
            // Monaco listeners can already be gone if the editor was disposed first.
          }
        }
      }
      registrations.delete(editor);
      if (activeEditor === editor) {
        const remaining = [...registrations.keys()].find(isAlive) ?? null;
        activeEditor = remaining;
        if (remaining) syncCursorSnapshot(remaining);
        else publish({ selectionActive: false, selectedCharCount: 0 });
      }
      syncInstanceSnapshot();
    }
  };
}

/** Focus an editor group, for `go.switch-group`. Returns false if it is gone. */
export function focusGroup(groupId: string): boolean {
  for (const [editor, registration] of registrations) {
    if (registration.groupId !== groupId || !isAlive(editor)) continue;
    setActiveEditor(editor);
    try {
      editor.focus();
    } catch {
      return false;
    }
    syncInstanceSnapshot();
    return true;
  }
  return false;
}

export function setActiveEditor(editor: MonacoEditorLike | null): void {
  if (activeEditor === editor) return;
  activeEditor = editor;
  if (editor && isAlive(editor)) syncCursorSnapshot(editor);
  syncInstanceSnapshot();
}

export function getActiveEditor(): MonacoEditorLike | null {
  return isAlive(activeEditor) ? activeEditor : null;
}

export function getActiveGroupId(): string | null {
  return activeGroupId();
}

export function listEditorGroups(): string[] {
  return groupIds();
}

/**
 * Adopt the diff editor, for `go.next-change` / `go.previous-change`.
 *
 * Registered separately from {@link registerEditor} because a diff is a second
 * surface over the same tab: its modified pane is a Monaco editor, but change
 * navigation needs the hunk list only the diff editor has.
 */
export function registerDiffEditor(diff: MonacoDiffEditorLike): EditorDisposable {
  activeDiff = diff;
  diffDisposable?.dispose();
  diffDisposable = diff.onDidUpdateDiff(() => syncDiffSnapshot());
  syncDiffSnapshot();
  publish({ diffOpen: true });

  let released = false;
  return {
    dispose() {
      if (released) return;
      released = true;
      diffDisposable?.dispose();
      diffDisposable = null;
      if (activeDiff === diff) activeDiff = null;
      publish({ diffOpen: false, diffChangeCount: 0 });
    }
  };
}

function syncDiffSnapshot(): void {
  const changes = readDiffChanges();
  publish({ diffChangeCount: changes.length });
}

function readDiffChanges(): DiffLineChangeLike[] {
  if (!activeDiff || activeDiff.isDisposed?.()) return [];
  try {
    return activeDiff.getLineChanges() ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Active file
// ---------------------------------------------------------------------------

/**
 * Record which file the active editor is showing.
 *
 * The path comes from the workspace store rather than the model URI: this
 * codebase normalises slashes in several places and the store's path is the one
 * every other feature already uses, so breakpoints, history and last-edit
 * entries all key on the same string.
 */
export function setActiveFile(filePath: string | null, languageId: string | null): void {
  const previous = snapshot.filePath;
  if (previous === filePath && snapshot.languageId === languageId) return;
  publish({ filePath, languageId });
  const editor = getActiveEditor();
  const position = editor?.getPosition() ?? snapshot.position;
  // Switching file is itself a navigation event, unless the history head already
  // points at this file — which is the case right after Back/Forward sent us
  // here, and committing then would push the destination twice.
  const head = history[historyIndex];
  if (filePath && (!head || head.filePath !== filePath)) {
    commit({ filePath, lineNumber: position.lineNumber, column: position.column });
  }
  // A different language can change whether symbol navigation is available.
  notifyLanguageChange();
}

const languageListeners = new Set<() => void>();

function notifyLanguageChange(): void {
  for (const listener of languageListeners) listener();
}

/** Subscribe to file/language changes — used to re-evaluate `hasSymbolProvider`. */
export function subscribeEditorFile(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

export function getActiveFilePath(): string | null {
  return snapshot.filePath;
}

export function getActiveLanguageId(): string | null {
  return snapshot.languageId;
}

export function getCursorPosition(): EditorPositionLike {
  return getActiveEditor()?.getPosition() ?? snapshot.position;
}

export function getCursorLine(): number {
  return getCursorPosition().lineNumber;
}

/** The selected text, read live so a large selection is never held in state. */
export function getSelectedText(): string {
  const editor = getActiveEditor();
  if (!editor) return '';
  const selection = editor.getSelection();
  if (!selection) return '';
  const empty =
    typeof selection.isEmpty === 'function'
      ? selection.isEmpty()
      : selection.startLineNumber === selection.endLineNumber &&
        selection.startColumn === selection.endColumn;
  if (empty) return '';
  return readSelectionText(editor, selection);
}

export function hasSelection(): boolean {
  return snapshot.selectionActive;
}

// ---------------------------------------------------------------------------
// Monaco action delegation
// ---------------------------------------------------------------------------

export type MonacoActionFailure = 'no-editor' | 'unknown-action' | 'threw';

export interface MonacoActionResult {
  ran: boolean;
  failure?: MonacoActionFailure;
  error?: string;
}

/**
 * Run a Monaco action on the active editor.
 *
 * This is what Prompt 5 Step 3.1 means by "delegate to Monaco actions so
 * behavior matches editor semantics": cut/copy/paste/comment/multi-cursor/
 * column mode and every Go-menu jump all land here and are executed by Monaco
 * itself, never reimplemented.
 *
 * The editor is focused first on purpose. Clicking a menu row moves DOM focus to
 * the menu bar, and Monaco gates most actions behind `editorTextFocus`, so
 * without this the action would exist, be found, and then refuse to run — a dead
 * click wearing the costume of a working one.
 */
export function runMonacoAction(actionId: string): MonacoActionResult {
  const editor = getActiveEditor();
  if (!editor) return { ran: false, failure: 'no-editor' };

  let action: EditorActionLike | null = null;
  try {
    action = editor.getAction(actionId);
  } catch (err) {
    return { ran: false, failure: 'threw', error: describe(err) };
  }
  if (!action) return { ran: false, failure: 'unknown-action' };

  try {
    editor.focus();
    void action.run();
    return { ran: true };
  } catch (err) {
    return { ran: false, failure: 'threw', error: describe(err) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Move the cursor and centre it, clamped to the model. Returns false when there
 * is no editor to move — callers turn that into an honest decline rather than a
 * silent no-op.
 */
export function revealPosition(position: EditorPositionLike, options?: { focus?: boolean }): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const model = editor.getModel();
  const lineNumber = model
    ? Math.max(1, Math.min(model.getLineCount(), position.lineNumber))
    : Math.max(1, position.lineNumber);
  const column = model
    ? Math.max(1, Math.min(model.getLineMaxColumn(lineNumber), position.column))
    : Math.max(1, position.column);
  const clamped = { lineNumber, column };
  try {
    // Suppress first: `setPosition` fires a cursor event that would otherwise be
    // recorded as a fresh navigation entry, making Back bounce straight forward.
    armSuppression();
    editor.setPosition(clamped);
    editor.revealPositionInCenter(clamped);
    if (options?.focus !== false) editor.focus();
    syncCursorSnapshot(editor);
    return true;
  } catch {
    clearSuppression();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Navigation history (Go G1: Back / Forward)
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;
/** Lines of drift tolerated before a move counts as navigation, not typing. */
const JUMP_THRESHOLD = 8;
/** Quiet period after which in-file drift is committed as one entry. */
const SETTLE_MS = 400;
/** Fallback for a programmatic move that never fires a cursor event. */
const SUPPRESSION_FALLBACK_MS = 250;

let history: NavigationTarget[] = [];
let historyIndex = -1;
let suppressionArmed = false;
let suppressionTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function sameLocation(a: NavigationTarget, b: NavigationTarget): boolean {
  return (
    a.filePath === b.filePath && a.lineNumber === b.lineNumber && a.column === b.column
  );
}

function currentTarget(position: EditorPositionLike): NavigationTarget {
  return {
    filePath: snapshot.filePath,
    lineNumber: position.lineNumber,
    column: position.column
  };
}

function commit(target: NavigationTarget): void {
  const head = history[historyIndex];
  if (head && sameLocation(head, target)) return;
  cancelSettle();
  // Truncate the forward branch: navigating back and then somewhere new makes
  // the old future unreachable, exactly as a browser drops its forward list.
  history = history.slice(0, historyIndex + 1);
  history.push(target);
  if (history.length > HISTORY_LIMIT) history.shift();
  historyIndex = history.length - 1;
  publishHistoryFlags();
}

function publishHistoryFlags(): void {
  publish({
    historyCanGoBack: historyIndex > 0,
    historyCanGoForward: historyIndex >= 0 && historyIndex < history.length - 1
  });
}

function armSuppression(): void {
  suppressionArmed = true;
  clearSuppressionTimer();
  suppressionTimer = setTimeout(clearSuppression, SUPPRESSION_FALLBACK_MS);
}

function clearSuppressionTimer(): void {
  if (suppressionTimer) {
    clearTimeout(suppressionTimer);
    suppressionTimer = null;
  }
}

function clearSuppression(): void {
  suppressionArmed = false;
  clearSuppressionTimer();
}

function consumeSuppression(): boolean {
  if (!suppressionArmed) return false;
  clearSuppression();
  return true;
}

function cancelSettle(): void {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

function scheduleSettle(target: NavigationTarget): void {
  cancelSettle();
  settleTimer = setTimeout(() => {
    settleTimer = null;
    commit(target);
  }, SETTLE_MS);
}

function observePosition(target: NavigationTarget): void {
  // A move this service caused is not a navigation the user asked for.
  if (consumeSuppression()) return;
  const head = history[historyIndex];
  if (head && sameLocation(head, target)) return;
  if (
    head &&
    head.filePath === target.filePath &&
    Math.abs(head.lineNumber - target.lineNumber) < JUMP_THRESHOLD
  ) {
    // Arrow-key drift inside one file: record where they stopped, not each step.
    scheduleSettle(target);
    return;
  }
  commit(target);
}

/** Go G1 Back. Returns where to go, or null when there is no earlier position. */
export function navigateBack(): NavigationTarget | null {
  cancelSettle();
  if (historyIndex <= 0) return null;
  // Commit where the user is now so Forward can bring them back to it.
  const editor = getActiveEditor();
  if (editor) commit(currentTarget(editor.getPosition() ?? snapshot.position));
  if (historyIndex <= 0) return null;
  historyIndex -= 1;
  armSuppression();
  publishHistoryFlags();
  return history[historyIndex];
}

/** Go G1 Forward. */
export function navigateForward(): NavigationTarget | null {
  cancelSettle();
  if (historyIndex < 0 || historyIndex >= history.length - 1) return null;
  historyIndex += 1;
  armSuppression();
  publishHistoryFlags();
  return history[historyIndex];
}

// ---------------------------------------------------------------------------
// Last edit location (Go G1: Ctrl+K Ctrl+Q)
// ---------------------------------------------------------------------------

const lastEdits = new Map<string, EditorPositionLike>();

/**
 * Remember where the file was last edited.
 *
 * Called from `EditorArea`'s change handler. The cursor at change time is the
 * edit site, which is what "last edit location" means to a user pressing
 * Ctrl+K Ctrl+Q after wandering off to read something.
 */
export function recordEdit(filePath?: string | null): void {
  const path = filePath ?? snapshot.filePath;
  if (!path) return;
  const position = getActiveEditor()?.getPosition();
  if (!position) return;
  lastEdits.set(path, { lineNumber: position.lineNumber, column: position.column });
}

export function getLastEditLocation(filePath?: string | null): EditorPositionLike | null {
  const path = filePath ?? snapshot.filePath;
  if (!path) return null;
  return lastEdits.get(path) ?? null;
}

/** Go G1 Last Edit Location, as a navigation target. */
export function lastEditTarget(filePath?: string | null): NavigationTarget | null {
  const path = filePath ?? snapshot.filePath;
  if (!path) return null;
  const position = lastEdits.get(path);
  if (!position) return null;
  armSuppression();
  return { filePath: path, lineNumber: position.lineNumber, column: position.column };
}

/**
 * Drop everything remembered about a file, when its tab closes.
 *
 * Without this the history keeps pointing at files that no longer exist and Back
 * would try to reopen a tab the user deliberately closed.
 */
export function forgetFile(filePath: string): void {
  lastEdits.delete(filePath);
  const before = history.length;
  history = history.filter((entry) => entry.filePath !== filePath);
  if (history.length === before) {
    publishHistoryFlags();
    return;
  }
  const head = history[historyIndex];
  historyIndex = head
    ? history.findIndex((entry) => sameLocation(entry, head))
    : history.length - 1;
  if (historyIndex < 0) historyIndex = history.length - 1;
  publishHistoryFlags();
}

// ---------------------------------------------------------------------------
// Diff change navigation (Go G7)
// ---------------------------------------------------------------------------

/**
 * Next/Previous Change inside an open diff.
 *
 * Walks the diff editor's own hunk list, so the answer is the real set of
 * changes Monaco computed rather than a guess. Wraps at both ends, which is what
 * makes repeated Alt+F3 useful on a long diff.
 */
export function nextDiffChange(direction: 1 | -1): NavigationTarget | null {
  const changes = readDiffChanges();
  if (changes.length === 0) return null;
  const editor = activeDiff?.getModifiedEditor() ?? getActiveEditor();
  const current = editor?.getPosition()?.lineNumber ?? 1;
  const lines = [...new Set(changes.map((change) => change.modifiedStartLineNumber))].sort(
    (a, b) => a - b
  );
  const found =
    direction > 0
      ? lines.find((line) => line > current) ?? lines[0]
      : [...lines].reverse().find((line) => line < current) ?? lines[lines.length - 1];
  armSuppression();
  return { filePath: snapshot.filePath, lineNumber: found, column: 1 };
}

/** Reveal a diff hunk inside the diff's own modified pane. */
export function revealDiffChange(target: NavigationTarget): boolean {
  const editor = activeDiff?.getModifiedEditor() ?? getActiveEditor();
  if (!editor) return false;
  try {
    armSuppression();
    const position = { lineNumber: target.lineNumber, column: target.column };
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    return true;
  } catch {
    clearSuppression();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Symbol providers (Go G4 enablement)
// ---------------------------------------------------------------------------

/**
 * Languages Monaco answers symbol queries for out of the box, via its own
 * TypeScript worker. Everything else needs a language server actually running —
 * a registered-but-dead provider would make F12 a dead click.
 */
export const MONACO_BUILTIN_SYMBOL_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript'
]);

let symbolProviderResolver: (languageId: string) => boolean = (languageId) =>
  MONACO_BUILTIN_SYMBOL_LANGUAGES.has(languageId);

/**
 * Supply the real provider check.
 *
 * The wiring layer installs one that also consults the LSP store, because which
 * servers are running is not this module's business. Returns a disposable that
 * restores the conservative default.
 */
export function setSymbolProviderResolver(
  resolver: (languageId: string) => boolean
): EditorDisposable {
  const previous = symbolProviderResolver;
  symbolProviderResolver = resolver;
  return {
    dispose() {
      if (symbolProviderResolver === resolver) symbolProviderResolver = previous;
    }
  };
}

/**
 * Whether Go to Definition/Declaration/Type Definition/Implementations/References
 * can do anything for the active language. Backs the registry's
 * `editorOpen && hasSymbolProvider` gate and its "No symbol provider for this
 * language" reason.
 */
export function hasSymbolProviderFor(languageId: string | null): boolean {
  if (!languageId) return false;
  try {
    return symbolProviderResolver(languageId);
  } catch {
    return false;
  }
}

export function hasActiveSymbolProvider(): boolean {
  return hasSymbolProviderFor(snapshot.languageId);
}

// ---------------------------------------------------------------------------
// Test/reset support
// ---------------------------------------------------------------------------

/** Drop every instance, listener and remembered position. */
export function resetEditorService(): void {
  cancelSettle();
  clearSuppression();
  for (const registration of registrations.values()) {
    for (const disposable of registration.disposables) {
      try {
        disposable.dispose();
      } catch {
        // Nothing to do: reset must not throw on an already-dead editor.
      }
    }
  }
  registrations.clear();
  diffDisposable?.dispose();
  diffDisposable = null;
  activeEditor = null;
  activeDiff = null;
  history = [];
  historyIndex = -1;
  lastEdits.clear();
  languageListeners.clear();
  symbolProviderResolver = (languageId) => MONACO_BUILTIN_SYMBOL_LANGUAGES.has(languageId);
  snapshot = initialSnapshot();
  for (const listener of listeners) listener();
}
