/**
 * Brave Browser Launch & Automation Core
 *
 * Automates the locally detected Brave Browser using Playwright (playwright-core).
 * CRITICAL PRIVACY & SECURITY REQUIREMENT:
 * Launches strictly in "Guest Mode" with an isolated ephemeral user profile directory.
 * The AI is physically prevented from accessing existing user bookmarks, browsing history,
 * cookies, or saved credentials.
 *
 * Brand: Ty-Code
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { detectBraveBrowser } from '../brave-detector';
import { createEphemeralProfile, cleanupEphemeralProfile } from './ephemeral-profile';

export interface BraveLaunchOptions {
  headless?: boolean;
  timeoutMs?: number;
  additionalArgs?: string[];
}

export interface BraveSessionHandle {
  browser: Browser;
  context: BrowserContext;
  profilePath: string;
  activePage: Page;
}

// Track active sessions with their ephemeral profile paths for safe lifecycle cleanup
const activeSessions = new Map<string, BraveSessionHandle>();
let primarySession: BraveSessionHandle | null = null;

/**
 * Mandatory guest isolation flags.
 * --user-data-dir is supplied to Playwright persistent context to isolate storage completely.
 */
export const MANDATORY_BRAVE_ISOLATION_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--guest',
  '--incognito',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-component-update'
];

/**
 * Launches Brave Browser in an isolated, ephemeral Guest Mode.
 *
 * Uses the locally detected Brave executable without downloading external Chromium binaries.
 * Allocates a unique temporary directory in OS temp and binds it via --user-data-dir.
 *
 * @param executablePath Path to the local brave executable (defaults to auto-detected path).
 * @param options Headless mode and optional launch configurations.
 * @returns Connected Playwright Browser instance.
 */
export async function launchBraveGuestMode(
  executablePath?: string,
  options: BraveLaunchOptions = {}
): Promise<Browser> {
  let resolvedPath = executablePath;
  if (!resolvedPath) {
    const detected = await detectBraveBrowser();
    if (!detected.installed || !detected.executablePath) {
      throw new Error(
        'Brave Browser is not installed or could not be detected. Please install Brave Browser before launching.'
      );
    }
    resolvedPath = detected.executablePath;
  }

  // 1. Create a pristine, isolated ephemeral profile in OS temp
  const ephemeralProfilePath = await createEphemeralProfile();

  const launchArgs = [
    ...MANDATORY_BRAVE_ISOLATION_FLAGS,
    `--user-data-dir=${ephemeralProfilePath}`,
    ...(options.additionalArgs || [])
  ];

  try {
    // 2. Launch persistent context with Playwright targeting local Brave
    const context = await chromium.launchPersistentContext(ephemeralProfilePath, {
      executablePath: resolvedPath,
      headless: options.headless ?? true,
      args: MANDATORY_BRAVE_ISOLATION_FLAGS,
      timeout: options.timeoutMs ?? 30000,
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Brave/124'
    });

    const browser = context.browser() ?? (context as unknown as Browser);
    const existingPages = context.pages();
    const activePage = existingPages.length > 0 ? existingPages[0] : await context.newPage();

    const sessionId = `brave_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const handle: BraveSessionHandle = {
      browser,
      context,
      profilePath: ephemeralProfilePath,
      activePage
    };

    activeSessions.set(sessionId, handle);
    primarySession = handle;

    // Hook cleanup if browser or context closes
    context.on('close', () => {
      activeSessions.delete(sessionId);
      if (primarySession === handle) primarySession = null;
      void cleanupEphemeralProfile(ephemeralProfilePath);
    });

    return browser;
  } catch (err: unknown) {
    // Cleanup temporary profile immediately if launch fails
    await cleanupEphemeralProfile(ephemeralProfilePath);
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to launch Brave in Guest Mode: ${errorMsg}`);
  }
}

/**
 * Returns the currently active primary Brave session handle, if one exists.
 */
export function getPrimaryBraveSession(): BraveSessionHandle | null {
  return primarySession;
}

/**
 * Gracefully closes the active Brave session and securely deletes the ephemeral profile.
 *
 * @param browser Optional specific browser instance to close; closes the primary session if omitted.
 */
export async function closeBraveSession(browser?: Browser): Promise<void> {
  let targetHandle: BraveSessionHandle | null = null;
  let targetSessionId: string | null = null;

  if (browser) {
    for (const [id, handle] of activeSessions.entries()) {
      if (handle.browser === browser || (handle.context as unknown as Browser) === browser) {
        targetHandle = handle;
        targetSessionId = id;
        break;
      }
    }
  } else {
    targetHandle = primarySession;
    if (targetHandle) {
      for (const [id, handle] of activeSessions.entries()) {
        if (handle === targetHandle) {
          targetSessionId = id;
          break;
        }
      }
    }
  }

  if (targetHandle) {
    try {
      await targetHandle.context.close();
    } catch {
      // Ignore errors if already closed
    }

    if (targetSessionId) {
      activeSessions.delete(targetSessionId);
    }
    if (primarySession === targetHandle) {
      primarySession = null;
    }

    // Securely wipe ephemeral guest profile directory from disk
    await cleanupEphemeralProfile(targetHandle.profilePath);
  }
}

/**
 * Closes all active Brave automation sessions and wipes all ephemeral directories.
 */
export async function closeAllBraveSessions(): Promise<void> {
  const sessions = Array.from(activeSessions.values());
  activeSessions.clear();
  primarySession = null;

  await Promise.all(
    sessions.map(async (handle) => {
      try {
        await handle.context.close();
      } catch {}
      await cleanupEphemeralProfile(handle.profilePath);
    })
  );
}
