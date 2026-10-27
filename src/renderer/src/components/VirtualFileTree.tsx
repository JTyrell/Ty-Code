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
import type { FileNode, FlatFileNodeEntry } from '../../../preload/types';

export interface FlatFileNode {
  node: FileNode;
  depth: number;
  isOpen: boolean;
  hasChildren: boolean;
}

const ITEM_HEIGHT = 24;
const OVERSCAN = 6;

interface TreeRowProps {
  path: string;
  name: string;
  depth: number;
  isDirectory: boolean;
  isOpen: boolean;
  isSelected: boolean;
  extension?: string;
  relativePath: string;
  onNodeClick: (node: FileNode) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}

/**
 * Memoized tree row: virtualization re-renders on every range shift, so each
 * row must be skip-able unless its own primitives change.
 */
const TreeRow = React.memo<TreeRowProps>(({
  path,
  name,
  depth,
  isDirectory,
  isOpen,
  isSelected,
  extension,
  relativePath,
  onNodeClick,
  onNodeContextMenu
}) => {
  const node: FileNode = {
    name,
    path,
    relativePath,
    isDirectory,
    extension
  };
  return (
    <div
      className="virtual-tree-row"
      draggable={!isDirectory}
      onDragStart={isDirectory
        ? undefined
        : (event) => {
            event.dataTransfer.setData('application/x-ty-code-file-path', path);
            event.dataTransfer.effectAllowed = 'copy';
          }}
      onClick={() => onNodeClick(node)}
      onContextMenu={(e) => onNodeContextMenu(e, node)}
      title={`${name} (${relativePath})`}
      style={{
        height: `${ITEM_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        paddingLeft: `${depth * 14 + 8}px`,
        paddingRight: '8px',
        cursor: 'pointer',
        fontSize: '12px',
        backgroundColor: isSelected ? 'var(--bg-active)' : undefined,
        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {isDirectory ? (
        <>
          <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {isOpen ? (
            <FolderOpen size={13} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          ) : (
            <Folder size={13} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          )}
        </>
      ) : (
        <>
          <span style={{ width: 14 }} />
          <TreeFileIcon extension={extension} />
        </>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </div>
  );
});

const TreeFileIcon = React.memo<{ extension?: string }>(({ extension }) => {
  switch (extension) {
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
});

interface VirtualFileTreeProps {
  rootNode?: FileNode | null;
  flatEntries?: FlatFileNodeEntry[] | null;
  onRefresh?: () => void;
}

export const VirtualFileTree: React.FC<VirtualFileTreeProps> = ({ rootNode, flatEntries, onRefresh }) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [editingNode, setEditingNode] = useState<{ node: FileNode; isNew?: boolean; isDir?: boolean } | null>(null);
  const [editName, setEditName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollTopRef = useRef(0);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const storeFlatTree = useWorkspaceStore((s) => s.flatTree);
  const activeFlat = flatEntries || storeFlatTree;

  /**
   * Scroll updates are rAF-coalesced and only trigger a re-render when the
   * visible range would actually shift — continuous wheel events no longer
   * re-render the whole tree 60 times per second.
   */
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const top = scrollTopRef.current;
      const nextStart = Math.max(0, Math.floor(top / ITEM_HEIGHT) - OVERSCAN);
      setScrollTop((prev) => {
        const prevStart = Math.max(0, Math.floor(prev / ITEM_HEIGHT) - OVERSCAN);
        if (prev === top && prevStart === nextStart) return prev;
        return top;
      });
    });
  }, []);

  // Initialize with root expanded
  useEffect(() => {
    if (activeFlat && activeFlat[0]) {
      setExpandedPaths((prev) => new Set(prev).add(activeFlat[0].path));
    } else if (rootNode) {
      setExpandedPaths((prev) => new Set(prev).add(rootNode.path));
    }
  }, [rootNode, activeFlat]);

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
    // 1. High-speed flat array virtualization (O(N) single pass, no recursive nesting overhead)
    if (activeFlat && activeFlat.length > 0) {
      const result: FlatFileNode[] = [];
      const expandedDirPaths = new Set(expandedPaths);
      if (activeFlat[0]) expandedDirPaths.add(activeFlat[0].path);

      for (let i = 0; i < activeFlat.length; i++) {
        const item = activeFlat[i];
        if (item.depth > 1) {
          const sepMatch = /[/\\]/.exec(item.path);
          const sep = sepMatch ? sepMatch[0] : '/';
          const parentPath = item.path.substring(0, item.path.lastIndexOf(sep));
          if (!expandedDirPaths.has(parentPath)) {
            continue;
          }
        }

        const isDir = item.isDirectory || item.type === 'directory';
        const isOpen = expandedDirPaths.has(item.path);
        const node: FileNode = {
          name: item.name,
          path: item.path,
          relativePath: item.relativePath || '',
          isDirectory: isDir,
          size: item.size,
          extension: item.extension
        };

        result.push({
          node,
          depth: item.depth,
          isOpen,
          hasChildren: isDir
        });
      }
      return result;
    }

    // 2. Fallback to tree traversal if flat array not yet populated
    if (!rootNode) return [];

    const result: FlatFileNode[] = [];

    const traverse = (node: FileNode, depth: number) => {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isOpen = expandedPaths.has(node.path);

      result.push({
        node,
        depth,
        isOpen,
        hasChildren
      });

      if (node.isDirectory && isOpen && node.children) {
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
  }, [rootNode, activeFlat, expandedPaths]);

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

  const handleNodeClick = (node: FileNode) => {
    if (node.isDirectory) {
      toggleFolder(node.path);
    } else {
      openFile(node.path, node.name);
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
      onScroll={handleScroll}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--bg-secondary)',
        scrollbarWidth: 'thin',
        overscrollBehavior: 'contain'
      }}
    >
      <div
        style={{
          height: `${totalHeight}px`,
          position: 'relative',
          width: '100%',
          contain: 'layout paint'
        }}
      >
        <div
          style={{
            transform: `translateY(${startIndex * ITEM_HEIGHT}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            willChange: 'transform'
          }}
        >
          {visibleNodes.map((item) => (
            <TreeRow
              key={item.node.path}
              path={item.node.path}
              name={item.node.name}
              depth={item.depth}
              isDirectory={item.node.isDirectory ?? false}
              isOpen={item.isOpen}
              isSelected={activeTabPath === item.node.path}
              extension={item.node.extension}
              relativePath={item.node.relativePath || ''}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleContextMenu}
            />
          ))}
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
            zIndex: 'var(--layer-menu)',
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
