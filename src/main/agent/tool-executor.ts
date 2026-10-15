import { createHash } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import type { AgentToolApproval, ProposedDiff, ToolCall } from '../../preload/types';
import { gitService } from '../services/git-service';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager } from '../services/settings-manager';

export interface ToolExecutionResponse {
  output: string;
  isError?: boolean;
  proposedDiff?: ProposedDiff;
}

export class ToolExecutor {
  private readonly workspaceRoot: string;
  private readonly securityPolicy: SecurityPolicyEngine;

  constructor(workspaceRoot: string, securityPolicy?: SecurityPolicyEngine) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.securityPolicy = securityPolicy || new SecurityPolicyEngine(this.workspaceRoot, settingsManager);
  }

  private resolveSafePath(relativePath: string, allowMissing = false): Promise<string> {
    return this.securityPolicy.resolveFilePath(relativePath || '.', allowMissing);
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }

  async execute(name: string, args: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolExecutionResponse> {
    try {
      if (abortSignal?.aborted) return { output: 'Tool execution cancelled.', isError: true };
      switch (name) {
        case 'read_file': return await this.readFile(args);
        case 'replace_file_content': return await this.replaceFileContent(args);
        case 'write_file': return await this.writeFile(args);
        case 'run_command': return await this.runCommand(args, abortSignal);
        case 'list_dir': return await this.listDir(args);
        case 'grep_search': return await this.grepSearch(args);
        case 'git_status': return await this.gitStatus();
        case 'git_diff': return await this.gitDiff(args);
        case 'git_commit': return await this.gitCommit(args);
        case 'git_branch': return await this.gitBranch(args);
        case 'git_log': return await this.gitLog(args);
        case 'git_merge': return await this.gitMerge(args);
        default: return { output: `Unknown tool: "${name}"`, isError: true };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error executing tool "${name}": ${message}`, isError: true };
    }
  }

  private async readFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    const absolutePath = await this.resolveSafePath(filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? args.startLine : 1;
    const endLine = typeof args.endLine === 'number' && args.endLine >= startLine ? args.endLine : lines.length;
    const slice = lines.slice(startLine - 1, endLine);
    const formatted = slice.map((line, index) => `${startLine + index}: ${line}`).join('\n');
    return { output: `File: ${filePath} (lines ${startLine}-${Math.min(endLine, lines.length)} of ${lines.length})\n\n${formatted}` };
  }

  private async replaceFileContent(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    const targetContent = String(args.targetContent || '');
    const replacementContent = String(args.replacementContent ?? '');
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    if (!targetContent) return { output: 'Error: targetContent is required', isError: true };
    const absolutePath = await this.resolveSafePath(filePath);
    const original = await fs.readFile(absolutePath, 'utf-8');
    if (typeof args.__approvedOriginalHash === 'string'
      && createHash('sha256').update(original, 'utf8').digest('hex') !== args.__approvedOriginalHash) {
      return { output: `Error: ${filePath} changed after approval. Review the updated file before applying this change.`, isError: true };
    }
    if (!original.includes(targetContent)) {
      return { output: `Error: targetContent was not found in ${filePath}. Verify line numbers and whitespace by reading the file first.`, isError: true };
    }
    const occurrences = original.split(targetContent).length - 1;
    if (occurrences > 1) {
      return { output: `Error: targetContent matched ${occurrences} occurrences in ${filePath}. Provide a larger, unique chunk of surrounding context.`, isError: true };
    }
    // Use a callback replacer so JavaScript replacement tokens such as $&, $' and $$ stay literal.
    const modified = original.replace(targetContent, () => replacementContent);
    await this.atomicWrite(absolutePath, modified);
    const diff: ProposedDiff = {
      id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      filePath,
      originalContent: original,
      proposedContent: modified,
      description: `Modified ${filePath} via replace_file_content`,
      status: 'applied'
    };
    return { output: `Successfully replaced content in ${filePath}. Changes applied.`, proposedDiff: diff };
  }

  private async writeFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    const content = String(args.content ?? '');
    const overwrite = Boolean(args.overwrite);
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    const absolutePath = await this.resolveSafePath(filePath, true);
    let original = '';
    let fileExisted = false;
    try {
      original = await fs.readFile(absolutePath, 'utf-8');
      fileExisted = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (typeof args.__approvedOriginalHash === 'string') {
      const currentHash = createHash('sha256').update(original, 'utf8').digest('hex');
      if (currentHash !== args.__approvedOriginalHash || fileExisted !== (args.__approvedOriginalExists === true)) {
        return { output: `Error: ${filePath} changed after approval. Review the updated file before applying this change.`, isError: true };
      }
    }
    if (fileExisted && !overwrite) {
      return { output: `Error: File ${filePath} already exists. Set overwrite: true if you intend to replace it completely.`, isError: true };
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.atomicWrite(absolutePath, content);
    const diff: ProposedDiff = {
      id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      filePath,
      originalContent: original,
      proposedContent: content,
      description: fileExisted ? `Overwrote ${filePath}` : `Created ${filePath}`,
      status: 'applied'
    };
    return { output: `Successfully ${fileExisted ? 'overwrote' : 'created'} ${filePath}.`, proposedDiff: diff };
  }

  private async runCommand(args: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolExecutionResponse> {
    const command = String(args.command || '');
    if (!command) return { output: 'Error: command is required', isError: true };
    if (abortSignal?.aborted) return { output: 'Command execution cancelled.', isError: true };
    const requestedTimeout = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000;
    const timeout = Math.min(Math.max(requestedTimeout, 1_000), 120_000);
    const subCwd = args.cwd ? await this.resolveSafePath(String(args.cwd)) : this.workspaceRoot;

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const child = spawn(shell, shellArgs, { cwd: subCwd, env: { ...process.env, PAGER: 'cat' }, windowsHide: true });
      const cleanup = () => {
        clearTimeout(timer);
        abortSignal?.removeEventListener('abort', handleAbort);
      };
      const finish = (result: ToolExecutionResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const handleAbort = () => {
        aborted = true;
        child.kill('SIGTERM');
      };
      timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
      abortSignal?.addEventListener('abort', handleAbort, { once: true });
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
      child.on('close', (code) => {
        if (aborted) finish({ output: `Command cancelled. Output before cancellation:\n${stdout}\n${stderr}`, isError: true });
        else if (timedOut) finish({ output: `Command timed out after ${timeout}ms. Output before timeout:\n${stdout}\n${stderr}`, isError: true });
        else finish({ output: `Command: ${command}\nExit Code: ${code}\nStdout:\n${stdout || '(empty)'}\nStderr:\n${stderr || '(none)'}`, isError: code !== 0 });
      });
      child.on('error', (err) => finish({ output: `Failed to execute command: ${err.message}`, isError: true }));
    });
  }

  private async listDir(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const directoryPath = String(args.directoryPath || '');
    const recursive = Boolean(args.recursive);
    const absolutePath = await this.resolveSafePath(directoryPath);
    const ignored = new Set(['.git', '.kombai', 'node_modules', 'dist', 'dist-electron', 'out']);
    const scan = async (current: string, depth = 0): Promise<string[]> => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const fullPath = path.join(current, entry.name);
        results.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
        if (recursive && entry.isDirectory() && depth < 3) {
          const children = await scan(fullPath, depth + 1);
          results.push(...children.map((item) => `  ${item}`));
        }
      }
      return results;
    };
    const items = await scan(absolutePath);
    return { output: `Directory ${directoryPath || '.'} (${items.length} items):\n${items.join('\n')}` };
  }

  private async grepSearch(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const query = String(args.query || '');
    if (!query) return { output: 'Error: query is required', isError: true };
    const isRegex = Boolean(args.isRegex);
    const caseInsensitive = Boolean(args.caseInsensitive);
    const regex = isRegex
      ? new RegExp(query, caseInsensitive ? 'gi' : 'g')
      : new RegExp(query.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), caseInsensitive ? 'gi' : 'g');
    const matches: string[] = [];
    const ignored = new Set(['.git', '.kombai', 'node_modules', 'dist', 'dist-electron', 'out', 'package-lock.json']);
    const searchDir = async (directory: string): Promise<void> => {
      if (matches.length > 50) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await searchDir(fullPath);
        else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            content.split('\n').forEach((line, index) => {
              if (regex.test(line)) matches.push(`${path.relative(this.workspaceRoot, fullPath)}:${index + 1}: ${line.trim()}`);
              regex.lastIndex = 0;
            });
          } catch { /* Skip binary or unreadable files. */ }
        }
      }
    };
    await searchDir(this.workspaceRoot);
    return { output: `Grep Search for "${query}" (${matches.length} matches):\n${matches.slice(0, 50).join('\n') || 'No matches found.'}` };
  }

  private async gitStatus(): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository. Use `git init` or initialize via Source Control to enable Git.', isError: true };
    }

    const status = await gitService.getStatus(this.workspaceRoot);
    const lines = [
      `Repository: ${this.workspaceRoot}`,
      `Current Branch: ${status.currentBranch}`,
      status.trackingBranch ? `Tracking: ${status.trackingBranch} (Ahead: ${status.ahead}, Behind: ${status.behind})` : 'Tracking: None',
      `Clean: ${status.isClean ? 'Yes' : 'No'}`
    ];

    if (status.stagedFiles.length > 0) {
      lines.push('\nStaged Changes:');
      status.stagedFiles.forEach((f) => lines.push(`  [${f.status}] ${f.path}`));
    }
    if (status.unstagedFiles.length > 0) {
      lines.push('\nUnstaged Changes:');
      status.unstagedFiles.forEach((f) => lines.push(`  [${f.status}] ${f.path}`));
    }
    if (status.untrackedFiles.length > 0) {
      lines.push('\nUntracked Files:');
      status.untrackedFiles.forEach((f) => lines.push(`  [?] ${f.path}`));
    }
    if (status.conflictedFiles.length > 0) {
      lines.push('\nMerge Conflicts:');
      status.conflictedFiles.forEach((f) => lines.push(`  [C] ${f.path}`));
    }

    return { output: lines.join('\n') };
  }

  private async gitDiff(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository.', isError: true };
    }

    const filePath = args.filePath ? String(args.filePath) : undefined;
    const staged = Boolean(args.staged);
    const diff = await gitService.getDiff(this.workspaceRoot, filePath, staged);
    const truncated = diff.length > 30_000 ? `${diff.slice(0, 30_000)}\n\n[Diff truncated at 30,000 characters]` : diff;
    return { output: truncated || '(No diff output; working tree matching HEAD or no changes in specified scope)' };
  }

  private isSensitiveGitPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const name = normalized.split('/').pop() || normalized;
    return (name.startsWith('.env') && name !== '.env.example' && name !== '.env.sample')
      || ['.npmrc', '.netrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_dsa'].includes(name)
      || /(^|\/)([^/]*credentials[^/]*|secrets?\.(json|ya?ml))$/.test(normalized)
      || /\.(pem|key|p8|p12|pfx|keystore)$/i.test(name);
  }

  private async gitCommit(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository.', isError: true };
    }

    const message = String(args.message || '').trim();
    if (!message) return { output: 'Error: commit message is required', isError: true };

    const filePaths = Array.isArray(args.filePaths) ? (args.filePaths as string[]).map(String) : undefined;
    const stageAll = args.stageAll === true;
    const status = await gitService.getStatus(this.workspaceRoot);
    const visibleChanges = [...status.stagedFiles, ...status.unstagedFiles, ...status.untrackedFiles].map((file) => file.path);
    const stagedAfterOperation = filePaths?.length
      ? visibleChanges.filter((candidate) => filePaths.some((target) => target === '.' || candidate === target || candidate.startsWith(`${target.replace(/[\\/]+$/, '')}/`)))
      : stageAll
        ? visibleChanges
        : status.stagedFiles.map((file) => file.path);
    const sensitivePaths = [...new Set(stagedAfterOperation)].filter((filePath) => this.isSensitiveGitPath(filePath));
    if (sensitivePaths.length > 0) {
      return { output: `Refusing to stage likely secret files: ${sensitivePaths.join(', ')}. Stage these manually after reviewing them.`, isError: true };
    }

    if (filePaths && filePaths.length > 0) {
      await gitService.stage(this.workspaceRoot, filePaths);
    } else if (stageAll) {
      await gitService.stage(this.workspaceRoot, '.');
    }

    const commitHash = await gitService.commit(this.workspaceRoot, message);
    return {
      output: `Successfully created Git commit [${commitHash}]: "${message}"`
    };
  }

  private async gitBranch(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository.', isError: true };
    }

    const action = String(args.action || 'list');
    const branchName = args.branchName ? String(args.branchName).trim() : '';

    if (action === 'create') {
      if (!branchName) return { output: 'Error: branchName is required for create action', isError: true };
      await gitService.createBranch(this.workspaceRoot, branchName);
      return { output: `Created and checked out new branch "${branchName}".` };
    }

    if (action === 'switch') {
      if (!branchName) return { output: 'Error: branchName is required for switch action', isError: true };
      await gitService.switchBranch(this.workspaceRoot, branchName);
      return { output: `Switched to branch "${branchName}".` };
    }

    // Default: list
    const branchInfo = await gitService.getBranches(this.workspaceRoot);
    const list = branchInfo.all.map((b) => (b === branchInfo.current ? `* ${b}` : `  ${b}`)).join('\n');
    return { output: `Git Branches (current: ${branchInfo.current}):\n${list}` };
  }

  private async gitLog(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository.', isError: true };
    }

    const requestedCount = typeof args.maxCount === 'number' ? Math.floor(args.maxCount) : 15;
    const maxCount = Math.max(1, Math.min(requestedCount, 50));
    const search = args.search ? String(args.search).slice(0, 200) : undefined;
    const commits = await gitService.getLog(this.workspaceRoot, maxCount, search);

    if (commits.length === 0) {
      return { output: 'No commit history found in this repository.' };
    }

    const formatted = commits.map((c) =>
      `commit ${c.shortHash} (${c.date})\nAuthor: ${c.authorName} <${c.authorEmail}>\n    ${c.message}`
    ).join('\n\n');

    return { output: formatted };
  }

  private async gitMerge(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const isRepo = await gitService.isRepo(this.workspaceRoot);
    if (!isRepo) {
      return { output: 'Current workspace is not a Git repository.', isError: true };
    }

    const branchName = String(args.branchName || '').trim();
    if (!branchName) return { output: 'Error: branchName is required', isError: true };

    const result = await gitService.merge(this.workspaceRoot, branchName);
    if (!result.success) {
      return {
        output: `Merge conflicts encountered: ${result.message}\nConflicted files:\n${(result.conflicts || []).map((f) => `  - ${f}`).join('\n')}`,
        isError: true
      };
    }

    return { output: result.message || `Successfully merged ${branchName}.` };
  }
}
