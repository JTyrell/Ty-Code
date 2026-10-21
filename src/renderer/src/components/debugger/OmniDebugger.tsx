import React, { useState, useMemo, useEffect } from 'react';
import {
  Bug,
  Cpu,
  Layers,
  Sparkles,
  Play,
  RotateCw,
  ExternalLink,
  Minimize2,
  FileCode,
  FolderTree,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  Search,
  Filter,
  Check,
  Copy,
  ChevronRight,
  ShieldAlert,
  Code2,
  Wrench,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import {
  useDebuggerStore,
  useDebuggerStoreListener,
  type AnalysisResult,
  type AnalysisRole,
  type AnalysisSeverity,
  type AnalysisEngine
} from '../../state/debugger-store';

interface OmniDebuggerProps {
  isStandalone?: boolean;
}

export const OmniDebugger: React.FC<OmniDebuggerProps> = ({ isStandalone = false }) => {
  // Mount store listener for IPC synchronization
  useDebuggerStoreListener();

  const {
    activeFile,
    analysisResults,
    isPopOutMode,
    selectedRole,
    selectedSeverity,
    selectedEngine,
    searchQuery,
    isAnalyzing,
    setActiveFile,
    togglePopOutMode,
    setRole,
    setSeverityFilter,
    setEngineFilter,
    setSearchQuery,
    runAnalysis,
    clearResults
  } = useDebuggerStore();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fixedIds, setFixedIds] = useState<Record<string, boolean>>({});
  const [isFileTreeExpanded, setIsFileTreeExpanded] = useState<boolean>(true);

  // Auto-clear copied state
  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedId]);

  // Requirement 2: If isPopOutMode is true and rendered inside the sidebar, hide it / show docked placeholder
  if (isPopOutMode && !isStandalone) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center select-none bg-zinc-950/95 border-r border-zinc-800/80">
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/10">
            <Bug size={26} className="text-indigo-400 animate-pulse" />
          </div>
          <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-600 text-white shadow">
            EXT
          </span>
        </div>

        <h3 className="text-sm font-semibold text-zinc-100 tracking-wide">
          Omni-Debugger Popped Out
        </h3>
        <p className="text-xs text-zinc-400 mt-2 max-w-[220px] leading-relaxed">
          Running in a dedicated, high-performance window for multi-monitor inspection.
        </p>

        <div className="mt-5 flex flex-col gap-2.5 w-full max-w-[210px]">
          <button
            type="button"
            onClick={() => window.electronAPI?.debuggerOpenWindow?.()}
            className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
          >
            <ExternalLink size={14} />
            Focus Debugger Window
          </button>

          <button
            type="button"
            onClick={togglePopOutMode}
            className="w-full px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium transition-colors border border-zinc-700/60 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Minimize2 size={13} />
            Dock Back in Sidebar
          </button>
        </div>
      </div>
    );
  }

  // Pre-aggregated list of workspace files & modules with findings
  const fileNodes = useMemo(() => {
    const defaultModules = [
      'src/main/agent/agent-engine.ts',
      'src/renderer/src/state/chat-store.ts',
      'src/renderer/src/components/EditorArea.tsx',
      'src/main/providers/provider-gateway.ts',
      'src/main/services/orchestration/agent-manager.ts',
      'src/main/services/orchestration/model-router.ts',
      'src/renderer/src/components/SettingsModal.tsx'
    ];

    const fileMap: Record<string, { count: number; maxSeverity: AnalysisSeverity }> = {};

    analysisResults.forEach((res) => {
      if (!res.filePath) return;
      if (!fileMap[res.filePath]) {
        fileMap[res.filePath] = { count: 0, maxSeverity: res.severity };
      }
      fileMap[res.filePath].count += 1;
      // Elevate max severity if higher
      const severityOrder: Record<AnalysisSeverity, number> = {
        critical: 5,
        high: 4,
        medium: 3,
        low: 2,
        info: 1
      };
      if (severityOrder[res.severity] > severityOrder[fileMap[res.filePath].maxSeverity]) {
        fileMap[res.filePath].maxSeverity = res.severity;
      }
    });

    const set = new Set([...defaultModules, ...Object.keys(fileMap)]);
    return Array.from(set).map((pathStr) => ({
      path: pathStr,
      name: pathStr.split('/').pop() || pathStr,
      dir: pathStr.substring(0, pathStr.lastIndexOf('/')),
      count: fileMap[pathStr]?.count || 0,
      maxSeverity: fileMap[pathStr]?.maxSeverity || null
    }));
  }, [analysisResults]);

  // Filtered analysis items based on current active tab, search, role, and engines
  const filteredResults = useMemo(() => {
    return analysisResults.filter((item) => {
      // 1. Role filter (Dev, QA, PM)
      if (selectedRole !== item.role) return false;

      // 2. Active file filter (if not "all")
      if (activeFile && activeFile !== 'all' && item.filePath && !item.filePath.toLowerCase().includes(activeFile.toLowerCase())) {
        return false;
      }

      // 3. Severity filter
      if (selectedSeverity !== 'all' && item.severity !== selectedSeverity) {
        return false;
      }

      // 4. Engine filter
      if (selectedEngine !== 'all' && item.engine !== selectedEngine) {
        return false;
      }

      // 5. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMsg = item.message.toLowerCase().includes(query);
        const matchesFile = item.filePath?.toLowerCase().includes(query) ?? false;
        const matchesRule = item.ruleId?.toLowerCase().includes(query) ?? false;
        const matchesSnippet = item.codeSnippet?.toLowerCase().includes(query) ?? false;
        if (!matchesMsg && !matchesFile && !matchesRule && !matchesSnippet) {
          return false;
        }
      }

      return true;
    });
  }, [analysisResults, selectedRole, activeFile, selectedSeverity, selectedEngine, searchQuery]);

  // Counts summary by severity
  const countsBySeverity = useMemo(() => {
    const map: Record<AnalysisSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };
    analysisResults
      .filter((r) => r.role === selectedRole)
      .forEach((r) => {
        map[r.severity] = (map[r.severity] || 0) + 1;
      });
    return map;
  }, [analysisResults, selectedRole]);

  const handleCopySnippet = (item: AnalysisResult) => {
    const text = item.suggestedFix || item.codeSnippet || item.message;
    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
  };

  const handleApplyFix = (id: string) => {
    setFixedIds((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#121316] text-zinc-200 select-none overflow-hidden font-sans border-r border-zinc-800/80">
      {/* ===================================================================== */}
      {/* PANE 1: TOP TOOLBAR */}
      {/* ===================================================================== */}
      <header className="flex flex-col border-b border-zinc-800/80 bg-zinc-950/80 px-3 py-2.5 gap-2.5 shrink-0 backdrop-blur-md">
        {/* Top line: Brand badge, Role pills, and Window action controls */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Omni-Debugger Title & Role Selector */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-md shadow-indigo-500/10">
                <Bug size={16} />
              </div>
              <span className="text-xs font-bold tracking-wider uppercase text-zinc-100 hidden sm:inline-block">
                Omni-Debugger
              </span>
            </div>

            {/* Role Selector: Dev / QA / PM */}
            <div className="flex items-center bg-zinc-900/90 p-0.5 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => setRole('dev')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedRole === 'dev'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
                title="Developer Perspective: Syntax, performance, async flow, and system boundaries"
              >
                <Code2 size={13} />
                <span>DEV</span>
              </button>

              <button
                type="button"
                onClick={() => setRole('qa')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedRole === 'qa'
                    ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
                title="QA Perspective: Edge cases, zero-coverage branches, input boundary assertions"
              >
                <ShieldAlert size={13} />
                <span>QA</span>
              </button>

              <button
                type="button"
                onClick={() => setRole('pm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedRole === 'pm'
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
                title="Product Manager Perspective: UX latency, ARIA accessibility, error fallbacks"
              >
                <Layers size={13} />
                <span>PM</span>
              </button>
            </div>
          </div>

          {/* Action buttons: Run Analysis & Pop Out */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runAnalysis(activeFile || undefined)}
              disabled={isAnalyzing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
                isAnalyzing
                  ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98]'
              }`}
              title="Execute full static, dynamic, and architectural diagnostics sweep"
            >
              <RotateCw size={13} className={isAnalyzing ? 'animate-spin' : ''} />
              <span>{isAnalyzing ? 'Analyzing…' : 'Run Full Analysis'}</span>
            </button>

            {/* Pop Out / Dock In toggle */}
            <button
              type="button"
              onClick={togglePopOutMode}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-800 transition-colors cursor-pointer"
              title={isPopOutMode ? 'Dock in Left Sidebar' : 'Pop Out into Dedicated Window'}
            >
              {isPopOutMode ? <Minimize2 size={15} /> : <ExternalLink size={15} />}
            </button>
          </div>
        </div>

        {/* Second line: Search bar, Engine filter pills, and Severity breakdown */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Quick search input */}
          <div className="relative flex-1 min-w-[160px] max-w-[280px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter rules, messages, files…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-8 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/80 transition-colors"
            />
          </div>

          {/* Engine filter pills */}
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-zinc-500 font-medium mr-1 text-[10px] uppercase tracking-wider">Engine:</span>
            {(['all', 'static', 'dynamic', 'arch'] as const).map((eng) => (
              <button
                key={eng}
                type="button"
                onClick={() => setEngineFilter(eng)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                  selectedEngine === eng
                    ? 'bg-zinc-800 text-indigo-400 border border-indigo-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {eng}
              </button>
            ))}
          </div>

          {/* Severity filter badges */}
          <div className="flex items-center gap-1.5 ml-auto text-[11px]">
            <button
              type="button"
              onClick={() => setSeverityFilter('all')}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                selectedSeverity === 'all'
                  ? 'bg-zinc-800 text-zinc-200 font-semibold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              All ({analysisResults.filter((r) => r.role === selectedRole).length})
            </button>

            {countsBySeverity.critical > 0 && (
              <button
                type="button"
                onClick={() => setSeverityFilter(selectedSeverity === 'critical' ? 'all' : 'critical')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                  selectedSeverity === 'critical'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50'
                    : 'bg-rose-500/10 text-rose-400/80 hover:bg-rose-500/20'
                }`}
              >
                {countsBySeverity.critical} Crit
              </button>
            )}

            {countsBySeverity.high > 0 && (
              <button
                type="button"
                onClick={() => setSeverityFilter(selectedSeverity === 'high' ? 'all' : 'high')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                  selectedSeverity === 'high'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-orange-500/10 text-orange-400/80 hover:bg-orange-500/20'
                }`}
              >
                {countsBySeverity.high} High
              </button>
            )}

            {countsBySeverity.medium > 0 && (
              <button
                type="button"
                onClick={() => setSeverityFilter(selectedSeverity === 'medium' ? 'all' : 'medium')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                  selectedSeverity === 'medium'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                    : 'bg-amber-500/10 text-amber-400/80 hover:bg-amber-500/20'
                }`}
              >
                {countsBySeverity.medium} Med
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* 2-COLUMN LOWER BODY: LEFT (FILE TREE) & RIGHT (RESULTS PANEL) */}
      {/* ===================================================================== */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* =================================================================== */}
        {/* PANE 2: FILE / MODULE TREE */}
        {/* =================================================================== */}
        <aside
          className={`flex flex-col border-r border-zinc-800/80 bg-zinc-950/60 transition-all duration-200 shrink-0 ${
            isFileTreeExpanded ? 'w-64 sm:w-72' : 'w-10'
          }`}
        >
          {/* File tree header */}
          <div className="h-8 flex items-center justify-between px-2.5 border-b border-zinc-800/60 text-[11px] font-semibold text-zinc-400 tracking-wider uppercase">
            {isFileTreeExpanded ? (
              <>
                <div className="flex items-center gap-1.5">
                  <FolderTree size={13} className="text-zinc-500" />
                  <span>Target Scope</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFileTreeExpanded(false)}
                  className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
                  title="Collapse Scope Tree"
                >
                  <PanelLeftClose size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsFileTreeExpanded(true)}
                className="w-full h-full flex items-center justify-center text-zinc-500 hover:text-zinc-300"
                title="Expand Scope Tree"
              >
                <PanelLeftOpen size={13} />
              </button>
            )}
          </div>

          {/* Module List */}
          {isFileTreeExpanded ? (
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {/* Entire Project node */}
              <button
                type="button"
                onClick={() => setActiveFile(null)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left ${
                  !activeFile || activeFile === 'all'
                    ? 'bg-indigo-600/15 text-indigo-300 font-semibold border border-indigo-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Cpu size={14} className="text-indigo-400 shrink-0" />
                  <span className="truncate">Entire Workspace</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-900 text-zinc-400 font-mono">
                  {analysisResults.length}
                </span>
              </button>

              <div className="pt-2 pb-1 px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                Monitored Files
              </div>

              {fileNodes.map((node) => {
                const isSelected = activeFile === node.path;
                return (
                  <button
                    key={node.path}
                    type="button"
                    onClick={() => setActiveFile(node.path)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left ${
                      isSelected
                        ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/40'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                    }`}
                    title={node.path}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileCode size={13} className="text-zinc-500 shrink-0" />
                      <div className="min-w-0 flex flex-col">
                        <span className="truncate text-xs font-medium text-zinc-200 leading-tight">
                          {node.name}
                        </span>
                        <span className="truncate text-[10px] text-zinc-500 font-mono leading-tight">
                          {node.dir}
                        </span>
                      </div>
                    </div>

                    {node.count > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold shrink-0 ml-1.5 ${
                          node.maxSeverity === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                            : node.maxSeverity === 'high'
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {node.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center py-3 gap-3">
              <button
                type="button"
                onClick={() => setActiveFile(null)}
                className={`p-1.5 rounded transition-colors ${
                  !activeFile ? 'text-indigo-400 bg-indigo-500/20' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Entire Workspace"
              >
                <Cpu size={15} />
              </button>
              {fileNodes.slice(0, 5).map((node) => (
                <button
                  key={node.path}
                  type="button"
                  onClick={() => setActiveFile(node.path)}
                  className={`p-1.5 rounded transition-colors ${
                    activeFile === node.path ? 'text-indigo-400 bg-indigo-500/20' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={node.path}
                >
                  <FileCode size={15} />
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* =================================================================== */}
        {/* PANE 3: RESULTS PANEL */}
        {/* =================================================================== */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#121316] overflow-y-auto">
          {/* Results Header bar */}
          <div className="h-8 flex items-center justify-between px-3 border-b border-zinc-800/60 bg-zinc-950/40 text-[11px] text-zinc-400 shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-200">
                {filteredResults.length} {filteredResults.length === 1 ? 'Finding' : 'Findings'}
              </span>
              <span className="text-zinc-600">•</span>
              <span className="capitalize text-zinc-400">
                Scope: {activeFile ? activeFile.split('/').pop() : 'All Monitored Files'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearResults}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                Clear Results
              </button>
            </div>
          </div>

          {/* Results List or Empty State */}
          <div className="flex-1 p-3 space-y-3">
            {filteredResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center p-6 border border-dashed border-zinc-800/80 rounded-xl my-4 bg-zinc-950/20">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3">
                  <CheckCircle2 size={24} />
                </div>
                <h4 className="text-sm font-semibold text-zinc-200">No Issues Detected</h4>
                <p className="text-xs text-zinc-500 max-w-sm mt-1 leading-relaxed">
                  All active static syntax rules, dynamic re-render benchmarks, and architecture boundaries
                  passed cleanly for role <strong className="text-zinc-400 uppercase">{selectedRole}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => runAnalysis(activeFile || undefined)}
                  className="mt-4 px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCw size={12} />
                  Run Diagnostics Sweep
                </button>
              </div>
            ) : (
              filteredResults.map((item) => {
                const isFixed = fixedIds[item.id];
                const isCopied = copiedId === item.id;

                const severityStyle = {
                  critical: {
                    badge: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
                    border: 'border-l-rose-500',
                    icon: <AlertOctagon size={14} className="text-rose-400 shrink-0" />
                  },
                  high: {
                    badge: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
                    border: 'border-l-orange-500',
                    icon: <AlertTriangle size={14} className="text-orange-400 shrink-0" />
                  },
                  medium: {
                    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
                    border: 'border-l-amber-500',
                    icon: <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                  },
                  low: {
                    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
                    border: 'border-l-blue-500',
                    icon: <Info size={14} className="text-blue-400 shrink-0" />
                  },
                  info: {
                    badge: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/40',
                    border: 'border-l-zinc-500',
                    icon: <Info size={14} className="text-zinc-400 shrink-0" />
                  }
                }[item.severity];

                const engineColor = {
                  static: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
                  dynamic: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
                  arch: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
                  ai: 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                }[item.engine];

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-3.5 transition-all shadow-sm border-l-4 ${
                      severityStyle.border
                    } ${isFixed ? 'opacity-50 line-through' : 'hover:border-zinc-700/80'}`}
                  >
                    {/* Header: Severity, Engine, Role, Rule ID, and File location */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Severity badge */}
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border ${
                            severityStyle.badge
                          }`}
                        >
                          {severityStyle.icon}
                          {item.severity}
                        </span>

                        {/* Engine badge */}
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${engineColor}`}
                        >
                          {item.engine} engine
                        </span>

                        {/* Role pill */}
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-zinc-900 text-zinc-400 border border-zinc-800">
                          {item.role}
                        </span>

                        {/* Rule ID */}
                        {item.ruleId && (
                          <span className="text-[11px] font-mono text-zinc-500">
                            #{item.ruleId}
                          </span>
                        )}
                      </div>

                      {/* File location with line number */}
                      {item.filePath && (
                        <div className="text-[11px] font-mono text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800/80 flex items-center gap-1">
                          <FileCode size={11} className="text-zinc-500" />
                          <span>{item.filePath}</span>
                          {item.line !== undefined && (
                            <span className="text-indigo-400 font-semibold">:{item.line}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Diagnostic message */}
                    <p className="text-xs font-medium text-zinc-100 leading-relaxed mb-2.5">
                      {item.message}
                    </p>

                    {/* Code Snippet Preview (if available) */}
                    {item.codeSnippet && (
                      <div className="rounded-lg bg-[#0c0d0e] border border-zinc-900 p-2.5 font-mono text-[11px] text-zinc-300 mb-2.5 overflow-x-auto relative group">
                        <div className="flex items-start gap-2">
                          <span className="text-zinc-600 select-none text-[10px] pt-0.5">
                            {item.line ?? '1'}
                          </span>
                          <code className="text-indigo-200">{item.codeSnippet}</code>
                        </div>
                      </div>
                    )}

                    {/* Suggested Fix Action Card */}
                    {item.suggestedFix && (
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5 flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                        <div className="flex items-start gap-2 min-w-0">
                          <Wrench size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                          <div className="text-[11px] leading-relaxed">
                            <span className="font-semibold text-emerald-400">Suggested Fix: </span>
                            <span className="text-zinc-300">{item.suggestedFix}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          <button
                            type="button"
                            onClick={() => handleCopySnippet(item)}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Copy Fix to Clipboard"
                          >
                            {isCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                            <span>{isCopied ? 'Copied' : 'Copy'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleApplyFix(item.id)}
                            disabled={isFixed}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                              isFixed
                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30'
                            }`}
                          >
                            {isFixed ? <Check size={11} /> : <Sparkles size={11} />}
                            <span>{isFixed ? 'Applied' : 'Apply'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
