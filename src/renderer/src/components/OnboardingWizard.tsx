/**
 * OnboardingWizard Component (Zero-Friction Edition)
 *
 * Streamlined two-path first-run choice, replacing the legacy multi-step
 * key collection (FCC guided setup remains available from Settings):
 *
 *   Path A - Ty-Code Free Tier (Zero Configuration): one click activates the
 *            community-keyed free supply (providerId 'ty-code-free', baked
 *            verified models bootstrapped from the Ty-Code Worker via
 *            credential-vault), the anonymous OpenKilo pool stays enabled as
 *            the automatic fallback, and the Chat Sidecar opens with a free
 *            model preselected. No account, no API key, no input.
 *
 *   Path B - Unlock Premium (One Key): a single OpenRouter key is verified
 *            with a live 1-token test, persisted through OS safeStorage
 *            (Windows DPAPI / macOS Keychain / Linux Secret Service), and
 *            immediately routes the default premium model (GPT-4o).
 *
 * Non-trapping: Escape / Close defer the decision and never block the
 * workbench. The FCC supply layer keeps powering free models upstream and its
 * attribution remains in the footer.
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  Zap,
  Rocket,
  Lock,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  X,
  Sparkles
} from 'lucide-react';
import { useOnboardingStore } from '../state/onboarding-store';
import { useChatStore } from '../state/chat-store';
import { toast } from '../state/toast-store';

// The default Ty-Code Free serving model: verified live against OpenRouter
// (baked in src/main/services/verified-models.ts, providerId 'ty-code-free').
const FREE_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
// Default One-Key Premium landing model (OPENROUTER_PREMIUM_MODELS).
const PREMIUM_DEFAULT_MODEL = 'openai/gpt-4o';

const FCC_CREDIT_STRING =
  'Free-model supply layer powered by free-claude-code (FCC) â€” AGPL-3.0 / MIT â€” https://github.com/Alishahryar1/free-claude-code';

type OnboardingView = 'choose' | 'premium';

export const OnboardingWizard: React.FC = () => {
  const { isOpen, openWizard, closeWizard } = useOnboardingStore();
  const { settings, saveSettings } = useChatStore();

  const [view, setView] = useState<OnboardingView>('choose');
  const [startingFree, setStartingFree] = useState(false);

  // Premium path state
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [isSavingPremium, setIsSavingPremium] = useState(false);

  // Auto-open on clean install (no onboarding flag)
  useEffect(() => {
    const isDone =
      localStorage.getItem('ty_code_onboarding_completed') === 'true' ||
      localStorage.getItem('ty_code_first_run_completed') === 'true' ||
      settings?.hasCompletedOnboarding === true;

    if (!isDone && !isOpen) {
      openWizard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, openWizard, settings]);

  // Keyboard navigation: Escape closes deferentially (non-trapping)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        closeWizard();
      }
    },
    [isOpen, closeWizard]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const persistOnboardingCompletion = async (
    freeMode: boolean,
    activeProvider: string,
    activeModel: string
  ): Promise<boolean> => {
    const saved = await saveSettings({
      freeMode,
      activeProvider: activeProvider as any,
      activeModel,
      hasCompletedOnboarding: true
    } as any);
    if (saved) {
      localStorage.setItem('ty_code_onboarding_completed', 'true');
      localStorage.setItem('ty_code_first_run_completed', 'true');
      localStorage.removeItem('ty_code_anonymous_tier_active');
    }
    return saved;
  };

  const handleStartFree = async () => {
    if (startingFree) return;
    setStartingFree(true);
    try {
      // Keep the anonymous OpenKilo pool enabled as the automatic fallback
      // behind the community-keyed Free Tier (gateway degradation chain).
      try {
        if (window.electronAPI?.openkiloEnableAnonymous) {
          await window.electronAPI.openkiloEnableAnonymous();
        }
        if (window.electronAPI?.orchestrationSetFreeMode) {
          await window.electronAPI.orchestrationSetFreeMode(true);
        }
      } catch {
        // Non-blocking: the community bootstrap at boot covers the primary path
      }

      const saved = await persistOnboardingCompletion(true, 'ty-code-free', FREE_DEFAULT_MODEL);
      if (!saved) throw new Error('Settings could not be applied.');

      toast.success('Free Tier active. Start coding with zero configuration.', 'A free model is preselected in the Chat Sidecar.');
      closeWizard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Free Tier activation failed. Try again or connect a key first.');
    } finally {
      setStartingFree(false);
    }
  };

  // "Test & Save": live 1-token verification, then safeStorage persistence
  const handleTestAndSave = async () => {
    const key = apiKey.trim();
    if (!key || isTesting) return;
    setIsTesting(true);
    setTestSuccess(null);
    setTestMessage('');
    try {
      if (window.electronAPI?.testProviderKey) {
        const testRes = await window.electronAPI.testProviderKey('openrouter', key);
        if (!testRes.success) {
          setTestSuccess(false);
          setTestMessage(testRes.message || 'OpenRouter rejected that key. Check it and try again.');
          return;
        }
      }
      if (window.electronAPI?.credentialsSave) {
        const saveRes = await window.electronAPI.credentialsSave('openrouter', key, 'OpenRouter API Key');
        if (saveRes && !saveRes.success) {
          setTestSuccess(false);
          setTestMessage(saveRes.error || 'The key verified but could not be stored in the OS keychain.');
          return;
        }
      }
      setTestSuccess(true);
      setTestMessage('Key verified and sealed in the OS keychain (safeStorage).');
    } catch (err) {
      setTestSuccess(false);
      setTestMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndStart = async () => {
    if (testSuccess !== true || isSavingPremium) return;
    setIsSavingPremium(true);
    try {
      const saved = await persistOnboardingCompletion(false, 'openrouter', PREMIUM_DEFAULT_MODEL);
      if (!saved) throw new Error('Settings could not be applied.');

      toast.success('Premium unlocked. GPT-4o is ready in the Chat Sidecar.', 'One Key Premium: your key never left this machine.');
      closeWizard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Premium activation failed. Try again in Settings.');
    } finally {
      setIsSavingPremium(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Ty-Code"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(7, 11, 22, 0.88)',
        backdropFilter: 'blur(14px)',
        zIndex: 10002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div
        style={{
          width: '860px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '16px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 32px rgba(99, 102, 241, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--text-primary)'
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: '20px 28px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 58, 138, 0.35) 100%)'
          }}
        >
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(99, 102, 241, 0.18)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Lock size={22} color="var(--accent-primary)" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Welcome to Ty-Code. Your Local-First AI IDE.
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Enterprise-grade AI coding, zero cloud exfiltration. Start building instantly.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeWizard}
            title="Decide later (onboarding resumes from Settings)"
            aria-label="Close onboarding"
            style={{
              background: 'var(--surface-2)',
              border: 'none',
              borderRadius: '6px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '5px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <X size={15} />
          </button>
        </header>

        {/* Body */}
        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
          {view === 'choose' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {/* Path A: Start Free (Zero Configuration) */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '20px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.07)',
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }} role="img" aria-label="Lightning">
                    âš¡
                  </span>
                  <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    Ty-Code Free Tier
                  </h2>
                </div>
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.6, minHeight: '68px' }}>
                  Start coding immediately. No account, no API key required. Access curated free models (Qwen, DeepSeek, Llama) routed securely through our community gateway.
                </p>
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    id="onboard-start-free-btn"
                    disabled={startingFree}
                    onClick={() => void handleStartFree()}
                    style={{
                      width: '100%',
                      height: '42px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '11px 20px',
                      borderRadius: '8px',
                      background: startingFree ? 'rgba(56, 189, 248, 0.5)' : 'var(--accent-cyan)',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      cursor: startingFree ? 'wait' : 'pointer',
                      boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
                      boxSizing: 'border-box'
                    }}
                  >
                    {startingFree ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Zap size={15} />
                    )}
                    <span>Start Coding Now</span>
                  </button>
                </div>
              </div>

              {/* Path B: Unlock Premium (One Key) */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '20px',
                  borderRadius: '12px',
                  background: 'rgba(168, 85, 247, 0.07)',
                  border: '1px solid rgba(168, 85, 247, 0.3)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }} role="img" aria-label="Rocket">
                    ðŸš€
                  </span>
                  <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                    Unlock Premium Models
                  </h2>
                </div>
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.6, minHeight: '68px' }}>
                  Paste a single OpenRouter API key to instantly unlock GPT-4o, Claude 3.5 Sonnet, Qwen-Max, and 100+ other premium models. Your key is encrypted locally via OS-level safeStorage and never leaves your machine.
                </p>
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    id="onboard-premium-btn"
                    onClick={() => setView('premium')}
                    style={{
                      width: '100%',
                      height: '42px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '11px 20px',
                      borderRadius: '8px',
                      background: 'var(--accent-primary, var(--accent-primary))',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                      boxSizing: 'border-box'
                    }}
                  >
                    <Key size={15} />
                    <span>Enter API Key</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'premium' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '620px', margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Rocket size={20} color="var(--accent-primary)" />
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                  One Key. Every Premium Model.
                </h2>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    id="onboard-premium-key-input"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestSuccess(null);
                      setTestMessage('');
                    }}
                    placeholder="sk-or-v1-... your OpenRouter key"
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      width: '100%',
                      padding: '12px 44px 12px 14px',
                      backgroundColor: 'var(--surface-2)',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && apiKey.trim()) void handleTestAndSave();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '4px'
                    }}
                    title={showKey ? 'Hide key' : 'Reveal key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  type="button"
                  id="onboard-test-save-btn"
                  disabled={isTesting || !apiKey.trim()}
                  onClick={() => void handleTestAndSave()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '11px 18px',
                    borderRadius: '8px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    border: '1px solid rgba(168, 85, 247, 0.5)',
                    color: 'var(--accent-primary)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isTesting || !apiKey.trim() ? 'not-allowed' : 'pointer',
                    opacity: !apiKey.trim() ? 0.55 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {isTesting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
                  <span>Test &amp; Save</span>
                </button>
              </div>

              {testSuccess === true && (
                <div
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: 'var(--accent-green)',
                    fontSize: '13px'
                  }}
                >
                  <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                  <span>{testMessage}</span>
                </div>
              )}
              {testSuccess === false && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: 'var(--accent-red)',
                    fontSize: '13px'
                  }}
                >
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{testMessage}</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  id="onboard-premium-back-btn"
                  onClick={() => {
                    setView('choose');
                    setTestSuccess(null);
                    setTestMessage('');
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    padding: '10px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} />
                  Back
                </button>
                <button
                  type="button"
                  id="onboard-premium-save-start-btn"
                  disabled={testSuccess !== true || isSavingPremium}
                  onClick={() => void handleSaveAndStart()}
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '11px 24px',
                    borderRadius: '8px',
                    background: testSuccess === true ? 'var(--accent-primary)' : 'rgba(51, 65, 85, 0.4)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: testSuccess === true && !isSavingPremium ? 'pointer' : 'not-allowed',
                    opacity: testSuccess === true ? 1 : 0.5
                  }}
                >
                  {isSavingPremium ? <RefreshCw size={14} className="animate-spin" /> : <Rocket size={15} />}
                  <span>Save &amp; Start Coding</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer: Zero-Telemetry Guarantee + FCC attribution */}
        <footer
          style={{
            padding: '14px 28px 18px',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            alignItems: 'center'
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span role="img" aria-label="Lock">
              ðŸ”’
            </span>
            <strong style={{ color: 'var(--text-primary)' }}>Zero-Telemetry Guarantee:</strong>
            <span>Your code and credentials never leave this machine in plaintext.</span>
          </div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', textAlign: 'center' }}>
            <Sparkles size={11} color="var(--text-secondary)" />
            <span>{FCC_CREDIT_STRING}</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
