/**
 * Brave Testing View (AI Local Testing Panel)
 *
 * Dedicated UI panel for AI-driven local web app preview and automated testing.
 *
 * CRITICAL PRIVACY & SECURITY REQUIREMENTS:
 * 1. Embedded <webview> uses partition="persist:tycode-guest" to isolate all cookies,
 *    localStorage, and credentials from the user's primary Electron session.
 * 2. Toolbar provides "Open in Brave Guest" to launch external visible Brave in guest mode.
 * 3. Uses atomic Zustand selectors for optimal rendering performance.
 *
 * Brand: Ty-Code
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  Globe,
  RotateCw,
  ExternalLink,
  Square,
  Play,
  ShieldCheck,
  AlertCircle,
  Laptop,
  CheckCircle2,
  Lock,
  ArrowRight
} from 'lucide-react';
import {
  useBraveTestingStore,
  useBraveTestingActive,
  useBraveTestingUrl,
  useBraveTestingTitle,
  useBraveTestingStatus,
  useBraveTestingLoading,
  useBraveTestingError,
  useBraveTestingRefreshTrigger,
  useBraveTestingSync
} from '../../state/brave-testing-store';

interface WebviewElement extends HTMLElement {
  reload: () => void;
  getURL?: () => string;
  getTitle?: () => string;
  isLoading?: () => boolean;
}

export const BraveTestingView: React.FC = () => {
  // Sync with main process IPC events
  useBraveTestingSync();

  const active = useBraveTestingActive();
  const url = useBraveTestingUrl();
  const title = useBraveTestingTitle();
  const status = useBraveTestingStatus();
  const isLoading = useBraveTestingLoading();
  const error = useBraveTestingError();
  const refreshTrigger = useBraveTestingRefreshTrigger();

  const startTesting = useBraveTestingStore((s) => s.startTesting);
  const stopTesting = useBraveTestingStore((s) => s.stopTesting);
  const refresh = useBraveTestingStore((s) => s.refresh);
  const setUrl = useBraveTestingStore((s) => s.setUrl);

  const [inputUrl, setInputUrl] = useState(url);
  const webviewRef = useRef<WebviewElement | null>(null);

  // Sync internal input field with store URL changes
  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  // Handle manual refresh
  useEffect(() => {
    if (webviewRef.current && typeof webviewRef.current.reload === 'function') {
      webviewRef.current.reload();
    }
  }, [refreshTrigger]);

  const handleStart = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputUrl.trim()) {
      void startTesting(inputUrl.trim());
    }
  };

  const handleOpenExternalGuest = () => {
    if (inputUrl.trim()) {
      void startTesting(inputUrl.trim(), true);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0d1117',
        color: '#c9d1d9',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        overflow: 'hidden'
      }}
    >
      {/* Top Testing Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#161b22',
          borderBottom: '1px solid #30363d',
          gap: '12px',
          flexWrap: 'wrap'
        }}
      >
        {/* Left: Branding & Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: '#ff55001a',
              border: '1px solid #ff550044',
              color: '#ff6622',
              fontSize: '12px',
              fontWeight: 600
            }}
          >
            <ShieldCheck size={14} color="#ff6622" />
            <span>AI Local Testing (Brave Guest)</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '4px',
              backgroundColor: active ? '#23863622' : '#21262d',
              border: `1px solid ${active ? '#2ea04355' : '#30363d'}`,
              color: active ? '#3fb950' : '#8b949e',
              fontSize: '11px',
              fontFamily: 'monospace'
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: active ? '#3fb950' : '#8b949e'
              }}
            />
            <span>{active ? (status ? `${status} LIVE` : 'CONNECTED') : 'IDLE'}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#8b949e',
              fontSize: '11px'
            }}
          >
            <Lock size={12} color="#8b949e" />
            <span style={{ fontFamily: 'monospace' }}>partition=persist:tycode-guest</span>
          </div>
        </div>

        {/* Center: Address Bar */}
        <form
          onSubmit={handleStart}
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: '1 1 300px',
            maxWidth: '560px',
            backgroundColor: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '2px 8px',
            gap: '8px'
          }}
        >
          <Globe size={14} color="#8b949e" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="http://localhost:3000"
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f0f6fc',
              fontSize: '13px',
              fontFamily: 'monospace',
              padding: '4px 0'
            }}
          />
          {!active ? (
            <button
              type="submit"
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                backgroundColor: '#238636',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Play size={12} />
              <span>Start</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stopTesting()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                backgroundColor: '#da3633',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Square size={12} />
              <span>Stop Testing</span>
            </button>
          )}
        </form>

        {/* Right: Actions Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={refresh}
            title="Refresh local app view"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              backgroundColor: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '6px',
              color: '#c9d1d9',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <RotateCw size={13} className={isLoading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleOpenExternalGuest}
            title="Open in visible external Brave Guest window"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: '#ff5500',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <ExternalLink size={13} />
            <span>Open in Brave Guest</span>
          </button>
        </div>
      </div>

      {/* Error Notification Bar */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#f851491a',
            borderBottom: '1px solid #f8514944',
            color: '#f85149',
            padding: '8px 16px',
            fontSize: '12px'
          }}
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Main View Area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          backgroundColor: '#010409',
          overflow: 'hidden'
        }}
      >
        {active ? (
          <webview
            ref={webviewRef as any}
            src={url}
            partition="persist:tycode-guest"
            allowpopups={true}
            style={{
              width: '100%',
              height: '100%',
              border: 'none'
            }}
          />
        ) : (
          /* Empty / Idle State */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '24px',
              textAlign: 'center',
              color: '#8b949e'
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                backgroundColor: '#161b22',
                border: '1px solid #30363d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}
            >
              <Laptop size={32} color="#ff6622" />
            </div>

            <h3
              style={{
                margin: '0 0 8px 0',
                color: '#f0f6fc',
                fontSize: '18px',
                fontWeight: 600
              }}
            >
              AI Local Testing Engine
            </h3>

            <p
              style={{
                maxWidth: '480px',
                margin: '0 0 24px 0',
                fontSize: '13px',
                lineHeight: 1.5,
                color: '#8b949e'
              }}
            >
              Watch the Ty-Code AI test your frontend and APIs in real-time. Rendered in a
              strictly isolated partition with zero access to your personal cookies or logins.
            </p>

            {/* Quick Target URL presets */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '20px',
                flexWrap: 'wrap',
                justifyContent: 'center'
              }}
            >
              {['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setInputUrl(preset);
                    void startTesting(preset);
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    color: '#c9d1d9',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    cursor: 'pointer'
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void startTesting(inputUrl)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                backgroundColor: '#238636',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <span>Launch Testing Webview</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BraveTestingView;
