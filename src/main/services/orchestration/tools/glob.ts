import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveSafePath } from './view';

const DEFAULT_IGNORE = ['.git', 'node_modules', '.ty-code', 'dist', 'out', 'build', '.cache'];

function globToRegex(globPattern: string): RegExp {
  const normalized = globPattern.replace(/\\/g, '/');
  let regexStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        regexStr += '(?:.+/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (c === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (c === '?') {
      regexStr += '[^/]';
      i++;
    } else if (['.', '+', '^', '$', '(', ')', '[', ']', '{', '}', '|'].includes(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr, 'i');
}

async function collectFiles(dir: string, baseDir: string, ignorePatterns: string[], max = 500): Promise<string[]> {
  const result: string[] = [];
  async function scan(current: string): Promise<void> {
    if (result.length >= max) return;
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (result.length >= max) break;
        if (ignorePatterns.includes(entry.name)) continue;
        const full = path.join(current, entry.name);
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.isFile()) {
          result.push(rel);
        }
      }
    } catch {
      // Skip unreadable
    }
  }
  await scan(dir);
  return result;
}

export const globTool: OpenCodeTool = {
  name: 'glob',
  description: 'Find files in workspace matching a glob pattern (e.g. "**/*.ts", "src/**/*.json").',
  definition: {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files in workspace matching a glob pattern (e.g. "**/*.ts", "src/**/*.json").',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match file paths against.'
          },
          cwd: {
            type: 'string',
            description: 'Subdirectory to search within (default: workspace root).'
          },
          ignore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Folder or file names to ignore.'
          }
        },
        required: ['pattern']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const pattern = String(args.pattern || '');
      if (!pattern) {
        return { output: 'Error: "pattern" parameter is required.', isError: true };
      }

      const cwdSubpath = String(args.cwd || '.');
      const searchRoot = resolveSafePath(context.workspaceRoot, cwdSubpath);
      const userIgnore = Array.isArray(args.ignore) ? args.ignore.map(String) : [];
      const ignore = [...DEFAULT_IGNORE, ...userIgnore];

      const allFiles = await collectFiles(searchRoot, context.workspaceRoot, ignore);
      const matcher = globToRegex(pattern);

      const matched = allFiles.filter((relPath) => matcher.test(relPath) || matcher.test(path.basename(relPath)));

      if (matched.length === 0) {
        return {
          output: `No files matched glob pattern "${pattern}".`,
          metadata: { count: 0, pattern }
        };
      }

      return {
        output: `Matched ${matched.length} file(s) for "${pattern}":\n\n${matched.join('\n')}`,
        metadata: { count: matched.length, files: matched }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error executing glob: ${message}`, isError: true };
    }
  }
};
