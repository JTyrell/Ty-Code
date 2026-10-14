import React from 'react';
import {
  FolderOpen,
  Settings,
  Terminal,
  Cpu,
  Minus,
  Square,
  X
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { DEFAULT_PRESET_MODELS } from '../../../main/providers/provider-gateway';
import type { ProviderType } from '../../../preload/types';

export const TitleBar: React.FC = () => {
  const { workspacePath, setWorkspacePath, setFileTree } = useWorkspaceStore();
  const { settings, saveSettings, toggleSettings, toggleTerminal, isTerminalOpen } = useChatStore();

  const handleOpenFolder = async () => {
    try {
      const res = await window.electronAPI.selectWorkspaceFolder();
      if (res.success && res.data) {
        setWorkspacePath(res.data);
        const treeRes = await window.electronAPI.getWorkspaceTree(res.data);
        if (treeRes.success && treeRes.data) {
          setFileTree(treeRes.data);
        }
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
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

  const folderName = workspacePath ? workspacePath.split(/[/\\]/).pop() : 'No Project Open';

  return (
    <div
      style={{
        height: '38px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        userSelect: 'none',
        WebkitAppRegion: 'drag' as unknown as string
      }}
    >
      {/* Left: App Title & Workspace */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' as unknown as string }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
          <Cpu size={16} color="var(--accent-primary)" />
          <span>Ty-Claude</span>
        </div>

        <button
          onClick={handleOpenFolder}
          style={{
            background: 'var(--bg-tertiary)',
            padding: '3px 8px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px'
          }}
          title="Open Workspace Folder"
        >
          <FolderOpen size={13} />
          <span>{folderName}</span>
        </button>
      </div>

      {/* Center: Model Selector */}
      <div style={{ WebkitAppRegion: 'no-drag' as unknown as string, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Model:</div>
        <select
          value={settings?.activeModel || 'deepseek/deepseek-chat'}
          onChange={handleModelChange}
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            background: 'var(--bg-tertiary)',
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

      {/* Right: Actions & Window Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', WebkitAppRegion: 'no-drag' as unknown as string }}>
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
      </div>
    </div>
  );
};
