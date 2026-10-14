import React, { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { EditorArea } from './components/EditorArea';
import { ChatSidecar } from './components/ChatSidecar';
import { TerminalDrawer } from './components/TerminalDrawer';
import { SettingsModal } from './components/SettingsModal';
import { useChatStore } from './state/chat-store';
import { useWorkspaceStore } from './state/workspace-store';

export const App: React.FC = () => {
  const { initSettings } = useChatStore();
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

      {/* Main Workspace Area (3-Column Layout) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar />
        <EditorArea />
        <ChatSidecar />
      </div>

      {/* Bottom Collapsible Terminal Drawer */}
      <TerminalDrawer />

      {/* Settings Modal */}
      <SettingsModal />
    </div>
  );
};
