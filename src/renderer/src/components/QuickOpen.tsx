import React, { useState, useEffect, useRef } from 'react';
import { Search, FileCode, Hash, AtSign, ChevronRight } from 'lucide-react';
import { ensureMonaco, useMonacoRuntime } from '../services/monaco-runtime';
import { useWorkspaceStore } from '../state/workspace-store';
import { useEditorNavigationStore } from '../state/editor-navigation-store';

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToCommandPalette?: () => void;
  onNavigateToLine?: (lineNumber: number, filePath?: string) => void;
  initialQuery?: string;
}

interface SymbolItem {
  name: string;
  kindName: string;
  line: number;
  filePath?: string;
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

export const QuickOpen: React.FC<QuickOpenProps> = ({
  isOpen,
  onClose,
  onSwitchToCommandPalette,
  onNavigateToLine,
  initialQuery = ''
}) => {
  const monaco = useMonacoRuntime().monaco;
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { openFile, workspacePath, activeTabPath } = useWorkspaceStore();

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setSelectedIndex(0);
      setSymbols([]);
      setTimeout(() => inputRef.current?.focus(), 50);

      // Load initial files
      void window.electronAPI.searchFiles('').then((res) => {
        if (res.success && res.data) {
          setFiles(res.data);
        }
      });

      // If active tab exists, pre-fetch symbols
      if (activeTabPath && !initialQuery.startsWith('#')) {
        void window.electronAPI.lspDocumentSymbols({ filePath: activeTabPath }).then((res) => {
          if (res.success && Array.isArray(res.data)) {
            const flattened: SymbolItem[] = [];
            function traverse(items: any[]) {
              for (const it of items) {
                flattened.push({
                  name: it.name,
                  kindName: it.detail || 'Symbol',
                  line: (it.range?.start?.line ?? 0) + 1
                });
                if (Array.isArray(it.children)) traverse(it.children);
              }
            }
            traverse(res.data);
            setSymbols(flattened);
          }
        });
      }
    }
  }, [isOpen, activeTabPath, initialQuery]);

  const loadWorkspaceSymbols = async (searchTerm: string) => {
    const response = await window.electronAPI.lspWorkspaceSymbols({ query: searchTerm });
    if (!response.success || !Array.isArray(response.data)) {
      setSymbols([]);
      return;
    }
    setSymbols(response.data.flatMap((item: any) => {
      const location = item.location || item;
      if (!location.uri || !location.range) return [];
      let filePath = location.uri;
      try { filePath = monaco?.Uri.parse(location.uri).fsPath || location.uri; } catch { /* retain URI for safe failure */ }
      return [{ name: item.name, kindName: item.containerName || item.detail || 'Workspace symbol', line: (location.range.start?.line ?? 0) + 1, filePath }];
    }));
  };

  useEffect(() => {
    if (!isOpen || !initialQuery.startsWith('#')) return;
    let cancelled = false;
    void ensureMonaco().then(() => {
      if (!cancelled) return loadWorkspaceSymbols('');
      return undefined;
    }).catch(() => setSymbols([]));
    return () => { cancelled = true; };
  }, [isOpen, initialQuery]);

  const handleQueryChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);

    // If query starts with '>', redirect to command palette
    if (val.startsWith('>')) {
      onClose();
      onSwitchToCommandPalette?.();
      return;
    }

    if (val.startsWith('#')) {
      try {
        await ensureMonaco();
        await loadWorkspaceSymbols(val.slice(1).trim());
      } catch {
        setSymbols([]);
      }
      return;
    }

    // Normal file search
    if (!val.startsWith(':') && !val.startsWith('@')) {
      try {
        const res = await window.electronAPI.searchFiles(val);
        if (res.success && res.data) {
          setFiles(res.data);
        }
      } catch {
        // Ignore
      }
    }
  };

  const handleSelectFile = (relPath: string) => {
    const fullPath = joinWorkspacePath(workspacePath, relPath);
    const name = relPath.split(/[\\/]/).pop() || relPath;
    void openFile(fullPath, name);
    onClose();
  };

  const handleSelectSymbol = (sym: SymbolItem) => {
    onNavigateToLine?.(sym.line, sym.filePath);
    onClose();
  };

  const isLineMode = query.startsWith(':');
  const isWorkspaceSymbolMode = query.startsWith('#');
  const isSymbolMode = query.startsWith('@') || isWorkspaceSymbolMode;

  const filteredSymbols = symbols.filter((s) => {
    const search = query.slice(1).toLowerCase().trim();
    if (!search) return true;
    return s.name.toLowerCase().includes(search) || s.kindName.toLowerCase().includes(search);
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = isSymbolMode ? filteredSymbols.length : files.length;
      setSelectedIndex((prev) => (prev < max - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isLineMode) {
        const lineNum = parseInt(query.slice(1).trim(), 10);
        if (!isNaN(lineNum) && lineNum > 0) {
          onNavigateToLine?.(lineNum);
          onClose();
        }
      } else if (isSymbolMode) {
        const target = filteredSymbols[selectedIndex];
        if (target) handleSelectSymbol(target);
      } else {
        const target = files[selectedIndex];
        if (target) handleSelectFile(target);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '70px',
        zIndex: 'var(--layer-modal)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '600px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 20px 48px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          {isLineMode ? (
            <Hash size={16} color="var(--accent-amber)" />
          ) : isSymbolMode ? (
            isWorkspaceSymbolMode ? <Hash size={16} color="var(--accent-cyan)" /> : <AtSign size={16} color="var(--accent-cyan)" />
          ) : (
            <Search size={16} color="var(--accent-primary)" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search files; use :line, @file symbol, #workspace symbol, or >command..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: '13px',
              outline: 'none',
              color: 'var(--text-primary)'
            }}
          />
        </div>

        {/* Results List */}
        <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '6px' }}>
          {isLineMode ? (
            <div style={{ padding: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Press <strong>Enter</strong> to jump to line <strong>{query.slice(1) || '...'}</strong> in active editor.
            </div>
          ) : isSymbolMode ? (
            filteredSymbols.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                No symbols found in this file.
              </div>
            ) : (
              filteredSymbols.map((sym, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectSymbol(sym)}
                    style={{
                      padding: '7px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '12px'
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AtSign size={13} color="var(--accent-cyan)" />
                      <span style={{ fontWeight: isSelected ? 600 : 400 }}>{sym.name}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sym.kindName}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      Line {sym.line}
                    </span>
                  </div>
                );
              })
            )
          ) : files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No files matching "{query}".
            </div>
          ) : (
            files.map((file, idx) => {
              const isSelected = idx === selectedIndex;
              const fileName = file.split('/').pop() || file;
              const dirName = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';

              return (
                <div
                  key={file}
                  onClick={() => handleSelectFile(file)}
                  style={{
                    padding: '7px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px'
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileCode size={14} color="var(--accent-primary)" />
                    <span style={{ fontWeight: isSelected ? 600 : 400 }}>{fileName}</span>
                  </div>

                  {dirName && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {dirName}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
