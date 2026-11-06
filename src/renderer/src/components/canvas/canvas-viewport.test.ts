import { describe, expect, it } from 'vitest';
import {
  CanvasViewport,
  FIT_PADDING,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  pickTickStep,
  snapToGrid
} from './canvas-viewport';

const make = (origin = { x: 0, y: 0 }, size = { width: 1000, height: 800 }) => {
  const vp = new CanvasViewport();
  vp.setOrigin(origin.x, origin.y);
  vp.setSize(size.width, size.height);
  return vp;
};

describe('CanvasViewport coordinate round-trip', () => {
  it('screenToCanvas and canvasToScreen are exact inverses at every scale', () => {
    for (const scale of [0.25, 1, 2.5, 4]) {
      for (const origin of [{ x: 0, y: 0 }, { x: 137, y: -84 }]) {
        const vp = make(origin);
        vp.scale = scale;
        vp.tx = 42;
        vp.ty = -17;
        const canvas = { x: 313.7, y: 209.1 };
        const screen = vp.canvasToScreen(canvas.x, canvas.y);
        const back = vp.screenToCanvas(screen.x, screen.y);
        expect(back.x).toBeCloseTo(canvas.x, 6);
        expect(back.y).toBeCloseTo(canvas.y, 6);
      }
    }
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const vp = make({ x: 60, y: 40 });
    vp.scale = 1;
    vp.tx = 12;
    vp.ty = 8;
    const world = { x: 250, y: 175 };
    const cursor = vp.canvasToScreen(world.x, world.y);
    vp.zoomAt(cursor, 2.3);
    const stillUnder = vp.screenToCanvas(cursor.x, cursor.y);
    expect(stillUnder.x).toBeCloseTo(world.x, 4);
    expect(stillUnder.y).toBeCloseTo(world.y, 4);
  });

  it('a screen drag delta converts to canvas units by dividing by scale', () => {
    const vp = make();
    vp.scale = 2;
    const d = vp.screenDeltaToCanvas(40, 10);
    expect(d.x).toBeCloseTo(20);
    expect(d.y).toBeCloseTo(5);
  });
});

describe('CanvasViewport transforms', () => {
  it('clamps scale to the [0.10, 4.00] window', () => {
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(NaN)).toBe(1);
    const vp = make();
    vp.zoomAt({ x: 10, y: 10 }, 100);
    expect(vp.scale).toBe(MAX_SCALE);
    vp.zoomAt({ x: 10, y: 10 }, 0.0001);
    expect(vp.scale).toBe(MIN_SCALE);
  });

  it('panBy moves the translate in screen px', () => {
    const vp = make();
    vp.panBy(30, -12);
    expect(vp.tx).toBe(30);
    expect(vp.ty).toBe(-12);
  });

  it('fitToContent frames the content, centered, honoring padding', () => {
    const vp = make({ x: 0, y: 0 }, { width: 1000, height: 800 });
    vp.setContent({ x: 0, y: 0, width: 400, height: 300 });
    vp.fitToContent();
    expect(vp.scale).toBeCloseTo(Math.min((1000 - FIT_PADDING * 2) / 400, (800 - FIT_PADDING * 2) / 300), 6);
    // Content center lands on viewport center.
    const center = vp.canvasToScreen(200, 150);
    expect(center.x).toBeCloseTo(500, 3);
    expect(center.y).toBeCloseTo(400, 3);
    // Left edge sits exactly at the padding gutter.
    const leftEdge = vp.canvasToScreen(0, 0);
    expect(leftEdge.x).toBeCloseTo(FIT_PADDING, 3);
  });

  it('zoomToSelection frames the selection and falls back to content', () => {
    const vp = make({ x: 0, y: 0 }, { width: 600, height: 600 });
    vp.setContent({ x: 0, y: 0, width: 1000, height: 1000 });
    vp.setSelection({ x: 0, y: 0, width: 100, height: 100 });
    vp.zoomToSelection();
    const fittedToSelection = vp.scale;
    vp.setSelection(null);
    vp.zoomToSelection();
    expect(vp.scale).toBeLessThan(fittedToSelection); // zooms out to fit the larger content box
  });

  it('reset100 sets scale to 1 keeping the centered canvas point fixed', () => {
    const vp = make({ x: 0, y: 0 }, { width: 800, height: 600 });
    vp.scale = 2;
    vp.tx = 120;
    vp.ty = 80;
    const centerWorldBefore = vp.screenToCanvas(400, 300);
    vp.reset100();
    expect(vp.scale).toBe(1);
    const centerWorldAfter = vp.screenToCanvas(400, 300);
    expect(centerWorldAfter.x).toBeCloseTo(centerWorldBefore.x, 3);
    expect(centerWorldAfter.y).toBeCloseTo(centerWorldBefore.y, 3);
  });

  it('centerContent recenters the device at the current scale (no top-left pin)', () => {
    const vp = make({ x: 0, y: 0 }, { width: 1000, height: 800 });
    vp.setContent({ x: 0, y: 0, width: 390, height: 780 });
    // A default-zoom applied from origin leaves the device top-left anchored.
    vp.setScale(0.8);
    vp.centerContent();
    // Content center lands on viewport center, and the scale is untouched.
    expect(vp.scale).toBeCloseTo(0.8, 6);
    const center = vp.canvasToScreen(195, 390);
    expect(center.x).toBeCloseTo(500, 3);
    expect(center.y).toBeCloseTo(400, 3);
  });
});

describe('CanvasViewport grid / ruler helpers', () => {
  it('pickTickStep yields a step whose on-screen spacing clears the minimum', () => {
    for (const scale of [0.25, 0.5, 1, 2, 4]) {
      const step = pickTickStep(scale, 72);
      expect(step * scale).toBeGreaterThanOrEqual(72 - 1e-6);
    }
  });

  it('snapToGrid rounds to the nearest multiple and no-ops when disabled', () => {
    expect(snapToGrid(47, 10)).toBe(50);
    expect(snapToGrid(43, 10)).toBe(40);
    expect(snapToGrid(38, 0)).toBe(38);
  });

  it('minimap mapping round-trips canvas <-> minimap px', () => {
    const vp = make({ x: 0, y: 0 }, { width: 1000, height: 800 });
    vp.setContent({ x: -50, y: 20, width: 400, height: 300 });
    const m = vp.minimapMapping(180, 120);
    expect(m).not.toBeNull();
    if (!m) return;
    const canvasPoint = { x: 120, y: 90 };
    const mm = vp.canvasToMinimap(canvasPoint.x, canvasPoint.y, m);
    const back = vp.minimapToCanvas(mm.x, mm.y, m);
    expect(back.x).toBeCloseTo(canvasPoint.x, 4);
    expect(back.y).toBeCloseTo(canvasPoint.y, 4);
  });
});
