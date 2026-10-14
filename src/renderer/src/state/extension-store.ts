import { create } from 'zustand';
import type { InstalledExtension, ExtensionMetadata, ExtensionCommand } from '../../../preload/types';
import { extensionHost } from '../services/extension-host';

let marketplaceRequestVersion = 0;

interface ExtensionStoreState {
  installed: InstalledExtension[];
  marketplace: ExtensionMetadata[];
  activeDetail: InstalledExtension | ExtensionMetadata | null;
  activeSettings: InstalledExtension | null;
  isLoading: boolean;
  isMarketplaceLoading: boolean;
  activeTab: 'installed' | 'marketplace';
  selectedCategory: string;
  query: string;
  error: string | null;

  // Actions
  setActiveTab: (tab: 'installed' | 'marketplace') => void;
  setSelectedCategory: (cat: string) => void;
  setQuery: (q: string) => void;
  setActiveDetail: (item: InstalledExtension | ExtensionMetadata | null) => void;
  setActiveSettings: (item: InstalledExtension | null) => void;
  loadInstalled: () => Promise<void>;
  searchMarketplace: (query?: string) => Promise<void>;
  cancelMarketplaceSearch: () => void;
  installExtension: (metadata: ExtensionMetadata) => Promise<boolean>;
  uninstallExtension: (id: string) => Promise<boolean>;
  toggleExtension: (id: string, enabled: boolean) => Promise<boolean>;
  updateSettings: (id: string, settings: Record<string, unknown>) => Promise<boolean>;
  installFromVsix: () => Promise<boolean>;
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
  activeTab: 'installed',
  selectedCategory: 'All',
  query: '',
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setQuery: (q) => set({ query: q }),
  setActiveDetail: (item) => set({ activeDetail: item }),
  setActiveSettings: (item) => set({ activeSettings: item }),

  loadInstalled: async () => {
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.getInstalledExtensions();
      if (res.success && res.data) {
        // Activate only trusted built-ins in the isolated Worker runtime before exposing commands.
        await extensionHost.initializeExtensions(res.data);
        set({ installed: res.data, isLoading: false });
      } else {
        set({ error: res.error || 'Failed to load extensions', isLoading: false });
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  searchMarketplace: async (customQuery?: string) => {
    const q = customQuery !== undefined ? customQuery : get().query;
    const requestVersion = ++marketplaceRequestVersion;
    try {
      set({ isMarketplaceLoading: true, error: null });
      const res = await window.electronAPI.searchExtensions(q || 'popular');
      if (requestVersion !== marketplaceRequestVersion) return;
      if (res.success && res.data) {
        set({ marketplace: res.data, isMarketplaceLoading: false });
      } else {
        set({ error: res.error || 'Marketplace search failed', isMarketplaceLoading: false });
      }
    } catch (err: unknown) {
      if (requestVersion === marketplaceRequestVersion) set({ error: err instanceof Error ? err.message : String(err), isMarketplaceLoading: false });
    }
  },

  cancelMarketplaceSearch: () => {
    marketplaceRequestVersion += 1;
    set({ isMarketplaceLoading: false });
  },

  installExtension: async (metadata) => {
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.installExtension(metadata);
      if (res.success && res.data) {
        await get().loadInstalled();
        return true;
      } else {
        set({ error: res.error || 'Install failed', isLoading: false });
        return false;
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      return false;
    }
  },

  uninstallExtension: async (id) => {
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.uninstallExtension(id);
      if (res.success) {
        extensionHost.deactivateExtension(id);
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
