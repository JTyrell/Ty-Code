import React from 'react';
import {
  Files,
  Boxes,
  Sparkles,
  GitBranch,
  Settings,
  Terminal
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';

export type ActivityTab = 'explorer' | 'extensions' | 'skills';

interface ActivityBarProps {
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeTab, onTabChange }) => {
  const { toggleSettings, toggleTerminal, isTerminalOpen } = useChatStore();

  const navItems: Array<{ id: ActivityTab; label: string; icon: React.ReactNode }> = [
    { id: 'explorer', label: 'File Explorer (Ctrl+Shift+E)', icon: <Files size={18} /> },
    { id: 'extensions', label: 'VS Code Extensions (Open VSX)', icon: <Boxes size={18} /> },
    { id: 'skills', label: 'Antigravity Skills & Capabilities', icon: <Sparkles size={18} /> }
  ];

  return (
    <div
      style={{
        width: '46px',
        height: '100%',
        backgroundColor: '#18191e',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        zIndex: 5
      }}
    >
      {/* Top Main Navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '6px',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent'
              }}
              title={item.label}
            >
              {item.icon}
            </button>
          );
        })}
      </div>

      {/* Bottom Utility Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
        <button
          onClick={toggleTerminal}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '6px',
            color: isTerminalOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
            backgroundColor: isTerminalOpen ? 'var(--bg-tertiary)' : 'transparent'
          }}
          title="Toggle Terminal (Ctrl+`)"
        >
          <Terminal size={18} />
        </button>

        <button
          onClick={toggleSettings}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '6px',
            color: 'var(--text-secondary)'
          }}
          title="Settings & API Keys"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};
