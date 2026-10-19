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
  hydrated: boolean;

  addNode: (input: AddNodeInput) => string | null;
  updateNodeProps: (id: string, patch: Record<string, CanvasPropValue>) => void;
  removeNode: (id: string) => void;
  setPlatform: (platform: CanvasPlatform) => void;
  clearCanvas: () => void;
  selectNode: (id: string | null) => void;
  applyRemoteSnapshot: (snapshot: CanvasSnapshotData, onlyIfUnhydrated?: boolean) => void;
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
// Store
// ---------------------------------------------------------------------------

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  nodes: [],
  activePlatform: 'react',
  selectedNodeId: null,
  hydrated: false,

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
      selectedNodeId: id
    });
    return id;
  },

  updateNodeProps: (id, patch) => {
    set({ nodes: updateNodeRecursive(get().nodes, id, patch) });
  },

  removeNode: (id) => {
    const state = get();
    set({
      nodes: removeNodeRecursive(state.nodes, id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId
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
    set({ nodes: [], selectedNodeId: null });
  },

  selectNode: (id) => {
    set({ selectedNodeId: id });
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
      selectedNodeId: stillExists ? state.selectedNodeId : null
    });
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
