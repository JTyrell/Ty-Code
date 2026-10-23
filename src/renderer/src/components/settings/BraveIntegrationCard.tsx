/**
 * Brave Browser Integration Settings Card
 *
 * Provides detection status, seamless installation initiation, and isolated
 * Guest Mode toggling for Brave Browser in Ty-Code.
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Lock,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  Check,
  AlertCircle,
  Globe,
  Sparkles,
  Zap,
  Loader2
} from 'lucide-react';
import { toast } from '../../state/toast-store';

export interface BraveIntegrationCardProps {
  className?: string;
  style?: React.CSSProperties;
  onStatusChange?: (status: { installed: boolean; enabled: boolean }) => void;
}

export const BraveIntegrationCard: React.FC<BraveIntegrationCardProps> = ({
  className = '',
  style
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [installed, setInstalled] = useState<boolean>(false);
  const [executablePath, setExecutablePath] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);
  const [toggling, setToggling] = useState<boolean>(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.getBraveStatus) {
        const res = await window.electronAPI.getBraveStatus();
        if (res.success && res.data) {
          setInstalled(res.data.installed);
          setExecutablePath(res.data.executablePath);
          setEnabled(res.data.enabled);
        }
      } else if (window.electronAPI?.detectBraveBrowser) {
        const res = await window.electronAPI.detectBraveBrowser();
        if (res.success && res.data) {
          setInstalled(res.data.installed);
          setExecutablePath(res.data.executablePath);
        }
      }
    } catch (err) {
      console.error('[BRAVE-CARD] Failed to fetch Brave status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextState = e.target.checked;
    setToggling(true);
    // Optimistic update
    setEnabled(nextState);

    try {
      if (window.electronAPI?.setBraveEnabled) {
        const res = await window.electronAPI.setBraveEnabled(nextState);
        if (!res.success) {
          setEnabled(!nextState);
          toast.error(res.error || 'Failed to update Brave settings');
        } else {
          toast.success(nextState ? '🦁 Brave enabled for AI & Testing' : 'Brave integration disabled');
        }
      } else if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings({
          integrations: { brave: nextState }
        });
        toast.success(nextState ? '🦁 Brave enabled for AI & Testing' : 'Brave integration disabled');
      }
    } catch (err) {
      setEnabled(!nextState);
      toast.error('Error saving Brave setting');
    } finally {
      setToggling(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      if (window.electronAPI?.installBraveBrowser) {
        toast.info('Opening official Brave Browser download page…');
        const res = await window.electronAPI.installBraveBrowser();
        if (res.success) {
          if (res.data?.installed) {
            setInstalled(true);
            setExecutablePath(res.data.executablePath);
            setEnabled(true);
            toast.success('🦁 Brave Browser detected and ready!');
          }
        } else {
          toast.error(res.error || 'Failed to open installer portal');
        }
      } else if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal('https://brave.com/download/');
      } else if (typeof window !== 'undefined') {
        window.open('https://brave.com/download/', '_blank');
      }
    } catch (err) {
      console.error('[BRAVE-CARD] Installation trigger error:', err);
      toast.error('Failed to launch Brave installation');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className={`brave-integration-card ${className}`}
      style={{
        padding: '20px',
        borderRadius: '12px',
        background: 'linear-gradient(145deg, rgba(23, 25, 35, 0.95), rgba(15, 17, 23, 0.95))',
        border: '1px solid var(--border-strong, rgba(255, 255, 255, 0.12))',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        ...style
      }}
    >
      {/* Subtle background glow */}
      <div
        style={{
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '140px',
          height: '140px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(251, 84, 43, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none'
        }}
      />

      {/* Header section with Headline & Status Badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--text-primary, #ffffff)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                letterSpacing: '-0.01em'
              }}
            >
              <span>🦁 Brave Browser Integration</span>
            </h3>

            {/* Status Badge */}
            {loading ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-muted, #9ca3af)',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}
              >
                <Loader2 size={10} className="animate-spin" />
                <span>Checking…</span>
              </span>
            ) : installed ? (
              <span
                className="badge-detected"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--accent-green, #10b981)',
                  border: '1px solid rgba(16, 185, 129, 0.35)'
                }}
              >
                <Check size={11} />
                <span>Detected</span>
              </span>
            ) : (
              <span
                className="badge-not-detected"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-red, #ef4444)',
                  border: '1px solid rgba(239, 68, 68, 0.35)'
                }}
              >
                <AlertCircle size={11} />
                <span>Not Detected</span>
              </span>
            )}
          </div>

          {/* Marketing Subtext */}
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'var(--text-secondary, #9ca3af)',
              maxWidth: '560px'
            }}
          >
            The best, fastest, secure, and private browsing for Ty-Code's AI functions. Zero telemetry, maximum privacy.
          </p>
        </div>

        {/* Refresh status button */}
        <button
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          title="Re-check Brave installation status"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            color: 'var(--text-muted, #9ca3af)',
            padding: '6px',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary, #ffffff)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted, #9ca3af)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feature Highlights Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.05)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary, #9ca3af)' }}>
          <ShieldCheck size={13} style={{ color: '#fb542b', flexShrink: 0 }} />
          <span>Brave Shields &amp; Adblock</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary, #9ca3af)' }}>
          <Zap size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <span>Ultra-fast Chromium Engine</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary, #9ca3af)' }}>
          <Globe size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />
          <span>Private AI Web Searching</span>
        </div>
      </div>

      {/* Dynamic State Rendering */}
      {installed ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.2)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
              Enable Brave for AI &amp; Testing
            </span>
            {executablePath && (
              <span
                style={{
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-muted, #9ca3af)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '380px'
                }}
                title={executablePath}
              >
                {executablePath}
              </span>
            )}
          </div>

          {/* Toggle Switch */}
          <label
            style={{
              position: 'relative',
              display: 'inline-block',
              width: '38px',
              height: '20px',
              cursor: toggling ? 'wait' : 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={handleToggle}
              disabled={toggling}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: 'absolute',
                cursor: 'pointer',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: enabled ? 'var(--accent-green, #10b981)' : 'rgba(255, 255, 255, 0.15)',
                transition: '0.2s',
                borderRadius: '20px'
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  content: '""',
                  height: '14px',
                  width: '14px',
                  left: enabled ? '20px' : '3px',
                  bottom: '3px',
                  backgroundColor: 'white',
                  transition: '0.2s',
                  borderRadius: '50%',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }}
              />
            </span>
          </label>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
              Brave is not currently installed
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)' }}>
              Install Brave to activate privacy-first web navigation for Ty-Code agents.
            </span>
          </div>

          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #fb542b 0%, #d43b18 100%)',
              color: '#ffffff',
              border: 'none',
              fontSize: '12px',
              fontWeight: 600,
              cursor: installing ? 'wait' : 'pointer',
              boxShadow: '0 2px 8px rgba(251, 84, 43, 0.35)',
              transition: 'transform 0.1s ease, filter 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'brightness(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'none';
            }}
          >
            {installing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Opening…</span>
              </>
            ) : (
              <>
                <ExternalLink size={12} />
                <span>Install Brave Browser</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Mandatory Privacy Note */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          paddingTop: '6px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '11px',
          color: 'var(--text-muted, #9ca3af)'
        }}
      >
        <Lock size={12} style={{ color: 'var(--accent-primary, #60a5fa)', flexShrink: 0 }} />
        <span>
          AI uses a secure, isolated Guest Mode. Your personal Brave data is never accessed.
        </span>
      </div>
    </div>
  );
};

export default BraveIntegrationCard;
