import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveSafePath } from './view';

interface DirItem {
  name: string;
  isDir: boolean;
  size?: number;
}

export const lsTool: OpenCodeTool = {
  name: 'ls',
  description: 'List contents of a directory in the workspace with file sizes and type indicators.',
  definition: {
    type: 'function',
    function: {
      name: 'ls',
      description: 'List contents of a directory in the workspace with file sizes and type indicators.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path relative to workspace root (default: ".").'
          },
          showHidden: {
            type: 'boolean',
            description: 'Whether to include hidden files (starting with dot) (default: false).'
          }
        }
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const relPath = String(args.path || '.');
      const absolutePath = resolveSafePath(context.workspaceRoot, relPath);
      const showHidden = Boolean(args.showHidden);

      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      const items: DirItem[] = [];

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          items.push({ name: entry.name, isDir: true });
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(path.join(absolutePath, entry.name));
            items.push({ name: entry.name, isDir: false, size: stat.size });
          } catch {
            items.push({ name: entry.name, isDir: false });
          }
        }
      }

      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      const formatted = items
        .map((item) => {
          if (item.isDir) return `[DIR]  ${item.name}/`;
          const sizeKb = item.size !== undefined ? `${(item.size / 1024).toFixed(1)} KB` : '';
          return `[FILE] ${item.name.padEnd(30)} ${sizeKb}`;
        })
        .join('\n');

      return {
        output: `Contents of "${relPath}" (${items.length} item${items.length === 1 ? '' : 's'}):\n\n${formatted || '(empty directory)'}`,
        metadata: { path: relPath, count: items.length }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error listing directory: ${message}`, isError: true };
    }
  }
};
