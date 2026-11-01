/**
 * State for the Help menu's document viewer (Prompt 5b Step 5, groups G1/G2).
 *
 * Four menu rows — Ty-Code Documentation, Show Release Notes, View License and
 * Privacy Policy — all open the same surface with a different document id, so
 * the id is state rather than a prop and one mounted panel serves all four.
 *
 * The store holds no document text of its own. Everything it renders came back
 * from main over `readAppDoc`, which reads the real file off disk; there is no
 * bundled fallback prose here, and a document this build does not ship shows the
 * sentence main sent rather than a blank panel. A blank panel and a missing file
 * look identical to a user, and only one of those is the truth.
 *
 * Two failure modes this file is written around.
 *
 *  - **Out-of-order responses.** Clicking Documentation and then License quickly
 *    fires two IPC round-trips over files of very different sizes, and IPC gives
 *    no ordering guarantee between them. Without a token the slower first read
 *    would land last and leave the panel titled "License" showing the README. The
 *    `requestId` counter makes that unrepresentable: a response is applied only
 *    if nothing newer was asked for.
 *  - **A spinner that never resolves.** A window with no `readAppDoc` on its
 *    bridge — an older preload, or a frame that never got one — is reported as
 *    an error immediately instead of staying in the loading state, because
 *    "still reading" reads as a hang when nothing is reading.
 */

import { create } from 'zustand';
import type { AppDoc, AppDocId } from '../../../preload/types';

interface AppDocsState {
  /** The id currently shown, or the one being read. Drives the panel title before the text arrives. */
  activeId: AppDocId | null;
  doc: AppDoc | null;
  isLoading: boolean;
  /** A sentence from main, or from this module when the bridge is missing. Never a stack trace. */
  error: string | null;
  openDoc: (id: AppDocId) => void;
  closeDoc: () => void;
  /** Re-read the open document from disk, for a user editing it in the same checkout. */
  reload: () => void;
}

/**
 * Monotonic so a stale response can be recognised without comparing ids.
 *
 * Comparing ids would be wrong: opening Documentation twice in a row has the
 * same id both times, and the second read must still win even though the file
 * changed underneath it.
 */
let requestId = 0;

async function readDoc(
  id: AppDocId,
  token: number,
  set: (partial: Partial<AppDocsState>) => void,
  get: () => AppDocsState
): Promise<void> {
  const bridge = window.electronAPI?.readAppDoc;
  if (typeof bridge !== 'function') {
    // Only reported if nothing newer superseded this read, so the message
    // cannot overwrite the panel a later click already filled.
    if (token === requestId) {
      set({
        isLoading: false,
        doc: null,
        error:
          'This window has no document bridge, so Help cannot read a file. Restart Ty-Code, or read the document in the repository directly.'
      });
    }
    return;
  }

  try {
    const result = await bridge({ id });
    if (token !== requestId) return;
    if (result?.success && result.data) {
      set({ isLoading: false, doc: result.data, error: null });
      return;
    }
    // Main names the paths it tried, which is the useful half of the message.
    // Passing it through verbatim rather than paraphrasing keeps that detail.
    set({
      isLoading: false,
      doc: null,
      error: result?.error || `The ${id} document could not be read.`
    });
  } catch (err) {
    if (token !== requestId) return;
    set({
      isLoading: false,
      doc: null,
      error: `Reading the document failed: ${err instanceof Error ? err.message : String(err)}`
    });
  } finally {
    // `get()` is unused on purpose here: every branch above already guarded on
    // the token, and re-checking state would only add a second, weaker copy of
    // that guard.
    void get;
  }
}

export const useAppDocsStore = create<AppDocsState>((set, get) => ({
  activeId: null,
  doc: null,
  isLoading: false,
  error: null,

  openDoc: (id) => {
    requestId += 1;
    const token = requestId;
    const sameDoc = get().activeId === id && get().doc !== null;

    // A different document clears the panel before the read starts. Keeping the
    // previous one visible would show text that does not belong to the title
    // above it, and the two are only consistent for the length of the request.
    set({
      activeId: id,
      isLoading: true,
      error: null,
      doc: sameDoc ? get().doc : null
    });

    void readDoc(id, token, set, get);
  },

  closeDoc: () => {
    // Supersedes an in-flight read, so a response arriving after the panel is
    // gone cannot reopen it.
    requestId += 1;
    // The text is dropped rather than kept for next time. The file may have been
    // edited in the meantime, and showing last week's privacy policy under this
    // week's title is exactly the failure this viewer exists to prevent.
    set({ activeId: null, doc: null, isLoading: false, error: null });
  },

  reload: () => {
    const id = get().activeId;
    if (!id) return;
    requestId += 1;
    const token = requestId;
    // Keeps the current text on screen while re-reading: a reload is a
    // refinement of what is already shown, not a navigation somewhere else.
    set({ isLoading: true, error: null });
    void readDoc(id, token, set, get);
  }
}));

/**
 * Open a Help document from anywhere, including a command handler that has no
 * React context. The four `help.*` rows in `workbench-commands.ts` call this.
 */
export function openAppDoc(id: AppDocId): void {
  useAppDocsStore.getState().openDoc(id);
}
