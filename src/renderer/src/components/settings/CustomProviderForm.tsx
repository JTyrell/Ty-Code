import React, { useState } from 'react';
import {
  Server,
  Key,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Check,
  Eye,
  EyeOff,
  Globe
} from 'lucide-react';
import type { DiscoveredModel, TestConnectionResult } from '../../../../preload/types';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';

export interface CustomProviderFormProps {
  onSaveCustom: (config: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    selectedModel?: string;
  }) => Promise<boolean>;
  initialBaseUrl?: string;
  initialName?: string;
  onCancel?: () => void;
}

export const CustomProviderForm: React.FC<CustomProviderFormProps> = ({
  onSaveCustom,
  initialBaseUrl = 'http://localhost:1234/v1',
  initialName = 'LM Studio (Local)',
  onCancel
}) => {
  const [customName, setCustomName] = useState(initialName);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Validate Base URL
  const validateBaseUrl = (url: string): string | null => {
    const trimmed = url.trim();
    if (!trimmed) return 'Base URL cannot be empty.';
    try {
      new URL(trimmed);
    } catch {
      return 'Please enter a valid URL (e.g. http://localhost:1234/v1).';
    }
    if (!trimmed.endsWith('/v1') && !trimmed.endsWith('/v1/')) {
      return 'Base URL must end in /v1 (e.g. http://localhost:1234/v1).';
    }
    return null;
  };

  const handleFetchModels = async () => {
    setError('');
    setTestResult(null);

    const urlError = validateBaseUrl(baseUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    setIsFetching(true);
    try {
      // First test connection
      const testRes = await window.electronAPI.providerTestConnection({
        providerId: 'custom',
        apiKey: apiKey.trim() || undefined,
        customEndpoint: baseUrl.trim()
      });

      if (!testRes.success || !testRes.data?.success) {
        const errorMsg = testRes.data?.error || testRes.error || 'Failed to connect to custom endpoint.';
        setError(errorMsg);
        setTestResult(testRes.data || { success: false, latencyMs: 0, error: errorMsg });
        return;
      }

      setTestResult(testRes.data);

      // Fetch models
      const modelsRes = await window.electronAPI.providerGetModels({
        providerId: 'custom',
        apiKey: apiKey.trim() || undefined,
        customEndpoint: baseUrl.trim()
      });

      if (modelsRes.success && modelsRes.data && modelsRes.data.length > 0) {
        setModels(modelsRes.data);
        setSelectedModelId(modelsRes.data[0].id);
      } else {
        // Fallback default model if server doesn't return list
        const fallbackModel: DiscoveredModel = {
          id: 'default',
          name: 'Default Endpoint Model',
          provider: 'custom',
          isFree: true,
          category: 'Free'
        };
        setModels([fallbackModel]);
        setSelectedModelId(fallbackModel.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTestResult({ success: false, latencyMs: 0, error: msg });
    } finally {
      setIsFetching(false);
    }
  };

  const handleSave = async () => {
    setError('');
    const urlError = validateBaseUrl(baseUrl);
    if (urlError) {
      setError(urlError);
      return;
    }
    if (!customName.trim()) {
      setError('Please provide a name for this custom provider.');
      return;
    }

    setIsSaving(true);
    try {
      const success = await onSaveCustom({
        name: customName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        selectedModel: selectedModelId || undefined
      });

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
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '16px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={16} color="var(--accent-primary)" />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Connect Custom OpenAI-Compatible Provider
          </h4>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            Back to Registry
          </button>
        )}
      </div>

      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
        Connect to LM Studio, vLLM, LocalAI, Jan, Text-Generation-WebUI, or any OpenAI-compatible API proxy.
      </p>

      {/* Form Fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label className="settings-field-label">Custom Provider Name</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="e.g., LM Studio (Local)"
            style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
          />
        </div>

        <div>
          <label className="settings-field-label">
            Base URL <span style={{ color: 'var(--accent-amber)', fontSize: '10px' }}>(must end in /v1)</span>
          </label>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:1234/v1"
            style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
          />
        </div>
      </div>

      <div>
        <label className="settings-field-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Key size={12} /> API Key <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>(optional for local servers)</span>
        </label>
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave blank for local LM Studio / vLLM, or enter proxy key"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: '100%',
              padding: '6px 30px 6px 10px',
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
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="settings-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}

      {/* Connection result feedback */}
      {testResult && testResult.success && (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--accent-green)'
          }}
        >
          <CheckCircle2 size={14} />
          <span>Endpoint reached successfully! Ping: {testResult.latencyMs}ms. Discovered {models.length} model(s).</span>
        </div>
      )}

      {/* Fetch Models & Test Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={isFetching}
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
            cursor: isFetching ? 'wait' : 'pointer'
          }}
        >
          {isFetching ? (
            <>
              <Loader2 size={12} className="spin" />
              <span>Fetching Models…</span>
            </>
          ) : (
            <>
              <Zap size={12} color="var(--accent-primary)" />
              <span>Fetch Models &amp; Test Endpoint</span>
            </>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saveSuccess && (
            <span style={{ color: 'var(--accent-green)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={13} /> Custom provider saved!
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
            {isSaving ? 'Saving…' : 'Save & Set Active'}
          </button>
        </div>
      </div>

      {/* Model Selector for Discovered Models */}
      {models.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <ModelSelectorDropdown
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={(id) => setSelectedModelId(id)}
            providerName={customName}
          />
        </div>
      )}
    </div>
  );
};
