import {
  Files,
  Boxes,
  Sparkles,
  GitBranch,
  Settings,
  Terminal,
  Search,
  ListTree
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useGitStore } from '../state/git-store';

export type ActivityTab = 'explorer' | 'search' | 'source-control' | 'extensions' | 'skills' | 'outline';

interface ActivityBarProps {
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeTab, onTabChange }) => {
  const { toggleSettings, toggleTerminal, isTerminalOpen } = useChatStore();
  const { status } = useGitStore();

  const totalChanges =
    (status?.stagedFiles.length || 0) +
    (status?.unstagedFiles.length || 0) +
    (status?.untrackedFiles.length || 0) +
    (status?.conflictedFiles.length || 0);

  const navItems: Array<{ id: ActivityTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'explorer', label: 'File Explorer (Ctrl+Shift+E)', icon: <Files size={18} /> },
    { id: 'search', label: 'Search in Files (Ctrl+Shift+F)', icon: <Search size={18} /> },
    {
      id: 'source-control',
      label: `Source Control (Ctrl+Shift+G)${totalChanges > 0 ? ` (${totalChanges} changes)` : ''}`,
      icon: <GitBranch size={18} />,
      badge: totalChanges > 0 ? totalChanges : undefined
    },
    { id: 'extensions', label: 'Extensions', icon: <Boxes size={18} /> },
    { id: 'skills', label: 'Capabilities', icon: <Sparkles size={18} /> },
    { id: 'outline', label: 'Document Outline', icon: <ListTree size={18} /> }
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
            <div key={item.id} style={{ position: 'relative' }}>
              <button
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

              {item.badge !== undefined && (
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    backgroundColor: 'var(--accent-primary)',
                    color: '#fff',
                    borderRadius: '10px',
                    fontSize: '9px',
                    fontWeight: 700,
                    minWidth: '15px',
                    height: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    pointerEvents: 'none'
                  }}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
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
