/**
 * OpenCode Integration Panel (Phase 6.3)
 *
 * Full UI for OpenCode synchronization:
 * 1. "OpenCode Detected" status badge with path and version
 * 2. One-click "Import OpenCode Providers" button
 * 3. Free-tier model catalog discovery breakdown
 * 4. Agent framework selector (Ty-Code Collaborative vs Ty-Code Autonomous)
 * 5. Synced provider catalog view with live status
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect } from 'react';
import {
  Code2,
  Check,
  RotateCw,
  Sparkles,
  Download,
  Server,
  Zap,
  Cpu,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  ArrowRight,
  Hammer,
  Compass
} from 'lucide-react';
import type {
  OpenCodeDetectionResult,
  OpenCodeFreeTierSummary,
  AgentFramework
} from '../../../../shared/types/opencode-sync';
import type { OpenCodeServiceStatusData, OpencodeInstallProgress } from '../../../../preload/types';

export interface OpenCodeIntegrationProps {
  onSyncComplete?: () => Promise<void>;
}

export const OpenCodeIntegration: React.FC<OpenCodeIntegrationProps> = ({
  onSyncComplete
}) => {
  const [detection, setDetection] = useState<OpenCodeDetectionResult | null>(null);
  const [freeSummary, setFreeSummary] = useState<OpenCodeFreeTierSummary | null>(null);
  const [serviceStatus, setServiceStatus] = useState<OpenCodeServiceStatusData | null>(null);
  const [isRefreshingSupply, setIsRefreshingSupply] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [agentFramework, setAgentFramework] = useState<AgentFramework>(() => {
    const stored = localStorage.getItem('ty_code_agent_framework');
    // Pre-rebrand values ('native'/'opencode') map to the Ty-Code names
    const legacy: Record<string, AgentFramework> = { native: 'collaborative', opencode: 'autonomous' };
    if (stored && stored in legacy) return legacy[stored];
    return (stored as AgentFramework) || 'collaborative';
  });
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<OpencodeInstallProgress | null>(null);
  const isInstallingCli = Boolean(installProgress && installProgress.stage !== 'done' && installProgress.stage !== 'failed');

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpencodeInstallProgress?.((progress: unknown) => {
      setInstallProgress(progress as OpencodeInstallProgress);
    });
    return () => unsubscribe?.();
  }, []);

  const handleInstallOpenCode = async () => {
    const api = window.electronAPI;
    setErrorNotice(null);
    if (!api?.opencodeInstall) {
      setErrorNotice('Installer unavailable in this build.');
      return;
    }
    setInstallProgress({ stage: 'checking', percent: 0, message: 'Starting installer...' });
    try {
      const res = await api.opencodeInstall();
      if (res.success && res.data) {
        setActionNotice(
          res.data.alreadyInstalled
            ? 'OpenCode CLI was already installed.'
            : `OpenCode CLI installed at ${res.data.cliPath || 'PATH'}`
        );
        setTimeout(() => setActionNotice(null), 6000);
        await scanOpenCode();
        await onSyncComplete?.();
      } else {
        setErrorNotice(res.error || 'OpenCode CLI installation failed.');
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallProgress(null);
    }
  };

  useEffect(() => {
    void scanOpenCode();
  }, []);

  const scanOpenCode = async () => {
    setIsScanning(true);
    setErrorNotice(null);
    try {
      if (window.electronAPI?.opencodeGetServiceStatus) {
        const statusRes = await window.electronAPI.opencodeGetServiceStatus();
        if (statusRes.success && statusRes.data) setServiceStatus(statusRes.data);
      }
      if (window.electronAPI?.opencodeDetect) {
        const res = await window.electronAPI.opencodeDetect();
        if (res.success && res.data) {
          setDetection(res.data);
        }
      }
      if (window.electronAPI?.opencodeGetFreeSummary) {
        const freeRes = await window.electronAPI.opencodeGetFreeSummary();
        if (freeRes.success && freeRes.data) {
          setFreeSummary(freeRes.data);
        }
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleRefreshStandardSupply = async () => {
    setIsRefreshingSupply(true);
    setErrorNotice(null);
    try {
      if (window.electronAPI?.opencodeRefreshStandardSupply) {
        const res = await window.electronAPI.opencodeRefreshStandardSupply();
        if (res.success && res.data) {
          setServiceStatus(res.data);
          setActionNotice(
            res.data.hostedReachable
              ? 'OpenCode standard supply verified live.'
              : 'OpenCode standard supply host unreachable right now â€” retry shortly.'
          );
          setTimeout(() => setActionNotice(null), 4000);
        } else {
          setErrorNotice(res.error || 'Failed to refresh OpenCode standard supply.');
        }
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingSupply(false);
    }
  };

  const handleImportProviders = async () => {
    setIsImporting(true);
    setErrorNotice(null);
    try {
      if (window.electronAPI?.opencodeImportProviders) {
        const res = await window.electronAPI.opencodeImportProviders();
        if (res.success && res.data) {
          setActionNotice(
            res.data.message ||
            `Successfully imported ${res.data.importedProviders.length} providers from OpenCode!`
          );
          setTimeout(() => setActionNotice(null), 4000);
          await scanOpenCode();
          if (onSyncComplete) await onSyncComplete();
        } else {
          setErrorNotice(res.error || 'Failed to import OpenCode providers.');
        }
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const handleFrameworkChange = async (framework: AgentFramework) => {
    setAgentFramework(framework);
    localStorage.setItem('ty_code_agent_framework', framework);
    if (window.electronAPI?.agentFrameworkSet) {
      await window.electronAPI.agentFrameworkSet(framework);
    }
    setActionNotice(
      framework === 'autonomous'
        ? 'Switched to Ty-Code Autonomous (Build, Plan, General agents active).'
        : 'Switched to Ty-Code Collaborative pair-programming assistant.'
    );
    setTimeout(() => setActionNotice(null), 3500);
  };

  return (
    <div
      id="opencode-integration-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        color: 'var(--text-primary)'
      }}
    >
      {/* Header Banner */}
      <div
        id="opencode-status-banner"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '16px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12) 0%, rgba(99, 102, 241, 0.08) 100%)',
          border: '1px solid rgba(6, 182, 212, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '8px',
              background: 'rgba(6, 182, 212, 0.2)',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Code2 size={24} color="var(--accent-cyan)" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
                OpenCode Framework Integration
              </h3>
              {detection?.isInstalled ? (
                <span
                  id="badge-opencode-detected"
                  style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: 'var(--accent-green)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  OpenCode Detected
                </span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    id="badge-opencode-not-detected"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'var(--surface-3)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '11px'
                    }}
                  >
                    Not Detected in ~/.config/opencode
                  </span>
                  <button
                    type="button"
                    id="btn-install-opencode"
                    disabled={isInstallingCli}
                    onClick={() => void handleInstallOpenCode()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      background: 'var(--accent-primary)',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: isInstallingCli ? 'wait' : 'pointer',
                      opacity: isInstallingCli ? 0.7 : 1
                    }}
                  >
                    <Download size={11} />
                    {isInstallingCli ? `Installing (${installProgress?.percent ?? 0}%)` : 'Install CLI for me'}
                  </button>
                  {isInstallingCli && installProgress && (
                    <div
                      style={{
                        width: '120px',
                        height: '4px',
                        borderRadius: '2px',
                        background: 'var(--surface-3)',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${installProgress.percent}%`,
                          height: '100%',
                          background: 'var(--accent-primary)',
                          transition: 'width 0.2s ease'
                        }}
                      />
                    </div>
                  )}
                  {isInstallingCli && installProgress?.message && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        maxWidth: '280px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {installProgress.message}
                    </span>
                  )}
                </div>
              )}
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              {detection?.isInstalled
                ? `Syncing from ${detection.configPath} • ${detection.providerCount} providers • ${detection.freeModelCount} free models • Zero API keys required for built-in supply`
                : 'Connect OpenCode or use the built-in free tier. Automatically imports all configured providers, Zen free supply, and zero-key coding models.'}
            </p>
          </div>
        </div>

        {/* Top actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            id="btn-rescan-opencode"
            disabled={isScanning}
            onClick={() => void scanOpenCode()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: isScanning ? 'wait' : 'pointer'
            }}
          >
            <RotateCw size={13} className={isScanning ? 'spinning' : ''} />
            {isScanning ? 'Scanning...' : 'Rescan'}
          </button>

          <button
            type="button"
            id="btn-import-opencode-providers"
            disabled={isImporting}
            onClick={handleImportProviders}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-blue) 100%)',
              border: 'none',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isImporting ? 'wait' : 'pointer',
              boxShadow: '0 4px 12px rgba(6, 182, 212, 0.3)'
            }}
          >
            <Download size={13} />
            {isImporting ? 'Importing...' : 'Import OpenCode Providers'}
          </button>
        </div>
      </div>

      {/* Standard Supply (baked-in hosted free models) */}
      <div
        id="opencode-standard-supply"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '14px 16px',
          borderRadius: '10px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <Server size={20} color="var(--accent-green)" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Standard Supply â€” Active</span>
              <span
                id="badge-opencode-supply-live"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: (serviceStatus?.hostedReachable ?? false)
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'var(--surface-2)',
                  color: (serviceStatus?.hostedReachable ?? false) ? 'var(--accent-green)' : 'var(--text-muted)',
                  border: `1px solid ${(serviceStatus?.hostedReachable ?? false) ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {(serviceStatus?.hostedReachable ?? false)
                  ? `Zen endpoint live â€¢ ${serviceStatus?.hostedLatencyMs ?? 'â€“'}ms`
                  : 'Zen endpoint unverified'}
              </span>
              <span
                id="badge-openkilo-supply-live"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: (serviceStatus?.kiloReachable ?? false)
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'var(--surface-2)',
                  color: (serviceStatus?.kiloReachable ?? false) ? 'var(--accent-green)' : 'var(--text-muted)',
                  border: `1px solid ${(serviceStatus?.kiloReachable ?? false) ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {(serviceStatus?.kiloReachable ?? false)
                  ? `Kilo gateway live â€¢ ${serviceStatus?.kiloLatencyMs ?? 'â€“'}ms`
                  : 'Kilo gateway unverified'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Zero-Key Coding Supply • Built-in & Free
              </span>
            </div>
            <p style={{ margin: '3px 0 0 0', fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              {serviceStatus
                ? `Free coding models (${serviceStatus.zenModelIds.join(', ')}) + OpenKilo gateway are always accessible without API keys or accounts. Total models in supply: ${serviceStatus.modelsInSupply}${serviceStatus.cliInstalled ? ` • Local CLI adopted (${serviceStatus.cliPath})` : ''}`
                : 'Free coding models powered by OpenCode Zen supply and OpenKilo fallback gateway are pre-configured with zero friction.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          id="opencode-supply-refresh-btn"
          disabled={isRefreshingSupply}
          onClick={() => void handleRefreshStandardSupply()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '6px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: 'var(--accent-green)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isRefreshingSupply ? 'wait' : 'pointer',
            flexShrink: 0
          }}
        >
          <RotateCw size={13} className={isRefreshingSupply ? 'spinning' : ''} />
          {isRefreshingSupply ? 'Checkingâ€¦' : 'Verify Supply'}
        </button>
      </div>

      {/* Notices */}
      {actionNotice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--accent-green)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          id="opencode-action-notice"
        >
          <CheckCircle2 size={14} />
          <span>{actionNotice}</span>
        </div>
      )}

      {errorNotice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--accent-red)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          id="opencode-error-notice"
        >
          <AlertCircle size={14} />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* AGENT FRAMEWORK SELECTOR                                     */}
      {/* ============================================================ */}
      <div
        id="agent-framework-selector-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px',
          borderRadius: '8px',
          background: 'var(--surface-3)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="var(--accent-primary)" />
            Default Coding Agent Framework
          </h4>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            Choose whether Ty-Code operates using the Collaborative pair-programming engine or the Autonomous multi-agent harness.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* Framework Option 1: Ty-Code Collaborative */}
          <div
            id="framework-option-collaborative"
            onClick={() => void handleFrameworkChange('collaborative')}
            style={{
              padding: '14px',
              borderRadius: '8px',
              border: agentFramework === 'collaborative' ? '2px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: agentFramework === 'collaborative' ? 'rgba(99, 102, 241, 0.15)' : 'var(--surface-2)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Ty-Code Collaborative</span>
              {agentFramework === 'collaborative' && <CheckCircle2 size={16} color="var(--accent-primary)" />}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Standard pair-programming experience with direct file edits, terminal integration, and Monaco smart diff reviews. You drive, Ty-Code assists.
            </p>
          </div>

          {/* Framework Option 2: Ty-Code Autonomous */}
          <div
            id="framework-option-autonomous"
            onClick={() => void handleFrameworkChange('autonomous')}
            style={{
              padding: '14px',
              borderRadius: '8px',
              border: agentFramework === 'autonomous' ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              background: agentFramework === 'autonomous' ? 'rgba(6, 182, 212, 0.15)' : 'var(--surface-2)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Ty-Code Autonomous</span>
              {agentFramework === 'autonomous' && <CheckCircle2 size={16} color="var(--accent-cyan)" />}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Autonomous 3-agent harness (Build, Plan, and General agents) equipped with 10 tools and auto-compacting context. Ty-Code drives, you review.
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* FREE TIER DETECTION BREAKDOWN                                */}
      {/* ============================================================ */}
      <div
        id="opencode-free-tier-breakdown"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px',
          borderRadius: '8px',
          background: 'var(--surface-3)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--accent-green)" />
              OpenCode Free-Tier Access &amp; Models
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Automatically discovered free model endpoints and zero-key coding models configured through OpenCode and cloud providers.
            </p>
          </div>

          {(freeSummary?.totalFreeModels || 0) > 0 ? (
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: 'var(--accent-green)',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              {freeSummary?.totalFreeModels} Free Models Synced
            </span>
          ) : (
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '12px',
                background: 'var(--surface-3)',
                color: 'var(--text-muted)',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              No Free Models Synced
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {/* Item 1: OpenRouter Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>OpenRouter Free Tier</span>
              {freeSummary?.hasOpenRouterFree ? (
                <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {freeSummary?.hasOpenRouterFree
                ? `${freeSummary.openRouterFreeModels?.length || 0} free models (Gemma 4 31B, Nemotron 3, Laguna S)`
                : 'Not detected in OpenCode config'}
            </span>
          </div>

          {/* Item 2: Groq Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Groq Free Tier</span>
              {freeSummary?.hasGroqFree ? (
                <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {freeSummary?.hasGroqFree
                ? `${freeSummary.groqFreeModels?.length || 0} models (Llama 3.3 70B Versatile, 8B Instant)`
                : 'Not detected in OpenCode config'}
            </span>
          </div>

          {/* Item 3: GitHub Copilot Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>GitHub Copilot</span>
              {freeSummary?.hasCopilotFree ? (
                <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {freeSummary?.hasCopilotFree
                ? 'Free model roster depends on your Copilot plan'
                : 'Not detected in OpenCode config'}
            </span>
          </div>

          {/* Item 4: Google AI Studio */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Google AI Studio</span>
              {freeSummary?.hasGeminiFree ? (
                <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {freeSummary?.hasGeminiFree
                ? `${freeSummary.geminiFreeModels?.length || 0} models synced from your AI Studio config`
                : 'Not detected in OpenCode config'}
            </span>
          </div>

          {/* Item 5: Local Ollama */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Local Ollama</span>
              {freeSummary?.hasOllamaLocal ? (
                <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {freeSummary?.hasOllamaLocal
                ? (freeSummary?.ollamaModels?.length || 0) > 0
                  ? `${freeSummary.ollamaModels.length} local models (localhost:11434)`
                  : 'Ollama detected, but OpenCode lists no local models yet'
                : 'Not detected in OpenCode config'}
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* CONFIGURED OPENCODE PROVIDERS LIST                           */}
      {/* ============================================================ */}
      {detection?.configuredProviders && detection.configuredProviders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Configured OpenCode Providers in Catalog
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {detection.configuredProviders.map((prov) => (
              <span
                key={prov}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '11px',
                  color: 'var(--text-secondary)'
                }}
              >
                {prov}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
