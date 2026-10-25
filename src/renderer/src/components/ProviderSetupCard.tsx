/**
 * RealConnect 3: Inline Provider Setup Card
 *
 * Rendered inline in ChatSidecar when a CONFIG_MISSING error occurs.
 * Features:
 * - Header: '🔑 Connect Provider: {provider_name}'
 * - Subheader: 'Model: {model_id}'
 * - Password input with visibility toggle & Clipboard Paste button
 * - Save button: verifies key with live Test Connection before calling safeStorage credentials:save
 * - Auto-retries original prompt on successful connection
 * - Info link: 'Don't have a key? Get one free at {provider_signup_url}'
 * - Alternative provider switcher (Groq Free, Ollama Local, OpenRouter Free)
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect } from 'react';
import {
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Clipboard,
  RefreshCw,
  Zap,
  Server,
  Sparkles,
  ArrowRight,
  Check,
  X
} from 'lucide-react';
import type { ChatErrorCard } from '../../../preload/types';
import { useChatStore } from '../state/chat-store';
import { toast } from '../state/toast-store';

export interface ProviderSetupCardProps {
  errorCard: ChatErrorCard;
  onRetry?: () => void;
  onDismiss?: () => void;
}

interface ProviderMeta {
  id: string;
  name: string;
  signupUrl: string;
  defaultModel: string;
  isFree?: boolean;
}

const PROVIDER_METAS: Record<string, ProviderMeta> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter Free',
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    isFree: true
  },
  groq: {
    id: 'groq',
    name: 'Groq Free Tier',
    signupUrl: 'https://console.groq.com/keys',
    defaultModel: 'openai/gpt-oss-120b',
    isFree: true
  },
  'google-ai-studio': {
    id: 'google-ai-studio',
    name: 'Google AI Studio',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-2.0-flash',
    isFree: true
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-sonnet-20241022'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    signupUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama Local',
    signupUrl: 'http://localhost:11434',
    defaultModel: 'qwen2.5-coder',
    isFree: true
  },
  openkilo: {
    id: 'openkilo-free',
    name: 'OpenKilo Free (Zero-Key)',
    signupUrl: 'https://openkilo.com',
    defaultModel: 'kilo-auto/free',
    isFree: true
  },
  'openkilo-free': {
    id: 'openkilo-free',
    name: 'OpenKilo Free (Zero-Key)',
    signupUrl: 'https://openkilo.com',
    defaultModel: 'kilo-auto/free',
    isFree: true
  }
};

export const ProviderSetupCard: React.FC<ProviderSetupCardProps> = ({
  errorCard,
  onRetry,
  onDismiss
}) => {
  const { settings, saveSettings } = useChatStore();

  const initialProviderId = errorCard.providerId || settings?.activeProvider || 'openrouter';
  const [providerId, setProviderId] = useState<string>(initialProviderId);
  const [apiKey, setApiKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState<boolean>(false);

  const meta = PROVIDER_METAS[providerId] || {
    id: providerId,
    name: providerId.toUpperCase(),
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: `${providerId}-default`
  };

  const activeModel = settings?.activeModel || meta.defaultModel;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKey(text.trim());
        setErrorMessage(null);
      }
    } catch {
      // Clipboard access denied
    }
  };

  const handleOpenSignupUrl = () => {
    const url = errorCard.actionUrl || meta.signupUrl;
    if (window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleAutoDetect = async () => {
    setIsAutoDetecting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (window.electronAPI?.credentialsAutoDetect) {
        const res = await window.electronAPI.credentialsAutoDetect();
        if (res.success && res.data && res.data.importedCount > 0) {
          const names = res.data.importedProviders.join(', ');
          setSuccessMessage(`Auto-detected & connected ${res.data.importedCount} provider key(s): ${names}! Retrying...`);
          toast.success(`Discovered ${res.data.importedCount} API key(s) from system`);
          if (onRetry) {
            window.setTimeout(() => {
              setIsClosed(true);
              onDismiss?.();
              onRetry();
            }, 800);
          }
          return;
        }
      }
      setErrorMessage('No API keys found in environment variables or configs. Switch to OpenKilo (Zero-Key) below or paste a key.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleSaveAndConnect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!apiKey.trim()) {
      setErrorMessage(`Please enter your ${meta.name} API key.`);
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsTesting(true);

    try {
      // 1. Live Test Connection with 1 token before saving
      let testResult: { success: boolean; data?: any; error?: string } = { success: true };
      if (window.electronAPI?.credentialsTest) {
        testResult = await window.electronAPI.credentialsTest(
          providerId,
          apiKey.trim(),
          activeModel
        );
      }

      if (!testResult.success) {
        setErrorMessage(testResult.error || `Failed to authenticate ${meta.name} key.`);
        setIsTesting(false);
        return; // Don't save key, keep card open
      }

      // 2. Encrypt and save via safeStorage credentials:save
      setIsSaving(true);
      if (window.electronAPI?.credentialsSave) {
        await window.electronAPI.credentialsSave(
          providerId,
          apiKey.trim(),
          `${meta.name} Key`
        );
      }

      // 3. Update chat settings
      await saveSettings({
        activeProvider: providerId as any,
        activeModel: activeModel
      });

      setSuccessMessage(`Verified & encrypted! Retrying prompt...`);
      toast.success(`Connected to ${meta.name}`);

      // 4. Close card, show success toast, auto-retry the failed prompt
      if (onRetry) {
        window.setTimeout(() => {
          setIsClosed(true);
          onDismiss?.();
          onRetry();
        }, 600);
      } else {
        window.setTimeout(() => {
          setIsClosed(true);
          onDismiss?.();
        }, 1200);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
      setIsSaving(false);
    }
  };

  const handleSwitchAlternative = async (altId: string) => {
    const altMeta = PROVIDER_METAS[altId];
    if (!altMeta) return;

    setProviderId(altId);
    setApiKey('');
    setErrorMessage(null);
    setSuccessMessage(null);

    // If switching to OpenKilo (zero-key required), connect instantly
    if (altId === 'openkilo' || altId === 'openkilo-free') {
      setIsTesting(true);
      try {
        await saveSettings({
          activeProvider: 'openkilo-free' as any,
          activeModel: 'qwen/qwen3-coder:free'
        });
        toast.success('Switched to OpenKilo Free (Zero-Key Required)');
        setIsClosed(true);
        onDismiss?.();
        if (onRetry) onRetry();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTesting(false);
      }
      return;
    }

    // If switching to Ollama local, test it directly and auto-retry if available
    if (altId === 'ollama') {
      setIsTesting(true);
      try {
        if (window.electronAPI?.credentialsTest) {
          const res = await window.electronAPI.credentialsTest('ollama', '', 'qwen2.5-coder');
          if (res.success) {
            await saveSettings({
              activeProvider: 'ollama',
              activeModel: 'qwen2.5-coder'
            });
            toast.success('Switched to Ollama Local');
            setIsClosed(true);
            onDismiss?.();
            if (onRetry) onRetry();
            return;
          } else {
            setErrorMessage('Ollama is not running at http://localhost:11434. Start with "ollama serve".');
          }
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTesting(false);
      }
    }
  };

  if (isClosed) return null;

  return (
    <div
      className="provider-setup-card"
      style={{
        margin: '12px 0',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '1.5px solid rgba(56, 189, 248, 0.45)',
        borderRadius: '12px',
        padding: '16px 20px',
        boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.7), 0 0 20px rgba(56, 189, 248, 0.15)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit'
      }}
      role="alert"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🔑</span>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Connect Provider: {meta.name}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--accent-cyan)',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontWeight: 500
            }}
          >
            CONFIG_MISSING
          </span>
          <button
            type="button"
            onClick={() => {
              setIsClosed(true);
              onDismiss?.();
            }}
            title="Dismiss"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Subheader */}
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Model: <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{activeModel}</span>
      </div>

      {/* Auto-detect prompt banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          border: '1px dashed rgba(56, 189, 248, 0.35)',
          borderRadius: '8px',
          padding: '8px 12px',
          marginBottom: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <Zap size={14} color="#38bdf8" />
          <span>Have keys in your environment or configs?</span>
        </div>
        <button
          type="button"
          disabled={isAutoDetecting}
          onClick={handleAutoDetect}
          style={{
            padding: '5px 12px',
            backgroundColor: isAutoDetecting ? 'var(--accent-cyan)' : 'var(--accent-cyan)',
            border: 'none',
            borderRadius: '5px',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 600,
            cursor: isAutoDetecting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)'
          }}
        >
          {isAutoDetecting ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
          <span>{isAutoDetecting ? 'Scanning...' : 'Auto-Detect Keys'}</span>
        </button>
      </div>

      {/* API Key Form */}
      <form onSubmit={handleSaveAndConnect} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setErrorMessage(null);
            }}
            placeholder={`Paste ${meta.name} API key...`}
            autoFocus
            style={{
              width: '100%',
              padding: '10px 76px 10px 12px',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              border: errorMessage ? '1px solid #ef4444' : '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontFamily: 'monospace',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />

          <div style={{ position: 'absolute', right: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={handlePaste}
              title="Paste from clipboard"
              style={{
                background: 'rgba(51, 65, 85, 0.7)',
                border: 'none',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                padding: '4px 6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '11px'
              }}
            >
              <Clipboard size={12} />
              <span>Paste</span>
            </button>
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              title={showKey ? 'Hide key' : 'Show key'}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                padding: '4px',
                cursor: 'pointer'
              }}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Error or Success feedback */}
        {errorMessage && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: 'var(--accent-red)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <AlertCircle size={14} flex-shrink="0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            style={{
              backgroundColor: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.4)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: 'var(--accent-green)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <CheckCircle2 size={14} flex-shrink="0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Action Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
          <button
            type="button"
            onClick={handleOpenSignupUrl}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-cyan)',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 0',
              textDecoration: 'underline'
            }}
          >
            <span>Don't have a key? Get one free at {new URL(meta.signupUrl).hostname}</span>
            <ExternalLink size={12} />
          </button>

          <button
            type="submit"
            disabled={!apiKey.trim() || isTesting || isSaving}
            style={{
              padding: '8px 16px',
              backgroundColor: isSaving || successMessage ? 'var(--accent-green)' : 'var(--accent-cyan)',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: !apiKey.trim() || isTesting || isSaving ? 'not-allowed' : 'pointer',
              opacity: !apiKey.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isTesting ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Testing Connection...</span>
              </>
            ) : isSaving ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Encrypting Key...</span>
              </>
            ) : successMessage ? (
              <>
                <Check size={13} />
                <span>Retrying...</span>
              </>
            ) : (
              <>
                <Key size={13} />
                <span>Save & Retry</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Alternative Free Providers */}
      <div
        style={{
          marginTop: '14px',
          paddingTop: '12px',
          borderTop: '1px solid rgba(51, 65, 85, 0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Or switch to free alternative:</span>
        <button
          type="button"
          onClick={() => handleSwitchAlternative('openkilo')}
          style={{
            padding: '4px 8px',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '4px',
            color: 'var(--accent-cyan)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Sparkles size={11} color="#38bdf8" />
          <span>OpenKilo Free (Zero-Key)</span>
        </button>
        {providerId !== 'groq' && (
          <button
            type="button"
            onClick={() => handleSwitchAlternative('groq')}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(51, 65, 85, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Zap size={11} color="#f59e0b" />
            <span>Groq Free</span>
          </button>
        )}
        {providerId !== 'ollama' && (
          <button
            type="button"
            onClick={() => handleSwitchAlternative('ollama')}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(51, 65, 85, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Server size={11} color="#4ade80" />
            <span>Ollama Local</span>
          </button>
        )}
        {providerId !== 'openrouter' && (
          <button
            type="button"
            onClick={() => handleSwitchAlternative('openrouter')}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(51, 65, 85, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Sparkles size={11} color="#38bdf8" />
            <span>OpenRouter Free</span>
          </button>
        )}
      </div>
    </div>
  );
};
