/**
 * Ty-Code Desktop IDE - Extension Controls Service
 * Backs the VS Code parity "…" menu: registry update checks, bulk enable/disable,
 * auto-update preference persistence, and a real extension-bisect session that
 * flips actual enabled state through ExtensionManager (persisted + host-synced).
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import os from 'os';
import { extensionManager } from '../extension-manager';
import { openVsxClient } from '../marketplace/openvsx-client';
import type { InstalledExtension } from '../../../preload/types';
import type {
  ExtensionUpdateInfo,
  ExtensionBisectState,
  BulkToggleResult
} from '../../../shared/types/marketplace';

/**
 * SemVer comparison: returns true when `candidate` is strictly newer than `current`.
 * Handles pre-release suffixes conservatively (numeric core comparison only).
 */
export function isVersionNewer(candidate?: string, current?: string): boolean {
  if (!candidate || !current) return false;
  const core = (v: string) => v.split('-')[0];
  const candParts = core(candidate).split('.').map((p) => parseInt(p, 10) || 0);
  const curParts = core(current).split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(candParts.length, curParts.length);
  for (let i = 0; i < maxLen; i++) {
    const c = candParts[i] || 0;
    const r = curParts[i] || 0;
    if (c > r) return true;
    if (c < r) return false;
  }
  return false;
}

function getBaseDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Pure node test environment
  }
  return os.homedir();
}

/**
 * Bisect state machine: halves the candidate set each round by disabling one half
 * and asking the user whether the issue persists. Pure math lives in
 * `splitCandidates` so it is unit-testable without touching the manager.
 */
export function splitCandidates(candidates: string[]): { testHalf: string[]; keepHalf: string[] } {
  const mid = Math.ceil(candidates.length / 2);
  return { testHalf: candidates.slice(0, mid), keepHalf: candidates.slice(mid) };
}

export class ExtensionControlsService {
  private controlsFile: string;
  private bisect: ExtensionBisectState | null = null;

  constructor(customDir?: string) {
    const base = customDir || getBaseDir();
    const legacyDir = path.join(base, '.ty-claude', 'extensions');
    const newDir = path.join(base, '.ty-code', 'extensions');
    const extDir = existsSync(legacyDir) && !existsSync(newDir) ? legacyDir : newDir;
    this.controlsFile = path.join(extDir, 'controls.json');
  }

  // --------------------------------------------------------------------------
  // Auto-update preference (persisted next to installed.json)
  // --------------------------------------------------------------------------

  async getAutoUpdateEnabled(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.controlsFile, 'utf-8');
      const parsed = JSON.parse(raw) as { autoUpdate?: unknown };
      return parsed.autoUpdate !== false;
    } catch {
      return true;
    }
  }

  async setAutoUpdateEnabled(enabled: boolean): Promise<boolean> {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await fs.readFile(this.controlsFile, 'utf-8')) as Record<string, unknown>;
    } catch {
      // first write or corrupt file: start fresh
    }
    current.autoUpdate = enabled;
    await fs.mkdir(path.dirname(this.controlsFile), { recursive: true });
    const tempFile = `${this.controlsFile}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(current, null, 2), 'utf-8');
    await fs.rename(tempFile, this.controlsFile);
    return enabled;
  }

  // --------------------------------------------------------------------------
  // Update checking
  // --------------------------------------------------------------------------

  collectUserExtensions(): InstalledExtension[] {
    return extensionManager.getInstalledExtensions().filter((ext) => !ext.isBuiltIn);
  }

  /**
   * Checks every installed (non built-in) extension against Open VSX.
   * Registry metadata is disk-cached by the client, so repeat checks are cheap.
   */
  async checkForUpdates(): Promise<ExtensionUpdateInfo[]> {
    await extensionManager.init();
    const updates: ExtensionUpdateInfo[] = [];
    const candidates = this.collectUserExtensions();

    for (const ext of candidates) {
      const dotIndex = ext.id.indexOf('.');
      if (dotIndex <= 0 || dotIndex >= ext.id.length - 1) continue;
      const namespace = ext.id.slice(0, dotIndex);
      const name = ext.id.slice(dotIndex + 1);
      try {
        const meta = await openVsxClient.getMetadata(namespace, name);
        if (meta && isVersionNewer(meta.version, ext.manifest.version)) {
          updates.push({
            id: ext.id,
            displayName: ext.manifest.displayName || meta.displayName || name,
            installedVersion: ext.manifest.version,
            latestVersion: meta.version,
            downloadUrl: meta.downloadUrl,
            sha256: meta.sha256,
            iconUrl: meta.iconUrl
          });
        }
      } catch {
        // Registry unreachable for this item: skip silently, the banner already
        // surfaces global failures through marketplace search.
      }
    }
    return updates;
  }

  // --------------------------------------------------------------------------
  // Bulk enable / disable
  // --------------------------------------------------------------------------

  async toggleAllExtensions(enabled: boolean): Promise<BulkToggleResult> {
    await extensionManager.init();
    const result: BulkToggleResult = { changed: 0, skippedMetadataOnly: [], failed: [] };

    for (const ext of extensionManager.getInstalledExtensions()) {
      if (ext.enabled === enabled) continue;
      try {
        await extensionManager.toggleExtension(ext.id, enabled);
        result.changed += 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('execution is disabled')) {
          result.skippedMetadataOnly.push(ext.id);
        } else {
          result.failed.push({ id: ext.id, error: msg });
        }
      }
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Extension bisect (real enabled-state halving)
  // --------------------------------------------------------------------------

  private async setEnabled(id: string, enabled: boolean): Promise<void> {
    try {
      await extensionManager.toggleExtension(id, enabled);
    } catch {
      // metadata-only guards or transient host errors must not abort a bisect step
    }
  }

  private async applyDisabledSet(disabled: Set<string>, all: string[]): Promise<void> {
    for (const id of all) {
      await this.setEnabled(id, !disabled.has(id));
    }
  }

  async startBisect(): Promise<ExtensionBisectState> {
    await extensionManager.init();
    const suspects = this.collectUserExtensions().map((ext) => ext.id);
    if (suspects.length === 0) {
      throw new Error('No installable (non built-in) extensions to bisect.');
    }

    const baseline: Record<string, boolean> = {};
    for (const ext of extensionManager.getInstalledExtensions()) {
      baseline[ext.id] = ext.enabled;
    }

    const { testHalf } = splitCandidates(suspects);
    await this.applyDisabledSet(new Set(testHalf), suspects);

    this.bisect = {
      active: true,
      round: 1,
      suspects,
      candidates: suspects.slice(),
      disabledThisRound: testHalf,
      baseline
    };
    return this.bisect;
  }

  /**
   * Report the result of the current round.
   * `issuePresent = true`  → culprit is among still-enabled candidates.
   * `issuePresent = false` → culprit is among the disabled half (re-enabled now).
   */
  async reportBisectRound(issuePresent: boolean): Promise<ExtensionBisectState> {
    if (!this.bisect || !this.bisect.active) {
      throw new Error('No extension bisect session is running.');
    }
    const session = this.bisect;
    const disabledSet = new Set(session.disabledThisRound);

    // Restore every candidate first, then narrow to the guilty half.
    for (const id of session.candidates) {
      await this.setEnabled(id, true);
    }

    const nextCandidates = issuePresent
      ? session.candidates.filter((id) => !disabledSet.has(id))
      : session.candidates.filter((id) => disabledSet.has(id));

    if (nextCandidates.length === 0) {
      session.identified = undefined;
      session.active = false;
      session.candidates = [];
      session.disabledThisRound = [];
      return session;
    }

    if (nextCandidates.length === 1) {
      await this.setEnabled(nextCandidates[0], true);
      session.identified = nextCandidates[0];
      session.active = false;
      session.candidates = nextCandidates;
      session.disabledThisRound = [];
      return session;
    }

    session.candidates = nextCandidates;
    session.round += 1;
    const { testHalf } = splitCandidates(nextCandidates);
    for (const id of testHalf) {
      await this.setEnabled(id, false);
    }
    session.disabledThisRound = testHalf;
    return session;
  }

  async stopBisect(restoreBaseline = true): Promise<ExtensionBisectState | null> {
    if (!this.bisect) return null;
    const session = this.bisect;
    if (restoreBaseline) {
      for (const [id, enabled] of Object.entries(session.baseline)) {
        await this.setEnabled(id, enabled);
      }
    }
    session.active = false;
    session.disabledThisRound = [];
    this.bisect = null;
    return session;
  }

  getBisectState(): ExtensionBisectState | null {
    return this.bisect;
  }
}

export const extensionControls = new ExtensionControlsService();
