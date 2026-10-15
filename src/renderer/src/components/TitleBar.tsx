import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  Settings,
  Terminal,
  Cpu,
  Minus,
  Square,
  X,
  RefreshCw,
  Sun,
  Moon,
  Contrast,
  DownloadCloud,
  CheckCircle2
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { toast } from '../state/toast-store';
import { DEFAULT_PRESET_MODELS } from '../../../preload/preset-models';
import type { AppInfo } from '../../../preload/types';

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties => ({ WebkitAppRegion: region } as React.CSSProperties);

export type AppTheme = 'dark' | 'light' | 'high-contrast';

export const TitleBar: React.FC = () => {
  const { workspacePath, setWorkspacePath, setFileTree } = useWorkspaceStore();
  const { settings, saveSettings, toggleSettings, toggleTerminal, isTerminalOpen } = useChatStore();

  const [theme, setTheme] = useState<AppTheme>(() => {
    return (localStorage.getItem('ty_claude_theme') as AppTheme) || 'dark';
  });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'>('idle');
  const [updatePercent, setUpdatePercent] = useState<number>(0);

  // Apply theme to body element
  useEffect(() => {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-high-contrast');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('ty_claude_theme', theme);
  }, [theme]);

  // Load app info and wait for an explicit user request before checking for updates.
  useEffect(() => {
    const savedChannel = localStorage.getItem('ty_code_update_channel');
    const channel = savedChannel === 'beta' || savedChannel === 'nightly' ? savedChannel : 'stable';
    void window.electronAPI?.setUpdateChannel?.(channel).catch((error) => console.warn('Could not restore the saved update channel:', error));
    void window.electronAPI?.getAppInfo?.().then((res) => {
      if (res?.success && res.data) setAppInfo(res.data);
    });

    const cleanupStatus = window.electronAPI?.onUpdateStatus?.((status) => {
      if (status.type === 'checking') setUpdateStatus('checking');
      else if (status.type === 'available') {
        setUpdateStatus('available');
        toast.info('New update available', `Version ${status.version || ''}`, {
          label: 'Download',
          onClick: () => { void window.electronAPI.downloadUpdate(); }
        });
      } else if (status.type === 'not-available') {
        setUpdateStatus('idle');
      } else if (status.type === 'downloaded') {
        setUpdateStatus('downloaded');
        toast.success('Update ready to install!', 'Restart Ty-Code to apply update.', {
          label: 'Restart Now',
          onClick: () => window.electronAPI.installUpdate()
        });
      } else if (status.type === 'error') {
        setUpdateStatus('idle');
        toast.error('Update check failed', status.error || 'The update service could not complete the request.');
      }
    });

    const cleanupProgress = window.electronAPI?.onUpdateProgress?.((progress) => {
      setUpdateStatus('downloading');
      setUpdatePercent(progress.percent || 0);
    });

    return () => {
      cleanupStatus?.();
      cleanupProgress?.();
    };
  }, []);

  const handleOpenFolder = async () => {
    try {
      const res = await window.electronAPI.selectWorkspaceFolder();
      if (res.success && res.data) {
        setWorkspacePath(res.data);
        const treeRes = await window.electronAPI.getWorkspaceTree(res.data);
        if (treeRes.success && treeRes.data) {
          setFileTree(treeRes.data);
          toast.success('Workspace opened', res.data);
        }
      }
    } catch (err) {
      toast.error('Failed to open folder', String(err));
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const model = DEFAULT_PRESET_MODELS.find((m) => m.id === selectedId);
    if (model) {
      saveSettings({
        activeModel: model.id,
        activeProvider: model.provider
      });
    }
  };

  const cycleTheme = () => {
    const next: AppTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'high-contrast' : 'dark';
    setTheme(next);
    toast.info(`Theme set to ${next}`);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res.error) {
        setUpdateStatus('idle');
        toast.error('Update check failed', res.error);
      } else if (res.updateAvailable) {
        // The update:available event owns the notification so a manual check never double-toasts.
        setUpdateStatus('available');
      } else {
        setUpdateStatus('idle');
        toast.success('Up to date', `Ty-Code v${res.currentVersion} is the latest version.`);
      }
    } catch (err) {
      setUpdateStatus('idle');
      toast.error('Update check failed', String(err));
    }
  };

  const folderName = workspacePath ? workspacePath.split(/[/\\]/).pop() : 'No Project Open';
  const isMac = appInfo?.platform === 'darwin';

  return (
    <header
      style={{
        height: '38px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMac ? '0 12px 0 78px' : '0 8px',
        userSelect: 'none',
        ...appRegion('drag')
      }}
    >
      {/* Left: App Title & Workspace */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...appRegion('no-drag') }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
          <Cpu size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '12px' }}>Ty-Code</span>
          {appInfo && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: '4px' }}>
              v{appInfo.version}
            </span>
          )}
        </div>

        <button
          onClick={handleOpenFolder}
          style={{
            background: 'var(--bg-tertiary)',
            padding: '3px 8px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer'
          }}
          title="Open Workspace Folder"
        >
          <FolderOpen size={13} />
          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {folderName}
          </span>
        </button>
      </div>

      {/* Center: Model Selector */}
      <div style={{ ...appRegion('no-drag'), display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Model:</div>
        <select
          value={settings?.activeModel || 'deepseek/deepseek-chat'}
          onChange={handleModelChange}
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {DEFAULT_PRESET_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.isFree ? '(Free)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Right: Actions, Updates, Theme & Window Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', ...appRegion('no-drag') }}>
        {/* Update Button / Indicator */}
        <button
          onClick={handleCheckUpdate}
          style={{
            padding: '4px 6px',
            color: updateStatus === 'available' ? 'var(--accent-green)' : updateStatus === 'downloaded' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title={
            updateStatus === 'checking'
              ? 'Checking for updates…'
              : updateStatus === 'downloading'
              ? `Downloading update (${updatePercent}%)…`
              : updateStatus === 'downloaded'
              ? 'Update downloaded! Restart to apply'
              : 'Check for Updates'
          }
        >
          {updateStatus === 'checking' ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : updateStatus === 'downloaded' ? (
            <CheckCircle2 size={13} color="var(--accent-green)" />
          ) : updateStatus === 'available' || updateStatus === 'downloading' ? (
            <DownloadCloud size={13} color="var(--accent-primary)" />
          ) : (
            <RefreshCw size={13} />
          )}
          {updateStatus === 'downloading' && (
            <span style={{ fontSize: '10px' }}>{updatePercent}%</span>
          )}
        </button>

        {/* Theme Cycler */}
        <button
          onClick={cycleTheme}
          style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}
          title={`Current Theme: ${theme}. Click to switch.`}
        >
          {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Contrast size={14} />}
        </button>

        <button
          onClick={toggleTerminal}
          style={{
            padding: '4px 6px',
            color: isTerminalOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
            background: isTerminalOpen ? 'var(--bg-hover)' : 'transparent'
          }}
          title="Toggle Terminal"
        >
          <Terminal size={14} />
        </button>

        <button
          onClick={toggleSettings}
          style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}
          title="Settings & API Keys"
        >
          <Settings size={14} />
        </button>

        {!isMac && (
          <>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 4px' }} />
            <button
              onClick={() => window.electronAPI.minimizeWindow()}
              style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}
              title="Minimize"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.electronAPI.maximizeWindow()}
              style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}
              title="Maximize"
            >
              <Square size={10} />
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}
              title="Close"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>
    </header>
  );
};
