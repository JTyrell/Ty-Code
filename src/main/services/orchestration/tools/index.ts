import type { OpenCodeTool, OpenCodeToolDefinition, ToolContext, ToolExecutionResult } from './types';
import { viewTool } from './view';
import { writeTool } from './write';
import { editTool } from './edit';
import { patchTool } from './patch';
import { bashTool } from './bash';
import { grepTool } from './grep';
import { globTool } from './glob';
import { lsTool } from './ls';
import { fetchTool } from './fetch';
import { diagnosticsTool } from './diagnostics';
import { approveFileMutation, approveTerminalCommand } from './policy';

export * from './types';
export * from './view';
export * from './write';
export * from './edit';
export * from './patch';
export * from './bash';
export * from './grep';
export * from './glob';
export * from './ls';
export * from './fetch';
export * from './diagnostics';
export * from './policy';

export const OPENCODE_TOOLS: Record<string, OpenCodeTool> = {
  view: viewTool,
  write: writeTool,
  edit: editTool,
  patch: patchTool,
  bash: bashTool,
  grep: grepTool,
  glob: globTool,
  ls: lsTool,
  fetch: fetchTool,
  diagnostics: diagnosticsTool
};

export const OPENCODE_TOOL_DEFINITIONS: OpenCodeToolDefinition[] = Object.values(OPENCODE_TOOLS).map(
  (t) => t.definition
);

export async function executeOpenCodeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const tool = OPENCODE_TOOLS[toolName];
  if (!tool) {
    return {
      output: `Unknown tool "${toolName}". Available tools: ${Object.keys(OPENCODE_TOOLS).join(', ')}.`,
      isError: true
    };
  }
  return tool.execute(args, context);
}
