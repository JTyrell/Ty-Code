import { z } from 'zod';

/**
 * Contract for Help > Open Process Explorer (Prompt 5b Step 5, group G3).
 *
 * The panel answers one question: *what is Ty-Code actually running right now,
 * and what does each piece cost?* So the row is a pid, a kind, a name and a
 * resident-set size — nothing else. Everything beyond that belongs in a
 * profiler, not in a menu item.
 *
 * Two properties are load-bearing and easy to lose in a later edit.
 *
 *  - **`scope` is a literal, not a string.** Every pid here comes from this
 *    machine: Electron's own metric table, the PTY registry this process
 *    spawned, and the FCC sidecar child it forked. There is no remote-session
 *    concept in the build, and declaring `z.literal('local')` means a future
 *    adapter cannot quietly start reporting another host's processes under the
 *    same schema — the parse would fail instead of the panel lying.
 *  - **`memoryKb` is optional and that is not a defect.** Electron reports
 *    memory for its own processes but says nothing about a PTY or the sidecar,
 *    so those need a platform-specific read that can fail (no `ps`, a restricted
 *    host, a process that exited mid-measurement). A row without a number
 *    renders as a dash; a row that vanished because measuring it threw would
 *    hide a process the user can see in their task manager.
 */

/**
 * IPC channel names.
 *
 * Declared here rather than in the main handler module for the same reason
 * `FILE_DIALOG_CHANNELS` lives in the shared contract: the preload bridge needs
 * the identical strings, and it must not import from `src/main` or it would pull
 * `ipcMain` into the sandboxed preload context.
 *
 * One channel, not two. There is deliberately no push channel: a main-side timer
 * keeps ticking after the window that asked for it is closed, which is a leak
 * with nothing to show for it. The panel polls instead, in a chain rather than on
 * an interval, so the window closing *is* the unsubscribe.
 */
export const PROCESS_EXPLORER_CHANNELS = {
  list: 'process-explorer:list'
} as const;

/**
 * What a row is.
 *
 * `utility` is the catch-all for Electron's own helper processes — network
 * service, audio service, crashpad — which is where its "workers" live. The
 * `worker_threads` used by the indexer, extension host and analysis engines are
 * *threads inside the main process*: they share its pid and its resident set, so
 * they are counted in the `main` row rather than listed as processes they are
 * not. Inventing a pid for a thread would be worse than omitting it.
 */
export const PROCESS_KINDS = ['main', 'renderer', 'gpu', 'utility', 'fcc-sidecar', 'pty'] as const;

export const ProcessKindSchema = z.enum(PROCESS_KINDS);

export type ProcessKind = z.infer<typeof ProcessKindSchema>;

/**
 * Stable display order.
 *
 * Rows are ordered by kind and then by pid rather than by memory, even though
 * memory is the column a user came for: a table that re-sorts itself every
 * refresh cannot be read, because the row you were looking at moves. Sorting is
 * a header-click concern, not a data concern.
 */
export const PROCESS_KIND_ORDER: readonly ProcessKind[] = PROCESS_KINDS;

export const ProcessRowSchema = z.object({
  pid: z.number().int().nonnegative(),
  kind: ProcessKindSchema,
  /** Short label, e.g. `Ty-Code (main)`, `Renderer`, `Terminal (bash)`. */
  name: z.string().min(1).max(160),
  /** Resident set in kibibytes. Absent when it could not be measured. */
  memoryKb: z.number().nonnegative().optional(),
  /** CPU percentage over the sampling window, where the platform reports one. */
  cpuPercent: z.number().nonnegative().optional(),
  /** One line of context: a window title, a shell path, a sidecar port. */
  detail: z.string().max(320).optional(),
  /** Set on renderer rows that belong to a window still open. */
  windowId: z.number().int().optional()
});

export type ProcessRow = z.infer<typeof ProcessRowSchema>;

export const ProcessExplorerSnapshotSchema = z.object({
  /** Epoch millis the reading was taken at, so the panel can say how stale it is. */
  capturedAt: z.number().int().nonnegative(),
  scope: z.literal('local'),
  rows: z.array(ProcessRowSchema).max(512),
  /** Sum of the rows that reported a size, so the header can show a total. */
  totalMemoryKb: z.number().nonnegative(),
  /**
   * Set when part of the reading is missing — a source threw, rows failed
   * validation, or the platform memory read came back empty. The panel shows it
   * verbatim, which is what keeps a partial reading honest instead of looking
   * like a complete one that happens to list fewer processes.
   */
  notice: z.string().max(400).optional()
});

export type ProcessExplorerSnapshot = z.infer<typeof ProcessExplorerSnapshotSchema>;

/**
 * A refresh request.
 *
 * Empty today, and validated anyway: the channel crosses a process boundary
 * from a sandboxed renderer, so a schema here is what stops a future field from
 * being added by whoever writes the renderer rather than by whoever owns the
 * data. `includeMemory` is the one knob that earns its place — the platform read
 * for external pids spawns a helper process, and a caller that only wants the
 * tree should not have to pay for it.
 */
export const ProcessExplorerRequestSchema = z.object({
  includeMemory: z.boolean().optional()
});

export type ProcessExplorerRequest = z.infer<typeof ProcessExplorerRequestSchema>;
