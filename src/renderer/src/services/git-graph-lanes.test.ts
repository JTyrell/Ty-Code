import { describe, expect, it } from 'vitest';
import { computeGraphRows, GRAPH_ROW_HEIGHT, GRAPH_LANE_WIDTH, type GraphLayout } from './git-graph-lanes';
import type { GitGraphCommit } from '../../../preload/types';

function commit(hash: string, parents: string[], refBranches: string[] = []): GitGraphCommit {
  return {
    hash,
    parents,
    message: `commit ${hash}`,
    authorName: 'Author',
    timestamp: 1_700_000_000,
    refs: { branches: refBranches, remoteBranches: [], tags: [], isHead: refBranches.length > 0 }
  };
}

describe('computeGraphRows', () => {
  it('renders a linear history on lane zero with a straight edge', () => {
    const layout: GraphLayout = computeGraphRows([commit('b', ['a']), commit('a', [])]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows[0]).toEqual({
      commit: expect.anything(),
      lane: 0,
      through: [],
      edges: [{ from: 0, to: 0 }]
    });
    expect(layout.rows[0].commit.hash).toBe('b');
    expect(layout.rows[1].lane).toBe(0);
    expect(layout.rows[1].edges).toEqual([]);
  });

  it('fans merge-commit parents into distinct lanes and re-binds them', () => {
    const layout = computeGraphRows([
      commit('merge', ['left', 'right'], ['main']),
      commit('left', ['root']),
      commit('right', ['root']),
      commit('root', [])
    ]);
    expect(layout.rows[0].lane).toBe(0);
    expect(layout.rows[0].edges).toEqual([
      { from: 0, to: 0 },
      { from: 0, to: 1 }
    ]);
    expect(layout.rows[0].commit.refs.isHead).toBe(true);
    expect(layout.rows[1].lane).toBe(0);
    expect(layout.rows[1].through).toEqual([1]);
    expect(layout.rows[1].edges).toEqual([{ from: 0, to: 0 }]);
    expect(layout.rows[2].lane).toBe(1);
    expect(layout.rows[2].through).toEqual([0]);
    expect(layout.rows[2].edges).toEqual([{ from: 1, to: 0 }]);
    expect(layout.rows[3].lane).toBe(0);
    expect(layout.rows[3].through).toEqual([]);
    expect(layout.laneCount).toBe(2);
  });

  it('tracks parallel branch lines with cross-lane edges', () => {
    const layout = computeGraphRows([
      commit('b2', ['base']),
      commit('b3', ['base'])
    ]);
    expect(layout.rows[0]).toEqual({
      commit: expect.anything(),
      lane: 0,
      through: [],
      edges: [{ from: 0, to: 0 }]
    });
    expect(layout.rows[1].lane).toBe(1);
    expect(layout.rows[1].through).toEqual([0]);
    expect(layout.rows[1].edges).toEqual([{ from: 1, to: 0 }]);
    expect(layout.laneCount).toBe(2);
  });

  it('rebinds a parent to the lane of an already-tracked branch tip', () => {
    const layout = computeGraphRows([commit('m', ['x', 'y']), commit('y', ['x'])]);
    expect(layout.rows[0].lane).toBe(0);
    expect(layout.rows[0].edges).toEqual([
      { from: 0, to: 0 },
      { from: 0, to: 1 }
    ]);
    expect(layout.rows[1].lane).toBe(1);
    expect(layout.rows[1].through).toEqual([0]);
    expect(layout.rows[1].edges).toEqual([{ from: 1, to: 0 }]);
    expect(layout.laneCount).toBe(2);
  });

  it('reuses the free slot of a finished branch line', () => {
    const layout = computeGraphRows([commit('tip', ['base']), commit('side', ['base', 'other']), commit('other', ['base'])]);
    expect(layout.rows[2]).toEqual({
      commit: expect.anything(),
      lane: 1,
      through: [0],
      edges: [{ from: 1, to: 0 }]
    });
    expect(layout.laneCount).toBe(2);
  });

  it('dedupes repeated hashes and caps row output at maxRows', () => {
    const twice = computeGraphRows([commit('c1', []), commit('c1', [])]);
    expect(twice.rows).toHaveLength(1);
    expect(twice.laneCount).toBe(1);

    const five = [commit('c5', ['c4']), commit('c4', ['c3']), commit('c3', ['c2']), commit('c2', ['c1']), commit('c1', [])];
    const capped = computeGraphRows(five, 2);
    expect(capped.rows).toHaveLength(2);
    expect(capped.rows.map((row) => row.commit.hash)).toEqual(['c5', 'c4']);
  });

  it('keeps laneCount at one for an empty commit list', () => {
    expect(computeGraphRows([])).toEqual({ rows: [], laneCount: 1 });
  });

  it('exposes stable layout rhythm constants', () => {
    expect(GRAPH_ROW_HEIGHT).toBe(26);
    expect(GRAPH_LANE_WIDTH).toBe(14);
  });
});
