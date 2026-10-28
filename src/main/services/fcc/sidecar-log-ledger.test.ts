/**
 * Unit tests for the sidecar log ledger (Prompt: Stream Hygiene).
 *
 * The ledger is the ONLY destination for sidecar log lines, gated stream
 * content and gateway rerun decisions. Identical consecutive lines are
 * coalesced into one entry with an occurrence count.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { sidecarLogLedger, type SidecarLedgerSource } from './sidecar-log-ledger';

function recordAll(source: SidecarLedgerSource, lines: string[]): void {
  for (const line of lines) sidecarLogLedger.record(source, line);
}

describe('sidecarLogLedger coalescing', () => {
  beforeEach(() => sidecarLogLedger.clear());

  it('coalesces identical consecutive lines into a single entry with a count', () => {
    recordAll('sidecar-stdout', ['Processed request via FCC claude-code harness.', 'Processed request via FCC claude-code harness.', 'Processed request via FCC claude-code harness.']);
    const recent = sidecarLogLedger.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0].source).toBe('sidecar-stdout');
    expect(recent[0].text).toBe('Processed request via FCC claude-code harness.');
    expect(recent[0].count).toBe(3);
  });

  it('breaks the consecutive run when a different line interleaves', () => {
    recordAll('sidecar-stdout', ['A', 'A', 'B', 'A', 'A', 'A']);
    const recent = sidecarLogLedger.recent();
    expect(recent).toHaveLength(3);
    const aEntries = recent.filter((entry) => entry.text === 'A');
    expect(aEntries).toHaveLength(2);
    expect(aEntries[0].count).toBe(2);
    expect(aEntries[1].count).toBe(3);
  });

  it('does not coalesce across different sources', () => {
    recordAll('sidecar-stdout', ['same line']);
    recordAll('sidecar-stderr', ['same line']);
    expect(sidecarLogLedger.recent()).toHaveLength(2);
  });

  it('does not coalesce when only the source differs in kind (rerun vs gate)', () => {
    recordAll('rerun-decision', ['[OmniRoute] hop']);
    recordAll('stream-gate', ['[OmniRoute] hop']);
    expect(sidecarLogLedger.recent()).toHaveLength(2);
  });
});

describe('sidecarLogLedger retention + shape', () => {
  beforeEach(() => sidecarLogLedger.clear());

  it('respects the requested limit and returns the most recent entries in order', () => {
    recordAll('sidecar-stdout', ['l1', 'l2', 'l3', 'l4', 'l5']);
    const recent = sidecarLogLedger.recent(3);
    expect(recent.map((e) => e.text)).toEqual(['l3', 'l4', 'l5']);
  });

  it('caps very long lines to keep entries bounded', () => {
    sidecarLogLedger.record('sidecar-stdout', 'x'.repeat(1000));
    sidecarLogLedger.record('sidecar-stdout', 'after-long');
    const recent = sidecarLogLedger.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0].text.length).toBeLessThanOrEqual(400);
    expect(recent[1].text).toBe('after-long');
  });

  it('validates entries against the Zod schema', () => {
    recordAll('rerun-decision', ['decision-1']);
    const recent = sidecarLogLedger.recent();
    expect(recent[0]).toMatchObject({ source: 'rerun-decision', text: 'decision-1', count: 1 });
    expect(typeof recent[0].id).toBe('number');
    expect(typeof recent[0].firstTs).toBe('number');
    expect(typeof recent[0].lastTs).toBe('number');
  });

  it('ignores empty text and clear() empties the ring', () => {
    expect(sidecarLogLedger.record('sidecar-stdout', '   ')).toBeNull();
    recordAll('sidecar-stdout', ['keep-1']);
    sidecarLogLedger.clear();
    expect(sidecarLogLedger.recent()).toEqual([]);
  });
});
