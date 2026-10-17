import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  Check,
  Copy,
  Zap,
  Globe,
  Sparkles,
  Layers,
  Gauge,
  Eye,
  LockKeyhole,
  Activity,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useExtensionStore } from '../state/extension-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import type {
  EditReviewPolicy,
  ProviderType,
  ShellInfo,
  TerminalProfile,
  LanguageServerStatus,
  PreConfiguredProvider,
  DiscoveredModel,
  TestConnectionResult,
  TelemetryPreview,
  CredentialStorageStatus,
  AppInfo
} from '../../../preload/types';
import type { SecurityPolicySettings, SettingsData, SettingsScope, WorkspaceSettingsPatch } from '../../../shared/types/settings';
import { DEFAULT_KEYBINDINGS, type KeybindingItem } from '../../../main/services/config-schemas';
import { DEFAULT_PRESET_MODELS } from '../../../preload/preset-models';
import { useLspStore } from '../state/lsp-store';
import { toast } from '../state/toast-store';
import { FCCSetup } from './settings/FCCSetup';
import { OpenKiloSetup } from './settings/OpenKiloSetup';
import { ProviderSelectionGrid, type ProviderStatusInfo } from './settings/ProviderSelectionGrid';
import { ProviderSetupForm } from './settings/ProviderSetupForm';
import { ModelSelectorDropdown } from './settings/ModelSelectorDropdown';
import { CustomProviderForm } from './settings/CustomProviderForm';
import { IntegrationsPanel } from './settings/IntegrationsPanel';
import { BYOKWizard } from './settings/BYOKWizard';
import { ProviderCards } from './settings/ProviderCards';
import { AdvancedProviderConfig } from './settings/AdvancedProviderConfig';
import { APIKeyManager } from './settings/APIKeyManager';
import { ApiKeyManager } from './ApiKeyManager';
import { OpenCodeIntegration } from './settings/OpenCodeIntegration';
import { useOnboardingStore } from '../state/onboarding-store';
import { DiagnosticsPanel } from './settings/DiagnosticsPanel';
import { UsageLedgerView } from './dashboard/UsageLedgerView';
import type { FreeProvider } from '../../../shared/types/free-providers';
import type { StoredKeySummary, CustomProviderConfig } from '../../../shared/types/byok';

type UpdateChannelPreference = 'stable' | 'beta' | 'nightly';
type SettingsTab = 'apikeys' | 'providers' | 'byok' | 'usage' | 'openkilo' | 'opencode' | 'integrations' | 'orchestration' | 'fcc' | 'endpoints' | 'params' | 'terminal' | 'lsp' | 'editor' | 'shortcuts' | 'extensions' | 'security' | 'privacy' | 'diagnostics';

const DEFAULT_SECURITY_SETTINGS: SecurityPolicySettings = {
  terminalPolicy: 'restricted',
  fileAccessPolicy: 'workspace-only',
  systemAccessConfirmed: false,
  reviewPolicy: 'always-ask'
};

function createProfileId(): string {
  return `profile_${globalThis.crypto.randomUUID()}`;
}

const FALLBACK_PROVIDERS: PreConfiguredProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    setupType: 'api_key',
    notes: 'Fetch models from /models endpoint. Highlight free models (e.g., deepseek/deepseek-r1:free).',
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free'
  },
  {
    id: 'openkilo',
    name: 'OpenKilo',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    setupType: 'api_key',
    notes: 'Standard OpenAI-compatible format.',
    signupUrl: 'https://openkilo.com',
    defaultModel: 'kilo-1'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: 'https://api.opencode.ai/v1',
    setupType: 'api_key',
    notes: 'Standard OpenAI-compatible format.',
    signupUrl: 'https://opencode.ai',
    defaultModel: 'opencode-v1'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    setupType: 'api_key',
    notes: 'Highlight ultra-fast free tier models (llama-3.3-70b-versatile, etc.).',
    signupUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    setupType: 'zero_config',
    notes: 'No API key required. Just check if localhost:11434 is reachable.',
    signupUrl: 'https://ollama.com/download',
    defaultModel: 'qwen2.5-coder:latest'
  }
];

export const SettingsModal: React.FC = () => {
  const { isSettingsOpen, toggleSettings, settings, saveSettings, activeSettingsTab } = useChatStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');

  const installedExtensions = useExtensionStore((s) => s.installed);
  const loadInstalledExtensions = useExtensionStore((s) => s.loadInstalled);
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);

  useEffect(() => {
    if (activeTab === 'extensions') {
      void loadInstalledExtensions();
    }
  }, [activeTab, loadInstalledExtensions]);

  useEffect(() => {
    if (isSettingsOpen && activeSettingsTab) {
      setActiveTab(activeSettingsTab as SettingsTab);
    }
  }, [isSettingsOpen, activeSettingsTab]);

  // AI Providers Onboarding state
  const [registryProviders, setRegistryProviders] = useState<PreConfiguredProvider[]>(FALLBACK_PROVIDERS);
  const [selectedGridProviderId, setSelectedGridProviderId] = useState<string>('openrouter');
  const [isCustomSelected, setIsCustomSelected] = useState<boolean>(false);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderStatusInfo>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);

  // BYOK & Key Management State (Phase 6.2)
  const [byokSubTab, setByokSubTab] = useState<'cards' | 'wizard' | 'keys' | 'advanced'>('cards');
  const [freeProviders, setFreeProviders] = useState<FreeProvider[]>([]);
  const [storedKeysSummary, setStoredKeysSummary] = useState<StoredKeySummary[]>([]);
  const [byokWizardProviderId, setByokWizardProviderId] = useState<string>('openrouter-free');
  const [byokTesting, setByokTesting] = useState<Record<string, boolean>>({});
  const [byokConnStatus, setByokConnStatus] = useState<Record<string, { status: 'connected' | 'error' | 'disconnected'; latencyMs?: number; error?: string }>>({});

  const refreshByokData = useCallback(async () => {
    if (window.electronAPI?.freeProvidersGetList) {
      const res = await window.electronAPI.freeProvidersGetList();
      if (res.success && res.data) setFreeProviders(res.data);
    }
    if (window.electronAPI?.byokGetStoredKeys) {
      const res = await window.electronAPI.byokGetStoredKeys();
      if (res.success && res.data) setStoredKeysSummary(res.data);
    }
  }, []);

  const handleByokAddKey = (providerId: string) => {
    setByokWizardProviderId(providerId);
    setByokSubTab('wizard');
  };

  const handleByokTestConnection = async (providerId: string) => {
    setByokTesting((prev) => ({ ...prev, [providerId]: true }));
    try {
      const cleanId = providerId.replace('-free', '');
      const provider = freeProviders.find((p) => p.id === providerId);
      const response = await window.electronAPI.providerTestConnection({
        providerId: cleanId,
        customEndpoint: provider?.base_url !== 'auto' ? provider?.base_url : undefined
      });
      if (!response.success || !response.data) throw new Error(response.error || 'Provider connection test failed.');
      const res = response.data;
      if (res.success) {
        setByokConnStatus((prev) => ({
          ...prev,
          [providerId]: { status: 'connected', latencyMs: res.latencyMs }
        }));
        toast.success('Connection Successful', `Latency: ${res.latencyMs || 0}ms`);
      } else {
        setByokConnStatus((prev) => ({
          ...prev,
          [providerId]: { status: 'error', error: res.error }
        }));
        toast.error('Connection Failed', res.error || 'Verification failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setByokConnStatus((prev) => ({ ...prev, [providerId]: { status: 'error', error: msg } }));
      toast.error('Connection Failed', msg);
    } finally {
      setByokTesting((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleByokRemoveKey = async (providerId: string) => {
    if (!window.electronAPI?.byokRevokeKey) return;
    const res = await window.electronAPI.byokRevokeKey(providerId);
    if (res.success) {
      toast.info('Key Revoked', `Key for ${providerId} removed from safeStorage.`);
      await refreshByokData();
    }
  };

  const handleByokWizardComplete = async (config: { providerId: string; apiKey: string; selectedModel?: string; selectedModels?: string[] }) => {
    const cleanId = config.providerId.replace('-free', '');
    const updates: Record<string, unknown> = {
      activeProvider: cleanId,
      apiKeys: { [cleanId]: config.apiKey }
    };
    if (config.selectedModel) {
      updates.activeModel = config.selectedModel;
    }
    await saveSettings(updates);
    await refreshByokData();
    toast.success('Key Saved Securely', `${config.providerId} configured with safeStorage.`);
  };

  const handleByokSaveAdvancedConfig = async (config: CustomProviderConfig): Promise<boolean> => {
    if (!window.electronAPI?.byokSaveCustomProvider) return false;
    const res = await window.electronAPI.byokSaveCustomProvider(config);
    if (res.success) {
      toast.success('Custom Provider Saved', `${config.name} added and set as active.`);
      await refreshByokData();
      setByokSubTab('cards');
      return true;
    } else {
      toast.error('Save Failed', res.error || 'Could not save custom provider.');
      return false;
    }
  };

  const handleByokStartCoding = () => {
    toggleSettings();
    toast.success('Ready to Code', 'Your AI provider is connected and ready to assist.');
  };

  // Endpoints & Inference state
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

  // Orchestration & Quota state
  const [freeMode, setFreeMode] = useState(true);
  const [quotaAlertThreshold, setQuotaAlertThreshold] = useState(80);
  const [autoRotateProviders, setAutoRotateProviders] = useState(true);
  const { openDashboard } = useUsageDashboardStore();

  // LSP Settings state
  const [lspServers, setLspServers] = useState<LanguageServerStatus[]>([]);
  const [lspActionLoading, setLspActionLoading] = useState<Record<string, boolean>>({});
  const [customLspPaths, setCustomLspPaths] = useState<Record<string, string>>({});
  const [copiedLspCommand, setCopiedLspCommand] = useState<string | null>(null);

  // Editor Settings state
  const [fontSize, setFontSize] = useState(13);
  const [tabSize, setTabSize] = useState(2);
  const [minimap, setMinimap] = useState(true);
  const [bracketPairs, setBracketPairs] = useState(true);
  const [autoSaveDelay, setAutoSaveDelay] = useState(1000);
  const [autoSaveMode, setAutoSaveMode] = useState<'off' | 'afterDelay' | 'onFocusChange'>('afterDelay');
  const [editorWordWrap, setEditorWordWrap] = useState<'off' | 'on' | 'wordWrapColumn' | 'bounded'>('off');
  const [reviewPolicy, setReviewPolicy] = useState<EditReviewPolicy>('alwaysReview');
  const [lspAutoStart, setLspAutoStart] = useState(true);
  const [updateChannel, setUpdateChannel] = useState<UpdateChannelPreference>(() => {
    const saved = localStorage.getItem('ty_code_update_channel');
    return saved === 'beta' || saved === 'nightly' ? saved : 'stable';
  });
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Keybindings state
  const [keybindingSearch, setKeybindingSearch] = useState('');
  const [thirdPartyRuntimeEnabled, setThirdPartyRuntimeEnabled] = useState(false);
  const [settingsScope, setSettingsScope] = useState<SettingsScope>('global');
  const [securitySettings, setSecuritySettings] = useState<SecurityPolicySettings>(DEFAULT_SECURITY_SETTINGS);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [telemetryInspectorOpen, setTelemetryInspectorOpen] = useState(false);
  const [telemetryPreview, setTelemetryPreview] = useState<TelemetryPreview | null>(null);
  const [credentialStorageStatus, setCredentialStorageStatus] = useState<CredentialStorageStatus | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyError, setPrivacyError] = useState('');
  const [privacyNotice, setPrivacyNotice] = useState('');
  const [privacyAppInfo, setPrivacyAppInfo] = useState<AppInfo | null>(null);

  // Load Registry Providers from IPC
  useEffect(() => {
    if (!window.electronAPI?.providerGetRegistry) return;
    void window.electronAPI.providerGetRegistry().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setRegistryProviders(res.data);
      }
    }).catch((err) => console.warn('Could not fetch provider registry:', err));
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) return;
    void refreshByokData();
  }, [isSettingsOpen, refreshByokData]);

  // Sync state from settings
  useEffect(() => {
    const saved = localStorage.getItem('ty_code_update_channel');
    const channel: UpdateChannelPreference = saved === 'beta' || saved === 'nightly' ? saved : 'stable';
    setUpdateChannel(channel);
    void window.electronAPI?.setUpdateChannel?.(channel).then((response) => {
      if (response && !response.success) console.warn('Could not restore the saved update channel:', response.error);
    }).catch((reason: unknown) => console.warn('Could not restore the saved update channel:', reason));
  }, []);

  useEffect(() => {
    if (!settings) return;
    setOllamaUrl(settings.customEndpoints?.ollama || 'http://localhost:11434/v1');
    setFccProxyUrl(settings.customEndpoints?.['fcc-proxy'] || 'http://localhost:8082/v1');
    setTemperature(settings.temperature ?? 0.2);
    setMaxTokens(settings.maxTokens ?? 4096);
    setFreeMode(settings.freeMode ?? true);
    setQuotaAlertThreshold(settings.quotaAlertThreshold ?? 80);
    setAutoRotateProviders(settings.autoRotateProviders ?? true);
    setTelemetryEnabled(settings.telemetry?.enabled ?? false);
    setProfiles(settings.terminalProfiles || []);
    setDefaultProfileId(settings.defaultTerminalProfileId || '');
    setThirdPartyRuntimeEnabled(settings.thirdPartyRuntimeEnabled ?? false);
    setReviewPolicy(settings['editor.reviewPolicy'] || 'alwaysReview');
    setLspAutoStart(settings['lsp.autoStart'] ?? true);
    setFontSize(settings.editor?.fontSize ?? 13);
    setTabSize(settings.editor?.tabSize ?? 2);
    setMinimap(settings.editor?.minimap ?? true);
    setBracketPairs(settings.editor?.bracketPairs ?? true);
    setAutoSaveDelay(settings.editor?.autoSaveDelay ?? 1000);
    setAutoSaveMode(settings.editor?.autoSave ?? 'afterDelay');
    setEditorWordWrap(settings.editor?.wordWrap ?? 'off');

    // Update statuses based on configured keys
    const statuses: Record<string, ProviderStatusInfo> = {};
    for (const p of registryProviders) {
      if (settings.apiKeysConfigured?.[p.id as ProviderType]) {
        statuses[p.id] = { status: 'connected' };
      } else {
        statuses[p.id] = { status: 'disconnected' };
      }
    }
    setProviderStatuses((prev) => ({ ...statuses, ...prev }));

    if (settings.activeProvider && registryProviders.some((p) => p.id === settings.activeProvider)) {
      setSelectedGridProviderId(settings.activeProvider);
      setIsCustomSelected(false);
    } else if (settings.activeProvider === 'custom') {
      setIsCustomSelected(true);
    }
  }, [settings, registryProviders, isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        toggleSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, toggleSettings]);

  useEffect(() => {
    if (!isSettingsOpen) {
      setTelemetryInspectorOpen(false);
      return;
    }
    let cancelled = false;
    void Promise.all([
      window.electronAPI.getCredentialStorageStatus(),
      window.electronAPI.getAppInfo()
    ]).then(([credentialResponse, appInfoResponse]) => {
      if (cancelled) return;
      if (credentialResponse.success && credentialResponse.data) setCredentialStorageStatus(credentialResponse.data);
      else setPrivacyError(credentialResponse.error || 'Credential storage status is unavailable.');
      if (appInfoResponse.success && appInfoResponse.data) setPrivacyAppInfo(appInfoResponse.data);
    }).catch((reason: unknown) => {
      if (!cancelled) setPrivacyError(reason instanceof Error ? reason.message : String(reason));
    });
    const load = async () => {
      const [globalResponse, layerResponse] = await Promise.all([
        window.electronAPI.getSettingsLayer('global'),
        window.electronAPI.getSettingsLayer(settingsScope)
      ]);
      if (cancelled || !globalResponse.success || !globalResponse.data || !layerResponse.success || !layerResponse.data) return;
      const globalData = globalResponse.data as SettingsData;
      const layerData = layerResponse.data as SettingsData | WorkspaceSettingsPatch;
      const baseSecurity = globalData.security || settings?.security || DEFAULT_SECURITY_SETTINGS;
      setSecuritySettings({
        ...DEFAULT_SECURITY_SETTINGS,
        ...baseSecurity,
        ...(settingsScope === 'workspace' ? layerData.security : {}),
        systemAccessConfirmed: baseSecurity.systemAccessConfirmed
      });
    };
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [isSettingsOpen, settingsScope, settings?.security]);

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

  // Fetch models for active/selected provider
  const fetchModelsForProvider = useCallback(async (providerId: string) => {
    if (!window.electronAPI?.providerGetModels) return;
    setLoadingModels(true);
    try {
      const res = await window.electronAPI.providerGetModels({
        providerId,
        customEndpoint: settings?.customEndpoints?.[providerId as ProviderType]
      });
      if (res.success && res.data && res.data.length > 0) {
        setDiscoveredModels((prev) => ({ ...prev, [providerId]: res.data! }));
      }
    } catch {
      // Fallback
    } finally {
      setLoadingModels(false);
    }
  }, [settings?.customEndpoints]);


  const refreshLspServers = async () => {
    if (!window.electronAPI?.lspGetServers) return;
    try {
      const res = await window.electronAPI.lspGetServers();
      if (res.success && res.data) {
        setLspServers(res.data);
        useLspStore.getState().setServers(res.data);
        const paths: Record<string, string> = {};
        for (const s of res.data) {
          paths[s.languageId] = s.configuredPath || '';
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
    const custom = customLspPaths[languageId]?.trim() || '';
    const response = await window.electronAPI.lspConfigureServer(languageId, {
      enabled: true,
      path: custom
    });
    if (!response.success) {
      setError(response.error || 'Could not save language-server executable path.');
      return;
    }
    await refreshLspServers();
  };

  if (!isSettingsOpen) return null;

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

  const copyLspInstallCommand = async (languageId: string, platform: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      const key = `${languageId}:${platform}`;
      setCopiedLspCommand(key);
      window.setTimeout(() => setCopiedLspCommand((current) => current === key ? null : current), 1600);
    } catch {
      setError('Clipboard access failed. Select and copy the install command manually.');
    }
  };

  const handleUpdateChannelChange = async (channel: UpdateChannelPreference) => {
    const previous = updateChannel;
    setUpdateChannel(channel);
    try {
      const result = await window.electronAPI.setUpdateChannel(channel);
      if (!result.success) throw new Error(result.error || 'Could not change the update channel.');
      localStorage.setItem('ty_code_update_channel', channel);
      toast.success('Update channel changed', `Ty-Code will check the ${channel} release channel.`);
    } catch (reason) {
      setUpdateChannel(previous);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setError('');
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.error) throw new Error(result.error);
      if (!result.updateAvailable) toast.success('Up to date', `Ty-Code v${result.currentVersion} is the latest version.`);
    } catch (reason) {
      toast.error('Update check failed', reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleSaveSecurity = async () => {
    setError('');
    setSecuritySaving(true);
    try {
      const { systemAccessConfirmed, ...workspacePolicy } = securitySettings;
      const policy = settingsScope === 'global'
        ? securitySettings
        : workspacePolicy;
      const response = await window.electronAPI.saveSettingsLayer(settingsScope, { security: policy });
      if (!response.success) throw new Error(response.error || 'Security settings could not be saved.');
      toast.success('Security settings saved', settingsScope === 'global' ? 'Global policy is active immediately.' : 'Workspace policy overrides are active immediately.');
      if (settingsScope === 'global' && settings) {
        useChatStore.setState({ settings: { ...settings, security: securitySettings } });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSecuritySaving(false);
    }
  };

  const refreshTelemetryPreview = async () => {
    const response = await window.electronAPI.getTelemetryPreview();
    if (!response.success || !response.data) throw new Error(response.error || 'Telemetry data is unavailable.');
    setTelemetryPreview(response.data);
  };

  const handleOpenTelemetryInspector = async () => {
    setTelemetryInspectorOpen(true);
    setPrivacyLoading(true);
    setPrivacyError('');
    try {
      await refreshTelemetryPreview();
    } catch (reason) {
      setPrivacyError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPrivacyLoading(false);
    }
  };

  const handleDeleteTelemetryEvent = async (index: number, event: TelemetryPreview['events'][number]) => {
    setPrivacyError('');
    try {
      const response = await window.electronAPI.deleteTelemetryEvent(index, event);
      if (!response.success) throw new Error(response.error || 'Could not delete this telemetry event.');
      await refreshTelemetryPreview();
    } catch (reason) {
      setPrivacyError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleClearTelemetryData = async () => {
    setPrivacyError('');
    try {
      const response = await window.electronAPI.clearTelemetryData();
      if (!response.success) throw new Error(response.error || 'Could not clear telemetry data.');
      await refreshTelemetryPreview();
    } catch (reason) {
      setPrivacyError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleCopyTelemetryData = async (event?: TelemetryPreview['events'][number]) => {
    setPrivacyError('');
    setPrivacyNotice('');
    try {
      const payload = event || telemetryPreview?.events || [];
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setPrivacyNotice(event ? 'Telemetry event JSON copied.' : 'Queued telemetry JSON copied.');
    } catch {
      setPrivacyError('Clipboard access failed. Select and copy the JSON manually.');
    }
  };

  useEffect(() => {
    if (!isSettingsOpen || !telemetryInspectorOpen) return;
    let cancelled = false;
    const refreshPreview = async () => {
      try {
        const response = await window.electronAPI.getTelemetryPreview();
        if (!cancelled && response.success && response.data) setTelemetryPreview(response.data);
      } catch {
        // Keep the last sanitized snapshot visible if a refresh temporarily fails.
      }
    };
    const unsubscribe = window.electronAPI.onTelemetryChanged(refreshPreview);
    void refreshPreview();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isSettingsOpen, telemetryInspectorOpen]);

  const handleSave = async () => {
    setError('');
    const saved = await saveSettings({
      telemetry: { enabled: telemetryEnabled },
      freeMode,
      quotaAlertThreshold: Number(quotaAlertThreshold),
      autoRotateProviders,
      customEndpoints: { ollama: ollamaUrl, 'fcc-proxy': fccProxyUrl },
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      terminalProfiles: profiles,
      defaultTerminalProfileId: defaultProfileId || undefined,
      thirdPartyRuntimeEnabled,
      'editor.reviewPolicy': reviewPolicy,
      'lsp.autoStart': lspAutoStart,
      editor: { fontSize, tabSize, minimap, bracketPairs, autoSave: autoSaveMode, autoSaveDelay, wordWrap: editorWordWrap, formatOnSave: settings?.editor?.formatOnSave || false },
      languageServers: Object.fromEntries(lspServers.map((server) => [server.languageId, { enabled: server.status !== 'disabled', args: server.args, path: customLspPaths[server.languageId]?.trim() || undefined }]))
    });
    if (window.electronAPI?.orchestrationSetFreeMode) {
      await window.electronAPI.orchestrationSetFreeMode(freeMode);
    }
    if (!saved) {
      setError('Failed to save settings. See the application log for details.');
      return;
    }
    toggleSettings();
  };

  // Provider Onboarding Handlers
  const handleSaveProviderKey = async (providerId: string, apiKey: string, customEndpoint?: string): Promise<boolean> => {
    setError('');
    const updates: Record<string, unknown> = {};
    if (apiKey) {
      updates.apiKeys = { [providerId]: apiKey };
    }
    if (customEndpoint) {
      updates.customEndpoints = { [providerId]: customEndpoint };
    }
    // Also set active provider
    updates.activeProvider = providerId as ProviderType;

    const saved = await saveSettings(updates);
    if (saved) {
      setProviderStatuses((prev) => ({
        ...prev,
        [providerId]: { status: 'connected' }
      }));
      toast.success('Provider Saved', `${providerId} credentials securely encrypted and saved.`);
      return true;
    } else {
      setError(`Failed to save ${providerId} settings.`);
      return false;
    }
  };

  const handleSaveCustom = async (config: { name: string; baseUrl: string; apiKey?: string; selectedModel?: string }): Promise<boolean> => {
    const updates: Record<string, unknown> = {
      activeProvider: 'custom',
      customEndpoints: { custom: config.baseUrl }
    };
    if (config.apiKey) {
      updates.apiKeys = { custom: config.apiKey };
    }
    if (config.selectedModel) {
      updates.activeModel = config.selectedModel;
    }

    const saved = await saveSettings(updates);
    if (saved) {
      toast.success('Custom Provider Configured', `${config.name} set as active provider.`);
      return true;
    }
    return false;
  };

  const handleProviderTested = (providerId: string, result: TestConnectionResult, models?: DiscoveredModel[]) => {
    if (result.success) {
      setProviderStatuses((prev) => ({
        ...prev,
        [providerId]: { status: 'connected', latencyMs: result.latencyMs }
      }));
      if (models && models.length > 0) {
        setDiscoveredModels((prev) => ({ ...prev, [providerId]: models }));
      }
    } else {
      setProviderStatuses((prev) => ({
        ...prev,
        [providerId]: { status: 'error', error: result.error }
      }));
    }
  };

  const handleSelectModel = (modelId: string, model?: DiscoveredModel) => {
    const targetProvider = (model?.provider || selectedGridProviderId) as ProviderType;
    void saveSettings({
      activeModel: modelId,
      activeProvider: targetProvider
    });
    toast.success('Model Activated', `Switched active model to ${model?.name || modelId}`);
  };

  const currentProvider = registryProviders.find((p) => p.id === selectedGridProviderId) || registryProviders[0] || FALLBACK_PROVIDERS[0];

  const currentModels = useMemo(() => {
    if (discoveredModels[selectedGridProviderId]?.length) {
      return discoveredModels[selectedGridProviderId];
    }
    // Fallback to preset models for this provider
    return DEFAULT_PRESET_MODELS.filter((m) => m.provider === selectedGridProviderId).map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      isFree: m.isFree,
      category: m.isFree ? ('Free' as const) : ('Premium/Reasoning' as const),
      description: m.description
    }));
  }, [discoveredModels, selectedGridProviderId]);

  const filteredKeybindings = DEFAULT_KEYBINDINGS.filter((kb) => {
    if (!keybindingSearch.trim()) return true;
    const q = keybindingSearch.toLowerCase();
    return kb.command.toLowerCase().includes(q) || kb.key.toLowerCase().includes(q) || (kb.description && kb.description.toLowerCase().includes(q));
  });
  const savedTelemetryEnabled = settings?.telemetry?.enabled ?? false;
  const telemetryChoiceIsDirty = telemetryEnabled !== savedTelemetryEnabled;
  const telemetryStatusText = telemetryChoiceIsDirty
    ? 'Your telemetry choice has not been saved. No events are transmitted.'
    : telemetryEnabled && credentialStorageStatus && !credentialStorageStatus.available
      ? 'Telemetry recording is selected, but encrypted OS storage is unavailable. No events are recorded or transmitted.'
      : telemetryEnabled
        ? 'Local event recording is on. Events remain on this device; nothing is transmitted.'
        : 'Telemetry is off. No telemetry data is transmitted.';

  if (!isSettingsOpen) return null;

  return (
    <div className="settings-overlay" onClick={toggleSettings}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" style={{ maxWidth: '820px' }}>
        <header className="settings-header">
          <div className="settings-title"><Key size={16} color="var(--accent-primary)" /><span>Ty-Code Preferences &amp; Configuration</span></div>
          <button onClick={toggleSettings} className="settings-close" aria-label="Close settings"><X size={14} /></button>
        </header>

        <nav className="settings-tabs" aria-label="Settings sections">
          <button
            className={activeTab === 'apikeys' ? 'is-active' : ''}
            onClick={() => setActiveTab('apikeys')}
            style={{ color: activeTab === 'apikeys' ? 'var(--accent-primary)' : undefined }}
            id="tab-btn-apikeys"
          >
            <Key size={13} color="var(--accent-primary)" />API Keys
          </button>
          <button className={activeTab === 'providers' ? 'is-active' : ''} onClick={() => setActiveTab('providers')} style={{ color: activeTab === 'providers' ? 'var(--accent-primary)' : undefined }}>
            <Key size={13} color="var(--accent-primary)" />AI Providers &amp; Models
          </button>
          <button
            className={activeTab === 'byok' ? 'is-active' : ''}
            onClick={() => setActiveTab('byok')}
            style={{ color: activeTab === 'byok' ? '#f43f5e' : undefined }}
            id="tab-btn-byok"
          >
            <Key size={13} color="#f43f5e" />BYOK &amp; Keys
          </button>
          <button
            className={activeTab === 'usage' ? 'is-active' : ''}
            onClick={() => setActiveTab('usage')}
            style={{ color: activeTab === 'usage' ? '#10b981' : undefined }}
            id="tab-btn-usage"
          >
            <Gauge size={13} color="#10b981" />Usage Ledger
          </button>
          <button
            className={activeTab === 'opencode' ? 'is-active' : ''}
            onClick={() => setActiveTab('opencode')}
            style={{ color: activeTab === 'opencode' ? '#06b6d4' : undefined }}
            id="tab-btn-opencode"
          >
            <Code2 size={13} color="#06b6d4" />OpenCode Sync
          </button>
          <button className={activeTab === 'orchestration' ? 'is-active' : ''} onClick={() => setActiveTab('orchestration')} style={{ color: activeTab === 'orchestration' ? '#38bdf8' : undefined }}>
            <Layers size={13} color="#38bdf8" />Smart Orchestration
          </button>
          <button className={activeTab === 'openkilo' ? 'is-active' : ''} onClick={() => setActiveTab('openkilo')} style={{ color: activeTab === 'openkilo' ? '#10b981' : undefined }}>
            <Sparkles size={13} color="#10b981" />OpenKilo (Free Backup)
          </button>
          <button className={activeTab === 'fcc' ? 'is-active' : ''} onClick={() => setActiveTab('fcc')} style={{ color: activeTab === 'fcc' ? '#f59e0b' : undefined }}>
            <Zap size={13} color="#f59e0b" />Free Models (FCC)
          </button>
          <button className={activeTab === 'integrations' ? 'is-active' : ''} onClick={() => setActiveTab('integrations')} style={{ color: activeTab === 'integrations' ? '#c084fc' : undefined }}>
            <Layers size={13} color="#c084fc" />Integrations &amp; Skills
          </button>
          <button className={activeTab === 'endpoints' ? 'is-active' : ''} onClick={() => setActiveTab('endpoints')}><Server size={13} />Endpoints</button>
          <button className={activeTab === 'params' ? 'is-active' : ''} onClick={() => setActiveTab('params')}><Sliders size={13} />Inference</button>
          <button className={activeTab === 'terminal' ? 'is-active' : ''} onClick={() => setActiveTab('terminal')}><Terminal size={13} />Terminal</button>
          <button className={activeTab === 'security' ? 'is-active' : ''} onClick={() => setActiveTab('security')}><ShieldCheck size={13} />Security</button>
          <button className={activeTab === 'lsp' ? 'is-active' : ''} onClick={() => setActiveTab('lsp')}><Code2 size={13} />Language Servers (LSP)</button>
          <button className={activeTab === 'editor' ? 'is-active' : ''} onClick={() => setActiveTab('editor')}><Sliders size={13} />Editor Polish</button>
          <button className={activeTab === 'shortcuts' ? 'is-active' : ''} onClick={() => setActiveTab('shortcuts')}><Keyboard size={13} />Keybindings</button>
          <button className={activeTab === 'extensions' ? 'is-active' : ''} onClick={() => setActiveTab('extensions')}><ShieldCheck size={13} />Extensions</button>
          <button
            className={activeTab === 'diagnostics' ? 'is-active' : ''}
            onClick={() => setActiveTab('diagnostics')}
            style={{ color: activeTab === 'diagnostics' ? '#38bdf8' : undefined }}
            id="tab-btn-diagnostics"
          >
            <Activity size={13} color="#38bdf8" />Connection Diagnostics
          </button>
          <button className={activeTab === 'privacy' ? 'is-active' : ''} onClick={() => { setActiveTab('privacy'); setTelemetryInspectorOpen(false); }}><LockKeyhole size={13} />Privacy &amp; About</button>
        </nav>

        <div className="settings-body" style={{ maxHeight: '480px', overflowY: 'auto' }}>
          {/* Tab 0: Simple API Key Harvesting & SafeStorage Vault (KeyHarvest) */}
          {activeTab === 'apikeys' && (
            <ApiKeyManager />
          )}

          {/* Tab 1: AI Provider Onboarding, Configuration & Dynamic Model Discovery */}
          {activeTab === 'providers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Unified Provisioning & Wizard Launcher Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.12))',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '10px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={16} color="#818cf8" />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                      Unified Provider Access
                    </span>
                    <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: '#c7d2fe' }}>
                      Tiered Provisioning &amp; BYOK
                    </span>
                  </div>
                  <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
                    Manage free accounts (Tier 1), one-click OAuth (Tier 1b), local Ollama (Tier 2), and power-user BYOK keys (Tier 3) in one credential vault.
                  </p>
                </div>

                <button
                  type="button"
                  id="settings-re-run-wizard-btn"
                  onClick={() => {
                    useOnboardingStore.getState().openWizard('welcome');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '6px',
                    background: 'var(--accent-primary, #6366f1)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Sparkles size={13} />
                  <span>Re-run Setup Wizard</span>
                </button>
              </div>

              {/* Upstream Free-Model Supply Attribution (FCC) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                  fontSize: '11px',
                  color: '#a5b4fc'
                }}
              >
                <Zap size={13} color="#818cf8" style={{ flexShrink: 0 }} />
                <span>
                  Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — <a href="https://github.com/Alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#c7d2fe', textDecoration: 'underline' }}>https://github.com/Alishahryar1/free-claude-code</a>
                </span>
              </div>

              {/* Provider Selection Grid */}
              <ProviderSelectionGrid
                providers={registryProviders}
                selectedProviderId={selectedGridProviderId}
                onSelectProvider={(id) => {
                  setSelectedGridProviderId(id);
                  setIsCustomSelected(false);
                }}
                providerStatuses={providerStatuses}
                onSelectCustom={() => setIsCustomSelected(true)}
                isCustomSelected={isCustomSelected}
              />

              {/* Provider Setup / Custom Form */}
              {isCustomSelected ? (
                <CustomProviderForm
                  onSaveCustom={handleSaveCustom}
                  initialBaseUrl={settings?.customEndpoints?.custom || 'http://localhost:1234/v1'}
                  onCancel={() => setIsCustomSelected(false)}
                />
              ) : currentProvider ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <ProviderSetupForm
                    key={currentProvider.id}
                    provider={currentProvider}
                    isConfigured={Boolean(settings?.apiKeysConfigured?.[currentProvider.id as ProviderType])}
                    customEndpoint={settings?.customEndpoints?.[currentProvider.id as ProviderType]}
                    onSave={handleSaveProviderKey}
                    onConnectionTested={handleProviderTested}
                    onSelectModel={handleSelectModel}
                    activeModelId={settings?.activeModel}
                  />

                  {/* Dynamic Model Discovery Dropdown */}
                  <ModelSelectorDropdown
                    models={currentModels}
                    selectedModelId={settings?.activeModel || currentProvider.defaultModel || ''}
                    onSelectModel={handleSelectModel}
                    isLoading={loadingModels}
                    onRefreshModels={() => void fetchModelsForProvider(currentProvider.id)}
                    providerName={currentProvider.name}
                  />
                </div>
              ) : null}
            </div>
          )}

          {/* Tab: Seamless BYOK Interface & Key Management (Phase 6.2) */}
          {activeTab === 'byok' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="byok-settings-panel">
              {/* Sub-tab navigation */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px',
                  background: 'rgba(30, 41, 59, 0.5)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
                id="byok-subtab-bar"
              >
                {[
                  { id: 'cards', label: 'Provider Cards' },
                  { id: 'wizard', label: 'BYOK Setup Wizard' },
                  { id: 'keys', label: 'API Key Vault' },
                  { id: 'advanced', label: 'JSON Manual Config' }
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    id={`byok-subtab-${st.id}`}
                    onClick={() => setByokSubTab(st.id as any)}
                    style={{
                      flex: 1,
                      padding: '7px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: 'none',
                      background: byokSubTab === st.id ? 'var(--accent-primary)' : 'transparent',
                      color: byokSubTab === st.id ? '#ffffff' : '#94a3b8',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* View 1: Provider Cards */}
              {byokSubTab === 'cards' && (
                <ProviderCards
                  freeProviders={freeProviders}
                  storedKeys={storedKeysSummary}
                  onAddKey={handleByokAddKey}
                  onTestConnection={handleByokTestConnection}
                  onRemoveKey={handleByokRemoveKey}
                  onOpenSettings={(providerId) => {
                    setSelectedGridProviderId(providerId.replace('-free', ''));
                    setActiveTab('providers');
                  }}
                  onLaunchWizard={() => setByokSubTab('wizard')}
                  onOpenAdvanced={() => setByokSubTab('advanced')}
                  testingProviders={byokTesting}
                  connectionStatuses={byokConnStatus}
                />
              )}

              {/* View 2: BYOK Setup Wizard */}
              {byokSubTab === 'wizard' && (
                <BYOKWizard
                  freeProviders={freeProviders}
                  initialProviderId={byokWizardProviderId}
                  onComplete={handleByokWizardComplete}
                  onClose={() => setByokSubTab('cards')}
                  onStartCoding={handleByokStartCoding}
                />
              )}

              {/* View 3: API Key Vault & Auto-Detection */}
              {byokSubTab === 'keys' && (
                <APIKeyManager
                  onRefreshStoredKeys={refreshByokData}
                  onOpenWizardForProvider={handleByokAddKey}
                />
              )}

              {/* View 4: Advanced JSON Config */}
              {byokSubTab === 'advanced' && (
                <AdvancedProviderConfig
                  onSaveConfig={handleByokSaveAdvancedConfig}
                  onBack={() => setByokSubTab('cards')}
                />
              )}
            </div>
          )}

          {/* Tab: OpenCode Integration & Free Model Sync (Phase 6.3) */}
          {activeTab === 'opencode' && (
            <OpenCodeIntegration
              onSyncComplete={async () => {
                await refreshByokData();
                if (window.electronAPI?.providerGetRegistry) {
                  const res = await window.electronAPI.providerGetRegistry();
                  if (res.success && res.data) setRegistryProviders(res.data);
                }
              }}
            />
          )}

          {/* Tab: Modular Skills & External Integration Registry (Phase 3.1) */}
          {activeTab === 'integrations' && (
            <IntegrationsPanel />
          )}

          {/* Tab: Smart Orchestration & Unified Experience (Layer 6) */}
          {activeTab === 'orchestration' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(99, 102, 241, 0.05) 100%)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Layers size={16} color="#38bdf8" />
                    Automated Model Orchestration &amp; Quota Balancing
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                    Ty-Code automatically selects the optimal free model for code generation, reasoning, large context, vision, and quick responses.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    toggleSettings();
                    openDashboard();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    background: '#0ea5e9',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)'
                  }}
                >
                  <Gauge size={14} />
                  Open Quota Dashboard
                </button>
              </div>

              {/* Free Mode Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>One-Click "Free Mode"</span>
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: freeMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: freeMode ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                      {freeMode ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    Strictly enforces $0 cost by prioritizing OpenKilo (40+ free models), FCC Proxy (1.35B tokens/mo), OpenRouter free tier, and local Ollama.
                  </p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={freeMode}
                    onChange={(e) => setFreeMode(e.target.checked)}
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
                      backgroundColor: freeMode ? '#10b981' : '#334155',
                      borderRadius: '22px',
                      transition: '0.2s'
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        height: '16px',
                        width: '16px',
                        left: freeMode ? '21px' : '3px',
                        bottom: '3px',
                        backgroundColor: '#ffffff',
                        borderRadius: '50%',
                        transition: '0.2s'
                      }}
                    />
                  </span>
                </label>
              </div>

              {/* Auto Rotate Providers */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Automatic Provider Failover &amp; Rotation</span>
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: autoRotateProviders ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: autoRotateProviders ? '#38bdf8' : '#94a3b8', fontWeight: 600 }}>
                      {autoRotateProviders ? 'ENABLED' : 'MANUAL'}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    Automatically rotates to backup providers (e.g. OpenKilo or FCC) whenever rate limits (HTTP 429) or quota saturation occur.
                  </p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoRotateProviders}
                    onChange={(e) => setAutoRotateProviders(e.target.checked)}
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
                      backgroundColor: autoRotateProviders ? '#0ea5e9' : '#334155',
                      borderRadius: '22px',
                      transition: '0.2s'
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        height: '16px',
                        width: '16px',
                        left: autoRotateProviders ? '21px' : '3px',
                        bottom: '3px',
                        backgroundColor: '#ffffff',
                        borderRadius: '50%',
                        transition: '0.2s'
                      }}
                    />
                  </span>
                </label>
              </div>

              {/* Quota Alert Threshold */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Quota Warning Threshold
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>
                    {quotaAlertThreshold}% Used
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Displays an alert badge and pre-emptively activates failover pools when any provider approaches this percentage.
                </p>
                <input
                  type="range"
                  min="50"
                  max="98"
                  step="5"
                  value={quotaAlertThreshold}
                  onChange={(e) => setQuotaAlertThreshold(Number(e.target.value))}
                  style={{ width: '100%', marginTop: '6px' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'openkilo' && <OpenKiloSetup />}

          {activeTab === 'fcc' && <FCCSetup />}

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

          {activeTab === 'privacy' && (
            telemetryInspectorOpen ? (
              <section className="privacy-inspector" aria-labelledby="telemetry-inspector-heading">
                <button type="button" className="privacy-back" onClick={() => setTelemetryInspectorOpen(false)}>
                  <Eye size={14} /> Back to Privacy &amp; About
                </button>
                <h3 id="telemetry-inspector-heading">Telemetry data on this device</h3>
                <p className="privacy-status" role="status">{telemetryStatusText}</p>
                <p className="privacy-transmission">Transmitted events: none</p>
                <p className="privacy-delivery-status" role="status">
                  Queued: {telemetryPreview?.queuedCount ?? 0} · Sent: 0 · Failed: 0
                </p>
                {privacyLoading && <p className="settings-hint" role="status">Loading local event data…</p>}
                {privacyError && <p className="settings-error" role="alert">{privacyError}</p>}
                {privacyNotice && <p className="privacy-notice" role="status">{privacyNotice}</p>}
                {telemetryPreview && !telemetryPreview.storageAvailable && <p className="settings-error" role="alert">{telemetryPreview.storageMessage}</p>}
                {!privacyLoading && !privacyError && telemetryPreview?.storageError && <p className="settings-error" role="alert">The encrypted telemetry queue could not be read or updated: {telemetryPreview.storageError}</p>}
                {!privacyLoading && !privacyError && (telemetryPreview?.events.length
                  ? <div className="privacy-event-list" aria-label="Queued telemetry event payloads">
                    {telemetryPreview.events.map((event, index) => (
                      <div className="privacy-event-row" key={`${event.event}-${event.timestamp}-${index}`}>
                        <pre className="privacy-event">{JSON.stringify(event, null, 2)}</pre>
                        <div className="privacy-event-actions">
                          <button type="button" className="privacy-delete-event" onClick={() => void handleCopyTelemetryData(event)} aria-label={`Copy local ${event.event} event JSON`} title="Copy this event JSON"><Copy size={13} /></button>
                          <button type="button" className="privacy-delete-event" onClick={() => void handleDeleteTelemetryEvent(index, event)} aria-label={`Delete local ${event.event} event`} title="Delete this local event"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  : telemetryPreview && !telemetryPreview.storageAvailable
                    ? <p className="privacy-empty">Encrypted events cannot be read until operating-system secure storage is available.</p>
                    : telemetryPreview?.storageError
                      ? null
                      : <p className="privacy-empty">No diagnostic events recorded.</p>)}
                <div className="privacy-queue-actions">
                  <button type="button" onClick={() => void handleCopyTelemetryData()} disabled={!telemetryPreview?.events.length}>Copy queued JSON</button>
                  <button type="button" onClick={() => void handleClearTelemetryData()}>Clear telemetry data</button>
                </div>
                <p className="settings-hint">{telemetryPreview?.storageMessage} No telemetry destination is configured, so nothing is sent. Events older than 30 days are removed; the encrypted queue is limited to 5 MB.</p>
              </section>
            ) : (
              <section className="privacy-panel" aria-label="Privacy and application information">
                <p className="privacy-status" role="status">{telemetryStatusText}</p>
                <label className="privacy-consent">
                  <input
                    type="checkbox"
                    checked={telemetryEnabled}
                    onChange={(event) => setTelemetryEnabled(event.target.checked)}
                    aria-describedby="telemetry-consent-help"
                  />
                  <span>
                    <strong>Record anonymized diagnostic events on this device</strong>
                    <span id="telemetry-consent-help" className="settings-hint">
                      Fixed event names, allowlisted feature labels, and event timestamps only. Code, chat content, filenames, paths, API keys, and identifying details are excluded. There is no telemetry server; enabling recording does not send events.
                    </span>
                  </span>
                </label>
                <button type="button" className="privacy-inspect-button" onClick={() => void handleOpenTelemetryInspector()}>
                  <Eye size={14} /> View telemetry data
                </button>

                {privacyError && <p className="settings-error" role="alert">{privacyError}</p>}
                <section className="privacy-section" aria-labelledby="credential-storage-heading">
                  <h3 id="credential-storage-heading"><LockKeyhole size={15} />Credential storage on this device</h3>
                  <p className={credentialStorageStatus?.available ? 'privacy-storage-available' : 'privacy-storage-unavailable'} role="status">
                    {credentialStorageStatus?.message || 'Checking operating-system credential storage…'}
                  </p>
                  {privacyAppInfo && <p className="settings-hint">System: {privacyAppInfo.platform} · {credentialStorageStatus?.backend || 'checking storage backend'}</p>}
                </section>

                <section className="privacy-section" aria-labelledby="local-data-heading">
                  <h3 id="local-data-heading">What stays local</h3>
                  <ul className="privacy-list">
                    <li>Codebase indexing and local search run on this device. Workspace embeddings are not uploaded by default.</li>
                    <li>Chat history and conversation memory are stored locally.</li>
                    <li>History extraction reads local files and writes exports to the destination you choose.</li>
                    <li>If you choose a remote model provider, the prompts and context for that request go to that provider. This is separate from telemetry.</li>
                  </ul>
                </section>

                <section className="privacy-section" aria-labelledby="privacy-policy-heading">
                  <h3 id="privacy-policy-heading">Privacy policy</h3>
                  <p>Ty-Code keeps settings, chat history, conversation memory, and project-index data on this device. API credentials use the operating system credential store when available; Ty-Code will not save credentials when secure storage is unavailable.</p>
                  <p>Telemetry is off by default. If you turn it on, Ty-Code records only allowlisted, anonymized event names, approved feature labels, and timestamps on this device. It excludes code, chat content, file names, paths, API keys, and identifying details. Events are encrypted locally, kept for up to 30 days within a 5 MiB queue, and removed oldest-first when the queue reaches that size. You can copy or delete events individually, clear the queue, or turn telemetry off to purge it. No telemetry destination is configured, so telemetry events are not transmitted.</p>
                  <p>Codebase indexing, local search, and history extraction operate on the local filesystem. If you use a remote model provider, the prompts and context needed for that model request are sent to that provider under its terms; this provider traffic is not telemetry.</p>
                  <p>Save Settings applies your telemetry choice. Cancel discards unsaved changes. You can change consent any time in Settings &gt; Privacy &amp; About.</p>
                  {privacyAppInfo && <p className="privacy-version">Ty-Code v{privacyAppInfo.version} · {privacyAppInfo.platform} ({privacyAppInfo.arch})</p>}
                </section>

                <section className="privacy-section" aria-labelledby="in-app-credits-heading">
                  <h3 id="in-app-credits-heading"><Sparkles size={15} />In-App Credits &amp; Attribution</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Ty-Code integrates open-source AI infrastructure to offer free, decentralized, and high-performance model access:
                  </p>
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '12px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      fontSize: '12px',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#818cf8', marginBottom: '4px' }}>
                      Free-Claude-Code Supply Layer
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-all' }}>
                      Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — <a href="https://github.com/Alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#a5b4fc', textDecoration: 'underline' }}>https://github.com/Alishahryar1/free-claude-code</a>
                    </div>
                  </div>
                </section>
              </section>
            )
          )}

          {/* Security Policy Settings Tab */}
          {activeTab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0 }}>
                Choose where these rules apply. Workspace settings override the global policy for this project, but cannot grant access to files outside the workspace.
              </p>
              <div>
                <label className="settings-field-label" htmlFor="security-settings-scope">Settings scope</label>
                <select id="security-settings-scope" value={settingsScope} onChange={(event) => setSettingsScope(event.target.value as SettingsScope)} style={{ width: '100%' }}>
                  <option value="global">Global — all projects</option>
                  <option value="workspace">Current workspace</option>
                </select>
              </div>
              <div>
                <label className="settings-field-label" htmlFor="security-terminal-policy">Terminal policy</label>
                <select id="security-terminal-policy" value={securitySettings.terminalPolicy} onChange={(event) => setSecuritySettings((current) => ({ ...current, terminalPolicy: event.target.value as SecurityPolicySettings['terminalPolicy'] }))} style={{ width: '100%' }}>
                  <option value="always-ask">Always Ask — approve every command</option>
                  <option value="always-proceed">Always Proceed — run commands automatically</option>
                  <option value="restricted">Restricted Mode — approve only unlisted commands</option>
                </select>
                <p className="settings-hint">Restricted Mode auto-approves ls, cat, git status, and npm install. Destructive operations are blocked or require approval.</p>
              </div>
              <div>
                <label className="settings-field-label" htmlFor="security-file-access">Agent file access</label>
                <select id="security-file-access" value={securitySettings.fileAccessPolicy} onChange={(event) => setSecuritySettings((current) => ({ ...current, fileAccessPolicy: event.target.value as SecurityPolicySettings['fileAccessPolicy'] }))} style={{ width: '100%' }}>
                  <option value="workspace-only">Workspace Only</option>
                  <option value="system-access">System Access</option>
                </select>
                <p className="settings-hint">System Access requires the explicit global confirmation below. Workspace-level settings cannot enable it.</p>
                {settingsScope === 'global' && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--text-primary)', fontSize: 12, marginTop: 8 }}>
                  <input type="checkbox" checked={securitySettings.systemAccessConfirmed} onChange={(event) => setSecuritySettings((current) => ({ ...current, systemAccessConfirmed: event.target.checked }))} aria-describedby="system-access-confirm-help" />
                  <span>I understand the Agent may read or write files outside the active workspace.</span>
                </label>}
                <p id="system-access-confirm-help" className="settings-hint">System Access is effective only when selected above and explicitly confirmed in Global Settings.</p>
              </div>
              <div>
                <label className="settings-field-label" htmlFor="security-review-policy">Agent file change policy</label>
                <select id="security-review-policy" value={securitySettings.reviewPolicy} onChange={(event) => setSecuritySettings((current) => ({ ...current, reviewPolicy: event.target.value as SecurityPolicySettings['reviewPolicy'] }))} style={{ width: '100%' }}>
                  <option value="always-ask">Always Ask — review each proposed change</option>
                  <option value="auto-apply-safe">Auto-Apply Safe — apply changes under five lines</option>
                </select>
                <p className="settings-hint">Larger changes still require review. Approval is checked against the file contents before applying.</p>
              </div>
              {securitySettings.fileAccessPolicy === 'system-access' && !securitySettings.systemAccessConfirmed && <div className="settings-hint" role="status">System Access is selected but remains inactive until Global Settings explicitly confirm it.</div>}
            </div>
          )}

          {/* LSP Settings Tab */}
          {activeTab === 'lsp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Install language servers yourself. System PATH executables can start automatically; project-local candidates are detected for information only and never run unless you set an explicit absolute path.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 12 }}>
                <input type="checkbox" checked={lspAutoStart} onChange={(event) => setLspAutoStart(event.target.checked)} />
                Start available configured servers when supported files open
              </label>

              {lspServers.map((server) => {
                const isLoading = Boolean(lspActionLoading[server.languageId]);
                const statusColor = server.status === 'running' ? 'var(--accent-green)' : server.isAvailable ? 'var(--accent-cyan)' : 'var(--accent-amber)';
                const platformName: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

                return (
                  <section key={server.languageId} style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{server.name}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: statusColor }} aria-live="polite">
                          {server.status === 'running' ? 'Running' : server.isAvailable ? 'Found' : server.status === 'disabled' ? 'Disabled' : 'Not installed'}
                        </span>
                        {server.status === 'running' ? <>
                          <button onClick={() => void handleRestartLsp(server.languageId)} disabled={isLoading} aria-label={`Restart ${server.name}`} title="Restart server"><RotateCw size={13} className={isLoading ? 'spin' : ''} /></button>
                          <button onClick={() => void handleStopLsp(server.languageId)} disabled={isLoading} aria-label={`Stop ${server.name}`} title="Stop server"><Square size={12} /></button>
                        </> : <button onClick={() => void handleStartLsp(server.languageId)} disabled={isLoading || !server.isAvailable} title={server.isAvailable ? 'Start server' : 'No runnable executable found'}><Play size={12} />Start</button>}
                      </div>
                    </div>

                    {server.isAvailable && <div className="settings-hint">
                      Found at <code>{server.resolvedPath}</code>{server.version ? <> · Version {server.version}</> : ' · Version unavailable'}
                    </div>}
                    {server.workspaceCandidates?.map((candidate) => (
                      <div className="settings-hint" key={candidate.path}>
                        Project-local candidate (not run): <code>{candidate.path}</code>. Configure its absolute path below only if you trust this workspace.
                      </div>
                    ))}
                    {server.error && <div className="settings-error" role="status">{server.error}</div>}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label className="settings-field-label" htmlFor={`lsp-path-${server.languageId}`} style={{ margin: 0, flexShrink: 0 }}>Executable path</label>
                      <input
                        id={`lsp-path-${server.languageId}`}
                        type="text"
                        value={customLspPaths[server.languageId] || ''}
                        onChange={(event) => setCustomLspPaths((current) => ({ ...current, [server.languageId]: event.target.value }))}
                        placeholder="Optional absolute path; blank uses system PATH"
                        spellCheck={false}
                        aria-describedby={`lsp-path-help-${server.languageId}`}
                        style={{ minWidth: 0, flex: 1, padding: '5px 8px', fontSize: '11px', backgroundColor: 'var(--bg-primary)' }}
                      />
                      <button onClick={() => void handleSaveLspConfig(server.languageId)} disabled={isLoading} style={{ padding: '5px 8px', fontSize: '11px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Save path</button>
                    </div>
                    <div id={`lsp-path-help-${server.languageId}`} className="settings-hint">This path is stored per language and is the only way to run a project-local server.</div>

                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <strong style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Manual installation</strong>
                      {server.installCommands?.map((item) => {
                        const copyKey = `${server.languageId}:${item.platform}`;
                        const copyText = item.command || item.guidance;
                        return <div key={item.platform} style={{ display: 'grid', gridTemplateColumns: '60px minmax(0, 1fr) auto', alignItems: 'center', gap: '7px', fontSize: '11px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{platformName[item.platform]}</span>
                          <code style={{ minWidth: 0, color: item.command ? 'var(--accent-cyan)' : 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{copyText}</code>
                          <button type="button" onClick={() => void copyLspInstallCommand(server.languageId, item.platform, copyText)} aria-label={`${item.command ? 'Copy' : 'Copy instructions for'} ${server.name} ${platformName[item.platform]}`} title={item.command ? 'Copy install command' : 'Copy install instructions'} style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}>
                            {copiedLspCommand === copyKey ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedLspCommand === copyKey ? 'Copied' : item.command ? 'Copy' : 'Copy instructions'}</span>
                          </button>
                        </div>;
                      })}
                      {server.installCommands?.[0]?.sourceUrl && <div className="settings-hint">Official instructions: {server.installCommands[0].sourceUrl}</div>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* Editor Polish Tab */}
          {activeTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="settings-field-label" htmlFor="edit-review-policy">Change review policy</label>
                <select id="edit-review-policy" value={reviewPolicy} onChange={(event) => setReviewPolicy(event.target.value as EditReviewPolicy)} style={{ width: '100%' }}>
                  <option value="alwaysReview">Always preview edits (recommended)</option>
                  <option value="autoApplySafeSingleFile">Auto-apply safe single-file edits</option>
                </select>
                <p className="settings-hint">Auto-apply is limited to low-risk changes in tracked files and always records an undo snapshot. Multi-file edits and protected files always require review.</p>
              </div>
              <div>
                <label className="settings-field-label" htmlFor="editor-word-wrap">Word wrap</label>
                <select id="editor-word-wrap" value={editorWordWrap} onChange={(event) => setEditorWordWrap(event.target.value as typeof editorWordWrap)} style={{ width: '100%' }}>
                  <option value="off">Off</option><option value="on">On</option><option value="wordWrapColumn">Column</option><option value="bounded">Bounded</option>
                </select>
              </div>
              <div>
                <label className="settings-field-label" htmlFor="editor-auto-save">Auto-save behavior</label>
                <select id="editor-auto-save" value={autoSaveMode} onChange={(event) => setAutoSaveMode(event.target.value as typeof autoSaveMode)} style={{ width: '100%' }}>
                  <option value="off">Off</option><option value="afterDelay">After delay</option><option value="onFocusChange">When focus changes</option>
                </select>
              </div>
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
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={minimap}
                    onChange={(e) => setMinimap(e.target.checked)}
                  />
                  <span>Show Minimap</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={bracketPairs}
                    onChange={(e) => setBracketPairs(e.target.checked)}
                  />
                  <span>Bracket Pair Colorization</span>
                </label>
              </div>

              {/* Updates Section */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                <div className="settings-section-heading">
                  <strong>Software Updates</strong>
                  <span>Manage update release channels and check for application updates.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                  <select
                    value={updateChannel}
                    onChange={(e) => void handleUpdateChannelChange(e.target.value as UpdateChannelPreference)}
                    style={{ padding: '5px 8px', fontSize: '11px' }}
                  >
                    <option value="stable">Stable channel</option>
                    <option value="beta">Beta preview</option>
                    <option value="nightly">Nightly build</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => void handleCheckForUpdates()}
                    disabled={isCheckingUpdate}
                    style={{
                      padding: '5px 10px',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      backgroundColor: 'var(--bg-hover)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <RotateCw size={12} className={isCheckingUpdate ? 'spin' : ''} />
                    <span>Check for Updates</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Keybindings Tab */}
          {activeTab === 'shortcuts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Filter keybindings by command name, key, or description…"
                  value={keybindingSearch}
                  onChange={(e) => setKeybindingSearch(e.target.value)}
                  style={{ width: '100%', paddingLeft: '30px', fontSize: '12px' }}
                />
              </div>

              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredKeybindings.map((kb) => (
                  <div
                    key={kb.command}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {kb.description || kb.command}
                      </span>
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

          {/* Extensions Tab */}
          {activeTab === 'extensions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="settings-section-heading">
                <strong>Third-party Extensions</strong>
                <span>Allow sandboxed Worker execution for community extensions.</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={thirdPartyRuntimeEnabled}
                  onChange={(e) => setThirdPartyRuntimeEnabled(e.target.checked)}
                />
                Enable Worker runtime for third-party extensions
              </label>
              <p className="settings-hint">
                Only enable if you trust downloaded extensions. Sandboxed workers have restricted filesystem and process capabilities.
              </p>

              {/* Installed Extensions List with Version, Enable/Disable, and Uninstall */}
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="settings-section-heading">
                  <strong>Installed Extensions ({installedExtensions.length})</strong>
                  <span>Manage installed tools, language packages, and community extensions.</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                  {installedExtensions.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px', textAlign: 'center' }}>
                      No extensions installed.
                    </div>
                  ) : (
                    installedExtensions.map((ext) => (
                      <div
                        key={ext.id}
                        data-testid={`settings-extension-item-${ext.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          backgroundColor: 'var(--bg-tertiary)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1, marginRight: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ext.manifest.displayName || ext.manifest.name}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                                color: 'var(--accent-primary)',
                                fontFamily: 'monospace'
                              }}
                            >
                              v{ext.manifest.version}
                            </span>
                            {ext.isBuiltIn && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                  color: 'var(--text-muted)'
                                }}
                              >
                                BUILT-IN
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ext.manifest.publisher} · {ext.manifest.description || 'No description'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Enable / Disable Toggle */}
                          <button
                            type="button"
                            onClick={() => void toggleExtension(ext.id, !ext.enabled)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: ext.enabled ? 'var(--accent-green)' : 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '2px'
                            }}
                            title={ext.enabled ? 'Click to Disable' : 'Click to Enable'}
                            aria-label={ext.enabled ? `Disable ${ext.id}` : `Enable ${ext.id}`}
                          >
                            {ext.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          </button>

                          {/* Uninstall Button */}
                          {!ext.isBuiltIn && (
                            <button
                              type="button"
                              onClick={() => void uninstallExtension(ext.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--accent-red)',
                                padding: '4px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                              title="Uninstall Extension"
                              aria-label={`Uninstall ${ext.id}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Sub-tab: Integrations & Modular Skills */}
              <div
                style={{
                  marginTop: '6px',
                  padding: '12px 14px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(168, 85, 247, 0.08)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Integrations &amp; Modular Skills</strong>
                  <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Enable external agent workflows, presentation tools, chat history exporters, UI wireframing, and SEO MCP servers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('integrations')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    backgroundColor: '#a855f7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  Open Integrations &amp; Skills
                </button>
              </div>

              {/* AI Chat History Export (Phase 3.3) */}
              <div
                style={{
                  marginTop: '10px',
                  padding: '12px 14px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Export AI Chat History</strong>
                  <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Export and backup conversations from Ty-Code, Cursor, and Aider into normalized JSON and Markdown.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('integrations')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    backgroundColor: '#0ea5e9',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  Export AI History
                </button>
              </div>
            </div>
          )}

          {/* Tab: RealConnect Usage Ledger */}
          {activeTab === 'usage' && (
            <UsageLedgerView />
          )}

          {/* Tab: Provider Connection Diagnostic Harness (Phase Diagnostics 1) */}
          {activeTab === 'diagnostics' && (
            <DiagnosticsPanel />
          )}

          {error && <div className="settings-error" role="alert">{error}</div>}
        </div>

        <footer className="settings-footer">
          <button className="settings-cancel" onClick={toggleSettings}>Cancel</button>
          <button className="settings-save" disabled={securitySaving} onClick={() => activeTab === 'security' ? void handleSaveSecurity() : void handleSave()}>
            {securitySaving ? 'Saving…' : activeTab === 'security' ? 'Save Security Settings' : 'Save Settings'}
          </button>
        </footer>
      </section>
    </div>
  );
};
