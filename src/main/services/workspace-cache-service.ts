/**
 * Stage 6b — Shared Workspace Cache Service
 *
 * A single process-wide cache reused by BOTH the Omni-Debugger (workspace
 * profile / DB profiling) and the M3E Canvas (design-system + workspace
 * extraction). Previously each surface re-scanned the workspace on every turn;
 * this singleton memoizes the expensive scans behind a TTL and explicit
 * invalidation wired to the Workspace Session Bus.
 *
 * Invalidation strategy (matches Stage 5b `getVerifiedModels` memo, TTL 30s):
 *  - TTL expiry (caller-supplied, 30s by convention), whichever comes first, OR
 *  - explicit invalidation when the active workspace changes/closes
 *    (`handleWorkspaceChanged`, invoked by the session manager), OR
 *  - a file-watcher event on a monitored path (`handleFileEvent`).
 *
 * Cache keys are `${projectRoot}:${scope}` so a single root owns a namespace
 * that can be invalidated atomically with a `${root}:` prefix pattern.
 */
import path from 'node:path';

export const WORKSPACE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Normalize a root into the canonical prefix used inside cache keys. */
export function normalizeWorkspaceRoot(root: string): string {
  if (!root) return '';
  return path.resolve(root).toLowerCase().replace(/\\/g, '/');
}

/** Build a shared cache key for a workspace root + scope label (e.g. hash). */
export function workspaceCacheKey(root: string, scope: string): string {
  return `${normalizeWorkspaceRoot(root)}:${scope}`;
}

/**
 * Turn a pattern into a key matcher. Supports an optional trailing `*` glob;
 * otherwise the pattern matches the exact key or any key prefixed by it (so a
 * `${root}:` prefix invalidates the whole namespace for that workspace).
 */
function toMatcher(pattern: string): (key: string) => boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return (key) => key.startsWith(prefix);
  }
  return (key) => key === pattern || key.startsWith(`${pattern}:`) || key.startsWith(pattern);
}

type InvalidateListener = (key: string) => void;

export class WorkspaceCacheService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown>>();
  private listeners = new Set<InvalidateListener>();

  /**
   * Return a cached value for `key` when it is still within `ttl`, otherwise
   * compute it (deduplicating concurrent calls onto the same in-flight
   * promise) and store the result.
   */
  async getOrCompute<T>(key: string, ttl: number, computeFn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }
    // Drop an expired entry before checking in-flight so a recompute starts fresh.
    if (hit) this.cache.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      try {
        const value = await computeFn();
        this.cache.set(key, { value, expiresAt: Date.now() + Math.max(0, ttl) });
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise as Promise<T>;
  }

  /** Drop a single key and notify matching subscribers. */
  invalidate(key: string): void {
    if (this.cache.delete(key)) {
      this.notify(key);
    }
  }

  /** Drop every key matching `pattern` (exact, `${root}:` prefix, or `glob*`). */
  invalidateByPattern(pattern: string): void {
    const matcher = toMatcher(pattern);
    for (const key of Array.from(this.cache.keys())) {
      if (matcher(key)) {
        this.cache.delete(key);
        this.notify(key);
      }
    }
  }

  /**
   * Register an invalidation callback for keys matching `pattern`. Returns a
   * disposable that removes the subscription.
   */
  subscribeToInvalidation(pattern: string, callback: () => void): () => void {
    const matcher = toMatcher(pattern);
    const listener: InvalidateListener = (key) => {
      if (matcher(key)) callback();
    };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Workspace Session Bus hook: called when the active workspace changes or
   * closes. Invalidates the entire namespace owned by `root`.
   */
  handleWorkspaceChanged(root: string): void {
    if (!root) return;
    this.invalidateByPattern(`${normalizeWorkspaceRoot(root)}:`);
  }

  /**
   * File-watcher hook: called when a monitored file under `root` changes. Any
   * workspace-derived cache under that root is stale, so drop the namespace.
   */
  handleFileEvent(root: string, _filename?: string): void {
    this.handleWorkspaceChanged(root);
  }

  /** Test/teardown hook: drop all cached values and in-flight work. */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /** Number of live (not necessarily unexpired) entries — for diagnostics/tests. */
  get size(): number {
    return this.cache.size;
  }

  private notify(key: string): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(key);
      } catch {
        // A misbehaving subscriber must never break invalidation for others.
      }
    }
  }
}

/** Process-wide singleton shared by the Debugger and Canvas surfaces. */
export const workspaceCache = new WorkspaceCacheService();
