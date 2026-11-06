// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampCustomWidth,
  resolveResponsiveWidth,
  getCanvasResponsive,
  setCanvasResponsive,
  subscribeCanvasResponsive,
  DEFAULT_RESPONSIVE,
  CUSTOM_WIDTH_MIN,
  CUSTOM_WIDTH_MAX,
  RESPONSIVE_PRESETS
} from './canvas-responsive-store';

/**
 * Prompt 4 Step 3 — responsive-preview store. The width clamp band (280-2560)
 * and the preset -> effective-width resolution are the load-bearing pure logic
 * shared by the design stage and the live preview `<webview>`.
 */

beforeEach(() => {
  localStorage.clear();
});

describe('clampCustomWidth', () => {
  it('clamps below the min and above the max', () => {
    expect(clampCustomWidth(10)).toBe(CUSTOM_WIDTH_MIN);
    expect(clampCustomWidth(99999)).toBe(CUSTOM_WIDTH_MAX);
    expect(CUSTOM_WIDTH_MIN).toBe(280);
    expect(CUSTOM_WIDTH_MAX).toBe(2560);
  });

  it('rounds and falls back to the default on non-finite input', () => {
    expect(clampCustomWidth(1280.6)).toBe(1281);
    expect(clampCustomWidth(Number.NaN)).toBe(DEFAULT_RESPONSIVE.customWidth);
  });
});

describe('resolveResponsiveWidth', () => {
  it("'auto' imposes no constraint", () => {
    expect(resolveResponsiveWidth({ preset: 'auto', customWidth: 800, orientation: 'portrait' })).toBeNull();
  });

  it('honours a numeric preset in portrait, widened in landscape', () => {
    expect(resolveResponsiveWidth({ preset: 360, customWidth: 800, orientation: 'portrait' })).toBe(360);
    const landscape = resolveResponsiveWidth({ preset: 360, customWidth: 800, orientation: 'landscape' });
    expect(landscape).not.toBeNull();
    expect(landscape as number).toBeGreaterThan(360);
    expect(landscape as number).toBeLessThanOrEqual(CUSTOM_WIDTH_MAX);
  });

  it('custom preset resolves to the clamped custom width', () => {
    expect(resolveResponsiveWidth({ preset: 'custom', customWidth: 4000, orientation: 'portrait' })).toBe(CUSTOM_WIDTH_MAX);
  });

  it('every advertised preset width is within the clamp band', () => {
    for (const option of RESPONSIVE_PRESETS) {
      if (option.width === null) continue;
      expect(option.width).toBeGreaterThanOrEqual(CUSTOM_WIDTH_MIN);
      expect(option.width).toBeLessThanOrEqual(CUSTOM_WIDTH_MAX);
    }
  });
});

describe('responsive persistence + subscription', () => {
  it('stores per document and normalizes an unknown preset to auto', () => {
    setCanvasResponsive('doc-r', { preset: 768 });
    expect(getCanvasResponsive('doc-r').preset).toBe(768);
    const coerced = setCanvasResponsive('doc-r2', { preset: 12345 as never });
    expect(coerced.preset).toBe('auto');
  });

  it('notifies immediately, on change, and stops after dispose', () => {
    const seen: Array<string | number> = [];
    const unsub = subscribeCanvasResponsive('doc-sub', (s) => seen.push(s.preset));
    expect(seen).toEqual([DEFAULT_RESPONSIVE.preset]);
    setCanvasResponsive('doc-sub', { preset: 1024 });
    expect(seen[seen.length - 1]).toBe(1024);
    unsub();
    setCanvasResponsive('doc-sub', { preset: 1440 });
    expect(seen[seen.length - 1]).toBe(1024);
  });
});
