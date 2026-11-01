/**
 * Session migration tests — no Electron, in-memory FS, injected fake store.
 *
 * The load-bearing guarantees:
 *  1. IN-FLIGHT PRESERVATION GATES EVERYTHING. If captureLiveSession throws, the
 *     migration aborts, nothing is imported, and — critically — NO legacy file is
 *     quarantined, so the legacy writers keep serving the live session.
 *  2. Legacy agent + chat records are imported and their originals MOVED (never
 *     deleted) into quarantine.
 *  3. Idempotent: a second run with the journal `done` imports nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const memfs = vi.hoisted(() => ({ files: new Map<string, string>() }));

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
    async readdir(dir: string, options?: { withFileTypes?: boolean }) {
      const prefix = String(dir).replace(/\\/g, '/') + '/';
      const names = new Set<string>();
      for (const key of memfs.files.keys()) {
        const norm = key.replace(/\\/g, '/');
        if (norm.startsWith(prefix)) {
          const rest = norm.slice(prefix.length);
          if (rest && !rest.includes('/')) names.add(rest);
        }
      }
      if (options?.withFileTypes) {
        return [...names].map((name) => ({ name, isFile: () => true, isDirectory: () => false }));
      }
      return [...names];
    },
    async unlink(p: string) {
      if (!memfs.files.has(String(p))) throw new Error('ENOENT');
      memfs.files.delete(String(p));
    },
    async rm() {
      return undefined;
    },
    async access(p: string) {
      if (!memfs.files.has(String(p))) throw new Error('ENOENT');
      return undefined;
    },
    async stat() {
      return { mtimeMs: Date.now() };
    }
  }
}));

// Neutralize the crypto chain so importing the store does not pull in Electron.
vi.mock('./session-crypto', () => ({
  isEncryptionAvailable: () => true,
  encryptJson: (obj: unknown) => 'enc:' + JSON.stringify(obj),
  decryptPayload: <T,>(payload: string) => ({ ok: true, data: JSON.parse(String(payload).slice(4)) as T })
}));

import { runSessionMigration, type MigrationDeps } from './session-migration';
import type { SessionPayload } from '../../../shared/types/session-envelope';

const SESSIONS_ROOT = path.join(os.homedir(), '.tycode', 'sessions');
const WS = '/tmp/tycode-mig-ws';

function legacyAgent(sessionId: string, todos: unknown[]): void {
  memfs.files.set(
    path.join(SESSIONS_ROOT, `${sessionId}.json`),
    JSON.stringify({ sessionId, workspacePath: WS, mode: 'execute', todos, iterationCount: 4, recentToolCalls: [], createdAt: 1, updatedAt: 2 })
  );
}

function makeFakeStore(): { store: { importSession: (ws: string, p: SessionPayload) => Promise<void> }; imported: SessionPayload[] } {
  const imported: SessionPayload[] = [];
  return {
    imported,
    store: {
      importSession: async (_ws: string, p: SessionPayload) => {
        imported.push(p);
      }
    }
  };
}

beforeEach(() => {
  memfs.files.clear();
});

describe('session migration', () => {
  it('ABORTS and quarantines nothing when in-flight capture throws', async () => {
    legacyAgent('sess_live', [{ id: 'a' }, { id: 'b' }]);
    const { store, imported } = makeFakeStore();
    const deps: MigrationDeps = {
      store: store as never,
      workspaceRoot: WS,
      getActiveSessionId: () => 'sess_live',
      captureLiveSession: async () => {
        throw new Error('live agent memory unreachable');
      }
    };
    const result = await runSessionMigration(deps);
    expect(result.aborted).toBe(true);
    expect(imported.length).toBe(0);
    // The legacy original must STILL be present (not quarantined) so it can retry.
    expect(memfs.files.has(path.join(SESSIONS_ROOT, 'sess_live.json'))).toBe(true);
  });

  it('imports legacy agent records and quarantines the originals', async () => {
    legacyAgent('sess_1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { store, imported } = makeFakeStore();
    const deps: MigrationDeps = {
      store: store as never,
      workspaceRoot: WS,
      getActiveSessionId: () => null,
      captureLiveSession: async () => null
    };
    const result = await runSessionMigration(deps);
    expect(result.aborted).toBe(false);
    expect(result.imported).toBe(1);
    expect(imported[0].todos.length).toBe(3); // todos survive verbatim
    // Original moved out of the flat dir into quarantine.
    expect(memfs.files.has(path.join(SESSIONS_ROOT, 'sess_1.json'))).toBe(false);
    expect([...memfs.files.keys()].some((k) => k.includes('quarantine') && k.includes('sess_1'))).toBe(true);
  });

  it('is idempotent: a done journal imports nothing on re-run', async () => {
    legacyAgent('sess_2', [{ id: 'x' }]);
    const first = makeFakeStore();
    const baseDeps = (store: unknown): MigrationDeps => ({
      store: store as never,
      workspaceRoot: WS,
      getActiveSessionId: () => null,
      captureLiveSession: async () => null
    });
    await runSessionMigration(baseDeps(first.store));
    // Second run over an already-quarantined (empty) legacy set.
    const second = makeFakeStore();
    const result = await runSessionMigration(baseDeps(second.store));
    expect(result.imported).toBe(0);
  });
});
