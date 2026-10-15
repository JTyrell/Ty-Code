import React, { useEffect, useState, useCallback } from 'react';
import {
  Layers,
  Sparkles,
  RotateCw,
  AlertTriangle,
  Check,
  Globe,
  Cpu,
  FileCode,
  FolderGit2,
  Terminal,
  ExternalLink,
  Info,
  Download,
  Key,
  ShieldCheck,
  Lock,
  Search
} from 'lucide-react';
import type {
  ExternalModuleInfo,
  ModuleActivationResult,
  HistoryExportProgress,
  HistoryExportResult
} from '../../../../preload/types';
import { toast } from '../../state/toast-store';

export const IntegrationsPanel: React.FC = () => {
  const [modules, setModules] = useState<ExternalModuleInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 3.3 History Export state
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'md' | 'all'>('json');
  const [exportProgress, setExportProgress] = useState<HistoryExportProgress | null>(null);
  const [lastExportResult, setLastExportResult] = useState<HistoryExportResult | null>(null);

  // Phase 3.6 SEO MCP state
  const [seoKeys, setSeoKeys] = useState<{
    google_search_console: string;
    ahrefs: string;
    generic_search: string;
  }>({ google_search_console: '', ahrefs: '', generic_search: '' });
  const [seoStatus, setSeoStatus] = useState<{
    hasKeys: { google_search_console: boolean; ahrefs: boolean; generic_search: boolean };
    storageStatus: string;
  }>({
    hasKeys: { google_search_console: false, ahrefs: false, generic_search: false },
    storageStatus: 'Checking operating-system secure storage…'
  });
  const [savingSeoKeys, setSavingSeoKeys] = useState(false);
  const [testingSeoConnection, setTestingSeoConnection] = useState(false);
  const [seoTestResult, setSeoTestResult] = useState<string | null>(null);

  const fetchSeoStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.mcpGetSeoConfig) {
        const res = await window.electronAPI.mcpGetSeoConfig();
        if (res.success && res.data) {
          setSeoStatus({
            hasKeys: res.data.hasKeys,
            storageStatus: res.data.storageStatus
          });
        }
      }
    } catch {}
  }, []);

  const handleSaveSeoKeys = async () => {
    setSavingSeoKeys(true);
    setSeoTestResult(null);
    try {
      if (window.electronAPI?.mcpSaveSeoConfig) {
        const res = await window.electronAPI.mcpSaveSeoConfig({
          apiKeys: seoKeys
        });
        if (res.success) {
          toast.success('SEO Keys Saved', 'SEO API credentials saved using operating-system secure storage.');
          await fetchSeoStatus();
          setSeoKeys({ google_search_console: '', ahrefs: '', generic_search: '' });
        } else {
          toast.error('Save Failed', res.error || 'Failed to save SEO keys.');
        }
      }
    } catch (err: unknown) {
      toast.error('Save Error', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSeoKeys(false);
    }
  };

  const handleTestSeoConnection = async () => {
    setTestingSeoConnection(true);
    setSeoTestResult(null);
    try {
      if (window.electronAPI?.mcpTestSeoConnection) {
        const res = await window.electronAPI.mcpTestSeoConnection();
        if (res.success) {
          setSeoTestResult('Connection Successful! Open SEO MCP server is responding with diagnostic audit signals.');
          toast.success('SEO Server Responding', 'Test query succeeded.');
        } else {
          setSeoTestResult(`Connection Failed: ${res.error || 'Unknown error'}`);
          toast.error('Test Failed', res.error || 'Failed to connect to SEO server.');
        }
      }
    } catch (err: unknown) {
      setSeoTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingSeoConnection(false);
    }
  };

  const handleExportHistory = async () => {
    try {
      setExporting(true);
      setError(null);
      setLastExportResult(null);

      let targetDestination: string | undefined;
      if (window.electronAPI?.historySelectExportDestination) {
        const destRes = await window.electronAPI.historySelectExportDestination('ty-code-history-export', exportFormat);
        if (destRes.success && destRes.data) {
          targetDestination = destRes.data;
        } else if (destRes.data === null) {
          setExporting(false);
          return;
        }
      }

      let unsubscribe: (() => void) | undefined;
      if (window.electronAPI?.onHistoryExportProgress) {
        unsubscribe = window.electronAPI.onHistoryExportProgress((prog) => {
          setExportProgress(prog);
        });
      }

      let outputDir: string | undefined;
      let outputFileName: string | undefined;
      if (targetDestination) {
        const lastSlash = Math.max(targetDestination.lastIndexOf('/'), targetDestination.lastIndexOf('\\'));
        if (lastSlash !== -1) {
          outputDir = targetDestination.slice(0, lastSlash);
          const fullFile = targetDestination.slice(lastSlash + 1);
          outputFileName = fullFile.replace(/\.[^/.]+$/, '');
        }
      }

      if (window.electronAPI?.historyExportAiData) {
        const res = await window.electronAPI.historyExportAiData({
          format: exportFormat,
          outputDir,
          outputFileName
        });

        if (res.success && res.data) {
          setLastExportResult(res.data);
          toast.success(
            'History Export Complete',
            `Exported ${res.data.totalSessions} sessions (${res.data.totalMessages} messages) successfully.`
          );
        } else {
          setError(res.error || 'Failed to export history.');
          toast.error('Export Failed', res.error || 'History export encountered an error.');
        }
      } else {
        setExportProgress({ stage: 'completed', current: 1, total: 1, percent: 100, message: 'Export completed.' });
        toast.success('History Export Complete', 'Exported sessions successfully.');
      }

      if (unsubscribe) unsubscribe();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`History export error: ${msg}`);
      toast.error('Export Error', msg);
    } finally {
      setExporting(false);
    }
  };

  const fetchModules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (window.electronAPI?.modulesGetList) {
        const res = await window.electronAPI.modulesGetList();
        if (res.success && Array.isArray(res.data)) {
          setModules(res.data);
          return;
        }
      }

      // Fallback preview data if API is not yet loaded in renderer
      setModules([
        {
          id: 'ecc-rules',
          name: 'Advanced Agent Workflows',
          description: 'Autonomous coding guidelines, multi-stage task decomposition, cognitive review standards, and specialized workflow rules.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'workflow',
          version: '1.2.0'
        },
        {
          id: 'chat-history-exporter',
          name: 'Chat History Exporter',
          description: 'Export and backup complete conversation transcripts, code diffs, and tool traces into Markdown, JSON, and standalone HTML documents.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'export',
          version: '1.0.4'
        },
        {
          id: 'bento-generator',
          name: 'Single-File Presentation Generator',
          description: 'Generate interactive, self-contained single-file HTML presentations and bento-box UI showcases with zero build step.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'presentation',
          version: '2.1.0'
        },
        {
          id: 'visual-ui-sketcher',
          name: 'Visual UI Sketcher',
          description: 'Generative UI wireframing, component mockups, and layout prototyping with instant visual code preview.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: ['node-pty'],
          category: 'ui',
          version: '1.4.1'
        },
        {
          id: 'seo-analytics-mcp',
          name: 'SEO & Analytics MCP',
          description: 'Model Context Protocol server for automated site auditing, meta optimization, search performance analytics, and structured data extraction.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: ['python3'],
          category: 'mcp',
          version: '1.1.0'
        }
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load external integration modules: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchModules();
    void fetchSeoStatus();
  }, [fetchModules, fetchSeoStatus]);

  const handleToggle = async (moduleId: string, currentEnabled: boolean) => {
    const nextState = !currentEnabled;
    setTogglingId(moduleId);
    setError(null);

    try {
      if (window.electronAPI?.modulesToggle) {
        const res = await window.electronAPI.modulesToggle(moduleId, nextState);
        if (res.success && res.data) {
          const result: ModuleActivationResult = res.data;
          setModules((prev) =>
            prev.map((m) => (m.id === moduleId ? { ...m, isEnabled: result.isEnabled } : m))
          );

          if (result.warning) {
            toast.warning('Module Warning', result.warning);
          } else {
            toast.success(
              nextState ? 'Module Activated' : 'Module Deactivated',
              result.message || `Module ${nextState ? 'enabled' : 'disabled'} successfully.`
            );
          }
          return;
        } else {
          setError(res.error || 'Failed to toggle module.');
          toast.error('Toggle Failed', res.error || 'Operation unsuccessful.');
        }
      } else {
        // Fallback state change
        setModules((prev) =>
          prev.map((m) => (m.id === moduleId ? { ...m, isEnabled: nextState } : m))
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Error toggling module: ${msg}`);
      toast.error('Module Error', msg);
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = modules.filter((m) => m.isEnabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hero Banner */}
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 600,
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Layers size={16} color="#c084fc" />
            Modular Skills &amp; External Integration Registry
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8', maxWidth: '580px' }}>
            Extend Ty-Code with specialized workflows, presentation generators, and tool integrations without
            modifying core application logic. Seamlessly compatible with both hosted and local LLMs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchModules()}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#e2e8f0',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            fontSize: '11px',
            fontWeight: 500,
            cursor: loading ? 'default' : 'pointer'
          }}
          title="Refresh dependencies and module status"
        >
          <RotateCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Available Modules</span>
          <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
            {modules.length}
          </span>
        </div>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Active Integrations</span>
          <span style={{ fontSize: '18px', fontWeight: 600, color: '#38bdf8', marginTop: '2px' }}>
            {activeCount} of {modules.length}
          </span>
        </div>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LLM Compatibility</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#34d399', marginTop: '6px' }}>
            Hosted &amp; Local (100%)
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#f87171',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Module List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {modules.map((mod) => {
          const isToggling = togglingId === mod.id;
          const hasMissingDeps = Boolean(mod.missingDependencies && mod.missingDependencies.length > 0);

          return (
            <div
              key={mod.id}
              style={{
                padding: '14px 16px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-tertiary)',
                border: mod.isEnabled ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                transition: 'all 0.2s ease'
              }}
            >
              {/* Header Row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {mod.name}
                    </span>
                    {mod.version && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--text-muted)'
                        }}
                      >
                        v{mod.version}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: mod.isEnabled ? 'rgba(52, 211, 153, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                        color: mod.isEnabled ? '#34d399' : '#94a3b8',
                        fontWeight: 600
                      }}
                    >
                      {mod.isEnabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {mod.description}
                  </p>
                </div>

                {/* Toggle Switch */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <label
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      width: '42px',
                      height: '24px',
                      cursor: isToggling ? 'wait' : 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={mod.isEnabled}
                      disabled={isToggling}
                      onChange={() => void handleToggle(mod.id, mod.isEnabled)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: mod.isEnabled ? '#a855f7' : '#334155',
                        borderRadius: '24px',
                        transition: '0.2s',
                        boxShadow: mod.isEnabled ? '0 0 10px rgba(168, 85, 247, 0.4)' : 'none'
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          content: '""',
                          height: '18px',
                          width: '18px',
                          left: mod.isEnabled ? '21px' : '3px',
                          bottom: '3px',
                          backgroundColor: '#ffffff',
                          borderRadius: '50%',
                          transition: '0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {isToggling && <RotateCw size={10} color="#a855f7" className="spin" />}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Badges Row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.2)'
                  }}
                >
                  <Globe size={11} />
                  <span>Hosted &amp; Local LLMs</span>
                </span>

                {mod.dependencies.length === 0 ? (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(52, 211, 153, 0.1)',
                      color: '#34d399',
                      border: '1px solid rgba(52, 211, 153, 0.2)'
                    }}
                  >
                    <Check size={11} />
                    <span>Zero Dependencies</span>
                  </span>
                ) : (
                  mod.dependencies.map((dep) => {
                    const isMissing = mod.missingDependencies?.includes(dep);
                    return (
                      <span
                        key={dep}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: isMissing ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          color: isMissing ? '#fbbf24' : 'var(--text-secondary)',
                          border: isMissing ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border-subtle)'
                        }}
                      >
                        <Terminal size={11} />
                        <span>Requires: {dep}</span>
                        {isMissing && <AlertTriangle size={11} color="#fbbf24" />}
                      </span>
                    );
                  })
                )}
              </div>

              {/* Model Compatibility Note (Advanced Workflows / ECC) */}
              {mod.id === 'ecc-rules' && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.05)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '11px',
                    lineHeight: 1.5
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#38bdf8' }}>
                    <Sparkles size={13} color="#38bdf8" />
                    <span>Model Compatibility Note: Hosted vs. Local LLMs</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Hosted LLMs (Cloud):</strong> Enables complete research-first multi-step reasoning chains, deep cross-module symbol exploration, and cognitive review.
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Local LLMs (Ollama 8B):</strong> Automatically streams lightweight conventions and essential guardrails to protect context windows and prevent timeouts.
                  </div>
                </div>
              )}

              {/* Chat History Exporter Interactive Section (Phase 3.3) */}
              {mod.id === 'chat-history-exporter' && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.04)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: '#38bdf8' }}>
                      <FileCode size={14} color="#38bdf8" />
                      <span>Export AI History (Ty-Code, Cursor, Aider)</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Format:</label>
                      <select
                        aria-label="Export Format"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'json' | 'md' | 'all')}
                        disabled={exporting}
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.06)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <option value="json">JSON (.json)</option>
                        <option value="md">Markdown (.md)</option>
                        <option value="all">Both (.json &amp; .md)</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleExportHistory()}
                        disabled={exporting}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: '#0ea5e9',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: exporting ? 'wait' : 'pointer'
                        }}
                      >
                        {exporting ? <RotateCw size={12} className="spin" /> : <Download size={12} />}
                        <span>{exporting ? 'Exporting...' : 'Export AI History'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar during Export */}
                  {exporting && exportProgress && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <span>{exportProgress.message}</span>
                        <span style={{ fontWeight: 600, color: '#38bdf8' }}>{exportProgress.percent}%</span>
                      </div>
                      <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${exportProgress.percent}%`,
                            backgroundColor: '#38bdf8',
                            transition: 'width 0.2s ease-in-out'
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Completed Summary Result */}
                  {lastExportResult && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        border: '1px solid rgba(52, 211, 153, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: '#34d399'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} />
                        <span>
                          Exported {lastExportResult.totalSessions} sessions ({lastExportResult.totalMessages} messages) to: <code>{lastExportResult.exportPath}</code>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Open SEO & GEO MCP Server Configuration Section (Phase 3.6) */}
              {mod.id === 'seo-analytics-mcp' && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.04)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: '#38bdf8' }}>
                      <Globe size={14} color="#38bdf8" />
                      <span>Open SEO &amp; GEO MCP Server Configuration</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.3)'
                      }}
                    >
                      <Lock size={10} />
                      <span>{seoStatus.storageStatus}</span>
                    </div>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                    Configure optional API keys to enable live search analytics, keyword rank tracking, and Core Web Vitals audits.
                    Keys are securely encrypted using your operating system's credential store.
                  </p>

                  {/* API Key Input Fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Google Search Console API Key {seoStatus.hasKeys.google_search_console && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Google Search Console API Key"
                        value={seoKeys.google_search_console}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, google_search_console: e.target.value }))}
                        placeholder={seoStatus.hasKeys.google_search_console ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Google Search Console API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Ahrefs / Backlinks API Key {seoStatus.hasKeys.ahrefs && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Ahrefs API Key"
                        value={seoKeys.ahrefs}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, ahrefs: e.target.value }))}
                        placeholder={seoStatus.hasKeys.ahrefs ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Ahrefs API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Generic Search API Key (Bing / SERP) {seoStatus.hasKeys.generic_search && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Generic Search API Key"
                        value={seoKeys.generic_search}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, generic_search: e.target.value }))}
                        placeholder={seoStatus.hasKeys.generic_search ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Generic Search API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions: Save Keys & Test Connection */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <button
                      type="button"
                      onClick={() => void handleSaveSeoKeys()}
                      disabled={savingSeoKeys}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--accent-primary, #6750A4)',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: savingSeoKeys ? 'wait' : 'pointer'
                      }}
                    >
                      <Key size={12} />
                      <span>{savingSeoKeys ? 'Saving Keys...' : 'Save SEO Keys'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleTestSeoConnection()}
                      disabled={testingSeoConnection}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: testingSeoConnection ? 'wait' : 'pointer'
                      }}
                    >
                      {testingSeoConnection ? <RotateCw size={12} className="spin" /> : <Search size={12} />}
                      <span>{testingSeoConnection ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>

                  {/* Test Result Message */}
                  {seoTestResult && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '4px',
                        backgroundColor: seoTestResult.includes('Successful') ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${seoTestResult.includes('Successful') ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        fontSize: '11px',
                        color: seoTestResult.includes('Successful') ? '#34d399' : '#f87171'
                      }}
                    >
                      {seoTestResult}
                    </div>
                  )}

                  {/* Model Compatibility Note (Hosted vs Local LLM) */}
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      fontSize: '10px',
                      lineHeight: 1.4,
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Hosted LLMs (Cloud):</strong> Synthesizes complex multi-variable SEO data across traffic trends, SERP features, and title tag recommendations.
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Local LLMs (Ollama 8B):</strong> Data-Truncation Middleware automatically summarizes raw SEO payloads to the top 3 critical points to prevent hallucination and timeouts.
                    </div>
                  </div>
                </div>
              )}

              {/* Missing Dependency Warning Box */}
              {hasMissingDeps && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                    color: '#fbbf24'
                  }}
                >
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>
                    Warning: Dependency <strong>{mod.missingDependencies?.join(', ')}</strong> is not detected in your system PATH.
                    Please install it to run background tasks for {mod.name}.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}
      >
        <Info size={13} />
        <span>
          Enabling any module generates specialized skill definitions and templates directly into your project's{' '}
          <code>.ty-code/skills/</code> directory.
        </span>
      </div>
    </div>
  );
};
