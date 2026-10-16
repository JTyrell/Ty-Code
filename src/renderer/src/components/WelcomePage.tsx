import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  FilePlus,
  GitBranch,
  Compass,
  Clock,
  Command,
  Trash2,
  Sparkles,
  Cpu
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { toast } from '../state/toast-store';
import { t } from '../services/i18n';
import type { RecentWorkspace } from '../../../preload/types';

interface WelcomePageProps {
  onStartTour?: () => void;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onStartTour }) => {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const { setWorkspacePath, setFileTree, openFile } = useWorkspaceStore();
  const { toggleTerminal } = useChatStore();

  const loadRecent = async () => {
    try {
      const res = await window.electronAPI.getRecentWorkspaces();
      if (res.success && res.data) {
        setRecentWorkspaces(res.data);
      }
    } catch {
      // Ignore in dev/test
    }
  };

  useEffect(() => {
    void loadRecent();
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
          void loadRecent();
        }
      }
    } catch (err) {
      toast.error('Could not open folder', String(err));
    }
  };

  const handleOpenRecent = async (folderPath: string) => {
    try {
      const res = await window.electronAPI.setWorkspaceFolder(folderPath);
      if (res.success && res.data) {
        setWorkspacePath(folderPath);
        setFileTree(res.data);
        toast.success('Workspace opened', folderPath);
        void loadRecent();
      } else {
        toast.error('Could not open folder', res.error || 'Folder may not exist');
      }
    } catch (err) {
      toast.error('Open error', String(err));
    }
  };

  const handleClearRecent = async () => {
    try {
      await window.electronAPI.clearRecentWorkspaces();
      setRecentWorkspaces([]);
      toast.info('Recent workspaces cleared');
    } catch {
      // Ignore
    }
  };

  const handleNewFile = async () => {
    openFile('untitled-1.ts', 'untitled-1.ts');
  };

  const handleCloneRepo = async () => {
    const { useExtensionPromptStore } = await import('../state/extension-prompt-store');
    const url = await useExtensionPromptStore.getState().requestInput('Enter Git repository URL (e.g. https://github.com/user/repo.git):');
    if (!url || !url.trim()) return;
    const cleanUrl = url.trim();
    toast.info('Cloning repository…', cleanUrl);
    try {
      const result = await window.electronAPI.runCommand({
        command: `git clone ${cleanUrl}`,
        timeoutMs: 60000
      });
      if (result.success && result.data?.exitCode === 0) {
        toast.success('Clone complete!', 'Open the cloned folder to begin.');
      } else {
        toast.error('Clone failed', result.data?.stderr || result.error);
      }
    } catch (err) {
      toast.error('Clone error', String(err));
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        padding: '40px 24px',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        userSelect: 'none'
      }}
    >
      <div style={{ maxWidth: '820px', width: '100%', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-cyan) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(139, 92, 246, 0.35)'
            }}
          >
            <Cpu size={28} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Ty-Code
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Desktop AI Coding Assistant &amp; High-Performance Monaco IDE
            </p>
          </div>
        </div>

        {/* 2-Column Grid: Quick Actions + Recent Projects */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
          {/* Start Section */}
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              {t('welcome.quickStart')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                onClick={handleOpenFolder}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <FolderOpen size={16} color="var(--accent-primary)" />
                <span>Open Workspace Folder…</span>
              </button>
              <button
                onClick={handleNewFile}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <FilePlus size={16} color="var(--accent-cyan)" />
                <span>New Scratch File</span>
              </button>
              <button
                onClick={handleCloneRepo}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <GitBranch size={16} color="var(--accent-green)" />
                <span>Clone Git Repository…</span>
              </button>
              {onStartTour && (
                <button
                  onClick={onStartTour}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Compass size={16} color="var(--accent-amber)" />
                  <span>Take Interactive Feature Tour</span>
                </button>
              )}
            </div>
          </div>

          {/* Recent Workspaces Section */}
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                {t('welcome.recentWorkspaces')}
              </div>
              {recentWorkspaces.length > 0 && (
                <button
                  onClick={handleClearRecent}
                  title="Clear recent projects list"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Trash2 size={11} /> Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
              {recentWorkspaces.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '16px 0', textAlign: 'center' }}>
                  No recent workspaces yet
                </div>
              ) : (
                recentWorkspaces.map((ws) => (
                  <button
                    key={ws.path}
                    onClick={() => handleOpenRecent(ws.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Clock size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ws.name}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                      {ws.path}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts Cheatsheet */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            <Command size={13} />
            <span>Essential Keyboard Shortcuts</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Command Palette</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+Shift+P</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Quick Open File</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+P</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Toggle Terminal</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+`</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Find in Workspace</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+Shift+F</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Source Control (Git)</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+Shift+G</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Split Editor Pane</span>
              <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-strong)', color: 'var(--accent-primary)' }}>Ctrl+\</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
