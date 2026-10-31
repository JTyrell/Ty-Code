/**
 * File dialog IPC — the wiring half of `file-dialog-service.ts`.
 *
 * Everything decision-making lives in the service, which is free of `electron`
 * so it can be unit-tested under plain Node. This module supplies the two things
 * only main can: the real `dialog` binding, and the window to parent it to.
 *
 * Parenting matters more than it looks. An unparented dialog is not modal to the
 * window that asked for it, so a user can click behind the picker into the
 * editor, change the active tab, and then confirm a path the command handler no
 * longer means — the handler reads `activeTabPath` after the await returns. The
 * sender's own window is used first for exactly that reason, with the primary
 * window as a fallback for the rare frame that is not a `BrowserWindow`.
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcResponse } from '../../preload/types';
import {
  FILE_DIALOG_CHANNELS,
  type FileDialogResult
} from '../../shared/types/file-dialog';
import {
  openFileDialog,
  savePathDialog,
  type DialogParentLike,
  type FileDialogServiceDeps
} from '../services/file-dialog-service';

export { FILE_DIALOG_CHANNELS };

export interface FileDialogHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Primary window, read lazily because index.ts rebinds it on recreation. */
  getFallbackWindow(): BrowserWindow | null;
  /** Override for tests. Defaults to the real Electron dialog. */
  service?: FileDialogServiceDeps;
}

/**
 * The real Electron dialog, adapted to the service's Electron-free signatures.
 *
 * The `parent` branch is not ceremony: `dialog.showOpenDialog(null, options)`
 * throws, while the one-argument overload is how you ask for an unparented
 * picker.
 */
export function createElectronFileDialogService(): FileDialogServiceDeps {
  return {
    showOpenDialog: (parent, options) => {
      const asWindow = parent as BrowserWindow | null;
      return asWindow
        ? dialog.showOpenDialog(asWindow, options as Electron.OpenDialogOptions)
        : dialog.showOpenDialog(options as Electron.OpenDialogOptions);
    },
    showSaveDialog: (parent, options) => {
      const asWindow = parent as BrowserWindow | null;
      return asWindow
        ? dialog.showSaveDialog(asWindow, options as Electron.SaveDialogOptions)
        : dialog.showSaveDialog(options as Electron.SaveDialogOptions);
    }
  };
}

function isUsable(window: BrowserWindow | null | undefined): window is BrowserWindow {
  return Boolean(window) && !window!.isDestroyed();
}

/** The window that should own the picker, or null for an unparented one. */
function resolveParent(
  event: IpcMainInvokeEvent,
  deps: FileDialogHandlerDeps
): DialogParentLike | null {
  const sender = event.sender;
  if (sender && !sender.isDestroyed()) {
    const own = BrowserWindow.fromWebContents(sender);
    if (isUsable(own)) return own;
  }
  const fallback = deps.getFallbackWindow();
  return isUsable(fallback) ? fallback : null;
}

let registered: { dispose(): void } | null = null;

/**
 * Register both dialog channels. Idempotent, like `registerCommandHandlers`: a
 * second call returns the existing disposable instead of double-binding and
 * throwing on an already-registered channel.
 */
export function registerFileDialogHandlers(
  deps: FileDialogHandlerDeps
): { dispose(): void } {
  if (registered) return registered;

  const service = deps.service ?? createElectronFileDialogService();

  const openListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<FileDialogResult>> => {
    if (!deps.isTrustedSender(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    return openFileDialog(service, resolveParent(event, deps), payload);
  };

  const saveListener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<FileDialogResult>> => {
    if (!deps.isTrustedSender(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    return savePathDialog(service, resolveParent(event, deps), payload);
  };

  ipcMain.handle(FILE_DIALOG_CHANNELS.openFile, openListener);
  ipcMain.handle(FILE_DIALOG_CHANNELS.savePath, saveListener);

  registered = {
    dispose() {
      ipcMain.removeHandler(FILE_DIALOG_CHANNELS.openFile);
      ipcMain.removeHandler(FILE_DIALOG_CHANNELS.savePath);
      registered = null;
    }
  };
  return registered;
}
