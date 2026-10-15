import fs from 'node:fs/promises';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveSafePath } from './view';

export const editTool: OpenCodeTool = {
  name: 'edit',
  description: 'Apply precise edits to a file by replacing specific target text with replacement text.',
  definition: {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Apply precise edits to a file by replacing specific target text with replacement text.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The relative file path in the workspace to edit.'
          },
          oldString: {
            type: 'string',
            description: 'The exact text chunk to find and replace. Must match uniquely within the file.'
          },
          newString: {
            type: 'string',
            description: 'The replacement text to insert in place of oldString.'
          }
        },
        required: ['filePath', 'oldString', 'newString']
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
      const oldString = String(args.oldString ?? args.targetContent ?? '');
      const newString = String(args.newString ?? args.replacementContent ?? '');

      if (!filePath) {
        return { output: 'Error: "filePath" parameter is required.', isError: true };
      }
      if (!oldString) {
        return { output: 'Error: "oldString" parameter is required to identify the target code to replace.', isError: true };
      }

      const absolutePath = resolveSafePath(context.workspaceRoot, filePath);
      const original = await fs.readFile(absolutePath, 'utf-8');

      if (!original.includes(oldString)) {
        return {
          output: `Error: oldString was not found in ${filePath}. Verify line numbers and whitespace by reading the file with "view" first.`,
          isError: true
        };
      }

      const occurrences = original.split(oldString).length - 1;
      if (occurrences > 1) {
        return {
          output: `Error: oldString matched ${occurrences} occurrences in ${filePath}. Provide a larger, unique chunk of surrounding context.`,
          isError: true
        };
      }

      // Literal string replacement without regex interpolation tokens
      const modified = original.replace(oldString, () => newString);

      const tempPath = `${absolutePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tempPath, modified, 'utf-8');
      await fs.rename(tempPath, absolutePath);

      context.trackModifiedFile?.(filePath);

      const diff = {
        id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filePath,
        originalContent: original,
        proposedContent: modified,
        description: `Edit ${filePath}`,
        status: 'applied' as const
      };

      return {
        output: `Successfully applied edit to ${filePath}. Replaced ${oldString.length} characters with ${newString.length} characters.`,
        proposedDiff: diff,
        metadata: { filePath, replacedBytes: oldString.length, newBytes: newString.length }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error editing file: ${message}`, isError: true };
    }
  }
};
