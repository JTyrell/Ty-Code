import type { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { FileNode, IpcResponse } from '../../preload/types';

// Ignored folders for fast directory indexing
const IGNORED_DIRS = new Set(['.git', '.kombai', 'node_modules', 'dist', 'dist-electron', 'out', 'release', '.DS_Store', 'Thumbs.db']);

function isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveWorkspaceTarget(targetPath: string, workspaceRoot: string, allowMissing = false): Promise<string> {
  if (!targetPath || typeof targetPath !== 'string') throw new Error('A valid workspace path is required.');
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const resolved = path.resolve(root, targetPath);
  if (!isInsideWorkspace(resolved, root) || resolved === root) throw new Error('File operations must target a path inside the active workspace.');
  try {
    const real = await fs.realpath(resolved);
    if (!isInsideWorkspace(real, root)) throw new Error('File path resolves outside the active workspace.');
    return real;
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let parent = path.dirname(resolved);
    while (parent !== root && isInsideWorkspace(parent, root)) {
      try {
        const realParent = await fs.realpath(parent);
        if (!isInsideWorkspace(realParent, root)) throw new Error('File parent resolves outside the active workspace.');
        break;
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
        parent = path.dirname(parent);
      }
    }
    return resolved;
  }
}

export async function selectWorkspaceFolder(mainWindow?: BrowserWindow): Promise<IpcResponse<string>> {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Directory'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'User canceled directory selection' };
    }

    return { success: true, data: result.filePaths[0] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getWorkspaceTree(rootPath: string): Promise<IpcResponse<FileNode>> {
  try {
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Provided path is not a directory' };
    }

    async function buildTree(currentPath: string, relative: string, depth = 0): Promise<FileNode> {
      const name = path.basename(currentPath) || currentPath;
      const currentStats = await fs.stat(currentPath);

      if (!currentStats.isDirectory()) {
        return {
          name,
          path: currentPath,
          relativePath: relative,
          isDirectory: false,
          size: currentStats.size,
          extension: path.extname(name).toLowerCase()
        };
      }

      const node: FileNode = {
        name,
        path: currentPath,
        relativePath: relative,
        isDirectory: true,
        children: []
      };

      // Limit depth for initial scan performance
      if (depth > 6) return node;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        const filteredEntries = entries.filter((e) => !IGNORED_DIRS.has(e.name));

        // Sort: directories first, then alphabetical
        filteredEntries.sort((a, b) => {
          if (a.isDirectory() === b.isDirectory()) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory() ? -1 : 1;
        });

        for (const entry of filteredEntries) {
          const entryPath = path.join(currentPath, entry.name);
          const entryRel = relative ? `${relative}/${entry.name}` : entry.name;
          const childNode = await buildTree(entryPath, entryRel, depth + 1);
          node.children?.push(childNode);
        }
      } catch (err) {
        console.warn(`[FS] Could not read directory: ${currentPath}`, err);
      }

      return node;
    }

    const tree = await buildTree(rootPath, '');
    return { success: true, data: tree };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function readFile(filePath: string, workspaceRoot = process.cwd()): Promise<IpcResponse<string>> {
  try {
    const safePath = await resolveWorkspaceTarget(filePath, workspaceRoot);
    const content = await fs.readFile(safePath, 'utf-8');
    return { success: true, data: content };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function writeFile(filePath: string, content: string, workspaceRoot = process.cwd()): Promise<IpcResponse<void>> {
  try {
    const safePath = await resolveWorkspaceTarget(filePath, workspaceRoot, true);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    const verifiedPath = await resolveWorkspaceTarget(safePath, workspaceRoot, true);
    await fs.writeFile(verifiedPath, content, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function createFile(filePath: string, workspaceRoot = process.cwd()): Promise<IpcResponse<void>> {
  try {
    const safePath = await resolveWorkspaceTarget(filePath, workspaceRoot, true);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    const verifiedPath = await resolveWorkspaceTarget(safePath, workspaceRoot, true);
    await fs.writeFile(verifiedPath, '', { flag: 'wx' }); // Error if file exists
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function createDirectory(dirPath: string, workspaceRoot = process.cwd()): Promise<IpcResponse<void>> {
  try {
    const safePath = await resolveWorkspaceTarget(dirPath, workspaceRoot, true);
    await fs.mkdir(safePath, { recursive: true });
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function deletePath(targetPath: string, workspaceRoot = process.cwd()): Promise<IpcResponse<void>> {
  try {
    const safePath = await resolveWorkspaceTarget(targetPath, workspaceRoot);
    await fs.rm(safePath, { recursive: true, force: true });
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function renamePath(oldPath: string, newPath: string, workspaceRoot = process.cwd()): Promise<IpcResponse<void>> {
  try {
    const safeOldPath = await resolveWorkspaceTarget(oldPath, workspaceRoot);
    const safeNewPath = await resolveWorkspaceTarget(newPath, workspaceRoot, true);
    await fs.rename(safeOldPath, safeNewPath);
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function searchWorkspaceFiles(workspaceRoot: string, query: string): Promise<IpcResponse<string[]>> {
  try {
    const q = query.toLowerCase().trim();
    const results: string[] = [];

    async function walk(dir: string) {
      if (results.length >= 60) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!q || relPath.toLowerCase().includes(q)) {
            results.push(relPath);
          }
        }
      }
    }

    await walk(workspaceRoot);
    return { success: true, data: results };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export interface SearchInFilesOptions {
  query: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  matchWholeWord?: boolean;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchLength: number;
  preview: string;
}

export interface FileSearchResult {
  filePath: string;
  relativePath: string;
  matches: SearchMatch[];
}

export interface ReplaceInFilesOptions extends SearchInFilesOptions {
  replacement: string;
  dryRun?: boolean;
  filePaths?: string[];
}

export interface ReplaceResult {
  filePath: string;
  relativePath: string;
  replacedCount: number;
  previewDiff?: string;
}

function simpleGlobMatch(targetPath: string, pattern: string): boolean {
  const norm = targetPath.replace(/\\/g, '/');
  const cleanPat = pattern.trim();
  if (!cleanPat) return true;

  // Simple wildcard to regex translation
  const escaped = cleanPat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE_STAR___/g, '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp(`(^|/)${escaped}($|/)`, 'i');
    return regex.test(norm) || norm.endsWith(cleanPat.replace(/^\*/, ''));
  } catch {
    return norm.includes(cleanPat);
  }
}

function matchesPatternFilter(relPath: string, include?: string, exclude?: string): boolean {
  if (exclude && exclude.trim()) {
    const excludes = exclude.split(',').map((p) => p.trim()).filter(Boolean);
    for (const pat of excludes) {
      if (simpleGlobMatch(relPath, pat)) return false;
    }
  }

  if (include && include.trim()) {
    const includes = include.split(',').map((p) => p.trim()).filter(Boolean);
    let matched = false;
    for (const pat of includes) {
      if (simpleGlobMatch(relPath, pat)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }

  return true;
}

export function buildSearchRegex(options: SearchInFilesOptions): RegExp {
  let pattern = options.query;
  if (!options.isRegex) {
    pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (options.matchWholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  const flags = options.isCaseSensitive ? 'g' : 'gi';
  return new RegExp(pattern, flags);
}

export async function searchInWorkspaceFiles(
  workspaceRoot: string,
  options: SearchInFilesOptions
): Promise<IpcResponse<FileSearchResult[]>> {
  if (!options.query) {
    return { success: true, data: [] };
  }

  try {
    const regex = buildSearchRegex(options);
    const results: FileSearchResult[] = [];
    const maxResults = options.maxResults || 500;
    let totalMatches = 0;

    async function walk(dir: string) {
      if (totalMatches >= maxResults) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (totalMatches >= maxResults) break;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!matchesPatternFilter(relPath, options.includePattern, options.excludePattern)) {
            continue;
          }

          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > 5 * 1024 * 1024) continue; // Skip files > 5MB

            const content = await fs.readFile(fullPath, 'utf-8');
            if (content.includes('\0')) continue; // Skip binary files

            const lines = content.split(/\r?\n/);
            const fileMatches: SearchMatch[] = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              regex.lastIndex = 0;
              let match: RegExpExecArray | null;

              while ((match = regex.exec(line)) !== null) {
                fileMatches.push({
                  lineNumber: i + 1,
                  lineContent: line,
                  matchStart: match.index,
                  matchLength: match[0].length,
                  preview: line.trim()
                });
                totalMatches++;
                if (!regex.global) break;
                if (match[0].length === 0) regex.lastIndex++;
                if (totalMatches >= maxResults) break;
              }
              if (totalMatches >= maxResults) break;
            }

            if (fileMatches.length > 0) {
              results.push({
                filePath: fullPath,
                relativePath: relPath,
                matches: fileMatches
              });
            }
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }

    await walk(workspaceRoot);
    return { success: true, data: results };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function replaceInWorkspaceFiles(
  workspaceRoot: string,
  options: ReplaceInFilesOptions
): Promise<IpcResponse<{ replacedCount: number; filesChanged: number; results: ReplaceResult[] }>> {
  try {
    const searchRes = await searchInWorkspaceFiles(workspaceRoot, options);
    if (!searchRes.success || !searchRes.data) {
      return { success: false, error: searchRes.error || 'Search failed before replace' };
    }

    const regex = buildSearchRegex(options);
    const replaceResults: ReplaceResult[] = [];
    let totalReplacements = 0;
    let filesChanged = 0;

    for (const fileResult of searchRes.data) {
      if (options.filePaths && !options.filePaths.includes(fileResult.filePath)) {
        continue;
      }

      const originalContent = await fs.readFile(fileResult.filePath, 'utf-8');
      let count = 0;
      const modifiedContent = originalContent.replace(regex, () => {
        count++;
        return options.replacement;
      });

      if (count > 0) {
        totalReplacements += count;
        filesChanged++;

        if (!options.dryRun) {
          await fs.writeFile(fileResult.filePath, modifiedContent, 'utf-8');
        }

        replaceResults.push({
          filePath: fileResult.filePath,
          relativePath: fileResult.relativePath,
          replacedCount: count,
          previewDiff: `Replaced ${count} occurrence(s) with '${options.replacement}'`
        });
      }
    }

    return {
      success: true,
      data: {
        replacedCount: totalReplacements,
        filesChanged,
        results: replaceResults
      }
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}


