import {
  Files,
  Boxes,
  Sparkles,
  GitBranch,
  Settings,
  Terminal,
  Search,
  ListTree,
  Palette
} from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useGitStore } from '../state/git-store';

import React, { useRef, useCallback } from 'react';
import { FileCheck } from 'lucide-react';

export type ActivityTab = 'explorer' | 'search' | 'source-control' | 'code-review' | 'extensions' | 'skills' | 'outline' | 'ui-sketcher';

interface ActivityBarProps {
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  isLeftPanelOpen?: boolean;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeTab, onTabChange, isLeftPanelOpen = true }) => {
  // Zustand selector audit: subscribe to narrow slices only
  const toggleSettings = useChatStore((s) => s.toggleSettings);
  const toggleTerminal = useChatStore((s) => s.toggleTerminal);
  const isTerminalOpen = useChatStore((s) => s.isTerminalOpen);
  const status = useGitStore((s) => s.status);

  // Prefetch on intent: hover/focus for 150ms triggers dynamic import during idle
  const prefetchTimerRef = useRef<number | null>(null);

  const prefetchPanel = useCallback((id: string) => {
    switch (id) {
      case 'extensions':
        void import('./ExtensionsPanel');
        break;
      case 'code-review':
        void import('./CodeReviewPanel');
        break;
      case 'ui-sketcher':
        void import('./CanvasWebview');
        break;
      case 'settings':
        void import('./SettingsModal');
        break;
      case 'terminal':
        void import('./TerminalDrawer');
        break;
      default:
        break;
    }
  }, []);

  const handleIntentStart = useCallback((id: string) => {
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current);
    }
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null;
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => prefetchPanel(id));
      } else {
        setTimeout(() => prefetchPanel(id), 32);
      }
    }, 150);
  }, [prefetchPanel]);

  const handleIntentCancel = useCallback(() => {
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

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
    { id: 'code-review', label: 'AI Code Review', icon: <FileCheck size={18} /> },
    { id: 'ui-sketcher', label: 'UI Sketcher', icon: <Palette size={18} /> },
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
          const isActive = isLeftPanelOpen && activeTab === item.id && item.id !== 'ui-sketcher';
          return (
            <div key={item.id} style={{ position: 'relative' }}>
              <button
                onClick={() => onTabChange(item.id)}
                onPointerEnter={() => handleIntentStart(item.id)}
                onPointerLeave={handleIntentCancel}
                onFocus={() => handleIntentStart(item.id)}
                onBlur={handleIntentCancel}
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
          onPointerEnter={() => handleIntentStart('terminal')}
          onPointerLeave={handleIntentCancel}
          onFocus={() => handleIntentStart('terminal')}
          onBlur={handleIntentCancel}
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
          onPointerEnter={() => handleIntentStart('settings')}
          onPointerLeave={handleIntentCancel}
          onFocus={() => handleIntentStart('settings')}
          onBlur={handleIntentCancel}
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
