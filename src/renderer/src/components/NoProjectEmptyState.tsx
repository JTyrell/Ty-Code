import React, { useState } from 'react';
import { FolderOpen, History, ChevronDown, ChevronRight } from 'lucide-react';
import type { RecentWorkspace } from '../../../preload/types';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';

interface NoProjectEmptyStateProps {
  hint: string;
}

export const NoProjectEmptyState: React.FC<NoProjectEmptyStateProps> = ({ hint }) => {
  const setWorkspacePath = useWorkspaceStore((s) => s.setWorkspacePath);
  const setFileTree = useWorkspaceStore((s) => s.setFileTree);

  const [showRecents, setShowRecents] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);

  // Open a folder via the native directory picker, then load its file tree.
  const handleOpenFolder = async () => {
    try {
      const res = await window.electronAPI.selectWorkspaceFolder();
      if (res.success && res.data) {
        setWorkspacePath(res.data);
        const treeRes = await window.electronAPI.getWorkspaceTree(res.data);
        if (treeRes.success && treeRes.data) {
          setFileTree(treeRes.data);
          toast.success('Workspace opened', res.data);
        } else {
          toast.warning('Folder selected', treeRes.error || 'Could not load the file tree.');
        }
      }
    } catch (err) {
      toast.error('Failed to open folder', String(err));
    }
  };

  // Load a previously opened workspace from the recents list.
  const handleOpenRecent = async (recent: RecentWorkspace) => {
    try {
      const res = await window.electronAPI.setWorkspaceFolder(recent.path);
      if (res.success && res.data) {
        setWorkspacePath(recent.path);
        setFileTree(res.data);
        toast.success('Workspace opened', recent.name || recent.path);
      } else {
        toast.error('Could not open workspace', res.error);
      }
    } catch (err) {
      toast.error('Failed to open workspace', String(err));
    }
  };

  const toggleRecents = async () => {
    setShowRecents((prev) => !prev);
    if (!recentsLoaded) {
      try {
        const res = await window.electronAPI.getRecentWorkspaces();
        if (res.success && res.data) setRecentWorkspaces(res.data);
      } catch {
        toast.error('Failed to load recent workspaces');
      }
      setRecentsLoaded(true);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px 16px',
        gap: 12,
        textAlign: 'center',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-secondary)'
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: 'rgba(99, 102, 241, 0.12)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#818cf8'
        }}
      >
        <FolderOpen size={20} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6' }}>No project loaded</div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', lineHeight: 1.5, maxWidth: 220 }}>
        {hint}
      </div>

      <button
        type="button"
        onClick={() => void handleOpenFolder()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--accent-primary, #6366f1)',
          color: '#ffffff',
          border: 'none',
          borderRadius: 6,
          padding: '7px 14px',
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        <FolderOpen size={13} />
        <span>Open Folder</span>
      </button>

      <button
        type="button"
        onClick={() => void toggleRecents()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          color: '#9ca3af',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        <History size={12} />
        <span>Open Recent</span>
        {showRecents ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {showRecents && (
        <div
          style={{
            width: '100%',
            maxHeight: 180,
            overflowY: 'auto',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          {recentWorkspaces.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 11, color: '#6b7280', textAlign: 'left' }}>
              No recent workspaces found
            </div>
          ) : (
            recentWorkspaces.map((recent) => (
              <button
                key={recent.path}
                type="button"
                onClick={() => void handleOpenRecent(recent)}
                title={recent.path}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  padding: '8px 12px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#e5e7eb' }}>{recent.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {recent.path}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
