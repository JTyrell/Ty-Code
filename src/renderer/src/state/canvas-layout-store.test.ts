// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCanvasLayoutStore,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  selectLeftWidth,
  selectFocusMode,
  selectSections
} from './canvas-layout-store';
import type { SectionConfig } from './canvas-layout-store';

const STORE_KEY = 'tycode.canvas.layout';

interface PersistedShape {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftSections: SectionConfig[];
  rightSections: SectionConfig[];
}

const readPersisted = (): PersistedShape => {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) throw new Error('no persisted layout');
  return JSON.parse(raw) as PersistedShape;
};

// The store debounces its localStorage write (200ms) — advance the fake clock
// so a committed action is flushed before we inspect the persisted payload.
const flushPersist = (): void => {
  vi.advanceTimersByTime(300);
};

const state = () => useCanvasLayoutStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  state().resetLayout();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('canvas-layout-store width clamping', () => {
  it('clamps dragged panel width to the min/max bounds', () => {
    state().setPanelWidth('left', 100);
    expect(state().leftWidth).toBe(PANEL_MIN_WIDTH);
    state().setPanelWidth('left', 9999);
    expect(state().leftWidth).toBe(PANEL_MAX_WIDTH);
    state().setPanelWidth('right', 300);
    expect(state().rightWidth).toBe(300);
  });

  it('exposes width through a tiny atomic selector', () => {
    state().setPanelWidth('left', 260);
    expect(selectLeftWidth(state())).toBe(260);
  });

  it('persists the resized width so it survives a restart', () => {
    state().setPanelWidth('left', 340);
    flushPersist();
    expect(readPersisted().leftWidth).toBe(340);
  });
});

describe('canvas-layout-store collapse + focus mode', () => {
  it('toggles and sets collapsed state per panel', () => {
    expect(state().leftCollapsed).toBe(false);
    state().togglePanel('left');
    expect(state().leftCollapsed).toBe(true);
    state().setPanelCollapsed('right', true);
    expect(state().rightCollapsed).toBe(true);
    flushPersist();
    expect(readPersisted().leftCollapsed).toBe(true);
    expect(readPersisted().rightCollapsed).toBe(true);
  });

  it('focus mode is session-only and never written to storage', () => {
    state().setPanelWidth('left', 260);
    state().toggleFocusMode();
    expect(selectFocusMode(state())).toBe(true);
    flushPersist();
    const persisted = readPersisted() as PersistedShape & Record<string, unknown>;
    expect(persisted).not.toHaveProperty('focusMode');
    expect(persisted.leftWidth).toBe(260);
  });

  it('exiting focus mode restores the prior layout exactly', () => {
    state().setPanelCollapsed('left', true);
    state().setPanelWidth('right', 300);
    state().setFocusMode(true);
    state().setFocusMode(false);
    expect(state().leftCollapsed).toBe(true);
    expect(state().rightWidth).toBe(300);
    expect(selectFocusMode(state())).toBe(false);
  });

  it('isResizing is transient and not persisted', () => {
    state().setResizing(true);
    expect(state().isResizing).toBe(true);
    flushPersist();
    const persisted = readPersisted() as PersistedShape & Record<string, unknown>;
    expect(persisted).not.toHaveProperty('isResizing');
  });
});

describe('canvas-layout-store section customization', () => {
  const rightIds = () => selectSections('right')(state()).map((s) => s.id);

  it('collapses, hides and reorders right-panel sections', () => {
    expect(rightIds()).toEqual(['properties', 'styles', 'events', 'data']);

    state().toggleSectionCollapsed('right', 'styles');
    expect(state().rightSections.find((s) => s.id === 'styles')?.collapsed).toBe(true);

    state().setSectionVisible('right', 'events', false);
    expect(state().rightSections.find((s) => s.id === 'events')?.visible).toBe(false);

    state().moveSection('right', 'data', 'properties');
    expect(rightIds()).toEqual(['data', 'properties', 'styles', 'events']);
  });

  it('persists the reordered + re-toggled sections', () => {
    state().moveSection('right', 'data', 'properties');
    state().setSectionVisible('right', 'events', false);
    flushPersist();
    const persisted = readPersisted();
    expect(persisted.rightSections.map((s) => s.id)).toEqual(['data', 'properties', 'styles', 'events']);
    expect(persisted.rightSections.find((s) => s.id === 'events')?.visible).toBe(false);
  });

  it('ignores a no-op or unknown reorder target', () => {
    const before = rightIds();
    state().moveSection('right', 'styles', 'styles');
    expect(rightIds()).toEqual(before);
    // @ts-expect-error exercising an invalid id at runtime
    state().moveSection('right', 'ghost', 'properties');
    expect(rightIds()).toEqual(before);
  });
});

describe('canvas-layout-store reset', () => {
  it('resetLayout returns defaults and persists them', () => {
    state().setPanelWidth('left', 400);
    state().togglePanel('right');
    state().resetLayout();
    expect(state().leftWidth).toBe(DEFAULT_LEFT_WIDTH);
    expect(state().rightWidth).toBe(DEFAULT_RIGHT_WIDTH);
    expect(state().rightCollapsed).toBe(false);
    flushPersist();
    const persisted = readPersisted();
    expect(persisted.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
    expect(persisted.rightWidth).toBe(DEFAULT_RIGHT_WIDTH);
    expect(persisted.leftSections.map((s) => s.id)).toEqual(['library', 'layers']);
  });
});
