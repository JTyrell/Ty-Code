/**
 * Ephemeral Profile Manager for Brave Browser Automation
 *
 * Provisions cryptographically unique, strictly isolated temporary directories
 * in the OS temp folder for Brave "Guest Mode" sessions.
 * Guarantees zero leakage of personal history, cookies, credentials, or session state.
 *
 * Automatically tracks and deletes all guest directories upon session close,
 * process exit, or Electron app termination.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Global registry of active ephemeral profile paths for process crash safety
const activeEphemeralProfiles = new Set<string>();
let processHooksRegistered = false;

/**
 * Registers exit and termination hooks to guarantee disk cleanup
 * even if the application crashes or exits abruptly.
 */
function registerCleanupHooks(): void {
  if (processHooksRegistered) return;
  processHooksRegistered = true;

  const syncCleanup = () => {
    for (const profilePath of activeEphemeralProfiles) {
      try {
        if (fs.existsSync(profilePath)) {
          fs.rmSync(profilePath, { recursive: true, force: true });
        }
      } catch (err) {
        // Suppress errors during process teardown
      }
    }
    activeEphemeralProfiles.clear();
  };

  process.on('exit', syncCleanup);
  process.on('SIGINT', () => {
    syncCleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    syncCleanup();
    process.exit(143);
  });

  // Hook Electron app before-quit if running in Electron environment
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.on === 'function') {
      app.on('before-quit', () => {
        syncCleanup();
      });
    }
  } catch {
    // Not running in Electron main process or electron module unavailable
  }
}

/**
 * Creates a unique, temporary guest profile directory in the OS temp folder.
 *
 * Format: `<os.tmpdir()>/tycode-brave-guest-<uuid>`
 * Directory permissions are strictly restricted to the current user (0o700).
 *
 * @returns Absolute path to the newly created ephemeral profile directory.
 */
export async function createEphemeralProfile(): Promise<string> {
  registerCleanupHooks();

  const uniqueId = crypto.randomUUID();
  const profileDirName = `tycode-brave-guest-${uniqueId}`;
  const profilePath = path.join(os.tmpdir(), profileDirName);

  // Secure directory creation with owner-only read/write/execute permissions (0o700)
  await fsp.mkdir(profilePath, { recursive: true, mode: 0o700 });
  activeEphemeralProfiles.add(profilePath);

  return profilePath;
}

// In-flight cleanup promises to prevent race conditions during teardown
const inFlightCleanups = new Map<string, Promise<void>>();

/**
 * Securely and recursively deletes an ephemeral guest profile directory.
 *
 * @param profilePath Absolute path to the temporary guest profile.
 */
export async function cleanupEphemeralProfile(profilePath: string): Promise<void> {
  if (!profilePath) return;

  activeEphemeralProfiles.delete(profilePath);

  if (inFlightCleanups.has(profilePath)) {
    return inFlightCleanups.get(profilePath)!;
  }

  const cleanupPromise = (async () => {
    // Retry up to 8 times to allow Windows OS handles (e.g. lockfile) to be completely released
    const maxRetries = 8;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (fs.existsSync(profilePath)) {
          await fsp.rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
        return;
      } catch (err: unknown) {
        if (attempt === maxRetries - 1) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[BRAVE-PROFILE] Failed to remove ephemeral profile ${profilePath}:`, errorMsg);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
    }
  })();

  inFlightCleanups.set(profilePath, cleanupPromise);
  try {
    await cleanupPromise;
  } finally {
    inFlightCleanups.delete(profilePath);
  }
}

/**
 * Clean up all tracked active ephemeral profiles.
 */
export async function cleanupAllEphemeralProfiles(): Promise<void> {
  const paths = Array.from(activeEphemeralProfiles);
  activeEphemeralProfiles.clear();

  await Promise.all(
    paths.map(async (profilePath) => {
      try {
        await fsp.rm(profilePath, { recursive: true, force: true });
      } catch {
        // Ignore errors during mass cleanup
      }
    })
  );
}

/**
 * Returns the count of currently active ephemeral profiles.
 */
export function getActiveEphemeralProfilesCount(): number {
  return activeEphemeralProfiles.size;
}
