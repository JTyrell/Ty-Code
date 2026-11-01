/**
 * Breakpoint store contract tests (Prompt 5b Step 3: Run menu).
 *
 * The store owns the user's intention, so these tests are about four rules that
 * are invisible to type checking and obvious to a user the moment one breaks:
 *
 *  - **The id is derived from path + line, after normalisation.** Two windows that
 *    spell the same file differently must land on one entry. If they did not, the
 *    runtime would accept two registrations on one line and report two hits for a
 *    single stop — a debugger that appears to overshoot.
 *  - **`verified` is never set by a request.** There is no path from "the user
 *    clicked" to "the engine accepted it", not even when the click re-states an
 *    existing breakpoint. This is the exact failure the debugger feature was
 *    audited for, so the tests below assert it on every mutation path.
 *  - **The key is folded, the value is not.** A lowercase forward-slash path shown
 *    back in a panel is not the file the user has open.
 *  - **`hasBreakpoints` counts entries, not enabled ones.** Otherwise Disable All
 *    Breakpoints removes the only way back: every row gated on it disappears,
 *    including Remove All.
 *
 * Pure store: no session, no socket, no Electron.
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import type { IpcResponse } from '../../preload/types';
import { MAX_TRACKED_BREAKPOINTS, type Breakpoint } from '../../shared/types/debug-session';
import { createBreakpointStore } from './breakpoint-service';

/** `path.resolve` keeps this portable: `C:\repo` on Windows, `/repo` elsewhere. */
const ROOT = path.resolve('/repo');
const FILE_A = path.join(ROOT, 'src', 'app.js');

/**
 * The list an accepted change carried back.
 *
 * `success` and `data` are separate fields on the wire, so narrowing on one does
 * not type the other — and a test that indexed `result.data` directly would be
 * asserting against an `undefined` it never noticed.
 */
function data(result: IpcResponse<Breakpoint[]>): Breakpoint[] {
  if (!result.success || !result.data) {
    throw new Error(result.error ?? 'the store accepted the change but returned no list');
  }
  return result.data;
}

/** Ask for a breakpoint the way the gutter does. */
function addLine(store: ReturnType<typeof createBreakpointStore>, filePath: string, lineNumber: number): Breakpoint[] {
  return data(store.add({ filePath, lineNumber, kind: 'unconditional' }));
}

describe('breakpoint store (Prompt 5b Step 3)', () => {
  describe('the derived id', () => {
    it('folds two spellings of one line onto one entry, so the second toggle removes it', () => {
      const store = createBreakpointStore();
      // Same file, differently spelled: a `..` segment and a different case in a
      // directory name. Normalisation has to converge both before the runtime ever
      // sees a request.
      const otherSpelling = path.join(ROOT, 'SRC', 'nested', '..', 'app.js');
      expect(addLine(store, FILE_A, 4)).toHaveLength(1);

      const toggled = store.toggle({ filePath: otherSpelling, lineNumber: 4 });
      expect(toggled.success).toBe(true);
      expect(toggled.data).toHaveLength(0);
      expect(store.hasBreakpoints()).toBe(false);
    });

    it('keeps two lines of one file apart', () => {
      const store = createBreakpointStore();
      addLine(store, FILE_A, 4);
      expect(addLine(store, FILE_A, 9)).toHaveLength(2);
    });

    it('shows the path the user typed while keying it folded', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, path.join(ROOT, 'SRC', 'app.js'), 2);
      // The value keeps the spelling; only the key is folded.
      expect(bp.filePath).toContain(path.join('SRC', 'app.js'));
      expect(path.isAbsolute(bp.filePath)).toBe(true);
      expect(bp.id).toBe(bp.id.toLowerCase());
      expect(bp.id).toContain(':2');
    });
  });

  describe('what a request may never do', () => {
    it('leaves a brand-new breakpoint unverified', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      expect(bp.verified).toBeUndefined();
      expect(bp.note).toBeUndefined();
    });

    it('does not carry an old verification onto a record that replaces it', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      store.verify(bp.id, true);
      expect(store.list()[0].verified).toBe(true);

      // Re-stating the same line is a new request, not evidence about a binding the
      // runtime never saw in this form.
      addLine(store, FILE_A, 4);
      expect(store.list()[0].verified).toBeUndefined();
      expect(store.list()[0].note).toBeUndefined();
    });

    it('refuses a conditional breakpoint with nothing to evaluate, in its own words', () => {
      const store = createBreakpointStore();
      const result = store.add({ filePath: FILE_A, lineNumber: 4, kind: 'conditional', condition: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('A conditional breakpoint needs a condition to evaluate.');
      expect(store.list()).toHaveLength(0);
    });

    it('refuses a logpoint with nothing to print', () => {
      const store = createBreakpointStore();
      const result = store.add({ filePath: FILE_A, lineNumber: 4, kind: 'logpoint' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('A logpoint needs a message to print.');
    });

    it('lets the kind decide which field survives, rather than half-honouring both', () => {
      const store = createBreakpointStore();
      // A logpoint that also carries a condition is contradictory: a logpoint does
      // not pause, so it cannot also be a break that sometimes pauses.
      const result = store.add({
        filePath: FILE_A,
        lineNumber: 4,
        kind: 'logpoint',
        logMessage: 'i={i}',
        condition: 'i > 3'
      });
      expect(result.success).toBe(true);
      expect(data(result)[0].logMessage).toBe('i={i}');
      expect(data(result)[0].condition).toBeUndefined();
    });

    it('refuses a payload the contract rejects and says it failed validation', () => {
      const store = createBreakpointStore();
      const result = store.add({ filePath: '', lineNumber: 0, kind: 'telepathic' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('failed validation');
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('enable, disable, remove', () => {
    it('removing something already gone is a success, not an error', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      store.remove({ id: bp.id });
      // Two windows clicking the same dot is the common case; the caller's goal —
      // no dot on that line — is already satisfied.
      const again = store.remove({ id: bp.id });
      expect(again.success).toBe(true);
      expect(again.data).toHaveLength(0);
    });

    it('keeps the runtime answer when everything is disabled, because the binding still exists', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      store.verify(bp.id, true);
      const result = store.setAllEnabled({ enabled: false });
      expect(result.success).toBe(true);
      expect(data(result)[0]).toMatchObject({ enabled: false, verified: true });
    });

    it('cannot invent a verification by re-enabling', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      store.verify(bp.id, false, 'The script was never parsed.');
      store.setAllEnabled({ enabled: false });
      const result = store.setAllEnabled({ enabled: true });
      expect(data(result)[0]).toMatchObject({ enabled: true, verified: false });
      expect(data(result)[0].note).toBe('The script was never parsed.');
    });

    it('answers for an empty set instead of failing', () => {
      const store = createBreakpointStore();
      const result = store.setAllEnabled({ enabled: true });
      expect(result).toEqual({ success: true, data: [] });
    });

    it('counts disabled entries when deciding whether the rows apply', () => {
      const store = createBreakpointStore();
      addLine(store, FILE_A, 4);
      store.setAllEnabled({ enabled: false });
      // Reaching false here would hide Remove All Breakpoints behind the very
      // action that emptied the menu of everything else.
      expect(store.hasBreakpoints()).toBe(true);
      expect(store.removeAll().data).toHaveLength(0);
      expect(store.hasBreakpoints()).toBe(false);
    });
  });

  describe('the workspace changing', () => {
    it('drops the dots belonging to this folder and leaves a file from outside it alone', () => {
      const store = createBreakpointStore();
      addLine(store, path.join(ROOT, 'src', 'app.js'), 4);
      addLine(store, path.join(ROOT, 'other.js'), 8);
      const outside = path.resolve(path.join(ROOT, '..', 'elsewhere', 'main.js'));
      addLine(store, outside, 1);

      store.clearWorkspace(ROOT);

      const left = store.list();
      // A file the user opened from outside the workspace is not this workspace's
      // to lose.
      expect(left).toHaveLength(1);
      expect(left[0].filePath).toBe(outside);
    });

    it('does nothing at all when no folder is open', () => {
      const store = createBreakpointStore();
      addLine(store, FILE_A, 4);
      store.clearWorkspace(null);
      expect(store.list()).toHaveLength(1);
    });
  });

  describe('the cap', () => {
    it('refuses one more breakpoint than it can hand to the runtime', () => {
      const store = createBreakpointStore();
      for (let line = 1; line <= MAX_TRACKED_BREAKPOINTS; line += 1) {
        addLine(store, FILE_A, line);
      }
      expect(store.list()).toHaveLength(MAX_TRACKED_BREAKPOINTS);

      const result = store.add({ filePath: FILE_A, lineNumber: MAX_TRACKED_BREAKPOINTS + 1, kind: 'unconditional' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        `${MAX_TRACKED_BREAKPOINTS} breakpoints are already set. Remove one before adding another.`
      );
      // Refusing the extra one must not disturb the ones it already holds.
      expect(store.list()).toHaveLength(MAX_TRACKED_BREAKPOINTS);
    });

    it('still lets an existing line be edited while the set is full', () => {
      const store = createBreakpointStore();
      for (let line = 1; line <= MAX_TRACKED_BREAKPOINTS; line += 1) {
        addLine(store, FILE_A, line);
      }
      // The cap is on entries, not on requests: replacing a full-set breakpoint is
      // not what the warning is about.
      const result = store.add({
        filePath: FILE_A,
        lineNumber: 7,
        kind: 'conditional',
        condition: 'ready'
      });
      expect(result.success).toBe(true);
      expect(data(result)).toHaveLength(MAX_TRACKED_BREAKPOINTS);
    });
  });

  describe('observers', () => {
    it('publishes once per accepted change and stops when unsubscribed', () => {
      const store = createBreakpointStore();
      const seen: number[] = [];
      const off = store.subscribe((list) => seen.push(list.length));
      addLine(store, FILE_A, 4);
      expect(seen).toEqual([1]);
      off();
      addLine(store, FILE_A, 9);
      expect(seen).toEqual([1]);
    });

    it('does not let one throwing observer starve the next', () => {
      const store = createBreakpointStore();
      const seen: number[] = [];
      store.subscribe(() => {
        throw new Error('a bad panel');
      });
      store.subscribe((list) => seen.push(list.length));
      expect(() => addLine(store, FILE_A, 4)).not.toThrow();
      expect(seen).toEqual([1]);
    });

    it('ignores an answer about a breakpoint the user already removed', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      store.remove({ id: bp.id });
      // The session can answer for a dot that vanished mid-flight. Failing a menu
      // action over that race would be worse than the race itself.
      expect(() => store.verify(bp.id, true)).not.toThrow();
      expect(store.list()).toHaveLength(0);
    });

    it('stays quiet when a repeated answer changes nothing', () => {
      const store = createBreakpointStore();
      const [bp] = addLine(store, FILE_A, 4);
      const seen: number[] = [];
      store.subscribe((list) => seen.push(list.length));
      store.verify(bp.id, true);
      store.verify(bp.id, true);
      expect(seen).toEqual([1]);
      store.clearVerifications();
      expect(seen).toHaveLength(2);
      store.clearVerifications();
      expect(seen).toHaveLength(2);
    });
  });

  describe('shutdown', () => {
    it('empties the store and refuses every further edit', () => {
      const store = createBreakpointStore();
      addLine(store, FILE_A, 4);
      const seen: number[] = [];
      store.subscribe(() => seen.push(1));
      store.dispose();
      expect(store.list()).toHaveLength(0);
      expect(store.add({ filePath: FILE_A, lineNumber: 8, kind: 'unconditional' }).error).toContain('shut down');
      expect(store.toggle({ filePath: FILE_A, lineNumber: 8 }).error).toContain('shut down');
      expect(store.remove({ id: 'anything' }).error).toContain('shut down');
      expect(store.setAllEnabled({ enabled: false }).error).toContain('shut down');
      expect(store.removeAll().error).toContain('shut down');
      expect(store.hasBreakpoints()).toBe(false);
      // A detached observer list means nothing can be published, so the subscriber
      // that was still registered hears no more.
      expect(seen).toHaveLength(0);
    });

    it('is idempotent, so a second shutdown publishes nothing to anyone', () => {
      const store = createBreakpointStore();
      addLine(store, FILE_A, 4);
      const seen: number[] = [];
      store.subscribe(() => seen.push(1));
      store.dispose();
      expect(() => {
        store.dispose();
        store.clearWorkspace(ROOT);
        store.clearVerifications();
        store.verify('a:1', true);
      }).not.toThrow();
      expect(seen).toHaveLength(0);
    });
  });
});
