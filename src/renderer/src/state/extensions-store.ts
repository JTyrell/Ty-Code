/**
 * Ty-Code Desktop IDE - Extensions & Marketplace Zustand Store
 * Manages marketplace search, disk-cached entries, rate limits, install pipeline states,
 * and enabled/disabled toggles.
 */

import { create } from 'zustand';
import type { InstalledExtension, ExtensionMetadata, ExtensionCommand } from '../../../preload/types';
import type {
  MarketplaceExtensionEntry,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  InstallStep,
  ExtensionInstallState,
  ExtensionEnabledState
} from '../../../shared/types/marketplace';
import { extensionHost } from '../services/extension-host';

let marketplaceRequestVersion = 0;

export interface ExtensionStoreState {
  // Collections
  installed: InstalledExtension[];
  marketplace: MarketplaceExtensionEntry[];
  activeDetail: InstalledExtension | MarketplaceExtensionEntry | ExtensionMetadata | null;
  activeSettings: InstalledExtension | null;

  // Loading & View States
  isLoading: boolean;
  isMarketplaceLoading: boolean;
  isOfflineCache: boolean;
  offlineMessage: string | null;
  rateLimited: boolean;
  retryAfterSec: number;
  activeTab: 'installed' | 'marketplace';
  selectedCategory: string;
  query: string;
  sortBy: 'relevance' | 'downloadCount' | 'rating';
  error: string | null;

  // Pipeline tracking
  installingMap: Record<string, { step: InstallStep; percent?: number; message?: string }>;
  errorMap: Record<string, { message: string; step?: InstallStep; canRetry: boolean }>;

  // Actions
  setActiveTab: (tab: 'installed' | 'marketplace') => void;
  setSelectedCategory: (cat: string) => void;
  setQuery: (q: string) => void;
  setSortBy: (sort: 'relevance' | 'downloadCount' | 'rating') => void;
  setActiveDetail: (item: InstalledExtension | MarketplaceExtensionEntry | ExtensionMetadata | null) => void;
  setActiveSettings: (item: InstalledExtension | null) => void;
  loadInstalled: () => Promise<void>;
  searchMarketplace: (query?: string, forceRefresh?: boolean) => Promise<void>;
  cancelMarketplaceSearch: () => void;
  installExtension: (item: MarketplaceExtensionEntry | ExtensionMetadata) => Promise<boolean>;
  uninstallExtension: (id: string) => Promise<boolean>;
  toggleExtension: (id: string, enabled: boolean) => Promise<boolean>;
  updateSettings: (id: string, settings: Record<string, unknown>) => Promise<boolean>;
  installFromVsix: () => Promise<boolean>;
  retryInstall: (id: string) => Promise<boolean>;
  retrySearch: () => Promise<void>;
  executeCommand: (commandId: string, ...args: unknown[]) => Promise<unknown>;
  getAvailableCommands: () => ExtensionCommand[];
}

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  installed: [],
  marketplace: [],
  activeDetail: null,
  activeSettings: null,
  isLoading: false,
  isMarketplaceLoading: false,
  isOfflineCache: false,
  offlineMessage: null,
  rateLimited: false,
  retryAfterSec: 0,
  activeTab: 'installed',
  selectedCategory: 'All',
  query: '',
  sortBy: 'relevance',
  error: null,
  installingMap: {},
  errorMap: {},

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setQuery: (q) => set({ query: q }),
  setSortBy: (sort) => {
    set({ sortBy: sort });
    void get().searchMarketplace(undefined, true);
  },
  setActiveDetail: (item) => set({ activeDetail: item }),
  setActiveSettings: (item) => set({ activeSettings: item }),

  loadInstalled: async () => {
    try {
      set({ isLoading: true, error: null });
      const res = window.electronAPI.marketplaceListInstalled
        ? await window.electronAPI.marketplaceListInstalled()
        : await window.electronAPI.getInstalledExtensions();
      if (res.success && res.data) {
        try {
          await extensionHost.initializeExtensions(res.data);
        } catch (initErr) {
          console.warn('[ExtensionStore] Extension worker initialization warning:', initErr);
        }

        const installedList = res.data;

        // Synchronize marketplace installed states
        set((state) => {
          const updatedMarketplace = state.marketplace.map((m) => {
            const match = installedList.find((i) => i.id === m.id);
            if (match) {
              return {
                ...m,
                installedState: 'installed' as ExtensionInstallState,
                enabledState: (match.enabled ? 'enabled' : 'disabled') as ExtensionEnabledState
              };
            } else if (m.installedState === 'installed') {
              return {
                ...m,
                installedState: 'uninstalled' as ExtensionInstallState,
                enabledState: 'disabled' as ExtensionEnabledState
              };
            }
            return m;
          });
          return { installed: installedList, marketplace: updatedMarketplace, isLoading: false };
        });
      } else {
        set({ error: res.error || 'Failed to load extensions', isLoading: false });
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  searchMarketplace: async (customQuery?: string, forceRefresh = false) => {
    const q = customQuery !== undefined ? customQuery : get().query;
    const requestVersion = ++marketplaceRequestVersion;

    try {
      set({ isMarketplaceLoading: true, error: null });

      const currentSort = get().sortBy || 'relevance';

      const options: MarketplaceSearchOptions = {
        query: q || 'popular',
        size: 25,
        sortBy: currentSort,
        sortOrder: 'desc',
        forceRefresh
      };

      const res = window.electronAPI.marketplaceSearch
        ? await window.electronAPI.marketplaceSearch(options)
        : await window.electronAPI.searchExtensions(q || 'popular').then((r) => ({
            success: r.success,
            error: r.error,
            data: {
              extensions: (r.data || []).map((ext) => ({
                id: ext.id,
                namespace: ext.namespace,
                displayName: ext.displayName || ext.name,
                shortDescription: ext.description || '',
                version: ext.version,
                downloadCount: ext.downloadCount || 0,
                publisher: ext.namespace,
                iconUrl: ext.iconUrl,
                installedState: 'uninstalled' as ExtensionInstallState,
                enabledState: 'disabled' as ExtensionEnabledState,
                downloadUrl: ext.downloadUrl,
                rating: ext.rating,
                categories: ext.categories
              })),
              totalSize: r.data?.length || 0,
              isOfflineCache: false,
              offlineMessage: undefined,
              rateLimited: false,
              retryAfterSec: 0
            } as MarketplaceSearchResult
          }));

      if (requestVersion !== marketplaceRequestVersion) return;

      if (res.success && res.data) {
        const installedList = get().installed;
        const mappedExtensions = res.data.extensions.map((ext: MarketplaceExtensionEntry) => {
          const match = installedList.find((i) => i.id === ext.id);
          const installing = get().installingMap[ext.id];
          const hasError = get().errorMap[ext.id];

          let installedState: ExtensionInstallState = ext.installedState || 'uninstalled';
          let enabledState: ExtensionEnabledState = ext.enabledState || 'disabled';

          if (installing) {
            installedState = 'installing';
          } else if (hasError) {
            installedState = 'error';
          } else if (match) {
            installedState = 'installed';
            enabledState = match.enabled ? 'enabled' : 'disabled';
          }

          return {
            ...ext,
            installedState,
            enabledState
          };
        });

        // Apply secondary client-side sort if requested
        if (currentSort === 'downloadCount') {
          mappedExtensions.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
        } else if (currentSort === 'rating') {
          mappedExtensions.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        }

        set({
          marketplace: mappedExtensions,
          isOfflineCache: Boolean(res.data.isOfflineCache),
          offlineMessage: res.data.offlineMessage || null,
          rateLimited: Boolean(res.data.rateLimited),
          retryAfterSec: res.data.retryAfterSec || 0,
          isMarketplaceLoading: false
        });
      } else {
        set({
          error: res.error || 'Marketplace search failed',
          isMarketplaceLoading: false,
          isOfflineCache: false,
          offlineMessage: null
        });
      }
    } catch (err: unknown) {
      if (requestVersion === marketplaceRequestVersion) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: msg, isMarketplaceLoading: false });
      }
    }
  },

  cancelMarketplaceSearch: () => {
    marketplaceRequestVersion += 1;
    set({ isMarketplaceLoading: false });
  },

  installExtension: async (item) => {
    const id = item.id;
    let cleanupProgress: (() => void) | undefined;

    try {
      // 1. Mark Installing state in UI
      set((state) => ({
        installingMap: {
          ...state.installingMap,
          [id]: { step: 'download', message: 'Downloading package…', percent: 10 }
        },
        errorMap: {
          ...state.errorMap,
          [id]: undefined as unknown as { message: string; step?: InstallStep; canRetry: boolean }
        },
        marketplace: state.marketplace.map((m) =>
          m.id === id ? { ...m, installedState: 'installing' as ExtensionInstallState, errorMessage: undefined } : m
        )
      }));

      // Listen for progress updates
      if (window.electronAPI.onMarketplaceInstallProgress) {
        cleanupProgress = window.electronAPI.onMarketplaceInstallProgress((evt) => {
          if (evt && typeof evt === 'object' && evt.id && evt.id.toLowerCase() === id.toLowerCase()) {
            set((state) => ({
              installingMap: {
                ...state.installingMap,
                [id]: { step: evt.step, percent: evt.percent, message: evt.message }
              }
            }));
          }
        });
      }

      // 2. Trigger installation via IPC
      const res = window.electronAPI.marketplaceInstall
        ? await window.electronAPI.marketplaceInstall(item as MarketplaceExtensionEntry)
        : await window.electronAPI.installExtension(item as ExtensionMetadata).then((r) => ({
            success: r.success,
            error: r.error,
            data: { success: r.success, id, error: r.error, failedStep: 'download' as InstallStep } as InstallResult
          }));

      if (res.success && res.data) {
        // 3. Mark Installed state
        set((state) => {
          const nextInstalling = { ...state.installingMap };
          delete nextInstalling[id];
          const nextErrors = { ...state.errorMap };
          delete nextErrors[id];

          return {
            installingMap: nextInstalling,
            errorMap: nextErrors,
            marketplace: state.marketplace.map((m) =>
              m.id === id
                ? { ...m, installedState: 'installed' as ExtensionInstallState, enabledState: 'enabled' as ExtensionEnabledState }
                : m
            )
          };
        });

        await get().loadInstalled();
        return true;
      } else {
        // Failed state
        const failedStep = (res.data?.failedStep as InstallStep) || 'download';
        const errorMsg = res.error || res.data?.error || 'Installation failed';

        set((state) => {
          const nextInstalling = { ...state.installingMap };
          delete nextInstalling[id];

          return {
            installingMap: nextInstalling,
            errorMap: {
              ...state.errorMap,
              [id]: { message: errorMsg, step: failedStep, canRetry: true }
            },
            marketplace: state.marketplace.map((m) =>
              m.id === id
                ? { ...m, installedState: 'error' as ExtensionInstallState, errorMessage: errorMsg, failedStep }
                : m
            )
          };
        });
        return false;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set((state) => {
        const nextInstalling = { ...state.installingMap };
        delete nextInstalling[id];

        return {
          installingMap: nextInstalling,
          errorMap: {
            ...state.errorMap,
            [id]: { message: errorMsg, step: 'download', canRetry: true }
          },
          marketplace: state.marketplace.map((m) =>
            m.id === id
              ? { ...m, installedState: 'error' as ExtensionInstallState, errorMessage: errorMsg }
              : m
          )
        };
      });
      return false;
    } finally {
      cleanupProgress?.();
    }
  },

  retryInstall: async (id: string) => {
    const entry = get().marketplace.find((m) => m.id === id);
    if (!entry) return false;
    return get().installExtension(entry);
  },

  retrySearch: async () => {
    set({ error: null, rateLimited: false });
    await get().searchMarketplace(get().query, true);
  },

  uninstallExtension: async (id) => {
    try {
      set({ isLoading: true, error: null });

      const res = window.electronAPI.marketplaceUninstall
        ? await window.electronAPI.marketplaceUninstall(id)
        : await window.electronAPI.uninstallExtension(id).then((r) => ({ success: r.success, error: r.error }));

      if (res.success) {
        extensionHost.deactivateExtension(id);

        set((state) => ({
          marketplace: state.marketplace.map((m) =>
            m.id === id
              ? { ...m, installedState: 'uninstalled' as ExtensionInstallState, enabledState: 'disabled' as ExtensionEnabledState }
              : m
          ),
          isLoading: false
        }));

        await get().loadInstalled();
        return true;
      } else {
        set({ error: res.error || 'Uninstall failed', isLoading: false });
        return false;
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      return false;
    }
  },

  toggleExtension: async (id, enabled) => {
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.toggleExtension(id, enabled);

      if (res.success && res.data) {
        extensionHost.deactivateExtension(id);

        set((state) => ({
          marketplace: state.marketplace.map((m) =>
            m.id === id
              ? { ...m, enabledState: enabled ? 'enabled' : 'disabled' }
              : m
          ),
          isLoading: false
        }));

        await get().loadInstalled();
        return true;
      } else {
        set({ error: res.error || 'Toggle failed', isLoading: false });
        return false;
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      return false;
    }
  },

  updateSettings: async (id, settings) => {
    try {
      const res = await window.electronAPI.updateExtensionSettings(id, settings);
      if (res.success) {
        await get().loadInstalled();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  installFromVsix: async () => {
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.installExtensionFromVsix();
      if (res.success && res.data) {
        await get().loadInstalled();
        return true;
      } else {
        if (res.error !== 'Installation cancelled') {
          set({ error: res.error || 'VSIX install failed' });
        }
        set({ isLoading: false });
        return false;
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      return false;
    }
  },

  executeCommand: async (commandId, ...args) => {
    return await extensionHost.executeCommand(commandId, ...args);
  },

  getAvailableCommands: () => extensionHost.getRegisteredCommands()
}));
