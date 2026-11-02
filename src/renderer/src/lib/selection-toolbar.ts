/**
 * Prompt E (Step 1) — selection hover toolbar.
 *
 * A Monaco ContentWidget that floats above a non-empty selection with the
 * same six registry-backed actions as the context menu. It deliberately owns
 * no behaviour: every button dispatches through `executeCommandEntry`, so
 * hidden > dead, the `when` re-check, and the handler table stay the single
 * source of truth shared with the menu bar and the palette.
 */

import { executeCommandEntry } from './command-runtime';
import { QUICK_ACTION_ENTRY_IDS } from './ai-quick-actions';

interface ToolbarDisposable {
  dispose: () => void;
}

/** Monaco's ContentWidgetPositionPreference.ABOVE; read defensively. */
function abovePreference(): number {
  const monacoGlobal = (window as unknown as {
    monaco?: { editor?: { ContentWidgetPositionPreference?: { ABOVE?: number } } };
  }).monaco;
  return monacoGlobal?.editor?.ContentWidgetPositionPreference?.ABOVE ?? 1;
}

const TOOLBAR_ACTIONS: Array<{ entryId: string; label: string; title: string }> = [
  { entryId: QUICK_ACTION_ENTRY_IDS.explain, label: 'Explain', title: 'Explain this selection in the Assistant (Plan)' },
  { entryId: QUICK_ACTION_ENTRY_IDS.fix, label: 'Fix', title: 'Fix the bug in this selection (Build)' },
  { entryId: QUICK_ACTION_ENTRY_IDS.refactor, label: 'Refactor', title: 'Refactor this selection, preserving behaviour (Build)' },
  { entryId: QUICK_ACTION_ENTRY_IDS.tests, label: 'Tests', title: 'Generate tests for this selection (Build)' },
  { entryId: QUICK_ACTION_ENTRY_IDS.addToChat, label: '@Chat', title: 'Attach this selection to the chat as @selection' },
  { entryId: 'edit.inline-assist', label: 'Inline', title: 'Inline Assist on this selection (Ctrl+I)' }
];

/**
 * Attach the hover toolbar to one Monaco editor. Returns a disposable; the
 * owning pane disposes it on unmount or re-mount, never leaks a listener.
 */
export function attachSelectionToolbar(editor: any): ToolbarDisposable {
  let widget: { dispose: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const hide = () => {
    if (widget) {
      try { editor.removeContentWidget(widget); } catch { /* already detached */ }
      widget = null;
    }
  };

  const selectionIsEmpty = (selection: any): boolean =>
    !selection ||
    (typeof selection.isEmpty === 'function'
      ? selection.isEmpty()
      : selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn);

  const buildDom = (): HTMLElement => {
    const bar = document.createElement('div');
    bar.className = 'tycode-selection-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Ty-Code quick actions');
    // Same precedent as the inline-assist widget: programmatic DOM styles on
    // theme tokens, since this surface exists outside the React tree.
    bar.style.display = 'inline-flex';
    bar.style.gap = '2px';
    bar.style.alignItems = 'center';
    bar.style.padding = '2px 4px';
    bar.style.borderRadius = '6px';
    bar.style.border = '1px solid var(--border-subtle, #333)';
    bar.style.background = 'var(--surface-3, #24262e)';
    bar.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.35)';
    bar.style.zIndex = '9';
    // mousedown must not steal the selection the actions are about to read.
    bar.addEventListener('mousedown', (event) => event.preventDefault());
    for (const action of TOOLBAR_ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tycode-selection-toolbar-btn';
      button.textContent = action.label;
      button.title = action.title;
      button.style.padding = '2px 7px';
      button.style.fontSize = '11px';
      button.style.fontFamily = 'var(--font-mono, monospace)';
      button.style.color = 'var(--text-primary, #e6e6e6)';
      button.style.background = 'transparent';
      button.style.border = 'none';
      button.style.borderRadius = '4px';
      button.style.cursor = 'pointer';
      button.addEventListener('mouseenter', () => { button.style.background = 'var(--surface-2, #2f323c)'; });
      button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void executeCommandEntry(action.entryId);
      });
      bar.appendChild(button);
    }
    return bar;
  };

  const show = () => {
    if (disposed) return;
    const selection = editor.getSelection?.();
    if (!selection || selectionIsEmpty(selection)) {
      hide();
      return;
    }
    hide();
    const domNode = buildDom();
    const contentWidget = {
      getId: () => `tycode.selection.toolbar.${Math.random().toString(36).slice(2, 8)}`,
      getDomNode: () => domNode,
      getPosition: () => ({
        position: { lineNumber: selection.startLineNumber, column: selection.startColumn },
        preference: [abovePreference()]
      }),
      stopPropagation: () => true,
      dispose: () => {
        try { editor.removeContentWidget(contentWidget); } catch { /* already detached */ }
      }
    };
    editor.addContentWidget(contentWidget);
    widget = contentWidget;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    const selection = editor.getSelection?.();
    if (!selection || selectionIsEmpty(selection)) {
      hide();
      return;
    }
    // Debounce so drag-selecting does not rebuild the widget on every move.
    timer = setTimeout(show, 180);
  };

  const selectionListener = editor.onDidChangeCursorSelection?.(() => schedule());
  const blurListener = editor.onDidBlurEditorText?.(() => {
    if (timer) clearTimeout(timer);
    hide();
  });

  return {
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      selectionListener?.dispose?.();
      blurListener?.dispose?.();
      hide();
    }
  };
}
