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
import { Send, Square, Sparkles, Trash2, ChevronRight, ChevronDown, Terminal, FileCode, Check, Eye, AlertCircle, Copy, RotateCcw, Loader2, ShieldCheck, X, Users, Lightbulb, Hammer, Compass, Info, Presentation, Play, ExternalLink, Settings, Activity, Key, WifiOff, Clock, RefreshCw } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { ModelSelector } from './ChatInterface/ModelSelector';
import type { ChatMessage, ToolCall, ToolExecutionStatus, ChatErrorCard, ProviderType } from '../../../preload/types';

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
export const ConnectProviderCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const { settings, saveSettings, openSettings } = useChatStore();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const activeProvider = errorCard.providerId || settings?.activeProvider || 'openrouter';
  const providerDisplayNames: Record<string, string> = {
    openrouter: 'OpenRouter',
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
    groq: 'https://console.groq.com/keys',
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    gemini: 'https://aistudio.google.com/app/apikey',
    deepseek: 'https://platform.deepseek.com/api_keys'
  };
  const displayName = providerDisplayNames[activeProvider] || activeProvider;
  const keyLink = errorCard.actionUrl || providerLinks[activeProvider] || 'https://openrouter.ai/keys';

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const ok = await saveSettings({
        apiKeys: { [activeProvider]: apiKey.trim() }
      });
      if (ok) {
        setSaved(true);
        if (onRetry) {
          window.setTimeout(() => {
            onRetry();
          }, 600);
        }
      }
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
export const NetworkErrorCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
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
export const QuotaExhaustedCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  const { openSettings, saveSettings } = useChatStore();
  const [countdown, setCountdown] = useState<number>(errorCard.retryAfterSec || 60);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev: number) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

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

        <div className="chat-error-alternatives">
          <span className="chat-error-alt-title">Alternative providers available:</span>
          <div className="chat-error-alt-buttons">
            <button
              type="button"
              className="chat-error-alt-btn"
              onClick={() => void handleSwitchToProvider('openrouter', 'deepseek/deepseek-r1:free')}
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
export const ProviderUnavailableCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
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
export const StandardErrorCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
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

export const ErrorCard: React.FC<{ errorCard: ChatErrorCard; onRetry?: () => void }> = ({ errorCard, onRetry }) => {
  if (errorCard.taxonomyCode === 'CONFIG_MISSING') {
    return <ConnectProviderCard errorCard={errorCard} onRetry={onRetry} />;
  }
  if (errorCard.taxonomyCode === 'NETWORK_BLOCKED') {
    return <NetworkErrorCard errorCard={errorCard} onRetry={onRetry} />;
  }
  if (errorCard.taxonomyCode === 'RATE_LIMITED' || errorCard.taxonomyCode === 'QUOTA_EXCEEDED') {
    return <QuotaExhaustedCard errorCard={errorCard} onRetry={onRetry} />;
  }
  if (errorCard.taxonomyCode === 'PROVIDER_DOWN' || errorCard.taxonomyCode === 'TIMEOUT') {
    return <ProviderUnavailableCard errorCard={errorCard} onRetry={onRetry} />;
  }
  return <StandardErrorCard errorCard={errorCard} onRetry={onRetry} />;
};

export const ChatSidecar: React.FC = () => {
  const [input, setInput] = useState('');
  const [sidecarTab, setSidecarTab] = useState<'chat' | 'pair'>('chat');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const userAtBottomRef = useRef(true);
  const { messages, isRunning, currentStatus, currentThought, streamingText, pendingApproval, sendMessage, stopTask, respondToApproval, clearChat, agentMode, setAgentMode, draftPrompt, setDraftPrompt } = useChatStore();
  const { isPairActive, suggestions, togglePairMode, dismissSuggestion, clearSuggestions } = usePairProgrammingStore();
  const [approvalSending, setApprovalSending] = useState(false);
  const { workspacePath, activeTabPath, openTabs, openDiffReview, applyDiff } = useWorkspaceStore();
  const activeTab = openTabs.find((tab) => tab.path === activeTabPath);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const firstTokenPending = isRunning && !streamingText && !currentThought && !messages.some((message) => message.role === 'tool' && message.toolStatus === 'running');

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

  const sendPrompt = (prompt: string, appendUserMessage = true) => {
    userAtBottomRef.current = true;
    void sendMessage(prompt, workspacePath, activeTab?.path, activeTab?.content, appendUserMessage);
  };
  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!input.trim() || isRunning) return;
    const prompt = input.trim();
    setInput('');
    sendPrompt(prompt);
  };
  const handleRegenerate = () => {
    if (!isRunning && lastUserMessage) sendPrompt(lastUserMessage.content, false);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          {currentStatus && <span className="chat-status" title={currentStatus}><Loader2 size={10} className="animate-spin" /><span>{currentStatus}</span></span>}
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
                background: agentMode === 'plan' ? '#f59e0b' : 'transparent',
                color: agentMode === 'plan' ? '#fff' : 'var(--text-muted)'
              }}
            >
              <Compass size={10} aria-hidden="true" />
              <span>Plan</span>
            </button>
          </div>
          <div className="chat-header-model">
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
          color: '#f59e0b',
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
              color: isPairActive ? '#ef4444' : '#22c55e',
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
                  <span style={{ fontSize: 11, fontWeight: 700, color: sug.type === 'bug-alert' ? '#ef4444' : sug.type === 'tdd-step' ? '#f59e0b' : '#38bdf8' }}>{sug.title}</span>
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
        {messages.length === 0 && !streamingText && <div className="chat-empty-state"><Sparkles size={30} color="var(--border-strong)" /><strong>How can Ty-Code help you today?</strong><span>Explore your workspace, implement a feature, fix a bug, or run a test suite.</span></div>}
        {messages.map((message) => <article key={message.id} className={`chat-message is-${message.role}`}>
          {message.role === 'user' ? <div className="user-message-bubble">{message.content}</div> : <div className="assistant-message-bubble">
            {message.toolCall && <ToolCard tool={message.toolCall} status={message.toolStatus} output={message.toolResult?.output ?? (message.toolStatus === 'running' ? undefined : message.content || undefined)} />}
            {message.toolCalls?.map((tool: ToolCall) => <ToolCard key={tool.id} tool={tool} />)}
            {message.proposedDiffs?.map((proposedDiff) => <DiffCard key={proposedDiff.id} diff={proposedDiff} onInspect={() => openDiffReview(proposedDiff)} onApply={() => void applyDiff(proposedDiff)} />)}
            {message.errorCard ? (
              <ErrorCard errorCard={message.errorCard} onRetry={handleRegenerate} />
            ) : (
              message.content && <MarkdownContent content={message.content} />
            )}
            {message.reasoning && <details className="chat-reasoning"><summary>Reasoning summary</summary><div>{message.reasoning}</div></details>}
            {message.id === lastAssistantId && !isRunning && lastUserMessage && <div className="assistant-message-actions"><button onClick={handleRegenerate} title="Regenerate last response"><RotateCcw size={11} />Regenerate</button></div>}
          </div>}
        </article>)}
        {streamingText && <article className="chat-message is-assistant"><div className="assistant-message-bubble"><MarkdownContent content={streamingText} /></div></article>}
        {pendingApproval && <article className="agent-approval" role="alert" aria-labelledby="agent-approval-title">
          <div className="agent-approval-heading"><ShieldCheck size={15} /><div><strong id="agent-approval-title">Approval required</strong><span>{pendingApproval.reason}</span></div></div>
          <div className="agent-approval-tool"><strong>{pendingApproval.toolCall.name}</strong><pre>{JSON.stringify(pendingApproval.toolCall.arguments, null, 2)}</pre></div>
          {pendingApproval.reviewDiff && <details className="agent-approval-diff" open>
            <summary>Review proposed file change ({pendingApproval.addedLines || 0} added, {pendingApproval.removedLines || 0} removed)</summary>
            <div><strong>Before</strong><pre>{pendingApproval.reviewDiff.originalContent || '(new file)'}</pre></div>
            <div><strong>After</strong><pre>{pendingApproval.reviewDiff.proposedContent}</pre></div>
          </details>}
          {pendingApproval.affectedPaths && pendingApproval.affectedPaths.length > 0 && <div className="agent-approval-paths"><strong>Potentially affected paths</strong><ul>{pendingApproval.affectedPaths.map((path) => <li key={path}>{path}</li>)}</ul></div>}
          <div className="agent-approval-actions">
            <button className="agent-approval-decline" disabled={approvalSending} onClick={async () => { setApprovalSending(true); try { await respondToApproval(false); } finally { setApprovalSending(false); } }}><X size={12} />Deny</button>
            <button className="agent-approval-accept" disabled={approvalSending} onClick={async () => { setApprovalSending(true); try { await respondToApproval(true); } finally { setApprovalSending(false); } }}><Check size={12} />{pendingApproval.reviewDiff ? 'Apply change' : 'Approve operation'}</button>
          </div>
          <span className="agent-approval-note">Nothing runs or changes until approved. Requests expire after two minutes.</span>
        </article>}
        {currentThought && <div className="chat-reasoning is-live"><strong>Reasoning</strong><span>{currentThought}</span></div>}
        {firstTokenPending && <div className="chat-typing-indicator" role="status"><Loader2 size={12} className="animate-spin" color="var(--accent-primary)" /><span>Ty-Code is thinking…</span></div>}
        <div ref={messagesEndRef} />
      </div>
    )}

    <form onSubmit={handleSubmit} className="chat-composer">
      <div className="chat-composer-field">
        <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Ty-Code… (Enter to send)" aria-label="Message Ty-Code" rows={3} />
        {isRunning ? <button type="button" onClick={() => void stopTask()} className="chat-send-button is-stop" title="Stop agent" aria-label="Stop agent"><Square size={12} /></button>
          : <button type="submit" disabled={!input.trim()} className="chat-send-button" title="Send message" aria-label="Send message"><Send size={13} /></button>}
      </div>
      <div className="chat-composer-hint">Shift+Enter for a new line</div>
    </form>
  </aside>;
};
