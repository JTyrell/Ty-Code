import { AGENT_TOOLS_DEFINITIONS, type EnvironmentContext } from './system-prompt';
import { type ToolScope } from './prompt-assembler';

/**
 * Tool names that depend on a loaded workspace (filesystem, PTY cwd, git repo).
 * When no workspace is open these MUST NOT be offered to the LLM or executed,
 * otherwise the main process wastes cycles on failed path resolutions and
 * hanging PTY spawns against an empty cwd.
 */
const WORKSPACE_TOOLS = new Set([
  'read_file',
  'write_file',
  'replace_file_content',
  'edit_file',
  'run_command',
  'run_terminal_command',
  'list_dir',
  'list_directory',
  'grep_search',
  'git_status',
  'git_diff',
  'git_commit',
  'git_branch',
  'git_log',
  'git_merge',
  'generate_presentation'
]);

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'grep_search',
  'list_dir',
  'list_directory',
  'git_log',
  'git_diff'
]);

const ALWAYS_AVAILABLE = ['request_approval', 'request_workspace_open', 'brave_web_search', 'submit_plan', 'submit_report'];

/**
 * Returns the tool names the agent may use given the current environment AND
 * tool scope. Two independent short-circuits ANDed together:
 *   1. Workspace state (no workspace -> no FS/PTY/git tools)
 *   2. Tool scope (read-only / docs-only tighten the set further)
 * O(1) with respect to the workspace - no disk reads, no PTY spawns.
 */
export function getAvailableTools(envContext: EnvironmentContext, scope: ToolScope = 'all'): string[] {
  // Short-circuit 1: no workspace
  if (!envContext.hasWorkspace) {
    return [...ALWAYS_AVAILABLE];
  }

  // Short-circuit 2: tool scope from role/mode
  if (scope === 'read-only') {
    return [...ALWAYS_AVAILABLE, ...Array.from(READ_ONLY_TOOLS)];
  }
  if (scope === 'docs-only') {
    // docs-only: read-only + write_file restricted to docs/ (enforced at execution time)
    return [...ALWAYS_AVAILABLE, ...Array.from(READ_ONLY_TOOLS), 'write_file'];
  }
  // all
  return AGENT_TOOLS_DEFINITIONS.map((t) => t.function.name);
}

export function isToolAvailable(toolName: string, envContext: EnvironmentContext, scope: ToolScope = 'all'): boolean {
  return getAvailableTools(envContext, scope).includes(toolName);
}

export function isWorkspaceTool(toolName: string): boolean {
  return WORKSPACE_TOOLS.has(toolName);
}

/**
 * For docs-only scope, write_file is restricted to the docs/ directory.
 * Enforced at execution time in the engine.
 */
export function isDocsOnlyWrite(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
  return normalized.startsWith('docs/') || normalized === 'docs';
}
