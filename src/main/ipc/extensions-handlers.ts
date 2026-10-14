import { dialog, BrowserWindow } from 'electron';
import type { ExtensionMetadata, InstalledExtension, IpcResponse } from '../../preload/types';
import { extensionManager } from '../services/extension-manager';

export async function searchOpenVsxExtensions(query: string): Promise<IpcResponse<ExtensionMetadata[]>> {
  try {
    const q = query.trim() || 'popular';
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=25&sortBy=downloadCount&sortOrder=desc`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Ty-Claude-Desktop-IDE'
      }
    });

    if (!res.ok) {
      throw new Error(`Open VSX API responded with ${res.status}: ${res.statusText}`);
    }

    const json = await res.json() as { extensions?: Array<Record<string, any>> };
    const rawExtensions = json.extensions || [];

    const formatted: ExtensionMetadata[] = rawExtensions.map((e) => {
      const files = e.files || {};
      return {
        id: `${e.namespace}.${e.name}`,
        namespace: e.namespace,
        name: e.name,
        displayName: e.displayName || e.name,
        description: e.description || '',
        version: e.version || '1.0.0',
        iconUrl: files.icon,
        downloadCount: e.downloadCount || 0,
        rating: e.averageRating ? Math.round(e.averageRating * 10) / 10 : undefined,
        publishedDate: e.timestamp,
        repository: e.repository,
        downloadUrl: files.download,
        categories: e.categories || ['Tools']
      };
    });

    return { success: true, data: formatted };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[OpenVSX] Search error:', msg);
    return { success: false, error: msg };
  }
}

export async function getOpenVsxExtensionDetails(
  namespace: string,
  name: string
): Promise<IpcResponse<Record<string, unknown>>> {
  try {
    const url = `https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ty-Claude-Desktop-IDE' }
    });

    if (!res.ok) {
      throw new Error(`Failed to load extension details: ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleGetInstalledExtensions(): Promise<IpcResponse<InstalledExtension[]>> {
  try {
    await extensionManager.init();
    const installed = extensionManager.getInstalledExtensions();
    return { success: true, data: installed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleInstallExtension(ext: ExtensionMetadata): Promise<IpcResponse<InstalledExtension>> {
  try {
    const installed = await extensionManager.installExtension(ext);
    return { success: true, data: installed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleUninstallExtension(id: string): Promise<IpcResponse<void>> {
  try {
    await extensionManager.uninstallExtension(id);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleToggleExtension(id: string, enabled: boolean): Promise<IpcResponse<InstalledExtension>> {
  try {
    const updated = await extensionManager.toggleExtension(id, enabled);
    return { success: true, data: updated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleUpdateExtensionSettings(id: string, settings: Record<string, unknown>): Promise<IpcResponse<void>> {
  try {
    await extensionManager.updateSettings(id, settings);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function handleInstallExtensionFromVsix(window?: BrowserWindow): Promise<IpcResponse<InstalledExtension>> {
  try {
    const win = window || BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select Extension VSIX Package',
      filters: [{ name: 'VSIX Package', extensions: ['vsix', 'zip'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Installation cancelled' };
    }

    const installed = await extensionManager.installFromVsix(result.filePaths[0]);
    return { success: true, data: installed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
