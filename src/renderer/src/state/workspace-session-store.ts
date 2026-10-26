import { create } from 'zustand';
import { z } from 'zod';
import type { WorkspaceSurfaceId } from '../../../preload/types';

export type WorkspaceSurfacePresence = {
  attached: boolean;
  lastActive: number;
};

export type WorkspaceSessionSnapshot = {
  rootPath: string | null;
  openedAt: number | null;
  surfaces: Record<WorkspaceSurfaceId, WorkspaceSurfacePresence>;
};

export type WorkspaceSessionEvent = {
  channel:
    | 'workspace:opened'
    | 'workspace:changed'
    | 'workspace:closed'
    | 'workspace:session-updated';
  session: WorkspaceSessionSnapshot;
};

const initialState: WorkspaceSessionSnapshot = {
  rootPath: null,
  openedAt: null,
  surfaces: {
    editor: { attached: false, lastActive: 0 },
    context: { attached: false, lastActive: 0 },
    debugger: { attached: false, lastActive: 0 },
    canvas: { attached: false, lastActive: 0 }
  }
};

const WorkspaceSessionSchema = z.object({
  rootPath: z.string().max(4096).nullable(),
  openedAt: z.number().int().nonnegative().nullable(),
  surfaces: z
    .object({
      editor: z.object({ attached: z.boolean(), lastActive: z.number().int() }).strict(),
      context: z.object({ attached: z.boolean(), lastActive: z.number().int() }).strict(),
      debugger: z.object({ attached: z.boolean(), lastActive: z.number().int() }).strict(),
      canvas: z.object({ attached: z.boolean(), lastActive: z.number().int() }).strict()
    })
    .strict()
});

function parseSession(raw: unknown): WorkspaceSessionSnapshot {
  const validated = WorkspaceSessionSchema.safeParse(raw);
  if (!validated.success) return initialState;
  return {
    rootPath: validated.data.rootPath,
    openedAt: validated.data.openedAt,
    surfaces: {
      editor: validated.data.surfaces.editor,
      context: validated.data.surfaces.context,
      debugger: validated.data.surfaces.debugger,
      canvas: validated.data.surfaces.canvas
    }
  };
}

// The preload bridge surface relevant to the session bus. Typed loosely because
// electronAPI members are optional and spread across the bridge declaration.
interface SessionBridge {
  getWorkspaceSession?: () => Promise<{ success?: boolean; data?: unknown }>;
  onWorkspaceSession?: (cb: (event: WorkspaceSessionEvent) => void) => () => void;
  attachSessionSurface?: (id: WorkspaceSurfaceId) => Promise<{ success?: boolean; data?: unknown }>;
  detachSessionSurface?: (id: WorkspaceSurfaceId) => Promise<{ success?: boolean; data?: unknown }>;
  closeSessionWorkspace?: () => Promise<{ success?: boolean; data?: unknown }>;
}

function getSessionBridge(): SessionBridge | undefined {
  try {
    return (window as unknown as { electronAPI?: SessionBridge }).electronAPI;
  } catch {
    return undefined;
  }
}

interface WorkspaceSessionStoreState {
  session: WorkspaceSessionSnapshot;
  setSession: (session: WorkspaceSessionSnapshot) => void;
  attachSurface: (id: WorkspaceSurfaceId) => void;
  detachSurface: (id: WorkspaceSurfaceId) => void;
  closeSession: () => void;
}

function applyResponse(res: { success?: boolean; data?: unknown } | undefined): void {
  if (res?.success && res.data !== undefined && res.data !== null) {
    useWorkspaceSessionStore.setState({ session: parseSession(res.data) });
  }
}

export const useWorkspaceSessionStore = create<WorkspaceSessionStoreState>((set) => ({
  session: initialState,
  setSession: (session: WorkspaceSessionSnapshot) => set({ session }),
  attachSurface: (id: WorkspaceSurfaceId) => {
    set((state) => {
      const surfaces = { ...state.session.surfaces };
      surfaces[id] = { attached: true, lastActive: Date.now() };
      return { session: { ...state.session, surfaces } };
    });
    const api = getSessionBridge();
    if (api?.attachSessionSurface) {
      api
        .attachSessionSurface(id)
        .then(applyResponse)
        .catch(() => {
          /* optimistic local presence stands until next broadcast */
        });
    }
  },
  detachSurface: (id: WorkspaceSurfaceId) => {
    set((state) => {
      const surfaces = { ...state.session.surfaces };
      surfaces[id] = { attached: false, lastActive: state.session.surfaces[id].lastActive };
      return { session: { ...state.session, surfaces } };
    });
    const api = getSessionBridge();
    if (api?.detachSessionSurface) {
      api
        .detachSessionSurface(id)
        .then(applyResponse)
        .catch(() => {
          /* optimistic local presence stands until next broadcast */
        });
    }
  },
  closeSession: () => {
    set({
      session: {
        rootPath: null,
        openedAt: null,
        surfaces: {
          editor: { attached: false, lastActive: 0 },
          context: { attached: false, lastActive: 0 },
          debugger: { attached: false, lastActive: 0 },
          canvas: { attached: false, lastActive: 0 }
        }
      }
    });
    const api = getSessionBridge();
    if (api?.closeSessionWorkspace) {
      api
        .closeSessionWorkspace()
        .then(applyResponse)
        .catch(() => {
          /* tolerated */
        });
    }
  }
}));

// Listener dispatcher — subscribes to the multiplexed workspace session channel
// exposed by preload, then hydrates the local snapshot from the main process.
export function initWorkspaceSessionSync(): () => void {
  const api = getSessionBridge();
  if (!api?.onWorkspaceSession) return () => {};

  const applySnapshot = (raw: unknown): void => {
    useWorkspaceSessionStore.setState({ session: parseSession(raw) });
  };

  let disposeSession: (() => void) | undefined;
  try {
    disposeSession = api.onWorkspaceSession((event) => {
      if (event && event.session) applySnapshot(event.session);
    });
  } catch {
    /* subscription failure tolerated */
  }

  if (api.getWorkspaceSession) {
    api
      .getWorkspaceSession()
      .then(applyResponse)
      .catch(() => {
        /* hydrate failure tolerated */
      });
  }

  return () => {
    try {
      disposeSession?.();
    } catch {
      /* tolerated */
    }
  };
}
