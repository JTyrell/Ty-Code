/**
 * Canvas Settings (M3E Sketcher — Prompt 2, Step 4)
 *
 * The Sketcher's tunable defaults: starting zoom, grid spacing, snap tolerance,
 * whether the grid / rulers / minimap chrome starts on, the canvas chrome theme
 * and the default panel widths. These live in localStorage under one key so the
 * main-window Settings modal can edit them and an already-open Sketcher window
 * (same origin) picks the change up live through the `storage` event — no
 * restart, no IPC round-trip.
 *
 * Within the editing window we also fire a synthetic event so the modal's own
 * preview (and any same-window subscriber) updates immediately.
 */

export type CanvasChromeTheme = 'dark' | 'light' | 'accent';

export interface CanvasSettings {
  /** Scale applied when a document opens with no saved viewport. */
  defaultZoom: number;
  /** Dot-grid spacing in canvas units. */
  gridSpacing: number;
  /** Snap-to-grid tolerance in canvas units (0 disables alignment). */
  snapTolerance: number;
  gridDefault: boolean;
  rulersDefault: boolean;
  minimapDefault: boolean;
  chromeTheme: CanvasChromeTheme;
  defaultLeftWidth: number;
  defaultRightWidth: number;
  /**
   * Prompt 4 Step 5: a custom accent override (any CSS color). Empty string
   * means "follow the chrome theme". Sourced from the extracted DesignProfile
   * palette when the user picks one, but stored here so it survives
   * independently of the app theme.
   */
  accentColor: string;
  /**
   * Prompt 4 Step 5: the canvas stage background color. Empty string means
   * "follow the chrome theme" (var(--bg-primary)); otherwise a CSS color the
   * stage paints behind the device frame.
   */
  backgroundColor: string;
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  defaultZoom: 1,
  gridSpacing: 24,
  snapTolerance: 8,
  gridDefault: true,
  rulersDefault: true,
  minimapDefault: true,
  chromeTheme: 'dark',
  defaultLeftWidth: 232,
  defaultRightWidth: 250,
  accentColor: '',
  backgroundColor: ''
};

const STORAGE_KEY = 'tycode.canvas.settings';

const clamp = (value: number, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
};

const normalize = (parsed: Partial<CanvasSettings> | null | undefined): CanvasSettings => {
  const src = parsed ?? {};
  const theme: CanvasChromeTheme =
    src.chromeTheme === 'light' || src.chromeTheme === 'accent' ? src.chromeTheme : 'dark';
  return {
    defaultZoom: clamp(src.defaultZoom as number, 0.1, 4, DEFAULT_CANVAS_SETTINGS.defaultZoom),
    gridSpacing: clamp(src.gridSpacing as number, 4, 128, DEFAULT_CANVAS_SETTINGS.gridSpacing),
    snapTolerance: clamp(src.snapTolerance as number, 0, 64, DEFAULT_CANVAS_SETTINGS.snapTolerance),
    gridDefault: src.gridDefault !== false,
    rulersDefault: src.rulersDefault !== false,
    minimapDefault: src.minimapDefault !== false,
    chromeTheme: theme,
    defaultLeftWidth: clamp(src.defaultLeftWidth as number, 220, 480, DEFAULT_CANVAS_SETTINGS.defaultLeftWidth),
    defaultRightWidth: clamp(src.defaultRightWidth as number, 220, 480, DEFAULT_CANVAS_SETTINGS.defaultRightWidth),
    accentColor: typeof src.accentColor === 'string' ? src.accentColor.trim() : '',
    backgroundColor: typeof src.backgroundColor === 'string' ? src.backgroundColor.trim() : ''
  };
};

let cache: CanvasSettings = readFromStorage();

function readFromStorage(): CanvasSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_CANVAS_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CANVAS_SETTINGS };
    return normalize(JSON.parse(raw) as Partial<CanvasSettings>);
  } catch {
    return { ...DEFAULT_CANVAS_SETTINGS };
  }
}

type Listener = (settings: CanvasSettings) => void;
const listeners = new Set<Listener>();

const emit = (): void => {
  const snapshot = cache;
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('[canvas-settings] listener threw', err);
    }
  }
};

// A cross-window write lands here as a `storage` event (same origin). Re-read
// and broadcast so an open Sketcher adopts the new defaults live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    cache = readFromStorage();
    emit();
  });
}

export const getCanvasSettings = (): CanvasSettings => cache;

export const setCanvasSettings = (patch: Partial<CanvasSettings>): CanvasSettings => {
  cache = normalize({ ...cache, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — the in-memory value still applies for this session */
  }
  emit();
  return cache;
};

export const subscribeCanvasSettings = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(cache);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The palette a canvas surface adopts for its chrome under each theme. Values
 * are CSS custom-property overrides scoped to the Sketcher root element, so a
 * theme change recolours panels and toolbar live without touching global CSS.
 */
export const canvasThemeVars = (
  theme: CanvasChromeTheme,
  overrides?: { accentColor?: string; backgroundColor?: string }
): Record<string, string> => {
  const base: Record<string, string> = ((): Record<string, string> => {
  switch (theme) {
    case 'light':
      return {
        '--bg-primary': '#f5f6f8',
        '--bg-secondary': '#eceef2',
        '--bg-tertiary': '#d7dae1',
        '--text-primary': '#1a1d24',
        '--text-secondary': '#4a4f5a',
        '--text-muted': '#6b7280'
      };
    case 'accent':
      return {
        '--bg-primary': '#170f24',
        '--bg-secondary': '#211436',
        '--bg-tertiary': '#33224d',
        '--text-primary': '#efe7ff',
        '--text-secondary': '#c3b1e6',
        '--text-muted': '#9d86c9'
      };
    default:
      return {};
  }
  })();
  // Prompt 4 Step 5: a custom accent (from the design profile) recolours the
  // Sketcher's accent tokens, and an explicit background overrides the stage
  // fill — both applied ON TOP of the chrome theme, still independent of the
  // app theme because they live in their own localStorage key.
  const accent = overrides?.accentColor?.trim();
  if (accent) {
    base['--accent-primary'] = accent;
  }
  const background = overrides?.backgroundColor?.trim();
  if (background) {
    base['--canvas-bg'] = background;
  }
  return base;
};
