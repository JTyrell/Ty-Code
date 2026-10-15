/**
 * ECC (Advanced Agent Workflows) Asset Installer (Phase 3.2)
 *
 * Safely provisions core rules, skills, and commands from ECC into
 * global user directory (~/.ty-code/ and ~/.ty-claude/ for compatibility)
 * and workspace target directories.
 *
 * Offline-first with bundled assets and optional remote clone support.
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface EccAssetFile {
  subpath: string; // e.g. 'rules/01-core-principles.md', 'skills/code-review/SKILL.md'
  content: string;
}

/**
 * High-fidelity bundled ECC assets for rules, skills, and commands.
 * Matches affaan-m/ECC structure.
 */
export const ECC_BUNDLED_ASSETS: EccAssetFile[] = [
  // --- Rules ---
  {
    subpath: path.join('rules', '01-core-principles.md'),
    content: `# Core Principles & Cognitive Framework (ECC)
1. **Ground Truth First**: Never speculate about file structures, API signatures, or imports. Always verify using read_file or grep_search.
2. **Surgical Precision**: Limit modifications to necessary lines. Prefer contiguous block replacements over full-file rewrites.
3. **Preserve Integrity**: Retain all existing docstrings, typing annotations, comments, and project coding styles.
4. **Step-by-Step Execution**: Formulate an explicit plan, apply changes atomically, and verify with tests or diagnostics.
`
  },
  {
    subpath: path.join('rules', '02-research-first.md'),
    content: `# Research-First Multi-Step Reasoning Protocol (ECC)
1. **Exhaustive Dependency Tracing**: Before modifying code, inspect callers, callees, and type definitions across surrounding modules.
2. **Architectural Cohesion**: Understand the system's prevailing design patterns before proposing changes.
3. **Hypothesis & Risk Analysis**: Formulate explicit failure modes and edge cases before writing implementation code.
4. **Verification Loop**: Confirm compilation and test results after every logical change.
`
  },
  {
    subpath: path.join('rules', '03-code-conventions.md'),
    content: `# Code Conventions & Quality Standards (ECC)
- Adhere strictly to language-idiomatic patterns and existing project linting rules.
- Strict type-safety: Never introduce implicit \`any\` or lose type information.
- Clean error propagation: Avoid swallowing errors; ensure proper boundary handling.
- Atomic commits: Create descriptive, conventional commit messages when staging changes.
`
  },
  {
    subpath: path.join('rules', '04-guardrails.md'),
    content: `# Guardrails & Security Policies (ECC)
- Never mutate files outside the authorized workspace boundaries.
- Never hardcode or log credentials, tokens, or private secrets.
- Prompt for explicit user approval before executing any destructive shell commands or git mutations.
- In restricted mode, block write and execution operations outside safe allowlists.
`
  },
  {
    subpath: path.join('rules', '05-cognitive-review.md'),
    content: `# Cognitive Review & Post-Edit Inspection (ECC)
1. Diff Inspection: Inspect generated git diffs to ensure no unintended formatting or whitespace changes were introduced.
2. Regression Checking: Assess whether changes impact neighboring modules or dependent tests.
3. Edge Case Coverage: Verify nullability, empty state handling, and timeout behavior.
`
  },

  // --- Skills ---
  {
    subpath: path.join('skills', 'deep-research', 'SKILL.md'),
    content: `---
name: "ECC Deep Codebase Research"
description: "Multi-step architectural analysis, symbol dependency tracing, and codebase exploration."
---
# Deep Codebase Research Skill
Conducts exhaustive symbol and call-site exploration across the project.
1. Grep for target interfaces, function names, and types.
2. View surrounding files to map dependency graphs.
3. Synthesize findings before proposing modifications.
`
  },
  {
    subpath: path.join('skills', 'code-review', 'SKILL.md'),
    content: `---
name: "ECC Cognitive Code Review"
description: "High-precision diff analysis, architectural validation, and regression hazard detection."
---
# Cognitive Code Review Skill
Evaluates pending changes against quality standards.
1. Run git diff or inspect editor buffer.
2. Verify type correctness, security policies, and edge-case handling.
3. Flag any deviations from project idioms.
`
  },
  {
    subpath: path.join('skills', 'refactor-clean', 'SKILL.md'),
    content: `---
name: "ECC Surgical Refactoring"
description: "Safe dead-code elimination, pattern consolidation, and code smell reduction."
---
# Surgical Refactoring Skill
Refactors complex methods into concise, cohesive units without altering external behavior.
`
  },
  {
    subpath: path.join('skills', 'test-generator', 'SKILL.md'),
    content: `---
name: "ECC Test Suite Generator"
description: "Automated test generator for unit, integration, and regression suites."
---
# Test Suite Generator Skill
Generates comprehensive tests covering happy paths, edge cases, and error boundaries.
`
  },

  // --- Commands ---
  {
    subpath: path.join('commands', 'research.md'),
    content: `# /research Command
Perform deep multi-step codebase exploration for a specific topic, module, or architecture component.
`
  },
  {
    subpath: path.join('commands', 'review.md'),
    content: `# /review Command
Perform cognitive diff review of current changes, analyzing regression risk, security, and styling compliance.
`
  },
  {
    subpath: path.join('commands', 'plan.md'),
    content: `# /plan Command
Formulate a multi-stage implementation plan with explicit checkpoints and validation steps before execution.
`
  }
];

export interface InstallResult {
  success: boolean;
  copiedFiles: string[];
  targetDirs: string[];
  message: string;
}

/**
 * Safely installs ECC assets into global ~/.ty-code/ (and ~/.ty-claude/)
 * and workspace target directories.
 */
export async function installEccAssets(
  workspacePath?: string,
  options?: { remoteClone?: boolean; customHome?: string }
): Promise<InstallResult> {
  const homeDir = options?.customHome || os.homedir();
  const root = workspacePath || process.cwd();

  const targetBases = [
    // Global user directories
    path.join(homeDir, '.ty-code'),
    path.join(homeDir, '.ty-claude'),
    // Workspace target directories
    path.join(root, '.ty-code'),
    path.join(root, '.ty-claude')
  ];

  const copiedFiles: string[] = [];
  const targetDirs: string[] = [];

  // If remote clone is explicitly requested and git is available, attempt git clone
  let remoteClonedAssets: EccAssetFile[] | null = null;
  if (options?.remoteClone) {
    try {
      const tempDir = path.join(os.tmpdir(), `ecc-clone-${Date.now()}`);
      await execAsync(`git clone --depth 1 https://github.com/affaan-m/ECC.git "${tempDir}"`);
      // Read files from cloned repo if successful
      // If any issue occurs, we gracefully fall back to ECC_BUNDLED_ASSETS
      remoteClonedAssets = await readAssetsFromClonedDir(tempDir);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    } catch {
      // Fallback to bundled assets
      remoteClonedAssets = null;
    }
  }

  const assetsToInstall = remoteClonedAssets && remoteClonedAssets.length > 0
    ? remoteClonedAssets
    : ECC_BUNDLED_ASSETS;

  for (const base of targetBases) {
    const rulesDir = path.join(base, 'rules', 'ecc');
    const skillsDir = path.join(base, 'skills', 'ecc');
    const commandsDir = path.join(base, 'commands', 'ecc');

    await fs.mkdir(rulesDir, { recursive: true }).catch(() => {});
    await fs.mkdir(skillsDir, { recursive: true }).catch(() => {});
    await fs.mkdir(commandsDir, { recursive: true }).catch(() => {});

    targetDirs.push(rulesDir, skillsDir, commandsDir);

    for (const asset of assetsToInstall) {
      const fullPath = path.join(base, asset.subpath.startsWith('skills') || asset.subpath.startsWith('rules') || asset.subpath.startsWith('commands')
        ? insertEccFolder(asset.subpath)
        : path.join('rules', 'ecc', asset.subpath)
      );

      await fs.mkdir(path.dirname(fullPath), { recursive: true }).catch(() => {});
      await fs.writeFile(fullPath, asset.content, 'utf-8');
      copiedFiles.push(fullPath);
    }
  }

  return {
    success: true,
    copiedFiles,
    targetDirs,
    message: `Installed ${assetsToInstall.length} ECC assets across ${targetBases.length} targets.`
  };
}

function insertEccFolder(subpath: string): string {
  const parts = subpath.split(path.sep);
  if (parts.length >= 2) {
    // e.g. ['rules', '01-core.md'] -> ['rules', 'ecc', '01-core.md']
    // e.g. ['skills', 'code-review', 'SKILL.md'] -> ['skills', 'ecc', 'code-review', 'SKILL.md']
    return path.join(parts[0], 'ecc', ...parts.slice(1));
  }
  return path.join('rules', 'ecc', subpath);
}

async function readAssetsFromClonedDir(dir: string): Promise<EccAssetFile[]> {
  const results: EccAssetFile[] = [];
  const dirsToScan = ['rules', 'skills', 'commands'];

  for (const d of dirsToScan) {
    const fullDir = path.join(dir, d);
    try {
      const stat = await fs.stat(fullDir);
      if (!stat.isDirectory()) continue;
      await scanRecursive(fullDir, d, results);
    } catch {
      // directory might not exist
    }
  }

  return results;
}

async function scanRecursive(currentDir: string, relativeBase: string, results: EccAssetFile[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    const rel = path.join(relativeBase, entry.name);
    if (entry.isDirectory()) {
      await scanRecursive(entryPath, rel, results);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
      const content = await fs.readFile(entryPath, 'utf-8');
      results.push({ subpath: rel, content });
    }
  }
}

/**
 * Removes ECC assets from workspace when module is disabled.
 */
export async function removeEccAssets(workspacePath?: string, customHome?: string): Promise<boolean> {
  const homeDir = customHome || os.homedir();
  const root = workspacePath || process.cwd();

  const targets = [
    path.join(root, '.ty-code', 'skills', 'ecc'),
    path.join(root, '.ty-code', 'rules', 'ecc'),
    path.join(root, '.ty-code', 'commands', 'ecc'),
    path.join(root, '.ty-claude', 'skills', 'ecc'),
    path.join(root, '.ty-claude', 'rules', 'ecc'),
    path.join(homeDir, '.ty-code', 'skills', 'ecc'),
    path.join(homeDir, '.ty-code', 'rules', 'ecc'),
    path.join(homeDir, '.ty-claude', 'skills', 'ecc'),
    path.join(homeDir, '.ty-claude', 'rules', 'ecc')
  ];

  for (const target of targets) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
  }

  return true;
}
