import React, { useState, useEffect } from 'react';
import { X, Key, Server, Sliders, ShieldCheck } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import type { ProviderType } from '../../../preload/types';

export const SettingsModal: React.FC = () => {
  const { isSettingsOpen, toggleSettings, settings, saveSettings } = useChatStore();

  const [activeTab, setActiveTab] = useState<'keys' | 'endpoints' | 'params'>('keys');

  // Form states
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434/v1');
  const [fccProxyUrl, setFccProxyUrl] = useState('http://localhost:8082/v1');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(4096);

  useEffect(() => {
    if (settings) {
      setOpenRouterKey(settings.apiKeys?.openrouter || '');
      setGroqKey(settings.apiKeys?.groq || '');
      setDeepseekKey(settings.apiKeys?.deepseek || '');
      setOllamaUrl(settings.customEndpoints?.ollama || 'http://localhost:11434/v1');
      setFccProxyUrl(settings.customEndpoints?.['fcc-proxy'] || 'http://localhost:8082/v1');
      setTemperature(settings.temperature ?? 0.2);
      setMaxTokens(settings.maxTokens ?? 4096);
    }
  }, [settings]);

  if (!isSettingsOpen) return null;

  const handleSave = async () => {
    await saveSettings({
      apiKeys: {
        openrouter: openRouterKey,
        groq: groqKey,
        deepseek: deepseekKey
      },
      customEndpoints: {
        ollama: ollamaUrl,
        'fcc-proxy': fccProxyUrl
      },
      temperature: Number(temperature),
      maxTokens: Number(maxTokens)
    });
    toggleSettings();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
      onClick={toggleSettings}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '540px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            height: '44px',
            padding: '0 16px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Key size={16} color="var(--accent-primary)" />
            <span>AI Provider & Model Settings</span>
          </div>
          <button onClick={toggleSettings} style={{ padding: '4px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-primary)'
          }}
        >
          <button
            onClick={() => setActiveTab('keys')}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '12px',
              borderBottom: activeTab === 'keys' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: activeTab === 'keys' ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
            <Key size={13} />
            <span>API Keys</span>
          </button>
          <button
            onClick={() => setActiveTab('endpoints')}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '12px',
              borderBottom: activeTab === 'endpoints' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: activeTab === 'endpoints' ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
            <Server size={13} />
            <span>Endpoints & Proxy</span>
          </button>
          <button
            onClick={() => setActiveTab('params')}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '12px',
              borderBottom: activeTab === 'params' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: activeTab === 'params' ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
            <Sliders size={13} />
            <span>Inference Params</span>
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeTab === 'keys' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  OpenRouter API Key (Free & Low-Cost Models)
                </label>
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Groq API Key (Ultra-Fast 300+ tokens/sec)
                </label>
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_..."
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  DeepSeek API Key (Official Direct Endpoint)
                </label>
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={(e) => setDeepseekKey(e.target.value)}
                  placeholder="sk-..."
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-green)' }}>
                <ShieldCheck size={14} />
                <span>API Keys are encrypted locally using Electron safeStorage</span>
              </div>
            </>
          )}

          {activeTab === 'endpoints' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Local Ollama Base URL (Private Offline Inference)
                </label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Free-Claude-Code Proxy URL (FastAPI fcc-server)
                </label>
                <input
                  type="text"
                  value={fccProxyUrl}
                  onChange={(e) => setFccProxyUrl(e.target.value)}
                  placeholder="http://localhost:8082/v1"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Connects to a running instance of <code>Alishahryar1/free-claude-code</code> proxy.
                </div>
              </div>
            </>
          )}

          {activeTab === 'params' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Temperature: {temperature} (Lower = more deterministic coding)
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Max Response Tokens: {maxTokens}
                </label>
                <input
                  type="number"
                  min="1024"
                  max="16384"
                  step="512"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            height: '48px',
            padding: '0 16px',
            backgroundColor: 'var(--bg-tertiary)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '8px'
          }}
        >
          <button
            onClick={toggleSettings}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              fontSize: '12px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '6px 16px',
              backgroundColor: 'var(--accent-primary)',
              color: '#ffffff',
              fontWeight: 500,
              fontSize: '12px'
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
