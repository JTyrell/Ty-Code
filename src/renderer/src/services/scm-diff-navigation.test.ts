/**
 * Source-control diff navigation seam tests (Prompt 5b, Go menu group G7).
 *
 * The behaviours worth pinning are the ones that fail quietly if they regress:
 *
 *  - a declined step is the *caller's cue* to fall through to the editor
 *    service's diff editor, so `false` and `0` are load-bearing return values,
 *    not just absence-of-data;
 *  - disposing restores the **previous** navigator rather than clearing it,
 *    because StrictMode double-mounts and a popout closing over the primary
 *    window must not leave the Go menu pointed at nothing;
 *  - `hunkCount()` swallows errors while `step()` propagates them. That
 *    asymmetry is deliberate: a throw during menu-enablement resolution would
 *    take the whole menu bar down over one surface's bug, whereas a throwing
 *    step becomes a visible toast, which beats a silent fall-through reporting
 *    "no later change" over a diff full of them.
 *
 * Every test imports a **fresh module instance**. The navigator is module-level
 * singleton state, and one case below disposes out of order on purpose — after
 * which `previous` is a navigator that is already disposed, so no sequence of
 * disposes can drain it. Re-importing per test removes that leak instead of
 * depending on test order to hide it. The types are `import type`, so they are
 * erased and cannot capture a stale instance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScmDiffNavigator } from './scm-diff-navigation';

type ScmDiffNavigationModule = typeof import('./scm-diff-navigation');

let mod: ScmDiffNavigationModule;

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./scm-diff-navigation');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A navigator with a fixed hunk count that records the directions it saw. */
function fakeNavigator(hunkCount: number, stepResult = true) {
  const steps: Array<1 | -1> = [];
  const navigator: ScmDiffNavigator = {
    hunkCount: () => hunkCount,
    step: (direction) => {
      steps.push(direction);
      return stepResult;
    }
  };
  return { navigator, steps };
}

describe('scm-diff-navigation: nothing published', () => {
  it('reports zero hunks so diffOrScmChangesOpen stays false', () => {
    expect(mod.scmDiffHunkCount()).toBe(0);
  });

  it('declines a step, which is the cue to try the editor service', () => {
    expect(mod.stepScmDiff(1)).toBe(false);
    expect(mod.stepScmDiff(-1)).toBe(false);
  });
});

describe('scm-diff-navigation: a published navigator', () => {
  it('exposes its hunk count and forwards the direction', () => {
    const { navigator, steps } = fakeNavigator(12);
    mod.registerScmDiffNavigator(navigator);

    expect(mod.scmDiffHunkCount()).toBe(12);
    expect(mod.stepScmDiff(1)).toBe(true);
    expect(mod.stepScmDiff(-1)).toBe(true);
    expect(steps).toEqual([1, -1]);
  });

  it('passes a declined step through as false rather than swallowing it', () => {
    const { navigator } = fakeNavigator(3, false);
    mod.registerScmDiffNavigator(navigator);

    // A diff that is open but has nothing to step into must not read as a
    // successful navigation, or the editor-service fall-through never runs.
    expect(mod.stepScmDiff(1)).toBe(false);
  });

  it('treats a non-boolean step result as a decline', () => {
    mod.registerScmDiffNavigator({
      hunkCount: () => 4,
      step: () => undefined as unknown as boolean
    });

    expect(mod.stepScmDiff(1)).toBe(false);
  });
});

describe('scm-diff-navigation: hunk counts that cannot be trusted', () => {
  it.each([
    ['negative', -3],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('reports zero for a %s count', (_label, count) => {
    mod.registerScmDiffNavigator({ hunkCount: () => count, step: () => true });

    // A count like this would otherwise make `diffOrScmChangesOpen` true and
    // enable Alt+F3 over a diff with nothing to walk.
    expect(mod.scmDiffHunkCount()).toBe(0);
  });

  it('floors a fractional count rather than publishing a partial hunk', () => {
    mod.registerScmDiffNavigator({ hunkCount: () => 4.9, step: () => true });

    expect(mod.scmDiffHunkCount()).toBe(4);
  });

  it('fails closed to zero when hunkCount() throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod.registerScmDiffNavigator({
      hunkCount: () => {
        throw new Error('overlay not ready');
      },
      step: () => true
    });

    expect(mod.scmDiffHunkCount()).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('propagates a throwing step so the runtime can surface it', () => {
    mod.registerScmDiffNavigator({
      hunkCount: () => 2,
      step: () => {
        throw new Error('hunk vanished mid-step');
      }
    });

    expect(() => mod.stepScmDiff(1)).toThrow('hunk vanished mid-step');
  });
});

describe('scm-diff-navigation: overlapping registrations', () => {
  it('restores the previous navigator on dispose instead of clearing it', () => {
    const first = fakeNavigator(5);
    const second = fakeNavigator(9);
    mod.registerScmDiffNavigator(first.navigator);
    const disposable = mod.registerScmDiffNavigator(second.navigator);

    expect(mod.scmDiffHunkCount()).toBe(9);

    disposable.dispose();
    expect(mod.scmDiffHunkCount()).toBe(5);
    expect(mod.stepScmDiff(1)).toBe(true);
    expect(first.steps).toEqual([1]);
  });

  it('unwinds to nothing once every registration is disposed in reverse', () => {
    const first = mod.registerScmDiffNavigator(fakeNavigator(5).navigator);
    const second = mod.registerScmDiffNavigator(fakeNavigator(9).navigator);

    second.dispose();
    first.dispose();

    expect(mod.scmDiffHunkCount()).toBe(0);
    expect(mod.stepScmDiff(1)).toBe(false);
  });

  it('ignores a second dispose of the same registration', () => {
    mod.registerScmDiffNavigator(fakeNavigator(5).navigator);
    const disposable = mod.registerScmDiffNavigator(fakeNavigator(9).navigator);

    disposable.dispose();
    disposable.dispose();

    // A double dispose that unwound twice would drop past the first navigator
    // to nothing, greying out a diff that is still open.
    expect(mod.scmDiffHunkCount()).toBe(5);
  });

  it('does not let a stale dispose clobber a newer registration', () => {
    const stale = mod.registerScmDiffNavigator(fakeNavigator(5).navigator);
    mod.registerScmDiffNavigator(fakeNavigator(9).navigator);

    stale.dispose();

    // StrictMode and a popout closing both produce out-of-order teardown; the
    // surface still on screen must keep owning the Go menu.
    expect(mod.scmDiffHunkCount()).toBe(9);
  });
});

describe('scm-diff-navigation: notifications', () => {
  it('notifies on register and on dispose, so the Go menu re-resolves', () => {
    const listener = vi.fn();
    mod.subscribeScmDiffNavigation(listener);

    const disposable = mod.registerScmDiffNavigator(fakeNavigator(7).navigator);
    expect(listener).toHaveBeenCalledTimes(1);

    disposable.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = mod.subscribeScmDiffNavigation(listener);
    unsubscribe();

    mod.registerScmDiffNavigator(fakeNavigator(7).navigator);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying other listeners when one throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const survivor = vi.fn();
    mod.subscribeScmDiffNavigation(() => {
      throw new Error('listener bug');
    });
    mod.subscribeScmDiffNavigation(survivor);

    mod.registerScmDiffNavigator(fakeNavigator(7).navigator);

    // One surface's broken refresh must not grey out the Go menu for the rest.
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('tolerates a listener that unsubscribes itself during the emit', () => {
    const calls = vi.fn();
    let unsubscribe: (() => void) | undefined;
    unsubscribe = mod.subscribeScmDiffNavigation(() => {
      calls();
      unsubscribe?.();
    });

    mod.registerScmDiffNavigator(fakeNavigator(7).navigator);

    // `emit()` iterates a copy, so mutating the set mid-emit cannot skip or
    // double-fire the remaining listeners.
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
