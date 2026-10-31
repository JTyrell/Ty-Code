/**
 * Process explorer service tests (Prompt 5b Step 5, group G3).
 *
 * Runs in pure Node — no Electron, no `app.getAppMetrics()`, no real process
 * table. Everything the service reads is injected, which is the point: these
 * tests can hand it a broken source, a malformed metric or a platform that
 * refuses to report memory, none of which can be arranged on demand in a live
 * app.
 *
 * The properties proved here, in the order the panel depends on them:
 *
 *  - **A partial reading is still a reading.** Each of the four sources throws
 *    independently and the snapshot survives with the rows that worked plus a
 *    sentence saying what is missing. A diagnostics panel that blanks out when
 *    one subsystem is broken is useless exactly when it is needed.
 *  - **One row per pid, named by whoever knows it best.** Terminals and the FCC
 *    sidecar are read before Electron's own table, so a child that appears in
 *    both is called "Terminal (bash)" rather than "Utility process" — and still
 *    keeps the memory Electron measured for it.
 *  - **An unmeasured process is still listed.** `memoryKb` is optional, so a
 *    shell whose resident set the platform would not report keeps its row.
 *    Dropping it would hide a process the user can see in their task manager.
 *  - **Malformed data costs one row, not the panel.** Rows are validated
 *    individually and the count that failed is reported.
 *  - **The notice always fits its schema budget.** If it did not, the parse on
 *    the way out would throw and a partial reading would arrive looking like a
 *    total failure.
 */

import { describe, expect, it } from 'vitest';
import type { IpcResponse } from '../../preload/types';
import type { ProcessExplorerSnapshot, ProcessRow } from '../../shared/types/process-explorer';
import {
  captureProcessSnapshot,
  type AppMetricLike,
  type ExplorerPtyLike,
  type ExplorerSidecarLike,
  type ExplorerWindowLike,
  type ProcessExplorerDeps
} from './process-explorer-service';

/** A fixed reading, or a function so a test can make the source throw. */
type Source<T> = T | (() => T);

/** The instant the injected clock reports, so `capturedAt` is assertable. */
const CAPTURED_AT = 1_700_000_000_000;

const MAIN_PID = 500;
const RENDERER_PID = 300;
const GPU_PID = 400;
const UTILITY_PID = 200;
const SIDECAR_PID = 9100;
const PTY_PID = 9001;
const SECOND_PTY_PID = 9002;

function readSource<T>(source: Source<T> | undefined, fallback: T): T {
  return typeof source === 'function' ? (source as () => T)() : source ?? fallback;
}

interface HarnessOverrides {
  appMetrics?: Source<AppMetricLike[]>;
  windows?: Source<ExplorerWindowLike[]>;
  ptyProcesses?: Source<ExplorerPtyLike[]>;
  sidecar?: Source<ExplorerSidecarLike | null>;
  externalMemoryKb?: (pids: number[]) => Promise<Record<number, number>>;
  now?: () => number;
}

/**
 * Build the injected dependency bundle.
 *
 * `memoryCalls` records every batch the service asked the platform for, in the
 * order asked. It is a plain array rather than a `vi.fn()` so the assertions read
 * as data ("one call, these pids") instead of as mock bookkeeping — and because
 * the thing worth proving is *how many times* the read happened, which a spy
 * makes you dig for.
 */
function harness(overrides: HarnessOverrides = {}): {
  deps: ProcessExplorerDeps;
  memoryCalls: number[][];
} {
  const memoryCalls: number[][] = [];
  const deps: ProcessExplorerDeps = {
    appMetrics: () => readSource(overrides.appMetrics, []),
    windows: () => readSource(overrides.windows, []),
    ptyProcesses: () => readSource(overrides.ptyProcesses, []),
    sidecar: () => readSource(overrides.sidecar, null),
    externalMemoryKb: async (pids) => {
      memoryCalls.push([...pids]);
      return overrides.externalMemoryKb ? overrides.externalMemoryKb(pids) : {};
    },
    now: overrides.now ?? (() => CAPTURED_AT)
  };
  return { deps, memoryCalls };
}

/** Unwrap the house envelope, failing the test with the refusal if there is one. */
function snapshotOf(response: IpcResponse<ProcessExplorerSnapshot>): ProcessExplorerSnapshot {
  if (!response.success || !response.data) {
    throw new Error(`Expected a snapshot, got a refusal: ${JSON.stringify(response)}`);
  }
  return response.data;
}

function rowFor(snapshot: ProcessExplorerSnapshot, pid: number): ProcessRow | undefined {
  return snapshot.rows.find((row) => row.pid === pid);
}

function pty(pid: number, shellId = 'bash', exited?: number): ExplorerPtyLike {
  return { ptyId: `pty-${pid}`, pid, shellId, shellPath: `/bin/${shellId}`, exited };
}

function metric(pid: number, type: string, memoryKb?: number, name?: string): AppMetricLike {
  return {
    pid,
    type,
    name,
    memory: memoryKb === undefined ? undefined : { workingSetSize: memoryKb },
    cpu: { percentCPUUsage: 1.5 }
  };
}

/** A minimal healthy app: main, one renderer, one GPU process. */
const HEALTHY_METRICS: AppMetricLike[] = [
  metric(MAIN_PID, 'Browser', 120_000),
  metric(RENDERER_PID, 'Tab', 90_000),
  metric(GPU_PID, 'GPU', 45_000)
];

describe('process explorer service (Prompt 5b Step 5 G3)', () => {
  describe('Electron process kinds', () => {
    it('maps each Electron metric type onto a panel kind and a name', async () => {
      const { deps } = harness({
        appMetrics: [
          metric(MAIN_PID, 'Browser', 1000),
          metric(RENDERER_PID, 'Tab', 2000),
          metric(301, 'Renderer', 2100),
          metric(GPU_PID, 'GPU', 3000),
          metric(UTILITY_PID, 'Utility', 4000, 'Network Service')
        ]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(rowFor(snapshot, MAIN_PID)).toMatchObject({ kind: 'main', name: 'Ty-Code (main)' });
      expect(rowFor(snapshot, RENDERER_PID)).toMatchObject({ kind: 'renderer', name: 'Renderer' });
      // `Renderer` is what older Electron builds report for the same thing.
      expect(rowFor(snapshot, 301)).toMatchObject({ kind: 'renderer', name: 'Renderer' });
      expect(rowFor(snapshot, GPU_PID)).toMatchObject({ kind: 'gpu', name: 'GPU' });
      expect(rowFor(snapshot, UTILITY_PID)).toMatchObject({
        kind: 'utility',
        name: 'Network Service'
      });
    });

    it('names an unlabelled utility process rather than showing a blank cell', async () => {
      const { deps } = harness({ appMetrics: [metric(UTILITY_PID, 'Utility', 4000)] });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(rowFor(snapshot, UTILITY_PID)).toMatchObject({
        kind: 'utility',
        name: 'Utility process'
      });
    });

    it('carries memory and cpu through when Electron reports them', async () => {
      const { deps } = harness({
        appMetrics: [{ pid: MAIN_PID, type: 'Browser', memory: { workingSetSize: 123_456 }, cpu: { percentCPUUsage: 12.5 } }]
      });

      const row = rowFor(snapshotOf(await captureProcessSnapshot(deps)), MAIN_PID);

      expect(row?.memoryKb).toBe(123_456);
      expect(row?.cpuPercent).toBe(12.5);
    });

    it('lists a process Electron reported no memory for instead of hiding it', async () => {
      const { deps } = harness({ appMetrics: [{ pid: MAIN_PID, type: 'Browser' }] });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));
      const row = rowFor(snapshot, MAIN_PID);

      expect(row).toBeDefined();
      expect(row?.memoryKb).toBeUndefined();
    });
  });

  describe('renderer rows are joined to their window', () => {
    it('names a renderer with the window id and title it belongs to', async () => {
      const { deps } = harness({
        appMetrics: [metric(RENDERER_PID, 'Tab', 90_000)],
        windows: [{ windowId: 7, title: 'Ty-Code — src/main/index.ts', pid: RENDERER_PID }]
      });

      const row = rowFor(snapshotOf(await captureProcessSnapshot(deps)), RENDERER_PID);

      // Without the title every renderer row reads "Renderer", and the panel
      // cannot be used to find which window is leaking.
      expect(row).toMatchObject({
        kind: 'renderer',
        windowId: 7,
        detail: 'Ty-Code — src/main/index.ts'
      });
    });

    it('still lists a renderer whose window has already closed', async () => {
      const { deps } = harness({ appMetrics: [metric(301, 'Tab', 90_000)], windows: [] });

      const row = rowFor(snapshotOf(await captureProcessSnapshot(deps)), 301);

      expect(row?.kind).toBe('renderer');
      expect(row?.windowId).toBeUndefined();
      expect(row?.detail).toBeUndefined();
    });

    it('never attaches a non-renderer row to a window that shares its pid', async () => {
      const { deps } = harness({
        appMetrics: [metric(MAIN_PID, 'Browser', 1000)],
        windows: [{ windowId: 1, title: 'Ty-Code', pid: MAIN_PID }]
      });

      const row = rowFor(snapshotOf(await captureProcessSnapshot(deps)), MAIN_PID);

      expect(row?.windowId).toBeUndefined();
      expect(row?.name).toBe('Ty-Code (main)');
    });
  });

  describe('one row per pid', () => {
    it('keeps the terminal name but takes the memory Electron measured', async () => {
      const { deps, memoryCalls } = harness({
        ptyProcesses: [pty(777, 'pwsh')],
        appMetrics: [metric(777, 'Utility', 8192, 'Child process')]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.filter((row) => row.pid === 777)).toHaveLength(1);
      // The specific source wins the name...
      expect(rowFor(snapshot, 777)).toMatchObject({ kind: 'pty', name: 'Terminal (pwsh)' });
      // ...and the general source still contributes the number it had, so no
      // platform read is spent recovering a value already in hand.
      expect(rowFor(snapshot, 777)?.memoryKb).toBe(8192);
      expect(memoryCalls).toEqual([]);
    });
  });

  describe('terminals and the FCC sidecar', () => {
    it('lists live terminals with their shell and path', async () => {
      const { deps } = harness({ ptyProcesses: [pty(PTY_PID, 'bash')] });

      const row = rowFor(snapshotOf(await captureProcessSnapshot(deps)), PTY_PID);

      expect(row).toMatchObject({
        kind: 'pty',
        name: 'Terminal (bash)',
        detail: `pty-${PTY_PID} — /bin/bash`
      });
    });

    it('omits a shell that has exited, including one that exited cleanly', async () => {
      const { deps } = harness({
        ptyProcesses: [pty(PTY_PID, 'bash'), pty(SECOND_PTY_PID, 'zsh', 0), pty(9003, 'fish', 1)]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      // `exited: 0` is still exited. A truthiness check would list it, putting a
      // dead pid in a panel whose whole purpose is showing what is alive.
      expect(snapshot.rows.map((row) => row.pid)).toEqual([PTY_PID]);
    });

    it('lists the FCC sidecar with the port it serves', async () => {
      const { deps } = harness({ sidecar: { running: true, pid: SIDECAR_PID, port: 8765 } });

      expect(rowFor(snapshotOf(await captureProcessSnapshot(deps)), SIDECAR_PID)).toMatchObject({
        kind: 'fcc-sidecar',
        name: 'FCC sidecar',
        detail: 'Free-model gateway on port 8765'
      });
    });

    it.each([
      { label: 'not running', sidecar: { running: false, pid: SIDECAR_PID, port: 8765 } },
      { label: 'running with no pid yet', sidecar: { running: true, port: 8765 } },
      { label: 'absent entirely', sidecar: null }
    ])('omits the sidecar when it is $label', async ({ sidecar }) => {
      const { deps } = harness({ sidecar, appMetrics: [metric(MAIN_PID, 'Browser', 1000)] });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.map((row) => row.pid)).toEqual([MAIN_PID]);
      expect(snapshot.notice).toBeUndefined();
    });
  });

  describe('pids that are not processes', () => {
    it('skips unusable pids quietly and does not count them as dropped', async () => {
      const { deps } = harness({
        appMetrics: [
          // Electron reports 0 for a process created but not started.
          { pid: 0, type: 'Utility', name: 'Not started' },
          // A fractional pid is a malformed reading, but still not worth a
          // notice: there is nothing the user could do about it.
          { pid: 12.5, type: 'Utility', name: 'Fractional' },
          metric(MAIN_PID, 'Browser', 1000)
        ],
        windows: [
          { windowId: 1, title: 'Booting', pid: 0 },
          { windowId: 2, title: 'Also booting' }
        ],
        ptyProcesses: [{ ptyId: 'pty-dead', pid: 0, shellId: 'bash', shellPath: '/bin/bash' }]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.map((row) => row.pid)).toEqual([MAIN_PID]);
      // A notice on every launch would be noise, and would train the user to
      // ignore the notice that does mean something.
      expect(snapshot.notice).toBeUndefined();
    });
  });

  describe('malformed rows', () => {
    it('drops one invalid row, keeps the rest, and says so in the singular', async () => {
      const { deps } = harness({
        appMetrics: [
          metric(RENDERER_PID, 'Tab', 1000),
          metric(301, 'Tab', 2000)
        ],
        windows: [
          // A fractional window id fails `z.number().int()`, so the row built
          // from it cannot be sent — but its sibling must survive.
          { windowId: 12.5, title: 'Broken window', pid: RENDERER_PID },
          { windowId: 2, title: 'Good window', pid: 301 }
        ]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.map((row) => row.pid)).toEqual([301]);
      expect(snapshot.notice).toBe('1 process row was dropped because it did not validate.');
    });

    it('pluralises the dropped-row notice', async () => {
      const { deps } = harness({
        // `Tab` rather than `Utility`: only a renderer row is joined to a
        // window, so only a renderer row can be invalidated by a bad window id.
        appMetrics: [metric(1, 'Tab', 10), metric(2, 'Tab', 20), metric(3, 'Tab', 30)],
        windows: [
          { windowId: 1.5, title: 'A', pid: 1 },
          { windowId: 2.5, title: 'B', pid: 2 },
          { windowId: 3.5, title: 'C', pid: 3 }
        ]
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows).toEqual([]);
      expect(snapshot.notice).toBe('3 process rows were dropped because they did not validate.');
    });
  });

  describe('a broken source never blanks the panel', () => {
    const HEALTHY = {
      appMetrics: HEALTHY_METRICS,
      windows: [{ windowId: 1, title: 'Ty-Code', pid: RENDERER_PID }],
      ptyProcesses: [pty(PTY_PID)],
      sidecar: { running: true, pid: SIDECAR_PID, port: 8765 }
    } satisfies HarnessOverrides;

    it.each([
      { source: 'ptyProcesses', notice: 'Could not read the terminal list', survivor: MAIN_PID, gone: PTY_PID },
      { source: 'sidecar', notice: 'Could not read the FCC sidecar state', survivor: MAIN_PID, gone: SIDECAR_PID },
      // Windows contribute no rows of their own, so nothing can go missing —
      // only the renderer's title and id are lost.
      { source: 'windows', notice: 'Could not read the window list', survivor: RENDERER_PID, gone: undefined },
      { source: 'appMetrics', notice: 'Could not read the Electron process table', survivor: PTY_PID, gone: MAIN_PID }
    ])('$source throwing loses only its own rows', async ({ source, notice, survivor, gone }) => {
      const overrides: HarnessOverrides = { ...HEALTHY };
      (overrides as Record<string, unknown>)[source] = () => {
        throw new Error(`${source} exploded`);
      };
      const { deps } = harness(overrides);

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      // Whatever the healthy sources knew is still on the panel.
      expect(rowFor(snapshot, survivor)).toBeDefined();
      if (gone !== undefined) expect(rowFor(snapshot, gone)).toBeUndefined();
      expect(snapshot.notice).toContain(notice);
      expect(snapshot.notice).toContain(`${source} exploded`);
    });

    it('returns an empty-but-valid snapshot when every source throws', async () => {
      const boom = () => {
        throw new Error('subsystem offline');
      };
      const { deps } = harness({
        appMetrics: boom,
        windows: boom,
        ptyProcesses: boom,
        sidecar: boom
      });

      const response = await captureProcessSnapshot(deps);

      // Not a refusal: the reading genuinely happened and genuinely found
      // nothing readable, which is different from being unable to answer.
      expect(response.success).toBe(true);
      const snapshot = snapshotOf(response);
      expect(snapshot.rows).toEqual([]);
      expect(snapshot.totalMemoryKb).toBe(0);
      expect(snapshot.notice).toContain('Could not read the terminal list');
      expect(snapshot.notice).toContain('Could not read the Electron process table');
    });
  });

  describe('memory for pids Electron does not own', () => {
    it('asks once, for exactly the pids that have no measurement yet', async () => {
      const { deps, memoryCalls } = harness({
        ptyProcesses: [pty(PTY_PID), pty(SECOND_PTY_PID, 'zsh')],
        sidecar: { running: true, pid: SIDECAR_PID, port: 8765 },
        appMetrics: [metric(MAIN_PID, 'Browser', 120_000)]
      });

      await captureProcessSnapshot(deps);

      // One batched call, not one per pid: on Windows and POSIX alike the read
      // is a helper process, and spawning one per terminal would cost more than
      // the thing it measures. Main already had a size, so it is not asked for.
      expect(memoryCalls).toEqual([[PTY_PID, SECOND_PTY_PID, SIDECAR_PID]]);
    });

    it('merges what the platform reported and counts what it did not', async () => {
      const { deps } = harness({
        ptyProcesses: [pty(PTY_PID), pty(SECOND_PTY_PID, 'zsh')],
        externalMemoryKb: async () => ({ [PTY_PID]: 4096 })
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(rowFor(snapshot, PTY_PID)?.memoryKb).toBe(4096);
      // The unmeasured shell keeps its row rather than disappearing.
      expect(rowFor(snapshot, SECOND_PTY_PID)?.memoryKb).toBeUndefined();
      expect(snapshot.notice).toBe('Memory could not be measured for 1 process.');
    });

    it('pluralises the unmeasured-process notice', async () => {
      const { deps } = harness({
        ptyProcesses: [pty(PTY_PID), pty(SECOND_PTY_PID, 'zsh')],
        externalMemoryKb: async () => ({})
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.notice).toBe('Memory could not be measured for 2 processes.');
    });

    it('still returns the tree when the platform read fails outright', async () => {
      const { deps } = harness({
        ptyProcesses: [pty(PTY_PID)],
        appMetrics: [metric(MAIN_PID, 'Browser', 1000)],
        externalMemoryKb: async () => {
          throw new Error('ps is not available on this host');
        }
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      // Which processes exist answers "why is my fan spinning" more often than
      // the exact byte count does, so the rows stay.
      const pids = snapshot.rows.map((row) => row.pid).sort((a, b) => a - b);
      expect(pids).toEqual([MAIN_PID, PTY_PID].sort((a, b) => a - b));
      expect(snapshot.notice).toContain('Memory for external processes is unavailable');
      expect(snapshot.notice).toContain('ps is not available on this host');
    });

    it('ignores a nonsense size from the platform read', async () => {
      const { deps } = harness({
        ptyProcesses: [pty(PTY_PID)],
        externalMemoryKb: async () => ({ [PTY_PID]: Number.NaN })
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(rowFor(snapshot, PTY_PID)?.memoryKb).toBeUndefined();
      expect(snapshot.notice).toBe('Memory could not be measured for 1 process.');
    });

    it('never calls the platform when the caller opted out of memory', async () => {
      const { deps, memoryCalls } = harness({ ptyProcesses: [pty(PTY_PID)] });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps, { includeMemory: false }));

      expect(memoryCalls).toEqual([]);
      expect(rowFor(snapshot, PTY_PID)).toBeDefined();
      // Opting out is a choice, not a failure, so it must not be reported as one.
      expect(snapshot.notice).toBeUndefined();
    });
  });

  describe('snapshot shape', () => {
    it('sums only the rows that reported a size', async () => {
      const { deps } = harness({
        appMetrics: [metric(MAIN_PID, 'Browser', 1000), metric(RENDERER_PID, 'Tab', 250)],
        ptyProcesses: [pty(PTY_PID), pty(SECOND_PTY_PID, 'zsh')],
        externalMemoryKb: async () => ({ [PTY_PID]: 4096 })
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.totalMemoryKb).toBe(1000 + 250 + 4096);
    });

    it('orders rows by kind then pid, never by memory', async () => {
      const { deps } = harness({
        appMetrics: [
          metric(UTILITY_PID, 'Utility', 10, 'Network Service'),
          metric(GPU_PID, 'GPU', 20),
          metric(RENDERER_PID, 'Tab', 30),
          metric(MAIN_PID, 'Browser', 40)
        ],
        sidecar: { running: true, pid: SIDECAR_PID, port: 8765 },
        // The largest process in the app, deliberately listed last.
        ptyProcesses: [pty(PTY_PID), pty(50, 'zsh')],
        externalMemoryKb: async () => ({ [PTY_PID]: 999_999, 50: 888_888 })
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.map((row) => row.kind)).toEqual([
        'main',
        'renderer',
        'gpu',
        'utility',
        'fcc-sidecar',
        'pty',
        'pty'
      ]);
      // Stable within a kind too: a table that re-sorts itself every refresh
      // cannot be read, because the row you were looking at moves.
      expect(snapshot.rows.map((row) => row.pid)).toEqual([
        MAIN_PID,
        RENDERER_PID,
        GPU_PID,
        UTILITY_PID,
        SIDECAR_PID,
        50,
        PTY_PID
      ]);
    });

    it('stamps the injected clock and declares a local scope', async () => {
      const { deps } = harness({ appMetrics: HEALTHY_METRICS, now: () => 42 });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.capturedAt).toBe(42);
      // Every pid here comes from this machine. A future remote adapter cannot
      // quietly report another host's processes under the same schema.
      expect(snapshot.scope).toBe('local');
    });

    it('omits the notice entirely when nothing went wrong', async () => {
      const { deps } = harness({ appMetrics: HEALTHY_METRICS });

      expect(snapshotOf(await captureProcessSnapshot(deps)).notice).toBeUndefined();
    });
  });

  describe('notice budget', () => {
    it('keeps whole sentences and counts the ones it had to leave out', async () => {
      const long = new Error(`boom ${'x'.repeat(300)}`);
      const boom = () => {
        throw long;
      };
      const { deps } = harness({
        appMetrics: boom,
        windows: boom,
        ptyProcesses: boom,
        sidecar: boom
      });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      // If the notice overran its 400-character schema bound, the parse on the
      // way out would throw and this partial reading would arrive as a refusal.
      expect(snapshot.notice!.length).toBeLessThanOrEqual(400);
      expect(snapshot.notice).toContain('Could not read the terminal list');
      expect(snapshot.notice).toContain('Could not read the FCC sidecar state');
      expect(snapshot.notice).toContain('(+2 more)');
      // Truncation happens between sentences, not inside one: a diagnosis cut
      // mid-word is worse than a shorter complete one.
      expect(snapshot.notice).not.toContain('Could not read the window list');
      expect(snapshot.notice).not.toContain('Could not read the Electron process table');
    });
  });

  describe('request validation', () => {
    it('refuses a malformed payload without touching any source', async () => {
      const { deps, memoryCalls } = harness({ appMetrics: HEALTHY_METRICS });

      const response = await captureProcessSnapshot(deps, { includeMemory: 'yes' });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Process list request failed validation:');
      expect(memoryCalls).toEqual([]);
    });

    it('treats a missing payload as a default request', async () => {
      const { deps, memoryCalls } = harness({ ptyProcesses: [pty(PTY_PID)] });

      const snapshot = snapshotOf(await captureProcessSnapshot(deps));

      expect(snapshot.rows.map((row) => row.pid)).toEqual([PTY_PID]);
      // Memory is on unless the caller says otherwise.
      expect(memoryCalls).toEqual([[PTY_PID]]);
    });

    it('strips unknown keys rather than rejecting the caller for sending them', async () => {
      const { deps } = harness({ appMetrics: HEALTHY_METRICS });

      const response = await captureProcessSnapshot(deps, {
        includeMemory: false,
        killEverything: true
      });

      // `z.object` drops what it does not declare, which is what stops a future
      // field from being invented by whoever writes the renderer.
      expect(response.success).toBe(true);
      expect(response.data?.rows.length).toBe(HEALTHY_METRICS.length);
    });
  });
});
