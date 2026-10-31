/**
 * Ty-Code main-process command backends.
 *
 * The registry declares *what* a menu row does; this module is *how* the
 * main-target rows do it. Everything Electron-specific arrives through
 * `MainCommandAdapters`, so the module runs under plain Node in
 * `vitest.main.config.ts` — the same reason the executor and the registry are
 * adapter-driven rather than importing `electron` at module scope.
 *
 * Two rules shape the code:
 *
 *  - **Hidden > dead.** A key listed in `MAIN_DEFERRED_COMMANDS` is not
 *    registered, so `missingHandlers()` reports it and the renderer hides the
 *    row instead of painting a click that ends in `no_handler`. A menu item
 *    that opens nothing is worse than no menu item.
 *  - **Every result is a sentence plus data.** The `summary` field exists so a
 *    toast can show what happened without interpreting the payload — a boolean
 *    is not a visible result. Results are parsed through their own schema on
 *    the way out because the IPC envelope only checks that `data` exists, not
 *    what it contains, and these values cross a process boundary.
 */

import { z } from 'zod';
import type { CommandContextSnapshot } from '../../shared/types/command-registry';
import type { CommandHandler } from './command-executor';
// Type-only: erased at compile time, so this module never pulls `electron` in.
import type { EditorWindowReveal } from '../windows/editor-window';

/**
 * Context keys main owns.
 *
 * Deliberately a `z.object` rather than the registry's `partialRecord`:
 * unknown keys are **stripped** on parse. This snapshot is merged *over* the
 * calling window's own report, so an adapter that started returning
 * `editorOpen` would overwrite what the renderer can actually see and grey out
 * the whole Go menu. Stripping makes that impossible instead of merely
 * unlikely.
 */
export const MainOwnedContextSchema = z.object({
  /** Packaged builds cannot open devtools; see `help.toggle-dev-tools`. */
  devToolsAllowed: z.boolean(),
  /** An updater is wired up and reachable in this build. */
  updatersAvailable: z.boolean(),
  /** A workspace folder is loaded. */
  workspaceOpen: z.boolean(),
  /** A launch configuration exists for the open workspace. */
  configurationsExist: z.boolean()
});
export type MainOwnedContext = z.infer<typeof MainOwnedContextSchema>;

/**
 * What main can see, re-read on every request so a menu never paints from
 * state that went stale between two clicks.
 */
export interface MainOwnedContextSources {
  devToolsAllowed: () => boolean;
  updatersAvailable: () => boolean;
  workspaceOpen: () => boolean;
  configurationsExist: () => boolean;
}

/** Mirrors `UpdateCheckResult` in `services/update-manager.ts`. */
export const UpdateCheckInputSchema = z.object({
  updateAvailable: z.boolean(),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  releaseNotes: z.string().optional(),
  releaseDate: z.string().optional(),
  error: z.string().optional(),
  /**
   * Set by the adapter, which is the only layer that legitimately knows whether
   * the app is packaged. In development the update manager short-circuits and
   * reports no update without ever reaching the network, so a summary reading
   * "up to date" there would claim a check that never happened.
   */
  devMode: z.boolean().optional()
});
export type UpdateCheckInput = z.infer<typeof UpdateCheckInputSchema>;

/** The shape the UI receives, so `app.checkForUpdates` has a visible result. */
export const UpdateCheckCommandResultSchema = UpdateCheckInputSchema.extend({
  summary: z.string().min(1)
});
export type UpdateCheckCommandResult = z.infer<typeof UpdateCheckCommandResultSchema>;

/** Mirrors the fields this command reports from `FCCServerStatus`. */
export const FccSidecarStatusInputSchema = z.object({
  running: z.boolean(),
  port: z.number().int(),
  pid: z.number().int().optional(),
  health: z.enum(['healthy', 'degraded', 'stopped']),
  version: z.string(),
  mode: z.enum(['native-sidecar', 'external-process']),
  providersCount: z.number().int(),
  restartCount: z.number().int(),
  uptimeSeconds: z.number(),
  freeTokensAllocated: z.number(),
  freeTokensUsed: z.number()
});
export type FccSidecarStatusInput = z.infer<typeof FccSidecarStatusInputSchema>;

export const FccSidecarStatusResultSchema = FccSidecarStatusInputSchema.extend({
  summary: z.string().min(1)
});
export type FccSidecarStatusResult = z.infer<typeof FccSidecarStatusResultSchema>;

/**
 * The Electron-facing surface these handlers need.
 *
 * Passed in rather than imported so the same code path runs in a unit test with
 * fakes and in the packaged app with the real window manager, updater and FCC
 * sidecar.
 */
export interface MainCommandAdapters {
  /** Open a new workbench window, optionally revealing a surface inside it. */
  openWindow: (reveal?: EditorWindowReveal) => void;
  /**
   * Close a window by id, or the caller's own window when no id is known.
   * Returns `false` when there was nothing to close, so a failed close is
   * reported rather than silently succeeding.
   */
  closeWindow: (windowId?: number) => boolean;
  /** Quit the application. */
  quit: () => void;
  /**
   * Toggle devtools on a window. Returns `false` when the window is gone or
   * devtools are refused; the `when: devToolsAllowed` gate normally stops the
   * command before it gets here, so a `false` means the window disappeared
   * between the menu opening and the click landing.
   */
  toggleDevTools: (windowId?: number) => boolean;
  /** electron-updater check. Rejections surface as `handler_threw`. */
  checkForUpdates: () => Promise<UpdateCheckInput>;
  /** FCC sidecar state. */
  fccStatus: () => FccSidecarStatusInput;
  contexts: MainOwnedContextSources;
}

/**
 * Main-target handler keys backed by this module.
 *
 * Keyed by the registry's `command` field, never by an entry id: both
 * `help.check-for-updates` and `tycode.check-for-updates` run through the single
 * `app.checkForUpdates` handler, which is what keeps the table declarative.
 */
export const MAIN_BACKED_COMMANDS = [
  'window.newWindow',
  'window.close',
  'app.quit',
  'terminal.newWindow',
  'window.toggleDevTools',
  'app.checkForUpdates',
  'fcc.sidecarStatus'
] as const;

/**
 * Main-target handler keys intentionally **not** registered yet, with the
 * backend each one is waiting on.
 *
 * Listing them here rather than leaving them implicit is what makes "hidden >
 * dead" auditable: a test walks `listRequiredHandlers().main` and fails if a key
 * is neither backed nor accounted for below, so a row can never quietly become a
 * dead click as the registry grows.
 */
export const MAIN_DEFERRED_COMMANDS: Readonly<Record<string, string>> = {
  'window.openProcessExplorer': 'Needs a process-explorer window and service (Help menu task).'
};

/** Sentence the UI shows for an update check, whatever the outcome. */
function describeUpdateCheck(result: UpdateCheckInput): string {
  if (result.error) return `Update check could not complete: ${result.error}`;
  if (result.devMode) {
    return `Update checking needs a packaged build (running ${result.currentVersion}).`;
  }
  if (result.updateAvailable) {
    return result.latestVersion
      ? `Ty-Code ${result.latestVersion} is available (you are on ${result.currentVersion}).`
      : `An update is available (you are on ${result.currentVersion}).`;
  }
  return `Ty-Code is up to date (${result.currentVersion}).`;
}

/** Sentence the UI shows for the FCC sidecar. */
function describeFccStatus(status: FccSidecarStatusInput): string {
  if (!status.running) return 'FCC sidecar is not running.';
  const providers = status.providersCount === 1 ? '1 provider' : `${status.providersCount} providers`;
  if (status.health === 'healthy') {
    return `FCC sidecar is healthy on port ${status.port} (v${status.version}, ${providers}).`;
  }
  if (status.health === 'degraded') {
    return `FCC sidecar is degraded on port ${status.port} (v${status.version}, ${providers}).`;
  }
  // `running` with health `stopped` is a contradictory reading of a sidecar that
  // is mid-restart; report what was observed instead of guessing.
  return `FCC sidecar reports '${status.health}' on port ${status.port} (v${status.version}).`;
}

/**
 * Build the main-target handler map.
 *
 * The returned record is handed to `registerCommandHandlers`, which registers
 * every key on the main executor and returns one disposable for all of them.
 */
export function createMainCommandHandlers(
  adapters: MainCommandAdapters
): Record<string, CommandHandler> {
  return {
    'window.newWindow': () => {
      adapters.openWindow();
      return { opened: true };
    },

    'terminal.newWindow': () => {
      // The reveal travels in the window's load hash rather than an event: a
      // hash survives the renderer's boot ordering, whereas an event sent
      // before the renderer subscribes is simply lost.
      adapters.openWindow('terminal');
      return { opened: true, reveal: 'terminal' };
    },

    'window.close': (_args, context) => ({ closed: adapters.closeWindow(context.windowId) }),

    'app.quit': () => {
      adapters.quit();
      return { quitting: true };
    },

    'window.toggleDevTools': (_args, context) => ({
      toggled: adapters.toggleDevTools(context.windowId)
    }),

    'app.checkForUpdates': async () => {
      const result = UpdateCheckInputSchema.parse(await adapters.checkForUpdates());
      return UpdateCheckCommandResultSchema.parse({
        ...result,
        summary: describeUpdateCheck(result)
      });
    },

    'fcc.sidecarStatus': () => {
      const status = FccSidecarStatusInputSchema.parse(adapters.fccStatus());
      return FccSidecarStatusResultSchema.parse({
        ...status,
        summary: describeFccStatus(status)
      });
    }
  };
}

/**
 * Main's half of the context snapshot.
 *
 * The return type is spelled out rather than importing `MainContextProvider`
 * from `ipc/command-handlers.ts`: they are structurally the same function, and
 * keeping the services layer free of any dependency on the IPC layer means this
 * module can be tested without `ipcMain` ever existing.
 */
export function createMainContextProvider(
  adapters: MainCommandAdapters
): () => CommandContextSnapshot {
  return () =>
    MainOwnedContextSchema.parse({
      devToolsAllowed: adapters.contexts.devToolsAllowed(),
      updatersAvailable: adapters.contexts.updatersAvailable(),
      workspaceOpen: adapters.contexts.workspaceOpen(),
      configurationsExist: adapters.contexts.configurationsExist()
    });
}
