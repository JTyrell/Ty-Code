import { z } from 'zod';

/**
 * Stream Hygiene ledger (Prompt: Stream Hygiene, Task Idempotency & Sidecar Log
 * Classification).
 *
 * Every FCC sidecar stdout/stderr line, every gated stream-salvage line and
 * every gateway rerun-decision lands here instead of leaking into the agent
 * token stream. Identical consecutive lines are coalesced into a single entry
 * with a count so a chatty sidecar cannot flood the ring buffer.
 *
 * The ledger is exposed to the Diagnostics panel (`sidecar-ledger:get`) and is
 * the ONLY consumer destination for these lines. It never feeds onToken.
 */

export const SidecarLedgerEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  source: z.enum(['sidecar-stdout', 'sidecar-stderr', 'stream-gate', 'rerun-decision']),
  text: z.string(),
  count: z.number().int().positive(),
  firstTs: z.number(),
  lastTs: z.number()
});

export type SidecarLedgerEntry = z.infer<typeof SidecarLedgerEntrySchema>;
export type SidecarLedgerSource = SidecarLedgerEntry['source'];

const MAX_RING_ENTRIES = 250;
const MAX_TEXT_CHARS = 400;

class SidecarLogLedger {
  private ring: SidecarLedgerEntry[] = [];
  private seq = 0;
  // Tracks the most recently recorded entry; consecutive identical lines bump
  // its count instead of allocating a new entry. Any different line (any
  // source) breaks the consecutive run.
  private lastCoalesced: SidecarLedgerEntry | null = null;

  public record(source: SidecarLedgerSource, rawText: string): SidecarLedgerEntry | null {
    const text = String(rawText).slice(0, MAX_TEXT_CHARS);
    if (!text.trim()) return null;
    const now = Date.now();
    const last = this.lastCoalesced;
    if (last && last.source === source && last.text === text) {
      last.count += 1;
      last.lastTs = now;
      return last;
    }
    this.seq += 1;
    const entry: SidecarLedgerEntry = {
      id: this.seq,
      source,
      text,
      count: 1,
      firstTs: now,
      lastTs: now
    };
    this.ring.push(entry);
    while (this.ring.length > MAX_RING_ENTRIES) {
      this.ring.shift();
    }
    this.lastCoalesced = entry;
    return entry;
  }

  public recent(limit = 80): SidecarLedgerEntry[] {
    const bounded = Math.max(1, Math.min(limit, this.ring.length || 1));
    return this.ring.slice(-bounded).map((entry) => SidecarLedgerEntrySchema.parse(entry));
  }

  public clear(): void {
    this.ring = [];
    this.lastCoalesced = null;
  }
}

export const sidecarLogLedger = new SidecarLogLedger();
