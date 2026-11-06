/**
 * Canvas Export Target Store (Prompt 4 extension — Section F)
 *
 * Persists the chosen dialect-export target PER DOCUMENT (keyed by the workspace
 * root) under `tycode.canvas.target::${docId}`. Deliberately separate from the
 * structural node `CanvasPlatform` (which stays on the AST) — this is only the
 * export/format selector, so switching a target never mutates canvas nodes or the
 * device-frame-independent snapshot.
 *
 * Mirrors `canvas-responsive-store.ts`: memoized per-document cache + listener
 * set, cross-window sync through the same-origin `storage` event, and a disposer
 * return so callers register disposable subscriptions.
 */

import { isCanvasTargetId, type CanvasTargetId } from '../../../shared/canvas-platform-registry';

const STORAGE_PREFIX = 'tycode.canvas.target::';
const DEFAULT_TARGET: CanvasTargetId = 'react-web';

const keyFor = (docId: string): string => `${STORAGE_PREFIX}${docId}`;

const normalize = (value: unknown): CanvasTargetId =>
  isCanvasTargetId(value) ? value : DEFAULT_TARGET;

const readFor = (docId: string): CanvasTargetId => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TARGET;
    const raw = localStorage.getItem(keyFor(docId));
    if (!raw) return DEFAULT_TARGET;
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_TARGET;
  }
};

type Listener = (target: CanvasTargetId) => void;

interface TargetEntry {
  cache: CanvasTargetId;
  listeners: Set<Listener>;
}
const entries = new Map<string, TargetEntry>();

const entryFor = (docId: string): TargetEntry => {
  let entry = entries.get(docId);
  if (!entry) {
    entry = { cache: readFor(docId), listeners: new Set() };
    entries.set(docId, entry);
  }
  return entry;
};

const emit = (docId: string): void => {
  const entry = entries.get(docId);
  if (!entry) return;
  const snapshot = entry.cache;
  for (const listener of entry.listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('[canvas-target] listener threw', err);
    }
  }
};

// A write from another same-origin window (Sketcher <-> live preview) arrives as a
// `storage` event; re-read the affected document and broadcast so an open surface
// adopts the target switch live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null) return;
    if (!event.key.startsWith(STORAGE_PREFIX)) return;
    const docId = event.key.slice(STORAGE_PREFIX.length);
    const entry = entries.get(docId);
    if (!entry) return;
    entry.cache = readFor(docId);
    emit(docId);
  });
}

export const getCanvasTarget = (docId: string): CanvasTargetId => entryFor(docId).cache;

export const setCanvasTarget = (docId: string, target: CanvasTargetId): CanvasTargetId => {
  const entry = entryFor(docId);
  entry.cache = normalize(target);
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(entry.cache));
  } catch {
    /* storage unavailable — the in-memory value still applies for this session */
  }
  emit(docId);
  return entry.cache;
};

export const subscribeCanvasTarget = (docId: string, listener: Listener): (() => void) => {
  const entry = entryFor(docId);
  entry.listeners.add(listener);
  listener(entry.cache);
  return () => {
    entry.listeners.delete(listener);
  };
};
