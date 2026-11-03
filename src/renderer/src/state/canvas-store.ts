/**
 * Canvas Store (M3E Canvas overhaul)
 *
 * Zustand store for the visual editor's component tree. Every local change is
 * debounce-pushed to the main-process CanvasSyncManager via
 * `canvas:update-state`, and remote snapshots arriving over
 * `canvas:state-synced` are applied back without re-pushing (echo-safe).
 */

import { create } from 'zustand';
import type { CanvasSnapshotData } from '../../../preload/types';

export type CanvasPlatform = 'react' | 'flutter' | 'swiftui' | 'web' | 'other';

export type CanvasPropValue = string | number | boolean;

export interface CanvasNode {
  id: string;
  type: string;
  platform: CanvasPlatform;
  props: Record<string, CanvasPropValue>;
  name?: string;
  children: CanvasNode[];
}

interface AddNodeInput {
  type: string;
  name?: string;
  props?: Record<string, CanvasPropValue>;
  parentId?: string | null;
}

interface CanvasStoreState {
  nodes: CanvasNode[];
  activePlatform: CanvasPlatform;
  selectedNodeId: string | null;
  /**
   * Full multi-select set (Prompt 3, Step 2). `selectedNodeId` stays the
   * "primary" node (last added) so the single-node Inspector keeps working;
   * `selectedNodeIds` is the ordered set the bbox / multi-inspector read.
   */
  selectedNodeIds: string[];
  /**
   * Session-only editing aids (Prompt 3, Step 4). Deliberately NOT node fields
   * and NOT part of the synced/persisted document — closing the window drops
   * them. Locked nodes are unselectable; hidden nodes render ghosted in the
   * layer tree only.
   */
  lockedIds: string[];
  hiddenIds: string[];
  hydrated: boolean;
  /** Viewport chrome + transform, persisted per document and NOT synced to main. */
  viewport: CanvasViewportPersist;

  addNode: (input: AddNodeInput) => string | null;
  updateNodeProps: (id: string, patch: Record<string, CanvasPropValue>) => void;
  removeNode: (id: string) => void;
  /**
   * Replace the whole node tree. Used by the Prompt 3 history stack, whose
   * commands are pure `nodes -> nodes` transforms: applying / inverting a
   * command is a single atomic tree swap, so undo restores the EXACT prior
   * state without replaying individual field writes.
   */
  replaceNodes: (nodes: CanvasNode[]) => void;
  setPlatform: (platform: CanvasPlatform) => void;
  clearCanvas: () => void;
  selectNode: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  selectAllTopLevel: () => void;
  toggleLock: (id: string) => void;
  toggleHide: (id: string) => void;
  applyRemoteSnapshot: (snapshot: CanvasSnapshotData, onlyIfUnhydrated?: boolean) => void;
  setViewport: (patch: Partial<CanvasViewportPersist>) => void;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export const findCanvasNode = (nodes: CanvasNode[], id: string): CanvasNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children.length > 0) {
      const hit = findCanvasNode(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
};

const updateNodeRecursive = (nodes: CanvasNode[], id: string, patch: Record<string, CanvasPropValue>): CanvasNode[] =>
  nodes.map((node) =>
    node.id === id
      ? { ...node, props: { ...node.props, ...patch } }
      : node.children.length > 0
        ? { ...node, children: updateNodeRecursive(node.children, id, patch) }
        : node
  );

const removeNodeRecursive = (nodes: CanvasNode[], id: string): CanvasNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children.length > 0 ? { ...node, children: removeNodeRecursive(node.children, id) } : node
    );

const replatformRecursive = (nodes: CanvasNode[], platform: CanvasPlatform): CanvasNode[] =>
  nodes.map((node) => ({ ...node, platform, children: replatformRecursive(node.children, platform) }));

const replatformOne = (node: CanvasNode, platform: CanvasPlatform): CanvasNode => ({
  ...node,
  platform,
  children: replatformRecursive(node.children, platform)
});

export const serializeCanvasNode = (node: CanvasNode): Record<string, unknown> => ({
  id: node.id,
  type: node.type,
  ...(node.name ? { name: node.name } : {}),
  props: { ...node.props },
  ...(node.children.length > 0
    ? { children: node.children.map((child) => serializeCanvasNode(child)) }
    : {})
});

export const sanitizeUnknownProps = (props?: Record<string, unknown>): Record<string, CanvasPropValue> => {
  const out: Record<string, CanvasPropValue> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
};

const hydrateNodesFromSnapshot = (
  snapshotNodes: Array<Record<string, unknown>> | undefined,
  platform: CanvasPlatform,
  indexOffset = { value: 0 }
): CanvasNode[] => {
  if (!snapshotNodes || snapshotNodes.length === 0) return [];
  return snapshotNodes.map((raw) => {
    const id = typeof raw.id === 'string' ? raw.id : `node_${globalThis.crypto.randomUUID()}`;
    const type = typeof raw.type === 'string' ? raw.type : 'container';
    const name = typeof raw.name === 'string' ? raw.name : undefined;
    let props = sanitizeUnknownProps(raw.props as Record<string, unknown> | undefined);
    const children = hydrateNodesFromSnapshot(raw.children as Array<Record<string, unknown>> | undefined, platform, indexOffset);
    if (rawHasLayout(props)) {
      props = { ...props, x: toInt(props.x), y: toInt(props.y), width: toNum(props.width, nodeDefaultSize(type).width), height: toNum(props.height, nodeDefaultSize(type).height) };
    } else {
      const slot = autoPlaceSlot(indexOffset.value++);
      const size = nodeDefaultSize(type);
      props = { ...props, x: slot.x, y: slot.y, width: props.width !== undefined ? toNum(props.width, size.width) : size.width, height: props.height !== undefined ? toNum(props.height, size.height) : size.height };
    }
    return { id, type, platform, props, ...(name ? { name } : {}), children };
  });
};

const rawHasLayout = (props: Record<string, CanvasPropValue>): boolean =>
  props.x !== undefined && props.y !== undefined;

const toInt = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const toNum = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const autoPlaceSlot = (index: number): { x: number; y: number } => ({
  x: 24 + (index % 3) * 200,
  y: 24 + Math.floor(index / 3) * 140
});

export const nodeDefaultSize = (type: string): { width: number; height: number } => {
  switch (type) {
    case 'button': return { width: 128, height: 38 };
    case 'input': return { width: 220, height: 38 };
    case 'text': return { width: 140, height: 24 };
    case 'image': return { width: 180, height: 130 };
    case 'card': return { width: 260, height: 170 };
    case 'divider': return { width: 220, height: 3 };
    case 'avatar': return { width: 44, height: 44 };
    case 'switch': return { width: 46, height: 26 };
    case 'checkbox': return { width: 22, height: 22 };
    case 'progress': return { width: 210, height: 8 };
    default: return { width: 320, height: 220 };
  }
};

// ---------------------------------------------------------------------------
// Viewport persistence (Prompt 1 Step 4) — per canvas document, UI-local.
// Kept in the store but deliberately excluded from the node-sync push (see
// schedulePush): panning / zooming must not spam the main CanvasSyncManager.
// ---------------------------------------------------------------------------

export interface CanvasViewportPersist {
  scale: number;
  tx: number;
  ty: number;
  grid: boolean;
  rulers: boolean;
  minimap: boolean;
  /** True once the user has actually moved the view, so we restore instead of fit. */
  saved: boolean;
}

const VIEWPORT_STORAGE_KEY = 'tycode.canvas.viewport';

const DEFAULT_VIEWPORT: CanvasViewportPersist = {
  scale: 1,
  tx: 0,
  ty: 0,
  grid: true,
  rulers: true,
  minimap: true,
  saved: false
};

const loadViewport = (): CanvasViewportPersist => {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_VIEWPORT };
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VIEWPORT };
    const parsed = JSON.parse(raw) as Partial<CanvasViewportPersist>;
    return {
      scale: typeof parsed.scale === 'number' ? parsed.scale : 1,
      tx: typeof parsed.tx === 'number' ? parsed.tx : 0,
      ty: typeof parsed.ty === 'number' ? parsed.ty : 0,
      grid: typeof parsed.grid === 'boolean' ? parsed.grid : true,
      rulers: typeof parsed.rulers === 'boolean' ? parsed.rulers : true,
      minimap: typeof parsed.minimap === 'boolean' ? parsed.minimap : true,
      saved: parsed.saved === true
    };
  } catch {
    return { ...DEFAULT_VIEWPORT };
  }
};

let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null;
const persistViewport = (value: CanvasViewportPersist): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
    viewportSaveTimer = setTimeout(() => {
      viewportSaveTimer = null;
      try {
        localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* storage full or unavailable — non-fatal, view simply re-fits next open */
      }
    }, 250);
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  nodes: [],
  activePlatform: 'react',
  selectedNodeId: null,
  selectedNodeIds: [],
  lockedIds: [],
  hiddenIds: [],
  hydrated: false,
  viewport: loadViewport(),

  addNode: (input) => {
    const state = get();
    const id = `node_${globalThis.crypto.randomUUID()}`;
    const size = nodeDefaultSize(input.type);
    let slot = autoPlaceSlot(state.nodes.length);
    let parentId = input.parentId ?? null;

    if (parentId) {
      const parent = findCanvasNode(state.nodes, parentId);
      if (!parent) parentId = null;
    }

    const node: CanvasNode = {
      id,
      type: input.type,
      platform: state.activePlatform,
      props: {
        x: slot.x,
        y: slot.y,
        width: size.width,
        height: size.height,
        ...input.props
      },
      ...(input.name ? { name: input.name } : {}),
      children: []
    };

    set({
      nodes: parentId
        ? insertIntoParent(state.nodes, parentId, node)
        : [...state.nodes, node],
      selectedNodeId: id,
      selectedNodeIds: [id]
    });
    return id;
  },

  updateNodeProps: (id, patch) => {
    set({ nodes: updateNodeRecursive(get().nodes, id, patch) });
  },

  replaceNodes: (nodes) => {
    // Drop any selection / lock / hide that pointed at a node no longer present
    // so the aids can never reference a stale id after an undo / paste.
    const present = new Set<string>();
    const collect = (list: CanvasNode[]): void => {
      for (const n of list) {
        present.add(n.id);
        collect(n.children);
      }
    };
    collect(nodes);
    const state = get();
    const selectedNodeIds = state.selectedNodeIds.filter((id) => present.has(id));
    set({
      nodes,
      selectedNodeIds,
      selectedNodeId: selectedNodeIds.length
        ? selectedNodeIds[selectedNodeIds.length - 1]
        : null,
      lockedIds: state.lockedIds.filter((id) => present.has(id)),
      hiddenIds: state.hiddenIds.filter((id) => present.has(id))
    });
  },

  removeNode: (id) => {
    const state = get();
    set({
      nodes: removeNodeRecursive(state.nodes, id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      selectedNodeIds: state.selectedNodeIds.filter((n) => n !== id),
      lockedIds: state.lockedIds.filter((n) => n !== id),
      hiddenIds: state.hiddenIds.filter((n) => n !== id)
    });
  },

  setPlatform: (platform) => {
    const state = get();
    set({
      activePlatform: platform,
      nodes: replatformRecursive(state.nodes, platform)
    });
  },

  clearCanvas: () => {
    set({ nodes: [], selectedNodeId: null, selectedNodeIds: [], lockedIds: [], hiddenIds: [] });
  },

  selectNode: (id) => {
    // A locked node is unselectable (Step 4). null always clears.
    if (id !== null && get().lockedIds.includes(id)) {
      set({ selectedNodeId: null, selectedNodeIds: [] });
      return;
    }
    set({ selectedNodeId: id, selectedNodeIds: id ? [id] : [] });
  },

  setSelection: (ids) => {
    const allowed = ids.filter((id) => !get().lockedIds.includes(id));
    set({ selectedNodeIds: allowed, selectedNodeId: allowed.length ? allowed[allowed.length - 1] : null });
  },

  toggleSelect: (id) => {
    const state = get();
    if (state.lockedIds.includes(id)) return;
    if (state.selectedNodeIds.includes(id)) {
      const next = state.selectedNodeIds.filter((n) => n !== id);
      set({ selectedNodeIds: next, selectedNodeId: next.length ? next[next.length - 1] : null });
    } else {
      const next = [...state.selectedNodeIds, id];
      set({ selectedNodeIds: next, selectedNodeId: id });
    }
  },

  clearSelection: () => set({ selectedNodeIds: [], selectedNodeId: null }),

  selectAllTopLevel: () => {
    const state = get();
    const ids = state.nodes.filter((n) => !state.lockedIds.includes(n.id)).map((n) => n.id);
    set({ selectedNodeIds: ids, selectedNodeId: ids.length ? ids[ids.length - 1] : null });
  },

  toggleLock: (id) => {
    const state = get();
    const locked = state.lockedIds.includes(id);
    const lockedIds = locked ? state.lockedIds.filter((n) => n !== id) : [...state.lockedIds, id];
    // Locking drops the node from any selection (locked = unselectable).
    const selectedNodeIds = locked ? state.selectedNodeIds : state.selectedNodeIds.filter((n) => n !== id);
    set({
      lockedIds,
      selectedNodeIds,
      selectedNodeId: selectedNodeIds.length ? selectedNodeIds[selectedNodeIds.length - 1] : null
    });
  },

  toggleHide: (id) => {
    const state = get();
    const hidden = state.hiddenIds.includes(id);
    set({ hiddenIds: hidden ? state.hiddenIds.filter((n) => n !== id) : [...state.hiddenIds, id] });
  },

  applyRemoteSnapshot: (snapshot, onlyIfUnhydrated = false) => {
    const state = get();
    if (onlyIfUnhydrated && state.hydrated) return;
    const platform = isPlatform(snapshot.activePlatform) ? snapshot.activePlatform : state.activePlatform;
    const nodes = hydrateNodesFromSnapshot(
      (snapshot.canvasComponents ?? []) as unknown as Array<Record<string, unknown>>,
      platform
    );
    const stillExists = state.selectedNodeId ? findCanvasNode(nodes, state.selectedNodeId) !== null : false;
    cancelPendingPush();
    set({
      nodes,
      activePlatform: platform,
      hydrated: true,
      selectedNodeId: stillExists ? state.selectedNodeId : null,
      selectedNodeIds: stillExists ? state.selectedNodeIds : []
    });
  },

  setViewport: (patch) => {
    const next = { ...get().viewport, ...patch };
    set({ viewport: next });
    persistViewport(next);
  }
}));

const insertIntoParent = (nodes: CanvasNode[], parentId: string, node: CanvasNode): CanvasNode[] =>
  nodes.map((candidate) =>
    candidate.id === parentId
      ? { ...candidate, children: [...candidate.children, node] }
      : candidate.children.length > 0
        ? { ...candidate, children: insertIntoParent(candidate.children, parentId, node) }
        : candidate
  );

const isPlatform = (value: unknown): value is CanvasPlatform =>
  value === 'react' || value === 'flutter' || value === 'swiftui' || value === 'web' || value === 'other';

// ---------------------------------------------------------------------------
// Sync plumbing (debounced push + remote apply)
// ---------------------------------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let isRemoteApply = false;

const cancelPendingPush = (): void => {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
};

const schedulePush = (): void => {
  if (isRemoteApply) return;
  const state = useCanvasStore.getState();
  if (!state.hydrated) return;
  // Viewport-only changes must not push the node tree; only nodes / platform
  // are part of the synced document. Skip when that signature is unchanged.
  const signature = `${state.activePlatform}|${state.nodes.length}|${nodesDeepId(state.nodes)}`;
  if (signature === lastPushSignature) return;
  lastPushSignature = signature;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const snapshot = useCanvasStore.getState();
    void window.electronAPI
      ?.canvasUpdateState?.({
        activePlatform: snapshot.activePlatform,
        canvasComponents: snapshot.nodes.map((node) => serializeCanvasNode(node)) as never,
        reason: 'canvas-editor-edit'
      })
      .catch((err: unknown) => console.warn('Failed to push canvas state:', err));
  }, 300);
};

let lastPushSignature = '';

// A cheap structural id so moving a node's x/y (which changes props, not the
// node set) still counts as a real edit and pushes, while a pure viewport change
// does not.
const nodesDeepId = (nodes: CanvasNode[]): string => {
  let acc = '';
  const walk = (list: CanvasNode[]): void => {
    for (const n of list) {
      acc += `${n.id}:${n.props.x},${n.props.y},${n.props.width},${n.props.height};`;
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return acc;
};

// Push every local mutation (debounced). Remote applies set the guard above so
// we never bounce our own snapshot straight back.
export const initCanvasStoreSync = (): (() => void) => {
  const unsubscribe = useCanvasStore.subscribe(() => schedulePush());
  return () => {
    unsubscribe();
    cancelPendingPush();
  };
};

export const initCanvasRemoteSync = (): (() => void) => {
  let disposed = false;
  void window.electronAPI
    ?.canvasRequestState?.()
    .then((res) => {
      if (disposed || !res?.success || !res.data) return;
      isRemoteApply = true;
      try {
        useCanvasStore.getState().applyRemoteSnapshot(res.data, true);
      } finally {
        isRemoteApply = false;
      }
    })
    .catch(() => {});

  const unsubState = window.electronAPI?.onCanvasStateSynced?.((snapshot) => {
    if (disposed) return;
    isRemoteApply = true;
    try {
      useCanvasStore.getState().applyRemoteSnapshot(snapshot as CanvasSnapshotData);
    } finally {
      isRemoteApply = false;
    }
  });

  return () => {
    disposed = true;
    unsubState?.();
  };
};

export const isRemoteSyncActive = (): boolean => isRemoteApply;
