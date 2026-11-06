/**
 * Canvas Viewport service (M3E Sketcher — Prompt 1)
 *
 * A DOM-free transform for the M3E design stage: `state = { scale, tx, ty }`
 * applied to the stage wrapper as `transform: translate(tx, ty) scale(scale)`
 * with `transform-origin: 0 0`. It owns every piece of pointer geometry the
 * stage needs so that node drag, library drop, resize handles, the marquee, the
 * minimap and the rulers all resolve to the SAME canvas coordinate regardless of
 * zoom — the "correctness core" of the viewport upgrade.
 *
 * Two coordinate spaces, one class:
 *   - screen / client px  — what DOM pointer/wheel events report; relative to the
 *     viewport container, tracked via {@link CanvasViewport.setOrigin}.
 *   - canvas units         — the coordinate space nodes live in (`node.props.x/y`),
 *     which is the space the transform maps.
 *
 * `screenToCanvas` / `canvasToScreen` are exact inverses; the whole design rests
 * on that round-trip, which the paired unit test asserts at every scale.
 *
 * The class is intentionally imperative and holds its geometry context (origin,
 * container size, content box, selection box) so the exported method signatures
 * stay the clean `zoomAt(screenPoint, factor)` / `screenToCanvas(clientX, clientY)`
 * shape the spec asks for. React subscribes through {@link onChange}.
 */

export interface ViewportState {
  scale: number;
  tx: number;
  ty: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A box in canvas units (matches node `x/y/width/height` space). */
export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Hard zoom bounds the spec fixes: 10 % .. 400 %. */
export const MIN_SCALE = 0.10;
export const MAX_SCALE = 4.00;

/** Padding kept around the content when fitting (screen px). */
export const FIT_PADDING = 48;

/** Zoom presets offered in the floating cluster menu, as scale fractions. */
export const ZOOM_PRESETS: ReadonlyArray<{ label: string; scale: number }> = [
  { label: '25%', scale: 0.25 },
  { label: '50%', scale: 0.5 },
  { label: '75%', scale: 0.75 },
  { label: '100%', scale: 1 },
  { label: '150%', scale: 1.5 },
  { label: '200%', scale: 2 }
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Keep a scale inside the [0.10, 4.00] window. */
export const clampScale = (scale: number): number =>
  Number.isFinite(scale) ? clamp(scale, MIN_SCALE, MAX_SCALE) : 1;

/**
 * Round a canvas-unit length to the nearest multiple of `grid`, used for
 * snap-to-grid. A `grid <= 0` disables snapping and echoes the value back.
 */
export const snapToGrid = (value: number, grid: number): number =>
  grid > 0 ? Math.round(value / grid) * grid : value;

/**
 * Choose a "nice" ruler/grid step (in canvas units) so adjacent major ticks sit
 * at least `minScreenPx` apart on screen at the current zoom. Powers of a fixed
 * base keep labels readable and stable while zooming.
 */
export const pickTickStep = (scale: number, minScreenPx = 72): number => {
  const safeScale = clampScale(scale);
  const worldMin = minScreenPx / safeScale;
  const bases = [1, 2, 5];
  let exponent = Math.floor(Math.log10(worldMin));
  // Walk up decades until a base multiple clears the on-screen minimum.
  for (let guard = 0; guard < 12; guard += 1) {
    for (const base of bases) {
      const step = base * Math.pow(10, exponent);
      if (step * safeScale >= minScreenPx) return step;
    }
    exponent += 1;
  }
  return Math.pow(10, exponent);
};

/**
 * The viewport transform + coordinate algebra. One instance per open design
 * stage. Mutating methods emit {@link onChange} so the host React tree can
 * re-render; pure accessors (`screenToCanvas`, `canvasToScreen`, …) never do.
 */
export class CanvasViewport {
  scale = 1;
  tx = 0;
  ty = 0;

  /** Viewport container's client-space origin; set by the host on layout. */
  private origin: ScreenPoint = { x: 0, y: 0 };
  /** Viewport container size in client px. */
  private size = { width: 0, height: 0 };
  /** Bounding box of all content (canvas units), for fit-to-content. */
  private content: CanvasBox | null = null;
  /** Bounding box of the current selection (canvas units), for zoom-to-selection. */
  private selection: CanvasBox | null = null;

  /** Fired after any state mutation; the host bumps a render counter here. */
  onChange?: () => void;

  get state(): ViewportState {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  // -- geometry context (set by the host, not user-driven) ------------------

  setOrigin(left: number, top: number): void {
    this.origin = { x: left, y: top };
  }

  setSize(width: number, height: number): void {
    this.size = { width, height };
  }

  setContent(box: CanvasBox | null): void {
    this.content = box;
  }

  setSelection(box: CanvasBox | null): void {
    this.selection = box;
  }

  /**
   * Restore a persisted transform verbatim (clamped scale). Used on open; emits
   * so the first paint already reflects the saved viewport.
   */
  restore(next: ViewportState): void {
    this.scale = clampScale(next.scale);
    this.tx = Number.isFinite(next.tx) ? next.tx : 0;
    this.ty = Number.isFinite(next.ty) ? next.ty : 0;
    this.emit();
  }

  // -- coordinate conversions (exact inverses) ------------------------------

  /** Client px → canvas units. */
  screenToCanvas(clientX: number, clientY: number): ScreenPoint {
    return {
      x: (clientX - this.origin.x - this.tx) / this.scale,
      y: (clientY - this.origin.y - this.ty) / this.scale
    };
  }

  /** Canvas units → client px. */
  canvasToScreen(x: number, y: number): ScreenPoint {
    return {
      x: x * this.scale + this.tx + this.origin.x,
      y: y * this.scale + this.ty + this.origin.y
    };
  }

  /** Canvas units → px local to the viewport container (rulers / minimap). */
  canvasToLocal(x: number, y: number): ScreenPoint {
    return { x: x * this.scale + this.tx, y: y * this.scale + this.ty };
  }

  /**
   * Convert a screen-space length (e.g. a pointer delta in client px) to canvas
   * units. This is the piece the old drag handler got wrong: it added raw client
   * px straight onto canvas-unit node coords, so a dragged node drifted at any
   * zoom != 1. Route every drag/resize delta through here.
   */
  screenDeltaToCanvas(dx: number, dy: number): ScreenPoint {
    return { x: dx / this.scale, y: dy / this.scale };
  }

  /** A canvas length expressed in the units needed to stay `cssPx` on screen. */
  constantOnScreen(cssPx: number): number {
    return cssPx / this.scale;
  }

  // -- transforms -----------------------------------------------------------

  /**
   * Zoom by `factor` keeping `screenPoint` (client px) pinned under the cursor:
   * the canvas point currently beneath it maps to the same client px afterwards.
   */
  zoomAt(screenPoint: ScreenPoint, factor: number): void {
    const nextScale = clampScale(this.scale * factor);
    if (nextScale === this.scale) return;
    const lx = screenPoint.x - this.origin.x;
    const ly = screenPoint.y - this.origin.y;
    const ratio = nextScale / this.scale;
    // local = t + W*scale, W fixed ⇒ t' = local - (local - t) * ratio
    this.tx = lx - (lx - this.tx) * ratio;
    this.ty = ly - (ly - this.ty) * ratio;
    this.scale = nextScale;
    this.emit();
  }

  /** Pan by a client-px delta. */
  panBy(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.tx += dx;
    this.ty += dy;
    this.emit();
  }

  /**
   * Set an absolute scale anchored at a screen point (defaults to the viewport
   * center). Used by the zoom preset menu and +/- commands, which must not jump
   * the view the way `zoomAt` at the far corner would.
   */
  setScale(nextScale: number, anchor?: ScreenPoint): void {
    const target = clampScale(nextScale);
    const point = anchor ?? {
      x: this.origin.x + this.size.width / 2,
      y: this.origin.y + this.size.height / 2
    };
    this.zoomRatioTo(target, point);
  }

  private zoomRatioTo(nextScale: number, screenPoint: ScreenPoint): void {
    if (nextScale === this.scale) return;
    const lx = screenPoint.x - this.origin.x;
    const ly = screenPoint.y - this.origin.y;
    const ratio = nextScale / this.scale;
    this.tx = lx - (lx - this.tx) * ratio;
    this.ty = ly - (ly - this.ty) * ratio;
    this.scale = nextScale;
    this.emit();
  }

  /** Frame the whole content box, centered, keeping {@link FIT_PADDING}. */
  fitToContent(): void {
    this.fitBox(this.content);
  }

  /** Frame the current selection, falling back to content when nothing is picked. */
  zoomToSelection(): void {
    this.fitBox(this.selection ?? this.content);
  }

  private fitBox(box: CanvasBox | null): void {
    if (!box || this.size.width <= 0 || this.size.height <= 0) return;
    if (box.width <= 0 || box.height <= 0) {
      // A zero-size box (single point / empty canvas): center at 100 %.
      this.scale = 1;
      this.tx = this.size.width / 2 - box.x;
      this.ty = this.size.height / 2 - box.y;
      this.emit();
      return;
    }
    const availableW = Math.max(1, this.size.width - FIT_PADDING * 2);
    const availableH = Math.max(1, this.size.height - FIT_PADDING * 2);
    const nextScale = clampScale(Math.min(availableW / box.width, availableH / box.height));
    this.scale = nextScale;
    this.tx = this.size.width / 2 - (box.x + box.width / 2) * nextScale;
    this.ty = this.size.height / 2 - (box.y + box.height / 2) * nextScale;
    this.emit();
  }

  /** Reset to 100 % while keeping the canvas point at the viewport center fixed. */
  reset100(): void {
    this.setScale(1);
  }

  /**
   * Recenter the current content box at the existing scale (no zoom change).
   * `setScale` keeps the point under the viewport center fixed, so applying a
   * default zoom to a canvas whose origin is (0, 0) leaves the device pinned to
   * the top-left; this pulls it back to the middle without touching the scale.
   */
  centerContent(): void {
    const box = this.content;
    if (!box || this.size.width <= 0 || this.size.height <= 0) return;
    this.tx = this.size.width / 2 - (box.x + box.width / 2) * this.scale;
    this.ty = this.size.height / 2 - (box.y + box.height / 2) * this.scale;
    this.emit();
  }

  /** Step zoom used by the +/- buttons and commands; anchors the viewport center. */
  zoomStep(direction: 1 | -1): void {
    this.setScale(this.scale * (direction === 1 ? 1.25 : 0.8));
  }

  /** Recenter the viewport on a canvas point, keeping the current scale. */
  centerOn(canvasPoint: ScreenPoint): void {
    if (this.size.width <= 0 || this.size.height <= 0) return;
    this.tx = this.size.width / 2 - canvasPoint.x * this.scale;
    this.ty = this.size.height / 2 - canvasPoint.y * this.scale;
    this.emit();
  }

  // -- grid / rulers / minimap helpers --------------------------------------

  /** On-screen spacing for a canvas-unit grid step at the current zoom. */
  screenGridSpacing(worldStep: number): number {
    return worldStep * this.scale;
  }

  /** The canvas-unit rectangle currently visible in the viewport. */
  visibleCanvasBox(): CanvasBox {
    const top = 0;
    const left = 0;
    const min = this.screenToCanvas(this.origin.x + left, this.origin.y + top);
    const max = this.screenToCanvas(this.origin.x + this.size.width, this.origin.y + this.size.height);
    return { x: min.x, y: min.y, width: max.x - min.x, height: max.y - min.y };
  }

  /** Map the content box to a minimap thumbnail, returning the fitted scale/offset. */
  minimapMapping(mapWidth: number, mapHeight: number, padding = 6): { scale: number; offsetX: number; offsetY: number } | null {
    const box = this.content;
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const innerW = Math.max(1, mapWidth - padding * 2);
    const innerH = Math.max(1, mapHeight - padding * 2);
    const k = Math.min(innerW / box.width, innerH / box.height);
    const drawW = box.width * k;
    const drawH = box.height * k;
    return {
      scale: k,
      offsetX: padding + (innerW - drawW) / 2 - box.x * k,
      offsetY: padding + (innerH - drawH) / 2 - box.y * k
    };
  }

  /** Canvas point → minimap px, given a {@link minimapMapping} result. */
  canvasToMinimap(x: number, y: number, m: { scale: number; offsetX: number; offsetY: number }): ScreenPoint {
    return { x: x * m.scale + m.offsetX, y: y * m.scale + m.offsetY };
  }

  /** Minimap px → canvas point (inverse of {@link canvasToMinimap}). */
  minimapToCanvas(mx: number, my: number, m: { scale: number; offsetX: number; offsetY: number }): ScreenPoint {
    return { x: (mx - m.offsetX) / m.scale, y: (my - m.offsetY) / m.scale };
  }

  /** The CSS transform string for the stage wrapper (origin 0 0). */
  toTransformStyle(): string {
    return `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  private emit(): void {
    this.onChange?.();
  }
}
