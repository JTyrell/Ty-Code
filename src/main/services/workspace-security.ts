import { app } from 'electron';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

/**
 * Determines whether a directory is an application root, installation folder,
 * or system directory that should never be opened as a user workspace.
 */
export function isAppOrSystemDir(dirPath: string): boolean {
  if (!dirPath || typeof dirPath !== 'string') return true;
  try {
    const resolved = path.resolve(dirPath);
    const lower = resolved.toLowerCase().replace(/\\/g, '/');

    // Root paths (e.g. "C:\", "C:/", "/", "\")
    if (resolved === path.parse(resolved).root || lower === '/' || /^[a-z]:\/?$/i.test(resolved)) {
      return true;
    }

    // User home directory root (e.g. C:\Users\JT)
    const home = os.homedir().toLowerCase().replace(/\\/g, '/');
    if (lower === home) {
      return true;
    }

    // AppData / LocalAppData / Temp roots
    const appData = (process.env.APPDATA || '').toLowerCase().replace(/\\/g, '/');
    const localAppData = (process.env.LOCALAPPDATA || '').toLowerCase().replace(/\\/g, '/');
    const tempDir = os.tmpdir().toLowerCase().replace(/\\/g, '/');
    if (appData && (lower === appData || lower.startsWith(appData + '/ty-code') || lower.startsWith(appData + '/ty-claude') || lower.startsWith(appData + '/electron'))) {
      return true;
    }
    if (localAppData && (lower === localAppData || lower.startsWith(localAppData + '/temp') || lower.startsWith(localAppData + '/programs/ty-code') || lower.startsWith(localAppData + '/programs/ty-claude'))) {
      return true;
    }
    if (tempDir && lower === tempDir) {
      return true;
    }

    // Windows / System32 / Program Files
    const programFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase().replace(/\\/g, '/');
    const programFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase().replace(/\\/g, '/');
    const winDir = (process.env.windir || process.env.SystemRoot || 'C:\\Windows').toLowerCase().replace(/\\/g, '/');
    if (lower.startsWith(programFiles) || lower.startsWith(programFilesX86) || lower.startsWith(winDir)) {
      return true;
    }

    // Executable directory (where Ty-Code.exe resides, e.g. dist-release/win-unpacked or install dir)
    try {
      if (process.execPath) {
        const execDir = path.dirname(process.execPath).toLowerCase().replace(/\\/g, '/');
        if (lower === execDir || lower.startsWith(execDir + '/')) {
          return true;
        }
      }
    } catch {}

    // app.getAppPath()
    try {
      if (app && typeof app.getAppPath === 'function') {
        const appPath = path.resolve(app.getAppPath()).toLowerCase().replace(/\\/g, '/');
        if (lower === appPath || lower.startsWith(appPath + '/')) {
          return true;
        }
      }
    } catch {}

    // process.resourcesPath
    try {
      if (process.resourcesPath) {
        const resPath = path.resolve(process.resourcesPath).toLowerCase().replace(/\\/g, '/');
        if (lower === resPath || lower.startsWith(resPath + '/')) {
          return true;
        }
      }
    } catch {}

    // Common packaging / app folder signatures
    if (
      lower.includes('/win-unpacked') ||
      lower.includes('/mac-unpacked') ||
      lower.includes('/linux-unpacked') ||
      lower.includes('/dist-release') ||
      lower.endsWith('/resources') ||
      lower.endsWith('/resources/app') ||
      lower.endsWith('/resources/app.asar')
    ) {
      return true;
    }

    // Directory contains electron app artifacts (Ty-Code.exe, resources.pak, chrome_100_percent.pak, etc.)
    try {
      if (
        fsSync.existsSync(path.join(resolved, 'Ty-Code.exe')) ||
        fsSync.existsSync(path.join(resolved, 'ty-code.exe')) ||
        (fsSync.existsSync(path.join(resolved, 'resources.pak')) && fsSync.existsSync(path.join(resolved, 'v8_context_snapshot.bin')))
      ) {
        return true;
      }
    } catch {}

    return false;
  } catch {
    return true;
  }
}
