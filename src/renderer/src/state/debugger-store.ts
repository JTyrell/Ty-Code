import { create } from 'zustand';
import { useEffect } from 'react';
import { applyAppTheme, normalizeAppTheme } from '../hooks/useThemeSync';

export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AnalysisEngine = 'static' | 'dynamic' | 'arch' | 'ai';
export type AnalysisRole = 'dev' | 'qa' | 'pm';

export interface AnalysisResult {
  id: string;
  severity: AnalysisSeverity;
  engine: AnalysisEngine;
  role: AnalysisRole;
  message: string;
  line?: number;
  codeSnippet?: string;
  filePath?: string;
  ruleId?: string;
  suggestedFix?: string;
  timestamp?: number;
}

export interface DebuggerState {
  activeFile: string | null;
  analysisResults: AnalysisResult[];
  isPopOutMode: boolean;
  selectedRole: AnalysisRole;
  selectedSeverity: 'all' | AnalysisSeverity;
  selectedEngine: 'all' | AnalysisEngine;
  searchQuery: string;
  isAnalyzing: boolean;

  // Required Actions:
  setActiveFile: (file: string | null) => void;
  updateResults: (results: AnalysisResult[]) => void;
  togglePopOutMode: () => void;
  setRole: (role: AnalysisRole) => void;

  // Additional Helper Actions:
  setSeverityFilter: (severity: 'all' | AnalysisSeverity) => void;
  setEngineFilter: (engine: 'all' | AnalysisEngine) => void;
  setSearchQuery: (query: string) => void;
  runAnalysis: (filePath?: string) => Promise<void>;
  clearResults: () => void;
}

export const INITIAL_ANALYSIS_RESULTS: AnalysisResult[] = [
  {
    id: 'res-static-01',
    severity: 'critical',
    engine: 'static',
    role: 'dev',
    message: 'Potential unhandled Promise rejection in asynchronous stream pipeline.',
    line: 87,
    codeSnippet: 'const res = await ProviderGateway.streamChat(settings, messages);',
    filePath: 'src/main/agent/agent-engine.ts',
    ruleId: 'no-floating-promises',
    suggestedFix: 'Wrap in try/catch block and dispatch AgentErrorPayloadSchema event to renderer.'
  },
  {
    id: 'res-dyn-02',
    severity: 'high',
    engine: 'dynamic',
    role: 'dev',
    message: 'High re-render velocity detected: token stream listener not throttled to display VSync.',
    line: 142,
    codeSnippet: 'onChunk: (c) => set({ streamingText: state.streamingText + c.content })',
    filePath: 'src/renderer/src/state/chat-store.ts',
    ruleId: 'perf-excessive-renders',
    suggestedFix: 'Use 24ms micro-batching buffer with requestAnimationFrame sync.'
  },
  {
    id: 'res-arch-03',
    severity: 'medium',
    engine: 'arch',
    role: 'dev',
    message: 'Process boundary violation: Renderer attempting direct filesystem access without contextBridge.',
    line: 45,
    codeSnippet: 'import fs from "node:fs";',
    filePath: 'src/renderer/src/components/EditorArea.tsx',
    ruleId: 'arch-boundary-enforcement',
    suggestedFix: 'Route through window.electronAPI.readWorkspaceFile IPC handler.'
  },
  {
    id: 'res-qa-01',
    severity: 'high',
    engine: 'dynamic',
    role: 'qa',
    message: 'Edge case test failure: Empty API key for custom endpoint returns unhandled 500 instead of 400 Bad Request.',
    line: 112,
    codeSnippet: 'if (!apiKey) throw new Error("Missing key");',
    filePath: 'src/main/providers/provider-gateway.ts',
    ruleId: 'qa-boundary-validation',
    suggestedFix: 'Add input schema validation using Zod with descriptive error card payload.'
  },
  {
    id: 'res-qa-02',
    severity: 'medium',
    engine: 'static',
    role: 'qa',
    message: 'Zero-coverage path detected: autoCompactSession branch has no unit or live E2E test assertions.',
    line: 264,
    codeSnippet: 'if (compactCheck.shouldCompact) { await this.sessionStore.autoCompactSession(session); }',
    filePath: 'src/main/services/orchestration/agent-manager.ts',
    ruleId: 'qa-uncovered-branch',
    suggestedFix: 'Add test case in scripts/verify-compact-coverage.mjs to assert token ratio threshold.'
  },
  {
    id: 'res-pm-01',
    severity: 'high',
    engine: 'arch',
    role: 'pm',
    message: 'User Experience Risk: Rate limit backoff exceeds 8 seconds without visual progress or timeout cancel affordance.',
    line: 198,
    codeSnippet: 'await new Promise((r) => setTimeout(r, backoffMs));',
    filePath: 'src/main/services/orchestration/model-router.ts',
    ruleId: 'pm-ux-latency-threshold',
    suggestedFix: 'Show indeterminate loader badge with "Cancel Task" or "Switch to Local Ollama" button.'
  },
  {
    id: 'res-pm-02',
    severity: 'low',
    engine: 'static',
    role: 'pm',
    message: 'Accessibility Compliance: Terminal profile selector lacks ARIA live status announcer for screen readers.',
    line: 1378,
    codeSnippet: '<select value={defaultProfileId} onChange={...}>',
    filePath: 'src/renderer/src/components/SettingsModal.tsx',
    ruleId: 'pm-a11y-wcag2-aa',
    suggestedFix: 'Add aria-describedby="default-profile-help" and announce active profile selection.'
  }
];

export const useDebuggerStore = create<DebuggerState>((set, get) => ({
  activeFile: 'src/main/agent/agent-engine.ts',
  analysisResults: INITIAL_ANALYSIS_RESULTS,
  isPopOutMode: true,
  selectedRole: 'dev',
  selectedSeverity: 'all',
  selectedEngine: 'all',
  searchQuery: '',
  isAnalyzing: false,

  setActiveFile: (file: string | null) => {
    set({ activeFile: file });
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ activeFile: file });
    }
  },

  updateResults: (results: AnalysisResult[]) => {
    set({ analysisResults: results, isAnalyzing: false });
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ analysisResults: results });
    }
  },

  togglePopOutMode: () => {
    const nextMode = !get().isPopOutMode;
    set({ isPopOutMode: nextMode });

    if (nextMode) {
      if (window.electronAPI?.debuggerOpenWindow) {
        void window.electronAPI.debuggerOpenWindow();
      }
    } else {
      if (window.electronAPI?.debuggerCloseWindow) {
        void window.electronAPI.debuggerCloseWindow();
      }
    }

    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ isPopOutMode: nextMode });
    }
  },

  setRole: (role: AnalysisRole) => {
    set({ selectedRole: role });
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ selectedRole: role });
    }
  },

  setSeverityFilter: (severity: 'all' | AnalysisSeverity) => set({ selectedSeverity: severity }),
  setEngineFilter: (engine: 'all' | AnalysisEngine) => set({ selectedEngine: engine }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),

  runAnalysis: async (filePath?: string) => {
    const target = filePath || get().activeFile || 'all';
    set({ isAnalyzing: true });
    try {
      if (window.electronAPI?.debuggerRunAnalysis) {
        const response = await window.electronAPI.debuggerRunAnalysis({
          filePath: target,
          role: get().selectedRole
        });
        if (response.success && response.data) {
          get().updateResults(response.data as AnalysisResult[]);
          return;
        }
      }
      // Fallback local simulated sweep if offline
      setTimeout(() => {
        set({ isAnalyzing: false });
      }, 600);
    } catch (err) {
      console.error('[OmniDebugger] Analysis run failed:', err);
      set({ isAnalyzing: false });
    }
  },

  clearResults: () => {
    set({ analysisResults: [] });
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ analysisResults: [] });
    }
  }
}));

/**
 * Hook to listen to window.electronAPI.onDebuggerUpdate and onDebuggerStateSynced,
 * pushing incoming IPC results directly into the Zustand store.
 */
export function useDebuggerStoreListener(): void {
  const updateResults = useDebuggerStore((s) => s.updateResults);
  const setActiveFile = useDebuggerStore((s) => s.setActiveFile);
  const setRole = useDebuggerStore((s) => s.setRole);

  useEffect(() => {
    if (!window.electronAPI) return;

    // 1. Listen for dynamic diagnostic updates / analysis sweeps
    const unsubscribeUpdate = window.electronAPI.onDebuggerUpdate?.((data: any) => {
      if (!data) return;
      if (Array.isArray(data)) {
        updateResults(data as AnalysisResult[]);
      } else if (data.results && Array.isArray(data.results)) {
        updateResults(data.results as AnalysisResult[]);
      }
    });

    // 2. Listen for state synchronization between main & pop-out windows
    const unsubscribeSync = window.electronAPI.onDebuggerStateSynced?.((state: any) => {
      if (!state) return;
      if (state.activeFile !== undefined) setActiveFile(state.activeFile);
      if (state.analysisResults && Array.isArray(state.analysisResults)) {
        useDebuggerStore.setState({ analysisResults: state.analysisResults });
      }
      if (state.selectedRole) setRole(state.selectedRole);
      if (state.isPopOutMode !== undefined) {
        useDebuggerStore.setState({ isPopOutMode: Boolean(state.isPopOutMode) });
      }
      if (state.theme) {
        applyAppTheme(normalizeAppTheme(state.theme), true);
      }
    });

    // 3. Request initial snapshot if available
    void window.electronAPI.debuggerRequestState?.().then((res) => {
      if (res?.success && res.data) {
        const d = res.data as any;
        if (d.activeFile) setActiveFile(d.activeFile);
        if (d.analysisResults?.length) useDebuggerStore.setState({ analysisResults: d.analysisResults });
        if (d.selectedRole) setRole(d.selectedRole);
        if (d.isPopOutMode !== undefined) useDebuggerStore.setState({ isPopOutMode: Boolean(d.isPopOutMode) });
        if (d.theme) applyAppTheme(normalizeAppTheme(d.theme), false);
      }
    });

    return () => {
      unsubscribeUpdate?.();
      unsubscribeSync?.();
    };
  }, [updateResults, setActiveFile, setRole]);
}
