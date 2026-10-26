import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSessionManager } from './workspace-session-manager';
import type { WorkspaceSessionChannel, WorkspaceSessionState } from './workspace-session-manager';

interface BroadcastCall {
  channel: WorkspaceSessionChannel;
  payload: WorkspaceSessionState;
}

function makeManager(opts: { stateFilePath?: string; now?: () => number } = {}): {
  manager: WorkspaceSessionManager;
  broadcasts: BroadcastCall[];
} {
  const broadcasts: BroadcastCall[] = [];
  const manager = new WorkspaceSessionManager({
    stateFilePath: opts.stateFilePath,
    now: opts.now,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload })
  });
  return { manager, broadcasts };
}

describe('WorkspaceSessionManager', () => {
  it('starts with a detached, empty session', () => {
    const { manager } = makeManager();
    const session = manager.getSession();
    expect(session.rootPath).toBeNull();
    expect(session.openedAt).toBeNull();
    for (const id of ['editor', 'context', 'debugger', 'canvas'] as const) {
      expect(session.surfaces[id]).toEqual({ attached: false, lastActive: expect.any(Number) });
    }
  });

  it('validates and rejects invalid roots', () => {
    const { manager } = makeManager();
    expect(() => manager.setActiveWorkspace('')).toThrow();
    expect(() => manager.setActiveWorkspace('   '.repeat(1500))).toThrow();
    // Session stays clean after the failed attempts.
    expect(manager.getSession().rootPath).toBeNull();
  });

  it('broadcasts workspace:opened on the first root and workspace:changed on subsequent roots', () => {
    let tick = 1000;
    const { manager, broadcasts } = makeManager({ now: () => tick });
    manager.setActiveWorkspace('C:\\repos\\alpha');
    expect(broadcasts.map((b) => b.channel)).toEqual(['workspace:opened']);
    expect(broadcasts[0].payload.rootPath).toBe('C:\\repos\\alpha');

    tick = 2000;
    manager.setActiveWorkspace('C:\\repos\\beta');
    expect(broadcasts.map((b) => b.channel)).toEqual(['workspace:opened', 'workspace:changed']);
    expect(broadcasts[1].payload.rootPath).toBe('C:\\repos\\beta');

    // Same root re-set → presence-only session update, no changed event.
    broadcasts.length = 0;
    manager.setActiveWorkspace('C:\\repos\\beta');
    expect(broadcasts.map((b) => b.channel)).toEqual(['workspace:session-updated']);
  });

  it('tracks surface attach/detach presence and persists last-activity', () => {
    let tick = 5000;
    const { manager } = makeManager({ now: () => tick });
    manager.setActiveWorkspace('C:\\repos\\gamma');
    manager.attachSurface('editor');
    tick = 6000;
    manager.attachSurface('canvas');
    const session = manager.getSession();
    expect(session.surfaces.editor).toEqual({ attached: true, lastActive: 5000 });
    expect(session.surfaces.canvas).toEqual({ attached: true, lastActive: 6000 });
    expect(session.surfaces.debugger.attached).toBe(false);

    manager.detachSurface('editor');
    const afterDetach = manager.getSession();
    expect(afterDetach.surfaces.editor.attached).toBe(false);
    // lastActive moves to the detach moment — that was the surface's last activity.
    expect(afterDetach.surfaces.editor.lastActive).toBe(6000);

    // Re-attach is idempotent for attachment state and refreshes lastActive.
    tick = 7000;
    manager.attachSurface('canvas');
    expect(manager.getSession().surfaces.canvas.lastActive).toBe(7000);
  });

  it('closeSession clears the root but keeps surface presence and emits workspace:closed', () => {
    const { manager, broadcasts } = makeManager();
    manager.setActiveWorkspace('C:\\repos\\delta');
    manager.attachSurface('context');
    broadcasts.length = 0;
    const closed = manager.closeSession();
    expect(closed.rootPath).toBeNull();
    expect(closed.openedAt).toBeNull();
    expect(closed.surfaces.context.attached).toBe(true);
    expect(broadcasts.map((b) => b.channel)).toEqual(['workspace:closed']);
  });

  it('persists the session and restores rootPath/openedAt in a new manager instance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tycode-session-'));
    const stateFilePath = join(dir, 'tycode', 'session.json');
    try {
      let tick = 4200;
      const first = makeManager({ stateFilePath, now: () => tick });
      first.manager.setActiveWorkspace('C:\\repos\\persisted');
      tick = 4300;
      first.manager.attachSurface('editor');

      // File was written (atomic temp swap collapsed into the final file).
      expect(existsSync(stateFilePath)).toBe(true);
      const onDisk = JSON.parse(readFileSync(stateFilePath, 'utf8')) as {
        rootPath?: string;
        openedAt?: number;
      };
      expect(onDisk.rootPath).toBe('C:\\repos\\persisted');
      expect(onDisk.openedAt).toBe(4200);

      // A brand-new manager loads the persisted root; surfaces always boot detached.
      const second = makeManager({ stateFilePath, now: () => 4400 });
      const restored = second.manager.getSession();
      expect(restored.openedAt).toBe(4200);
      for (const id of ['editor', 'canvas'] as const) {
        expect(restored.surfaces[id].attached).toBe(false);
      }
      expect(restored.rootPath).toBe('C:\\repos\\persisted');

      // Closing broadcasts closed + persists the cleared root.
      second.manager.closeSession();
      const cleared = JSON.parse(readFileSync(stateFilePath, 'utf8')) as { rootPath?: string };
      expect(cleared.rootPath).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts clean when the persisted file is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tycode-session-corrupt-'));
    const stateFilePath = join(dir, 'session.json');
    try {
      writeFileSync(stateFilePath, '{not json at all', 'utf8');
      const { manager } = makeManager({ stateFilePath });
      expect(manager.getSession()).toEqual({
        rootPath: null,
        openedAt: null,
        surfaces: expect.anything()
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not emit malformed payloads on the broadcast channel', () => {
    const broadcasts: BroadcastCall[] = [];
    const manager = new WorkspaceSessionManager({
      broadcast: (channel, payload) => broadcasts.push({ channel, payload })
    });
    manager.setActiveWorkspace('C:\\repos\\epsilon');
    for (const call of broadcasts) {
      expect(() => JSON.stringify(call.payload)).not.toThrow();
      expect(Object.keys(call.payload.surfaces).sort()).toEqual(['canvas', 'context', 'debugger', 'editor']);
    }
  });
});
