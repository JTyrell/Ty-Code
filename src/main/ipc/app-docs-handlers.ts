/**
 * Help-menu document IPC — the wiring half of `app-docs-service.ts`.
 *
 * The service resolves an allowlisted id to a file and reads it, and knows
 * nothing about Electron. This module supplies the two things only main can: the
 * directory the allowlist is relative to, and the frame trust gate that decides
 * which renderer is allowed to ask.
 *
 * There is exactly one root and it works in both layouts, which is why there is
 * no `app.isPackaged` branch here. `package.json` points at `dist/main/index.js`
 * in dev and `electron-builder.yml` keeps that path inside the archive when
 * packaged, so `__dirname` is always `<bundle root>/dist/main` and two levels up
 * is always the directory the repo-relative paths in `APP_DOC_SOURCES` were
 * written against — the working tree in dev, the asar root in an installed build.
 * The documents reach that archive through the `files:` list, so the reader and
 * the packager agree by construction rather than by a second copy kept in sync.
 *
 * Reads go through the callback `fs` API promisified, not `fs.promises`. Both are
 * asar-aware in Electron, but the callback API is the one the archive support was
 * built around, and this is a four-file menu click where being boring is free.
 */

import { readFile, readdir } from 'node:fs';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promisify } from 'node:util';
import path from 'node:path';
import type { IpcResponse } from '../../preload/types';
import { APP_DOC_CHANNELS, type AppDoc } from '../../shared/types/app-docs';
import { readAppDoc, type AppDocDeps } from '../services/app-docs-service';

export { APP_DOC_CHANNELS };

const readFileAsync = promisify(readFile);
const readdirAsync = promisify(readdir);

/**
 * The directories allowlisted paths resolve against.
 *
 * Exported for the same reason `createElectronAppDocDeps` is: a test can assert
 * the root it will get instead of guessing at `__dirname`, and a future
 * platform-specific override is one array entry rather than a branch in the
 * service.
 */
export function docSearchRoots(): string[] {
  return [path.resolve(__dirname, '..', '..')];
}

/** The real filesystem bindings, adapted to the service's Electron-free shape. */
export function createElectronAppDocDeps(): AppDocDeps {
  return {
    roots: docSearchRoots(),
    readFile: async (absPath) => readFileAsync(absPath, 'utf8'),
    listDir: async (absPath) => readdirAsync(absPath)
  };
}

export interface AppDocHandlerDeps {
  /** The frame trust gate every Ty-Code IPC handler shares. */
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Override for tests. Defaults to the real filesystem bindings. */
  service?: AppDocDeps;
}

let registered: { dispose(): void } | null = null;

/**
 * Register the document channel. Idempotent, like `registerProcessExplorerHandlers`:
 * a second call returns the existing disposable instead of double-binding and
 * throwing on an already-registered channel.
 *
 * Nothing is cached between calls. A document is read when it is asked for and
 * the panel drops it when it closes, so a cache here would be a second copy of
 * the truth that has to be invalidated — and the one case where staleness would
 * matter is a developer editing `README.md` in the repo they are running Ty-Code
 * from, who expects the click to show what they just wrote.
 */
export function registerAppDocHandlers(deps: AppDocHandlerDeps): { dispose(): void } {
  if (registered) return registered;

  const service = deps.service ?? createElectronAppDocDeps();

  const listener = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<IpcResponse<AppDoc>> => {
    if (!deps.isTrustedSender(event)) {
      return { success: false, error: 'Untrusted renderer frame.' };
    }
    return readAppDoc(service, payload);
  };

  ipcMain.handle(APP_DOC_CHANNELS.read, listener);

  registered = {
    dispose() {
      ipcMain.removeHandler(APP_DOC_CHANNELS.read);
      registered = null;
    }
  };
  return registered;
}
