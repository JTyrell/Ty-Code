/**
 * Worker-Thread Indexer Service (Fix 4)
 *
 * Coordinates project indexing, candidate scanning, and fast regex searching
 * in a dedicated Node.js worker_thread.
 *
 * Ensures the main Electron process never blocks >16ms during workspace opens
 * or full-text codebase scans. Includes non-blocking chunked async fallback.
 *
 * Brand: Ty-Code
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fsSync from 'node:fs';
import { runIndexing, runSearch } from './indexer-worker';

export interface IndexStats {
  fileCount: number;
  symbolCount: number;
  exportCount: number;
  durationMs: number;
  frameworks: string[];
  languages: Record<string, number>;
  lastIndexedAt?: number;
}

export interface SearchMatchItem {
  filePath: string;
  relativePath: string;
  line: number;
  preview: string;
}

export class WorkerIndexerService {
  private static instance: WorkerIndexerService | null = null;
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }
  >();
  private requestCounter = 0;
  private cachedStats: IndexStats | null = null;
  private isProcessing = false;

  private constructor() {
    this.initWorker();
  }

  public static getInstance(): WorkerIndexerService {
    if (!WorkerIndexerService.instance) {
      WorkerIndexerService.instance = new WorkerIndexerService();
    }
    return WorkerIndexerService.instance;
  }

  private initWorker(): void {
    try {
      // Find worker script location (.js or .ts)
      const jsWorker = path.join(__dirname, 'indexer-worker.js');
      const tsWorker = path.join(__dirname, 'indexer-worker.ts');
      const workerScript = fsSync.existsSync(jsWorker)
        ? jsWorker
        : fsSync.existsSync(tsWorker)
          ? tsWorker
          : null;

      if (!workerScript) {
        // Fallback to async in-process execution
        return;
      }

      this.worker = new Worker(workerScript, {
        execArgv: workerScript.endsWith('.ts') ? ['--loader', 'ts-node/esm'] : []
      });

      this.worker.on('message', (msg: any) => {
        if (!msg || !msg.id) return;
        const pending = this.pendingRequests.get(msg.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);

        if (msg.type === 'error') {
          pending.reject(new Error(msg.error || 'Worker error'));
        } else {
          pending.resolve(msg.data);
        }
      });

      this.worker.on('error', (err) => {
        console.warn('[WorkerIndexerService] Worker thread reported error:', err);
        this.cleanupPending(err);
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(`[WorkerIndexerService] Worker thread exited with code ${code}`);
        }
        this.worker = null;
      });
    } catch (err) {
      console.warn('[WorkerIndexerService] Could not instantiate Worker thread, falling back to chunked async:', err);
      this.worker = null;
    }
  }

  private cleanupPending(err: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timeout);
      req.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Triggers an indexing pass for the given workspace path.
   */
  public async indexWorkspace(workspacePath: string): Promise<IndexStats> {
    if (!workspacePath) {
      return {
        fileCount: 0,
        symbolCount: 0,
        exportCount: 0,
        durationMs: 0,
        frameworks: [],
        languages: {},
        lastIndexedAt: Date.now()
      };
    }

    this.isProcessing = true;
    const reqId = `idx_${++this.requestCounter}_${Date.now()}`;

    try {
      if (this.worker) {
        const stats = await new Promise<IndexStats>((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.pendingRequests.delete(reqId);
            // Fallback to async in-process if worker hangs
            runIndexing(workspacePath).then(resolve).catch(reject);
          }, 10000);

          this.pendingRequests.set(reqId, { resolve, reject, timeout });
          this.worker!.postMessage({ id: reqId, type: 'index', workspacePath });
        });

        this.cachedStats = { ...stats, lastIndexedAt: Date.now() };
        return this.cachedStats;
      } else {
        // Fallback: in-process async execution
        const stats = await runIndexing(workspacePath);
        this.cachedStats = { ...stats, lastIndexedAt: Date.now() };
        return this.cachedStats;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Runs regex / ripgrep search in worker thread.
   */
  public async searchWorkspace(
    workspaceRoot: string,
    query: string,
    options: {
      isRegex?: boolean;
      isCaseSensitive?: boolean;
      matchWholeWord?: boolean;
      maxResults?: number;
    } = {}
  ): Promise<SearchMatchItem[]> {
    if (!workspaceRoot || !query) return [];

    const reqId = `srch_${++this.requestCounter}_${Date.now()}`;

    if (this.worker) {
      return new Promise<SearchMatchItem[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(reqId);
          runSearch(
            workspaceRoot,
            query,
            options.isRegex,
            options.isCaseSensitive,
            options.maxResults || 500
          )
            .then(resolve)
            .catch(reject);
        }, 10000);

        this.pendingRequests.set(reqId, { resolve, reject, timeout });
        this.worker!.postMessage({
          id: reqId,
          type: 'search',
          workspaceRoot,
          query,
          isRegex: options.isRegex,
          isCaseSensitive: options.isCaseSensitive,
          maxResults: options.maxResults || 500
        });
      });
    }

    return runSearch(
      workspaceRoot,
      query,
      options.isRegex,
      options.isCaseSensitive,
      options.maxResults || 500
    );
  }

  public getStats(): IndexStats | null {
    return this.cachedStats;
  }

  public isBusy(): boolean {
    return this.isProcessing;
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.cleanupPending(new Error('WorkerIndexerService terminated'));
  }
}
