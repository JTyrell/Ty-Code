/**
 * canvas-editing controller tests (Prompt 3, Verification #1/#4/#5)
 *
 * Drives the controller against an in-memory tree (the same shape the store
 * holds) so every op — gesture move, resize, restyle, delete, reparent-adjacent
 * duplicate, align, distribute, nudge, clipboard — is undone/redone exactly,
 * with no React or DOM in the loop.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasNode, CanvasPropValue } from '../../state/canvas-store';
import { canvasHistory } from './canvas-history';
import { CanvasEditController, nodeRectOf, unionRectOfIds } from './canvas-editing';

type Props = Record<string, CanvasPropValue>;

const node = (id: string, type = 'button', props: Props = {}, children: CanvasNode[] = []): CanvasNode => ({
  id,
  type,
  platform: 'react',
  props: { x: 0, y: 0, width: 100, height: 40, ...props },
  children
});

interface Harness {
  tree: CanvasNode[];
  selection: string[];
  writes: string[];
}

const makeHarness = (initial: CanvasNode[]): Harness => ({
  tree: initial,
  selection: [],
  writes: []
});

const makeController = (h: Harness): CanvasEditController =>
  new CanvasEditController({
    treeOf: () => h.tree,
    replaceOf: (nodes) => {
      h.tree = nodes;
    },
    selectionOf: () => h.selection,
    platformOf: () => 'react',
    clipboardOf: () => ({ write: (text) => h.writes.push(text) })
  });

const sample = (): CanvasNode[] => [
  node('a', 'button', { x: 10, y: 10, width: 100, height: 40 }),
  node('b', 'container', { x: 0, y: 0, width: 300, height: 200 }, [
    node('b1', 'text', { x: 20, y: 30, width: 80, height: 20 })
  ]),
  node('c', 'card', { x: 250, y: 300, width: 120, height: 90 })
];

beforeEach(() => {
  canvasHistory.clear();
});

describe('CanvasEditController — gestures', () => {
  it('a drag gesture records ONE entry that undoes to the start position', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.beginPositionsGesture(['a']);
    // Live updates are visible but unrecorded.
    for (const x of [20, 40, 70]) {
      ctrl.applyLive({ a: { x, y: 10 } });
      expect(canvasHistory.size).toBe(0);
    }
    ctrl.commitPositions('move', 'Move');
    expect(canvasHistory.size).toBe(1);
    expect(h.tree[0].props.x).toBe(70);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
    ctrl.redo();
    expect(h.tree[0].props.x).toBe(70);
  });

  it('a gesture that never moved records nothing', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.beginPositionsGesture(['a']);
    ctrl.applyLive({ a: { x: 10, y: 10 } });
    ctrl.commitPositions('move', 'Move');
    expect(canvasHistory.size).toBe(0);
  });

  it('nudge is discrete and restores exactly on undo', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.nudge(1, 0);
    ctrl.nudge(1, 0);
    expect(h.tree[0].props.x).toBe(12);
    expect(canvasHistory.size).toBe(2);
    ctrl.undo();
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('nudging a parent moves its subtree together', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['b'];
    ctrl.nudge(0, 10);
    expect(h.tree[1].props.y).toBe(10);
    expect((h.tree[1].children[0].props as Props).y).toBe(40);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — add / delete', () => {
  it('addLayer appends a top-level node that undoes by removing it', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    const id = ctrl.addLayer({ type: 'button' });
    expect(h.tree).toHaveLength(4);
    expect(h.tree[3].id).toBe(id);
    expect(h.tree[3].props.width).toBe(128);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — restyle / delete', () => {
  it('restyle round-trips', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.restyle('a', { label: 'Go' }, 'Restyle');
    expect(h.tree[0].props.label).toBe('Go');
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('delete restores the node at its exact slot (top level)', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['c'];
    ctrl.deleteSelection();
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'b']);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('delete of a nested node restores it inside its parent', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['b1'];
    ctrl.deleteSelection();
    expect(h.tree[1].children).toHaveLength(0);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('deleting a selected parent deletes the subtree once', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['b', 'b1'];
    ctrl.deleteSelection();
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'c']);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — align / distribute', () => {
  it('align left moves both nodes to the union edge and undoes', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a', 'c'];
    ctrl.align('left');
    expect(h.tree[0].props.x).toBe(10);
    expect(h.tree[2].props.x).toBe(10);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('distribute needs 3+ nodes (no-op below)', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a', 'c'];
    ctrl.distribute('h');
    expect(h.tree).toEqual(sample());
    expect(canvasHistory.size).toBe(0);
  });
});

describe('CanvasEditController — clipboard', () => {
  it('copy writes canvas-node JSON through the clipboard service', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    expect(ctrl.copySelection()).toBe(true);
    expect(h.writes[0]).toContain('tycode.canvas-nodes');
    expect(JSON.parse(h.writes[0]).payload[0].id).toBe('a');
  });

  it('paste appends an offset duplicate with fresh ids', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.copySelection();
    h.selection = [];
    ctrl.paste();
    expect(h.tree).toHaveLength(4);
    const pasted = h.tree[3];
    expect(pasted.id).not.toBe('a');
    expect(pasted.props.x).toBe(26);
    expect(pasted.props.y).toBe(26);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('paste accepts a JSON payload from the shared clipboard text', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    const payload = JSON.stringify({ kind: 'tycode.canvas-nodes', payload: [node('x', 'text', { x: 5, y: 5 })] });
    ctrl.paste(payload);
    expect(h.tree[3].props.x).toBe(21);
  });

  it('cut deletes as well as copies, and one undo restores', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.cutSelection();
    expect(h.tree.map((n) => n.id)).toEqual(['b', 'c']);
    ctrl.undo(); // restore the delete
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    ctrl.undo(); // the copy recorded nothing, so this is the tree before delete
    expect(h.tree).toEqual(sample());
  });

  it('duplicate offsets by 16 and inserts next to the source', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.duplicateSelection();
    expect(h.tree).toHaveLength(4);
    expect(h.tree[1].props.x).toBe(26);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — rect helpers', () => {
  it('nodeRectOf reads the props layout box', () => {
    expect(nodeRectOf(sample()[0])).toEqual({ x: 10, y: 10, width: 100, height: 40 });
  });

  it('unionRectOfIds unions the selection including descendants', () => {
    const box = unionRectOfIds(sample(), ['b']);
    // b (0,0,300,200) ∪ b1 (20,30,80,20) → still b's box.
    expect(box).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('CanvasEditController — z-order', () => {
  it('bring to front / send to back reorder the top-level list and undo', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.zorder('front');
    expect(h.tree.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    ctrl.undo();
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    h.selection = ['c'];
    ctrl.zorder('back');
    expect(h.tree.map((n) => n.id)).toEqual(['c', 'a', 'b']);
    ctrl.undo();
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('bring forward moves one slot up; no-op when already at the top', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.zorder('forward');
    expect(h.tree.map((n) => n.id)).toEqual(['b', 'a', 'c']);
    // 'c' is already last, so forward records nothing.
    h.selection = ['c'];
    ctrl.zorder('forward');
    expect(canvasHistory.size).toBe(1);
    expect(h.tree.map((n) => n.id)).toEqual(['b', 'a', 'c']);
    ctrl.undo();
    expect(h.tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('CanvasEditController — group / ungroup', () => {
  it('group wraps siblings in a container and ungroup restores exactly', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a', 'c'];
    ctrl.groupSelection();
    expect(h.tree).toHaveLength(2);
    const group = h.tree.find((n) => n.name === 'Group');
    expect(group).toBeTruthy();
    expect(group!.children.map((c) => c.id).sort()).toEqual(['a', 'c']);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('ungroup dissolves a group and undo re-forms it exactly', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a', 'c'];
    ctrl.groupSelection();
    const grouped = JSON.parse(JSON.stringify(h.tree));
    const groupId = h.tree.find((n) => n.name === 'Group')!.id;
    h.selection = [groupId];
    ctrl.ungroupSelection();
    expect(h.tree.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(h.tree.find((n) => n.name === 'Group')).toBeFalsy();
    ctrl.undo();
    expect(h.tree).toEqual(grouped);
  });

  it('grouping fewer than two nodes is a no-op', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    h.selection = ['a'];
    ctrl.groupSelection();
    expect(canvasHistory.size).toBe(0);
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — reparent', () => {
  it('reparents a node into another container and restores on undo', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.reparent('a', ['b'], 0);
    expect(h.tree.map((n) => n.id)).toEqual(['b', 'c']);
    expect(h.tree[0].children.map((c) => c.id)).toEqual(['a', 'b1']);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
  });

  it('refuses to drop a node inside its own subtree', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.reparent('b', ['b'], 0);
    expect(canvasHistory.size).toBe(0);
    expect(h.tree).toEqual(sample());
  });
});

describe('CanvasEditController — rename', () => {
  it('renames a layer and restores the prior name exactly on undo', () => {
    const h = makeHarness(sample());
    const ctrl = makeController(h);
    ctrl.rename('a', 'Primary CTA');
    expect(h.tree[0].name).toBe('Primary CTA');
    expect(canvasHistory.size).toBe(1);
    // A rename to the same value records nothing.
    ctrl.rename('a', 'Primary CTA');
    expect(canvasHistory.size).toBe(1);
    ctrl.undo();
    expect(h.tree).toEqual(sample());
    ctrl.redo();
    expect(h.tree[0].name).toBe('Primary CTA');
  });
});

describe('CanvasEditController.marqueeHits', () => {
  it('selects only top-level nodes the rectangle fully encloses', () => {
    const nodes = sample();
    // 'a' is 10..110 / 10..50; this box encloses it but not 'b' or 'c'.
    const box = { x: 0, y: 0, width: 120, height: 60 };
    expect(CanvasEditController.marqueeHits(nodes, box, [])).toEqual(['a']);
    // A box covering the whole stage encloses every top-level node.
    const full = { x: -10, y: -10, width: 500, height: 500 };
    expect(CanvasEditController.marqueeHits(nodes, full, [])).toEqual(['a', 'b', 'c']);
  });

  it('ignores locked nodes even when enclosed', () => {
    const nodes = sample();
    const full = { x: -10, y: -10, width: 500, height: 500 };
    expect(CanvasEditController.marqueeHits(nodes, full, ['b'])).toEqual(['a', 'c']);
  });
});
