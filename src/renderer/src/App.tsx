import React, { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityBar, type ActivityTab } from './components/ActivityBar';
import { Sidebar } from './components/Sidebar';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { EditorArea } from './components/EditorArea';
import { ChatSidecar } from './components/ChatSidecar';
import { TerminalDrawer } from './components/TerminalDrawer';
import { StatusBar } from './components/StatusBar';
import { QuickOpenModal } from './components/QuickOpenModal';
import { SettingsModal } from './components/SettingsModal';
import { useChatStore } from './state/chat-store';
import { useWorkspaceStore } from './state/workspace-store';

export const App: React.FC = () => {
  const [activityTab, setActivityTab] = useState<ActivityTab>('explorer');
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);

  const { initSettings, toggleTerminal } = useChatStore();
  const { setWorkspacePath, setFileTree } = useWorkspaceStore();

  useEffect(() => {
    initSettings();

    // Auto-load current workspace tree
    (async () => {
      try {
        const treeRes = await window.electronAPI.getWorkspaceTree('');
        if (treeRes.success && treeRes.data) {
          setWorkspacePath(treeRes.data.path);
          setFileTree(treeRes.data);
        }
      } catch (err) {
        console.error('Failed to load initial workspace:', err);
      }
    })();
  }, [initSettings, setWorkspacePath, setFileTree]);

  // Global Keyboard Shortcuts (Ctrl+P for Quick Open, Ctrl+` for Terminal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsQuickOpenOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminal]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)'
      }}
    >
      {/* Top Application Title Bar */}
      <TitleBar />

      {/* Main Workspace Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Leftmost Activity Bar */}
        <ActivityBar activeTab={activityTab} onTabChange={setActivityTab} />

        {/* Dynamic Primary Panel (Explorer / Extensions / Skills) */}
        {activityTab === 'explorer' && <Sidebar />}
        {activityTab === 'extensions' && <ExtensionsPanel />}
        {activityTab === 'skills' && <SkillsPanel />}

        {/* Central Monaco Editor Workspace */}
        <EditorArea />

        {/* Right AI Assistant Sidecar */}
        <ChatSidecar />
      </div>

      {/* Bottom Interactive Terminal Drawer */}
      <TerminalDrawer />

      {/* VS Code Style Status Bar */}
      <StatusBar />

      {/* Quick Open Modal (Ctrl+P) */}
      <QuickOpenModal
        isOpen={isQuickOpenOpen}
        onClose={() => setIsQuickOpenOpen(false)}
      />

      {/* Settings Modal */}
      <SettingsModal />
    </div>
  );
};
