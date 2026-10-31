import { z } from 'zod';

/**
 * Request and result contracts for the two file dialogs the command registry
 * drives (`workbench.openFile`, `workbench.saveAs`).
 *
 * These dialogs did not exist before the registry. The only picker in the build
 * was `selectWorkspaceFolder`, which is directory-only — so File > Open File…
 * and File > Save As… had nothing to call and were left unregistered, i.e.
 * hidden. Adding them means adding a process boundary, and a new boundary gets
 * a schema.
 *
 * Two properties matter here.
 *
 *  - **`z.object` strips unknown keys.** Electron's dialog options include
 *    `properties` and `securityScopedBookmarks`. Neither should be reachable
 *    from a renderer payload: a caller that could set `properties` could turn
 *    an "Open File" picker into a directory picker or ask for multi-selection
 *    this handler never intended to handle. Declaring only the keys below and
 *    letting Zod drop the rest is what keeps that true.
 *  - **Cancellation is not an error.** `selectWorkspaceFolder` collapses "the
 *    user dismissed the dialog" and "the dialog failed" into one
 *    `success: false`, which forces every caller to sniff the error text for
 *    the word "cancel" to avoid showing a red toast for a changed mind.
 *    `FileDialogResult.canceled` says it structurally instead.
 */

/**
 * IPC channel names.
 *
 * Declared here rather than in the main handler module for the same reason
 * `COMMAND_CHANNELS` lives in the shared contract: the preload bridge needs the
 * identical strings, and it must not import from `src/main` or it would pull
 * `ipcMain` into the sandboxed preload context.
 */
export const FILE_DIALOG_CHANNELS = {
  openFile: 'dialog:open-file',
  savePath: 'dialog:save-path'
} as const;

/** One row of the picker's file-type dropdown. */
export const FileDialogFilterSchema = z.object({
  name: z.string().min(1).max(80),
  extensions: z.array(z.string().min(1).max(32)).max(64)
});

export type FileDialogFilter = z.infer<typeof FileDialogFilterSchema>;

export const OpenFileDialogRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  defaultPath: z.string().min(1).max(4096).optional(),
  filters: z.array(FileDialogFilterSchema).max(16).optional()
});

export type OpenFileDialogRequest = z.infer<typeof OpenFileDialogRequestSchema>;

export const SavePathDialogRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  defaultPath: z.string().min(1).max(4096).optional(),
  buttonLabel: z.string().min(1).max(40).optional(),
  filters: z.array(FileDialogFilterSchema).max(16).optional()
});

export type SavePathDialogRequest = z.infer<typeof SavePathDialogRequestSchema>;

/**
 * What either dialog returned.
 *
 * Exactly one of the three shapes is legal, and the discriminator is
 * `canceled`: `{ canceled: true }` for a dismissed picker, `{ canceled: false,
 * filePath }` for a chosen path. A genuine failure is reported by the envelope
 * (`IpcResponse.success === false`) rather than here, so a caller never has to
 * decide whether a falsy `filePath` means "dismissed" or "broken".
 */
export const FileDialogResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().min(1).optional()
});

export type FileDialogResult = z.infer<typeof FileDialogResultSchema>;
