import React, { useState, useEffect, useRef } from 'react';
import { Search, FileCode, FileText } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';

interface QuickOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { openFile, workspacePath } = useWorkspaceStore();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      // Fetch file list
      (async () => {
        try {
          const res = await window.electronAPI.searchFiles('');
          if (res.success && res.data) {
            setFiles(res.data);
          }
        } catch (err) {
          console.error('Failed to search files:', err);
        }
      })();
    }
  }, [isOpen]);

  const handleQueryChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);

    try {
      const res = await window.electronAPI.searchFiles(val);
      if (res.success && res.data) {
        setFiles(res.data);
      }
    } catch (err) {
      console.error('Failed to search files:', err);
    }
  };

  const handleSelectFile = (relPath: string) => {
    const fullPath = `${workspacePath}/${relPath}`.replace(/\/+/g, '/');
    const name = relPath.split('/').pop() || relPath;
    openFile(fullPath, name);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < files.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (files[selectedIndex]) {
        handleSelectFile(files[selectedIndex]);
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
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '80px',
        zIndex: 'var(--layer-modal)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '580px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Search size={15} color="var(--accent-primary)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name in workspace (Ctrl+P)..."
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
        <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '4px' }}>
          {files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No files found matching "{query}".
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
                    padding: '6px 10px',
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
                    <FileCode size={14} color="var(--accent-cyan)" />
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
