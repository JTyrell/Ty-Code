/**
 * Canvas Layout Store (M3E Sketcher — Prompt 2)
 *
 * Holds the Sketcher's customizable chrome: left / right panel widths, their
 * collapsed rails, per-section configuration (visibility, collapse and order),
 * and a session-only focus mode. Panel widths and section configuration persist
 * to localStorage; focus mode deliberately does not (it is a transient "eyes on
 * the canvas" state that must restore the prior layout on exit).
 *
 * The store exposes tiny atomic selectors so a panel-drag or a section toggle
 * re-renders only the slice that changed — the stage itself never subscribes to
 * width during a drag (see `isResizing`), which is what keeps the viewport's
 * ResizeObserver from thrashing every pointermove.
 */

import { create } from 'zustand';

export type CanvasSectionId =
  | 'library'
  | 'layers'
  | 'properties'
  | 'styles'
  | 'events'
  | 'data';

export type CanvasPanelId = 'left' | 'right';

export interface SectionConfig {
  id: CanvasSectionId;
  visible: boolean;
  collapsed: boolean;
}

export const PANEL_MIN_WIDTH = 220;
export const PANEL_MAX_WIDTH = 480;
export const DEFAULT_LEFT_WIDTH = 232;
export const DEFAULT_RIGHT_WIDTH = 250;

const clampWidth = (value: number): number =>
  Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(value)));

const DEFAULT_LEFT_SECTIONS: SectionConfig[] = [
  { id: 'library', visible: true, collapsed: false },
  { id: 'layers', visible: true, collapsed: false }
];

const DEFAULT_RIGHT_SECTIONS: SectionConfig[] = [
  { id: 'properties', visible: true, collapsed: false },
  { id: 'styles', visible: true, collapsed: false },
  { id: 'events', visible: true, collapsed: false },
  { id: 'data', visible: true, collapsed: false }
];

interface PersistedLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftSections: SectionConfig[];
  rightSections: SectionConfig[];
}

interface CanvasLayoutState extends PersistedLayout {
  /** Session-only: hides both panels + chrome. Never written to storage. */
  focusMode: boolean;
  /** True while a resize handle is being dragged; the stage ignores width. */
  isResizing: boolean;
  /** Set once the narrow-window auto-collapse has fired this session. */
  autoCollapsedOnce: boolean;

  setPanelWidth: (panel: CanvasPanelId, width: number) => void;
  setResizing: (resizing: boolean) => void;
  togglePanel: (panel: CanvasPanelId) => void;
  setPanelCollapsed: (panel: CanvasPanelId, collapsed: boolean) => void;
  setFocusMode: (on: boolean) => void;
  toggleFocusMode: () => void;
  markAutoCollapsed: () => void;
  toggleSectionCollapsed: (panel: CanvasPanelId, id: CanvasSectionId) => void;
  setSectionVisible: (panel: CanvasPanelId, id: CanvasSectionId, visible: boolean) => void;
  moveSection: (panel: CanvasPanelId, dragId: CanvasSectionId, overId: CanvasSectionId) => void;
  resetLayout: () => void;
}

const STORAGE_KEY = 'tycode.canvas.layout';

const loadLayout = (): PersistedLayout => {
  const base: PersistedLayout = {
    leftWidth: DEFAULT_LEFT_WIDTH,
    rightWidth: DEFAULT_RIGHT_WIDTH,
    leftCollapsed: false,
    rightCollapsed: false,
    leftSections: DEFAULT_LEFT_SECTIONS,
    rightSections: DEFAULT_RIGHT_SECTIONS
  };
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    return {
      leftWidth: typeof parsed.leftWidth === 'number' ? clampWidth(parsed.leftWidth) : base.leftWidth,
      rightWidth: typeof parsed.rightWidth === 'number' ? clampWidth(parsed.rightWidth) : base.rightWidth,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
      leftSections: reconcileSections(parsed.leftSections, DEFAULT_LEFT_SECTIONS),
      rightSections: reconcileSections(parsed.rightSections, DEFAULT_RIGHT_SECTIONS)
    };
  } catch {
    return base;
  }
};

/**
 * Rebuild a persisted section list against the known defaults: keep the stored
 * order and flags for recognized ids, drop corrupt/unknown entries, and append
 * any section the defaults gained since the snapshot was written (so new
 * sections surface instead of silently vanishing).
 */
const reconcileSections = (
  stored: SectionConfig[] | undefined,
  defaults: SectionConfig[]
): SectionConfig[] => {
  if (!Array.isArray(stored)) return defaults.map((s) => ({ ...s }));
  const byId = new Map<CanvasSectionId, SectionConfig>();
  for (const item of stored) {
    if (item && typeof item.id === 'string' && defaults.some((d) => d.id === item.id)) {
      byId.set(item.id, {
        id: item.id,
        visible: item.visible !== false,
        collapsed: item.collapsed === true
      });
    }
  }
  const ordered: SectionConfig[] = [];
  for (const item of stored) {
    const hit = byId.get(item.id);
    if (hit && !ordered.some((s) => s.id === hit.id)) ordered.push(hit);
  }
  for (const def of defaults) {
    if (!ordered.some((s) => s.id === def.id)) ordered.push({ ...def });
  }
  return ordered;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const persist = (state: CanvasLayoutState): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedLayout = {
      leftWidth: state.leftWidth,
      rightWidth: state.rightWidth,
      leftCollapsed: state.leftCollapsed,
      rightCollapsed: state.rightCollapsed,
      leftSections: state.leftSections,
      rightSections: state.rightSections
    };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* storage unavailable — layout simply re-defaults next open */
      }
    }, 200);
  } catch {
    /* ignore */
  }
};

const sectionsFor = (state: CanvasLayoutState, panel: CanvasPanelId): SectionConfig[] =>
  panel === 'left' ? state.leftSections : state.rightSections;

export const useCanvasLayoutStore = create<CanvasLayoutState>((set, get) => {
  const commit = (patch: Partial<CanvasLayoutState>): void => {
    set(patch);
    persist(get());
  };

  return {
    ...loadLayout(),
    focusMode: false,
    isResizing: false,
    autoCollapsedOnce: false,

    setPanelWidth: (panel, width) => {
      const clamped = clampWidth(width);
      commit(panel === 'left' ? { leftWidth: clamped } : { rightWidth: clamped });
    },

    setResizing: (resizing) => set({ isResizing: resizing }),

    togglePanel: (panel) => {
      const state = get();
      commit(panel === 'left' ? { leftCollapsed: !state.leftCollapsed } : { rightCollapsed: !state.rightCollapsed });
    },

    setPanelCollapsed: (panel, collapsed) => {
      commit(panel === 'left' ? { leftCollapsed: collapsed } : { rightCollapsed: collapsed });
    },

    setFocusMode: (on) => set({ focusMode: on }),
    toggleFocusMode: () => set({ focusMode: !get().focusMode }),
    markAutoCollapsed: () => set({ autoCollapsedOnce: true }),

    toggleSectionCollapsed: (panel, id) => {
      const state = get();
      const next = sectionsFor(state, panel).map((s) =>
        s.id === id ? { ...s, collapsed: !s.collapsed } : s
      );
      commit(panel === 'left' ? { leftSections: next } : { rightSections: next });
    },

    setSectionVisible: (panel, id, visible) => {
      const state = get();
      const next = sectionsFor(state, panel).map((s) => (s.id === id ? { ...s, visible } : s));
      commit(panel === 'left' ? { leftSections: next } : { rightSections: next });
    },

    // Move `dragId` to sit where `overId` currently is, preserving the rest.
    moveSection: (panel, dragId, overId) => {
      if (dragId === overId) return;
      const state = get();
      const list = [...sectionsFor(state, panel)];
      const from = list.findIndex((s) => s.id === dragId);
      const to = list.findIndex((s) => s.id === overId);
      if (from === -1 || to === -1) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      commit(panel === 'left' ? { leftSections: list } : { rightSections: list });
    },

    resetLayout: () => {
      commit({
        leftWidth: DEFAULT_LEFT_WIDTH,
        rightWidth: DEFAULT_RIGHT_WIDTH,
        leftCollapsed: false,
        rightCollapsed: false,
        leftSections: DEFAULT_LEFT_SECTIONS.map((s) => ({ ...s })),
        rightSections: DEFAULT_RIGHT_SECTIONS.map((s) => ({ ...s }))
      });
    }
  };
});

// --- Atomic selectors --------------------------------------------------------
// Each returns one primitive so a subscriber re-renders only when that value
// changes; `shallow`-free reads keep width/collapse/focus independent.

export const selectLeftWidth = (s: CanvasLayoutState): number => s.leftWidth;
export const selectRightWidth = (s: CanvasLayoutState): number => s.rightWidth;
export const selectLeftCollapsed = (s: CanvasLayoutState): boolean => s.leftCollapsed;
export const selectRightCollapsed = (s: CanvasLayoutState): boolean => s.rightCollapsed;
export const selectFocusMode = (s: CanvasLayoutState): boolean => s.focusMode;
export const selectIsResizing = (s: CanvasLayoutState): boolean => s.isResizing;
export const selectLeftSections = (s: CanvasLayoutState): SectionConfig[] => s.leftSections;
export const selectRightSections = (s: CanvasLayoutState): SectionConfig[] => s.rightSections;

export const selectSections = (panel: CanvasPanelId) => (s: CanvasLayoutState): SectionConfig[] =>
  panel === 'left' ? s.leftSections : s.rightSections;
