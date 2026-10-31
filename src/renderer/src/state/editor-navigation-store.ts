import { create } from 'zustand';

export interface EditorNavigationTarget {
  filePath?: string;
  line: number;
  column?: number;
}

/**
 * The editor-side implementations a command handler can ask for.
 *
 * Exported because `lib/workbench-commands.ts` has to check whether one is
 * actually registered before calling it: `runAction` is a silent no-op when
 * `EditorArea` is unmounted, and a menu row that quietly does nothing is the
 * dead click the registry exists to remove.
 *
 * `refreshBlame` is the one entry that is *not* a user-facing toggle. Saving
 * used to bump a `useState` counter inside `EditorArea` from its own keydown
 * listener; with that listener retired in favour of registry keybindings, the
 * bump has to be reachable from the `workbench.save` handler, and this store is
 * already the bridge between the two.
 */
export type EditorActionName = 'toggleMinimap' | 'toggleWordWrap' | 'toggleZenMode' | 'splitVertical' | 'splitHorizontal' | 'renameSymbol' | 'findReferences' | 'goToDefinition' | 'goToImplementation' | 'quickFix' | 'refreshBlame';
type EditorActionHandlers = Partial<Record<EditorActionName, () => void>>;

interface EditorNavigationState {
  request: { id: number; target: EditorNavigationTarget } | null;
  actions: EditorActionHandlers;
  nextId: number;
  navigateTo: (target: EditorNavigationTarget) => void;
  clearRequest: (id: number) => void;
  registerActions: (actions: EditorActionHandlers) => () => void;
  runAction: (action: EditorActionName) => void;
}

export const useEditorNavigationStore = create<EditorNavigationState>((set, get) => ({
  request: null,
  actions: {},
  nextId: 1,
  navigateTo: (target) => set((state) => ({ request: { id: state.nextId, target }, nextId: state.nextId + 1 })),
  clearRequest: (id) => set((state) => state.request?.id === id ? { request: null } : state),
  registerActions: (actions) => {
    set({ actions });
    return () => set((state) => state.actions === actions ? { actions: {} } : state);
  },
  runAction: (action) => get().actions[action]?.()
}));
