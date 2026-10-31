/**
 * Ty-Code Command IPC — the only bridge between a window's menu bar and the
 * main-process half of the command registry.
 *
 * A renderer imports `command-registry.ts` directly (it is Electron-free, same
 * precedent as `config-schemas.ts`), so menus and keybindings are painted with
 * no round trip. This module exists for the three things a window genuinely
 * cannot do alone:
 *
 *  1. Run an entry whose `target` is `main` — New Window, Exit, Toggle
 *     Developer Tools, Open Process Explorer, Check for Updates.
 *  2. Learn the contexts only main can observe, and which main-target handlers
 *     are actually registered. Without (2) a window would paint rows main
 *     cannot run, which is the dead click "hidden > dead" forbids.
 *  3. Read the execution ledger, so "zero dead clicks" is a claim checked
 *     against what really ran rather than an assertion.
 *
 * Envelope vs outcome are deliberately separate: `success: false` means the
 * call itself did not complete (untrusted frame, payload failed validation),
 * while `success: true` with `data.ok === false` means the call completed and
 * the command declined for a reason the UI can show — `disabled` carries the
 * same sentence the tooltip carries, `no_handler` is the hidden>dead tripwire.
 *
 * Handlers must return structured-cloneable data. The result is schema-checked
 * on the way out, but Electron's clone step is not, so a returned function or
 * live object reference would surface as an opaque clone failure.
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { IpcResponse } from '../../preload/types';
import {
  COMMAND_CHANNELS,
  CommandExecutionRecordSchema,
  ExecuteCommandPayloadSchema,
  ExecuteDynamicSubmenuPayloadSchema,
  ExecuteCommandResultSchema,
  MainCommandContextSchema,
  type CommandContextSnapshot,
  type CommandExecutionRecord,
  type ExecuteCommandResult,
  type MainCommandContext
} from '../../shared/types/command-registry';
import {
  assertCommandRegistryValid,
  emptyContext
} from '../services/command-registry';
import {
  createCommandExecutor,
  type CommandDisposable,
  type CommandExecutor,
  type CommandHandler
} from '../services/command-executor';

/**
 * Channel names, re-exported for main-process callers.
 *
 * The definition lives in the shared contract because the preload bridge needs
 * the same strings and must not import this module — doing so would pull
 * `ipcMain` into the sandboxed preload.
 */
export { COMMAND_CHANNELS };

/**
 * Supplies the contexts main owns.
 *
 * Must return **only** main-authoritative keys (`updatersAvailable`,
 * `devToolsAllowed`, `workspaceOpen`, `configurationsExist`, …). Those are
 * merged *over* the sender's snapshot, so main's word is final on them and a
 * compromised renderer cannot claim `devToolsAllowed` to unlock a guarded row.
 * Keys main does not report stay exactly as the window sent them — otherwise
 * main would clobber `editorOpen` with `false` on every call and grey out the
 * whole Go menu.
 */
export type MainContextProvider = () => CommandContextSnapshot;

export interface CommandHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Re-read on every request, so a menu never paints from stale state. */
  contexts: MainContextProvider;
  /**
   * Main-target handlers, keyed by the registry's `command` field — never by an
   * entry id. One handler backs many entries (`editor.monacoAction` serves every
   * go.* row), which is what keeps the table declarative.
   */
  handlers?: Record<string, CommandHandler>;
  /** How many executions the ledger retains. Defaults to the executor's own. */
  auditLimit?: number;
}

let executor: CommandExecutor | null = null;
let registered: CommandDisposable | null = null;
let contextsProvider: MainContextProvider = () => ({});

/**
 * The process-wide main executor.
 *
 * Lazily created so a service module can register its handlers during import
 * without depending on `registerCommandHandlers` having run first.
 */
export function getMainCommandExecutor(): CommandExecutor {
  if (!executor) executor = createCommandExecutor({ target: 'main' });
  return executor;
}

function failure(message: string): IpcResponse<never> {
  return { success: false, error: message };
}

function describeIssues(error: z.ZodError): string {
  return error.issues[0]?.message || 'invalid payload';
}

/** Window that originated the call, so window-targeting handlers aim correctly. */
function resolveWindowId(event: IpcMainInvokeEvent, claimed?: number): number | undefined {
  if (typeof claimed === 'number') return claimed;
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) return undefined;
  return BrowserWindow.fromWebContents(sender)?.id;
}

function readMainContext(): MainCommandContext {
  const current = getMainCommandExecutor();
  // Parsed on the way out, not just on the way in: a window that paints menus
  // from this payload must never receive a key the shared contract does not
  // define, or it would silently treat an unknown context as false.
  return MainCommandContextSchema.parse({
    contexts: contextsProvider(),
    availableCommands: [...current.availableCommands()],
    missingHandlers: current.missingHandlers()
  });
}

/**
 * Register the command channels. Idempotent — a second call returns the
 * existing disposable rather than double-binding and throwing.
 */
export function registerCommandHandlers(deps: CommandHandlerDeps): CommandDisposable {
  if (registered) return registered;

  // Fail fast on a malformed table. The registry is frozen and unit-tested, so
  // reaching this throw means a real regression, and booting with a broken
  // table would surface later as inexplicably missing menu rows.
  assertCommandRegistryValid();

  const current = getMainCommandExecutor();
  const handlerDisposable = deps.handlers ? current.registerAll(deps.handlers) : null;
  contextsProvider = deps.contexts;

  const executeListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<ExecuteCommandResult>> => {
    if (!deps.isTrustedSender(event)) return failure('Untrusted renderer frame.');

    const parsed = ExecuteCommandPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failure(`Command payload failed validation: ${describeIssues(parsed.error)}`);
    }

    const windowId = resolveWindowId(event, parsed.data.windowId);
    // Sender first, then main's own view layered over the keys it owns. Absent
    // keys read false, so an unproven context disables rather than fires blind.
    const contexts = { ...emptyContext(), ...parsed.data.contexts, ...contextsProvider() };

    const result = await current.execute({
      commandId: parsed.data.commandId,
      args: parsed.data.args,
      windowId,
      contexts
    });
    return { success: true, data: ExecuteCommandResultSchema.parse(result) };
  };

  const executeDynamicListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<ExecuteCommandResult>> => {
    if (!deps.isTrustedSender(event)) return failure('Untrusted renderer frame.');

    const parsed = ExecuteDynamicSubmenuPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failure(`Dynamic submenu payload failed validation: ${describeIssues(parsed.error)}`);
    }

    const windowId = resolveWindowId(event, parsed.data.windowId);
    const result = await current.executeDynamic(parsed.data.item, windowId);
    return { success: true, data: ExecuteCommandResultSchema.parse(result) };
  };

  const mainContextListener = (
    event: IpcMainInvokeEvent
  ): IpcResponse<MainCommandContext> => {
    if (!deps.isTrustedSender(event)) return failure('Untrusted renderer frame.');
    try {
      return { success: true, data: readMainContext() };
    } catch (err: unknown) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  };

  const auditListener = (
    event: IpcMainInvokeEvent
  ): IpcResponse<CommandExecutionRecord[]> => {
    if (!deps.isTrustedSender(event)) return failure('Untrusted renderer frame.');
    try {
      return { success: true, data: z.array(CommandExecutionRecordSchema).parse(current.auditTrail()) };
    } catch (err: unknown) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.handle(COMMAND_CHANNELS.execute, executeListener);
  ipcMain.handle(COMMAND_CHANNELS.executeDynamic, executeDynamicListener);
  ipcMain.handle(COMMAND_CHANNELS.mainContext, mainContextListener);
  ipcMain.handle(COMMAND_CHANNELS.audit, auditListener);

  registered = {
    dispose() {
      ipcMain.removeHandler(COMMAND_CHANNELS.execute);
      ipcMain.removeHandler(COMMAND_CHANNELS.executeDynamic);
      ipcMain.removeHandler(COMMAND_CHANNELS.mainContext);
      ipcMain.removeHandler(COMMAND_CHANNELS.audit);
      handlerDisposable?.dispose();
      contextsProvider = () => ({});
      registered = null;
    }
  };
  return registered;
}

/**
 * Drop the singleton executor. Test-only seam: without it, a suite that
 * registers handlers leaks them into the next file's module instance.
 */
export function resetCommandHandlersForTest(): void {
  registered?.dispose();
  executor?.dispose();
  executor = null;
  registered = null;
  contextsProvider = () => ({});
}
