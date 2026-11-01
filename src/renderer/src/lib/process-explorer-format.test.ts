/**
 * Process Explorer formatting tests (Prompt 5b, Help group G3).
 *
 * These cover the claims the panel makes to a user who is trying to work out
 * what is eating their machine. The two that matter most are the ones a healthy
 * screenshot cannot reveal: an unmeasured process must never be reported as
 * using no memory, and the table must not re-order itself underneath somebody
 * who is reading it.
 *
 * Pure Node — no React, no jsdom, no Electron. The module under test imports
 * only types and one constant array.
 */

import { describe, expect, it } from 'vitest';
import type { ProcessExplorerSnapshot, ProcessRow } from '../../../preload/types';
import { PROCESS_KIND_ORDER } from '../../../shared/types/process-explorer';
import {
  MISSING_VALUE,
  formatAge,
  formatClock,
  formatCpuPercent,
  formatKibibytes,
  nextProcessSort,
  snapshotToTsv,
  sortProcessRows
} from './process-explorer-format';

function row(overrides: Partial<ProcessRow> = {}): ProcessRow {
  return {
    pid: 1000,
    kind: 'renderer',
    name: 'Renderer',
    ...overrides
  };
}

function snapshot(rows: ProcessRow[], overrides: Partial<ProcessExplorerSnapshot> = {}): ProcessExplorerSnapshot {
  return {
    capturedAt: 1_700_000_000_000,
    scope: 'local',
    rows,
    totalMemoryKb: rows.reduce((sum, r) => sum + (r.memoryKb ?? 0), 0),
    ...overrides
  };
}

describe('formatKibibytes', () => {
  it('reports an unmeasured value as a dash, never as zero', () => {
    // The whole point of the panel. `0 KB` claims a live process holds no
    // memory, which is impossible; a dash says Ty-Code could not read it, which
    // is what actually happened when a shell exits mid-measurement.
    expect(formatKibibytes(undefined)).toBe(MISSING_VALUE);
    expect(formatKibibytes(Number.NaN)).toBe(MISSING_VALUE);
    expect(formatKibibytes(Number.POSITIVE_INFINITY)).toBe(MISSING_VALUE);
    expect(formatKibibytes(-1)).toBe(MISSING_VALUE);
    // Zero IS a measurement the schema permits, so it must not become a dash.
    expect(formatKibibytes(0)).toBe('0 KB');
  });

  it('picks the largest unit that keeps two significant figures', () => {
    expect(formatKibibytes(512)).toBe('512 KB');
    expect(formatKibibytes(1023)).toBe('1023 KB');
    expect(formatKibibytes(1024)).toBe('1.0 MB');
    expect(formatKibibytes(1536)).toBe('1.5 MB');
    // Past 10 MB the decimal stops carrying information and only takes width.
    expect(formatKibibytes(15 * 1024)).toBe('15 MB');
    expect(formatKibibytes(1024 * 1024)).toBe('1.00 GB');
    expect(formatKibibytes(3.5 * 1024 * 1024)).toBe('3.50 GB');
  });
});

describe('formatCpuPercent', () => {
  it('dashes a platform that reports no percentage', () => {
    expect(formatCpuPercent(undefined)).toBe(MISSING_VALUE);
    expect(formatCpuPercent(-0.5)).toBe(MISSING_VALUE);
    expect(formatCpuPercent(0)).toBe('0.0%');
    expect(formatCpuPercent(12.34)).toBe('12.3%');
  });
});

describe('formatAge', () => {
  const now = 1_700_000_000_000;

  it('says how stale the reading is', () => {
    expect(formatAge(now, now)).toBe('just now');
    expect(formatAge(now - 4_000, now)).toBe('just now');
    expect(formatAge(now - 5_000, now)).toBe('5s ago');
    expect(formatAge(now - 59_000, now)).toBe('59s ago');
    expect(formatAge(now - 60_000, now)).toBe('1m ago');
    expect(formatAge(now - 3_600_000, now)).toBe('1h ago');
  });

  it('treats a clock skew that puts the capture in the future as fresh', () => {
    // A negative age would render as "-3s ago", which reads like a bug in the
    // panel rather than what it is: the two clocks disagreeing slightly.
    expect(formatAge(now + 30_000, now)).toBe('just now');
  });

  it('dashes a non-finite timestamp rather than printing Invalid Date', () => {
    expect(formatAge(Number.NaN, now)).toBe(MISSING_VALUE);
  });
});

describe('formatClock', () => {
  it('zero-pads to a stable HH:MM:SS shape', () => {
    // Deliberately not compared against a literal: the value is local time, so
    // the assertion has to hold in every timezone the suite might run in.
    expect(formatClock(1_700_000_000_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClock(Number.NaN)).toBe(MISSING_VALUE);
  });
});

describe('sortProcessRows', () => {
  it('preserves the service order when no column has been clicked', () => {
    const rows = [row({ pid: 3, kind: 'pty' }), row({ pid: 1, kind: 'main' })];
    const result = sortProcessRows(rows, null);
    expect(result.map((r) => r.pid)).toEqual([3, 1]);
    // A copy, not the input: the caller keeps the snapshot immutable, so a
    // later sort cannot be observed mutating data the panel already rendered.
    expect(result).not.toBe(rows);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [row({ pid: 3, memoryKb: 10 }), row({ pid: 1, memoryKb: 900 })];
    sortProcessRows(rows, { key: 'memory', descending: true });
    expect(rows.map((r) => r.pid)).toEqual([3, 1]);
  });

  it('sinks unmeasured rows to the bottom of a descending memory sort', () => {
    const rows = [
      row({ pid: 1, name: 'no reading', memoryKb: undefined }),
      row({ pid: 2, name: 'small', memoryKb: 100 }),
      row({ pid: 3, name: 'big', memoryKb: 900_000 })
    ];
    const sorted = sortProcessRows(rows, { key: 'memory', descending: true });
    // A leak hunt is exactly this view. Interleaving the blank row among the
    // consumers would make it look like a process using nothing.
    expect(sorted.map((r) => r.pid)).toEqual([3, 2, 1]);
  });

  it('breaks ties on pid so equal rows cannot swap between refreshes', () => {
    const rows = [
      row({ pid: 9, name: 'b', memoryKb: 500 }),
      row({ pid: 4, name: 'a', memoryKb: 500 }),
      row({ pid: 7, name: 'c', memoryKb: 500 })
    ];
    expect(sortProcessRows(rows, { key: 'memory', descending: false }).map((r) => r.pid)).toEqual([4, 7, 9]);
    expect(sortProcessRows(rows, { key: 'memory', descending: true }).map((r) => r.pid)).toEqual([9, 7, 4]);
    expect(sortProcessRows(rows, { key: 'name', descending: false }).map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('orders kinds by the contract order, not alphabetically', () => {
    const rows = PROCESS_KIND_ORDER.map((kind, index) => row({ kind, pid: 100 - index }));
    const shuffled = [rows[4], rows[0], rows[5], rows[1], rows[3], rows[2]];
    const sorted = sortProcessRows(shuffled, { key: 'kind', descending: false });
    expect(sorted.map((r) => r.kind)).toEqual([...PROCESS_KIND_ORDER]);
  });
});

describe('nextProcessSort', () => {
  it('starts each column in the direction that is useful for it', () => {
    expect(nextProcessSort(null, 'memory')).toEqual({ key: 'memory', descending: true });
    expect(nextProcessSort(null, 'pid')).toEqual({ key: 'pid', descending: true });
    expect(nextProcessSort(null, 'name')).toEqual({ key: 'name', descending: false });
    expect(nextProcessSort(null, 'kind')).toEqual({ key: 'kind', descending: false });
  });

  it('flips direction when the same header is clicked again', () => {
    expect(nextProcessSort({ key: 'memory', descending: true }, 'memory')).toEqual({
      key: 'memory',
      descending: false
    });
    // Switching column resets to that column's own default rather than
    // inheriting the direction of the one just left.
    expect(nextProcessSort({ key: 'memory', descending: false }, 'name')).toEqual({
      key: 'name',
      descending: false
    });
  });
});

describe('snapshotToTsv', () => {
  it('copies raw kibibytes, so the paste agrees with the measurement', () => {
    const tsv = snapshotToTsv(snapshot([row({ pid: 42, kind: 'main', name: 'Ty-Code (main)', memoryKb: 1536, cpuPercent: 2.5 })]));
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('PID\tKind\tName\tMemory (KB)\tCPU %\tDetail');
    // `1536`, not the `1.5 MB` the table shows: a rounded value in a bug report
    // cannot be compared against anything.
    expect(lines[1]).toBe('42\tMain\tTy-Code (main)\t1536\t2.5\t');
  });

  it('leaves unmeasured cells empty rather than pasting a dash into a numeric column', () => {
    const tsv = snapshotToTsv(snapshot([row({ pid: 7, kind: 'pty', name: 'Terminal (bash)', detail: '/bin/bash' })]));
    expect(tsv.split('\n')[1]).toBe('7\tTerminal\tTerminal (bash)\t\t\t/bin/bash');
  });

  it('flattens tabs and newlines that would shift every later column', () => {
    const tsv = snapshotToTsv(
      snapshot([row({ pid: 5, name: 'bad\tname', detail: 'line one\nline two\ttabbed' })])
    );
    const dataLine = tsv.split('\n')[1];
    // Header has 6 columns, so a sane row has exactly 5 separators.
    expect(dataLine.split('\t')).toHaveLength(6);
    expect(dataLine).toBe('5\tRenderer\tbad name\t\t\tline one line two tabbed');
  });

  it('carries the notice-bearing snapshot through unchanged', () => {
    const tsv = snapshotToTsv(snapshot([], { notice: 'Memory for 2 processes could not be read.' }));
    expect(tsv).toBe('PID\tKind\tName\tMemory (KB)\tCPU %\tDetail');
  });
});
