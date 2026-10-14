import { create } from 'zustand';
import type { InstalledExtension, ExtensionMetadata, ExtensionCommand } from '../../../preload/types';
import { extensionHost } from '../services/extension-host';

interface ExtensionStoreState {
  installed: InstalledExtension[];
  marketplace: ExtensionMetadata[];
  activeDetail: InstalledExtension | ExtensionMetadata | null;
  activeSettings: InstalledExtension | null;
  isLoading: boolean;
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
        set({ installed: res.data, isLoading: false });
        // Initialize ExtensionHost
        extensionHost.initializeExtensions(res.data);
      } else {
        set({ error: res.error || 'Failed to load extensions', isLoading: false });
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  searchMarketplace: async (customQuery?: string) => {
    const q = customQuery !== undefined ? customQuery : get().query;
    try {
      set({ isLoading: true, error: null });
      const res = await window.electronAPI.searchExtensions(q || 'popular');
      if (res.success && res.data) {
        set({ marketplace: res.data, isLoading: false });
      } else {
        set({ error: res.error || 'Marketplace search failed', isLoading: false });
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
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
        if (enabled) {
          extensionHost.activateBuiltInExtension(res.data);
        } else {
          extensionHost.deactivateExtension(id);
        }
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

  getAvailableCommands: () => {
    const commands: ExtensionCommand[] = [];
    const { installed } = get();

    for (const ext of installed) {
      if (!ext.enabled || !ext.manifest.contributes?.commands) continue;
      for (const cmd of ext.manifest.contributes.commands) {
        commands.push({
          id: cmd.command,
          title: cmd.title,
          category: cmd.category,
          extensionId: ext.id,
          isBuiltIn: ext.isBuiltIn
        });
      }
    }

    return commands;
  }
}));
