import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight,
  FileCode, FileMinus, FilePlus, FolderPlus, GitBranch, GitCommit, GitMerge, History,
  Loader2, Minus, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Tag, Trash2, X
} from 'lucide-react';
import { useGitStore } from '../state/git-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { NoProjectEmptyState } from './NoProjectEmptyState';
import type { GitFileChange } from '../../../preload/types';
import './SourceControlPanel.css';

type SourceControlView = 'changes' | 'history';
type ChangeSection = 'conflicts' | 'staged' | 'unstaged' | 'untracked' | 'stashes' | 'tags';

function fullWorkspacePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  const root = workspacePath.replace(/[\\/]+$/, '');
  const prefix = `${root}${root ? separator : separator}`;
  return `${prefix}${relativePath.replace(/[\\/]/g, separator)}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function fileDirectory(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index >= 0 ? filePath.slice(0, index) : '';
}

export const SourceControlPanel: React.FC = () => {
  const {
    status, branches, commits, commitDetail, historySearch, commitMessage, isLoading,
    isSyncing, operationStatus, error, tags, stashes, remotes, activeConflict,
    setCommitMessage, setHistorySearch, clearError, refreshStatus, initRepo,
    stageFile, unstageFile, discardChanges, createCommit, fetchBranches, switchBranch,
    createBranch, deleteBranch, mergeBranch, fetchRemote, pullRemote, pushRemote,
    loadHistory, loadCommitDetail, loadTags, loadStashes, createTag, deleteTag,
    stashChanges, popStash, dropStash, loadConflict, closeConflict, resolveConflict, abortMerge
   } = useGitStore();
  const { workspacePath, openFile } = useWorkspaceStore();
  const resetStatus = useGitStore((s) => s.resetStatus);
  const [view, setView] = useState<SourceControlView>('changes');
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchInput, setBranchInput] = useState('');
  const [branchMenuPosition, setBranchMenuPosition] = useState({ top: 0, left: 0 });
  const [stashMessage, setStashMessage] = useState('');
  const [tagName, setTagName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<ChangeSection, boolean>>({
    conflicts: false, staged: false, unstaged: false, untracked: false, stashes: true, tags: true
  });
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; actionLabel: string; onConfirm: () => Promise<unknown> } | null>(null);
  const [discardTarget, setDiscardTarget] = useState<GitFileChange | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const commitRef = useRef<HTMLTextAreaElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!workspacePath) {
      // No project loaded: keep Git store pristine instead of probing a phantom repo
      resetStatus();
      return;
    }
    void refreshStatus(true);
    const timer = window.setInterval(() => { void refreshStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, resetStatus, workspacePath]);

  useEffect(() => {
    if (view !== 'history') return;
    const timer = window.setTimeout(() => { void loadHistory(historyQuery); }, 220);
    return () => window.clearTimeout(timer);
  }, [historyQuery, loadHistory, view]);

  useEffect(() => {
    if (!branchMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !branchMenuRef.current?.contains(event.target)) setBranchMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBranchMenuOpen(false);
        branchTriggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchMenuOpen]);

  const handleBranchMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (event.key === 'Escape') {
      setBranchMenuOpen(false);
      branchTriggerRef.current?.focus();
    }
  };

  const openDiff = useCallback((file: GitFileChange, staged: boolean) => {
    void useGitStore.getState().openFileDiff(file.path, staged);
  }, []);

  const openConflictFile = useCallback((filePath: string) => {
    void loadConflict(filePath);
  }, [loadConflict]);

  const handleCommit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!commitMessage.trim() || isLoading) return;
    if (await createCommit()) commitRef.current?.focus();
  };

  const insertPrefix = (prefix: string) => {
    const current = commitMessage.trim();
    setCommitMessage(current.startsWith(`${prefix}:`) ? current : `${prefix}: ${current}`);
    commitRef.current?.focus();
  };

  const handleCreateBranch = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = branchInput.trim();
    if (!name) return;
    if (await createBranch(name)) {
      setBranchInput('');
      setBranchMenuOpen(false);
    }
  };

  const handleDeleteBranch = (name: string) => {
    setConfirmAction({ title: 'Delete branch?', message: `Delete local branch “${name}”? This cannot be undone.`, actionLabel: 'Delete branch', onConfirm: () => deleteBranch(name) });
  };

  const handleMergeBranch = (name: string) => {
    setConfirmAction({ title: 'Merge branch?', message: `Merge “${name}” into “${status?.currentBranch}”?`, actionLabel: 'Merge branch', onConfirm: () => mergeBranch(name) });
  };

  const handleCreateTag = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tagName.trim()) return;
    if (await createTag(tagName.trim())) setTagName('');
  };

  const toggleSection = (section: ChangeSection) => {
    setCollapsed((current) => ({ ...current, [section]: !current[section] }));
  };

  const renderStatus = (fileStatus: GitFileChange['status']) => (
    <span className={`source-control-status-letter is-${fileStatus}`} aria-label={
      fileStatus === 'M' ? 'Modified' : fileStatus === 'A' ? 'Added' : fileStatus === 'D' ? 'Deleted' : fileStatus === 'C' ? 'Conflict' : fileStatus === 'R' ? 'Renamed' : 'Untracked'
    }>{fileStatus === 'C' ? '!' : fileStatus}</span>
  );

  const renderFileRow = (file: GitFileChange, category: 'staged' | 'unstaged' | 'untracked') => {
    const staged = category === 'staged';
    const untracked = category === 'untracked';
    return <div key={`${category}-${file.path}`} className="source-control-file-row">
      <button type="button" className="source-control-file-open" aria-label={`Open diff for ${file.path}`} onClick={() => openDiff(file, staged)}>
        <FileCode size={13} aria-hidden="true" />
        <span className="source-control-file-name" title={file.path}>
          <strong>{fileName(file.path)}</strong>{fileDirectory(file.path) && <small>{fileDirectory(file.path)}</small>}
        </span>
      </button>
      <span className="source-control-row-actions">
        {staged ? <button aria-label={`Unstage ${file.path}`} title="Unstage changes" onClick={(event) => { event.stopPropagation(); void unstageFile(file.path); }}><Minus size={12} /></button> : <>
          <button className="is-danger" aria-label={`Discard ${file.path}`} title="Discard changes" onClick={(event) => { event.stopPropagation(); setDiscardTarget(file); }}><RotateCcw size={12} /></button>
          <button aria-label={`Stage ${file.path}`} title="Stage changes" onClick={(event) => { event.stopPropagation(); void stageFile(file.path); }}><Plus size={12} /></button>
        </>}
      </span>
      {renderStatus(file.status)}
    </div>;
  };

  const renderSectionHeader = (section: ChangeSection, label: string, count: number, colorClass = '') => (
    <div className="source-control-section-heading">
      <button className="source-control-section-toggle" aria-expanded={!collapsed[section]} onClick={() => toggleSection(section)}>
        {collapsed[section] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>{label}</span>
        <span className={`source-control-count ${colorClass}`}>{count}</span>
      </button>
      {section === 'staged' && count > 0 && <button className="source-control-icon-button" title="Unstage all" aria-label="Unstage all files" onClick={() => void unstageFile('.')}><Minus size={13} /></button>}
      {section === 'unstaged' && count > 0 && <button className="source-control-icon-button" title="Stage all changes" aria-label="Stage all changes" onClick={() => void stageFile('.')}><Plus size={13} /></button>}
      {section === 'untracked' && count > 0 && <button className="source-control-icon-button" title="Stage all untracked files" aria-label="Stage all untracked files" onClick={() => void stageFile(status?.untrackedFiles.map((file) => file.path) || [])}><Plus size={13} /></button>}
      {section === 'conflicts' && count > 0 && <button className="source-control-danger-button" onClick={() => setConfirmAction({
        title: 'Abort merge?',
        message: 'Abort the current merge and restore the state from before it started?',
        actionLabel: 'Abort merge',
        onConfirm: async () => { await abortMerge(); }
      })}>Abort merge</button>}
    </div>
  );

  if (!workspacePath) {
    return (
      <div className="source-control-panel">
        <div className="source-control-header"><span>Source Control</span></div>
        <NoProjectEmptyState hint="Git reads from the currently loaded project. Open a folder to see branches, changes, and history." />
      </div>
    );
  }

  if (status && !status.isRepo) return <div className="source-control-panel">
    <div className="source-control-header"><span>Source Control</span><button className="source-control-icon-button" aria-label="Refresh Git status" onClick={() => void refreshStatus()}><RefreshCw size={13} /></button></div>
    <div className="source-control-empty">
      <FolderPlus size={32} />
      <strong>No Git repository found</strong>
      <span>Initialize a repository in the active workspace to enable source control.</span>
      <button className="source-control-primary-button" disabled={isLoading} onClick={() => void initRepo()}>
        <GitBranch size={13} />{isLoading ? 'Initializing…' : 'Initialize Repository'}
      </button>
    </div>
    {error && <div className="source-control-error" role="alert">{error}<button onClick={clearError} aria-label="Dismiss error"><X size={12} /></button></div>}
  </div>;

  const stagedCount = status?.stagedFiles.length || 0;
  const unstagedCount = status?.unstagedFiles.length || 0;
  const untrackedCount = status?.untrackedFiles.length || 0;
  const conflictCount = status?.conflictedFiles.length || 0;
  const totalChanges = stagedCount + unstagedCount + untrackedCount + conflictCount;
  const canCommit = Boolean(commitMessage.trim()) && (stagedCount + unstagedCount + untrackedCount > 0) && conflictCount === 0;
  const remoteConfigured = remotes.length > 0;
  const isNestedWorkspace = Boolean(status?.repositoryRoot && workspacePath && normalizePath(status.repositoryRoot) !== normalizePath(workspacePath));

  return <div className="source-control-panel">
    <header className="source-control-header">
      <span>Source Control</span>
      <div className="source-control-header-actions">
        <button className="source-control-icon-button" aria-label="Fetch from remote" title="Fetch from remote" disabled={isSyncing || !remoteConfigured} onClick={() => void fetchRemote()}><ArrowDown size={13} /></button>
        <button className="source-control-icon-button" aria-label="Pull from remote" title="Pull from remote" disabled={isSyncing || !remoteConfigured} onClick={() => void pullRemote()}><ArrowDown size={13} /></button>
        <button className="source-control-icon-button" aria-label="Push to remote" title="Push to remote" disabled={isSyncing || !remoteConfigured} onClick={() => void pushRemote()}><ArrowUp size={13} /></button>
        <button className="source-control-icon-button" aria-label="Refresh Git status" title="Refresh status" disabled={isLoading} onClick={() => void refreshStatus()}>{isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
      </div>
    </header>

    <div className="source-control-tabs" role="tablist" aria-label="Source control views">
      <button id="git-tab-changes" role="tab" aria-controls="git-panel-changes" aria-selected={view === 'changes'} tabIndex={view === 'changes' ? 0 : -1} className={view === 'changes' ? 'is-active' : ''} onClick={() => setView('changes')}>Changes{totalChanges > 0 ? ` · ${totalChanges}` : ''}</button>
      <button id="git-tab-history" role="tab" aria-controls="git-panel-history" aria-selected={view === 'history'} tabIndex={view === 'history' ? 0 : -1} className={view === 'history' ? 'is-active' : ''} onClick={() => setView('history')}>History</button>
    </div>

    <div className="source-control-branchbar">
      <div ref={branchMenuRef} style={{ position: 'relative', minWidth: 0 }}>
        <button ref={branchTriggerRef} className="source-control-branch-trigger" aria-expanded={branchMenuOpen} aria-haspopup="menu" onClick={() => {
          const opening = !branchMenuOpen;
          setBranchMenuOpen(opening);
          void fetchBranches();
          if (opening) window.requestAnimationFrame(() => branchMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]')?.focus());
        }}>
          <GitBranch size={12} /><span>{status?.currentBranch || branches?.current || 'HEAD'}</span><ChevronDown size={11} />
        </button>
        {branchMenuOpen && <div className="source-control-branch-menu" role="group" aria-label="Git branch actions">
          <div className="source-control-menu-heading">LOCAL BRANCHES</div>
          <div className="source-control-branch-items" role="menu" aria-label="Local branches" onKeyDown={handleBranchMenuKeyDown}>
          {branches?.all.map((branch) => {
            const current = branch === branches.current;
            return <div key={branch} className={`source-control-branch-row${current ? ' is-current' : ''}`}>
              <button role="menuitemradio" aria-checked={current} title={`Switch to ${branch}`} onClick={() => { if (!current) void switchBranch(branch); setBranchMenuOpen(false); }}>
                <GitBranch size={11} /><span>{branch}</span>{current && <Check size={11} />}
              </button>
              {!current && <>
                <button role="menuitem" title={`Merge ${branch} into current branch`} aria-label={`Merge ${branch} into current branch`} onClick={() => { setBranchMenuOpen(false); void handleMergeBranch(branch); }}><GitMerge size={11} /></button>
                <button role="menuitem" className="is-danger" title={`Delete ${branch}`} aria-label={`Delete branch ${branch}`} onClick={() => { setBranchMenuOpen(false); void handleDeleteBranch(branch); }}><Trash2 size={11} /></button>
              </>}
            </div>;
          })}
          </div>
          <form className="source-control-branch-form" onSubmit={(event) => void handleCreateBranch(event)}>
            <input value={branchInput} onChange={(event) => setBranchInput(event.target.value)} placeholder="New branch name" aria-label="New branch name" maxLength={240} />
            <button className="source-control-primary-button" type="submit" disabled={!branchInput.trim() || isLoading}>Create</button>
          </form>
        </div>}
      </div>
      <span className="source-control-inline-actions" title={`${status?.ahead || 0} commits ahead, ${status?.behind || 0} behind`}>
        <span className="source-control-count" aria-label={`${status?.ahead || 0} commits ahead`}><ArrowUp size={9} />{status?.ahead || 0}</span>
        <span className="source-control-count" aria-label={`${status?.behind || 0} commits behind`}><ArrowDown size={9} />{status?.behind || 0}</span>
      </span>
    </div>

    <div className="source-control-credential-note" style={{ padding: '6px 9px 0' }} title="Credentials are supplied by your operating system's configured Git credential helper; Ty-Code does not store remote passwords or tokens.">
      <ShieldCheck size={11} /><span>{remoteConfigured ? `GitHub, GitLab & Bitbucket credentials use your OS Git helper · ${remotes.map((remote) => remote.provider || 'remote').join(', ')}` : 'No remote configured. Add a remote in the terminal; credentials remain in your OS Git helper.'}</span>
    </div>
    {isNestedWorkspace && <div className="source-control-status" role="note">Changes, commits, and stashes are limited to this folder. Remote sync still affects the whole Git repository.</div>}

    {operationStatus && <div className="source-control-status" role="status">{operationStatus}</div>}
    {error && <div className="source-control-error" role="alert"><span>{error}</span><button onClick={clearError} aria-label="Dismiss error"><X size={12} /></button></div>}

    {view === 'changes' ? <div id="git-panel-changes" className="source-control-view-panel" role="tabpanel" aria-labelledby="git-tab-changes">
      <form className="source-control-commit-box" onSubmit={(event) => void handleCommit(event)}>
        <div className="source-control-prefixes" aria-label="Conventional commit types">
          {['feat', 'fix', 'docs', 'refactor', 'test', 'chore'].map((prefix) => <button key={prefix} type="button" onClick={() => insertPrefix(prefix)}>{prefix}</button>)}
        </div>
        <textarea ref={commitRef} value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void handleCommit();
        }} placeholder="Commit message (Ctrl+Enter)" rows={3} aria-label="Git commit message" />
        <button className="source-control-commit-button" type="submit" disabled={!canCommit || isLoading}>
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
          {stagedCount > 0 ? `Commit ${stagedCount} staged file${stagedCount === 1 ? '' : 's'}` : 'Stage all & commit'}
        </button>
      </form>
      <div className="source-control-scroll">
        {conflictCount > 0 && <section className="source-control-section">
          {renderSectionHeader('conflicts', 'MERGE CONFLICTS', conflictCount, 'is-conflict')}
          {!collapsed.conflicts && status?.conflictedFiles.map((file) => <div key={file.path} className="source-control-conflict-box">
            <button className="source-control-file-row" style={{ width: '100%' }} onClick={() => openConflictFile(file.path)} title="Inspect conflict stages">
              <AlertTriangle size={12} /><span className="source-control-file-name"><strong>{fileName(file.path)}</strong><small>{fileDirectory(file.path)}</small></span>{renderStatus(file.status)}
            </button>
          </div>)}
        </section>}
        {stagedCount > 0 && <section className="source-control-section">{renderSectionHeader('staged', 'STAGED CHANGES', stagedCount)}{!collapsed.staged && status?.stagedFiles.map((file) => renderFileRow(file, 'staged'))}</section>}
        {unstagedCount > 0 && <section className="source-control-section">{renderSectionHeader('unstaged', 'CHANGES', unstagedCount)}{!collapsed.unstaged && status?.unstagedFiles.map((file) => renderFileRow(file, 'unstaged'))}</section>}
        {untrackedCount > 0 && <section className="source-control-section">{renderSectionHeader('untracked', 'UNTRACKED', untrackedCount)}{!collapsed.untracked && status?.untrackedFiles.map((file) => renderFileRow(file, 'untracked'))}</section>}
        <section className="source-control-section">
          {renderSectionHeader('stashes', 'STASHES', stashes.length)}
          {!collapsed.stashes && <>
            <form className="source-control-mini-form" onSubmit={async (event) => { event.preventDefault(); if (await stashChanges(stashMessage)) setStashMessage(''); }}>
              <input value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} placeholder="Optional stash message" aria-label="Stash message" maxLength={200} />
              <button className="source-control-subtle-button" type="submit" disabled={!totalChanges || isLoading}><Archive size={11} />Save</button>
            </form>
            {stashes.map((stash) => <div className="source-control-list-item" key={`${stash.hash}-${stash.index}`} title={stash.message}>
              <Archive size={11} /><span>{stash.message || 'WIP changes'}</span><code>{stash.hash.slice(0, 7)}</code>
              <button aria-label={`Apply stash ${stash.index}`} title="Pop and apply stash" onClick={() => void popStash(stash.index)}><ArrowDown size={11} /></button>
              <button aria-label={`Drop stash ${stash.index}`} title="Drop stash" onClick={() => setConfirmAction({ title: 'Drop stash?', message: `Drop stash “${stash.message}”? This cannot be undone.`, actionLabel: 'Drop stash', onConfirm: () => dropStash(stash.index) })}><Trash2 size={11} /></button>
            </div>)}
            {stashes.length === 0 && <div className="source-control-empty">No saved stashes.</div>}
          </>}
        </section>
        <section className="source-control-section">
          {renderSectionHeader('tags', 'TAGS', tags.length)}
          {!collapsed.tags && <>
            <form className="source-control-mini-form" onSubmit={(event) => void handleCreateTag(event)}>
              <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="New tag name" aria-label="New tag name" maxLength={240} />
              <button className="source-control-subtle-button" type="submit" disabled={!tagName.trim() || isLoading}><Tag size={11} />Create</button>
            </form>
            {tags.map((item) => <div className="source-control-list-item" key={item.name} title={`${item.name} · ${item.commit}`}>
              <Tag size={11} /><span>{item.name}</span><code>{item.commit.slice(0, 7)}</code>
              <button aria-label={`Delete tag ${item.name}`} title="Delete tag" onClick={() => setConfirmAction({ title: 'Delete tag?', message: `Delete tag “${item.name}”? This cannot be undone.`, actionLabel: 'Delete tag', onConfirm: () => deleteTag(item.name) })}><Trash2 size={11} /></button>
            </div>)}
            {tags.length === 0 && <div className="source-control-empty">No tags yet.</div>}
          </>}
        </section>
        {totalChanges === 0 && <div className="source-control-empty"><Check size={26} /><strong>Working tree clean</strong><span>No pending changes or merge conflicts.</span></div>}
      </div>
    </div> : <div id="git-panel-history" className="source-control-view-panel" role="tabpanel" aria-labelledby="git-tab-history"><div className="source-control-scroll">
      <label className="source-control-search"><Search size={12} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search commits…" aria-label="Search commit history" /></label>
      {isLoading && commits.length === 0 ? <div className="source-control-empty"><Loader2 size={14} className="animate-spin" />Loading history…</div>
        : commits.length === 0 ? <div className="source-control-empty"><History size={20} /><strong>No commits found</strong><span>Try another message or author search.</span></div>
          : commits.map((commit) => <button key={commit.hash} className={`source-control-history-row${commitDetail?.commit.hash === commit.hash ? ' is-selected' : ''}`} onClick={() => void loadCommitDetail(commit.hash)}>
            <GitCommit size={12} /><span><strong>{commit.message}</strong><small>{commit.shortHash} · {commit.authorName} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(commit.date))}</small></span>
          </button>)}
      {commitDetail && <div className="source-control-history-detail">
        <h3>{commitDetail.commit.message}</h3>
        <p>{commitDetail.commit.hash} · {commitDetail.commit.authorName} &lt;{commitDetail.commit.authorEmail}&gt; · {new Date(commitDetail.commit.date).toLocaleString()}</p>
        <strong style={{ display: 'block', marginBottom: 5, color: 'var(--text-secondary)', fontSize: 10 }}>FILES CHANGED · {commitDetail.files.length}</strong>
        {commitDetail.files.map((file) => <div className="source-control-list-item" key={`${file.path}-${file.status}`}>{file.status === 'A' ? <FilePlus size={11} /> : file.status === 'D' ? <FileMinus size={11} /> : <FileCode size={11} />}<span title={file.path}>{file.path}</span></div>)}
        <pre>{commitDetail.diff || 'No patch details available.'}</pre>
      </div>}
      {remoteConfigured && <div className="source-control-list-item" title="Remote URLs are sanitized; authentication remains in Git's credential helper."><ShieldCheck size={11} /><span>{remotes.map((remote) => `${remote.name} (${remote.provider || 'remote'})`).join(', ')}</span></div>}
      </div></div>}

    {confirmAction && <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmAction(null); }}>
      <section className="source-control-modal" role="alertdialog" aria-modal="true" aria-labelledby="git-confirm-title" aria-describedby="git-confirm-description">
        <div className="source-control-modal-heading"><h2 id="git-confirm-title">{confirmAction.title}</h2><button className="source-control-icon-button" aria-label="Close confirmation" onClick={() => setConfirmAction(null)}><X size={13} /></button></div>
        <p id="git-confirm-description" style={{ margin: '10px 0', color: 'var(--text-secondary)', fontSize: 11 }}>{confirmAction.message}</p>
        <div className="source-control-modal-footer"><button className="source-control-subtle-button" onClick={() => setConfirmAction(null)}>Cancel</button><button className="source-control-danger-button" onClick={async () => { const pending = confirmAction; setConfirmAction(null); await pending.onConfirm(); }}>{confirmAction.actionLabel}</button></div>
      </section>
    </div>}

    {discardTarget && <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiscardTarget(null); }}>
      <section className="source-control-modal" role="alertdialog" aria-modal="true" aria-labelledby="git-discard-title" aria-describedby="git-discard-description">
        <div className="source-control-modal-heading"><h2 id="git-discard-title">Discard changes?</h2><button className="source-control-icon-button" aria-label="Close confirmation" onClick={() => setDiscardTarget(null)}><X size={13} /></button></div>
        <p id="git-discard-description" style={{ margin: '10px 0', color: 'var(--text-secondary)', fontSize: 11 }}>Discard changes in <strong>{discardTarget.path}</strong>? This action cannot be undone.</p>
        <div className="source-control-modal-footer"><button className="source-control-subtle-button" onClick={() => setDiscardTarget(null)}>Cancel</button><button className="source-control-danger-button" onClick={async () => { const target = discardTarget; setDiscardTarget(null); await discardChanges(target.path, target.status === 'U'); }}>Discard</button></div>
      </section>
    </div>}

    {activeConflict && <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConflict(); }}>
      <section className="source-control-modal" role="dialog" aria-modal="true" aria-labelledby="git-conflict-title">
        <div className="source-control-modal-heading"><h2 id="git-conflict-title">Resolve conflict · {activeConflict.filePath}</h2><button className="source-control-icon-button" aria-label="Close conflict details" onClick={closeConflict}><X size={13} /></button></div>
        <pre>{activeConflict.workingContent || 'The working file is empty or was deleted.'}</pre>
        <div className="source-control-modal-footer">
          <button className="source-control-subtle-button" onClick={() => { openFile(fullWorkspacePath(workspacePath, activeConflict.filePath), fileName(activeConflict.filePath)); closeConflict(); }}>Open in editor</button>
          <button className="source-control-subtle-button" disabled={!activeConflict.oursContent} onClick={() => { if (window.confirm('Replace the working file with the current branch version?')) void resolveConflict(activeConflict.filePath, 'ours'); }}>Accept Current</button>
          <button className="source-control-subtle-button" disabled={!activeConflict.theirsContent} onClick={() => { if (window.confirm('Replace the working file with the incoming branch version?')) void resolveConflict(activeConflict.filePath, 'theirs'); }}>Accept Incoming</button>
          <button className="source-control-primary-button" onClick={() => void resolveConflict(activeConflict.filePath, 'mark-resolved')}>Mark resolved (stage)</button>
        </div>
      </section>
    </div>}
  </div>;
};
