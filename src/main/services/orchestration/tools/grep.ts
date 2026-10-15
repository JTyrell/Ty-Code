import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveToolPath } from './view';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.ty-code',
  'dist',
  'out',
  'build',
  '.next',
  '.cache',
  'coverage'
]);

async function walkDir(dir: string, baseDir: string, maxFiles = 300): Promise<string[]> {
  const results: string[] = [];
  async function traverse(current: string): Promise<void> {
    if (results.length >= maxFiles) return;
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            await traverse(path.join(current, entry.name));
          }
        } else if (entry.isFile()) {
          results.push(path.relative(baseDir, path.join(current, entry.name)).replace(/\\/g, '/'));
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  await traverse(dir);
  return results;
}

export const grepTool: OpenCodeTool = {
  name: 'grep',
  description: 'Search file contents across workspace files using literal text or regular expressions.',
  definition: {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents across workspace files using literal text or regular expressions.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The search string or regular expression to look for.'
          },
          path: {
            type: 'string',
            description: 'Optional subfolder or specific file to search in (default: entire workspace).'
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether search should be case sensitive (default: false).'
          },
          include: {
            type: 'string',
            description: 'Optional file extension filter (e.g. "*.ts", "*.json").'
          }
        },
        required: ['pattern']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const patternStr = String(args.pattern ?? args.query ?? '');
      if (!patternStr) {
        return { output: 'Error: "pattern" parameter is required.', isError: true };
      }

      const searchSubpath = String(args.path || '.');
      const searchTarget = await resolveToolPath(context, searchSubpath);
      const isCaseSensitive = Boolean(args.caseSensitive);
      const includeFilter = args.include ? String(args.include).replace(/^\*/, '') : '';

      let regex: RegExp;
      try {
        regex = new RegExp(patternStr, isCaseSensitive ? 'g' : 'gi');
      } catch {
        // Fallback to escaped literal if pattern is not valid regex
        const escaped = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, isCaseSensitive ? 'g' : 'gi');
      }

      let targetFiles: string[] = [];
      const stat = await fs.stat(searchTarget);
      if (stat.isFile()) {
        targetFiles = [path.relative(context.workspaceRoot, searchTarget).replace(/\\/g, '/')];
      } else {
        targetFiles = await walkDir(searchTarget, context.workspaceRoot);
      }

      if (includeFilter) {
        targetFiles = targetFiles.filter((f) => f.endsWith(includeFilter));
      }

      const matches: Array<{ file: string; line: number; text: string }> = [];
      const MAX_MATCHES = 100;

      for (const relPath of targetFiles) {
        if (matches.length >= MAX_MATCHES) break;
        try {
          const absPath = path.resolve(context.workspaceRoot, relPath);
          const content = await fs.readFile(absPath, 'utf-8');
          // Skip binary files
          if (content.includes('\0')) continue;

          const lines = content.split('\n');
          for (let idx = 0; idx < lines.length; idx++) {
            if (matches.length >= MAX_MATCHES) break;
            const line = lines[idx];
            regex.lastIndex = 0;
            if (regex.test(line)) {
              matches.push({
                file: relPath,
                line: idx + 1,
                text: line.trim()
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matches.length === 0) {
        return {
          output: `No matches found for pattern "${patternStr}" across ${targetFiles.length} searched files.`,
          metadata: { count: 0, searchedFiles: targetFiles.length }
        };
      }

      const formatted = matches
        .map((m) => `${m.file}:${m.line}: ${m.text}`)
        .join('\n');

      return {
        output: `Found ${matches.length} match(es) for "${patternStr}":\n\n${formatted}${
          matches.length >= MAX_MATCHES ? '\n\n[Results capped at 100 matches]' : ''
        }`,
        metadata: { count: matches.length, pattern: patternStr }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error executing grep: ${message}`, isError: true };
    }
  }
};
