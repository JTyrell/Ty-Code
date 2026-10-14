import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import type { ProposedDiff } from '../../preload/types';

export interface ToolExecutionResponse {
  output: string;
  isError?: boolean;
  proposedDiff?: ProposedDiff;
}

export class ToolExecutor {
  constructor(private workspaceRoot: string) {}

  private resolveSafePath(relativePath: string): string {
    const cleanRel = relativePath.replace(/^(\.\/|\/)+/, '');
    const resolved = path.resolve(this.workspaceRoot, cleanRel);
    const relCheck = path.relative(this.workspaceRoot, resolved);

    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${relativePath}"`);
    }

    return resolved;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    try {
      switch (name) {
        case 'read_file':
          return await this.readFile(args);
        case 'replace_file_content':
          return await this.replaceFileContent(args);
        case 'write_file':
          return await this.writeFile(args);
        case 'run_command':
          return await this.runCommand(args);
        case 'list_dir':
          return await this.listDir(args);
        case 'grep_search':
          return await this.grepSearch(args);
        default:
          return {
            output: `Unknown tool: "${name}"`,
            isError: true
          };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        output: `Error executing tool "${name}": ${msg}`,
        isError: true
      };
    }
  }

  private async readFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    if (!filePath) return { output: 'Error: filePath is required', isError: true };

    const absPath = this.resolveSafePath(filePath);
    const content = await fs.readFile(absPath, 'utf-8');
    const lines = content.split('\n');

    const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? args.startLine : 1;
    const endLine = typeof args.endLine === 'number' && args.endLine >= startLine ? args.endLine : lines.length;

    const slice = lines.slice(startLine - 1, endLine);
    const formatted = slice.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');

    return {
      output: `File: ${filePath} (lines ${startLine}-${Math.min(endLine, lines.length)} of ${lines.length})\n\n${formatted}`
    };
  }

  private async replaceFileContent(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    const targetContent = String(args.targetContent || '');
    const replacementContent = String(args.replacementContent ?? '');

    if (!filePath) return { output: 'Error: filePath is required', isError: true };
    if (!targetContent) return { output: 'Error: targetContent is required', isError: true };

    const absPath = this.resolveSafePath(filePath);
    const original = await fs.readFile(absPath, 'utf-8');

    if (!original.includes(targetContent)) {
      return {
        output: `Error: targetContent was not found in ${filePath}. Verify line numbers and whitespace by reading the file first.`,
        isError: true
      };
    }

    const occurrences = original.split(targetContent).length - 1;
    if (occurrences > 1) {
      return {
        output: `Error: targetContent matched ${occurrences} occurrences in ${filePath}. Provide a larger, unique chunk of surrounding context.`,
        isError: true
      };
    }

    const modified = original.replace(targetContent, replacementContent);
    await fs.writeFile(absPath, modified, 'utf-8');

    const diff: ProposedDiff = {
      id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      filePath,
      originalContent: original,
      proposedContent: modified,
      description: `Modified ${filePath} via replace_file_content`,
      status: 'applied'
    };

    return {
      output: `Successfully replaced content in ${filePath}. Changes applied.`,
      proposedDiff: diff
    };
  }

  private async writeFile(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const filePath = String(args.filePath || '');
    const content = String(args.content ?? '');
    const overwrite = Boolean(args.overwrite);

    if (!filePath) return { output: 'Error: filePath is required', isError: true };

    const absPath = this.resolveSafePath(filePath);
    let original = '';
    let fileExisted = false;

    try {
      original = await fs.readFile(absPath, 'utf-8');
      fileExisted = true;
    } catch {
      fileExisted = false;
    }

    if (fileExisted && !overwrite) {
      return {
        output: `Error: File ${filePath} already exists. Set overwrite: true if you intend to replace it completely.`,
        isError: true
      };
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf-8');

    const diff: ProposedDiff = {
      id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      filePath,
      originalContent: original,
      proposedContent: content,
      description: fileExisted ? `Overwrote ${filePath}` : `Created ${filePath}`,
      status: 'applied'
    };

    return {
      output: `Successfully ${fileExisted ? 'overwrote' : 'created'} ${filePath}.`,
      proposedDiff: diff
    };
  }

  private async runCommand(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const command = String(args.command || '');
    if (!command) return { output: 'Error: command is required', isError: true };

    const timeout = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30000;
    const subCwd = args.cwd ? this.resolveSafePath(String(args.cwd)) : this.workspaceRoot;

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const cmdArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(shell, cmdArgs, {
        cwd: subCwd,
        env: { ...process.env, PAGER: 'cat' }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            output: `Command timed out after ${timeout}ms. Output before timeout:\n${stdout}\n${stderr}`,
            isError: true
          });
        } else {
          const out = `Command: ${command}\nExit Code: ${code}\nStdout:\n${stdout || '(empty)'}\nStderr:\n${stderr || '(none)'}`;
          resolve({
            output: out,
            isError: code !== 0
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: `Failed to execute command: ${err.message}`,
          isError: true
        });
      });
    });
  }

  private async listDir(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const dirRel = String(args.directoryPath || '');
    const recursive = Boolean(args.recursive);
    const absPath = this.resolveSafePath(dirRel);

    const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'out']);

    async function scan(current: string, depth = 0): Promise<string[]> {
      const entries = await fs.readdir(current, { withFileTypes: true });
      const results: string[] = [];

      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        results.push(entry.isDirectory() ? `${entry.name}/` : entry.name);

        if (recursive && entry.isDirectory() && depth < 3) {
          const sub = await scan(full, depth + 1);
          results.push(...sub.map((s) => `  ${s}`));
        }
      }
      return results;
    }

    const items = await scan(absPath);
    return {
      output: `Directory ${dirRel || '.'} (${items.length} items):\n` + items.join('\n')
    };
  }

  private async grepSearch(args: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const query = String(args.query || '');
    if (!query) return { output: 'Error: query is required', isError: true };

    const isRegex = Boolean(args.isRegex);
    const caseInsensitive = Boolean(args.caseInsensitive);

    const regex = isRegex
      ? new RegExp(query, caseInsensitive ? 'gi' : 'g')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'gi' : 'g');

    const matches: string[] = [];
    const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'out', 'package-lock.json']);

    async function searchDir(dir: string) {
      if (matches.length > 50) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await searchDir(full);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(full, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (regex.test(line)) {
                matches.push(`${path.relative(dir, full)}:${idx + 1}: ${line.trim()}`);
              }
              regex.lastIndex = 0;
            });
          } catch {
            // skip binary or unreadable files
          }
        }
      }
    }

    await searchDir(this.workspaceRoot);
    return {
      output: `Grep Search for "${query}" (${matches.length} matches):\n` + (matches.slice(0, 50).join('\n') || 'No matches found.')
    };
  }
}
