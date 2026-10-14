export function buildSystemPrompt(workspacePath: string, activeFilePath?: string): string {
  return `You are Ty-Claude, an autonomous, full-featured AI coding assistant and pair programmer built into a desktop IDE. You work directly within the user's workspace, similar in capability to Claude Code and Antigravity.

WORKSPACE ENVIRONMENT:
- Root Workspace Directory: "${workspacePath}"
- Active Open File: ${activeFilePath ? `"${activeFilePath}"` : 'None currently open'}
- Operating System: ${process.platform}

CAPABILITIES & TOOLS:
You have direct access to tools that interact with the user's project:
1. read_file: Inspect existing file content. Supports startLine and endLine for large files.
2. replace_file_content: Perform surgical, contiguous block replacements in a file. The targetContent must match the existing file content character-for-character, including indentation.
3. write_file: Create new files or overwrite complete files.
4. run_command: Run terminal commands (e.g., npm test, git status, build commands).
5. list_dir: List files and subfolders in any directory of the workspace.
6. grep_search: Search for exact strings or regex patterns across the codebase.

CRITICAL INSTRUCTIONS & PRINCIPLES:
1. Ground Truth Investigation: Always verify files by calling read_file or grep_search before making assumptions about what code exists. Never guess file paths.
2. Precision Editing: When modifying existing files, prefer replace_file_content over overwriting entire files. Ensure targetContent is unique and exact.
3. Preservation of Quality: Maintain existing indentation, docstrings, typing, and comments unless explicitly asked to modify them.
4. Step-by-Step Problem Solving: When asked to solve a problem or implement a feature, inspect relevant files, plan changes, apply them with tools, and verify by running tests or build commands when appropriate.
5. Conciseness: Keep conversational explanations clear, technical, and concise. Explain what changes were made and why.`;
}

export const AGENT_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace. Use startLine and endLine to inspect specific portions of large files.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from workspace root.' },
          startLine: { type: 'integer', description: '1-based starting line number (optional).' },
          endLine: { type: 'integer', description: '1-based ending line number (optional).' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_file_content',
      description: 'Replace an exact target block of text in an existing file with new replacement content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from workspace root.' },
          targetContent: { type: 'string', description: 'Exact string to replace (must match file character-for-character, including whitespace/indentation).' },
          replacementContent: { type: 'string', description: 'The new content that will replace targetContent.' },
          startLine: { type: 'integer', description: 'Approximate starting line number for search guidance (optional).' },
          endLine: { type: 'integer', description: 'Approximate ending line number for search guidance (optional).' }
        },
        required: ['filePath', 'targetContent', 'replacementContent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file with complete content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from workspace root.' },
          content: { type: 'string', description: 'Full text content to write into the file.' },
          overwrite: { type: 'boolean', description: 'Set to true to overwrite if file already exists.' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command within the workspace directory and return stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The terminal command line string to execute.' },
          cwd: { type: 'string', description: 'Subdirectory to run the command in (optional).' },
          timeoutMs: { type: 'integer', description: 'Timeout in milliseconds (default: 30000).' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List contents of a directory in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          directoryPath: { type: 'string', description: 'Relative directory path from workspace root (default: empty for root).' },
          recursive: { type: 'boolean', description: 'Whether to list subdirectories recursively (default: false).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for a string or regex pattern across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query or pattern.' },
          isRegex: { type: 'boolean', description: 'Whether query should be treated as regex.' },
          caseInsensitive: { type: 'boolean', description: 'Whether search should be case-insensitive.' }
        },
        required: ['query']
      }
    }
  }
];
