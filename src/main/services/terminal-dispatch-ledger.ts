import { z } from 'zod';

/**
 * Terminal Dispatch ledger (Prompt: Terminal Command Dispatch Fix).
 *
 * Every `terminal:run-command` dispatch lands here — the receiving terminal,
 * the command, how long it waited for PTY readiness and the outcome. Local
 * diagnostics only: the ring buffer never leaves the main process except
 * through the `terminal-dispatch-ledger:get` IPC read channel, and identical
 * consecutive failures are coalesced so a broken dispatch loop cannot flood
 * the ring. Zero-Telemetry: nothing is uploaded anywhere.
 */

export const TerminalDispatchEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  terminalId: z.string(),
  cmd: z.string(),
  readyWaitMs: z.number().int().nonnegative(),
  outcome: z.enum(['executed', 'created', 'queued', 'timeout', 'failed']),
  detail: z.string().optional(),
  ts: z.number()
});

export type TerminalDispatchEntry = z.infer<typeof TerminalDispatchEntrySchema>;
export type TerminalDispatchOutcome = TerminalDispatchEntry['outcome'];

const MAX_RING_ENTRIES = 250;
const MAX_CMD_CHARS = 200;
const MAX_DETAIL_CHARS = 200;

class TerminalDispatchLedger {
  private ring: TerminalDispatchEntry[] = [];
  private seq = 0;
  private lastCoalesced: TerminalDispatchEntry | null = null;

  public record(entry: Omit<TerminalDispatchEntry, 'id' | 'ts'>): TerminalDispatchEntry | null {
    const normalized: TerminalDispatchEntry = {
      ...entry,
      cmd: entry.cmd.slice(0, MAX_CMD_CHARS),
      detail: entry.detail ? entry.detail.slice(0, MAX_DETAIL_CHARS) : undefined,
      id: this.seq + 1,
      ts: Date.now()
    };
    const last = this.lastCoalesced;
    if (last && last.outcome === normalized.outcome && last.terminalId === normalized.terminalId && last.cmd === normalized.cmd) {
      last.readyWaitMs = normalized.readyWaitMs;
      last.detail = normalized.detail;
      last.ts = normalized.ts;
      return last;
    }
    this.seq += 1;
    normalized.id = this.seq;
    this.ring.push(normalized);
    while (this.ring.length > MAX_RING_ENTRIES) this.ring.shift();
    this.lastCoalesced = normalized;
    return normalized;
  }

  public recent(limit = 80): TerminalDispatchEntry[] {
    const bounded = Math.max(1, Math.min(limit, this.ring.length || 1));
    return this.ring.slice(-bounded).map((entry) => TerminalDispatchEntrySchema.parse(entry));
  }

  public clear(): void {
    this.ring = [];
    this.lastCoalesced = null;
  }
}

export const terminalDispatchLedger = new TerminalDispatchLedger();
