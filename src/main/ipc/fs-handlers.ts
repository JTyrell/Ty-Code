import type { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import fsSync from 'node:fs';
import path from 'path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { FileNode, FlatFileNodeEntry, IpcResponse } from '../../preload/types';
import { WorkerIndexerService } from '../services/indexing/worker-indexer-service';

// Ignored folders for fast directory indexing
const IGNORED_DIRS = new Set(['.git', '.kombai', 'node_modules', 'dist', 'dist-electron', 'out', 'release', '.DS_Store', 'Thumbs.db']);

const TREE_CACHE_DIR = path.join(os.tmpdir(), 'tycode-tree-cache');

const inMemoryTreeCache = new Map<string, FlatFileNodeEntry[]>();

async function readTreeDiskCache(cacheKey: string): Promise<FlatFileNodeEntry[] | null> {
  const mem = inMemoryTreeCache.get(cacheKey);
  if (mem && mem.length > 0) return mem;

  try {
    const cacheFile = path.join(TREE_CACHE_DIR, `${cacheKey}.json`);
    const raw = await fs.readFile(cacheFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      inMemoryTreeCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    // Cache miss or parse error
  }
  return null;
}

async function writeTreeDiskCache(cacheKey: string, entries: FlatFileNodeEntry[]): Promise<void> {
  inMemoryTreeCache.set(cacheKey, entries);
  try {
    await fs.mkdir(TREE_CACHE_DIR, { recursive: true });
    const cacheFile = path.join(TREE_CACHE_DIR, `${cacheKey}.json`);
    await fs.writeFile(cacheFile, JSON.stringify(entries), 'utf-8');
  } catch (err) {
    console.warn('[FS Cache] Failed to write tree cache:', err);
  }
}

let activeWorkspaceWatcher: fsSync.FSWatcher | null = null;
let watcherDebounceTimer: NodeJS.Timeout | null = null;

export function setupWorkspaceWatcher(
  workspaceRoot: string,
  onUpdate: (event: 'change' | 'add' | 'unlink', relPath: string) => void
): () => void {
  if (activeWorkspaceWatcher) {
    try {
      activeWorkspaceWatcher.close();
    } catch {}
    activeWorkspaceWatcher = null;
  }

  try {
    activeWorkspaceWatcher = fsSync.watch(workspaceRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const cleanRel = filename.replace(/\\/g, '/');
      if (IGNORED_DIRS.has(cleanRel.split('/')[0])) return;

      if (watcherDebounceTimer) clearTimeout(watcherDebounceTimer);
      watcherDebounceTimer = setTimeout(async () => {
        try {
          const fullPath = path.join(workspaceRoot, filename);
          let changeType: 'change' | 'add' | 'unlink' = 'change';
          try {
            await fs.stat(fullPath);
            changeType = eventType === 'rename' ? 'add' : 'change';
          } catch {
            changeType = 'unlink';
          }
          onUpdate(changeType, cleanRel);
        } catch {
          // Ignore watch callback error
        }
      }, 150);
    });
  } catch (err) {
    console.warn('[FS Watcher] Failed to attach workspace watcher:', err);
  }

  return () => {
    if (activeWorkspaceWatcher) {
      try {
        activeWorkspaceWatcher.close();
      } catch {}
      activeWorkspaceWatcher = null;
    }
  };
}

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

/**
 * Async chunked directory walk yielding every 500 entries (setImmediate)
 * Streams partial tree (first 200 entries paint immediately)
 * Uses disk index cache keyed by root + mtime hash; second open loads cache first, refreshes in background.
 */
export async function getWorkspaceTreeChunked(
  rootPath: string,
  onChunk?: (chunk: FlatFileNodeEntry[], isComplete: boolean, totalSoFar: number) => void
): Promise<IpcResponse<{ flatTree: FlatFileNodeEntry[]; fromCache: boolean; cacheKey?: string }>> {
  try {
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Provided path is not a directory' };
    }

    const cacheKey = crypto.createHash('sha256').update(`${rootPath}:${stats.mtimeMs}`).digest('hex');

    // Second open loads cache first, refreshes in background
    const cached = await readTreeDiskCache(cacheKey);
    if (cached && cached.length > 0) {
      if (onChunk) onChunk(cached, true, cached.length);
      return {
        success: true,
        data: { flatTree: cached, fromCache: true, cacheKey }
      };
    }

    const flatTree: FlatFileNodeEntry[] = [];
    let processedCount = 0;
    let firstChunkEmitted = false;

    // Root entry
    const rootName = path.basename(rootPath) || rootPath;
    flatTree.push({
      name: rootName,
      path: rootPath,
      relativePath: '',
      isDirectory: true,
      depth: 0,
      type: 'directory'
    });

    async function walk(currentPath: string, relative: string, depth: number): Promise<void> {
      if (depth > 8) return;
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        const filtered = entries.filter((e) => !IGNORED_DIRS.has(e.name));

        filtered.sort((a, b) => {
          if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
          return a.isDirectory() ? -1 : 1;
        });

        for (const entry of filtered) {
          processedCount++;
          const entryPath = path.join(currentPath, entry.name);
          const entryRel = relative ? `${relative}/${entry.name}` : entry.name;
          const isDir = entry.isDirectory();

          flatTree.push({
            name: entry.name,
            path: entryPath,
            relativePath: entryRel,
            isDirectory: isDir,
            depth: depth + 1,
            type: isDir ? 'directory' : 'file',
            extension: isDir ? undefined : path.extname(entry.name).toLowerCase()
          });

          // Yield every 500 entries: ensures main process never blocks >16ms
          if (processedCount % 500 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }

          // Progressive streaming: stream partial tree (first 200 entries paint immediately)
          if (!firstChunkEmitted && flatTree.length >= 200) {
            firstChunkEmitted = true;
            if (onChunk) {
              onChunk(flatTree.slice(0, 200), false, 200);
            }
          }

          if (isDir) {
            await walk(entryPath, entryRel, depth + 1);
          }
        }
      } catch (err) {
        console.warn(`[FS] Could not read directory: ${currentPath}`, err);
      }
    }

    await walk(rootPath, '', 0);

    // Write disk index cache
    await writeTreeDiskCache(cacheKey, flatTree);

    if (onChunk) {
      onChunk(flatTree, true, flatTree.length);
    }

    return {
      success: true,
      data: { flatTree, fromCache: false, cacheKey }
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export function buildNestedTreeFromFlat(flat: FlatFileNodeEntry[]): FileNode {
  if (flat.length === 0) {
    return { name: '', path: '', relativePath: '', isDirectory: true, children: [] };
  }
  const root = flat[0];
  const rootNode: FileNode = {
    name: root.name,
    path: root.path,
    relativePath: root.relativePath || '',
    isDirectory: true,
    children: []
  };

  const nodeMap = new Map<string, FileNode>();
  nodeMap.set(root.path, rootNode);

  for (let i = 1; i < flat.length; i++) {
    const item = flat[i];
    const node: FileNode = {
      name: item.name,
      path: item.path,
      relativePath: item.relativePath || '',
      isDirectory: item.isDirectory,
      size: item.size,
      extension: item.extension,
      children: item.isDirectory ? [] : undefined
    };
    nodeMap.set(item.path, node);

    const parentPath = path.dirname(item.path);
    const parentNode = nodeMap.get(parentPath);
    if (parentNode && parentNode.children) {
      parentNode.children.push(node);
    } else {
      rootNode.children?.push(node);
    }
  }

  return rootNode;
}

export async function getWorkspaceTree(rootPath: string): Promise<IpcResponse<FileNode>> {
  const chunkedRes = await getWorkspaceTreeChunked(rootPath);
  if (!chunkedRes.success || !chunkedRes.data) {
    return { success: false, error: chunkedRes.error || 'Failed to read tree' };
  }
  const nested = buildNestedTreeFromFlat(chunkedRes.data.flatTree);
  return { success: true, data: nested };
}

export async function readFile(
  filePath: string,
  workspaceRoot = process.cwd(),
  onProgress?: (chunk: string, isComplete: boolean) => void
): Promise<IpcResponse<string>> {
  try {
    const safePath = await resolveWorkspaceTarget(filePath, workspaceRoot);
    const stat = await fs.stat(safePath);

    // Stream-read files >1MB with progressive delivery; small files read once
    if (stat.size > 1024 * 1024) {
      const handle = await fs.open(safePath, 'r');
      try {
        const firstChunkBuffer = Buffer.alloc(128 * 1024); // 128KB initial chunk
        const { bytesRead } = await handle.read(firstChunkBuffer, 0, 128 * 1024, 0);
        const firstChunk = firstChunkBuffer.toString('utf-8', 0, bytesRead);

        if (onProgress) {
          onProgress(firstChunk, false);
        }

        const fullContent = await fs.readFile(safePath, 'utf-8');
        if (onProgress) {
          onProgress(fullContent, true);
        }
        return { success: true, data: fullContent };
      } finally {
        await handle.close();
      }
    }

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

        // Yield to event loop to keep main thread responsive (<16ms)
        if (results.length % 50 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }

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


