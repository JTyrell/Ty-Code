import { create } from 'zustand';
import type {
  GitCommitDetail,
  GitCommitInfo,
  GitConflictContent,
  GitFileChange,
  GitFileDiff,
  GitHunk,
  GitRemoteInfo,
  GitStashInfo,
  GitStatusResult,
  GitTagInfo,
  GitBranchInfo
} from '../../../preload/types';

export interface ActiveGitDiff extends GitFileDiff {
  title: string;
  isStaged: boolean;
  isUntracked: boolean;
}

let historyRequestId = 0;

interface GitStoreState {
  status: GitStatusResult | null;
  branches: GitBranchInfo | null;
  commits: GitCommitInfo[];
  commitDetail: GitCommitDetail | null;
  historySearch: string;
  activeDiff: ActiveGitDiff | null;
  activeHunks: GitHunk[];
  diffInline: boolean;
  commitMessage: string;
  tags: GitTagInfo[];
  stashes: GitStashInfo[];
  remotes: GitRemoteInfo[];
  activeConflict: GitConflictContent | null;
  isLoading: boolean;
  isSyncing: boolean;
  operationStatus: string | null;
  error: string | null;

  setCommitMessage: (msg: string) => void;
  setHistorySearch: (search: string) => void;
  setDiffInline: (inline: boolean) => void;
  clearError: () => void;
  resetStatus: () => void;
  refreshStatus: (loadMetadata?: boolean) => Promise<void>;
  initRepo: () => Promise<boolean>;
  stageFile: (filePath: string | string[]) => Promise<boolean>;
  unstageFile: (filePath: string | string[]) => Promise<boolean>;
  discardChanges: (filePath: string, isUntracked?: boolean) => Promise<boolean>;
  createCommit: (message?: string) => Promise<boolean>;
  fetchBranches: () => Promise<void>;
  createBranch: (branchName: string) => Promise<boolean>;
  switchBranch: (branchName: string) => Promise<boolean>;
  deleteBranch: (branchName: string) => Promise<boolean>;
  mergeBranch: (branchName: string) => Promise<boolean>;
  fetchRemote: () => Promise<boolean>;
  pullRemote: () => Promise<boolean>;
  pushRemote: () => Promise<boolean>;
  syncRepo: () => Promise<void>;
  loadHistory: (search?: string) => Promise<void>;
  loadCommitDetail: (hash: string) => Promise<void>;
  loadTags: () => Promise<void>;
  createTag: (name: string, message?: string) => Promise<boolean>;
  deleteTag: (name: string) => Promise<boolean>;
  loadStashes: () => Promise<void>;
  stashChanges: (message?: string) => Promise<boolean>;
  popStash: (index: number) => Promise<boolean>;
  dropStash: (index: number) => Promise<boolean>;
  openFileDiff: (filePath: string, isStaged: boolean) => Promise<void>;
  refreshActiveDiff: () => Promise<void>;
  applyHunk: (hunkId: string, operation: 'stage' | 'unstage' | 'revert') => Promise<boolean>;
  loadConflict: (filePath: string) => Promise<void>;
  closeConflict: () => void;
  resolveConflict: (filePath: string, action: 'ours' | 'theirs' | 'mark-resolved') => Promise<boolean>;
  abortMerge: () => Promise<boolean>;
  closeDiff: () => void;
}

const emptyStatus = (): GitStatusResult => ({
  isRepo: false,
  currentBranch: '',
  ahead: 0,
  behind: 0,
  isClean: true,
  stagedFiles: [],
  unstagedFiles: [],
  untrackedFiles: [],
  conflictedFiles: []
});

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

export const useGitStore = create<GitStoreState>((set, get) => ({
  status: null,
  branches: null,
  commits: [],
  commitDetail: null,
  historySearch: '',
  activeDiff: null,
  activeHunks: [],
  diffInline: false,
  commitMessage: '',
  tags: [],
  stashes: [],
  remotes: [],
  activeConflict: null,
  isLoading: false,
  isSyncing: false,
  operationStatus: null,
  error: null,

  setCommitMessage: (commitMessage) => set({ commitMessage }),
  setHistorySearch: (historySearch) => set({ historySearch }),
  setDiffInline: (diffInline) => set({ diffInline }),
  clearError: () => set({ error: null }),

  resetStatus: () => set({
    status: emptyStatus(),
    error: null,
    branches: null,
    commits: [],
    commitDetail: null,
    tags: [],
    stashes: [],
    remotes: [],
    activeConflict: null,
    activeDiff: null,
    activeHunks: []
  }),

  refreshStatus: async (loadMetadata = false) => {
    if (!window.electronAPI?.gitGetStatus) {
      set({ status: emptyStatus(), error: 'Git source control is available in the Ty-Code desktop app.' });
      return;
    }
    try {
      const statusRes = await window.electronAPI.gitGetStatus();
      if (!statusRes.success || !statusRes.data) throw new Error(statusRes.error || 'Unable to read Git status.');
      set({ status: statusRes.data });
      if (statusRes.data.isRepo && loadMetadata) {
        void get().fetchBranches();
        void get().loadTags();
        void get().loadStashes();
        void window.electronAPI.gitGetRemotes().then((res) => {
          if (res.success && res.data) set({ remotes: res.data });
        });
      } else if (!statusRes.data.isRepo) {
        set({ branches: null, tags: [], stashes: [], remotes: [] });
      }
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
    }
  },

  initRepo: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await window.electronAPI.gitInit();
      if (!response.success) throw new Error(response.error || 'Failed to initialize Git repository.');
      await get().refreshStatus(true);
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  stageFile: async (filePath) => {
    set({ error: null });
    try {
      const statusResponse = await window.electronAPI.gitGetStatus();
      if (!statusResponse.success || !statusResponse.data) throw new Error(statusResponse.error || 'Could not refresh Git status before staging.');
      const status = statusResponse.data;
      set({ status });
      const candidates = Array.isArray(filePath)
        ? filePath
        : filePath === '.'
          ? [...(status?.stagedFiles || []), ...(status?.unstagedFiles || []), ...(status?.untrackedFiles || [])].map((file) => file.path)
          : [filePath];
      const sensitive = candidates.filter(isSensitiveGitPath);
      if (sensitive.length) throw new Error(`Refusing to stage likely secret file(s): ${sensitive.join(', ')}. Stage manually after reviewing.`);
      const response = await window.electronAPI.gitStage(filePath);
      if (!response.success) throw new Error(response.error || 'Could not stage changes.');
      const diff = get().activeDiff;
      await get().refreshStatus();
      if (diff && (filePath === '.' || filePath === diff.filePath || (Array.isArray(filePath) && filePath.includes(diff.filePath)))) {
        await get().openFileDiff(diff.filePath, true);
      }
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  unstageFile: async (filePath) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitUnstage(filePath);
      if (!response.success) throw new Error(response.error || 'Could not unstage changes.');
      const diff = get().activeDiff;
      await get().refreshStatus();
      if (diff && (filePath === '.' || filePath === diff.filePath || (Array.isArray(filePath) && filePath.includes(diff.filePath)))) {
        await get().openFileDiff(diff.filePath, false);
      }
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  discardChanges: async (filePath, isUntracked = false) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitDiscardChanges(filePath, isUntracked);
      if (!response.success) throw new Error(response.error || 'Could not discard changes.');
      if (get().activeDiff?.filePath === filePath) get().closeDiff();
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  createCommit: async (customMessage) => {
    const message = (customMessage ?? get().commitMessage).trim();
    if (!message) return false;
    set({ isLoading: true, error: null });
    try {
      const statusResponse = await window.electronAPI.gitGetStatus();
      if (!statusResponse.success || !statusResponse.data) throw new Error(statusResponse.error || 'Unable to refresh Git status before committing.');
      const status = statusResponse.data;
      set({ status });
      if (!status.isRepo) throw new Error('Initialize a Git repository before committing.');
      if (status.conflictedFiles.length) throw new Error('Resolve merge conflicts before committing.');
      const sensitiveStaged = status.stagedFiles.map((file) => file.path).filter(isSensitiveGitPath);
      if (sensitiveStaged.length) throw new Error(`Refusing to commit likely secret file(s): ${sensitiveStaged.join(', ')}. Review and unstage them first.`);
      if (status.stagedFiles.length === 0 && (status.unstagedFiles.length || status.untrackedFiles.length)) {
        const staged = await get().stageFile('.');
        if (!staged) throw new Error(get().error || 'Could not stage changes.');
      }
      const response = await window.electronAPI.gitCommit(message);
      if (!response.success) throw new Error(response.error || 'Commit failed.');
      set({ commitMessage: '', commitDetail: null });
      await get().refreshStatus();
      await get().loadHistory();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchBranches: async () => {
    try {
      const response = await window.electronAPI.gitGetBranches();
      if (!response.success) throw new Error(response.error || 'Could not load branches.');
      if (response.data) set({ branches: response.data });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
    }
  },

  createBranch: async (branchName) => {
    set({ isLoading: true, error: null });
    try {
      const response = await window.electronAPI.gitCreateBranch(branchName);
      if (!response.success) throw new Error(response.error || `Failed to create branch ${branchName}.`);
      await Promise.all([get().refreshStatus(), get().fetchBranches()]);
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  switchBranch: async (branchName) => {
    set({ isLoading: true, error: null });
    try {
      const response = await window.electronAPI.gitSwitchBranch(branchName);
      if (!response.success) throw new Error(response.error || `Failed to switch to ${branchName}.`);
      set({ activeDiff: null, activeHunks: [] });
      await Promise.all([get().refreshStatus(), get().fetchBranches()]);
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteBranch: async (branchName) => {
    set({ isLoading: true, error: null });
    try {
      const response = await window.electronAPI.gitDeleteBranch(branchName);
      if (!response.success) throw new Error(response.error || `Failed to delete ${branchName}.`);
      await get().fetchBranches();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  mergeBranch: async (branchName) => {
    set({ isLoading: true, error: null, operationStatus: `Merging ${branchName}…` });
    try {
      const response = await window.electronAPI.gitMerge(branchName);
      if (!response.success) throw new Error(response.error || 'Merge failed.');
      if (!response.data?.success) {
        const detail = response.data?.message || 'Merge stopped because there are conflicts.';
        set({ error: detail });
      } else {
        set({ operationStatus: response.data.message || `Merged ${branchName}.` });
      }
      await get().refreshStatus();
      return Boolean(response.data?.success);
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isLoading: false, operationStatus: null });
    }
  },

  fetchRemote: async () => {
    set({ isSyncing: true, error: null, operationStatus: 'Fetching from remote…' });
    try {
      const response = await window.electronAPI.gitFetch();
      if (!response.success) throw new Error(response.error || 'Fetch failed.');
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isSyncing: false, operationStatus: null });
    }
  },

  pullRemote: async () => {
    set({ isSyncing: true, error: null, operationStatus: 'Pulling from remote…' });
    try {
      const response = await window.electronAPI.gitPull();
      if (!response.success) throw new Error(response.error || 'Pull failed.');
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isSyncing: false, operationStatus: null });
    }
  },

  pushRemote: async () => {
    set({ isSyncing: true, error: null, operationStatus: 'Pushing to remote…' });
    try {
      const response = await window.electronAPI.gitPush();
      if (!response.success) throw new Error(response.error || 'Push failed.');
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    } finally {
      set({ isSyncing: false, operationStatus: null });
    }
  },

  syncRepo: async () => {
    const status = get().status;
    if (status?.behind) {
      const pulled = await get().pullRemote();
      if (!pulled) return;
    } else {
      const fetched = await get().fetchRemote();
      if (!fetched) return;
      await get().refreshStatus();
    }
    if ((get().status?.ahead || 0) > 0) await get().pushRemote();
  },

  loadHistory: async (search) => {
    const term = search ?? get().historySearch;
    const request = ++historyRequestId;
    try {
      set({ isLoading: true, error: null, historySearch: term });
      const response = await window.electronAPI.gitGetLog(100, term || undefined);
      if (!response.success) throw new Error(response.error || 'Could not load commit history.');
      if (request === historyRequestId) set({ commits: response.data || [] });
    } catch (error: unknown) {
      if (request === historyRequestId) set({ error: getErrorMessage(error) });
    } finally {
      if (request === historyRequestId) set({ isLoading: false });
    }
  },

  loadCommitDetail: async (hash) => {
    try {
      set({ isLoading: true, error: null, commitDetail: null });
      const response = await window.electronAPI.gitGetCommitDetail(hash);
      if (!response.success || !response.data) throw new Error(response.error || 'Could not load commit details.');
      set({ commitDetail: response.data });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadTags: async () => {
    const response = await window.electronAPI.gitGetTags();
    if (response.success) set({ tags: response.data || [] });
    else if (response.error) set({ error: response.error });
  },

  createTag: async (name, message) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitCreateTag(name, message);
      if (!response.success) throw new Error(response.error || 'Could not create tag.');
      await get().loadTags();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  deleteTag: async (name) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitDeleteTag(name);
      if (!response.success) throw new Error(response.error || 'Could not delete tag.');
      await get().loadTags();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  loadStashes: async () => {
    const response = await window.electronAPI.gitStash('list');
    if (response.success && Array.isArray(response.data)) set({ stashes: response.data });
    else if (!response.success && response.error) set({ error: response.error });
  },

  stashChanges: async (message) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitStash('save', message);
      if (!response.success) throw new Error(response.error || 'Could not save stash.');
      await Promise.all([get().refreshStatus(), get().loadStashes()]);
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  popStash: async (index) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitStash('pop', undefined, index);
      if (!response.success) throw new Error(response.error || 'Could not apply stash.');
      await get().loadStashes();
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      await get().refreshStatus();
      return false;
    }
  },

  dropStash: async (index) => {
    set({ error: null });
    try {
      const response = await window.electronAPI.gitStash('drop', undefined, index);
      if (!response.success) throw new Error(response.error || 'Could not drop stash.');
      await get().loadStashes();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  openFileDiff: async (filePath, isStaged) => {
    try {
      set({ isLoading: true, error: null });
      const [diffResponse, hunkResponse] = await Promise.all([
        window.electronAPI.gitGetFileDiff(filePath, isStaged),
        window.electronAPI.gitGetHunks(filePath, isStaged)
      ]);
      if (!diffResponse.success || !diffResponse.data) throw new Error(diffResponse.error || 'Could not open file diff.');
      if (!hunkResponse.success) throw new Error(hunkResponse.error || 'Could not load diff hunks.');
      set({
        activeDiff: {
          ...diffResponse.data,
          title: `${diffResponse.data.filePath} (${isStaged ? 'Index ↔ HEAD' : 'Working Tree ↔ Index'})`,
          isStaged,
          isUntracked: get().status?.untrackedFiles.some((file) => file.path === diffResponse.data?.filePath) || false
        },
        activeHunks: hunkResponse.data || []
      });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  refreshActiveDiff: async () => {
    const current = get().activeDiff;
    if (current) await get().openFileDiff(current.filePath, current.isStaged);
  },

  applyHunk: async (hunkId, operation) => {
    const current = get().activeDiff;
    if (!current) return false;
    try {
      const response = await window.electronAPI.gitApplyHunk(current.filePath, hunkId, operation);
      if (!response.success) throw new Error(response.error || 'Could not apply hunk action.');
      await get().refreshStatus();
      await get().openFileDiff(current.filePath, operation === 'stage' ? true : operation === 'unstage' ? false : current.isStaged);
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  loadConflict: async (filePath) => {
    try {
      const response = await window.electronAPI.gitGetConflictContent(filePath);
      if (!response.success || !response.data) throw new Error(response.error || 'Could not load conflict content.');
      set({ activeConflict: response.data, error: null });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
    }
  },

  closeConflict: () => set({ activeConflict: null }),

  resolveConflict: async (filePath, action) => {
    try {
      const response = await window.electronAPI.gitResolveConflict(filePath, action);
      if (!response.success) throw new Error(response.error || 'Could not resolve conflict.');
      set({ activeConflict: null });
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  abortMerge: async () => {
    try {
      const response = await window.electronAPI.gitAbortMerge();
      if (!response.success) throw new Error(response.error || 'Could not abort merge.');
      set({ activeConflict: null });
      await get().refreshStatus();
      return true;
    } catch (error: unknown) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  closeDiff: () => set({ activeDiff: null, activeHunks: [] })
}));
