import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, Loader2, X, Eye, EyeOff } from 'lucide-react';
import { useChatStore } from '../state/chat-store';

export interface QuickConnectProviderProps {
  isOpen: boolean;
  onClose: () => void;
  initialProvider?: string;
  onSuccess?: (provider: string) => void;
}

interface ProviderOption {
  id: string;
  name: string;
  placeholder: string;
  keyHelpUrl: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    placeholder: 'sk-or-v1-...',
    keyHelpUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    placeholder: 'gsk_...',
    keyHelpUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys'
  }
];

export const QuickConnectProvider: React.FC<QuickConnectProviderProps> = ({
  isOpen,
  onClose,
  initialProvider = 'openrouter',
  onSuccess
}) => {
  const [provider, setProvider] = useState<string>(initialProvider);
  const [apiKey, setApiKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>('idle');
  const [feedback, setFeedback] = useState<string>('');

  const { saveSettings, initSettings } = useChatStore();

  useEffect(() => {
    if (initialProvider) {
      const match = PROVIDERS.find((p) => p.id === initialProvider.toLowerCase());
      if (match) setProvider(match.id);
    }
  }, [initialProvider]);

  // Load existing key if available
  useEffect(() => {
    let isMounted = true;
    if (isOpen && window.electronAPI?.getProviderKey) {
      window.electronAPI.getProviderKey(provider).then((savedKey) => {
        if (isMounted && savedKey) {
          setApiKey(savedKey);
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [provider, isOpen]);

  if (!isOpen) return null;

  const currentProviderConfig = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];

  const handleTestAndSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setStatus('error');
      setFeedback('Please enter an API key.');
      return;
    }

    setLoading(true);
    setStatus('testing');
    setFeedback('Testing connection to ' + currentProviderConfig.name + '…');

    try {
      if (window.electronAPI?.testProviderKey) {
        const testRes = await window.electronAPI.testProviderKey(provider, cleanKey);
        if (!testRes?.success) {
          setStatus('error');
          setFeedback(testRes?.message || 'Key validation failed. Please check the key.');
          setLoading(false);
          return;
        }
      }

      setStatus('saving');
      setFeedback('Key verified! Saving to safeStorage…');

      if (window.electronAPI?.saveProviderKey) {
        const saveRes = await window.electronAPI.saveProviderKey(provider, cleanKey);
        if (!saveRes?.success) {
          setStatus('error');
          setFeedback('Failed to save key into secure safeStorage.');
          setLoading(false);
          return;
        }
      }

      // Also persist to renderer chat store settings
      await saveSettings({
        activeProvider: provider as any,
        ...(cleanKey.includes('•') || cleanKey.includes('****') ? {} : { apiKeys: { [provider]: cleanKey } })
      });
      await initSettings();

      setStatus('success');
      setFeedback('Connected successfully to ' + currentProviderConfig.name + '!');

      setTimeout(() => {
        onSuccess?.(provider);
        onClose();
      }, 700);
    } catch (err: unknown) {
      setStatus('error');
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="quick-connect-title"
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'var(--bg-primary, #0f172a)',
          border: '1px solid var(--border-default, rgba(255, 255, 255, 0.15))',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary, #818cf8)'
              }}
            >
              <Key size={16} />
            </div>
            <h2 id="quick-connect-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Connect Provider
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleTestAndSave} style={{ padding: '18px' }}>
          {/* Provider Selector */}
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="quick-connect-provider-select"
              style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}
            >
              Select Provider
            </label>
            <select
              id="quick-connect-provider-select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setStatus('idle');
                setFeedback('');
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                outline: 'none'
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* API Key Input */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label
                htmlFor="quick-connect-key-input"
                style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}
              >
                API Key
              </label>
              <a
                href={currentProviderConfig.keyHelpUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(currentProviderConfig.keyHelpUrl);
                  } else {
                    window.open(currentProviderConfig.keyHelpUrl, '_blank');
                  }
                }}
                style={{ fontSize: '11px', color: 'var(--accent-primary)', textDecoration: 'none' }}
              >
                Get {currentProviderConfig.name} Key ↗
              </a>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="quick-connect-key-input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setStatus('idle');
                  setFeedback('');
                }}
                placeholder={currentProviderConfig.placeholder}
                autoFocus
                style={{
                  width: '100%',
                  padding: '9px 36px 9px 12px',
                  fontSize: '13px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex'
                }}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
              Keys are encrypted locally via OS safeStorage (Windows DPAPI).
            </p>
          </div>

          {/* Feedback Banner */}
          {feedback && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                marginBottom: '16px',
                background:
                  status === 'success'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : status === 'error'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(99, 102, 241, 0.15)',
                color:
                  status === 'success'
                    ? 'var(--accent-green)'
                    : status === 'error'
                      ? 'var(--accent-red)'
                      : 'var(--accent-primary)',
                border: `1px solid ${
                  status === 'success'
                    ? 'rgba(16, 185, 129, 0.3)'
                    : status === 'error'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'rgba(99, 102, 241, 0.3)'
                }`
              }}
            >
              {status === 'success' ? (
                <CheckCircle size={15} />
              ) : status === 'error' ? (
                <AlertCircle size={15} />
              ) : (
                <Loader2 size={15} className="animate-spin" />
              )}
              <span>{feedback}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#ffffff',
                background: status === 'success' ? 'var(--accent-green)' : 'var(--accent-primary, #6366f1)',
                border: 'none',
                borderRadius: '6px',
                cursor: loading || !apiKey.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !apiKey.trim() ? 0.6 : 1
              }}
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              <span>{loading ? 'Testing & Saving…' : status === 'success' ? 'Connected!' : 'Test & Save'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
