/**
 * High-performance Myers' Diff Algorithm (Eugene W. Myers, 1986).
 * Computes shortest edit script (SES) with O(ND) time complexity and line-level diffing.
 */

export type DiffOperation = 'equal' | 'insert' | 'delete';

export interface DiffEdit {
  operation: DiffOperation;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: string[];
}

export interface MyersDiffResult {
  edits: DiffEdit[];
  unifiedDiff: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isIdentical: boolean;
}

export class MyersDiff {
  /**
   * Split string into lines while preserving empty trailing lines appropriately.
   */
  public static splitLines(text: string): string[] {
    if (text.length === 0) return [];
    return text.split(/\r?\n/);
  }

  /**
   * Compute the shortest edit script between textA and textB.
   */
  public static diff(textA: string, textB: string, contextLines = 3): MyersDiffResult {
    if (textA === textB) {
      const lines = this.splitLines(textA);
      return {
        edits: lines.map((text, idx) => ({ operation: 'equal', text, oldLineNumber: idx + 1, newLineNumber: idx + 1 })),
        unifiedDiff: '',
        hunks: [],
        additions: 0,
        deletions: 0,
        isIdentical: true
      };
    }

    const a = this.splitLines(textA);
    const b = this.splitLines(textB);
    const N = a.length;
    const M = b.length;
    const MAX = N + M;

    // Fast path: either sequence is empty
    if (N === 0) {
      const edits: DiffEdit[] = b.map((text, idx) => ({ operation: 'insert', text, newLineNumber: idx + 1 }));
      const hunk: DiffHunk = {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: M,
        header: `@@ -0,0 +1,${M} @@`,
        lines: b.map((line) => `+${line}`)
      };
      return {
        edits,
        unifiedDiff: `${hunk.header}\n${hunk.lines.join('\n')}`,
        hunks: [hunk],
        additions: M,
        deletions: 0,
        isIdentical: false
      };
    }

    if (M === 0) {
      const edits: DiffEdit[] = a.map((text, idx) => ({ operation: 'delete', text, oldLineNumber: idx + 1 }));
      const hunk: DiffHunk = {
        oldStart: 1,
        oldCount: N,
        newStart: 0,
        newCount: 0,
        header: `@@ -1,${N} +0,0 @@`,
        lines: a.map((line) => `-${line}`)
      };
      return {
        edits,
        unifiedDiff: `${hunk.header}\n${hunk.lines.join('\n')}`,
        hunks: [hunk],
        additions: 0,
        deletions: N,
        isIdentical: false
      };
    }

    // V array: index offset is MAX
    const offset = MAX;
    const vSize = 2 * MAX + 1;
    let v = new Int32Array(vSize);
    v.fill(-1);
    v[offset + 1] = 0;

    // History to trace back the edit script
    const trace: Int32Array[] = [];

    let reached = false;
    for (let d = 0; d <= MAX; d++) {
      const vCopy = new Int32Array(v);
      trace.push(vCopy);

      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1]; // Move down (insertion)
        } else {
          x = v[offset + k - 1] + 1; // Move right (deletion)
        }

        let y = x - k;

        // Diagonal snake: consume matching lines
        while (x < N && y < M && a[x] === b[y]) {
          x++;
          y++;
        }

        v[offset + k] = x;

        if (x >= N && y >= M) {
          reached = true;
          break;
        }
      }

      if (reached) break;
    }

    // Backtrack to build the edit script
    const edits: DiffEdit[] = [];
    let x = N;
    let y = M;

    for (let d = trace.length - 1; d >= 0; d--) {
      const currentV = trace[d];
      const k = x - y;

      let prevK: number;
      if (k === -d || (k !== d && currentV[offset + k - 1] < currentV[offset + k + 1])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = currentV[offset + prevK];
      const prevY = prevX - prevK;

      // Diagonal snake in reverse
      while (x > prevX && y > prevY && x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
        edits.push({ operation: 'equal', text: a[x - 1], oldLineNumber: x, newLineNumber: y });
        x--;
        y--;
      }

      if (d > 0) {
        if (x === prevX) {
          // Insertion from b
          edits.push({ operation: 'insert', text: b[y - 1], newLineNumber: y });
          y--;
        } else if (y === prevY) {
          // Deletion from a
          edits.push({ operation: 'delete', text: a[x - 1], oldLineNumber: x });
          x--;
        }
      }
    }

    // Remaining snake at start if any
    while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
      edits.push({ operation: 'equal', text: a[x - 1], oldLineNumber: x, newLineNumber: y });
      x--;
      y--;
    }

    edits.reverse();

    // Compute stats
    let additions = 0;
    let deletions = 0;
    for (const edit of edits) {
      if (edit.operation === 'insert') additions++;
      else if (edit.operation === 'delete') deletions++;
    }

    // Generate unified diff hunks with contextLines
    const hunks = this.buildHunks(edits, contextLines);
    const unifiedDiff = hunks.map((h) => `${h.header}\n${h.lines.join('\n')}`).join('\n');

    return {
      edits,
      unifiedDiff,
      hunks,
      additions,
      deletions,
      isIdentical: additions === 0 && deletions === 0
    };
  }

  private static buildHunks(edits: DiffEdit[], context: number): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const changeIndices: number[] = [];

    for (let i = 0; i < edits.length; i++) {
      if (edits[i].operation !== 'equal') {
        changeIndices.push(i);
      }
    }

    if (changeIndices.length === 0) return hunks;

    // Group nearby changes into hunks based on context lines
    const groups: Array<{ start: number; end: number }> = [];
    let currentGroup = {
      start: Math.max(0, changeIndices[0] - context),
      end: Math.min(edits.length - 1, changeIndices[0] + context)
    };

    for (let i = 1; i < changeIndices.length; i++) {
      const idx = changeIndices[i];
      const start = Math.max(0, idx - context);
      const end = Math.min(edits.length - 1, idx + context);

      if (start <= currentGroup.end + 1) {
        currentGroup.end = Math.max(currentGroup.end, end);
      } else {
        groups.push(currentGroup);
        currentGroup = { start, end };
      }
    }
    groups.push(currentGroup);

    // Format each group into a unified diff hunk
    for (const group of groups) {
      const slice = edits.slice(group.start, group.end + 1);
      const lines: string[] = [];
      let oldStart = 0;
      let oldCount = 0;
      let newStart = 0;
      let newCount = 0;

      for (const edit of slice) {
        if (edit.operation === 'equal') {
          if (oldStart === 0 && edit.oldLineNumber) oldStart = edit.oldLineNumber;
          if (newStart === 0 && edit.newLineNumber) newStart = edit.newLineNumber;
          oldCount++;
          newCount++;
          lines.push(` ${edit.text}`);
        } else if (edit.operation === 'delete') {
          if (oldStart === 0 && edit.oldLineNumber) oldStart = edit.oldLineNumber;
          oldCount++;
          lines.push(`-${edit.text}`);
        } else if (edit.operation === 'insert') {
          if (newStart === 0 && edit.newLineNumber) newStart = edit.newLineNumber;
          newCount++;
          lines.push(`+${edit.text}`);
        }
      }

      if (oldStart === 0) oldStart = 1;
      if (newStart === 0) newStart = 1;

      const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
      hunks.push({
        oldStart,
        oldCount,
        newStart,
        newCount,
        header,
        lines
      });
    }

    return hunks;
  }
}
