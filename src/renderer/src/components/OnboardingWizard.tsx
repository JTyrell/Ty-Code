/**
 * OnboardingWizard Component (Phase FCC-2)
 *
 * FCC-First Onboarding with Subscription + Harness Import:
 * 1. welcome: Introduces the free model supply layer (61 providers, 1.3B+ free tokens/month).
 *             Credit line visible in splash. Actions: ["Set Up Free Supply", "Skip (Anonymous Only)"].
 * 2. auto_setup: Progress screen: verifying embedded supply -> loading catalog -> health-checking top providers.
 *                Displays live count of free models discovered. Runs FCC-1 bootstrap without user action needed.
 * 3. subscriptions: Unlock pro-class models at $0: connect accounts you already have (GitHub Copilot, ChatGPT/OpenAI, Skip).
 *                   Device-code / PKCE authentication per FCC-3.
 * 4. harness_import: We found existing AI tool configs on this machine. Detects ~/.claude, ~/.codex, ~/.config/opencode, aider;
 *                    offers import of model preferences and compatible credentials via safeStorage;
 *                    lists the 11 FCC-supported harnesses Ty-Code can drive. Options: ["Import", "Skip"].
 * 5. summary: Supply active: N free models • subscriptions: list • harnesses: list • credit line 'powered by free-claude-code'.
 *             Action: ["Start Coding"].
 *
 * Non-trapping architecture:
 * - Interruptible and resumable anytime.
 * - Never blocks the workbench.
 * - Skip path activates anonymous tier instantly with honest limits; status chip offers 'Enable full free supply' forever after.
 * - Re-runnable from Settings.
 * - Credit line visible in splash and summary.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import React, { useEffect, useCallback, useState } from 'react';
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
  Code2,
  Terminal,
  Laptop,
  Check,
  Download,
  Key,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { useOnboardingStore, type OnboardingStepId } from '../state/onboarding-store';
import { useChatStore } from '../state/chat-store';
import type { DetectedHarnessConfig, HarnessMetadata } from '../../../preload/types';

const STEP_SEQUENCE: { id: OnboardingStepId; label: string; number: number }[] = [
  { id: 'welcome', label: 'Welcome', number: 1 },
  { id: 'auto_setup', label: 'Free Supply', number: 2 },
  { id: 'subscriptions', label: 'Subscriptions', number: 3 },
  { id: 'harness_import', label: 'Import Tools', number: 4 },
  { id: 'summary', label: 'All Set', number: 5 }
];

const FCC_CREDIT_STRING =
  'Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code';

const DEFAULT_11_HARNESSES: { id: string; name: string; cliName: string; desc: string }[] = [
  { id: 'claude-code', name: 'Claude Code', cliName: 'claude', desc: 'Anthropic agentic CLI with bash tool execution' },
  { id: 'codex', name: 'OpenAI Codex', cliName: 'codex', desc: 'OpenAI agentic CLI with function calling & diff generation' },
  { id: 'opencode', name: 'OpenCode', cliName: 'opencode', desc: 'OpenCode terminal companion & multi-provider bridge' },
  { id: 'pi', name: 'Pi Agent', cliName: 'pi', desc: 'Minimalist autonomous loop agent harness' },
  { id: 'cline', name: 'Cline', cliName: 'cline', desc: 'Autonomous coding agent supporting Plan & Act workflows' },
  { id: 'aider', name: 'Aider', cliName: 'aider', desc: 'AI pair programming CLI in terminal with git repo awareness' },
  { id: 'hermes', name: 'Hermes', cliName: 'hermes', desc: 'Multi-step reasoning agent with search & python execution' },
  { id: 'deepseek', name: 'DeepSeek CLI', cliName: 'deepseek', desc: 'DeepSeek Coder / R1 native agent harness' },
  { id: 'grok-build', name: 'Grok Build', cliName: 'grok', desc: 'xAI Grok coding & build assistant harness' },
  { id: 'muse-code', name: 'Muse Code', cliName: 'muse', desc: 'Creative synthesis & architecture exploration harness' },
  { id: 'vscode-chat', name: 'VS Code Chat', cliName: 'code-chat', desc: 'VS Code language model chat participant protocol' }
];

export const OnboardingWizard: React.FC = () => {
  const {
    isOpen,
    currentStep,
    connectedProviders,
    connectedSubscriptions,
    importedHarnesses,
    discoveredFreeModelsCount,
    autoSetupStatus,
    autoSetupLogs,
    openWizard,
    closeWizard,
    setStep,
    skipToAnonymous,
    completeWizard,
    startAutoSetup,
    connectSubscription,
    importHarness
  } = useOnboardingStore();

  const { settings } = useChatStore();

  // Local state for harness detection & subscription connection
  const [detectedConfigs, setDetectedConfigs] = useState<DetectedHarnessConfig[]>([]);
  const [supportedHarnesses, setSupportedHarnesses] = useState<HarnessMetadata[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [connectingSub, setConnectingSub] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

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

  // Run auto_setup bootstrap when entering auto_setup step
  useEffect(() => {
    if (isOpen && currentStep === 'auto_setup' && autoSetupStatus === 'idle') {
      void startAutoSetup();
    }
  }, [isOpen, currentStep, autoSetupStatus, startAutoSetup]);

  // Detect local AI tool configs when entering harness_import step
  useEffect(() => {
    if (isOpen && currentStep === 'harness_import') {
      setLoadingConfigs(true);
      Promise.all([
        window.electronAPI?.fccDetectHarnessConfigs?.() || Promise.resolve({ success: true, data: [] }),
        window.electronAPI?.fccGetSupportedHarnesses?.() || Promise.resolve({ success: true, data: [] })
      ])
        .then(([configsRes, harnessesRes]) => {
          if (configsRes?.success && Array.isArray(configsRes.data)) {
            setDetectedConfigs(configsRes.data);
          }
          if (harnessesRes?.success && Array.isArray(harnessesRes.data)) {
            setSupportedHarnesses(harnessesRes.data);
          }
        })
        .catch(() => {
          // Non-blocking fallback
        })
        .finally(() => {
          setLoadingConfigs(false);
        });
    }
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const currentStepMeta = STEP_SEQUENCE.find((s) => s.id === currentStep) || {
    id: currentStep,
    label: currentStep === 'skip_anonymous' ? 'Anonymous Tier' : 'Setup',
    number: currentStep === 'skip_anonymous' ? 1 : 1
  };

  const handleStartCoding = async () => {
    if (currentStep === 'skip_anonymous') {
      await skipToAnonymous();
    } else {
      await completeWizard();
    }
    closeWizard();
  };

  const handleConnectSubscription = async (subId: 'copilot' | 'chatgpt') => {
    setConnectingSub(subId);
    try {
      await connectSubscription(subId);
    } finally {
      setConnectingSub(null);
    }
  };

  const handleImportSingle = async (cfg: DetectedHarnessConfig) => {
    setImportingId(cfg.id);
    try {
      await importHarness(cfg);
    } finally {
      setImportingId(null);
    }
  };

  const handleImportAll = async () => {
    for (const cfg of detectedConfigs) {
      await importHarness(cfg);
    }
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
          width: '820px',
          maxWidth: '95vw',
          maxHeight: '92vh',
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
                {currentStep === 'skip_anonymous'
                  ? 'Anonymous Tier (Standby)'
                  : `Step ${currentStepMeta.number} of ${STEP_SEQUENCE.length}: ${currentStepMeta.label}`}
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
                    width: isCurrent ? '22px' : '8px',
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

          {/* Right Action: Non-trapping Skip / Close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentStep !== 'skip_anonymous' && currentStep !== 'summary' && (
              <button
                type="button"
                id="wizard-skip-anonymous-btn"
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
                Skip (Anonymous Only)
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
              <div style={{ textAlign: 'center', padding: '8px 0 4px 0' }}>
                <div
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '18px',
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.35), rgba(168, 85, 247, 0.35))',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    color: '#c084fc',
                    boxShadow: '0 0 28px rgba(99, 102, 241, 0.3)'
                  }}
                >
                  <Code2 size={32} />
                </div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>
                  Welcome to Ty-Code
                </h1>
                <p
                  id="welcome-content-text"
                  style={{
                    margin: '10px auto 0 auto',
                    maxWidth: '620px',
                    fontSize: '14px',
                    color: '#e2e8f0',
                    lineHeight: 1.6,
                    fontWeight: 500
                  }}
                >
                  Ty-Code ships with a free model supply layer (powered by free-claude-code): 61 providers, 1.3B+ free tokens/month. Setup takes under a minute.
                </p>

                <div style={{ marginTop: '8px', fontSize: '12px', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <Sparkles size={13} />
                  <span>Connecting your free model supply (powered by free-claude-code)</span>
                </div>

                {/* Splash Credit Line */}
                <div
                  id="splash-credit-line"
                  style={{
                    margin: '12px auto 0 auto',
                    maxWidth: '680px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    fontSize: '11px',
                    color: '#a5b4fc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Sparkles size={13} color="#818cf8" />
                  <span>
                    Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
                    <a
                      href="https://github.com/Alishahryar1/free-claude-code"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#c7d2fe', textDecoration: 'underline' }}
                    >
                      https://github.com/Alishahryar1/free-claude-code
                    </a>
                  </span>
                </div>
              </div>

              {/* Value prop pillars */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '4px' }}>
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.07)'
                  }}
                >
                  <div style={{ color: '#818cf8', marginBottom: '8px' }}>
                    <Server size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    61 Free Providers
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Zero-key access across Gemini, Groq, Mistral, Cerebras, OpenRouter, and more with zero server storage.
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.07)'
                  }}
                >
                  <div style={{ color: '#34d399', marginBottom: '8px' }}>
                    <Zap size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    1.3B+ Monthly Tokens
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Aggregate allowance for pro-grade development with reasoning, coding, and large context windows.
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(30, 41, 59, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.07)'
                  }}
                >
                  <div style={{ color: '#38bdf8', marginBottom: '8px' }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                    SafeStorage Sealed
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Hardware-backed OS vault encryption for your subscriptions and existing tool credentials.
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
                  id="action-skip-anonymous"
                  onClick={() => void skipToAnonymous()}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                    padding: '9px 16px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Skip (Anonymous Only)
                </button>

                <button
                  type="button"
                  id="action-setup-free-supply"
                  onClick={() => setStep('auto_setup')}
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
                  <span>Set Up Free Supply</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: AUTO SETUP PROGRESS SCREEN */}
          {currentStep === 'auto_setup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                    Provisioning Embedded Free Supply Layer
                  </h2>
                  <div
                    id="auto-setup-models-badge"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 12px',
                      borderRadius: '999px',
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      color: '#34d399',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                  >
                    <Sparkles size={14} />
                    <span>{discoveredFreeModelsCount} Free Models Discovered</span>
                  </div>
                </div>
                <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Verifying embedded supply → loading catalog → health-checking top providers; shows live count of free models discovered.
                </p>
              </div>

              {/* Step progression cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background:
                      autoSetupStatus !== 'idle'
                        ? 'rgba(16, 185, 129, 0.08)'
                        : 'rgba(30, 41, 59, 0.4)',
                    border:
                      autoSetupStatus !== 'idle'
                        ? '1px solid rgba(16, 185, 129, 0.3)'
                        : '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div style={{ color: autoSetupStatus !== 'idle' ? '#10b981' : '#94a3b8' }}>
                    {autoSetupStatus !== 'idle' ? <CheckCircle2 size={18} /> : <Server size={18} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                      1. Verifying Embedded Supply Layer
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      FCC loopback daemon binary verification & SHA-256 integrity check
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color: autoSetupStatus !== 'idle' ? '#34d399' : '#64748b',
                      fontWeight: 600
                    }}
                  >
                    {autoSetupStatus === 'idle' ? 'Pending' : 'Verified'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background:
                      autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready'
                        ? 'rgba(16, 185, 129, 0.08)'
                        : autoSetupStatus === 'loading'
                        ? 'rgba(99, 102, 241, 0.1)'
                        : 'rgba(30, 41, 59, 0.4)',
                    border:
                      autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready'
                        ? '1px solid rgba(16, 185, 129, 0.3)'
                        : autoSetupStatus === 'loading'
                        ? '1px solid rgba(99, 102, 241, 0.3)'
                        : '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div
                    style={{
                      color:
                        autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready'
                          ? '#10b981'
                          : autoSetupStatus === 'loading'
                          ? '#818cf8'
                          : '#94a3b8'
                    }}
                  >
                    {autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready' ? (
                      <CheckCircle2 size={18} />
                    ) : autoSetupStatus === 'loading' ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <Layers size={18} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                      2. Loading 61-Provider Model Catalog
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Indexing 68+ models across Groq, Gemini, Mistral, Cerebras, OpenRouter
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color:
                        autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready'
                          ? '#34d399'
                          : autoSetupStatus === 'loading'
                          ? '#818cf8'
                          : '#64748b',
                      fontWeight: 600
                    }}
                  >
                    {autoSetupStatus === 'health_checking' || autoSetupStatus === 'ready'
                      ? 'Catalog Loaded'
                      : autoSetupStatus === 'loading'
                      ? 'Loading...'
                      : 'Pending'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background:
                      autoSetupStatus === 'ready'
                        ? 'rgba(16, 185, 129, 0.08)'
                        : autoSetupStatus === 'health_checking'
                        ? 'rgba(99, 102, 241, 0.1)'
                        : 'rgba(30, 41, 59, 0.4)',
                    border:
                      autoSetupStatus === 'ready'
                        ? '1px solid rgba(16, 185, 129, 0.3)'
                        : autoSetupStatus === 'health_checking'
                        ? '1px solid rgba(99, 102, 241, 0.3)'
                        : '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div
                    style={{
                      color:
                        autoSetupStatus === 'ready'
                          ? '#10b981'
                          : autoSetupStatus === 'health_checking'
                          ? '#818cf8'
                          : '#94a3b8'
                    }}
                  >
                    {autoSetupStatus === 'ready' ? (
                      <CheckCircle2 size={18} />
                    ) : autoSetupStatus === 'health_checking' ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <Cpu size={18} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                      3. Health-Checking Top Providers
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Verifying ping latency, quota buffers, and ToS compliance flags
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color:
                        autoSetupStatus === 'ready'
                          ? '#34d399'
                          : autoSetupStatus === 'health_checking'
                          ? '#818cf8'
                          : '#64748b',
                      fontWeight: 600
                    }}
                  >
                    {autoSetupStatus === 'ready'
                      ? 'Healthy'
                      : autoSetupStatus === 'health_checking'
                      ? 'Checking...'
                      : 'Pending'}
                  </span>
                </div>
              </div>

              {/* Live Bootstrap Output Logs */}
              <div
                style={{
                  background: 'rgba(10, 15, 29, 0.75)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#94a3b8',
                  maxHeight: '120px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                <div style={{ color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={12} />
                  <span>Bootstrap Log Output:</span>
                </div>
                {autoSetupLogs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('ready') || log.includes('Discovered') ? '#34d399' : '#cbd5e1' }}>
                    {log}
                  </div>
                ))}
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
                  id="action-auto-setup-continue"
                  onClick={() => setStep('subscriptions')}
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
                  <span>{autoSetupStatus === 'ready' ? 'Continue to Subscriptions' : 'Next'}</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SUBSCRIPTIONS */}
          {currentStep === 'subscriptions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                  Unlock Pro-Class Models at $0
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
                  Unlock pro-class models at $0: connect accounts you already have. Device-code / PKCE authentication per FCC-3.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Option 1: GitHub Copilot */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot'))
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(30, 41, 59, 0.45)',
                    border: connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot'))
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        background: 'rgba(99, 102, 241, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#818cf8',
                        flexShrink: 0
                      }}
                    >
                      <Code2 size={20} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                          GitHub Copilot (free for students/OSS)
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
                          $0 Free Tier
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                        Connect via local Copilot auth or GitHub device-code. Access Claude 3.5 Sonnet, GPT-4o, and o1.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="connect-copilot-btn"
                    disabled={connectingSub === 'copilot'}
                    onClick={() => void handleConnectSubscription('copilot')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot'))
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(99, 102, 241, 0.2)',
                      border: connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot'))
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(99, 102, 241, 0.4)',
                      color: connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot'))
                        ? '#34d399'
                        : '#818cf8',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {connectedSubscriptions.some((s) => s.toLowerCase().includes('copilot')) ? (
                      <>
                        <Check size={14} />
                        <span>Connected</span>
                      </>
                    ) : connectingSub === 'copilot' ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <span>Connect</span>
                    )}
                  </button>
                </div>

                {/* Option 2: ChatGPT / OpenAI */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt'))
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(30, 41, 59, 0.45)',
                    border: connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt'))
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        background: 'rgba(56, 189, 248, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#38bdf8',
                        flexShrink: 0
                      }}
                    >
                      <Zap size={20} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                          ChatGPT/OpenAI
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
                          Plus / Team
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                        Link your existing ChatGPT Plus or Team account through OAuth device PKCE authorization.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="connect-chatgpt-btn"
                    disabled={connectingSub === 'chatgpt'}
                    onClick={() => void handleConnectSubscription('chatgpt')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt'))
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(56, 189, 248, 0.2)',
                      border: connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt'))
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(56, 189, 248, 0.4)',
                      color: connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt'))
                        ? '#34d399'
                        : '#38bdf8',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {connectedSubscriptions.some((s) => s.toLowerCase().includes('chatgpt')) ? (
                      <>
                        <Check size={14} />
                        <span>Connected</span>
                      </>
                    ) : connectingSub === 'chatgpt' ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <span>Connect</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Info safeStorage note */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px dashed rgba(255, 255, 255, 0.1)',
                  fontSize: '11px',
                  color: '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <ShieldCheck size={15} color="#34d399" />
                <span>
                  All tokens land directly in your operating system&apos;s safeStorage vault (DPAPI / Keychain / Secret Service).
                </span>
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
                  id="action-subscriptions-skip"
                  onClick={() => setStep('harness_import')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                    padding: '8px 12px'
                  }}
                >
                  Skip
                </button>

                <button
                  type="button"
                  id="action-subscriptions-continue"
                  onClick={() => setStep('harness_import')}
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
                  <span>Next: Import Tools</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: HARNESS CONFIG IMPORT */}
          {currentStep === 'harness_import' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                  We found existing AI tool configs on this machine
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
                  Detect ~/.claude, ~/.codex, ~/.config/opencode, aider config files; offer import of model preferences and compatible credentials via safeStorage; list the 11 FCC-supported harnesses Ty-Code can drive.
                </p>
              </div>

              {/* Detected Configs List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Detected CLI Tool Configurations:</span>
                  {detectedConfigs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleImportAll()}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#818cf8',
                        fontSize: '11px',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                      }}
                    >
                      Import All Detected
                    </button>
                  )}
                </div>

                {loadingConfigs ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                    <RefreshCw size={16} className="animate-spin" style={{ margin: '0 auto 8px auto' }} />
                    Scanning ~/.claude, ~/.codex, ~/.config/opencode, and ~/.aider...
                  </div>
                ) : detectedConfigs.length > 0 ? (
                  detectedConfigs.map((cfg) => {
                    const isImported = importedHarnesses.some((h) => h.includes(cfg.name));
                    return (
                      <div
                        key={cfg.id}
                        id={`detected-harness-${cfg.id}`}
                        style={{
                          padding: '12px 16px',
                          borderRadius: '10px',
                          background: isImported ? 'rgba(16, 185, 129, 0.08)' : 'rgba(30, 41, 59, 0.45)',
                          border: isImported
                            ? '1px solid rgba(16, 185, 129, 0.35)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <FolderOpen size={18} color="#818cf8" />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                                {cfg.name}
                              </span>
                              <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                                {cfg.configPath}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
                              {cfg.modelPreference && (
                                <span style={{ marginRight: '10px' }}>
                                  Preferred Model: <strong>{cfg.modelPreference}</strong>
                                </span>
                              )}
                              {cfg.credentialSummary && (
                                <span style={{ color: '#34d399' }}>
                                  • {cfg.credentialSummary}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          id={`import-btn-${cfg.id}`}
                          disabled={importingId === cfg.id || isImported}
                          onClick={() => void handleImportSingle(cfg)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '6px',
                            background: isImported
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'rgba(99, 102, 241, 0.2)',
                            border: isImported
                              ? '1px solid rgba(16, 185, 129, 0.4)'
                              : '1px solid rgba(99, 102, 241, 0.4)',
                            color: isImported ? '#34d399' : '#818cf8',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: isImported ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {isImported ? (
                            <>
                              <Check size={13} />
                              <span>Imported</span>
                            </>
                          ) : importingId === cfg.id ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              <span>Importing...</span>
                            </>
                          ) : (
                            <span>Import</span>
                          )}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      background: 'rgba(15, 23, 42, 0.4)',
                      border: '1px dashed rgba(255, 255, 255, 0.1)',
                      color: '#94a3b8',
                      fontSize: '12px',
                      textAlign: 'center'
                    }}
                  >
                    No prior AI tool configs found on this machine. Ty-Code will use optimal clean defaults.
                  </div>
                )}
              </div>

              {/* 11 Supported Coding Agent Harnesses Grid */}
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                  11 FCC-Supported Agent Harnesses Ty-Code Can Drive:
                </div>
                <div
                  id="fcc-supported-harnesses-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                    gap: '8px'
                  }}
                >
                  {DEFAULT_11_HARNESSES.map((h) => (
                    <div
                      key={h.id}
                      title={h.desc}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: 'rgba(15, 23, 42, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
                          {h.name}
                        </span>
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: '#a5b4fc'
                          }}
                        >
                          CLI
                        </span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
                        ${h.cliName}
                      </span>
                    </div>
                  ))}
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
                  id="action-harness-skip"
                  onClick={() => setStep('summary')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                    padding: '8px 12px'
                  }}
                >
                  Skip
                </button>

                <button
                  type="button"
                  id="action-harness-continue"
                  onClick={() => setStep('summary')}
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
                  <span>Next: Summary</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: SUMMARY ("YOU'RE ALL SET") */}
          {currentStep === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', padding: '10px 0 4px 0' }}>
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
                    margin: '0 auto 14px auto',
                    color: '#34d399'
                  }}
                >
                  <CheckCircle2 size={28} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>
                  You&apos;re All Set!
                </h2>
                <p
                  id="summary-supply-active-line"
                  style={{
                    margin: '8px auto 0 auto',
                    maxWidth: '640px',
                    fontSize: '13px',
                    color: '#cbd5e1',
                    lineHeight: 1.6
                  }}
                >
                  Supply active: {discoveredFreeModelsCount} free models • subscriptions:{' '}
                  {connectedSubscriptions.length > 0 ? connectedSubscriptions.join(', ') : 'None'} • harnesses:{' '}
                  {importedHarnesses.length > 0 ? importedHarnesses.join(', ') : '11 FCC harnesses supported'} • credit line &apos;powered by free-claude-code&apos;
                </p>
              </div>

              {/* Connected provisioning review */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.45)',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                  Provisioned Model Fleet & Toolchains:
                </div>

                {/* Free Model Supply Layer Item */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={16} color="#818cf8" />
                    <span style={{ color: '#f8fafc', fontWeight: 600 }}>
                      Free Model Supply Layer (61 Providers, 1.3B+ tokens/mo)
                    </span>
                  </div>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>
                    {discoveredFreeModelsCount} Models Ready
                  </span>
                </div>

                {/* Subscriptions Item */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Key size={16} color="#38bdf8" />
                    <span style={{ color: '#f8fafc' }}>Subscriptions:</span>
                  </div>
                  <span style={{ color: connectedSubscriptions.length > 0 ? '#34d399' : '#94a3b8' }}>
                    {connectedSubscriptions.length > 0
                      ? connectedSubscriptions.join(', ')
                      : 'None (can connect anytime in Settings)'}
                  </span>
                </div>

                {/* Harnesses Item */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Terminal size={16} color="#a855f7" />
                    <span style={{ color: '#f8fafc' }}>Harnesses:</span>
                  </div>
                  <span style={{ color: '#c084fc' }}>
                    {importedHarnesses.length > 0
                      ? importedHarnesses.join(', ')
                      : '11 FCC coding agent harnesses ready to drive'}
                  </span>
                </div>

                {/* Standby Anonymous Fallback */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(15, 23, 42, 0.3)',
                    border: '1px dashed rgba(255, 255, 255, 0.08)',
                    fontSize: '11px',
                    color: '#94a3b8'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={14} color="#10b981" />
                    <span>Tier 0 Anonymous Gateway</span>
                  </div>
                  <span style={{ color: '#10b981' }}>Always Standby Fallback</span>
                </div>
              </div>

              {/* Attribution Credit Line in Summary */}
              <div
                id="summary-credit-line"
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  fontSize: '11px',
                  color: '#a5b4fc',
                  textAlign: 'center'
                }}
              >
                Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
                <a
                  href="https://github.com/Alishahryar1/free-claude-code"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#c7d2fe', textDecoration: 'underline' }}
                >
                  https://github.com/Alishahryar1/free-claude-code
                </a>
              </div>

              {/* Actions */}
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
                  id="action-start-coding"
                  onClick={() => void handleStartCoding()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 28px',
                    borderRadius: '8px',
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)'
                  }}
                >
                  <span>Start Coding</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* SKIP / ANONYMOUS ONLY VIEW (IF OPENED DIRECTLY) */}
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
                  <ShieldCheck size={28} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>
                  Anonymous Mode Active
                </h2>
                <p style={{ margin: '8px auto 0 auto', maxWidth: '520px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                  You are coding with zero setup. You have an honest limit of 20 requests per hour. You can upgrade to the full 61-provider free supply at any time.
                </p>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  borderRadius: '10px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '12px',
                  color: '#94a3b8'
                }}
              >
                <div style={{ color: '#f8fafc', fontWeight: 600, marginBottom: '4px' }}>
                  Honest Limits on Anonymous Tier:
                </div>
                <div>• Rate Limit: 20 requests / hour</div>
                <div>• Token Supply: Tier 0 anonymous pool</div>
                <div>• &apos;Enable full free supply&apos; button remains in your Status Bar anytime you want 1.3B+ tokens.</div>
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
                  id="action-enable-full-supply"
                  onClick={() => setStep('welcome')}
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
                  Set Up Free Supply
                </button>

                <button
                  type="button"
                  id="action-start-coding-anon"
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
