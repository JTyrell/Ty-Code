// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLibraryBookmarks,
  toggleFavorite,
  recordRecent,
  subscribeLibraryBookmarks
} from './canvas-library-store';

/**
 * Prompt 4 Step 1 — library bookmarks store. Favorites + recents persist PER
 * WORKSPACE under a single flat id space, so a project component's name (e.g.
 * "Button") and a primitive's type (e.g. "container") — the TWO library groups —
 * share the same star / recent machinery.
 */

const keyFor = (workspaceId: string): string => `tycode.canvas.library::${workspaceId}`;
const MAX = 8;

beforeEach(() => {
  localStorage.clear();
});

describe('library favorites', () => {
  it('adds to the front and toggles off, persisting to storage', () => {
    toggleFavorite('ws-1', 'Button');
    toggleFavorite('ws-1', 'container');
    expect(getLibraryBookmarks('ws-1').favorites).toEqual(['container', 'Button']);
    toggleFavorite('ws-1', 'Button');
    expect(getLibraryBookmarks('ws-1').favorites).toEqual(['container']);
    expect(JSON.parse(localStorage.getItem(keyFor('ws-1')) ?? '{}').favorites).toEqual(['container']);
  });

  it('scopes bookmarks per workspace', () => {
    toggleFavorite('ws-a', 'Button');
    expect(getLibraryBookmarks('ws-b').favorites).toEqual([]);
  });
});

describe('library recents', () => {
  it('de-dups and moves the reused id to the front', () => {
    recordRecent('ws-2', 'card');
    recordRecent('ws-2', 'button');
    recordRecent('ws-2', 'card');
    expect(getLibraryBookmarks('ws-2').recents).toEqual(['card', 'button']);
  });

  it('caps recents at the max length', () => {
    for (let i = 0; i < MAX + 5; i++) recordRecent('ws-3', `comp-${i}`);
    expect(getLibraryBookmarks('ws-3').recents).toHaveLength(MAX);
    expect(getLibraryBookmarks('ws-3').recents[0]).toBe(`comp-${MAX + 4}`);
  });
});

describe('library subscription', () => {
  it('notifies immediately, on change, and stops after dispose', () => {
    const seen: string[][] = [];
    const unsub = subscribeLibraryBookmarks('ws-4', (b) => seen.push([...b.favorites]));
    expect(seen).toHaveLength(1);
    toggleFavorite('ws-4', 'Button');
    expect(seen[seen.length - 1]).toEqual(['Button']);
    unsub();
    toggleFavorite('ws-4', 'card');
    expect(seen[seen.length - 1]).toEqual(['Button']);
  });
});
