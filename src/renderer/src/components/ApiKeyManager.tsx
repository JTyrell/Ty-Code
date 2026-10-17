import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, XCircle, Loader2, Save, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';

const GithubIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

interface ProviderConfig {
  id: string;
  name: string;
  placeholder: string;
  signupUrl: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    placeholder: 'sk-or-v1-...',
    signupUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    placeholder: 'gsk_...',
    signupUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    signupUrl: 'https://console.anthropic.com/settings/keys'
  }
];

type KeyStatus = 'Not Tested' | 'Testing...' | 'Valid' | 'Invalid';

export const ApiKeyManager: React.FC = () => {
  const [keys, setKeys] = useState<Record<string, string>>({
    openrouter: '',
    groq: '',
    anthropic: ''
  });

  const [statuses, setStatuses] = useState<Record<string, KeyStatus>>({
    openrouter: 'Not Tested',
    groq: 'Not Tested',
    anthropic: 'Not Tested'
  });

  const [messages, setMessages] = useState<Record<string, string>>({});
  const [savedSuccess, setSavedSuccess] = useState<Record<string, boolean>>({});

  // Copilot Subscription State
  const [copilotConnected, setCopilotConnected] = useState<boolean>(false);
  const [copilotDeviceFlow, setCopilotDeviceFlow] = useState<{
    user_code: string;
    verification_uri: string;
    device_code: string;
  } | null>(null);
  const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
  const [copilotPolling, setCopilotPolling] = useState<boolean>(false);
  const [copilotMessage, setCopilotMessage] = useState<string>('');

  useEffect(() => {
    PROVIDERS.forEach(async (provider) => {
      try {
        if (window.electronAPI?.getProviderKey) {
          const saved = await window.electronAPI.getProviderKey(provider.id);
          if (saved) {
            setKeys((prev) => ({ ...prev, [provider.id]: saved }));
            setStatuses((prev) => ({ ...prev, [provider.id]: 'Valid' }));
            setMessages((prev) => ({ ...prev, [provider.id]: 'Loaded from safeStorage' }));
          }
        }
      } catch (err) {
        console.error(`Failed loading key for ${provider.id}:`, err);
      }
    });

    // Check existing Copilot subscription token in safeStorage
    (async () => {
      try {
        if (window.electronAPI?.getProviderKey) {
          const token = await window.electronAPI.getProviderKey('copilot');
          if (token) {
            setCopilotConnected(true);
          }
        }
      } catch {}
    })();
  }, []);

  const handleTestKey = async (providerId: string) => {
    const key = keys[providerId]?.trim();
    if (!key) {
      setStatuses((prev) => ({ ...prev, [providerId]: 'Invalid' }));
      setMessages((prev) => ({ ...prev, [providerId]: 'Please enter an API key first' }));
      return;
    }

    setStatuses((prev) => ({ ...prev, [providerId]: 'Testing...' }));
    setMessages((prev) => ({ ...prev, [providerId]: '' }));
    setSavedSuccess((prev) => ({ ...prev, [providerId]: false }));

    try {
      if (!window.electronAPI?.testProviderKey) {
        throw new Error('IPC handler testProviderKey not available');
      }

      const result = await window.electronAPI.testProviderKey(providerId, key);
      if (result.success) {
        setStatuses((prev) => ({ ...prev, [providerId]: 'Valid' }));
        setMessages((prev) => ({ ...prev, [providerId]: result.message || 'Key is valid' }));
      } else {
        setStatuses((prev) => ({ ...prev, [providerId]: 'Invalid' }));
        setMessages((prev) => ({ ...prev, [providerId]: result.message || 'Invalid key or network error' }));
      }
    } catch (err: any) {
      setStatuses((prev) => ({ ...prev, [providerId]: 'Invalid' }));
      setMessages((prev) => ({ ...prev, [providerId]: err?.message || 'Connection failed' }));
    }
  };

  const handleSaveKey = async (providerId: string) => {
    const key = keys[providerId]?.trim();
    if (!key || statuses[providerId] !== 'Valid') {
      return;
    }

    try {
      if (!window.electronAPI?.saveProviderKey) {
        throw new Error('IPC handler saveProviderKey not available');
      }

      await window.electronAPI.saveProviderKey(providerId, key);
      setSavedSuccess((prev) => ({ ...prev, [providerId]: true }));
      setMessages((prev) => ({ ...prev, [providerId]: 'Key securely encrypted in credentials.enc' }));
      setTimeout(() => {
        setSavedSuccess((prev) => ({ ...prev, [providerId]: false }));
      }, 3000);
    } catch (err: any) {
      setMessages((prev) => ({ ...prev, [providerId]: `Save failed: ${err?.message || err}` }));
    }
  };

  const handleConnectCopilot = async () => {
    setCopilotLoading(true);
    setCopilotMessage('');
    try {
      if (!window.electronAPI?.initiateCopilotDeviceFlow) {
        throw new Error('Copilot device flow IPC handler not available');
      }

      const res = await window.electronAPI.initiateCopilotDeviceFlow();
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to initiate device flow');
      }

      setCopilotDeviceFlow({
        user_code: res.data.user_code,
        verification_uri: res.data.verification_uri,
        device_code: res.data.device_code
      });
      setCopilotLoading(false);
      setCopilotPolling(true);

      // Open verification URL
      try {
        if (window.electronAPI?.openExternal) {
          await window.electronAPI.openExternal(res.data.verification_uri);
        } else {
          window.open(res.data.verification_uri, '_blank');
        }
      } catch {}

      // Poll until authenticated
      if (window.electronAPI?.pollCopilotToken) {
        const pollRes = await window.electronAPI.pollCopilotToken(res.data.device_code);
        if (pollRes.success) {
          setCopilotConnected(true);
          setCopilotPolling(false);
          setCopilotDeviceFlow(null);
          setCopilotMessage('Copilot Connected');
        } else {
          setCopilotPolling(false);
          setCopilotMessage(pollRes.error || 'Authentication timed out or failed');
        }
      }
    } catch (err: any) {
      setCopilotLoading(false);
      setCopilotPolling(false);
      setCopilotMessage(err?.message || 'Connection failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Notice */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          borderRadius: 8,
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)'
        }}
      >
        <ShieldCheck size={20} color="#3b82f6" />
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          <strong>Secure Hardware Vault:</strong> All keys and subscription tokens are encrypted via Electron{' '}
          <code style={{ color: 'var(--accent-primary)' }}>safeStorage</code> and sealed into{' '}
          <code>credentials.enc</code>. Plaintext files are never created.
        </div>
      </div>

      {/* Provider API Key Cards */}
      {PROVIDERS.map((provider) => {
        const status = statuses[provider.id] || 'Not Tested';
        const isTesting = status === 'Testing...';
        const canSave = status === 'Valid';
        const isSaved = savedSuccess[provider.id];

        return (
          <div
            key={provider.id}
            style={{
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={16} color="var(--text-muted)" />
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                  {provider.name}
                </span>
                <a
                  href={provider.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 11,
                    color: 'var(--accent-primary)',
                    textDecoration: 'none'
                  }}
                >
                  <span>Get Key</span>
                  <ExternalLink size={10} />
                </a>
              </div>

              {/* Status Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 8px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  background:
                    status === 'Valid'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : status === 'Invalid'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : status === 'Testing...'
                      ? 'rgba(59, 130, 246, 0.15)'
                      : 'rgba(255, 255, 255, 0.05)',
                  color:
                    status === 'Valid'
                      ? '#10b981'
                      : status === 'Invalid'
                      ? '#ef4444'
                      : status === 'Testing...'
                      ? '#3b82f6'
                      : 'var(--text-muted)',
                  border: `1px solid ${
                    status === 'Valid'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : status === 'Invalid'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : status === 'Testing...'
                      ? 'rgba(59, 130, 246, 0.3)'
                      : 'rgba(255, 255, 255, 0.1)'
                  }`
                }}
              >
                {status === 'Testing...' ? <Loader2 size={12} className="animate-spin" /> : null}
                {status === 'Valid' ? <CheckCircle size={12} /> : null}
                {status === 'Invalid' ? <XCircle size={12} /> : null}
                <span>{status}</span>
              </div>
            </div>

            {/* Input Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="password"
                value={keys[provider.id] || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setKeys((prev) => ({ ...prev, [provider.id]: val }));
                  setStatuses((prev) => ({ ...prev, [provider.id]: 'Not Tested' }));
                  setMessages((prev) => ({ ...prev, [provider.id]: '' }));
                }}
                placeholder={provider.placeholder}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, monospace)'
                }}
              />

              <button
                type="button"
                onClick={() => void handleTestKey(provider.id)}
                disabled={isTesting || !keys[provider.id]?.trim()}
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: isTesting ? 'rgba(255,255,255,0.05)' : 'var(--bg-hover)',
                  color: 'var(--text-primary)',
                  cursor: isTesting || !keys[provider.id]?.trim() ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap'
                }}
              >
                {isTesting ? <Loader2 size={13} className="animate-spin" /> : null}
                <span>Test Connection</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveKey(provider.id)}
                disabled={!canSave}
                title={canSave ? 'Save key to secure storage' : 'Test connection first to enable saving'}
                style={{
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  background: canSave ? (isSaved ? '#059669' : 'var(--accent-primary)') : 'rgba(255,255,255,0.08)',
                  color: canSave ? '#ffffff' : 'var(--text-muted)',
                  cursor: canSave ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                  transition: 'background 0.2s'
                }}
              >
                <Save size={13} />
                <span>{isSaved ? 'Saved!' : 'Save'}</span>
              </button>
            </div>

            {messages[provider.id] ? (
              <div
                style={{
                  fontSize: 11,
                  color: status === 'Valid' ? '#10b981' : status === 'Invalid' ? '#ef4444' : 'var(--text-muted)',
                  wordBreak: 'break-word'
                }}
              >
                {messages[provider.id]}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Connect Existing Subscriptions Section (FCC-2) */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)'
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <h4
            style={{
              margin: '0 0 4px 0',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Sparkles size={16} color="var(--accent-primary)" />
            <span>Connect Existing Subscriptions</span>
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--text-muted)'
            }}
          >
            Reuse your existing GitHub Copilot subscription without incurring extra model fees.
          </p>
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 6,
                  background: 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <GithubIcon size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  GitHub Copilot
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Official RFC 8628 Device Flow &bull; Encrypted in safeStorage
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {copilotConnected ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#10b981',
                    fontSize: 12,
                    fontWeight: 600
                  }}
                >
                  <CheckCircle size={14} />
                  <span>Copilot Connected</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnectCopilot()}
                  disabled={copilotLoading || copilotPolling}
                  style={{
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--accent-primary)',
                    color: '#ffffff',
                    cursor: copilotLoading || copilotPolling ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {copilotLoading || copilotPolling ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <GithubIcon size={13} />
                  )}
                  <span>{copilotPolling ? 'Waiting for authentication...' : 'Connect GitHub Copilot'}</span>
                </button>
              )}
            </div>
          </div>

          {copilotDeviceFlow && (
            <div
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 6,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Please enter this one-time code on GitHub to authenticate:
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap'
                }}
              >
                <code
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 2,
                    padding: '6px 14px',
                    borderRadius: 6,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--accent-primary)',
                    fontFamily: 'monospace'
                  }}
                >
                  {copilotDeviceFlow.user_code}
                </code>

                <a
                  href={copilotDeviceFlow.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(copilotDeviceFlow.verification_uri);
                    } else {
                      window.open(copilotDeviceFlow.verification_uri, '_blank');
                    }
                  }}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--accent-primary)',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <span>Open {copilotDeviceFlow.verification_uri}</span>
                  <ExternalLink size={12} />
                </a>
              </div>

              {copilotPolling && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 4
                  }}
                >
                  <Loader2 size={13} className="animate-spin" />
                  <span>Waiting for authentication in your browser...</span>
                </div>
              )}
            </div>
          )}

          {copilotMessage && !copilotDeviceFlow && (
            <div
              style={{
                fontSize: 12,
                color: copilotConnected ? '#10b981' : '#ef4444'
              }}
            >
              {copilotMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
