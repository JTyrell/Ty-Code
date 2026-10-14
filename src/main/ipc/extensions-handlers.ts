import type { ExtensionMetadata, IpcResponse } from '../../preload/types';

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
        downloadUrl: files.download
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
