import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight,
  FileCode, FileMinus, FilePlus, FolderPlus, GitBranch, GitMerge, History, Loader2,
  Minus, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Sparkles, Tag, Trash2, X
} from 'lucide-react';
import { useGitStore, type GitRepoState } from '../state/git-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import { computeGraphRows, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT, type GraphRow } from '../services/git-graph-lanes';
import { WorkspaceGate } from './common/WorkspaceGate';
import type { GitFileChange, GitRepositoryInfo } from '../../../preload/types';
import './SourceControlPanel.css';

type HeadlineSection = 'repos' | 'graph' | 'npm';
type ChangeSection = 'conflicts' | 'staged' | 'unstaged' | 'untracked' | 'stashes' | 'tags';
type PanelMenu = { kind: 'repo' | 'commit'; root: string; top: number; left: number } | null;

const SECTION_LABELS: Record<ChangeSection, string> = {
  conflicts: 'MERGE CONFLICTS',
  staged: 'STAGED CHANGES',
  unstaged: 'CHANGES',
  untracked: 'UNTRACKED',
  stashes: 'STASHES',
  tags: 'TAGS'
};

function fullWorkspacePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  const root = workspacePath.replace(/[\\/]+$/, '');
  return `${root}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function fileDirectory(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index >= 0 ? filePath.slice(0, index) : '';
}

function formatGraphTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp * 1000));
}

function repoChangeCount(state: GitRepoState | undefined): number {
  return state?.status
    ? state.status.stagedFiles.length + state.status.unstagedFiles.length + state.status.untrackedFiles.length + state.status.conflictedFiles.length
    : 0;
}

export const SourceControlPanel: React.FC = () => {
  const {
    repositories, activeRepoRoot, repoStates, commitMessages, applyingSuggestion,
    listRepositories, setActiveRepo, refreshStatus, suggestCommitMessage,
    stageFile, unstageFile, discardChanges, createCommit, fetchBranches, switchBranch,
    createBranch, deleteBranch, mergeBranch, fetchRemote, pullRemote, pushRemote, syncRepo,
    loadGraph, loadCommitDetail, createTag, deleteTag, stashChanges, popStash, dropStash,
    initRepo, loadConflict, closeConflict, resolveConflict, abortMerge
  } = useGitStore();
  const { workspacePath, openFile } = useWorkspaceStore();
  const isWorkspaceReady = useWorkspaceStore((s) => s.isWorkspaceReady);
  const error = useGitStore((s) => s.error);
  const clearError = useGitStore((s) => s.clearError);
  const commitDetail = useGitStore((s) => s.commitDetail);
  const activeConflict = useGitStore((s) => s.activeConflict);

  const [headlineCollapsed, setHeadlineCollapsed] = useState<Record<HeadlineSection, boolean>>({ repos: false, graph: false, npm: true });
  const [collapsedRepo, setCollapsedRepo] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<ChangeSection, boolean>>({ conflicts: false, staged: false, unstaged: false, untracked: false, stashes: true, tags: true });
  const [branchMenuOpen, setBranchMenuOpen] = useState<string | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState({ top: 0, left: 0 });
  const [branchInput, setBranchInput] = useState('');
  const [menu, setMenu] = useState<PanelMenu>(null);
  const [autoFetchGraph, setAutoFetchGraph] = useState(false);
  const [stashMessage, setStashMessage] = useState('');
  const [tagName, setTagName] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; actionLabel: string; onConfirm: () => Promise<unknown> } | null>(null);
  const [discardTarget, setDiscardTarget] = useState<{ file: GitFileChange; root: string } | null>(null);
  const [conflictRoot, setConflictRoot] = useState<string | null>(null);
  const [npmScripts, setNpmScripts] = useState<Array<{ name: string; command: string }> | null>(null);
  const [npmError, setNpmError] = useState('');
  const [graphSelection, setGraphSelection] = useState<string | null>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!workspacePath || !isWorkspaceReady) {
      useGitStore.getState().resetStatus();
      return;
    }
    void listRepositories(workspacePath).then((repos) => {
      const first = repos[0];
      if (first) void refreshStatus(first.root, true);
    });
    const timer = window.setInterval(() => {
      const root = useGitStore.getState().activeRepoRoot;
      if (root) void useGitStore.getState().refreshStatus(root);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isWorkspaceReady, listRepositories, refreshStatus, workspacePath]);

  useEffect(() => {
    for (const repo of repositories) {
      if (repo.root === activeRepoRoot) continue;
      if (!collapsedRepo[repo.root]) void refreshStatus(repo.root);
    }
  }, [activeRepoRoot, collapsedRepo, refreshStatus, repositories]);

  useEffect(() => {
    if (headlineCollapsed.graph || !activeRepoRoot) return;
    void loadGraph(activeRepoRoot, 150);
    if (!autoFetchGraph) return;
    const timer = window.setInterval(() => {
      const root = useGitStore.getState().activeRepoRoot;
      if (root) void useGitStore.getState().loadGraph(root, 150);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [activeRepoRoot, autoFetchGraph, headlineCollapsed.graph, loadGraph]);

  useEffect(() => {
    if (!workspacePath) return;
    setNpmScripts(null);
    setNpmError('');
  }, [workspacePath]);

  useEffect(() => {
    if (headlineCollapsed.npm || !workspacePath || npmScripts || npmError) return;
    const separator = workspacePath.includes('\\') ? '\\' : '/';
    void window.electronAPI?.readFile(`${workspacePath}${separator}package.json`).then((response) => {
      if (!response?.success || !response.data) {
        setNpmError('No package.json in the workspace root.');
        return;
      }
      let parsed: { scripts?: Record<string, string> } | null = null;
      try {
        parsed = JSON.parse(response.data) as { scripts?: Record<string, string> };
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') {
        setNpmError('package.json could not be parsed.');
        return;
      }
      const entries = Object.entries(parsed.scripts || {}).map(([name, command]) => ({ name, command }));
      setNpmScripts(entries);
      if (!entries.length) setNpmError('No npm scripts in package.json.');
    }).catch(() => setNpmError('No package.json in the workspace root.'));
  }, [headlineCollapsed.npm, npmError, npmScripts, workspacePath]);

  useEffect(() => {
    if (!menu && !branchMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.source-control-menu-floating')) return;
      setMenu(null);
      setBranchMenuOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setBranchMenuOpen(null);
        branchTriggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchMenuOpen, menu]);

  const openMenu = useCallback((kind: 'repo' | 'commit', root: string, event: React.MouseEvent) => {
    if (menu?.kind === kind && menu.root === root) {
      setMenu(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, root, top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 240) });
  }, [menu]);

  const toggleRepo = useCallback((repo: GitRepositoryInfo) => {
    const nextCollapsed = collapsedRepo[repo.root] ?? false;
    setCollapsedRepo((current) => ({ ...current, [repo.root]: !nextCollapsed }));
    if (nextCollapsed && useGitStore.getState().activeRepoRoot !== repo.root) {
      useGitStore.getState().setActiveRepo(repo.root);
      void refreshStatus(repo.root, true);
    }
  }, [collapsedRepo, refreshStatus]);

  const runNpmScript = useCallback((name: string) => {
    if (!workspacePath) return;
    window.dispatchEvent(new CustomEvent('tycode:run-terminal-command', { detail: { autoRunCommand: `npm run ${name}`, cwd: workspacePath } }));
    toast.info('NPM script', `npm run ${name} started in the terminal.`);
  }, [workspacePath]);

  const openDiff = useCallback((root: string, file: GitFileChange, staged: boolean) => {
    void useGitStore.getState().openFileDiff(file.path, staged, root);
  }, []);

  const handleCommit = async (root: string, options?: { amend?: boolean }): Promise<boolean> => {
    const ok = await createCommit(root, undefined, options);
    return ok;
  };

  const toggleSection = (section: ChangeSection) => {
    setCollapsed((current) => ({ ...current, [section]: !current[section] }));
  };

  const toggleHeadline = (section: HeadlineSection) => {
    setHeadlineCollapsed((current) => ({ ...current, [section]: !current[section] }));
  };

  const renderStatus = (fileStatus: GitFileChange['status']) => {
    const labels: Record<GitFileChange['status'], string> = {
      M: 'Modified', A: 'Added', D: 'Deleted', U: 'Untracked', C: 'Conflict', R: 'Renamed', '?': 'Untracked'
    };
    const letter = fileStatus === 'C' ? '!' : fileStatus === '?' ? 'U' : fileStatus;
    return (
      <span
        className={`source-control-status-letter is-${letter === '!' ? 'C' : letter}`}
        data-testid={`git-status-letter-${fileStatus}`}
        aria-label={labels[fileStatus]}
      >
        {letter}
      </span>
    );
  };

  const renderFileRow = (root: string, file: GitFileChange, category: 'staged' | 'unstaged' | 'untracked') => {
    const staged = category === 'staged';
    return (
      <div key={`${category}-${file.path}`} className="source-control-file-row">
        <button type="button" className="source-control-file-open" aria-label={`Open diff for ${file.path}`} onClick={() => openDiff(root, file, staged)}>
          <FileCode size={13} aria-hidden="true" />
          <span className="source-control-file-name" title={file.path}>
            <strong>{fileName(file.path)}</strong>
            {fileDirectory(file.path) && <small>{fileDirectory(file.path)}</small>}
          </span>
        </button>
        <span className="source-control-row-actions">
          {staged ? (
            <button aria-label={`Unstage ${file.path}`} title="Unstage changes" onClick={(event) => { event.stopPropagation(); void unstageFile(root, file.path); }}><Minus size={12} /></button>
          ) : (
            <>
              <button className="is-danger" aria-label={`Discard ${file.path}`} title="Discard changes" onClick={(event) => { event.stopPropagation(); setDiscardTarget({ file, root }); }}><RotateCcw size={12} /></button>
              <button aria-label={`Stage ${file.path}`} title="Stage changes" onClick={(event) => { event.stopPropagation(); void stageFile(root, file.path); }}><Plus size={12} /></button>
            </>
          )}
        </span>
        {renderStatus(file.status)}
      </div>
    );
  };

  const renderFileSectionHeader = (section: ChangeSection, count: number, colorClass = '', action?: React.ReactNode) => (
    <div className="source-control-section-heading">
      <button className="source-control-section-toggle" aria-expanded={!collapsed[section]} onClick={() => toggleSection(section)}>
        {collapsed[section] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>{SECTION_LABELS[section]}</span>
        <span className={`source-control-count ${colorClass}`}>{count}</span>
      </button>
      {action}
    </div>
  );

  const renderGraphRow = (row: GraphRow) => (
    <button
      key={row.commit.hash}
      className={`source-control-graph-row${graphSelection === row.commit.hash ? ' is-selected' : ''}`}
      style={{ height: GRAPH_ROW_HEIGHT }}
      onClick={() => {
        setGraphSelection(row.commit.hash);
        const root = activeRepoRoot;
        if (root) void loadCommitDetail(root, row.commit.hash);
      }}
      title={`${row.commit.message} · ${row.commit.authorName}`}
    >
      <strong className="source-control-graph-message">{row.commit.message.length > 64 ? `${row.commit.message.slice(0, 64)}…` : row.commit.message}</strong>
      {row.commit.refs.branches.map((branch) => <span key={branch} className="source-control-branch-badge">{branch}</span>)}
      {row.commit.refs.remoteBranches.slice(0, 2).map((remote) => <span key={remote} className="source-control-remote-badge">{remote}</span>)}
      {row.commit.refs.tags.slice(0, 2).map((tag) => <span key={tag} className="source-control-tag-badge">{tag}</span>)}
      <span className="source-control-graph-meta">{row.commit.authorName} · {formatGraphTime(row.commit.timestamp)}</span>
    </button>
  );

  const renderGraphSection = (repoState: GitRepoState | undefined) => {
    const layout = repoState ? computeGraphRows(repoState.graph) : { rows: [], laneCount: 1 };
    return (
      <div className="source-control-graph">
        <div className="source-control-graph-toolbar">
          <button className={`source-control-fetch-mode${autoFetchGraph ? ' is-auto' : ''}`} aria-pressed={autoFetchGraph} onClick={() => setAutoFetchGraph((on) => !on)}>
            {autoFetchGraph ? 'Auto fetch' : 'Manual'}
          </button>
          <span className="source-control-graph-actions">
            <button className="source-control-icon-button" title="Fetch" aria-label="Fetch from remote" disabled={!repoState?.remotes.length || repoState?.isSyncing} onClick={() => void fetchRemote(activeRepoRoot || '')}><ArrowDown size={12} /></button>
            <button className="source-control-icon-button" title="Pull" aria-label="Pull from remote" disabled={!repoState?.remotes.length || repoState?.isSyncing} onClick={() => void pullRemote(activeRepoRoot || '')}><ArrowDown size={12} /></button>
            <button className="source-control-icon-button" title="Push" aria-label="Push to remote" disabled={!repoState?.remotes.length || repoState?.isSyncing} onClick={() => void pushRemote(activeRepoRoot || '')}><ArrowUp size={12} /></button>
            <button className="source-control-icon-button" title="Refresh graph" aria-label="Refresh graph" disabled={!activeRepoRoot} onClick={() => { if (activeRepoRoot) void loadGraph(activeRepoRoot, 150); }}>
              {repoState?.graphLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </span>
        </div>
        {repoState?.graphLoading && repoState.graph.length === 0 ? (
          <div className="source-control-empty"><Loader2 size={13} className="animate-spin" />Loading graph…</div>
        ) : layout.rows.length === 0 ? (
          <div className="source-control-empty"><History size={18} /><strong>No graph yet</strong><span>Commits appear here once the repository has history.</span></div>
        ) : (
          <div className="source-control-graph-body" style={{ maxHeight: 340 }}>
            <svg className="source-control-graph-canvas" width={layout.laneCount * GRAPH_LANE_WIDTH + 8} height={layout.rows.length * GRAPH_ROW_HEIGHT} aria-hidden="true">
              {layout.rows.map((row, index) => {
                const y = index * GRAPH_ROW_HEIGHT;
                const laneX = (lane: number) => 8 + lane * GRAPH_LANE_WIDTH;
                const midY = y + GRAPH_ROW_HEIGHT / 2;
                return (
                  <g key={row.commit.hash}>
                    {row.through.map((lane) => <line key={lane} x1={laneX(lane)} y1={y} x2={laneX(lane)} y2={y + GRAPH_ROW_HEIGHT} className="source-control-graph-line" />)}
                    {row.edges.map((edge, edgeIndex) => (
                      <path key={edgeIndex} d={`M ${laneX(edge.from)} ${midY} C ${laneX(edge.from)} ${y + GRAPH_ROW_HEIGHT} ${laneX(edge.to)} ${y + GRAPH_ROW_HEIGHT} ${laneX(edge.to)} ${y + GRAPH_ROW_HEIGHT}`} className="source-control-graph-line" />
                    ))}
                    <circle cx={laneX(row.lane)} cy={midY} r={4} className={`source-control-graph-dot${row.commit.refs.isHead ? ' is-head' : ''}`} />
                  </g>
                );
              })}
            </svg>
            <div className="source-control-graph-rows" style={{ paddingLeft: layout.laneCount * GRAPH_LANE_WIDTH + 16 }}>
              {layout.rows.map((row) => renderGraphRow(row))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderNpmSection = () => (
    <div className="source-control-npm">
      {npmScripts === null && !npmError ? (
        <div className="source-control-empty"><Loader2 size={13} className="animate-spin" />Loading scripts…</div>
      ) : npmError ? (
        <div className="source-control-empty">{npmError}</div>
      ) : (
        (npmScripts || []).map((script) => (
          <div key={script.name} className="source-control-npm-row" title={script.command}>
            <span className="source-control-npm-name">{script.name}</span>
            <code className="source-control-npm-command">{script.command}</code>
            <button className="source-control-icon-button" title={`Run npm run ${script.name}`} aria-label={`Run ${script.name}`} onClick={() => runNpmScript(script.name)}><Play size={12} /></button>
          </div>
        ))
      )}
    </div>
  );

  const renderRepo = (repo: GitRepositoryInfo) => {
    const repoState = repoStates[repo.root];
    const isRepo = Boolean(repoState?.status?.isRepo);
    const isCollapsed = collapsedRepo[repo.root] ?? false;
    const changes = repoChangeCount(repoState);
    const draft = commitMessages[repo.root] || '';
    const staged = repoState?.status?.stagedFiles || [];
    const unstaged = repoState?.status?.unstagedFiles || [];
    const untracked = repoState?.status?.untrackedFiles || [];
    const conflicts = repoState?.status?.conflictedFiles || [];
    const actionable = staged.length + unstaged.length + untracked.length;
    const canCommit = Boolean(draft.trim()) && actionable > 0 && conflicts.length === 0;
    const hasRemote = (repoState?.remotes.length || 0) > 0;
    return (
      <div key={repo.root} className="source-control-repo" data-kind={repo.kind}>
        <div className="source-control-repo-row">
          <button className="source-control-repo-toggle" aria-expanded={!isCollapsed} onClick={() => toggleRepo(repo)}>
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span className="source-control-repo-name" title={repo.root}>{repo.name}</span>
            {changes > 0 && <span className="source-control-repo-badge">{changes}</span>}
          </button>
          <span className="source-control-row-actions">
            {isRepo && (repoState?.status?.ahead || repoState?.status?.behind) ? (
              <span className="source-control-inline-counts" title={`${repoState?.status?.ahead} ahead, ${repoState?.status?.behind} behind`}>
                {repoState?.status?.ahead ? <span className="source-control-count"><ArrowUp size={9} />{repoState.status.ahead}</span> : null}
                {repoState?.status?.behind ? <span className="source-control-count"><ArrowDown size={9} />{repoState.status.behind}</span> : null}
              </span>
            ) : null}
            <button className="source-control-icon-button" title="Fetch" aria-label={`Fetch ${repo.name}`} disabled={!hasRemote || repoState?.isSyncing} onClick={() => void fetchRemote(repo.root)}><ArrowDown size={12} /></button>
            <button className="source-control-icon-button" title="More repository actions" aria-label={`Repository actions for ${repo.name}`} onClick={(event) => openMenu('repo', repo.root, event)}><MoreHorizontal size={13} /></button>
          </span>
        </div>
        {!isCollapsed && (
          repoState?.isLoading && !repoState?.status ? (
            <div className="source-control-empty"><Loader2 size={12} className="animate-spin" />Checking repository…</div>
          ) : !isRepo ? (
            <div className="source-control-repo-body">
              <div className="source-control-empty">
                <FolderPlus size={24} />
                <strong>No Git repository</strong>
                <span>Initialize a repository in “{repo.name}” to enable source control.</span>
                <button className="source-control-primary-button" disabled={repoState?.isLoading} onClick={() => void initRepo(repo.root)}>
                  <GitBranch size={12} />{repoState?.isLoading ? 'Initializing…' : 'Initialize Repository'}
                </button>
              </div>
            </div>
          ) : (
            <div className="source-control-repo-body">
              <div className="source-control-toolstrip">
                <button className="source-control-icon-button" title="Discard all uncommitted changes" aria-label="Discard all changes" disabled={repoState?.isLoading || changes === 0} onClick={() => setConfirmAction({
                  title: 'Discard all changes?',
                  message: `Discard every uncommitted change in “${repo.name}”? This cannot be undone.`,
                  actionLabel: 'Discard all',
                  onConfirm: async () => {
                    const files = [...unstaged, ...untracked];
                    for (const file of files) await discardChanges(repo.root, file.path, file.status === 'U' || file.status === '?');
                  }
                })}><RotateCcw size={12} /></button>
                <button className="source-control-icon-button" title="Stage all changes" aria-label="Stage all changes" disabled={repoState?.isLoading || actionable === 0} onClick={() => void stageFile(repo.root, '.')}><Plus size={12} /></button>
                <button className="source-control-icon-button" title="Generate commit message" aria-label="Generate commit message" disabled={repoState?.isLoading || Boolean(applyingSuggestion[repo.root]) || actionable === 0} onClick={() => void suggestCommitMessage(repo.root)}>
                  {applyingSuggestion[repo.root] ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                </button>
                <button className="source-control-icon-button" title="Pull" aria-label="Pull" disabled={!hasRemote || repoState?.isSyncing} onClick={() => void pullRemote(repo.root)}><ArrowDown size={12} /></button>
                <button className="source-control-icon-button" title="Sync (pull + push)" aria-label="Sync repository" disabled={!hasRemote || repoState?.isSyncing} onClick={() => void syncRepo(repo.root)}><RefreshCw size={12} /></button>
                <span className="source-control-toolstrip-spacer" />
                <button
                  ref={repo.root === activeRepoRoot ? branchTriggerRef : undefined}
                  className="source-control-branch-trigger is-compact"
                  aria-expanded={branchMenuOpen === repo.root}
                  aria-haspopup="true"
                  onMouseDown={(event) => {
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    setBranchMenuPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)) });
                    setBranchMenuOpen(branchMenuOpen === repo.root ? null : repo.root);
                    void fetchBranches(repo.root);
                  }}
                >
                  <GitBranch size={11} />
                  <span>{repoState?.status?.currentBranch || 'HEAD'}</span>
                  <ChevronDown size={10} />
                </button>
              </div>
              <div className="source-control-commit-box">
                <div className="source-control-commit-row">
                  <textarea
                    value={draft}
                    onChange={(event) => useGitStore.getState().setCommitMessage(event.target.value, repo.root)}
                    placeholder={`Message (Ctrl+Enter to commit on ${repo.name})`}
                    rows={2}
                    aria-label={`Commit message for ${repo.name}`}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
                        event.preventDefault();
                        void handleCommit(repo.root);
                      }
                    }}
                  />
                </div>
                <div className="source-control-commit-actions">
                  <button className="source-control-subtle-button" disabled={applyingSuggestion[repo.root] || actionable === 0} onClick={() => void suggestCommitMessage(repo.root)}>
                    {applyingSuggestion[repo.root] ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}Generate
                  </button>
                  <span className="source-control-toolstrip-spacer" />
                  <button className="source-control-commit-button" disabled={!canCommit || repoState?.isLoading} onClick={() => void handleCommit(repo.root)}>
                    {repoState?.isLoading ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />}
                    {staged.length > 0 ? `Commit ${staged.length}` : 'Commit'}
                  </button>
                  <button className="source-control-icon-button source-control-commit-caret" title="Commit options" aria-label="Commit options" disabled={repoState?.isLoading || !draft.trim()} onClick={(event) => openMenu('commit', repo.root, event)}><ChevronDown size={12} /></button>
                </div>
              </div>
              {repoState?.operationStatus && <div className="source-control-status" role="status">{repoState.operationStatus}</div>}
              {repoState?.error && <div className="source-control-error" role="alert"><span>{repoState.error}</span><button onClick={() => useGitStore.getState().clearRepoError(repo.root)} aria-label="Dismiss error"><X size={12} /></button></div>}
              {repo.kind === 'parent' && <div className="source-control-status" role="note">This repository is a parent of the loaded folder; files are relative to the workspace.</div>}
              <div className="source-control-scroll">
                {conflicts.length > 0 && (
                  <section className="source-control-section">
                    {renderFileSectionHeader('conflicts', conflicts.length, 'is-conflict', (
                      <button className="source-control-danger-button" onClick={() => setConfirmAction({
                        title: 'Abort merge?',
                        message: 'Abort the current merge and restore the state from before it started?',
                        actionLabel: 'Abort merge',
                        onConfirm: () => abortMerge(repo.root)
                      })}>Abort merge</button>
                    ))}
                    {!collapsed.conflicts && conflicts.map((file) => (
                      <div key={file.path} className="source-control-conflict-box">
                        <button className="source-control-file-open" style={{ width: '100%' }} onClick={() => { setConflictRoot(repo.root); void loadConflict(file.path, repo.root); }} title="Inspect conflict stages">
                          <AlertTriangle size={12} />
                          <span className="source-control-file-name"><strong>{fileName(file.path)}</strong>{fileDirectory(file.path) && <small>{fileDirectory(file.path)}</small>}</span>
                          {renderStatus(file.status)}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                {staged.length > 0 && (
                  <section className="source-control-section">
                    {renderFileSectionHeader('staged', staged.length, '', (
                      <button className="source-control-icon-button" title="Unstage all" aria-label="Unstage all files" onClick={() => void unstageFile(repo.root, staged.map((file) => file.path))}><Minus size={13} /></button>
                    ))}
                    {!collapsed.staged && staged.map((file) => renderFileRow(repo.root, file, 'staged'))}
                  </section>
                )}
                {unstaged.length > 0 && (
                  <section className="source-control-section">
                    {renderFileSectionHeader('unstaged', unstaged.length, '', (
                      <button className="source-control-icon-button" title="Stage all changed files" aria-label="Stage all changes" onClick={() => void stageFile(repo.root, unstaged.map((file) => file.path))}><Plus size={13} /></button>
                    ))}
                    {!collapsed.unstaged && unstaged.map((file) => renderFileRow(repo.root, file, 'unstaged'))}
                  </section>
                )}
                {untracked.length > 0 && (
                  <section className="source-control-section">
                    {renderFileSectionHeader('untracked', untracked.length, '', (
                      <button className="source-control-icon-button" title="Stage all untracked files" aria-label="Stage all untracked files" onClick={() => void stageFile(repo.root, untracked.map((file) => file.path))}><Plus size={13} /></button>
                    ))}
                    {!collapsed.untracked && untracked.map((file) => renderFileRow(repo.root, file, 'untracked'))}
                  </section>
                )}
                <section className="source-control-section">
                  <div className="source-control-section-heading">
                    <button className="source-control-section-toggle" aria-expanded={!collapsed.stashes} onClick={() => setCollapsed((current) => ({ ...current, stashes: !current.stashes }))}>
                      {collapsed.stashes ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span>STASHES</span>
                      <span className="source-control-count">{repoState?.stashes.length || 0}</span>
                    </button>
                  </div>
                  {!collapsed.stashes && (
                    <>
                      <form className="source-control-mini-form" onSubmit={async (event) => { event.preventDefault(); if (await stashChanges(repo.root, stashMessage || undefined)) setStashMessage(''); }}>
                        <input value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} placeholder="Optional stash message" aria-label="Stash message" maxLength={200} />
                        <button className="source-control-subtle-button" type="submit" disabled={!changes || repoState?.isLoading}><Archive size={11} />Save</button>
                      </form>
                      {(repoState?.stashes || []).map((stash) => (
                        <div className="source-control-list-item" key={`${stash.hash}-${stash.index}`} title={`${stash.message || 'WIP changes'} · ${stash.date}`}>
                          <Archive size={11} /><span className="source-control-list-label">{stash.message || 'WIP changes'}</span><code>{stash.hash.slice(0, 7)}</code>
                          <button aria-label={`Apply stash ${stash.index}`} title="Pop and apply stash" onClick={() => void popStash(repo.root, stash.index)}><ArrowDown size={11} /></button>
                          <button aria-label={`Drop stash ${stash.index}`} title="Drop stash" onClick={() => setConfirmAction({ title: 'Drop stash?', message: `Drop stash “${stash.message}”? This cannot be undone.`, actionLabel: 'Drop stash', onConfirm: () => dropStash(repo.root, stash.index) })}><Trash2 size={11} /></button>
                        </div>
                      ))}
                      {(repoState?.stashes.length || 0) === 0 && <div className="source-control-empty">No saved stashes.</div>}
                    </>
                  )}
                </section>
                <section className="source-control-section">
                  <div className="source-control-section-heading">
                    <button className="source-control-section-toggle" aria-expanded={!collapsed.tags} onClick={() => setCollapsed((current) => ({ ...current, tags: !current.tags }))}>
                      {collapsed.tags ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span>TAGS</span>
                      <span className="source-control-count">{repoState?.tags.length || 0}</span>
                    </button>
                  </div>
                  {!collapsed.tags && (
                    <>
                      <form className="source-control-mini-form" onSubmit={async (event) => { event.preventDefault(); if (!tagName.trim()) return; if (await createTag(repo.root, tagName.trim())) setTagName(''); }}>
                        <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="New tag name" aria-label="New tag name" maxLength={240} />
                        <button className="source-control-subtle-button" type="submit" disabled={!tagName.trim() || repoState?.isLoading}><Tag size={11} />Create</button>
                      </form>
                      {(repoState?.tags || []).map((tag) => (
                        <div className="source-control-list-item" key={tag.name} title={`${tag.name} · ${tag.commit}`}>
                          <Tag size={11} /><span className="source-control-list-label">{tag.name}</span><code>{tag.commit.slice(0, 7)}</code>
                          <button aria-label={`Delete tag ${tag.name}`} title="Delete tag" onClick={() => setConfirmAction({ title: 'Delete tag?', message: `Delete tag “${tag.name}”? This cannot be undone.`, actionLabel: 'Delete tag', onConfirm: () => deleteTag(repo.root, tag.name) })}><Trash2 size={11} /></button>
                        </div>
                      ))}
                      {(repoState?.tags.length || 0) === 0 && <div className="source-control-empty">No tags yet.</div>}
                    </>
                  )}
                </section>
                {changes === 0 && repoState.status?.isClean && conflicts.length === 0 && (
                  <div className="source-control-empty"><Check size={22} /><strong>Working tree clean</strong><span>No pending changes or merge conflicts.</span></div>
                )}
              </div>
              {branchMenuOpen === repo.root && repoState.status && (
                <div className="source-control-branch-menu source-control-menu-floating" style={branchMenuPosition} role="group" aria-label="Git branch actions">
                  <div className="source-control-menu-heading">LOCAL BRANCHES</div>
                  <div className="source-control-branch-items" role="menu" aria-label="Local branches">
                    {(repoState.branches?.all || []).map((branch) => {
                      const current = branch === repoState.status?.currentBranch;
                      return (
                        <div key={branch} className={`source-control-branch-row${current ? ' is-current' : ''}`}>
                          <button role="menuitemradio" aria-checked={current} title={`Switch to ${branch}`} onClick={() => { if (!current) void switchBranch(repo.root, branch); setBranchMenuOpen(null); }}>
                            <GitBranch size={11} /><span>{branch}</span>{current && <Check size={11} />}
                          </button>
                          {!current && (
                            <>
                              <button role="menuitem" title={`Merge ${branch} into current branch`} aria-label={`Merge ${branch} into current branch`} onClick={() => { setBranchMenuOpen(null); setConfirmAction({ title: 'Merge branch?', message: `Merge “${branch}” into “${repoState.status?.currentBranch}”?`, actionLabel: 'Merge branch', onConfirm: () => mergeBranch(repo.root, branch) }); }}><GitMerge size={11} /></button>
                              <button role="menuitem" className="is-danger" title={`Delete ${branch}`} aria-label={`Delete branch ${branch}`} onClick={() => { setBranchMenuOpen(null); setConfirmAction({ title: 'Delete branch?', message: `Delete local branch “${branch}”? This cannot be undone.`, actionLabel: 'Delete branch', onConfirm: () => deleteBranch(repo.root, branch) }); }}><Trash2 size={11} /></button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <form className="source-control-branch-form" onSubmit={async (event) => {
                    event.preventDefault();
                    const name = branchInput.trim();
                    if (!name) return;
                    if (await createBranch(repo.root, name)) {
                      setBranchInput('');
                      setBranchMenuOpen(null);
                    }
                  }}>
                    <input value={branchInput} onChange={(event) => setBranchInput(event.target.value)} placeholder="New branch name" aria-label="New branch name" maxLength={240} />
                    <button className="source-control-primary-button" type="submit" disabled={!branchInput.trim() || repoState?.isLoading}>Create</button>
                  </form>
                </div>
              )}
            </div>
          )
        )}
      </div>
    );
  };

  const activeRepoState = activeRepoRoot ? repoStates[activeRepoRoot] : undefined;

  return (
    <WorkspaceGate featureName="Git" message="Indexing Workspace for Git...">
      <div className="source-control-panel">
        <header className="source-control-header">
          <span>Source Control</span>
          <div className="source-control-header-actions">
            <button className="source-control-icon-button" title="Refresh repositories" aria-label="Refresh Git repositories" disabled={!workspacePath || !isWorkspaceReady} onClick={() => {
              void listRepositories(workspacePath).then((repos) => {
                const first = repos[0];
                if (first) void refreshStatus(first.root, true);
              });
            }}>
              <RefreshCw size={13} />
            </button>
          </div>
        </header>

        {error && <div className="source-control-error" role="alert"><span>{error}</span><button onClick={clearError} aria-label="Dismiss error"><X size={12} /></button></div>}

        {repositories.length === 0 && <div className="source-control-empty" style={{ padding: 12 }}><Loader2 size={13} className="animate-spin" />Discovering repositories…</div>}

        <section className="source-control-headline">
          <button className="source-control-section-bar" aria-expanded={!headlineCollapsed.repos} onClick={() => toggleHeadline('repos')}>
            {headlineCollapsed.repos ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>Repositories</span>
            {repositories.length > 0 && <span className="source-control-count">{repositories.length}</span>}
          </button>
          {!headlineCollapsed.repos && repositories.map((repo) => renderRepo(repo))}
        </section>

        <section className="source-control-headline">
          <button className="source-control-section-bar" aria-expanded={!headlineCollapsed.graph} onClick={() => toggleHeadline('graph')}>
            {headlineCollapsed.graph ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>Source Control Graph</span>
            {activeRepoState?.graph.length ? <span className="source-control-count">{activeRepoState.graph.length}</span> : null}
          </button>
          {!headlineCollapsed.graph && renderGraphSection(activeRepoState)}
        </section>

        <section className="source-control-headline">
          <button className="source-control-section-bar" aria-expanded={!headlineCollapsed.npm} onClick={() => toggleHeadline('npm')}>
            {headlineCollapsed.npm ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>NPM Scripts</span>
            {npmScripts && npmScripts.length > 0 && <span className="source-control-count">{npmScripts.length}</span>}
          </button>
          {!headlineCollapsed.npm && renderNpmSection()}
        </section>

        {commitDetail && (
          <div className="source-control-commit-detail source-control-menu-floating" role="dialog" aria-label="Commit details">
            <div className="source-control-modal-heading">
              <h3>{commitDetail.commit.message}</h3>
              <button className="source-control-icon-button" aria-label="Close commit details" onClick={() => { useGitStore.setState({ commitDetail: null }); setGraphSelection(null); }}><X size={13} /></button>
            </div>
            <p>{commitDetail.commit.shortHash} · {commitDetail.commit.authorName} · {new Date(commitDetail.commit.date).toLocaleString()}</p>
            <strong>FILES CHANGED · {commitDetail.files.length}</strong>
            <div className="source-control-commit-detail-files">
              {commitDetail.files.map((file) => (
                <div className="source-control-list-item" key={`${file.path}-${file.status}`}>
                  {file.status === 'A' ? <FilePlus size={11} /> : file.status === 'D' ? <FileMinus size={11} /> : <FileCode size={11} />}
                  <span className="source-control-list-label" title={file.path}>{file.path}</span>
                  {renderStatus(file.status)}
                </div>
              ))}
            </div>
            <pre>{commitDetail.diff || 'No patch details available.'}</pre>
          </div>
        )}

        {menu?.kind === 'repo' && (
          <div className="source-control-menu source-control-menu-floating" style={{ top: menu.top, left: menu.left }} role="menu" aria-label="Repository actions">
            <button role="menuitem" onClick={() => { setMenu(null); void refreshStatus(menu.root, true); }}>Refresh</button>
            <button role="menuitem" onClick={() => { setMenu(null); void fetchBranches(menu.root); }}>Show branches</button>
            <button role="menuitem" onClick={() => { setMenu(null); void pullRemote(menu.root); }}>Pull</button>
            <button role="menuitem" onClick={() => { setMenu(null); void pushRemote(menu.root); }}>Push</button>
            <button role="menuitem" onClick={() => { setMenu(null); void syncRepo(menu.root); }}>Sync (pull + push)</button>
            <button role="menuitem" onClick={() => { setMenu(null); void stageFile(menu.root, '.'); }}>Stage all</button>
            <button role="menuitem" onClick={() => { setMenu(null); void unstageFile(menu.root, '.'); }}>Unstage all</button>
            <button role="menuitem" className="is-danger" onClick={() => {
              setMenu(null);
              setConfirmAction({
                title: 'Discard all changes?',
                message: 'Discard every uncommitted change? This cannot be undone.',
                actionLabel: 'Discard all',
                onConfirm: async () => {
                  const state = repoStates[menu.root];
                  const files = [...(state?.status?.unstagedFiles || []), ...(state?.status?.untrackedFiles || [])];
                  for (const file of files) await discardChanges(menu.root, file.path, file.status === 'U' || file.status === '?');
                }
              });
            }}>Discard all changes</button>
            <button role="menuitem" onClick={() => { setMenu(null); void stashChanges(menu.root, stashMessage || undefined); }}>Stash changes</button>
          </div>
        )}

        {menu?.kind === 'commit' && (
          <div className="source-control-menu source-control-menu-floating" style={{ top: menu.top, left: menu.left }} role="menu" aria-label="Commit options">
            <button role="menuitem" onClick={() => { setMenu(null); void handleCommit(menu.root); }}>Commit</button>
            <button role="menuitem" onClick={() => { setMenu(null); void handleCommit(menu.root).then((committed) => { if (committed) void pushRemote(menu.root); }); }}>Commit &amp; Push</button>
            <button role="menuitem" onClick={() => { setMenu(null); void handleCommit(menu.root).then((committed) => { if (committed) void syncRepo(menu.root); }); }}>Commit &amp; Sync</button>
            <button role="menuitem" onClick={() => { setMenu(null); void refreshStatus(menu.root).then(() => handleCommit(menu.root, { amend: true })); }}>Amend last commit</button>
          </div>
        )}

        {confirmAction && (
          <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmAction(null); }}>
            <section className="source-control-modal" role="alertdialog" aria-modal="true" aria-labelledby="git-confirm-title" aria-describedby="git-confirm-description">
              <div className="source-control-modal-heading"><h2 id="git-confirm-title">{confirmAction.title}</h2><button className="source-control-icon-button" aria-label="Close confirmation" onClick={() => setConfirmAction(null)}><X size={13} /></button></div>
              <p id="git-confirm-description">{confirmAction.message}</p>
              <div className="source-control-modal-footer">
                <button className="source-control-subtle-button" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button className="source-control-danger-button" onClick={async () => { const pending = confirmAction; setConfirmAction(null); await pending.onConfirm(); }}>{confirmAction.actionLabel}</button>
              </div>
            </section>
          </div>
        )}

        {discardTarget && (
          <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiscardTarget(null); }}>
            <section className="source-control-modal" role="alertdialog" aria-modal="true" aria-labelledby="git-discard-title" aria-describedby="git-discard-description">
              <div className="source-control-modal-heading"><h2 id="git-discard-title">Discard changes?</h2><button className="source-control-icon-button" aria-label="Close confirmation" onClick={() => setDiscardTarget(null)}><X size={13} /></button></div>
              <p id="git-discard-description">Discard changes in <strong>{discardTarget.file.path}</strong>? This action cannot be undone.</p>
              <div className="source-control-modal-footer">
                <button className="source-control-subtle-button" onClick={() => setDiscardTarget(null)}>Cancel</button>
                <button className="source-control-danger-button" onClick={async () => { const target = discardTarget; setDiscardTarget(null); await discardChanges(target.root, target.file.path, target.file.status === 'U' || target.file.status === '?'); }}>Discard</button>
              </div>
            </section>
          </div>
        )}

        {activeConflict && workspacePath && (
          <div className="source-control-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { closeConflict(); setConflictRoot(null); } }}>
            <section className="source-control-modal" role="dialog" aria-modal="true" aria-labelledby="git-conflict-title">
              <div className="source-control-modal-heading"><h2 id="git-conflict-title">Resolve conflict · {activeConflict.filePath}</h2><button className="source-control-icon-button" aria-label="Close conflict details" onClick={() => { closeConflict(); setConflictRoot(null); }}><X size={13} /></button></div>
              <pre>{activeConflict.workingContent || 'The working file is empty or was deleted.'}</pre>
              <div className="source-control-modal-footer">
                <button className="source-control-subtle-button" onClick={() => { openFile(fullWorkspacePath(workspacePath, activeConflict.filePath), fileName(activeConflict.filePath)); closeConflict(); setConflictRoot(null); }}>Open in editor</button>
                <button className="source-control-subtle-button" disabled={!activeConflict.oursContent} onClick={() => { if (window.confirm('Replace the working file with the current branch version?')) void resolveConflict(activeConflict.filePath, 'ours', conflictRoot || activeRepoRoot || undefined); }}>Accept Current</button>
                <button className="source-control-subtle-button" disabled={!activeConflict.theirsContent} onClick={() => { if (window.confirm('Replace the working file with the incoming branch version?')) void resolveConflict(activeConflict.filePath, 'theirs', conflictRoot || activeRepoRoot || undefined); }}>Accept Incoming</button>
                <button className="source-control-primary-button" onClick={() => void resolveConflict(activeConflict.filePath, 'mark-resolved', conflictRoot || activeRepoRoot || undefined)}>Mark resolved (stage)</button>
              </div>
            </section>
          </div>
        )}
      </div>
    </WorkspaceGate>
  );
};
