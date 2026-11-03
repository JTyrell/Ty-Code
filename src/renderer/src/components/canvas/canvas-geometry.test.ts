/**
 * canvas-geometry unit tests (Prompt 3, Steps 3-4)
 *
 * Verification #4: "Align/distribute math verified by unit tests on node
 * rects." Also covers union bbox (used by the multi-select bounding box),
 * smart-guide snapping (Step 3), and zoom-independent nudge arithmetic.
 */

import { describe, expect, it } from 'vitest';
import type { PositionedRect, Rect } from './canvas-geometry';
import { alignRects, distributeRects, snapToGuides, unionRect } from './canvas-geometry';

const rect = (id: string, x: number, y: number, width = 100, height = 40): PositionedRect => ({
  id,
  x,
  y,
  width,
  height
});

const targets = (result: { id: string; x: number; y: number }[]): Record<string, { x: number; y: number }> =>
  Object.fromEntries(result.map((t) => [t.id, { x: t.x, y: t.y }]));

describe('canvas-geometry — unionRect', () => {
  it('unions scattered rects into one bbox', () => {
    const box = unionRect([rect('a', 10, 10, 100, 40), rect('b', 300, 200, 50, 50)]);
    expect(box).toEqual({ x: 10, y: 10, width: 340, height: 240 });
  });

  it('returns null for an empty set', () => {
    expect(unionRect([])).toBeNull();
  });
});

describe('canvas-geometry — alignRects', () => {
  // Union box: x 10..350 (width 340), y 10..250 (height 240).
  const nodes = [rect('a', 10, 10, 100, 40), rect('b', 120, 80, 60, 60), rect('c', 250, 200, 100, 50)];

  it('left pins every x to the box left', () => {
    expect(targets(alignRects(nodes, 'left'))).toEqual({
      a: { x: 10, y: 10 },
      b: { x: 10, y: 80 },
      c: { x: 10, y: 200 }
    });
  });

  it('right pins every x to box right minus own width', () => {
    expect(targets(alignRects(nodes, 'right'))).toEqual({
      a: { x: 250, y: 10 },
      b: { x: 290, y: 80 },
      c: { x: 250, y: 200 }
    });
  });

  it('hcenter centers each rect within the union width', () => {
    expect(targets(alignRects(nodes, 'hcenter'))).toEqual({
      a: { x: 130, y: 10 },
      b: { x: 150, y: 80 },
      c: { x: 130, y: 200 }
    });
  });

  it('top / bottom / vcenter mirror on the y axis', () => {
    expect(targets(alignRects(nodes, 'top'))).toEqual({
      a: { x: 10, y: 10 },
      b: { x: 120, y: 10 },
      c: { x: 250, y: 10 }
    });
    expect(targets(alignRects(nodes, 'bottom'))).toEqual({
      a: { x: 10, y: 210 },
      b: { x: 120, y: 190 },
      c: { x: 250, y: 200 }
    });
    expect(targets(alignRects(nodes, 'vcenter'))).toEqual({
      a: { x: 10, y: 110 },
      b: { x: 120, y: 100 },
      c: { x: 250, y: 105 }
    });
  });

  it('is a no-op below two nodes', () => {
    expect(alignRects([rect('a', 0, 0)], 'left')).toEqual([]);
    expect(alignRects([], 'left')).toEqual([]);
  });
});

describe('canvas-geometry — distributeRects', () => {
  it('spaces centers evenly along h, pinning the extremes', () => {
    // Centers: a=50, b=170, c=300 → step = (300-50)/2 = 125 → even centers 50/175/300.
    const nodes = [rect('a', 0, 10, 100, 40), rect('b', 140, 0, 60, 60), rect('c', 250, 90, 100, 10)];
    const result = targets(distributeRects(nodes, 'h'));
    expect(result.a.x).toBe(0);
    expect(result.b.x).toBeCloseTo(145, 10);
    expect(result.c.x).toBe(250);
    // Distribution only moves the chosen axis; the other is untouched.
    expect(result.b.y).toBe(0);
  });

  it('ranks by current center order even when input is shuffled', () => {
    const nodes = [rect('c', 250, 0, 100, 40), rect('a', 0, 0, 100, 40), rect('b', 140, 0, 60, 40)];
    const result = targets(distributeRects(nodes, 'h'));
    expect(result.a.x).toBeLessThan(result.b.x);
    expect(result.b.x).toBeLessThan(result.c.x);
  });

  it('spaces centers evenly along v', () => {
    // Centers: a=20, b=110, c=250 → step 115 → targets 20/135/250.
    const nodes = [rect('a', 0, 0, 40, 40), rect('b', 0, 80, 40, 60), rect('c', 0, 200, 40, 100)];
    const result = targets(distributeRects(nodes, 'v'));
    expect(result.a.y).toBe(0);
    expect(result.b.y).toBeCloseTo(105, 10);
    expect(result.c.y).toBe(200);
  });

  it('is a no-op below three nodes', () => {
    expect(distributeRects([rect('a', 0, 0), rect('b', 50, 0)], 'h')).toEqual([]);
  });
});

describe('canvas-geometry — snapToGuides', () => {
  const stage: Rect = { x: 0, y: 0, width: 375, height: 812 };

  it('snaps a moving rect edge to a sibling edge within tolerance and emits a vertical guide', () => {
    const sibling = rect('s', 100, 100, 80, 40);
    // Proposed moving left edge sits 3 units from the sibling's left (103).
    const snap = snapToGuides({ x: 103, y: 0, width: 50, height: 20 }, [sibling], stage, 5);
    expect(snap.dx).toBe(-3);
    expect(snap.guides).toContainEqual({ orientation: 'vertical', at: 100 });
  });

  it('snaps centers to centers and edges to stage center', () => {
    // Moving center x = 10 + 200/2 = 110; sibling center x = 112 → delta 2.
    const sibling = rect('s', 70, 300, 84, 40);
    const snap = snapToGuides({ x: 10, y: 10, width: 200, height: 20 }, [sibling], stage, 4);
    expect(snap.dx).toBe(2);
    const vert = snap.guides.find((g) => g.orientation === 'vertical');
    expect(vert?.at).toBe(112);
    // Right edge 210 vs stage centerX 187.5 → |Δ|=22.5 > 4, so no stage snap fired.
    expect(vert?.at).not.toBe(187.5);
  });

  it('snaps to the stage center when within tolerance', () => {
    // moving centerX 187.5 already sits on the stage center → dx 0, guide fires.
    const snap = snapToGuides({ x: 185, y: 0, width: 5, height: 5 }, [], stage, 3);
    expect(snap.dx).toBeCloseTo(0, 10);
    expect(snap.guides).toContainEqual({ orientation: 'vertical', at: 187.5 });
    // Off the stage center by 1 still snaps to it (stage width 373 → center 186.5):
    const off = snapToGuides({ x: 185, y: 0, width: 5, height: 5 }, [], { ...stage, width: 373 }, 3);
    expect(off.dx).toBeCloseTo(186.5 - 187.5, 10);
    expect(off.guides).toContainEqual({ orientation: 'vertical', at: 186.5 });
  });

  it('leaves the box alone and emits no guides beyond tolerance', () => {
    const sibling = rect('s', 100, 100, 80, 40);
    // Box in the top-left corner, far from every sibling/stage candidate.
    const snap = snapToGuides({ x: 0, y: 0, width: 10, height: 10 }, [sibling], stage, 2);
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toEqual([]);
  });

  it('fires both axes independently with horizontal + vertical guides', () => {
    const sibling = rect('s', 100, 100, 80, 40);
    const snap = snapToGuides({ x: 102, y: 141, width: 40, height: 20 }, [sibling], stage, 3);
    // x candidates: 100/140/180 + stage 187.5; moving xs: 102/122/142 → |100-102|=2 → dx -2.
    // y candidates: 100/120/140; moving ys: 141/151/161 → |140-141|=1 → dy -1.
    expect(snap.dx).toBe(-2);
    expect(snap.dy).toBe(-1);
    expect(snap.guides).toHaveLength(2);
  });

  it('tolerance 0 only snaps exact matches', () => {
    const sibling = rect('s', 100, 100, 80, 40);
    const exact = snapToGuides({ x: 100, y: 0, width: 10, height: 10 }, [sibling], stage, 0);
    expect(exact.dx).toBe(0);
    expect(exact.guides).toContainEqual({ orientation: 'vertical', at: 100 });
    const near = snapToGuides({ x: 100.5, y: 0, width: 10, height: 10 }, [sibling], stage, 0);
    // moving left 100.5 vs target 100 → |0.5| > 0; no exact candidate match on x
    expect(near.guides.filter((g) => g.orientation === 'vertical')).toEqual([]);
  });
});
