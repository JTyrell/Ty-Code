import fs from 'node:fs/promises';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { resolveSafePath } from './view';
import { approveFileMutation } from './policy';

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

function parseUnifiedDiff(diffText: string): Hunk[] {
  const lines = diffText.split('\n');
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(match[1], 10),
        oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3], 10),
        newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: []
      };
    } else if (currentHunk) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '') {
        currentHunk.lines.push(line);
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

function applyHunks(original: string, hunks: Hunk[]): string {
  const origLines = original.split('\n');
  const resultLines = [...origLines];
  let offset = 0;

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1 + offset;
    const toRemove: number[] = [];
    const toInsert: string[] = [];

    let countOld = 0;
    for (const hLine of hunk.lines) {
      if (hLine.startsWith('-')) {
        countOld++;
      } else if (hLine.startsWith('+')) {
        toInsert.push(hLine.slice(1));
      } else if (hLine.startsWith(' ')) {
        countOld++;
        toInsert.push(hLine.slice(1));
      } else if (hLine === '') {
        countOld++;
        toInsert.push('');
      }
    }

    resultLines.splice(startIdx, countOld, ...toInsert);
    offset += (toInsert.length - countOld);
  }

  return resultLines.join('\n');
}

export const patchTool: OpenCodeTool = {
  name: 'patch',
  description: 'Apply unified diff patches to an existing file in the workspace.',
  definition: {
    type: 'function',
    function: {
      name: 'patch',
      description: 'Apply unified diff patches to an existing file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The target file path to patch.'
          },
          patch: {
            type: 'string',
            description: 'The unified diff or patch text (containing @@ -start,len +start,len @@).'
          }
        },
        required: ['filePath', 'patch']
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
      const patchText = String(args.patch ?? args.diff ?? '');

      if (!filePath) {
        return { output: 'Error: "filePath" parameter is required.', isError: true };
      }
      if (!patchText) {
        return { output: 'Error: "patch" parameter containing diff data is required.', isError: true };
      }

      const absolutePath = context.securityPolicy
        ? await context.securityPolicy.resolveFilePath(filePath)
        : resolveSafePath(context.workspaceRoot, filePath);
      const original = await fs.readFile(absolutePath, 'utf-8');

      const hunks = parseUnifiedDiff(patchText);
      if (hunks.length === 0) {
        return {
          output: 'Error: No valid unified diff hunks found in the provided patch.',
          isError: true
        };
      }

      const patched = applyHunks(original, hunks);

      const approval = await approveFileMutation({ id: `patch_${Date.now()}`, name: 'patch', arguments: { filePath, patch: patchText } }, filePath, original, patched, context);
      if (approval.denied) return approval.denied;
      let resolvedPath = approval.absolutePath || absolutePath;
      if (context.securityPolicy) {
        resolvedPath = await context.securityPolicy.verifyFileMutationSnapshot(approval.review!);
      }
      const tempPath = `${resolvedPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tempPath, patched, 'utf-8');
      await fs.rename(tempPath, resolvedPath);

      context.trackModifiedFile?.(filePath);

      const diff = {
        id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filePath,
        originalContent: original,
        proposedContent: patched,
        description: `Patch ${filePath} with ${hunks.length} hunk(s)`,
        status: 'applied' as const
      };

      return {
        output: `Successfully applied patch with ${hunks.length} hunk(s) to ${filePath}.`,
        proposedDiff: diff,
        metadata: { filePath, hunkCount: hunks.length }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error patching file: ${message}`, isError: true };
    }
  }
};
