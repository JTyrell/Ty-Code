/**
 * Canvas Editing Controller (M3E Sketcher — Prompt 3)
 *
 * Thin imperative bridge between the Sketcher UI and the two pure modules:
 * `canvas-history` (AST transforms + coalescing command stack) and
 * `canvas-geometry` (align / distribute / smart-guide math). Every editing
 * gesture ends as exactly one {@link HistoryCommand} that is recorded AND
 * applied through `replaceNodes`, so undo/redo restores the prior tree
 * verbatim. No DOM is mutated directly — the stage re-renders from the AST.
 *
 * Clipboard uses an internal module-level payload (canvas-node JSON) as the
 * transport contract; when it travels through the shared clipboard service
 * (async, and shared with the OS) the read is still parsed from that JSON.
 */

import type { CanvasNode, CanvasPlatform, CanvasPropValue } from '../../state/canvas-store';
import { autoPlaceSlot, nodeDefaultSize } from '../../state/canvas-store';
import {
  addNodeCommand,
  canvasHistory,
  deleteNodeCommand,
  findNodeInTree,
  findParentPath,
  groupCommand,
  propsCommand,
  reorderCommand,
  reparentCommand,
  replaceNodeInTree,
  resolveChildren,
  ungroupCommand
} from './canvas-history';
import type { HistoryCommand } from './canvas-history';
import { alignRects, distributeRects, snapToGuides, unionRect } from './canvas-geometry';
import type { AlignKind, GuideLine, PositionedRect, Rect } from './canvas-geometry';

export type ResizeMode = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type ZOrderMode = 'front' | 'forward' | 'backward' | 'back';

export type { AlignKind, GuideLine };

// ---------------------------------------------------------------------------
// Rect extraction over the AST (props are canvas units, top-left origin)
// ---------------------------------------------------------------------------

const numProp = (node: CanvasNode, key: string): number => {
  const value = node.props[key];
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const nodeRectOf = (node: CanvasNode): Rect => ({
  x: numProp(node, 'x'),
  y: numProp(node, 'y'),
  width: numProp(node, 'width'),
  height: numProp(node, 'height')
});

/** All ids in a subtree, the node itself first. */
export const collectSubtreeIds = (node: CanvasNode): string[] => {
  const ids: string[] = [node.id];
  for (const child of node.children) ids.push(...collectSubtreeIds(child));
  return ids;
};

/** Selection set with every descendant included (dragging a parent drags its kids). */
export const expandWithDescendants = (nodes: CanvasNode[], ids: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const node = findNodeInTree(nodes, id);
    if (!node) continue;
    for (const sub of collectSubtreeIds(node)) {
      if (!seen.has(sub)) {
        seen.add(sub);
        out.push(sub);
      }
    }
  }
  return out;
};

const propsSnapshot = (nodes: CanvasNode[], ids: string[]): Record<string, Record<string, CanvasPropValue>> => {
  const map: Record<string, Record<string, CanvasPropValue>> = {};
  for (const id of ids) {
    const node = findNodeInTree(nodes, id);
    if (node) map[id] = { ...node.props };
  }
  return map;
};

/** Union bbox of a set of nodes INCLUDING their descendants. */
export const unionRectOfIds = (nodes: CanvasNode[], ids: string[]): Rect | null => {
  const rects: Rect[] = [];
  for (const id of expandWithDescendants(nodes, ids)) {
    const node = findNodeInTree(nodes, id);
    if (node) rects.push(nodeRectOf(node));
  }
  return unionRect(rects);
};

/** Merge a patch into several nodes' props in one immutable pass. */
const patchMany = (
  nodes: CanvasNode[],
  patch: Record<string, Record<string, CanvasPropValue>>
): CanvasNode[] => {
  const walk = (list: CanvasNode[]): CanvasNode[] =>
    list.map((node) => {
      const next = patch[node.id] ? { ...node, props: { ...node.props, ...patch[node.id] } } : node;
      return node.children.length > 0 ? { ...next, children: walk(next.children) } : next;
    });
  return walk(nodes);
};

/**
 * Gesture bookkeeping: `begin` captures the pre-gesture props of every moving
 * node; live drags call {@link applyLive} (no history); `commit` records ONE
 * coalesced props command from start to final state — "a drag gesture = one
 * undo entry".
 */
interface ActiveGesture {
  key: string;
  before: Record<string, Record<string, CanvasPropValue>>;
}

export class CanvasEditController {
  private gesture: ActiveGesture | null = null;
  private internalClipboard: { nodes: CanvasNode[] } | null = null;

  // -- gestures -------------------------------------------------------------

  beginPositionsGesture(ids: string[], label = 'Move'): void {
    const nodes = this.readNodes();
    canvasHistory.beginGesture();
    this.gesture = { key: `gesture:${label}:${ids.join(',')}`, before: propsSnapshot(nodes, ids) };
  }

  /** Immediate visual update inside a gesture — history is NOT touched here. */
  applyLive(patch: Record<string, Record<string, CanvasPropValue>>): void {
    this.replace(patchMany(this.readNodes(), patch));
  }

  /** Record the coalesced command and close the gesture. No-op if nothing moved. */
  commitPositions(type: 'move' | 'resize', label: string): void {
    const gesture = this.gesture;
    this.gesture = null;
    canvasHistory.endGesture();
    if (!gesture) return;
    const after = propsSnapshot(this.readNodes(), Object.keys(gesture.before));
    if (JSON.stringify(gesture.before) === JSON.stringify(after)) return;
    this.run(propsCommand(type, label, gesture.before, after, gesture.key));
  }

  /** A discrete (single-step) op recorded straight away. */
  run(command: HistoryCommand): void {
    const next = command.apply(this.readNodes());
    canvasHistory.record(command);
    this.replace(next);
  }

  /** Apply without recording (used by undo/redo, which manage stacks themselves). */
  private step(restore: (nodes: CanvasNode[]) => CanvasNode[]): CanvasNode[] {
    const next = restore(this.readNodes());
    this.replace(next);
    return next;
  }

  undo(): void {
    this.gesture = null;
    this.step((nodes) => canvasHistory.undo(nodes));
  }

  redo(): void {
    this.gesture = null;
    this.step((nodes) => canvasHistory.redo(nodes));
  }

  canUndo(): boolean {
    return canvasHistory.canUndo;
  }

  canRedo(): boolean {
    return canvasHistory.canRedo;
  }

  undoLabel(): string | undefined {
    return canvasHistory.peekUndo()?.label;
  }

  redoLabel(): string | undefined {
    return canvasHistory.peekRedo()?.label;
  }

  clearHistory(): void {
    this.gesture = null;
    canvasHistory.clear();
  }

  // -- single-step ops ------------------------------------------------------

  /**
   * Create a top-level layer and record it as one `add` command (its invert
   * removes it), so a fresh node is undoable just like every other edit.
   */
  addLayer(input: { type: string; name?: string; props?: Record<string, CanvasPropValue> }): string {
    const nodes = this.readNodes();
    const platform = this.services.platformOf();
    const id = freshNodeId();
    const size = nodeDefaultSize(input.type);
    const slot = autoPlaceSlot(nodes.length);
    const node: CanvasNode = {
      id,
      type: input.type,
      platform,
      props: { x: slot.x, y: slot.y, width: size.width, height: size.height, ...input.props },
      ...(input.name ? { name: input.name } : {}),
      children: []
    };
    this.run(addNodeCommand(node, [], nodes.length, null));
    return id;
  }

  /**
   * Create a layer nested INSIDE an existing container (Prompt 4 Step 1: drop
   * from the library onto a container). The child's x/y are local to the
   * parent's content box; a fresh slot offsets stacked drops. Recorded as one
   * undoable `add` command against the parent path, mirroring {@link addLayer}.
   */
  addLayerInto(
    parentId: string,
    input: { type: string; name?: string; props?: Record<string, CanvasPropValue> }
  ): string | null {
    const nodes = this.readNodes();
    const parent = findNodeInTree(nodes, parentId);
    if (!parent) return null;
    const id = freshNodeId();
    const size = nodeDefaultSize(input.type);
    const slot = autoPlaceSlot(parent.children.length);
    const node: CanvasNode = {
      id,
      type: input.type,
      platform: parent.platform,
      props: { x: slot.x, y: slot.y, width: size.width, height: size.height, ...input.props },
      ...(input.name ? { name: input.name } : {}),
      children: []
    };
    this.run(
      addNodeCommand(
        node,
        [parentId],
        parent.children.length,
        { ...parent, children: [...parent.children] }
      )
    );
    return id;
  }

  restyle(id: string, patch: Record<string, CanvasPropValue>, label = 'Restyle'): void {
    const node = findNodeInTree(this.readNodes(), id);
    if (!node) return;
    const before = { [id]: { ...node.props } };
    const after = { [id]: { ...node.props, ...patch } };
    this.run(propsCommand('restyle', label, before, after));
  }

  /**
   * Rename a layer. `name` lives outside `props`, so this is its own pure
   * over-the-AST command (a `restyle` op) whose invert restores the exact prior
   * node — undo/redo round-trips the label verbatim.
   */
  rename(id: string, name: string): void {
    const nodes = this.readNodes();
    const node = findNodeInTree(nodes, id);
    if (!node || node.name === name) return;
    const before = node;
    const after: CanvasNode = { ...node, name };
    this.run({
      type: 'restyle',
      label: 'Rename layer',
      apply: (tree) => replaceNodeInTree(tree, id, after),
      invert: (tree) => replaceNodeInTree(tree, id, before)
    });
  }

  nudge(dx: number, dy: number): void {
    const nodes = this.readNodes();
    const ids = expandWithDescendants(nodes, this.selectedIds(nodes));
    if (ids.length === 0) return;
    const before = propsSnapshot(nodes, ids);
    const after: Record<string, Record<string, CanvasPropValue>> = {};
    for (const id of ids) {
      const node = findNodeInTree(nodes, id)!;
      after[id] = { ...node.props, x: numProp(node, 'x') + dx, y: numProp(node, 'y') + dy };
    }
    // Nudge is absolute-prop, so a repeat within its own gesture stays discrete
    // (each keypress = one entry, matching every pro editor's behaviour).
    this.run(propsCommand('move', `Nudge ${dx}/${dy}`, before, after));
  }

  deleteSelection(): void {
    const nodes = this.readNodes();
    // Deleting a selected parent deletes its subtree, so only the top-most
    // selected ids need their own command.
    const selected = this.selectedIds(nodes);
    const roots = selected.filter((id) => {
      const path = this.parentPathOf(nodes, id);
      return path === null || !path.some((ancestor) => selected.includes(ancestor));
    });
    for (const id of roots) {
      const node = findNodeInTree(nodes, id);
      if (!node) continue;
      const located = locateOrFallback(nodes, id);
      if (!located) continue;
      const parentPath = located.parentPath;
      const parentNode =
        parentPath.length > 0 ? findNodeInTree(nodes, parentPath[parentPath.length - 1]) : null;
      this.run(
        deleteNodeCommand(
          JSON.parse(JSON.stringify(node)) as CanvasNode,
          parentPath,
          located.index,
          parentNode ? ({ ...parentNode, children: [...parentNode.children] } as CanvasNode) : null
        )
      );
    }
  }

  // -- align / distribute (Step 4, pure math via canvas-geometry) -----------

  align(kind: AlignKind): void {
    const nodes = this.readNodes();
    const rects = this.selectionRects(nodes);
    const targets = alignRects(rects, kind);
    this.applyPositionTargets(`Align ${kind}`, nodes, targets);
  }

  distribute(axis: 'h' | 'v'): void {
    const nodes = this.readNodes();
    const rects = this.selectionRects(nodes);
    const targets = distributeRects(rects, axis);
    this.applyPositionTargets(`Distribute ${axis === 'h' ? 'horizontally' : 'vertically'}`, nodes, targets);
  }

  private applyPositionTargets(
    label: string,
    nodes: CanvasNode[],
    targets: { id: string; x: number; y: number }[]
  ): void {
    if (targets.length === 0) return;
    const ids = targets.map((t) => t.id);
    const before = propsSnapshot(nodes, ids);
    const after: Record<string, Record<string, CanvasPropValue>> = {};
    for (const t of targets) {
      const node = findNodeInTree(nodes, t.id)!;
      after[t.id] = { ...node.props, x: t.x, y: t.y };
    }
    this.run(propsCommand('move', label, before, after));
  }

  // -- z-order (Step 4) -----------------------------------------------------
  // The stage paints top-level siblings in array order, so "front" is the end
  // of the list and "back" the start. Each reorder is one `zorder` command over
  // the sibling id list, invertible exactly.

  zorder(mode: ZOrderMode): void {
    const nodes = this.readNodes();
    const ids = this.selectedIds(nodes);
    if (ids.length === 0) return;
    // Operate on the primary (last) selected node's sibling list.
    const primary = ids[ids.length - 1];
    const parentPath = findParentPath(nodes, primary);
    if (!parentPath) return;
    const children = resolveChildren(nodes, parentPath) ?? [];
    const beforeIds = children.map((c) => c.id);
    const idx = beforeIds.indexOf(primary);
    if (idx < 0) return;
    const afterIds = [...beforeIds];
    afterIds.splice(idx, 1);
    const target =
      mode === 'front'
        ? afterIds.length
        : mode === 'back'
          ? 0
          : mode === 'forward'
            ? Math.min(afterIds.length, idx + 1)
            : Math.max(0, idx - 1);
    afterIds.splice(target, 0, primary);
    if (afterIds.join('|') === beforeIds.join('|')) return;
    const label =
      mode === 'front'
        ? 'Bring to Front'
        : mode === 'back'
          ? 'Send to Back'
          : mode === 'forward'
            ? 'Bring Forward'
            : 'Send Backward';
    this.run(reorderCommand(parentPath, beforeIds, afterIds, label));
  }

  // -- group / ungroup (Step 4) --------------------------------------------

  groupSelection(): void {
    const nodes = this.readNodes();
    const ids = this.selectedIds(nodes);
    if (ids.length < 2) return;
    const parentPath = findParentPath(nodes, ids[0]);
    if (!parentPath) return;
    const located = locateOrFallback(nodes, ids[0]);
    const box = unionRectOfIds(nodes, ids) ?? { x: 0, y: 0, width: 120, height: 80 };
    const container: CanvasNode = {
      id: freshNodeId(),
      type: 'container',
      platform: nodes[0]?.platform ?? 'react',
      name: 'Group',
      props: { x: box.x, y: box.y, width: box.width, height: box.height },
      children: []
    };
    // Capture the pre-group tree so the invert restores it verbatim.
    this.run(groupCommand(container, parentPath, located?.index ?? 0, ids, cloneNodes(nodes)));
  }

  ungroupSelection(): void {
    const nodes = this.readNodes();
    const ids = this.selectedIds(nodes);
    if (ids.length === 0) return;
    const id = ids[ids.length - 1];
    const node = findNodeInTree(nodes, id);
    if (!node || node.children.length === 0) return;
    const located = locateOrFallback(nodes, id);
    if (!located) return;
    this.run(ungroupCommand(id, located.parentPath, located.index, cloneNodes(nodes)));
  }

  // -- reparent (layer-tree drag reorder, Step 4) --------------------------

  reparent(dragId: string, toParentPath: string[], toIndex: number): void {
    const nodes = this.readNodes();
    const node = findNodeInTree(nodes, dragId);
    if (!node) return;
    // Never drop a node inside its own subtree.
    if (toParentPath.includes(dragId)) return;
    const from = locateOrFallback(nodes, dragId);
    if (!from) return;
    if (from.parentPath.length === toParentPath.length && from.index === toIndex &&
        from.parentPath.every((id, i) => id === toParentPath[i])) {
      return;
    }
    this.run(
      reparentCommand(JSON.parse(JSON.stringify(node)) as CanvasNode, {
        id: dragId,
        fromParentPath: from.parentPath,
        fromIndex: from.index,
        toParentPath,
        toIndex
      })
    );
  }

  // -- guides ---------------------------------------------------------------

  /** Snap a proposed bbox of all moving nodes to sibling edges/centers + stage. */
  snapDrag(movingBox: Rect, excludeIds: Set<string>, stage: Rect, tolerance: number): { dx: number; dy: number; guides: GuideLine[] } {
    const nodes = this.readNodes();
    const siblings: Rect[] = [];
    const walk = (list: CanvasNode[]): void => {
      for (const node of list) {
        if (!excludeIds.has(node.id)) siblings.push(nodeRectOf(node));
        walk(node.children);
      }
    };
    walk(nodes);
    return snapToGuides(movingBox, siblings, stage, tolerance);
  }

  selectionBBox(): Rect | null {
    const nodes = this.readNodes();
    return unionRectOfIds(nodes, this.selectedIds(nodes));
  }

  /** The ids a marquee at 50% zoom would "visually enclose": top-level only. */
  static marqueeHits(nodes: CanvasNode[], box: Rect, lockedIds: string[]): string[] {
    return nodes
      .filter((n) => !lockedIds.includes(n.id))
      .map((n) => ({ n, r: nodeRectOf(n) }))
      .filter(({ r }) => r.x >= box.x && r.y >= box.y && r.x + r.width <= box.x + box.width && r.y + r.height <= box.y + box.height)
      .map(({ n }) => n.id);
  }

  private selectionRects(nodes: CanvasNode[]): PositionedRect[] {
    const rects: PositionedRect[] = [];
    for (const id of this.selectedIds(nodes)) {
      const node = findNodeInTree(nodes, id);
      if (node) rects.push({ id, ...nodeRectOf(node) });
    }
    return rects;
  }

  private selectedIds(nodes: CanvasNode[]): string[] {
    return this.services.selectionOf().filter((id) => findNodeInTree(nodes, id) !== null);
  }

  private parentPathOf(nodes: CanvasNode[], id: string): string[] | null {
    let path: string[] | null = null;
    const walk = (list: CanvasNode[], trail: string[]): boolean => {
      for (const node of list) {
        if (node.id === id) {
          path = trail;
          return true;
        }
        if (walk(node.children, [...trail, node.id])) return true;
      }
      return false;
    };
    walk(nodes, []);
    return path;
  }

  // -- clipboard (internal canvas-node JSON; paste offsets by 16) -----------

  copySelection(): boolean {
    const nodes = this.readNodes();
    const ids = this.selectedIds(nodes);
    if (ids.length === 0) return false;
    const payload = ids
      .map((id) => findNodeInTree(nodes, id))
      .filter((n): n is CanvasNode => Boolean(n))
      .map((node) => JSON.parse(JSON.stringify(node)) as CanvasNode);
    this.internalClipboard = { nodes: payload };
    const { clipboardOf } = this.services;
    void clipboardOf()?.write(JSON.stringify({ kind: 'tycode.canvas-nodes', payload }));
    return true;
  }

  cutSelection(): void {
    if (!this.copySelection()) return;
    this.deleteSelection();
  }

  hasClipboardText(text: string): boolean {
    return Boolean(this.internalClipboard) || /tycode\.canvas-nodes/.test(text);
  }

  paste(payloadJson?: string): void {
    let source: CanvasNode[] | null = null;
    if (payloadJson) {
      try {
        const parsed = JSON.parse(payloadJson) as { kind?: string; payload?: CanvasNode[] };
        if (parsed.kind === 'tycode.canvas-nodes' && Array.isArray(parsed.payload)) source = parsed.payload;
      } catch {
        source = null;
      }
    }
    if (!source) source = this.internalClipboard?.nodes ?? null;
    if (!source || source.length === 0) return;
    const nodes = this.readNodes();
    const platform: CanvasPlatform = nodes[0]?.platform ?? source[0]?.platform ?? 'react';
    for (const raw of source) {
      const clone = rehydrateClone(raw, platform);
      offsetDeep(clone, 16);
      const count = nodes.length;
      this.run(insertCommand(clone, [], count, 'Add pasted layer'));
    }
  }

  duplicateSelection(): void {
    const nodes = this.readNodes();
    const ids = this.selectedIds(nodes);
    for (const id of ids) {
      const source = findNodeInTree(nodes, id);
      if (!source) continue;
      const clone = rehydrateClone(source, source.platform);
      offsetDeep(clone, 16);
      const located = locateOrFallback(nodes, id);
      if (!located) continue;
      this.run(insertCommand(clone, located.parentPath, located.index + 1, 'Duplicate'));
    }
  }

  private readNodes(): CanvasNode[] {
    return this.services.treeOf();
  }

  private replace(nodes: CanvasNode[]): void {
    this.services.replaceOf(nodes);
  }

  constructor(
    private services: {
      treeOf: () => CanvasNode[];
      replaceOf: (nodes: CanvasNode[]) => void;
      selectionOf: () => string[];
      platformOf: () => CanvasPlatform;
      clipboardOf: () => { write: (text: string) => void } | null;
    }
  ) {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-copy a whole tree (used to capture pre-op snapshots for history). */
const cloneNodes = (nodes: CanvasNode[]): CanvasNode[] => JSON.parse(JSON.stringify(nodes)) as CanvasNode[];

/** A collision-free node id for freshly created containers. */
const freshNodeId = (): string => {
  const cryptoObj = globalThis.crypto;
  return cryptoObj?.randomUUID
    ? `node_${cryptoObj.randomUUID()}`
    : `node_${Math.random().toString(36).slice(2, 11)}`;
};

/** Deep clone + fresh ids so pastes/duplicates never alias the source. */
const rehydrateClone = (node: CanvasNode, platform: CanvasPlatform): CanvasNode => {
  const freshId = (): string => {
    const cryptoObj = globalThis.crypto;
    return cryptoObj?.randomUUID
      ? `node_${cryptoObj.randomUUID()}`
      : `node_${Math.random().toString(36).slice(2, 11)}`;
  };
  const walk = (n: CanvasNode): CanvasNode => ({
    ...n,
    id: freshId(),
    platform,
    props: { ...n.props },
    children: n.children.map(walk)
  });
  return walk(node);
};

/** Translate a subtree by (dx, dy) canvas units, in place (operates on clones). */
const offsetDeep = (node: CanvasNode, delta: number): void => {
  node.props = { ...node.props, x: numProp(node, 'x') + delta, y: numProp(node, 'y') + delta };
  for (const child of node.children) offsetDeep(child, delta);
};

const locateOrFallback = (
  nodes: CanvasNode[],
  id: string
): { parentPath: string[]; index: number } | null => {
  let result: { parentPath: string[]; index: number } | null = null;
  const walk = (list: CanvasNode[], parentPath: string[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        result = { parentPath, index: i };
        return true;
      }
      if (walk(list[i].children, [...parentPath, list[i].id])) return true;
    }
    return false;
  };
  walk(nodes, []);
  return result;
};

const insertCommand = (node: CanvasNode, parentPath: string[], index: number, label: string): HistoryCommand => ({
  type: 'add',
  label,
  apply: (nodes) => insertAt(nodes, parentPath, node, index),
  invert: (nodes) => removeDeep(nodes, node.id)
});

const insertAt = (nodes: CanvasNode[], parentPath: string[], node: CanvasNode, index: number): CanvasNode[] => {
  if (parentPath.length === 0) {
    const next = [...nodes];
    next.splice(index < 0 || index > next.length ? next.length : index, 0, node);
    return next;
  }
  const [head, ...rest] = parentPath;
  return nodes.map((candidate) =>
    candidate.id === head
      ? rest.length === 0
        ? {
            ...candidate,
            children: (() => {
              const kids = [...candidate.children];
              kids.splice(index < 0 || index > kids.length ? kids.length : index, 0, node);
              return kids;
            })()
          }
        : { ...candidate, children: insertAt(candidate.children, rest, node, index) }
      : candidate
  );
};

const removeDeep = (nodes: CanvasNode[], id: string): CanvasNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children.length > 0 ? { ...node, children: removeDeep(node.children, id) } : node));
