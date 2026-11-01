import { z } from 'zod';

/**
 * Contract for the Help menu's document rows (Prompt 5b Step 5, groups G1/G2):
 * Ty-Code Documentation, Show Release Notes, View License and Privacy Policy.
 *
 * These four rows are the reason the contract exists at all. Before it, the menu
 * bar answered Help clicks with either nothing or with prose written into a
 * component — text that looked like documentation and was really a decoration,
 * because nothing checked it against the file it claimed to be. The rule here is
 * the opposite: **the renderer names a document, main finds it and reads it, and
 * whatever is on disk is what the user sees.** A doc that cannot be found is
 * reported as missing rather than substituted with something plausible.
 *
 * Three properties are load-bearing.
 *
 *  - **The renderer sends an id and never a path.** `id` is a `z.enum` over
 *    `APP_DOC_IDS`, and the id-to-path mapping lives in main
 *    (`APP_DOC_SOURCES`). There is no channel by which a renderer frame could
 *    ask for `../../.ssh/id_rsa`, so path traversal is not "guarded against"
 *    here — it is unrepresentable. The containment check in the service is
 *    defence in depth against a future edit to that table, not against a caller.
 *  - **Candidates, not a single path.** Two of these files carry a version
 *    suffix (`RELEASE_NOTES_v1.0.0.md`), so an allowlist that hard-codes the
 *    filename silently becomes a dead click at the next release. Each id maps to
 *    an ordered list of patterns and the first one that resolves wins, which
 *    keeps the allowlist explicit while surviving a rename.
 *  - **`source` is repo-relative.** It is what the panel shows when it says
 *    where the text came from, and an absolute path would leak the build
 *    machine's directory layout into a screenshot for no benefit.
 */

/**
 * IPC channel names.
 *
 * Declared here rather than in the main handler module for the same reason
 * `PROCESS_EXPLORER_CHANNELS` and `FILE_DIALOG_CHANNELS` are: the preload bridge
 * needs the identical strings and must not import from `src/main`, or it would
 * pull `ipcMain` into the sandboxed preload context.
 *
 * One channel, pull only. There is no push channel and no cache invalidation
 * because a document is read when the user asks for it and dropped when they
 * close the panel; a watcher on four markdown files would be a subscription
 * with nothing to notify.
 */
export const APP_DOC_CHANNELS = {
  read: 'app-docs:read'
} as const;

/**
 * The documents the Help menu can open.
 *
 * Deliberately exactly the four the spec names. A fifth id with no menu row
 * would be an id nothing can reach, and a fifth menu row would break the
 * "exact groups and separators" the Help menu is verified against. Adding a
 * document later means one entry here and one in `APP_DOC_SOURCES` — that is the
 * whole cost, which is the point of keeping the list short now.
 */
export const APP_DOC_IDS = ['documentation', 'release-notes', 'license', 'privacy-policy'] as const;

export const AppDocIdSchema = z.enum(APP_DOC_IDS);

export type AppDocId = z.infer<typeof AppDocIdSchema>;

/**
 * How the content should be rendered.
 *
 * `markdown` for the three prose documents, `text` for the licence. A licence is
 * plain text with a layout that carries meaning — the all-caps disclaimer
 * paragraphs in an MIT licence are meant to look like a wall of text, and a
 * markdown renderer would collapse the line breaks that make it one.
 */
export const APP_DOC_FORMATS = ['markdown', 'text'] as const;

export const AppDocFormatSchema = z.enum(APP_DOC_FORMATS);

export type AppDocFormat = z.infer<typeof AppDocFormatSchema>;

export const AppDocSchema = z.object({
  id: AppDocIdSchema,
  /** Window title. Derived from the document's own first heading where it has one. */
  title: z.string().min(1).max(160),
  /** Repo-relative path that was actually read, e.g. `RELEASE_NOTES_v1.0.0.md`. */
  source: z.string().min(1).max(320),
  format: AppDocFormatSchema,
  /** The file's bytes decoded as UTF-8, unmodified. */
  content: z.string(),
  /** Size of the file on disk, so a truncated read can say what it cut. */
  bytes: z.number().int().nonnegative(),
  /** True when `bytes` exceeded the read cap and `content` is a prefix of it. */
  truncated: z.boolean()
});

export type AppDoc = z.infer<typeof AppDocSchema>;

export const AppDocRequestSchema = z.object({
  id: AppDocIdSchema
});

export type AppDocRequest = z.infer<typeof AppDocRequestSchema>;
