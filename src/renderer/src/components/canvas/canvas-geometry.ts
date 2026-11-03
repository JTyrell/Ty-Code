/**
 * Canvas Geometry (M3E Sketcher — Prompt 3, Steps 3-4)
 *
 * Pure, DOM-free math over axis-aligned rects in canvas units. Everything here
 * works on plain `{ x, y, width, height }` shapes so the align / distribute /
 * smart-guide results are unit-testable against synthetic node rects with no
 * React or store in the loop. The Sketcher feeds these functions `nodeRect()`
 * values (top-left origin, matching `node.props.x/y/width/height`) and writes
 * the returned positions straight back through a history command.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedRect extends Rect {
  id: string;
}

/** A proposed move for one node: where its top-left should end up. */
export interface TargetPosition {
  id: string;
  x: number;
  y: number;
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

const left = (r: Rect): number => r.x;
const right = (r: Rect): number => r.x + r.width;
const top = (r: Rect): number => r.y;
const bottom = (r: Rect): number => r.y + r.height;
const centerX = (r: Rect): number => r.x + r.width / 2;
const centerY = (r: Rect): number => r.y + r.height / 2;

/** Axis-aligned union of a set of rects; null for an empty set. */
export const unionRect = (rects: Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, left(r));
    minY = Math.min(minY, top(r));
    maxX = Math.max(maxX, right(r));
    maxY = Math.max(maxY, bottom(r));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Align a group of rects to one edge/axis of their shared bounding box.
 * Returns only the coordinates that change (x OR y per kind), keyed by id, so
 * the caller can merge them into a `propsCommand` without disturbing the other
 * axis. A single selection is a no-op (empty result).
 */
export const alignRects = (rects: PositionedRect[], kind: AlignKind): TargetPosition[] => {
  if (rects.length < 2) return [];
  const box = unionRect(rects);
  if (!box) return [];
  return rects.map((r) => {
    switch (kind) {
      case 'left':
        return { id: r.id, x: box.x, y: r.y };
      case 'right':
        return { id: r.id, x: box.x + box.width - r.width, y: r.y };
      case 'hcenter':
        return { id: r.id, x: box.x + (box.width - r.width) / 2, y: r.y };
      case 'top':
        return { id: r.id, x: r.x, y: box.y };
      case 'bottom':
        return { id: r.id, x: r.x, y: box.y + box.height - r.height };
      case 'vcenter':
        return { id: r.id, x: r.x, y: box.y + (box.height - r.height) / 2 };
    }
  });
};

/**
 * Distribute equal gaps along one axis, keeping the extreme items pinned.
 * Centers are spaced evenly from the first to the last center. Fewer than three
 * items cannot form interior gaps, so it is a no-op.
 */
export const distributeRects = (rects: PositionedRect[], axis: 'h' | 'v'): TargetPosition[] => {
  if (rects.length < 3) return [];
  const centers = rects.map((r) => (axis === 'h' ? centerX(r) : centerY(r)));
  const min = Math.min(...centers);
  const max = Math.max(...centers);
  const step = (max - min) / (rects.length - 1);
  // Rank by current center so the k-th item lands at min + k*step (stable, and
  // the extremes stay put because their rank is 0 / length-1).
  const ranked = rects
    .map((r, i) => ({ r, c: centers[i], i }))
    .sort((a, b) => a.c - b.c);
  return ranked.map((entry, k) => {
    const target = min + step * k;
    if (axis === 'h') {
      return { id: entry.r.id, x: target - entry.r.width / 2, y: entry.r.y };
    }
    return { id: entry.r.id, x: entry.r.x, y: target - entry.r.height / 2 };
  });
};

// ---------------------------------------------------------------------------
// Smart guides
// ---------------------------------------------------------------------------

export interface GuideLine {
  orientation: 'vertical' | 'horizontal';
  /** The canvas-unit coordinate the guide sits on. */
  at: number;
}

export interface SnapResult {
  /** Adjustment to add to the moving box's proposed x/y. */
  dx: number;
  dy: number;
  guides: GuideLine[];
}

/** The six alignment candidate coordinates of a rect (left, centerX, right / top, centerY, bottom). */
const xSnapsOf = (r: Rect): number[] => [r.x, centerX(r), r.x + r.width];
const ySnapsOf = (r: Rect): number[] => [r.y, centerY(r), r.y + r.height];

/**
 * Snap a proposed moving box to sibling edges/centers and the stage center,
 * within `tolerance` canvas units. Returns the delta to apply and the guide
 * lines that fired (so the UI can draw them). Pure — no state, no DOM.
 *
 * `moving` is the selection bbox at its PROPOSED (already-dragged) position.
 * `siblings` are the other top-level rects to align to, and `stage` is the
 * canvas box whose center is always a candidate.
 */
export const snapToGuides = (
  moving: Rect,
  siblings: Rect[],
  stage: Rect,
  tolerance: number
): SnapResult => {
  let dx = 0;
  let dy = 0;
  const guides: GuideLine[] = [];

  // Candidate x-coordinates: siblings' left/center/right plus the stage center.
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  for (const s of siblings) {
    xTargets.push(...xSnapsOf(s));
    yTargets.push(...ySnapsOf(s));
  }
  xTargets.push(centerX(stage));
  yTargets.push(centerY(stage));

  const movingXs = xSnapsOf(moving);
  const movingYs = ySnapsOf(moving);

  let bestDx: number | null = null;
  let bestXGuide: number | null = null;
  for (const mx of movingXs) {
    for (const tx of xTargets) {
      const delta = tx - mx;
      if (Math.abs(delta) <= tolerance && (bestDx === null || Math.abs(delta) < Math.abs(bestDx))) {
        bestDx = delta;
        bestXGuide = tx;
      }
    }
  }
  let bestDy: number | null = null;
  let bestYGuide: number | null = null;
  for (const my of movingYs) {
    for (const ty of yTargets) {
      const delta = ty - my;
      if (Math.abs(delta) <= tolerance && (bestDy === null || Math.abs(delta) < Math.abs(bestDy))) {
        bestDy = delta;
        bestYGuide = ty;
      }
    }
  }

  if (bestDx !== null && bestXGuide !== null) {
    dx = bestDx;
    guides.push({ orientation: 'vertical', at: bestXGuide });
  }
  if (bestDy !== null && bestYGuide !== null) {
    dy = bestDy;
    guides.push({ orientation: 'horizontal', at: bestYGuide });
  }
  return { dx, dy, guides };
};
