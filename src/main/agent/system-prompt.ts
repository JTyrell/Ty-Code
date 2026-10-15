export interface SystemPromptOptions {
  isEccEnabled?: boolean;
  isSeoEnabled?: boolean;
  isLocal?: boolean;
  activeProvider?: string;
  activeModel?: string;
  settings?: any;
}

export function isLocalModel(provider?: string, model?: string): boolean {
  const p = (provider || '').toLowerCase();
  const m = (model || '').toLowerCase();
  if (p === 'ollama' || p === 'local') return true;
  if (p === 'custom' && (m.includes('localhost') || m.includes('127.0.0.1') || m.includes('8b') || m.includes('local'))) return true;
  if (m.includes('ollama') || m.includes('local:')) return true;
  return false;
}

export function getEccRulesPrompt(isLocal: boolean): string {
  if (isLocal) {
    return `### ADVANCED AGENT WORKFLOWS (ECC - LOCAL / COMPACT MODE)
1. **Streamlined Conventions**:
   - Follow existing codebase patterns, naming conventions, and file organization strictly.
   - Perform surgical, targeted block replacements to preserve context window.
   - Maintain all existing type signatures, docstrings, and comments without extraneous rewrites.
2. **Essential Guardrails**:
   - Never execute destructive shell commands or mutate files outside workspace.
   - Keep conversational explanations concise and focused on the immediate diff.
   - Avoid speculative code expansions; address the requested prompt directly.
*(Heavy multi-turn research skills automatically disabled to prevent context-window overflow and timeouts on local models)*`;
  }

  return `### ADVANCED AGENT WORKFLOWS (ECC - RESEARCH-FIRST / HOSTED MODE)
1. **Research-First Multi-Step Reasoning Chains**:
   - Before taking any modifying action or writing code, conduct exhaustive exploration of existing symbols, types, and call sites.
   - Map dependencies across modules: verify call hierarchies and import graphs using grep_search and read_file.
   - Deconstruct user goals into explicit, validated logical stages with clearly stated invariants.
2. **Deep Codebase Exploration & Architectural Cohesion**:
   - Inspect related tests, configuration files, and type declarations to ensure new code adheres to existing architectural idioms.
   - Formulate clear mental models and hypothesize potential edge cases prior to making edits.
3. **Cognitive Review & Post-Edit Verification**:
   - Review proposed diffs against surrounding files for unintended side-effects or regressions.
   - Verify typing, boundary conditions, error handling, and test coverage before finalizing the turn.
4. **Engineering Guardrails & Standards**:
   - Never commit unverified assumptions. Run validation tests and diagnostic checks when available.
   - Maintain zero tolerance for broken types, leaky abstractions, or hardcoded credentials.`;
}

export function getPresentationPromptGuidance(isLocal: boolean): string {
  if (isLocal) {
    return `### PRESENTATION GENERATION (BENTO - LOCAL / COMPACT MODE)
When asked to create or generate a presentation, slide deck, or showcase:
- Use the generate_presentation tool with a clear topic and a concise outline of slide titles.
- Keep slide content as simple, clean markdown bullets or short phrases. Do NOT attempt manual coordinate math or inline scripts.
- Rely completely on the Bento presentation template engine for styling, bento-grid cards, smooth transitions, and offline presentation controls.`;
  }

  return `### PRESENTATION GENERATION (BENTO - HOSTED / RICH MODE)
When asked to create or generate a presentation, slide deck, or showcase:
- Use the generate_presentation tool to generate professional, interactive slide decks.
- Provide a rich, comprehensive outline and detailed slide content, including key takeaways, bullet items, speaker notes, and structured sections.
- Cover all key angles: an engaging title cover, problem definition, core concepts, multi-card deep dives, and clear next steps.`;
}

export function getSeoPromptGuidance(isLocal: boolean): string {
  if (isLocal) {
    return `### OPEN SEO & ANALYTICS MCP (LOCAL / COMPACT MODE)
When queried about website SEO, page audits, Core Web Vitals, or search performance:
- Use the seo_analytics_query tool to pull targeted analytics data.
- Payload data is automatically summarized to the top 3 most relevant insights to keep context usage optimal.
- Focus recommendations on top high-impact improvements (title tags, meta descriptions, heading hierarchy, and LCP/CLS performance).`;
  }

  return `### OPEN SEO & ANALYTICS MCP (HOSTED / RICH MODE)
When queried about website SEO, page audits, Core Web Vitals, or search performance:
- Use the seo_analytics_query tool to pull comprehensive search rankings, competitor metrics, and technical SEO signals.
- Synthesize multi-variable SEO data across keywords, traffic volumes, CTR trends, and SERP feature opportunities.
- Formulate strategic, in-depth optimization plans with specific title tag recommendations, meta updates, and Core Web Vitals fixes.`;
}

export function shouldInjectSeoRules(options?: SystemPromptOptions): boolean {
  if (options && typeof options.isSeoEnabled === 'boolean') {
    return options.isSeoEnabled;
  }
  if (options?.settings?.integrations && typeof options.settings.integrations['seo-analytics-mcp'] === 'boolean') {
    return options.settings.integrations['seo-analytics-mcp'];
  }
  try {
    const { moduleRegistry } = require('../services/module-registry');
    return Boolean(moduleRegistry.getModule('seo-analytics-mcp')?.isEnabled);
  } catch {
    return false;
  }
}

export function shouldInjectEccRules(options?: SystemPromptOptions): boolean {
  if (options && typeof options.isEccEnabled === 'boolean') {
    return options.isEccEnabled;
  }
  if (options?.settings?.integrations && typeof options.settings.integrations['ecc-rules'] === 'boolean') {
    return options.settings.integrations['ecc-rules'];
  }
  try {
    const { moduleRegistry } = require('../services/module-registry');
    return Boolean(moduleRegistry.getModule('ecc-rules')?.isEnabled);
  } catch {
    return false;
  }
}

export function buildSystemPrompt(
  workspacePath: string,
  activeFilePath?: string,
  activeFileContent?: string,
  options?: SystemPromptOptions
): string {
  const isEccEnabled = shouldInjectEccRules(options);
  const isSeoEnabled = shouldInjectSeoRules(options);
  const isLocal = typeof options?.isLocal === 'boolean'
    ? options.isLocal
    : isLocalModel(
        options?.activeProvider || options?.settings?.activeProvider,
        options?.activeModel || options?.settings?.activeModel
      );

  const activeFileContext = activeFileContent
    ? `\nActive file content (current editor buffer, truncated to 8,000 characters):\n${activeFileContent.slice(0, 8_000)}`
    : '';

  let prompt = `You are Ty-Code, an autonomous AI coding assistant and pair programmer built into a desktop IDE. Work directly within the user's workspace using the available coding tools.

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
9. git_commit: Create commits from already-staged changes. Stage files only when explicitly requested.
10. git_branch: List branches, switch branches, or create new branches. Create/switch requires user approval.
11. git_log: Inspect recent commit history.
12. git_merge: Merge branches and handle conflicts. Merge requires user approval.
13. generate_presentation: Generate an interactive, self-contained single-file HTML presentation from a topic and outline and save it to the workspace.

CRITICAL INSTRUCTIONS & PRINCIPLES:
1. Ground Truth Investigation: Always verify files by calling read_file or grep_search before making assumptions about what code exists. Never guess file paths.
2. Precision Editing: When modifying existing files, prefer replace_file_content over overwriting entire files. Ensure targetContent is unique and exact.
3. Preservation of Quality: Maintain existing indentation, docstrings, typing, and comments unless explicitly asked to modify them.
4. Git safety: Git commits, branch create/switch, merges, and shell commands that mutate Git or perform destructive file operations require explicit user approval. Wait for approval before execution; never attempt to bypass the approval prompt.
5. Step-by-Step Problem Solving: When asked to solve a problem or implement a feature, inspect relevant files, plan changes, apply them with tools, and verify by running tests or build commands when appropriate.
6. Conciseness: Keep conversational explanations clear, technical, and concise. Explain what changes were made and why.`;

  prompt += `\n\n${getPresentationPromptGuidance(isLocal)}`;

  if (isEccEnabled) {
    prompt += `\n\n${getEccRulesPrompt(isLocal)}`;
  }

  if (isSeoEnabled) {
    prompt += `\n\n${getSeoPromptGuidance(isLocal)}`;
  }

  return prompt;
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
          stageAll: { type: 'boolean', description: 'Explicitly stage all modified/untracked files before committing (default: false; requires user approval).' },
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
  },
  {
    type: 'function',
    function: {
      name: 'generate_presentation',
      description: 'Generate an interactive, beautiful single-file HTML presentation and save it into the workspace (default: presentation.html).',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'The overall presentation topic or title.'
          },
          outline: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of slide topics, headlines, or sections in the presentation.'
          },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Slide title' },
                content: { type: 'string', description: 'Slide content or markdown description' },
                notes: { type: 'string', description: 'Speaker notes for this slide (optional)' },
                items: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key bullet points or card items (optional)'
                }
              }
            },
            description: 'Optional array of detailed slide objects with titles, contents, items, and speaker notes.'
          },
          outputPath: {
            type: 'string',
            description: 'Workspace-relative output HTML file path (default: "presentation.html").'
          },
          theme: {
            type: 'string',
            enum: ['dark', 'light', 'cyan', 'emerald', 'sunset'],
            description: 'Color theme for the presentation (optional).'
          }
        },
        required: ['topic', 'outline']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'seo_analytics_query',
      description: 'Query the Open SEO & GEO Model Context Protocol (MCP) server for site SEO audits, keyword rankings, Search Console analytics, and Core Web Vitals.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['audit_page_seo', 'query_search_console', 'inspect_keyword_rankings', 'check_core_web_vitals'],
            description: 'The SEO analysis action to perform.'
          },
          targetUrl: {
            type: 'string',
            description: 'Target website URL or relative file path to audit (e.g., "https://example.com" or "index.html").'
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of target keywords to inspect or rank-track (optional).'
          },
          dateRange: {
            type: 'string',
            enum: ['7d', '28d', '3m', '12m'],
            description: 'Date range for search analytics query (optional, default: "28d").'
          }
        },
        required: ['action']
      }
    }
  }
];
