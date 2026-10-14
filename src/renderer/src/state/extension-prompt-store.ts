import { create } from 'zustand';

interface ExtensionInputPrompt {
  id: string;
  prompt: string;
  value: string;
}

interface ExtensionPromptState {
  inputPrompt: ExtensionInputPrompt | null;
  requestInput: (prompt: string, initialValue?: string) => Promise<string | undefined>;
  updateInput: (value: string) => void;
  resolveInput: (value?: string) => void;
}

let resolvePendingInput: ((value: string | undefined) => void) | null = null;

export const useExtensionPromptStore = create<ExtensionPromptState>((set, get) => ({
  inputPrompt: null,
  requestInput: (prompt, initialValue = '') => {
    if (resolvePendingInput) get().resolveInput(undefined);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      resolvePendingInput = resolve;
      set({ inputPrompt: { id, prompt: prompt.slice(0, 500), value: initialValue.slice(0, 2_000) } });
    });
  },
  updateInput: (value) => set((state) => state.inputPrompt ? { inputPrompt: { ...state.inputPrompt, value: value.slice(0, 2_000) } } : state),
  resolveInput: (value) => {
    const resolve = resolvePendingInput;
    resolvePendingInput = null;
    set({ inputPrompt: null });
    resolve?.(value);
  }
}));
