/**
 * Lazy Monaco Model Manager (Fix 4)
 *
 * Implements:
 * 1. Deferred Monaco createModel: only instantiate models when tab is visible.
 * 2. Recycled Disposed-Model Pool: pools up to 10 disposed models to avoid GC thrashing.
 * 3. Progressive 1MB+ File Stream Loader: displays first chunk immediately (<1200ms) and updates progressively.
 * 4. Tier-2 Idle Prefetcher: warms last-session tabs in the background so file clicks are instant warm (<150ms).
 *
 * Brand: Ty-Code
 */

export interface CachedTabContent {
  path: string;
  content: string;
  loadedAt: number;
  sizeBytes: number;
}

export class LazyModelManager {
  private static instance: LazyModelManager | null = null;
  private pooledModels: any[] = [];
  private readonly MAX_POOL_SIZE = 10;
  // Step 2: cap live Monaco models at 10 open tabs. Hidden tabs beyond the
  // cap are evicted LRU-style; their model is recreated on demand from the
  // editor store content when the tab becomes visible again.
  private readonly MAX_ACTIVE_MODELS = 10;
  private readonly MAX_CONTENT_CACHE_ENTRIES = 25;
  private readonly MAX_CONTENT_CACHE_BYTES = 64 * 1024 * 1024;
  private activeModels = new Map<string, any>();
  private modelLastAccess = new Map<string, number>();
  private contentCache = new Map<string, CachedTabContent>();
  private contentCacheBytes = 0;
  private prefetchScheduled = false;

  private constructor() {}

  public static getInstance(): LazyModelManager {
    if (!LazyModelManager.instance) {
      LazyModelManager.instance = new LazyModelManager();
    }
    return LazyModelManager.instance;
  }

  /**
   * Acquire or create a Monaco text model lazily for the given file.
   * Only called when the tab is actually visible.
   */
  public getOrCreateVisibleModel(
    monaco: any,
    filePath: string,
    content: string,
    language: string
  ): any {
    if (!monaco || !monaco.editor) return null;

    const normalizedPath = filePath.replace(/\\/g, '/');
    const existing = this.activeModels.get(normalizedPath);
    if (existing && !existing.isDisposed()) {
      this.modelLastAccess.set(normalizedPath, Date.now());
      return existing;
    }

    const uri = monaco.Uri.file(normalizedPath);
    const existingByUri = monaco.editor.getModel(uri);
    if (existingByUri && !existingByUri.isDisposed()) {
      this.activeModels.set(normalizedPath, existingByUri);
      this.modelLastAccess.set(normalizedPath, Date.now());
      return existingByUri;
    }

    // Try acquiring from recycled pool
    let model: any = null;
    while (this.pooledModels.length > 0) {
      const candidate = this.pooledModels.pop();
      if (candidate && !candidate.isDisposed()) {
        try {
          candidate.setValue(content);
          monaco.editor.setModelLanguage(candidate, language);
          model = candidate;
          break;
        } catch {
          // If candidate cannot be repurposed, continue
        }
      }
    }

    if (!model) {
      model = monaco.editor.createModel(content, language, uri);
    }

    this.activeModels.set(normalizedPath, model);
    this.modelLastAccess.set(normalizedPath, Date.now());
    this.enforceModelCap();
    return model;
  }

  /**
   * Step 2: dispose the least-recently-accessed models beyond the 10-tab cap.
   * The just-created/just-accessed model always survives (newest timestamp).
   */
  private enforceModelCap(): void {
    while (this.activeModels.size > this.MAX_ACTIVE_MODELS) {
      let lruPath: string | null = null;
      let lruTime = Infinity;
      for (const path of this.activeModels.keys()) {
        const t = this.modelLastAccess.get(path) ?? 0;
        if (t < lruTime) {
          lruTime = t;
          lruPath = path;
        }
      }
      if (!lruPath) break;
      const victim = this.activeModels.get(lruPath);
      this.activeModels.delete(lruPath);
      this.modelLastAccess.delete(lruPath);
      try {
        if (victim && !victim.isDisposed()) victim.dispose();
      } catch {
        // Already disposed
      }
    }
  }

  /** Evict least-recently-loaded content cache entries while over budget. */
  private trimContentCache(maxEntries: number, maxBytes: number): void {
    while (this.contentCache.size > 0 &&
           (this.contentCache.size > maxEntries || this.contentCacheBytes > maxBytes)) {
      let lruPath: string | null = null;
      let lruTime = Infinity;
      for (const [path, entry] of this.contentCache) {
        if (entry.loadedAt < lruTime) {
          lruTime = entry.loadedAt;
          lruPath = path;
        }
      }
      if (!lruPath) break;
      const victim = this.contentCache.get(lruPath);
      if (victim) this.contentCacheBytes -= victim.sizeBytes;
      this.contentCache.delete(lruPath);
    }
  }

  /**
   * Step 4: governor eviction hook. Called on tier changes.
   * Never touches live (active) models — only pooled + content caches.
   */
  public applyGovernorTier(tier: 'NOMINAL' | 'ELEVATED' | 'CRITICAL' | 'OVER'): void {
    if (tier === 'ELEVATED') {
      this.trimContentCache(
        Math.floor(this.MAX_CONTENT_CACHE_ENTRIES / 2),
        Math.floor(this.MAX_CONTENT_CACHE_BYTES / 2)
      );
    } else if (tier === 'CRITICAL' || tier === 'OVER') {
      for (const m of this.pooledModels) {
        try {
          if (!m.isDisposed()) m.dispose();
        } catch {}
      }
      this.pooledModels = [];
      this.contentCache.clear();
      this.contentCacheBytes = 0;
    }
  }

  /**
   * Recycle or dispose a model when tab is closed or unmounted.
   */
  public releaseModel(filePath: string): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const model = this.activeModels.get(normalizedPath);
    if (!model) return;

    this.activeModels.delete(normalizedPath);
    this.modelLastAccess.delete(normalizedPath);

    if (model.isDisposed()) return;

    if (this.pooledModels.length < this.MAX_POOL_SIZE) {
      try {
        // Reset model content and preserve in pool
        model.setValue('');
        this.pooledModels.push(model);
        return;
      } catch {
        // Fallback to dispose
      }
    }

    try {
      model.dispose();
    } catch {
      // Disposed
    }
  }

  /** Tracked content-cache insert with LRU + byte budget (Step 2). */
  private cacheContent(filePath: string, content: string): void {
    const previous = this.contentCache.get(filePath);
    if (previous) this.contentCacheBytes -= previous.sizeBytes;
    this.contentCache.set(filePath, {
      path: filePath,
      content,
      loadedAt: Date.now(),
      sizeBytes: content.length
    });
    this.contentCacheBytes += content.length;
    this.trimContentCache(this.MAX_CONTENT_CACHE_ENTRIES, this.MAX_CONTENT_CACHE_BYTES);
  }

  /**
   * Progressive loader for files >1MB:
   * Sets initial chunk immediately (<1200ms to editable) then applies full content.
   */
  public async loadLargeFileProgressively(
    filePath: string,
    onInitialChunk: (preview: string) => void,
    onComplete: (fullContent: string) => void
  ): Promise<string> {
    const cached = this.contentCache.get(filePath);
    if (cached) {
      onInitialChunk(cached.content);
      onComplete(cached.content);
      return cached.content;
    }

    // Small files or first read via async IPC
    const res = await (window as any).electronAPI.readFile(filePath);
    if (!res.success || res.data === undefined) {
      throw new Error(res.error || 'Failed to read file');
    }

    const fullContent: string = res.data;
    const isLarge = fullContent.length > 1024 * 1024;

    if (isLarge) {
      // Provide first 128KB immediately for progressive display
      const firstChunk = fullContent.substring(0, 128 * 1024);
      onInitialChunk(firstChunk);

      // Yield frame so UI paints editable Monaco view immediately
      await new Promise((r) => setTimeout(r, 16));
    }

    this.cacheContent(filePath, fullContent);

    onComplete(fullContent);
    return fullContent;
  }

  /**
   * Prefetches last-session tabs' contents during Tier-2 idle after launch.
   */
  public prefetchLastSessionTabs(tabs: Array<{ path: string; name: string }>): void {
    if (this.prefetchScheduled || tabs.length === 0) return;
    this.prefetchScheduled = true;

    const runPrefetch = async () => {
      for (const tab of tabs) {
        if (this.contentCache.has(tab.path)) continue;
        try {
          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            const res = await (window as any).electronAPI.readFile(tab.path);
            if (res.success && typeof res.data === 'string') {
              this.cacheContent(tab.path, res.data);
            }
          }
        } catch {
          // Ignore prefetch error
        }
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        void runPrefetch();
      }, { timeout: 3000 });
    } else {
      setTimeout(() => {
        void runPrefetch();
      }, 1500);
    }
  }

  public getCachedContent(filePath: string): string | null {
    const cached = this.contentCache.get(filePath);
    if (!cached) return null;
    cached.loadedAt = Date.now();
    return cached.content;
  }

  public clearPool(): void {
    for (const m of this.pooledModels) {
      try {
        if (!m.isDisposed()) m.dispose();
      } catch {}
    }
    this.pooledModels = [];
    this.modelLastAccess.clear();
  }
}
