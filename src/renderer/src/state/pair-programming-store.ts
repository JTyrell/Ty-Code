import { create } from 'zustand';
import type { PairProgrammingEvent, PairProgrammingSuggestion } from '../../../preload/types';
import { toast } from './toast-store';

interface PairProgrammingState {
  isPairActive: boolean;
  suggestions: PairProgrammingSuggestion[];
  currentMode: 'tdd' | 'collaborative' | 'proactive-review';
  togglePairMode: () => void;
  setMode: (mode: 'tdd' | 'collaborative' | 'proactive-review') => void;
  processEditorEvent: (event: PairProgrammingEvent) => Promise<void>;
  dismissSuggestion: (id: string) => void;
  clearSuggestions: () => void;
}

export const usePairProgrammingStore = create<PairProgrammingState>((set, get) => ({
  isPairActive: false,
  suggestions: [],
  currentMode: 'collaborative',

  togglePairMode: () => {
    const nextState = !get().isPairActive;
    set({ isPairActive: nextState });
    if (nextState) {
      toast.info('Pair Programmer Active', 'Ty-Code is now actively collaborating with you as you type.');
    } else {
      toast.info('Pair Programmer Paused', 'AI pair programming mode turned off.');
    }
  },

  setMode: (mode) => set({ currentMode: mode }),

  processEditorEvent: async (event: PairProgrammingEvent) => {
    if (!get().isPairActive) return;
    try {
      const res = await window.electronAPI.getPairProgrammingSuggestions(event);
      if (res.success && res.data && res.data.length > 0) {
        const current = get().suggestions;
        // Merge without duplicates by title
        const newSuggestions = res.data.filter((item) => !current.some((c) => c.title === item.title));
        if (newSuggestions.length > 0) {
          set({ suggestions: [...newSuggestions, ...current].slice(0, 15) });
        }
      }
    } catch {
      // Graceful error ignore
    }
  },

  dismissSuggestion: (id: string) => {
    set({ suggestions: get().suggestions.filter((s) => s.id !== id) });
  },

  clearSuggestions: () => {
    set({ suggestions: [] });
  }
}));
