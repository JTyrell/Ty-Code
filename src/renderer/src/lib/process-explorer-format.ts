/**
 * Pure formatting and ordering for the Process Explorer panel.
 *
 * Prompt 5b, Help menu group G3. Split out of `ProcessExplorerWindow.tsx`
 * because these are the pieces with logic worth being wrong about on their own:
 * a kibibyte count printed as bytes, or a table that re-orders itself between
 * refreshes, are both invisible in a screenshot of a healthy machine and
 * glaring the moment somebody is hunting a leak. There is no React in here, so
 * the renderer suite can cover it under plain Node — the only environment that
 * suite has by default.
 */

import type { ProcessKind, ProcessRow } from '../../../preload/types';
import {
  PROCESS_KIND_ORDER,
  type ProcessExplorerSnapshot
} from '../../../shared/types/process-explorer';

/** Placeholder for a measurement this machine could not provide. */
export const MISSING_VALUE = '—';

export const PROCESS_KIND_LABELS: Readonly<Record<ProcessKind, string>> = {
  main: 'Main',
  renderer: 'Renderer',
  gpu: 'GPU',
  utility: 'Utility',
  'fcc-sidecar': 'FCC Sidecar',
  pty: 'Terminal'
};

/**
 * Resident set, in the largest unit that still keeps two significant figures.
 *
 * A missing or nonsensical value renders as an em dash and never as `0 KB`. The
 * two are not the same claim: `0 KB` asserts a live process is holding no
 * memory, which is impossible, while a dash says Ty-Code could not measure it —
 * true when a shell exited mid-read, when `ps` is absent, or when Electron
 * simply does not report that pid. Collapsing the second into the first is how a
 * diagnostics panel starts lying, and this one exists to be trusted.
 */
export function formatKibibytes(kb: number | undefined): string {
  if (typeof kb !== 'number' || !Number.isFinite(kb) || kb < 0) return MISSING_VALUE;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** CPU over the sampling window. Absent on platforms that report no percentage. */
export function formatCpuPercent(percent: number | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return MISSING_VALUE;
  return `${percent.toFixed(1)}%`;
}

/**
 * How stale a reading is.
 *
 * The panel polls on a chain, so what is on screen is always at least one
 * interval old, and considerably older when a platform memory read was slow.
 * Saying "12s ago" is what stops a user reading an already-exited process as a
 * live one — the single most misleading thing this panel could do.
 */
export function formatAge(capturedAt: number, now: number): string {
  if (!Number.isFinite(capturedAt) || !Number.isFinite(now)) return MISSING_VALUE;
  const seconds = Math.max(0, Math.round((now - capturedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Local wall clock for the header, zero-padded. */
export function formatClock(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return MISSING_VALUE;
  const at = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

export type ProcessSortKey = 'name' | 'kind' | 'pid' | 'memory';

export interface ProcessSort {
  key: ProcessSortKey;
  descending: boolean;
}

/**
 * Unmeasured rows sort as -1, so a descending sort — the first thing anyone
 * hunting a leak reaches for — sinks them to the bottom rather than
 * interleaving blanks among the biggest consumers.
 */
const MEMORY_SORT_SENTINEL = -1;

const KIND_RANK: ReadonlyMap<ProcessKind, number> = new Map(
  PROCESS_KIND_ORDER.map((kind, index) => [kind, index] as const)
);

function compareRows(a: ProcessRow, b: ProcessRow, key: ProcessSortKey): number {
  switch (key) {
    case 'pid':
      return a.pid - b.pid;
    case 'memory': {
      const byMemory =
        (a.memoryKb ?? MEMORY_SORT_SENTINEL) - (b.memoryKb ?? MEMORY_SORT_SENTINEL);
      // Falls through to pid like every other branch. Without it two rows with
      // equal RSS keep their *input* order, which is whatever order the service
      // happened to emit them in — so the ascending and descending views stop
      // being reverses of each other, and the tie order can move between
      // refreshes as processes exit and new ones take their pids.
      return byMemory !== 0 ? byMemory : a.pid - b.pid;
    }
    case 'kind': {
      const rank =
        (KIND_RANK.get(a.kind) ?? KIND_RANK.size) - (KIND_RANK.get(b.kind) ?? KIND_RANK.size);
      return rank !== 0 ? rank : a.pid - b.pid;
    }
    case 'name': {
      const byName = a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.pid - b.pid;
    }
  }
}

/**
 * Order the rows, or return them as the service sent them.
 *
 * `null` is the default and means "keep the contract's own order" — kind, then
 * pid. The shared schema documents that a table which re-sorts itself on every
 * refresh cannot be read, because the row you were looking at moves; sorting is
 * therefore opt-in through a header click, never a side effect of polling.
 *
 * Every comparison falls through to pid, which makes the order total. Stability
 * alone would not be enough: `Array.prototype.sort` preserves *input* order for
 * ties, and two rows with equal memory would still swap places as pids churn.
 */
export function sortProcessRows(
  rows: readonly ProcessRow[],
  sort: ProcessSort | null
): ProcessRow[] {
  const copy = rows.slice();
  if (!sort) return copy;
  const direction = sort.descending ? -1 : 1;
  copy.sort((a, b) => direction * compareRows(a, b, sort.key));
  return copy;
}

/**
 * Header-click cycling: the same column flips direction, a new column starts in
 * whichever direction is useful for it — biggest memory and highest pid first,
 * names and kinds forwards.
 */
export function nextProcessSort(current: ProcessSort | null, key: ProcessSortKey): ProcessSort {
  if (current && current.key === key) return { key, descending: !current.descending };
  return { key, descending: key === 'memory' || key === 'pid' };
}

/** Tabs and newlines inside a cell would shift every column after it. */
function cell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * The snapshot as tab-separated text, for the panel's Copy button.
 *
 * TSV rather than JSON because the destination is nearly always a bug report or
 * a spreadsheet, and a wall of braces is useless in both. Unmeasured cells copy
 * as empty rather than as an em dash: a dash pasted into a numeric column
 * corrupts it, and an empty cell says "unknown" without breaking the data.
 *
 * The header carries `(KB)` so the numbers stay raw. Rounding them for display
 * and then copying the rounded form would make the paste disagree with the
 * screen, and the person reading the bug report has no way to tell which is the
 * real measurement.
 */
export function snapshotToTsv(snapshot: ProcessExplorerSnapshot): string {
  const lines = ['PID\tKind\tName\tMemory (KB)\tCPU %\tDetail'];
  for (const row of snapshot.rows) {
    lines.push(
      [
        String(row.pid),
        PROCESS_KIND_LABELS[row.kind] ?? row.kind,
        cell(row.name),
        typeof row.memoryKb === 'number' ? String(Math.round(row.memoryKb)) : '',
        typeof row.cpuPercent === 'number' ? row.cpuPercent.toFixed(1) : '',
        cell(row.detail ?? '')
      ].join('\t')
    );
  }
  return lines.join('\n');
}
