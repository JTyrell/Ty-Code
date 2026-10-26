import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { simpleGit, type SimpleGit, type SimpleGitOptions, type StatusResult } from 'simple-git';
import type {
  GitBlameHunk,
  GitBranchInfo,
  GitCommitDetail,
  GitCommitInfo,
  GitConflictContent,
  GitFileChange,
  GitFileDiff,
  GitGraphCommit,
  GitGraphResult,
  GitGraphRefs,
  GitHunk,
  GitRemoteInfo,
  GitRepositoryInfo,
  GitStashInfo,
  GitStatusResult,
  GitSuggestedCommitMessage,
  GitTagInfo
} from '../../preload/types';

const MAX_DIFF_CHARS = 200_000;
const MAX_GIT_OUTPUT_CHARS = 300_000;
const NETWORK_TIMEOUT_MS = 120_000;
const GRAPH_MAX_COMMITS = 400;
const MAX_SUGGEST_PATCH_CHARS = 1_500;
const MAX_SUGGEST_FILES = 20;
const MAX_BODY_BULLETS = 10;

export class GitService {
  private getGit(workspacePath: string): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
      baseDir: path.resolve(workspacePath),
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
      allowEnvironment: [
        'GIT_OPTIONAL_LOCKS',
        'GIT_SSH_COMMAND',
        'GIT_TERMINAL_PROMPT',
        'GIT_TRACE',
        'GIT_AUTHOR_NAME',
        'GIT_AUTHOR_EMAIL',
        'GIT_COMMITTER_NAME',
        'GIT_COMMITTER_EMAIL'
      ]
    };
    return simpleGit(options);
  }

  private async getRepoRoot(workspacePath: string): Promise<string> {
    const root = await this.getGit(workspacePath).revparse(['--show-toplevel']);
    if (!root) throw new Error('Could not determine the Git repository root.');
    return path.resolve(root);
  }

  private async getRepoGit(workspacePath: string): Promise<{ git: SimpleGit; root: string }> {
    const root = await this.getRepoRoot(workspacePath);
    return { git: this.getGit(root), root };
  }

  private literalPathspec(repoPath: string): string {
    return `:(literal)${repoPath.replace(/\\/g, '/')}`;
  }

  private getWorkspaceOffset(workspacePath: string, root: string): string {
    const workspaceRoot = path.resolve(workspacePath);
    const workspaceOffset = path.relative(root, workspaceRoot);
    if (workspaceOffset === '..' || workspaceOffset.startsWith(`..${path.sep}`) || path.isAbsolute(workspaceOffset)) {
      throw new Error('The selected workspace is outside its Git repository.');
    }
    return workspaceOffset;
  }

  private async resolveRepoPath(workspacePath: string, filePath: string): Promise<{ root: string; absolutePath: string; relativePath: string; workspaceRelativePath: string }> {
    if (!filePath || path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) {
      throw new Error('Git file paths must be non-empty paths relative to the workspace.');
    }
    const root = await this.getRepoRoot(workspacePath);
    const workspaceRoot = path.resolve(workspacePath);
    this.getWorkspaceOffset(workspaceRoot, root);
    const absolutePath = path.resolve(workspaceRoot, filePath);
    const workspaceRelativePath = path.relative(workspaceRoot, absolutePath);
    if (!workspaceRelativePath || workspaceRelativePath === '..' || workspaceRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(workspaceRelativePath)) {
      throw new Error(`Git path is outside the selected workspace: "${filePath}"`);
    }
    const relativePath = path.relative(root, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error(`Git path is outside the repository: "${filePath}"`);
    }
    return {
      root,
      absolutePath,
      relativePath: relativePath.split(path.sep).join('/'),
      workspaceRelativePath: workspaceRelativePath.split(path.sep).join('/')
    };
  }

  private async safeReadFile(root: string, workspaceRoot: string, absolutePath: string): Promise<string> {
    try {
      const realRoot = await fs.realpath(root);
      const realWorkspace = await fs.realpath(workspaceRoot);
      const realTarget = await fs.realpath(absolutePath);
      const repoRelative = path.relative(realRoot, realTarget);
      const workspaceRelative = path.relative(realWorkspace, realTarget);
      if ([repoRelative, workspaceRelative].some((relative) => relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
        throw new Error('Git file resolves outside the active workspace.');
      }
      return await fs.readFile(realTarget, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  public sanitizeCommitMessage(message: string): string {
    const sanitized = (message || '').replace(/\0/g, '').trim();
    if (!sanitized) throw new Error('Commit message cannot be empty.');
    if (sanitized.length > 50_000) throw new Error('Commit message exceeds maximum permitted length (50,000 characters).');
    return sanitized;
  }

  private assertBranchName(git: SimpleGit, name: string): Promise<string> {
    const normalized = (name || '').replace(/\0/g, '').trim();
    if (!normalized || normalized.length > 240 || normalized.startsWith('-')) {
      throw new Error('Enter a valid branch name.');
    }
    return git.raw(['check-ref-format', '--branch', normalized]).then(() => normalized);
  }

  private assertTagName(git: SimpleGit, name: string): Promise<string> {
    const normalized = (name || '').replace(/\0/g, '').trim();
    if (!normalized || normalized.length > 240 || normalized.startsWith('-') || normalized.startsWith('refs/')) {
      throw new Error('Enter a valid tag name.');
    }
    return git.raw(['check-ref-format', `refs/tags/${normalized}`]).then(() => normalized);
  }

  private redactSensitiveText(value: string): string {
    return value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
      .replace(/^[^@\s]+@/gm, '[redacted]@')
      .replace(/([?&](?:token|access_token|password|auth)=)[^&\s]*/gi, '$1[redacted]');
  }

  private safeRemoteUrl(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      if (parsed.username) parsed.username = '[redacted]';
      if (parsed.password) parsed.password = '[redacted]';
      for (const key of ['token', 'access_token', 'password', 'auth']) {
        if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[redacted]');
      }
      return this.redactSensitiveText(parsed.toString()).replace(/\/$/, '');
    } catch {
      return this.redactSensitiveText(url);
    }
  }


  private async runRemoteOperation(root: string, args: string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: root,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
        windowsHide: true
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) { settled = true; reject(new Error('Git remote operation timed out after 120 seconds.')); }
      }, NETWORK_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout = (stdout + chunk.toString()).slice(-MAX_GIT_OUTPUT_CHARS); });
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-MAX_GIT_OUTPUT_CHARS); });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(this.redactSensitiveText(stderr.trim()) || `git ${args[0]} exited with code ${code ?? 'unknown'}.`));
      });
    });
  }

  async isRepo(workspacePath: string): Promise<boolean> {
    try {
      return await this.getGit(workspacePath).checkIsRepo();
    } catch {
      return false;
    }
  }

  async isTracked(workspacePath: string, filePath: string): Promise<boolean> {
    try {
      const { git } = await this.getRepoGit(workspacePath);
      const { relativePath } = await this.resolveRepoPath(workspacePath, filePath);
      await git.raw(['ls-files', '--error-unmatch', '--', this.literalPathspec(relativePath)]);
      return true;
    } catch {
      return false;
    }
  }

  async init(workspacePath: string): Promise<void> {
    await this.getGit(workspacePath).init();
  }

  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    if (!(await this.isRepo(workspacePath))) {
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

    const { git, root } = await this.getRepoGit(workspacePath);
    const status: StatusResult = await git.env('GIT_OPTIONAL_LOCKS', '0').status();
    const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
    const statusPath = (repoPath: string): string | null => {
      if (!workspaceOffset) return repoPath;
      const prefix = `${workspaceOffset}/`;
      return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
    };
    const stagedFiles: GitFileChange[] = [];
    const unstagedFiles: GitFileChange[] = [];
    const untrackedFiles: GitFileChange[] = [];
    const conflictedFiles: GitFileChange[] = [];
    const mapCode = (indexCode: string, workingTreeCode: string): GitFileChange['status'] => {
      if (indexCode === 'U' || workingTreeCode === 'U') return 'C';
      if (indexCode === '?' || workingTreeCode === '?') return 'U';
      if (indexCode === 'A' || workingTreeCode === 'A') return 'A';
      if (indexCode === 'D' || workingTreeCode === 'D') return 'D';
      if (indexCode === 'R' || workingTreeCode === 'R') return 'R';
      if (indexCode === 'C' || workingTreeCode === 'C') return 'C';
      return 'M';
    };

    for (const file of status.files) {
      const visiblePath = statusPath(file.path);
      if (visiblePath === null) continue;
      const originalRepoPath = file.from && file.from !== file.path ? file.from : undefined;
      const originalPath = originalRepoPath ? statusPath(originalRepoPath) || undefined : undefined;
      if (file.index === 'U' || file.working_dir === 'U' || status.conflicted.includes(file.path)) {
        conflictedFiles.push({ path: visiblePath, originalPath, status: 'C', staged: false, workingTree: true });
        continue;
      }
      if (file.index === '?' || file.working_dir === '?') {
        untrackedFiles.push({ path: visiblePath, status: 'U', staged: false, workingTree: true });
        continue;
      }
      if (file.index !== ' ') {
        stagedFiles.push({ path: visiblePath, originalPath, status: mapCode(file.index, ' '), staged: true, workingTree: false });
      }
      if (file.working_dir !== ' ') {
        unstagedFiles.push({ path: visiblePath, originalPath, status: mapCode(' ', file.working_dir), staged: false, workingTree: true });
      }
    }

    const [userNameConfig, userEmailConfig, remotes] = await Promise.all([
      git.getConfig('user.name').catch(() => undefined),
      git.getConfig('user.email').catch(() => undefined),
      git.getRemotes(true).catch(() => [])
    ]);
    const remote = remotes[0];

    return {
      isRepo: true,
      repositoryRoot: root,
      currentBranch: status.current || 'HEAD (detached)',
      trackingBranch: status.tracking || undefined,
      ahead: status.ahead,
      behind: status.behind,
      isClean: stagedFiles.length + unstagedFiles.length + untrackedFiles.length + conflictedFiles.length === 0,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      conflictedFiles,
      userName: userNameConfig?.value || undefined,
      userEmail: userEmailConfig?.value || undefined,
      remoteUrl: this.safeRemoteUrl(remote?.refs.fetch || remote?.refs.push)
    };
  }

  async getDiff(workspacePath: string, filePath?: string, staged = false): Promise<string> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const args: string[] = ['--no-ext-diff'];
    if (staged) args.push('--cached');
    const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
    const pathspec = filePath
      ? (await this.resolveRepoPath(workspacePath, filePath)).relativePath
      : workspaceOffset || '.';
    args.push('--', this.literalPathspec(pathspec));
    return git.diff(args);
  }

  async getFileOriginalContent(workspacePath: string, filePath: string, staged = false): Promise<string> {
    const { git } = await this.getRepoGit(workspacePath);
    const { relativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const revision = staged ? 'HEAD' : ':0';
    try {
      return await git.show([`${revision}:${relativePath}`]);
    } catch {
      return '';
    }
  }

  async getFileDiff(workspacePath: string, filePath: string, staged = false): Promise<GitFileDiff> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const { absolutePath, relativePath, workspaceRelativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const originalContent = await this.getFileOriginalContent(root, relativePath, staged);
    let modifiedContent = '';
    if (staged) {
      try {
        modifiedContent = await git.show([`:0:${relativePath}`]);
      } catch {
        modifiedContent = '';
      }
    } else {
      modifiedContent = await this.safeReadFile(root, path.resolve(workspacePath), absolutePath);
    }
    const patch = await this.getDiff(root, relativePath, staged);
    return { filePath: workspaceRelativePath, originalContent, modifiedContent, patch };
  }

  async stage(workspacePath: string, filePaths: string | string[]): Promise<void> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const targets = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (targets.length === 0 || (targets.length === 1 && targets[0] === '.')) {
      const workspaceOffset = path.relative(root, path.resolve(workspacePath)).split(path.sep).join('/');
      await git.raw(['add', '--', this.literalPathspec(workspaceOffset || '.')]);
      return;
    }
    const safePaths = await Promise.all(targets.map(async (target) => this.literalPathspec((await this.resolveRepoPath(workspacePath, target)).relativePath)));
    await git.raw(['add', '--', ...safePaths]);
  }

  async unstage(workspacePath: string, filePaths: string | string[]): Promise<void> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const targets = Array.isArray(filePaths) ? filePaths : [filePaths];
    const all = targets.length === 0 || (targets.length === 1 && targets[0] === '.');
    const status = await git.status();
    const workspaceOffset = path.relative(root, path.resolve(workspacePath)).split(path.sep).join('/');
    const prefix = workspaceOffset ? `${workspaceOffset}/` : '';
    const safePaths = all
      ? status.files.filter((file) => file.index !== ' ' && file.index !== '?' && (!prefix || file.path.startsWith(prefix))).map((file) => this.literalPathspec(file.path))
      : await Promise.all(targets.map(async (target) => this.literalPathspec((await this.resolveRepoPath(workspacePath, target)).relativePath)));
    if (safePaths.length === 0) return;

    const hasHead = await git.raw(['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
    if (hasHead) {
      await git.reset(['HEAD', '--', ...safePaths]);
    } else {
      await git.raw(['rm', '--cached', '--ignore-unmatch', '-r', '--', ...safePaths]);
    }
  }

  async discardChanges(workspacePath: string, filePath: string, isUntracked = false): Promise<void> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const { absolutePath, relativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const status = await git.status();
    const affected = status.files.filter((entry) => entry.path === relativePath || entry.path.startsWith(`${relativePath}/`));
    if (affected.length === 0) throw new Error(`No Git changes found for "${relativePath}".`);

    if (isUntracked) {
      if (!affected.every((entry) => entry.index === '?' || entry.working_dir === '?')) {
        throw new Error('Refusing to delete a path containing tracked or staged changes. Discard untracked files individually.');
      }
      const targetStats = await fs.lstat(absolutePath);
      if (targetStats.isDirectory()) throw new Error('Refusing to recursively remove untracked directories. Discard their files individually.');
      const activeWorkspace = await fs.realpath(workspacePath);
      const realParent = await fs.realpath(path.dirname(absolutePath));
      const parentRelative = path.relative(activeWorkspace, realParent);
      if (parentRelative === '..' || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) {
        throw new Error('Refusing to delete an untracked path outside the active workspace.');
      }
      const realRoot = await fs.realpath(root);
      const repoRelative = path.relative(realRoot, realParent);
      if (repoRelative === '..' || repoRelative.startsWith(`..${path.sep}`) || path.isAbsolute(repoRelative)) {
        throw new Error('Refusing to delete an untracked path outside the Git repository.');
      }
      await fs.rm(absolutePath, { recursive: true, force: true });
      return;
    }
    if (affected.some((entry) => entry.index === '?' || entry.working_dir === '?')) throw new Error('This path contains untracked files; discard them individually.');
    await git.raw(['restore', '--worktree', '--', this.literalPathspec(relativePath)]);
  }

  async commit(workspacePath: string, message: string, options?: { amend?: boolean }): Promise<string> {
    const safeMessage = this.sanitizeCommitMessage(message);
    const { git, root } = await this.getRepoGit(workspacePath);
    const status = await git.status();
    if (status.conflicted.length > 0) throw new Error('Resolve all merge conflicts before committing.');
    const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
    if (workspaceOffset) {
      const prefix = `${workspaceOffset}/`;
      const stagedOutsideWorkspace = status.files.filter((file) => file.index !== ' ' && file.index !== '?' && file.path !== workspaceOffset && !file.path.startsWith(prefix));
      if (stagedOutsideWorkspace.length > 0) {
        throw new Error(`The Git index contains staged changes outside this workspace (${stagedOutsideWorkspace.map((file) => file.path).join(', ')}). Commit those separately first.`);
      }
    }
    const commitOptions = options?.amend ? ['--amend'] : [];
    const result = await git.commit(safeMessage, commitOptions);
    return result.commit || 'committed';
  }

  async getBranches(workspacePath: string): Promise<GitBranchInfo> {
    const { git } = await this.getRepoGit(workspacePath);
    const summary = await git.branch();
    const branches: GitBranchInfo['branches'] = {};
    for (const [name, branch] of Object.entries(summary.branches)) {
      branches[name] = { current: branch.current, name: branch.name, commit: branch.commit, label: branch.label };
    }
    return { current: summary.current, all: summary.all, branches };
  }

  async createBranch(workspacePath: string, branchName: string): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    await git.checkoutLocalBranch(await this.assertBranchName(git, branchName));
  }

  async switchBranch(workspacePath: string, branchName: string): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    const status = await git.status();
    if (!status.isClean()) throw new Error('Commit or stash working-tree changes before switching branches.');
    await git.checkout(await this.assertBranchName(git, branchName));
  }

  async deleteBranch(workspacePath: string, branchName: string, force = false): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    const name = await this.assertBranchName(git, branchName);
    const status = await git.status();
    if (status.current === name) throw new Error('Cannot delete the currently checked out branch.');
    await git.deleteLocalBranch(name, force);
  }

  async fetch(workspacePath: string): Promise<void> {
    const root = await this.getRepoRoot(workspacePath);
    await this.runRemoteOperation(root, ['fetch', '--prune']);
  }

  async pull(workspacePath: string): Promise<string> {
    const root = await this.getRepoRoot(workspacePath);
    const status = await this.getGit(root).status();
    if (!status.tracking) throw new Error('No upstream branch is configured. Set an upstream before pulling.');
    const output = await this.runRemoteOperation(root, ['pull', '--ff-only']);
    return output || 'Pulled successfully. Repository is up to date.';
  }

  async push(workspacePath: string, remote?: string, branch?: string): Promise<string> {
    const root = await this.getRepoRoot(workspacePath);
    const git = this.getGit(root);
    const status = await git.status();
    const targetBranch = branch ? await this.assertBranchName(git, branch) : status.current;
    if (!targetBranch || targetBranch === 'HEAD') throw new Error('Cannot push while HEAD is detached.');
    const remotes = await git.getRemotes(true);
    const targetRemote = remote || (branch ? status.tracking?.split('/')[0] : undefined) || status.tracking?.split('/')[0] || 'origin';
    if (targetRemote.startsWith('-') || !remotes.some((item) => item.name === targetRemote)) {
      throw new Error(`Git remote "${targetRemote}" is not configured.`);
    }
    const args = branch || remote || !status.tracking
      ? ['push', ...(!status.tracking && !remote ? ['--set-upstream'] : []), targetRemote, targetBranch]
      : ['push'];
    const output = await this.runRemoteOperation(root, args);
    return output || 'Pushed to remote successfully.';
  }

  async getLog(workspacePath: string, maxCount = 50, search?: string): Promise<GitCommitInfo[]> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const options: Record<string, unknown> = { maxCount: Math.max(1, Math.min(100, Math.floor(maxCount) || 50)) };
    const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
    if (workspaceOffset) options.file = this.literalPathspec(workspaceOffset);
    const normalizedSearch = search?.trim().slice(0, 200);
    if (normalizedSearch) options['--grep'] = normalizedSearch;
    const summary = await git.log(options).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('does not have any commits yet') || message.includes('bad default revision')) return { all: [] as Array<Awaited<ReturnType<typeof git.log>>['all'][number]> };
      throw err;
    });
    return summary.all.map((commit) => {
      const record = commit as unknown as { hash: string; author_name: string; author_email: string; date: string; message: string; refs?: string };
      return {
        hash: record.hash,
        shortHash: record.hash.slice(0, 7),
        authorName: record.author_name,
        authorEmail: record.author_email,
        date: record.date,
        message: record.message,
        refs: record.refs
      };
    });
  }

  async getCommitDetail(workspacePath: string, hash: string): Promise<GitCommitDetail> {
    if (!/^[0-9a-f]{7,64}$/i.test(hash)) throw new Error('Invalid commit identifier.');
    const { git } = await this.getRepoGit(workspacePath);
    const record = (await git.raw(['show', '-s', '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%D', hash])).split('\0');
    if (!record[0] || !record[1]) throw new Error(`Commit "${hash}" was not found.`);
    const item: GitCommitInfo = {
      hash: record[0],
      shortHash: record[1],
      authorName: record[2] || 'Unknown',
      authorEmail: record[3] || '',
      date: record[4] || '',
      message: record[5] || '',
      refs: record[6]?.trim() || undefined
    };
    const root = await this.getRepoRoot(workspacePath);
    const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
    const names = await git.raw(['diff-tree', '--root', '--first-parent', '--no-commit-id', '--name-status', '-r', item.hash]);
    const prefix = workspaceOffset ? `${workspaceOffset}/` : '';
    const files: GitFileChange[] = names.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [code = 'M', first = '', second] = line.split('\t');
      const renamed = code.startsWith('R') && Boolean(second);
      const sourcePath = renamed ? second as string : first;
      if (prefix && sourcePath !== workspaceOffset && !sourcePath.startsWith(prefix)) return [];
      return [{
        path: prefix ? sourcePath.slice(prefix.length) : sourcePath,
        originalPath: renamed ? first : undefined,
        status: code.startsWith('A') ? 'A' : code.startsWith('D') ? 'D' : code.startsWith('R') ? 'R' : 'M',
        staged: false,
        workingTree: false
      }];
    });
    const showArgs = workspaceOffset ? [item.hash, '--', this.literalPathspec(workspaceOffset)] : [item.hash];
    const diff = (await git.show(showArgs)).slice(0, MAX_DIFF_CHARS);
    return { commit: item, files, diff };
  }

  async getBlame(workspacePath: string, filePath: string): Promise<GitBlameHunk[]> {
    const { git } = await this.getRepoGit(workspacePath);
    const { relativePath } = await this.resolveRepoPath(workspacePath, filePath);
    try {
      const raw = await git.raw(['blame', '--line-porcelain', '--', this.literalPathspec(relativePath)]);
      const hunks: GitBlameHunk[] = [];
      const lines = raw.split('\n');
      let currentHash = '';
      let author = '';
      let authorEmail = '';
      let timestamp = 0;
      let summary = '';
      let lineNumber = 0;
      for (const line of lines) {
        const header = line.match(/^([0-9a-f]{40,64})\s+\d+\s+(\d+)/i);
        if (header) {
          currentHash = header[1];
          lineNumber = Number.parseInt(header[2], 10);
        } else if (line.startsWith('author ')) author = line.slice(7);
        else if (line.startsWith('author-mail ')) authorEmail = line.slice(12).replace(/[<>]/g, '');
        else if (line.startsWith('author-time ')) timestamp = Number.parseInt(line.slice(12), 10) * 1000;
        else if (line.startsWith('summary ')) summary = line.slice(8);
        else if (line.startsWith('\t')) {
          hunks.push({ commitHash: currentHash, author: author || 'Unknown', authorEmail, timestamp, dateString: timestamp ? new Date(timestamp).toLocaleDateString() : '', summary, lineStart: lineNumber, lineCount: 1 });
        }
      }
      return hunks;
    } catch {
      return [];
    }
  }

  async stash(workspacePath: string, action: 'list' | 'save' | 'pop' | 'drop', message?: string, index?: number): Promise<GitStashInfo[] | string> {
    const { git } = await this.getRepoGit(workspacePath);
    if (action === 'list') {
      const list = await git.stashList();
      return list.all.map((stash, stashIndex) => ({ index: stashIndex, hash: stash.hash, date: stash.date, message: stash.message }));
    }
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) throw new Error('Stash index must be a non-negative integer.');
    if (action === 'save') {
      const root = await this.getRepoRoot(workspacePath);
      const workspaceOffset = this.getWorkspaceOffset(workspacePath, root).split(path.sep).join('/');
      const prefix = workspaceOffset ? `${workspaceOffset}/` : '';
      const status = await git.status();
      const workspaceChanges = status.files.filter((file) => !prefix || file.path === workspaceOffset || file.path.startsWith(prefix));
      if (workspaceChanges.length === 0) throw new Error('There are no changes in the active workspace to stash.');
      const pathspec = workspaceOffset ? ['--', this.literalPathspec(workspaceOffset)] : [];
      const args = message?.trim()
        ? ['push', '--include-untracked', '-m', message.trim().slice(0, 200), ...pathspec]
        : ['push', '--include-untracked', ...pathspec];
      await git.stash(args);
      return 'Workspace changes stashed.';
    }
    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    if (action === 'pop') await git.stash(['pop', stashRef]);
    else if (action === 'drop') await git.stash(['drop', stashRef]);
    else throw new Error(`Unknown stash action: ${action}`);
    return `Stash ${action} completed.`;
  }

  async getRemotes(workspacePath: string): Promise<GitRemoteInfo[]> {
    const { git } = await this.getRepoGit(workspacePath);
    const remotes = await git.getRemotes(true);
    return remotes.map((remote) => {
      const url = remote.refs.fetch || remote.refs.push || '';
      let provider: GitRemoteInfo['provider'] = 'other';
      if (/github\.com/i.test(url)) provider = 'github';
      else if (/gitlab\.com/i.test(url)) provider = 'gitlab';
      else if (/bitbucket\.org/i.test(url)) provider = 'bitbucket';
      return { name: remote.name, fetchUrl: this.safeRemoteUrl(remote.refs.fetch), pushUrl: this.safeRemoteUrl(remote.refs.push), provider };
    });
  }

  async getTags(workspacePath: string): Promise<GitTagInfo[]> {
    const { git } = await this.getRepoGit(workspacePath);
    const output = await git.raw(['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/tags']);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, commit = ''] = line.split('\t');
      return { name, commit };
    });
  }

  async createTag(workspacePath: string, tagName: string, message?: string): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    const name = await this.assertTagName(git, tagName);
    if (message?.trim()) await git.raw(['tag', '-a', name, '-m', message.trim().slice(0, 500)]);
    else await git.raw(['tag', name]);
  }

  async deleteTag(workspacePath: string, tagName: string): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    await git.raw(['tag', '-d', await this.assertTagName(git, tagName)]);
  }

  async getConflictContent(workspacePath: string, filePath: string): Promise<GitConflictContent> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const { absolutePath, relativePath, workspaceRelativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const showStage = async (stage: number): Promise<string | undefined> => {
      try { return await git.show([`:${stage}:${relativePath}`]); } catch { return undefined; }
    };
    const [baseContent, oursContent, theirsContent, workingContent] = await Promise.all([
      showStage(1), showStage(2), showStage(3), this.safeReadFile(root, path.resolve(workspacePath), absolutePath)
    ]);
    return { filePath: workspaceRelativePath, baseContent, oursContent, theirsContent, workingContent };
  }

  async resolveConflict(workspacePath: string, filePath: string, action: 'ours' | 'theirs' | 'mark-resolved'): Promise<void> {
    if (!['ours', 'theirs', 'mark-resolved'].includes(action)) throw new Error('Invalid conflict resolution action.');
    const { git } = await this.getRepoGit(workspacePath);
    const { relativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const status = await git.status();
    if (!status.conflicted.includes(relativePath)) throw new Error(`"${relativePath}" is not currently conflicted.`);
    if (action === 'ours' || action === 'theirs') await git.raw(['checkout', `--${action}`, '--', this.literalPathspec(relativePath)]);
    if (action === 'mark-resolved') {
      const { root, absolutePath } = await this.resolveRepoPath(workspacePath, filePath);
      const content = await this.safeReadFile(root, path.resolve(workspacePath), absolutePath);
      if (/^(<{7}|={7}|>{7})/m.test(content)) throw new Error('Conflict markers remain in the working file. Edit the file before marking it resolved.');
    }
    await git.raw(['add', '--', this.literalPathspec(relativePath)]);
  }

  async abortMerge(workspacePath: string): Promise<void> {
    const { git } = await this.getRepoGit(workspacePath);
    await git.raw(['merge', '--abort']);
  }

  async getHunks(workspacePath: string, filePath: string, staged = false): Promise<GitHunk[]> {
    const { git } = await this.getRepoGit(workspacePath);
    const { relativePath } = await this.resolveRepoPath(workspacePath, filePath);
    const args = ['--no-ext-diff', '--unified=3'];
    if (staged) args.push('--cached');
    args.push('--', this.literalPathspec(relativePath));
    const patch = await git.diff(args);
    const firstHunkIndex = patch.indexOf('@@ -');
    if (firstHunkIndex < 0) return [];
    const header = patch.slice(0, firstHunkIndex);
    const blocks = patch.slice(firstHunkIndex).split(/(?=^@@ -)/m).filter(Boolean);
    return blocks.map((block, index) => {
      const hunkHeader = block.split(/\r?\n/, 1)[0];
      const match = hunkHeader.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      return {
        id: `${index}:${hunkHeader}`,
        header: hunkHeader,
        patch: `${header}${block}`,
        oldStart: match ? Number.parseInt(match[1], 10) : 0,
        newStart: match ? Number.parseInt(match[3], 10) : 0
      };
    });
  }

  async applyHunk(workspacePath: string, filePath: string, hunkId: string, operation: 'stage' | 'unstage' | 'revert'): Promise<void> {
    if (!['stage', 'unstage', 'revert'].includes(operation)) throw new Error('Invalid hunk operation.');
    const staged = operation === 'unstage';
    const hunk = (await this.getHunks(workspacePath, filePath, staged)).find((item) => item.id === hunkId);
    if (!hunk) throw new Error('The selected hunk is no longer current. Refresh the diff and try again.');
    const root = await this.getRepoRoot(workspacePath);
    const args = ['apply', '--unidiff-zero'];
    if (operation === 'stage' || operation === 'unstage') args.push('--cached');
    if (operation === 'unstage' || operation === 'revert') args.push('--reverse');
    await this.runGitWithInput(root, args, hunk.patch);
  }

  private async runGitWithInput(cwd: string, args: string[], input: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
        windowsHide: true
      });
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) { settled = true; reject(new Error('Git hunk operation timed out.')); }
      }, 20_000);
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `git apply exited with code ${code ?? 'unknown'}.`));
      });
      child.stdin?.end(input);
    });
  }

  async merge(workspacePath: string, branchName: string): Promise<{ success: boolean; conflicts?: string[]; message?: string }> {
    const { git } = await this.getRepoGit(workspacePath);
    const name = await this.assertBranchName(git, branchName);
    const beforeMerge = await git.status();
    if (!beforeMerge.isClean()) throw new Error('Commit or stash working-tree changes before merging branches.');
    try {
      const result = await git.merge([name]);
      if (result.conflicts?.length) {
        const conflicts = result.conflicts.map((conflict) => typeof conflict === 'string' ? conflict : conflict.file).filter((file): file is string => Boolean(file));
        return { success: false, conflicts, message: `Merge resulted in ${conflicts.length} conflict(s).` };
      }
      return { success: true, message: `Successfully merged ${name}.` };
    } catch (err: unknown) {
      const status = await git.status();
      if (status.conflicted.length) return { success: false, conflicts: status.conflicted, message: `Conflicts encountered while merging ${name}.` };
      throw err;
    }
  }

  /** A `.git` marker can be a directory or a file (worktrees/submodules). */
  private async hasGitMarker(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    try {
      await fs.stat(path.join(candidate, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Source-control repositories for a loaded workspace, like VS Code's
   * Repositories section: the workspace folder itself, repos that contain it
   * (one level of nesting), and direct child repos. Bounded fs-only scan.
   */
  async listRepositories(workspacePath: string): Promise<GitRepositoryInfo[]> {
    const raw = (workspacePath || '').trim();
    if (!raw) return [];
    const base = path.resolve(raw);
    const seen = new Map<string, GitRepositoryInfo>();
    const add = (root: string, kind: GitRepositoryInfo['kind']): void => {
      const resolved = path.resolve(root);
      const key = resolved.toLowerCase();
      if (!seen.has(key)) seen.set(key, { root: resolved, name: path.basename(resolved) || resolved, kind });
    };
    if (await this.hasGitMarker(base)) add(base, 'workspace');
    let parent = path.dirname(base);
    for (let level = 0; level < 2 && parent !== path.parse(parent).root; level += 1) {
      if (await this.hasGitMarker(parent)) add(parent, 'parent');
      parent = path.dirname(parent);
    }
    let children: string[] = [];
    try {
      children = (await fs.readdir(base, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map((entry) => path.join(base, entry.name));
    } catch {
      children = [];
    }
    for (const child of children) {
      if (await this.hasGitMarker(child)) add(child, 'child');
    }
    const order: Record<GitRepositoryInfo['kind'], number> = { workspace: 0, parent: 1, child: 2 };
    return [...seen.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.root.localeCompare(b.root));
  }

  /**
   * Commit graph data for the Source Control Graph view: DAG edges plus
   * branch/remote/tag decorations per commit, across the whole repository
   * (restricted to the workspace subtree when the opened folder is nested).
   */
  async getGraph(workspacePath: string, maxCount = 100): Promise<GitGraphResult> {
    const { git, root } = await this.getRepoGit(workspacePath);
    const count = Math.max(1, Math.min(GRAPH_MAX_COMMITS, Math.floor(maxCount) || 100));
    const args = ['log', String(count), '--all', '--date-order', '--pretty=format:%H%x00%P%x00%an%x00%at%x00%s%x00%D'];
    const workspaceOffset = this.getWorkspaceOffset(path.resolve(workspacePath), root).split(path.sep).join('/');
    if (workspaceOffset) args.push('--', this.literalPathspec(workspaceOffset));
    const raw = await git.raw(args).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('does not have any commits yet') || message.includes('bad default revision')) return '';
      throw err;
    });
    const { commits, head } = parseGraphRaw(raw);
    let currentBranch: string | undefined;
    try {
      currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim() || undefined;
    } catch {
      currentBranch = undefined;
    }
    return { commits, head, currentBranch, isRepo: true };
  }

  /**
   * Offline, deterministic commit message proposal derived from the working
   * tree (no network, no LLM): conventional-commit type/scope plus a subject
   * and per-file body bullets computed from paths, statuses and patch text.
   */
  async suggestCommitMessage(workspacePath: string): Promise<GitSuggestedCommitMessage> {
    const status = await this.getStatus(workspacePath);
    const changes = status.stagedFiles.length
      ? status.stagedFiles
      : [...status.unstagedFiles, ...status.untrackedFiles];
    if (!changes.length) throw new Error('There are no working-tree changes to generate a commit message from.');
    const selected = changes.slice(0, MAX_SUGGEST_FILES);
    const patches: string[] = [];
    for (const change of selected) {
      try {
        const patch = await this.getDiff(workspacePath, change.path, false);
        patches.push(patch.slice(0, MAX_SUGGEST_PATCH_CHARS));
      } catch {
        patches.push('');
      }
    }
    return buildCommitMessage(selected, patches);
  }
}

/**
 * Pure parser for the `getGraph` raw log format:
 *   hash%00parents%00author%00epoch%00subject%00refs
 * Refs decode: `HEAD -> name`, `tag: name`, and bare names where any name
 * containing a slash is treated as a remote branch.
 */
export function parseGraphRaw(raw: string): { commits: GitGraphCommit[]; head?: string } {
  const commits: GitGraphCommit[] = [];
  let head: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split('\x00');
    if (fields.length < 6) continue;
    const [hash = '', parentList = '', authorName = '', epoch = '', message = '', refsBlob = ''] = fields;
    const refs: GitGraphRefs = { branches: [], remoteBranches: [], tags: [], isHead: false };
    for (const token of refsBlob.split(',').map((item) => item.trim()).filter(Boolean)) {
      if (token.startsWith('HEAD -> ')) {
        refs.isHead = true;
        const branch = token.slice(8).trim();
        if (branch && !refs.branches.includes(branch)) refs.branches.push(branch);
        if (branch) head = branch;
        continue;
      }
      if (token.startsWith('tag: ')) {
        const tag = token.slice(5).trim();
        if (tag && !refs.tags.includes(tag)) refs.tags.push(tag);
        continue;
      }
      if (token.startsWith('HEAD')) {
        refs.isHead = true;
        continue;
      }
      if (token.includes('/')) {
        if (!refs.remoteBranches.includes(token)) refs.remoteBranches.push(token);
      } else if (token && !refs.branches.includes(token)) {
        refs.branches.push(token);
      }
    }
    commits.push({
      hash,
      parents: parentList ? parentList.split(' ').filter(Boolean) : [],
      message,
      authorName,
      timestamp: Number.parseInt(epoch, 10) || 0,
      refs
    });
  }
  return { commits, head };
}

const COMMIT_LETTER: Record<string, string> = { A: 'add', M: 'update', D: 'remove', U: 'add', C: 'fix', R: 'rename' };

function shareOf(paths: string[], predicate: (candidate: string) => boolean): number {
  if (!paths.length) return 0;
  let matching = 0;
  for (const candidate of paths) if (predicate(candidate)) matching += 1;
  return matching / paths.length;
}

function dominantTopDir(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const candidate of paths) {
    const segment = candidate.replace(/\\/g, '/').split('/')[0];
    if (!segment || segment.includes('.')) continue;
    counts.set(segment, (counts.get(segment) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [segment, count] of counts) {
    if (count > bestCount) {
      best = segment;
      bestCount = count;
    }
  }
  return best && best.length <= 20 ? best : undefined;
}

function subjectObject(paths: string[]): string {
  const stems = paths.map((candidate) => {
    const file = candidate.replace(/\\/g, '/').split('/').pop() || candidate;
    return file.replace(/\.[^.]+$/, '');
  });
  const counts = new Map<string, number>();
  for (const stem of stems) counts.set(stem, (counts.get(stem) || 0) + 1);
  let best = 'changes';
  let bestCount = -1;
  for (const [stem, count] of counts) {
    if (count > bestCount) {
      best = stem;
      bestCount = count;
    }
  }
  return best.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'changes';
}

/**
 * Pure, deterministic commit-message builder (offline heuristic, like the
 * natural-language service's synthesizers — no network, no LLM).
 */
export function buildCommitMessage(changes: Array<{ path: string; status: string }>, patches: string[]): GitSuggestedCommitMessage {
  const paths = changes.map((change) => change.path);
  let added = 0;
  let deleted = 0;
  let modified = 0;
  for (const change of changes) {
    if (change.status === 'A' || change.status === '?' || change.status === 'U') added += 1;
    else if (change.status === 'D') deleted += 1;
    else modified += 1;
  }
  const newText = [paths.join('\n'), ...patches].join('\n').toLowerCase();
  const slash = (needle: string): ((candidate: string) => boolean) => (candidate) => candidate.replace(/\\/g, '/').toLowerCase().includes(needle);
  const normalized = paths.map((candidate) => candidate.replace(/\\/g, '/').toLowerCase());
  const isDoc = (candidate: string): boolean => candidate.endsWith('.md') || candidate.split('/').slice(0, -1).some((segment) => segment === 'docs' || segment === 'doc');
  const isConfig = (candidate: string): boolean => [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json',
    '.editorconfig', '.gitignore', '.gitattributes', 'vite.config.ts', 'webpack.config.js'
  ].some((needle) => candidate.endsWith(needle)) || /(^|\/)(\.github|\.vscode|\.ty-code)\//.test(candidate);
  const isTest = (candidate: string): boolean => /\.(test|spec)\.[a-z]+$/.test(candidate) || /(^|\/)(tests?|__tests__)\//.test(candidate);
  const docShare = shareOf(normalized, isDoc);
  const configShare = shareOf(normalized, isConfig);
  const testShare = shareOf(normalized, isTest);
  const type = docShare === 1 ? 'docs'
    : configShare === 1 ? 'chore'
      : testShare === 1 ? 'test'
        : /\b(fix|bug|crash|regression|leak|race|null check|out of bounds|type error)\b/.test(newText) ? 'fix'
          : added >= modified && added >= deleted ? 'feat'
            : deleted > modified && deleted > added ? 'chore'
              : 'refactor';
  const scope = dominantTopDir(paths);
  const verb = added > deleted && added >= modified ? 'add'
    : deleted > added && deleted >= modified ? 'remove'
      : 'update';
  const subject = `${type}${scope ? `(${scope})` : ''}: ${verb} ${subjectObject(paths)}`.slice(0, 72);
  const bullets = changes.slice(0, MAX_BODY_BULLETS).map((change) => `- ${COMMIT_LETTER[change.status] || 'update'} ${change.path}`);
  if (changes.length > MAX_BODY_BULLETS) bullets.push(`- and ${changes.length - MAX_BODY_BULLETS} more file${changes.length - MAX_BODY_BULLETS === 1 ? '' : 's'}`);
  return { type, scope, subject, body: bullets.join('\n') };
}

export const gitService = new GitService();
