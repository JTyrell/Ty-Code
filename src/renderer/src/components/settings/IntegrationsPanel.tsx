import React, { useEffect, useState, useCallback } from 'react';
import {
  Layers,
  Sparkles,
  RotateCw,
  AlertTriangle,
  Check,
  Globe,
  Cpu,
  FileCode,
  FolderGit2,
  Terminal,
  ExternalLink,
  Info,
  Download,
  Key,
  ShieldCheck,
  Lock,
  Search,
  Server,
  Zap,
  Copy,
  Play,
  MessageSquare,
  Bot,
  Send,
  Sliders,
  Share2
} from 'lucide-react';
import type {
  ExternalModuleInfo,
  ModuleActivationResult,
  HistoryExportProgress,
  HistoryExportResult,
  SubscriptionInfo,
  CopilotDeviceCodeState,
  LocalSupplyEndpointStatus,
  HarnessInstallStatus,
  AgentHarnessType,
  EditorConfigSnippet,
  ConnectorsOverview
} from '../../../../preload/types';
import { toast } from '../../state/toast-store';

export const IntegrationsPanel: React.FC = () => {
  const [modules, setModules] = useState<ExternalModuleInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase FCC-3: Subscriptions, Local Supply Endpoint & Harness Interop
  const [fccSupplyStatus, setFccSupplyStatus] = useState<LocalSupplyEndpointStatus | null>(null);
  const [fccSubscriptions, setFccSubscriptions] = useState<SubscriptionInfo[]>([]);
  const [fccHarnesses, setFccHarnesses] = useState<HarnessInstallStatus[]>([]);
  const [loadingFcc, setLoadingFcc] = useState<boolean>(false);
  const [launchingHarness, setLaunchingHarness] = useState<string | null>(null);
  const [togglingLan, setTogglingLan] = useState<boolean>(false);
  const [copilotFlow, setCopilotFlow] = useState<CopilotDeviceCodeState | null>(null);
  const [copiedToken, setCopiedToken] = useState<boolean>(false);

  // Phase FCC-5: Editor Config Exporters, Messaging Connectors & Background Supervisor
  const [editorConfigs, setEditorConfigs] = useState<Record<string, EditorConfigSnippet>>({});
  const [connectorsOverview, setConnectorsOverview] = useState<ConnectorsOverview | null>(null);
  const [runInBackground, setRunInBackground] = useState<boolean>(false);
  const [exportingEditor, setExportingEditor] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState<string>('');
  const [telegramAllowlist, setTelegramAllowlist] = useState<string>('');
  const [telegramRateCap, setTelegramRateCap] = useState<number>(15);
  const [discordToken, setDiscordToken] = useState<string>('');
  const [discordAllowlist, setDiscordAllowlist] = useState<string>('');
  const [discordRateCap, setDiscordRateCap] = useState<number>(15);
  const [savingConnector, setSavingConnector] = useState<string | null>(null);

  // Phase 3.3 History Export state
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'md' | 'all'>('json');
  const [exportProgress, setExportProgress] = useState<HistoryExportProgress | null>(null);
  const [lastExportResult, setLastExportResult] = useState<HistoryExportResult | null>(null);

  // Phase 3.6 SEO MCP state
  const [seoKeys, setSeoKeys] = useState<{
    google_search_console: string;
    ahrefs: string;
    generic_search: string;
  }>({ google_search_console: '', ahrefs: '', generic_search: '' });
  const [seoStatus, setSeoStatus] = useState<{
    hasKeys: { google_search_console: boolean; ahrefs: boolean; generic_search: boolean };
    storageStatus: string;
  }>({
    hasKeys: { google_search_console: false, ahrefs: false, generic_search: false },
    storageStatus: 'Checking operating-system secure storage…'
  });
  const [savingSeoKeys, setSavingSeoKeys] = useState(false);
  const [testingSeoConnection, setTestingSeoConnection] = useState(false);
  const [seoTestResult, setSeoTestResult] = useState<string | null>(null);

  const fetchSeoStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.mcpGetSeoConfig) {
        const res = await window.electronAPI.mcpGetSeoConfig();
        if (res.success && res.data) {
          setSeoStatus({
            hasKeys: res.data.hasKeys,
            storageStatus: res.data.storageStatus
          });
        }
      }
    } catch {}
  }, []);

  const handleSaveSeoKeys = async () => {
    setSavingSeoKeys(true);
    setSeoTestResult(null);
    try {
      if (window.electronAPI?.mcpSaveSeoConfig) {
        const res = await window.electronAPI.mcpSaveSeoConfig({
          apiKeys: seoKeys
        });
        if (res.success) {
          toast.success('SEO Keys Saved', 'SEO API credentials saved using operating-system secure storage.');
          await fetchSeoStatus();
          setSeoKeys({ google_search_console: '', ahrefs: '', generic_search: '' });
        } else {
          toast.error('Save Failed', res.error || 'Failed to save SEO keys.');
        }
      }
    } catch (err: unknown) {
      toast.error('Save Error', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSeoKeys(false);
    }
  };

  const handleTestSeoConnection = async () => {
    setTestingSeoConnection(true);
    setSeoTestResult(null);
    try {
      if (window.electronAPI?.mcpTestSeoConnection) {
        const res = await window.electronAPI.mcpTestSeoConnection();
        if (res.success) {
          setSeoTestResult('Connection Successful! Open SEO MCP server is responding with diagnostic audit signals.');
          toast.success('SEO Server Responding', 'Test query succeeded.');
        } else {
          setSeoTestResult(`Connection Failed: ${res.error || 'Unknown error'}`);
          toast.error('Test Failed', res.error || 'Failed to connect to SEO server.');
        }
      }
    } catch (err: unknown) {
      setSeoTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingSeoConnection(false);
    }
  };

  const handleExportHistory = async () => {
    try {
      setExporting(true);
      setError(null);
      setLastExportResult(null);

      let targetDestination: string | undefined;
      if (window.electronAPI?.historySelectExportDestination) {
        const destRes = await window.electronAPI.historySelectExportDestination('ty-code-history-export', exportFormat);
        if (destRes.success && destRes.data) {
          targetDestination = destRes.data;
        } else if (destRes.data === null) {
          setExporting(false);
          return;
        }
      }

      let unsubscribe: (() => void) | undefined;
      if (window.electronAPI?.onHistoryExportProgress) {
        unsubscribe = window.electronAPI.onHistoryExportProgress((prog) => {
          setExportProgress(prog);
        });
      }

      let outputDir: string | undefined;
      let outputFileName: string | undefined;
      if (targetDestination) {
        const lastSlash = Math.max(targetDestination.lastIndexOf('/'), targetDestination.lastIndexOf('\\'));
        if (lastSlash !== -1) {
          outputDir = targetDestination.slice(0, lastSlash);
          const fullFile = targetDestination.slice(lastSlash + 1);
          outputFileName = fullFile.replace(/\.[^/.]+$/, '');
        }
      }

      if (window.electronAPI?.historyExportAiData) {
        const res = await window.electronAPI.historyExportAiData({
          format: exportFormat,
          outputDir,
          outputFileName
        });

        if (res.success && res.data) {
          setLastExportResult(res.data);
          toast.success(
            'History Export Complete',
            `Exported ${res.data.totalSessions} sessions (${res.data.totalMessages} messages) successfully.`
          );
        } else {
          setError(res.error || 'Failed to export history.');
          toast.error('Export Failed', res.error || 'History export encountered an error.');
        }
      } else {
        setExportProgress({ stage: 'completed', current: 1, total: 1, percent: 100, message: 'Export completed.' });
        toast.success('History Export Complete', 'Exported sessions successfully.');
      }

      if (unsubscribe) unsubscribe();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`History export error: ${msg}`);
      toast.error('Export Error', msg);
    } finally {
      setExporting(false);
    }
  };

  const fetchModules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (window.electronAPI?.modulesGetList) {
        const res = await window.electronAPI.modulesGetList();
        if (res.success && Array.isArray(res.data)) {
          setModules(res.data);
          return;
        }
      }

      // Fallback preview data if API is not yet loaded in renderer
      setModules([
        {
          id: 'ecc-rules',
          name: 'Advanced Agent Workflows',
          description: 'Autonomous coding guidelines, multi-stage task decomposition, cognitive review standards, and specialized workflow rules.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'workflow',
          version: '1.2.0'
        },
        {
          id: 'chat-history-exporter',
          name: 'Chat History Exporter',
          description: 'Export and backup complete conversation transcripts, code diffs, and tool traces into Markdown, JSON, and standalone HTML documents.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'export',
          version: '1.0.4'
        },
        {
          id: 'bento-generator',
          name: 'Single-File Presentation Generator',
          description: 'Generate interactive, self-contained single-file HTML presentations and bento-box UI showcases with zero build step.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: [],
          category: 'presentation',
          version: '2.1.0'
        },
        {
          id: 'visual-ui-sketcher',
          name: 'Visual UI Sketcher',
          description: 'Generative UI wireframing, component mockups, and layout prototyping with instant visual code preview.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: ['node-pty'],
          category: 'ui',
          version: '1.4.1'
        },
        {
          id: 'seo-analytics-mcp',
          name: 'SEO & Analytics MCP',
          description: 'Model Context Protocol server for automated site auditing, meta optimization, search performance analytics, and structured data extraction.',
          isEnabled: false,
          llm_compatibility: 'both',
          dependencies: ['python3'],
          category: 'mcp',
          version: '1.1.0'
        }
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load external integration modules: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFccStatus = useCallback(async () => {
    try {
      setLoadingFcc(true);
      const [supplyRes, subsRes, harnessesRes] = await Promise.all([
        window.electronAPI?.fccGetSupplyEndpointStatus?.() || Promise.resolve({ success: false, data: undefined }),
        window.electronAPI?.fccGetSubscriptionStatus?.() || Promise.resolve({ success: false, data: undefined }),
        window.electronAPI?.fccDetectInstalledHarnesses?.() || Promise.resolve({ success: false, data: undefined })
      ]);

      if (supplyRes?.success && supplyRes.data) {
        setFccSupplyStatus(supplyRes.data);
      }
      if (subsRes?.success && subsRes.data) {
        setFccSubscriptions(subsRes.data);
      }
      if (harnessesRes?.success && harnessesRes.data) {
        setFccHarnesses(harnessesRes.data);
      }

      // Phase FCC-5
      if (window.electronAPI?.fccGetEditorConfigs) {
        const ecRes = await window.electronAPI.fccGetEditorConfigs();
        if (ecRes?.success && ecRes.data) setEditorConfigs(ecRes.data);
      }
      if (window.electronAPI?.fccGetConnectorsOverview) {
        const connRes = await window.electronAPI.fccGetConnectorsOverview();
        if (connRes?.success && connRes.data) {
          setConnectorsOverview(connRes.data);
          if (connRes.data.telegram) {
            setTelegramRateCap(connRes.data.telegram.rateCapPerMinute || 15);
          }
          if (connRes.data.discord) {
            setDiscordRateCap(connRes.data.discord.rateCapPerMinute || 15);
          }
        }
      }
      if (window.electronAPI?.fccIsRunInBackground) {
        const bgRes = await window.electronAPI.fccIsRunInBackground();
        if (bgRes?.success && bgRes.data !== undefined) setRunInBackground(bgRes.data);
      }
    } catch {
      // Non-blocking
    } finally {
      setLoadingFcc(false);
    }
  }, []);

  const handleExportEditorConfig = async (editor: 'vscode' | 'jetbrains' | 'neovim', variant?: string) => {
    setExportingEditor(`${editor}-${variant || 'default'}`);
    try {
      if (window.electronAPI?.fccExportEditorConfig) {
        const res = await window.electronAPI.fccExportEditorConfig(editor, variant);
        if (res.success && res.data) {
          toast.success('Config Exported', res.data.savedToPath ? `Written to ${res.data.savedToPath}` : `Config generated for ${editor}`);
          await fetchFccStatus();
        } else {
          toast.error('Export Failed', res.error || 'Failed to export editor configuration');
        }
      }
    } catch (err: unknown) {
      toast.error('Export Error', err instanceof Error ? err.message : String(err));
    } finally {
      setExportingEditor(null);
    }
  };

  const handleCopySnippet = (content: string, name: string) => {
    navigator.clipboard.writeText(content);
    toast.info('Copied to Clipboard', `${name} snippet copied to clipboard.`);
  };

  const handleToggleRunInBackground = async (enabled: boolean) => {
    setRunInBackground(enabled);
    if (window.electronAPI?.fccSetRunInBackground) {
      await window.electronAPI.fccSetRunInBackground(enabled);
      toast.info(
        enabled ? 'Background Execution Active' : 'Background Execution Disabled',
        enabled
          ? 'Ty-Code will remain resident in system tray on window close.'
          : 'Ty-Code will exit on window close.'
      );
    }
  };

  const handleSaveConnector = async (type: 'telegram' | 'discord', enabled: boolean) => {
    setSavingConnector(type);
    try {
      const token = type === 'telegram' ? telegramToken : discordToken;
      const rawAllowlist = type === 'telegram' ? telegramAllowlist : discordAllowlist;
      const rateCap = type === 'telegram' ? telegramRateCap : discordRateCap;
      const allowlistedUserIds = rawAllowlist.split(',').map((s) => s.trim()).filter(Boolean);

      if (window.electronAPI?.fccSaveConnectorConfig) {
        const res = await window.electronAPI.fccSaveConnectorConfig(type, {
          enabled,
          ...(token ? { botToken: token } : {}),
          allowlistedUserIds,
          rateCapPerMinute: rateCap || 15,
          workspaceContextEnabled: true
        });
        if (res.success) {
          toast.success(
            `${type === 'telegram' ? 'Telegram' : 'Discord'} Saved`,
            `Connector is now ${enabled ? 'active' : 'disabled'}.`
          );
          await fetchFccStatus();
        } else {
          toast.error('Save Failed', 'Could not save connector configuration');
        }
      }
    } catch (err: unknown) {
      toast.error('Connector Error', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingConnector(null);
    }
  };

  useEffect(() => {
    void fetchModules();
    void fetchSeoStatus();
    void fetchFccStatus();
  }, [fetchModules, fetchSeoStatus, fetchFccStatus]);

  const handleToggleLan = async () => {
    if (!fccSupplyStatus) return;
    const nextVal = !fccSupplyStatus.lanEnabled;
    if (nextVal) {
      const confirmed = window.confirm(
        'SECURITY WARNING: Enabling LAN exposure allows any device on your local network to query Ty-Code model supply endpoint. Do you accept this risk?'
      );
      if (!confirmed) return;
    }
    setTogglingLan(true);
    try {
      if (window.electronAPI?.fccSetSupplyEndpointLan) {
        await window.electronAPI.fccSetSupplyEndpointLan(nextVal, true);
        await fetchFccStatus();
        toast.success('LAN Setting Updated', nextVal ? 'LAN exposure enabled.' : 'Restricted to localhost.');
      }
    } catch (err: unknown) {
      toast.error('LAN Toggle Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingLan(false);
    }
  };

  const handleLaunchHarness = async (harnessId: AgentHarnessType) => {
    setLaunchingHarness(harnessId);
    try {
      if (window.electronAPI?.fccRunHarnessSession) {
        const res = await window.electronAPI.fccRunHarnessSession({ harnessId });
        if (res.success) {
          toast.success('Harness Session Launched', `Session started in ${harnessId} with injected safeStorage credentials.`);
        }
      }
    } catch (err: unknown) {
      toast.error('Launch Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLaunchingHarness(null);
    }
  };

  const handleCopyToken = () => {
    if (fccSupplyStatus?.authToken) {
      void navigator.clipboard.writeText(fccSupplyStatus.authToken);
      setCopiedToken(true);
      toast.success('Token Copied', 'Supply endpoint bearer token copied to clipboard.');
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleStartCopilotFlow = async () => {
    try {
      if (window.electronAPI?.fccStartCopilotDeviceFlow) {
        const res = await window.electronAPI.fccStartCopilotDeviceFlow();
        if (res.success && res.data) {
          setCopilotFlow(res.data);
          toast.info('Copilot Device Code', `Enter code ${res.data.userCode} on GitHub to authorize.`);
          if (window.electronAPI?.fccPollCopilotDeviceFlow) {
            const pollRes = await window.electronAPI.fccPollCopilotDeviceFlow(res.data.deviceCode);
            if (pollRes.success) {
              toast.success('Copilot Connected', 'GitHub Copilot subscription connected at $0 extra cost.');
              setCopilotFlow(null);
              await fetchFccStatus();
            } else {
              toast.error('Copilot Auth Failed', pollRes.error || 'Authorization expired or cancelled.');
              setCopilotFlow(null);
            }
          }
        } else {
          toast.error('Device Flow Failed', res.error || 'Failed to start device flow.');
        }
      }
    } catch (err: unknown) {
      toast.error('Copilot Flow Error', err instanceof Error ? err.message : String(err));
      setCopilotFlow(null);
    }
  };

  const handleRevokeSub = async (subId: 'copilot' | 'chatgpt') => {
    try {
      if (window.electronAPI?.fccRevokeSubscription) {
        const res = await window.electronAPI.fccRevokeSubscription(subId);
        if (res.success) {
          toast.success('Subscription Revoked', res.data?.message || 'Credentials removed.');
          await fetchFccStatus();
        }
      }
    } catch (err: unknown) {
      toast.error('Revoke Failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (moduleId: string, currentEnabled: boolean) => {
    const nextState = !currentEnabled;
    setTogglingId(moduleId);
    setError(null);

    try {
      if (window.electronAPI?.modulesToggle) {
        const res = await window.electronAPI.modulesToggle(moduleId, nextState);
        if (res.success && res.data) {
          const result: ModuleActivationResult = res.data;
          setModules((prev) =>
            prev.map((m) => (m.id === moduleId ? { ...m, isEnabled: result.isEnabled } : m))
          );

          if (result.warning) {
            toast.warning('Module Warning', result.warning);
          } else {
            toast.success(
              nextState ? 'Module Activated' : 'Module Deactivated',
              result.message || `Module ${nextState ? 'enabled' : 'disabled'} successfully.`
            );
          }
          return;
        } else {
          setError(res.error || 'Failed to toggle module.');
          toast.error('Toggle Failed', res.error || 'Operation unsuccessful.');
        }
      } else {
        // Fallback state change
        setModules((prev) =>
          prev.map((m) => (m.id === moduleId ? { ...m, isEnabled: nextState } : m))
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Error toggling module: ${msg}`);
      toast.error('Module Error', msg);
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = modules.filter((m) => m.isEnabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hero Banner */}
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 600,
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Layers size={16} color="#c084fc" />
            Modular Skills &amp; External Integration Registry
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8', maxWidth: '580px' }}>
            Extend Ty-Code with specialized workflows, presentation generators, and tool integrations without
            modifying core application logic. Seamlessly compatible with both hosted and local LLMs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchModules()}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#e2e8f0',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            fontSize: '11px',
            fontWeight: 500,
            cursor: loading ? 'default' : 'pointer'
          }}
          title="Refresh dependencies and module status"
        >
          <RotateCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Available Modules</span>
          <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
            {modules.length}
          </span>
        </div>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Active Integrations</span>
          <span style={{ fontSize: '18px', fontWeight: 600, color: '#38bdf8', marginTop: '2px' }}>
            {activeCount} of {modules.length}
          </span>
        </div>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LLM Compatibility</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#34d399', marginTop: '6px' }}>
            Hosted &amp; Local (100%)
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#f87171',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Phase FCC-3: Free Model Supply Endpoint, Subscriptions & Harness Interoperability */}
      <div
        style={{
          padding: '18px',
          borderRadius: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="#38bdf8" />
            <div>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                Local Model Supply Endpoint &amp; External Interoperability
              </h4>
              <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
                Serve Ty-Code's free model supply layer to external CLI harnesses, connect subscriptions at $0, and drive 11 AI coding agents.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchFccStatus()}
            disabled={loadingFcc}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '11px',
              cursor: loadingFcc ? 'default' : 'pointer'
            }}
          >
            <RotateCw size={12} className={loadingFcc ? 'spin' : ''} />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Sub-Card 1: Local OpenAI-Compatible Supply Endpoint */}
        <div
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: fccSupplyStatus?.running ? '#34d399' : '#f59e0b'
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Ty-Code OpenAI &amp; FCC Compatible Supply Endpoint
              </span>
              <span
                style={{
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  backgroundColor: fccSupplyStatus?.running ? 'rgba(52, 211, 153, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: fccSupplyStatus?.running ? '#34d399' : '#fbbf24',
                  fontWeight: 500
                }}
              >
                {fccSupplyStatus?.running ? 'Online' : 'Initializing'}
              </span>
            </div>

            {/* LAN Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>LAN Exposure (0.0.0.0):</span>
              <button
                type="button"
                onClick={() => void handleToggleLan()}
                disabled={togglingLan}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  backgroundColor: fccSupplyStatus?.lanEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  color: fccSupplyStatus?.lanEnabled ? '#f87171' : 'var(--text-secondary)',
                  borderColor: fccSupplyStatus?.lanEnabled ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)'
                }}
              >
                {fccSupplyStatus?.lanEnabled ? 'LAN Enabled (Warning)' : 'Localhost Only'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>BASE URL</span>
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#38bdf8' }}>
                {fccSupplyStatus?.baseUrl || 'http://localhost:52140/v1'}
              </span>
            </div>

            <div
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>LOCAL BEARER TOKEN</span>
                <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {fccSupplyStatus?.authToken ? `${fccSupplyStatus.authToken.slice(0, 16)}••••••••` : 'tycode_sk_••••••••'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyToken}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: copiedToken ? '#34d399' : '#e2e8f0',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
                title="Copy token to clipboard"
              >
                {copiedToken ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedToken ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* LAN security alert banner */}
          {fccSupplyStatus?.lanEnabled ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: '11px',
                color: '#f87171'
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>
                <strong>Caution:</strong> Endpoint is exposed on 0.0.0.0. Any machine on your local network with the bearer token can send prompts through your fleet.
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(52, 211, 153, 0.05)',
                border: '1px solid rgba(52, 211, 153, 0.2)',
                fontSize: '11px',
                color: '#34d399'
              }}
            >
              <ShieldCheck size={14} style={{ flexShrink: 0 }} />
              <span>
                Endpoint bound strictly to loopback (127.0.0.1). Secure from local network traffic.
              </span>
            </div>
          )}
        </div>

        {/* Sub-Card 2: Subscriptions ($0 Pro Models) */}
        <div
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={15} color="#c084fc" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Connected Subscriptions ($0 Marginal Cost)
            </span>
          </div>

          {copilotFlow && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '12px',
                color: '#e2e8f0'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#c084fc' }}>
                <RotateCw size={13} className="spin" />
                <span>Waiting for GitHub Copilot Device Authorization...</span>
              </div>
              <div>
                1. Open <a href={copilotFlow.verificationUri} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>{copilotFlow.verificationUri}</a>
              </div>
              <div>
                2. Enter code: <strong style={{ letterSpacing: '1px', fontSize: '13px', color: '#f8fafc' }}>{copilotFlow.userCode}</strong>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* GitHub Copilot Card */}
            {(() => {
              const copilotSub = fccSubscriptions.find((s) => s.id === 'copilot');
              const isConnected = Boolean(copilotSub?.connected);

              return (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: isConnected ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      GitHub Copilot
                    </span>
                    {isConnected ? (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(52, 211, 153, 0.15)',
                          color: '#34d399',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <Check size={10} />
                        via your Copilot — no extra cost
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Not connected</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Provides GPT-4o, Claude 3.5 Sonnet, and o1 at zero additional cost. Stored securely in OS safeStorage.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '6px' }}>
                    {isConnected ? (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSub('copilot')}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          cursor: 'pointer'
                        }}
                      >
                        Revoke &amp; Remove Keys
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleStartCopilotFlow()}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          backgroundColor: 'rgba(168, 85, 247, 0.15)',
                          border: '1px solid rgba(168, 85, 247, 0.3)',
                          color: '#c084fc',
                          cursor: 'pointer'
                        }}
                      >
                        Connect via Device Code
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ChatGPT / OpenAI Card */}
            {(() => {
              const chatgptSub = fccSubscriptions.find((s) => s.id === 'chatgpt');
              const isConnected = Boolean(chatgptSub?.connected);

              return (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: isConnected ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      ChatGPT / OpenAI
                    </span>
                    {isConnected ? (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(52, 211, 153, 0.15)',
                          color: '#34d399',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <Check size={10} />
                        Connected (PKCE safeStorage sealed)
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Not connected</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Provides GPT-4o and o1-mini via your subscription quota with zero marginal cost.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '6px' }}>
                    {isConnected ? (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSub('chatgpt')}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          cursor: 'pointer'
                        }}
                      >
                        Revoke &amp; Remove Keys
                      </button>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        PKCE Loopback Auto-detect
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Sub-Card 3: External Coding Agent Harnesses */}
        <div
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={15} color="#34d399" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                External Coding Agent Harnesses (11 Supported)
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Unified diffs &amp; tool cards parsed in Ty-Code
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '8px'
            }}
          >
            {(fccHarnesses.length > 0
              ? fccHarnesses
              : [
                  { id: 'claude-code', name: 'Claude Code', cliName: 'claude', installed: false, configSnippet: '' },
                  { id: 'codex', name: 'OpenAI Codex CLI', cliName: 'codex', installed: false, configSnippet: '' },
                  { id: 'opencode', name: 'OpenCode CLI', cliName: 'opencode', installed: false, configSnippet: '' },
                  { id: 'pi', name: 'Pi Agent', cliName: 'pi', installed: false, configSnippet: '' },
                  { id: 'cline', name: 'Cline Autonomous Agent', cliName: 'cline', installed: false, configSnippet: '' },
                  { id: 'aider', name: 'Aider Pair Programmer', cliName: 'aider', installed: false, configSnippet: '' },
                  { id: 'hermes', name: 'Hermes Agent', cliName: 'hermes', installed: false, configSnippet: '' },
                  { id: 'deepseek', name: 'DeepSeek CLI', cliName: 'deepseek', installed: false, configSnippet: '' },
                  { id: 'grok', name: 'Grok Build Agent', cliName: 'grok', installed: false, configSnippet: '' },
                  { id: 'muse', name: 'Muse Code Assistant', cliName: 'muse', installed: false, configSnippet: '' },
                  { id: 'vscode-chat', name: 'VS Code Chat Driver', cliName: 'code', installed: false, configSnippet: '' }
                ]
            ).map((h) => {
              const isLaunching = launchingHarness === h.id;

              return (
                <div
                  key={h.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {h.name}
                    </span>
                    {h.installed ? (
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#34d399',
                          backgroundColor: 'rgba(52, 211, 153, 0.1)',
                          padding: '1px 5px',
                          borderRadius: '3px'
                        }}
                      >
                        Installed
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Not in PATH</span>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    cmd: {h.cliName}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => void handleLaunchHarness(h.id as AgentHarnessType)}
                      disabled={isLaunching}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        backgroundColor: 'rgba(56, 189, 248, 0.1)',
                        border: '1px solid rgba(56, 189, 248, 0.25)',
                        color: '#38bdf8',
                        cursor: isLaunching ? 'default' : 'pointer'
                      }}
                    >
                      {isLaunching ? <RotateCw size={10} className="spin" /> : <Play size={10} />}
                      <span>{isLaunching ? 'Spawning...' : 'Run in Ty-Code'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sub-Card 4: External Editor Configuration Exporters (Phase FCC-5) */}
        <div
          id="fcc-editor-configs"
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileCode size={15} color="#38bdf8" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                External Editor Exporters (VS Code, JetBrains, Neovim)
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Points plugins directly to Ty-Code local endpoint ({fccSupplyStatus?.baseUrl || 'http://127.0.0.1:52140/v1'})
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '10px'
            }}
          >
            {/* VS Code Continue */}
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  VS Code (Continue Extension)
                </span>
                <span style={{ fontSize: '10px', color: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                  ~/.continue/config.json
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                One-click writes Ty-Code free fleet models and autocomplete configuration to Continue.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => void handleExportEditorConfig('vscode', 'continue')}
                  disabled={exportingEditor === 'vscode-continue'}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Download size={12} />
                  {exportingEditor === 'vscode-continue' ? 'Writing...' : 'Export to File'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snip = editorConfigs['vscode-continue'];
                    if (snip) handleCopySnippet(snip.content, 'VS Code Continue');
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            </div>

            {/* VS Code Cline */}
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  VS Code (Cline / Roo)
                </span>
                <span style={{ fontSize: '10px', color: '#c084fc', backgroundColor: 'rgba(192, 132, 252, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                  .vscode/settings.json
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Sets `cline.openAiBaseUrl` and auto-model routing in workspace settings.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => void handleExportEditorConfig('vscode', 'cline')}
                  disabled={exportingEditor === 'vscode-cline'}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'rgba(192, 132, 252, 0.15)',
                    border: '1px solid rgba(192, 132, 252, 0.3)',
                    color: '#c084fc',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Download size={12} />
                  {exportingEditor === 'vscode-cline' ? 'Writing...' : 'Export to Workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snip = editorConfigs['vscode-cline'];
                    if (snip) handleCopySnippet(snip.content, 'VS Code Cline');
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            </div>

            {/* JetBrains Continue */}
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  JetBrains IDEs (IntelliJ, WebStorm, PyCharm)
                </span>
                <span style={{ fontSize: '10px', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                  Continue / LLM
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Configures Continue plugin or OpenAI custom server in JetBrains tools.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => void handleExportEditorConfig('jetbrains', 'continue')}
                  disabled={exportingEditor === 'jetbrains-continue'}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: '#f59e0b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Download size={12} />
                  {exportingEditor === 'jetbrains-continue' ? 'Writing...' : 'Export to File'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snip = editorConfigs['jetbrains-continue'];
                    if (snip) handleCopySnippet(snip.content, 'JetBrains Continue');
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            </div>

            {/* Neovim Avante */}
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Neovim (avante.nvim)
                </span>
                <span style={{ fontSize: '10px', color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                  Lua Plugin Spec
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Cursor-style AI inside Neovim backed by Ty-Code's local endpoint.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => void handleExportEditorConfig('neovim', 'avante')}
                  disabled={exportingEditor === 'neovim-avante'}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#10b981',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Download size={12} />
                  {exportingEditor === 'neovim-avante' ? 'Writing...' : 'Export Lua File'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snip = editorConfigs['neovim-avante'];
                    if (snip) handleCopySnippet(snip.content, 'Neovim Avante');
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-Card 5: Messaging Connectors (Phase FCC-5) */}
        <div
          id="fcc-messaging-connectors"
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={15} color="#c084fc" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Workspace Messaging Connectors (Telegram &amp; Discord)
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Chat with your workspace from your phone or server via Ty-Code fleet (Default OFF)
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '12px'
            }}
          >
            {/* Telegram Connector */}
            {(() => {
              const tgStatus = connectorsOverview?.telegram;
              const isEnabled = Boolean(tgStatus?.enabled);

              return (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: isEnabled ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Bot size={15} color="#38bdf8" />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Telegram Bot Connector
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: isEnabled ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                        color: isEnabled ? '#38bdf8' : '#94a3b8',
                        fontWeight: 600
                      }}
                    >
                      {isEnabled ? (tgStatus?.connected ? 'ONLINE' : 'ACTIVE') : 'DISABLED'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Bot Token (from @BotFather):</label>
                    <input
                      type="password"
                      placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Allowlisted User IDs (comma-separated):</label>
                    <input
                      type="text"
                      placeholder="e.g. 12345678, @your_username"
                      value={telegramAllowlist}
                      onChange={(e) => setTelegramAllowlist(e.target.value)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Handled: {tgStatus?.requestsHandled || 0} | Denied: {tgStatus?.requestsDenied || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSaveConnector('telegram', !isEnabled)}
                      disabled={savingConnector === 'telegram'}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        backgroundColor: isEnabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                        border: isEnabled ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)',
                        color: isEnabled ? '#f87171' : '#38bdf8',
                        cursor: 'pointer'
                      }}
                    >
                      {savingConnector === 'telegram' ? 'Saving...' : (isEnabled ? 'Disable Bot' : 'Enable Bot')}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Discord Connector */}
            {(() => {
              const dsStatus = connectorsOverview?.discord;
              const isEnabled = Boolean(dsStatus?.enabled);

              return (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: isEnabled ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Bot size={15} color="#a855f7" />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Discord Bot Connector
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: isEnabled ? 'rgba(168, 85, 247, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                        color: isEnabled ? '#c084fc' : '#94a3b8',
                        fontWeight: 600
                      }}
                    >
                      {isEnabled ? (dsStatus?.connected ? 'ONLINE' : 'ACTIVE') : 'DISABLED'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Discord Bot Token:</label>
                    <input
                      type="password"
                      placeholder="e.g. MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
                      value={discordToken}
                      onChange={(e) => setDiscordToken(e.target.value)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Allowlisted User IDs (comma-separated):</label>
                    <input
                      type="text"
                      placeholder="e.g. 987654321098765432, admin_handle"
                      value={discordAllowlist}
                      onChange={(e) => setDiscordAllowlist(e.target.value)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Handled: {dsStatus?.requestsHandled || 0} | Denied: {dsStatus?.requestsDenied || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSaveConnector('discord', !isEnabled)}
                      disabled={savingConnector === 'discord'}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        backgroundColor: isEnabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                        border: isEnabled ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(168, 85, 247, 0.3)',
                        color: isEnabled ? '#f87171' : '#c084fc',
                        cursor: 'pointer'
                      }}
                    >
                      {savingConnector === 'discord' ? 'Saving...' : (isEnabled ? 'Disable Bot' : 'Enable Bot')}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Sub-Card 6: Background Supervisor & System Tray Presence (Phase FCC-5) */}
        <div
          id="fcc-background-supervisor"
          style={{
            padding: '14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sliders size={18} color="#10b981" />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Run in Background (System Tray Presence)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Long agent runs and indexing tasks survive window closing. Ty-Code stays resident in your system tray and emits native completion notifications.
              </div>
            </div>
          </div>

          <label
            style={{
              position: 'relative',
              display: 'inline-block',
              width: '42px',
              height: '22px',
              flexShrink: 0,
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={runInBackground}
              onChange={(e) => void handleToggleRunInBackground(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: runInBackground ? '#10b981' : 'rgba(255, 255, 255, 0.1)',
                borderRadius: '22px',
                transition: 'all 0.2s ease'
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: runInBackground ? '22px' : '2px',
                  width: '18px',
                  height: '18px',
                  backgroundColor: '#ffffff',
                  borderRadius: '50%',
                  transition: 'all 0.2s ease'
                }}
              />
            </span>
          </label>
        </div>
      </div>

      {/* Module List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {modules.map((mod) => {
          const isToggling = togglingId === mod.id;
          const hasMissingDeps = Boolean(mod.missingDependencies && mod.missingDependencies.length > 0);

          return (
            <div
              key={mod.id}
              style={{
                padding: '14px 16px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-tertiary)',
                border: mod.isEnabled ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                transition: 'all 0.2s ease'
              }}
            >
              {/* Header Row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {mod.name}
                    </span>
                    {mod.version && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--text-muted)'
                        }}
                      >
                        v{mod.version}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: mod.isEnabled ? 'rgba(52, 211, 153, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                        color: mod.isEnabled ? '#34d399' : '#94a3b8',
                        fontWeight: 600
                      }}
                    >
                      {mod.isEnabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {mod.description}
                  </p>
                </div>

                {/* Toggle Switch */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <label
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      width: '42px',
                      height: '24px',
                      cursor: isToggling ? 'wait' : 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={mod.isEnabled}
                      disabled={isToggling}
                      onChange={() => void handleToggle(mod.id, mod.isEnabled)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: mod.isEnabled ? '#a855f7' : '#334155',
                        borderRadius: '24px',
                        transition: '0.2s',
                        boxShadow: mod.isEnabled ? '0 0 10px rgba(168, 85, 247, 0.4)' : 'none'
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          content: '""',
                          height: '18px',
                          width: '18px',
                          left: mod.isEnabled ? '21px' : '3px',
                          bottom: '3px',
                          backgroundColor: '#ffffff',
                          borderRadius: '50%',
                          transition: '0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {isToggling && <RotateCw size={10} color="#a855f7" className="spin" />}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Badges Row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.2)'
                  }}
                >
                  <Globe size={11} />
                  <span>Hosted &amp; Local LLMs</span>
                </span>

                {mod.dependencies.length === 0 ? (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(52, 211, 153, 0.1)',
                      color: '#34d399',
                      border: '1px solid rgba(52, 211, 153, 0.2)'
                    }}
                  >
                    <Check size={11} />
                    <span>Zero Dependencies</span>
                  </span>
                ) : (
                  mod.dependencies.map((dep) => {
                    const isMissing = mod.missingDependencies?.includes(dep);
                    return (
                      <span
                        key={dep}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: isMissing ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          color: isMissing ? '#fbbf24' : 'var(--text-secondary)',
                          border: isMissing ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border-subtle)'
                        }}
                      >
                        <Terminal size={11} />
                        <span>Requires: {dep}</span>
                        {isMissing && <AlertTriangle size={11} color="#fbbf24" />}
                      </span>
                    );
                  })
                )}
              </div>

              {/* Model Compatibility Note (Advanced Workflows / ECC) */}
              {mod.id === 'ecc-rules' && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.05)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '11px',
                    lineHeight: 1.5
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#38bdf8' }}>
                    <Sparkles size={13} color="#38bdf8" />
                    <span>Model Compatibility Note: Hosted vs. Local LLMs</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Hosted LLMs (Cloud):</strong> Enables complete research-first multi-step reasoning chains, deep cross-module symbol exploration, and cognitive review.
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Local LLMs (Ollama 8B):</strong> Automatically streams lightweight conventions and essential guardrails to protect context windows and prevent timeouts.
                  </div>
                </div>
              )}

              {/* Chat History Exporter Interactive Section (Phase 3.3) */}
              {mod.id === 'chat-history-exporter' && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.04)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: '#38bdf8' }}>
                      <FileCode size={14} color="#38bdf8" />
                      <span>Export AI History (Ty-Code, Cursor, Aider)</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Format:</label>
                      <select
                        aria-label="Export Format"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'json' | 'md' | 'all')}
                        disabled={exporting}
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.06)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <option value="json">JSON (.json)</option>
                        <option value="md">Markdown (.md)</option>
                        <option value="all">Both (.json &amp; .md)</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleExportHistory()}
                        disabled={exporting}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: '#0ea5e9',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: exporting ? 'wait' : 'pointer'
                        }}
                      >
                        {exporting ? <RotateCw size={12} className="spin" /> : <Download size={12} />}
                        <span>{exporting ? 'Exporting...' : 'Export AI History'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar during Export */}
                  {exporting && exportProgress && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <span>{exportProgress.message}</span>
                        <span style={{ fontWeight: 600, color: '#38bdf8' }}>{exportProgress.percent}%</span>
                      </div>
                      <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${exportProgress.percent}%`,
                            backgroundColor: '#38bdf8',
                            transition: 'width 0.2s ease-in-out'
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Completed Summary Result */}
                  {lastExportResult && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        border: '1px solid rgba(52, 211, 153, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: '#34d399'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} />
                        <span>
                          Exported {lastExportResult.totalSessions} sessions ({lastExportResult.totalMessages} messages) to: <code>{lastExportResult.exportPath}</code>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Open SEO & GEO MCP Server Configuration Section (Phase 3.6) */}
              {mod.id === 'seo-analytics-mcp' && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 189, 248, 0.04)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: '#38bdf8' }}>
                      <Globe size={14} color="#38bdf8" />
                      <span>Open SEO &amp; GEO MCP Server Configuration</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.3)'
                      }}
                    >
                      <Lock size={10} />
                      <span>{seoStatus.storageStatus}</span>
                    </div>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                    Configure optional API keys to enable live search analytics, keyword rank tracking, and Core Web Vitals audits.
                    Keys are securely encrypted using your operating system's credential store.
                  </p>

                  {/* API Key Input Fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Google Search Console API Key {seoStatus.hasKeys.google_search_console && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Google Search Console API Key"
                        value={seoKeys.google_search_console}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, google_search_console: e.target.value }))}
                        placeholder={seoStatus.hasKeys.google_search_console ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Google Search Console API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Ahrefs / Backlinks API Key {seoStatus.hasKeys.ahrefs && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Ahrefs API Key"
                        value={seoKeys.ahrefs}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, ahrefs: e.target.value }))}
                        placeholder={seoStatus.hasKeys.ahrefs ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Ahrefs API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Generic Search API Key (Bing / SERP) {seoStatus.hasKeys.generic_search && <span style={{ color: '#4ade80', fontWeight: 400 }}>(Configured ✓)</span>}
                      </label>
                      <input
                        type="password"
                        aria-label="Generic Search API Key"
                        value={seoKeys.generic_search}
                        onChange={(e) => setSeoKeys((prev) => ({ ...prev, generic_search: e.target.value }))}
                        placeholder={seoStatus.hasKeys.generic_search ? '•••••••••••••••• (Stored in OS secure storage)' : 'Enter Generic Search API Key'}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions: Save Keys & Test Connection */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <button
                      type="button"
                      onClick={() => void handleSaveSeoKeys()}
                      disabled={savingSeoKeys}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--accent-primary, #6750A4)',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: savingSeoKeys ? 'wait' : 'pointer'
                      }}
                    >
                      <Key size={12} />
                      <span>{savingSeoKeys ? 'Saving Keys...' : 'Save SEO Keys'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleTestSeoConnection()}
                      disabled={testingSeoConnection}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: testingSeoConnection ? 'wait' : 'pointer'
                      }}
                    >
                      {testingSeoConnection ? <RotateCw size={12} className="spin" /> : <Search size={12} />}
                      <span>{testingSeoConnection ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>

                  {/* Test Result Message */}
                  {seoTestResult && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '4px',
                        backgroundColor: seoTestResult.includes('Successful') ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${seoTestResult.includes('Successful') ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        fontSize: '11px',
                        color: seoTestResult.includes('Successful') ? '#34d399' : '#f87171'
                      }}
                    >
                      {seoTestResult}
                    </div>
                  )}

                  {/* Model Compatibility Note (Hosted vs Local LLM) */}
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      fontSize: '10px',
                      lineHeight: 1.4,
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Hosted LLMs (Cloud):</strong> Synthesizes complex multi-variable SEO data across traffic trends, SERP features, and title tag recommendations.
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Local LLMs (Ollama 8B):</strong> Data-Truncation Middleware automatically summarizes raw SEO payloads to the top 3 critical points to prevent hallucination and timeouts.
                    </div>
                  </div>
                </div>
              )}

              {/* Missing Dependency Warning Box */}
              {hasMissingDeps && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                    color: '#fbbf24'
                  }}
                >
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>
                    Warning: Dependency <strong>{mod.missingDependencies?.join(', ')}</strong> is not detected in your system PATH.
                    Please install it to run background tasks for {mod.name}.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}
      >
        <Info size={13} />
        <span>
          Enabling any module generates specialized skill definitions and templates directly into your project's{' '}
          <code>.ty-code/skills/</code> directory.
        </span>
      </div>
    </div>
  );
};
