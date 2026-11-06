/**
 * Canvas Responsive Preview (M3E Sketcher — Prompt 4, Step 3)
 *
 * A single source of truth for the Sketcher's "responsive preview" viewport,
 * shared by BOTH surfaces of the tool:
 *   • the design stage (`M3ECanvas`) constrains its stage root to the width, and
 *   • the live preview host (`CanvasPreviewHost`) sets the `<webview>` width,
 * so a preset applied in either mode is mirrored in the other.
 *
 * The state persists PER DOCUMENT (keyed by the workspace root) under
 * `tycode.canvas.responsive`, so reopening a project restores its last viewport.
 * Cross-window writes land through the `storage` event (same origin), so an
 * already-open Sketcher adopts the change live — the same mechanism the canvas
 * settings use.
 */

export type ResponsivePreset = 'auto' | 360 | 768 | 1024 | 1440 | 'custom';
export type ResponsiveOrientation = 'portrait' | 'landscape';

export interface ResponsiveState {
  /** Active preset. `'custom'` uses `customWidth`; `'auto'` imposes no constraint. */
  preset: ResponsivePreset;
  /** Custom width in CSS px, honoured only when `preset === 'custom'`. */
  customWidth: number;
  /** Swaps the effective width/height emphasis for landscape devices. */
  orientation: ResponsiveOrientation;
}

export const CUSTOM_WIDTH_MIN = 280;
export const CUSTOM_WIDTH_MAX = 2560;

export const RESPONSIVE_PRESETS: Array<{ value: ResponsivePreset; label: string; width: number | null }> = [
  { value: 'auto', label: 'Auto', width: null },
  { value: 360, label: '360', width: 360 },
  { value: 768, label: '768', width: 768 },
  { value: 1024, label: '1024', width: 1024 },
  { value: 1440, label: '1440', width: 1440 },
  { value: 'custom', label: 'Custom', width: null }
];

export const DEFAULT_RESPONSIVE: ResponsiveState = {
  preset: 'auto',
  customWidth: 1280,
  orientation: 'portrait'
};

export const clampCustomWidth = (value: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_RESPONSIVE.customWidth;
  return Math.max(CUSTOM_WIDTH_MIN, Math.min(CUSTOM_WIDTH_MAX, Math.round(n)));
};

/** The base width (CSS px) a preset implies, or null when unconstrained. */
const presetWidth = (state: ResponsiveState): number | null => {
  if (state.preset === 'auto') return null;
  if (state.preset === 'custom') return clampCustomWidth(state.customWidth);
  return state.preset;
};

/**
 * The effective stage/webview width for the current state. Portrait honours the
 * preset width directly; landscape keeps the same device but flips emphasis, so
 * the width becomes the taller (landscape) dimension — preset × ~1.7 capped to
 * the custom range. 'auto' imposes nothing.
 */
export const resolveResponsiveWidth = (state: ResponsiveState): number | null => {
  const base = presetWidth(state);
  if (base === null) return null;
  if (state.orientation === 'portrait') return base;
  // Landscape: widen toward the long edge, clamped to the same 280–2560 band.
  return Math.max(CUSTOM_WIDTH_MIN, Math.min(CUSTOM_WIDTH_MAX, Math.round(base * 1.7)));
};

const normalize = (parsed: Partial<ResponsiveState> | null | undefined): ResponsiveState => {
  const src = parsed ?? {};
  const validPreset: ResponsivePreset =
    src.preset === 'auto' || src.preset === 'custom'
      ? src.preset
      : ([360, 768, 1024, 1440] as number[]).includes(src.preset as number)
        ? (src.preset as ResponsivePreset)
        : DEFAULT_RESPONSIVE.preset;
  return {
    preset: validPreset,
    customWidth: clampCustomWidth(src.customWidth as number),
    orientation: src.orientation === 'landscape' ? 'landscape' : 'portrait'
  };
};

const keyFor = (docId: string): string => `tycode.canvas.responsive::${docId}`;

const readFor = (docId: string): ResponsiveState => {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_RESPONSIVE };
    const raw = localStorage.getItem(keyFor(docId));
    if (!raw) return { ...DEFAULT_RESPONSIVE };
    return normalize(JSON.parse(raw) as Partial<ResponsiveState>);
  } catch {
    return { ...DEFAULT_RESPONSIVE };
  }
};

type Listener = (state: ResponsiveState) => void;

/**
 * Per-document store instance. `getCanvasResponsive(docId)` memoizes one cache
 * + listener set per document id so switching documents never leaks state.
 */
interface ResponsiveEntry {
  cache: ResponsiveState;
  listeners: Set<Listener>;
}
const entries = new Map<string, ResponsiveEntry>();

const entryFor = (docId: string): ResponsiveEntry => {
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
      console.error('[canvas-responsive] listener threw', err);
    }
  }
};

// A write from another same-origin window arrives as a `storage` event; re-read
// the affected document and broadcast so an open Sketcher adopts it live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null) return;
    if (!event.key.startsWith('tycode.canvas.responsive::')) return;
    const docId = event.key.slice('tycode.canvas.responsive::'.length);
    const entry = entries.get(docId);
    if (!entry) return;
    entry.cache = readFor(docId);
    emit(docId);
  });
}

export const getCanvasResponsive = (docId: string): ResponsiveState => entryFor(docId).cache;

export const setCanvasResponsive = (docId: string, patch: Partial<ResponsiveState>): ResponsiveState => {
  const entry = entryFor(docId);
  entry.cache = normalize({ ...entry.cache, ...patch });
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(entry.cache));
  } catch {
    /* storage unavailable — the in-memory value still applies for this session */
  }
  emit(docId);
  return entry.cache;
};

export const subscribeCanvasResponsive = (docId: string, listener: Listener): (() => void) => {
  const entry = entryFor(docId);
  entry.listeners.add(listener);
  listener(entry.cache);
  return () => {
    entry.listeners.delete(listener);
  };
};
