/**
 * Ty-Code Desktop IDE - Extension Trace Panel Component
 *
 * Visual waterfall probe displaying the 9 hops of the extension installation
 * and activation pipeline with green/red status, per-hop latencies, payload sizes,
 * error taxonomy classifications, and static scan findings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  X,
  FileCode,
  Layers,
  Code2,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import type {
  ExtensionInstallTraceReport,
  TraceHop,
  MetadataOnlyFinding
} from '../../../../preload/types';

interface ExtensionTracePanelProps {
  isOpen: boolean;
  onClose: () => void;
  targetExtensionId?: string;
}

export const ExtensionTracePanel: React.FC<ExtensionTracePanelProps> = ({
  isOpen,
  onClose,
  targetExtensionId = 'ms-python.python'
}) => {
  const [report, setReport] = useState<ExtensionInstallTraceReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'waterfall' | 'static-scan' | 'json'>('waterfall');
  const [expandedHops, setExpandedHops] = useState<Record<string, boolean>>({
    E5: true,
    E6: true
  });
  const [copied, setCopied] = useState(false);

  const runTrace = useCallback(async () => {
    setIsRunning(true);
    try {
      if (window.electronAPI?.marketplaceTraceInstall) {
        const res = await window.electronAPI.marketplaceTraceInstall(targetExtensionId);
        if (res.success && res.data) {
          setReport(res.data);
        }
      }
    } catch (err) {
      console.error('[ExtensionTracePanel] Trace probe failed:', err);
    } finally {
      setIsRunning(false);
    }
  }, [targetExtensionId]);

  useEffect(() => {
    if (isOpen && !report && !isRunning) {
      void runTrace();
    }
  }, [isOpen, report, isRunning, runTrace]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleHop = (hopId: string) => {
    setExpandedHops((prev) => ({ ...prev, [hopId]: !prev[hopId] }));
  };

  const handleCopyJson = () => {
    if (!report) return;
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '940px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          backgroundColor: '#18181b',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(139, 92, 246, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f4f4f5',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.08) 0%, rgba(24, 24, 27, 0) 100%)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Activity size={18} color="#a78bfa" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.2px' }}>
                  Extension Installation Pipeline Trace
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(139, 92, 246, 0.18)',
                    color: '#c4b5fd',
                    border: '1px solid rgba(139, 92, 246, 0.3)'
                  }}
                >
                  Live Open VSX Probe
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '2px' }}>
                Tracing real 9-hop pipeline (E1..E9) for target: <strong style={{ color: '#e4e4e7' }}>{targetExtensionId}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => void runTrace()}
              disabled={isRunning}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor: isRunning ? 'rgba(255, 255, 255, 0.05)' : '#7c3aed',
                color: '#ffffff',
                border: 'none',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease'
              }}
              title="Re-run live probe against Open VSX"
            >
              <RefreshCw size={13} className={isRunning ? 'animate-spin' : ''} />
              <span>{isRunning ? 'Probing Open VSX…' : 'Run Live Trace'}</span>
            </button>
            <button
              onClick={onClose}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                border: 'none',
                color: '#a1a1aa',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              aria-label="Close Trace Panel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Verdict & Metrics Bar */}
        {report && (
          <div
            style={{
              padding: '12px 20px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Failure Callout */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                <XCircle size={14} />
                <span>
                  First Failing Hop: {report.firstFailingHop || 'None'} ({report.failureClassification || 'PASS'})
                </span>
              </div>

              {/* Architecture State */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#fbbf24',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                <ShieldAlert size={14} />
                <span>Architecture: {report.marketplaceArchitecture}</span>
              </div>
            </div>

            {/* Metrics Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: '#a1a1aa' }}>
              <span>
                Total: <strong style={{ color: '#e4e4e7' }}>{report.metrics.totalDurationMs}ms</strong>
              </span>
              <span>•</span>
              <span style={{ color: '#4ade80' }}>
                ✓ {report.metrics.passedHops} Passed
              </span>
              <span>•</span>
              <span style={{ color: '#f87171' }}>
                ✗ {report.metrics.failedHops} Failed
              </span>
              <span>•</span>
              <span style={{ color: '#71717a' }}>
                ⊘ {report.metrics.skippedHops} Skipped
              </span>
              <span>•</span>
              <span>
                Files: <strong style={{ color: '#e4e4e7' }}>{report.metrics.extractedFileCount || 0}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: '#1f1f23',
            padding: '0 20px'
          }}
        >
          <button
            onClick={() => setActiveTab('waterfall')}
            style={{
              padding: '10px 14px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'waterfall' ? '2px solid #a78bfa' : '2px solid transparent',
              color: activeTab === 'waterfall' ? '#c4b5fd' : '#a1a1aa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Layers size={13} />
            <span>Hop Waterfall (E1..E9)</span>
          </button>

          <button
            onClick={() => setActiveTab('static-scan')}
            style={{
              padding: '10px 14px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'static-scan' ? '2px solid #a78bfa' : '2px solid transparent',
              color: activeTab === 'static-scan' ? '#c4b5fd' : '#a1a1aa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Code2 size={13} />
            <span>
              Metadata-Only Scan ({report?.metadataOnlyScan.totalFindings || 0} Findings)
            </span>
          </button>

          <button
            onClick={() => setActiveTab('json')}
            style={{
              padding: '10px 14px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'json' ? '2px solid #a78bfa' : '2px solid transparent',
              color: activeTab === 'json' ? '#c4b5fd' : '#a1a1aa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <FileCode size={13} />
            <span>Raw JSON Trace</span>
          </button>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {isRunning && !report && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 20px',
                gap: '12px',
                color: '#a1a1aa'
              }}
            >
              <RefreshCw size={24} className="animate-spin" color="#a78bfa" />
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#e4e4e7' }}>
                Connecting to Open VSX Registry…
              </div>
              <div style={{ fontSize: '12px', color: '#71717a' }}>
                Downloading VSIX payload and instrumenting every hop E1 through E9
              </div>
            </div>
          )}

          {/* Tab 1: Waterfall View */}
          {activeTab === 'waterfall' && report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {report.hops.map((hop: TraceHop) => {
                const isExpanded = expandedHops[hop.hop];
                const isPass = hop.status === 'PASS';
                const isFail = hop.status === 'FAIL';
                const isSkipped = hop.status === 'SKIPPED';

                return (
                  <div
                    key={hop.hop}
                    style={{
                      borderRadius: '8px',
                      backgroundColor: isFail
                        ? 'rgba(239, 68, 68, 0.06)'
                        : isPass
                        ? 'rgba(34, 197, 94, 0.04)'
                        : 'rgba(255, 255, 255, 0.02)',
                      border: isFail
                        ? '1px solid rgba(239, 68, 68, 0.3)'
                        : isPass
                        ? '1px solid rgba(34, 197, 94, 0.2)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      onClick={() => toggleHop(hop.hop)}
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Status Icon */}
                        {isPass && <CheckCircle2 size={16} color="#4ade80" />}
                        {isFail && <XCircle size={16} color="#f87171" />}
                        {isSkipped && <AlertTriangle size={16} color="#71717a" />}

                        {/* Hop Tag */}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: isPass
                              ? 'rgba(34, 197, 94, 0.15)'
                              : isFail
                              ? 'rgba(239, 68, 68, 0.2)'
                              : 'rgba(255, 255, 255, 0.08)',
                            color: isPass ? '#86efac' : isFail ? '#fca5a5' : '#a1a1aa'
                          }}
                        >
                          {hop.hop}
                        </span>

                        {/* Title */}
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#f4f4f5' }}>
                          {hop.name}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Taxonomy Pill */}
                        {hop.taxonomy && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(239, 68, 68, 0.18)',
                              color: '#f87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)'
                            }}
                          >
                            {hop.taxonomy}
                          </span>
                        )}

                        {/* Payload / Count */}
                        {hop.payloadSize !== undefined && (
                          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>
                            {hop.payloadSize > 1_000_000
                              ? `${(hop.payloadSize / 1_000_000).toFixed(1)} MB`
                              : hop.payloadSize > 1_000
                              ? `${(hop.payloadSize / 1_000).toFixed(1)} KB`
                              : `${hop.payloadSize} B`}
                          </span>
                        )}

                        {/* Latency */}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: hop.durationMs > 1000 ? '#f59e0b' : '#a1a1aa',
                            minWidth: '55px',
                            textAlign: 'right'
                          }}
                        >
                          {hop.durationMs}ms
                        </span>

                        {isExpanded ? <ChevronDown size={14} color="#71717a" /> : <ChevronRight size={14} color="#71717a" />}
                      </div>
                    </div>

                    {/* Expanded Drawer */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          fontSize: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        {hop.error && (
                          <div
                            style={{
                              padding: '8px 12px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              color: '#fca5a5',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '160px',
                              overflowY: 'auto'
                            }}
                          >
                            <strong>Error:</strong> {hop.error}
                          </div>
                        )}

                        {hop.details && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', fontWeight: 600 }}>
                              Diagnostics & Context
                            </span>
                            <pre
                              style={{
                                margin: 0,
                                padding: '8px 12px',
                                borderRadius: '6px',
                                backgroundColor: '#111113',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                color: '#d4d4d8',
                                fontSize: '11px',
                                overflowX: 'auto',
                                maxHeight: '140px'
                              }}
                            >
                              {JSON.stringify(hop.details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Static Scan Findings */}
          {activeTab === 'static-scan' && report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(139, 92, 246, 0.08)',
                  border: '1px solid rgba(139, 92, 246, 0.2)',
                  fontSize: '12px',
                  color: '#c4b5fd'
                }}
              >
                <strong>Static Scan Findings:</strong> {report.metadataOnlyScan.totalFindings} instances
                detected across the codebase that explicitly enforce metadata-only behavior, disable third-party
                execution, or drop non-built-in extension host registration.
              </div>

              {report.metadataOnlyScan.findings.map((item: MetadataOnlyFinding, idx: number) => (
                <div
                  key={idx}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileCode size={13} color="#a78bfa" />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f4f4f5' }}>
                        {item.file}:{item.line}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor:
                          item.category === 'EXECUTION_BLOCKED'
                            ? 'rgba(239, 68, 68, 0.2)'
                            : item.category === 'REGISTRATION_FILTER'
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(139, 92, 246, 0.2)',
                        color:
                          item.category === 'EXECUTION_BLOCKED'
                            ? '#f87171'
                            : item.category === 'REGISTRATION_FILTER'
                            ? '#fbbf24'
                            : '#c4b5fd'
                      }}
                    >
                      {item.category}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
                    {item.description}
                  </div>

                  <pre
                    style={{
                      margin: '4px 0 0 0',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      backgroundColor: '#111113',
                      border: '1px solid rgba(255, 255, 255, 0.04)',
                      color: '#e4e4e7',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      overflowX: 'auto'
                    }}
                  >
                    {item.snippet}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Tab 3: Raw JSON */}
          {activeTab === 'json' && report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleCopyJson}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: '#e4e4e7',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                  <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
                </button>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: '#111113',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#a1a1aa',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  maxHeight: '450px'
                }}
              >
                {JSON.stringify(report, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: '#141416',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#71717a'
          }}
        >
          <div>
            Trace artifact saved to: <code style={{ color: '#a78bfa' }}>docs/traces/extension-install-trace.json</code>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#d4d4d8',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
