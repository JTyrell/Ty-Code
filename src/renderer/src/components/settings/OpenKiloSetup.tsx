import React, { useState, useEffect } from 'react';
import {
  Zap,
  ShieldCheck,
  Check,
  RefreshCw,
  ExternalLink,
  Key,
  Globe,
  Sparkles,
  Layers,
  Cpu,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import type { DiscoveredModel, OpenKiloStatus, TestConnectionResult } from '../../../../preload/types';

interface PriorityModelInfo {
  id: string;
  name: string;
  context: string;
  task: string;
  score: number;
  desc: string;
}

const PRIORITY_MODELS: PriorityModelInfo[] = [
  {
    id: 'kilo-auto/free',
    name: 'Kilo Auto Router',
    context: '256K context',
    task: 'Smart Auto-Routing',
    score: 92,
    desc: 'Zero-cost router that picks the best live free model for every request.'
  },
  {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S 2.1',
    context: '262K context',
    task: 'Autonomous Coding',
    score: 95,
    desc: 'Frontier code model excelling at full-repository refactoring.'
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA Nemotron 3.5 Super VL',
    context: '1M context',
    task: 'Complex Reasoning',
    score: 94,
    desc: 'Million-token context for architectural reasoning and planning.'
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    context: '256K context',
    task: 'Fast Development',
    score: 93,
    desc: 'Rapid instruction-following model for multi-turn pair programming.'
  }
];

export const OpenKiloSetup: React.FC = () => {
  const { settings, saveSettings } = useChatStore();
  const [authMode, setAuthMode] = useState<'anonymous' | 'oauth' | 'api_key'>('anonymous');
  const [status, setStatus] = useState<OpenKiloStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);

  const isOpenKiloActive = settings?.activeProvider === 'openkilo';

  useEffect(() => {
    void loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      if (window.electronAPI?.openkiloGetStatus) {
        const res = await window.electronAPI.openkiloGetStatus();
        if (res.success && res.data) {
          setStatus(res.data);
          setAuthMode(res.data.authMode);
        }
      }
    } catch {
      // Fallback
    }
  };

  const handleEnableAnonymous = async () => {
    setIsRefreshing(true);
    setActionMessage(null);
    try {
      if (window.electronAPI?.openkiloEnableAnonymous) {
        const res = await window.electronAPI.openkiloEnableAnonymous();
        if (res.success && res.data) {
          setStatus(res.data);
          setAuthMode('anonymous');
        }
      }
      await saveSettings({
        activeProvider: 'openkilo',
        activeModel: 'kilo-auto/free',
        apiKeys: { ...settings?.apiKeys, openkilo: 'anonymous' }
      });
      setActionMessage('OpenKilo Anonymous Free Tier activated! You have immediate access to 15+ live free models.');
    } catch (err: unknown) {
      setActionMessage(`Error enabling anonymous mode: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleStartOAuth = async () => {
    try {
      if (window.electronAPI?.openExternal) {
        void window.electronAPI.openExternal('https://openkilo.com');
      }
      setActionMessage('Opened openkilo.com. Sign in, create an API key, then use the "Or paste your API key" field below (the legacy OAuth code flow is deprecated).');
    } catch (err: unknown) {
      setActionMessage(`Failed to open browser: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCompleteOAuth = async () => {
    if (!oauthCode.trim()) return;
    setIsRefreshing(true);
    setActionMessage(null);
    try {
      if (window.electronAPI?.openkiloCompleteOAuth) {
        const res = await window.electronAPI.openkiloCompleteOAuth(oauthCode.trim());
        if (res.success) {
          setActionMessage('OAuth authentication successful! 350+ paid and free models unlocked.');
          setOauthCode('');
          void loadStatus();
        } else {
          setActionMessage(`OAuth verification failed: ${res.error || 'Unknown error'}`);
        }
      }
    } catch (err: unknown) {
      setActionMessage(`OAuth error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    try {
      await saveSettings({
        activeProvider: 'openkilo',
        apiKeys: { ...settings?.apiKeys, openkilo: apiKeyInput.trim() }
      });
      setAuthMode('api_key');
      setActionMessage('OpenKilo API key saved and activated.');
      setApiKeyInput('');
      void loadStatus();
    } catch (err: unknown) {
      setActionMessage(`Failed to save API key: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRefreshModels = async () => {
    setIsRefreshing(true);
    setActionMessage(null);
    try {
      if (window.electronAPI?.openkiloRefreshModels) {
        const res = await window.electronAPI.openkiloRefreshModels();
        if (res.success && res.data) {
          setDiscoveredModels(res.data);
          setActionMessage(`Refreshed OpenKilo catalog: ${res.data.length} models discovered (${res.data.filter((m) => m.isFree).length} free).`);
        }
      }
    } catch (err: unknown) {
      setActionMessage(`Failed to refresh models: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      if (window.electronAPI?.providerTestConnection) {
        const res = await window.electronAPI.providerTestConnection({
          providerId: 'openkilo',
          apiKey: settings?.apiKeys?.openkilo || 'anonymous',
          modelId: settings?.activeModel || 'kilo-auto/free'
        });
        if (res.success && res.data) {
          setTestResult(res.data);
        } else {
          setTestResult({
            success: false,
            latencyMs: 0,
            error: res.error || 'Connection test failed.'
          });
        }
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelectPriorityModel = async (modelId: string) => {
    await saveSettings({
      activeProvider: 'openkilo',
      activeModel: modelId,
      apiKeys: { ...settings?.apiKeys, openkilo: settings?.apiKeys?.openkilo || 'anonymous' }
    });
    setActionMessage(`Selected ${modelId} as your active coding model.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hero Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '8px',
          padding: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={20} color="#3b82f6" />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>OpenKilo Gateway (Layer 5 Backup Free Tier)</h3>
          </div>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: isOpenKiloActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: isOpenKiloActive ? '#22c55e' : 'var(--text-muted)',
              fontWeight: 600
            }}
          >
            {isOpenKiloActive ? '● Active Provider' : 'Backup Standby'}
          </span>
        </div>
        <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          OpenKilo guarantees that Ty-Code users never get blocked by rate limits or paywalls. Features <strong>40+ curated free models</strong> accessible anonymously with zero setup, seamless browser OAuth for 350+ models, and automatic router fallback when other providers are exhausted.
        </p>

        {/* Feature Highlights Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Sparkles size={13} color="#22c55e" />
              <strong style={{ fontSize: '12px' }}>40+ Free Models</strong>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Anonymous instant access with zero API key configuration.</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Layers size={13} color="#3b82f6" />
              <strong style={{ fontSize: '12px' }}>Auto-Fallback</strong>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Guaranteed backup provider when primary endpoints hit rate limits.</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Globe size={13} color="#8b5cf6" />
              <strong style={{ fontSize: '12px' }}>350+ Models</strong>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Browser OAuth login unlocks paid frontier reasoning and coding engines.</div>
          </div>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: '6px',
            background: actionMessage.includes('Error') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${actionMessage.includes('Error') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
            fontSize: '12px',
            color: actionMessage.includes('Error') ? '#ef4444' : '#22c55e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {actionMessage.includes('Error') ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Authentication Mode Tabs */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Authentication & Tier Selection</div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <button
            type="button"
            onClick={() => setAuthMode('anonymous')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: authMode === 'anonymous' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: authMode === 'anonymous' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              color: authMode === 'anonymous' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Sparkles size={13} />
            <span>Instant Anonymous Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('oauth')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: authMode === 'oauth' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: authMode === 'oauth' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              color: authMode === 'oauth' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Globe size={13} />
            <span>Browser OAuth Login</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('api_key')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: authMode === 'api_key' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: authMode === 'api_key' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              color: authMode === 'api_key' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Key size={13} />
            <span>Direct API Key</span>
          </button>
        </div>

        {/* Tab 1: Anonymous */}
        {authMode === 'anonymous' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Zero-Configuration Anonymous Access</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Uses `apiKey: "anonymous"` automatically. 40+ free models ready for immediate coding.</div>
            </div>
            <button
              type="button"
              onClick={handleEnableAnonymous}
              disabled={isRefreshing}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Zap size={12} />
              <span>{isOpenKiloActive ? 'Re-activate Anonymous' : 'One-Click Enable & Activate'}</span>
            </button>
          </div>
        )}

        {/* Tab 2: OAuth */}
        {authMode === 'oauth' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>OpenKilo Browser OAuth</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Login securely via OpenKilo dashboard to unlock all 350+ paid and free models.</div>
              </div>
              <button
                type="button"
                onClick={handleStartOAuth}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <ExternalLink size={12} />
                <span>Sign in with OpenKilo</span>
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Paste authorization code here..."
                value={oauthCode}
                onChange={(e) => setOauthCode(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px'
                }}
              />
              <button
                type="button"
                onClick={handleCompleteOAuth}
                disabled={!oauthCode.trim() || isRefreshing}
                style={{
                  padding: '6px 14px',
                  borderRadius: '4px',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '11px',
                  cursor: !oauthCode.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                Verify Code
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: API Key */}
        {authMode === 'api_key' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Custom OpenKilo API Key</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                placeholder="kilo-xxxxxxxxxxxxxxxxxxxx"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px'
                }}
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput.trim()}
                style={{
                  padding: '6px 14px',
                  borderRadius: '4px',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '11px',
                  cursor: !apiKeyInput.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Priority Free Models Showcase */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>Curated Priority Free Models</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleRefreshModels}
              disabled={isRefreshing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={11} className={isRefreshing ? 'spin' : ''} />
              <span>Refresh Catalog</span>
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <Cpu size={11} />
              <span>{isTesting ? 'Testing…' : 'Test Ping'}</span>
            </button>
          </div>
        </div>

        {testResult && (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: testResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${testResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              fontSize: '11px',
              color: testResult.success ? '#22c55e' : '#ef4444'
            }}
          >
            {testResult.success
              ? `Connection OK! Latency: ${testResult.latencyMs}ms`
              : `Connection test failed: ${testResult.error}`}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {PRIORITY_MODELS.map((model) => {
            const isSelected = settings?.activeProvider === 'openkilo' && settings?.activeModel === model.id;
            return (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-secondary)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '12px' }}>{model.name}</strong>
                    <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', fontWeight: 600 }}>FREE</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{model.context}</span>
                    <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600 }}>Score {model.score}/100</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{model.desc}</div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectPriorityModel(model.id)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    background: isSelected ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    color: isSelected ? '#fff' : 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {isSelected ? <Check size={11} /> : null}
                  <span>{isSelected ? 'Active Model' : 'Select'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
