/**
 * Canvas editing wiring (M3E Sketcher — Prompt 3)
 *
 * Binds the pure {@link CanvasEditController} to the live Zustand store and the
 * shared renderer clipboard service, exposing ONE session singleton the whole
 * Sketcher shares: the stage gestures, the layer tree, the inspector bodies and
 * the registry-backed `canvas.*` command handlers all drive the SAME controller,
 * so every edit is recorded on the one command stack.
 *
 * The controller reads/writes the tree through `replaceNodes` (an atomic AST
 * swap) and never touches the DOM, which is what keeps undo/redo exact.
 */

import { useCanvasStore } from '../../state/canvas-store';
import { copyTextOrNotify } from '../../lib/clipboard';
import { CanvasEditController } from './canvas-editing';

export const canvasEditController = new CanvasEditController({
  treeOf: () => useCanvasStore.getState().nodes,
  replaceOf: (nodes) => useCanvasStore.getState().replaceNodes(nodes),
  selectionOf: () => useCanvasStore.getState().selectedNodeIds,
  platformOf: () => useCanvasStore.getState().activePlatform,
  clipboardOf: () => ({
    // Fire-and-forget: the async copy path reports through its own toast.
    write: (text) => {
      void copyTextOrNotify(text, 'canvas-layers');
    }
  })
});
