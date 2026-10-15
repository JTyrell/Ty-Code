import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';

export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const normalized = path.resolve(workspaceRoot, targetPath);
  const relative = path.relative(workspaceRoot, normalized);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path traversal denied: "${targetPath}" is outside workspace root "${workspaceRoot}".`);
  }
  return normalized;
}

export async function resolveToolPath(context: ToolContext, targetPath: string, allowMissing = false): Promise<string> {
  if (context.securityPolicy) return context.securityPolicy.resolveFilePath(targetPath, allowMissing);
  return resolveSafePath(context.workspaceRoot, targetPath);
}

export const viewTool: OpenCodeTool = {
  name: 'view',
  description: 'Read file contents from the workspace with optional 1-indexed line offset and line limit.',
  definition: {
    type: 'function',
    function: {
      name: 'view',
      description: 'Read file contents from the workspace with optional 1-indexed line offset and line limit.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The relative or absolute file path to read.'
          },
          offset: {
            type: 'number',
            description: '1-indexed start line number to begin reading from (default: 1).'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default: 200).'
          }
        },
        required: ['filePath']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const filePath = String(args.filePath || args.path || '');
      if (!filePath) {
        return { output: 'Error: "filePath" parameter is required.', isError: true };
      }

      const absolutePath = await resolveToolPath(context, filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 1;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 200;
      const endLine = Math.min(offset + limit - 1, totalLines);

      const sliced = lines.slice(offset - 1, endLine);
      const formatted = sliced.map((line, idx) => `${offset + idx}: ${line}`).join('\n');

      return {
        output: `File: ${filePath} (lines ${offset}-${endLine} of ${totalLines})\n\n${formatted}`,
        metadata: { filePath, offset, limit, totalLines }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error reading file: ${message}`, isError: true };
    }
  }
};
