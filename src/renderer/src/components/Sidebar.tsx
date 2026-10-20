import React from 'react';
import { RefreshCw, Plus, FolderPlus } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { VirtualFileTree } from './VirtualFileTree';
import { NoProjectEmptyState } from './NoProjectEmptyState';
import { toast } from '../state/toast-store';

import { useExtensionPromptStore } from '../state/extension-prompt-store';

export const Sidebar: React.FC = () => {
  const fileTree = useWorkspaceStore((s) => s.fileTree);
  const flatTree = useWorkspaceStore((s) => s.flatTree);
  const refreshFileTree = useWorkspaceStore((s) => s.refreshFileTree);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const handleCreateFile = async () => {
    if (!workspacePath) {
      toast.warning('No workspace open', 'Please open a folder first.');
      return;
    }
    const fileName = await useExtensionPromptStore.getState().requestInput('Enter new file name (relative to workspace):');
    if (fileName && fileName.trim()) {
      const fullPath = `${workspacePath}/${fileName.trim()}`.replace(/\/+/g, '/');
      try {
        const res = await window.electronAPI.createFile(fullPath);
        if (res.success) {
          toast.success('File created', fileName.trim());
          await refreshFileTree();
        } else {
          toast.error('Could not create file', res.error);
        }
      } catch (err) {
        toast.error('Create error', String(err));
      }
    }
  };

  const handleCreateFolder = async () => {
    if (!workspacePath) {
      toast.warning('No workspace open', 'Please open a folder first.');
      return;
    }
    const folderName = await useExtensionPromptStore.getState().requestInput('Enter new folder name (relative to workspace):');
    if (folderName && folderName.trim()) {
      const fullPath = `${workspacePath}/${folderName.trim()}`.replace(/\/+/g, '/');
      try {
        const res = await window.electronAPI.createDirectory(fullPath);
        if (res.success) {
          toast.success('Folder created', folderName.trim());
          await refreshFileTree();
        } else {
          toast.error('Could not create folder', res.error);
        }
      } catch (err) {
        toast.error('Create error', String(err));
      }
    }
  };

  // Open folder / recents logic now lives in NoProjectEmptyState.

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Sidebar Header */}
      <div
        style={{
          height: '35px',
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <span>Explorer</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button onClick={handleCreateFile} title="New File" aria-label="New File" style={{ padding: '3px' }}>
            <Plus size={13} />
          </button>
          <button onClick={handleCreateFolder} title="New Folder" aria-label="New Folder" style={{ padding: '3px' }}>
            <FolderPlus size={13} />
          </button>
          <button onClick={refreshFileTree} title="Refresh Explorer" aria-label="Refresh Explorer" style={{ padding: '3px' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Directory Tree with Virtual Scrolling */}
      {fileTree || flatTree ? (
        <VirtualFileTree rootNode={fileTree} flatEntries={flatTree} onRefresh={refreshFileTree} />
      ) : (
        <NoProjectEmptyState hint="The Explorer stays closed until you choose a folder. Pick one to browse your files." />
      )}
    </div>
  );
};
