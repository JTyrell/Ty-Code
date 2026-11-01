/**
 * Breakpoint store — the second Electron-free half of the Run menu's debug rows
 * (Prompt 5b Step 3).
 *
 * A breakpoint is a *user intention*, which is a different kind of fact from a
 * debug session and has a different lifetime: the program can exit, be restarted
 * under a new pid, or be started from the other window, and the dots in the
 * gutter must survive all three. `debug-session-service.ts` owns the protocol's
 * answer about a live process; this owns what the user asked for. Splitting them
 * is what lets a restart re-install the same set without the renderer remembering
 * it, and it is why the store has no notion of sockets.
 *
 * Four properties are load-bearing.
 *
 *  - **The id is derived, not random.** `filePath:lineNumber` after
 *    normalisation, so toggling the same line from two windows converges on one
 *    breakpoint. The runtime would accept two registrations on one line and
 *    report two hits for a single stop, which looks like a debugger that
 *    overshoots.
 *  - **`verified` is never set by a request.** Adding a breakpoint records it
 *    *unverified*, because nothing has confirmed it yet; only `verify()` — which
 *    the session calls after `setBreakpointByUrl` answered — may light one. A dot
 *    that is bright because we asked for it is the exact failure this feature was
 *    audited for, so there is no path from "the user clicked" to "verified".
 *  - **The key is normalised, the value is not.** Windows paths differ in case
 *    and separator for the same file, so an unnormalised key duplicates
 *    breakpoints; but a normalised *value* would be shown to the user as the file
 *    they asked about, and lowercase-forward-slash is not how their editor spells
 *    it. The stored path is what they typed, resolved to absolute.
 *  - **`hasBreakpoints` counts entries, not enabled ones.** Disable All
 *    Breakpoints and Remove All Breakpoints are both gated on it, and the second
 *    has to stay reachable when everything is disabled — otherwise the only way
 *    back would be to re-enable what the user just turned off.
 */

import path from 'path';
import type { IpcResponse } from '../../preload/types';
import {
  BreakpointIdRequestSchema,
  BreakpointSchema,
  BreakpointToggleRequestSchema,
  BreakpointsEnabledRequestSchema,
  MAX_TRACKED_BREAKPOINTS,
  NewBreakpointRequestSchema,
  type Breakpoint,
  type NewBreakpointRequest
} from '../../shared/types/debug-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

/** Keep a value inside a schema bound instead of letting `parse` reject the result. */
function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Absolute, separator-normalised, case-folded.
 *
 * Case folding is unconditional rather than gated on `process.platform`: a
 * breakpoint id that differs only by case is a duplicate the user cannot see or
 * remove, and one extra normalised key costs nothing on the platforms where paths
 * are case-sensitive anyway.
 */
function normalizePath(absolutePath: string): string {
  return path.resolve(absolutePath).replace(/\\/g, '/').toLowerCase();
}

/** Derived from the normalised path, so two spellings of one file give one id. */
function breakpointId(absolutePath: string, lineNumber: number): string {
  return clamp(`${normalizePath(absolutePath)}:${lineNumber}`, 130);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface BreakpointStore {
  /** Every breakpoint, in the order they were added. */
  list(): Breakpoint[];
  /** Add-or-remove on one line, which is what F9 and a gutter click mean. */
  toggle(payload: unknown): IpcResponse<Breakpoint[]>;
  /** Add with a kind: unconditional, conditional, or a logpoint. */
  add(payload: unknown): IpcResponse<Breakpoint[]>;
  remove(payload: unknown): IpcResponse<Breakpoint[]>;
  /** Enable or disable the whole set. Empty lists are an answer, not a failure. */
  setAllEnabled(payload: unknown): IpcResponse<Breakpoint[]>;
  removeAll(): IpcResponse<Breakpoint[]>;
  /** The session's report on one breakpoint. Unknown ids are ignored, not errors. */
  verify(id: string, verified: boolean, note?: string): void;
  /** Drop every verification — the next session has confirmed nothing. */
  clearVerifications(): void;
  hasBreakpoints(): boolean;
  /** Called when the folder changes, so a new workspace starts with its own dots. */
  clearWorkspace(workspacePath: string | null): void;
  subscribe(listener: (breakpoints: Breakpoint[]) => void): () => void;
  dispose(): void;
}

export function createBreakpointStore(): BreakpointStore {
  /** Keyed by derived id, insertion-ordered. */
  const breakpoints = new Map<string, Breakpoint>();
  const listeners = new Set<(breakpoints: Breakpoint[]) => void>();
  let disposed = false;

  function publish(): void {
    const snapshot = list();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* One bad observer must not stop the others seeing the edit. */
      }
    }
  }

  function list(): Breakpoint[] {
    // Re-parsing on the way out is what makes a later edit that stored a
    // 0-based line fail here rather than surface as a gutter dot one row off.
    return Array.from(breakpoints.values()).map((bp) => BreakpointSchema.parse(bp));
  }

  /**
   * Insert or refine a breakpoint.
   *
   * Re-adding the same line updates it instead of failing, because the two ways to
   * reach this are a gutter click on a line that already has a dot and a
   * conditional request for a line that has an unconditional one. Both mean "make
   * this line stop like *this*", and a refusal would read as a broken menu.
   */
  function upsert(request: NewBreakpointRequest): { ok: true; breakpoint: Breakpoint } | { ok: false; error: string } {
    const absolute = path.resolve(request.filePath);
    const id = breakpointId(absolute, request.lineNumber);

    if (!breakpoints.has(id) && breakpoints.size >= MAX_TRACKED_BREAKPOINTS) {
      return {
        ok: false,
        error: `${MAX_TRACKED_BREAKPOINTS} breakpoints are already set. Remove one before adding another.`
      };
    }

    // The kind is authoritative about which field the breakpoint carries, which is
    // why a contradictory request is refused rather than half-honoured: a logpoint
    // does not pause, so it cannot also be a break that sometimes pauses.
    const condition = request.kind === 'conditional' ? request.condition?.trim() : undefined;
    const logMessage = request.kind === 'logpoint' ? request.logMessage?.trim() : undefined;
    if (request.kind === 'conditional' && !condition) {
      return { ok: false, error: 'A conditional breakpoint needs a condition to evaluate.' };
    }
    if (request.kind === 'logpoint' && !logMessage) {
      return { ok: false, error: 'A logpoint needs a message to print.' };
    }

    const next: Breakpoint = {
      id,
      filePath: clamp(absolute, 4096),
      lineNumber: request.lineNumber,
      enabled: true,
      condition,
      logMessage,
      // Deliberately absent, on a re-add as much as a first add: this is a new
      // record, so whatever the runtime said about the one it replaced is not
      // evidence about it. Carrying an old `verified` across would light a dot for
      // a binding the runtime was never asked about — and the session re-applies
      // the set on every change, so the honest answer arrives within one round trip.
      verified: undefined
    };

    breakpoints.set(id, next);
    return { ok: true, breakpoint: next };
  }

  function toggle(payload: unknown): IpcResponse<Breakpoint[]> {
    if (disposed) return { success: false, error: 'The breakpoint store has been shut down.' };
    const parsed = BreakpointToggleRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Toggle-breakpoint request failed validation: ${describeIssues(parsed.error)}` };
    }
    const absolute = path.resolve(parsed.data.filePath);
    const id = breakpointId(absolute, parsed.data.lineNumber);

    if (breakpoints.delete(id)) {
      publish();
      return { success: true, data: list() };
    }

    const created = upsert({
      filePath: absolute,
      lineNumber: parsed.data.lineNumber,
      kind: 'unconditional'
    });
    if (!created.ok) return { success: false, error: created.error };
    publish();
    return { success: true, data: list() };
  }

  function add(payload: unknown): IpcResponse<Breakpoint[]> {
    if (disposed) return { success: false, error: 'The breakpoint store has been shut down.' };
    const parsed = NewBreakpointRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `New-breakpoint request failed validation: ${describeIssues(parsed.error)}` };
    }
    const created = upsert(parsed.data);
    if (!created.ok) return { success: false, error: created.error };
    publish();
    return { success: true, data: list() };
  }

  function remove(payload: unknown): IpcResponse<Breakpoint[]> {
    if (disposed) return { success: false, error: 'The breakpoint store has been shut down.' };
    const parsed = BreakpointIdRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Remove-breakpoint request failed validation: ${describeIssues(parsed.error)}` };
    }
    // Removing something already gone is a success with the current list: the
    // caller's goal — no dot on that line — is satisfied, and an error would
    // imply the opposite. It is also the common case when two windows both click
    // the same gutter dot.
    breakpoints.delete(parsed.data.id);
    publish();
    return { success: true, data: list() };
  }

  function setAllEnabled(payload: unknown): IpcResponse<Breakpoint[]> {
    if (disposed) return { success: false, error: 'The breakpoint store has been shut down.' };
    const parsed = BreakpointsEnabledRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Enable-breakpoints request failed validation: ${describeIssues(parsed.error)}` };
    }
    if (breakpoints.size === 0) {
      // A decline that is still an answer: the rows are gated on
      // `hasBreakpoints`, so reaching this at all means the menu and the store
      // disagree, and saying so is more useful than a silent no-op.
      return { success: true, data: [] };
    }
    for (const [id, bp] of breakpoints) {
      // Disabling keeps whatever verification the runtime gave: the binding still
      // exists, it is just not stopped on. Re-enabling cannot invent one.
      breakpoints.set(id, { ...bp, enabled: parsed.data.enabled });
    }
    publish();
    return { success: true, data: list() };
  }

  function removeAll(): IpcResponse<Breakpoint[]> {
    if (disposed) return { success: false, error: 'The breakpoint store has been shut down.' };
    breakpoints.clear();
    publish();
    return { success: true, data: [] };
  }

  function verify(id: string, verified: boolean, note?: string): void {
    if (disposed) return;
    const bp = breakpoints.get(id);
    if (!bp) return;
    // An unknown id is ignored rather than reported: the session may answer for a
    // breakpoint the user removed in the meantime, and failing a menu action over
    // that race would be worse than the race itself.
    const next: Breakpoint = {
      ...bp,
      verified,
      // The refusal travels with the record it refuses, so a panel can say *why*
      // a dot is dim without keeping a second map keyed by the same id.
      note: verified ? undefined : note ? clamp(note, 400) : undefined
    };
    if (bp.verified === next.verified && bp.note === next.note) return;
    breakpoints.set(id, next);
    publish();
  }

  function clearVerifications(): void {
    if (disposed) return;
    let changed = false;
    for (const [id, bp] of breakpoints) {
      if (bp.verified === undefined && !bp.note) continue;
      breakpoints.set(id, { ...bp, verified: undefined, note: undefined });
      changed = true;
    }
    if (changed) publish();
  }

  return {
    list,
    toggle,
    add,
    remove,
    setAllEnabled,
    removeAll,
    verify,
    clearVerifications,
    hasBreakpoints(): boolean {
      return breakpoints.size > 0;
    },
    clearWorkspace(workspacePath: string | null): void {
      if (disposed || !workspacePath) return;
      const root = normalizePath(workspacePath);
      let changed = false;
      for (const [id, bp] of breakpoints) {
        // Only entries that live under the loaded root are dropped. A file the
        // user opened from outside any workspace is not this workspace's to lose.
        if (normalizePath(bp.filePath).startsWith(`${root}/`)) {
          breakpoints.delete(id);
          changed = true;
        }
      }
      if (changed) publish();
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      // Idempotent, like the task runner's: a second shutdown must not publish an
      // empty list to observers that were already detached.
      if (disposed) return;
      disposed = true;
      breakpoints.clear();
      listeners.clear();
    }
  };
}
