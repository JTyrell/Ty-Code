/**
 * Inspector Bridge (Prompt 4 Step 2)
 *
 * Guest pages report hover/click/drag/tree data over a window.parent
 * postMessage channel (the sandboxed webview has no guest preload).
 * The HOST validates every inbound message with Zod and renders via a
 * requestAnimationFrame drain loop that ONLY runs while the preview reports
 * an active interaction burst (Prompt 4 perf guard: no persistent rAF).
 *
 * ZERO-TELEMETRY: nothing leaves the local process.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Guest injection script (delivered via webview.executeJavaScript)
// ---------------------------------------------------------------------------

export const CANVAS_INSPECTOR_SOURCE = `(function(){
  if (window.__tycodeCanvasInspector) return;
  window.__tycodeCanvasInspector = true;
  var S = window.__tycodeInspectorState = { paused: false, inspect: true, dragging: null, borders: false };

  function send(type, payload) {
    if (S.paused && type !== 'tree') return;
    try { window.parent.postMessage({ source: 'tycode-canvas-inspector', type: type, payload: payload }, '*'); } catch (e) {}
  }
  function selectorFor(el) {
    var path = [];
    var node = el;
    while (node && node !== document.body) {
      var part = node.tagName.toLowerCase();
      if (node.id) { path.unshift('#' + node.id); break; }
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (Array.prototype.indexOf.call(same, node) + 1) + ')';
      }
      path.unshift(part);
      node = parent;
    }
    if (path.length === 0 || path[0] === 'body' && path.length === 1) path.unshift('body');
    else if (path.length === 0) path.push('body');
    return path.join(' > ');
  }
  function componentFor(el) {
    var node = el;
    while (node && node !== document.body) {
      var ds = node.dataset || {};
      if (ds.component) return String(ds.component).slice(0, 120);
      var cls = typeof node.className === 'string' ? node.className.split(/\\s+/) : [];
      for (var i = 0; i < cls.length; i++) {
        var token = cls[i];
        if (token.length > 2 && /^[A-Z][A-Za-z0-9]+$/.test(token)) return token;
      }
      node = node.parentElement;
    }
    return null;
  }
  var CAPTURE = ['color','background-color','font-size','font-weight','font-family','text-align','padding','margin','border-radius','border','box-shadow','gap','width','height','display','flex-direction','align-items','justify-content','position'];
  function stylesFor(el) {
    var cs = document.defaultView ? document.defaultView.getComputedStyle(el) : null;
    if (!cs) return {};
    var out = {};
    for (var i = 0; i < CAPTURE.length; i++) { var p = CAPTURE[i]; out[p] = cs.getPropertyValue(p) || ''; }
    return out;
  }
  function boxFor(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function describe(type, el) {
    return {
      type: type,
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      componentName: componentFor(el),
      styles: stylesFor(el),
      bbox: boxFor(el),
      innerText: ((el.innerText || el.textContent || '') + '').trim().slice(0, 200),
      at: Date.now()
    };
  }
  function handlePointerMove(e) {
    if (S.dragging) return;
    if (!S.inspect) return;
    if (Date.now() - (S.lastHoverAt || 0) < 33) return;
    S.lastHoverAt = Date.now();
    var t = e.target;
    if (t instanceof Element) send('hover', describe('hover', t));
  }
  function isInteractive(el) {
    return !!el.closest('a, button, [role=button], input, textarea, select, label, [onclick]');
  }
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  document.addEventListener('pointerdown', function(e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    if (S.dragging) return;
    if (S.inspect) {
      e.preventDefault(); e.stopPropagation();
      var interactive = isInteractive(t);
      send('select', describe('select', t));
      S.dragging = { el: t, x0: e.clientX, y0: e.clientY, bbox: boxFor(t), interactive: interactive, mode: 'move' };
      send('drag-start', { selector: S.dragging.el ? selectorFor(t) : '', bbox: S.dragging.bbox });
      var moveHandler = function(ev) {
        if (!S.dragging) return;
        var dx = ev.clientX - S.dragging.x0;
        var dy = ev.clientY - S.dragging.y0;
        if (Date.now() - (S.dragging.lastAt || 0) >= 33) {
          S.dragging.lastAt = Date.now();
          send('drag', { selector: selectorFor(t), dx: dx, dy: dy, base: S.dragging.bbox });
        }
      };
      var upHandler = function(ev) {
        document.removeEventListener('pointermove', moveHandler, true);
        document.removeEventListener('pointerup', upHandler, true);
        document.removeEventListener('pointercancel', cancelHandler, true);
        var dx = ev.clientX - S.dragging.x0;
        var dy = ev.clientY - S.dragging.y0;
        var base = S.dragging.bbox;
        var interactive = S.dragging.interactive;
        S.dragging = null;
        send('drag-end', {
          selector: selectorFor(t),
          dx: dx,
          dy: dy,
          base: base,
          interactive: interactive,
          position: (document.defaultView.getComputedStyle(t).position || '')
        });
      };
      var cancelHandler = function() {
        document.removeEventListener('pointermove', moveHandler, true);
        document.removeEventListener('pointerup', upHandler, true);
        document.removeEventListener('pointercancel', cancelHandler, true);
        S.dragging = null;
        send('drag-cancel', { selector: selectorFor(t) });
      };
      document.addEventListener('pointermove', moveHandler, true);
      document.addEventListener('pointerup', upHandler, true);
      document.addEventListener('pointercancel', cancelHandler, true);
    }
  }, { capture: true });
  document.addEventListener('click', function(e) {
    if (S.dragging || !S.inspect) return;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true });
  window.addEventListener('message', function(e) {
    var data = e.data;
    if (!data || data.channel !== 'tycode-canvas-host') return;
    if (data.command === 'pause') S.paused = true;
    else if (data.command === 'resume') S.paused = false;
    else if (data.command === 'inspect-on') S.inspect = true;
    else if (data.command === 'inspect-off') S.inspect = false;
    else if (data.command === 'select-by-selector') {
      var found = null;
      try { found = document.querySelector(data.selector); } catch (err) { found = null; }
      if (found instanceof Element) send('select', describe('select', found));
    }
  });
  function sendTree() {
    if (!document.body) return;
    function visit(node, depth) {
      var out = { selector: selectorFor(node), tag: node.tagName.toLowerCase(), children: [], preview: '' };
      if (depth < 12) {
        for (var i = 0; i < node.children.length; i++) {
          out.children.push(visit(node.children[i], depth + 1));
        }
      }
      if (node.children.length === 0) out.preview = ((node.textContent || '') + '').trim().slice(0, 24);
      return out;
    }
    var body = { selector: 'body', tag: 'body', children: [], preview: '' };
    for (var i = 0; i < document.body.children.length; i++) {
      body.children.push(visit(document.body.children[i], 1));
    }
    send('tree', { nodes: body.children });
  }
  var treeTimer = null;
  function queueTree(delay) {
    if (treeTimer) return;
    treeTimer = setTimeout(function() { treeTimer = null; sendTree(); }, delay || 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { sendTree(); }, 60); });
  } else {
    setTimeout(function() { sendTree(); }, 60);
  }
  new MutationObserver(function() { queueTree(300); }).observe(document.documentElement, { childList: true, subtree: true });
})();`;

// ---------------------------------------------------------------------------
// Host-side validation + consumer-facing snapshot API
// ---------------------------------------------------------------------------

const InspectorRecordSchema = z.object({
  type: z.enum(['hover', 'select']),
  selector: z.string().min(1).max(2048),
  tag: z.string().max(40),
  componentName: z.string().max(200).nullable().optional(),
  styles: z.record(z.string(), z.string()),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().min(0),
    h: z.number().min(0)
  }),
  innerText: z.string().max(200).optional(),
  at: z.number()
});

export type InspectorRecord = z.infer<typeof InspectorRecordSchema>;

export interface InspectorDragEvent {
  selector: string;
  dx: number;
  dy: number;
  base: { x: number; y: number; w: number; h: number };
  interactive: boolean;
  position: string;
}

const TreeNodeSchema: z.ZodType<InspectorTreeNode> = z.lazy(() =>
  z.object({
    selector: z.string().max(2048),
    tag: z.string().max(40),
    children: z.array(TreeNodeSchema).max(80),
    preview: z.string().max(48).optional()
  })
);

export interface InspectorTreeNode {
  selector: string;
  tag: string;
  children: InspectorTreeNode[];
  preview?: string;
}

const GuestMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hover'), payload: InspectorRecordSchema }),
  z.object({ type: z.literal('select'), payload: InspectorRecordSchema }),
  z.object({ type: z.literal('tree'), payload: z.object({ nodes: z.array(TreeNodeSchema).max(80) }) }),
  z.object({ type: z.literal('drag-start'), payload: z.object({ selector: z.string().max(2048), bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) }) }),
  z.object({ type: z.literal('drag'), payload: z.object({ selector: z.string().max(2048), dx: z.number(), dy: z.number(), base: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) }) }),
  z.object({ type: z.literal('drag-end'), payload: z.object({
    selector: z.string().max(2048),
    dx: z.number(),
    dy: z.number(),
    base: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    interactive: z.boolean().optional(),
    position: z.string().max(40).optional()
  }) }),
  z.object({ type: z.literal('drag-cancel'), payload: z.object({ selector: z.string().max(2048) }) })
]);

export { GuestMessageSchema };

export interface InspectorSnapshot {
  hover: InspectorRecord | null;
  select: InspectorRecord | null;
  tree: InspectorTreeNode[] | null;
  dragging: { selector: string; dx: number; dy: number; base: { x: number; y: number; w: number; h: number } } | null;
  dragEnded: InspectorDragEvent | null;
}

export class CanvasInspectorBridge {
  private expectedOrigin: string | null = null;
  private paused = false;
  private attached = false;
  private pendingHover: InspectorRecord | null = null;
  private pendingSelect: InspectorRecord | null = null;
  private pendingTree: InspectorTreeNode[] | null = null;
  private pendingDrag: { selector: string; dx: number; dy: number; base: { x: number; y: number; w: number; h: number } } | null = null;
  private pendingDragEnd: InspectorDragEvent | null = null;
  private lastMessageAt = 0;

  private readonly onMessage = (event: MessageEvent): void => {
    if (this.expectedOrigin && this.expectedOrigin !== event.origin) return;
    const parsed = GuestMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    this.lastMessageAt = Date.now();
    const guest = parsed.data;
    switch (guest.type) {
      case 'hover': this.pendingHover = guest.payload; break;
      case 'select': this.pendingSelect = guest.payload; this.pendingHover = null; break;
      case 'tree': this.pendingTree = guest.payload.nodes; break;
      case 'drag': this.pendingDrag = { selector: guest.payload.selector, dx: guest.payload.dx, dy: guest.payload.dy, base: guest.payload.base }; break;
      case 'drag-end': {
        this.pendingDrag = null;
        this.pendingDragEnd = {
          selector: guest.payload.selector,
          dx: guest.payload.dx,
          dy: guest.payload.dy,
          base: guest.payload.base,
          interactive: guest.payload.interactive ?? false,
          position: guest.payload.position ?? ''
        };
        break;
      }
      case 'drag-start':
      case 'drag-cancel': {
        this.pendingDrag = null;
        this.pendingDragEnd = null;
        break;
      }
    }
  };

  attach(expectedOrigin: string | null): void {
    if (this.attached) return;
    this.attached = true;
    this.expectedOrigin = expectedOrigin;
    window.addEventListener('message', this.onMessage);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('message', this.onMessage);
  }

  get isAttached(): boolean {
    return this.attached;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Reset all pending guest data (visibility change / navigation away). */
  clear(): void {
    this.pendingHover = null;
    this.pendingSelect = null;
    this.pendingTree = null;
    this.pendingDrag = null;
    this.pendingDragEnd = null;
    this.lastMessageAt = 0;
  }

  drain(): InspectorSnapshot {
    const snap: InspectorSnapshot = {
      hover: this.pendingHover,
      select: this.pendingSelect,
      tree: this.pendingTree,
      dragging: this.pendingDrag,
      dragEnded: this.pendingDragEnd
    };
    this.pendingHover = null;
    this.pendingSelect = null;
    this.pendingTree = null;
    this.pendingDrag = null;
    this.pendingDragEnd = null;
    return snap;
  }

  /** True while the guest reported something within the idle window. */
  isActive(idleWindowMs = 700): boolean {
    return Date.now() - this.lastMessageAt < idleWindowMs;
  }

  /** Host → guest control channel (webview.contentWindow.postMessage). */
  static command(frame: Window | null, command: 'pause' | 'resume' | 'inspect-on' | 'inspect-off' | 'select-by-selector', selector?: string): void {
    if (!frame || frame.closed) return;
    try {
      frame.postMessage({ channel: 'tycode-canvas-host', command, ...(selector ? { selector } : {}) }, '*');
    } catch {
      /* frame torn down mid-send */
    }
  }
}
