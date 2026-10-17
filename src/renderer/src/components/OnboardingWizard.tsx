/**
 * OnboardingWizard Component (Phase UnifiedProvisioning)
 *
 * Comprehensive, non-blocking onboarding wizard for Ty-Code:
 * - Multi-step guided wizard: Welcome -> Path Choice -> Sequential Providers -> Summary
 * - Zero-trap architecture: Skip (Anonymous) is always visible on every step
 * - Partial completion is valid and immediately persisted to safeStorage
 * - Re-runnable anytime from Settings > Providers and Status Bar chip
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useCallback } from 'react';
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Server,
  Zap,
  Lock,
  Layers,
  Cpu,
  ChevronRight,
  X,
  Info,
  ExternalLink,
  Code2
} from 'lucide-react';
import { useOnboardingStore, type OnboardingStepId, type OnboardingPath } from '../state/onboarding-store';
import { ProviderSetupStep, PROVIDER_CATALOG } from './ProviderSetupStep';
import { useChatStore } from '../state/chat-store';

const STEP_SEQUENCE: { id: OnboardingStepId; label: string; number: number }[] = [
  { id: 'welcome', label: 'Welcome', number: 1 },
  { id: 'path_choice', label: 'Setup Path', number: 2 },
  { id: 'openrouter', label: 'OpenRouter', number: 3 },
  { id: 'groq', label: 'Groq', number: 4 },
  { id: 'google-gemini', label: 'Google AI', number: 5 },
  { id: 'summary', label: 'All Set', number: 6 }
];

export const OnboardingWizard: React.FC = () => {
  const {
    isOpen,
    currentStep,
    selectedPath,
    connectedProviders,
    isCompleted,
    isSkipped,
    openWizard,
    closeWizard,
    setStep,
    selectPath,
    skipToAnonymous,
    completeWizard
  } = useOnboardingStore();

  const { settings } = useChatStore();

  // Auto-open on clean install (no onboarding flag)
  useEffect(() => {
    const isDone =
      localStorage.getItem('ty_code_onboarding_completed') === 'true' ||
      localStorage.getItem('ty_code_first_run_completed') === 'true' ||
      settings?.hasCompletedOnboarding === true;

    if (!isDone && !isOpen) {
      openWizard('welcome');
    }
  }, [isOpen, openWizard, settings]);

  // Keyboard navigation: Escape key closes or skips gracefully
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

  if (!isOpen) return null;

  const currentStepMeta = STEP_SEQUENCE.find((s) => s.id === currentStep) || {
    id: currentStep,
    label: 'Setup',
    number: currentStep === 'skip_anonymous' ? 3 : 1
  };

  const handleStartCoding = async () => {
    if (currentStep === 'skip_anonymous') {
      await skipToAnonymous();
    } else {
      await completeWizard();
    }
    closeWizard();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ty-Code Setup Wizard"
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
          width: '780px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          backgroundColor: '#0b1329',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 32px rgba(99, 102, 241, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Top Progress & Header Bar */}
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.5)'
          }}
        >
          {/* Progress Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.2)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
                fontWeight: 700,
                fontSize: '13px'
              }}
            >
              <Sparkles size={15} />
            </div>

            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                Ty-Code Setup Wizard
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                Step {currentStepMeta.number} of {STEP_SEQUENCE.length}: {currentStepMeta.label}
              </div>
            </div>
          </div>

          {/* Stepper Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {STEP_SEQUENCE.map((s) => {
              const isPast = s.number < currentStepMeta.number;
              const isCurrent = s.id === currentStep;
              return (
                <div
                  key={s.id}
                  title={s.label}
                  style={{
                    width: isCurrent ? '20px' : '8px',
                    height: '8px',
                    borderRadius: '4px',
                    backgroundColor: isCurrent
                      ? 'var(--accent-primary, #6366f1)'
                      : isPast
                      ? 'rgba(16, 185, 129, 0.7)'
                      : 'rgba(255, 255, 255, 0.15)',
                    transition: 'all 0.2s ease'
                  }}
                />
              );
            })}
          </div>

          {/* Right Action: Never-Trapping Skip / Close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentStep !== 'skip_anonymous' && currentStep !== 'summary' && (
              <button
                type="button"
                onClick={() => void skipToAnonymous()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  textDecoration: 'underline',
                  transition: 'color 0.15s ease'
                }}
              >
                Skip (Use Anonymous)
              </button>
            )}

            <button
              type="button"
              onClick={closeWizard}
              title="Close wizard (Do this later)"
              aria-label="Close setup wizard"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                borderRadius: '6px',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '5px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            flex: 1
          }}
        >
          {/* STEP 1: WELCOME */}
          {currentStep === 'welcome' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', padding: '12px 0 8px 0' }}>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(168, 85, 247, 0.3))',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    color: '#c084fc',
                    boxShadow: '0 0 24px rgba(99, 102, 241, 0.25)'
                  }}
                >
                  <Code2 size={28} />
                </div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>
                  Welcome to Ty-Code
                </h1>
                <p style={{ margin: '8px auto 0 auto', maxWidth: '540px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                  Free AI models for coding, out of the box. Connect your own free accounts for the highest limits, or start instantly with anonymous access.
                </p>
              </div>

              {/* Value prop pillars */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '4px' }}>
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div style={{ color: '#818cf8', marginBottom: '8px' }}>
                    <Sparkles size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    15+ Free Models
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    DeepSeek R1, Qwen 2.5 Coder, Llama 3.3, and Gemini 2.0 Flash at zero cost.
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div style={{ color: '#34d399', marginBottom: '8px' }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    Local safeStorage
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Zero server storage. Credentials land strictly in your OS encrypted credential vault.
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div style={{ color: '#38bdf8', marginBottom: '8px' }}>
                    <Zap size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    Instant Fallback
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Zero-config anonymous tier keeps you coding even if you have no keys.
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '16px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <button
                  type="button"
                  onClick={() => void skipToAnonymous()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                    padding: '8px 12px'
                  }}
                >
                  Skip (Use Anonymous)
                </button>

                <button
                  type="button"
                  onClick={() => setStep('path_choice')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 24px',
                    borderRadius: '8px',
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
                  }}
                >
                  <span>Let&apos;s Go</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PATH CHOICE */}
          {currentStep === 'path_choice' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                  Choose Your Setup Path
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
                  Select how you want to power Ty-Code. You can switch or connect additional providers anytime in Settings.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Option 1: Connect Free Accounts */}
                <div
                  onClick={() => selectPath('free_accounts')}
                  role="button"
                  tabIndex={0}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(99, 102, 241, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#818cf8',
                      flexShrink: 0
                    }}
                  >
                    <Sparkles size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                        Connect Free Accounts
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: 'rgba(99, 102, 241, 0.2)',
                          color: '#a5b4fc',
                          fontWeight: 600
                        }}
                      >
                        Recommended (~2-3 min)
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                      Connect OpenRouter, Groq, and Google AI Studio for 15+ models, 10x higher rate limits, and full ownership under your own free developer quota.
                    </p>
                  </div>
                  <ChevronRight size={18} style={{ color: '#818cf8', marginTop: '10px' }} />
                </div>

                {/* Option 2: Local & Private */}
                <div
                  onClick={() => selectPath('local')}
                  role="button"
                  tabIndex={0}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(16, 185, 129, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#34d399',
                      flexShrink: 0
                    }}
                  >
                    <Server size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                        Local &amp; Private
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#34d399',
                          fontWeight: 600
                        }}
                      >
                        100% Offline
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                      Use Ollama on this machine. Zero telemetry, zero external network calls. Perfect for sensitive enterprise codebases.
                    </p>
                  </div>
                  <ChevronRight size={18} style={{ color: '#94a3b8', marginTop: '10px' }} />
                </div>

                {/* Option 3: Anonymous Skip */}
                <div
                  onClick={() => void skipToAnonymous()}
                  role="button"
                  tabIndex={0}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#38bdf8',
                      flexShrink: 0
                    }}
                  >
                    <Zap size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                        Anonymous (Instant Skip)
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          fontWeight: 600
                        }}
                      >
                        No Accounts Required
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                      Start coding immediately with 3 free models via OpenKilo gateway (~50 req/hour). No signups or credit cards needed.
                    </p>
                  </div>
                  <ChevronRight size={18} style={{ color: '#94a3b8', marginTop: '10px' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  onClick={() => setStep('welcome')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: '6px 10px'
                  }}
                >
                  ← Back to Welcome
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: OPENROUTER */}
          {currentStep === 'openrouter' && (
            <ProviderSetupStep
              providerId="openrouter"
              mode="wizard"
              onNext={() => setStep('groq')}
              onSkip={() => setStep('groq')}
              onBack={() => setStep('path_choice')}
            />
          )}

          {/* STEP 4: GROQ */}
          {currentStep === 'groq' && (
            <ProviderSetupStep
              providerId="groq"
              mode="wizard"
              onNext={() => setStep('google-gemini')}
              onSkip={() => setStep('google-gemini')}
              onBack={() => setStep('openrouter')}
            />
          )}

          {/* STEP 5: GOOGLE AI STUDIO */}
          {currentStep === 'google-gemini' && (
            <ProviderSetupStep
              providerId="google-gemini"
              mode="wizard"
              onNext={() => setStep('summary')}
              onSkip={() => setStep('summary')}
              onBack={() => setStep('groq')}
            />
          )}

          {/* LOCAL OLLAMA STEP */}
          {currentStep === 'ollama' && (
            <ProviderSetupStep
              providerId="ollama"
              mode="wizard"
              onNext={() => setStep('summary')}
              onSkip={() => setStep('summary')}
              onBack={() => setStep('path_choice')}
            />
          )}

          {/* SKIP FLOW: ANONYMOUS ACCESS ACTIVATED */}
          {currentStep === 'skip_anonymous' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', padding: '12px 0 4px 0' }}>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    color: '#38bdf8'
                  }}
                >
                  <Zap size={28} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>
                  Anonymous Access Activated
                </h2>
                <p style={{ margin: '8px auto 0 auto', maxWidth: '520px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                  You are ready to code immediately! We have enabled the Tier 0 anonymous gateway so you can ask coding questions and edit code without registering anywhere.
                </p>
              </div>

              {/* What you get breakdown */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  borderRadius: '10px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '10px' }}>
                  What you get with anonymous access:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.7 }}>
                  <li>
                    <strong>3 free models:</strong> DeepSeek R1, Qwen3 Coder, and Llama 3.3 70B via OpenKilo gateway.
                  </li>
                  <li>
                    <strong>Shared rate limits:</strong> ~50 requests per hour per instance.
                  </li>
                  <li>
                    <strong>Zero tracking:</strong> No account, no login, zero personally identifying info transmitted.
                  </li>
                  <li>
                    <strong>Upgrade anytime:</strong> Connect your own free accounts from the status bar or Settings for 10x higher quota.
                  </li>
                </ul>
              </div>

              {/* Action buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '16px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <button
                  type="button"
                  onClick={() => setStep('openrouter')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#818cf8',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '8px 12px'
                  }}
                >
                  Actually, Let Me Connect Accounts
                </button>

                <button
                  type="button"
                  onClick={() => void handleStartCoding()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 24px',
                    borderRadius: '8px',
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <span>Start Coding</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 6: SUMMARY ("YOU'RE ALL SET") */}
          {currentStep === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', padding: '12px 0 4px 0' }}>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    color: '#34d399'
                  }}
                >
                  <CheckCircle2 size={28} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>
                  You&apos;re All Set!
                </h2>
                <p style={{ margin: '8px auto 0 auto', maxWidth: '520px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                  Your provider configuration is active. Credentials are encrypted in your OS safeStorage, and anonymous fallback is ready if any provider runs out of quota.
                </p>
              </div>

              {/* Connected providers review */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  borderRadius: '10px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '10px' }}>
                  Active Provisioning Summary:
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {connectedProviders.length > 0 ? (
                    connectedProviders.map((pId) => {
                      const pConfig = PROVIDER_CATALOG[pId];
                      return (
                        <div
                          key={pId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'rgba(15, 23, 42, 0.6)',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle2 size={14} color="#10b981" />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                              {pConfig?.name || pId.toUpperCase()}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {pConfig?.freeModels.length || 1} models active
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: 'rgba(56, 189, 248, 0.1)',
                        color: '#38bdf8',
                        fontSize: '12px'
                      }}
                    >
                      No custom keys configured — running on <strong>Tier 0 Anonymous Access</strong>.
                    </div>
                  )}

                  {/* Always-available anonymous backup indicator */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.3)',
                      border: '1px dashed rgba(255, 255, 255, 0.1)',
                      fontSize: '11px',
                      color: '#94a3b8'
                    }}
                  >
                    <span>🛡️ Tier 0 Anonymous Gateway</span>
                    <span style={{ color: '#10b981' }}>Always Standby Fallback</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingTop: '16px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleStartCoding()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 24px',
                    borderRadius: '8px',
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <span>Start Coding</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
