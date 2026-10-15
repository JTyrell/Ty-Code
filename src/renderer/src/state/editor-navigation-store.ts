import { create } from 'zustand';

export interface EditorNavigationTarget {
  filePath?: string;
  line: number;
  column?: number;
}

type EditorActionName = 'toggleMinimap' | 'toggleWordWrap' | 'toggleZenMode' | 'splitVertical' | 'splitHorizontal' | 'renameSymbol' | 'findReferences' | 'goToDefinition' | 'goToImplementation' | 'quickFix';
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
