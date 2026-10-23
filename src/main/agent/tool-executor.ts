import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { AgentToolApproval, ProposedDiff, ToolCall } from '../../preload/types';
import { gitService } from '../services/git-service';
import { SecurityPolicyEngine, buildSanitizedPtyEnv } from '../services/security-policy';
import { settingsManager } from '../services/settings-manager';
import { mcpManager } from '../services/mcp-manager';
import { SmartFileReader } from '../services/tools/smart-file-reader';

export interface ToolExecutionResponse {
  output: string;
  isError?: boolean;
  proposedDiff?: ProposedDiff;
}

export class ToolExecutor {
  private readonly workspaceRoot: string;
  private readonly securityPolicy: SecurityPolicyEngine;
  private readonly smartFileReader: SmartFileReader;

  constructor(workspaceRoot: string, securityPolicy?: SecurityPolicyEngine) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.securityPolicy = securityPolicy || new SecurityPolicyEngine(this.workspaceRoot, settingsManager);
    this.smartFileReader = new SmartFileReader(this.workspaceRoot);
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
        case 'replace_file_content':
        case 'edit_file':
          return await this.replaceFileContent(args);
        case 'write_file': return await this.writeFile(args);
        case 'run_command': return await this.runCommand(args, abortSignal);
        case 'list_dir':
        case 'list_directory':
          return await this.listDir(args);
        case 'grep_search': return await this.grepSearch(args);
        case 'git_status': return await this.gitStatus();
        case 'git_diff': return await this.gitDiff(args);
        case 'git_commit': return await this.gitCommit(args);
        case 'git_branch': return await this.gitBranch(args);
        case 'git_log': return await this.gitLog(args);
        case 'git_merge': return await this.gitMerge(args);
        case 'generate_presentation': return await this.generatePresentation(args);
        case 'brave_web_search':
        case 'web_search':
          return await this.braveWebSearch(args);
        case 'seo_analytics_query':
        case 'audit_page_seo':
        case 'query_search_console':
        case 'inspect_keyword_rankings':
        case 'check_core_web_vitals':
          return await this.executeSeoQuery(name, args);
        default: return { output: `Unknown tool: "${name}"`, isError: true };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error executing tool "${name}": ${message}`, isError: true };
    }
  }

  public async readFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || args.path || '');
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    const allowed = await this.securityPolicy.isFileAllowed(filePath);
    if (!allowed) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}". Non-Workspace Access is disabled.`);
    }

    const fileInfo = await this.smartFileReader.getFileInfo(filePath);

    if (fileInfo.totalLines <= 500) {
      const result = await this.smartFileReader.readFileInChunks(filePath, 1, fileInfo.totalLines);
      return {
        output: `File: ${filePath} (${fileInfo.totalLines} lines)\n\n${result.content}`
      };
    }

    const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? args.startLine : 1;
    const endLine = typeof args.endLine === 'number' && args.endLine >= startLine ? args.endLine : startLine + 199;

    const result = await this.smartFileReader.readFileInChunks(filePath, startLine, endLine);
    const chunkInfo = result.isComplete
      ? `(lines ${result.startLine}-${result.endLine} of ${result.totalLines} — COMPLETE)`
      : `(lines ${result.startLine}-${result.endLine} of ${result.totalLines} — partial, use startLine/endLine to continue)`;

    return {
      output: `File: ${filePath} ${chunkInfo}\n\n${result.content}\n\n[Hint: File has ${result.totalLines} lines. Use startLine/endLine parameters to read more. Suggested: startLine=${result.endLine + 1}, endLine=${Math.min(result.endLine + 200, result.totalLines)}]`
    };
  }

  public async replaceFileContent(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || args.path || '');
    const targetContent = String(args.targetContent || args.oldString || args.old_str || args.oldContent || '');
    const replacementContent = String(args.replacementContent ?? args.newString ?? args.new_str ?? args.newContent ?? '');
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    if (!targetContent) return { output: 'Error: targetContent is required', isError: true };
    const allowed = await this.securityPolicy.isFileAllowed(filePath);
    if (!allowed) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}". Non-Workspace Access is disabled.`);
    }
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
    const current = await fs.readFile(absolutePath, 'utf-8');
    if (current !== original) return { output: `Error: ${filePath} changed before the edit could be written. Read the latest content and try again.`, isError: true };
    const verifiedPath = await this.resolveSafePath(filePath);
    await this.atomicWrite(verifiedPath, modified);
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

  public async writeFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || args.path || '');
    const content = String(args.content ?? '');
    const overwrite = Boolean(args.overwrite);
    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    const allowed = await this.securityPolicy.isFileAllowed(filePath);
    if (!allowed) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}". Non-Workspace Access is disabled.`);
    }
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
    const current = await fs.readFile(absolutePath, 'utf-8').catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    });
    if (current !== original) return { output: `Error: ${filePath} changed before the write could be completed. Read the latest content and try again.`, isError: true };
    const verifiedPath = await this.resolveSafePath(filePath, true);
    await this.atomicWrite(verifiedPath, content);
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

    // Security policy check
    const policyDecision = await this.securityPolicy.checkTerminalCommand(command);
    if (policyDecision.blocked || policyDecision.status === 'BLOCK') {
      return { output: `Command blocked by security policy: ${policyDecision.reason}`, isError: true };
    }

    const requestedTimeout = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000;
    const timeout = Math.min(Math.max(requestedTimeout, 1_000), 120_000);
    const subCwd = args.cwd ? await this.resolveSafePath(String(args.cwd)) : this.workspaceRoot;

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      let stdout = '';
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const streamToTerminalDrawer = (chunk: string) => {
        try {
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
              win.webContents.send('terminal:stream', { command, data: chunk });
              win.webContents.send('pty:agent-output', chunk);
            }
          }
        } catch {
          // non-electron or test runner
        }
      };

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

      let ptyProcess: pty.IPty | null = null;
      let child: ReturnType<typeof spawn> | null = null;

      const handleAbort = () => {
        aborted = true;
        if (ptyProcess) {
          try { ptyProcess.kill(); } catch {}
        }
        if (child) {
          child.kill('SIGTERM');
        }
      };

      timer = setTimeout(() => {
        timedOut = true;
        if (ptyProcess) {
          try { ptyProcess.kill(); } catch {}
        }
        if (child) {
          child.kill('SIGTERM');
        }
      }, timeout);
      abortSignal?.addEventListener('abort', handleAbort, { once: true });

      try {
        const root = process.env.SystemRoot || 'C:\\Windows';
        const shell = isWin
          ? (process.env.ComSpec || path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
          : (process.env.SHELL || '/bin/bash');
        const shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];
        const ptyEnv = buildSanitizedPtyEnv(process.env);
        ptyEnv.TERM = 'xterm-256color';

        ptyProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 100,
          rows: 30,
          cwd: subCwd,
          env: ptyEnv
        });

        ptyProcess.onData((data: string) => {
          stdout += data;
          streamToTerminalDrawer(data);
        });

        ptyProcess.onExit(({ exitCode }) => {
          if (aborted) {
            finish({ output: `Command cancelled. Output before cancellation:\n${stdout}`, isError: true });
          } else if (timedOut) {
            finish({ output: `Command timed out after ${timeout}ms. Output before timeout:\n${stdout}`, isError: true });
          } else {
            finish({
              output: `Command: ${command}\nExit Code: ${exitCode}\nOutput:\n${stdout || '(empty)'}`,
              isError: exitCode !== 0
            });
          }
        });
      } catch {
        const shell = isWin ? 'powershell.exe' : '/bin/bash';
        const shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];
        child = spawn(shell, shellArgs, { cwd: subCwd, env: { ...buildSanitizedPtyEnv(process.env), PAGER: 'cat' }, windowsHide: true });

        child.stdout?.on('data', (chunk: Buffer | string) => {
          const str = chunk.toString();
          stdout += str;
          streamToTerminalDrawer(str);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
          const str = chunk.toString();
          stdout += str;
          streamToTerminalDrawer(str);
        });
        child.on('close', (code) => {
          if (aborted) finish({ output: `Command cancelled. Output before cancellation:\n${stdout}`, isError: true });
          else if (timedOut) finish({ output: `Command timed out after ${timeout}ms. Output before timeout:\n${stdout}`, isError: true });
          else finish({ output: `Command: ${command}\nExit Code: ${code}\nOutput:\n${stdout || '(empty)'}`, isError: code !== 0 });
        });
        child.on('error', (err) => finish({ output: `Failed to execute command: ${err.message}`, isError: true }));
      }
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

  private async generatePresentation(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const topic = String(args.topic || '').trim();
    if (!topic) {
      return { output: 'Error: topic is required for generate_presentation', isError: true };
    }

    let outline: string[] = [];
    if (Array.isArray(args.outline)) {
      outline = args.outline.map(String).map((s) => s.trim()).filter(Boolean);
    } else if (typeof args.outline === 'string' && args.outline.trim()) {
      outline = args.outline
        .split(/[,\n]/)
        .map((s) => s.replace(/^[-*•\d.]+\s*/, '').trim())
        .filter(Boolean);
    } else if (Array.isArray(args.slides) && args.slides.length > 0) {
      outline = args.slides.map((s: any) => String(s?.title || s?.content || 'Slide')).filter(Boolean);
    }

    if (outline.length === 0) {
      return { output: 'Error: outline is required (must provide at least one slide outline item)', isError: true };
    }

    let relativePath = typeof args.outputPath === 'string' && args.outputPath.trim()
      ? args.outputPath.trim()
      : 'presentation.html';
    if (!/\.html?$/i.test(relativePath)) {
      relativePath += '.html';
    }

    const absolutePath = await this.resolveSafePath(relativePath, true);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Load base template
    const templateCandidates = [
      path.join(__dirname, '../templates/bento-base.html'),
      path.join(__dirname, '../../templates/bento-base.html'),
      path.join(__dirname, 'templates/bento-base.html'),
      path.join(process.cwd(), 'src/main/templates/bento-base.html'),
      path.join(this.workspaceRoot, 'src/main/templates/bento-base.html'),
      path.join(this.workspaceRoot, '.ty-code/templates/bento-generator/bento-base.html')
    ];

    let baseHtml = '';
    for (const candidate of templateCandidates) {
      try {
        baseHtml = await fs.readFile(candidate, 'utf-8');
        if (baseHtml && baseHtml.includes('bento-doc')) break;
      } catch {
        // try next
      }
    }

    if (!baseHtml) {
      baseHtml = this.getFallbackPresentationTemplate();
    }

    const themeName = (typeof args.theme === 'string' ? args.theme.toLowerCase() : 'dark');
    const themes: Record<string, { background: string; color: string; accent: string; cardBg: string; cardBorder: string; textMuted: string }> = {
      dark: {
        background: '#0a0f1d',
        color: '#f8fafc',
        accent: '#38bdf8',
        cardBg: '#111827',
        cardBorder: 'rgba(56, 189, 248, 0.25)',
        textMuted: '#94a3b8'
      },
      light: {
        background: '#f8fafc',
        color: '#0f172a',
        accent: '#0284c7',
        cardBg: '#ffffff',
        cardBorder: 'rgba(2, 132, 199, 0.25)',
        textMuted: '#64748b'
      },
      cyan: {
        background: '#041724',
        color: '#ecfeff',
        accent: '#06b6d4',
        cardBg: '#08253a',
        cardBorder: 'rgba(6, 182, 212, 0.3)',
        textMuted: '#67e8f9'
      },
      emerald: {
        background: '#041b12',
        color: '#ecfdf5',
        accent: '#10b981',
        cardBg: '#072e20',
        cardBorder: 'rgba(16, 185, 129, 0.3)',
        textMuted: '#6ee7b7'
      },
      sunset: {
        background: '#1a0b1e',
        color: '#fdf4ff',
        accent: '#f43f5e',
        cardBg: '#2c1233',
        cardBorder: 'rgba(244, 63, 94, 0.3)',
        textMuted: '#f9a8d4'
      }
    };
    const activeTheme = themes[themeName] || themes.dark;

    const escapeHtml = (str: string) => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const rawSlides = Array.isArray(args.slides) ? args.slides : [];

    // Construct Bento Doc
    const bentoSlides: any[] = [];

    // Slide 1: Cover slide
    bentoSlides.push({
      id: 'slide-1',
      background: activeTheme.background,
      transition: 'none',
      notes: `Welcome everyone. Today's presentation is on ${topic}. We will explore ${outline.length} core themes.`,
      elements: [
        {
          id: 'cover-accent-bar',
          type: 'shape',
          shape: 'rect',
          x: 96,
          y: 160,
          w: 96,
          h: 6,
          rotation: 0,
          opacity: 1,
          fill: activeTheme.accent,
          stroke: 'none',
          strokeWidth: 0,
          radius: 3
        },
        {
          id: 'cover-title',
          type: 'text',
          x: 96,
          y: 196,
          w: 1088,
          h: 180,
          rotation: 0,
          opacity: 1,
          html: `<b>${escapeHtml(topic)}</b>`,
          fontSize: 56,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 800,
          color: activeTheme.color,
          align: 'left',
          valign: 'top',
          lineHeight: 1.15,
          fx: { enter: 'fade-up' }
        },
        {
          id: 'cover-subtitle',
          type: 'text',
          x: 96,
          y: 390,
          w: 1088,
          h: 60,
          rotation: 0,
          opacity: 1,
          html: `Single-File Interactive Presentation · ${outline.length + 1} Slides`,
          fontSize: 22,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 500,
          color: activeTheme.textMuted,
          align: 'left',
          valign: 'top',
          lineHeight: 1.2
        },
        {
          id: 'cover-badge',
          type: 'shape',
          shape: 'rect',
          x: 96,
          y: 470,
          w: 220,
          h: 36,
          rotation: 0,
          opacity: 1,
          fill: activeTheme.cardBg,
          stroke: activeTheme.cardBorder,
          strokeWidth: 1,
          radius: 8
        },
        {
          id: 'cover-badge-text',
          type: 'text',
          x: 108,
          y: 478,
          w: 196,
          h: 20,
          rotation: 0,
          opacity: 1,
          html: '⚡ Ty-Code Presentation',
          fontSize: 13,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 600,
          color: activeTheme.accent,
          align: 'left',
          valign: 'top',
          lineHeight: 1
        }
      ]
    });

    // Content slides
    outline.forEach((titleStr, index) => {
      const slideIndex = index + 2;
      const slideInput = rawSlides[index] as Record<string, unknown> | undefined;
      const slideTitle = String(slideInput?.title || titleStr);
      const slideNotes = String(slideInput?.notes || `Speaker notes for: ${slideTitle}. Highlight real-world impact and actionable takeaways.`);

      let items: string[] = [];
      if (Array.isArray(slideInput?.items) && slideInput.items.length > 0) {
        items = slideInput.items.map(String).map((s) => s.trim()).filter(Boolean);
      } else if (typeof slideInput?.content === 'string' && slideInput.content.trim()) {
        items = slideInput.content
          .split(/\r?\n/)
          .map((line) => line.replace(/^[-*•\d.]+\s*/, '').trim())
          .filter(Boolean);
      }
      if (items.length === 0) {
        items = [
          `Key principles, architectural standards, and core requirements for ${slideTitle.toLowerCase()}`,
          `Practical workflows, best practices, and integration strategies`,
          `Validation checkpoints, metrics, and actionable next steps`
        ];
      }

      const elements: any[] = [
        {
          id: `slide-${slideIndex}-accent`,
          type: 'shape',
          shape: 'rect',
          x: 96,
          y: 64,
          w: 6,
          h: 40,
          rotation: 0,
          opacity: 1,
          fill: activeTheme.accent,
          stroke: 'none',
          strokeWidth: 0,
          radius: 3
        },
        {
          id: `slide-${slideIndex}-title`,
          type: 'text',
          x: 114,
          y: 60,
          w: 1070,
          h: 50,
          rotation: 0,
          opacity: 1,
          html: `<b>${escapeHtml(slideTitle)}</b>`,
          fontSize: 34,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 700,
          color: activeTheme.color,
          align: 'left',
          valign: 'top',
          lineHeight: 1.2
        }
      ];

      // Lay out items in Bento box cards
      const count = Math.min(items.length, 4);
      let cardConfigs: Array<{ x: number; y: number; w: number; h: number }>;
      if (count === 1) {
        cardConfigs = [{ x: 96, y: 150, w: 1088, h: 480 }];
      } else if (count === 2) {
        cardConfigs = [
          { x: 96, y: 150, w: 524, h: 480 },
          { x: 660, y: 150, w: 524, h: 480 }
        ];
      } else if (count === 3) {
        cardConfigs = [
          { x: 96, y: 150, w: 342, h: 480 },
          { x: 468, y: 150, w: 342, h: 480 },
          { x: 840, y: 150, w: 342, h: 480 }
        ];
      } else {
        cardConfigs = [
          { x: 96, y: 150, w: 524, h: 225 },
          { x: 660, y: 150, w: 524, h: 225 },
          { x: 96, y: 405, w: 524, h: 225 },
          { x: 660, y: 405, w: 524, h: 225 }
        ];
      }

      for (let c = 0; c < count; c++) {
        const cfg = cardConfigs[c];
        const itemText = items[c];
        elements.push({
          id: `slide-${slideIndex}-card-${c}`,
          type: 'shape',
          shape: 'rect',
          x: cfg.x,
          y: cfg.y,
          w: cfg.w,
          h: cfg.h,
          rotation: 0,
          opacity: 1,
          fill: activeTheme.cardBg,
          stroke: activeTheme.cardBorder,
          strokeWidth: 1,
          radius: 12
        });

        elements.push({
          id: `slide-${slideIndex}-card-step-${c}`,
          type: 'text',
          x: cfg.x + 24,
          y: cfg.y + 20,
          w: 80,
          h: 26,
          rotation: 0,
          opacity: 1,
          html: `<b>0${c + 1}</b>`,
          fontSize: 16,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 800,
          color: activeTheme.accent,
          align: 'left',
          valign: 'top',
          lineHeight: 1
        });

        elements.push({
          id: `slide-${slideIndex}-card-text-${c}`,
          type: 'text',
          x: cfg.x + 24,
          y: cfg.y + 54,
          w: cfg.w - 48,
          h: cfg.h - 74,
          rotation: 0,
          opacity: 1,
          html: escapeHtml(itemText),
          fontSize: count >= 4 ? 17 : 20,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 500,
          color: activeTheme.color,
          align: 'left',
          valign: 'top',
          lineHeight: 1.45
        });
      }

      bentoSlides.push({
        id: `slide-${slideIndex}`,
        background: activeTheme.background,
        transition: 'morph',
        notes: slideNotes,
        elements
      });
    });

    const bentoDoc = {
      format: 'bento/slides',
      version: 1,
      title: topic,
      size: { width: 1280, height: 720 },
      theme: {
        background: activeTheme.background,
        color: activeTheme.color,
        accent: activeTheme.accent,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      },
      slides: bentoSlides
    };

    const docJson = JSON.stringify(bentoDoc, null, 2).replace(/</g, '\\u003c');

    let outputHtml = baseHtml;
    if (outputHtml.includes('<script type="application/bento+json" id="bento-doc"></script>')) {
      outputHtml = outputHtml.replace(
        '<script type="application/bento+json" id="bento-doc"></script>',
        `<script type="application/bento+json" id="bento-doc">\n${docJson}\n    </script>`
      );
    } else if (/<script[^>]*id=["']bento-doc["'][^>]*>[\s\S]*?<\/script>/i.test(outputHtml)) {
      outputHtml = outputHtml.replace(
        /<script[^>]*id=["']bento-doc["'][^>]*>[\s\S]*?<\/script>/i,
        `<script type="application/bento+json" id="bento-doc">\n${docJson}\n    </script>`
      );
    } else {
      outputHtml = outputHtml.replace(
        '</head>',
        `    <script type="application/bento+json" id="bento-doc">\n${docJson}\n    </script>\n  </head>`
      );
    }

    // Ensure title matches topic
    outputHtml = outputHtml.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(topic)}</title>`);

    await this.atomicWrite(absolutePath, outputHtml);

    let previewUrl = `file:///${absolutePath.replace(/\\/g, '/')}`;
    try {
      previewUrl = pathToFileURL(absolutePath).href;
    } catch {
      // keep fallback
    }

    const result = {
      success: true,
      topic,
      filePath: relativePath,
      absolutePath,
      slideCount: bentoSlides.length,
      outline,
      previewUrl,
      message: `Successfully generated presentation "${topic}" with ${bentoSlides.length} slides.`
    };

    return {
      output: JSON.stringify(result, null, 2)
    };
  }

  private getFallbackPresentationTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ty-Code Bento Presentation</title>
    <script type="application/bento+json" id="bento-doc"></script>
    <style>
      :root { --bg: #0b0f19; --fg: #f8fafc; --accent: #38bdf8; --card-bg: #111827; --card-border: rgba(56,189,248,0.2); }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
      #deck-container { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; position: relative; }
      .slide-view { width: 100%; max-width: 1200px; aspect-ratio: 16/9; background: #0f172a; border: 1px solid var(--card-border); border-radius: 16px; padding: 48px; display: none; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
      .slide-view.active { display: flex; }
      .slide-header { font-size: 32px; font-weight: 700; margin-bottom: 32px; display: flex; align-items: center; gap: 12px; }
      .slide-header i { width: 6px; height: 32px; background: var(--accent); border-radius: 3px; display: inline-block; }
      .bento-grid { flex: 1; display: grid; gap: 20px; }
      .bento-grid.cols-1 { grid-template-columns: 1fr; }
      .bento-grid.cols-2 { grid-template-columns: 1fr 1fr; }
      .bento-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
      .bento-grid.cols-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      .bento-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
      .bento-num { font-size: 14px; font-weight: 800; color: var(--accent); letter-spacing: 0.05em; }
      .bento-text { font-size: 18px; line-height: 1.5; color: #e2e8f0; }
      #deck-nav { height: 56px; background: #090d16; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; font-size: 13px; }
      .nav-btn { background: rgba(56,189,248,0.1); border: 1px solid var(--card-border); color: var(--fg); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }
      .nav-btn:hover { background: rgba(56,189,248,0.25); }
    </style>
  </head>
  <body>
    <div id="deck-container"></div>
    <div id="deck-nav">
      <span id="deck-title" style="font-weight: 600; color: var(--accent)">Ty-Code Presentation</span>
      <div style="display: flex; align-items: center; gap: 12px;">
        <button class="nav-btn" id="prev-btn">◀ Previous</button>
        <span id="slide-indicator" style="color: #94a3b8">1 / 1</span>
        <button class="nav-btn" id="next-btn">Next ▶</button>
      </div>
      <span style="color: #64748b; font-size: 11px">Use ◀ ▶ Arrow Keys</span>
    </div>
    <script>
      (function() {
        const raw = document.getElementById('bento-doc')?.textContent;
        if (!raw) return;
        try {
          const doc = JSON.parse(raw);
          document.title = doc.title || 'Presentation';
          const titleEl = document.getElementById('deck-title');
          if (titleEl) titleEl.textContent = doc.title || 'Presentation';
          const container = document.getElementById('deck-container');
          const indicator = document.getElementById('slide-indicator');
          let current = 0;
          doc.slides.forEach((s, idx) => {
            const slideEl = document.createElement('div');
            slideEl.className = 'slide-view' + (idx === 0 ? ' active' : '');
            let titleText = '';
            const cardTexts = [];
            (s.elements || []).forEach(el => {
              if (el.type === 'text') {
                if (el.id.includes('title')) titleText = el.html.replace(/<[^>]+>/g, '');
                else if (el.id.includes('card-text')) cardTexts.push(el.html.replace(/<[^>]+>/g, ''));
                else if (el.id.includes('subtitle') && !cardTexts.length) cardTexts.push(el.html.replace(/<[^>]+>/g, ''));
              }
            });
            slideEl.innerHTML = \`<div class="slide-header"><i></i><span>\${titleText || doc.title || 'Slide ' + (idx + 1)}</span></div>
            <div class="bento-grid cols-\${Math.min(Math.max(cardTexts.length, 1), 4)}">
              \${cardTexts.map((txt, cIdx) => \`<div class="bento-card"><div class="bento-num">0\${cIdx + 1}</div><div class="bento-text">\${txt}</div></div>\`).join('')}
            </div>\`;
            container.appendChild(slideEl);
          });
          const update = () => {
            const views = document.querySelectorAll('.slide-view');
            views.forEach((v, i) => v.classList.toggle('active', i === current));
            if (indicator) indicator.textContent = (current + 1) + ' / ' + views.length;
          };
          document.getElementById('prev-btn')?.addEventListener('click', () => { if (current > 0) { current--; update(); } });
          document.getElementById('next-btn')?.addEventListener('click', () => { if (current < doc.slides.length - 1) { current++; update(); } });
          window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'Space') { if (current < doc.slides.length - 1) { current++; update(); } }
            if (e.key === 'ArrowLeft') { if (current > 0) { current--; update(); } }
          });
          update();
        } catch (e) {
          console.error(e);
        }
      })();
    </script>
  </body>
</html>`;
  }

  private async executeSeoQuery(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const action = String(args.action || toolName);
    const isLocal = Boolean(args.__isLocal);
    const result = await mcpManager.executeSeoTool(action, args, {
      isLocal,
      workspacePath: this.workspaceRoot
    });
    return {
      output: result.output,
      isError: result.isError
    };
  }

  public async braveWebSearch(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const query = String(args.query || args.q || '').trim();
    if (!query) {
      return { output: 'Error: search query cannot be empty', isError: true };
    }

    try {
      const { braveEngine } = await import('../services/brave-engine');
      const searchResult = await braveEngine.searchWeb(query);

      const top3 = (searchResult.results || []).slice(0, 3);
      if (top3.length === 0) {
        const textSummary = searchResult.text ? searchResult.text.slice(0, 600) : 'No search results found.';
        return {
          output: `Search executed via Brave Guest Mode (${searchResult.engine}) for "${query}".\n\nTitle: ${searchResult.title}\nURL: ${searchResult.url}\n\nSnippet/Summary:\n${textSummary}`
        };
      }

      const formatted = top3
        .map((r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   Snippet: ${r.snippet}`)
        .join('\n\n');

      return {
        output: `Search results for "${query}" (via Brave Guest Mode - ${searchResult.engine}):\n\n${formatted}`
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        output: `Failed to execute web search via Brave: ${errorMsg}`,
        isError: true
      };
    }
  }
}
