/**
 * Ty-Code Provider Connection & Capability Diagnostics Panel (Phase Diagnostics 1 & 2)
 *
 * Full in-app diagnostic harness testing:
 * 1. Connection Diagnostics: Every configured and built-in free provider with 5-step verification & error taxonomy
 * 2. Capability Test Suite: The 4 core jobs (answer questions, write files, edit files, use tools, reasoning)
 *    with scratch workspace isolation, automatic pass/fail, evidence capture, auto-fallback, and auto-written reports.
 * 3. Remediation Checklist: Prioritized roadmap of operational tiers, user action items, and bug fixes.
 * 4. Trace Waterfall: Live H1 through H10 probe tracing across renderer, preload, and main process.
 *
 * Brand: Ty-Code
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Activity,
  Play,
  RotateCw,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Zap,
  Server,
  Brain,
  FileCode,
  Wrench,
  Edit3,
  MessageSquare,
  FileText,
  ListChecks,
  Sparkles,
  ArrowRight,
  CheckSquare,
  Square,
  Clock,
  Terminal,
  Network,
  Radio,
  ShieldCheck,
  Layers,
  Bug,
  Info
} from 'lucide-react';
import type {
  DiagnosticRunSummary,
  ProviderDiagnosticResult,
  DiagnosticStep,
  DiagnosticsFleetHealth,
  CapabilitySuiteSummary,
  ScenarioResult,
  RemediationReport,
  WorkingNowItem,
  MissingFromYouItem,
  MissingFromCodeItem,
  ExternalOutageItem,
  RecommendedAction,
  SmokeTestStep,
  HopId,
  HopTraceRecord,
  ProviderConnectivityTrace,
  FullConnectivityTraceReport,
  MockScanFinding,
  MockScanReport
} from '../../../../shared/types/diagnostics';
import { SMOKE_TEST_STEPS, SMOKE_TEST_FAILURE_PROTOCOL } from '../../../../shared/types/diagnostics';
import { toast } from '../../state/toast-store';
import { useChatStore } from '../../state/chat-store';
import './DiagnosticsPanel.css';

const STEP_LABELS: Record<DiagnosticStep, string> = {
  reachability: 'Reachability',
  auth: '1-Token Auth',
  streaming: 'SSE Streaming',
  tool_call: 'Tool-Call Schema',
  latency: 'Latency (TTFT)'
};

const SCENARIO_ICONS: Record<string, React.ReactNode> = {
  answer: <MessageSquare size={16} className="text-sky-400" />,
  write: <FileCode size={16} className="text-emerald-400" />,
  edit: <Edit3 size={16} className="text-indigo-400" />,
  tools: <Wrench size={16} className="text-amber-400" />,
  reasoning: <Brain size={16} className="text-purple-400" />
};

// Clipboard write with execCommand fallback (navigator.clipboard can reject in some Electron contexts)
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
};

export const DiagnosticsPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<'connection' | 'capabilities' | 'remediation' | 'trace'>('connection');

  // Connection diagnostics state (Phase Diagnostics 1)
  const [isConnRunning, setIsConnRunning] = useState(false);
  const [connSummary, setConnSummary] = useState<DiagnosticRunSummary | null>(null);
  const [expandedConnEvidence, setExpandedConnEvidence] = useState<Record<string, boolean>>({});
  const [connCopied, setConnCopied] = useState(false);

  // Capability suite state (Phase Diagnostics 2)
  const [isCapRunning, setIsCapRunning] = useState(false);
  const [capSummary, setCapSummary] = useState<CapabilitySuiteSummary | null>(null);
  const [expandedCapEvidence, setExpandedCapEvidence] = useState<Record<string, boolean>>({});
  const [capCopied, setCapCopied] = useState(false);

  // Remediation report state (Phase Diagnostics 3)
  const [isRemediationLoading, setIsRemediationLoading] = useState(false);
  const [remediationReport, setRemediationReport] = useState<RemediationReport | null>(null);
  const [remediationPromptCopied, setRemediationPromptCopied] = useState(false);
  const [remReportCopied, setRemReportCopied] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [expandedRemediationEvidence, setExpandedRemediationEvidence] = useState<Record<string, boolean>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  // Manual smoke-test state (Phase Diagnostics 4)
  const [copiedSmokeId, setCopiedSmokeId] = useState<string | null>(null);
  const [copiedAllSmoke, setCopiedAllSmoke] = useState(false);

  // Connectivity Trace state (Fix 1)
  const [isTraceRunning, setIsTraceRunning] = useState(false);
  const [traceReport, setTraceReport] = useState<FullConnectivityTraceReport | null>(null);
  const [activeTraceProvider, setActiveTraceProvider] = useState<string>('openkilo');
  const [expandedHopId, setExpandedHopId] = useState<string | null>(null);
  const [mockScanReport, setMockScanReport] = useState<MockScanReport | null>(null);
  const [isScanningMocks, setIsScanningMocks] = useState(false);
  const [traceCopied, setTraceCopied] = useState(false);

  // Live-hydration state: retained latest results polled at intervals
  const [isLive, setIsLive] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [fleetHealth, setFleetHealth] = useState<DiagnosticsFleetHealth | null>(null);

  // Load latest trace report and subscribe to live hop updates
  useEffect(() => {
    if (window.electronAPI?.getConnectivityTrace) {
      void window.electronAPI.getConnectivityTrace().then((res) => {
        if (res.success && res.data) {
          setTraceReport(res.data);
          if (res.data.mockScan) setMockScanReport(res.data.mockScan);
          const provs = Object.keys(res.data.providers || {});
          if (provs.length > 0) setActiveTraceProvider(provs[0]);
        }
      });
    }

    if (window.electronAPI?.onConnectivityTraceUpdate) {
      const unsub = window.electronAPI.onConnectivityTraceUpdate(({ trace }) => {
        setTraceReport((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            providers: {
              ...prev.providers,
              [trace.providerId]: trace
            }
          };
        });
      });
      return () => {
        unsub?.();
      };
    }
    return undefined;
  }, []);

  // Live hydration: pull retained latest run results (no fabricated data)
  const refreshLatest = useCallback(async () => {
    try {
      if (window.electronAPI?.getDiagnosticsLatest) {
        const res = await window.electronAPI.getDiagnosticsLatest();
        if (res.success && res.data) {
          if (res.data.connSummary) setConnSummary(res.data.connSummary);
          if (res.data.capSummary) setCapSummary(res.data.capSummary);
        }
      }
      if (window.electronAPI?.diagnosticsGetFleetHealth) {
        const res = await window.electronAPI.diagnosticsGetFleetHealth();
        if (res.success && res.data) setFleetHealth(res.data);
      }
      if (window.electronAPI?.getConnectivityTrace) {
        const res = await window.electronAPI.getConnectivityTrace();
        if (res.success && res.data) setTraceReport(res.data);
      }
    } catch {
      // Silent: a failed poll must never disrupt the panel
    } finally {
      setLastCheckedAt(Date.now());
    }
  }, []);

  // Hydrate once on mount
  useEffect(() => {
    void refreshLatest();
  }, [refreshLatest]);

  // Poll every 12s while live mode is on
  useEffect(() => {
    if (!isLive) return undefined;
    const intervalId = window.setInterval(() => {
      void refreshLatest();
    }, 12000);
    return () => window.clearInterval(intervalId);
  }, [isLive, refreshLatest]);

  const formatRelativeTime = (ts: number | null): string => {
    if (!ts) return 'never';
    const diffSec = Math.round((Date.now() - ts) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  };

  // Fetch remediation report
  const loadRemediationReport = useCallback(async () => {
    if (!window.electronAPI?.getRemediationReport) {
      toast.error('Remediation API not available in current environment');
      return;
    }
    setIsRemediationLoading(true);
    try {
      const res = await window.electronAPI.getRemediationReport();
      if (res.success && res.data) {
        setRemediationReport(res.data);
      } else {
        toast.error(res.error || 'Failed to generate remediation report');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Remediation report generation failed');
    } finally {
      setIsRemediationLoading(false);
    }
  }, []);

  // Action button click handler for checklist items
  const handleRemediationAction = useCallback(async (action: {
    actionType: string;
    actionTarget?: string;
    actionUrl?: string;
  }) => {
    if (action.actionType === 'open_settings') {
      useChatStore.getState().openSettings(action.actionTarget || 'providers');
    } else if (action.actionType === 'open_url') {
      const url = action.actionUrl || action.actionTarget;
      if (url) {
        if (window.electronAPI?.openExternal) {
          await window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      }
    } else if (action.actionType === 'use_provider') {
      const providerId = action.actionTarget;
      if (providerId) {
        await useChatStore.getState().saveSettings({ activeProvider: providerId as any });
        toast.success(`Active provider set to ${providerId}!`);
      }
    } else if (action.actionType === 'copy_prompt') {
      if (action.actionTarget) {
        const copied = await copyToClipboard(action.actionTarget);
        if (copied) {
          setRemediationPromptCopied(true);
          toast.success('AI Coder prompt copied to clipboard!');
          setTimeout(() => setRemediationPromptCopied(false), 2500);
        } else {
          toast.error('Failed to copy to clipboard');
        }
      }
    }
  }, []);

  // Copy AI coder prompt to clipboard with feedback
  const copyAiCoderPrompt = useCallback(async (prompt: string, itemId?: string) => {
    if (!prompt) {
      toast.error('No prompt available to copy');
      return;
    }
    const copied = await copyToClipboard(prompt);
    if (!copied) {
      toast.error('Failed to copy to clipboard');
      return;
    }
    if (itemId) {
      setCopiedItemId(itemId);
      setTimeout(() => setCopiedItemId(null), 2500);
    } else {
      setRemediationPromptCopied(true);
      setTimeout(() => setRemediationPromptCopied(false), 2500);
    }
    toast.success('AI Coder prompt copied to clipboard!');
  }, []);

  // Copy the complete plain-language remediation report
  const handleCopyRemediationReport = useCallback(async () => {
    if (!remediationReport?.markdownReport) {
      toast.error('No remediation report available yet. Generate it first.');
      return;
    }
    const copied = await copyToClipboard(remediationReport.markdownReport);
    if (!copied) {
      toast.error('Failed to copy the report to clipboard');
      return;
    }
    setRemReportCopied(true);
    toast.success('Full remediation report copied as Markdown!');
    setTimeout(() => setRemReportCopied(false), 2500);
  }, [remediationReport]);

  const toggleCheckItem = useCallback((id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleRemediationEvidence = useCallback((id: string) => {
    setExpandedRemediationEvidence((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Copy single smoke test prompt
  const copySmokeStep = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSmokeId(id);
      toast.success(`Copied smoke prompt: "${text}"`);
      setTimeout(() => setCopiedSmokeId(null), 2500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, []);

  // Copy all 6 smoke test prompts as a formatted markdown script
  const copyAllSmokeSteps = useCallback(async () => {
    try {
      const fullScript = [
        '# Ty-Code Manual Smoke-Test Script',
        '',
        ...SMOKE_TEST_STEPS.map(
          (s) => `### Step ${s.stepNumber} (~${s.timeEstimateSec}s)\nSend: \`${s.send}\`\nExpect: ${s.expect}\n`
        ),
        '### Failure Protocol',
        SMOKE_TEST_FAILURE_PROTOCOL
      ].join('\n');
      await navigator.clipboard.writeText(fullScript);
      setCopiedAllSmoke(true);
      toast.success('Entire 6-step smoke-test script copied to clipboard!');
      setTimeout(() => setCopiedAllSmoke(false), 2500);
    } catch {
      toast.error('Failed to copy smoke script');
    }
  }, []);

  // Run connection diagnostics suite
  const runDiagnostics = useCallback(async (providerId?: string) => {
    if (!window.electronAPI?.runDiagnostics) {
      toast.error('Diagnostics API not available in current environment');
      return;
    }

    setIsConnRunning(true);
    try {
      const res = await window.electronAPI.runDiagnostics(providerId);
      if (res.success && res.data) {
        setConnSummary(res.data);
        if (res.data.failedCount > 0) {
          toast.warning(`Diagnostics completed: ${res.data.passedCount} passed, ${res.data.failedCount} need attention.`);
        } else {
          toast.success(`Diagnostics completed: All ${res.data.passedCount} providers operational!`);
        }
        void loadRemediationReport();
      } else {
        toast.error(res.error || 'Failed to complete connection diagnostics');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Diagnostics run failed');
    } finally {
      setIsConnRunning(false);
    }
  }, [loadRemediationReport]);

  // Run end-to-end capability test suite
  const runCapabilityTests = useCallback(async (providerId?: string) => {
    if (!window.electronAPI?.runCapabilitySuite) {
      toast.error('Capability Suite API not available in current environment');
      return;
    }

    setIsCapRunning(true);
    try {
      const res = await window.electronAPI.runCapabilitySuite({ providerId });
      if (res.success && res.data) {
        setCapSummary(res.data);
        if (res.data.failedCount === 0) {
          toast.success(`Capability Suite Passed! All ${res.data.passedCount} scenarios verified.`);
        } else {
          toast.warning(`Capability Suite: ${res.data.passedCount} passed, ${res.data.failedCount} failed.`);
        }
        void loadRemediationReport();
      } else {
        toast.error(res.error || 'Failed to complete capability test suite');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Capability tests failed');
    } finally {
      setIsCapRunning(false);
    }
  }, [loadRemediationReport]);

  // Copy connection markdown report
  const handleCopyConnReport = useCallback(async () => {
    if (!window.electronAPI?.getDiagnosticReport) return;
    try {
      const res = await window.electronAPI.getDiagnosticReport(connSummary || undefined);
      if (res.success && res.data) {
        const copied = await copyToClipboard(res.data);
        if (!copied) throw new Error('Clipboard unavailable');
        setConnCopied(true);
        toast.success('Report copied to clipboard!');
        setTimeout(() => setConnCopied(false), 2500);
      } else {
        toast.error(res.error || 'Failed to generate markdown report');
      }
    } catch {
      toast.error('Could not copy report to clipboard');
    }
  }, [connSummary]);

  // Copy capability markdown report
  const handleCopyCapReport = useCallback(async () => {
    if (!window.electronAPI?.getCapabilityReport) return;
    try {
      const res = await window.electronAPI.getCapabilityReport();
      if (res.success && res.data) {
        const copied = await copyToClipboard(res.data);
        if (!copied) throw new Error('Clipboard unavailable');
        setCapCopied(true);
        toast.success('Report copied to clipboard!');
        setTimeout(() => setCapCopied(false), 2500);
      } else if (capSummary?.markdownReport) {
        const copied = await copyToClipboard(capSummary.markdownReport);
        if (!copied) throw new Error('Clipboard unavailable');
        setCapCopied(true);
        toast.success('Report copied to clipboard!');
        setTimeout(() => setCapCopied(false), 2500);
      } else {
        toast.error(res.error || 'Failed to generate capability report');
      }
    } catch {
      toast.error('Could not copy capability report');
    }
  }, [capSummary]);

  // Run End-to-End Connectivity Trace
  const handleRunTrace = useCallback(async () => {
    if (!window.electronAPI?.runConnectivityTrace) {
      toast.error('Connectivity trace API not available in current environment');
      return;
    }
    setIsTraceRunning(true);
    try {
      const res = await window.electronAPI.runConnectivityTrace();
      if (res.success && res.data) {
        setTraceReport(res.data);
        if (res.data.mockScan) setMockScanReport(res.data.mockScan);
        const provs = Object.keys(res.data.providers || {});
        if (provs.length > 0 && !provs.includes(activeTraceProvider)) {
          setActiveTraceProvider(provs[0]);
        }
        if (res.data.overallStatus === 'PASS') {
          const skippedNote = res.data.summary.skippedCount > 0 ? ` (${res.data.summary.skippedCount} optional provider${res.data.summary.skippedCount === 1 ? '' : 's'} skipped, no key)` : '';
          toast.success(`Live Trace Passed! All hops verified.${skippedNote}`);
        } else {
          toast.warning(`Trace Failed at ${res.data.firstFailingHop || 'unknown hop'} (${res.data.firstFailingProvider || 'provider'})`);
        }
      } else {
        toast.error(res.error || 'Failed to complete connectivity trace');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Trace probe execution failed');
    } finally {
      setIsTraceRunning(false);
    }
  }, [activeTraceProvider]);

  // Run Mock Scanner
  const handleScanMocks = useCallback(async () => {
    if (!window.electronAPI?.scanMockPaths) return;
    setIsScanningMocks(true);
    try {
      const res = await window.electronAPI.scanMockPaths();
      if (res.success && res.data) {
        setMockScanReport(res.data);
        if (res.data.hasShortCircuits) {
          toast.error('Mock scan found short-circuits in streaming path!');
        } else {
          toast.success(`Mock scan clean! Scanned ${res.data.filesScanned} files with zero short circuits.`);
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Mock scan failed');
    } finally {
      setIsScanningMocks(false);
    }
  }, []);

  // Copy Trace JSON
  const handleCopyTraceJson = useCallback(async () => {
    if (!traceReport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(traceReport, null, 2));
      setTraceCopied(true);
      toast.success('Trace report JSON copied to clipboard!');
      setTimeout(() => setTraceCopied(false), 2500);
    } catch {
      toast.error('Failed to copy trace JSON');
    }
  }, [traceReport]);

  const toggleConnEvidence = (providerId: string) => {
    setExpandedConnEvidence((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const toggleCapEvidence = (scenarioId: string) => {
    setExpandedCapEvidence((prev) => ({ ...prev, [scenarioId]: !prev[scenarioId] }));
  };

  const getStatusBadge = (res: ProviderDiagnosticResult) => {
    if (res.status === 'PASS') {
      return (
        <span className="diag-pill-pass flex items-center gap-1.5 text-xs font-semibold">
          <CheckCircle2 size={13} />
          PASS {res.timeToFirstTokenMs ? `(${res.timeToFirstTokenMs}ms)` : ''}
        </span>
      );
    }
    if (res.status === 'FAIL') {
      return (
        <span className="diag-pill-fail flex items-center gap-1.5 text-xs font-semibold">
          <XCircle size={13} />
          FAIL ({res.errorCode || 'ERROR'})
        </span>
      );
    }
    return (
      <span className="diag-pill-skip flex items-center gap-1.5 text-xs font-semibold">
        SKIPPED
      </span>
    );
  };

  const getStepIcon = (status: 'PASS' | 'FAIL' | 'SKIPPED') => {
    if (status === 'PASS') return <Check size={11} className="text-emerald-400" />;
    if (status === 'FAIL') return <XCircle size={11} className="text-rose-400" />;
    return <span className="text-zinc-500">-</span>;
  };

  return (
    <div className="diag-container">
      {/* ---------------------------------------------------------------------
          At-a-Glance Live Status Strip (HUD)
          --------------------------------------------------------------------- */}
      <div className="diag-hud-strip">
        <div className="diag-hud-metrics">
          <span className="diag-hud-metric-item">
            <span
              className={`diag-hud-dot ${
                fleetHealth
                  ? fleetHealth.downCount > 0
                    ? 'diag-dot-rose'
                    : fleetHealth.degradedCount > 0 || fleetHealth.untestedCount > 0
                      ? 'diag-dot-amber'
                      : 'diag-dot-green'
                  : 'diag-dot-zinc'
              }`}
            />
            Fleet Health:{' '}
            <strong>
              {fleetHealth
                ? `${fleetHealth.healthyCount}/${fleetHealth.totalCount} Healthy${
                    fleetHealth.untestedCount > 0 ? ` (${fleetHealth.untestedCount} untested)` : ''
                  }`
                : 'Evaluating...'}
            </strong>
          </span>

          <span className="diag-hud-divider" />

          <span className="diag-hud-metric-item">
            Conn:{' '}
            <span className={connSummary ? (connSummary.failedCount > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold') : 'text-zinc-500'}>
              {connSummary ? `${connSummary.passedCount} PASS / ${connSummary.failedCount} FAIL` : 'Not run'}
            </span>
          </span>

          <span className="diag-hud-divider" />

          <span className="diag-hud-metric-item">
            Cap:{' '}
            <span className={capSummary ? (capSummary.failedCount > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold') : 'text-zinc-500'}>
              {capSummary ? `${capSummary.passedCount} PASS / ${capSummary.failedCount} FAIL` : 'Not run'}
            </span>
          </span>

          <span className="diag-hud-divider" />

          <span className="diag-hud-metric-item">
            Trace:{' '}
            <span className={traceReport ? (traceReport.overallStatus === 'PASS' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold') : 'text-zinc-500'}>
              {traceReport ? traceReport.overallStatus : 'Not run'}
            </span>
          </span>

          <span className="diag-hud-divider" />

          <span className="text-zinc-400 text-xs">
            Last probe: {formatRelativeTime(lastCheckedAt)}
          </span>
        </div>

        <div className="diag-hud-actions">
          <button
            onClick={() => void refreshLatest()}
            title="Fetch latest retained diagnostics results"
            className="diag-btn-hud"
          >
            <RotateCw size={12} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsLive((prev) => !prev)}
            title="Toggle 12s live polling of latest diagnostics data"
            className={`diag-btn-hud ${isLive ? 'is-active' : ''}`}
          >
            <Radio size={12} />
            <span>{isLive ? 'Live Polling: On' : 'Live Polling: Off'}</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          Sub-Tab Segmented Switcher
          --------------------------------------------------------------------- */}
      <div className="diag-tabs-nav">
        <button
          onClick={() => setSubTab('connection')}
          id="diag-subtab-connection"
          data-tab="connection"
          className={`diag-tab-btn ${subTab === 'connection' ? 'is-active' : ''}`}
        >
          <Activity size={14} className={subTab === 'connection' ? 'text-indigo-400' : ''} />
          <span>Connections</span>
        </button>

        <button
          onClick={() => setSubTab('capabilities')}
          id="diag-subtab-capabilities"
          data-tab="capabilities"
          className={`diag-tab-btn ${subTab === 'capabilities' ? 'is-active' : ''}`}
        >
          <Brain size={14} className={subTab === 'capabilities' ? 'text-sky-400' : ''} />
          <span>Capabilities</span>
        </button>

        <button
          onClick={() => {
            setSubTab('remediation');
            void loadRemediationReport();
          }}
          id="diag-subtab-remediation"
          data-tab="remediation"
          className={`diag-tab-btn ${subTab === 'remediation' ? 'is-active' : ''}`}
        >
          <ListChecks size={14} className={subTab === 'remediation' ? 'text-emerald-400' : ''} />
          <span>Checklist</span>
        </button>

        <button
          onClick={() => setSubTab('trace')}
          id="diag-subtab-trace"
          data-tab="trace"
          className={`diag-tab-btn ${subTab === 'trace' ? 'is-active' : ''}`}
        >
          <Network size={14} className={subTab === 'trace' ? 'text-purple-400' : ''} />
          <span>Trace (H1-H10)</span>
        </button>
      </div>

      {/* =====================================================================
          SECTION 1: CONNECTION DIAGNOSTICS & ERROR TAXONOMY
          ===================================================================== */}
      {subTab === 'connection' && (
        <div className="space-y-4">
          {/* Header Banner */}
          <div className="diag-hero-banner">
            <div className="diag-hero-title-group">
              <div className="diag-hero-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                <Activity size={18} />
              </div>
              <div className="diag-hero-text">
                <h2>Provider Connection Diagnostics</h2>
                <p>
                  Live 5-step test sequence (Reachability, 1-Token Auth, SSE Streaming, Tool-Call Format, TTFT) across all free providers with automated error taxonomy classification.
                </p>
              </div>
            </div>

            <div className="diag-hero-actions">
              <button
                onClick={() => runDiagnostics()}
                disabled={isConnRunning}
                className="diag-btn-action diag-btn-primary"
              >
                {isConnRunning ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Testing Providers...</span>
                  </>
                ) : (
                  <>
                    <Play size={13} />
                    <span>Run All Tests</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCopyConnReport}
                className="diag-btn-action diag-btn-secondary"
                title="Copy Markdown Diagnostic Report"
              >
                {connCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{connCopied ? 'Copied!' : 'Copy Report'}</span>
              </button>
            </div>
          </div>

          {/* Zero-Key Status Banner */}
          {connSummary && (
            <div className={`diag-status-banner ${connSummary.zeroKeyOperational ? 'is-success' : 'is-warning'}`}>
              <div className="diag-status-banner-left">
                {connSummary.zeroKeyOperational ? (
                  <Zap size={18} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={18} className="text-amber-400" />
                )}
                <div>
                  <div className="diag-status-banner-title">
                    {connSummary.zeroKeyOperational
                      ? 'Zero-Key Fallback Operational'
                      : 'Zero-Key Providers Require Attention'}
                  </div>
                  <div className="diag-status-banner-desc">
                    {connSummary.zeroKeyOperational
                      ? 'Zero-input tier active (Ty-Code Free community key + OpenKilo / local inference). Free reasoning and completions available out-of-the-box.'
                      : 'No anonymous free tier currently active. Review Ty-Code Free, OpenKilo or local Ollama.'}
                  </div>
                </div>
              </div>

              <div className="diag-status-pills">
                <span className="diag-pill-pass">{connSummary.passedCount} PASS</span>
                <span className="diag-pill-fail">{connSummary.failedCount} FAIL</span>
                <span className="diag-pill-skip">{connSummary.skippedCount} SKIPPED</span>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!connSummary && !isConnRunning && (
            <div className="diag-empty-card">
              <Server size={32} className="diag-empty-icon" />
              <h3 className="diag-empty-title">Ready to diagnose providers</h3>
              <p className="diag-empty-desc">
                Click &ldquo;Run All Tests&rdquo; to test every built-in free provider and configured key. Anonymous providers will be prioritized first.
              </p>
              <button
                onClick={() => runDiagnostics()}
                className="mt-2 diag-btn-action diag-btn-primary"
              >
                <Play size={13} />
                <span>Start Diagnostics</span>
              </button>
            </div>
          )}

          {/* Provider Results Grid */}
          {connSummary && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <span>Provider Test Results ({connSummary.results.length})</span>
                <span className="text-[11px] text-zinc-500 font-normal">Retested live on this device</span>
              </div>

              <div className="diag-cards-stack">
                {connSummary.results.map((res) => {
                  const isExpanded = Boolean(expandedConnEvidence[res.providerId]);
                  return (
                    <div key={res.providerId} className="diag-card">
                      {/* Card Header */}
                      <div className="diag-card-header">
                        <div className="diag-card-title-wrap">
                          <span className="diag-card-title">{res.providerName}</span>
                          <span className={res.authType === 'anonymous' ? 'diag-tag-zero-key' : 'diag-tag-api-key'}>
                            {res.authType === 'anonymous' ? 'Anonymous (Zero-Key)' : 'API Key Required'}
                          </span>
                          <span className="diag-card-meta">
                            {res.baseUrl} &bull; Model: {res.testedModel || 'default'}
                          </span>
                        </div>

                        <div className="diag-card-actions">
                          {getStatusBadge(res)}
                          <button
                            onClick={() => runDiagnostics(res.providerId)}
                            disabled={isConnRunning}
                            title="Retest this provider"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          >
                            <RotateCw size={12} className={isConnRunning ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      </div>

                      {/* 5-Step Pipeline Stepper */}
                      <div className="diag-pipeline-grid">
                        {(Object.keys(STEP_LABELS) as DiagnosticStep[]).map((stepKey) => {
                          const step = res.steps[stepKey];
                          const status = step?.status || 'SKIPPED';
                          const stepClass =
                            status === 'PASS'
                              ? 'diag-step-pass'
                              : status === 'FAIL'
                                ? 'diag-step-fail'
                                : 'diag-step-skipped';

                          return (
                            <div key={stepKey} className={`diag-step-pill ${stepClass}`}>
                              <span className="truncate">{STEP_LABELS[stepKey]}</span>
                              <span className="ml-1 shrink-0">{getStepIcon(status)}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Failure Remedy Alert */}
                      {res.status === 'FAIL' && (
                        <div className="diag-remedy-box">
                          <div className="diag-remedy-header">
                            <div>
                              <div className="diag-remedy-message">
                                <AlertTriangle size={13} />
                                <span>{res.humanMessage}</span>
                              </div>
                              <div className="diag-remedy-text">{res.remedy}</div>
                            </div>

                            {res.actionUrl && (
                              res.actionUrl.startsWith('ty-code://settings/') || res.actionUrl.startsWith('settings:') ? (
                                <button
                                  onClick={() =>
                                    handleRemediationAction({
                                      actionType: 'open_settings',
                                      actionTarget: res.actionUrl!.includes('apikeys') ? 'apikeys' : 'providers'
                                    })
                                  }
                                  className="diag-btn-remedy"
                                >
                                  <span>{res.actionLabel || 'Fix Issue'}</span>
                                  <ArrowRight size={11} />
                                </button>
                              ) : res.actionUrl.startsWith('ty-code://dashboard/quota') || res.actionUrl.startsWith('dashboard:') ? (
                                <button
                                  onClick={() => {
                                    useChatStore.getState().openSettings('analytics');
                                    toast.info('Opened Usage & Limits dashboard.');
                                  }}
                                  className="diag-btn-remedy"
                                >
                                  <span>{res.actionLabel || 'Check Quota'}</span>
                                  <ArrowRight size={11} />
                                </button>
                              ) : res.actionUrl.startsWith('ty-code://action/retry') ? (
                                <button
                                  onClick={() => {
                                    toast.info('Re-running diagnostics...');
                                    void runDiagnostics();
                                  }}
                                  className="diag-btn-remedy"
                                >
                                  <span>{res.actionLabel || 'Retry'}</span>
                                  <RotateCw size={11} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (window.electronAPI?.openExternal) {
                                      void window.electronAPI.openExternal(res.actionUrl!);
                                    } else {
                                      window.open(res.actionUrl!, '_blank');
                                    }
                                  }}
                                  className="diag-btn-remedy"
                                >
                                  <span>{res.actionLabel || 'Fix Issue'}</span>
                                  <ExternalLink size={11} />
                                </button>
                              )
                            )}
                          </div>

                          {/* Raw Evidence Drawer */}
                          {res.rawEvidence && (
                            <div className="pt-1">
                              <button
                                onClick={() => toggleConnEvidence(res.providerId)}
                                className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                              >
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{isExpanded ? 'Hide Raw Evidence Chunk' : 'View Raw Evidence Chunk'}</span>
                              </button>

                              {isExpanded && (
                                <pre className="diag-evidence-pre">
                                  {res.rawEvidence}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Success Note */}
                      {res.status === 'PASS' && (
                        <div className="text-[11px] text-emerald-400/90 flex items-center gap-1.5 pt-0.5">
                          <CheckCircle2 size={12} />
                          <span>Provider healthy &bull; Latency: {res.timeToFirstTokenMs}ms &bull; Streaming &amp; Tool-calling verified</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SECTION 2: END-TO-END CAPABILITY TEST SUITE (PHASE DIAGNOSTICS 2)
          ===================================================================== */}
      {subTab === 'capabilities' && (
        <div className="space-y-4" id="capability-tests-section">
          {/* Header Banner */}
          <div className="diag-hero-banner">
            <div className="diag-hero-title-group">
              <div className="diag-hero-icon" style={{ background: 'rgba(14, 165, 233, 0.15)', color: '#38bdf8' }}>
                <Brain size={18} />
              </div>
              <div className="diag-hero-text">
                <h2>Capability Test Suite</h2>
                <p>
                  Proves the connected AI performs the 4 core jobs: answer questions, write files, edit files, and use workspace tools — with isolated scratch workspace, auto-fallback, and diff verification.
                </p>
              </div>
            </div>

            <div className="diag-hero-actions">
              <button
                onClick={() => runCapabilityTests()}
                disabled={isCapRunning}
                id="btn-run-capability-tests"
                className="diag-btn-action diag-btn-sky"
              >
                {isCapRunning ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Running Capability Tests...</span>
                  </>
                ) : (
                  <>
                    <Play size={13} />
                    <span>Run Capability Tests</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCopyCapReport}
                id="btn-copy-capability-report"
                className="diag-btn-action diag-btn-secondary"
                title="Copy Markdown Capability Report"
              >
                {capCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{capCopied ? 'Copied!' : 'Copy Report'}</span>
              </button>
            </div>
          </div>

          {/* Capability Run Summary Banner */}
          {capSummary && (
            <div className={`diag-status-banner ${capSummary.failedCount === 0 ? 'is-success' : 'is-warning'}`}>
              <div className="diag-status-banner-left">
                {capSummary.failedCount === 0 ? (
                  <CheckCircle2 size={18} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={18} className="text-amber-400" />
                )}
                <div>
                  <div className="diag-status-banner-title flex items-center gap-2">
                    <span>
                      {capSummary.failedCount === 0
                        ? 'All 5 Core AI Capabilities Operational'
                        : `${capSummary.passedCount}/${capSummary.totalScenarios} Scenarios Operational`}
                    </span>
                    {capSummary.fallbackEngaged && (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Auto-Fallback Engaged: {capSummary.fallbackProvider}
                      </span>
                    )}
                  </div>
                  <div className="diag-status-banner-desc mt-0.5">
                    Active Provider: <strong className="text-white">{capSummary.activeProvider}</strong> &bull; Scratch workspace: isolated &amp; auto-cleaned &bull; Report: <span className="font-mono text-[10px]">docs/DIAGNOSTIC-REPORT.md</span>
                  </div>
                </div>
              </div>

              <div className="diag-status-pills">
                <span className="diag-pill-pass">{capSummary.passedCount} PASS</span>
                <span className="diag-pill-fail">{capSummary.failedCount} FAIL</span>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!capSummary && !isCapRunning && (
            <div className="diag-empty-card">
              <Brain size={32} className="diag-empty-icon" />
              <h3 className="diag-empty-title">Ready to test AI capabilities</h3>
              <p className="diag-empty-desc">
                Validates the connected AI across the 4 core jobs in an isolated temporary scratch workspace (never touches your project files).
              </p>
              <button
                onClick={() => runCapabilityTests()}
                className="mt-2 diag-btn-action diag-btn-sky"
              >
                <Play size={13} />
                <span>Start Capability Tests</span>
              </button>
            </div>
          )}

          {/* Scenario Results Table / Cards */}
          {capSummary && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <span>Scenario Execution Results ({capSummary.scenarios.length})</span>
                <span className="text-[11px] text-zinc-500 flex items-center gap-1 font-normal">
                  <FileText size={12} />
                  <span>docs/DIAGNOSTIC-REPORT.md auto-written</span>
                </span>
              </div>

              <div className="diag-cards-stack">
                {capSummary.scenarios.map((sc: ScenarioResult) => {
                  const isExpanded = Boolean(expandedCapEvidence[sc.id]);
                  return (
                    <div key={sc.id} className="diag-card">
                      {/* Scenario Row Header */}
                      <div className="diag-card-header">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="diag-scenario-icon" style={{ background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            {SCENARIO_ICONS[sc.id] || <Activity size={16} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-white">{sc.title}</span>
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                                {sc.id}
                              </span>
                              {sc.toolUsed && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-sky-950/40 text-sky-300 border border-sky-800/40">
                                  tool: {sc.toolUsed}
                                </span>
                              )}
                              {sc.diffShown && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
                                  diff verified
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 mt-0.5">
                              Prompt: <span className="italic text-zinc-300">&ldquo;{sc.prompt}&rdquo;</span>
                            </div>
                          </div>
                        </div>

                        <div className="diag-card-actions">
                          {sc.status === 'PASS' ? (
                            <span className="diag-pill-pass flex items-center gap-1.5 text-xs font-semibold">
                              <CheckCircle2 size={13} />
                              PASS ({sc.durationMs}ms)
                            </span>
                          ) : (
                            <span className="diag-pill-fail flex items-center gap-1.5 text-xs font-semibold">
                              <XCircle size={13} />
                              FAIL
                            </span>
                          )}

                          <button
                            onClick={() => toggleCapEvidence(sc.id)}
                            id={`btn-evidence-${sc.id}`}
                            className="diag-btn-hud text-xs"
                          >
                            <span>{isExpanded ? 'Hide evidence' : 'View evidence'}</span>
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                      </div>

                      {/* Pass Criteria Info */}
                      <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                        <span className="text-zinc-400 font-medium">Pass Criteria:</span>
                        <span>{sc.passCriteria}</span>
                      </div>

                      {/* Expandable Evidence Drawer */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-zinc-800/80 space-y-3">
                          {/* Diff Preview Card (for write and edit) */}
                          {sc.evidence?.diffPreview && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                                <FileCode size={13} className="text-sky-400" />
                                <span>Diff Preview Card ({sc.evidence.diffPreview.filePath || 'diag-write.md'})</span>
                              </div>
                              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] space-y-1 overflow-x-auto">
                                <div className="text-zinc-500 text-[10px]">
                                  --- {sc.evidence.diffPreview.filePath || 'diag-write.md'} (original)
                                </div>
                                <div className="text-rose-400 bg-rose-950/20 px-1 py-0.5 rounded">
                                  - {sc.evidence.diffPreview.originalContent || '(empty file)'}
                                </div>
                                <div className="text-zinc-500 text-[10px]">
                                  +++ {sc.evidence.diffPreview.filePath || 'diag-write.md'} (proposed)
                                </div>
                                <div className="text-emerald-400 bg-emerald-950/20 px-1 py-0.5 rounded">
                                  + {sc.evidence.diffPreview.proposedContent}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Tool Execution Details */}
                          {sc.evidence?.toolCallName && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                                <Wrench size={13} className="text-amber-400" />
                                <span>Tool Execution ({sc.evidence.toolCallName})</span>
                              </div>
                              <pre className="p-2.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto">
                                {JSON.stringify(sc.evidence.toolCallArgs || {}, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Failure Evidence / Taxonomy */}
                          {sc.status === 'FAIL' && sc.evidence && (
                            <div className="diag-remedy-box">
                              <div className="font-semibold text-rose-300 flex items-center gap-1.5 text-xs">
                                <AlertTriangle size={13} />
                                <span>Failure Classification: {sc.evidence.taxonomyCode || 'DIAGNOSTIC_FAILURE'}</span>
                              </div>
                              <div className="text-[11px] text-rose-300/80">
                                Failed Step: <code className="text-rose-200">{sc.evidence.failedStep}</code> &bull; Error: {sc.evidence.errorMessage || 'Condition not met'}
                              </div>
                              {sc.evidence.rawResponseBytes && (
                                <div className="space-y-1 pt-1">
                                  <div className="text-[10px] text-zinc-400">Raw response bytes:</div>
                                  <pre className="diag-evidence-pre">
                                    {sc.evidence.rawResponseBytes}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SECTION 3: REMEDIATION CHECKLIST (PHASE DIAGNOSTICS 3 & 4)
          ===================================================================== */}
      {subTab === 'remediation' && (
        <div className="space-y-5">
          {/* Header Banner */}
          <div className="diag-hero-banner">
            <div className="diag-hero-title-group">
              <div className="diag-hero-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                <ListChecks size={18} />
              </div>
              <div className="diag-hero-text">
                <h2>Remediation Checklist &amp; Action Plan</h2>
                <p>
                  Automatically classified checklist derived from your live probe results. Explains what works right now, what is missing, and what action to take next.
                </p>
              </div>
            </div>

            <div className="diag-hero-actions">
              <button
                onClick={() => void loadRemediationReport()}
                disabled={isRemediationLoading}
                className="diag-btn-action diag-btn-primary"
              >
                {isRemediationLoading ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Analyzing Findings...</span>
                  </>
                ) : (
                  <>
                    <RotateCw size={13} />
                    <span>Regenerate Checklist</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCopyRemediationReport}
                disabled={!remediationReport}
                className="diag-btn-action diag-btn-secondary"
                title="Copy full remediation plan as Markdown"
              >
                {remReportCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{remReportCopied ? 'Copied Plan!' : 'Copy Plan'}</span>
              </button>
            </div>
          </div>

          {isRemediationLoading && (
            <div className="p-8 text-center rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
              <RotateCw size={24} className="mx-auto text-indigo-400 animate-spin" />
              <h3 className="text-sm font-semibold text-zinc-300">Evaluating diagnostics &amp; generating checklist...</h3>
              <p className="text-xs text-zinc-500">Classifying taxonomy codes and structuring actionable remediation steps.</p>
            </div>
          )}

          {remediationReport && (
            <div className="space-y-5">
              {/* Live provenance notice when nothing has been tested yet */}
              {!connSummary && !capSummary && remediationReport.workingNow.length === 0 &&
               remediationReport.missingFromYou.length === 0 &&
               remediationReport.missingFromCode.length === 0 &&
               remediationReport.externalOutage.length === 0 && (
                <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 text-zinc-300 text-xs flex items-start gap-3">
                  <Info size={16} className="text-zinc-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-200">No diagnostic results measured yet</div>
                    <div className="text-[11px] text-zinc-400">
                      This checklist is rebuilt from measured results of the Connection Diagnostics and Capability
                      Test Suite. Run those first and this checklist will populate with your real findings.
                    </div>
                  </div>
                </div>
              )}

              {/* 1. RECOMMENDED NEXT ACTION (Single Highest-Value Step Hero Card) */}
              <div className="diag-recommended-hero">
                <div className="space-y-2 max-w-2xl">
                  <span className="diag-recommended-badge">
                    <Sparkles size={12} className="text-indigo-400" />
                    RECOMMENDED NEXT ACTION &bull; HIGHEST VALUE
                  </span>
                  <h3 className="text-base font-bold text-white tracking-tight m-0">
                    {remediationReport.recommendedNextAction.title}
                  </h3>
                  <p className="text-xs text-zinc-300 leading-relaxed m-0">
                    {remediationReport.recommendedNextAction.description}
                  </p>
                  <p className="text-[10px] text-zinc-500 m-0">
                    Generated {new Date(remediationReport.timestamp).toLocaleTimeString()} from latest probe.
                  </p>
                </div>

                <button
                  onClick={() => handleRemediationAction(remediationReport.recommendedNextAction)}
                  id="btn-recommended-action"
                  className="diag-btn-action diag-btn-primary"
                >
                  <span>{remediationReport.recommendedNextAction.actionLabel}</span>
                  <ArrowRight size={13} />
                </button>
              </div>

              {/* 2. WORKING NOW (Providers & Models ready immediately) */}
              <div className="space-y-3" id="section-working-now">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 m-0">
                      1. Working Now &bull; Ready Immediately ({remediationReport.workingNow.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500">Start coding without waiting</span>
                </div>

                {remediationReport.workingNow.length === 0 ? (
                  <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-200 text-xs space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-400" />
                      <span>No Operational Providers Connected</span>
                    </div>
                    <div className="text-[11px] opacity-90">
                      {remediationReport.workingPathExplanation ||
                        'No providers are currently operational. Review the missing items below to restore connectivity.'}
                    </div>
                  </div>
                ) : (
                  <div className="diag-checklist-grid">
                    {remediationReport.workingNow.map((item) => (
                      <div key={item.providerId} className="diag-checklist-item">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">{item.providerName}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              READY
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400 mt-1">
                            Model: {item.modelId} &bull; {item.authType}
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            handleRemediationAction({
                              actionType: 'use_provider',
                              actionTarget: item.providerId
                            })
                          }
                          className="diag-btn-hud text-xs"
                        >
                          <span>Use Provider</span>
                          <ArrowRight size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. MISSING FROM YOU (Interactive Checklist for User) */}
              <div className="space-y-3" id="section-missing-from-you">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 m-0">
                      2. Missing From You &bull; User Action Required ({remediationReport.missingFromYou.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500">API keys, tokens, or network permissions</span>
                </div>

                {remediationReport.missingFromYou.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span>All required API keys and user configurations are present and verified!</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {remediationReport.missingFromYou.map((item) => {
                      const isChecked = Boolean(checkedItems[item.id]);
                      return (
                        <div
                          key={item.id}
                          className={`diag-checklist-item ${isChecked ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => toggleCheckItem(item.id)}
                              className="mt-0.5 text-zinc-400 hover:text-white cursor-pointer transition-colors"
                              title={isChecked ? 'Mark incomplete' : 'Mark complete'}
                            >
                              {isChecked ? (
                                <CheckSquare size={16} className="text-emerald-400" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>

                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-sm font-semibold ${isChecked ? 'line-through text-zinc-400' : 'text-white'}`}>
                                  {item.providerName}
                                </span>
                                <span className="diag-code-badge bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                  {item.code}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-300 m-0">{item.issue}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {item.actionUrl && (
                              <button
                                onClick={() =>
                                  handleRemediationAction({
                                    actionType: item.actionType,
                                    actionTarget: item.settingTab || item.actionUrl,
                                    actionUrl: item.actionUrl
                                  })
                                }
                                className="diag-btn-hud text-amber-200 border-amber-500/30 hover:bg-amber-500/20"
                              >
                                <span>{item.actionText}</span>
                                <ExternalLink size={11} />
                              </button>
                            )}

                            {item.aiCoderPrompt && (
                              <button
                                onClick={() => copyAiCoderPrompt(item.aiCoderPrompt!, item.id)}
                                title="Copy AI prompt for this item"
                                className="diag-btn-hud"
                              >
                                {copiedItemId === item.id ? (
                                  <Check size={12} className="text-emerald-400" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 4. MISSING FROM CODE (Bugs for AI Coder to Fix) */}
              <div className="space-y-3" id="section-missing-from-code">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode size={16} className="text-rose-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400 m-0">
                      3. Missing From Code &bull; AI Coder Fixes ({remediationReport.missingFromCode.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500">Protocol mismatches &amp; streaming parser fixes</span>
                </div>

                {remediationReport.missingFromCode.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span>No client-side protocol or parsing bugs detected in src/!</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {remediationReport.missingFromCode.map((item) => {
                      const isExpanded = Boolean(expandedRemediationEvidence[item.id]);
                      return (
                        <div key={item.id} className="diag-card border-rose-950/40">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-white">{item.providerName}</span>
                                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  {item.code}
                                </span>
                                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50 flex items-center gap-1">
                                  <FileCode size={11} className="text-rose-400" />
                                  <span>{item.targetFile}{item.targetLine ? `:${item.targetLine}` : ''}</span>
                                </span>
                              </div>
                              <p className="text-xs text-zinc-300 m-0">{item.issue}</p>
                            </div>

                            <button
                              onClick={() => copyAiCoderPrompt(item.aiCoderPrompt, item.id)}
                              className="diag-btn-hud text-rose-200 border-rose-500/30 hover:bg-rose-500/20"
                            >
                              {copiedItemId === item.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                              <span>{copiedItemId === item.id ? 'Prompt Copied!' : 'Copy Fix Prompt'}</span>
                            </button>
                          </div>

                          <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs space-y-1">
                            <div className="text-zinc-400 text-[11px] font-medium flex items-center gap-1.5">
                              <Terminal size={12} className="text-indigo-400" />
                              <span>Required Fix:</span>
                            </div>
                            <div className="text-zinc-200 font-mono text-[11px]">{item.fixDescription}</div>

                            {item.evidenceChunk && (
                              <div className="pt-1">
                                <button
                                  onClick={() => toggleRemediationEvidence(item.id)}
                                  className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                >
                                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  <span>{isExpanded ? 'Hide Raw Chunk Evidence' : 'Show Raw Chunk Evidence'}</span>
                                </button>
                                {isExpanded && (
                                  <pre className="diag-evidence-pre">
                                    {item.evidenceChunk}
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 5. EXTERNAL OUTAGE (Providers Down Right Now) */}
              <div className="space-y-3" id="section-external-outage">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-orange-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-400 m-0">
                      4. External Outage &bull; Providers Down Right Now ({remediationReport.externalOutage.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500">Live status links &amp; auto-retry schedule</span>
                </div>

                {remediationReport.externalOutage.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span>All remote provider gateways are responding normally without outages or rate limits!</span>
                  </div>
                ) : (
                  <div className="diag-checklist-grid">
                    {remediationReport.externalOutage.map((item) => (
                      <div key={item.id} className="diag-card border-orange-500/20">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">{item.providerName}</span>
                            <span className="diag-code-badge bg-orange-500/10 text-orange-400 border border-orange-500/20">
                              {item.code}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-300 mt-1">{item.details}</div>
                        </div>

                        <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800 text-[11px] space-y-1">
                          <div className="text-zinc-400 flex items-center gap-1.5">
                            <Clock size={11} className="text-orange-400" />
                            <span>Retry: <strong className="text-zinc-200">{item.nextRetrySchedule}</strong></span>
                          </div>
                          <div className="text-zinc-400 flex items-center gap-1.5">
                            <Zap size={11} className="text-emerald-400" />
                            <span>Fallback: <strong className="text-emerald-300">{item.suggestedFallback}</strong></span>
                          </div>
                        </div>

                        {item.statusUrl && (
                          <div className="pt-1">
                            <a
                              href={item.statusUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 underline"
                            >
                              <span>Provider Status Page</span>
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. MANUAL SMOKE-TEST SCRIPT (6 Prompts) */}
              <div className="space-y-3 pt-3 border-t border-zinc-800/80" id="section-manual-smoke-test">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Terminal size={16} className="text-emerald-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 m-0">
                        Manual Smoke-Test Script (Under 3 Minutes)
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        6 Prompts
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 m-0">
                      Copy each prompt into chat to verify completions, tool-calling, and streaming by hand.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyAllSmokeSteps}
                      id="btn-copy-smoke-all"
                      className="diag-btn-hud text-xs"
                    >
                      {copiedAllSmoke ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      <span>{copiedAllSmoke ? 'Script Copied!' : 'Copy Entire Script'}</span>
                    </button>

                    <button
                      onClick={() => window.electronAPI?.openPath?.('docs/SMOKE-TEST.md')}
                      className="diag-btn-hud text-xs"
                      title="Open docs/SMOKE-TEST.md"
                    >
                      <FileText size={12} />
                      <span>docs/SMOKE-TEST.md</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {SMOKE_TEST_STEPS.map((step: SmokeTestStep) => {
                    const isCopied = copiedSmokeId === step.id;
                    return (
                      <div key={step.id} className="diag-checklist-item">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 text-[11px] font-bold shrink-0">
                              {step.stepNumber}
                            </span>
                            <span className="font-mono text-xs font-semibold text-white">
                              &ldquo;{step.send}&rdquo;
                            </span>
                            <span className="font-mono text-[10px] text-zinc-500">
                              ~{step.timeEstimateSec}s
                            </span>
                          </div>

                          <div className="text-[11px] text-zinc-400 pl-7">
                            <strong className="text-zinc-300 font-medium">Expected: </strong>
                            <span>{step.expect}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => copySmokeStep(step.send, step.id)}
                          id={`btn-copy-smoke-${step.stepNumber}`}
                          className="diag-btn-hud text-xs shrink-0"
                        >
                          {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          <span>{isCopied ? 'Copied!' : 'Copy Prompt'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Failure Protocol Alert Box */}
                <div
                  id="smoke-failure-protocol"
                  className="diag-status-banner is-warning"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-amber-300">Failure Protocol:</div>
                      <div className="text-[11px] text-amber-200/90 leading-relaxed">
                        {SMOKE_TEST_FAILURE_PROTOCOL}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SECTION 4: END-TO-END CONNECTIVITY TRACE (H1–H10 WATERFALL)
          ===================================================================== */}
      {subTab === 'trace' && (
        <div className="space-y-4">
          {/* Header Banner */}
          <div className="diag-hero-banner">
            <div className="diag-hero-title-group">
              <div className="diag-hero-icon" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
                <Network size={18} />
              </div>
              <div className="diag-hero-text">
                <h2>End-to-End Connectivity Trace</h2>
                <p>
                  Real-path probe tracing Hops H1 through H10 through actual app code to identify broken hops across renderer, preload, and main process.
                </p>
              </div>
            </div>

            <div className="diag-hero-actions">
              <button
                onClick={handleScanMocks}
                disabled={isScanningMocks}
                id="btn-scan-mocks"
                className="diag-btn-action diag-btn-secondary"
              >
                {isScanningMocks ? <RotateCw size={12} className="animate-spin text-purple-400" /> : <ShieldCheck size={12} className="text-purple-400" />}
                <span>{isScanningMocks ? 'Scanning...' : 'Scan Mock Paths'}</span>
              </button>

              <button
                onClick={handleCopyTraceJson}
                disabled={!traceReport}
                id="btn-copy-trace-json"
                className="diag-btn-action diag-btn-secondary"
              >
                {traceCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                <span>{traceCopied ? 'Copied JSON!' : 'Copy Trace JSON'}</span>
              </button>

              <button
                onClick={handleRunTrace}
                disabled={isTraceRunning}
                id="btn-run-connectivity-trace"
                className="diag-btn-action diag-btn-purple"
              >
                {isTraceRunning ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Tracing Hops H1–H10...</span>
                  </>
                ) : (
                  <>
                    <Play size={13} />
                    <span>Run Live Trace</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Overall Trace Status Banner */}
          {traceReport && (
            <div className={`diag-status-banner ${traceReport.overallStatus === 'PASS' ? 'is-success' : 'is-danger'}`}>
              <div className="diag-status-banner-left">
                {traceReport.overallStatus === 'PASS' ? (
                  <CheckCircle2 size={18} className="text-emerald-400" />
                ) : (
                  <XCircle size={18} className="text-rose-400" />
                )}
                <div>
                  <div className="diag-status-banner-title">
                    {traceReport.overallStatus === 'PASS'
                      ? 'End-to-End Connectivity Verified Across Providers'
                      : `Connectivity Broken at Hop ${traceReport.firstFailingHop || 'H6'} (${traceReport.firstFailingProvider || 'unknown provider'})`}
                  </div>
                  <div className="diag-status-banner-desc">
                    {traceReport.summary.passedCount} of {traceReport.summary.totalTested} providers passed
                    {traceReport.summary.skippedCount > 0
                      ? `, ${traceReport.summary.skippedCount} skipped (no key)`
                      : ''}
                    . Probe prompt: &ldquo;{traceReport.cannedPrompt}&rdquo;
                  </div>
                </div>
              </div>

              {traceReport.firstFailingProvider && traceReport.providers[traceReport.firstFailingProvider]?.taxonomyCode && (
                <div className="px-3 py-1 rounded bg-rose-500/20 border border-rose-500/30 text-xs font-mono font-semibold text-rose-300">
                  Taxonomy: {traceReport.providers[traceReport.firstFailingProvider]?.taxonomyCode}
                </div>
              )}
            </div>
          )}

          {/* Provider Selection Tabs */}
          {traceReport && Object.keys(traceReport.providers).length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {Object.entries(traceReport.providers).map(([pId, trace]) => {
                const isActive = activeTraceProvider === pId;
                const isPass = trace.status === 'PASS';
                const isSkipped = trace.status === 'SKIPPED';
                const badgeLabel = isPass ? 'PASS' : isSkipped ? 'SKIP' : `FAIL (${trace.firstFailingHop || 'ERR'})`;
                return (
                  <button
                    key={pId}
                    onClick={() => setActiveTraceProvider(pId)}
                    className={`diag-btn-hud ${isActive ? 'is-active text-white' : ''}`}
                  >
                    <span>{trace.providerName || pId}</span>
                    <span className={isPass ? 'text-emerald-400 text-[10px] font-bold' : isSkipped ? 'text-amber-400 text-[10px] font-bold' : 'text-rose-400 text-[10px] font-bold'}>
                      {badgeLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected Provider Waterfall Details */}
          {traceReport && traceReport.providers[activeTraceProvider] && (
            <div className="space-y-3">
              {/* Provider Info Summary */}
              {(() => {
                const trace = traceReport.providers[activeTraceProvider];
                return (
                  <div className="diag-card">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-white text-sm">{trace.providerName}</span>
                        <span className="text-xs text-zinc-400 font-mono">Model: {trace.modelId}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                          Auth: {trace.authType}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400">
                        Total Latency: <strong className="text-zinc-200">{trace.totalDurationMs}ms</strong>
                      </div>
                    </div>

                    {trace.firstFailingHop && (
                      <div className="diag-remedy-box">
                        <div className="font-semibold text-rose-300 flex items-center gap-1.5 text-xs">
                          <AlertTriangle size={14} className="text-rose-400" />
                          <span>Failing Hop: {trace.firstFailingHop} &mdash; Classification: {trace.taxonomyCode || 'UNCLASSIFIED'}</span>
                        </div>
                        <div className="text-rose-200/90 text-xs pl-5">{trace.errorSummary}</div>
                        {trace.remedy && (
                          <div className="text-zinc-300 text-xs pl-5 pt-1">
                            <strong className="text-purple-300">Remedy: </strong>
                            <span>{trace.remedy}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {trace.status === 'SKIPPED' && (
                      <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 text-xs space-y-1">
                        <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                          <Info size={14} className="text-amber-400" />
                          <span>Skipped: {trace.skipReason || 'Not configured (expected state, not a failure).'}</span>
                        </div>
                        <div className="text-amber-200/70 pl-5">
                          This provider was not probed because it holds no stored key. Add one in Settings &gt; Providers to include it in tests.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* H1 to H10 Waterfall Rows */}
              <div className="diag-waterfall-track">
                {(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10'] as HopId[]).map((hopId) => {
                  const trace = traceReport.providers[activeTraceProvider];
                  const hop = trace?.hops[hopId];
                  const isExpanded = expandedHopId === hopId;
                  const isPass = hop?.status === 'PASS';
                  const isFail = hop?.status === 'FAIL';
                  const isSkipped = hop?.status === 'SKIPPED';
                  const isPending = !hop || hop.status === 'PENDING';

                  const HOP_META: Record<HopId, { title: string; subtitle: string }> = {
                    H0: { title: 'Prompt Assembly', subtitle: 'Dynamic system prompt assembled from profile, mode, and roles' },
                    H1: { title: 'Renderer Chat Handler', subtitle: 'ChatSidecar send handler invoked' },
                    H2: { title: 'Preload IPC Bridge', subtitle: 'window.electronAPI.startAgentTask called' },
                    H3: { title: 'Main IPC Receiver', subtitle: "ipcMain.handle('agent:start-task') entered" },
                    H4: { title: 'Agent Engine Setup', subtitle: 'run() started, system prompt + tools assembled' },
                    H5: { title: 'Provider Gateway Resolution', subtitle: 'safeStorage key presence checked, endpoint resolved' },
                    H6: { title: 'Network Fetch & Handshake', subtitle: 'HTTP fetch /chat/completions (URL, status, headers)' },
                    H7: { title: 'SSE Stream Parsing', subtitle: 'First chunk parsed, delta extracted (TTFT)' },
                    H8: { title: 'Stream IPC Fanout', subtitle: 'agent:stream-token events forwarded to renderer' },
                    H9: { title: 'Tool Sandbox Execution', subtitle: 'Tool sandbox verified or tool call executed' },
                    H10: { title: 'Renderer Presentation', subtitle: 'Tokens rendered into UI state' }
                  };

                  return (
                    <div
                      key={hopId}
                      className="diag-card p-0 overflow-hidden"
                    >
                      <div
                        onClick={() => setExpandedHopId(isExpanded ? null : hopId)}
                        className="diag-hop-node"
                      >
                        <div className="diag-hop-left">
                          <span
                            className={`diag-hop-badge ${
                              isPass
                                ? 'is-pass'
                                : isFail
                                  ? 'is-fail'
                                  : 'is-pending'
                            }`}
                          >
                            {hopId}
                          </span>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="diag-hop-title">
                                {HOP_META[hopId]?.title || hop?.name || hopId}
                              </span>
                              {hop?.durationMs !== undefined && (
                                <span className="diag-hop-latency">
                                  {hop.durationMs}ms
                                </span>
                              )}
                              {hop?.payloadSize !== undefined && (
                                <span className="text-[10px] text-zinc-500">
                                  ({hop.payloadSize} bytes)
                                </span>
                              )}
                            </div>
                            <div className="diag-hop-desc">
                              {HOP_META[hopId]?.subtitle}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 ml-3">
                          {isPass && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                              <CheckCircle2 size={14} />
                              <span className="hidden sm:inline">PASS</span>
                            </span>
                          )}
                          {isFail && (
                            <span className="flex items-center gap-1 text-xs text-rose-400 font-semibold">
                              <XCircle size={14} />
                              <span className="hidden sm:inline">FAIL</span>
                            </span>
                          )}
                          {isSkipped && (
                            <span className="text-xs text-zinc-500 font-medium">SKIPPED</span>
                          )}
                          {isPending && (
                            <span className="text-xs text-zinc-600 font-medium">PENDING</span>
                          )}

                          {isExpanded ? (
                            <ChevronDown size={14} className="text-zinc-400" />
                          ) : (
                            <ChevronRight size={14} className="text-zinc-400" />
                          )}
                        </div>
                      </div>

                      {/* Expandable Hop Metadata Drawer */}
                      {isExpanded && (
                        <div className="p-4 border-t border-zinc-800/80 space-y-3 text-xs bg-zinc-950/40">
                          {hop?.error && (
                            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 font-mono text-[11px] break-all">
                              <strong>Error: </strong> {hop.error}
                            </div>
                          )}

                          {hop?.metadata && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-zinc-400">Evidence Metadata (Zero Secrets):</div>
                              <pre className="diag-evidence-pre">
                                {JSON.stringify(hop.metadata, null, 2)}
                              </pre>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
                            <span>Timestamp: {hop?.timestamp ? new Date(hop.timestamp).toLocaleTimeString() : 'N/A'}</span>
                            <span>Hop Status: {hop?.status || 'PENDING'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Static Mock Scanner Findings Card */}
          {mockScanReport && (
            <div className="diag-card">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className={mockScanReport.hasShortCircuits ? 'text-rose-400' : 'text-emerald-400'} />
                  <span className="font-semibold text-sm text-white">Static Mock Scanner Findings</span>
                  <span className="text-xs text-zinc-400">
                    ({mockScanReport.filesScanned} files scanned across src/main/agent, src/main/providers, and ChatSidecar)
                  </span>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    mockScanReport.hasShortCircuits
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}
                >
                  {mockScanReport.hasShortCircuits ? 'SHORT-CIRCUITS DETECTED' : 'CLEAN — NO STREAMING MOCKS'}
                </span>
              </div>

              {mockScanReport.pathsFound.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {mockScanReport.pathsFound.map((finding, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800 text-xs space-y-1 font-mono"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-purple-300 font-semibold">{finding.file}:{finding.line}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {finding.category}
                        </span>
                      </div>
                      <div className="text-zinc-400 text-[11px] truncate bg-black/40 p-1.5 rounded">
                        {finding.codeSnippet}
                      </div>
                      <div className="text-zinc-300 text-[11px] font-sans">
                        <strong className="text-zinc-400">Verified: </strong>
                        {finding.explanation}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-400">No mock pattern references found. Production streaming paths strictly verified.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
