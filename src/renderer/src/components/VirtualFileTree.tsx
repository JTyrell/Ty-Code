import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FilePlus,
  FolderPlus,
  Edit2,
  Trash2,
  Copy,
  FolderSync
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import type { FileNode } from '../../../preload/types';

export interface FlatFileNode {
  node: FileNode;
  depth: number;
  isOpen: boolean;
  hasChildren: boolean;
}

const ITEM_HEIGHT = 24;
const OVERSCAN = 6;

interface VirtualFileTreeProps {
  rootNode: FileNode | null;
  onRefresh?: () => void;
}

export const VirtualFileTree: React.FC<VirtualFileTreeProps> = ({ rootNode, onRefresh }) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [editingNode, setEditingNode] = useState<{ node: FileNode; isNew?: boolean; isDir?: boolean } | null>(null);
  const [editName, setEditName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);

  // Initialize with root expanded
  useEffect(() => {
    if (rootNode) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(rootNode.path);
        return next;
      });
    }
  }, [rootNode]);

  // Track container height via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Flatten the tree for virtualization based on expanded state
  const flatList: FlatFileNode[] = useMemo(() => {
    if (!rootNode) return [];

    const result: FlatFileNode[] = [];

    const traverse = (node: FileNode, depth: number) => {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isOpen = expandedPaths.has(node.path);

      // Do not add root if it is just workspace container, or add it with depth 0
      result.push({
        node,
        depth,
        isOpen,
        hasChildren
      });

      if (node.isDirectory && isOpen && node.children) {
        // Sort directories first, then alphabetical
        const sorted = [...node.children].sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        });

        for (const child of sorted) {
          traverse(child, depth + 1);
        }
      }
    };

    if (rootNode.children) {
      for (const child of rootNode.children) {
        traverse(child, 0);
      }
    } else {
      traverse(rootNode, 0);
    }

    return result;
  }, [rootNode, expandedPaths]);

  const totalHeight = flatList.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(flatList.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN);
  const visibleNodes = flatList.slice(startIndex, endIndex);

  const toggleFolder = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleNodeClick = (flatNode: FlatFileNode) => {
    if (flatNode.node.isDirectory) {
      toggleFolder(flatNode.node.path);
    } else {
      openFile(flatNode.node.path, flatNode.node.name);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 200),
      node
    });
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
        return <FileCode size={13} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />;
      default:
        return <FileText size={13} color="var(--text-secondary)" style={{ flexShrink: 0 }} />;
    }
  };

  // Actions
  const handleCopyPath = async (relative = false) => {
    if (!contextMenu) return;
    const text = relative ? contextMenu.node.relativePath : contextMenu.node.path;
    await navigator.clipboard.writeText(text);
    toast.success('Path copied to clipboard', text);
    setContextMenu(null);
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const target = contextMenu.node;
    setContextMenu(null);
    toast.warning(`Delete "${target.name}"?`, 'This will permanently remove the item from your filesystem.', {
      label: 'Delete',
      onClick: async () => {
        try {
          const res = await window.electronAPI.deletePath(target.path);
          if (res.success) {
            toast.success('Deleted', target.name);
            onRefresh?.();
          } else {
            toast.error('Delete failed', res.error);
          }
        } catch (err) {
          toast.error('Delete error', String(err));
        }
      }
    });
  };

  // Drag and drop support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = window.electronAPI.getFilePathForDroppedFile(file);
        if (filePath) {
          openFile(filePath, file.name);
          toast.info('Opened file', file.name);
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--bg-secondary)',
        scrollbarWidth: 'thin'
      }}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}>
        <div
          style={{
            transform: `translateY(${startIndex * ITEM_HEIGHT}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0
          }}
        >
          {visibleNodes.map((item) => {
            const isSelected = activeTabPath === item.node.path;
            return (
              <div
                key={item.node.path}
                onClick={() => handleNodeClick(item)}
                onContextMenu={(e) => handleContextMenu(e, item.node)}
                title={`${item.node.name} (${item.node.relativePath})`}
                style={{
                  height: `${ITEM_HEIGHT}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  paddingLeft: `${item.depth * 14 + 8}px`,
                  paddingRight: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.node.isDirectory ? (
                  <>
                    <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {item.isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    {item.isOpen ? (
                      <FolderOpen size={13} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                    ) : (
                      <Folder size={13} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                    )}
                  </>
                ) : (
                  <>
                    <span style={{ width: 14 }} />
                    {getFileIcon(item.node.extension)}
                  </>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.node.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 99999,
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-strong)',
            borderRadius: '6px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            padding: '4px',
            minWidth: '170px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleCopyPath(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <Copy size={12} />
            Copy Full Path
          </button>
          <button
            onClick={() => handleCopyPath(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <Copy size={12} />
            Copy Relative Path
          </button>
          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '3px 0' }} />
          <button
            onClick={handleDelete}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--accent-red)',
              borderRadius: '4px',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
