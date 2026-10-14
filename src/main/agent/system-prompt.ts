export function buildSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string {
  const activeFileContext = activeFileContent
    ? `\nActive file content (current editor buffer, truncated to 8,000 characters):\n${activeFileContent.slice(0, 8_000)}`
    : '';
  return `You are Ty-Claude, an autonomous, full-featured AI coding assistant and pair programmer built into a desktop IDE. You work directly within the user's workspace, similar in capability to Claude Code and Antigravity.

WORKSPACE ENVIRONMENT:
- Root Workspace Directory: "${workspacePath}"
- Active Open File: ${activeFilePath ? `"${activeFilePath}"` : 'None currently open'}${activeFileContext}
- Operating System: ${process.platform}

CAPABILITIES & TOOLS:
You have direct access to tools that interact with the user's project:
1. read_file: Inspect existing file content. Supports startLine and endLine for large files.
2. replace_file_content: Perform surgical, contiguous block replacements in a file. The targetContent must match the existing file content character-for-character, including indentation.
3. write_file: Create new files or overwrite complete files.
4. run_command: Run terminal commands (e.g. npm test, build commands).
5. list_dir: List files and subfolders in any directory of the workspace.
6. grep_search: Search for exact strings or regex patterns across the codebase.
7. git_status: Query repository status, branches, modified and staged files.
8. git_diff: Inspect unified diffs of working changes or specific files.
9. git_commit: Stage files and create commits with conventional commit messages.
10. git_branch: List branches, switch branches, or create new branches.
11. git_log: Inspect recent commit history.
12. git_merge: Merge branches and handle conflicts.

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
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Get current Git repository status including current branch, ahead/behind counts, and staged/unstaged/untracked files.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Get Git diff in unified format for unstaged changes, staged changes, or a specific file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to a specific file to diff (optional).' },
          staged: { type: 'boolean', description: 'Set to true to view staged/cached diff (optional).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Stage files and create a Git commit with a descriptive conventional commit message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The commit message (e.g., "feat(ui): add source control panel").' },
          stageAll: { type: 'boolean', description: 'Whether to stage all modified/untracked files before committing (default: true).' },
          filePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific list of relative file paths to stage before committing (optional).'
          }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: 'List, create, or switch Git branches.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'switch'],
            description: 'The branch action to execute: "list", "create", or "switch".'
          },
          branchName: {
            type: 'string',
            description: 'The branch name (required for "create" and "switch").'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Get recent Git commit history with author, date, and commit messages.',
      parameters: {
        type: 'object',
        properties: {
          maxCount: { type: 'integer', description: 'Maximum number of commits to return (default: 15).' },
          search: { type: 'string', description: 'Search term to filter commit messages (optional).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_merge',
      description: 'Merge a specified branch into the current working branch with conflict detection.',
      parameters: {
        type: 'object',
        properties: {
          branchName: { type: 'string', description: 'Name of the branch to merge into current branch.' }
        },
        required: ['branchName']
      }
    }
  }
];
