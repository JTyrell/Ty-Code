import { create } from 'zustand';
import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitInfo,
  GitConflictContent,
  GitFileDiff,
  GitGraphCommit,
  GitGraphResult,
  GitHunk,
  GitRemoteInfo,
  GitRepositoryInfo,
  GitStashInfo,
  GitStatusResult,
  GitSuggestedCommitMessage,
  GitTagInfo
} from '../../../preload/types';

export interface ActiveGitDiff extends GitFileDiff {
  title: string;
  isStaged: boolean;
  isUntracked: boolean;
  repositoryRoot: string;
}

export interface GitRepoState {
  root: string;
  name: string;
  isRepo: boolean;
  status: GitStatusResult | null;
  branches: GitBranchInfo | null;
  remotes: GitRemoteInfo[];
  tags: GitTagInfo[];
  stashes: GitStashInfo[];
  commits: GitCommitInfo[];
  graph: GitGraphCommit[];
  graphLoading: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  operationStatus: string | null;
  error: string | null;
}

let historyRequestId = 0;

interface GitStoreState {
  repositories: GitRepositoryInfo[];
  activeRepoRoot: string | null;
  repoStates: Record<string, GitRepoState>;
  commitMessages: Record<string, string>;
  applyingSuggestion: Record<string, boolean>;

  // Active-repository mirror (Status bar, overflow menu, diff viewer, chat
  // store and extension capabilities keep reading these fields).
  status: GitStatusResult | null;
  branches: GitBranchInfo | null;
  commits: GitCommitInfo[];
  tags: GitTagInfo[];
  stashes: GitStashInfo[];
  remotes: GitRemoteInfo[];
  commitMessage: string;
  isLoading: boolean;
  isSyncing: boolean;
  operationStatus: string | null;
  error: string | null;

  historySearch: string;
  activeDiff: ActiveGitDiff | null;
  activeHunks: GitHunk[];
  diffInline: boolean;
  commitDetail: GitCommitDetail | null;
  activeConflict: GitConflictContent | null;

  listRepositories: (workspacePath?: string) => Promise<GitRepositoryInfo[]>;
  setActiveRepo: (repoRoot: string) => void;
  resetStatus: () => void;

  refreshStatus: (repoRoot?: string, loadMetadata?: boolean) => Promise<void>;
  initRepo: (repoRoot?: string) => Promise<boolean>;
  stageFile: (repoRootOrPath: string | string[], filePath?: string | string[]) => Promise<boolean>;
  unstageFile: (repoRootOrPath: string | string[], filePath?: string | string[]) => Promise<boolean>;
  discardChanges: (repoRootOrPath: string, filePathOrFlag?: string | boolean, isUntracked?: boolean) => Promise<boolean>;
  createCommit: (repoRoot: string, message?: string, options?: { amend?: boolean }) => Promise<boolean>;
  suggestCommitMessage: (repoRoot: string) => Promise<GitSuggestedCommitMessage | null>;
  fetchBranches: (repoRoot?: string) => Promise<void>;
  createBranch: (repoRoot: string, branchName: string) => Promise<boolean>;
  switchBranch: (repoRoot: string, branchName: string) => Promise<boolean>;
  deleteBranch: (repoRoot: string, branchName: string, force?: boolean) => Promise<boolean>;
  mergeBranch: (repoRoot: string, branchName: string) => Promise<boolean>;
  fetchRemote: (repoRoot: string) => Promise<boolean>;
  pullRemote: (repoRoot: string) => Promise<boolean>;
  pushRemote: (repoRoot: string, options?: { remote?: string; branch?: string }) => Promise<boolean>;
  syncRepo: (repoRoot?: string) => Promise<void>;
  loadHistory: (repoRoot: string, search?: string) => Promise<GitCommitInfo[] | null>;
  loadGraph: (repoRoot: string, maxCount?: number) => Promise<GitGraphResult | null>;
  loadCommitDetail: (repoRoot: string, hash: string) => Promise<void>;
  loadTags: (repoRoot?: string) => Promise<void>;
  createTag: (repoRoot: string, name: string, message?: string) => Promise<boolean>;
  deleteTag: (repoRoot: string, name: string) => Promise<boolean>;
  loadStashes: (repoRoot?: string) => Promise<void>;
  stashChanges: (repoRoot: string, message?: string) => Promise<boolean>;
  popStash: (repoRoot: string, index: number) => Promise<boolean>;
  dropStash: (repoRoot: string, index: number) => Promise<boolean>;
  openFileDiff: (filePath: string, isStaged: boolean, repoRoot?: string) => Promise<void>;
  refreshActiveDiff: () => Promise<void>;
  applyHunk: (hunkId: string, operation: 'stage' | 'unstage' | 'revert') => Promise<boolean>;
  loadConflict: (filePath: string, repoRoot?: string) => Promise<void>;
  closeConflict: () => void;
  resolveConflict: (filePath: string, action: 'ours' | 'theirs' | 'mark-resolved', repoRoot?: string) => Promise<boolean>;
  abortMerge: (repoRoot?: string) => Promise<boolean>;
  closeDiff: () => void;

  setCommitMessage: (msg: string, repoRoot?: string) => void;
  setHistorySearch: (search: string) => void;
  setDiffInline: (inline: boolean) => void;
  clearError: () => void;
  clearRepoError: (repoRoot: string) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSensitiveGitPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const name = normalized.split('/').pop() || normalized;
  return (name.startsWith('.env') && name !== '.env.example' && name !== '.env.sample')
    || ['.npmrc', '.netrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_dsa'].includes(name)
    || /(^|\/)([^/]*credentials[^/]*|secrets?\.(json|ya?ml))$/.test(normalized)
    || /\.(pem|key|p8|p12|pfx|keystore)$/i.test(name);
}

function normalizeRepoRoot(value: string): string {
  return (value || '').replace(/[\\/]+$/, '');
}

function repoName(root: string): string {
  const segment = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
  return segment;
}

function createRepoState(root: string): GitRepoState {
  return {
    root,
    name: repoName(root),
    isRepo: false,
    status: null,
    branches: null,
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    graph: [],
    graphLoading: false,
    isLoading: false,
    isSyncing: false,
    operationStatus: null,
    error: null
  };
}

function emptyStatus(): GitStatusResult {
  return {
    isRepo: false,
    currentBranch: '',
    ahead: 0,
    behind: 0,
    isClean: true,
    stagedFiles: [],
    unstagedFiles: [],
    untrackedFiles: [],
    conflictedFiles: []
  };
}

export const useGitStore = create<GitStoreState>((set, get) => {
  const applyRepoPatch = (root: string, patch: Partial<GitRepoState>): void => {
    set((state) => {
      const current = state.repoStates[root] || createRepoState(root);
      const updated: GitRepoState = { ...current, ...patch };
      const isActive = state.activeRepoRoot === root;
      return {
        repoStates: { ...state.repoStates, [root]: updated },
        ...(isActive ? {
          status: updated.status,
          branches: updated.branches,
          remotes: updated.remotes,
          tags: updated.tags,
          stashes: updated.stashes,
          commits: updated.commits,
          isLoading: updated.isLoading,
          isSyncing: updated.isSyncing,
          operationStatus: updated.operationStatus,
          error: updated.error
        } : {})
      };
    });
  };

  const failRepo = (root: string, message: string): void => {
    applyRepoPatch(root, { error: message });
    if (get().activeRepoRoot === root) set({ error: message });
  };

  const clearRepoError = (root: string): void => {
    applyRepoPatch(root, { error: null });
  };

  const repoState = (root: string): GitRepoState => get().repoStates[root] || createRepoState(root);

  const resolveDiffRepoRoot = (): string | null => {
    const state = get();
    return state.activeDiff?.repositoryRoot || state.activeRepoRoot;
  };

  return {
    repositories: [],
    activeRepoRoot: null,
    repoStates: {},
    commitMessages: {},
    applyingSuggestion: {},

    status: null,
    branches: null,
    commits: [],
    tags: [],
    stashes: [],
    remotes: [],
    commitMessage: '',
    isLoading: false,
    isSyncing: false,
    operationStatus: null,
    error: null,

    historySearch: '',
    activeDiff: null,
    activeHunks: [],
    diffInline: false,
    commitDetail: null,
    activeConflict: null,

    listRepositories: async (workspacePath) => {
      if (!window.electronAPI?.gitListRepositories) return [];
      try {
        const response = await window.electronAPI.gitListRepositories(workspacePath ? { workspacePath } : undefined);
        if (!response.success || !response.data) throw new Error(response.error || 'Could not discover Git repositories.');
        const repositories = response.data;
        set((state) => {
          const nextStates: Record<string, GitRepoState> = {};
          for (const repo of repositories) {
            nextStates[repo.root] = state.repoStates[repo.root] || createRepoState(repo.root);
          }
          const keepActive = repositories.some((repo) => repo.root === state.activeRepoRoot);
          return {
            repositories,
            repoStates: nextStates,
            activeRepoRoot: keepActive ? state.activeRepoRoot : (repositories[0]?.root ?? null)
          };
        });
        return repositories;
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
        return [];
      }
    },

    setActiveRepo: (repoRoot) => {
      const root = normalizeRepoRoot(repoRoot);
      const state = get();
      const repo = state.repoStates[root];
      if (!repo) return;
      set({
        activeRepoRoot: root,
        status: repo.status,
        branches: repo.branches,
        remotes: repo.remotes,
        tags: repo.tags,
        stashes: repo.stashes,
        commits: repo.commits,
        isLoading: repo.isLoading,
        isSyncing: repo.isSyncing,
        operationStatus: repo.operationStatus,
        error: repo.error,
        commitMessage: state.commitMessages[root] || '',
        commitDetail: null
      });
    },

    resetStatus: () => set({
      repositories: [],
      activeRepoRoot: null,
      repoStates: {},
      commitMessages: {},
      applyingSuggestion: {},
      status: emptyStatus(),
      branches: null,
      commits: [],
      tags: [],
      stashes: [],
      remotes: [],
      activeDiff: null,
      activeHunks: [],
      commitMessage: '',
      commitDetail: null,
      activeConflict: null,
      error: null
    }),

    refreshStatus: async (repoRoot, loadMetadata = false) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root || !window.electronAPI?.gitGetStatus) {
        if (!window.electronAPI) {
          set({ status: emptyStatus(), error: 'Git source control is available in the Ty-Code desktop app.' });
        }
        return;
      }
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const statusRes = await window.electronAPI.gitGetStatus({ repoPath: root });
        if (!statusRes.success || !statusRes.data) throw new Error(statusRes.error || 'Unable to read Git status.');
        const status = statusRes.data;
        applyRepoPatch(root, { status, isLoading: false, isRepo: status.isRepo });
        if (status.isRepo && loadMetadata) {
          void get().fetchBranches(root);
          void get().loadTags(root);
          void get().loadStashes(root);
          void window.electronAPI.gitGetRemotes({ repoPath: root }).then((res) => {
            if (res.success && res.data) applyRepoPatch(root, { remotes: res.data });
          }).catch(() => undefined);
        } else if (!status.isRepo) {
          applyRepoPatch(root, { branches: null, tags: [], stashes: [], remotes: [] });
        }
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false, status: emptyStatus() });
        failRepo(root, getErrorMessage(error));
      }
    },

    initRepo: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return false;
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitInit({ repoPath: root });
        if (!response.success) throw new Error(response.error || 'Failed to initialize Git repository.');
        await get().refreshStatus(root, true);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false });
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    stageFile: async (repoRootOrPath, filePath) => {
      // New API (repoRoot, filePath...) with a legacy single-argument form
      // (filePath) kept for the diff viewer; the legacy form acts on the diff's
      // own repository.
      const legacy = filePath === undefined;
      const root = legacy
        ? (get().activeDiff?.repositoryRoot || get().activeRepoRoot || '')
        : normalizeRepoRoot(String(repoRootOrPath));
      const files = legacy ? (repoRootOrPath as string | string[]) : (filePath as string | string[]);
      if (!root || !files) return false;
      clearRepoError(root);
      try {
        const statusResponse = await window.electronAPI.gitGetStatus({ repoPath: root });
        if (!statusResponse.success || !statusResponse.data) throw new Error(statusResponse.error || 'Could not refresh Git status before staging.');
        const status = statusResponse.data;
        applyRepoPatch(root, { status });
        const candidates = Array.isArray(files)
          ? files
          : files === '.'
            ? [...(status?.stagedFiles || []), ...(status?.unstagedFiles || []), ...(status?.untrackedFiles || [])].map((file) => file.path)
            : [files];
        const sensitive = candidates.filter(isSensitiveGitPath);
        if (sensitive.length) throw new Error(`Refusing to stage likely secret file(s): ${sensitive.join(', ')}. Stage manually after reviewing.`);
        const response = await window.electronAPI.gitStage({ filePaths: files, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not stage changes.');
        const diff = get().activeDiff;
        await get().refreshStatus(root);
        if (diff && diff.repositoryRoot === root && (files === '.' || files === diff.filePath || (Array.isArray(files) && files.includes(diff.filePath)))) {
          await get().openFileDiff(diff.filePath, true, root);
        }
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    unstageFile: async (repoRootOrPath, filePath) => {
      const legacy = filePath === undefined;
      const root = legacy
        ? (get().activeDiff?.repositoryRoot || get().activeRepoRoot || '')
        : normalizeRepoRoot(String(repoRootOrPath));
      const files = legacy ? (repoRootOrPath as string | string[]) : (filePath as string | string[]);
      if (!root || !files) return false;
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitUnstage({ filePaths: files, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not unstage changes.');
        const diff = get().activeDiff;
        await get().refreshStatus(root);
        if (diff && diff.repositoryRoot === root && (files === '.' || files === diff.filePath || (Array.isArray(files) && files.includes(diff.filePath)))) {
          await get().openFileDiff(diff.filePath, false, root);
        }
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    discardChanges: async (repoRootOrPath, filePathOrFlag, isUntracked = false) => {
      // Legacy form: discardChanges(filePath, isUntracked?) for the diff viewer.
      const legacy = typeof filePathOrFlag === 'boolean' || filePathOrFlag === undefined;
      const root = legacy
        ? (get().activeDiff?.repositoryRoot || get().activeRepoRoot || '')
        : normalizeRepoRoot(repoRootOrPath);
      const filePath = legacy ? repoRootOrPath : (filePathOrFlag as string);
      const untracked = legacy ? Boolean(filePathOrFlag) : Boolean(isUntracked);
      if (!root || !filePath) return false;
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitDiscardChanges({ filePath, isUntracked: untracked, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not discard changes.');
        if (get().activeDiff?.filePath === filePath) get().closeDiff();
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    createCommit: async (repoRoot, customMessage, options) => {
      const root = normalizeRepoRoot(repoRoot);
      const message = (customMessage ?? get().commitMessages[root] ?? get().commitMessage).trim();
      if (!message) return false;
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const statusResponse = await window.electronAPI.gitGetStatus({ repoPath: root });
        if (!statusResponse.success || !statusResponse.data) throw new Error(statusResponse.error || 'Unable to refresh Git status before committing.');
        const status = statusResponse.data;
        applyRepoPatch(root, { status });
        if (!status.isRepo) throw new Error('Initialize a Git repository before committing.');
        if (status.conflictedFiles.length) throw new Error('Resolve merge conflicts before committing.');
        const sensitiveStaged = status.stagedFiles.map((file) => file.path).filter(isSensitiveGitPath);
        if (sensitiveStaged.length) throw new Error(`Refusing to commit likely secret file(s): ${sensitiveStaged.join(', ')}. Review and unstage them first.`);
        if (!options?.amend && status.stagedFiles.length === 0 && (status.unstagedFiles.length || status.untrackedFiles.length)) {
          const staged = await get().stageFile(root, '.');
          if (!staged) throw new Error(repoState(root).error || 'Could not stage changes.');
        }
        const response = await window.electronAPI.gitCommit({ message, options, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Commit failed.');
        set((state) => ({
          commitMessages: { ...state.commitMessages, [root]: '' },
          commitDetail: null,
          ...(state.activeRepoRoot === root ? { commitMessage: '' } : {})
        }));
        await get().refreshStatus(root);
        await get().loadHistory(root);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false });
        failRepo(root, getErrorMessage(error));
        return false;
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    suggestCommitMessage: async (repoRoot) => {
      const root = normalizeRepoRoot(repoRoot);
      set((state) => ({ applyingSuggestion: { ...state.applyingSuggestion, [root]: true } }));
      try {
        if (!window.electronAPI?.gitSuggestCommitMessage) return null;
        const response = await window.electronAPI.gitSuggestCommitMessage({ repoPath: root });
        if (!response.success || !response.data) throw new Error(response.error || 'Could not generate a commit message.');
        const proposal = response.data;
        const compose = [proposal.subject, proposal.body].filter(Boolean).join('\n\n');
        set((state) => ({
          applyingSuggestion: { ...state.applyingSuggestion, [root]: false },
          commitMessages: { ...state.commitMessages, [root]: compose },
          ...(state.activeRepoRoot === root ? { commitMessage: compose } : {})
        }));
        return proposal;
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
        set((state) => ({ applyingSuggestion: { ...state.applyingSuggestion, [root]: false } }));
        return null;
      }
    },

    fetchBranches: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return;
      try {
        const response = await window.electronAPI.gitGetBranches({ repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not load branches.');
        if (response.data) applyRepoPatch(root, { branches: response.data });
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
      }
    },

    createBranch: async (repoRoot, branchName) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitCreateBranch({ branchName, repoPath: root });
        if (!response.success) throw new Error(response.error || `Failed to create branch ${branchName}.`);
        await Promise.all([get().refreshStatus(root), get().fetchBranches(root)]);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false });
        failRepo(root, getErrorMessage(error));
        return false;
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    switchBranch: async (repoRoot, branchName) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitSwitchBranch({ branchName, repoPath: root });
        if (!response.success) throw new Error(response.error || `Failed to switch to ${branchName}.`);
        if (get().activeDiff?.repositoryRoot === root) {
          set({ activeDiff: null, activeHunks: [], commitDetail: null });
        }
        await Promise.all([get().refreshStatus(root), get().fetchBranches(root)]);
        void get().loadGraph(root).catch(() => undefined);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false });
        failRepo(root, getErrorMessage(error));
        return false;
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    deleteBranch: async (repoRoot, branchName, force) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isLoading: true });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitDeleteBranch({ branchName, force, repoPath: root });
        if (!response.success) throw new Error(response.error || `Failed to delete ${branchName}.`);
        await get().fetchBranches(root);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false });
        failRepo(root, getErrorMessage(error));
        return false;
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    mergeBranch: async (repoRoot, branchName) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isLoading: true, operationStatus: `Merging ${branchName}…` });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitMerge({ branchName, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Merge failed.');
        if (!response.data?.success) {
          const detail = response.data?.message || 'Merge stopped because there are conflicts.';
          failRepo(root, detail);
          applyRepoPatch(root, { operationStatus: null });
        } else {
          applyRepoPatch(root, { operationStatus: response.data.message || `Merged ${branchName}.` });
        }
        await get().refreshStatus(root);
        return Boolean(response.data?.success);
      } catch (error: unknown) {
        applyRepoPatch(root, { isLoading: false, operationStatus: null });
        failRepo(root, getErrorMessage(error));
        return false;
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    fetchRemote: async (repoRoot) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isSyncing: true, operationStatus: 'Fetching from remote…' });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitFetch({ repoPath: root });
        if (!response.success) throw new Error(response.error || 'Fetch failed.');
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    pullRemote: async (repoRoot) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isSyncing: true, operationStatus: 'Pulling from remote…' });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitPull({ repoPath: root });
        if (!response.success) throw new Error(response.error || 'Pull failed.');
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        await get().refreshStatus(root);
        void get().loadGraph(root).catch(() => undefined);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    pushRemote: async (repoRoot, options) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isSyncing: true, operationStatus: 'Pushing to remote…' });
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitPush({ remote: options?.remote, branch: options?.branch, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Push failed.');
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        applyRepoPatch(root, { isSyncing: false, operationStatus: null });
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    syncRepo: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return;
      const state = repoState(root);
      if ((state.status?.behind || 0) > 0) {
        const pulled = await get().pullRemote(root);
        if (!pulled) return;
      } else {
        const fetched = await get().fetchRemote(root);
        if (!fetched) return;
        await get().refreshStatus(root);
      }
      if ((get().repoStates[root]?.status?.ahead || 0) > 0) await get().pushRemote(root);
    },

    loadHistory: async (repoRoot, search) => {
      const root = normalizeRepoRoot(repoRoot);
      const request = ++historyRequestId;
      try {
        const response = await window.electronAPI.gitGetLog({ maxCount: 100, search: search || get().historySearch || undefined, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not load commit history.');
        if (request === historyRequestId) {
          applyRepoPatch(root, { commits: response.data || [] });
          return response.data || null;
        }
        return null;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return null;
      }
    },

    loadGraph: async (repoRoot, maxCount = 100) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { graphLoading: true });
      try {
        if (!window.electronAPI?.gitGraph) {
          applyRepoPatch(root, { graphLoading: false });
          return null;
        }
        const response = await window.electronAPI.gitGraph({ maxCount, repoPath: root });
        if (!response.success || !response.data) throw new Error(response.error || 'Could not load the source control graph.');
        applyRepoPatch(root, { graph: response.data.commits, graphLoading: false });
        return response.data;
      } catch (error: unknown) {
        applyRepoPatch(root, { graphLoading: false });
        failRepo(root, getErrorMessage(error));
        return null;
      }
    },

    loadCommitDetail: async (repoRoot, hash) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { isLoading: true });
      try {
        set({ commitDetail: null });
        const response = await window.electronAPI.gitGetCommitDetail({ hash, repoPath: root });
        if (!response.success || !response.data) throw new Error(response.error || 'Could not load commit details.');
        set({ commitDetail: response.data });
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    loadTags: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return;
      try {
        const response = await window.electronAPI.gitGetTags({ repoPath: root });
        if (response.success) applyRepoPatch(root, { tags: response.data || [] });
        else if (response.error) failRepo(root, response.error);
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
      }
    },

    createTag: async (repoRoot, name, message) => {
      const root = normalizeRepoRoot(repoRoot);
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitCreateTag({ name, message, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not create tag.');
        await get().loadTags(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    deleteTag: async (repoRoot, name) => {
      const root = normalizeRepoRoot(repoRoot);
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitDeleteTag({ name, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not delete tag.');
        await get().loadTags(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    loadStashes: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return;
      try {
        const response = await window.electronAPI.gitStash({ action: 'list', repoPath: root });
        if (response.success && Array.isArray(response.data)) applyRepoPatch(root, { stashes: response.data });
        else if (!response.success && response.error) failRepo(root, response.error);
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
      }
    },

    stashChanges: async (repoRoot, message) => {
      const root = normalizeRepoRoot(repoRoot);
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitStash({ action: 'save', message, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not save stash.');
        await Promise.all([get().refreshStatus(root), get().loadStashes(root)]);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    popStash: async (repoRoot, index) => {
      const root = normalizeRepoRoot(repoRoot);
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitStash({ action: 'pop', index, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not apply stash.');
        await get().loadStashes(root);
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        await get().refreshStatus(root);
        return false;
      }
    },

    dropStash: async (repoRoot, index) => {
      const root = normalizeRepoRoot(repoRoot);
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitStash({ action: 'drop', index, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not drop stash.');
        await get().loadStashes(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    openFileDiff: async (filePath, isStaged, repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : resolveDiffRepoRoot();
      if (!root) {
        set({ error: 'Select a repository before opening a diff.' });
        return;
      }
      applyRepoPatch(root, { isLoading: true });
      try {
        const [diffResponse, hunkResponse] = await Promise.all([
          window.electronAPI.gitGetFileDiff({ filePath, staged: isStaged, repoPath: root }),
          window.electronAPI.gitGetHunks({ filePath, staged: isStaged, repoPath: root })
        ]);
        if (!diffResponse.success || !diffResponse.data) throw new Error(diffResponse.error || 'Could not open file diff.');
        if (!hunkResponse.success) throw new Error(hunkResponse.error || 'Could not load diff hunks.');
        const repo = repoState(root);
        set({
          activeDiff: {
            ...diffResponse.data,
            title: `${diffResponse.data.filePath} (${isStaged ? 'Index ↔ HEAD' : 'Working Tree ↔ Index'})`,
            isStaged,
            isUntracked: repo.status?.untrackedFiles.some((file) => file.path === diffResponse.data?.filePath) || false,
            repositoryRoot: root
          },
          activeHunks: hunkResponse.data || []
        });
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
      } finally {
        if (get().repoStates[root]?.isLoading) applyRepoPatch(root, { isLoading: false });
      }
    },

    refreshActiveDiff: async () => {
      const current = get().activeDiff;
      if (current) await get().openFileDiff(current.filePath, current.isStaged, current.repositoryRoot);
    },

    applyHunk: async (hunkId, operation) => {
      const current = get().activeDiff;
      if (!current) return false;
      const root = current.repositoryRoot;
      try {
        const response = await window.electronAPI.gitApplyHunk({ filePath: current.filePath, hunkId, operation, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not apply hunk action.');
        await get().refreshStatus(root);
        await get().openFileDiff(current.filePath, operation === 'stage' ? true : operation === 'unstage' ? false : current.isStaged, root);
        return true;
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
        return false;
      }
    },

    loadConflict: async (filePath, repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : resolveDiffRepoRoot();
      if (!root) {
        set({ error: 'Select a repository before opening a conflict.' });
        return;
      }
      try {
        const response = await window.electronAPI.gitGetConflictContent({ filePath, repoPath: root });
        if (!response.success || !response.data) throw new Error(response.error || 'Could not load conflict content.');
        set({ activeConflict: response.data, error: null });
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
      }
    },

    closeConflict: () => set({ activeConflict: null }),

    resolveConflict: async (filePath, action, repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : (get().activeDiff?.repositoryRoot || get().activeRepoRoot);
      if (!root) {
        set({ error: 'Select a repository before resolving conflicts.' });
        return false;
      }
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitResolveConflict({ filePath, action, repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not resolve conflict.');
        set({ activeConflict: null });
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    abortMerge: async (repoRoot) => {
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : get().activeRepoRoot;
      if (!root) return false;
      clearRepoError(root);
      try {
        const response = await window.electronAPI.gitAbortMerge({ repoPath: root });
        if (!response.success) throw new Error(response.error || 'Could not abort merge.');
        set({ activeConflict: null });
        await get().refreshStatus(root);
        return true;
      } catch (error: unknown) {
        failRepo(root, getErrorMessage(error));
        return false;
      }
    },

    closeDiff: () => set({ activeDiff: null, activeHunks: [] }),

    setCommitMessage: (commitMessage, repoRoot) => {
      const state = get();
      const root = repoRoot ? normalizeRepoRoot(repoRoot) : state.activeRepoRoot;
      if (!root) return;
      set((current) => ({
        commitMessage: current.activeRepoRoot === root ? commitMessage : current.commitMessage,
        commitMessages: { ...current.commitMessages, [root]: commitMessage }
      }));
    },
    setHistorySearch: (historySearch) => set({ historySearch }),
    setDiffInline: (diffInline) => set({ diffInline }),
    clearError: () => {
      const root = get().activeRepoRoot;
      set({ error: null });
      if (root) applyRepoPatch(root, { error: null });
    },
    clearRepoError: (repoRoot) => {
      const root = normalizeRepoRoot(repoRoot);
      applyRepoPatch(root, { error: null });
      if (get().activeRepoRoot === root) set({ error: null });
    }
  };
});

export type { GitStoreState };
export type { GitFileChange } from '../../../preload/types';
export function normalizeRepositoryRoot(value: string): string {
  return normalizeRepoRoot(value);
}
