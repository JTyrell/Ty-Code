import React, { useState, useMemo, useEffect } from 'react';
import {
  Bug,
  Cpu,
  Layers,
  Sparkles,
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
  Check,
  Copy,
  ShieldAlert,
  Code2,
  Wrench,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  Terminal,
  ArrowUpRight,
  BarChart3,
  Sliders,
  Zap,
  X,
  ShieldCheck,
  Gauge,
  Globe
} from 'lucide-react';
import {
  useDebuggerStore,
  useDebuggerStoreListener,
  type AnalysisResult,
  type AnalysisRole,
  type AnalysisSeverity,
  type AnalysisEngine
} from '../../state/debugger-store';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import { useEditorNavigationStore } from '../../state/editor-navigation-store';
import { useChatStore } from '../../state/chat-store';
import { DebuggerToolbar } from './DebuggerToolbar';
import { WorkspaceGate } from '../common/WorkspaceGate';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import { useWorkspaceStore } from '../../state/workspace-store';
import { BraveTestingView } from '../testing/BraveTestingView';
import './OmniDebugger.css';

interface OmniDebuggerProps {
  isStandalone?: boolean;
}

type ViewTab = 'findings' | 'engines' | 'metrics' | 'testing';

export const OmniDebugger: React.FC<OmniDebuggerProps> = ({ isStandalone = false }) => {
  // Mount store listener for IPC synchronization
  useDebuggerStoreListener();

  // Surface session attachment for workspace session bus
  const { attachSurface, detachSurface } = useWorkspaceSessionStore();

  useEffect(() => {
    attachSurface('debugger');
    return () => detachSurface('debugger');
  }, [attachSurface, detachSurface]);

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
  const isWorkspaceReady = useWorkspaceStore((s) => s.isWorkspaceReady);
  const workspaceRoot = useWorkspaceStore((s) => s.workspaceRoot || s.workspacePath);

  const [activeTab, setActiveTab] = useState<ViewTab>('findings');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fixedIds, setFixedIds] = useState<Record<string, boolean>>({});
  const [isFileTreeExpanded, setIsFileTreeExpanded] = useState<boolean>(true);
  const [onlyActionable, setOnlyActionable] = useState<boolean>(false);
  const [aiStreamingMsg, setAiStreamingMsg] = useState<string | null>(null);

  // Auto-clear copied state
  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedId]);

  // Hook up live AI stream listener if available
  useEffect(() => {
    if (!isWorkspaceReady || !workspaceRoot) return;
    if (!window.electronAPI?.onDebuggerAiStream) return;
    const unsubscribe = window.electronAPI.onDebuggerAiStream((frame: any) => {
      if (frame?.token) {
        setAiStreamingMsg((prev) => (prev ? prev + frame.token : frame.token));
      } else if (frame?.done) {
        setTimeout(() => setAiStreamingMsg(null), 3000);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [isWorkspaceReady, workspaceRoot]);

  // Requirement: If isPopOutMode is true and rendered inside the sidebar, show docked placeholder
  if (isPopOutMode && !isStandalone) {
    return (
      <WorkspaceGate featureName="Omni-Debugger" message="Indexing Workspace for Omni-Debugger...">
        <div className="omni-docked-placeholder select-none">
        <div className="omni-docked-icon-wrap">
          <Bug size={30} className="text-indigo-400" />
          <span className="omni-docked-badge">LIVE EXT</span>
        </div>

        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px 0' }}>
          Omni-Debugger Popped Out
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 20px 0', maxWidth: '240px', lineHeight: 1.5 }}>
          Running in a dedicated, high-performance window for multi-monitor inspection and zero editor latency.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '220px' }}>
          <button
            type="button"
            onClick={() => window.electronAPI?.debuggerOpenWindow?.()}
            className="omni-btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '9px 16px' }}
          >
            <ExternalLink size={14} />
            <span>Focus Debugger Window</span>
          </button>

          <button
            type="button"
            onClick={togglePopOutMode}
            className="omni-btn-copy"
            style={{ width: '100%', justifyContent: 'center', padding: '8px 14px' }}
          >
            <Minimize2 size={13} />
            <span>Dock Back in Sidebar</span>
          </button>
        </div>
      </div>
    </WorkspaceGate>
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

  // Filtered analysis items based on role, active file, severity, engine, search, and actionable flag
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

      // 5. Only Actionable filter
      if (onlyActionable && !item.suggestedFix) {
        return false;
      }

      // 6. Search query
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
  }, [analysisResults, selectedRole, activeFile, selectedSeverity, selectedEngine, onlyActionable, searchQuery]);

  // Counts summary by severity for currently selected role
  const roleResults = useMemo(() => {
    return analysisResults.filter((r) => r.role === selectedRole);
  }, [analysisResults, selectedRole]);

  const countsBySeverity = useMemo(() => {
    const map: Record<AnalysisSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };
    roleResults.forEach((r) => {
      map[r.severity] = (map[r.severity] || 0) + 1;
    });
    return map;
  }, [roleResults]);

  // Code Health Score Calculation (0-100)
  const healthScore = useMemo(() => {
    const penalty =
      countsBySeverity.critical * 25 +
      countsBySeverity.high * 15 +
      countsBySeverity.medium * 8 +
      countsBySeverity.low * 3;
    return Math.max(10, Math.min(100, 100 - penalty));
  }, [countsBySeverity]);

  const healthGrade = useMemo(() => {
    if (healthScore >= 90) return { letter: 'A+', class: 'grade-a', label: 'Optimal' };
    if (healthScore >= 75) return { letter: 'B', class: 'grade-b', label: 'Minor Risks' };
    return { letter: 'C', class: 'grade-c', label: 'Action Needed' };
  }, [healthScore]);

  // Handlers
  const handleCopySnippet = (item: AnalysisResult) => {
    const text = item.suggestedFix || item.codeSnippet || item.message;
    void navigator.clipboard.writeText(text);
    setCopiedId(item.id);
  };

  const handleApplyFix = (id: string) => {
    setFixedIds((prev) => ({ ...prev, [id]: true }));
  };

  const handleJumpToCode = (item: AnalysisResult) => {
    if (!item.filePath) return;
    useEditorNavigationStore.getState().navigateTo({
      filePath: item.filePath,
      line: item.line || 1
    });
  };

  const handleAskAIToFix = (item: AnalysisResult) => {
    const prompt = `[Omni-Debugger ${item.role.toUpperCase()} Finding #${item.ruleId || 'diagnostic'}]\nFile: ${item.filePath || 'workspace'}${item.line ? `:${item.line}` : ''}\nEngine: ${item.engine.toUpperCase()}\nSeverity: ${item.severity.toUpperCase()}\nIssue: ${item.message}\n${item.codeSnippet ? `\nCode:\n\`\`\`\n${item.codeSnippet}\n\`\`\`\n` : ''}${item.suggestedFix ? `\nSuggested Remediation: ${item.suggestedFix}\n` : ''}\nPlease review and apply the complete architectural fix.`;
    useChatStore.getState().setDraftPrompt(prompt);
  };

  return (
    <WorkspaceGate featureName="Omni-Debugger" message="Indexing Workspace for Omni-Debugger...">
      <div className="omni-debugger-root">
      {/* ===================================================================== */}
      {/* 1. TOP COMMAND BAR */}
      {/* ===================================================================== */}
      <header className="omni-debugger-header">
        <div className="omni-debugger-top-row">
          {/* Brand & Perspective Switcher */}
          <div className="omni-brand-badge">
            <div className="omni-brand-icon">
              <Bug size={17} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="omni-brand-title">Omni-Debugger</span>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Multi-Engine Inspector
              </span>
            </div>
          </div>

          {/* Role Segmented Controller (DEV / QA / PM) */}
          <div className="omni-role-group" role="tablist" aria-label="Analysis Perspective">
            <button
              type="button"
              role="tab"
              aria-selected={selectedRole === 'dev'}
              onClick={() => setRole('dev')}
              className={`omni-role-btn ${selectedRole === 'dev' ? 'active-dev' : ''}`}
              title="Developer Perspective: Syntax, performance, async flow, and system boundaries"
            >
              <Code2 size={13} />
              <span>DEV</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedRole === 'qa'}
              onClick={() => setRole('qa')}
              className={`omni-role-btn ${selectedRole === 'qa' ? 'active-qa' : ''}`}
              title="QA Perspective: Edge cases, zero-coverage branches, input boundary assertions"
            >
              <ShieldAlert size={13} />
              <span>QA</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedRole === 'pm'}
              onClick={() => setRole('pm')}
              className={`omni-role-btn ${selectedRole === 'pm' ? 'active-pm' : ''}`}
              title="Product Manager Perspective: UX latency, ARIA accessibility, error fallbacks"
            >
              <Layers size={13} />
              <span>PM</span>
            </button>
          </div>

          {/* Intelligent Model Selector (Auto vs Manual) */}
          <DebuggerToolbar />

          {/* Action Buttons: Run Sweep & Pop-out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => void runAnalysis(activeFile || undefined)}
              disabled={isAnalyzing}
              className="omni-btn-primary"
              title="Execute full static, dynamic, architectural, and AI diagnostic sweep"
            >
              <RotateCw size={13} className={isAnalyzing ? 'animate-spin' : ''} />
              <span>{isAnalyzing ? 'Sweeping…' : 'Run Sweep'}</span>
            </button>

            <button
              type="button"
              onClick={() => void runAnalysis(activeFile || undefined)}
              disabled={isAnalyzing}
              className="omni-btn-ai-sweep"
              title="Run AI Deep Architectural Analyst"
            >
              <Sparkles size={13} />
              <span>AI Analyst</span>
            </button>

            {/* Pop Out / Dock Toggle */}
            <button
              type="button"
              onClick={togglePopOutMode}
              className="omni-btn-icon"
              title={isPopOutMode ? 'Dock in Left Sidebar' : 'Pop Out into Dedicated Multi-Monitor Window'}
            >
              {isPopOutMode ? <Minimize2 size={14} /> : <ExternalLink size={14} />}
            </button>
        </div>
      </div>
      {/* Workspace session presence strip (Prompt 1: session bus) */}
      <div style={{ padding: '3px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <SessionPresenceStrip self="debugger" />
      </div>
      </header>

      {/* ===================================================================== */}
      {/* 2. DIAGNOSTICS HERO HUD STRIP */}
      {/* ===================================================================== */}
      <div className="omni-hud-bar">
        {/* Quality Score Ring */}
        <div className="omni-score-badge">
          <div className={`omni-score-ring ${healthGrade.class}`}>{healthGrade.letter}</div>
          <div className="omni-score-label">
            <strong>{healthScore}/100 Health</strong>
            <span>{healthGrade.label}</span>
          </div>
        </div>

        {/* 4 Active Engines Status Chips */}
        <div className="omni-engines-status-strip">
          <div className="omni-engine-chip chip-static" title="Static AST & Syntax Rule Analyzer">
            <span className="dot" />
            <span>Static AST</span>
          </div>
          <div className="omni-engine-chip chip-dynamic" title="Dynamic Runtime & Re-render Profiler">
            <span className="dot" />
            <span>Profiler</span>
          </div>
          <div className="omni-engine-chip chip-arch" title="Process Isolation & Architectural Boundary Engine">
            <span className="dot" />
            <span>Arch Boundary</span>
          </div>
          <div className="omni-engine-chip chip-ai" title="AI Deep Reasoning Code Health Analyst">
            <span className="dot" />
            <span>AI Analyst</span>
          </div>
        </div>

        {/* Severity Count Filter Buttons */}
        <div className="omni-severity-badges">
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            className={`omni-sev-btn sev-all ${selectedSeverity === 'all' ? 'active' : ''}`}
            title="Show all findings"
          >
            <span>All ({roleResults.length})</span>
          </button>

          {countsBySeverity.critical > 0 && (
            <button
              type="button"
              onClick={() => setSeverityFilter(selectedSeverity === 'critical' ? 'all' : 'critical')}
              className={`omni-sev-btn sev-crit ${selectedSeverity === 'critical' ? 'active' : ''}`}
              title="Filter to Critical severity"
            >
              <AlertOctagon size={11} />
              <span>{countsBySeverity.critical} Crit</span>
            </button>
          )}

          {countsBySeverity.high > 0 && (
            <button
              type="button"
              onClick={() => setSeverityFilter(selectedSeverity === 'high' ? 'all' : 'high')}
              className={`omni-sev-btn sev-high ${selectedSeverity === 'high' ? 'active' : ''}`}
              title="Filter to High severity"
            >
              <AlertTriangle size={11} />
              <span>{countsBySeverity.high} High</span>
            </button>
          )}

          {countsBySeverity.medium > 0 && (
            <button
              type="button"
              onClick={() => setSeverityFilter(selectedSeverity === 'medium' ? 'all' : 'medium')}
              className={`omni-sev-btn sev-med ${selectedSeverity === 'medium' ? 'active' : ''}`}
              title="Filter to Medium severity"
            >
              <AlertTriangle size={11} />
              <span>{countsBySeverity.medium} Med</span>
            </button>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 3. SUBTABS & FILTER CONTROLS */}
      {/* ===================================================================== */}
      <div className="omni-subtabs-row">
        {/* Segmented View Mode Tabs */}
        <div className="omni-segmented-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('findings')}
            className={`omni-tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
          >
            <Bug size={12} />
            <span>Findings ({filteredResults.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('engines')}
            className={`omni-tab-btn ${activeTab === 'engines' ? 'active' : ''}`}
          >
            <Cpu size={12} />
            <span>Engine Map</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('metrics')}
            className={`omni-tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
          >
            <BarChart3 size={12} />
            <span>Health Matrix</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('testing')}
            className={`omni-tab-btn ${activeTab === 'testing' ? 'active' : ''}`}
            style={activeTab === 'testing' ? { borderColor: '#ff5500', color: '#ff6622' } : {}}
          >
            <Globe size={12} />
            <span>AI Local Testing</span>
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="omni-filter-toolbar">
          {/* Search Input */}
          <div className="omni-search-wrapper">
            <Search size={12} className="omni-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rules, messages, files…"
              className="omni-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="omni-search-clear"
                title="Clear Search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Engine Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            {(['all', 'static', 'dynamic', 'arch', 'ai'] as const).map((eng) => (
              <button
                key={eng}
                type="button"
                onClick={() => setEngineFilter(eng)}
                style={{
                  padding: '3px 7px',
                  borderRadius: '5px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  border: selectedEngine === eng ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                  background: selectedEngine === eng ? 'rgba(99, 102, 241, 0.2)' : 'var(--surface-2)',
                  color: selectedEngine === eng ? 'var(--accent-primary)' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                {eng}
              </button>
            ))}
          </div>

          {/* Actionable Only Filter Toggle */}
          <button
            type="button"
            onClick={() => setOnlyActionable(!onlyActionable)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '10.5px',
              fontWeight: 600,
              border: onlyActionable ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid transparent',
              background: onlyActionable ? 'rgba(16, 185, 129, 0.2)' : 'var(--surface-2)',
              color: onlyActionable ? 'var(--accent-green)' : 'var(--text-muted)',
              cursor: 'pointer'
            }}
            title="Filter to findings that have automated suggested fixes"
          >
            <Wrench size={11} />
            <span>Has Fix</span>
          </button>
        </div>
      </div>

      {/* Live AI Streaming notification banner if active */}
      {aiStreamingMsg && (
        <div
          style={{
            padding: '6px 14px',
            background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.2), rgba(99, 102, 241, 0.15))',
            borderBottom: '1px solid rgba(168, 85, 247, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            color: 'var(--accent-primary)'
          }}
        >
          <Sparkles size={12} className="animate-pulse text-purple-400" />
          <span style={{ fontWeight: 600 }}>AI Analyst Live Stream:</span>
          <span style={{ fontFamily: 'monospace', opacity: 0.9 }}>{aiStreamingMsg}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. MAIN VIEWPORT: FINDINGS / ENGINES / METRICS */}
      {/* ===================================================================== */}
      <div className="omni-body-container">
        {/* Collapsible Target Scope Sidebar */}
        <aside className={`omni-scope-sidebar ${isFileTreeExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="omni-scope-header">
            {isFileTreeExpanded ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FolderTree size={12} />
                  <span>Target Scope</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFileTreeExpanded(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                  title="Collapse Scope Tree"
                >
                  <PanelLeftClose size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsFileTreeExpanded(true)}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="Expand Scope Tree"
              >
                <PanelLeftOpen size={13} />
              </button>
            )}
          </div>

          {isFileTreeExpanded ? (
            <div className="omni-scope-list">
              {/* Entire Workspace node */}
              <button
                type="button"
                onClick={() => setActiveFile(null)}
                className={`omni-scope-item ${!activeFile || activeFile === 'all' ? 'selected' : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                  <Cpu size={14} color="var(--accent-primary)" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Entire Workspace
                  </span>
                </div>
                <span className="omni-scope-count">{analysisResults.length}</span>
              </button>

              <div style={{ padding: '8px 8px 4px', fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Monitored Files
              </div>

              {fileNodes.map((node) => {
                const isSelected = activeFile === node.path;
                return (
                  <button
                    key={node.path}
                    type="button"
                    onClick={() => setActiveFile(node.path)}
                    className={`omni-scope-item ${isSelected ? 'selected' : ''}`}
                    title={node.path}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <FileCode size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {node.name}
                        </span>
                        <span style={{ fontSize: '9.5px', color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {node.dir}
                        </span>
                      </div>
                    </div>

                    {node.count > 0 && (
                      <span
                        className={`omni-scope-count ${
                          node.maxSeverity === 'critical'
                            ? 'count-crit'
                            : node.maxSeverity === 'high'
                            ? 'count-high'
                            : ''
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveFile(null)}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  background: !activeFile ? 'var(--surface-3)' : 'transparent',
                  border: 'none',
                  color: !activeFile ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
                title="Entire Workspace"
              >
                <Cpu size={15} />
              </button>
              {fileNodes.slice(0, 5).map((node) => (
                <button
                  key={node.path}
                  type="button"
                  onClick={() => setActiveFile(node.path)}
                  style={{
                    padding: '6px',
                    borderRadius: '6px',
                    background: activeFile === node.path ? 'var(--surface-3)' : 'transparent',
                    border: 'none',
                    color: activeFile === node.path ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                  title={node.path}
                >
                  <FileCode size={15} />
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Viewport Content */}
        <main className="omni-findings-viewport">
          {/* ================================================================= */}
          {/* TAB 1: FINDINGS STREAM */}
          {/* ================================================================= */}
          {activeTab === 'findings' && (
            <>
              {/* Findings Header Bar */}
              <div className="omni-findings-status-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {filteredResults.length} {filteredResults.length === 1 ? 'Finding' : 'Findings'}
                  </span>
                  <span>•</span>
                  <span>Scope: {activeFile ? activeFile.split('/').pop() : 'All Workspace Files'}</span>
                  {selectedEngine !== 'all' && <span>• Engine: {selectedEngine.toUpperCase()}</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={clearResults}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Clear Results
                  </button>
                </div>
              </div>

              {/* Cards List or Clean Empty State */}
              <div className="omni-cards-container">
                {filteredResults.length === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '48px 24px',
                      borderRadius: '12px',
                      border: '1px dashed var(--border-subtle)',
                      background: 'var(--surface-2)',
                      textAlign: 'center',
                      margin: '20px 0'
                    }}
                  >
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-green)',
                        marginBottom: '12px'
                      }}
                    >
                      <CheckCircle2 size={24} />
                    </div>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      All Diagnostics Passing Cleanly
                    </h4>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', maxWidth: '380px', lineHeight: 1.5 }}>
                      Zero critical violations detected across Static AST, Dynamic Runtime profiling, and Architectural boundaries for <strong style={{ color: 'var(--text-primary)', textTransform: 'uppercase' }}>{selectedRole}</strong>.
                    </p>
                    <button
                      type="button"
                      onClick={() => void runAnalysis(activeFile || undefined)}
                      className="omni-btn-primary"
                      style={{ marginTop: '16px' }}
                    >
                      <RotateCw size={13} />
                      <span>Re-Sweep Scope</span>
                    </button>
                  </div>
                ) : (
                  filteredResults.map((item) => {
                    const isFixed = fixedIds[item.id];
                    const isCopied = copiedId === item.id;

                    const severityClass = {
                      critical: 'border-crit',
                      high: 'border-high',
                      medium: 'border-med',
                      low: 'border-low',
                      info: 'border-info'
                    }[item.severity];

                    const badgeClass = {
                      critical: 'badge-crit',
                      high: 'badge-high',
                      medium: 'badge-med',
                      low: 'badge-low',
                      info: 'badge-info'
                    }[item.severity];

                    const engineBadgeClass = {
                      static: 'engine-static',
                      dynamic: 'engine-dynamic',
                      arch: 'engine-arch',
                      ai: 'engine-ai'
                    }[item.engine];

                    return (
                      <div
                        key={item.id}
                        className={`omni-finding-card ${severityClass} ${isFixed ? 'is-fixed' : ''}`}
                      >
                        {/* Header: Severity, Engine, Role, Rule, Location */}
                        <div className="omni-card-header">
                          <div className="omni-card-badges">
                            {/* Severity Badge */}
                            <span className={`omni-badge ${badgeClass}`}>
                              {item.severity === 'critical' ? (
                                <AlertOctagon size={11} />
                              ) : (
                                <AlertTriangle size={11} />
                              )}
                              <span>{item.severity}</span>
                            </span>

                            {/* Engine Badge */}
                            <span className={`omni-badge badge-engine ${engineBadgeClass}`}>
                              <span>{item.engine} engine</span>
                            </span>

                            {/* Role Pill */}
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: 'var(--surface-2)',
                                color: 'var(--text-muted)'
                              }}
                            >
                              {item.role}
                            </span>

                            {/* Rule ID */}
                            {item.ruleId && (
                              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                #{item.ruleId}
                              </span>
                            )}
                          </div>

                          {/* File & Line Jump Pill */}
                          {item.filePath && (
                            <button
                              type="button"
                              onClick={() => handleJumpToCode(item)}
                              className="omni-location-pill"
                              title="Click to jump directly to this line in Monaco Editor"
                            >
                              <FileCode size={11} />
                              <span>{item.filePath}</span>
                              {item.line !== undefined && (
                                <span className="omni-location-line">:{item.line}</span>
                              )}
                              <ArrowUpRight size={10} style={{ opacity: 0.6 }} />
                            </button>
                          )}
                        </div>

                        {/* Diagnostic Description */}
                        <p className="omni-card-message">{item.message}</p>

                        {/* Code Snippet */}
                        {item.codeSnippet && (
                          <div className="omni-code-snippet">
                            <span className="omni-snippet-line-num">{item.line || '1'}</span>
                            <code className="omni-snippet-code">{item.codeSnippet}</code>
                          </div>
                        )}

                        {/* Suggested Fix Action Box */}
                        {item.suggestedFix && (
                          <div className="omni-fix-box">
                            <div className="omni-fix-content">
                              <Wrench size={13} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: '2px' }} />
                              <div className="omni-fix-text">
                                <strong>Suggested Fix: </strong>
                                <span>{item.suggestedFix}</span>
                              </div>
                            </div>

                            <div className="omni-fix-actions">
                              <button
                                type="button"
                                onClick={() => handleCopySnippet(item)}
                                className="omni-btn-copy"
                                title="Copy suggested fix to clipboard"
                              >
                                {isCopied ? <Check size={11} color="var(--accent-green)" /> : <Copy size={11} />}
                                <span>{isCopied ? 'Copied' : 'Copy'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAskAIToFix(item)}
                                className="omni-btn-ask-ai"
                                title="Send issue to Ty-Code Chat Sidecar to refactor automatically"
                              >
                                <Sparkles size={11} />
                                <span>Ask AI</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleApplyFix(item.id)}
                                disabled={isFixed}
                                className="omni-btn-apply"
                                title="Mark this diagnostic remediation as applied"
                              >
                                {isFixed ? <Check size={11} /> : <Zap size={11} />}
                                <span>{isFixed ? 'Applied ✓' : 'Apply Fix'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* ================================================================= */}
          {/* TAB 2: MULTI-ENGINE ARCHITECTURE MAP */}
          {/* ================================================================= */}
          {activeTab === 'engines' && (
            <div className="omni-engine-matrix-grid">
              {/* Static AST Engine */}
              <div className="omni-engine-card card-static">
                <div className="omni-engine-card-top">
                  <div className="omni-engine-title-group">
                    <div className="omni-engine-icon-wrap" style={{ background: 'rgba(99, 102, 241, 0.2)', color: 'var(--accent-primary)' }}>
                      <Code2 size={18} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Static AST Engine
                      </h4>
                      <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600 }}>AST / Syntax / Linter</span>
                    </div>
                  </div>
                  <span className="omni-badge badge-engine engine-static">Active</span>
                </div>
                <p className="omni-engine-card-desc">
                  Performs deep abstract syntax tree traverses on TypeScript and JavaScript code without executing it, flagging floating promises, unhandled rejection branches, and dead paths.
                </p>
                <div className="omni-engine-rules-list">
                  <div className="omni-engine-rule-item">
                    <span>Promise Handling:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>no-floating-promises</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Async Concurrency:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>race-condition-guard</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Dead Code:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>unreachable-branches</strong>
                  </div>
                </div>
              </div>

              {/* Dynamic Profiler Engine */}
              <div className="omni-engine-card card-dynamic">
                <div className="omni-engine-card-top">
                  <div className="omni-engine-title-group">
                    <div className="omni-engine-icon-wrap" style={{ background: 'rgba(168, 85, 247, 0.2)', color: 'var(--accent-primary)' }}>
                      <Activity size={18} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Dynamic Profiler
                      </h4>
                      <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600 }}>VSync / Memory / Latency</span>
                    </div>
                  </div>
                  <span className="omni-badge badge-engine engine-dynamic">Hooked</span>
                </div>
                <p className="omni-engine-card-desc">
                  Monitors re-render velocity, IPC frame buffering, and garbage collection pressure to maintain a 60 FPS silky smooth developer experience.
                </p>
                <div className="omni-engine-rules-list">
                  <div className="omni-engine-rule-item">
                    <span>Render Frequency:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>24ms micro-batching</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Stream Profiling:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>rAF synchronization</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Memory Footprint:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>no-listener-leaks</strong>
                  </div>
                </div>
              </div>

              {/* Architecture Boundary Engine */}
              <div className="omni-engine-card card-arch">
                <div className="omni-engine-card-top">
                  <div className="omni-engine-title-group">
                    <div className="omni-engine-icon-wrap" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--accent-green)' }}>
                      <ShieldCheck size={18} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Arch Boundary Engine
                      </h4>
                      <span style={{ fontSize: '10px', color: 'var(--accent-green)', fontWeight: 600 }}>IPC / Isolation / Security</span>
                    </div>
                  </div>
                  <span className="omni-badge badge-engine engine-arch">Enforced</span>
                </div>
                <p className="omni-engine-card-desc">
                  Guarantees complete process boundary isolation between Electron main and renderer processes, preventing raw filesystem exfiltration and enforcing contextBridge security.
                </p>
                <div className="omni-engine-rules-list">
                  <div className="omni-engine-rule-item">
                    <span>Process Boundary:</span>
                    <strong style={{ color: 'var(--accent-green)' }}>contextBridge IPC</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Zero Exfiltration:</span>
                    <strong style={{ color: 'var(--accent-green)' }}>safeStorage keyring</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Credential Shield:</span>
                    <strong style={{ color: 'var(--accent-green)' }}>no-plaintext-keys</strong>
                  </div>
                </div>
              </div>

              {/* AI Deep Reasoning Analyst */}
              <div className="omni-engine-card card-ai">
                <div className="omni-engine-card-top">
                  <div className="omni-engine-title-group">
                    <div className="omni-engine-icon-wrap" style={{ background: 'rgba(236, 72, 153, 0.2)', color: 'var(--accent-primary)' }}>
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        AI Analyst Engine
                      </h4>
                      <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600 }}>Multi-Perspective Reasoning</span>
                    </div>
                  </div>
                  <span className="omni-badge badge-engine engine-ai">Ready</span>
                </div>
                <p className="omni-engine-card-desc">
                  Autonomous LLM-driven analyzer evaluating the codebase from DEV, QA, and PM perspectives simultaneously, detecting subtle edge-cases and WCAG AA accessibility compliance issues.
                </p>
                <div className="omni-engine-rules-list">
                  <div className="omni-engine-rule-item">
                    <span>Role DEV:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>API contracts &amp; concurrency</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Role QA:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>Boundary conditions &amp; edge cases</strong>
                  </div>
                  <div className="omni-engine-rule-item">
                    <span>Role PM:</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>UX fallbacks &amp; accessibility</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: HEALTH & QUALITY MATRIX */}
          {/* ================================================================= */}
          {activeTab === 'metrics' && (
            <div className="omni-metrics-container">
              {/* Top Metric Tiles */}
              <div className="omni-metrics-hero">
                <div className="omni-metric-tile">
                  <span className="omni-metric-tile-title">Health Index</span>
                  <span className="omni-metric-tile-value" style={{ color: healthScore >= 80 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                    {healthScore}%
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Grade {healthGrade.letter} ({healthGrade.label})
                  </span>
                </div>

                <div className="omni-metric-tile">
                  <span className="omni-metric-tile-title">Total Monitored Files</span>
                  <span className="omni-metric-tile-value" style={{ color: 'var(--accent-primary)' }}>
                    {fileNodes.length}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {fileNodes.filter((f) => f.count > 0).length} files have active findings
                  </span>
                </div>

                <div className="omni-metric-tile">
                  <span className="omni-metric-tile-title">Remediations Applied</span>
                  <span className="omni-metric-tile-value" style={{ color: 'var(--accent-green)' }}>
                    {Object.keys(fixedIds).length}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Interactive 1-click fixes applied this session
                  </span>
                </div>
              </div>

              {/* Role-Specific Readiness Bars */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Perspective Readiness Breakdown
                </h4>

                {/* DEV */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Developer (DEV) Readiness</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {analysisResults.filter((r) => r.role === 'dev').length} issues
                    </span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '82%', background: 'var(--accent-primary)' }} />
                  </div>
                </div>

                {/* QA */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>Quality Assurance (QA) Coverage</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {analysisResults.filter((r) => r.role === 'qa').length} issues
                    </span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '74%', background: 'var(--accent-amber)' }} />
                  </div>
                </div>

                {/* PM */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Product Experience (PM) Quality</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {analysisResults.filter((r) => r.role === 'pm').length} issues
                    </span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '89%', background: 'var(--accent-primary)' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AI LOCAL TESTING VIEW */}
          {activeTab === 'testing' && (
            <div style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
              <BraveTestingView />
            </div>
          )}
        </main>
      </div>
    </div>
    </WorkspaceGate>
  );
};
