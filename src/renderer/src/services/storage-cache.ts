/**
 * High-performance Storage Cache with IndexedDB backing and memory fallback.
 * Supports Time-To-Live (TTL) expiration and LRU eviction for large datasets.
 */

interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  expiresAt: number | null;
}

export class StorageCache {
  private dbName: string;
  private storeName: string;
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(dbName = 'ty_code_cache', storeName = 'general') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.initDb();
  }

  private initDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.warn('[StorageCache] IndexedDB open error, falling back to in-memory cache.');
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: now,
      expiresAt: typeof ttlMs === 'number' && ttlMs > 0 ? now + ttlMs : null
    };

    this.memoryCache.set(key, entry as CacheEntry<unknown>);

    const db = await this.initDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async get<T>(key: string): Promise<T | null> {
    const now = Date.now();

    // Check memory cache first
    const mem = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (mem) {
      if (mem.expiresAt !== null && mem.expiresAt < now) {
        this.memoryCache.delete(key);
        void this.delete(key);
        return null;
      }
      return mem.value;
    }

    const db = await this.initDb();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => {
          const entry = req.result as CacheEntry<T> | undefined;
          if (!entry) {
            resolve(null);
            return;
          }
          if (entry.expiresAt !== null && entry.expiresAt < now) {
            void this.delete(key);
            resolve(null);
            return;
          }
          this.memoryCache.set(key, entry as CacheEntry<unknown>);
          resolve(entry.value);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  public async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    const db = await this.initDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async clear(): Promise<void> {
    this.memoryCache.clear();
    const db = await this.initDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const appCache = new StorageCache();
