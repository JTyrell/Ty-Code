/**
 * Unified session store tests — no Electron. We mock `session-crypto` (a
 * base64 stand-in for safeStorage) and `node:fs/promises` (an in-memory FS) so
 * the assertions are about the store's CONTRACT, not the OS keystore:
 *
 *  - listing NEVER decrypts (the invariant the history browser relies on),
 *  - a write is REFUSED when secure storage is unavailable (no plaintext ever),
 *  - an encrypted round-trip preserves todos + agent runtime state,
 *  - debounced saves land on flush.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory filesystem shared by the mock and the tests.
const memfs = vi.hoisted(() => ({ files: new Map<string, string>() }));
// Toggle for the availability of the fake secure storage.
const cryptoState = vi.hoisted(() => ({ available: true, decrypts: 0 }));

vi.mock('node:fs/promises', () => ({
  default: {
    async mkdir() {
      return undefined;
    },
    async writeFile(p: string, contents: string) {
      memfs.files.set(String(p), contents);
    },
    async rename(oldP: string, newP: string) {
      const data = memfs.files.get(String(oldP));
      if (data === undefined) throw new Error('ENOENT');
      memfs.files.set(String(newP), data);
      memfs.files.delete(String(oldP));
    },
    async readFile(p: string) {
      const data = memfs.files.get(String(p));
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return data;
    },
    async readdir(dir: string) {
      const prefix = String(dir).replace(/\\/g, '/') + '/';
      const names = new Set<string>();
      for (const key of memfs.files.keys()) {
        const norm = key.replace(/\\/g, '/');
        if (norm.startsWith(prefix)) {
          const rest = norm.slice(prefix.length);
          if (rest && !rest.includes('/')) names.add(rest);
        }
      }
      return [...names];
    },
    async unlink(p: string) {
      if (!memfs.files.has(String(p))) throw new Error('ENOENT');
      memfs.files.delete(String(p));
    },
    async access() {
      return undefined;
    }
  }
}));

vi.mock('./session-crypto', () => ({
  isEncryptionAvailable: () => cryptoState.available,
  encryptJson: (obj: unknown) => {
    if (!cryptoState.available) throw new Error('secure storage unavailable');
    return 'enc:' + Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
  },
  decryptPayload: <T,>(payload: string) => {
    if (!cryptoState.available) return { ok: false, reason: 'unavailable' as const };
    if (typeof payload !== 'string' || !payload.startsWith('enc:')) return { ok: false, reason: 'dpapi-mismatch' as const };
    cryptoState.decrypts++;
    try {
      return { ok: true, data: JSON.parse(Buffer.from(payload.slice(4), 'base64').toString('utf-8')) as T };
    } catch {
      return { ok: false, reason: 'dpapi-mismatch' as const };
    }
  }
}));

// Import AFTER mocks are registered.
import { UnifiedSessionStore } from './unified-session-store';

const WS = '/tmp/tycode-ws-test';

function freshStore(): UnifiedSessionStore {
  memfs.files.clear();
  cryptoState.available = true;
  cryptoState.decrypts = 0;
  return new UnifiedSessionStore();
}

describe('unified session store', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('lists sidecars WITHOUT a single decrypt', async () => {
    const store = freshStore();
    await store.createSession(WS, { title: 'Alpha' });
    await store.createSession(WS, { title: 'Beta' });
    const before = cryptoState.decrypts;
    const sidecars = await store.listSidecars(WS);
    expect(sidecars.length).toBe(2);
    expect(sidecars.every((s) => typeof s.title === 'string')).toBe(true);
    expect(cryptoState.decrypts).toBe(before); // zero new decrypts
    expect(store.getDecryptionCount()).toBe(0);
  });

  it('refuses to persist when secure storage is unavailable (no plaintext)', async () => {
    const store = freshStore();
    cryptoState.available = false;
    await expect(store.createSession(WS, { title: 'Secret' })).rejects.toThrow(/secure storage unavailable/);
    expect(store.getWriteFailureCount()).toBeGreaterThan(0);
    // Nothing landed on disk.
    expect([...memfs.files.keys()].some((k) => k.endsWith('.json'))).toBe(false);
  });

  it('round-trips an encrypted payload preserving todos + agent state', async () => {
    const store = freshStore();
    const created = await store.createSession(WS, { title: 'Task', agentMode: 'execute' });
    created.todos = [{ id: 't1', content: 'step', status: 'pending' }] as unknown as typeof created.todos;
    created.agentIterationCount = 3;
    created.completionContract = { originalObjective: 'ship it' };
    await store.writeNow(WS, created);

    // Fresh store instance → forces a decrypt on open (no RAM cache carryover).
    const reader = freshStoreNoClear();
    const opened = await reader.secureOpen(WS, created.sessionId);
    expect(opened).toBeTruthy();
    expect(opened && 'payload' in opened && !opened.locked).toBe(true);
    if (opened && !opened.locked) {
      expect(opened.payload.todos.length).toBe(1);
      expect(opened.payload.agentIterationCount).toBe(3);
      expect(opened.payload.completionContract?.originalObjective).toBe('ship it');
    }
    expect(reader.getDecryptionCount()).toBe(1);
  });

  it('flushes a debounced save on exit', async () => {
    const store = freshStore();
    const created = await store.createSession(WS, { title: 'Debounced' });
    const modified = { ...created, title: 'Renamed In Memory' };
    store.saveSession(WS, modified); // schedules a write ~800ms out
    await store.flushOnExit();
    const opened = await store.secureOpen(WS, created.sessionId);
    if (opened && !opened.locked) expect(opened.payload.title).toBe('Renamed In Memory');
  });
});

// A reader that reuses the SAME in-memory files but a fresh cache/counter.
function freshStoreNoClear(): UnifiedSessionStore {
  cryptoState.decrypts = 0;
  const s = new UnifiedSessionStore();
  return s;
}
