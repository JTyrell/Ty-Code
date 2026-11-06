/**
 * Canvas Component Library Bookmarks (M3E Sketcher — Prompt 4, Step 1)
 *
 * Favorites (starred) and recently-used component ids, persisted PER WORKSPACE
 * under `tycode.canvas.library`. A component id is the string the LibraryPanel
 * keys rows by — a project component's `name` (e.g. "Button") or a primitive's
 * `type` (e.g. "container"). Keeping one flat id space lets both library groups
 * share the same star / recents machinery.
 *
 * Follows the canvas-settings pattern: an in-memory cache + listener set, a
 * localStorage write, and a `storage`-event re-read so an already-open Sketcher
 * (same origin) adopts changes live.
 */

const STORAGE_PREFIX = 'tycode.canvas.library';
const MAX_RECENTS = 8;

export interface LibraryBookmarks {
  favorites: string[];
  recents: string[];
}

export const EMPTY_BOOKMARKS: LibraryBookmarks = { favorites: [], recents: [] };

interface Persisted {
  favorites: string[];
  recents: string[];
}

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

const keyFor = (workspaceId: string): string => `${STORAGE_PREFIX}::${workspaceId}`;

const readFor = (workspaceId: string): LibraryBookmarks => {
  try {
    if (typeof localStorage === 'undefined') return { favorites: [], recents: [] };
    const raw = localStorage.getItem(keyFor(workspaceId));
    if (!raw) return { favorites: [], recents: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      favorites: readStringArray(parsed.favorites),
      recents: readStringArray(parsed.recents).slice(0, MAX_RECENTS)
    };
  } catch {
    return { favorites: [], recents: [] };
  }
};

type Listener = (bookmarks: LibraryBookmarks) => void;

interface Entry {
  cache: LibraryBookmarks;
  listeners: Set<Listener>;
}
const entries = new Map<string, Entry>();

const entryFor = (workspaceId: string): Entry => {
  let entry = entries.get(workspaceId);
  if (!entry) {
    entry = { cache: readFor(workspaceId), listeners: new Set() };
    entries.set(workspaceId, entry);
  }
  return entry;
};

const emit = (workspaceId: string): void => {
  const entry = entries.get(workspaceId);
  if (!entry) return;
  const snapshot = entry.cache;
  for (const listener of entry.listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('[canvas-library] listener threw', err);
    }
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || !event.key.startsWith(`${STORAGE_PREFIX}::`)) return;
    const workspaceId = event.key.slice(`${STORAGE_PREFIX}::`.length);
    const entry = entries.get(workspaceId);
    if (!entry) return;
    entry.cache = readFor(workspaceId);
    emit(workspaceId);
  });
}

export const getLibraryBookmarks = (workspaceId: string): LibraryBookmarks => entryFor(workspaceId).cache;

const write = (workspaceId: string, next: LibraryBookmarks): void => {
  const entry = entryFor(workspaceId);
  entry.cache = next;
  try {
    localStorage.setItem(keyFor(workspaceId), JSON.stringify(next));
  } catch {
    /* storage unavailable — the in-memory value still applies for this session */
  }
  emit(workspaceId);
};

export const toggleFavorite = (workspaceId: string, id: string): LibraryBookmarks => {
  const current = entryFor(workspaceId).cache;
  const favorites = current.favorites.includes(id)
    ? current.favorites.filter((f) => f !== id)
    : [id, ...current.favorites];
  write(workspaceId, { favorites, recents: current.recents });
  return entryFor(workspaceId).cache;
};

/** Mark a component as just-used: de-dup and move it to the front of recents. */
export const recordRecent = (workspaceId: string, id: string): LibraryBookmarks => {
  const current = entryFor(workspaceId).cache;
  const recents = [id, ...current.recents.filter((r) => r !== id)].slice(0, MAX_RECENTS);
  // A no-op reorder (already first) skips the write to avoid churn.
  if (current.recents.length > 0 && current.recents[0] === id) return current;
  write(workspaceId, { favorites: current.favorites, recents });
  return entryFor(workspaceId).cache;
};

export const subscribeLibraryBookmarks = (workspaceId: string, listener: Listener): (() => void) => {
  const entry = entryFor(workspaceId);
  entry.listeners.add(listener);
  listener(entry.cache);
  return () => {
    entry.listeners.delete(listener);
  };
};
