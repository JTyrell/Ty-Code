/**
 * Workspace Context Manager
 *
 * Supplies ground-truth workspace context to the agent system prompt so every
 * model is aware of the open directory, its folder structure, and the files the
 * user is actively working on (mirrors what the Explorer shows).
 */

import fs from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.gradle',
  'target',
  'bin',
  'obj',
  'vendor',
  '.ty-code'
]);

const IGNORED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'package-lock.json',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.tsbuildinfo'
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.vue',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp',
  '.cs', '.php', '.sh', '.sql', '.json', '.md', '.txt', '.yml', '.yaml', '.env',
  '.xml'
]);

const SUMMARY_MAX_LINES = 220;
const TREE_MAX_DEPTH = 3;
const TREE_MAX_ENTRIES_PER_DIR = 40;

export interface WorkspaceFileContext {
  path: string;
  languageLabel: string;
  content: string;
  truncated: boolean;
}

function sortDirEntries(entries: Dirent[]): Dirent[] {
  return entries
    .filter((entry) => (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name)) ||
      (entry.isFile() && !IGNORED_FILE_NAMES.has(entry.name) && !entry.name.startsWith('.')))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) : a.isDirectory() ? -1 : 1));
}

async function buildTree(rootPath: string, dirPath: string, depth: number, lines: string[], prefix: string): Promise<void> {
  if (depth > TREE_MAX_DEPTH || lines.length >= SUMMARY_MAX_LINES) return;
  let entries: Dirent[];
  try {
    entries = sortDirEntries(await fs.readdir(dirPath, { withFileTypes: true }));
  } catch {
    return;
  }
  if (entries.length > TREE_MAX_ENTRIES_PER_DIR) {
    entries = entries.slice(0, TREE_MAX_ENTRIES_PER_DIR);
    lines.push(`${prefix}  … (${entries.length}/${entries.length} TRUNCATED)`);
    return;
  }
  for (const entry of entries) {
    if (lines.length >= SUMMARY_MAX_LINES) {
      lines.push(`${prefix}  … (output truncated)`);
      return;
    }
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      await buildTree(rootPath, fullPath, depth + 1, lines, `${prefix}    `);
    } else {
      lines.push(`${prefix}${entry.name}${relPath ? `  -> ${relPath}` : ''}`);
    }
  }
}

async function countFiles(rootPath: string): Promise<{ files: number; dirs: number }> {
  let files = 0;
  let dirs = 0;
  const walk = async (dirPath: string, depth: number): Promise<void> => {
    if (depth > TREE_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name)) continue;
        dirs++;
        await walk(full, depth + 1);
      } else if (entry.isFile() && !IGNORED_FILE_NAMES.has(entry.name)) {
        files++;
      }
    }
  };
  await walk(rootPath, 0);
  return { files, dirs };
}

/**
 * Concise tree-shaped summary of the workspace root, used directly inside the
 * agent system prompt. Always resolves to a usable string (never throws).
 */
export async function getWorkspaceSummary(rootPath: string): Promise<string> {
  if (!rootPath || rootPath.trim().length === 0) {
    return '(workspace path is not set — ask the user to open a folder in the Explorer)';
  }
  let resolved: string;
  try {
    resolved = await fs.realpath(rootPath);
  } catch {
    return `(workspace directory is not accessible: ${rootPath})`;
  }
  let stats: Stats;
  try {
    stats = await fs.stat(resolved);
  } catch {
    return `(workspace directory is not accessible: ${rootPath})`;
  }
  if (!stats.isDirectory()) {
    return `(workspace path is a file, not a directory: ${rootPath})`;
  }

  const projectName = path.basename(resolved);
  const rootEntries = sortDirEntries(await fs.readdir(resolved, { withFileTypes: true }).catch(() => []));
  const { files, dirs } = await countFiles(resolved);

  const lines: string[] = [];
  lines.push(`${projectName}/  (${rootEntries.filter((e) => e.isDirectory()).length} top-level folders, ${rootEntries.filter((e) => e.isFile()).length} top-level files; ~${files} files / ${dirs} subfolders sampled to depth ${TREE_MAX_DEPTH})`);
  await buildTree(resolved, resolved, 0, lines, '');

  const summary = lines.join('\n');
  console.log(`[WORKSPACE-CTX] summary for ${resolved}: ${lines.length} lines, ${summary.length} chars`);
  return summary;
}

function fileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function languageLabel(filePath: string): string {
  const ext = fileExtension(filePath);
  switch (ext) {
    case '.ts': case '.tsx': return 'TypeScript';
    case '.js': case '.jsx': case '.mjs': case '.cjs': return 'JavaScript';
    case '.py': return 'Python';
    case '.json': return 'JSON';
    case '.md': return 'Markdown';
    case '.css': case '.scss': return 'CSS';
    case '.html': return 'HTML';
    default: return ext.replace('.', '').toUpperCase() || 'Text';
  }
}

const MAX_OPEN_FILE_CHARS = 6000;
const MAX_OPEN_FILES = 6;

/**
 * Reads the content of the currently open / active editor files for prompt
 * injection. `openFilePaths` are workspace-relative or absolute paths; the
 * `activeFilePath` param allows the engine to describe which file has focus.
 */
export async function getOpenFilesContent(
  rootPath: string,
  openFilePaths: string[],
  activeFilePath?: string
): Promise<WorkspaceFileContext[]> {
  const results: WorkspaceFileContext[] = [];
  const unique = Array.from(new Set(openFilePaths.filter(Boolean))).slice(0, MAX_OPEN_FILES);
  for (const relPath of unique) {
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(rootPath, relPath);
    let content = '';
    try {
      const stats = await fs.stat(absPath);
      if (!stats.isFile() || stats.size > 2 * 1024 * 1024) continue;
      const ext = fileExtension(absPath);
      if (!TEXT_EXTENSIONS.has(ext) && ext !== '') continue;
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    const truncated = content.length > MAX_OPEN_FILE_CHARS;
    if (truncated) {
      content = content.slice(0, MAX_OPEN_FILE_CHARS);
    }
    if (!content.trim()) continue;
    results.push({
      path: path.isAbsolute(relPath) ? path.relative(rootPath, absPath).replace(/\\/g, '/') : relPath.replace(/\\/g, '/'),
      languageLabel: languageLabel(absPath),
      content: truncated ? `${content}\n… (truncated at ${MAX_OPEN_FILE_CHARS} chars; use read_file for the rest)` : content,
      truncated
    });
    console.log(`[WORKSPACE-CTX] open file injected: ${relPath}`);
  }
  if (activeFilePath) {
    console.log(`[WORKSPACE-CTX] active editor focus: ${activeFilePath}`);
  }
  return results;
}

/**
 * Composes the full dynamic workspace block that agent engines embed at the
 * top of the system prompt before the first LLM call.
 */
export function buildWorkspaceContextBlock(params: {
  rootPath: string;
  workspaceSummary: string;
  openFiles: WorkspaceFileContext[];
  activeFilePath?: string;
  activeFileContent?: string;
}): string {
  const { rootPath, workspaceSummary, openFiles, activeFilePath, activeFileContent } = params;
  const projectName = rootPath ? path.basename(rootPath) : 'workspace';
  const sections: string[] = [];
  sections.push(`You are working in the "${projectName}" workspace at: ${rootPath}`);
  sections.push(`CURRENT FILE STRUCTURE (Explorer view):\n${workspaceSummary}`);
  if (activeFilePath) {
    sections.push(`ACTIVE EDITOR FILE (user is currently focused here): ${activeFilePath}`);
    if (activeFileContent) {
      sections.push(`ACTIVE FILE PREVIEW (first 4000 chars):\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\``);
    }
  }
  if (openFiles.length > 0) {
    const filesBlock = openFiles
      .map((f) => `--- ${f.path} (${f.languageLabel}) ---\n${f.content}`)
      .join('\n\n');
    sections.push(`OPEN FILES CONTENT:\n${filesBlock}`);
  } else {
    sections.push('No extra editor tabs are open in the workspace.');
  }
  return sections.join('\n\n');
}
