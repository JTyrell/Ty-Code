import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Replace,
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  CheckCheck,
  FileCode,
  SlidersHorizontal,
  X,
  History
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { NoProjectEmptyState } from './NoProjectEmptyState';
import type { FileSearchResult, SearchInFilesOptions, ReplaceInFilesOptions } from '../../../preload/types';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { handleAutoAppliedTransaction } from '../services/workspace-edit-commands';

interface SearchPanelProps {
  onNavigateToLocation?: (filePath: string, line: number, column?: number) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ onNavigateToLocation }) => {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const { openFile, workspacePath } = useWorkspaceStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replacementSourceKey = JSON.stringify({ workspacePath, query, replacement, isCaseSensitive, matchWholeWord, isRegex, includePattern, excludePattern });

  const totalMatches = results.reduce((acc, file) => acc + file.matches.length, 0);

  useEffect(() => {
    const state = useWorkspaceEditStore.getState();
    const current = state.request;
    if (!current?.sourceKey || current.sourceKey === replacementSourceKey) return;
    const options: ReplaceInFilesOptions = {
      query,
      replacement,
      isCaseSensitive,
      matchWholeWord,
      isRegex,
      includePattern: includePattern.trim() || undefined,
      excludePattern: excludePattern.trim() || undefined,
      filePaths: current.filePaths
    };
    state.setRequest({
      ...current,
      sourceKey: replacementSourceKey,
      isStale: true,
      refresh: async () => {
        const response = await window.electronAPI.previewReplace({ ...options, forcePreview: true });
        if (!response.success || !response.data?.preview) throw new Error(response.error || 'Could not refresh replacement preview.');
        return response.data.preview;
      }
    });
  }, [replacementSourceKey]);

  useEffect(() => {
    const onWorkspaceMutated = () => { void handleSearch(); };
    window.addEventListener('workspace-files-mutated', onWorkspaceMutated);
    return () => window.removeEventListener('workspace-files-mutated', onWorkspaceMutated);
  });

  const handleSearch = async (searchTerm?: string) => {
    const term = searchTerm !== undefined ? searchTerm : query;
    if (!term.trim()) {
      setResults([]);
      setStatusMessage('');
      return;
    }
    if (!workspacePath) {
      setResults([]);
      setStatusMessage('No project is loaded. Open a folder to search across files.');
      return;
    }

    setIsSearching(true);
    setStatusMessage('Searching workspace...');

    // Save history
    if (!searchHistory.includes(term)) {
      setSearchHistory((prev) => [term, ...prev.slice(0, 9)]);
    }

    try {
      const options: SearchInFilesOptions = {
        query: term,
        isCaseSensitive,
        matchWholeWord,
        isRegex,
        includePattern: includePattern.trim() || undefined,
        excludePattern: excludePattern.trim() || undefined
      };

      const res = await window.electronAPI.searchInFiles(options);
      if (res.success && res.data) {
        setResults(res.data);
        const matchesCount = res.data.reduce((acc, f) => acc + f.matches.length, 0);
        setStatusMessage(
          matchesCount > 0
            ? `${matchesCount} result${matchesCount > 1 ? 's' : ''} in ${res.data.length} file${res.data.length > 1 ? 's' : ''}`
            : 'No results found.'
        );
      } else {
        setStatusMessage(res.error || 'Search error');
      }
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSearch();
    }
  };

  const prepareReplacement = async (filePaths?: string[]) => {
    if (!query.trim() || !window.electronAPI) return;
    setIsReplacing(true);
    const options: ReplaceInFilesOptions = {
      query,
      replacement,
      isCaseSensitive,
      matchWholeWord,
      isRegex,
      includePattern: includePattern.trim() || undefined,
      excludePattern: excludePattern.trim() || undefined,
      filePaths
    };
    try {
      const response = await window.electronAPI.previewReplace({ ...options, forcePreview: useWorkspaceEditStore.getState().forcePreviewAll });
      if (!response.success || !response.data) throw new Error(response.error || 'Could not prepare a replacement preview.');
      if (response.data.applied) {
        handleAutoAppliedTransaction(response.data.applied);
        setStatusMessage(`Auto-applied ${response.data.applied.editCount} low-risk change(s) in ${response.data.applied.fileCount} tracked file(s).`);
        return;
      }
      const preview = response.data.preview;
      if (!preview) throw new Error('The replace preview response is empty.');
      useWorkspaceEditStore.getState().setRequest({
        preview,
        isStale: false,
        sourceKey: replacementSourceKey,
        filePaths,
        refresh: async () => {
          const refreshed = await window.electronAPI.previewReplace({ ...options, forcePreview: true });
          if (!refreshed.success || !refreshed.data?.preview) throw new Error(refreshed.error || 'Could not refresh replacement preview.');
          return refreshed.data.preview;
        }
      });
      setStatusMessage(`Preview ready: ${preview.totalEdits} changes in ${preview.files.length} file${preview.files.length === 1 ? '' : 's'}.`);
    } catch (reason) {
      setStatusMessage(reason instanceof Error ? reason.message : 'Could not preview replacements.');
    } finally {
      setIsReplacing(false);
    }
  };

  const handleReplaceAll = () => prepareReplacement();

  const handleReplaceInFile = (filePath: string) => prepareReplacement([filePath]);

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  const handleOpenMatch = (filePath: string, lineNumber: number, column: number) => {
    if (onNavigateToLocation) {
      onNavigateToLocation(filePath, lineNumber, column);
      return;
    }
    const name = filePath.split(/[\/\\]/).pop() || filePath;
    void openFile(filePath, name);
  };

  if (!workspacePath) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-subtle)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-secondary)'
          }}
        >
          Search &amp; Replace
        </div>
        <NoProjectEmptyState hint="Search scans the currently loaded project. Open a folder to search and replace across files." />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Search Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Search & Replace
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setIsReplaceOpen((prev) => !prev)}
            style={{
              padding: '4px',
              borderRadius: '4px',
              color: isReplaceOpen ? 'var(--accent-primary)' : 'var(--text-muted)',
              backgroundColor: isReplaceOpen ? 'var(--bg-tertiary)' : 'transparent'
            }}
            title="Toggle Replace"
          >
            <Replace size={14} />
          </button>
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            style={{
              padding: '4px',
              borderRadius: '4px',
              color: showFilters ? 'var(--accent-primary)' : 'var(--text-muted)',
              backgroundColor: showFilters ? 'var(--bg-tertiary)' : 'transparent'
            }}
            title="Toggle Search Details & Filters"
          >
            <SlidersHorizontal size={14} />
          </button>
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setStatusMessage('');
            }}
            style={{ padding: '4px', borderRadius: '4px', color: 'var(--text-muted)' }}
            title="Clear Search"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Inputs Area */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Search Input Box with Modifiers */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search (Enter to search)..."
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '5px',
              padding: '6px 86px 6px 10px',
              fontSize: '12px',
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />

          {/* Toggle Buttons inside Search Input */}
          <div style={{ position: 'absolute', right: '4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button
              onClick={() => setIsCaseSensitive((prev) => !prev)}
              style={{
                padding: '3px 4px',
                borderRadius: '3px',
                color: isCaseSensitive ? '#fff' : 'var(--text-muted)',
                backgroundColor: isCaseSensitive ? 'var(--accent-primary)' : 'transparent'
              }}
              title="Match Case (Alt+C)"
            >
              <CaseSensitive size={14} />
            </button>
            <button
              onClick={() => setMatchWholeWord((prev) => !prev)}
              style={{
                padding: '3px 4px',
                borderRadius: '3px',
                color: matchWholeWord ? '#fff' : 'var(--text-muted)',
                backgroundColor: matchWholeWord ? 'var(--accent-primary)' : 'transparent'
              }}
              title="Match Whole Word (Alt+W)"
            >
              <WholeWord size={14} />
            </button>
            <button
              onClick={() => setIsRegex((prev) => !prev)}
              style={{
                padding: '3px 4px',
                borderRadius: '3px',
                color: isRegex ? '#fff' : 'var(--text-muted)',
                backgroundColor: isRegex ? 'var(--accent-primary)' : 'transparent'
              }}
              title="Use Regular Expression (Alt+R)"
            >
              <Regex size={14} />
            </button>
          </div>
        </div>

        {/* Replace Input Box if enabled */}
        {isReplaceOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with..."
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />
            <button
              onClick={handleReplaceAll}
              disabled={isReplacing || !query.trim() || totalMatches === 0}
              style={{
                padding: '6px 10px',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: totalMatches === 0 ? 0.5 : 1
              }}
              title="Replace All Occurrences (Ctrl+Alt+Enter)"
            >
              <CheckCheck size={13} />
              <span>Replace All</span>
            </button>
          </div>
        )}

        {/* Include / Exclude Pattern Filters */}
        {showFilters && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>files to include (e.g. *.ts, src/**)</div>
              <input
                type="text"
                value={includePattern}
                onChange={(e) => setIncludePattern(e.target.value)}
                placeholder="e.g. *.ts, *.tsx"
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>files to exclude (e.g. dist/**, *.spec.ts)</div>
              <input
                type="text"
                value={excludePattern}
                onChange={(e) => setExcludePattern(e.target.value)}
                placeholder="e.g. node_modules/**, dist/**"
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
            </div>
          </div>
        )}

        {/* History Dropdown */}
        {searchHistory.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
            <span
              onClick={() => setShowHistory((prev) => !prev)}
              style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}
            >
              <History size={11} />
              <span>Recent searches ({searchHistory.length})</span>
            </span>
          </div>
        )}

        {showHistory && searchHistory.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {searchHistory.map((h, i) => (
              <div
                key={i}
                onClick={() => {
                  setQuery(h);
                  setShowHistory(false);
                  void handleSearch(h);
                }}
                style={{ padding: '3px 6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: '3px' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {h}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status Bar */}
      {statusMessage && (
        <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
          {statusMessage}
        </div>
      )}

      {/* Results Tree View */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {results.map((file) => {
          const isCollapsed = Boolean(collapsedFiles[file.filePath]);
          const fileName = file.filePath.split(/[\/\\]/).pop() || file.filePath;
          const dirPath = file.relativePath.includes('/')
            ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
            : '';

          return (
            <div key={file.filePath} style={{ marginBottom: '4px' }}>
              {/* File Row */}
              <div
                onClick={() => toggleFileCollapse(file.filePath)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  borderRadius: '3px',
                  fontSize: '12px'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  {isCollapsed ? <ChevronRight size={13} color="var(--text-muted)" /> : <ChevronDown size={13} color="var(--text-muted)" />}
                  <FileCode size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {fileName}
                  </span>
                  {dirPath && (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dirPath}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      fontWeight: 700
                    }}
                  >
                    {file.matches.length}
                  </span>

                  {isReplaceOpen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReplaceInFile(file.filePath);
                      }}
                      style={{ padding: '2px 6px', fontSize: '10px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '3px', color: 'var(--text-secondary)' }}
                      title="Replace all in this file"
                    >
                      Replace file
                    </button>
                  )}
                </div>
              </div>

              {/* Match Lines */}
              {!isCollapsed && (
                <div style={{ paddingLeft: '22px' }}>
                  {file.matches.map((m, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOpenMatch(file.filePath, m.lineNumber, m.matchStart + 1)}
                      style={{
                        padding: '3px 8px',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        borderRadius: '3px',
                        color: 'var(--text-secondary)',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                      title={`Line ${m.lineNumber}: ${m.preview}`}
                    >
                      <span style={{ color: 'var(--accent-cyan)', fontSize: '10px', minWidth: '24px', flexShrink: 0 }}>
                        {m.lineNumber}:
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.preview}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {results.length === 0 && !isSearching && !statusMessage && (
          <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            Type a query and press Enter to search across all files in your workspace.
          </div>
        )}
      </div>
    </div>
  );
};
