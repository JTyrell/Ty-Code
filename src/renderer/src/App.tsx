import React, { useEffect, useState, useRef } from 'react';
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

  // Resizable Sidebars State
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(380);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

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

  // Handle Left Sidebar Resizing
  const handleLeftMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
    const startX = e.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(550, startWidth + delta));
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Handle Right Sidebar (AI Chat) Resizing
  const handleRightMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
    const startX = e.clientX;
    const startWidth = rightWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Dragging leftwards increases the width of the right sidebar
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(280, Math.min(750, startWidth + delta));
      setRightWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingRight(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

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

      {/* Main Workspace Area (3-Column Layout with Resizers) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Leftmost Activity Bar */}
        <ActivityBar activeTab={activityTab} onTabChange={setActivityTab} />

        {/* Dynamic Primary Left Panel (Explorer / Extensions / Skills) */}
        <div style={{ width: `${leftWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          {activityTab === 'explorer' && <Sidebar />}
          {activityTab === 'extensions' && <ExtensionsPanel />}
          {activityTab === 'skills' && <SkillsPanel />}
        </div>

        {/* Left Splitter Resizer Handle */}
        <div
          className={`resizer-col ${isDraggingLeft ? 'dragging' : ''}`}
          onMouseDown={handleLeftMouseDown}
          title="Drag to resize sidebar"
        />

        {/* Central Monaco Editor Workspace */}
        <div style={{ flex: 1, height: '100%', minWidth: 200, overflow: 'hidden' }}>
          <EditorArea />
        </div>

        {/* Right Splitter Resizer Handle */}
        <div
          className={`resizer-col ${isDraggingRight ? 'dragging' : ''}`}
          onMouseDown={handleRightMouseDown}
          title="Drag to resize assistant panel"
        />

        {/* Right AI Assistant Sidecar */}
        <div style={{ width: `${rightWidth}px`, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
          <ChatSidecar />
        </div>
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
