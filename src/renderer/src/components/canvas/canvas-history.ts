/**
 * Canvas History (M3E Sketcher — Prompt 3, Step 1)
 *
 * A command stack for the Sketcher's editing operations. The governing rule is
 * that every mutation is a PURE function over the node AST: `apply(nodes)`
 * returns a new tree and `invert(nodes)` returns the tree as it was, so undo /
 * redo restores the EXACT prior state for every op type (add / delete / move /
 * resize / restyle / reparent / z-order / group) with no reliance on DOM or on
 * the store. That purity is what makes the stack unit-testable in isolation.
 *
 * Coalescing: a single drag gesture fires many intermediate updates but must be
 * ONE undo entry. A command carries an optional `coalesceKey`; `record()` merges
 * a command whose key matches the current top, keeping that top's `invert` (the
 * gesture's start state) and swapping in the newest `apply` (the gesture's end
 * state). The stack is capped at {@link HISTORY_CAP} and is session-only — it is
 * never persisted, so closing the window drops it (matching the spec).
 */

import type { CanvasNode, CanvasPropValue } from '../../state/canvas-store';

export type CanvasOpType =
  | 'add'
  | 'delete'
  | 'move'
  | 'resize'
  | 'restyle'
  | 'reparent'
  | 'zorder'
  | 'group'
  | 'ungroup';

export interface HistoryCommand {
  type: CanvasOpType;
  label: string;
  /** Consecutive commands sharing a key merge into one undo entry (a gesture). */
  coalesceKey?: string;
  apply: (nodes: CanvasNode[]) => CanvasNode[];
  invert: (nodes: CanvasNode[]) => CanvasNode[];
}

export const HISTORY_CAP = 100;

// ---------------------------------------------------------------------------
// Pure tree navigation
// ---------------------------------------------------------------------------

export const findNodeInTree = (nodes: CanvasNode[], id: string): CanvasNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNodeInTree(node.children, id);
    if (hit) return hit;
  }
  return null;
};

/** The ids from the root down to the node's parent; [] means a top-level node. */
export const findParentPath = (nodes: CanvasNode[], id: string): string[] | null => {
  const walk = (list: CanvasNode[], path: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === id) return path;
      const hit = walk(node.children, [...path, node.id]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(nodes, []);
};

/** Index of `id` within its sibling list at `parentPath` ([] = top level). */
const indexOfInList = (nodes: CanvasNode[], parentPath: string[], id: string): number => {
  const list = parentPath.length === 0 ? nodes : resolveChildren(nodes, parentPath);
  return list ? list.findIndex((n) => n.id === id) : -1;
};

export const resolveChildren = (nodes: CanvasNode[], parentPath: string[]): CanvasNode[] | null => {
  let list: CanvasNode[] = nodes;
  for (const id of parentPath) {
    const parent = list.find((n) => n.id === id);
    if (!parent) return null;
    list = parent.children;
  }
  return list;
};

// ---------------------------------------------------------------------------
// Pure transforms (immutable rebuild — never mutate the input tree)
// ---------------------------------------------------------------------------

export const setPropsInTree = (
  nodes: CanvasNode[],
  id: string,
  patch: Record<string, CanvasPropValue>
): CanvasNode[] =>
  nodes.map((node) =>
    node.id === id
      ? { ...node, props: { ...node.props, ...patch } }
      : node.children.length > 0
        ? { ...node, children: setPropsInTree(node.children, id, patch) }
        : node
  );

export const removeInTree = (nodes: CanvasNode[], id: string): CanvasNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children.length > 0 ? { ...node, children: removeInTree(node.children, id) } : node
    );

/** Insert `node` into the children at `parentPath` at `index` (append if < 0). */
export const insertInTree = (
  nodes: CanvasNode[],
  parentPath: string[],
  node: CanvasNode,
  index = -1
): CanvasNode[] => {
  if (parentPath.length === 0) {
    const next = [...nodes];
    next.splice(index < 0 ? next.length : index, 0, node);
    return next;
  }
  const [head, ...rest] = parentPath;
  return nodes.map((candidate) => {
    if (candidate.id !== head) return candidate;
    if (rest.length === 0) {
      const children = [...candidate.children];
      children.splice(index < 0 ? children.length : index, 0, node);
      return { ...candidate, children };
    }
    return { ...candidate, children: insertInTree(candidate.children, rest, node, index) };
  });
};

export const replaceNodeInTree = (
  nodes: CanvasNode[],
  id: string,
  nextNode: CanvasNode
): CanvasNode[] =>
  nodes.map((node) =>
    node.id === id
      ? nextNode
      : node.children.length > 0
        ? { ...node, children: replaceNodeInTree(node.children, id, nextNode) }
        : node
  );

/**
 * Replace the ENTIRE child list at `parentPath` ([] = top level). Used by
 * restores that must reproduce a captured snapshot exactly — key order,
 * removed props, and sibling indices included — which merge- or reinsert-based
 * inverses cannot guarantee.
 */
export const replaceChildrenInTree = (
  nodes: CanvasNode[],
  parentPath: string[],
  nextChildren: CanvasNode[]
): CanvasNode[] => {
  if (parentPath.length === 0) return nextChildren.map((node) => ({ ...node }));
  const [head, ...rest] = parentPath;
  return nodes.map((candidate) => {
    if (candidate.id !== head) return candidate;
    if (rest.length === 0) return { ...candidate, children: nextChildren.map((node) => ({ ...node })) };
    return {
      ...candidate,
      children: replaceChildrenInTree(candidate.children, rest, nextChildren)
    };
  });
};

/** Reorder the children of `parentPath` to match `orderedIds`. */
export const reorderChildren = (
  nodes: CanvasNode[],
  parentPath: string[],
  orderedIds: string[]
): CanvasNode[] => {
  const applyOrder = (children: CanvasNode[]): CanvasNode[] => {
    const byId = new Map(children.map((c) => [c.id, c] as const));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is CanvasNode => Boolean(c));
    // Append any child not named in `orderedIds` so nothing is silently dropped.
    for (const child of children) {
      if (!orderedIds.includes(child.id)) ordered.push(child);
    }
    return ordered;
  };
  if (parentPath.length === 0) return applyOrder(nodes);
  const [head, ...rest] = parentPath;
  return nodes.map((candidate) => {
    if (candidate.id !== head) return candidate;
    if (rest.length === 0) return { ...candidate, children: applyOrder(candidate.children) };
    return { ...candidate, children: reorderChildren(candidate.children, rest, orderedIds) };
  });
};

// ---------------------------------------------------------------------------
// Command factories — each captures the "before" it needs to invert exactly
// ---------------------------------------------------------------------------

export function addNodeCommand(
  node: CanvasNode,
  parentPath: string[],
  index: number,
  parentNode?: CanvasNode | null
): HistoryCommand {
  // With a captured parent snapshot the invert restores the parent's whole
  // child list exactly (even if the added node was restyled before the undo);
  // without one, removing the inserted id at its level is the fallback.
  const restore = (nodes: CanvasNode[]): CanvasNode[] =>
    parentNode
      ? replaceNodeInTree(nodes, parentNode.id, { ...parentNode })
      : parentPath.length === 0
        ? nodes.filter((n) => n.id !== node.id).map((n) => ({ ...n }))
        : replaceChildrenInTree(
            nodes,
            parentPath.slice(0, -1),
            resolveChildren(nodes, parentPath.slice(0, -1))?.filter((n) => n.id !== node.id) ?? []
          );
  return {
    type: 'add',
    label: `Add ${node.type}`,
    apply: (nodes) => insertInTree(nodes, parentPath, node, index),
    invert: restore
  };
}

export function deleteNodeCommand(
  node: CanvasNode,
  parentPath: string[],
  index: number,
  parentNode?: CanvasNode | null
): HistoryCommand {
  const restore = (nodes: CanvasNode[]): CanvasNode[] =>
    parentNode
      ? replaceNodeInTree(nodes, parentNode.id, { ...parentNode })
      : parentPath.length === 0
        ? insertInTree(nodes.map((n) => ({ ...n })), [], { ...node }, index)
        : replaceChildrenInTree(
            nodes,
            parentPath.slice(0, -1),
            insertInTree(resolveChildren(nodes, parentPath.slice(0, -1)) ?? [], [parentPath[parentPath.length - 1]], { ...node }, index)
          );
  return {
    type: 'delete',
    label: `Delete ${node.name || node.type}`,
    apply: (nodes) => removeInTree(nodes, node.id),
    invert: restore
  };
}

/**
 * A restyle / move / resize command expressed as absolute before+after prop
 * maps per node id. Maps are FULL replacements (not merges) so removing a prop
 * inverts exactly, and absolute (not delta) so a coalesced gesture keeps the
 * first `before` and the latest `after`.
 */
export function propsCommand(
  type: CanvasOpType,
  label: string,
  before: Record<string, Record<string, CanvasPropValue>>,
  after: Record<string, Record<string, CanvasPropValue>>,
  coalesceKey?: string
): HistoryCommand {
  const replaceProps = (
    nodes: CanvasNode[],
    map: Record<string, Record<string, CanvasPropValue>>
  ): CanvasNode[] => {
    let next = nodes;
    for (const [id, props] of Object.entries(map)) {
      if (!findNodeInTree(next, id)) continue;
      next = replaceNodeInTree(next, id, { ...findNodeInTree(next, id)!, props: { ...props } });
    }
    return next;
  };
  return {
    type,
    label,
    coalesceKey,
    apply: (nodes) => replaceProps(nodes, after),
    invert: (nodes) => replaceProps(nodes, before)
  };
}

export interface ReparentSnapshot {
  id: string;
  fromParentPath: string[];
  fromIndex: number;
  toParentPath: string[];
  toIndex: number;
}

export function reparentCommand(node: CanvasNode, snap: ReparentSnapshot): HistoryCommand {
  return {
    type: 'reparent',
    label: `Move ${node.name || node.type}`,
    apply: (nodes) => {
      const without = removeInTree(nodes, node.id);
      // Adjust the destination index when re-inserting into the SAME parent we
      // just removed from, since removal shifts later indices left by one.
      const sameParent =
        snap.fromParentPath.length === snap.toParentPath.length &&
        snap.fromParentPath.every((id, i) => id === snap.toParentPath[i]);
      const toIndex = sameParent && snap.toIndex > snap.fromIndex ? snap.toIndex - 1 : snap.toIndex;
      return insertInTree(without, snap.toParentPath, node, toIndex);
    },
    invert: (nodes) => insertInTree(removeInTree(nodes, node.id), snap.fromParentPath, node, snap.fromIndex)
  };
}

export function reorderCommand(
  parentPath: string[],
  beforeIds: string[],
  afterIds: string[],
  label = 'Reorder layers'
): HistoryCommand {
  return {
    type: 'zorder',
    label,
    apply: (nodes) => reorderChildren(nodes, parentPath, afterIds),
    invert: (nodes) => reorderChildren(nodes, parentPath, beforeIds)
  };
}

/** Deep-copy a tree so a captured snapshot can never alias live state. */
const cloneTree = (nodes: CanvasNode[]): CanvasNode[] => JSON.parse(JSON.stringify(nodes)) as CanvasNode[];

/**
 * Group: wrap `ids` (siblings under `parentPath`) into a new container built
 * from the CURRENT live child states. Pass the pre-group tree as `source` and
 * the invert restores it verbatim — exact for non-contiguous selections too;
 * without it the inverse dissolves the container back into its slot.
 */
export function groupCommand(
  container: CanvasNode,
  parentPath: string[],
  index: number,
  ids: string[],
  source?: CanvasNode[]
): HistoryCommand {
  const dissolveInto = (nodes: CanvasNode[]): CanvasNode[] => {
    const containerNode = findNodeInTree(nodes, container.id);
    const kids = containerNode ? containerNode.children : [];
    const without = removeInTree(nodes, container.id);
    if (parentPath.length === 0) {
      const list = [...without];
      kids.forEach((kid, i) => list.splice(Math.min(index + i, list.length), 0, { ...kid }));
      return list;
    }
    const grandPath = parentPath.slice(0, -1);
    const members = resolveChildren(without, grandPath) ?? [];
    const restored = [...members];
    kids.forEach((kid, i) => restored.splice(Math.min(index + i, restored.length), 0, { ...kid }));
    return replaceChildrenInTree(without, grandPath, restored);
  };
  return {
    type: 'group',
    label: 'Group selection',
    apply: (nodes) => {
      const grabbed = ids
        .map((id) => findNodeInTree(nodes, id))
        .filter((n): n is CanvasNode => Boolean(n));
      let next = nodes;
      for (const id of ids) next = removeInTree(next, id);
      const withKids: CanvasNode = { ...container, children: grabbed };
      return insertInTree(next, parentPath, withKids, index);
    },
    invert: (nodes) => (source ? cloneTree(source) : dissolveInto(nodes))
  };
}

/**
 * Ungroup: dissolve the container `groupId` at `parentPath` slot `index`,
 * spilling its members in place. Pass the pre-ungroup tree as `source` and
 * the invert restores it verbatim (re-forming the group exactly).
 */
export function ungroupCommand(
  groupId: string,
  parentPath: string[],
  index: number,
  source?: CanvasNode[]
): HistoryCommand {
  // Captured during apply so the no-snapshot invert can re-form the group.
  let groupShape: CanvasNode | null = null;
  const dissolve = (nodes: CanvasNode[]): CanvasNode[] => {
    const group = findNodeInTree(nodes, groupId);
    if (!group) return nodes;
    groupShape = { ...group, children: group.children.map((k) => ({ ...k })) };
    const without = removeInTree(nodes, groupId);
    if (parentPath.length === 0) {
      const list = [...without];
      group.children.forEach((kid, i) => list.splice(Math.min(index + i, list.length), 0, { ...kid }));
      return list;
    }
    const grandPath = parentPath.slice(0, -1);
    const members = resolveChildren(without, grandPath) ?? [];
    const restored = [...members];
    group.children.forEach((kid, i) => restored.splice(Math.min(index + i, restored.length), 0, { ...kid }));
    return replaceChildrenInTree(without, grandPath, restored);
  };
  const regroup = (nodes: CanvasNode[]): CanvasNode[] => {
    const shape = groupShape ?? findNodeInTree(nodes, groupId);
    const kids = shape ? shape.children : [];
    const container = { ...(shape ?? { id: groupId, type: 'group', platform: 'other', props: {}, children: [] }), children: [] } as CanvasNode;
    return groupCommand(container, parentPath, index, kids.map((k) => k.id)).apply(nodes);
  };
  return {
    type: 'ungroup',
    label: 'Ungroup',
    apply: dissolve,
    invert: (nodes) => (source ? cloneTree(source) : regroup(nodes))
  };
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export type HistoryListener = () => void;

export class CanvasHistory {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private listeners = new Set<HistoryListener>();
  /** Token of the OPEN gesture, or null; a coalesce only merges within one. */
  private activeGestureToken: number | null = null;
  /** Monotonic so two separate gestures can never share a token value. */
  private gestureCounter = 0;
  private lastGestureToken = new WeakMap<HistoryCommand, number>();

  onChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[canvas-history] listener threw', err);
      }
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get size(): number {
    return this.undoStack.length;
  }

  /**
   * Open a coalescing gesture. Every command recorded with the same
   * `coalesceKey` before the matching {@link endGesture} merges into one entry,
   * so a continuous drag produces a single undo step.
   */
  beginGesture(): void {
    this.gestureCounter += 1;
    this.activeGestureToken = this.gestureCounter;
  }

  endGesture(): void {
    this.activeGestureToken = null;
  }

  /**
   * Record a command. Consecutive commands sharing a `coalesceKey` within one
   * active gesture merge (the first `invert` and the latest `apply` win).
   */
  record(command: HistoryCommand): void {
    const top = this.undoStack[this.undoStack.length - 1];
    // Merge only inside an OPEN gesture and only when the top was recorded in
    // THIS same gesture token — a closed gesture must never absorb into it.
    if (
      command.coalesceKey &&
      this.activeGestureToken !== null &&
      top &&
      top.coalesceKey === command.coalesceKey &&
      this.lastGestureToken.get(top) === this.activeGestureToken
    ) {
      // Merge: keep the original inverse, adopt the newest forward transform.
      const merged: HistoryCommand = {
        ...command,
        invert: top.invert,
        label: top.label
      };
      this.undoStack[this.undoStack.length - 1] = merged;
      this.lastGestureToken.set(merged, this.activeGestureToken);
      this.redoStack = [];
      this.emit();
      return;
    }

    this.undoStack.push(command);
    this.lastGestureToken.set(command, this.activeGestureToken ?? -1);
    if (this.undoStack.length > HISTORY_CAP) this.undoStack.shift();
    this.redoStack = [];
    this.emit();
  }

  /** Undo the top command against `nodes`, returning the restored tree. */
  undo(nodes: CanvasNode[]): CanvasNode[] {
    const command = this.undoStack.pop();
    if (!command) return nodes;
    const next = command.invert(nodes);
    this.redoStack.push(command);
    this.emit();
    return next;
  }

  /** Redo the top redo command against `nodes`, returning the re-applied tree. */
  redo(nodes: CanvasNode[]): CanvasNode[] {
    const command = this.redoStack.pop();
    if (!command) return nodes;
    const next = command.apply(nodes);
    this.undoStack.push(command);
    this.lastGestureToken.set(command, -1);
    this.emit();
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.activeGestureToken = null;
    this.emit();
  }

  // -- inspection (for tests + an Undo/Redo menu affordance) ----------------

  peekUndo(): HistoryCommand | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): HistoryCommand | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  undoLabels(): string[] {
    return this.undoStack.map((c) => c.label);
  }

  /** Index helpers kept here so callers need not reimplement tree walking. */
  static locate(nodes: CanvasNode[], id: string): { parentPath: string[]; index: number } | null {
    const parentPath = findParentPath(nodes, id);
    if (!parentPath) return null;
    return { parentPath, index: indexOfInList(nodes, parentPath, id) };
  }
}

/** Shared session-only singleton used by the open Sketcher window. */
export const canvasHistory = new CanvasHistory();
