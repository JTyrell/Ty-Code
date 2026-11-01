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
  /**
   * Whether a diagnostics sweep has actually completed since this window booted.
   *
   * `analysisResults.length === 0` cannot answer that on its own — an empty list
   * is equally consistent with "the engines found nothing" and with "nobody has
   * asked the engines yet" — and the two deserve different copy. Only the first
   * may be described as a clean workspace. Seeded from main's `lastSweepAt`,
   * which only `pushResults` advances, so it is a real completion rather than a
   * renderer's hope; set locally when a sweep this window asked for returns.
   */
  hasRunAnalysis: boolean;
  /**
   * Why the last sweep did not produce results, or null.
   *
   * Held as state rather than swallowed because the previous behaviour was a
   * `setTimeout` that cleared the spinner and left the panel displaying whatever
   * it already had, which read as success. See `runAnalysis`.
   */
  analysisError: string | null;

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

// No seed findings. Every entry this store used to start with was invented in
// source — fixed ids, invented severities, and file/line pairs asserted about
// the user's own code without any engine having read it — and the panel rendered
// them on first open because `analysisResults` was this array and `selectedRole`
// defaulted to 'dev'. Findings arrive from the engines via `updateResults`, or
// the panel says no sweep has run yet. `scripts/no-fake-debugger-findings.mjs`
// keeps it that way.

export const useDebuggerStore = create<DebuggerState>((set, get) => ({
  // Null rather than a checked-in path: a default here would both filter the
  // first view onto a file the workspace may not contain and make the sweep
  // button target that file instead of the workspace.
  activeFile: null,
  analysisResults: [],
  isPopOutMode: true,
  selectedRole: 'dev',
  selectedSeverity: 'all',
  selectedEngine: 'all',
  searchQuery: '',
  isAnalyzing: false,
  hasRunAnalysis: false,
  analysisError: null,

  setActiveFile: (file: string | null) => {
    set({ activeFile: file });
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ activeFile: file });
    }
  },

  /**
   * Accept findings produced by main's engines.
   *
   * Reaching this means a sweep ran: `pushResults` on the main side is called
   * only from inside `runAnalysis`, and the IPC mirror of it is the only route
   * here. So a non-empty *or* empty payload both legitimately mark the store as
   * swept — an empty sweep is a real result, not an absence of one.
   */
  updateResults: (results: AnalysisResult[]) => {
    set({ analysisResults: results, isAnalyzing: false, hasRunAnalysis: true });
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

  /**
   * Ask main to run the static, dynamic, architectural and AI engines.
   *
   * Every exit names an outcome. The version this replaces had a branch
   * commented "Fallback local simulated sweep if offline" that waited 600ms and
   * then only cleared `isAnalyzing`, so a failed IPC left the spinner gone and
   * the previous findings on screen — indistinguishable from a sweep that had
   * just confirmed them. There is no local stand-in for the engines, and a
   * missing bridge or a rejected payload is reported instead of rounded away.
   *
   * Prior findings are deliberately kept when a new sweep fails, paired with the
   * error: they are stale but they were real, and clearing them would imply the
   * workspace became clean because a button was pressed.
   */
  runAnalysis: async (filePath?: string) => {
    const target = filePath || get().activeFile || 'all';
    set({ isAnalyzing: true, analysisError: null });

    const runAnalysisBridge = window.electronAPI?.debuggerRunAnalysis;
    if (!runAnalysisBridge) {
      set({
        isAnalyzing: false,
        analysisError:
          'This window has no bridge to the diagnostics engines, so no sweep could run. Open the debugger from the main workbench window.'
      });
      return;
    }

    try {
      const response = await runAnalysisBridge({ filePath: target, role: get().selectedRole });
      if (response?.success && response.data) {
        get().updateResults(response.data as AnalysisResult[]);
        set({ analysisError: null });
        return;
      }
      set({
        isAnalyzing: false,
        analysisError: response?.error || 'The diagnostics sweep returned no result.'
      });
    } catch (err) {
      console.error('[OmniDebugger] Analysis run failed:', err);
      set({
        isAnalyzing: false,
        analysisError: err instanceof Error ? err.message : String(err)
      });
    }
  },

  /**
   * Withdraw the current findings from view.
   *
   * Also resets `hasRunAnalysis`: once nothing is on screen, "no sweep has run"
   * is the honest state again, and leaving the flag true would let the empty
   * panel claim a clean workspace that the user just asked it to forget.
   */
  clearResults: () => {
    set({ analysisResults: [], hasRunAnalysis: false, analysisError: null });
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

    /**
     * Copy a snapshot's swept marker into this window.
     *
     * Assigned from `lastSweepAt` rather than inferred from the array length, so
     * that a genuinely clean sweep (zero findings) still reads as swept and a
     * window that has merely never asked still does not. Written with `!==
     * undefined` rather than truthiness because `null` is itself the meaningful
     * answer "no sweep has run", and a missing key from an older main is left to
     * speak for nothing.
     */
    const applySweptFlag = (state: { lastSweepAt?: number | null }): void => {
      if (state.lastSweepAt === undefined) return;
      useDebuggerStore.setState({ hasRunAnalysis: state.lastSweepAt !== null });
    };

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
      applySweptFlag(state);
      if (state.theme) {
        applyAppTheme(normalizeAppTheme(state.theme), true);
      }
      // Contract (Workspace Session Bus, Prompt 1): debugger snapshots never
      // re-seed workspace-store. The root lives in the session bus; root
      // changes replay through main's open-folder / session broadcasts.
    });

    // 3. Request initial snapshot if available
    void window.electronAPI.debuggerRequestState?.().then((res) => {
      if (res?.success && res.data) {
        const d = res.data as any;
        if (d.activeFile) setActiveFile(d.activeFile);
        if (d.analysisResults?.length) useDebuggerStore.setState({ analysisResults: d.analysisResults });
        if (d.selectedRole) setRole(d.selectedRole);
        if (d.isPopOutMode !== undefined) useDebuggerStore.setState({ isPopOutMode: Boolean(d.isPopOutMode) });
        applySweptFlag(d);
        if (d.theme) applyAppTheme(normalizeAppTheme(d.theme), false);
        // Contract (Workspace Session Bus, Prompt 1): initial debugger
        // snapshots may not adopt a workspace root either — same rule as above.
      }
    });

    return () => {
      unsubscribeUpdate?.();
      unsubscribeSync?.();
    };
  }, [updateResults, setActiveFile, setRole]);
}
