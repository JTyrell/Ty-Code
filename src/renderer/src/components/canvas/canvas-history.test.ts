/**
 * canvas-history unit tests (Prompt 3, Step 1)
 *
 * Proves the STRICT RULE "history mutations are pure functions over the AST
 * (testable)" and Verification #1: "Undo/redo restores exact prior state for
 * every op type including coalesced drags and reparents", plus cap = 100.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../state/canvas-store';
import {
  CanvasHistory,
  HISTORY_CAP,
  addNodeCommand,
  deleteNodeCommand,
  findNodeInTree,
  findParentPath,
  groupCommand,
  propsCommand,
  removeInTree,
  reorderCommand,
  reparentCommand,
  setPropsInTree,
  ungroupCommand
} from './canvas-history';

type Props = Record<string, string | number | boolean>;

const node = (id: string, type = 'button', props: Props = {}, children: CanvasNode[] = []): CanvasNode => ({
  id,
  type,
  platform: 'react',
  props: { x: 0, y: 0, width: 100, height: 40, ...props },
  children
});

const tree = (): CanvasNode[] => [
  node('a', 'button', { x: 10, y: 10 }),
  node('b', 'container', {}, [node('b1', 'text', { x: 20, y: 20 }), node('b2', 'text', { x: 30, y: 30 })]),
  node('c', 'button', { x: 40, y: 40 })
];

describe('canvas-history — pure tree transforms', () => {
  it('findNodeInTree / findParentPath walk nested trees', () => {
    const nodes = tree();
    expect(findNodeInTree(nodes, 'b2')?.type).toBe('text');
    expect(findParentPath(nodes, 'b2')).toEqual(['b']);
    expect(findParentPath(nodes, 'a')).toEqual([]);
    expect(findNodeInTree(nodes, 'missing')).toBeNull();
  });

  it('setPropsInTree / removeInTree are immutable over the input', () => {
    const nodes = tree();
    const frozen = JSON.parse(JSON.stringify(nodes));
    const patched = setPropsInTree(nodes, 'b2', { x: 99 });
    const removed = removeInTree(nodes, 'b1');
    expect(nodes).toEqual(frozen);
    expect(findNodeInTree(patched, 'b2')?.props.x).toBe(99);
    expect(findNodeInTree(removed, 'b1')).toBeNull();
  });
});

describe('canvas-history — apply/invert round-trips per op type', () => {
  const roundTrip = (
    before: CanvasNode[],
    cmd: { apply: (n: CanvasNode[]) => CanvasNode[]; invert: (n: CanvasNode[]) => CanvasNode[] }
  ): void => {
    const after = cmd.apply(before);
    expect(after).not.toBe(before);
    expect(cmd.invert(after)).toEqual(before);
  };

  it('add (top level, remove-id fallback)', () => roundTrip(tree(), addNodeCommand(node('d'), [], 1)));
  it('add (child, parent-snapshot restore)', () => {
    const parent = findNodeInTree(tree(), 'b')!;
    roundTrip(tree(), addNodeCommand(node('d'), ['b'], 0, parent));
  });
  it('delete (top level)', () => roundTrip(tree(), deleteNodeCommand(tree()[2], [], 2)));
  it('delete (child, parent-snapshot restore)', () => {
    const parent = findNodeInTree(tree(), 'b')!;
    const b1 = findNodeInTree(tree(), 'b1')!;
    roundTrip(tree(), deleteNodeCommand(b1, ['b'], 0, parent));
  });
  it('restyle replaces the full prop map — added AND removed keys invert', () => {
    const a = findNodeInTree(tree(), 'a')!;
    // Adding props: after has extras the before lacks → undo strips them.
    roundTrip(
      tree(),
      propsCommand('restyle', 'Restyle', { a: { ...a.props } }, { a: { ...a.props, label: 'Go', height: 48 } })
    );
    // Removing a prop: build a tree that HAS a label, then a command whose
    // `after` drops it and `before` keeps it, so the round-trip is honest.
    const withLabel = setPropsInTree(tree(), 'a', { label: 'Hi' });
    const aLabel = findNodeInTree(withLabel, 'a')!;
    roundTrip(
      withLabel,
      propsCommand('restyle', 'Restyle', { a: { ...aLabel.props } }, { a: { x: 10, y: 10, width: 100, height: 40 } })
    );
  });
  it('move (props with coalesce key)', () =>
    roundTrip(
      tree(),
      propsCommand('move', 'Move', { a: { x: 10, y: 10, width: 100, height: 40 } }, { a: { x: 15, y: 12, width: 100, height: 40 } }, 'move:a')
    ));
  it('resize', () =>
    roundTrip(tree(), propsCommand('resize', 'Resize', { a: { x: 10, y: 10, width: 100, height: 40 } }, { a: { x: 10, y: 10, width: 250, height: 80 } })));
  it('reparent into a container', () => {
    const c = findNodeInTree(tree(), 'c')!;
    roundTrip(tree(), reparentCommand(c, { id: 'c', fromParentPath: [], fromIndex: 2, toParentPath: ['b'], toIndex: 1 }));
  });
  it('reparent within the same parent (forward and backward)', () => {
    const b1 = findNodeInTree(tree(), 'b1')!;
    roundTrip(tree(), reparentCommand(b1, { id: 'b1', fromParentPath: ['b'], fromIndex: 0, toParentPath: ['b'], toIndex: 2 }));
    const b2 = findNodeInTree(tree(), 'b2')!;
    roundTrip(tree(), reparentCommand(b2, { id: 'b2', fromParentPath: ['b'], fromIndex: 1, toParentPath: ['b'], toIndex: 0 }));
  });
  it('z-order reorder', () => roundTrip(tree(), reorderCommand([], ['a', 'b', 'c'], ['c', 'a', 'b'])));
  it('group + ungroup restore the exact pre-op tree', () => {
    const start = tree();
    const container = node('g1', 'group');
    // Grouping NON-contiguous ids (a@0, c@2) must still undo to the exact tree.
    roundTrip(start, groupCommand(container, [], 0, ['a', 'c'], start));
    // Ungrouping the grouped tree restores it exactly via its source snapshot.
    const grouped = groupCommand(container, [], 0, ['a', 'c'], start).apply(start);
    roundTrip(grouped, ungroupCommand('g1', [], 0, grouped));
  });
});

describe('canvas-history — stack, coalescing, cap', () => {
  it('undo/redo restore exact state through the stack', () => {
    const h = new CanvasHistory();
    const start = tree();
    const cmd = propsCommand('resize', 'Resize', { a: { x: 10, y: 10, width: 100, height: 40 } }, { a: { x: 10, y: 10, width: 250, height: 40 } });
    h.record(cmd);
    const resized = cmd.apply(start);
    expect(h.undo(resized)).toEqual(start);
    expect(h.redo(start)).toEqual(resized);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('coalesces a gesture of many move updates into ONE undo entry', () => {
    const h = new CanvasHistory();
    const start = tree();
    let nodes = start;
    const base = { x: 10, y: 10, width: 100, height: 40 };
    h.beginGesture();
    // A drag fires incremental absolute-prop updates; the merged entry must keep
    // the FIRST invert (gesture start) and the LATEST apply (gesture end).
    for (const x of [11, 14, 20, 31]) {
      const cmd = propsCommand('move', 'Move', { a: base }, { a: { ...base, x } }, 'move:a');
      nodes = cmd.apply(nodes);
      h.record(cmd);
    }
    h.endGesture();
    expect(nodes).toEqual(setPropsInTree(start, 'a', { x: 31, y: 10, width: 100, height: 40 }));
    expect(h.size).toBe(1);
    const restored = h.undo(nodes);
    expect(restored).toEqual(start);
    // Redo jumps straight to the gesture's END state.
    expect(h.redo(restored)).toEqual(nodes);
  });

  it('does NOT coalesce across separate gestures', () => {
    const h = new CanvasHistory();
    const key = 'move:a';
    const base = { x: 1, y: 0, width: 100, height: 40 };
    h.beginGesture();
    h.record(propsCommand('move', 'Move', { a: base }, { a: { ...base, x: 2 } }, key));
    h.endGesture();
    h.beginGesture();
    h.record(propsCommand('move', 'Move', { a: { ...base, x: 2 } }, { a: { ...base, x: 3 } }, key));
    h.endGesture();
    expect(h.size).toBe(2);
  });

  it('records separate entries without a gesture', () => {
    const h = new CanvasHistory();
    const key = 'move:a';
    h.record(propsCommand('move', 'Move', { a: { x: 1 } }, { a: { x: 2 } }, key));
    h.record(propsCommand('move', 'Move', { a: { x: 2 } }, { a: { x: 3 } }, key));
    expect(h.size).toBe(2);
  });

  it('caps the stack at 100, dropping the oldest entries', () => {
    const h = new CanvasHistory();
    for (let i = 0; i < HISTORY_CAP + 25; i++) {
      h.record(propsCommand('restyle', `Op ${i}`, { a: { x: 0 } }, { a: { x: i } }));
    }
    expect(h.size).toBe(HISTORY_CAP);
    expect(h.undoLabels()[0]).toBe('Op 25');
  });

  it('recording a new command clears the redo stack', () => {
    const h = new CanvasHistory();
    const start = tree();
    h.record(addNodeCommand(node('d'), [], -1));
    h.undo(start);
    expect(h.canRedo).toBe(true);
    h.record(deleteNodeCommand(start[0], [], 0));
    expect(h.canRedo).toBe(false);
  });

  it('undo/redo on an empty stack return the tree untouched', () => {
    const h = new CanvasHistory();
    const start = tree();
    expect(h.undo(start)).toBe(start);
    expect(h.redo(start)).toBe(start);
  });

  it('clear() empties both stacks and notifies listeners', () => {
    const h = new CanvasHistory();
    let notified = 0;
    const off = h.onChange(() => notified++);
    h.record(propsCommand('restyle', 'R', { a: {} }, { a: { x: 1 } }));
    h.clear();
    off();
    expect(h.size).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(notified).toBe(2); // record + clear
  });

  it('CanvasHistory.locate reports parentPath and index', () => {
    const nodes = tree();
    expect(CanvasHistory.locate(nodes, 'b1')).toEqual({ parentPath: ['b'], index: 0 });
    expect(CanvasHistory.locate(nodes, 'c')).toEqual({ parentPath: [], index: 2 });
    expect(CanvasHistory.locate(nodes, 'nope')).toBeNull();
  });
});
