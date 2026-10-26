import type { GitGraphCommit } from '../../../preload/types';

/**
 * Deterministic git-graph lane layout for the Source Control Graph view.
 *
 * Walks commits in display order and allocates lanes for each branch line:
 * a commit reuses the lane of its incoming edge, and every parent edge keeps
 * or allocates a lane. Pure from the parsed graph data — no git, no network.
 */

export const GRAPH_ROW_HEIGHT = 26;
export const GRAPH_LANE_WIDTH = 14;
export const GRAPH_ROWS_ABOVE = 240;

export interface GraphRowEdge {
  /** Lane index where the edge line starts at this row boundary. */
  from: number;
  /** Lane index where the edge continues below this row. */
  to: number;
}

export interface GraphRow {
  commit: GitGraphCommit;
  /** Lane index the commit dot is rendered in. */
  lane: number;
  /** Lane indices with continuing line segments at this row (excluding the dot lane). */
  through: number[];
  /** Parent edges that fan out below this row. */
  edges: GraphRowEdge[];
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
}

export function computeGraphRows(commits: GitGraphCommit[], maxRows = GRAPH_ROWS_ABOVE): GraphLayout {
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  const seen = new Set<string>();
  for (const commit of commits) {
    if (rows.length >= maxRows) break;
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);

    let lane = lanes.findIndex((head) => head === commit.hash);
    if (lane < 0) {
      lane = lanes.findIndex((head) => head === null);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(null);
      }
      lanes[lane] = commit.hash;
    }

    const through: number[] = [];
    for (let index = 0; index < lanes.length; index += 1) {
      if (index !== lane && lanes[index]) through.push(index);
    }

    lanes[lane] = null;
    const edges: GraphRowEdge[] = [];
    for (const parent of commit.parents) {
      if (!parent) continue;
      let target = lanes.findIndex((head) => head === parent);
      if (target < 0) {
        target = lanes.findIndex((head, index) => index >= lane && head === null);
        if (target < 0) {
          target = lanes.length;
          lanes.push(null);
        }
        lanes[target] = parent;
      }
      edges.push({ from: lane, to: target });
    }

    rows.push({ commit, lane, through, edges });
  }
  return { rows, laneCount: Math.max(1, lanes.length) };
}
