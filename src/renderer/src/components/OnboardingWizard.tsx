import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Zap,
  CheckCircle,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Code2,
  Play,
  RotateCw,
  X
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';

interface OnboardingStep {
  id: number;
  title: string;
}

const STEPS: OnboardingStep[] = [
  { id: 1, title: 'Welcome' },
  { id: 2, title: 'Free Tier Setup' },
  { id: 3, title: 'How It Works' },
  { id: 4, title: 'Quick Start' }
];

export const OnboardingWizard: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isEnabling, setIsEnabling] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<string[]>([]);
  const { settings, saveSettings, sendMessage } = useChatStore();
  const { refreshStats } = useUsageDashboardStore();

  useEffect(() => {
    // Check if user has already completed onboarding
    const completedLocal = localStorage.getItem('ty_code_onboarding_completed') === 'true';
    if (!completedLocal && (!settings || settings.hasCompletedOnboarding !== true)) {
      setIsOpen(true);
    }
  }, [settings]);

  if (!isOpen) return null;

  const handleEnableFreeMode = async () => {
    setIsEnabling(true);
    try {
      // 1. Enable OpenKilo anonymous access
      if (window.electronAPI?.openkiloEnableAnonymous) {
        await window.electronAPI.openkiloEnableAnonymous();
      }

      // 2. Pre-warm HTTP connection pools
      if (window.electronAPI?.orchestrationWarmConnections) {
        await window.electronAPI.orchestrationWarmConnections();
      }

      // 3. Set freeMode: true in orchestrator
      if (window.electronAPI?.orchestrationSetFreeMode) {
        await window.electronAPI.orchestrationSetFreeMode(true);
      }

      // 4. Update settings
      await saveSettings({
        freeMode: true,
        activeProvider: 'openkilo',
        activeModel: 'deepseek/deepseek-r1-0528:free',
        hasCompletedOnboarding: true
      });

      setEnabledProviders(['OpenKilo Gateway', 'Free-Claude-Code Proxy', 'OpenRouter Free', 'Groq LPU', 'Ollama Local']);
      void refreshStats();
      setCurrentStep(3);
    } catch (err) {
      console.error('Failed to auto-enable free providers:', err);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleFinish = async (quickTaskPrompt?: string) => {
    localStorage.setItem('ty_code_onboarding_completed', 'true');
    if (window.electronAPI?.orchestrationCompleteOnboarding) {
      await window.electronAPI.orchestrationCompleteOnboarding();
    }
    await saveSettings({ hasCompletedOnboarding: true });
    setIsOpen(false);

    if (quickTaskPrompt) {
      void sendMessage(quickTaskPrompt, process.cwd());
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 15, 29, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div
        style={{
          width: '760px',
          maxWidth: '92vw',
          backgroundColor: '#0f172a',
          borderRadius: '16px',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(56, 189, 248, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f1f5f9'
        }}
      >
        {/* Header / Step Bar */}
        <div
          style={{
            padding: '20px 28px',
            borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.8) 100%)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(14, 165, 233, 0.4)'
              }}
            >
              <Sparkles size={22} color="#ffffff" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
                Welcome to Ty-Code
              </h2>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>
                Next-generation autonomous AI coding with 2.05B+ monthly free tokens
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  style={{
                    width: currentStep === s.id ? '20px' : '8px',
                    height: '8px',
                    borderRadius: '4px',
                    backgroundColor:
                      currentStep === s.id
                        ? '#38bdf8'
                        : currentStep > s.id
                          ? '#10b981'
                          : 'rgba(255, 255, 255, 0.2)',
                    transition: 'all 0.2s ease'
                  }}
                  title={s.title}
                />
              ))}
            </div>

            <button
              onClick={() => void handleFinish()}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: '4px'
              }}
              title="Skip setup"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body Content by Step */}
        <div style={{ padding: '32px 36px', minHeight: '340px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* Step 1: Welcome Screen */}
          {currentStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'center', alignItems: 'center' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 25px rgba(56, 189, 248, 0.2)'
                }}
              >
                <Zap size={32} color="#38bdf8" />
              </div>

              <div>
                <h3 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
                  Code with Frontier AI Models — 100% Free
                </h3>
                <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '560px', margin: '0 auto', lineHeight: '1.6' }}>
                  Ty-Code unifies 61+ free models across OpenKilo, Free-Claude-Code, OpenRouter, and Groq.
                  No credit card or paid subscriptions required to start building.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '24px',
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  padding: '16px 24px',
                  borderRadius: '10px',
                  border: '1px solid rgba(51, 65, 85, 0.6)'
                }}
              >
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8' }}>2.05B+</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Free Tokens/Month</div>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>40+</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Zero-Config Models</div>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#a855f7' }}>&lt; 2s</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Average Latency</div>
                </div>
              </div>

              <button
                onClick={() => setCurrentStep(2)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 28px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(14, 165, 233, 0.4)',
                  marginTop: '8px'
                }}
              >
                <span>Get Started</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Step 2: Auto-enable free providers */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0' }}>
                  Enable Free Mode &amp; Connect Free Providers
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  Click below to automatically configure anonymous gateway keys and pre-warm healthy connections.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(56, 189, 248, 0.2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ShieldCheck size={18} color="#10b981" />
                    <div>
                      <strong style={{ fontSize: '13px', color: '#f8fafc' }}>OpenKilo Gateway</strong>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>500M tokens/mo · DeepSeek R1, Qwen3 Coder, Llama 3.3 70B</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>Anonymous Access</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(56, 189, 248, 0.2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Zap size={18} color="#f59e0b" />
                    <div>
                      <strong style={{ fontSize: '13px', color: '#f8fafc' }}>Free-Claude-Code (FCC) Proxy</strong>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>1.35B tokens/mo · 61+ ToS-friendly free providers</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>Zero Config</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(56, 189, 248, 0.2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Cpu size={18} color="#38bdf8" />
                    <div>
                      <strong style={{ fontSize: '13px', color: '#f8fafc' }}>Groq Cloud &amp; OpenRouter Free</strong>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>250M tokens/mo · Ultra-low latency LPU fast responses</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>Included</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                <button
                  onClick={() => setCurrentStep(1)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    padding: '10px 18px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>

                <button
                  onClick={handleEnableFreeMode}
                  disabled={isEnabling}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
                  }}
                >
                  {isEnabling ? (
                    <>
                      <RotateCw size={16} className="spin" />
                      <span>Configuring Free Mode...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Enable Free Mode (1-Click)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Tutorial on Model Selection */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0' }}>
                  How Ty-Code Chooses Models Automatically
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  You focus on coding. Layer 6 Smart Orchestrator routes every task to the best model:
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>Code Generation</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Qwen3 Coder (262K)</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Refactoring, algorithms, and bug fixes</div>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#a855f7' }}>Complex Reasoning</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>DeepSeek R1 (164K)</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Deep reflection and multi-file architecture</div>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#10b981' }}>Fast Keystrokes</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Groq Llama 3.3 70B</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Sub-second inline ghost text autocompletion</div>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b' }}>Large Contexts</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Qwen3 Coder / Long-Context Model</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Full repository index searches &gt; 32K tokens</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                <button
                  onClick={() => setCurrentStep(2)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    padding: '10px 18px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>

                <button
                  onClick={() => setCurrentStep(4)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 22px',
                    borderRadius: '6px',
                    backgroundColor: '#0ea5e9',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <span>Next: Try a Coding Task</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Quick Start Coding Tasks */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0' }}>
                  Quick Start: Launch Your First Task
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  Pick a sample task to watch Ty-Code classify, select the model, and stream code:
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => handleFinish('Write a TypeScript utility function for debounce with immediate execution option and full unit tests.')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Code2 size={18} color="#38bdf8" />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Create Debounce Utility with Tests</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Auto-routes to Qwen3 Coder free model</div>
                    </div>
                  </div>
                  <Play size={14} color="#38bdf8" />
                </button>

                <button
                  onClick={() => handleFinish('Explain the architectural difference between optimistic locking and pessimistic locking with code examples.')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Layers size={18} color="#a855f7" />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Architecture Deep Dive: Locking Tradeoffs</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Auto-routes to DeepSeek R1 reasoning model</div>
                    </div>
                  </div>
                  <Play size={14} color="#a855f7" />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                <button
                  onClick={() => setCurrentStep(3)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    padding: '10px 18px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>

                <button
                  onClick={() => handleFinish()}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '6px',
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
                  }}
                >
                  Start Coding Now
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 28px',
            borderTop: '1px solid rgba(51, 65, 85, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.9)',
            fontSize: '11px',
            color: '#64748b'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle size={13} color="#10b981" />
            <span>Ready for offline &amp; anonymous local coding</span>
          </div>

          <span>You can re-open this wizard anytime from Settings</span>
        </div>
      </div>
    </div>
  );
};
