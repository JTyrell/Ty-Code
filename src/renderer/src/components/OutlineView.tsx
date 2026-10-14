import React, { useState, useEffect } from 'react';
import {
  ListTree,
  ChevronRight,
  ChevronDown,
  Box,
  Braces,
  Variable,
  FunctionSquare,
  FileCode,
  Search,
  RefreshCw
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';

export interface DocumentSymbolNode {
  name: string;
  detail?: string;
  kind: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  selectionRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: DocumentSymbolNode[];
}

interface OutlineViewProps {
  onNavigateToLine?: (line: number) => void;
}

function getSymbolIcon(kind: number) {
  switch (kind) {
    case 5: // Class
    case 22: // Struct
      return <Box size={13} color="var(--accent-amber)" />;
    case 6: // Method
    case 12: // Function
      return <FunctionSquare size={13} color="var(--accent-primary)" />;
    case 11: // Interface
      return <Braces size={13} color="var(--accent-cyan)" />;
    case 7: // Property
    case 8: // Field
    case 13: // Variable
    case 14: // Constant
      return <Variable size={13} color="var(--accent-green)" />;
    default:
      return <FileCode size={13} color="var(--text-muted)" />;
  }
}

export const OutlineView: React.FC<OutlineViewProps> = ({ onNavigateToLine }) => {
  const { activeTabPath, openTabs } = useWorkspaceStore();
  const [symbols, setSymbols] = useState<DocumentSymbolNode[]>([]);
  const [filter, setFilter] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  const fetchSymbols = async () => {
    if (!activeTabPath || !window.electronAPI) {
      setSymbols([]);
      return;
    }

    setIsLoading(true);
    try {
      const res = await window.electronAPI.lspDocumentSymbols({ filePath: activeTabPath });
      if (res.success && Array.isArray(res.data)) {
        setSymbols(res.data);
      } else {
        // Fallback: parse basic JS/TS/Python symbols from content if LSP unavailable
        if (activeTab?.content) {
          const lines = activeTab.content.split('\n');
          const basicSymbols: DocumentSymbolNode[] = [];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fnMatch = line.match(/(?:function|const|let|var|class|interface|type|def)\s+([a-zA-Z0-9_$]+)/);
            if (fnMatch) {
              const kind = line.includes('class') ? 5 : line.includes('interface') ? 11 : line.includes('function') || line.includes('def') ? 12 : 13;
              basicSymbols.push({
                name: fnMatch[1],
                detail: line.trim(),
                kind,
                range: {
                  start: { line: i, character: 0 },
                  end: { line: i, character: line.length }
                }
              });
            }
          }
          setSymbols(basicSymbols);
        } else {
          setSymbols([]);
        }
      }
    } catch {
      setSymbols([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSymbols();
  }, [activeTabPath, activeTab?.content]);

  const toggleCollapse = (nodeKey: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [nodeKey]: !prev[nodeKey] }));
  };

  const handleSelectSymbol = (node: DocumentSymbolNode) => {
    const line = (node.selectionRange?.start.line ?? node.range.start.line) + 1;
    onNavigateToLine?.(line);
  };

  const filterSymbols = (nodes: DocumentSymbolNode[]): DocumentSymbolNode[] => {
    if (!filter.trim()) return nodes;
    const q = filter.toLowerCase();

    return nodes.filter((n) => {
      const nameMatch = n.name.toLowerCase().includes(q) || (n.detail && n.detail.toLowerCase().includes(q));
      const childMatches = n.children && filterSymbols(n.children).length > 0;
      return nameMatch || childMatches;
    });
  };

  const renderSymbolNode = (node: DocumentSymbolNode, depth = 0, keyPrefix = '') => {
    const key = `${keyPrefix}_${node.name}_${node.range.start.line}`;
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isCollapsed = Boolean(collapsedNodes[key]);

    return (
      <div key={key}>
        <div
          onClick={() => handleSelectSymbol(node)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 8px',
            paddingLeft: `${depth * 14 + 8}px`,
            cursor: 'pointer',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--text-secondary)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title={`${node.name} (Line ${node.range.start.line + 1})`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
            {hasChildren ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(key);
                }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {isCollapsed ? <ChevronRight size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
              </span>
            ) : (
              <span style={{ width: '12px' }} />
            )}

            {getSymbolIcon(node.kind)}

            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
          </div>

          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
            :{node.range.start.line + 1}
          </span>
        </div>

        {hasChildren && !isCollapsed && (
          <div>
            {node.children!.map((child) => renderSymbolNode(child, depth + 1, key))}
          </div>
        )}
      </div>
    );
  };

  const filtered = filterSymbols(symbols);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-secondary)',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Outline Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ListTree size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            Outline
          </span>
        </div>

        <button
          onClick={fetchSymbols}
          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-muted)' }}
          title="Refresh Outline"
        >
          <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
        </button>
      </div>

      {/* Symbol Filter Input */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'var(--bg-tertiary)',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <Search size={12} color="var(--text-muted)" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter symbols by name..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              fontSize: '11px',
              outline: 'none',
              color: 'var(--text-primary)'
            }}
          />
        </div>
      </div>

      {/* Symbols Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {!activeTab ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            Open a file to view its outline symbols.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            No symbols found in this file.
          </div>
        ) : (
          filtered.map((node) => renderSymbolNode(node))
        )}
      </div>
    </div>
  );
};
