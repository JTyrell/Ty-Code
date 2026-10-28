/**
 * RouteEventPolicy: the single source of truth for what the Main Process may
 * tell the renderer about provider routing.
 *
 *  - SILENT            key missing on an api_key_optional provider during automatic
 *                      probing, or failover that lands on a working free tier. This is
 *                      the designed happy path: ledger and diagnostics only, never emitted.
 *  - LEDGER_PLUS_ONCE  first occurrence per session of "optional providers unlocked by
 *                      adding keys". One info event per session, maximum.
 *  - ACTIONABLE        the user explicitly selected a provider that needs a key they have
 *                      not saved. One warning (with the settings deep-link), once per
 *                      provider per session until a key is saved.
 *
 * Per user turn there is exactly ONE consolidated route event: the trail,
 * reusing the existing `status` AgentStreamChunk (no new chunk types), e.g.
 *   [ROUTE] openrouter(401) -> google(401) -> ty-code-free(ok)
 *
 * Local-only: the route ledger is a bounded JSONL file in userData and an
 * in-memory ring buffer for the Diagnostics panel. No network, no telemetry.
 */

import fs from 'fs';
import path from 'path';

export type RouteEventClass = 'SILENT' | 'LEDGER_PLUS_ONCE' | 'ACTIONABLE';
export type SelectionOrigin = 'explicit' | 'auto';

export interface KeyMissingContext {
  providerId: string;
  /** True for providers that work without a key (free tier, keyless pool). */
  apiKeyOptional: boolean;
  origin: SelectionOrigin;
  /** Failover or downgrade landed on a working free tier. */
  landedOnWorkingFree: boolean;
}

export interface RouteNotice {
  class: RouteEventClass;
  severity: 'info' | 'warning';
  title: string;
  message: string;
  /** Settings deep-link for ACTIONABLE notices. */
  actionUrl?: string;
}

interface Hop {
  providerId: string;
  outcome: string;
  attempts: number;
}

interface TurnTrail {
  hops: Hop[];
  skipped: string[];
  /** Latest handoff target: where the turn actually landed. */
  landing?: string;
  emitted: number;
  classes: { silent: number; once: number; actionable: number };
}

export interface RouteLedgerRecord {
  at: number;
  kind: 'key_missing' | 'hop' | 'skip' | 'turn';
  turnId?: string;
  providerId?: string;
  detail: string;
  class?: RouteEventClass;
}

const MAX_RING = 200;
const MAX_LEDGER_BYTES = 512 * 1024;
const SETTINGS_DEEP_LINK = 'ty-code://settings/api-keys';

class RouteEventPolicy {
  private onceUnlockEmitted = false;
  /** Turn that router/gateway layers attribute hops to when they have no explicit id. */
  private activeTurn: string | undefined;
  /** Flips true at the first real chat turn; boot-time syncs and probes never emit. */
  private armed = false;
  private actionableEmitted = new Set<string>();
  private turns = new Map<string, TurnTrail>();
  private ring: RouteLedgerRecord[] = [];
  private ledgerPath: string | null | undefined;

  // ---------- Classification ----------

  classifyKeyMissing(ctx: KeyMissingContext): RouteEventClass {
    if (ctx.origin === 'explicit') {
      // Explicitly choosing a provider that cannot run without a key.
      return ctx.apiKeyOptional ? 'SILENT' : 'ACTIONABLE';
    }
    if (!ctx.landedOnWorkingFree) return 'SILENT'; // the stream error path reports real failures
    return ctx.apiKeyOptional ? 'SILENT' : 'LEDGER_PLUS_ONCE';
  }

  /**
   * Applies the class to the session-level dedupe and returns the notice the
   * renderer may show, or null when nothing at all may be emitted. Always
   * writes to the ledger.
   */
  resolveKeyMissingNotice(ctx: KeyMissingContext, turnId?: string): RouteNotice | null {
    const klass = this.classifyKeyMissing(ctx);
    this.record({
      at: Date.now(),
      kind: 'key_missing',
      turnId,
      providerId: ctx.providerId,
      detail: `origin=${ctx.origin} optional=${ctx.apiKeyOptional} freeTier=${ctx.landedOnWorkingFree}`,
      class: klass
    });
    this.count(turnId, klass);

    if (klass === 'SILENT') return null;

    if (klass === 'LEDGER_PLUS_ONCE') {
      if (this.onceUnlockEmitted || !this.armed) return null;
      this.onceUnlockEmitted = true;
      this.bumpEmitted(turnId);
      return {
        class: klass,
        severity: 'info',
        title: 'More providers available',
        message: 'You are chatting on Ty-Code Free. Add optional API keys in Settings to unlock more providers.'
      };
    }

    const key = (ctx.providerId || '').toLowerCase();
    if (this.actionableEmitted.has(key)) return null;
    this.actionableEmitted.add(key);
    this.bumpEmitted(turnId);
    return {
      class: klass,
      severity: 'warning',
      title: 'Provider key missing',
      message: `${ctx.providerId} needs an API key. Chat continues on Ty-Code Free. Add your key in Settings, API Keys.`,
      actionUrl: SETTINGS_DEEP_LINK
    };
  }

  /** Re-arms the actionable warning once the user has saved a key. */
  onKeySaved(providerId: string): void {
    this.actionableEmitted.delete((providerId || '').toLowerCase());
  }

  // ---------- Per-turn consolidated trail ----------

  beginTurn(turnId: string): void {
    this.armed = true;
    this.activeTurn = turnId;
    this.turns.set(turnId, { hops: [], skipped: [], emitted: 0, classes: { silent: 0, once: 0, actionable: 0 } });
  }

  /** Resolves the turn: an exact known id wins, else the active turn, else the given id. */
  private resolveTurn(turnIdIn: string | undefined): string | undefined {
    if (turnIdIn && this.turns.has(turnIdIn)) return turnIdIn;
    return this.activeTurn ?? turnIdIn;
  }

  /** Records the provider a handoff moved to (the turn's current landing spot). */
  setLanding(turnIdIn: string | undefined, providerId: string): void {
    const turnId = this.resolveTurn(turnIdIn);
    if (!turnId) return;
    const trail = this.turns.get(turnId) ?? this.ensure(turnId);
    trail.landing = (providerId || '').toLowerCase();
  }

  /**
   * Records one routing outcome. Consecutive records for the SAME provider
   * (retry attempts) collapse into one hop with an attempt counter, so a
   * retry never produces a new trail entry.
   */
  recordHop(turnIdIn: string | undefined, providerId: string, outcome: string | number): void {
    const turnId = this.resolveTurn(turnIdIn);
    if (!turnId) return;
    const trail = this.turns.get(turnId) ?? this.ensure(turnId);
    const id = (providerId || 'unknown').toLowerCase();
    const last = trail.hops[trail.hops.length - 1];
    if (last && last.providerId === id) {
      last.attempts += 1;
      last.outcome = String(outcome);
      this.record({ at: Date.now(), kind: 'hop', turnId, providerId: id, detail: `retry attempt=${last.attempts} outcome=${outcome}` });
      return;
    }
    trail.hops.push({ providerId: id, outcome: String(outcome), attempts: 1 });
    this.count(turnId, 'SILENT');
    this.record({ at: Date.now(), kind: 'hop', turnId, providerId: id, detail: `outcome=${outcome}`, class: 'SILENT' });
  }

  /** A provider skipped up-front because sticky health says it is dead. */
  recordSkip(turnIdIn: string | undefined, providerId: string): void {
    const turnId = this.resolveTurn(turnIdIn);
    if (!turnId) return;
    const trail = this.turns.get(turnId) ?? this.ensure(turnId);
    const id = (providerId || '').toLowerCase();
    if (!trail.skipped.includes(id)) {
      trail.skipped.push(id);
      this.count(turnId, 'SILENT');
      this.record({ at: Date.now(), kind: 'skip', turnId, providerId: id, detail: 'sticky health: skipped without a request', class: 'SILENT' });
    }
  }

  /**
   * Called once at `done`. Returns the single consolidated status line when a
   * real failover happened (more than one hop), else null. A direct route is
   * only logged in main, never emitted.
   */
  finishTurn(turnId: string, finalProviderId: string): string | null {
    const trail = this.turns.get(turnId);
    if (!trail) return null;
    this.turns.delete(turnId);

    const finalId = (trail.landing || finalProviderId || '').toLowerCase();
    const hops = [...trail.hops];
    const lastHop = hops[hops.length - 1];
    if (finalId && (!lastHop || lastHop.providerId !== finalId)) {
      hops.push({ providerId: finalId, outcome: 'ok', attempts: 1 });
    } else if (lastHop && lastHop.outcome !== 'ok' && lastHop.providerId === finalId) {
      lastHop.outcome = 'ok';
    }

    const skipped = trail.skipped.map((s) => `${s}(skip)`);
    const line = `[ROUTE] ${[...skipped, ...hops.map((h) => `${h.providerId}(${h.outcome}${h.attempts > 1 ? `x${h.attempts}` : ''})`)].join(' -> ')}`;
    const failedHops = hops.filter((h) => h.outcome !== 'ok').length;
    const emitLine = failedHops > 0;
    if (emitLine) trail.emitted += 1;
    console.log(line);
    console.log(
      `[ROUTE-EVENTS] turn=${turnId} emitted=${trail.emitted} classes={silent:${trail.classes.silent}, once:${trail.classes.once}, actionable:${trail.classes.actionable}}`
    );
    this.record({ at: Date.now(), kind: 'turn', turnId, detail: line });
    return emitLine ? line : null;
  }

  // ---------- Diagnostics reads (Diagnostics panel never triggers toasts) ----------

  getRecentRouteRecords(limit = 50): RouteLedgerRecord[] {
    return this.ring.slice(-limit);
  }

  /** Test-only: reset all session state so tests start from a clean slate. */
  __resetForTest(): void {
    this.onceUnlockEmitted = false;
    this.armed = false;
    this.activeTurn = undefined;
    this.actionableEmitted.clear();
    this.turns.clear();
    this.ring = [];
  }

  // ---------- Internals ----------

  private ensure(turnId: string): TurnTrail {
    const t: TurnTrail = { hops: [], skipped: [], emitted: 0, classes: { silent: 0, once: 0, actionable: 0 } };
    this.turns.set(turnId, t);
    return t;
  }

  private count(turnId: string | undefined, klass: RouteEventClass): void {
    if (!turnId) return;
    const t = this.turns.get(turnId);
    if (!t) return;
    if (klass === 'SILENT') t.classes.silent += 1;
    else if (klass === 'LEDGER_PLUS_ONCE') t.classes.once += 1;
    else t.classes.actionable += 1;
  }

  private bumpEmitted(turnId: string | undefined): void {
    if (!turnId) return;
    const t = this.turns.get(turnId);
    if (t) t.emitted += 1;
  }

  private resolveLedger(): string | null {
    if (this.ledgerPath !== undefined) return this.ledgerPath;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron');
      this.ledgerPath = path.join(app.getPath('userData'), 'route-events.jsonl');
    } catch {
      this.ledgerPath = null;
    }
    return this.ledgerPath;
  }

  private record(rec: RouteLedgerRecord): void {
    this.ring.push(rec);
    if (this.ring.length > MAX_RING) this.ring.splice(0, this.ring.length - MAX_RING);
    const file = this.resolveLedger();
    if (!file) return;
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* first write */ }
      if (size > MAX_LEDGER_BYTES) fs.writeFileSync(file, '', 'utf-8');
      fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
    } catch {
      // Ledger is best-effort and local-only.
    }
  }
}

export const routeEventPolicy = new RouteEventPolicy();
