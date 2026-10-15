/**
 * Ty-Code Provider Connection & Capability Diagnostics Panel (Phase Diagnostics 1 & 2)
 *
 * Full in-app diagnostic harness testing:
 * 1. Connection Diagnostics: Every configured and built-in free provider with 5-step verification & error taxonomy
 * 2. Capability Test Suite: The 4 core jobs (answer questions, write files, edit files, use tools, reasoning)
 *    with scratch workspace isolation, automatic pass/fail, evidence capture, auto-fallback, and auto-written reports.
 *
 * Brand: Ty-Code
 */

import React, { useState, useCallback } from 'react';
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
  Terminal
} from 'lucide-react';
import type {
  DiagnosticRunSummary,
  ProviderDiagnosticResult,
  DiagnosticStep,
  CapabilitySuiteSummary,
  ScenarioResult,
  RemediationReport,
  WorkingNowItem,
  MissingFromYouItem,
  MissingFromCodeItem,
  ExternalOutageItem,
  RecommendedAction,
  SmokeTestStep
} from '../../../../shared/types/diagnostics';
import { SMOKE_TEST_STEPS, SMOKE_TEST_FAILURE_PROTOCOL } from '../../../../shared/types/diagnostics';
import { toast } from '../../state/toast-store';
import { useChatStore } from '../../state/chat-store';

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

export const DiagnosticsPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<'connection' | 'capabilities' | 'remediation'>('connection');

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
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [expandedRemediationEvidence, setExpandedRemediationEvidence] = useState<Record<string, boolean>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  // Manual smoke-test state (Phase Diagnostics 4)
  const [copiedSmokeId, setCopiedSmokeId] = useState<string | null>(null);
  const [copiedAllSmoke, setCopiedAllSmoke] = useState(false);

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
        await navigator.clipboard.writeText(action.actionTarget);
        setRemediationPromptCopied(true);
        toast.success('AI Coder prompt copied to clipboard!');
        setTimeout(() => setRemediationPromptCopied(false), 2500);
      }
    }
  }, []);

  // Copy AI coder prompt to clipboard with feedback
  const copyAiCoderPrompt = useCallback(async (prompt: string, itemId?: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      if (itemId) {
        setCopiedItemId(itemId);
        setTimeout(() => setCopiedItemId(null), 2500);
      } else {
        setRemediationPromptCopied(true);
        setTimeout(() => setRemediationPromptCopied(false), 2500);
      }
      toast.success('AI Coder prompt copied to clipboard!');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, []);

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
        // Auto-refresh remediation checklist
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
        // Auto-refresh remediation checklist
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
        await navigator.clipboard.writeText(res.data);
        setConnCopied(true);
        toast.success('Connection report copied to clipboard!');
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
        await navigator.clipboard.writeText(res.data);
        setCapCopied(true);
        toast.success('Capability report copied to clipboard!');
        setTimeout(() => setCapCopied(false), 2500);
      } else if (capSummary?.markdownReport) {
        await navigator.clipboard.writeText(capSummary.markdownReport);
        setCapCopied(true);
        toast.success('Capability report copied to clipboard!');
        setTimeout(() => setCapCopied(false), 2500);
      } else {
        toast.error(res.error || 'Failed to generate capability report');
      }
    } catch {
      toast.error('Could not copy capability report');
    }
  }, [capSummary]);

  const toggleConnEvidence = (providerId: string) => {
    setExpandedConnEvidence((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const toggleCapEvidence = (scenarioId: string) => {
    setExpandedCapEvidence((prev) => ({ ...prev, [scenarioId]: !prev[scenarioId] }));
  };

  const getStatusBadge = (res: ProviderDiagnosticResult) => {
    if (res.status === 'PASS') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={13} />
          PASS {res.timeToFirstTokenMs ? `(${res.timeToFirstTokenMs}ms)` : ''}
        </span>
      );
    }
    if (res.status === 'FAIL') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <XCircle size={13} />
          FAIL ({res.errorCode || 'ERROR'})
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-700/20 text-zinc-400 border border-zinc-700/30">
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
    <div className="space-y-6 text-zinc-200">
      {/* Sub-Tab Navigation Switcher */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-inner">
        <button
          onClick={() => setSubTab('connection')}
          id="diag-subtab-connection"
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            subTab === 'connection'
              ? 'bg-zinc-800 text-white shadow'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Activity size={14} className={subTab === 'connection' ? 'text-indigo-400' : ''} />
          <span>Provider Connections (Harness &amp; Taxonomy)</span>
        </button>

        <button
          onClick={() => setSubTab('capabilities')}
          id="diag-subtab-capabilities"
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            subTab === 'capabilities'
              ? 'bg-zinc-800 text-white shadow'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Brain size={14} className={subTab === 'capabilities' ? 'text-sky-400' : ''} />
          <span>Capability Tests (Answer / Write / Edit / Tools)</span>
        </button>

        <button
          onClick={() => {
            setSubTab('remediation');
            if (!remediationReport) {
              void loadRemediationReport();
            }
          }}
          id="diag-subtab-remediation"
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            subTab === 'remediation'
              ? 'bg-zinc-800 text-white shadow'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <ListChecks size={14} className={subTab === 'remediation' ? 'text-emerald-400' : ''} />
          <span>What&apos;s Needed Checklist (Remediation)</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: CONNECTION DIAGNOSTICS & ERROR TAXONOMY                        */}
      {/* ========================================================================= */}
      {subTab === 'connection' && (
        <div className="space-y-6">
          {/* Header & Main Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 shadow-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <Activity size={20} />
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-white">Provider Connection Diagnostics</h2>
              </div>
              <p className="text-xs text-zinc-400 max-w-xl">
                Live 5-step test sequence (Reachability, 1-Token Auth, SSE Streaming, Tool-Call Format, TTFT) across all free providers with automated error taxonomy classification.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => runDiagnostics()}
                disabled={isConnRunning}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all cursor-pointer"
              >
                {isConnRunning ? (
                  <>
                    <RotateCw size={14} className="animate-spin" />
                    Testing Providers...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Run All Tests
                  </>
                )}
              </button>

              <button
                onClick={handleCopyConnReport}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 font-medium text-xs transition-colors cursor-pointer"
                title="Copy Markdown Diagnostic Report"
              >
                {connCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{connCopied ? 'Copied!' : 'Copy Report'}</span>
              </button>
            </div>
          </div>

          {/* Zero-Key Status Banner */}
          {connSummary && (
            <div
              className={`flex items-center justify-between p-4 rounded-xl border ${
                connSummary.zeroKeyOperational
                  ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                  : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {connSummary.zeroKeyOperational ? (
                  <Zap size={18} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={18} className="text-amber-400" />
                )}
                <div>
                  <div className="text-xs font-semibold">
                    {connSummary.zeroKeyOperational
                      ? 'Zero-Key Fallback Operational'
                      : 'Zero-Key Providers Require Attention'}
                  </div>
                  <div className="text-[11px] opacity-80">
                    {connSummary.zeroKeyOperational
                      ? 'Anonymous tier (OpenKilo / local inference) is active. Free reasoning and completions available out-of-the-box.'
                      : 'No anonymous free tier currently active. Please review OpenKilo or local Ollama.'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="text-emerald-400">{connSummary.passedCount} PASS</span>
                <span className="text-rose-400">{connSummary.failedCount} FAIL</span>
                <span className="text-zinc-400">{connSummary.skippedCount} SKIPPED</span>
              </div>
            </div>
          )}

          {/* No results yet state */}
          {!connSummary && !isConnRunning && (
            <div className="p-12 text-center rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
              <Server size={32} className="mx-auto text-zinc-600" />
              <h3 className="text-sm font-medium text-zinc-300">Ready to diagnose providers</h3>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Click &ldquo;Run All Tests&rdquo; to test every built-in free provider and configured key. Anonymous providers will be prioritized first.
              </p>
              <button
                onClick={() => runDiagnostics()}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer transition-colors"
              >
                <Play size={13} />
                Start Diagnostics
              </button>
            </div>
          )}

          {/* Provider Results Grid */}
          {connSummary && (
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Provider Test Results ({connSummary.results.length})
              </h3>

              <div className="grid grid-cols-1 gap-3.5">
                {connSummary.results.map((res) => {
                  const isExpanded = Boolean(expandedConnEvidence[res.providerId]);
                  return (
                    <div
                      key={res.providerId}
                      className="rounded-xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-colors p-4 space-y-3"
                    >
                      {/* Card Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-white">{res.providerName}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                                {res.authType === 'anonymous' ? 'Anonymous (Zero-Key)' : 'API Key Required'}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                              {res.baseUrl} &bull; Model: {res.testedModel || 'default'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
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

                      {/* 5-Step Pipeline Progress */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                        {(Object.keys(STEP_LABELS) as DiagnosticStep[]).map((stepKey) => {
                          const step = res.steps[stepKey];
                          const status = step?.status || 'SKIPPED';
                          return (
                            <div
                              key={stepKey}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] border ${
                                status === 'PASS'
                                  ? 'bg-emerald-950/10 border-emerald-500/20 text-emerald-300'
                                  : status === 'FAIL'
                                    ? 'bg-rose-950/10 border-rose-500/20 text-rose-300 font-semibold'
                                    : 'bg-zinc-800/30 border-zinc-800 text-zinc-500'
                              }`}
                            >
                              <span className="truncate">{STEP_LABELS[stepKey]}</span>
                              <span className="ml-1 shrink-0">{getStepIcon(status)}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Human Message & Remedy Box */}
                      {res.status === 'FAIL' && (
                        <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-200 text-xs space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                                <AlertTriangle size={13} />
                                {res.humanMessage}
                              </div>
                              <div className="text-[11px] text-rose-300/80">{res.remedy}</div>
                            </div>

                            {res.actionUrl && (
                              <a
                                href={res.actionUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-100 border border-rose-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                <span>{res.actionLabel || 'Fix Issue'}</span>
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>

                          {/* Expandable Evidence toggle */}
                          {res.rawEvidence && (
                            <div className="pt-1">
                              <button
                                onClick={() => toggleConnEvidence(res.providerId)}
                                className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                              >
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{isExpanded ? 'Hide Raw Evidence' : 'View Raw Evidence Chunk'}</span>
                              </button>

                              {isExpanded && (
                                <pre className="mt-2 p-2.5 rounded bg-zinc-950/80 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-36 whitespace-pre-wrap break-all">
                                  {res.rawEvidence}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Pass note */}
                      {res.status === 'PASS' && (
                        <div className="text-[11px] text-emerald-400/90 flex items-center gap-1.5">
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

      {/* ========================================================================= */}
      {/* SECTION 2: END-TO-END CAPABILITY TEST SUITE (PHASE DIAGNOSTICS 2)         */}
      {/* ========================================================================= */}
      {subTab === 'capabilities' && (
        <div className="space-y-6" id="capability-tests-section">
          {/* Header & Main Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 shadow-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
                  <Brain size={20} />
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-white">Capability Test Suite</h2>
              </div>
              <p className="text-xs text-zinc-400 max-w-xl">
                Proves the connected AI performs the 4 core jobs: answer questions, write files, edit files, and use workspace tools — with isolated scratch workspace, auto-fallback, and diff verification.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => runCapabilityTests()}
                disabled={isCapRunning}
                id="btn-run-capability-tests"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all cursor-pointer"
              >
                {isCapRunning ? (
                  <>
                    <RotateCw size={14} className="animate-spin" />
                    Running Capability Tests...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Run Capability Tests
                  </>
                )}
              </button>

              <button
                onClick={handleCopyCapReport}
                id="btn-copy-capability-report"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 font-medium text-xs transition-colors cursor-pointer"
                title="Copy Markdown Capability Report"
              >
                {capCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{capCopied ? 'Copied!' : 'Copy Report'}</span>
              </button>
            </div>
          </div>

          {/* Capability Run Summary Banner */}
          {capSummary && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border ${
                capSummary.failedCount === 0
                  ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                  : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {capSummary.failedCount === 0 ? (
                  <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle size={20} className="text-amber-400 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
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
                  <div className="text-[11px] opacity-80 mt-0.5">
                    Active Provider: <strong className="text-white">{capSummary.activeProvider}</strong> &bull; Scratch workspace: isolated &amp; auto-cleaned &bull; Report: <span className="font-mono text-[10px]">docs/DIAGNOSTIC-REPORT.md</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs font-medium self-end sm:self-center">
                <span className="text-emerald-400">{capSummary.passedCount} PASS</span>
                <span className="text-rose-400">{capSummary.failedCount} FAIL</span>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!capSummary && !isCapRunning && (
            <div className="p-12 text-center rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
              <Brain size={32} className="mx-auto text-zinc-600" />
              <h3 className="text-sm font-medium text-zinc-300">Ready to test AI capabilities</h3>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Validates the connected AI across the 4 core jobs in an isolated temporary scratch workspace (never touches your project files).
              </p>
              <button
                onClick={() => runCapabilityTests()}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer transition-colors"
              >
                <Play size={13} />
                Start Capability Tests
              </button>
            </div>
          )}

          {/* Scenario Results Table / Cards */}
          {capSummary && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Scenario Execution Results ({capSummary.scenarios.length})
                </h3>
                <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                  <FileText size={12} />
                  <span>docs/DIAGNOSTIC-REPORT.md auto-written</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {capSummary.scenarios.map((sc: ScenarioResult) => {
                  const isExpanded = Boolean(expandedCapEvidence[sc.id]);
                  return (
                    <div
                      key={sc.id}
                      className="rounded-xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-colors p-4 space-y-3"
                    >
                      {/* Scenario Row Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-start sm:items-center gap-3">
                          <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/50 shrink-0">
                            {SCENARIO_ICONS[sc.id] || <Activity size={16} />}
                          </div>
                          <div>
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

                        <div className="flex items-center gap-2.5 self-end sm:self-center">
                          {sc.status === 'PASS' ? (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 size={13} />
                              PASS ({sc.durationMs}ms)
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              <XCircle size={13} />
                              FAIL
                            </span>
                          )}

                          <button
                            onClick={() => toggleCapEvidence(sc.id)}
                            id={`btn-evidence-${sc.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/50 text-[11px] font-medium transition-colors cursor-pointer"
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
                            <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-200 text-xs space-y-2">
                              <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                                <AlertTriangle size={13} />
                                <span>Failure Classification: {sc.evidence.taxonomyCode || 'DIAGNOSTIC_FAILURE'}</span>
                              </div>
                              <div className="text-[11px] text-rose-300/80">
                                Failed Step: <code className="text-rose-200">{sc.evidence.failedStep}</code> &bull; Error: {sc.evidence.errorMessage || 'Condition not met'}
                              </div>
                              {sc.evidence.rawResponseBytes && (
                                <div className="space-y-1 pt-1">
                                  <div className="text-[10px] text-zinc-400">Raw response bytes (truncated to 2KB):</div>
                                  <pre className="p-2.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
                                    {sc.evidence.rawResponseBytes}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Successful Output Snippet */}
                          {sc.status === 'PASS' && sc.output && (
                            <div className="space-y-1">
                              <div className="text-[10px] text-zinc-400">Response / Verification Output:</div>
                              <pre className="p-2.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-emerald-300/90 overflow-x-auto whitespace-pre-wrap max-h-28">
                                {sc.output}
                              </pre>
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

      {/* ========================================================================= */}
      {/* SECTION 3: REMEDIATION REPORT ENGINE & WHAT'S NEEDED CHECKLIST (PHASE 3) */}
      {/* ========================================================================= */}
      {subTab === 'remediation' && (
        <div className="space-y-6" id="remediation-report-section">
          {/* Header & Main Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 shadow-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <ListChecks size={20} />
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-white">What&apos;s Needed Checklist &amp; Remediation</h2>
              </div>
              <p className="text-xs text-zinc-400 max-w-xl">
                Prioritized, plain-language checklist of exactly what is needed to make Ty-Code work, with one-click fixes and copy-as-prompt handoffs for your AI coder.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => loadRemediationReport()}
                disabled={isRemediationLoading}
                id="btn-refresh-remediation"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all cursor-pointer"
              >
                {isRemediationLoading ? (
                  <>
                    <RotateCw size={14} className="animate-spin" />
                    Generating Report...
                  </>
                ) : (
                  <>
                    <RotateCw size={14} />
                    Refresh What&apos;s Needed
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  if (remediationReport?.aiCoderHandoffPrompt) {
                    void copyAiCoderPrompt(remediationReport.aiCoderHandoffPrompt);
                  }
                }}
                disabled={!remediationReport}
                id="btn-copy-coder-prompt"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-white border border-zinc-700/60 font-medium text-xs transition-colors cursor-pointer"
                title="Copy AI Coder Handoff Prompt Block"
              >
                {remediationPromptCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{remediationPromptCopied ? 'Prompt Copied!' : 'Copy AI Coder Prompt'}</span>
              </button>
            </div>
          </div>

          {/* Loading state if not yet loaded */}
          {isRemediationLoading && !remediationReport && (
            <div className="p-12 text-center rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
              <RotateCw size={32} className="mx-auto text-emerald-400 animate-spin" />
              <h3 className="text-sm font-medium text-zinc-300">Evaluating diagnostics &amp; generating checklist...</h3>
              <p className="text-xs text-zinc-500">Classifying taxonomy codes and structuring actionable remediation steps.</p>
            </div>
          )}

          {remediationReport && (
            <div className="space-y-6">
              {/* 1. RECOMMENDED NEXT ACTION (Single Highest-Value Step Hero Card) */}
              <div className="relative overflow-hidden rounded-xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/40 via-zinc-900 to-zinc-950 p-5 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        <Sparkles size={12} className="text-indigo-400" />
                        RECOMMENDED NEXT ACTION &bull; HIGHEST VALUE
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white tracking-tight">
                      {remediationReport.recommendedNextAction.title}
                    </h3>
                    <p className="text-xs text-zinc-300 max-w-2xl leading-relaxed">
                      {remediationReport.recommendedNextAction.description}
                    </p>
                  </div>

                  <button
                    onClick={() => handleRemediationAction(remediationReport.recommendedNextAction)}
                    id="btn-recommended-action"
                    className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-all cursor-pointer self-start sm:self-center"
                  >
                    <span>{remediationReport.recommendedNextAction.actionLabel}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>

              {/* 2. WORKING NOW (Providers & Models ready immediately) */}
              <div className="space-y-3" id="section-working-now">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      1. Working Now &bull; Ready Immediately ({remediationReport.workingNow.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500 font-medium">Start coding without waiting</span>
                </div>

                {remediationReport.workingNow.length === 0 ? (
                  <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-200 text-xs space-y-1.5">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {remediationReport.workingNow.map((item) => (
                      <div
                        key={item.providerId}
                        className="flex flex-col justify-between p-3.5 rounded-xl bg-zinc-900/80 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-white">{item.providerName}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                READY
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                              Model: {item.modelId} &bull; {item.authType}
                            </div>
                          </div>
                          {item.latencyMs && (
                            <span className="font-mono text-[10px] text-emerald-400 px-1.5 py-0.5 rounded bg-zinc-800">
                              {item.latencyMs}ms TTFT
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[11px]">
                          <span className="text-zinc-400 truncate max-w-[200px]">{item.notes || 'Fully operational'}</span>
                          <button
                            onClick={() =>
                              handleRemediationAction({
                                actionType: 'use_provider',
                                actionTarget: item.providerId
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                          >
                            <span>Use Provider</span>
                            <ArrowRight size={11} />
                          </button>
                        </div>
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
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
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
                  <div className="grid grid-cols-1 gap-2.5">
                    {remediationReport.missingFromYou.map((item) => {
                      const isChecked = Boolean(checkedItems[item.id]);
                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                            isChecked
                              ? 'bg-zinc-900/40 border-zinc-800/60 opacity-60'
                              : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                          }`}
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
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                  {item.code}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-300">{item.issue}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            {item.actionUrl && (
                              <button
                                onClick={() =>
                                  handleRemediationAction({
                                    actionType: item.actionType,
                                    actionTarget: item.settingTab || item.actionUrl,
                                    actionUrl: item.actionUrl
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border border-amber-500/30 text-xs font-medium transition-colors cursor-pointer"
                              >
                                <span>{item.actionText}</span>
                                <ExternalLink size={12} />
                              </button>
                            )}

                            {item.aiCoderPrompt && (
                              <button
                                onClick={() => copyAiCoderPrompt(item.aiCoderPrompt!, item.id)}
                                title="Copy AI prompt for this item"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/50 transition-colors cursor-pointer"
                              >
                                {copiedItemId === item.id ? (
                                  <Check size={13} className="text-emerald-400" />
                                ) : (
                                  <Copy size={13} />
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
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
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
                  <div className="grid grid-cols-1 gap-3">
                    {remediationReport.missingFromCode.map((item) => {
                      const isExpanded = Boolean(expandedRemediationEvidence[item.id]);
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl bg-zinc-900/80 border border-rose-950/40 p-4 space-y-3"
                        >
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
                              <p className="text-xs text-zinc-300">{item.issue}</p>
                            </div>

                            <button
                              onClick={() => copyAiCoderPrompt(item.aiCoderPrompt, item.id)}
                              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 border border-rose-500/30 text-xs font-medium transition-colors cursor-pointer self-start sm:self-center"
                            >
                              {copiedItemId === item.id ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                              <span>{copiedItemId === item.id ? 'Prompt Copied!' : 'Copy Fix Prompt'}</span>
                            </button>
                          </div>

                          <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs space-y-1.5">
                            <div className="text-zinc-400 text-[11px] font-medium flex items-center gap-1.5">
                              <Terminal size={12} className="text-indigo-400" />
                              <span>Required Fix:</span>
                            </div>
                            <div className="text-zinc-200 font-mono text-[11px]">{item.fixDescription}</div>

                            {item.evidenceChunk && (
                              <div className="pt-1.5">
                                <button
                                  onClick={() => toggleRemediationEvidence(item.id)}
                                  className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                >
                                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  <span>{isExpanded ? 'Hide Raw Chunk Evidence' : 'Show Raw Chunk Evidence'}</span>
                                </button>
                                {isExpanded && (
                                  <pre className="mt-2 p-2.5 rounded bg-black/60 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-36 whitespace-pre-wrap break-all">
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
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-400">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {remediationReport.externalOutage.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl bg-zinc-900/80 border border-orange-500/20 hover:border-orange-500/30 transition-colors space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-white">{item.providerName}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                {item.code}
                              </span>
                            </div>
                            <div className="text-xs text-zinc-300 mt-1">{item.details}</div>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[11px] space-y-1">
                          <div className="text-zinc-400 flex items-center gap-1.5">
                            <Clock size={12} className="text-orange-400" />
                            <span>Retry: <strong className="text-zinc-200">{item.nextRetrySchedule}</strong></span>
                          </div>
                          <div className="text-zinc-400 flex items-center gap-1.5">
                            <Zap size={12} className="text-emerald-400" />
                            <span>Fallback: <strong className="text-emerald-300">{item.suggestedFallback}</strong></span>
                          </div>
                        </div>

                        {item.statusUrl && (
                          <div className="flex items-center justify-between pt-1">
                            <a
                              href={item.statusUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-orange-300 hover:text-orange-200 font-medium cursor-pointer"
                            >
                              <span>View Live Status Page</span>
                              <ExternalLink size={12} />
                            </a>

                            {item.aiCoderPrompt && (
                              <button
                                onClick={() => copyAiCoderPrompt(item.aiCoderPrompt!, item.id)}
                                title="Copy AI prompt for this outage"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                              >
                                {copiedItemId === item.id ? (
                                  <Check size={12} className="text-emerald-400" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. AI CODER HANDOFF PROMPT (Self-Contained Copy Block) */}
              <div className="space-y-3 pt-2 border-t border-zinc-800/80" id="section-ai-coder-handoff">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal size={16} className="text-indigo-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                      AI Coder Handoff Prompt Block
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-500 font-mono">docs/DIAGNOSTIC-REPORT.md</span>
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <p className="text-xs text-zinc-400">
                    Paste this self-contained block directly to your AI coder to immediately propose and apply the minimal fix in <code className="text-zinc-300">src/</code>:
                  </p>

                  <pre className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-xs text-indigo-200 overflow-x-auto whitespace-pre-wrap leading-relaxed select-all">
                    {remediationReport.aiCoderHandoffPrompt}
                  </pre>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-zinc-500">
                      Standardized template &bull; Fixed category &bull; Autonomous pass verification
                    </span>

                    <button
                      onClick={() => copyAiCoderPrompt(remediationReport.aiCoderHandoffPrompt)}
                      id="btn-copy-coder-prompt-box"
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-all cursor-pointer"
                    >
                      {remediationPromptCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      <span>{remediationPromptCopied ? 'Prompt Copied to Clipboard!' : 'Copy AI Coder Prompt'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 7. MANUAL SMOKE-TEST MESSAGE SCRIPT (UNDER 3 MINUTES - PHASE DIAGNOSTICS 4) */}
              <div className="space-y-4 pt-4 border-t border-zinc-800/80" id="section-manual-smoke-test">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Terminal size={16} className="text-emerald-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                        Manual Smoke-Test Script (Under 3 Minutes)
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        6 Prompts
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Copy and paste each message into chat to verify the core experience by hand in under 3 minutes.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyAllSmokeSteps}
                      id="btn-copy-smoke-all"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-medium transition-colors cursor-pointer"
                    >
                      {copiedAllSmoke ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      <span>{copiedAllSmoke ? 'Script Copied!' : 'Copy Entire Script'}</span>
                    </button>

                    <button
                      onClick={() => window.electronAPI?.openPath?.('docs/SMOKE-TEST.md')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-medium transition-colors cursor-pointer"
                      title="Open docs/SMOKE-TEST.md"
                    >
                      <FileText size={13} />
                      <span>docs/SMOKE-TEST.md</span>
                    </button>
                  </div>
                </div>

                {/* 6 Steps Grid */}
                <div className="grid grid-cols-1 gap-2.5">
                  {SMOKE_TEST_STEPS.map((step: SmokeTestStep) => {
                    const isCopied = copiedSmokeId === step.id;
                    return (
                      <div
                        key={step.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 transition-colors"
                      >
                        <div className="space-y-1.5 flex-1 min-w-0">
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
                          className="shrink-0 self-end sm:self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-colors cursor-pointer"
                        >
                          {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                          <span>{isCopied ? 'Copied!' : 'Copy Message'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Failure Protocol Alert Box */}
                <div
                  id="smoke-failure-protocol"
                  className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-200 text-xs space-y-1"
                >
                  <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                    <AlertTriangle size={14} className="text-amber-400" />
                    <span>Failure Protocol:</span>
                  </div>
                  <div className="text-[11px] opacity-90 pl-5 leading-relaxed">
                    {SMOKE_TEST_FAILURE_PROTOCOL}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
