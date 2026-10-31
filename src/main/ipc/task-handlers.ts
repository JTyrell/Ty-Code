/**
 * Task IPC — the wiring half of `task-runner-service.ts`.
 *
 * Everything decision-making lives in the service, which is free of `electron`
 * so it runs under plain Node in tests. This module supplies the three things
 * only main can: the real PTY surface, the workspace root discovery reads from,
 * and the frame trust gate.
 *
 * Two shapes here are worth explaining.
 *
 *  - **`tasks:changed` is a push, and it goes to every window.** A task started
 *    from a popout's menu bar has to disable that popout's Terminate row when
 *    the sentinel lands, and the primary window's menu bar has to agree. Both
 *    windows read `tasksRunning` from the same context key, so both need the
 *    same event. The payload is the whole running list rather than a delta,
 *    because a delta forces every receiver to hold prior state and get it
 *    right — and a receiver that missed one message would then be permanently
 *    wrong about whether G3 is enabled.
 *  - **`list` returns a note, not a failure.** A `tasks.json` with a trailing
 *    comma still yields the package.json scripts beside it; see
 *    `TaskListResult.error`. The envelope reserves `success: false` for "the
 *    frame is not trusted" and "main threw", which are the two cases where
 *    there is genuinely nothing to show.
 */

import fs from 'fs';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcResponse } from '../../preload/types';
import {
  TASK_CHANNELS,
  type RunningTask,
  type TaskListResult,
  type TaskRunResult
} from '../../shared/types/tasks';
import {
  createTaskRunner,
  type TaskRunner,
  type TaskRunnerDeps
} from '../services/task-runner-service';
import {
  dispatchRunCommand,
  observePtyExit,
  observePtyOutput,
  resolveTaskTerminal
} from './pty-handlers';

export { TASK_CHANNELS };

export interface TaskHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Primary window, read lazily because index.ts rebinds it on recreation. */
  getMainWindow(): BrowserWindow | null;
  /**
   * Workspace root that `.vscode/tasks.json` and `package.json` are read from,
   * or null before a folder is open — in which case discovery honestly reports
   * `source: 'none'` instead of listing tasks from Ty-Code's own install
   * directory, which is what `process.cwd()` would give it.
   */
  getWorkspacePath(): string | null;
  /** Override for tests. Defaults to the real PTY-backed surface. */
  runnerDeps?: TaskRunnerDeps;
}

/**
 * The real PTY surface, adapted to the service's Electron-free signatures.
 *
 * `createIfMissing: false` on the dispatch is load-bearing, not caution. The
 * command being written is already wrapped in a sentinel spelled for the shell
 * {@link resolveTaskTerminal} reported; a terminal recreated here would be a
 * different PTY nobody inspected, and the wrapper could be wrong for it. If the
 * terminal vanished between resolving and writing — the user closed the tab in
 * that gap — the honest answer is a failure with a reason, which the menu bar
 * shows as a toast, rather than a task silently running somewhere else.
 */
export function createPtyTaskRunnerDeps(
  getMainWindow: () => BrowserWindow | null
): TaskRunnerDeps {
  return {
    resolveTerminal: ({ cwd }) => resolveTaskTerminal({ cwd }, getMainWindow()),
    dispatchCommand: (command, opts) =>
      dispatchRunCommand(
        command,
        { terminalId: opts.terminalId, execute: opts.execute, createIfMissing: false },
        getMainWindow(),
        opts.cwd
      ),
    observeTerminalOutput: observePtyOutput,
    observeTerminalExit: observePtyExit,
    readFileOrNull: (absolutePath) => {
      try {
        return fs.readFileSync(absolutePath, 'utf8');
      } catch {
        // Missing, a directory, or unreadable: all "no such file" to discovery,
        // which is allowed to fall through to the next candidate.
        return null;
      }
    }
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run a synchronous piece of handler work and turn a throw into an envelope.
 *
 * The runner's async paths already catch internally, so this only guards the two
 * synchronous reads — where a Zod `parse` on the way out is the realistic
 * failure, and an unhandled throw would reach the renderer as a rejected
 * promise carrying a stack instead of a sentence.
 */
function guard<T>(label: string, work: () => T): IpcResponse<T> {
  try {
    return { success: true, data: work() };
  } catch (err: unknown) {
    return { success: false, error: `${label}: ${describeError(err)}` };
  }
}

let registered: { dispose(): void } | null = null;

/**
 * Register the five task channels and start pushing changes. Idempotent, like
 * `registerFileDialogHandlers`: a second call returns the existing disposable
 * instead of double-binding and throwing on an already-registered channel.
 */
export function registerTaskHandlers(deps: TaskHandlerDeps): { dispose(): void } {
  if (registered) return registered;

  const runner: TaskRunner = createTaskRunner(
    deps.runnerDeps ?? createPtyTaskRunnerDeps(deps.getMainWindow)
  );

  const broadcast = (tasks: RunningTask[]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send(TASK_CHANNELS.changed, tasks);
      } catch {
        /* Window raced shutdown; the next change reaches it or it is gone. */
      }
    }
  };

  const disposeSubscription = runner.subscribe(broadcast);

  const listListener = (event: IpcMainInvokeEvent): IpcResponse<TaskListResult> => {
    if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return guard('Task discovery failed', () => runner.list(deps.getWorkspacePath()));
  };

  const runningListener = (event: IpcMainInvokeEvent): IpcResponse<RunningTask[]> => {
    if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return guard('Reading running tasks failed', () => runner.listRunning());
  };

  const terminateListener = (event: IpcMainInvokeEvent, payload: unknown): IpcResponse<RunningTask> => {
    if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
    // The runner's own envelope is passed through untouched: "that task is no
    // longer running" is a precise answer and re-wrapping it would bury it.
    try {
      return runner.terminate(payload);
    } catch (err: unknown) {
      return { success: false, error: `Terminating the task failed: ${describeError(err)}` };
    }
  };

  const runListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<TaskRunResult>> => {
    if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return runner.run(payload, deps.getWorkspacePath());
  };

  const restartListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<TaskRunResult>> => {
    if (!deps.isTrustedSender(event)) return { success: false, error: 'Untrusted renderer frame.' };
    return runner.restart(payload, deps.getWorkspacePath());
  };

  ipcMain.handle(TASK_CHANNELS.list, listListener);
  ipcMain.handle(TASK_CHANNELS.running, runningListener);
  ipcMain.handle(TASK_CHANNELS.terminate, terminateListener);
  ipcMain.handle(TASK_CHANNELS.run, runListener);
  ipcMain.handle(TASK_CHANNELS.restart, restartListener);

  registered = {
    dispose() {
      disposeSubscription();
      runner.dispose();
      ipcMain.removeHandler(TASK_CHANNELS.list);
      ipcMain.removeHandler(TASK_CHANNELS.running);
      ipcMain.removeHandler(TASK_CHANNELS.terminate);
      ipcMain.removeHandler(TASK_CHANNELS.run);
      ipcMain.removeHandler(TASK_CHANNELS.restart);
      registered = null;
    }
  };
  return registered;
}
