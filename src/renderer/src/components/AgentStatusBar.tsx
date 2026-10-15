import React, { useState } from 'react';
import { Hammer, Compass, ChevronDown, Check, Activity, ShieldAlert, Zap } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import type { AgentMode } from '../../../preload/types';

export const AgentStatusBar: React.FC = () => {
  const { agentMode, setAgentMode, contextTokens, contextLimit, isRunning } = useChatStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const usageRatio = Math.min(1, contextTokens / (contextLimit || 128_000));
  const usagePercent = Math.round(usageRatio * 100);
  const isNearLimit = usagePercent >= 90;
  const isAutoCompact = usagePercent >= 95;

  const modeConfig = {
    build: {
      label: 'Build Agent',
      shortLabel: 'Build',
      desc: 'Full Access • Files, Edits, Bash',
      color: '#3b82f6',
      icon: Hammer
    },
    plan: {
      label: 'Plan Agent',
      shortLabel: 'Plan',
      desc: 'Read-Only • Exploration, Guarded Bash',
      color: '#f59e0b',
      icon: Compass
    },
    general: {
      label: 'General Subagent',
      shortLabel: 'General',
      desc: 'Search & Multi-Step Discovery',
      color: '#8b5cf6',
      icon: Zap
    }
  }[agentMode];

  const IconComponent = modeConfig.icon;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* Agent Mode Switcher Trigger */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={`OpenCode ${modeConfig.label} (${modeConfig.desc}). Click to toggle mode.`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: menuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
          color: modeConfig.color,
          border: 'none',
          cursor: isRunning ? 'default' : 'pointer',
          fontSize: '11px',
          fontWeight: 600
        }}
      >
        <IconComponent size={12} color={modeConfig.color} />
        <span>{modeConfig.shortLabel}</span>
        <ChevronDown size={10} style={{ opacity: 0.7 }} />
      </button>

      {/* Context Window Usage Gauge */}
      <div
        title={`Context Usage: ${(contextTokens / 1000).toFixed(1)}k / ${(contextLimit / 1000).toFixed(0)}k tokens (${usagePercent}%). Auto-compact triggers at 95%.`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '10px',
          color: isAutoCompact ? '#ef4444' : isNearLimit ? '#f59e0b' : 'var(--text-muted)',
          padding: '1px 5px',
          borderRadius: '3px',
          background: isNearLimit ? 'rgba(245, 158, 11, 0.1)' : 'transparent'
        }}
      >
        <Activity size={10} />
        <span>{usagePercent}% ctx</span>
        {/* Tiny gauge bar */}
        <div
          style={{
            width: '28px',
            height: '4px',
            background: 'rgba(255,255,255,0.15)',
            borderRadius: '2px',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${usagePercent}%`,
              height: '100%',
              background: isAutoCompact ? '#ef4444' : isNearLimit ? '#f59e0b' : 'var(--accent-primary)',
              transition: 'width 0.3s ease'
            }}
          />
        </div>
      </div>

      {/* Popover Menu */}
      {menuOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '26px',
              left: 0,
              width: '240px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '6px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              padding: '6px',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <div
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              OpenCode Framework Agents
            </div>

            {(['build', 'plan', 'general'] as AgentMode[]).map((mode) => {
              const cfg = {
                build: {
                  title: 'Build Agent',
                  tag: 'Full Access (Default)',
                  desc: 'Read, write, edit, patch files, run tests and commands.',
                  color: '#3b82f6',
                  icon: Hammer
                },
                plan: {
                  title: 'Plan Agent',
                  tag: 'Read-Only Exploration',
                  desc: 'Refuses file mutations; requires permission for shell execution.',
                  color: '#f59e0b',
                  icon: Compass
                },
                general: {
                  title: 'General Subagent',
                  tag: 'Deep Code Search',
                  desc: 'Fast discovery, grep/glob search, and architectural analysis.',
                  color: '#8b5cf6',
                  icon: Zap
                }
              }[mode];

              const ModeIcon = cfg.icon;
              const isSelected = agentMode === mode;

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setAgentMode(mode);
                    setMenuOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '4px',
                    background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'inherit'
                  }}
                >
                  <ModeIcon size={14} color={cfg.color} style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: cfg.color }}>{cfg.title}</span>
                      {isSelected && <Check size={12} color="var(--accent-primary)" />}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '1px 0' }}>{cfg.tag}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{cfg.desc}</div>
                  </div>
                </button>
              );
            })}

            <div
              style={{
                marginTop: '4px',
                paddingTop: '6px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '10px',
                color: 'var(--text-muted)',
                paddingLeft: '6px'
              }}
            >
              Auto-compaction active at 95% context window.
            </div>
          </div>
        </>
      )}
    </div>
  );
};
