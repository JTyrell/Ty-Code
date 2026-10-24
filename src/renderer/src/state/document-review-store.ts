import { create } from 'zustand';
import type { AgentDocument } from '../../../preload/types';

export type DocumentReviewMode = 'preview' | 'edit';
export type DocumentReviewStatus = 'pending' | 'approved' | 'revision-requested';

export interface DocumentReviewState {
  activeDocument: AgentDocument | null;
  mode: DocumentReviewMode;
  comments: Record<string, string[]>;
  status: DocumentReviewStatus;
  isDocumentTabOpen: boolean;
  isDocTabActive: boolean;
  updatedSectionIds: string[];

  // Actions
  openDocument: (doc: AgentDocument) => void;
  setMode: (mode: DocumentReviewMode) => void;
  addComment: (sectionId: string, comment: string) => void;
  setStatus: (status: DocumentReviewStatus) => void;
  clearDocument: () => void;
  setDocTabActive: (active: boolean) => void;
  updateDocumentMarkdown: (markdown: string) => void;
  restoreLastDocument: () => Promise<AgentDocument | null>;
}

export const useDocumentReviewStore = create<DocumentReviewState>((set, get) => ({
  activeDocument: null,
  mode: 'preview',
  comments: {},
  status: 'pending',
  isDocumentTabOpen: false,
  isDocTabActive: false,
  updatedSectionIds: [],

  openDocument: (doc: AgentDocument) => {
    const prevDoc = get().activeDocument;
    const currentComments = get().comments;

    // 1. Diff old vs new sections to detect changed sections
    const updatedSectionIds: string[] = [];
    if (prevDoc && (prevDoc.id === doc.id || prevDoc.kind === doc.kind)) {
      const prevSectionMap = new Map(
        prevDoc.sections.map((s) => [s.heading.trim().toLowerCase(), s.markdown.trim()])
      );
      for (const section of doc.sections) {
        const prevContent = prevSectionMap.get(section.heading.trim().toLowerCase());
        if (prevContent === undefined || prevContent !== section.markdown.trim()) {
          updatedSectionIds.push(section.id);
        }
      }
    }

    // 2. Preserve existing section comments where heading IDs still match
    const newSectionIds = new Set(doc.sections.map((s) => s.id));
    const preservedComments: Record<string, string[]> = {};
    for (const [secId, comms] of Object.entries(currentComments)) {
      if (newSectionIds.has(secId)) {
        preservedComments[secId] = comms;
      }
    }

    set({
      activeDocument: doc,
      mode: 'preview',
      status: 'pending',
      isDocumentTabOpen: true,
      isDocTabActive: true,
      comments: preservedComments,
      updatedSectionIds
    });
  },

  setMode: (mode: DocumentReviewMode) => set({ mode }),

  addComment: (sectionId: string, comment: string) => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    set((state) => ({
      comments: {
        ...state.comments,
        [sectionId]: [...(state.comments[sectionId] || []), trimmed]
      }
    }));
  },

  setStatus: (status: DocumentReviewStatus) => set({ status }),

  clearDocument: () => {
    set({
      activeDocument: null,
      mode: 'preview',
      status: 'pending',
      isDocumentTabOpen: false,
      isDocTabActive: false,
      comments: {},
      updatedSectionIds: []
    });
  },

  setDocTabActive: (active: boolean) => set({ isDocTabActive: active }),

  updateDocumentMarkdown: (markdown: string) => {
    const current = get().activeDocument;
    if (!current) return;
    set({
      activeDocument: {
        ...current,
        markdown
      }
    });
  },

  restoreLastDocument: async () => {
    const api = typeof window !== 'undefined'
      ? window.electronAPI
      : typeof globalThis !== 'undefined'
      ? (globalThis as any).electronAPI || (globalThis as any).window?.electronAPI
      : undefined;

    if (api?.getLastDocument) {
      try {
        const response = await api.getLastDocument();
        const doc = (response as any)?.data ?? response;
        if (doc && typeof doc === 'object' && doc.id && Array.isArray(doc.sections)) {
          get().openDocument(doc);
          return doc;
        }
      } catch {
        // Fallback silently if no documents exist
      }
    }
    return null;
  }
}));

/**
 * Top-level disposable subscription to onDocumentProposed IPC event.
 * Returns a cleanup function for useEffect.
 */
export function initDocumentProposedListener(): () => void {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return () => {};
  }
  const subscriber = window.electronAPI.onDocumentProposed || window.electronAPI.onAgentDocumentProposed;
  if (typeof subscriber !== 'function') {
    return () => {};
  }

  const dispose = subscriber((payload: any) => {
    const doc = payload?.document ?? payload;
    if (doc && typeof doc === 'object' && doc.id && doc.title && Array.isArray(doc.sections)) {
      useDocumentReviewStore.getState().openDocument(doc);
    }
  });

  return typeof dispose === 'function' ? dispose : () => {};
}
