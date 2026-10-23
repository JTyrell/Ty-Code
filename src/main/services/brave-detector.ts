/**
 * Cross-Platform Brave Browser Detection Service
 *
 * Detects if Brave Browser is installed across Windows, macOS, and Linux
 * using native OS paths, registry queries, and executable lookups without
 * external dependencies.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BraveDetectionResult {
  installed: boolean;
  executablePath: string | null;
}

/**
 * Checks if a file exists and is accessible.
 */
async function fileExists(filePath: string): Promise<boolean> {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Queries Windows registry for registered application paths.
 */
async function queryWindowsRegistry(regPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', regPath, '/ve']);
    // Matches "(Default)    REG_SZ    C:\Path\To\brave.exe"
    const match = stdout.match(/REG_SZ\s+(.*)$/m);
    if (match && match[1]) {
      const candidate = match[1].trim().replace(/^"(.*)"$/, '$1');
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Key not found or query error
  }
  return null;
}

/**
 * Searches system PATH for a binary using `where` (Windows) or `which` (POSIX).
 */
async function findInPath(binaryName: string): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(command, [binaryName]);
    const firstLine = stdout.split('\n')[0]?.trim();
    if (firstLine && (await fileExists(firstLine))) {
      return firstLine;
    }
  } catch {
    // Not found in PATH
  }
  return null;
}

/**
 * Cross-Platform Brave Browser Detection
 *
 * Scans standard OS locations, environment variable targets, registry entries,
 * and system PATH to resolve the exact Brave executable path.
 */
export async function detectBraveBrowser(): Promise<BraveDetectionResult> {
  const platform = process.platform;

  // ==========================================
  // 1. WINDOWS DETECTION
  // ==========================================
  if (platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const windowsCandidatePaths = [
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    ];

    // Check filesystem candidate paths
    for (const candidate of windowsCandidatePaths) {
      if (await fileExists(candidate)) {
        return { installed: true, executablePath: candidate };
      }
    }

    // Check Windows Registry (HKLM & HKCU App Paths)
    const registryKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe'
    ];

    for (const key of registryKeys) {
      const regResolved = await queryWindowsRegistry(key);
      if (regResolved) {
        return { installed: true, executablePath: regResolved };
      }
    }

    // Fallback: check PATH
    const pathResolved = await findInPath('brave.exe');
    if (pathResolved) {
      return { installed: true, executablePath: pathResolved };
    }

    return { installed: false, executablePath: null };
  }

  // ==========================================
  // 2. MACOS (DARWIN) DETECTION
  // ==========================================
  if (platform === 'darwin') {
    const macCandidates = [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(os.homedir(), 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser')
    ];

    for (const candidate of macCandidates) {
      if (await fileExists(candidate)) {
        return { installed: true, executablePath: candidate };
      }
    }

    // Try Spotlight metadata query (mdfind)
    try {
      const { stdout } = await execFileAsync('mdfind', [
        "kMDItemCFBundleIdentifier == 'com.brave.Browser'"
      ]);
      const appPath = stdout.split('\n')[0]?.trim();
      if (appPath) {
        const binPath = path.join(appPath, 'Contents', 'MacOS', 'Brave Browser');
        if (await fileExists(binPath)) {
          return { installed: true, executablePath: binPath };
        }
      }
    } catch {
      // Spotlight index not available or query failed
    }

    const pathResolved = await findInPath('brave');
    if (pathResolved) {
      return { installed: true, executablePath: pathResolved };
    }

    return { installed: false, executablePath: null };
  }

  // ==========================================
  // 3. LINUX & UNIX DETECTION
  // ==========================================
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    const linuxCandidates = [
      '/usr/bin/brave-browser',
      '/usr/bin/brave-browser-stable',
      '/usr/bin/brave',
      '/snap/bin/brave',
      '/var/lib/flatpak/exports/bin/com.brave.Browser',
      path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', 'com.brave.Browser')
    ];

    for (const candidate of linuxCandidates) {
      if (await fileExists(candidate)) {
        return { installed: true, executablePath: candidate };
      }
    }

    // Try `which` lookups for common distribution package names
    for (const bin of ['brave-browser', 'brave-browser-stable', 'brave']) {
      const found = await findInPath(bin);
      if (found) {
        return { installed: true, executablePath: found };
      }
    }

    return { installed: false, executablePath: null };
  }

  return { installed: false, executablePath: null };
}
