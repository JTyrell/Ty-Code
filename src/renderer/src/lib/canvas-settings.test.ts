// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCanvasSettings,
  setCanvasSettings,
  subscribeCanvasSettings,
  canvasThemeVars,
  DEFAULT_CANVAS_SETTINGS
} from './canvas-settings';
import type { CanvasChromeTheme, CanvasSettings } from './canvas-settings';

const STORAGE_KEY = 'tycode.canvas.settings';

beforeEach(() => {
  localStorage.clear();
  // Reset the module cache back to the shipped defaults for a clean slate.
  setCanvasSettings(DEFAULT_CANVAS_SETTINGS);
});

describe('canvas-settings clamping', () => {
  it('clamps out-of-range values to their bounds', () => {
    expect(setCanvasSettings({ defaultZoom: 99 }).defaultZoom).toBe(4);
    expect(setCanvasSettings({ gridSpacing: 1 }).gridSpacing).toBe(4);
    expect(setCanvasSettings({ snapTolerance: 500 }).snapTolerance).toBe(64);
    expect(setCanvasSettings({ defaultLeftWidth: 10 }).defaultLeftWidth).toBe(220);
    expect(setCanvasSettings({ defaultRightWidth: 9999 }).defaultRightWidth).toBe(480);
  });

  it('coerces an unknown chrome theme to dark', () => {
    const patch = { chromeTheme: 'neon' as unknown as CanvasChromeTheme };
    expect(setCanvasSettings(patch).chromeTheme).toBe('dark');
  });

  it('accepts a valid accent theme', () => {
    expect(setCanvasSettings({ chromeTheme: 'accent' }).chromeTheme).toBe('accent');
  });
});

describe('canvas-settings persistence + live read', () => {
  it('writes the normalized value to storage and reflects it in memory', () => {
    setCanvasSettings({ gridSpacing: 40 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect((JSON.parse(raw ?? '{}') as CanvasSettings).gridSpacing).toBe(40);
    expect(getCanvasSettings().gridSpacing).toBe(40);
  });
});

describe('canvas-settings subscription', () => {
  it('notifies immediately, on each change, and stops after unsubscribe', () => {
    const seen: number[] = [];
    const unsub = subscribeCanvasSettings((s) => seen.push(s.gridSpacing));
    expect(seen).toHaveLength(1); // immediate snapshot on subscribe

    setCanvasSettings({ gridSpacing: 32 });
    expect(seen[seen.length - 1]).toBe(32);

    unsub();
    setCanvasSettings({ gridSpacing: 48 });
    expect(seen[seen.length - 1]).toBe(32); // no further delivery after unsub
  });
});

describe('canvasThemeVars', () => {
  it('dark defers to the global palette (no overrides)', () => {
    expect(canvasThemeVars('dark')).toEqual({});
  });

  it('light and accent return distinct scoped custom-property overrides', () => {
    const light = canvasThemeVars('light');
    const accent = canvasThemeVars('accent');
    expect(light['--bg-primary']).toBeTruthy();
    expect(accent['--bg-primary']).toBeTruthy();
    expect(light['--bg-primary']).not.toBe(accent['--bg-primary']);
  });
});
