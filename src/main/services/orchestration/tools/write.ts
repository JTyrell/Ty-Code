import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveSafePath } from './view';
import { approveFileMutation } from './policy';

export const writeTool: OpenCodeTool = {
  name: 'write',
  description: 'Create a new file or completely overwrite an existing file with the provided content.',
  definition: {
    type: 'function',
    function: {
      name: 'write',
      description: 'Create a new file or completely overwrite an existing file with the provided content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The destination file path relative to workspace.'
          },
          content: {
            type: 'string',
            description: 'The full text content to write.'
          }
        },
        required: ['filePath', 'content']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    if (context.agentMode === 'plan') {
      return {
        output: 'Plan Agent is in read-only exploration mode and cannot modify files. Switch to Build Agent to apply changes.',
        isError: true
      };
    }

    try {
      const filePath = String(args.filePath || args.path || '');
      if (!filePath) {
        return { output: 'Error: "filePath" parameter is required.', isError: true };
      }
      const content = String(args.content ?? '');

      const absolutePath = context.securityPolicy
        ? await context.securityPolicy.resolveFilePath(filePath, true)
        : resolveSafePath(context.workspaceRoot, filePath);
      let originalContent = '';
      let isNewFile = true;
      try {
        originalContent = await fs.readFile(absolutePath, 'utf-8');
        isNewFile = false;
      } catch {
        // File does not exist yet
      }

      const approval = await approveFileMutation({ id: `write_${Date.now()}`, name: 'write', arguments: { filePath, content } }, filePath, originalContent, content, context);
      if (approval.denied) return approval.denied;
      let resolvedPath = approval.absolutePath || absolutePath;
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      if (context.securityPolicy) {
        resolvedPath = await context.securityPolicy.verifyFileMutationSnapshot(approval.review!);
      }
      const tempPath = `${resolvedPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, resolvedPath);

      context.trackModifiedFile?.(filePath);

      const diff = {
        id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filePath,
        originalContent,
        proposedContent: content,
        description: isNewFile ? `Create ${filePath}` : `Overwrite ${filePath}`,
        status: 'applied' as const
      };

      return {
        output: `Successfully wrote ${content.length} characters to ${filePath} (${isNewFile ? 'created new file' : 'updated existing file'}).`,
        proposedDiff: diff,
        metadata: { filePath, isNewFile, size: content.length }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error writing file: ${message}`, isError: true };
    }
  }
};
