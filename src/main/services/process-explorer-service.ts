/**
 * Process explorer service — the Electron-free half of Help > Open Process
 * Explorer (Prompt 5b Step 5, group G3).
 *
 * Same split as `file-dialog-service.ts` and `task-runner-service.ts`: all the
 * logic lives here with Electron injected as plain functions, so it runs under
 * plain Node in `vitest.main.config.ts`, and `ipc/process-explorer-handlers.ts`
 * is the thin wiring that hands it the real thing.
 *
 * **There is no state in this module.** No singleton, no timer, no listener set.
 * That is the design rather than an omission: the panel polls in a chain, so a
 * reading is only ever taken while a window is waiting for one, and closing the
 * window stops the work with nothing to unsubscribe. A main-side interval would
 * keep sampling the process table for an audience that left, and every such
 * timer is a leak that survives until the app quits.
 *
 * Three rules shape the code:
 *
 *  - **One source failing must not blank the panel.** Electron's metric table,
 *    the window list, the PTY registry and the sidecar are read independently,
 *    and each is wrapped: a throw contributes zero rows *and* a sentence in
 *    `notice`. A diagnostics panel that goes empty when one subsystem is broken
 *    is useless exactly when it is needed.
 *  - **An unmeasured process is still listed.** `memoryKb` is optional, so a PTY
 *    whose resident set the platform refused to report keeps its row. Dropping it
 *    would hide a process the user can see in their own task manager.
 *  - **One row per pid.** Sources are read most-specific first and later ones
 *    skip a pid already listed, so a child that ever appears in both Electron's
 *    table and the PTY registry is named as a terminal rather than as a generic
 *    utility process.
 */

import type { IpcResponse } from '../../preload/types';
import {
  PROCESS_KIND_ORDER,
  ProcessExplorerRequestSchema,
  ProcessExplorerSnapshotSchema,
  ProcessRowSchema,
  type ProcessExplorerSnapshot,
  type ProcessKind,
  type ProcessRow
} from '../../shared/types/process-explorer';

/**
 * Structural stand-in for Electron's `ProcessMetric`.
 *
 * Declared rather than imported so this module stays free of `electron`. Only the
 * fields the panel shows are declared; the rest of the real object is ignored.
 */
export interface AppMetricLike {
  pid: number;
  /** Electron reports `Browser`, `Tab`, `GPU` or `Utility`. */
  type: string;
  name?: string;
  memory?: { workingSetSize?: number };
  cpu?: { percentCPUUsage?: number };
}

/** A live window, joined to its renderer by `webContents.osProcessId`. */
export interface ExplorerWindowLike {
  windowId: number;
  title: string;
  /** Absent or zero before the window's renderer has started. */
  pid?: number;
}

/** A terminal this process spawned. */
export interface ExplorerPtyLike {
  ptyId: string;
  pid: number;
  shellId: string;
  shellPath: string;
  /** Exit code, once the shell is gone. */
  exited?: number;
}

/** The FCC sidecar child, when one is running. */
export interface ExplorerSidecarLike {
  running: boolean;
  pid?: number;
  port: number;
}

export interface ProcessExplorerDeps {
  /** `app.getAppMetrics()`. */
  appMetrics(): AppMetricLike[];
  /** Every live window, for naming renderer rows. */
  windows(): ExplorerWindowLike[];
  /** Every PTY in the registry, alive or not. */
  ptyProcesses(): ExplorerPtyLike[];
  /** FCC sidecar state, or null when the integration is absent. */
  sidecar(): ExplorerSidecarLike | null;
  /**
   * Resident set in kibibytes for pids Electron does not own.
   *
   * Called once per snapshot with the whole batch, never once per pid: on
   * Windows and POSIX alike the read is a helper process, and spawning one per
   * terminal would make a refresh cost more than the thing it measures. Must
   * resolve promptly and must not throw for a pid it cannot measure — omit the
   * key instead. A rejection is caught here and reported as a notice.
   */
  externalMemoryKb(pids: number[]): Promise<Record<number, number>>;
  /** Injectable clock, so `capturedAt` is assertable. */
  now(): number;
}

/** First Zod issue, so a validation failure reads as a diagnosis not a dump. */
function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bound a message taken from somewhere else.
 *
 * An error string from a platform helper can be arbitrarily long, and `notice`
 * has a hard maximum in the schema; truncating here keeps the parse on the way
 * out from throwing over a sentence that was only meant to explain something.
 */
function clip(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A pid worth listing.
 *
 * Electron reports `0` for a process that has been created but not started, and
 * `osProcessId` is `0` on a window whose renderer has not booted. Neither is a
 * malformed reading, so those rows are skipped quietly rather than counted as
 * dropped — a notice about them would be noise on every launch.
 */
function usablePid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

/** Only a finite, non-negative number is a measurement. */
function usableSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function kindForMetricType(type: string): ProcessKind {
  const normalised = String(type).toLowerCase();
  if (normalised === 'browser') return 'main';
  // `Tab` is what Electron calls a renderer; `Renderer` appears in older builds.
  if (normalised === 'tab' || normalised === 'renderer') return 'renderer';
  if (normalised === 'gpu') return 'gpu';
  return 'utility';
}

/**
 * Whole sentences only, within the schema's budget.
 *
 * Cutting the joined string at 400 characters would end mid-word, and a
 * truncated diagnosis is worse than a shorter complete one.
 */
function fitNotices(parts: string[]): string | undefined {
  const budget = 400;
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const cost = part.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) break;
    kept.push(part);
    used += cost;
  }
  if (kept.length === 0) return undefined;
  const omitted = parts.length - kept.length;
  if (omitted <= 0) return kept.join(' ');
  return clip(`${kept.join(' ')} (+${omitted} more)`, budget);
}

/** Raw rows before per-row validation. */
type RawRow = Omit<ProcessRow, 'kind'> & { kind: ProcessKind };

/**
 * Take one reading of everything Ty-Code is running.
 *
 * Returns the house envelope: a refusal is `success: false` with a sentence, and
 * a partial reading is `success: true` with the rows that worked plus a `notice`
 * explaining what is missing.
 */
export async function captureProcessSnapshot(
  deps: ProcessExplorerDeps,
  payload?: unknown
): Promise<IpcResponse<ProcessExplorerSnapshot>> {
  const parsed = ProcessExplorerRequestSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: `Process list request failed validation: ${describeIssues(parsed.error)}`
    };
  }
  const includeMemory = parsed.data.includeMemory !== false;
  const notices: string[] = [];

  /** pid → row, built most-specific first so a shared pid keeps its real name. */
  const rows = new Map<number, RawRow>();
  let dropped = 0;

  /**
   * Validate one row before it enters the table.
   *
   * Per row rather than the whole array at the end: `ProcessRowSchema.parse` on
   * the batch would let a single malformed metric throw away a reading that was
   * otherwise fine, and the panel would go blank because of one odd process.
   */
  function add(candidate: RawRow): void {
    const existing = rows.get(candidate.pid);
    if (existing) {
      // A pid two sources both claim keeps the first name — sources are read
      // most-specific first, so that is the one that says "Terminal (bash)"
      // rather than "Utility process". It still takes a measurement the earlier
      // source lacked, though: Electron knows the resident set of a child it
      // forked, and discarding that number would pay for a platform read to
      // recover something already in hand.
      if (!usableSize(existing.memoryKb) && usableSize(candidate.memoryKb)) {
        existing.memoryKb = candidate.memoryKb;
      }
      if (!usableSize(existing.cpuPercent) && usableSize(candidate.cpuPercent)) {
        existing.cpuPercent = candidate.cpuPercent;
      }
      return;
    }
    const checked = ProcessRowSchema.safeParse(candidate);
    if (checked.success) {
      rows.set(candidate.pid, candidate);
      return;
    }
    dropped += 1;
  }

  // --- Terminals, then the sidecar --------------------------------------
  // Read before Electron's own table so that if a shell ever does appear there
  // it is still named as the terminal the user opened.
  try {
    for (const terminal of deps.ptyProcesses()) {
      // An exited shell is not running: listing it would put a dead pid in a
      // panel whose whole purpose is showing what is alive.
      if (typeof terminal.exited === 'number') continue;
      if (!usablePid(terminal.pid)) continue;
      add({
        pid: terminal.pid,
        kind: 'pty',
        name: `Terminal (${clip(terminal.shellId || 'shell', 40)})`,
        detail: clip(`${terminal.ptyId} — ${terminal.shellPath}`, 320)
      });
    }
  } catch (err: unknown) {
    notices.push(`Could not read the terminal list: ${clip(describeError(err))}`);
  }

  try {
    const sidecar = deps.sidecar();
    if (sidecar?.running && usablePid(sidecar.pid)) {
      add({
        pid: sidecar.pid,
        kind: 'fcc-sidecar',
        name: 'FCC sidecar',
        detail: `Free-model gateway on port ${sidecar.port}`
      });
    }
  } catch (err: unknown) {
    notices.push(`Could not read the FCC sidecar state: ${clip(describeError(err))}`);
  }

  // --- Electron's own processes ------------------------------------------
  // `app.getAppMetrics()` covers main, every renderer, the GPU process and the
  // utility processes, and is the only source that already knows their memory.
  const windowsByPid = new Map<number, ExplorerWindowLike>();
  try {
    for (const win of deps.windows()) {
      // First window wins a shared pid, which cannot happen for two live
      // renderers but keeps the join deterministic if it ever does.
      if (usablePid(win.pid) && !windowsByPid.has(win.pid)) windowsByPid.set(win.pid, win);
    }
  } catch (err: unknown) {
    notices.push(`Could not read the window list: ${clip(describeError(err))}`);
  }

  try {
    for (const metric of deps.appMetrics()) {
      if (!usablePid(metric.pid)) continue;
      const kind = kindForMetricType(metric.type);
      const owner = kind === 'renderer' ? windowsByPid.get(metric.pid) : undefined;
      const base: RawRow = {
        pid: metric.pid,
        kind,
        name:
          kind === 'main'
            ? 'Ty-Code (main)'
            : kind === 'renderer'
              ? 'Renderer'
              : kind === 'gpu'
                ? 'GPU'
                : clip(metric.name || 'Utility process', 160),
        memoryKb: usableSize(metric.memory?.workingSetSize) ? metric.memory?.workingSetSize : undefined,
        cpuPercent: usableSize(metric.cpu?.percentCPUUsage) ? metric.cpu?.percentCPUUsage : undefined
      };
      if (owner) {
        base.windowId = owner.windowId;
        // The title is what tells two renderers apart; without it every window
        // row reads "Renderer" and the panel cannot be used to find a leak.
        base.detail = clip(owner.title, 320);
      }
      add(base);
    }
  } catch (err: unknown) {
    notices.push(`Could not read the Electron process table: ${clip(describeError(err))}`);
  }

  if (dropped > 0) {
    notices.push(
      `${dropped} process ${dropped === 1 ? 'row was' : 'rows were'} dropped because ${
        dropped === 1 ? 'it did' : 'they did'
      } not validate.`
    );
  }

  // --- Memory for pids Electron does not own ------------------------------
  const unmeasured = includeMemory
    ? [...rows.values()].filter((row) => !usableSize(row.memoryKb)).map((row) => row.pid)
    : [];
  if (unmeasured.length > 0) {
    try {
      const measured = await deps.externalMemoryKb(unmeasured);
      let missing = 0;
      for (const pid of unmeasured) {
        const size = measured?.[pid];
        if (usableSize(size)) {
          const row = rows.get(pid);
          if (row) row.memoryKb = size;
        } else {
          missing += 1;
        }
      }
      if (missing > 0) {
        notices.push(
          `Memory could not be measured for ${missing} ${
            missing === 1 ? 'process' : 'processes'
          }.`
        );
      }
    } catch (err: unknown) {
      // The tree is still worth showing: which processes exist is the answer to
      // "why is my fan spinning" more often than the exact byte count is.
      notices.push(`Memory for external processes is unavailable: ${clip(describeError(err))}`);
    }
  }

  const ordered = [...rows.values()].sort(
    (a, b) =>
      PROCESS_KIND_ORDER.indexOf(a.kind) - PROCESS_KIND_ORDER.indexOf(b.kind) || a.pid - b.pid
  );

  try {
    return {
      success: true,
      data: ProcessExplorerSnapshotSchema.parse({
        capturedAt: deps.now(),
        scope: 'local',
        rows: ordered,
        totalMemoryKb: ordered.reduce(
          (total, row) => total + (usableSize(row.memoryKb) ? row.memoryKb : 0),
          0
        ),
        notice: fitNotices(notices)
      })
    };
  } catch (err: unknown) {
    // Reached only if this module built something its own contract rejects —
    // which is a bug here, not a condition the caller can fix, so it is reported
    // as a failure rather than as a partial reading.
    return {
      success: false,
      error: `The process list could not be assembled: ${clip(describeError(err))}`
    };
  }
}
