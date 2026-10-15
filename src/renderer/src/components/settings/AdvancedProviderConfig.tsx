/**
 * Advanced Provider Manual Configuration (Phase 6.2)
 *
 * Direct control for power users:
 * 1. JSON config editor for custom providers with validation
 * 2. Base URL override for self-hosted models (Ollama, LM Studio, vLLM, LocalAI)
 * 3. Custom headers and authentication
 * 4. Model list override
 * 5. Import / export provider configs (JSON)
 *
 * Brand: Ty-Code
 */

import React, { useState } from 'react';
import {
  Code2,
  Download,
  Upload,
  Check,
  AlertCircle,
  Copy,
  Server,
  Save,
  RotateCw,
  Sparkles,
  Lock
} from 'lucide-react';
import type { CustomProviderConfig } from '../../../../shared/types/byok';

export interface AdvancedProviderConfigProps {
  initialConfig?: Partial<CustomProviderConfig>;
  onSaveConfig: (config: CustomProviderConfig) => Promise<boolean>;
  onBack?: () => void;
}

const DEFAULT_SAMPLE_CONFIG: CustomProviderConfig = {
  id: 'custom-local-vllm',
  name: 'Local vLLM / Ollama Server',
  baseUrl: 'http://localhost:8000/v1',
  apiKey: '',
  authHeader: 'Authorization: Bearer <token>',
  customHeaders: {
    'X-Custom-Client': 'Ty-Code'
  },
  models: [
    'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct',
    'meta-llama/Meta-Llama-3.1-8B-Instruct'
  ],
  defaultModel: 'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct',
  notes: 'High-throughput self-hosted inference server'
};

export const AdvancedProviderConfig: React.FC<AdvancedProviderConfigProps> = ({
  initialConfig,
  onSaveConfig,
  onBack
}) => {
  const [jsonText, setJsonText] = useState<string>(() => {
    const merged = { ...DEFAULT_SAMPLE_CONFIG, ...initialConfig };
    return JSON.stringify(merged, null, 2);
  });
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Validate JSON on change
  const handleJsonChange = (val: string) => {
    setJsonText(val);
    setSaveSuccess(false);
    try {
      const parsed = JSON.parse(val);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setSyntaxError('Config must be a valid JSON object.');
        return;
      }
      if (!parsed.name || typeof parsed.name !== 'string') {
        setSyntaxError('Configuration must include a valid "name" field.');
        return;
      }
      if (!parsed.baseUrl || typeof parsed.baseUrl !== 'string') {
        setSyntaxError('Configuration must include a valid "baseUrl" field.');
        return;
      }
      setSyntaxError(null);
    } catch (err: unknown) {
      setSyntaxError(err instanceof Error ? err.message : 'Invalid JSON format');
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setSyntaxError(null);
    } catch {
      // Ignore format if parse fails
    }
  };

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImportFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleJsonChange(content);
      }
    };
    reader.readAsText(file);
  };

  const handleExportToFile = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ty-code-provider-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (syntaxError) return;
    setIsSaving(true);
    try {
      const parsed = JSON.parse(jsonText) as CustomProviderConfig;
      const success = await onSaveConfig(parsed);
      if (success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err: unknown) {
      setSyntaxError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="advanced-provider-config-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        background: 'rgba(15, 23, 42, 0.75)',
        borderRadius: '10px',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code2 size={16} color="var(--accent-primary)" />
            Advanced Provider JSON Configuration
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
            Define custom endpoints, custom auth headers, base URL overrides, and custom model lists directly.
          </p>
        </div>

        {/* Import/Export buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <label
            htmlFor="upload-json-file"
            id="label-upload-json"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <Upload size={13} />
            Import JSON
            <input
              id="upload-json-file"
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportFromFile}
            />
          </label>

          <button
            type="button"
            id="btn-export-json"
            onClick={handleExportToFile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <Download size={13} />
            Export JSON
          </button>

          <button
            type="button"
            id="btn-copy-json"
            onClick={handleCopyJson}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            {copied ? <Check size={13} color="#34d399" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Editor Area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Configuration Schema (JSON)</span>
          <button
            type="button"
            id="btn-format-json"
            onClick={handleFormatJson}
            style={{
              background: 'none',
              border: 'none',
              color: '#818cf8',
              fontSize: '11px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Format / Prettify
          </button>
        </div>

        <textarea
          id="textarea-custom-provider-json"
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={14}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: syntaxError ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
            background: '#090d16',
            color: '#f8fafc',
            fontFamily: 'Consolas, Monaco, monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            resize: 'vertical'
          }}
        />

        {syntaxError ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171', fontSize: '11px' }}>
            <AlertCircle size={13} />
            <span>Syntax Error: {syntaxError}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399', fontSize: '11px' }}>
            <Check size={13} />
            <span>JSON schema valid and ready to apply</span>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
        {onBack ? (
          <button
            type="button"
            id="btn-back-from-advanced"
            onClick={onBack}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Back to Providers
          </button>
        ) : <div />}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {saveSuccess && (
            <span style={{ color: '#34d399', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={14} />
              Config Saved!
            </span>
          )}

          <button
            type="button"
            id="btn-save-advanced-config"
            disabled={Boolean(syntaxError) || isSaving}
            onClick={handleSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
              borderRadius: '6px',
              background: syntaxError ? 'rgba(255, 255, 255, 0.1)' : 'var(--accent-primary)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '12px',
              cursor: syntaxError ? 'not-allowed' : 'pointer'
            }}
          >
            <Save size={14} />
            {isSaving ? 'Saving...' : 'Apply & Save Config'}
          </button>
        </div>
      </div>
    </div>
  );
};
