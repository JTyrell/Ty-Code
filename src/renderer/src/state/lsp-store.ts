import { create } from 'zustand';
import type { LanguageServerStatus, LspDiagnosticsEvent } from '../../../preload/types';

interface LspState {
  servers: LanguageServerStatus[];
  diagnostics: Record<string, LspDiagnosticsEvent>;
  refreshServers: () => Promise<void>;
  setServers: (servers: LanguageServerStatus[]) => void;
  setDiagnostics: (event: LspDiagnosticsEvent) => void;
  clearDiagnostics: (filePath: string) => void;
}

export const useLspStore = create<LspState>((set) => ({
  servers: [],
  diagnostics: {},
  refreshServers: async () => {
    try {
      const response = await window.electronAPI.lspGetServers();
      if (response.success && response.data) set({ servers: response.data });
    } catch {
      // LSP status is supplementary; editor fallback remains available.
    }
  },
  setServers: (servers) => set({ servers }),
  setDiagnostics: (event) => set((state) => ({ diagnostics: { ...state.diagnostics, [event.filePath]: event } })),
  clearDiagnostics: (filePath) => set((state) => {
    const diagnostics = { ...state.diagnostics };
    delete diagnostics[filePath];
    return { diagnostics };
  })
}));
