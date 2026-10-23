import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ChatSidecar.css';
import ReactMarkdown, { type Components } from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import { Send, Square, Sparkles, Trash2, ChevronRight, ChevronDown, Terminal, FileCode, Check, Eye, AlertCircle, Copy, RotateCcw, Loader2, ShieldCheck, X, Users, Lightbulb, Hammer, Compass, Info, Palette, Presentation, Play, ExternalLink, Settings, Activity, Key, WifiOff, Clock, RefreshCw, Zap } from 'lucide-react';
import { useChatStore, groupMessagesByTask } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { useOnboardingStore } from '../state/onboarding-store';
import { useSettingsStore } from '../state/settings-store';
import { ModelSelector } from './ChatInterface/ModelSelector';
import { ProviderSetupCard } from './ProviderSetupCard';
import { ChatErrorCard } from './ChatErrorCard';
import { BackgroundAgentsPanel } from './agent/BackgroundAgentsPanel';
import { ChatInput } from './chat/ChatInput';
import { useChatInputStore } from '../state/chat-input-store';
import { ChatMessageItem } from './ChatMessage';
import type { AgentToolApproval, ChatMessage, ToolCall, ToolExecutionStatus, ChatErrorCard as ChatErrorCardType, ProviderType } from '../../../preload/types';

const languages: Record<string, LanguageFn> = {
  bash, shell: bash, sh: bash,
  css,
  diff,
  html: xml, xml,
  js: javascript, javascript, jsx: javascript,
  json,
  md: markdown, markdown,
  powershell, ps1: powershell,
  py: python, python,
  ts: typescript, tsx: typescript, typescript,
  yaml, yml: yaml
};
for (const [name, language] of Object.entries(languages)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}

interface CodeBlockProps { language?: string; value: string; }

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language?.toLowerCase() || '';
  const highlightLanguage = languages[normalizedLanguage] ? normalizedLanguage : '';
  const highlighted = useMemo(() => highlightLanguage
    ? hljs.highlight(value, { language: highlightLanguage }).value
    : hljs.highlightAuto(value).value, [highlightLanguage, value]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return <div className="code-block">
    <div className="code-block-header"><span>{language || 'code'}</span>
      <button onClick={() => void handleCopy()} title="Copy code" aria-label="Copy code block">
        {copied ? <><Check size={11} color="var(--accent-green)" /><span>Copied</span></> : <><Copy size={11} /><span>Copy</span></>}
      </button>
    </div>
    <pre><code className={`hljs${highlightLanguage ? ` language-${highlightLanguage}` : ''}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
  </div>;
};

const markdownComponents: Components = {
  pre({ children }) { return <>{children}</>; },
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/.exec(className || '')?.[1];
    const value = String(children).replace(/\n$/, '');
    if (language || value.includes('\n')) return <CodeBlock language={language} value={value} />;
    return <code className={className} {...props}>{children}</code>;
  }
};

function MarkdownContent({ content }: { content: string }): React.ReactElement {
  return <div className="markdown-content"><ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown></div>;
}

interface ToolCardProps { tool: ToolCall; status?: ToolExecutionStatus; output?: string; }

interface PresentationData {
  topic: string;
  filePath: string;
  absolutePath?: string;
  slideCount: number;
  outline: string[];
  previewUrl?: string;
}

function parsePresentationData(toolArgs: Record<string, unknown>, output?: string): PresentationData | null {
  try {
    if (output) {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === 'object' && parsed.success !== false) {
        return {
          topic: String(parsed.topic || toolArgs.topic || 'Presentation'),
          filePath: String(parsed.filePath || toolArgs.outputPath || 'presentation.html'),
          absolutePath: parsed.absolutePath ? String(parsed.absolutePath) : undefined,
          slideCount: typeof parsed.slideCount === 'number' ? parsed.slideCount : (Array.isArray(toolArgs.outline) ? toolArgs.outline.length + 1 : 1),
          outline: Array.isArray(parsed.outline) ? parsed.outline.map(String) : (Array.isArray(toolArgs.outline) ? toolArgs.outline.map(String) : []),
          previewUrl: parsed.previewUrl ? String(parsed.previewUrl) : undefined
        };
      }
    }
  } catch {
    // not JSON
  }
  if (toolArgs && toolArgs.topic) {
    const outlineArr = Array.isArray(toolArgs.outline) ? toolArgs.outline.map(String) : [];
    return {
      topic: String(toolArgs.topic),
      filePath: String(toolArgs.outputPath || 'presentation.html'),
      slideCount: outlineArr.length + 1,
      outline: outlineArr
    };
  }
  return null;
}

export const PresentationPreviewCard: React.FC<{ data: PresentationData }> = ({ data }) => {
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const { openFile } = useWorkspaceStore();

  const handlePreview = async () => {
    setOpening(true);
    try {
      const target = data.previewUrl || (data.absolutePath ? `file:///${data.absolutePath.replace(/\\/g, '/')}` : data.filePath);
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(target);
      } else if (window.electronAPI?.openPath && data.filePath) {
        await window.electronAPI.openPath(data.filePath);
      } else if (typeof window !== 'undefined') {
        window.open(target, '_blank');
      }
    } catch (err) {
      console.error('Failed to preview presentation:', err);
    } finally {
      window.setTimeout(() => setOpening(false), 800);
    }
  };

  const handleOpenEditor = async () => {
    try {
      const name = data.filePath.split(/[/\\]/).pop() || 'presentation.html';
      await openFile(data.filePath, name);
    } catch (err) {
      console.error('Failed to open presentation in editor:', err);
    }
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(data.filePath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="presentation-preview-card" role="region" aria-label="Interactive Presentation Preview">
      <div className="presentation-card-header">
        <div className="presentation-card-badge">
          <Presentation size={13} color="var(--accent-cyan)" />
          <span>Bento Presentation Deck</span>
        </div>
        <span className="presentation-card-count">{data.slideCount} {data.slideCount === 1 ? 'Slide' : 'Slides'}</span>
      </div>

      <div className="presentation-card-body">
        <h4 className="presentation-card-topic">{data.topic}</h4>
        <div className="presentation-card-meta">
          <FileCode size={12} color="var(--accent-primary)" />
          <span className="presentation-card-filepath" title={data.filePath}>{data.filePath}</span>
          <button
            type="button"
            className="presentation-copy-btn"
            onClick={() => void handleCopyPath()}
            title="Copy file path"
          >
            {copied ? <Check size={11} color="var(--accent-green)" /> : <Copy size={11} />}
          </button>
        </div>

        {data.outline && data.outline.length > 0 && (
          <details className="presentation-card-outline">
            <summary>
              <span>Slide Outline ({data.outline.length} sections)</span>
              <ChevronDown size={11} className="outline-chevron" />
            </summary>
            <ol>
              <li><em>Cover:</em> {data.topic}</li>
              {data.outline.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </details>
        )}
      </div>

      <div className="presentation-card-actions">
        <button
          type="button"
          className="presentation-btn-preview"
          onClick={() => void handlePreview()}
          disabled={opening}
          title="Open interactive presentation in default browser"
        >
          {opening ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          <span>{opening ? 'Opening…' : 'Preview Presentation'}</span>
          <ExternalLink size={11} />
        </button>

        <button
          type="button"
          className="presentation-btn-editor"
          onClick={() => void handleOpenEditor()}
          title="Open HTML file in IDE editor"
        >
          <FileCode size={12} />
          <span>Open in Editor</span>
        </button>
      </div>
    </div>
  );
};

const ToolCard: React.FC<ToolCardProps> = ({ tool, status, output }) => {
  const [expanded, setExpanded] = useState(false);
  const isError = status === 'error';
  const isPresentation = tool.name === 'generate_presentation';
  const presentationData = isPresentation ? parsePresentationData(tool.arguments || {}, output) : null;

  return <section className="tool-card">
    <button className="tool-header" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tool.name} tool details`} style={{ color: isError ? 'var(--accent-red)' : status === 'running' ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {isPresentation ? <Presentation size={12} color="var(--accent-cyan)" /> : <Terminal size={12} color="var(--accent-primary)" />}
        <strong>{tool.name}</strong><span style={{ color: 'var(--text-muted)' }}>({Object.keys(tool.arguments || {}).length} args)</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {status === 'running' && <span className="tool-status is-running"><Loader2 size={11} className="animate-spin" />Running</span>}
        {status === 'success' && <span className="tool-status is-success"><Check size={11} />Success</span>}
        {status === 'error' && <span className="tool-status is-error"><AlertCircle size={11} />Failed</span>}
        {status === 'cancelled' && <span className="tool-status is-cancelled">Stopped</span>}
      </span>
    </button>
    {status === 'success' && presentationData && (
      <PresentationPreviewCard data={presentationData} />
    )}
    {expanded && <div className="tool-body">
      <div style={{ marginBottom: 8, color: 'var(--accent-cyan)' }}><strong>Input:</strong>{' '}{JSON.stringify(tool.arguments, null, 2)}</div>
      {output !== undefined && <div><strong style={{ color: isError ? 'var(--accent-red)' : 'var(--text-secondary)' }}>Output:</strong><div style={{ marginTop: 4 }}>{output}</div></div>}
    </div>}
  </section>;
};

function DiffCard({ diff: proposedDiff, onInspect, onApply }: {
  diff: NonNullable<ChatMessage['proposedDiffs']>[number]; onInspect: () => void; onApply: () => void;
}): React.ReactElement {
  return <div className="diff-card">
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 11, fontWeight: 600 }}><FileCode size={13} color="var(--accent-primary)" /><span style={{ overflowWrap: 'anywhere' }}>{proposedDiff.filePath}</span></div>
      <span style={{ flexShrink: 0, color: 'var(--accent-amber)', fontSize: 10 }}>Ready to review</span>
    </div>
    <div className="diff-actions">
      <button onClick={onInspect} style={{ padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', fontSize: 11 }}><Eye size={12} />Inspect</button>
      <button onClick={onApply} style={{ padding: '4px 8px', background: 'var(--accent-green)', color: '#fff', fontSize: 11 }}><Check size={12} />Apply</button>
    </div>
  </div>;
}

// 1. Connect Provider Card (CONFIG_MISSING: In-chat key input)
export const ConnectProviderCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const { settings, saveSettings, openSettings } = useChatStore();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const activeProvider = errorCard.providerId || settings?.activeProvider || 'openrouter';
  const providerDisplayNames: Record<string, string> = {
    openrouter: 'OpenRouter',
    openkilo: 'OpenKilo',
    groq: 'Groq',
    openai: 'OpenAI',
    anthropic: 'Anthropic Claude',
    gemini: 'Google Gemini',
    deepseek: 'DeepSeek',
    together: 'Together AI',
    mistral: 'Mistral AI',
    'fcc-proxy': 'Free-Claude-Code Proxy'
  };
  const providerLinks: Record<string, string> = {
    openrouter: 'https://openrouter.ai/keys',
    openkilo: 'https://openkilo.com',
    groq: 'https://console.groq.com/keys',
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    gemini: 'https://aistudio.google.com/app/apikey',
    deepseek: 'https://platform.deepseek.com/api_keys'
  };
  const displayName = providerDisplayNames[activeProvider] || activeProvider;
  const keyLink = errorCard.actionUrl || providerLinks[activeProvider] || 'https://openrouter.ai/keys';

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (window.electronAPI?.testProviderKey) {
        const testRes = await window.electronAPI.testProviderKey(activeProvider, cleanKey);
        if (!testRes?.success) {
          setSaveError(testRes?.message || 'Key validation failed');
          setSaving(false);
          return;
        }
      }
      if (window.electronAPI?.saveProviderKey) {
        await window.electronAPI.saveProviderKey(activeProvider, cleanKey);
      }
      const ok = await saveSettings({
        activeProvider: activeProvider as any,
        apiKeys: { [activeProvider]: cleanKey }
      });
      if (ok) {
        setSaved(true);
        if (onRetry) {
          window.setTimeout(() => {
            onRetry();
          }, 600);
        }
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenLink = () => {
    if (window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(keyLink);
    } else {
      window.open(keyLink, '_blank');
    }
  };

  return (
    <div className="chat-error-card is-connect-provider" role="alert">
      <div className="chat-error-card-header">
        <div className="chat-error-card-badge">
          <Key size={14} className="chat-error-icon-key" />
          <span className="chat-error-code">Connect {displayName}</span>
        </div>
        <span className="chat-error-badge-tag">API Key Required</span>
      </div>

      <div className="chat-error-card-body">
        <p className="chat-error-message">
          To chat with <strong>{settings?.activeModel || displayName}</strong>, enter your {displayName} API key below. Keys are encrypted via OS safeStorage (Windows DPAPI) and never stored in plain text.
        </p>

        <form onSubmit={handleSave} className="chat-error-key-form">
          <div className="chat-error-input-group">
            <input
              type="password"
              className="chat-error-key-input"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
              placeholder={`Paste your ${displayName} API key…`}
              autoFocus
            />
            <button
              type="submit"
              className={`chat-error-btn ${saved ? 'chat-error-btn-success' : 'chat-error-btn-primary'}`}
              disabled={!apiKey.trim() || saving}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : saved ? <Check size={11} /> : <Key size={11} />}
              <span>{saving ? 'Saving…' : saved ? 'Connected! Retrying…' : 'Save & Connect'}</span>
            </button>
          </div>
          {saveError && <div style={{ color: 'var(--accent-red)', fontSize: '11px', marginTop: '6px' }}>{saveError}</div>}
        </form>

        <div className="chat-error-helper-links">
          <button type="button" className="chat-error-link-btn" onClick={handleOpenLink}>
            <span>Get a {displayName} API key</span>
            <ExternalLink size={10} />
          </button>
          <span className="chat-error-separator">•</span>
          <button type="button" className="chat-error-link-btn" onClick={() => openSettings('providers')}>
            <span>Open Provider Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// 2. Network Error Card (NETWORK_BLOCKED)
export const NetworkErrorCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const openSettings = useChatStore((s) => s.openSettings);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = () => {
    if (!onRetry) return;
    setRetrying(true);
    onRetry();
    window.setTimeout(() => setRetrying(false), 1500);
  };

  return (
    <div className="chat-error-card is-network-blocked" role="alert">
      <div className="chat-error-card-header">
        <div className="chat-error-card-badge">
          <WifiOff size={14} className="chat-error-icon" />
          <span className="chat-error-code">[NETWORK_BLOCKED] Network Error</span>
        </div>
      </div>

      <div className="chat-error-card-body">
        <p className="chat-error-message">{errorCard.message || 'Unable to connect to AI provider endpoint (DNS lookup failed or host unreachable).'}</p>
        <div className="chat-error-remedy">
          <Lightbulb size={12} className="chat-remedy-icon" />
          <span><strong>Remedy:</strong> {errorCard.remedy || 'Check your internet connection or proxy settings, then retry.'}</span>
        </div>
      </div>

      <div className="chat-error-card-actions">
        {onRetry && (
          <button
            type="button"
            className="chat-error-btn chat-error-btn-primary"
            onClick={handleRetry}
            disabled={retrying}
          >
            <RefreshCw size={11} className={retrying ? 'animate-spin' : ''} />
            <span>{retrying ? 'Retrying…' : 'Retry Connection'}</span>
          </button>
        )}
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('diagnostics')}
        >
          <Activity size={11} />
          <span>Run Diagnostics</span>
        </button>
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('providers')}
        >
          <Settings size={11} />
          <span>Switch Provider</span>
        </button>
      </div>
    </div>
  );
};

// 3. Quota Exhausted Card (RATE_LIMITED / QUOTA_EXCEEDED)
export const QuotaExhaustedCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const { openSettings, saveSettings } = useChatStore();
  const { connectedProviders, openWizard, recordRateLimit429 } = useOnboardingStore();
  const [countdown, setCountdown] = useState<number>(errorCard.retryAfterSec || 60);

  const isAnonymousRateLimit =
    connectedProviders.length === 0 ||
    errorCard.providerId?.includes('openkilo') ||
    localStorage.getItem('ty_code_anonymous_tier_active') === 'true' ||
    Boolean(errorCard.message && errorCard.message.toLowerCase().includes('anonymous'));

  useEffect(() => {
    if (isAnonymousRateLimit) {
      recordRateLimit429();
    }
  }, [isAnonymousRateLimit, recordRateLimit429]);

  const handleSwitchToProvider = async (provider: ProviderType, model: string) => {
    await saveSettings({ activeProvider: provider, activeModel: model });
    if (onRetry) {
      onRetry();
    }
  };

  return (
    <div className="chat-error-card is-rate-limited" role="alert">
      <div className="chat-error-card-header">
        <div className="chat-error-card-badge">
          <Clock size={14} style={{ color: 'var(--accent-amber)' }} />
          <span className="chat-error-code" style={{ color: 'var(--accent-amber)' }}>
            [{errorCard.taxonomyCode}] Quota Exhausted / Rate Limited
          </span>
        </div>
        {countdown > 0 && (
          <span className="chat-error-timer">Reset in {countdown}s</span>
        )}
      </div>

      <div className="chat-error-card-body">
        <p className="chat-error-message">{errorCard.message || 'Provider rate limit reached (HTTP 429) or free tier quota exhausted.'}</p>
        <div className="chat-error-remedy">
          <Lightbulb size={12} className="chat-remedy-icon" />
          <span><strong>Remedy:</strong> {errorCard.remedy}</span>
        </div>

        {/* Anonymous 429 Upsell Hook */}
        {isAnonymousRateLimit && (
          <div
            style={{
              marginTop: '12px',
              padding: '12px 14px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15))',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '13px' }}>
              <Sparkles size={16} />
              <span>Anonymous tier limit reached — connect your free OpenRouter account for 10x more requests</span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
              Take 2 minutes to connect your free OpenRouter, Groq, or Google AI Studio accounts. No credit card required.
            </p>
            <button
              type="button"
              onClick={() => openWizard('openrouter')}
              style={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                background: 'var(--accent-primary, #6366f1)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <span>Connect Free Accounts Now →</span>
            </button>
          </div>
        )}

        {/* Subscription Upsell Card */}
        <div
          id="quota-exhausted-subscription-upsell"
          style={{
            marginTop: '12px',
            padding: '12px 14px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(56, 189, 248, 0.12))',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-green)', fontWeight: 600, fontSize: '13px' }}>
            <Sparkles size={16} />
            <span>Connect your Copilot subscription — no extra cost</span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
            Never hit rate limits. Ty-Code supports device-flow authentication for GitHub Copilot and ChatGPT OAuth. Zero API billing.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            <button
              type="button"
              onClick={() => openWizard('subscriptions')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                background: 'var(--accent-green)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <span>Connect Copilot (via your Copilot — no extra cost)</span>
            </button>
            <button
              type="button"
              onClick={() => openSettings('providers')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              <span>Manage Subscriptions</span>
            </button>
          </div>
        </div>

        <div className="chat-error-alternatives">
          <span className="chat-error-alt-title">Alternative providers available:</span>
          <div className="chat-error-alt-buttons">
            <button
              type="button"
              className="chat-error-alt-btn"
              onClick={() => void handleSwitchToProvider('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free')}
            >
              Switch to OpenRouter Free
            </button>
            <button
              type="button"
              className="chat-error-alt-btn"
              onClick={() => void handleSwitchToProvider('groq', 'llama-3.3-70b-versatile')}
            >
              Switch to Groq Free
            </button>
            <button
              type="button"
              className="chat-error-alt-btn"
              onClick={() => void handleSwitchToProvider('ollama', 'qwen2.5-coder:7b')}
            >
              Switch to Local Ollama
            </button>
          </div>
        </div>
      </div>

      <div className="chat-error-card-actions">
        {onRetry && (
          <button
            type="button"
            className="chat-error-btn chat-error-btn-primary"
            onClick={onRetry}
            disabled={countdown > 50}
          >
            <RotateCcw size={11} />
            <span>Retry Prompt</span>
          </button>
        )}
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('providers')}
        >
          <Settings size={11} />
          <span>Configure Providers</span>
        </button>
      </div>
    </div>
  );
};

// 4. Provider Unavailable Card (PROVIDER_DOWN / TIMEOUT)
export const ProviderUnavailableCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const openSettings = useChatStore((s) => s.openSettings);
  const [autoRetry, setAutoRetry] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(5);

  useEffect(() => {
    if (!autoRetry || !onRetry) return;
    const timer = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setAutoRetry(false);
          onRetry();
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRetry, onRetry]);

  return (
    <div className="chat-error-card is-provider-down" role="alert">
      <div className="chat-error-card-header">
        <div className="chat-error-card-badge">
          <AlertCircle size={14} className="chat-error-icon" />
          <span className="chat-error-code">[{errorCard.taxonomyCode}] Provider Unavailable</span>
        </div>
      </div>

      <div className="chat-error-card-body">
        <p className="chat-error-message">{errorCard.message || 'Provider returned a 5xx server error or connection timed out.'}</p>
        <div className="chat-error-remedy">
          <Lightbulb size={12} className="chat-remedy-icon" />
          <span><strong>Remedy:</strong> {errorCard.remedy || 'Provider is experiencing a temporary outage. You can auto-retry or switch providers.'}</span>
        </div>

        {onRetry && (
          <label className="chat-error-autoretry-label">
            <input
              type="checkbox"
              checked={autoRetry}
              onChange={(e) => {
                setAutoRetry(e.target.checked);
                setRetryCountdown(5);
              }}
            />
            <span>Auto-retry in {retryCountdown}s</span>
          </label>
        )}
      </div>

      <div className="chat-error-card-actions">
        {onRetry && (
          <button
            type="button"
            className="chat-error-btn chat-error-btn-primary"
            onClick={onRetry}
          >
            <RotateCcw size={11} />
            <span>Retry Now</span>
          </button>
        )}
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('providers')}
        >
          <Settings size={11} />
          <span>Switch Provider</span>
        </button>
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('diagnostics')}
        >
          <Activity size={11} />
          <span>Check Diagnostics</span>
        </button>
      </div>
    </div>
  );
};

// 5. Standard Error Card (Fallback & Diagnostic Violations)
export const StandardErrorCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const openSettings = useChatStore((s) => s.openSettings);

  const handleExternalAction = () => {
    if (errorCard.actionUrl && window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(errorCard.actionUrl);
    } else if (errorCard.actionUrl && typeof window !== 'undefined') {
      window.open(errorCard.actionUrl, '_blank');
    }
  };

  return (
    <div className="chat-error-card" role="alert">
      <div className="chat-error-card-header">
        <div className="chat-error-card-badge">
          <AlertCircle size={14} className="chat-error-icon" />
          <span className="chat-error-code">[{errorCard.taxonomyCode}]</span>
        </div>
        {errorCard.hopId && (
          <span className="chat-error-hop">{errorCard.hopId}</span>
        )}
      </div>

      <div className="chat-error-card-body">
        <p className="chat-error-message">{errorCard.message}</p>
        {errorCard.remedy && (
          <div className="chat-error-remedy">
            <Lightbulb size={12} className="chat-remedy-icon" />
            <span><strong>Remedy:</strong> {errorCard.remedy}</span>
          </div>
        )}
        {errorCard.suggestedFallback && (
          <div className="chat-error-fallback">
            <Info size={11} />
            <span>{errorCard.suggestedFallback}</span>
          </div>
        )}
      </div>

      <div className="chat-error-card-actions">
        {onRetry && (
          <button
            type="button"
            className="chat-error-btn chat-error-btn-primary"
            onClick={onRetry}
          >
            <RotateCcw size={11} />
            <span>Retry</span>
          </button>
        )}
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('providers')}
        >
          <Settings size={11} />
          <span>Configure Providers</span>
        </button>
        <button
          type="button"
          className="chat-error-btn chat-error-btn-secondary"
          onClick={() => openSettings('diagnostics')}
        >
          <Activity size={11} />
          <span>Run Diagnostics</span>
        </button>
        {errorCard.actionUrl && (
          <button
            type="button"
            className="chat-error-btn chat-error-btn-external"
            onClick={handleExternalAction}
          >
            <span>{errorCard.actionLabel || 'Learn More'}</span>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    </div>
  );
};

export const ErrorCard: React.FC<{ errorCard: ChatErrorCardType; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  return <ChatErrorCard errorCard={errorCard} onRetry={onRetry} />;
};

const planReviewButtonBase: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  fontSize: '12.5px',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease'
};

interface PlanReviewCardProps {
  approval: AgentToolApproval;
  sending: boolean;
  onApprove: () => void | Promise<void>;
  onRevise: (feedback: string) => void | Promise<void>;
}

const PlanReviewCard: React.FC<PlanReviewCardProps> = ({ approval, sending, onApprove, onRevise }) => {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState('');
  const report = approval.planReport || approval.reason || '';
  const sendFeedback = () => {
    const trimmed = reviseText.trim();
    if (!trimmed) return;
    setReviseOpen(false);
    setReviseText('');
    void onRevise(trimmed);
  };
  return (
    <article
      role="alert"
      aria-label="Task Scoping Report review"
      style={{
        margin: '10px 0',
        padding: '14px',
        borderRadius: '12px',
        border: '1px solid var(--accent-blue, #3b82f6)',
        background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.10), rgba(59, 130, 246, 0.03))',
        boxShadow: '0 8px 24px -12px rgba(59, 130, 246, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div
          style={{
            padding: '8px',
            borderRadius: '10px',
            background: 'rgba(59, 130, 246, 0.15)',
            color: 'var(--accent-blue, #3b82f6)',
            display: 'flex',
            flexShrink: 0
          }}
        >
          <Compass size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: '13px', color: 'var(--text-primary, #f3f4f6)' }}>Task Scoping Report</strong>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary, #9ca3af)', marginTop: '2px', overflowWrap: 'anywhere' }}>{approval.reason}</div>
        </div>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '3px 8px',
            borderRadius: '999px',
            background: 'rgba(59, 130, 246, 0.18)',
            color: 'var(--accent-blue, #3b82f6)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            flexShrink: 0
          }}
        >
          Plan review
        </span>
      </div>
      {report.trim().length > 0 && (
        <pre
          style={{
            margin: 0,
            maxHeight: '300px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'var(--bg-primary, #121316)',
            border: '1px solid var(--border-subtle, #262833)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '11.5px',
            lineHeight: 1.55,
            color: 'var(--text-primary, #f3f4f6)'
          }}
        >
          {report}
        </pre>
      )}
      {approval.checkpoint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-secondary, #9ca3af)' }}>
          <Info size={13} />
          <span>
            <strong style={{ color: 'var(--text-primary, #f3f4f6)' }}>Checkpoint:</strong> {approval.checkpoint}
          </span>
        </div>
      )}
      {reviseOpen && (
        <textarea
          value={reviseText}
          onChange={(e) => setReviseText(e.target.value)}
          placeholder="Describe what should change in the plan (missing phases, wrong files, tighter scope...)"
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            padding: '8px 10px',
            borderRadius: '8px',
            background: 'var(--bg-primary, #121316)',
            border: '1px solid var(--border-subtle, #262833)',
            color: 'var(--text-primary, #f3f4f6)',
            fontSize: '12px',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)'
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          disabled={sending}
          onClick={() => void onApprove()}
          style={{
            ...planReviewButtonBase,
            background: 'var(--accent-green, #10b981)',
            color: '#ffffff',
            border: 'none',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)',
            cursor: sending ? 'not-allowed' : 'pointer',
            opacity: sending ? 0.6 : 1
          }}
        >
          <Check size={13} />
          <span>Approve &amp; Execute</span>
        </button>
        {!reviseOpen && (
          <button
            disabled={sending}
            onClick={() => setReviseOpen(true)}
            style={{
              ...planReviewButtonBase,
              background: 'transparent',
              color: 'var(--text-primary, #f3f4f6)',
              border: '1px solid var(--border-strong, #3b3e4f)'
            }}
          >
            <RotateCcw size={13} />
            <span>Revise Plan</span>
          </button>
        )}
        {reviseOpen && (
          <button
            disabled={sending || reviseText.trim().length === 0}
            onClick={sendFeedback}
            style={{
              ...planReviewButtonBase,
              background: 'var(--accent-blue, #3b82f6)',
              color: '#ffffff',
              border: 'none',
              cursor: sending || reviseText.trim().length === 0 ? 'not-allowed' : 'pointer',
              opacity: sending || reviseText.trim().length === 0 ? 0.6 : 1
            }}
          >
            <Send size={13} />
            <span>Send feedback</span>
          </button>
        )}
        {reviseOpen && (
          <button
            disabled={sending}
            onClick={() => setReviseOpen(false)}
            style={{
              ...planReviewButtonBase,
              background: 'transparent',
              color: 'var(--text-secondary, #9ca3af)',
              border: '1px solid transparent',
              padding: '8px 10px'
            }}
          >
            <span>Cancel</span>
          </button>
        )}
      </div>
      <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #6b7280)' }}>
        Execution tools stay locked until a plan is approved. Plan reviews remain open for up to ten minutes.
      </span>
    </article>
  );
};

function describeSessionAge(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatHeaderStatus(status: string, maxLen = 23): string {
  if (!status) return '';
  const trimmed = status.trim();

  const knownMap: Record<string, string> = {
    'Plan revision feedback sent.': 'Feedback sent',
    'Waiting for your approval…': 'Needs approval',
    'Approval request expired.': 'Request expired',
    'Approval granted.': 'Approved',
    'Approval denied.': 'Denied',
    'Analyzing workspace…': 'Analyzing…',
    'Stopping task…': 'Stopping…',
    'Task stopped.': 'Task stopped',
    'Task completed.': 'Task completed',
    'Could not start agent.': 'Could not start agent.'
  };
  if (knownMap[trimmed]) return knownMap[trimmed];

  const toolMatch = trimmed.match(/^Running\s+([a-zA-Z0-9_\-.:]+)(…|\.{3})?$/i);
  if (toolMatch) {
    const rawTool = toolMatch[1];
    const maxToolLen = 12;
    const toolName = rawTool.length > maxToolLen ? `${rawTool.slice(0, 10)}…` : rawTool;
    return `Running ${toolName}…`;
  }

  if (trimmed.length > maxLen) {
    return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
  }

  return trimmed;
}


export const ChatSidecar: React.FC = () => {
  const [input, setInput] = useState('');
  const [sidecarTab, setSidecarTab] = useState<'chat' | 'pair'>('chat');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const userAtBottomRef = useRef(true);
  const { messages, isRunning, currentTaskId, currentStatus, currentThought, streamingText, pendingApproval, sendMessage, stopTask, respondToApproval, clearChat, agentMode, setAgentMode, draftPrompt, setDraftPrompt, activeErrorCard, dismissErrorCard, contextTokens, recentSessions, pendingResume, loadRecentSessions, acceptSessionResume, dismissSessionResume } = useChatStore();
  const { isPairActive, suggestions, togglePairMode, dismissSuggestion, clearSuggestions } = usePairProgrammingStore();
  const communityKeyStatus = useSettingsStore((s) => s.communityKeyStatus);
  const [approvalSending, setApprovalSending] = useState(false);
  const { workspacePath, activeTabPath, openTabs, openDiffReview, applyDiff } = useWorkspaceStore();
  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const groupedMessages = useMemo(() => groupMessagesByTask(messages), [messages]);

  // Diagnostic Telemetry: Track H5 (Renderer Flush - first token painted to DOM)
  const reportedH5TaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentTaskId) {
      reportedH5TaskRef.current = null;
      return;
    }
    const hasTokens = (streamingText && streamingText.length > 0) || messages.some((m) => m.taskId === currentTaskId && m.role === 'assistant' && (m.content.length > 0 || (m.toolExecutions && m.toolExecutions.length > 0)));
    if (hasTokens && reportedH5TaskRef.current !== currentTaskId) {
      reportedH5TaskRef.current = currentTaskId;
      const targetTaskId = currentTaskId;
      window.requestAnimationFrame(() => {
        setTimeout(() => {
          const h5 = performance.timeOrigin + performance.now();
          window.electronAPI?.perfReportH5?.({ taskId: targetTaskId, h5 });
        }, 0);
      });
    }
  }, [streamingText, messages, currentTaskId]);
  const lastAssistantId = [...groupedMessages].reverse().find((message) => message.role === 'assistant')?.id;
  const lastUserMessage = [...groupedMessages].reverse().find((message) => message.role === 'user');

  useEffect(() => {
    if (!workspacePath || !loadRecentSessions) return;
    void loadRecentSessions(workspacePath);
  }, [workspacePath, loadRecentSessions]);
  const [resumeArmed, setResumeArmed] = useState(false);
  useEffect(() => {
    if (!pendingResume) setResumeArmed(false);
  }, [pendingResume]);

  // Up/Down prompt history (persisted across app launches)
  const promptHistoryRef = useRef<string[]>((() => {
    try {
      const raw = window.localStorage.getItem('ty_code_chat_history');
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  })());
  const historyIndexRef = useRef<number>(-1);
  const historyDraftRef = useRef<string>('');
  const rememberPrompt = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = [trimmed, ...promptHistoryRef.current.filter((entry) => entry !== trimmed)].slice(0, 100);
    promptHistoryRef.current = next;
    try {
      window.localStorage.setItem('ty_code_chat_history', JSON.stringify(next));
    } catch {
      // localStorage full or unavailable — history just stays in memory
    }
  };
  const lastHandoffAtRef = useRef<{ model: string; at: number }>({ model: '', at: 0 });

  // Ground Truth Direct Bypass Test State
  const [groundTruthRunning, setGroundTruthRunning] = useState(false);
  const [groundTruthText, setGroundTruthText] = useState<string | null>(null);
  const [groundTruthError, setGroundTruthError] = useState<string | null>(null);

  const handleTestGroundTruth = async () => {
    setGroundTruthRunning(true);
    setGroundTruthText('');
    setGroundTruthError(null);

    const unsubChunk = window.electronAPI?.onGroundTruthChunk?.((chunk: string) => {
      setGroundTruthText((prev) => (prev || '') + chunk);
    });

    const unsubEnd = window.electronAPI?.onGroundTruthEnd?.(() => {
      setGroundTruthRunning(false);
      unsubChunk?.();
      unsubEnd?.();
      unsubErr?.();
    });

    const unsubErr = window.electronAPI?.onGroundTruthError?.((err: string) => {
      setGroundTruthError(err);
      setGroundTruthRunning(false);
      unsubChunk?.();
      unsubEnd?.();
      unsubErr?.();
    });

    try {
      const res = await window.electronAPI?.testGroundTruthApi?.();
      if (res && !res.success) {
        setGroundTruthError(res.error || 'Failed to trigger ground truth API');
        setGroundTruthRunning(false);
      }
    } catch (e: any) {
      setGroundTruthError(e?.message || String(e));
      setGroundTruthRunning(false);
    }
  };

  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      setSidecarTab('chat');
      setDraftPrompt('');
      window.setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.selectionStart = inputRef.current.value.length;
          inputRef.current.selectionEnd = inputRef.current.value.length;
        }
      }, 50);
    }
  }, [draftPrompt, setDraftPrompt]);

  const handleScroll = () => {
    const feed = feedRef.current;
    if (feed) userAtBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  };
  useEffect(() => {
    if (!userAtBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }));
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streamingText, currentThought, currentStatus]);

  // Listen for mid-stream provider handoffs (FCC-3)
  useEffect(() => {
    const unsub = window.electronAPI?.onProviderHandoff?.((data) => {
      // Regulatory guard: duplicate handoff emissions for the same target
      // model inside a short window (probe/retry loops) must not spam the feed.
      const now = Date.now();
      const last = lastHandoffAtRef.current;
      if (last.model && (now - last.at) < 4000) return;
      lastHandoffAtRef.current = { model: data.newModel || data.toProvider, at: now };
      const modelName = data.newModel || data.toProvider;
      const handoffText = `⚠️ Previous provider throttled. Continuing with ${modelName}...`;
      useChatStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            role: 'system',
            content: handoffText,
            timestamp: Date.now()
          }
        ]
      }));
    });
    return () => unsub?.();
  }, []);

  const sendPrompt = (prompt: string, appendUserMessage = true, images?: string[], clientSentAt?: number) => {
    userAtBottomRef.current = true;
    const h1 = clientSentAt ?? (performance.timeOrigin + performance.now());
    console.log('UI: Sending prompt', prompt, 'H1:', h1);
    void sendMessage(prompt, workspacePath, activeTab?.path, activeTab?.content, appendUserMessage, { clientSentAt: h1 }, images);
  };
  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (isRunning) return;
    const h1 = performance.timeOrigin + performance.now();
    const attachments = useChatInputStore.getState().attachments;
    const media = attachments.filter((attachment) => attachment.type === 'media');
    const contextParts = attachments
      .filter((attachment) => attachment.type !== 'media')
      .map((attachment) => `@${attachment.name}\n${attachment.content}`)
      .filter(Boolean);
    const composedPrompt = contextParts.length > 0 ? [input.trim(), ...contextParts].join('\n\n').trim() : input.trim();
    const images = media.length > 0 ? media.map((attachment) => attachment.content) : undefined;
    if (!composedPrompt && !images) return;
    if (composedPrompt) rememberPrompt(composedPrompt);
    historyIndexRef.current = -1;
    useChatInputStore.getState().clearAttachments();
    setInput('');
    sendPrompt(composedPrompt, true, images, h1);
  };
  const handleRegenerate = () => {
    if (isRunning) {
      void stopTask();
    }
    const h1 = performance.timeOrigin + performance.now();
    const promptToRetry = lastUserMessage?.content || input.trim();
    if (promptToRetry) {
      sendPrompt(promptToRetry, !lastUserMessage, Array.isArray(lastUserMessage?.images) && lastUserMessage.images.length > 0 ? [...lastUserMessage.images] : undefined, h1);
    } else {
      inputRef.current?.focus();
    }
  };
  const cycleHistory = (direction: 1 | -1, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const history = promptHistoryRef.current;
    if (history.length === 0) return;
    if (historyIndexRef.current === -1) {
      if (direction === -1) {
        historyDraftRef.current = input;
        historyIndexRef.current = 0;
        setInput(history[0]);
      }
      return;
    }
    const nextIndex = historyIndexRef.current + direction;
    if (nextIndex >= history.length) {
      historyIndexRef.current = -1;
      setInput(historyDraftRef.current);
      return;
    }
    if (nextIndex < 0) {
      return;
    }
    event.preventDefault();
    historyIndexRef.current = nextIndex;
    setInput(history[nextIndex]);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'ArrowUp') {
      const el = event.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      if (atStart || el.value === '') cycleHistory(-1, event);
      return;
    }
    if (event.key === 'ArrowDown') {
      const el = event.currentTarget;
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      if (atEnd && historyIndexRef.current !== -1) cycleHistory(1, event);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(); }
  };

  return <aside className="chat-sidecar">
    <header className="chat-header">
      <div className="chat-header-top">
        <div className="chat-header-tabs" aria-label="Assistant view">
          <button
            type="button"
            aria-pressed={sidecarTab === 'chat'}
            onClick={() => setSidecarTab('chat')}
            className={`chat-header-tab${sidecarTab === 'chat' ? ' is-active' : ''}`}
          >
            <Sparkles size={13} aria-hidden="true" />
            <span>Assistant</span>
          </button>
          <button
            type="button"
            aria-pressed={sidecarTab === 'pair'}
            onClick={() => setSidecarTab('pair')}
            className={`chat-header-tab${sidecarTab === 'pair' ? ' is-active' : ''}`}
          >
            <Users size={13} aria-hidden="true" />
            <span>Pair Mode</span>
            {isPairActive && <span className="chat-pair-active-dot" aria-label="Pair session active" />}
          </button>
        </div>
        <div className="chat-header-actions">
          {currentStatus && <span className="chat-status" title={currentStatus}><Loader2 size={10} className="animate-spin" /><span>{formatHeaderStatus(currentStatus)}</span></span>}
          {sidecarTab === 'chat' ? (
            <button onClick={clearChat} title="Clear chat history" aria-label="Clear chat history" className="chat-icon-button"><Trash2 size={13} /></button>
          ) : (
            <button onClick={clearSuggestions} title="Clear pair suggestions" aria-label="Clear suggestions" className="chat-icon-button"><Trash2 size={13} /></button>
          )}
        </div>
      </div>
      {sidecarTab === 'chat' && (
        <div className="chat-header-controls">
          <div className="chat-header-agent-mode" aria-label="Agent mode">
            <button
              type="button"
              onClick={() => setAgentMode('build')}
              title="Build Agent: Full access to read, write, edit files and execute commands (Default)"
              aria-pressed={agentMode === 'build'}
              style={{
                background: agentMode === 'build' ? 'var(--accent-primary)' : 'transparent',
                color: agentMode === 'build' ? '#fff' : 'var(--text-muted)'
              }}
            >
              <Hammer size={10} aria-hidden="true" />
              <span>Build</span>
            </button>
            <button
              type="button"
              onClick={() => setAgentMode('plan')}
              title="Plan Agent: Read-only exploration and planning. Refuses file edits, bash commands require permission."
              aria-pressed={agentMode === 'plan'}
              style={{
                background: agentMode === 'plan' ? 'var(--accent-amber)' : 'transparent',
                color: agentMode === 'plan' ? '#fff' : 'var(--text-muted)'
              }}
            >
              <Compass size={10} aria-hidden="true" />
              <span>Plan</span>
            </button>
          </div>
          <div className="chat-header-model" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {communityKeyStatus === 'degraded' && (
              <span
                id="chip-community-key-degraded-chat"
                className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-[10px] px-2 py-0.5 rounded-full"
                title="Free Tier Rate Limited (Using Anonymous Fallback)"
                style={{
                  backgroundColor: 'rgba(234, 179, 8, 0.1)',
                  color: '#facc15',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0
                }}
              >
                ⚠️ Free Tier Rate Limited (Using Anonymous Fallback)
              </span>
            )}
            <ModelSelector />
          </div>
        </div>
      )}
    </header>

    {sidecarTab === 'chat' && agentMode === 'plan' && (
      <div
        style={{
          padding: '6px 10px',
          background: 'rgba(245, 158, 11, 0.1)',
          borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--accent-amber)',
          lineHeight: '1.3'
        }}
      >
        <Compass size={13} style={{ flexShrink: 0 }} />
        <span><strong>Plan Agent Active (Read-Only):</strong> File edits are refused; bash commands require permission. Switch to Build mode to apply changes.</span>
      </div>
    )}

    {sidecarTab === 'pair' ? (
      <div className="chat-feed" style={{ padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 12 }}>AI Pair Programmer</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isPairActive ? 'Active and watching editor edits' : 'Paused'}</div>
          </div>
          <button
            type="button"
            onClick={togglePairMode}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 4,
              background: isPairActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
              color: isPairActive ? 'var(--accent-red)' : 'var(--accent-green)',
              border: `1px solid ${isPairActive ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
              cursor: 'pointer'
            }}
          >
            {isPairActive ? 'Pause' : 'Start'}
          </button>
        </div>

        {suggestions.length === 0 ? (
          <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            <Lightbulb size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 8px auto' }} />
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Pair programming is listening</p>
            <p>Start writing functions, interfaces, or classes in the editor. Ty-Code will suggest next steps, bug warnings, and test-driven development workflows in real time.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map((sug) => (
              <div key={sug.id} style={{ padding: 10, borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: sug.type === 'bug-alert' ? 'var(--accent-red)' : sug.type === 'tdd-step' ? 'var(--accent-amber)' : 'var(--accent-cyan)' }}>{sug.title}</span>
                  <button type="button" onClick={() => dismissSuggestion(sug.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}><X size={11} /></button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sug.message}</div>
                {sug.actionLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setSidecarTab('chat');
                      sendPrompt(`Let's execute: ${sug.title}. Detail: ${sug.message}`);
                    }}
                    style={{ alignSelf: 'flex-start', padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer', marginTop: 4 }}
                  >
                    {sug.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    ) : (
      <div ref={feedRef} onScroll={handleScroll} className="chat-feed" aria-live="polite">
        {groupedMessages.length === 0 && !isRunning && (
          <div className="chat-empty-state">
            <Sparkles size={30} color="var(--border-strong)" />
            <strong>How can Ty-Code help you today?</strong>
            <span>Explore your workspace, implement a feature, fix a bug, or run a test suite.</span>
          </div>
        )}

        {!isRunning && pendingResume && !resumeArmed && (
          <div className="session-resume-card" role="status">
            <strong>Offer from the previous session</strong>
            <span>
              Mode: {pendingResume.mode} | {pendingResume.todoCount} task{pendingResume.todoCount === 1 ? '' : 's'} | {describeSessionAge(pendingResume.updatedAt)}
            </span>
            <div className="session-resume-actions">
              <button type="button" className="session-resume-confirm" onClick={() => { setResumeArmed(true); acceptSessionResume(pendingResume); }}>
                Resume and continue tasks
              </button>
              <button type="button" className="session-resume-dismiss" onClick={() => { setResumeArmed(false); dismissSessionResume(); }}>
                Ignore
              </button>
            </div>
            <span className="session-resume-note">Your next message resumes this session; tasks and iteration progress are restored from disk.</span>
          </div>
        )}

        {groupedMessages.map((message) => {
          const isLastAssistant = message.id === lastAssistantId;
          const isStreaming = isLastAssistant && (message.isStreaming ?? isRunning);
          return (
            <ChatMessageItem
              key={message.id}
              message={message}
              isLastAssistant={isLastAssistant}
              isRunning={isRunning}
              isStreaming={isStreaming}
              currentStatus={currentStatus}
              contextTokens={contextTokens}
              onRegenerate={handleRegenerate}
              onInspectDiff={openDiffReview}
              onApplyDiff={(diff) => void applyDiff(diff)}
              onRetryError={handleRegenerate}
            />
          );
        })}

        {pendingApproval && pendingApproval.approvalKind === 'plan_review' && (
          <PlanReviewCard
            approval={pendingApproval}
            sending={approvalSending}
            onApprove={async () => {
              setApprovalSending(true);
              try {
                await respondToApproval(true);
              } finally {
                setApprovalSending(false);
              }
            }}
            onRevise={async (feedback) => {
              setApprovalSending(true);
              try {
                await respondToApproval(false, feedback);
              } finally {
                setApprovalSending(false);
              }
            }}
          />
        )}

        {pendingApproval && pendingApproval.approvalKind !== 'plan_review' && (
          <article className="agent-approval" role="alert" aria-labelledby="agent-approval-title">
            <div className="agent-approval-heading">
              <ShieldCheck size={15} />
              <div>
                <strong id="agent-approval-title">Approval required</strong>
                <span>{pendingApproval.reason}</span>
              </div>
            </div>
            <div className="agent-approval-tool">
              <strong>{pendingApproval.toolCall.name}</strong>
              <pre>{JSON.stringify(pendingApproval.toolCall.arguments, null, 2)}</pre>
            </div>
            {pendingApproval.reviewDiff && (
              <details className="agent-approval-diff" open>
                <summary>
                  Review proposed file change ({pendingApproval.addedLines || 0} added, {pendingApproval.removedLines || 0} removed)
                </summary>
                <div>
                  <strong>Before</strong>
                  <pre>{pendingApproval.reviewDiff.originalContent || '(new file)'}</pre>
                </div>
                <div>
                  <strong>After</strong>
                  <pre>{pendingApproval.reviewDiff.proposedContent}</pre>
                </div>
              </details>
            )}
            {pendingApproval.affectedPaths && pendingApproval.affectedPaths.length > 0 && (
              <div className="agent-approval-paths">
                <strong>Potentially affected paths</strong>
                <ul>
                  {pendingApproval.affectedPaths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="agent-approval-actions">
              <button
                className="agent-approval-decline"
                disabled={approvalSending}
                onClick={async () => {
                  setApprovalSending(true);
                  try {
                    await respondToApproval(false);
                  } finally {
                    setApprovalSending(false);
                  }
                }}
              >
                <X size={12} />
                Deny
              </button>
              <button
                className="agent-approval-accept"
                disabled={approvalSending}
                onClick={async () => {
                  setApprovalSending(true);
                  try {
                    await respondToApproval(true);
                  } finally {
                    setApprovalSending(false);
                  }
                }}
              >
                <Check size={12} />
                {pendingApproval.reviewDiff ? 'Apply change' : 'Approve operation'}
              </button>
              <button
                className="agent-approval-accept-temp"
                disabled={approvalSending}
                onClick={async () => {
                  setApprovalSending(true);
                  try {
                    await respondToApproval(true);
                    if (pendingApproval?.toolCall?.name) {
                      await window.electronAPI?.addApprovalRule?.({
                        toolName: pendingApproval.toolCall.name,
                        action: 'auto_approve',
                        scope: 'workspace',
                        expiresAt: Date.now() + 10 * 60 * 1000
                      });
                    }
                  } finally {
                    setApprovalSending(false);
                  }
                }}
              >
                Approve for 10 min
              </button>
            </div>
            <span className="agent-approval-note">
              Nothing runs or changes until approved. Requests expire after two minutes.
            </span>
          </article>
        )}

        {activeErrorCard && (
          <div className="chat-active-error-banner" style={{ margin: '8px 0' }}>
            <ChatErrorCard
              errorCard={activeErrorCard}
              onRetry={handleRegenerate}
              onDismiss={dismissErrorCard}
            />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    )}

    <BackgroundAgentsPanel />

    <ChatInput
      input={input}
      inputRef={inputRef}
      onInputChange={setInput}
      onKeyDown={handleKeyDown}
      onSubmit={handleSubmit}
      isRunning={isRunning}
      onStop={() => void stopTask()}
    />
  </aside>;
};
