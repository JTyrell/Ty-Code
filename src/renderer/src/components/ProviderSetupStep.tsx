/**
 * ProviderSetupStep Component (Phase UnifiedProvisioning)
 *
 * Shared step component used in:
 * 1. OnboardingWizard (guided setup path)
 * 2. Settings > Providers (management grid)
 * 3. In-chat ProviderSetupCard (CONFIG_MISSING or upsell jump)
 *
 * Provides numbered account creation steps, one-click browser links,
 * optional one-click PKCE OAuth, and KeyInputField with live 1-token testing.
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect } from 'react';
import {
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Server,
  Zap,
  Cpu,
  Layers,
  Lock,
  RefreshCw,
  ChevronRight,
  Check
} from 'lucide-react';
import { KeyInputField } from './KeyInputField';
import { useOnboardingStore } from '../state/onboarding-store';
import { useChatStore } from '../state/chat-store';
import { toast } from '../state/toast-store';

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  tagline: string;
  flow: 'oauth-pkce-preferred' | 'guided-key' | 'local-detect';
  signupUrl: string;
  instructions: string[];
  keyFormat: string;
  defaultModel: string;
  freeModels: string[];
  badges: string[];
  accentColor: string;
}

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Access top free models like Nemotron, Cohere North and Laguna',
    flow: 'oauth-pkce-preferred',
    signupUrl: 'https://openrouter.ai/keys',
    instructions: [
      'Sign up at OpenRouter with Google or GitHub (takes ~30 seconds)',
      'Open the "Keys" section in the dashboard',
      'Click "Create Key" and give it a name (e.g. Ty-Code)',
      'Copy the generated key (starts with sk-or-v1-)'
    ],
    keyFormat: 'sk-or-v1-... (50+ characters)',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    freeModels: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'cohere/north-mini-code:free',
      'dots-studio/dots-3-note-preview:free',
      'google/gemma-4-31b-it:free'
    ],
    badges: ['Most Popular', '10+ free models'],
    accentColor: 'var(--accent-primary)'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    tagline: 'Ultra-fast LPU inference (300+ tok/s) with generous daily free quota',
    flow: 'guided-key',
    signupUrl: 'https://console.groq.com/keys',
    instructions: [
      'Sign up at Groq Console with email or Google',
      'Navigate to "API Keys" in the left sidebar',
      'Click "Create API Key" and enter a name',
      'Copy your new key (starts with gsk_)'
    ],
    keyFormat: 'gsk_... (40+ characters)',
    defaultModel: 'llama-3.3-70b-versatile',
    freeModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant'
    ],
    badges: ['Ultra-Fast', '300+ tok/s'],
    accentColor: 'var(--accent-amber)'
  },
  'google-gemini': {
    id: 'google-gemini',
    name: 'Google AI Studio',
    tagline: 'Gemini 2.0 Flash with multimodal reasoning and large free tiers',
    flow: 'guided-key',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    instructions: [
      'Sign in with your Google account at Google AI Studio',
      'Click "Get API Key" or "Create API Key"',
      'Choose or create a Google Cloud project',
      'Copy your generated key (starts with AIza, exactly 39 characters)'
    ],
    keyFormat: 'AIza... (exact 39 characters)',
    defaultModel: 'gemini-2.0-flash',
    freeModels: [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ],
    badges: ['Multimodal', 'Large Context'],
    accentColor: 'var(--accent-cyan)'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama Local',
    tagline: 'Run models 100% locally on your machine with zero telemetry and zero network',
    flow: 'local-detect',
    signupUrl: 'https://ollama.com/download',
    instructions: [
      'Download and run Ollama from ollama.com/download if not installed',
      'Pull a coding model in your terminal (e.g. ollama run qwen2.5-coder)',
      'Ty-Code connects directly to http://localhost:11434'
    ],
    keyFormat: 'No key needed (Local Server)',
    defaultModel: 'qwen2.5-coder',
    freeModels: ['qwen2.5-coder', 'llama3.2', 'deepseek-coder-v2'],
    badges: ['Offline', 'Private'],
    accentColor: 'var(--accent-green)'
  }
};

export interface ProviderSetupStepProps {
  providerId: string;
  mode?: 'wizard' | 'settings' | 'in_chat';
  onConnected?: (providerId: string) => void;
  onSkip?: () => void;
  onNext?: () => void;
  onBack?: () => void;
  showNavigation?: boolean;
}

export const ProviderSetupStep: React.FC<ProviderSetupStepProps> = ({
  providerId,
  mode = 'wizard',
  onConnected,
  onSkip,
  onNext,
  onBack,
  showNavigation = true
}) => {
  const normId = providerId.replace(/-free$/, '');
  const config = PROVIDER_CATALOG[normId] || {
    id: normId,
    name: normId.toUpperCase(),
    tagline: 'Configure API credentials',
    flow: 'guided-key' as const,
    signupUrl: `https://${normId}.com`,
    instructions: ['Create an account', 'Obtain your API key', 'Paste the key below'],
    keyFormat: 'API Key',
    defaultModel: `${normId}-default`,
    freeModels: [`${normId}-default`],
    badges: ['API Key'],
    accentColor: 'var(--accent-primary)'
  } as ProviderCatalogEntry;
  const REAL_SIGNUP_URLS: Record<string, string> = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    'google-ai-studio': 'https://aistudio.google.com/app/apikey',
    gemini: 'https://aistudio.google.com/app/apikey',
    groq: 'https://console.groq.com/keys',
    openrouter: 'https://openrouter.ai/keys',
    copilot: 'https://github.com/settings/copilot',
    openkilo: 'https://openkilo.com',
    ollama: 'https://ollama.com/download'
  };
  if (!PROVIDER_CATALOG[normId]) {
    config.signupUrl = REAL_SIGNUP_URLS[normId] || 'https://openkilo.com';
  }
  const REAL_DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-3-5-sonnet-20241022',
    openai: 'gpt-4o',
    deepseek: 'deepseek-chat',
    'google-ai-studio': 'gemini-2.0-flash',
    gemini: 'gemini-2.0-flash',
    'google-gemini': 'gemini-2.0-flash',
    openrouter: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    groq: 'llama-3.3-70b-versatile',
    copilot: 'claude-3.5-sonnet',
    openkilo: 'kilo-auto/free',
    'openkilo-free': 'kilo-auto/free',
    ollama: 'qwen2.5-coder'
  };
  const defaultModel = REAL_DEFAULT_MODELS[normId] || 'kilo-auto/free';
  if (config.defaultModel?.endsWith('-default')) {
    config.defaultModel = defaultModel;
  }
  if (config.freeModels.length === 1 && config.freeModels[0]?.endsWith('-default')) {
    config.freeModels = [defaultModel];
  }

  const { connectedProviders, markProviderConnected, markProviderSkipped } = useOnboardingStore();
  const { saveSettings } = useChatStore();

  const isAlreadyConnected = connectedProviders.includes(normId);

  const [apiKey, setApiKey] = useState('');
  const [hasValidTest, setHasValidTest] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOAuthRunning, setIsOAuthRunning] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(config.flow === 'guided-key' || isAlreadyConnected);

  // Local Ollama state
  const [isDetectingOllama, setIsDetectingOllama] = useState(false);
  const [ollamaDetected, setOllamaDetected] = useState<boolean | null>(null);
  const [ollamaMessage, setOllamaMessage] = useState<string>('');

  useEffect(() => {
    if (config.flow === 'local-detect') {
      void checkOllamaStatus();
    }
  }, [config.flow]);

  const checkOllamaStatus = async () => {
    setIsDetectingOllama(true);
    setOllamaDetected(null);
    try {
      if (window.electronAPI?.credentialsTest) {
        const res = await window.electronAPI.credentialsTest('ollama', '');
        if (res.success) {
          setOllamaDetected(true);
          setOllamaMessage('Ollama server running at http://localhost:11434');
          markProviderConnected('ollama');
        } else {
          setOllamaDetected(false);
          setOllamaMessage(res.error || 'Ollama is not running. Start Ollama and try again.');
        }
      }
    } catch {
      setOllamaDetected(false);
      setOllamaMessage('Could not connect to Ollama at localhost:11434');
    } finally {
      setIsDetectingOllama(false);
    }
  };

  const handleOpenSignup = async () => {
    try {
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(config.signupUrl);
      } else {
        window.open(config.signupUrl, '_blank');
      }
    } catch (err) {
      console.warn('Failed to open external signup link:', err);
    }
  };

  const handleStartOAuthPKCE = async () => {
    if (config.id !== 'openrouter') return;
    setIsOAuthRunning(true);
    try {
      if (window.electronAPI?.oauthStartOpenRouterPKCE) {
        const res = await window.electronAPI.oauthStartOpenRouterPKCE();
        if (res.success) {
          toast.info('Authorizing in browser... Token will land directly in safeStorage.');
          // Listen for status changes
          const unsubscribe = window.electronAPI.onOAuthStatusChanged?.((status) => {
            if (status?.openrouter?.connected) {
              markProviderConnected('openrouter');
              void saveSettings({
                activeProvider: 'openrouter' as any,
                activeModel: config.defaultModel
              });
              toast.success('OpenRouter connected via PKCE OAuth!');
              setIsOAuthRunning(false);
              onConnected?.('openrouter');
              unsubscribe?.();
            }
          });
        } else {
          toast.error(res.error || 'Failed to start OpenRouter OAuth. You can paste a key below instead.');
          setShowKeyInput(true);
          setIsOAuthRunning(false);
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setShowKeyInput(true);
      setIsOAuthRunning(false);
    }
  };

  const handleSaveCredential = async () => {
    if (!apiKey.trim() || !hasValidTest) return;
    setIsSaving(true);

    try {
      if (!window.electronAPI?.credentialsSave) throw new Error('credentialsSave IPC is not available in preload.');
      const saveRes = await window.electronAPI.credentialsSave(
        config.id,
        apiKey.trim(),
        `${config.name} Free Key`
      );
      if (!saveRes?.success) throw new Error(saveRes?.error || 'Main process refused to save the key.');

      const settingsOk = await saveSettings({
        activeProvider: config.id as any,
        activeModel: config.defaultModel,
        freeMode: true
      });
      if (!settingsOk) throw new Error('Key saved, but active provider settings could not be saved.');

      markProviderConnected(config.id);
      toast.success(`${config.name} credentials saved securely!`);
      onConnected?.(config.id);

      if (onNext) {
        onNext();
      }
    } catch (err) {
      console.error('Onboarding: save key failed', err);
      toast.error(`Failed to save ${config.name} key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkipThis = () => {
    markProviderSkipped(config.id);
    onSkip?.();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: mode === 'in_chat' ? '12px' : '20px',
        background: mode === 'in_chat' ? 'transparent' : 'rgba(15, 23, 42, 0.6)',
        borderRadius: '12px',
        border: mode === 'in_chat' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Header with Title & Badges */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: `rgba(99, 102, 241, 0.15)`,
              border: `1px solid ${config.accentColor}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: config.accentColor
            }}
          >
            {config.id === 'groq' ? (
              <Zap size={20} />
            ) : config.id === 'ollama' ? (
              <Server size={20} />
            ) : (
              <Sparkles size={20} />
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Connect {config.name}
              </h3>
              {isAlreadyConnected && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--accent-green)',
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <CheckCircle2 size={11} />
                  Connected
                </span>
              )}
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {config.tagline}
            </p>
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {config.badges.map((b) => (
            <span
              key={b}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* Numbered Instructions */}
      <div
        style={{
          background: 'rgba(30, 41, 59, 0.4)',
          borderRadius: '8px',
          padding: '12px 14px',
          border: '1px solid rgba(255, 255, 255, 0.05)'
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
          How to get your free key:
        </div>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {config.instructions.map((step, idx) => (
            <li key={idx} style={{ marginBottom: '4px' }}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Flow Actions */}
      {config.flow === 'local-detect' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: ollamaDetected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${ollamaDetected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
              fontSize: '12px',
              color: ollamaDetected ? 'var(--accent-green)' : 'var(--accent-red)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>{ollamaMessage || 'Checking local Ollama status...'}</span>
            <button
              type="button"
              onClick={() => void checkOllamaStatus()}
              disabled={isDetectingOllama}
              style={{
                background: 'transparent',
                border: '1px solid currentColor',
                borderRadius: '6px',
                color: 'inherit',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <RefreshCw size={11} className={isDetectingOllama ? 'spin-animation' : ''} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Action Row: Open in Browser + Optional 1-Click PKCE */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void handleOpenSignup()}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span>Open {config.name} →</span>
              <ExternalLink size={12} />
            </button>

            {config.flow === 'oauth-pkce-preferred' && (
              <button
                type="button"
                onClick={() => void handleStartOAuthPKCE()}
                disabled={isOAuthRunning}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  background: 'var(--accent-primary, #6366f1)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isOAuthRunning ? 'wait' : 'pointer',
                  opacity: isOAuthRunning ? 0.7 : 1,
                  transition: 'all 0.15s ease'
                }}
              >
                {isOAuthRunning ? (
                  <>
                    <RefreshCw size={12} className="spin-animation" />
                    <span>Waiting for browser approval…</span>
                  </>
                ) : (
                  <>
                    <Lock size={12} />
                    <span>One-Click Connect (OAuth PKCE)</span>
                  </>
                )}
              </button>
            )}

            {!showKeyInput && config.flow === 'oauth-pkce-preferred' && (
              <button
                type="button"
                onClick={() => setShowKeyInput(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '6px 10px',
                  textDecoration: 'underline'
                }}
              >
                I already have a key
              </button>
            )}
          </div>

          {/* Key Input Section */}
          {showKeyInput && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Paste your {config.keyFormat}:</span>
                <span style={{ color: 'var(--accent-green)' }}>Saved only to local OS safeStorage</span>
              </div>

              <KeyInputField
                providerId={config.id}
                value={apiKey}
                onChange={(val) => {
                  setApiKey(val);
                  setHasValidTest(false);
                }}
                onValidKeyTested={(_key) => {
                  setHasValidTest(true);
                }}
                placeholder={`Paste your ${config.name} key`}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveCredential()}
                  disabled={!hasValidTest || isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 16px',
                    borderRadius: '6px',
                    background: hasValidTest ? 'var(--accent-primary, #6366f1)' : 'rgba(255, 255, 255, 0.08)',
                    color: hasValidTest ? '#ffffff' : 'var(--text-muted)',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: hasValidTest && !isSaving ? 'pointer' : 'not-allowed',
                    opacity: hasValidTest ? 1 : 0.6,
                    transition: 'all 0.15s ease'
                  }}
                >
                  {isSaving ? (
                    <>
                      <RefreshCw size={12} className="spin-animation" />
                      <span>Saving to safeStorage…</span>
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      <span>Save &amp; Connect</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Free Models Included */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Free models included:</span>
        {config.freeModels.map((m) => (
          <code
            key={m}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--text-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            {m}
          </code>
        ))}
      </div>

      {/* Navigation Footer for Wizard */}
      {showNavigation && mode === 'wizard' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: '14px',
            marginTop: '6px'
          }}
        >
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '6px 12px'
              }}
            >
              ← Back
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={handleSkipThis}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '6px 12px'
              }}
            >
              Skip this provider
            </button>

            {onNext && (
              <button
                type="button"
                onClick={onNext}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 16px',
                  borderRadius: '6px',
                  background: isAlreadyConnected || hasValidTest ? 'var(--accent-primary, #6366f1)' : 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <span>Continue</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
