import { dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { FileNode, IpcResponse } from '../../preload/types';

// Ignored folders for fast directory indexing
const IGNORED_DIRS = new Set(['.git', '.kombai', 'node_modules', 'dist', 'dist-electron', 'out', 'release', '.DS_Store', 'Thumbs.db']);

function isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function selectWorkspaceFolder(mainWindow: BrowserWindow): Promise<IpcResponse<string>> {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Directory'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'User canceled directory selection' };
  }

  return { success: true, data: result.filePaths[0] };
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

export async function readFile(filePath: string): Promise<IpcResponse<string>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, data: content };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function writeFile(filePath: string, content: string): Promise<IpcResponse<void>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function createFile(filePath: string): Promise<IpcResponse<void>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '', { flag: 'wx' }); // Error if file exists
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function createDirectory(dirPath: string): Promise<IpcResponse<void>> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function deletePath(targetPath: string): Promise<IpcResponse<void>> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

export async function renamePath(oldPath: string, newPath: string): Promise<IpcResponse<void>> {
  try {
    await fs.rename(oldPath, newPath);
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

