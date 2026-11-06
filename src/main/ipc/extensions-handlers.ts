import { dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { ExtensionMetadata, InstalledExtension, IpcResponse } from '../../preload/types';
import {
  ExtensionCapabilityRequestSchema,
  ExtensionIdSchema,
  ExtensionMetadataSchema
} from '../../preload/extension-schemas';
import { extensionManager } from '../services/extension-manager';
import { vsixInstaller } from '../services/marketplace/vsix-installer';
import { extensionHost } from '../services/extensions/extension-host';
import { extensionControls } from '../services/extensions/extension-controls';
import type {
  ExtensionUpdateInfo,
  RunningExtensionInfo,
  ExtensionBisectState,
  BulkToggleResult,
  InstallResult
} from '../../shared/types/marketplace';

const MAX_REGISTRY_RESPONSE_BYTES = 1_000_000;

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRY_RESPONSE_BYTES) {
    throw new Error('Extension registry response exceeded the size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Extension registry response had no readable body.');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Extension registry response exceeded the size limit.');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(joined)) as unknown;
}

function safeHttpsUrl(value: unknown, allowedHost?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (allowedHost && url.hostname !== allowedHost)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Open VSX "files" entries can be relative URIs ("/api/..."). Absolutize them
 * against the registry origin before HTTPS validation so real icons and VSIX
 * download URLs survive the schema round-trip.
 */
function registryFileUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `https://open-vsx.org${value}`;
  return undefined;
}

function toMarketplaceMetadata(item: unknown): ExtensionMetadata | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const raw = item as Record<string, unknown>;
  const files = raw.files && typeof raw.files === 'object' ? raw.files as Record<string, unknown> : {};
  const namespace = raw.namespace;
  const name = raw.name;
  const normalized = ExtensionMetadataSchema.safeParse({
    id: `${String(namespace || '')}.${String(name || '')}`,
    namespace,
    name,
    displayName: typeof raw.displayName === 'string' ? raw.displayName.slice(0, 160) : name,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2_000) : '',
    version: raw.version,
    iconUrl: safeHttpsUrl(registryFileUrl(files.icon), 'open-vsx.org'),
    downloadUrl: safeHttpsUrl(registryFileUrl(files.download), 'open-vsx.org'),
    downloadCount: typeof raw.downloadCount === 'number' && Number.isFinite(raw.downloadCount) ? Math.max(0, raw.downloadCount) : 0,
    rating: typeof raw.averageRating === 'number' && Number.isFinite(raw.averageRating) ? Math.min(5, Math.max(0, raw.averageRating)) : undefined,
    publishedDate: typeof raw.timestamp === 'string' ? raw.timestamp.slice(0, 80) : undefined,
    repository: safeHttpsUrl(raw.repository),
    categories: Array.isArray(raw.categories) ? raw.categories.filter((item): item is string => typeof item === 'string').slice(0, 20) : ['Tools']
  });
  return normalized.success ? normalized.data : undefined;
}

export async function searchOpenVsxExtensions(query: string): Promise<IpcResponse<ExtensionMetadata[]>> {
  try {
    if (typeof query !== 'string' || query.length > 160) throw new Error('Search text must be 160 characters or fewer.');
    const q = query.trim() || 'popular';
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=25&sortBy=downloadCount&sortOrder=desc`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Ty-Code-Desktop-IDE' }, signal: AbortSignal.timeout(12_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Extension registry responded with status ${response.status}.`);
    const data = await readBoundedJson(response);
    const rawExtensions = data && typeof data === 'object' && 'extensions' in data && Array.isArray(data.extensions)
      ? data.extensions.slice(0, 25)
      : [];
    const formatted = rawExtensions.map(toMarketplaceMetadata).filter((item): item is ExtensionMetadata => Boolean(item));
    return { success: true, data: formatted };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getOpenVsxExtensionDetails(namespace: string, name: string): Promise<IpcResponse<Record<string, unknown>>> {
  try {
    ExtensionIdSchema.parse(`${namespace}.${name}`);
    const response = await fetch(`https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
      headers: { 'User-Agent': 'Ty-Code-Desktop-IDE' }, signal: AbortSignal.timeout(12_000), redirect: 'error'
    });
    if (!response.ok) throw new Error(`Failed to load extension details: ${response.status}`);
    const raw = await readBoundedJson(response);
    const metadata = toMarketplaceMetadata(raw);
    if (!metadata) throw new Error('Extension registry returned invalid extension metadata.');
    return { success: true, data: metadata as unknown as Record<string, unknown> };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleGetInstalledExtensions(): Promise<IpcResponse<InstalledExtension[]>> {
  try {
    await extensionManager.init();
    return { success: true, data: extensionManager.getInstalledExtensions() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleInstallExtension(input: unknown): Promise<IpcResponse<InstalledExtension>> {
  try {
    const metadata = ExtensionMetadataSchema.parse(input);
    return { success: true, data: await extensionManager.installExtension(metadata) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleUninstallExtension(id: unknown): Promise<IpcResponse<void>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    await extensionManager.uninstallExtension(safeId);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleToggleExtension(id: unknown, enabled: unknown): Promise<IpcResponse<InstalledExtension>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    if (typeof enabled !== 'boolean') throw new Error('Extension enabled state must be boolean.');
    return { success: true, data: await extensionManager.toggleExtension(safeId, enabled) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleUpdateExtensionSettings(id: unknown, settings: unknown): Promise<IpcResponse<void>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Extension settings must be an object.');
    await extensionManager.updateSettings(safeId, settings as Record<string, unknown>);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isSafeWorkspaceRelativePath(relativePath: string): boolean {
  return Boolean(relativePath.trim()) && !path.isAbsolute(relativePath) && !path.win32.isAbsolute(relativePath)
    && !relativePath.split(/[\\/]/).some((segment) => segment === '..' || segment === '.' || /^\.env(?:\.|$)/i.test(segment));
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function handleExtensionCapability(input: unknown, workspacePath: string): Promise<IpcResponse<unknown>> {
  try {
    const request = ExtensionCapabilityRequestSchema.parse(input);
    await extensionManager.init();
    const safeId = ExtensionIdSchema.parse(request.extensionId);
    if (request.capability !== 'workspace.fs.read' && request.capability !== 'workspace.fs.write') throw new Error('This extension capability is not supported.');
    const extension = extensionManager.getInstalledExtensions().find((item) => item.id === safeId);
    if (!extension || !extension.isBuiltIn || !extension.enabled) throw new Error('Only enabled built-in extensions can use workspace capabilities.');
    if (!(extension.manifest.capabilities || []).includes(request.capability)) throw new Error(`Extension "${safeId}" has not declared "${request.capability}".`);
    if ((request.method === 'workspace.read-file' && request.capability !== 'workspace.fs.read') || (request.method === 'workspace.write-file' && request.capability !== 'workspace.fs.write')) {
      throw new Error('Requested operation does not match its declared capability.');
    }
    if (!isSafeWorkspaceRelativePath(request.relativePath)) throw new Error('Workspace capability paths must be safe, relative, and non-sensitive.');
    if (request.method === 'workspace.write-file' && (typeof request.content !== 'string' || request.content.length > 50_000)) throw new Error('Workspace write content is invalid or exceeds the 50,000-character RPC limit.');

    const root = await fs.realpath(workspacePath);
    const targetPath = path.resolve(root, request.relativePath);
    if (!isContained(root, targetPath)) throw new Error('Workspace capability path escapes the active workspace.');
    let safeTarget = targetPath;
    try {
      safeTarget = await fs.realpath(targetPath);
      if (!isContained(root, safeTarget)) throw new Error('Workspace capability target resolves outside the active workspace.');
      const stats = await fs.stat(safeTarget);
      if (!stats.isFile()) throw new Error('Workspace capabilities can only access files.');
      if (request.method === 'workspace.read-file') {
        if (stats.size > 200 * 1024) throw new Error('Workspace read exceeds the 200 KiB RPC limit.');
        return { success: true, data: await fs.readFile(safeTarget, 'utf8') };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || request.method !== 'workspace.write-file') throw error;
      const realParent = await fs.realpath(path.dirname(targetPath));
      if (!isContained(root, realParent)) throw new Error('Workspace capability parent resolves outside the active workspace.');
    }
    const realParent = await fs.realpath(path.dirname(safeTarget));
    if (!isContained(root, realParent)) throw new Error('Workspace write parent resolves outside the active workspace.');
    const finalTarget = path.join(realParent, path.basename(safeTarget));
    const tempTarget = path.join(realParent, `.ty-code-extension-${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(tempTarget, request.content!, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(tempTarget, finalTarget);
    } catch (error) {
      await fs.rm(tempTarget, { force: true }).catch(() => undefined);
      throw error;
    }
    return { success: true, data: null };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleInstallExtensionFromVsix(window?: BrowserWindow): Promise<IpcResponse<InstalledExtension>> {
  try {
    const win = window || BrowserWindow.getFocusedWindow();
    if (!win) throw new Error('No application window is available to select an extension package.');
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Extension VSIX Package',
      filters: [{ name: 'VSIX Package', extensions: ['vsix'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Installation cancelled' };

    const vsixPath = result.filePaths[0];
    // Real pipeline: magic-byte check, zip-slip-safe extraction, manifest validation,
    // host registration, and rollback on failure (see VsixInstaller.installFromVsix).
    const broadcastProgress = (progressEvent: { id: string; step: string; percent?: number; message?: string }) => {
      try {
        for (const target of BrowserWindow.getAllWindows()) {
          if (!target.isDestroyed()) {
            target.webContents.send('marketplace:install-progress', progressEvent);
          }
        }
      } catch {
        // Ignore progress delivery failures
      }
    };

    const installResult = await vsixInstaller.installFromVsix(vsixPath, broadcastProgress);
    if (installResult.success && installResult.installedExtension) {
      broadcastProgress({ id: installResult.id, step: 'registration', percent: 100, message: 'Installation complete!' });
      return { success: true, data: installResult.installedExtension as InstalledExtension };
    }
    return { success: false, error: installResult.error || 'VSIX installation failed.' };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionActivate(id: unknown): Promise<IpcResponse<boolean>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    const success = await extensionHost.activateExtension(safeId);
    return { success: true, data: success };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionDeactivate(id: unknown): Promise<IpcResponse<boolean>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    const success = await extensionHost.deactivateExtension(safeId);
    return { success: true, data: success };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionExecuteCommand(payload: unknown): Promise<IpcResponse<unknown>> {
  try {
    if (!payload || typeof payload !== 'object') throw new Error('Command execution payload must be an object.');
    const raw = payload as { commandId?: unknown; args?: unknown };
    if (typeof raw.commandId !== 'string' || !raw.commandId.trim()) throw new Error('Missing commandId.');
    const args = Array.isArray(raw.args) ? raw.args : [];
    const result = await extensionHost.executeCommand(raw.commandId.trim(), args);
    return { success: true, data: result };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionTriggerEvent(payload: unknown): Promise<IpcResponse<string[]>> {
  try {
    if (!payload || typeof payload !== 'object') throw new Error('Trigger event payload must be an object.');
    const raw = payload as { event?: unknown; payload?: unknown };
    if (typeof raw.event !== 'string' || !raw.event.trim()) throw new Error('Missing event.');
    const context = raw.payload && typeof raw.payload === 'object' ? raw.payload as any : undefined;
    const activated = await extensionHost.handleActivationEvent(raw.event.trim(), context);
    return { success: true, data: activated };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionListCommands(): Promise<IpcResponse<any[]>> {
  try {
    const commands = extensionHost.getRegisteredCommands();
    return { success: true, data: commands };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleExtensionProvideCompletions(payload: unknown): Promise<IpcResponse<any[]>> {
  try {
    if (!payload || typeof payload !== 'object') return { success: true, data: [] };
    const raw = payload as { language?: string; filePath?: string; line?: number; character?: number };
    const items = await extensionHost.provideCompletionItems(
      raw.language || '',
      raw.filePath || '',
      raw.line || 0,
      raw.character || 0
    );
    return { success: true, data: items };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Extension Controls (VS Code parity "…" menu)
// ---------------------------------------------------------------------------

export async function handleCheckExtensionUpdates(): Promise<IpcResponse<ExtensionUpdateInfo[]>> {
  try {
    const updates = await extensionControls.checkForUpdates();
    return { success: true, data: updates };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err), data: [] };
  }
}

export async function handleUpdateExtension(id: unknown): Promise<IpcResponse<InstallResult>> {
  try {
    const safeId = ExtensionIdSchema.parse(id);
    // Real VSIX pipeline: resolves latest metadata from Open VSX, downloads,
    // verifies checksum, extracts with zip-slip protection, re-registers host.
    const result = await vsixInstaller.install({ id: safeId }, (event) => {
      try {
        for (const target of BrowserWindow.getAllWindows()) {
          if (!target.isDestroyed()) target.webContents.send('marketplace:install-progress', event);
        }
      } catch {
        // Ignore progress delivery failures
      }
    });
    return { success: result.success, data: result, error: result.error };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleToggleAllExtensions(enabled: unknown): Promise<IpcResponse<BulkToggleResult>> {
  try {
    if (typeof enabled !== 'boolean') throw new Error('Bulk toggle target must be boolean.');
    const result = await extensionControls.toggleAllExtensions(enabled);
    return { success: true, data: result };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleGetRunningExtensions(): Promise<IpcResponse<RunningExtensionInfo[]>> {
  try {
    return { success: true, data: extensionHost.getRunningExtensions() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err), data: [] };
  }
}

export async function handleGetExtensionAutoUpdate(): Promise<IpcResponse<boolean>> {
  try {
    return { success: true, data: await extensionControls.getAutoUpdateEnabled() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err), data: true };
  }
}

export async function handleSetExtensionAutoUpdate(enabled: unknown): Promise<IpcResponse<boolean>> {
  try {
    if (typeof enabled !== 'boolean') throw new Error('Auto-update flag must be boolean.');
    return { success: true, data: await extensionControls.setAutoUpdateEnabled(enabled) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleStartExtensionBisect(): Promise<IpcResponse<ExtensionBisectState>> {
  try {
    return { success: true, data: await extensionControls.startBisect() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleReportExtensionBisectRound(issuePresent: unknown): Promise<IpcResponse<ExtensionBisectState>> {
  try {
    if (typeof issuePresent !== 'boolean') throw new Error('Bisect report must be boolean.');
    return { success: true, data: await extensionControls.reportBisectRound(issuePresent) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleStopExtensionBisect(restore: unknown): Promise<IpcResponse<ExtensionBisectState | null>> {
  try {
    return { success: true, data: await extensionControls.stopBisect(restore !== false) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleGetExtensionBisectState(): Promise<IpcResponse<ExtensionBisectState | null>> {
  try {
    return { success: true, data: extensionControls.getBisectState() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}


