/**
 * Worker-Thread Indexer & Search Runner (Fix 4)
 *
 * Runs background project indexing, candidate file scanning, token indexing,
 * symbol analysis, and ripgrep/regex search in a dedicated Node.js worker_thread.
 *
 * This offloads all heavy parsing and I/O away from the main Electron process,
 * ensuring the main process never blocks >16ms during workspace open.
 *
 * Brand: Ty-Code
 */

import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.ty-code',
  '.cache'
]);

const SUPPORTED_CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.json',
  '.md',
  '.sql',
  '.sh',
  '.html',
  '.css'
]);

export interface WorkerIndexRequest {
  id: string;
  type: 'index';
  workspacePath: string;
}

export interface WorkerSearchRequest {
  id: string;
  type: 'search';
  workspaceRoot: string;
  query: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  matchWholeWord?: boolean;
  maxResults?: number;
}

export type WorkerMessage = WorkerIndexRequest | WorkerSearchRequest | { id: string; type: 'ping' };

export async function runIndexing(workspacePath: string): Promise<{
  fileCount: number;
  symbolCount: number;
  exportCount: number;
  durationMs: number;
  frameworks: string[];
  languages: Record<string, number>;
}> {
  const startTime = Date.now();
  const fileList: string[] = [];
  const languageCounts: Record<string, number> = {};
  let symbolCount = 0;
  let exportCount = 0;

  async function collect(dir: string, depth = 0): Promise<void> {
    if (depth > 8) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await collect(full, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_CODE_EXTENSIONS.has(ext)) {
            const rel = path.relative(workspacePath, full).replace(/\\/g, '/');
            fileList.push(rel);
            languageCounts[ext] = (languageCounts[ext] || 0) + 1;
          }
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }

  await collect(workspacePath);

  // Parse framework & packages
  const frameworks: string[] = [];
  try {
    const pkgPath = path.join(workspacePath, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.react) frameworks.push('React');
    if (deps.electron) frameworks.push('Electron');
    if (deps.vue) frameworks.push('Vue');
    if (deps.vite) frameworks.push('Vite');
  } catch {
    // No package.json
  }

  // Sample files for symbol and export counts
  const sampleLimit = Math.min(fileList.length, 500);
  for (let i = 0; i < sampleLimit; i++) {
    const rel = fileList[i];
    const full = path.join(workspacePath, rel);
    try {
      const content = await fs.readFile(full, 'utf-8');
      const exportMatches = content.match(/export\s+(const|function|class|interface|type)\s+([A-Za-z0-9_]+)/g);
      if (exportMatches) {
        exportCount += exportMatches.length;
        symbolCount += exportMatches.length;
      }
    } catch {
      // Skip
    }
  }

  const durationMs = Math.max(1, Date.now() - startTime);

  return {
    fileCount: fileList.length,
    symbolCount,
    exportCount,
    durationMs,
    frameworks,
    languages: languageCounts
  };
}

export async function runSearch(
  workspaceRoot: string,
  query: string,
  isRegex = false,
  isCaseSensitive = false,
  maxResults = 500
): Promise<Array<{ filePath: string; relativePath: string; line: number; preview: string }>> {
  const results: Array<{ filePath: string; relativePath: string; line: number; preview: string }> = [];
  let flags = isCaseSensitive ? 'g' : 'gi';
  let pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let reg = new RegExp(pattern, flags);

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/');
          try {
            const content = await fs.readFile(full, 'utf-8');
            if (content.includes('\0')) continue; // Skip binary
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              reg.lastIndex = 0;
              if (reg.test(lines[i])) {
                results.push({
                  filePath: full,
                  relativePath: rel,
                  line: i + 1,
                  preview: lines[i].trim()
                });
                if (results.length >= maxResults) break;
              }
            }
          } catch {
            // Ignore unreadable
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  await walk(workspaceRoot);
  return results;
}

// If invoked as a worker thread:
if (parentPort) {
  parentPort.on('message', async (msg: WorkerMessage) => {
    try {
      if (msg.type === 'ping') {
        parentPort?.postMessage({ id: msg.id, type: 'pong' });
      } else if (msg.type === 'index') {
        const stats = await runIndexing(msg.workspacePath);
        parentPort?.postMessage({ id: msg.id, type: 'index-complete', data: stats });
      } else if (msg.type === 'search') {
        const matches = await runSearch(
          msg.workspaceRoot,
          msg.query,
          msg.isRegex,
          msg.isCaseSensitive,
          msg.maxResults
        );
        parentPort?.postMessage({ id: msg.id, type: 'search-complete', data: matches });
      }
    } catch (err) {
      parentPort?.postMessage({ id: (msg as any).id, type: 'error', error: String(err) });
    }
  });
}
