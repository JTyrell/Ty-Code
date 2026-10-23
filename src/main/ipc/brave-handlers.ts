/**
 * Brave Browser IPC Handlers
 *
 * Bridges Brave detection, installation, and status management between
 * the Electron Main Process and Renderer settings UI.
 *
 * Brand: Ty-Code
 */

import type { IpcResponse } from '../../preload/types';
import { detectBraveBrowser, type BraveDetectionResult } from '../services/brave-detector';
import { installBraveBrowser, type BraveInstallOptions, type BraveInstallResult } from '../services/brave-installer';
import { getSettings, saveSettings } from './settings-handlers';

export interface BraveStatusResponse {
  installed: boolean;
  executablePath: string | null;
  enabled: boolean;
}

/**
 * Handles detection of Brave browser on host operating system.
 */
export async function handleBraveDetect(): Promise<IpcResponse<BraveDetectionResult>> {
  try {
    const result = await detectBraveBrowser();
    return { success: true, data: result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Handles initiating the Brave browser installation flow.
 */
export async function handleBraveInstall(
  options?: BraveInstallOptions
): Promise<IpcResponse<BraveInstallResult>> {
  try {
    const result = await installBraveBrowser(options);
    return { success: result.success, data: result, error: result.error };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Retrieves aggregate Brave browser status (installed + enabled state in settings).
 */
export async function handleBraveGetStatus(): Promise<IpcResponse<BraveStatusResponse>> {
  try {
    const detection = await detectBraveBrowser();
    const settingsRes = await getSettings();
    const settings = settingsRes.success ? settingsRes.data : null;
    const isEnabled = Boolean(settings?.integrations?.brave);

    return {
      success: true,
      data: {
        installed: detection.installed,
        executablePath: detection.executablePath,
        enabled: isEnabled
      }
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Updates the Brave integration enabled setting.
 */
export async function handleBraveSetEnabled(enabled: boolean): Promise<IpcResponse<{ enabled: boolean }>> {
  try {
    const settingsRes = await getSettings();
    const current = settingsRes.success && settingsRes.data ? settingsRes.data : null;
    const updatedIntegrations = {
      ...(current?.integrations || {}),
      brave: enabled
    };

    const saveRes = await saveSettings({
      integrations: updatedIntegrations
    });

    if (!saveRes.success) {
      return { success: false, error: saveRes.error || 'Failed to save settings' };
    }

    return { success: true, data: { enabled } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Handles executing an isolated web search inside Brave Guest Mode.
 */
export async function handleBraveSearch(query: string): Promise<IpcResponse<any>> {
  try {
    const { braveEngine } = await import('../services/brave-engine');
    const result = await braveEngine.searchWeb(query);
    return { success: true, data: result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Handles navigating the guest browser to a test or dev URL.
 */
export async function handleBraveNavigate(url: string): Promise<IpcResponse<any>> {
  try {
    const { braveEngine } = await import('../services/brave-engine');
    const result = await braveEngine.navigateToTestingUrl(url);
    return { success: true, data: result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Handles extracting the readable content from the active Brave guest page.
 */
export async function handleBraveGetPageContent(): Promise<IpcResponse<{ content: string }>> {
  try {
    const { braveEngine } = await import('../services/brave-engine');
    const content = await braveEngine.getPageContent();
    return { success: true, data: { content } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Handles closing the active Brave guest session and wiping temporary files.
 */
export async function handleBraveClose(): Promise<IpcResponse<{ closed: boolean }>> {
  try {
    const { braveEngine } = await import('../services/brave-engine');
    await braveEngine.close();
    return { success: true, data: { closed: true } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Broadcasts Brave testing updates to all active renderer windows.
 */
export function broadcastBraveTestingUpdate(state: any): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('brave:testing-update', state);
      }
    }
  } catch {
    // Outside Electron main process
  }
}

let activeVisibleBraveProcess: import('node:child_process').ChildProcess | null = null;
let activeVisibleProfilePath: string | null = null;

/**
 * Handles starting local web testing in Brave Guest Mode.
 * Validates payload with Zod and optionally opens visible Brave in guest mode.
 */
export async function handleBraveStartTesting(
  rawPayload: unknown
): Promise<IpcResponse<{ active: boolean; url: string; title?: string; status?: number }>> {
  try {
    const { BraveStartTestingPayloadSchema } = await import('../../shared/types/brave-testing');
    const parsed = BraveStartTestingPayloadSchema.parse(
      typeof rawPayload === 'string' ? { url: rawPayload } : rawPayload
    );

    let targetUrl = parsed.url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `http://${targetUrl}`;
    }

    // 1. Broadcast immediate active state to UI
    broadcastBraveTestingUpdate({
      active: true,
      url: targetUrl,
      title: 'Connecting to local test target...',
      status: 200
    });

    // 2. If visible window requested, launch external visible Brave in strict Guest Mode
    if (parsed.openVisibleWindow) {
      const { detectBraveBrowser } = await import('../services/brave-detector');
      const { createEphemeralProfile, cleanupEphemeralProfile, MANDATORY_BRAVE_ISOLATION_FLAGS } = await import(
        '../services/brave-engine'
      );
      const detection = await detectBraveBrowser();

      if (detection.installed && detection.executablePath) {
        if (activeVisibleProfilePath) {
          void cleanupEphemeralProfile(activeVisibleProfilePath);
        }

        activeVisibleProfilePath = await createEphemeralProfile();
        const { spawn } = await import('node:child_process');

        const proc = spawn(
          detection.executablePath,
          [
            `--user-data-dir=${activeVisibleProfilePath}`,
            ...MANDATORY_BRAVE_ISOLATION_FLAGS,
            targetUrl
          ],
          { detached: true, stdio: 'ignore' }
        );

        proc.unref();
        activeVisibleBraveProcess = proc;
      }
    }

    // 3. Navigate the background automation engine to target URL
    const { braveEngine } = await import('../services/brave-engine');
    const navResult = await braveEngine.navigateToTestingUrl(targetUrl);

    // 4. Broadcast updated navigation details
    broadcastBraveTestingUpdate({
      active: true,
      url: navResult.url,
      title: navResult.title || 'Testing Active',
      status: navResult.status
    });

    return {
      success: true,
      data: {
        active: true,
        url: navResult.url,
        title: navResult.title,
        status: navResult.status
      }
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    broadcastBraveTestingUpdate({
      active: false,
      url: '',
      error
    });
    return { success: false, error };
  }
}

/**
 * Handles stopping local web testing in Brave Guest Mode.
 */
export async function handleBraveStopTesting(): Promise<IpcResponse<{ active: boolean }>> {
  try {
    const { braveEngine } = await import('../services/brave-engine');
    await braveEngine.close();

    if (activeVisibleProfilePath) {
      const { cleanupEphemeralProfile } = await import('../services/brave-engine');
      await cleanupEphemeralProfile(activeVisibleProfilePath);
      activeVisibleProfilePath = null;
      activeVisibleBraveProcess = null;
    }

    broadcastBraveTestingUpdate({
      active: false,
      url: ''
    });

    return { success: true, data: { active: false } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}


