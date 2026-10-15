/**
 * Ty-Code Desktop IDE - Marketplace Disk Cache
 * Provides 24-hour TTL disk caching with ETag revalidation and offline fallback support.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface CacheEntry<T = unknown> {
  key: string;
  etag?: string;
  data: T;
  timestamp: number;
  ttlMs: number;
}

export interface CacheLookupResult<T = unknown> {
  entry: CacheEntry<T> | null;
  isExpired: boolean;
  isMissing: boolean;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getElectronUserData(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Pure node test environment
  }
  return undefined;
}

export class MarketplaceCache {
  private cacheDir: string;
  private initialized = false;

  constructor(customCacheDir?: string) {
    if (customCacheDir) {
      this.cacheDir = customCacheDir;
    } else {
      const base = getElectronUserData() || os.homedir();
      this.cacheDir = path.join(base, '.ty-code', 'cache', 'marketplace');
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      this.initialized = true;
    } catch (err) {
      console.warn('[MarketplaceCache] Failed to initialize directory:', err);
    }
  }

  /**
   * Generates a deterministic, filesystem-safe filename for a cache key.
   */
  private getFilePathForKey(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const sanitizedPrefix = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    return path.join(this.cacheDir, `${sanitizedPrefix}_${hash}.json`);
  }

  /**
   * Retrieves an entry from disk.
   */
  async get<T = unknown>(key: string): Promise<CacheLookupResult<T>> {
    await this.ensureInitialized();
    const filePath = this.getFilePathForKey(key);

    if (!existsSync(filePath)) {
      return { entry: null, isExpired: true, isMissing: true };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry<T>;

      if (!entry || typeof entry !== 'object' || !('timestamp' in entry) || !('data' in entry)) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        return { entry: null, isExpired: true, isMissing: true };
      }

      const age = Date.now() - entry.timestamp;
      const ttl = typeof entry.ttlMs === 'number' ? entry.ttlMs : DEFAULT_TTL_MS;
      const isExpired = age > ttl;

      return {
        entry,
        isExpired,
        isMissing: false
      };
    } catch {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      return { entry: null, isExpired: true, isMissing: true };
    }
  }

  /**
   * Writes an entry to disk using atomic rename.
   */
  async set<T = unknown>(key: string, data: T, etag?: string, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
    await this.ensureInitialized();
    const filePath = this.getFilePathForKey(key);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    const entry: CacheEntry<T> = {
      key,
      etag: etag?.trim() || undefined,
      data,
      timestamp: Date.now(),
      ttlMs
    };

    try {
      await fs.writeFile(tempPath, JSON.stringify(entry, null, 2), 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (err) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      console.warn('[MarketplaceCache] Failed to write cache entry:', err);
    }
  }

  /**
   * Touches an existing cache entry to reset its TTL timestamp (e.g., upon HTTP 304 Not Modified).
   */
  async touch(key: string, newEtag?: string): Promise<void> {
    await this.ensureInitialized();
    const { entry } = await this.get(key);
    if (!entry) return;

    entry.timestamp = Date.now();
    if (newEtag) {
      entry.etag = newEtag.trim();
    }
    await this.set(key, entry.data, entry.etag, entry.ttlMs);
  }

  /**
   * Deletes a specific cache entry.
   */
  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const filePath = this.getFilePathForKey(key);
    try {
      if (existsSync(filePath)) {
        await fs.rm(filePath, { force: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clears all cache files in the cache directory.
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map((file) => fs.rm(path.join(this.cacheDir, file), { recursive: true, force: true }))
      );
    } catch (err) {
      console.warn('[MarketplaceCache] Failed to clear cache directory:', err);
    }
  }

  getCacheDir(): string {
    return this.cacheDir;
  }
}

export const marketplaceCache = new MarketplaceCache();
