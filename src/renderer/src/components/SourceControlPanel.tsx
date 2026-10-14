import React, { useEffect, useState, useRef } from 'react';
import {
  GitBranch,
  RefreshCw,
  Check,
  Plus,
  Minus,
  RotateCcw,
  GitCommit,
  GitPullRequest,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  FileMinus,
  AlertTriangle,
  FolderPlus,
  SplitSquareVertical,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useGitStore } from '../state/git-store';
import type { GitFileChange } from '../../../preload/types';

export const SourceControlPanel: React.FC = () => {
  const {
    status,
    branches,
    commitMessage,
    isLoading,
    isSyncing,
    error,
    setCommitMessage,
    refreshStatus,
    initRepo,
    stageFile,
    unstageFile,
    discardChanges,
    createCommit,
    switchBranch,
    createBranch,
    syncRepo,
    openFileDiff
  } = useGitStore();

  const [isStagedCollapsed, setIsStagedCollapsed] = useState(false);
  const [isChangesCollapsed, setIsChangesCollapsed] = useState(false);
  const [isUntrackedCollapsed, setIsUntrackedCollapsed] = useState(false);
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [newBranchInput, setNewBranchInput] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<{ path: string; isUntracked: boolean } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Handle Ctrl+Enter to commit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleCommit();
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    const success = await createCommit();
    if (success && textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const insertConventionalPrefix = (prefix: string) => {
    const current = commitMessage.trim();
    if (current.startsWith(prefix)) return;
    setCommitMessage(`${prefix}: ${current}`);
    textareaRef.current?.focus();
  };

  // Status icon and color helper
  const renderStatusBadge = (statusType: GitFileChange['status']) => {
    switch (statusType) {
      case 'M':
        return <span style={{ color: '#eab308', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }} title="Modified">M</span>;
      case 'A':
        return <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }} title="Added">A</span>;
      case 'D':
        return <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }} title="Deleted">D</span>;
      case 'U':
        return <span style={{ color: '#3b82f6', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }} title="Untracked">U</span>;
      case 'C':
        return <span style={{ color: '#ec4899', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }} title="Conflict">!</span>;
      default:
        return <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '11px', width: '14px', textAlign: 'center' }}>?</span>;
    }
  };

  const renderFileRow = (file: GitFileChange, isStaged: boolean) => {
    const fileName = file.path.split(/[\\/]/).pop() || file.path;
    const dirPath = file.path.includes('/') || file.path.includes('\\')
      ? file.path.substring(0, Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\')))
      : '';

    return (
      <div
        key={`${isStaged ? 'staged' : 'unstaged'}-${file.path}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          fontSize: '12px',
          cursor: 'pointer',
          borderRadius: '4px',
          transition: 'background-color 0.15s ease'
        }}
        className="file-item-hover"
        onClick={() => openFileDiff(file.path, isStaged)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
          <FileCode size={13} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
          <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {fileName}
          </span>
          {dirPath && (
            <span style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {dirPath}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {/* Quick Actions */}
          {isStaged ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void unstageFile(file.path);
              }}
              style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
              title="Unstage changes"
              className="action-hover"
            >
              <Minus size={12} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDiscardTarget({ path: file.path, isUntracked: file.status === 'U' });
                }}
                style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                title="Discard changes"
                className="action-hover"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void stageFile(file.path);
                }}
                style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                title="Stage changes"
                className="action-hover"
              >
                <Plus size={12} />
              </button>
            </>
          )}

          {renderStatusBadge(file.status)}
        </div>
      </div>
    );
  };

  // If workspace is not a Git repo yet
  if (status && !status.isRepo) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          textAlign: 'center',
          gap: '14px',
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-secondary)'
        }}
      >
        <FolderPlus size={36} color="var(--accent-primary)" />
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          No Git Repository Found
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
          This workspace is not currently tracked by Git. Initialize a repository to enable version control, branching, and visual diffs.
        </p>
        <button
          onClick={() => void initRepo()}
          disabled={isLoading}
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            padding: '8px 16px',
            fontSize: '12px',
            fontWeight: 500,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer'
          }}
        >
          <GitBranch size={14} />
          <span>{isLoading ? 'Initializing…' : 'Initialize Repository'}</span>
        </button>
      </div>
    );
  }

  const stagedCount = status?.stagedFiles.length || 0;
  const unstagedCount = status?.unstagedFiles.length || 0;
  const untrackedCount = status?.untrackedFiles.length || 0;
  const totalChanges = stagedCount + unstagedCount + untrackedCount;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Top Header */}
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
          letterSpacing: '0.5px',
          color: 'var(--text-secondary)'
        }}
      >
        <span style={{ textTransform: 'uppercase' }}>Source Control</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Branch Switcher Button */}
          <button
            onClick={() => setIsBranchMenuOpen((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--accent-primary)',
              fontSize: '11px',
              fontWeight: 500
            }}
            title="Switch or create branches"
          >
            <GitBranch size={11} />
            <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status?.currentBranch || 'master'}
            </span>
            <ChevronDown size={10} />
          </button>

          {/* Sync Button */}
          <button
            onClick={() => void syncRepo()}
            disabled={isSyncing}
            style={{
              padding: '4px',
              borderRadius: '4px',
              color: isSyncing ? 'var(--accent-primary)' : 'var(--text-secondary)'
            }}
            title={`Sync with remote (${status?.ahead || 0}↑ ${status?.behind || 0}↓)`}
          >
            <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Branch Selector Dropdown Modal/Card */}
      {isBranchMenuOpen && (
        <div
          style={{
            padding: '8px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>SWITCH BRANCH</span>
            <button
              onClick={() => setIsBranchMenuOpen(false)}
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Branch List */}
          <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {branches?.all.map((b) => {
              const isCurrent = b === branches.current;
              return (
                <div
                  key={b}
                  onClick={() => {
                    void switchBranch(b);
                    setIsBranchMenuOpen(false);
                  }}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isCurrent ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                    color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)'
                  }}
                >
                  <span>{b}</span>
                  {isCurrent && <Check size={11} />}
                </div>
              );
            })}
          </div>

          {/* Create New Branch Input */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <input
              type="text"
              placeholder="New branch name…"
              value={newBranchInput}
              onChange={(e) => setNewBranchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranchInput.trim()) {
                  void createBranch(newBranchInput.trim());
                  setNewBranchInput('');
                  setIsBranchMenuOpen(false);
                }
              }}
              style={{
                flex: 1,
                fontSize: '11px',
                padding: '4px 6px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                borderRadius: '4px'
              }}
            />
            <button
              onClick={() => {
                if (newBranchInput.trim()) {
                  void createBranch(newBranchInput.trim());
                  setNewBranchInput('');
                  setIsBranchMenuOpen(false);
                }
              }}
              style={{
                padding: '4px 8px',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                fontSize: '11px',
                borderRadius: '4px'
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Commit Box Section */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Conventional Commit Tag Chips */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
          {['feat', 'fix', 'docs', 'refactor', 'test', 'chore'].map((tag) => (
            <button
              key={tag}
              onClick={() => insertConventionalPrefix(tag)}
              style={{
                fontSize: '10px',
                padding: '2px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Commit Message Textarea */}
        <textarea
          ref={textareaRef}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message (Ctrl+Enter to commit)"
          rows={3}
          style={{
            width: '100%',
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '6px 8px',
            fontSize: '12px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />

        {/* Commit Action Button */}
        <button
          onClick={() => void handleCommit()}
          disabled={isLoading || !commitMessage.trim()}
          style={{
            width: '100%',
            height: '28px',
            backgroundColor: commitMessage.trim() ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
            color: commitMessage.trim() ? '#fff' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: commitMessage.trim() ? 'pointer' : 'default',
            transition: 'background-color 0.2s'
          }}
        >
          <Check size={14} />
          <span>Commit ({stagedCount > 0 ? `${stagedCount} staged` : 'all changes'})</span>
        </button>

        {error && (
          <div style={{ fontSize: '11px', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <AlertTriangle size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{error}</span>
          </div>
        )}
      </div>

      {/* Changes Accordion Scrollable View */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {/* Staged Changes Section */}
        {stagedCount > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600
              }}
              onClick={() => setIsStagedCollapsed((prev) => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isStagedCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span>STAGED CHANGES</span>
                <span
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    color: '#22c55e',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                >
                  {stagedCount}
                </span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void unstageFile('.');
                }}
                style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                title="Unstage All Changes"
              >
                <Minus size={13} />
              </button>
            </div>

            {!isStagedCollapsed && (
              <div style={{ padding: '0 4px' }}>
                {status?.stagedFiles.map((file) => renderFileRow(file, true))}
              </div>
            )}
          </div>
        )}

        {/* Changes (Working Tree) Section */}
        {unstagedCount > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600
              }}
              onClick={() => setIsChangesCollapsed((prev) => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isChangesCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span>CHANGES</span>
                <span
                  style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.2)',
                    color: '#eab308',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                >
                  {unstagedCount}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void stageFile('.');
                  }}
                  style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                  title="Stage All Changes"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>

            {!isChangesCollapsed && (
              <div style={{ padding: '0 4px' }}>
                {status?.unstagedFiles.map((file) => renderFileRow(file, false))}
              </div>
            )}
          </div>
        )}

        {/* Untracked Files Section */}
        {untrackedCount > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600
              }}
              onClick={() => setIsUntrackedCollapsed((prev) => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isUntrackedCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span>UNTRACKED</span>
                <span
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: '#3b82f6',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                >
                  {untrackedCount}
                </span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (status) void stageFile(status.untrackedFiles.map((untrackedFile) => untrackedFile.path));
                }}
                style={{ padding: '2px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}
                title="Stage All Untracked"
              >
                <Plus size={13} />
              </button>
            </div>

            {!isUntrackedCollapsed && (
              <div style={{ padding: '0 4px' }}>
                {status?.untrackedFiles.map((file) => renderFileRow(file, false))}
              </div>
            )}
          </div>
        )}

        {/* Clean Working Tree State */}
        {totalChanges === 0 && (
          <div
            style={{
              padding: '30px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              textAlign: 'center'
            }}
          >
            <Check size={28} color="var(--accent-green)" />
            <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Working tree clean</span>
            <span>No changes detected in workspace.</span>
          </div>
        )}
      </div>

      {/* Discard Confirmation Modal */}
      {discardTarget && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 100
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '16px',
              width: '100%',
              maxWidth: '300px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-red)', fontWeight: 600, fontSize: '13px' }}>
              <AlertTriangle size={16} />
              <span>Discard Changes?</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Are you sure you want to discard changes in <strong>{discardTarget.path}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setDiscardTarget(null)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void discardChanges(discardTarget.path, discardTarget.isUntracked);
                  setDiscardTarget(null);
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--accent-red)',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 500
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
