import { gitService } from '../services/git-service';
import type {
  GitBlameHunk, GitBranchInfo, GitCommitDetail, GitCommitInfo, GitConflictContent,
  GitFileDiff, GitGraphResult, GitHunk, GitRemoteInfo, GitRepositoryInfo, GitStashInfo,
  GitStatusResult, GitSuggestedCommitMessage, GitTagInfo, IpcResponse
} from '../../preload/types';

export async function handleGitIsRepo(workspacePath: string): Promise<IpcResponse<boolean>> {
  try {
    const isRepo = Boolean(workspacePath) && (await gitService.isRepo(workspacePath));
    return { success: true, data: isRepo };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitInit(workspacePath: string): Promise<IpcResponse<void>> {
  try {
    if (!workspacePath) return { success: false, error: 'No workspace folder is open. Open a project before initializing Git.' };
    await gitService.init(workspacePath);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetStatus(workspacePath: string): Promise<IpcResponse<GitStatusResult>> {
  try {
    // Empty workspace must never probe process.cwd(); report "no repository" honestly instead
    if (!workspacePath) {
      return {
        success: true,
        data: {
          isRepo: false,
          isClean: true,
          currentBranch: '',
          ahead: 0,
          behind: 0,
          stagedFiles: [],
          unstagedFiles: [],
          untrackedFiles: [],
          conflictedFiles: [],
          repositoryRoot: ''
        }
      };
    }
    const status = await gitService.getStatus(workspacePath);
    return { success: true, data: status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetDiff(
  workspacePath: string,
  filePath?: string,
  staged = false
): Promise<IpcResponse<string>> {
  try {
    const diff = await gitService.getDiff(workspacePath, filePath, staged);
    return { success: true, data: diff };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetOriginalContent(
  workspacePath: string,
  filePath: string,
  staged = false
): Promise<IpcResponse<string>> {
  try {
    const content = await gitService.getFileOriginalContent(workspacePath, filePath, staged);
    return { success: true, data: content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitStage(
  workspacePath: string,
  filePaths: string | string[]
): Promise<IpcResponse<void>> {
  try {
    await gitService.stage(workspacePath, filePaths);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitUnstage(
  workspacePath: string,
  filePaths: string | string[]
): Promise<IpcResponse<void>> {
  try {
    await gitService.unstage(workspacePath, filePaths);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitDiscardChanges(
  workspacePath: string,
  filePath: string,
  isUntracked = false
): Promise<IpcResponse<void>> {
  try {
    await gitService.discardChanges(workspacePath, filePath, isUntracked);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitCommit(
  workspacePath: string,
  message: string,
  options?: { amend?: boolean }
): Promise<IpcResponse<string>> {
  try {
    const hash = await gitService.commit(workspacePath, message, options);
    return { success: true, data: hash };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetBranches(workspacePath: string): Promise<IpcResponse<GitBranchInfo>> {
  try {
    const branches = await gitService.getBranches(workspacePath);
    return { success: true, data: branches };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitCreateBranch(
  workspacePath: string,
  branchName: string
): Promise<IpcResponse<void>> {
  try {
    await gitService.createBranch(workspacePath, branchName);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitSwitchBranch(
  workspacePath: string,
  branchName: string
): Promise<IpcResponse<void>> {
  try {
    await gitService.switchBranch(workspacePath, branchName);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitDeleteBranch(
  workspacePath: string,
  branchName: string,
  force = false
): Promise<IpcResponse<void>> {
  try {
    await gitService.deleteBranch(workspacePath, branchName, force);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitFetch(workspacePath: string): Promise<IpcResponse<void>> {
  try {
    await gitService.fetch(workspacePath);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitPull(workspacePath: string): Promise<IpcResponse<string>> {
  try {
    const summary = await gitService.pull(workspacePath);
    return { success: true, data: summary };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitPush(
  workspacePath: string,
  remote?: string,
  branch?: string
): Promise<IpcResponse<string>> {
  try {
    const summary = await gitService.push(workspacePath, remote, branch);
    return { success: true, data: summary };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetLog(
  workspacePath: string,
  maxCount = 50,
  search?: string
): Promise<IpcResponse<GitCommitInfo[]>> {
  try {
    const log = await gitService.getLog(workspacePath, maxCount, search);
    return { success: true, data: log };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetBlame(
  workspacePath: string,
  filePath: string
): Promise<IpcResponse<GitBlameHunk[]>> {
  try {
    const blame = await gitService.getBlame(workspacePath, filePath);
    return { success: true, data: blame };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitStash(
  workspacePath: string,
  action: 'list' | 'save' | 'pop' | 'drop',
  message?: string,
  index?: number
): Promise<IpcResponse<GitStashInfo[] | string>> {
  try {
    const res = await gitService.stash(workspacePath, action, message, index);
    return { success: true, data: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetRemotes(workspacePath: string): Promise<IpcResponse<GitRemoteInfo[]>> {
  try {
    const remotes = await gitService.getRemotes(workspacePath);
    return { success: true, data: remotes };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGitGetFileDiff(workspacePath: string, filePath: string, staged = false): Promise<IpcResponse<GitFileDiff>> {
  try { return { success: true, data: await gitService.getFileDiff(workspacePath, filePath, staged) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitGetCommitDetail(workspacePath: string, hash: string): Promise<IpcResponse<GitCommitDetail>> {
  try { return { success: true, data: await gitService.getCommitDetail(workspacePath, hash) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitGetTags(workspacePath: string): Promise<IpcResponse<GitTagInfo[]>> {
  try { return { success: true, data: await gitService.getTags(workspacePath) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitCreateTag(workspacePath: string, name: string, message?: string): Promise<IpcResponse<void>> {
  try { await gitService.createTag(workspacePath, name, message); return { success: true }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitDeleteTag(workspacePath: string, name: string): Promise<IpcResponse<void>> {
  try { await gitService.deleteTag(workspacePath, name); return { success: true }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitGetConflictContent(workspacePath: string, filePath: string): Promise<IpcResponse<GitConflictContent>> {
  try { return { success: true, data: await gitService.getConflictContent(workspacePath, filePath) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitResolveConflict(workspacePath: string, filePath: string, action: 'ours' | 'theirs' | 'mark-resolved'): Promise<IpcResponse<void>> {
  try { await gitService.resolveConflict(workspacePath, filePath, action); return { success: true }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitAbortMerge(workspacePath: string): Promise<IpcResponse<void>> {
  try { await gitService.abortMerge(workspacePath); return { success: true }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitGetHunks(workspacePath: string, filePath: string, staged = false): Promise<IpcResponse<GitHunk[]>> {
  try { return { success: true, data: await gitService.getHunks(workspacePath, filePath, staged) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitApplyHunk(workspacePath: string, filePath: string, hunkId: string, operation: 'stage' | 'unstage' | 'revert'): Promise<IpcResponse<void>> {
  try { await gitService.applyHunk(workspacePath, filePath, hunkId, operation); return { success: true }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function handleGitMerge(workspacePath: string, branchName: string): Promise<IpcResponse<{ success: boolean; conflicts?: string[]; message?: string }>> {
  try { return { success: true, data: await gitService.merge(workspacePath, branchName) }; }
  catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
}

/**
 * Renderer-supplied repo paths are accepted only when they belong to the
 * loaded workspace's discovered repositories (same containment posture as
 * the rest of the app). Falls back to the active workspace path.
 */
let repositoryAllowlist: { roots: string[]; resolvedAt: number } = { roots: [], resolvedAt: 0 };
const REPOSITORY_ALLOWLIST_TTL_MS = 10_000;

export async function resolveGitRepositoryPath(requested?: unknown, fallback = ''): Promise<string> {
  if (requested === undefined || requested === null || String(requested).trim() === '') return fallback;
  const requestedPath = String(requested).trim();
  const now = Date.now();
  if (now - repositoryAllowlist.resolvedAt > REPOSITORY_ALLOWLIST_TTL_MS) {
    try {
      const discovered = await gitService.listRepositories(fallback);
      repositoryAllowlist = { roots: discovered.map((repo) => repo.root.toLowerCase()), resolvedAt: now };
    } catch {
      repositoryAllowlist = { roots: fallback ? [fallback.toLowerCase()] : [], resolvedAt: now };
    }
  }
  if (repositoryAllowlist.roots.includes(requestedPath.toLowerCase())) return requestedPath;
  throw new Error('The requested Git repository is not part of the loaded workspace.');
}

export async function handleGitListRepositories(workspacePath: string): Promise<IpcResponse<GitRepositoryInfo[]>> {
  try {
    if (!workspacePath) return { success: true, data: [] };
    const repositories = await gitService.listRepositories(workspacePath);
    // Explicit discovery refreshes the security allowlist used by resolveGitRepositoryPath.
    repositoryAllowlist = { roots: repositories.map((repo) => repo.root.toLowerCase()), resolvedAt: Date.now() };
    return { success: true, data: repositories };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleGitGetGraph(repoPath: string, maxCount?: number): Promise<IpcResponse<GitGraphResult>> {
  try {
    if (!repoPath) return { success: true, data: { commits: [], isRepo: false } };
    return { success: true, data: await gitService.getGraph(repoPath, maxCount) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleGitSuggestCommitMessage(repoPath: string): Promise<IpcResponse<GitSuggestedCommitMessage>> {
  try {
    if (!repoPath) return { success: false, error: 'No workspace folder is open.' };
    return { success: true, data: await gitService.suggestCommitMessage(repoPath) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
