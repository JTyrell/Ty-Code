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
  Check
} from 'lucide-react';
import type { PreConfiguredProvider, DiscoveredModel, TestConnectionResult } from '../../../../preload/types';

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
  const [apiKey, setApiKey] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState(initialCustomEndpoint || provider.baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState('');

  const isZeroConfig = provider.setupType === 'zero_config';

  useEffect(() => {
    setApiKey('');
    setCustomEndpoint(initialCustomEndpoint || provider.baseUrl);
    setTestResult(null);
    setValidationError('');
    setSaveSuccess(false);
    setDiscoveredModels([]);
  }, [provider.id, initialCustomEndpoint]);

  const handleOpenHelp = () => {
    if (provider.signupUrl && window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(provider.signupUrl);
    }
  };

  const handleTestConnection = async () => {
    setValidationError('');
    setTestResult(null);
    setIsTesting(true);

    try {
      if (!isZeroConfig && !apiKey.trim() && !isConfigured) {
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
        // Automatically fetch and discover available models on successful connection
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
    if (!isZeroConfig && !apiKey.trim() && !isConfigured) {
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
                backgroundColor: isConfigured ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-hover)',
                color: isConfigured ? 'var(--accent-green)' : 'var(--text-muted)'
              }}
            >
              {isConfigured ? 'Configured in operating-system storage' : 'Not yet configured'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
            {provider.notes}
          </p>
        </div>

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
            <span>Help me get a key</span>
            <ExternalLink size={12} />
          </button>
        )}
      </div>

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
        /* API Key Mode */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="settings-field-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Key size={12} /> API Key
            </label>
            {provider.signupUrl && (
              <button
                type="button"
                onClick={handleOpenHelp}
                style={{
                  fontSize: '10px',
                  color: 'var(--accent-primary)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                Get API Key <ExternalLink size={10} />
              </button>
            )}
          </div>

          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                isConfigured
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
            <span>Saved using the operating-system credential store. If secure storage is unavailable, Ty-Code refuses to save the key.</span>
          </div>
        </div>
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
            <span style={{ fontSize: '10px', opacity: 0.8 }}>Ready to save</span>
          )}
        </div>
      )}

      {/* Action Buttons: Test Connection & Save */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={isTesting}
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

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="settings-save"
            style={{
              padding: '6px 16px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: isSaving ? 'wait' : 'pointer'
            }}
          >
            {isSaving ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};
