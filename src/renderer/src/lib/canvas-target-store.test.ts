// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCanvasTarget,
  setCanvasTarget,
  subscribeCanvasTarget
} from './canvas-target-store';

/**
 * Prompt 4 extension — export-target store (Section F). The target is persisted
 * PER DOCUMENT, decoupled from the AST platform, and syncs cross-window through
 * the same-origin `storage` event. Distinct doc ids per case avoid the module's
 * memoized per-document cache bleeding between tests.
 */

const keyFor = (docId: string): string => `tycode.canvas.target::${docId}`;

beforeEach(() => {
  localStorage.clear();
});

describe('canvas-target store persistence', () => {
  it('defaults an unseen document to react-web', () => {
    expect(getCanvasTarget('doc-default')).toBe('react-web');
  });

  it('persists the chosen target per document and reads it back', () => {
    setCanvasTarget('doc-a', 'flutter');
    expect(getCanvasTarget('doc-a')).toBe('flutter');
    expect(JSON.parse(localStorage.getItem(keyFor('doc-a')) ?? 'null')).toBe('flutter');
    // A different document is unaffected (per-document isolation).
    expect(getCanvasTarget('doc-b')).toBe('react-web');
  });

  it('coerces an unknown target id back to the default', () => {
    const next = setCanvasTarget('doc-coerce', 'not-a-target' as never);
    expect(next).toBe('react-web');
  });

  it('honours a cross-window storage event for the same document', () => {
    const seen: string[] = [];
    const unsub = subscribeCanvasTarget('doc-sync', (t) => seen.push(t));
    // Another window wrote flutter; emulate the same-origin storage event.
    localStorage.setItem(keyFor('doc-sync'), JSON.stringify('flutter'));
    window.dispatchEvent(new StorageEvent('storage', { key: keyFor('doc-sync'), newValue: '"flutter"' }));
    expect(seen).toContain('flutter');
    unsub();
  });
});

describe('canvas-target store subscription', () => {
  it('fires immediately, on each write, and stops after dispose', () => {
    const seen: string[] = [];
    const unsub = subscribeCanvasTarget('doc-sub', (t) => seen.push(t));
    expect(seen).toEqual(['react-web']); // immediate snapshot
    setCanvasTarget('doc-sub', 'vue');
    expect(seen[seen.length - 1]).toBe('vue');
    unsub();
    setCanvasTarget('doc-sub', 'svelte');
    expect(seen[seen.length - 1]).toBe('vue'); // no delivery after dispose
  });
});
