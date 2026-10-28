import { describe, expect, it, beforeEach } from 'vitest';
import { terminalDispatchLedger } from './terminal-dispatch-ledger';

describe('terminalDispatchLedger', () => {
  beforeEach(() => terminalDispatchLedger.clear());

  it('records dispatch entries with monotonically increasing ids', () => {
    const first = terminalDispatchLedger.record({ terminalId: 'pty_1', cmd: 'npm run dev', readyWaitMs: 0, outcome: 'executed' });
    const second = terminalDispatchLedger.record({ terminalId: 'pty_2', cmd: 'npm test', readyWaitMs: 12, outcome: 'executed' });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).toBeGreaterThan(first!.id);
    expect(terminalDispatchLedger.recent().map((entry) => entry.cmd)).toEqual(['npm run dev', 'npm test']);
  });

  it('coalesces identical consecutive dispatches instead of flooding the ring', () => {
    terminalDispatchLedger.record({ terminalId: 'pty_1', cmd: 'npm run dev', readyWaitMs: 0, outcome: 'executed' });
    terminalDispatchLedger.record({ terminalId: 'pty_1', cmd: 'npm run dev', readyWaitMs: 5, outcome: 'executed' });
    const entries = terminalDispatchLedger.recent();
    expect(entries).toHaveLength(1);
    expect(entries[0].readyWaitMs).toBe(5);
  });

  it('keeps failure outcomes with their detail reason', () => {
    terminalDispatchLedger.record({ terminalId: '(none)', cmd: 'npm run build', readyWaitMs: 5, outcome: 'failed', detail: 'No active terminal to receive the command.' });
    const entries = terminalDispatchLedger.recent();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('failed');
    expect(entries[0].detail).toContain('No active terminal');
  });
});
