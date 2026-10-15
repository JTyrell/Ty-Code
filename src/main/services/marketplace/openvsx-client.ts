/**
 * Ty-Code Desktop IDE - Open VSX Marketplace Client
 * Connects to Open VSX registry (https://open-vsx.org) via Electron main process.
 * Implements 10s timeouts, 2x retry with exponential backoff, rate limit handling,
 * disk caching with 24h TTL + ETag revalidation, and offline fallback.
 */

import { MarketplaceCache, marketplaceCache } from './cache';
import { extensionManager } from '../extension-manager';
import type {
  MarketplaceExtensionEntry,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  ExtensionInstallState,
  ExtensionEnabledState
} from '../../../shared/types/marketplace';

const DEFAULT_BASE_URL = 'https://open-vsx.org';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 300;

export interface OpenVsxClientOptions {
  baseUrl?: string;
  cache?: MarketplaceCache;
  userAgent?: string;
}

export class OpenVsxClient {
  private baseUrl: string;
  private cache: MarketplaceCache;
  private userAgent: string;

  // Rate limit state
  private rateLimitedUntil = 0;
  private rateLimitRetryAfterSec = 0;

  constructor(options: OpenVsxClientOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.cache = options.cache || marketplaceCache;
    this.userAgent = options.userAgent || 'Ty-Code-Desktop-IDE';
  }

  /**
   * Checks if client is currently in a rate-limited cooldown.
   */
  isRateLimited(): { rateLimited: boolean; retryAfterSec: number } {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      const remainingSec = Math.max(1, Math.ceil((this.rateLimitedUntil - now) / 1000));
      return { rateLimited: true, retryAfterSec: remainingSec };
    }
    this.rateLimitedUntil = 0;
    this.rateLimitRetryAfterSec = 0;
    return { rateLimited: false, retryAfterSec: 0 };
  }

  /**
   * Resets rate-limit state (useful for tests).
   */
  resetRateLimit(): void {
    this.rateLimitedUntil = 0;
    this.rateLimitRetryAfterSec = 0;
  }

  /**
   * Sets rate limit status manually (used when receiving 429 or in tests).
   */
  setRateLimited(seconds: number): void {
    const sec = Math.max(1, seconds);
    this.rateLimitRetryAfterSec = sec;
    this.rateLimitedUntil = Date.now() + sec * 1000;
  }

  /**
   * Executes an HTTP request with a 10s timeout and up to 2 retries with exponential backoff.
   */
  private async fetchWithRetry(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<{ response?: Response; error?: Error }> {
    const rateStatus = this.isRateLimited();
    if (rateStatus.rateLimited) {
      const err = new Error(`Registry rate limited, retry in ${rateStatus.retryAfterSec}s`);
      (err as unknown as { rateLimited: boolean; retryAfterSec: number }).rateLimited = true;
      (err as unknown as { rateLimited: boolean; retryAfterSec: number }).retryAfterSec = rateStatus.retryAfterSec;
      return { error: err };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(3, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const mergedHeaders: Record<string, string> = {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          ...headers
        };

        const res = await fetch(url, {
          method: 'GET',
          headers: mergedHeaders,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Check for Rate Limit (HTTP 429)
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('Retry-After');
          let waitSec = 30;
          if (retryAfterHeader) {
            const parsedNum = parseInt(retryAfterHeader, 10);
            if (!Number.isNaN(parsedNum) && parsedNum > 0) {
              waitSec = parsedNum;
            } else {
              const parsedDate = Date.parse(retryAfterHeader);
              if (!Number.isNaN(parsedDate)) {
                waitSec = Math.max(1, Math.ceil((parsedDate - Date.now()) / 1000));
              }
            }
          }
          this.setRateLimited(waitSec);
          const rateErr = new Error(`Registry rate limited, retry in ${waitSec}s`);
          (rateErr as unknown as { rateLimited: boolean; retryAfterSec: number }).rateLimited = true;
          (rateErr as unknown as { rateLimited: boolean; retryAfterSec: number }).retryAfterSec = waitSec;
          return { error: rateErr };
        }

        // Return immediately if status is OK, Not Modified, or non-retryable 4xx
        if (res.ok || res.status === 304 || (res.status >= 400 && res.status < 500 && res.status !== 408)) {
          return { response: res };
        }

        // 5xx Server Error or 408 Request Timeout -> retry
        lastError = new Error(`Registry responded with HTTP ${res.status}`);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return { error: lastError || new Error('Network request failed after retries') };
  }

  /**
   * Maps raw Open VSX extension item to UI Data Contract.
   */
  private mapToEntry(raw: Record<string, unknown>, installedMap: Map<string, { enabled: boolean }>): MarketplaceExtensionEntry {
    const namespace = String(raw.namespace || raw.publisher || '');
    const name = String(raw.name || '');
    const id = `${namespace}.${name}`;
    const version = String(raw.version || '0.0.0');
    const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName
      : name || id;
    const shortDescription = typeof raw.description === 'string'
      ? raw.description.slice(0, 500)
      : '';
    const downloadCount = typeof raw.downloadCount === 'number' && Number.isFinite(raw.downloadCount)
      ? Math.max(0, raw.downloadCount)
      : 0;
    const publisher = String(raw.publisher || namespace);

    // Extract files object
    const files = raw.files && typeof raw.files === 'object' ? (raw.files as Record<string, unknown>) : {};
    const iconUrl = typeof files.icon === 'string' ? files.icon : undefined;
    const downloadUrl = typeof files.download === 'string' ? files.download : undefined;
    const readmeUrl = typeof files.readme === 'string' ? files.readme : undefined;
    const sha256 = typeof files.sha256 === 'string' ? files.sha256 : undefined;

    // Installed & Enabled state from local registry
    const installed = installedMap.get(id);
    const installedState: ExtensionInstallState = installed ? 'installed' : 'uninstalled';
    const enabledState: ExtensionEnabledState = installed ? (installed.enabled ? 'enabled' : 'disabled') : 'disabled';

    const categories = Array.isArray(raw.categories)
      ? raw.categories.filter((cat): cat is string => typeof cat === 'string')
      : ['Tools'];

    const rating = typeof raw.averageRating === 'number' && Number.isFinite(raw.averageRating)
      ? Math.round(raw.averageRating * 10) / 10
      : undefined;

    return {
      id,
      namespace,
      displayName,
      shortDescription,
      version,
      downloadCount,
      publisher,
      iconUrl,
      installedState,
      enabledState,
      downloadUrl,
      sha256,
      rating,
      categories,
      readmeUrl,
      repository: typeof raw.repository === 'string' ? raw.repository : undefined,
      publishedDate: typeof raw.timestamp === 'string' ? raw.timestamp : undefined
    };
  }

  /**
   * Builds an installed extensions lookup map.
   */
  private async getInstalledExtensionsMap(): Promise<Map<string, { enabled: boolean }>> {
    const map = new Map<string, { enabled: boolean }>();
    try {
      await extensionManager.init();
      const installed = extensionManager.getInstalledExtensions();
      for (const item of installed) {
        map.set(item.id, { enabled: item.enabled });
      }
    } catch {
      // Fallback empty if extension manager is unavailable in test harness
    }
    return map;
  }

  /**
   * Search Open VSX Registry:
   * GET /api/-/search?query={q}&size={n}&sortBy=relevance&sortOrder=desc
   */
  async search(options: MarketplaceSearchOptions = {}): Promise<MarketplaceSearchResult> {
    const q = options.query?.trim() || '';
    const size = Math.max(1, Math.min(100, options.size || 25));
    const sortBy = options.sortBy || 'relevance';
    const sortOrder = options.sortOrder || 'desc';
    const forceRefresh = options.forceRefresh || false;

    const cacheKey = `search:${q.toLowerCase()}:${size}:${sortBy}:${sortOrder}`;
    const url = `${this.baseUrl}/api/-/search?query=${encodeURIComponent(q)}&size=${size}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

    // 1. Check disk cache
    const cacheResult = await this.cache.get<{ extensions: Record<string, unknown>[]; totalSize: number }>(cacheKey);
    const hasCachedEntry = Boolean(cacheResult.entry);

    // Fast-path: if valid cache hit and no forceRefresh, return within milliseconds
    if (hasCachedEntry && !cacheResult.isExpired && !forceRefresh) {
      const installedMap = await this.getInstalledExtensionsMap();
      const mapped = cacheResult.entry!.data.extensions.map((ext) => this.mapToEntry(ext, installedMap));
      return {
        extensions: mapped,
        totalSize: cacheResult.entry!.data.totalSize || mapped.length,
        isOfflineCache: false
      };
    }

    // 2. Prepare headers with ETag if cached
    const headers: Record<string, string> = {};
    if (hasCachedEntry && cacheResult.entry?.etag) {
      headers['If-None-Match'] = cacheResult.entry.etag;
    }

    // 3. Perform network fetch
    const { response, error } = await this.fetchWithRetry(url, headers);

    // If rate limited
    if (error && (error as unknown as { rateLimited?: boolean }).rateLimited) {
      const retrySec = (error as unknown as { retryAfterSec?: number }).retryAfterSec || 30;
      if (hasCachedEntry) {
        const installedMap = await this.getInstalledExtensionsMap();
        const mapped = cacheResult.entry!.data.extensions.map((ext) => this.mapToEntry(ext, installedMap));
        return {
          extensions: mapped,
          totalSize: cacheResult.entry!.data.totalSize || mapped.length,
          isOfflineCache: true,
          offlineMessage: `Registry rate limited, retry in ${retrySec}s`,
          rateLimited: true,
          retryAfterSec: retrySec
        };
      }
      return {
        extensions: [],
        totalSize: 0,
        isOfflineCache: false,
        rateLimited: true,
        retryAfterSec: retrySec,
        offlineMessage: `Registry rate limited, retry in ${retrySec}s`
      };
    }

    // If network error (offline, DNS, timeout, etc.)
    if (error || !response) {
      if (hasCachedEntry) {
        const installedMap = await this.getInstalledExtensionsMap();
        const mapped = cacheResult.entry!.data.extensions.map((ext) => this.mapToEntry(ext, installedMap));
        return {
          extensions: mapped,
          totalSize: cacheResult.entry!.data.totalSize || mapped.length,
          isOfflineCache: true,
          offlineMessage: 'offline — cached results'
        };
      }
      throw new Error(error?.message || 'Network unavailable. Check your internet connection and retry.');
    }

    // 4. HTTP 304 Not Modified
    if (response.status === 304 && hasCachedEntry) {
      const newEtag = response.headers.get('etag') || cacheResult.entry!.etag;
      await this.cache.touch(cacheKey, newEtag || undefined);
      const installedMap = await this.getInstalledExtensionsMap();
      const mapped = cacheResult.entry!.data.extensions.map((ext) => this.mapToEntry(ext, installedMap));
      return {
        extensions: mapped,
        totalSize: cacheResult.entry!.data.totalSize || mapped.length,
        isOfflineCache: false
      };
    }

    // 5. HTTP 200 OK
    if (response.ok) {
      const data = (await response.json()) as { extensions?: Record<string, unknown>[]; totalSize?: number };
      const rawList = Array.isArray(data.extensions) ? data.extensions : [];
      const totalSize = typeof data.totalSize === 'number' ? data.totalSize : rawList.length;
      const etag = response.headers.get('etag') || undefined;

      // Save to disk cache
      await this.cache.set(cacheKey, { extensions: rawList, totalSize }, etag);

      const installedMap = await this.getInstalledExtensionsMap();
      const mapped = rawList.map((ext) => this.mapToEntry(ext, installedMap));
      return {
        extensions: mapped,
        totalSize,
        isOfflineCache: false
      };
    }

    // Other error statuses
    if (hasCachedEntry) {
      const installedMap = await this.getInstalledExtensionsMap();
      const mapped = cacheResult.entry!.data.extensions.map((ext) => this.mapToEntry(ext, installedMap));
      return {
        extensions: mapped,
        totalSize: cacheResult.entry!.data.totalSize || mapped.length,
        isOfflineCache: true,
        offlineMessage: 'offline — cached results'
      };
    }

    throw new Error(`Registry responded with HTTP ${response.status}`);
  }

  /**
   * Get Extension Metadata:
   * GET /api/{namespace}/{extension}
   */
  async getMetadata(namespace: string, extension: string, forceRefresh = false): Promise<MarketplaceExtensionEntry | null> {
    const cleanNs = namespace.trim();
    const cleanExt = extension.trim();
    if (!cleanNs || !cleanExt) throw new Error('Namespace and extension name must not be empty.');

    const cacheKey = `metadata:${cleanNs.toLowerCase()}:${cleanExt.toLowerCase()}`;
    const url = `${this.baseUrl}/api/${encodeURIComponent(cleanNs)}/${encodeURIComponent(cleanExt)}`;

    // 1. Check disk cache
    const cacheResult = await this.cache.get<Record<string, unknown>>(cacheKey);
    const hasCachedEntry = Boolean(cacheResult.entry);

    if (hasCachedEntry && !cacheResult.isExpired && !forceRefresh) {
      const installedMap = await this.getInstalledExtensionsMap();
      return this.mapToEntry(cacheResult.entry!.data, installedMap);
    }

    // 2. Prepare headers
    const headers: Record<string, string> = {};
    if (hasCachedEntry && cacheResult.entry?.etag) {
      headers['If-None-Match'] = cacheResult.entry.etag;
    }

    // 3. Fetch
    const { response, error } = await this.fetchWithRetry(url, headers);

    if (error || !response) {
      if (hasCachedEntry) {
        const installedMap = await this.getInstalledExtensionsMap();
        return this.mapToEntry(cacheResult.entry!.data, installedMap);
      }
      throw new Error(error?.message || 'Failed to fetch extension metadata');
    }

    if (response.status === 304 && hasCachedEntry) {
      const newEtag = response.headers.get('etag') || cacheResult.entry!.etag;
      await this.cache.touch(cacheKey, newEtag || undefined);
      const installedMap = await this.getInstalledExtensionsMap();
      return this.mapToEntry(cacheResult.entry!.data, installedMap);
    }

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const etag = response.headers.get('etag') || undefined;
      await this.cache.set(cacheKey, data, etag);
      const installedMap = await this.getInstalledExtensionsMap();
      return this.mapToEntry(data, installedMap);
    }

    if (response.status === 404) {
      return null;
    }

    if (hasCachedEntry) {
      const installedMap = await this.getInstalledExtensionsMap();
      return this.mapToEntry(cacheResult.entry!.data, installedMap);
    }

    throw new Error(`Failed to load extension metadata: HTTP ${response.status}`);
  }
}

export const openVsxClient = new OpenVsxClient();
