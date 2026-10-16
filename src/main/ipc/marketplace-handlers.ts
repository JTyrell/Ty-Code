/**
 * Ty-Code Desktop IDE - Marketplace IPC Handlers
 * Handles IPC channels for Open VSX marketplace search, metadata, install, uninstall,
 * and list-installed operations.
 */

import { BrowserWindow } from 'electron';
import { openVsxClient } from '../services/marketplace/openvsx-client';
import { vsixInstaller } from '../services/marketplace/vsix-installer';
import { extensionManager } from '../services/extension-manager';
import type { IpcResponse, InstalledExtension } from '../../preload/types';
import type {
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  MarketplaceExtensionEntry,
  InstallResult,
  InstallProgressEvent
} from '../../shared/types/marketplace';

export async function handleMarketplaceSearch(
  optionsOrQuery: MarketplaceSearchOptions | string
): Promise<IpcResponse<MarketplaceSearchResult>> {
  try {
    const opts: MarketplaceSearchOptions = typeof optionsOrQuery === 'string'
      ? { query: optionsOrQuery }
      : (optionsOrQuery || {});

    const result = await openVsxClient.search(opts);
    return { success: true, data: result };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMessage,
      data: {
        extensions: [],
        totalSize: 0,
        isOfflineCache: false,
        offlineMessage: errorMessage
      }
    };
  }
}

export async function handleMarketplaceMetadata(
  namespace: string,
  extension: string
): Promise<IpcResponse<MarketplaceExtensionEntry | null>> {
  try {
    if (!namespace || !extension) {
      throw new Error('Both namespace and extension name must be provided.');
    }
    const result = await openVsxClient.getMetadata(namespace, extension);
    return { success: true, data: result };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleMarketplaceInstall(
  entry: MarketplaceExtensionEntry | { id: string; downloadUrl?: string; sha256?: string; [key: string]: unknown }
): Promise<IpcResponse<InstallResult>> {
  try {
    if (!entry || typeof entry !== 'object' || !entry.id) {
      throw new Error('Valid extension entry with id must be provided.');
    }

    const broadcastProgress = (progressEvent: InstallProgressEvent) => {
      try {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('marketplace:install-progress', progressEvent);
          }
        }
      } catch {
        // Ignore progress send failures
      }
    };

    const result = await vsixInstaller.install(entry, broadcastProgress);
    return { success: result.success, data: result, error: result.error };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: msg,
      data: {
        success: false,
        id: entry?.id || 'unknown',
        failedStep: 'download',
        error: msg,
        canRetry: true
      }
    };
  }
}

export async function handleMarketplaceUninstall(id: string): Promise<IpcResponse<boolean>> {
  try {
    if (!id || typeof id !== 'string') {
      throw new Error('Extension ID must be provided.');
    }
    const success = await vsixInstaller.uninstall(id);
    return { success: true, data: success };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleMarketplaceListInstalled(): Promise<IpcResponse<InstalledExtension[]>> {
  try {
    await extensionManager.init();
    const installed = extensionManager.getInstalledExtensions();
    return { success: true, data: installed };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err), data: [] };
  }
}

export async function handleTraceExtensionInstall(
  extensionId?: string
): Promise<IpcResponse<import('../services/marketplace/installation-tracer').ExtensionInstallTraceReport>> {
  try {
    const { runInstallationTrace } = await import('../services/marketplace/installation-tracer');
    const report = await runInstallationTrace(extensionId || 'ms-python.python');
    return { success: true, data: report };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
