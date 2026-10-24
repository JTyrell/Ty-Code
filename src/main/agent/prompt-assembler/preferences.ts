/**
 * Ty-Code Role Preferences persistence layer (Deliverable 2)
 *
 * Per-workspace (.tycode/role-preferences.json) and per-user
 * (~/.tycode/role-preferences.json) overrides for role injection, mode
 * defaults, quest gating, and token budgets.
 *
 * - Zod schema v1 with secret-shape rejection
 * - Atomic write (tmp file + fs.rename)
 * - deepMerge precedence: project > global > built-in defaults
 * - Migrator map (1→2 etc.)
 * - Corruption quarantine + recovery
 * - fs.watch hot reload (300ms debounce) emitting 'preferences:changed'
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { RolePreferencesSchema, type RolePreferences, type RolePreferencesRaw, containsSecretShape } from './schemas';

/* ---------------------------------------------------------------- paths */

function projectPrefsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.tycode', 'role-preferences.json');
}

function globalPrefsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.tycode', 'role-preferences.json');
}

/* ---------------------------------------------------------------- defaults & migrator */

const BUILTIN_DEFAULTS: RolePreferences = {
  version: 1,
  defaultMode: 'BUILD',
  roleOverrides: { pin: [], ban: [], prefer: {} },
  scopeOverrides: {},
  questGate: { autoApproveMedium: false, requireApprovalFrom: 'Large' },
  tokenBudget: { systemPromptFraction: 0.12, maxRoles: 2 },
  conventions: { autoExtract: true, refreshOnHeadChange: true },
  modeBySignal: {}
};

const MIGRATORS: Record<number, (prev: any) => RolePreferences> = {
  1: (prev) => RolePreferencesSchema.parse(prev)
};

function migrate(raw: any): RolePreferences {
  const version = typeof raw?.version === 'number' ? raw.version : 0;
  if (version > 1) {
    // Unknown higher version → read-only mode, warn
    console.warn(`[ROLE-PREFS] version ${version} > 1: read-only mode, no migration`);
    return { ...BUILTIN_DEFAULTS, version };
  }
  let migrated: any = raw;
  for (let v = 1; v < version; v++) {
    const migrator = MIGRATORS[v];
    if (migrator) migrated = migrator(migrated);
  }
  return RolePreferencesSchema.parse(migrated ?? BUILTIN_DEFAULTS);
}

/* ---------------------------------------------------------------- deep merge */

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) continue;
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && out[key] !== null && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      (out as any)[key] = deepMerge(out[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      (out as any)[key] = val;
    }
  }
  return out as T;
}

/* ---------------------------------------------------------------- load */

export async function loadPreferences(workspaceRoot: string): Promise<RolePreferences> {
  let merged: RolePreferences = { ...BUILTIN_DEFAULTS };

  // Global (lowest precedence after builtin)
  try {
    const gRaw = await fsp.readFile(globalPrefsPath(), 'utf8');
    const gParsed = JSON.parse(gRaw);
    if (containsSecretShape(gParsed)) {
      console.warn('[ROLE-PREFS] global file rejected: secret-shaped value detected');
    } else {
      merged = deepMerge(merged, migrate(gParsed));
    }
  } catch {
    // no global file — use builtin
  }

  // Project (highest)
  try {
    const pRaw = await fsp.readFile(projectPrefsPath(workspaceRoot), 'utf8');
    const pParsed = JSON.parse(pRaw);
    if (containsSecretShape(pParsed)) {
      console.warn('[ROLE-PREFS] project file rejected: secret-shaped value detected');
    } else {
      merged = deepMerge(merged, migrate(pParsed));
    }
  } catch {
    // no project file — global/builtin stands
  }

  return RolePreferencesSchema.parse(merged);
}

/* ---------------------------------------------------------------- save (atomic) */

export async function savePreferences(workspaceRoot: string, prefs: RolePreferencesRaw): Promise<RolePreferences> {
  if (containsSecretShape(prefs)) {
    throw new Error('PREF_ERR_SECRET_SHAPE: preferences contain a secret-shaped value (sk-..., Bearer token, ...). Write rejected.');
  }
  const validated = RolePreferencesSchema.parse({ ...prefs, version: 1, updatedAt: new Date().toISOString() });
  const cachePath = projectPrefsPath(workspaceRoot);
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = cachePath + `.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(validated, null, 2));
  await fsp.rename(tmp, cachePath);
  return validated;
}

export async function resetPreferences(workspaceRoot: string): Promise<RolePreferences> {
  const cachePath = projectPrefsPath(workspaceRoot);
  try {
    await fsp.unlink(cachePath);
  } catch {
    // ignore missing
  }
  return loadPreferences(workspaceRoot);
}

/* ---------------------------------------------------------------- watcher */

const watchers = new Map<string, { watcher: fs.FSWatcher; emitter: EventEmitter; debounceTimer: NodeJS.Timeout | null }>();

const DEBOUNCE_MS = 300;

export function watchPreferences(workspaceRoot: string, emitter: EventEmitter): () => void {
  let entry = watchers.get(workspaceRoot);
  if (!entry) {
    const watcher = fs.watch(path.dirname(projectPrefsPath(workspaceRoot)), { recursive: false });
    entry = { watcher, emitter, debounceTimer: null };
    watchers.set(workspaceRoot, entry);

    watcher.on('event', (_eventType, filename) => {
      if (filename && !filename.includes('role-preferences')) return;
      if (!entry) return;
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      const emitter = entry.emitter;
      entry.debounceTimer = setTimeout(async () => {
        try {
          const next = await loadPreferences(workspaceRoot);
          emitter.emit('preferences:changed', next);
        } catch {
          // corruption handled inside loadPreferences (falls back)
        }
      }, DEBOUNCE_MS);
    });
  }
  return () => {
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    watchers.delete(workspaceRoot);
  };
}

/* ---------------------------------------------------------------- corruption quarantine */

export async function quarantineCorrupt(workspaceRoot: string, reason: string): Promise<string | null> {
  const cachePath = projectPrefsPath(workspaceRoot);
  try {
    await fsp.access(cachePath);
    const ts = Date.now();
    const corruptPath = cachePath + `.corrupt-${ts}.json`;
    await fsp.rename(cachePath, corruptPath);
    console.warn(`[ROLE-PREFS] quarantined corrupt project preferences to ${corruptPath}: ${reason}`);
    return corruptPath;
  } catch {
    return null;
  }
}
