import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export type WorkspaceSurfaceId = 'editor' | 'context' | 'debugger' | 'canvas';

export interface WorkspaceSurfacePresence {
  attached: boolean;
  lastActive: number;
}

export interface WorkspaceSessionState {
  rootPath: string | null;
  openedAt: number | null;
  surfaces: Record<WorkspaceSurfaceId, WorkspaceSurfacePresence>;
}

export type WorkspaceSessionChannel =
  | 'workspace:opened'
  | 'workspace:changed'
  | 'workspace:closed'
  | 'workspace:session-updated';

export const WorkspaceSurfaceIdSchema = z.enum(['editor', 'context', 'debugger', 'canvas']);

export const WorkspaceRootValueSchema = z
  .string()
  .trim()
  .min(1, 'Workspace root path cannot be empty.')
  .max(4096, 'Workspace root path exceeds the 4096 character limit.');

export const WorkspaceSurfacePresenceSchema = z
  .object({
    attached: z.boolean(),
    lastActive: z.number().int().nonnegative()
  })
  .strict();

export const WorkspaceSessionStateSchema = z
  .object({
    rootPath: z.string().max(4096).nullable(),
    openedAt: z.number().int().nonnegative().nullable(),
    surfaces: z
      .object({
        editor: WorkspaceSurfacePresenceSchema,
        context: WorkspaceSurfacePresenceSchema,
        debugger: WorkspaceSurfacePresenceSchema,
        canvas: WorkspaceSurfacePresenceSchema
      })
      .strict()
  })
  .strict();

export const WorkspaceSessionSetRootPayloadSchema = z
  .object({ rootPath: WorkspaceRootValueSchema })
  .strict();

export const WorkspaceSessionSurfacePayloadSchema = z
  .object({ id: WorkspaceSurfaceIdSchema })
  .strict();

export type BroadcastFn = (channel: WorkspaceSessionChannel, payload: WorkspaceSessionState) => void;

export interface WorkspaceSessionManagerOptions {
  stateFilePath?: string;
  broadcast?: BroadcastFn;
  now?: () => number;
}

function buildDetachedSurfaces(nowMs: number): Record<WorkspaceSurfaceId, WorkspaceSurfacePresence> {
  const create = (): WorkspaceSurfacePresence => ({ attached: false, lastActive: nowMs });
  return { editor: create(), context: create(), debugger: create(), canvas: create() };
}

export class WorkspaceSessionManager {
  private statePath: string | null;
  private broadcastFn: BroadcastFn | null;
  private clock: () => number;
  private state: WorkspaceSessionState;

  constructor(options: WorkspaceSessionManagerOptions = {}) {
    this.statePath = options.stateFilePath ?? null;
    this.broadcastFn = options.broadcast ?? null;
    this.clock = options.now ?? (() => Date.now());
    this.state = { rootPath: null, openedAt: null, surfaces: buildDetachedSurfaces(this.clock()) };
    if (this.statePath) this.loadFromDisk();
  }

  getSession(): WorkspaceSessionState {
    const surfacesCopy = { ...this.state.surfaces };
    for (const key of Object.keys(surfacesCopy) as WorkspaceSurfaceId[]) {
      surfacesCopy[key] = { ...surfacesCopy[key] };
    }
    return { rootPath: this.state.rootPath, openedAt: this.state.openedAt, surfaces: surfacesCopy };
  }

  setActiveWorkspace(rootPath: string): WorkspaceSessionState {
    const parsed = WorkspaceRootValueSchema.safeParse(rootPath);
    if (!parsed.success) {
      throw new Error(`Workspace root failed validation: ${parsed.error.issues[0]?.message || 'invalid path'}`);
    }
    const root = parsed.data;
    const previous = this.state.rootPath;
    if (previous === root) {
      this.broadcastSession('workspace:session-updated', this.getSession());
      return this.getSession();
    }
    this.state = { rootPath: root, openedAt: this.clock(), surfaces: this.state.surfaces };
    this.persist();
    this.evictOrphanedRootCaches(previous);
    this.broadcastSession(previous === null ? 'workspace:opened' : 'workspace:changed', this.getSession());
    return this.getSession();
  }

  attachSurface(id: WorkspaceSurfaceId): WorkspaceSessionState {
    return this.applySurfacePresence(id, true);
  }

  detachSurface(id: WorkspaceSurfaceId): WorkspaceSessionState {
    return this.applySurfacePresence(id, false);
  }

  closeSession(): WorkspaceSessionState {
    if (this.state.rootPath === null && this.state.openedAt === null) {
      return this.getSession();
    }
    const previousRoot = this.state.rootPath;
    this.state = { rootPath: null, openedAt: null, surfaces: this.state.surfaces };
    this.persist();
    this.evictOrphanedRootCaches(previousRoot);
    this.broadcastSession('workspace:closed', this.getSession());
    return this.getSession();
  }

  private applySurfacePresence(id: WorkspaceSurfaceId, attached: boolean): WorkspaceSessionState {
    const current = this.state.surfaces[id];
    if (current.attached !== attached) {
      this.state = {
        rootPath: this.state.rootPath,
        openedAt: this.state.openedAt,
        surfaces: { ...this.state.surfaces, [id]: { attached, lastActive: this.clock() } }
      };
      this.persist();
      this.broadcastSession('workspace:session-updated', this.getSession());
      return this.getSession();
    }
    if (attached && current.lastActive !== this.clock()) {
      this.state.surfaces[id] = { ...current, lastActive: this.clock() };
      this.persist();
    }
    return this.getSession();
  }

  private broadcastSession(channel: WorkspaceSessionChannel, payload: WorkspaceSessionState): void {
    const validated = WorkspaceSessionStateSchema.safeParse(payload);
    if (!validated.success) return;
    if (this.broadcastFn) {
      this.broadcastFn(channel, validated.data as WorkspaceSessionState);
      return;
    }
    void import('electron')
      .then(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(channel, validated.data);
          }
        }
      })
      .catch(() => {});
  }

  private persist(): void {
    if (!this.statePath) return;
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      const payload = WorkspaceSessionStateSchema.parse(this.state);
      const tmpPath = `${this.statePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.statePath);
    } catch {
      // Persistence is best-effort; the in-memory session stays authoritative.
    }
  }

  private loadFromDisk(): void {
    if (!this.statePath) return;
    const restored = { rootPath: null as string | null, openedAt: null as number | null };
    try {
      if (!fs.existsSync(this.statePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      const parsed = z
        .object({
          rootPath: z.string().max(4096).nullable(),
          openedAt: z.number().int().nonnegative().nullable()
        })
        .strict()
        .safeParse({ rootPath: raw?.rootPath ?? null, openedAt: raw?.openedAt ?? null });
      if (!parsed.success) return;
      restored.rootPath = parsed.data.rootPath;
      restored.openedAt = parsed.data.openedAt;
    } catch {
      // Corrupt session file: start with a clean session below.
    } finally {
      this.state = { rootPath: restored.rootPath, openedAt: restored.openedAt, surfaces: buildDetachedSurfaces(this.clock()) };
    }
  }

  private evictOrphanedRootCaches(previous: string | null): void {
    if (!previous) return;
    void import('./context-engine/workspace-scanner')
      .then((m) => m.clearWorkspaceProfileCache())
      .catch(() => {});
    void import('./context-engine/design-system-extractor')
      .then((m) => m.clearDesignProfileCache())
      .catch(() => {});
  }
}

let defaultManager: WorkspaceSessionManager | null = null;

export function getWorkspaceSessionManager(): WorkspaceSessionManager {
  if (!defaultManager) {
    defaultManager = new WorkspaceSessionManager({
      stateFilePath: path.join(os.homedir(), '.tycode', 'session.json')
    });
  }
  return defaultManager;
}

export function resetWorkspaceSessionManagerForTests(): void {
  defaultManager = null;
}
