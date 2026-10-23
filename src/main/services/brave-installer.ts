/**
 * Brave Browser Installation Service
 *
 * Facilitates Brave Browser installation for AI web search and local testing.
 * Strictly adheres to safety and distribution compliance:
 * - Does NOT bundle the large Brave binary in the Ty-Code distribution package.
 * - Opens the official Brave download portal (https://brave.com/download/) via shell.openExternal.
 * - Provides an optional silent installer workflow downloading directly from official Brave HTTPS endpoints.
 * - Automatically re-verifies installation with detectBraveBrowser().
 *
 * Brand: Ty-Code
 */

import { shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { detectBraveBrowser, type BraveDetectionResult } from './brave-detector';

export interface BraveInstallOptions {
  silent?: boolean;
}

export interface BraveInstallResult extends BraveDetectionResult {
  success: boolean;
  openedUrl?: boolean;
  error?: string;
}

const BRAVE_OFFICIAL_DOWNLOAD_URL = 'https://brave.com/download/';
const BRAVE_LINUX_INSTALL_URL = 'https://brave.com/linux/';

// Official direct release installer endpoints
const BRAVE_WIN_STANDALONE_URL = 'https://laptop-updates.brave.com/latest/winx64';
const BRAVE_MAC_DMG_URL = 'https://laptop-updates.brave.com/latest/osx';

/**
 * Downloads a file from an HTTPS URL following redirects.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Follow 301 / 302 / 307 redirects
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download installer: HTTP ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      fileStream.on('error', (err) => {
        void fsp.unlink(destPath).catch(() => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      void fsp.unlink(destPath).catch(() => {});
      reject(err);
    });

    // 60-second download timeout
    request.setTimeout(60000, () => {
      request.destroy();
      void fsp.unlink(destPath).catch(() => {});
      reject(new Error('Download timed out after 60 seconds'));
    });
  });
}

/**
 * Executes a file asynchronously and returns its exit code.
 */
function runExecutable(executable: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code ?? 0));
  });
}

/**
 * Initiates the Brave Browser installation flow.
 *
 * By default, safely opens the official Brave download portal in the user's
 * default web browser for manual installation.
 * If `options.silent` is specified and supported on the OS, downloads the official
 * setup binary to a temporary directory and triggers installation.
 */
export async function installBraveBrowser(
  options: BraveInstallOptions = {}
): Promise<BraveInstallResult> {
  const platform = process.platform;

  try {
    // Check if already installed before initiating download
    const currentStatus = await detectBraveBrowser();
    if (currentStatus.installed) {
      return {
        success: true,
        installed: true,
        executablePath: currentStatus.executablePath
      };
    }

    // Silent automated installer option (Windows & macOS)
    if (options.silent) {
      if (platform === 'win32') {
        const tempExePath = path.join(os.tmpdir(), `BraveBrowserSetup-${Date.now()}.exe`);
        try {
          console.log('[BRAVE-INSTALLER] Downloading official Brave setup binary…');
          await downloadFile(BRAVE_WIN_STANDALONE_URL, tempExePath);

          console.log('[BRAVE-INSTALLER] Executing silent installer…');
          await runExecutable(tempExePath, ['/silent', '/install']);

          // Cleanup temp installer
          void fsp.unlink(tempExePath).catch(() => {});

          // Re-detect post installation
          const postDetect = await detectBraveBrowser();
          return {
            success: postDetect.installed,
            installed: postDetect.installed,
            executablePath: postDetect.executablePath
          };
        } catch (downloadErr) {
          console.warn('[BRAVE-INSTALLER] Silent download failed, falling back to browser download page:', downloadErr);
          // Fall through to browser download page on failure
        }
      } else if (platform === 'darwin') {
        const tempDmgPath = path.join(os.tmpdir(), `Brave-Browser-${Date.now()}.dmg`);
        try {
          console.log('[BRAVE-INSTALLER] Downloading official macOS dmg…');
          await downloadFile(BRAVE_MAC_DMG_URL, tempDmgPath);
          await shell.openPath(tempDmgPath);

          const postDetect = await detectBraveBrowser();
          return {
            success: true,
            installed: postDetect.installed,
            executablePath: postDetect.executablePath
          };
        } catch (downloadErr) {
          console.warn('[BRAVE-INSTALLER] macOS direct download failed, falling back to browser page:', downloadErr);
        }
      }
    }

    // Primary & default compliant method: Open official portal in user browser
    const targetUrl = platform === 'linux' ? BRAVE_LINUX_INSTALL_URL : BRAVE_OFFICIAL_DOWNLOAD_URL;
    await shell.openExternal(targetUrl);

    // Give user time or re-detect current state
    const postDetect = await detectBraveBrowser();
    return {
      success: true,
      openedUrl: true,
      installed: postDetect.installed,
      executablePath: postDetect.executablePath
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[BRAVE-INSTALLER] Installation flow error:', errorMsg);
    const postDetect = await detectBraveBrowser();
    return {
      success: false,
      installed: postDetect.installed,
      executablePath: postDetect.executablePath,
      error: errorMsg
    };
  }
}
