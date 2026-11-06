/**
 * Reliability Ledger (Autonomous Free-Tier Reliability, Prompt 1).
 *
 * Bounded, LOCAL-ONLY JSONL audit trail for every silent remediation step,
 * sentinel probe, cooldown, chaos injection and advisor event. The file lives
 * under ~/.tycode/ and never leaves the machine (Zero-Telemetry). An
 * in-memory ring (200 records) backs the Diagnostics panel reads, so a
 * missing/corrupt file never breaks anything.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

export type ReliabilityLedgerKind =
  | 'probe'
  | 'ladder_step'
  | 'cooldown'
  | 'advisor'
  | 'recovered'
  | 'chaos'
  | 'degenerate'
  /** Silent rotation happened (model / key / provider) for a routable failure. */
  | 'rotation_trigger'
  /** A keyed route advanced to the next key in its pool (Step 2). */
  | 'key_rotation'
  /** The community key was re-bootstrap from the Cloudflare endpoint (Step 2.2). */
  | 'community_key_refresh';

export type ReliabilityLedgerOutcome = 'ok' | 'failed' | 'skipped' | 'started' | 'exhausted' | 'recovered';

export interface ReliabilityLedgerRecord {
  at: number;
  kind: ReliabilityLedgerKind;
  turnId?: string;
  /** Human-readable route key, e.g. `ty-code-free::google/gemma-4-31b-it:free`. */
  route?: string;
  step?: string;
  outcome?: ReliabilityLedgerOutcome;
  latencyMs?: number;
  detail?: string;
  /** degenerate_output payload: streamed content bytes (0 for a degenerate turn). */
  bytes?: number;
  /** degenerate_output payload: normalized provider finish_reason at stream end. */
  finishReason?: string;
  /** rotation_trigger / key_rotation: what we rotated away from and to. */
  from?: string;
  to?: string;
}

// STRICT RULE: Zod-validate every ledger payload before it is written. The
// record is best-effort and LOCAL-ONLY, so an invalid shape is dropped with a
// warning rather than crashing the turn — never silently coerced into a lie.
const LedgerOutcomeEnum = z.enum(['ok', 'failed', 'skipped', 'started', 'exhausted', 'recovered']);
const ReliabilityLedgerRecordSchema = z.object({
  at: z.number(),
  kind: z.enum(['probe', 'ladder_step', 'cooldown', 'advisor', 'recovered', 'chaos', 'degenerate', 'rotation_trigger', 'key_rotation', 'community_key_refresh']),
  turnId: z.string().optional(),
  route: z.string().optional(),
  step: z.string().optional(),
  outcome: LedgerOutcomeEnum.optional(),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
  bytes: z.number().optional(),
  finishReason: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

const MAX_RING = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

class ReliabilityLedger {
  private ring: ReliabilityLedgerRecord[] = [];
  private ledgerDir: string | null | undefined;

  /** Test hook: pin the directory and reset in-memory state. */
  __forTest(dir: string | null): void {
    this.ring = [];
    this.ledgerDir = dir;
  }

  private resolveDir(): string | null {
    if (this.ledgerDir !== undefined) return this.ledgerDir;
    try {
      this.ledgerDir = path.join(os.homedir(), '.tycode', 'reliability');
    } catch {
      this.ledgerDir = null;
    }
    return this.ledgerDir;
  }

  private resolveFile(): string | null {
    const dir = this.resolveDir();
    if (!dir) return null;
    return path.join(dir, 'reliability-ledger.jsonl');
  }

  record(rec: ReliabilityLedgerRecord): void {
    // STRICT RULE: reject a malformed payload rather than writing an unreliable
    // audit line. Never throw — the ledger must not break a turn.
    const parsed = ReliabilityLedgerRecordSchema.safeParse(rec);
    if (!parsed.success) {
      console.warn('[LEDGER] dropped invalid record:', parsed.error.issues[0]?.message ?? 'schema mismatch');
      return;
    }
    this.ring.push(rec);
    if (this.ring.length > MAX_RING) this.ring.splice(0, this.ring.length - MAX_RING);
    const file = this.resolveFile();
    if (!file) return;
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        // First write.
      }
      if (size > MAX_FILE_BYTES) fs.writeFileSync(file, '', 'utf-8');
      fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
    } catch {
      // The ledger is best-effort and local-only; never crash a turn for it.
    }
  }

  getRecent(limit = 50): ReliabilityLedgerRecord[] {
    return this.ring.slice(-limit);
  }

  /** Diagnostics aggregate over the ring window (session-scoped by design). */
  getStats(): {
    probeCount: number;
    probeFailures: number;
    ladderSteps: number;
    ladderSucceeded: number;
    cooldownCount: number;
    rotationCount: number;
    advisorCount: number;
    recoveredCount: number;
    degenerateCount: number;
  } {
    let probeCount = 0;
    let probeFailures = 0;
    let ladderSteps = 0;
    let ladderSucceeded = 0;
    let cooldownCount = 0;
    let rotationCount = 0;
    let advisorCount = 0;
    let recoveredCount = 0;
    let degenerateCount = 0;
    for (const rec of this.ring) {
      if (rec.kind === 'probe') {
        probeCount += 1;
        if (rec.outcome === 'failed') probeFailures += 1;
      } else if (rec.kind === 'ladder_step') {
        ladderSteps += 1;
        if (rec.outcome === 'ok') ladderSucceeded += 1;
        if (rec.step === 'provider_rotation') rotationCount += 1;
      } else if (rec.kind === 'cooldown') {
        cooldownCount += 1;
      } else if (rec.kind === 'advisor') {
        advisorCount += 1;
      } else if (rec.kind === 'recovered') {
        recoveredCount += 1;
      } else if (rec.kind === 'degenerate') {
        degenerateCount += 1;
      } else if (rec.kind === 'rotation_trigger' || rec.kind === 'key_rotation') {
        rotationCount += 1;
      }
    }
    return { probeCount, probeFailures, ladderSteps, ladderSucceeded, cooldownCount, rotationCount, advisorCount, recoveredCount, degenerateCount };
  }

  __resetForTest(): void {
    this.ring = [];
  }
}

export const reliabilityLedger = new ReliabilityLedger();
