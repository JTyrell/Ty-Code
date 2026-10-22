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
import type { OpenCodeServiceStatusData } from '../../../../preload/types';

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
              : 'OpenCode standard supply host unreachable right now — retry shortly.'
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
        color: '#f8fafc'
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
            <Code2 size={24} color="#06b6d4" />
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
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  OpenCode Detected
                </span>
              ) : (
                <span
                  id="badge-opencode-not-detected"
                  style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#94a3b8',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '11px'
                  }}
                >
                  Not Detected in ~/.config/opencode
                </span>
              )}
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
              {detection?.isInstalled
                ? `Syncing from ${detection.configPath} • ${detection.providerCount} providers • ${detection.freeModelCount} free models`
                : 'Connect OpenCode to automatically import all configured providers and free tier models.'}
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
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
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
              background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
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
          <Server size={20} color="#34d399" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Standard Supply — Active</span>
              <span
                id="badge-opencode-supply-live"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: (serviceStatus?.hostedReachable ?? false)
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: (serviceStatus?.hostedReachable ?? false) ? '#34d399' : '#94a3b8',
                  border: `1px solid ${(serviceStatus?.hostedReachable ?? false) ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {(serviceStatus?.hostedReachable ?? false)
                  ? `Zen endpoint live • ${serviceStatus?.hostedLatencyMs ?? '–'}ms`
                  : 'Zen endpoint unverified'}
              </span>
              <span
                id="badge-openkilo-supply-live"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: (serviceStatus?.kiloReachable ?? false)
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: (serviceStatus?.kiloReachable ?? false) ? '#34d399' : '#94a3b8',
                  border: `1px solid ${(serviceStatus?.kiloReachable ?? false) ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {(serviceStatus?.kiloReachable ?? false)
                  ? `Kilo gateway live • ${serviceStatus?.kiloLatencyMs ?? '–'}ms`
                  : 'Kilo gateway unverified'}
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                Always included • not optional
              </span>
            </div>
            <p style={{ margin: '3px 0 0 0', fontSize: '11.5px', color: '#94a3b8' }}>
              {serviceStatus
                ? `${serviceStatus.zenModelIds.join(', ')} + OpenKilo gateway routed through the FCC orchestration backend • models in supply: ${serviceStatus.modelsInSupply}${serviceStatus.cliInstalled ? ` • local CLI adopted (${serviceStatus.cliPath})` : ''}`
                : 'Loading standard supply status…'}
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
            color: '#34d399',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isRefreshingSupply ? 'wait' : 'pointer',
            flexShrink: 0
          }}
        >
          <RotateCw size={13} className={isRefreshingSupply ? 'spinning' : ''} />
          {isRefreshingSupply ? 'Checking…' : 'Verify Supply'}
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
            color: '#34d399',
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
            color: '#f87171',
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
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="var(--accent-primary)" />
            Default Coding Agent Framework
          </h4>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
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
              border: agentFramework === 'collaborative' ? '2px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: agentFramework === 'collaborative' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Ty-Code Collaborative</span>
              {agentFramework === 'collaborative' && <CheckCircle2 size={16} color="var(--accent-primary)" />}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
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
              border: agentFramework === 'autonomous' ? '2px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.08)',
              background: agentFramework === 'autonomous' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Ty-Code Autonomous</span>
              {agentFramework === 'autonomous' && <CheckCircle2 size={16} color="#06b6d4" />}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
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
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="#34d399" />
              OpenCode Free-Tier Access &amp; Models
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
              Automatically discovered free model endpoints configured through OpenCode.
            </p>
          </div>

          <span
            style={{
              padding: '3px 10px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            {freeSummary?.totalFreeModels || 0} Free Models Synced
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {/* Item 1: OpenRouter Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>OpenRouter Free Tier</span>
              {freeSummary?.hasOpenRouterFree ? (
                <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {freeSummary?.openRouterFreeModels?.length || 5} models (Nemotron, Gemma 4, Laguna)
            </span>
          </div>

          {/* Item 2: Groq Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Groq Free Tier</span>
              {freeSummary?.hasGroqFree ? (
                <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {freeSummary?.groqFreeModels?.length || 5} models (Llama 3.3 70B, 8B Instant)
            </span>
          </div>

          {/* Item 3: GitHub Copilot Free */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>GitHub Copilot</span>
              {freeSummary?.hasCopilotFree ? (
                <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              3 models (Claude 3.5 Sonnet, GPT-4o, o1-mini)
            </span>
          </div>

          {/* Item 4: Google AI Studio */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Google AI Studio</span>
              {freeSummary?.hasGeminiFree ? (
                <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {freeSummary?.geminiFreeModels?.length || 3} models (Gemini 2.0 Flash, 1.5 Pro)
            </span>
          </div>

          {/* Item 5: Local Ollama */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Local Ollama</span>
              {freeSummary?.hasOllamaLocal ? (
                <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Active</span>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px' }}>Inactive</span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {freeSummary?.ollamaModels?.length || 0} local models (localhost:11434)
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* CONFIGURED OPENCODE PROVIDERS LIST                           */}
      {/* ============================================================ */}
      {detection?.configuredProviders && detection.configuredProviders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            Configured OpenCode Providers in Catalog
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {detection.configuredProviders.map((prov) => (
              <span
                key={prov}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  fontSize: '11px',
                  color: '#cbd5e1'
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
