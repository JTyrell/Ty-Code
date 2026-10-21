import React, { useState, useEffect } from 'react';
import {
  Key,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Server,
  Zap,
  ShieldCheck,
  Check,
  Share2,
  Sparkles,
  Box,
  Copy,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Cpu
} from 'lucide-react';
import type { PreConfiguredProvider, DiscoveredModel, TestConnectionResult } from '../../../../preload/types';
import { useChatStore } from '../../state/chat-store';

export interface ProviderSetupFormProps {
  provider: PreConfiguredProvider;
  isConfigured: boolean;
  savedApiKey?: string;
  customEndpoint?: string;
  onSave: (providerId: string, apiKey: string, customEndpoint?: string) => Promise<boolean>;
  onConnectionTested?: (providerId: string, result: TestConnectionResult, models?: DiscoveredModel[]) => void;
  onSelectModel?: (modelId: string) => void;
  activeModelId?: string;
}

export const ProviderSetupForm: React.FC<ProviderSetupFormProps> = ({
  provider,
  isConfigured,
  customEndpoint: initialCustomEndpoint,
  onSave,
  onConnectionTested,
  onSelectModel,
  activeModelId
}) => {
  const providerId = provider?.id || '';
  const providerBaseUrl = provider?.baseUrl || '';
  const [apiKey, setApiKey] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState(initialCustomEndpoint || providerBaseUrl);
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Scale 1: Zero-Server OAuth & Device-Code State
  const [oauthState, setOauthState] = useState<{
    status: 'idle' | 'starting' | 'waiting_browser' | 'polling' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  const [copilotFlow, setCopilotFlow] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresAt?: number;
  } | null>(null);

  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showManualByok, setShowManualByok] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const isZeroConfig = provider?.setupType === 'zero_config';
  const isOpenRouter = providerId === 'openrouter' || providerId === 'openrouter-free';
  const isOpenKilo = providerId === 'openkilo' || providerId === 'openkilo-free';
  const isCopilot = providerId === 'github-copilot' || providerId === 'github-models';
  const hasOAuthCapability = isOpenRouter || isOpenKilo || isCopilot;

  const [localConfigured, setLocalConfigured] = useState(false);
  const effectiveIsConfigured = isConfigured || localConfigured;

  useEffect(() => {
    setApiKey('');
    setCustomEndpoint(initialCustomEndpoint || providerBaseUrl);
    setTestResult(null);
    setValidationError('');
    setSaveSuccess(false);
    setDiscoveredModels([]);
    setOauthState({ status: 'idle' });
    setCopilotFlow(null);
    setShowManualByok(!hasOAuthCapability);
    setLocalConfigured(false);
  }, [providerId, initialCustomEndpoint, providerBaseUrl, hasOAuthCapability]);

  // Listen for OAuth status change events pushed from main process
  useEffect(() => {
    if (!window.electronAPI?.onOAuthStatusChanged || !providerId) return;
    const unsub = window.electronAPI.onOAuthStatusChanged((statusMap: Record<string, any>) => {
      const pStatus = statusMap[providerId] || statusMap[providerId.replace('-free', '')];
      if (pStatus?.connected) {
        setLocalConfigured(true);
        setOauthState({ status: 'success', message: `Connected to ${provider?.name || providerId} securely!` });
        setTimeout(() => setOauthState({ status: 'idle' }), 3000);
        void useChatStore.getState().initSettings();
        void handleTestConnection(true);
      }
    });
    return () => {
      unsub();
    };
  }, [providerId, provider?.name]);

  if (!provider) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>
        No provider selected. Please select a provider from the grid above.
      </div>
    );
  }

  const handleOpenHelp = () => {
    if (provider.signupUrl && window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(provider.signupUrl);
    }
  };

  const handleTestConnection = async (forceConfigured?: boolean | React.MouseEvent) => {
    const isForced = typeof forceConfigured === 'boolean' ? forceConfigured : false;
    setValidationError('');
    setTestResult(null);
    setIsTesting(true);

    try {
      const hasKeyOrConfigured = apiKey.trim() || effectiveIsConfigured || isForced;
      if (!isZeroConfig && !hasKeyOrConfigured) {
        setValidationError('Please enter an API key before testing connection.');
        setIsTesting(false);
        return;
      }

      const res = await window.electronAPI.providerTestConnection({
        providerId: provider.id,
        apiKey: apiKey.trim() || undefined,
        customEndpoint: customEndpoint.trim() || undefined
      });

      if (!res.success || !res.data) {
        const errorMsg = res.error || 'Connection failed.';
        const result: TestConnectionResult = { success: false, latencyMs: 0, error: errorMsg };
        setTestResult(result);
        onConnectionTested?.(provider.id, result);
        return;
      }

      setTestResult(res.data);

      if (res.data.success) {
        try {
          const modelsRes = await window.electronAPI.providerGetModels({
            providerId: provider.id,
            apiKey: apiKey.trim() || undefined,
            customEndpoint: customEndpoint.trim() || undefined
          });
          if (modelsRes.success && modelsRes.data) {
            setDiscoveredModels(modelsRes.data);
            onConnectionTested?.(provider.id, res.data, modelsRes.data);
          } else {
            onConnectionTested?.(provider.id, res.data);
          }
        } catch {
          onConnectionTested?.(provider.id, res.data);
        }
      } else {
        onConnectionTested?.(provider.id, res.data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const result: TestConnectionResult = { success: false, latencyMs: 0, error: msg };
      setTestResult(result);
      onConnectionTested?.(provider.id, result);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setValidationError('');
    if (!isZeroConfig && !apiKey.trim() && !effectiveIsConfigured) {
      setValidationError('Please enter an API key.');
      return;
    }

    setIsSaving(true);
    try {
      const success = await onSave(
        provider.id,
        apiKey.trim(),
        customEndpoint.trim() !== provider.baseUrl ? customEndpoint.trim() : undefined
      );

      if (success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // =========================================================================
  // Zero-Server OAuth Action Handlers
  // =========================================================================

  const handleStartOpenRouterPKCE = async () => {
    if (!window.electronAPI?.oauthStartOpenRouterPKCE) return;
    setValidationError('');
    setOauthState({
      status: 'waiting_browser',
      message: 'Opening OpenRouter in your browser. Authorize Ty-Code in the tab that opened...'
    });

    try {
      const res = await window.electronAPI.oauthStartOpenRouterPKCE();
      if (!res.success) {
        setOauthState({ status: 'error', message: res.error || 'Failed to start OpenRouter PKCE flow.' });
      }
    } catch (err: unknown) {
      setOauthState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleStartOpenKiloOAuth = async () => {
    if (!window.electronAPI?.oauthStartOpenKilo) return;
    setValidationError('');
    setOauthState({
      status: 'waiting_browser',
      message: 'Opening OpenKilo in your browser. Complete sign-in to connect...'
    });

    try {
      const res = await window.electronAPI.oauthStartOpenKilo();
      if (!res.success) {
        setOauthState({ status: 'error', message: res.error || 'Failed to start OpenKilo OAuth.' });
      }
    } catch (err: unknown) {
      setOauthState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleEnableOpenKiloAnonymous = async () => {
    if (!window.electronAPI?.openkiloEnableAnonymous) return;
    setValidationError('');
    setOauthState({ status: 'starting', message: 'Activating OpenKilo anonymous free tier...' });

    try {
      const res = await window.electronAPI.openkiloEnableAnonymous();
      if (res.success) {
        setOauthState({ status: 'success', message: 'OpenKilo Anonymous Free Tier activated!' });
        setTimeout(() => setOauthState({ status: 'idle' }), 3000);
        void handleTestConnection();
      } else {
        setOauthState({ status: 'error', message: res.error || 'Failed to enable anonymous mode.' });
      }
    } catch (err: unknown) {
      setOauthState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleStartCopilotDeviceFlow = async () => {
    if (!window.electronAPI?.oauthStartCopilotDevice) return;
    setValidationError('');
    setOauthState({ status: 'polling', message: 'Requesting device code from GitHub...' });

    try {
      const res = await window.electronAPI.oauthStartCopilotDevice();
      if (res.success && res.data) {
        setCopilotFlow(res.data);
        if (window.electronAPI.openExternal) {
          void window.electronAPI.openExternal(res.data.verificationUri || 'https://github.com/login/device');
        }
        pollCopilot(res.data.deviceCode);
      } else {
        setOauthState({ status: 'error', message: res.error || 'Failed to request device authorization code.' });
      }
    } catch (err: unknown) {
      setOauthState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const pollCopilot = (deviceCode: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        setOauthState({ status: 'error', message: 'Device authorization code expired. Please try again.' });
        setCopilotFlow(null);
        return;
      }

      try {
        if (!window.electronAPI?.oauthPollCopilotDevice) return;
        const res = await window.electronAPI.oauthPollCopilotDevice(deviceCode);
        if (res.success && res.data) {
          if (res.data.status === 'authorized') {
            clearInterval(interval);
            setCopilotFlow(null);
            setOauthState({ status: 'success', message: 'GitHub Copilot connected and encrypted in safeStorage!' });
            setTimeout(() => setOauthState({ status: 'idle' }), 3000);
            void handleTestConnection();
          } else if (
            res.data.status === 'expired' ||
            res.data.status === 'cancelled' ||
            res.data.status === 'error'
          ) {
            clearInterval(interval);
            setCopilotFlow(null);
            setOauthState({ status: 'error', message: res.data.error || 'Device authorization cancelled.' });
          }
        }
      } catch {
        // Continue polling until timeout
      }
    }, 4000);
  };

  const handleCancelCopilot = () => {
    setCopilotFlow(null);
    setOauthState({ status: 'idle' });
    if (window.electronAPI?.oauthCancelCopilotDevice) {
      void window.electronAPI.oauthCancelCopilotDevice();
    }
  };

  const handleCopyUserCode = () => {
    if (!copilotFlow?.userCode) return;
    navigator.clipboard.writeText(copilotFlow.userCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDisconnect = async () => {
    if (!window.confirm(`Disconnect ${provider.name}? This will remove credentials from operating-system safeStorage and stop ledger attribution.`)) {
      return;
    }
    setIsDisconnecting(true);
    try {
      if (window.electronAPI?.oauthDisconnect) {
        await window.electronAPI.oauthDisconnect(provider.id);
      } else if (window.electronAPI?.byokRevokeKey) {
        await window.electronAPI.byokRevokeKey(provider.id);
      }
      setApiKey('');
      setLocalConfigured(false);
      setTestResult(null);
      setOauthState({ status: 'idle' });
      setCopilotFlow(null);
      void useChatStore.getState().initSettings();
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}
      id={`provider-setup-form-${provider.id}`}
    >
      {/* Provider Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Configure {provider.name}
            </h4>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: '10px',
                backgroundColor: effectiveIsConfigured ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-hover)',
                color: effectiveIsConfigured ? 'var(--accent-green)' : 'var(--text-muted)'
              }}
            >
              {effectiveIsConfigured ? 'Connected (Encrypted in safeStorage)' : 'Not connected'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
            {provider.notes}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {effectiveIsConfigured && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              id="btn-provider-disconnect"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: '#f87171',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                cursor: isDisconnecting ? 'wait' : 'pointer'
              }}
              title="Disconnect and revoke local safeStorage key"
            >
              <Trash2 size={11} />
              <span>{isDisconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
            </button>
          )}

          {provider.signupUrl && (
            <button
              type="button"
              onClick={handleOpenHelp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: 'var(--accent-primary)',
                backgroundColor: 'transparent',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid rgba(99, 102, 241, 0.25)'
              }}
              title={`Open ${provider.name} website in default browser`}
            >
              <span>Get Key</span>
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* Scale 1: Zero-Server One-Click OAuth / Device Flow Cards            */}
      {/* =================================================================== */}

      {/* OpenRouter PKCE Connect */}
      {isOpenRouter && (
        <div
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
          id="openrouter-pkce-connect-card"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Share2 size={16} color="#818cf8" />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                  One-Click OpenRouter Connect (PKCE)
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Authorize directly in your browser. No API key copying or pasting required.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartOpenRouterPKCE}
              disabled={oauthState.status === 'waiting_browser'}
              id="btn-openrouter-pkce-connect"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                fontSize: '11px',
                fontWeight: 600,
                backgroundColor: '#6366f1',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: oauthState.status === 'waiting_browser' ? 'wait' : 'pointer',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)'
              }}
            >
              {oauthState.status === 'waiting_browser' ? (
                <>
                  <Loader2 size={13} className="spin" />
                  <span>Waiting for browser…</span>
                </>
              ) : (
                <>
                  <Share2 size={13} />
                  <span>{effectiveIsConfigured ? 'Re-connect OpenRouter' : 'Connect OpenRouter'}</span>
                </>
              )}
            </button>
          </div>

          {oauthState.message && (
            <div style={{ fontSize: '11px', color: oauthState.status === 'error' ? '#f87171' : '#34d399' }}>
              {oauthState.message}
            </div>
          )}
        </div>
      )}

      {/* OpenKilo Anonymous & Browser OAuth */}
      {isOpenKilo && (
        <div
          style={{
            backgroundColor: 'rgba(236, 72, 153, 0.08)',
            border: '1px solid rgba(236, 72, 153, 0.25)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
          id="openkilo-connect-card"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Box size={16} color="#ec4899" />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                  OpenKilo Gateway (Free Tier &amp; OAuth)
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Instant zero-click access to 40+ free models, or browser sign-in for 350+ models.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={handleEnableOpenKiloAnonymous}
                id="btn-openkilo-enable-anonymous"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: 'rgba(34, 197, 94, 0.2)',
                  color: '#4ade80',
                  border: '1px solid rgba(34, 197, 94, 0.4)',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <Sparkles size={12} />
                <span>1-Click Anonymous</span>
              </button>

              <button
                type="button"
                onClick={handleStartOpenKiloOAuth}
                id="btn-openkilo-oauth-connect"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: '#ec4899',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <Box size={12} />
                <span>Sign in with Kilo</span>
              </button>
            </div>
          </div>

          {oauthState.message && (
            <div style={{ fontSize: '11px', color: oauthState.status === 'error' ? '#f87171' : '#34d399' }}>
              {oauthState.message}
            </div>
          )}
        </div>
      )}

      {/* GitHub Copilot Device Code Flow */}
      {isCopilot && (
        <div
          style={{
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
          id="github-copilot-connect-card"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} color="#38bdf8" />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                  GitHub Copilot Device Code Connect
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Authenticate via standard GitHub device code (RFC 8628).
                </div>
              </div>
            </div>

            {!copilotFlow && (
              <button
                type="button"
                onClick={handleStartCopilotDeviceFlow}
                id="btn-copilot-device-connect"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <Cpu size={13} />
                <span>{effectiveIsConfigured ? 'Re-connect Copilot' : 'Connect Copilot'}</span>
              </button>
            )}
          </div>

          {/* Active Device Flow Modal / Box */}
          {copilotFlow && (
            <div
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: '8px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
              id="copilot-device-prompt"
            >
              <div style={{ fontSize: '12px', color: '#f1f5f9' }}>
                Enter this code on GitHub to authorize Ty-Code:
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    fontSize: '22px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid rgba(56, 189, 248, 0.3)'
                  }}
                  id="copilot-user-code-display"
                >
                  {copilotFlow.userCode}
                </span>

                <button
                  type="button"
                  onClick={handleCopyUserCode}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '8px 12px',
                    fontSize: '11px',
                    fontWeight: 500,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: '#f1f5f9',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Copy size={12} />
                  <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (window.electronAPI?.openExternal) {
                      void window.electronAPI.openExternal(copilotFlow.verificationUri);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '8px 12px',
                    fontSize: '11px',
                    fontWeight: 500,
                    backgroundColor: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <span>Open Verification Page</span>
                  <ExternalLink size={12} />
                </button>

                <button
                  type="button"
                  onClick={handleCancelCopilot}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                  title="Cancel device code flow"
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8' }}>
                <Loader2 size={12} className="spin" />
                <span>Waiting for authorization on github.com/login/device…</span>
              </div>
            </div>
          )}

          {oauthState.message && (
            <div style={{ fontSize: '11px', color: oauthState.status === 'error' ? '#f87171' : '#34d399' }}>
              {oauthState.message}
            </div>
          )}
        </div>
      )}

      {/* Manual BYOK Toggle for OAuth-capable providers */}
      {hasOAuthCapability && (
        <button
          type="button"
          onClick={() => setShowManualByok(!showManualByok)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            padding: '2px 0',
            cursor: 'pointer'
          }}
        >
          {showManualByok ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span>{showManualByok ? 'Hide manual key entry' : 'Or enter an API key manually (BYOK fallback)'}</span>
        </button>
      )}

      {/* Zero Config Mode (Ollama) */}
      {isZeroConfig ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label className="settings-field-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Server size={12} /> Local Endpoint URL
            </label>
            <input
              type="url"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder="http://localhost:11434/v1"
              style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
            />
            <span className="settings-hint">
              Ollama requires no API key. Ensure the local Ollama background daemon is running (`ollama serve`).
            </span>
          </div>
        </div>
      ) : (
        /* Manual API Key Mode (BYOK) */
        (showManualByok || !hasOAuthCapability) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="settings-field-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Key size={12} /> {hasOAuthCapability ? 'Manual API Key (BYOK)' : 'API Key'}
              </label>
            </div>

            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  effectiveIsConfigured
                    ? '•••••••••••••••• (Stored in operating-system secure storage. Enter a new key to replace)'
                    : provider.id === 'openrouter'
                      ? 'sk-or-v1-...'
                      : provider.id === 'groq'
                        ? 'gsk_...'
                        : 'Enter your API key...'
                }
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '7px 32px 7px 10px',
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px'
                }}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>

            <div className="settings-secure-note" style={{ marginTop: '2px' }}>
              <ShieldCheck size={12} />
              <span>Saved using operating-system safeStorage (DPAPI / Keychain / Secret Service). Never sent to any Ty-Code server.</span>
            </div>
          </div>
        )
      )}

      {/* Validation or Test Feedback Alerts */}
      {validationError && (
        <div className="settings-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertCircle size={13} />
          <span>{validationError}</span>
        </div>
      )}

      {testResult && (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: testResult.success ? 'var(--accent-green)' : 'var(--accent-red)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>
              {testResult.success
                ? `Connection successful! Ping: ${testResult.latencyMs}ms ${testResult.modelsFound ? `· Found ${testResult.modelsFound} models` : ''}`
                : `Connection failed: ${testResult.error || 'Invalid API Key'}`}
            </span>
          </div>

          {testResult.success && (
            <span style={{ fontSize: '10px', opacity: 0.8 }}>Ready to use</span>
          )}
        </div>
      )}

      {/* Action Buttons: Test Connection & Save */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
        <button
          type="button"
          onClick={() => void handleTestConnection()}
          disabled={isTesting}
          id="btn-test-provider-connection"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '4px',
            backgroundColor: 'var(--bg-hover)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            cursor: isTesting ? 'wait' : 'pointer'
          }}
        >
          {isTesting ? (
            <>
              <Loader2 size={12} className="spin" />
              <span>Verifying Connection…</span>
            </>
          ) : (
            <>
              <Zap size={12} color="var(--accent-amber)" />
              <span>{isZeroConfig ? 'Ping Local Server' : 'Test Connection'}</span>
            </>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saveSuccess && (
            <span style={{ color: 'var(--accent-green)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={13} /> Saved securely
            </span>
          )}

          {(showManualByok || !hasOAuthCapability) && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="settings-save"
              id="btn-save-provider-config"
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isSaving ? 'wait' : 'pointer'
              }}
            >
              {isSaving ? 'Saving…' : 'Save Key'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
