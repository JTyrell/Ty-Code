/**
 * Brave Browser Automation Engine (Guest Mode Core)
 *
 * Provides the main process singleton API for privacy-first, isolated browser automation.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. STRICT GUEST ISOLATION: Runs Brave with an ephemeral user profile directory
 *    (--user-data-dir=${ephemeralProfilePath}). Zero access to personal bookmarks,
 *    cookies, logins, or history.
 * 2. MAIN EVENT LOOP PROTECTION: All Playwright operations are executed inside a
 *    dedicated Node.js Worker Thread. The Electron UI and Main thread are never blocked.
 * 3. CRASH SAFETY: All temporary guest directories are automatically wiped on
 *    session termination, process exit, or Electron 'before-quit'.
 *
 * Brand: Ty-Code
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type {
  SearchResultItem,
  SearchJobResult,
  NavigationJobResult,
  ContentJobResult,
  WorkerJobRequest
} from './brave-worker';
import { executeSearch, executeNavigate, executeGetContent, executeClose } from './brave-worker';

export * from './ephemeral-profile';
export * from './brave-automation';
export type { SearchResultItem, SearchJobResult, NavigationJobResult, ContentJobResult };

interface PendingJob<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Resolves the absolute path to the compiled Brave worker file.
 */
function resolveBraveWorkerFile(): string | null {
  const candidates = [
    path.join(__dirname, 'workers', 'brave-worker.js'),
    path.join(__dirname, 'brave-worker.js'),
    path.join(process.cwd(), 'dist', 'main', 'workers', 'brave-worker.js')
  ];

  for (const candidate of candidates) {
    const unpacked = candidate.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export class BraveEngine {
  private static instance: BraveEngine | null = null;
  private worker: Worker | null = null;
  private pendingJobs = new Map<string, PendingJob<any>>();
  private jobTimeoutMs = 60000;
  private isShuttingDown = false;

  private constructor() {
    this.registerAppHooks();
  }

  /**
   * Returns the singleton instance of the BraveEngine.
   */
  public static getInstance(): BraveEngine {
    if (!BraveEngine.instance) {
      BraveEngine.instance = new BraveEngine();
    }
    return BraveEngine.instance;
  }

  /**
   * Registers process and Electron app hooks to guarantee cleanup on shutdown.
   */
  private registerAppHooks(): void {
    const cleanup = () => {
      void this.close();
    };

    process.on('exit', cleanup);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app } = require('electron');
      if (app && typeof app.on === 'function') {
        app.on('before-quit', cleanup);
      }
    } catch {
      // Outside Electron main process
    }
  }

  /**
   * Initializes or returns the dedicated background Worker Thread.
   */
  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.isShuttingDown) return null;

    const workerFile = resolveBraveWorkerFile();
    if (!workerFile) {
      // Worker file not compiled yet (e.g. in test or dev fallback mode)
      return null;
    }

    try {
      this.worker = new Worker(workerFile);

      this.worker.on('message', (response: { id: string; success: boolean; data?: any; error?: string }) => {
        if (!response || !response.id) return;
        const pending = this.pendingJobs.get(response.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pendingJobs.delete(response.id);

        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error || 'Brave worker execution failed'));
        }
      });

      this.worker.on('error', (err) => {
        console.warn('[BraveEngine] Worker thread reported error:', err.message);
        this.failAllPendingJobs(new Error(`Brave worker error: ${err.message}`));
        this.worker = null;
      });

      this.worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.warn(`[BraveEngine] Worker thread exited with code ${code}`);
        }
        this.failAllPendingJobs(new Error(`Brave worker exited with code ${code}`));
        this.worker = null;
      });

      return this.worker;
    } catch (err) {
      console.warn('[BraveEngine] Failed to spawn worker thread:', err);
      this.worker = null;
      return null;
    }
  }

  /**
   * Dispatches a job to the worker thread, or falls back to async execution if worker script is unbundled.
   */
  private async dispatchJob<T>(type: WorkerJobRequest['type'], payload?: any): Promise<T> {
    const worker = this.ensureWorker();

    // 1. Worker thread execution (Default for production & bundled dev)
    if (worker) {
      return new Promise<T>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          this.pendingJobs.delete(id);
          reject(new Error(`Brave operation '${type}' timed out after ${this.jobTimeoutMs}ms`));
        }, this.jobTimeoutMs);

        this.pendingJobs.set(id, { resolve, reject, timer });

        worker.postMessage({ id, type, payload });
      });
    }

    // 2. Direct async execution fallback (for direct test runners or pre-build dev)
    switch (type) {
      case 'search':
        return (await executeSearch(payload?.query || '')) as unknown as T;
      case 'navigate':
        return (await executeNavigate(payload?.url || '')) as unknown as T;
      case 'get_content':
        return (await executeGetContent()) as unknown as T;
      case 'close':
        return (await executeClose()) as unknown as T;
      default:
        throw new Error(`Unsupported job type: ${type}`);
    }
  }

  private failAllPendingJobs(error: Error): void {
    for (const [id, job] of this.pendingJobs.entries()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pendingJobs.clear();
  }

  /**
   * Performs an isolated web search inside Brave Guest Mode.
   *
   * @param query Search keywords or phrase.
   * @returns Structured search results and page text.
   */
  public async searchWeb(query: string): Promise<SearchJobResult> {
    return this.dispatchJob<SearchJobResult>('search', { query });
  }

  /**
   * Navigates the guest browser to a specific testing URL (e.g., local dev server).
   *
   * @param url Target URL to load.
   * @returns Navigation status, final URL, and title.
   */
  public async navigateToTestingUrl(url: string): Promise<NavigationJobResult> {
    return this.dispatchJob<NavigationJobResult>('navigate', { url });
  }

  /**
   * Retrieves the readable text content and DOM of the active page.
   *
   * @returns String content of the page (convenient for LLM context injection).
   */
  public async getPageContent(): Promise<string> {
    const result = await this.dispatchJob<ContentJobResult>('get_content');
    return result.text || result.content;
  }

  /**
   * Retrieves full content details including URL, title, inner text, and raw HTML.
   */
  public async getFullPageContent(): Promise<ContentJobResult> {
    return this.dispatchJob<ContentJobResult>('get_content');
  }

  /**
   * Gracefully closes the active Brave session and tears down the worker thread.
   */
  public async close(): Promise<void> {
    this.isShuttingDown = true;
    try {
      if (this.worker) {
        await this.dispatchJob('close');
        await this.worker.terminate();
        this.worker = null;
      } else {
        await executeClose();
      }
    } catch {
      // Ignore errors on shutdown
    } finally {
      this.isShuttingDown = false;
    }
  }
}

export const braveEngine = BraveEngine.getInstance();
