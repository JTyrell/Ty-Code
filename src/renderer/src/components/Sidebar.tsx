import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  RefreshCw,
  Plus,
  FolderPlus
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import type { FileNode } from '../../../preload/types';

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, depth }) => {
  const [isOpen, setIsOpen] = useState(depth === 0);
  const { openFile, activeTabPath } = useWorkspaceStore();

  const isSelected = activeTabPath === node.path;

  const handleClick = () => {
    if (node.isDirectory) {
      setIsOpen(!isOpen);
    } else {
      openFile(node.path, node.name);
    }
  };

  const getFileIcon = (ext?: string) => {
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
      case '.py':
      case '.html':
      case '.css':
      case '.json':
        return <FileCode size={14} color="var(--accent-cyan)" />;
      default:
        return <FileText size={14} color="var(--text-secondary)" />;
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          paddingLeft: `${depth * 14 + 8}px`,
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
          color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
          borderRadius: '3px',
          fontSize: '12px'
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {node.isDirectory ? (
          <>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? (
              <FolderOpen size={14} color="var(--accent-primary)" />
            ) : (
              <Folder size={14} color="var(--accent-primary)" />
            )}
          </>
        ) : (
          <>
            <span style={{ width: '14px', display: 'inline-block' }} />
            {getFileIcon(node.extension)}
          </>
        )}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>
      </div>

      {node.isDirectory && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const { fileTree, refreshFileTree, workspacePath } = useWorkspaceStore();

  const handleCreateFile = async () => {
    if (!workspacePath) return;
    const fileName = prompt('Enter new file name (relative to workspace):');
    if (fileName) {
      const fullPath = `${workspacePath}/${fileName}`.replace(/\/+/g, '/');
      await window.electronAPI.createFile(fullPath);
      await refreshFileTree();
    }
  };

  const handleCreateFolder = async () => {
    if (!workspacePath) return;
    const folderName = prompt('Enter new folder name (relative to workspace):');
    if (folderName) {
      const fullPath = `${workspacePath}/${folderName}`.replace(/\/+/g, '/');
      await window.electronAPI.createDirectory(fullPath);
      await refreshFileTree();
    }
  };

  return (
    <div
      style={{
        width: '240px',
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
          <button onClick={handleCreateFile} title="New File" style={{ padding: '3px' }}>
            <Plus size={13} />
          </button>
          <button onClick={handleCreateFolder} title="New Folder" style={{ padding: '3px' }}>
            <FolderPlus size={13} />
          </button>
          <button onClick={refreshFileTree} title="Refresh Explorer" style={{ padding: '3px' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Directory Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {fileTree ? (
          fileTree.children && fileTree.children.length > 0 ? (
            fileTree.children.map((child) => (
              <FileTreeItem key={child.path} node={child} depth={0} />
            ))
          ) : (
            <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>
              Directory is empty.
            </div>
          )
        ) : (
          <div style={{ padding: '24px 16px', color: 'var(--text-muted)', textAlign: 'center' }}>
            No workspace folder opened.
          </div>
        )}
      </div>
    </div>
  );
};
