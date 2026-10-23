import React, { useState } from 'react';
import {
  Sparkles,
  Code2,
  GitBranch,
  Terminal,
  Layers,
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle2,
  Zap
} from 'lucide-react';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TourStep {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  content: string;
  badge?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Ty-Code',
    subtitle: 'The Next-Generation AI-Native Desktop IDE',
    badge: 'Introduction',
    icon: <Sparkles size={28} color="var(--accent-primary)" />,
    content:
      'Ty-Code combines the performance of Monaco Editor with autonomous AI agent capabilities, cross-platform terminal emulator, and native Git integration. Let’s take a 30-second tour of what’s inside!'
  },
  {
    title: 'Monaco Editor & Language Server Protocol',
    subtitle: 'Full IntelliSense, Diagnostics, and Code Navigation',
    badge: 'Phase 5: LSP',
    icon: <Code2 size={28} color="var(--accent-cyan)" />,
    content:
      'Enjoy real-time type checking, go-to-definition, find references, rename symbol, and diagnostics for TypeScript, JavaScript, Python, Rust, Go, Java, and C/C++ backed by auto-detected language servers with Monaco fallback.'
  },
  {
    title: 'Autonomous AI Copilot Sidecar',
    subtitle: 'Agentic Tool Loop with In-place Diff Review',
    badge: 'AI Engine',
    icon: <Sparkles size={28} color="var(--accent-green)" />,
    content:
      'The AI Agent sidecar can read and write files, execute CLI commands, and generate proposed unified diffs that you can visually inspect, accept, or reject with a single click.'
  },
  {
    title: 'OpenCode Free Models & Multi-Agent Framework',
    subtitle: 'Built-in Free Coding Supply & Flexible Agent Modes',
    badge: 'Free Tier & Agents',
    icon: <Zap size={28} color="var(--accent-cyan)" />,
    content:
      'Code immediately with zero API keys using Ty-Code’s built-in OpenCode Zen supply and OpenKilo gateway. Switch between Collaborative pair-programming and Autonomous 3-agent harness (Build, Plan, General) anytime in Settings.'
  },
  {
    title: 'Git Integration & Visual Diff',
    subtitle: 'Professional Source Control Panel',
    badge: 'Phase 3: Git',
    icon: <GitBranch size={28} color="var(--accent-amber)" />,
    content:
      'Stage and unstage individual files or hunks, view line-by-line diffs, commit with conventional messages, manage branches, and view interactive commit history right inside the sidebar.'
  },
  {
    title: 'Cross-Platform Integrated Terminal',
    subtitle: 'Multi-Tab PTY with Split-Pane Support',
    badge: 'Phase 2: Terminal',
    icon: <Terminal size={28} color="var(--accent-cyan)" />,
    content:
      'Launch PowerShell, CMD, Bash, or WSL sessions with ANSI color rendering, history persistence across restarts, horizontal/vertical split panes, and shell profile customization.'
  },
  {
    title: 'Extension Gallery',
    subtitle: 'Built-in Tools & Community Listings',
    badge: 'Phase 4: Plugins',
    icon: <Layers size={28} color="var(--accent-primary)" />,
    content:
      'Browse community listings, save extension metadata for reference, and configure trusted built-in tools. Community package code and local bundles are not executed.'
  }
];

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '540px',
          maxWidth: '100%',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-strong)',
          borderRadius: '12px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'modalFadeIn 0.2s ease-out'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-3)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--accent-primary)',
                letterSpacing: '0.04em'
              }}
            >
              {step.badge}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Step {currentStep + 1} of {TOUR_STEPS.length}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Tour"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)'
            }}
          >
            {step.icon}
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>
              {step.title}
            </h2>
            <p style={{ fontSize: '12px', fontWeight: 500, margin: 0, color: 'var(--accent-primary)' }}>
              {step.subtitle}
            </p>
          </div>
          <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0, maxWidth: '440px' }}>
            {step.content}
          </p>

          {/* Stepper Dots */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            {TOUR_STEPS.map((_, idx) => (
              <div
                key={idx}
                onClick={() => setCurrentStep(idx)}
                style={{
                  width: idx === currentStep ? '20px' : '6px',
                  height: '6px',
                  borderRadius: '3px',
                  backgroundColor: idx === currentStep ? 'var(--accent-primary)' : 'var(--border-strong)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            backgroundColor: 'var(--bg-tertiary)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Skip Tour
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!isFirst && (
              <button
                onClick={handlePrev}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 16px',
                backgroundColor: 'var(--accent-primary)',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {isLast ? (
                <>
                  <CheckCircle2 size={14} /> Get Started
                </>
              ) : (
                <>
                  Next <ChevronRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
