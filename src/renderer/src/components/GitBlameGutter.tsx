import React, { useEffect, useState } from 'react';
import { GitCommit, User, Calendar, Hash, Copy, Check, ExternalLink } from 'lucide-react';
import type { GitBlameHunk } from '../../../preload/types';

interface GitBlameProps {
  filePath: string;
  currentLine?: number;
}

export const GitBlameGutter: React.FC<GitBlameProps> = ({ filePath, currentLine = 1 }) => {
  const [blameHunks, setBlameHunks] = useState<GitBlameHunk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedHunk, setSelectedHunk] = useState<GitBlameHunk | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (!filePath) return;

    (async () => {
      try {
        setIsLoading(true);
        const res = await window.electronAPI.gitGetBlame(filePath);
        if (isMounted && res.success && res.data) {
          setBlameHunks(res.data);
        }
      } catch (err) {
        console.error('Failed to load blame:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [filePath]);

  const activeHunk = blameHunks.find((h) => h.lineStart === currentLine) || blameHunks[0];

  const handleCopyHash = (hash: string) => {
    void navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  if (!activeHunk) return null;

  return (
    <>
      {/* Inline Subtle Blame Text in Status Bar / Editor Header */}
      <div
        onClick={() => setSelectedHunk(activeHunk)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          color: 'var(--text-muted)',
          fontSize: '11px',
          cursor: 'pointer',
          maxWidth: '350px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={`Git Blame (Line ${currentLine}): ${activeHunk.author} - ${activeHunk.summary} (${activeHunk.commitHash.slice(0, 7)})`}
      >
        <GitCommit size={12} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{activeHunk.author}</span>
        <span>•</span>
        <span style={{ color: 'var(--text-muted)' }}>{activeHunk.dateString}</span>
        <span>•</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeHunk.summary}</span>
      </div>

      {/* Commit Detail Modal on Click */}
      {selectedHunk && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
          onClick={() => setSelectedHunk(null)}
        >
          <div
            style={{
              width: '420px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                <GitCommit size={15} color="var(--accent-primary)" />
                <span>Commit Details</span>
              </div>

              <button
                onClick={() => handleCopyHash(selectedHunk.commitHash)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: '11px'
                }}
                title="Copy full commit SHA"
              >
                {copiedHash ? <Check size={12} color="var(--accent-green)" /> : <Copy size={12} />}
                <span>{selectedHunk.commitHash.slice(0, 7)}</span>
              </button>
            </div>

            {/* Commit Message */}
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: '1.4' }}>
              {selectedHunk.summary}
            </div>

            {/* Meta details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={13} color="var(--text-muted)" />
                <span>{selectedHunk.author} {selectedHunk.authorEmail ? `<${selectedHunk.authorEmail}>` : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={13} color="var(--text-muted)" />
                <span>{selectedHunk.dateString}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash size={13} color="var(--text-muted)" />
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {selectedHunk.commitHash}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                onClick={() => setSelectedHunk(null)}
                style={{
                  padding: '5px 14px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
