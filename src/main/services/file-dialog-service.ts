/**
 * File dialog service — the Electron-free half of `workbench.openFile` and
 * `workbench.saveAs`.
 *
 * These two dialogs did not exist before the command registry. The build's only
 * picker was `selectWorkspaceFolder`, which asks for a directory, so the two
 * File-menu rows that need a *file* had nothing to call and stayed hidden.
 *
 * The module follows the same split as `command-main-handlers.ts` and
 * `command-main-adapters.ts`: all the logic lives here with `electron`'s dialog
 * injected as two plain functions, so it runs under plain Node in tests, and
 * `ipc/file-dialog-handlers.ts` is the thin wiring that hands it the real thing.
 *
 * Two decisions worth stating, because both are easy to lose in a later edit.
 *
 *  - **`properties` is set here, never taken from the payload.** The shared
 *    schema does not declare it, and `z.object` strips undeclared keys, so a
 *    renderer cannot ask for `multiSelections` or `openDirectory`. If it could,
 *    an "Open File" picker would become a directory picker and the handler
 *    below would hand back a folder path that `openFile()` then fails to read.
 *  - **Cancellation is `success: true` with `canceled: true`, not an error.**
 *    `selectWorkspaceFolder` returns `success: false` with the text "User
 *    canceled directory selection", which forces callers to sniff the message
 *    to avoid showing a red toast for a changed mind. A dismissed picker is a
 *    normal outcome and is reported structurally instead.
 */

import type { IpcResponse } from '../../preload/types';
import {
  FileDialogResultSchema,
  OpenFileDialogRequestSchema,
  SavePathDialogRequestSchema,
  type FileDialogFilter,
  type FileDialogResult
} from '../../shared/types/file-dialog';

/**
 * Structural stand-in for `BrowserWindow`.
 *
 * Declared rather than imported so this module stays free of `electron`: a real
 * `BrowserWindow` satisfies it, and tests pass a stub.
 */
export interface DialogParentLike {
  isDestroyed(): boolean;
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileDialogFilter[];
  /** Set by this module only. Never read from a caller payload. */
  properties: Array<'openFile'>;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileDialogFilter[];
}

export interface FileDialogServiceDeps {
  showOpenDialog(
    parent: DialogParentLike | null,
    options: OpenDialogOptions
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    parent: DialogParentLike | null,
    options: SaveDialogOptions
  ): Promise<{ canceled: boolean; filePath?: string }>;
}

/** First Zod issue, so a validation failure reads as a diagnosis not a dump. */
function describeIssues(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'invalid payload';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Strip `undefined` values before they reach `dialog`.
 *
 * Electron treats an explicitly-`undefined` `defaultPath` differently from an
 * absent one on some platforms — it can reset the picker's remembered location
 * instead of falling back to it. Omitting the key entirely is the behaviour a
 * caller means when it does not supply one.
 */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

/**
 * Ask for a file to open.
 *
 * Multi-selection is deliberately not offered: `workbench.openFile` opens one
 * tab, and a picker that returned five paths would silently drop four. Adding
 * multi-select means adding a loop in the command handler, not a flag here.
 */
export async function openFileDialog(
  deps: FileDialogServiceDeps,
  parent: DialogParentLike | null,
  payload: unknown
): Promise<IpcResponse<FileDialogResult>> {
  const parsed = OpenFileDialogRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: `Open-file request failed validation: ${describeIssues(parsed.error)}`
    };
  }

  try {
    const result = await deps.showOpenDialog(
      parent,
      defined({
        title: parsed.data.title,
        defaultPath: parsed.data.defaultPath,
        filters: parsed.data.filters,
        properties: ['openFile'] as const
      }) as OpenDialogOptions
    );

    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return { success: true, data: { canceled: true } };

    // Parsed on the way out as well as in: an empty string from a misbehaving
    // platform binding would otherwise travel to `openFile('')` and fail there
    // with a message about a file that does not exist.
    return {
      success: true,
      data: FileDialogResultSchema.parse({ canceled: false, filePath: chosen })
    };
  } catch (err: unknown) {
    return { success: false, error: `The open-file dialog failed: ${describeError(err)}` };
  }
}

/**
 * Ask where to save.
 *
 * No `properties` are set, so the overwrite confirmation stays at each
 * platform's own default rather than being pinned to one that behaves oddly on
 * another. The caller supplies `defaultPath` — normally the active tab's path —
 * because a Save As… that opens in Documents is a dialog the user has to work.
 */
export async function savePathDialog(
  deps: FileDialogServiceDeps,
  parent: DialogParentLike | null,
  payload: unknown
): Promise<IpcResponse<FileDialogResult>> {
  const parsed = SavePathDialogRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: `Save-path request failed validation: ${describeIssues(parsed.error)}`
    };
  }

  try {
    const result = await deps.showSaveDialog(
      parent,
      defined({
        title: parsed.data.title,
        defaultPath: parsed.data.defaultPath,
        buttonLabel: parsed.data.buttonLabel,
        filters: parsed.data.filters
      }) as SaveDialogOptions
    );

    if (result.canceled || !result.filePath) return { success: true, data: { canceled: true } };

    return {
      success: true,
      data: FileDialogResultSchema.parse({ canceled: false, filePath: result.filePath })
    };
  } catch (err: unknown) {
    return { success: false, error: `The save dialog failed: ${describeError(err)}` };
  }
}
