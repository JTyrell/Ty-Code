import React, { useEffect, useState } from 'react';
import {
  X,
  Key,
  Server,
  Sliders,
  ShieldCheck,
  Terminal,
  Plus,
  Trash2,
  Code2,
  Keyboard,
  Play,
  Square,
  RotateCw,
  Search,
  Check
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import type { ProviderType, ShellInfo, TerminalProfile, LanguageServerStatus } from '../../../preload/types';
import { DEFAULT_KEYBINDINGS, type KeybindingItem } from '../../../main/services/config-schemas';

type SettingsTab = 'keys' | 'endpoints' | 'params' | 'terminal' | 'lsp' | 'editor' | 'shortcuts' | 'extensions';

function createProfileId(): string {
  return `profile_${globalThis.crypto.randomUUID()}`;
}

export const SettingsModal: React.FC = () => {
  const { isSettingsOpen, toggleSettings, settings, saveSettings } = useChatStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('keys');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434/v1');
  const [fccProxyUrl, setFccProxyUrl] = useState('http://localhost:8082/v1');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState('');
  const [newProfileName, setNewProfileName] = useState('Developer shell');
  const [newProfileShellId, setNewProfileShellId] = useState('');
  const [newProfilePath, setNewProfilePath] = useState('');
  const [error, setError] = useState('');

  // LSP Settings state
  const [lspServers, setLspServers] = useState<LanguageServerStatus[]>([]);
  const [lspActionLoading, setLspActionLoading] = useState<Record<string, boolean>>({});
  const [customLspPaths, setCustomLspPaths] = useState<Record<string, string>>({});

  // Editor Settings state
  const [fontSize, setFontSize] = useState(13);
  const [tabSize, setTabSize] = useState(2);
  const [minimap, setMinimap] = useState(true);
  const [bracketPairs, setBracketPairs] = useState(true);
  const [autoSaveDelay, setAutoSaveDelay] = useState(1000);

  // Keybindings state
  const [keybindingSearch, setKeybindingSearch] = useState('');
  const [thirdPartyRuntimeEnabled, setThirdPartyRuntimeEnabled] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setOpenRouterKey('');
    setGroqKey('');
    setDeepseekKey('');
    setOllamaUrl(settings.customEndpoints?.ollama || 'http://localhost:11434/v1');
    setFccProxyUrl(settings.customEndpoints?.['fcc-proxy'] || 'http://localhost:8082/v1');
    setTemperature(settings.temperature ?? 0.2);
    setMaxTokens(settings.maxTokens ?? 4096);
    setProfiles(settings.terminalProfiles || []);
    setDefaultProfileId(settings.defaultTerminalProfileId || '');
    setThirdPartyRuntimeEnabled(settings.thirdPartyRuntimeEnabled ?? false);
  }, [settings]);

  useEffect(() => {
    if (!window.electronAPI) return;
    let cancelled = false;

    void window.electronAPI.getAvailableShells().then((response) => {
      if (!cancelled && response.success && response.data) {
        setShells(response.data);
        setNewProfileShellId((current) => current || response.data?.find((shell) => shell.isDefault)?.id || response.data?.[0]?.id || '');
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });

    void refreshLspServers();

    return () => { cancelled = true; };
  }, []);

  const refreshLspServers = async () => {
    if (!window.electronAPI?.lspGetServers) return;
    try {
      const res = await window.electronAPI.lspGetServers();
      if (res.success && res.data) {
        setLspServers(res.data);
        const paths: Record<string, string> = {};
        for (const s of res.data) {
          paths[s.languageId] = s.command;
        }
        setCustomLspPaths(paths);
      }
    } catch {
      // Ignore
    }
  };

  const handleStartLsp = async (languageId: string) => {
    setLspActionLoading((prev) => ({ ...prev, [languageId]: true }));
    try {
      await window.electronAPI.lspStartServer(languageId);
      await refreshLspServers();
    } finally {
      setLspActionLoading((prev) => ({ ...prev, [languageId]: false }));
    }
  };

  const handleStopLsp = async (languageId: string) => {
    setLspActionLoading((prev) => ({ ...prev, [languageId]: true }));
    try {
      await window.electronAPI.lspStopServer(languageId);
      await refreshLspServers();
    } finally {
      setLspActionLoading((prev) => ({ ...prev, [languageId]: false }));
    }
  };

  const handleRestartLsp = async (languageId: string) => {
    setLspActionLoading((prev) => ({ ...prev, [languageId]: true }));
    try {
      await window.electronAPI.lspRestartServer(languageId);
      await refreshLspServers();
    } finally {
      setLspActionLoading((prev) => ({ ...prev, [languageId]: false }));
    }
  };

  const handleSaveLspConfig = async (languageId: string) => {
    const custom = customLspPaths[languageId];
    if (custom) {
      await window.electronAPI.lspConfigureServer(languageId, {
        enabled: true,
        customPath: custom
      });
      await refreshLspServers();
    }
  };

  if (!isSettingsOpen) return null;

  const apiKeyConfigured = (provider: ProviderType) => Boolean(settings?.apiKeysConfigured?.[provider]);

  const handleAddProfile = () => {
    setError('');
    const shellId = newProfileShellId;
    if (!newProfileName.trim() || !shellId) {
      setError('Enter a profile name and select a shell.');
      return;
    }
    if (shellId === 'custom' && !newProfilePath.trim()) {
      setError('Enter the full path to the custom shell executable.');
      return;
    }
    const profile: TerminalProfile = {
      id: createProfileId(),
      name: newProfileName.trim(),
      shellId,
      ...(shellId === 'custom' ? { customShellPath: newProfilePath.trim() } : {})
    };
    setProfiles((current) => [...current, profile]);
    if (!defaultProfileId) setDefaultProfileId(profile.id);
    setNewProfileName('Developer shell');
    setNewProfilePath('');
  };

  const updateProfile = (id: string, updates: Partial<TerminalProfile>) => {
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...updates } : profile));
  };

  const removeProfile = (id: string) => {
    const remaining = profiles.filter((profile) => profile.id !== id);
    setProfiles(remaining);
    if (defaultProfileId === id) setDefaultProfileId(remaining[0]?.id || '');
  };

  const handleSave = async () => {
    setError('');
    const saved = await saveSettings({
      apiKeys: { openrouter: openRouterKey, groq: groqKey, deepseek: deepseekKey },
      customEndpoints: { ollama: ollamaUrl, 'fcc-proxy': fccProxyUrl },
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      terminalProfiles: profiles,
      defaultTerminalProfileId: defaultProfileId || undefined,
      thirdPartyRuntimeEnabled
    });
    if (!saved) {
      setError('Failed to save settings. See the application log for details.');
      return;
    }
    toggleSettings();
  };

  const renderApiKey = (
    provider: ProviderType,
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder: string
  ) => {
    const configured = apiKeyConfigured(provider);
    return (
      <div className="settings-field-group" key={provider}>
        <div className="settings-field-header">
          <label className="settings-field-label">{label}</label>
          <span className={`settings-status-pill ${configured ? 'is-configured' : 'is-missing'}`}>
            {configured ? 'Configured' : 'Missing'}
          </span>
        </div>
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured ? 'Saved in secure storage — enter a new key to update' : placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ width: '100%' }}
        />
      </div>
    );
  };

  const filteredKeybindings = DEFAULT_KEYBINDINGS.filter((kb) => {
    if (!keybindingSearch.trim()) return true;
    const q = keybindingSearch.toLowerCase();
    return (
      kb.command.toLowerCase().includes(q) ||
      kb.key.toLowerCase().includes(q) ||
      (kb.description && kb.description.toLowerCase().includes(q)) ||
      (kb.category && kb.category.toLowerCase().includes(q))
    );
  });

  return (
    <div className="settings-backdrop" onClick={toggleSettings}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" style={{ maxWidth: '780px' }}>
        <header className="settings-header">
          <div className="settings-title"><Key size={16} color="var(--accent-primary)" /><span>Ty-Claude Preferences &amp; Configuration</span></div>
          <button onClick={toggleSettings} className="settings-close" aria-label="Close settings"><X size={14} /></button>
        </header>

        <nav className="settings-tabs" aria-label="Settings sections">
          <button className={activeTab === 'keys' ? 'is-active' : ''} onClick={() => setActiveTab('keys')}><Key size={13} />API Keys</button>
          <button className={activeTab === 'endpoints' ? 'is-active' : ''} onClick={() => setActiveTab('endpoints')}><Server size={13} />Endpoints</button>
          <button className={activeTab === 'params' ? 'is-active' : ''} onClick={() => setActiveTab('params')}><Sliders size={13} />Inference</button>
          <button className={activeTab === 'terminal' ? 'is-active' : ''} onClick={() => setActiveTab('terminal')}><Terminal size={13} />Terminal</button>
          <button className={activeTab === 'lsp' ? 'is-active' : ''} onClick={() => setActiveTab('lsp')}><Code2 size={13} />Language Servers (LSP)</button>
          <button className={activeTab === 'editor' ? 'is-active' : ''} onClick={() => setActiveTab('editor')}><Sliders size={13} />Editor Polish</button>
          <button className={activeTab === 'shortcuts' ? 'is-active' : ''} onClick={() => setActiveTab('shortcuts')}><Keyboard size={13} />Keybindings</button>
          <button className={activeTab === 'extensions' ? 'is-active' : ''} onClick={() => setActiveTab('extensions')}><ShieldCheck size={13} />Extensions</button>
        </nav>

        <div className="settings-body" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          {activeTab === 'keys' && <>
            {renderApiKey('openrouter', 'OpenRouter API key', openRouterKey, setOpenRouterKey, 'sk-or-v1-…')}
            {renderApiKey('groq', 'Groq API key', groqKey, setGroqKey, 'gsk_…')}
            {renderApiKey('deepseek', 'DeepSeek API key', deepseekKey, setDeepseekKey, 'sk-…')}
            <div className="settings-secure-note"><ShieldCheck size={14} /><span>Credentials remain in the main process and are encrypted with Electron safeStorage.</span></div>
          </>}

          {activeTab === 'endpoints' && <>
            <div><label className="settings-field-label">Local Ollama base URL</label><input type="url" value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} placeholder="http://localhost:11434/v1" style={{ width: '100%' }} /></div>
            <div><label className="settings-field-label">Free-Claude-Code proxy URL</label><input type="url" value={fccProxyUrl} onChange={(event) => setFccProxyUrl(event.target.value)} placeholder="http://localhost:8082/v1" style={{ width: '100%' }} /></div>
          </>}

          {activeTab === 'params' && <>
            <div><label className="settings-field-label">Temperature: {temperature}</label><input type="range" min="0" max="1" step="0.05" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} style={{ width: '100%' }} /></div>
            <div><label className="settings-field-label">Max response tokens</label><input type="number" min="1024" max="16384" step="512" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} style={{ width: '100%' }} /></div>
          </>}

          {activeTab === 'terminal' && <>
            <div className="settings-section-heading"><strong>Shell profiles</strong><span>Profiles are available in the terminal tab menu.</span></div>
            <div><label className="settings-field-label">Default terminal profile</label>
              <select value={defaultProfileId} onChange={(event) => setDefaultProfileId(event.target.value)} style={{ width: '100%' }}>
                <option value="">Use system default</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.shellId}</option>)}
              </select>
            </div>
            {profiles.map((profile) => (
              <div className="terminal-profile-row" key={profile.id}>
                <div className="terminal-profile-fields">
                  <input aria-label="Profile name" value={profile.name} onChange={(event) => updateProfile(profile.id, { name: event.target.value })} />
                  <select aria-label="Profile shell" value={profile.shellId} onChange={(event) => updateProfile(profile.id, { shellId: event.target.value, customShellPath: event.target.value === 'custom' ? profile.customShellPath : undefined })}>
                    {shells.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}
                    <option value="custom">Custom executable…</option>
                  </select>
                  <button className="terminal-profile-remove" onClick={() => removeProfile(profile.id)} title={`Remove ${profile.name}`} aria-label={`Remove ${profile.name}`}><Trash2 size={13} /></button>
                </div>
                {profile.shellId === 'custom' && <input aria-label="Custom shell executable path" value={profile.customShellPath || ''} onChange={(event) => updateProfile(profile.id, { customShellPath: event.target.value })} placeholder="Absolute path to shell executable" />}
              </div>
            ))}
            <div className="terminal-profile-create">
              <div className="terminal-profile-fields">
                <input aria-label="New profile name" value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Profile name" />
                <select aria-label="New profile shell" value={newProfileShellId} onChange={(event) => setNewProfileShellId(event.target.value)}>
                  {shells.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}
                  <option value="custom">Custom executable…</option>
                </select>
                <button className="terminal-profile-add" onClick={handleAddProfile} title="Add shell profile" aria-label="Add shell profile"><Plus size={14} /></button>
              </div>
              {newProfileShellId === 'custom' && <input value={newProfilePath} onChange={(event) => setNewProfilePath(event.target.value)} placeholder="Absolute path to shell executable" aria-label="New custom shell executable path" />}
            </div>
            <div className="settings-hint">Session scrollback and shell profile are saved locally.</div>
          </>}

          {/* LSP Settings Tab */}
          {activeTab === 'lsp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Language servers provide IntelliSense, Go-to-Definition, and Refactoring. If a server is not installed, Ty-Claude seamlessly falls back to Monaco's built-in language engine.
              </div>

              {lspServers.map((server) => {
                const isLoading = Boolean(lspActionLoading[server.languageId]);
                const statusColor =
                  server.status === 'running'
                    ? 'var(--accent-green)'
                    : server.isAvailable
                    ? 'var(--text-muted)'
                    : 'var(--accent-amber)';

                return (
                  <div
                    key={server.languageId}
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                          {server.name}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            color: statusColor,
                            fontWeight: 700,
                            textTransform: 'uppercase'
                          }}
                        >
                          {server.status === 'running' ? 'Running' : server.isAvailable ? 'Stopped' : 'Not Installed'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {server.status === 'running' ? (
                          <>
                            <button
                              onClick={() => void handleRestartLsp(server.languageId)}
                              disabled={isLoading}
                              style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Restart Server"
                            >
                              <RotateCw size={11} className={isLoading ? 'spin' : ''} />
                              <span>Restart</span>
                            </button>
                            <button
                              onClick={() => void handleStopLsp(server.languageId)}
                              disabled={isLoading}
                              style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px', backgroundColor: 'var(--bg-hover)', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Stop Server"
                            >
                              <Square size={11} />
                              <span>Stop</span>
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => void handleStartLsp(server.languageId)}
                            disabled={isLoading || !server.isAvailable}
                            style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px', backgroundColor: server.isAvailable ? 'var(--accent-primary)' : 'var(--bg-hover)', color: '#fff', display: 'flex', alignItems: 'center', gap: '4px', opacity: server.isAvailable ? 1 : 0.5 }}
                            title={server.isAvailable ? 'Start Server' : 'Binary not found'}
                          >
                            <Play size={11} />
                            <span>Start</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Command / Custom Path input */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="text"
                        value={customLspPaths[server.languageId] || ''}
                        onChange={(e) => setCustomLspPaths({ ...customLspPaths, [server.languageId]: e.target.value })}
                        placeholder={`Command / binary path (default: ${server.command})`}
                        style={{ flex: 1, padding: '4px 8px', fontSize: '11px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      />
                      <button
                        onClick={() => void handleSaveLspConfig(server.languageId)}
                        style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: 'var(--bg-hover)', borderRadius: '4px', color: 'var(--text-secondary)' }}
                      >
                        Apply
                      </button>
                    </div>

                    {!server.isAvailable && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Install command: <code style={{ color: 'var(--accent-cyan)' }}>{server.installInstructions}</code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Editor Polish Tab */}
          {activeTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="settings-field-label">Font Size: {fontSize}px</label>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label className="settings-field-label">Tab Size: {tabSize} spaces</label>
                <select
                  value={tabSize}
                  onChange={(e) => setTabSize(Number(e.target.value))}
                  style={{ width: '100%' }}
                >
                  <option value={2}>2 spaces</option>
                  <option value={4}>4 spaces</option>
                  <option value={8}>8 spaces</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="minimap-toggle"
                  checked={minimap}
                  onChange={(e) => setMinimap(e.target.checked)}
                />
                <label htmlFor="minimap-toggle" style={{ fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Enable Minimap code overview on right side
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="bracket-toggle"
                  checked={bracketPairs}
                  onChange={(e) => setBracketPairs(e.target.checked)}
                />
                <label htmlFor="bracket-toggle" style={{ fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Enable Bracket Pair Colorization & Guides
                </label>
              </div>

              <div>
                <label className="settings-field-label">Auto-Save Delay ({autoSaveDelay}ms)</label>
                <input
                  type="number"
                  min="200"
                  max="10000"
                  step="200"
                  value={autoSaveDelay}
                  onChange={(e) => setAutoSaveDelay(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'extensions' && (
            <section className="extension-runtime-settings" aria-labelledby="extension-runtime-heading">
              <h3 id="extension-runtime-heading" className="settings-field-label">Extension runtime</h3>
              <div className="settings-secure-note">
                <ShieldCheck size={14} />
                <span>Built-in packages run in an isolated Worker with mediated Ty-Claude Extension API capabilities.</span>
              </div>
              <label className="extension-runtime-toggle" htmlFor="third-party-extension-runtime">
                <input id="third-party-extension-runtime" type="checkbox" checked={thirdPartyRuntimeEnabled} onChange={(event) => setThirdPartyRuntimeEnabled(event.target.checked)} aria-describedby="extension-runtime-help" />
                <span>Enable third-party extension runtime</span>
              </label>
              <p id="extension-runtime-help" className="settings-hint">
This preference is off by default. Enabling it records your intent only; community packages remain metadata-only until package verification and the runtime complete security review.
              </p>
            </section>
          )}

          {/* Keybindings Tab */}
          {activeTab === 'shortcuts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-tertiary)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <Search size={13} color="var(--text-muted)" />
                <input
                  type="text"
                  value={keybindingSearch}
                  onChange={(e) => setKeybindingSearch(e.target.value)}
                  placeholder="Search keyboard shortcuts..."
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-primary)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {filteredKeybindings.map((kb) => (
                  <div
                    key={kb.command}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{kb.description || kb.command}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{kb.command}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontFamily: "'JetBrains Mono', monospace",
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-subtle)',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {kb.key}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div className="settings-error" role="alert">{error}</div>}
        </div>

        <footer className="settings-footer">
          <button className="settings-cancel" onClick={toggleSettings}>Cancel</button>
          <button className="settings-save" onClick={() => void handleSave()}>Save Settings</button>
        </footer>
      </section>
    </div>
  );
};
