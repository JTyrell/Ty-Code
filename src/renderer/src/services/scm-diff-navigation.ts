/**
 * Source-control diff change navigation (Prompt 5b, Go menu group G7).
 *
 * Go's Next/Previous Change has two halves in the spec: walk the diff editor
 * when one is open, *else* walk source control. The first half already lives in
 * {@link ./editor-service}, which owns the diff editor registered by the
 * workspace-edit review surface. The second half cannot live there, because the
 * source-control overlay (`components/DiffViewer.tsx`) drives its own Monaco
 * diff editor from git's hunk list — and that list is not the same list Monaco
 * computes from the two strings it was handed.
 *
 * This module is the seam between the two. The overlay publishes a navigator
 * while it is open and withdraws it when it closes; the command layer asks for
 * a step and falls through to the editor service when no navigator is
 * published. Nothing here imports React, and nothing here knows which hunk is
 * selected — the overlay keeps that, because the same index drives its Stage /
 * Unstage / Revert-hunk buttons and desynchronising it would revert work the
 * user is not looking at.
 *
 * Shaped as a module-level singleton with an explicit listener set, mirroring
 * {@link ./monaco-runtime} and {@link ./editor-service}, so a popout window and
 * the primary window each publish their own navigator and tear it down without
 * leaking a subscription into a store that outlives them.
 */

/** Walks one diff's hunks. Implemented by whichever surface owns the diff. */
export interface ScmDiffNavigator {
  /**
   * Hunks available to step through. Zero means the overlay is showing a diff
   * with nothing to navigate, so the Go menu rows stay greyed rather than
   * firing a step that cannot move.
   */
  hunkCount(): number;
  /**
   * Move one hunk in `direction` and reveal it. Returns false when there is
   * nothing to step into, which lets the caller fall through to the diff editor
   * registered with the editor service.
   */
  step(direction: 1 | -1): boolean;
}

export interface ScmDiffNavigationDisposable {
  dispose(): void;
}

// Named `activeNavigator` rather than `navigator` so it does not shadow the
// DOM global inside this module.
let activeNavigator: ScmDiffNavigator | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[scm-diff-navigation] a listener failed', error);
    }
  }
}

/**
 * Publish a navigator, replacing any current one.
 *
 * Disposing restores the *previous* navigator rather than clearing it, so two
 * overlapping surfaces — StrictMode's double mount, or a popout closing over
 * the primary window — leave the command layer pointed at something real
 * instead of at nothing.
 *
 * Registering and disposing both notify listeners, because the hunk count is
 * what `diffOrScmChangesOpen` is resolved from: without a notification the Go
 * menu would keep greying out Alt+F3 after a diff opened.
 */
export function registerScmDiffNavigator(next: ScmDiffNavigator): ScmDiffNavigationDisposable {
  const previous = activeNavigator;
  activeNavigator = next;
  emit();

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (activeNavigator === next) activeNavigator = previous;
      emit();
    }
  };
}

/** Observe navigator changes. Returns an unsubscribe function. */
export function subscribeScmDiffNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hunks the published navigator can walk, or zero when none is published.
 *
 * Defensive on purpose: this is read while resolving menu enablement, where a
 * throw would take the whole menu bar down over one surface's bug. A navigator
 * that cannot count its hunks has no business claiming there are changes to
 * walk, so zero — the fail-closed answer — is the honest fallback.
 */
export function scmDiffHunkCount(): number {
  if (!activeNavigator) return 0;
  try {
    const count = activeNavigator.hunkCount();
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch (error) {
    console.warn('[scm-diff-navigation] hunkCount() failed', error);
    return 0;
  }
}

/**
 * Step one hunk in the published navigator.
 *
 * Returns false when nothing is published or the navigator declines, which is
 * the caller's cue to try the editor service's diff editor. Errors are *not*
 * caught here: a failing step is a real failure and the command runtime turns
 * a thrown handler into a visible toast, which is better than a silent
 * fall-through that reports "no later change" over a diff full of them.
 */
export function stepScmDiff(direction: 1 | -1): boolean {
  if (!activeNavigator) return false;
  return activeNavigator.step(direction) === true;
}
