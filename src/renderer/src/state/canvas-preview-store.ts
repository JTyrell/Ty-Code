import { create } from 'zustand';
import type { CanvasEditAppliedPayload, CanvasPreviewProposedPayload, CanvasPreviewStatusPayload } from '../../../preload/types';
import { useWorkspaceEditStore } from './workspace-edit-store';

export type CanvasPreviewStateValue = CanvasPreviewStatusPayload['status']['state'];

export interface CanvasAppliedToast {
  id: number;
  files: string[];
}

interface CanvasPreviewStoreState {
  /** Latest preview boot status (null until the first status arrives). */
  status: CanvasPreviewStatusPayload['status'] | null;
  /** Surface mode: 'sketcher' = M3E generator, 'live' = project preview host. */
  mode: 'sketcher' | 'live';
  /** Inspector bridge state for the live host. */
  bridgeActive: boolean;
  inspectMode: boolean;
  /** Main-window-bound: latest canvas edit proposed for Monaco review. */
  proposedReview: (CanvasPreviewProposedPayload & { receivedAt: number }) | null;
  /** Applied-edit toast stack (canvas window + main window). */
  appliedToasts: CanvasAppliedToast[];
  setPreviewStatus: (status: CanvasPreviewStatusPayload['status'] | null) => void;
  setMode: (mode: 'sketcher' | 'live') => void;
  setBridgeActive: (active: boolean) => void;
  setInspectMode: (enabled: boolean) => void;
  setProposedReview: (payload: CanvasPreviewProposedPayload | null) => void;
  recordAppliedEdits: (payload: CanvasEditAppliedPayload) => void;
  dismissAppliedToast: (id: number) => void;
}

const MAX_APPLIED_TOASTS = 3;

export const useCanvasPreviewStore = create<CanvasPreviewStoreState>((set) => ({
  status: null,
  mode: 'sketcher',
  bridgeActive: false,
  inspectMode: true,
  proposedReview: null,
  appliedToasts: [],
  setPreviewStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),
  setBridgeActive: (bridgeActive) => set({ bridgeActive }),
  setInspectMode: (inspectMode) => set({ inspectMode }),
  setProposedReview: (proposedReview) => set({
    proposedReview: proposedReview ? { ...proposedReview, receivedAt: Date.now() } : null
  }),
  recordAppliedEdits: (payload) => set((state) => ({
    appliedToasts: [
      { id: Date.now(), files: payload.files },
      ...state.appliedToasts
    ].slice(0, MAX_APPLIED_TOASTS)
  })),
  dismissAppliedToast: (id) => set((state) => ({ appliedToasts: state.appliedToasts.filter((t) => t.id !== id) }))
}));

/**
 * Canvas window + main window listener wiring (idempotent, returns dispose).
 * - status broadcasts (all windows)
 * - canvas-edit:applied broadcasts (appliedFiles toasts)
 * - proposed previews only matter in the Main Editor (Safe Edit Review Gate)
 */
export function initCanvasPreviewSync(): () => void {
  const api = window.electronAPI;
  const disposers: Array<() => void> = [];

  disposers.push(api?.onCanvasPreviewStatus?.((payload) => {
    if (!payload?.status) return;
    useCanvasPreviewStore.getState().setPreviewStatus(payload.status);
  }) ?? (() => undefined));

  disposers.push(api?.onCanvasEditApplied?.((payload) => {
    if (!payload?.files?.length) return;
    useCanvasPreviewStore.getState().recordAppliedEdits(payload);
  }) ?? (() => undefined));

  disposers.push(api?.onCanvasEditPreviewProposed?.((payload) => {
    const preview = payload?.preview;
    if (!preview?.previewId) return;
    const canvas = useCanvasPreviewStore.getState();
    canvas.setProposedReview(payload);
    // Surface the proposal in the Main Editor's existing Monaco review gate
    // (Safe Edit Review Gate — the same flow M3ECanvas uses for >policy edits).
    useWorkspaceEditStore.getState().setRequest({
      preview,
      isStale: false,
      refresh: async () => {
        const refreshed = useWorkspaceEditStore.getState().request?.preview;
        if (!refreshed) throw new Error('Canvas edit preview is stale.');
        return refreshed;
      },
      filePaths: preview.files?.map((file) => file.filePath),
      sourceKey: 'canvas-live-preview'
    });
  }) ?? (() => undefined));

  return () => disposers.forEach((dispose) => dispose());
}
