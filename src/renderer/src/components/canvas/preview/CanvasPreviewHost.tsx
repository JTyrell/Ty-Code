import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe,
  Square,
  RefreshCw,
  MousePointer2,
  Eraser,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  Layers,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { toast } from '../../../state/toast-store';
import { useWorkspaceSessionStore } from '../../../state/workspace-session-store';
import { useCanvasPreviewStore } from '../../../state/canvas-preview-store';
import {
  CANVAS_INSPECTOR_SOURCE,
  CanvasInspectorBridge,
  type InspectorDragEvent,
  type InspectorRecord,
  type InspectorTreeNode,
} from './inspector-bridge';
import type { CanvasEditIntent } from '../../../../../preload/types';

/**
 * M3E Canvas Live Project Editor (Prompt 4)
 *
 * Renders the session workspace's own UI inside a sandboxed <webview>
 * (persist:tycode-preview). The inspector bridge is injected on dom-ready and
 * the host validates every guest message with Zod (inspector-bridge.ts).
 * Visual edits become CanvasEditIntent batches â†’ canvas:edit:apply â†’ the
 * existing Safe Edit Review Gate; structural changes go to the canvas agent
 * engine through canvas:structural:dispatch (pressed from the tree rail).
 *
 * PERF GUARDS: rAF drain only runs while the webview reports an active
 * interaction burst (hover/drag) or while a drag is live; the bridge pauses
 * whenever the window is hidden (visibilitychange â†’ guest 'pause' command).
 */

const HIGHLIGHT_MOVE_PROPERTY = 'margin-left';
const HIGHLIGHT_MOVE_TOP_PROPERTY = 'margin-top';
const POSITION_LEFT_PROPERTY = 'left';
const POSITION_TOP_PROPERTY = 'top';
const ABSOLUTE_POSITIONS = new Set(['absolute', 'fixed']);

function parsePx(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function debounceFrameText(value: number): string {
  return `${Math.round(value)}px`;
}

/**
 * Host → guest control transport. The sandboxed <webview> exposes no
 * contentWindow to the host renderer, so commands are delivered by executing
 * a window.postMessage inside the guest context (the inspector script above
 * listens on the 'tycode-canvas-host' channel).
 */
function sendGuestCommand(
  webview: Electron.WebviewTag | null,
  command: 'pause' | 'resume' | 'inspect-on' | 'inspect-off' | 'select-by-selector',
  selector?: string
): void {
  if (!webview) return;
  try {
    const payload = JSON.stringify({ channel: 'tycode-canvas-host', command, ...(selector ? { selector } : {}) });
    void webview.executeJavaScript(`window.postMessage(${payload}, '*');`, false).catch(() => undefined);
  } catch {
    /* webview torn down mid-send */
  }
}

interface OverlayBox {
  selector: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
  label: string | null;
}

const PropertyRows: React.FC<{ record: InspectorRecord }> = ({ record }) => {
  const entries = Object.entries(record.styles);
  if (entries.length === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>No computed styles.</span>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 10.5 }}>
      {entries.map(([prop, value]) => (
        <React.Fragment key={prop}>
          <span style={{ color: 'var(--text-muted, #6b7280)', whiteSpace: 'nowrap' }}>{prop}</span>
          <span style={{ color: 'var(--text-primary, #e5e7eb)', fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>{value}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

interface TreeRowsProps {
  nodes: InspectorTreeNode[];
  selectedSelector: string | null;
  onSelect: (node: InspectorTreeNode) => void;
}

const TreeRows: React.FC<TreeRowsProps> = ({ nodes, selectedSelector, onSelect }) => {
  const flat = useMemo(() => {
    const out: Array<{ node: InspectorTreeNode; depth: number }> = [];
    const walk = (list: InspectorTreeNode[], depth: number): void => {
      for (const node of list) {
        out.push({ node, depth });
        walk(node.children, depth + 1);
      }
    };
    walk(nodes, 1);
    return out;
  }, [nodes]);
  return (
    <div style={{ padding: '4px 8px' }}>
      {flat.map((entry, flatIndex) => {
        const node = entry.node;
        const depth = entry.depth;
        const selected = selectedSelector === node.selector;
        return (
          <div
            key={`${node.selector}#${depth}#${flatIndex}`}
            onClick={() => onSelect(node)}
            title={`${node.tag}${node.preview ? ` - ${node.preview}` : ''}`}
            style={{
              padding: '1.5px 6px',
              paddingLeft: `${6 + depth * 11}px`,
              fontSize: 10.5,
              fontFamily: 'var(--font-mono, monospace)',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              gap: 4,
              alignItems: 'baseline',
              color: selected ? '#c084fc' : 'var(--text-secondary, #9ca3af)',
              backgroundColor: selected ? 'rgba(168, 85, 247, 0.18)' : 'transparent'
            }}
          >
            <span style={{ color: '#8b5cf6' }}>{node.tag}</span>
            {node.preview && (
              <span style={{ color: 'var(--text-muted, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                {node.preview}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const CanvasPreviewHost: React.FC = () => {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const bridgeRef = useRef<CanvasInspectorBridge | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);
  const pausedRef = useRef(false);
  const selectionRef = useRef<InspectorRecord | null>(null);
  const inspectModeRef = useRef(true);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [selection, setSelectionState] = useState<InspectorRecord | null>(null);
  const [treeNodes, setTreeNodes] = useState<InspectorTreeNode[]>([]);
  const [selectionOverlay, setSelectionOverlay] = useState<OverlayBox | null>(null);
  const [hoverOverlay, setHoverOverlay] = useState<OverlayBox | null>(null);
  const [dragging, setDragging] = useState(false);
  const [footerNote, setFooterNote] = useState<string | null>(null);
  const [showTreePanel, setShowTreePanel] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  const sessionRoot = useWorkspaceSessionStore((s) => s.session?.rootPath ?? null);
  const status = useCanvasPreviewStore((s) => s.status);
  const inspectMode = useCanvasPreviewStore((s) => s.inspectMode);
  const setInspectMode = useCanvasPreviewStore((s) => s.setInspectMode);
  const setBridgeActive = useCanvasPreviewStore((s) => s.setBridgeActive);

  // Prompt 5 Step 3.2: colors are constrained to the extracted DesignProfile
  // palette — the swatch strip below is sourced from the workspace extractor.
  const [palette, setPalette] = useState<Array<{ name: string; value: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    if (!sessionRoot) {
      setPalette([]);
      return;
    }
    void window.electronAPI?.getDesignProfile?.(sessionRoot).then((response) => {
      if (cancelled || !response?.success || !response.data) return;
      setPalette(
        Object.entries(response.data.colors || {})
          .slice(0, 24)
          .map(([name, value]) => ({ name, value: String(value) }))
      );
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionRoot]);

  const expectedOrigin = useMemo(() => {
    try {
      return previewUrl ? new URL(previewUrl).origin : null;
    } catch {
      return null;
    }
  }, [previewUrl]);

  useEffect(() => {
    inspectModeRef.current = inspectMode;
    if (webviewReady && webviewRef.current) {
      sendGuestCommand(webviewRef.current, inspectMode ? 'inspect-on' : 'inspect-off');
    }
  }, [inspectMode, webviewReady]);

  const setSelection = useCallback((record: InspectorRecord | null): void => {
    selectionRef.current = record;
    setSelectionState(record);
  }, []);

  // --- bridge attachment ----------------------------------------------------
  useEffect(() => {
    const bridge = new CanvasInspectorBridge();
    bridgeRef.current = bridge;
    bridge.attach(expectedOrigin);
    setBridgeActive(bridge.isAttached);
    return () => {
      bridge.detach();
      bridgeRef.current = null;
      setBridgeActive(false);
    };
  }, [expectedOrigin, setBridgeActive]);

  const commitDragRef = useRef<(event: InspectorDragEvent) => void>(() => undefined);

  // --- 30 Hz coalesced drain (rAF only during active bursts / drags) --------
  const drainOnce = useCallback((): void => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const snap = bridge.drain();
    if (snap.tree) setTreeNodes(snap.tree);
    if (snap.select) {
      setSelection(snap.select);
      setHoverOverlay(null);
      setSelectionOverlay({
        selector: snap.select.selector,
        x: snap.select.bbox.x,
        y: snap.select.bbox.y,
        w: snap.select.bbox.w,
        h: snap.select.bbox.h,
        accent: '#8b5cf6',
        label: snap.select.componentName || snap.select.tag
      });
    }
    if (snap.hover && !snap.dragging) {
      if (!selectionRef.current || selectionRef.current.selector !== snap.hover.selector) {
        setHoverOverlay({
          selector: snap.hover.selector,
          x: snap.hover.bbox.x,
          y: snap.hover.bbox.y,
          w: snap.hover.bbox.w,
          h: snap.hover.bbox.h,
          accent: '#14b8a6',
          label: null
        });
      }
    }
    if (snap.dragging) {
      setDragging(true);
      const drag = snap.dragging;
      setSelectionOverlay((prev) => prev && prev.selector === drag.selector
        ? { ...prev, x: drag.base.x + drag.dx, y: drag.base.y + drag.dy, w: drag.base.w, h: drag.base.h }
        : prev);
    }
    if (snap.dragEnded) {
      setDragging(false);
      commitDragRef.current(snap.dragEnded);
    }
  }, [setSelection]);

  const armDrain = useCallback((): void => {
    if (rafRef.current !== null || pausedRef.current) return;
    lastActivityRef.current = Date.now();
    const step = (): void => {
      drainOnce();
      const bridge = bridgeRef.current;
      const active = draggingRef.current || (bridge ? bridge.isActive(700) : false) || pausedRef.current;
      if (active) {
        lastActivityRef.current = Math.max(lastActivityRef.current, Date.now());
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [drainOnce]);

  const draggingRef = useRef(false);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    const wake = (): void => {
      armDrain();
    };
    window.addEventListener('message', wake);
    return () => window.removeEventListener('message', wake);
  }, [armDrain]);

  useEffect(() => {
    const handler = (): void => {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      if (document.hidden) {
        bridge.pause();
        pausedRef.current = true;
        bridge.clear();
        sendGuestCommand(webviewRef.current, 'pause');
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else {
        bridge.resume();
        pausedRef.current = false;
        sendGuestCommand(webviewRef.current, 'resume');
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // --- intent plumbing ------------------------------------------------------
  const makeIntent = useCallback((record: InspectorRecord, property: string, value: string, kind: 'style' | 'text' = 'style'): CanvasEditIntent => ({
    intentId: `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    property,
    value,
    targetSelector: record.selector,
    componentName: record.componentName ?? undefined,
    sourceFileHint: undefined,
    originalInnerText: kind === 'text' ? (record.innerText ?? '') : undefined
  }), []);

  const dispatchIntents = useCallback(async (intents: CanvasEditIntent[]): Promise<void> => {
    if (!window.electronAPI?.applyCanvasEdits) {
      toast.error('Live edits unavailable', 'The canvas preview bridge is still initializing.');
      return;
    }
    try {
      const response = await window.electronAPI.applyCanvasEdits({ intents });
      if (!response.success) {
        toast.error('Live edit rejected', response.error || 'The Safe Gate could not map this visual edit to source.');
        return;
      }
      const result = response.data;
      if (result?.files?.length) {
        toast.success(
          result.autoApplied ? 'Applied to source' : 'Sent for review',
          result.autoApplied
            ? `Updated ${result.files.join(', ')}`
            : 'Auto-apply policy did not fire â€” review the diff in the Main Editor.'
        );
      }
    } catch (err) {
      toast.error('Live edit failed', err instanceof Error ? err.message : String(err));
    }
  }, []);

  const commitDrag = useCallback((event: InspectorDragEvent): void => {
    if (Math.abs(event.dx) < 2 && Math.abs(event.dy) < 2) return;
    if (event.interactive) {
      setFooterNote('Links and buttons navigate â€” select containers to move them.');
      return;
    }
    const selected = selectionRef.current;
    if (!selected || selected.selector !== event.selector) return;
    const intents: CanvasEditIntent[] = [];
    const position = event.position || selected.styles['position'] || '';
    if (ABSOLUTE_POSITIONS.has(position)) {
      if (Math.abs(event.dx) >= 2) {
        intents.push(makeIntent(selected, POSITION_LEFT_PROPERTY, debounceFrameText(parsePx(selected.styles[POSITION_LEFT_PROPERTY]) + event.dx)));
      }
      if (Math.abs(event.dy) >= 2) {
        intents.push(makeIntent(selected, POSITION_TOP_PROPERTY, debounceFrameText(parsePx(selected.styles[POSITION_TOP_PROPERTY]) + event.dy)));
      }
    } else {
      if (Math.abs(event.dx) >= 2) {
        intents.push(makeIntent(selected, HIGHLIGHT_MOVE_PROPERTY, debounceFrameText(parsePx(selected.styles[HIGHLIGHT_MOVE_PROPERTY]) + event.dx)));
      }
      if (Math.abs(event.dy) >= 2) {
        intents.push(makeIntent(selected, HIGHLIGHT_MOVE_TOP_PROPERTY, debounceFrameText(parsePx(selected.styles[HIGHLIGHT_MOVE_TOP_PROPERTY]) + event.dy)));
      }
    }
    if (intents.length === 0) return;
    void dispatchIntents(intents);
  }, [dispatchIntents, makeIntent]);
  commitDragRef.current = commitDrag;

  // --- resize handles (Prompt 5 Step 3.1) -----------------------------------
  type ResizeHandle = 'e' | 's' | 'se';
  const resizeStateRef = useRef<{ handle: ResizeHandle; startX: number; startY: number; baseW: number; baseH: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  const beginResize = useCallback((handle: ResizeHandle, event: React.PointerEvent): void => {
    const selected = selectionRef.current;
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = { handle, startX: event.clientX, startY: event.clientY, baseW: selected.bbox.w, baseH: selected.bbox.h };
    setResizing(true);
    const onMove = (moveEvent: PointerEvent): void => {
      const state = resizeStateRef.current;
      if (!state) return;
      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;
      setSelectionOverlay((prev) => {
        if (!prev || prev.selector !== selected.selector) return prev;
        const w = state.handle === 's' ? prev.w : Math.max(8, state.baseW + dx);
        const h = state.handle === 'e' ? prev.h : Math.max(8, state.baseH + dy);
        return { ...prev, w, h };
      });
    };
    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      const state = resizeStateRef.current;
      resizeStateRef.current = null;
      setResizing(false);
      const target = selectionRef.current;
      if (!state || !target) return;
      const dx = upEvent.clientX - state.startX;
      const dy = upEvent.clientY - state.startY;
      const intents: CanvasEditIntent[] = [];
      if (state.handle !== 's' && Math.abs(dx) >= 2) {
        intents.push(makeIntent(target, 'width', `${Math.max(8, Math.round(state.baseW + dx))}px`));
      }
      if (state.handle !== 'e' && Math.abs(dy) >= 2) {
        intents.push(makeIntent(target, 'height', `${Math.max(8, Math.round(state.baseH + dy))}px`));
      }
      if (intents.length > 0) void dispatchIntents(intents);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, [dispatchIntents, makeIntent]);

  const applyProperty = useCallback((property: string, value: string): void => {
    const selected = selectionRef.current;
    if (!selected) return;
    if (!value.trim()) return;
    void dispatchIntents([makeIntent(selected, property, value)]);
  }, [dispatchIntents, makeIntent]);

  const propertySetter = useCallback((property: string): ((value: string) => void) => {
    return (value: string): void => { applyProperty(property, value); };
  }, [applyProperty]);

  const applyText = useCallback((next: string): void => {
    const selected = selectionRef.current;
    if (!selected) return;
    void dispatchIntents([makeIntent(selected, '', next, 'text')]);
  }, [dispatchIntents, makeIntent]);

  const selectFromTree = useCallback((node: InspectorTreeNode): void => {
    sendGuestCommand(webviewRef.current, 'select-by-selector', node.selector);
  }, []);

  // --- boot lifecycle -------------------------------------------------------
  const startPreview = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.canvasPreviewStart) return;
    setStarting(true);
    setStartError(null);
    const response = await window.electronAPI.canvasPreviewStart();
    setStarting(false);
    if (!response.success || !response.data) {
      setStartError(response.error || 'Preview boot failed.');
      return;
    }
    if (response.data.status.url && response.data.status.state === 'ready') {
      setPreviewUrl(response.data.status.url);
      return;
    }
    if (response.data.status.state === 'unavailable') {
      setStartError('No dev/start/serve script and no static build found in this workspace.');
    }
  }, []);

  useEffect(() => {
    const dispose = window.electronAPI?.onCanvasPreviewStatus?.((payload) => {
      if (!payload?.status) return;
      if (payload.status.state === 'ready' && payload.status.url) {
        setPreviewUrl(payload.status.url);
        setStartError(null);
        return;
      }
      if (payload.status.state === 'error' || payload.status.state === 'unavailable') {
        setStartError(payload.status.error || `Preview failed via ${payload.status.adapter}`);
        return;
      }
      if (payload.status.state === 'stopped') {
        setPreviewUrl(null);
      }
    }) ?? (() => undefined);
    return () => { dispose(); };
  }, []);

  // Hot-reload resync: reload the preview after canvas edits land on disk.
  useEffect(() => {
    const dispose = window.electronAPI?.onCanvasEditApplied?.((payload) => {
      if (!payload?.files?.length) return;
      const webview = webviewRef.current;
      if (!webview) return;
      window.setTimeout(() => {
        try {
          webview.reloadIgnoringCache();
          setFooterNote('Source updated â€” preview reloaded.');
        } catch {
          /* webview mid-navigation */
        }
      }, 300);
    }) ?? (() => undefined);
    return () => { dispose(); };
  }, []);

  const handleDomReady = useCallback((): void => {
    const webview = webviewRef.current;
    if (!webview) return;
    setWebviewReady(true);
    setSelection(null);
    setHoverOverlay(null);
    setTreeNodes([]);
    try {
      void webview.executeJavaScript(CANVAS_INSPECTOR_SOURCE, false);
      webview.setAudioMuted(true);
      sendGuestCommand(webview, inspectModeRef.current ? 'inspect-on' : 'inspect-off');
    } catch {
      /* inspector is best-effort; preview still renders */
    }
  }, []);

  const handleReloadPreview = useCallback((): void => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      webview.reloadIgnoringCache();
    } catch {
      /* webview dead */
    }
  }, []);

  const stopPreview = useCallback(async (): Promise<void> => {
    await window.electronAPI?.canvasPreviewStop?.().catch(() => undefined);
    setPreviewUrl(null);
    setSelection(null);
    setHoverOverlay(null);
    setTreeNodes([]);
    setSelectionOverlay(null);
    setHoverOverlay(null);
    setWebviewReady(false);
  }, []);

  const statusChip = useMemo(() => {
    const st = status?.state ?? 'idle';
    switch (st) {
      case 'ready': return { label: 'Preview ready', color: '#10b981', icon: <CheckCircle2 size={12} /> };
      case 'booting': return { label: 'Booting previewâ€¦', color: '#f59e0b', icon: <Loader2 size={12} /> };
      case 'error': return { label: 'Preview error', color: '#ef4444', icon: <XCircle size={12} /> };
      case 'unavailable': return { label: 'No adapter', color: '#ef4444', icon: <AlertTriangle size={12} /> };
      case 'stopped': return { label: 'Preview stopped', color: '#6b7280', icon: <Square size={12} /> };
      default: return { label: 'Preview idle', color: '#6b7280', icon: <Globe size={12} /> };
    }
  }, [status]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', backgroundColor: 'var(--bg-primary, #0d0e12)' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle, #272a34)',
          backgroundColor: 'var(--bg-secondary, #18191e)',
          flexWrap: 'wrap',
          flexShrink: 0
        }}
      >
        <button
          onClick={() => { void startPreview(); }}
          disabled={starting || !sessionRoot}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(139, 92, 246, 0.16)', color: '#c084fc',
            border: '1px solid rgba(139, 92, 246, 0.35)', borderRadius: 6,
            padding: '4px 10px', fontSize: 11.5, fontWeight: 600,
            cursor: sessionRoot ? 'pointer' : 'not-allowed',
            opacity: sessionRoot ? 1 : 0.55
          }}
        >
          <Globe size={13} />
          {previewUrl ? 'Restart preview' : 'Boot project preview'}
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary, #9ca3af)' }}>
          <input
            type="checkbox"
            checked={inspectMode}
            onChange={(e) => { setInspectMode(e.target.checked); }}
            style={{ accentColor: '#8b5cf6' }}
          />
          <MousePointer2 size={12} />
          Inspect
        </label>

        <button
          onClick={() => { void stopPreview(); }}
          title="Stop preview"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'transparent', color: 'var(--text-secondary, #9ca3af)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 6,
            padding: '4px 10px', fontSize: 11.5, cursor: 'pointer'
          }}
        >
          <Square size={11} />
          Stop
        </button>

        <button
          onClick={handleReloadPreview}
          title="Reload preview"
          style={{
            display: 'flex', alignItems: 'center',
            background: 'transparent', color: 'var(--text-secondary, #9ca3af)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 6,
            padding: '4px 6px', cursor: 'pointer'
          }}
        >
          <RefreshCw size={12} />
        </button>

        <button
          onClick={() => { setSelection(null); setHoverOverlay(null); setSelectionOverlay(null); setHoverOverlay(null); }}
          title="Clear selection"
          style={{
            display: 'flex', alignItems: 'center',
            background: 'transparent', color: 'var(--text-secondary, #9ca3af)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 6,
            padding: '4px 6px', cursor: 'pointer'
          }}
        >
          <Eraser size={12} />
        </button>

        <button
          onClick={() => setShowTreePanel((prev) => !prev)}
          title="Toggle DOM tree"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: showTreePanel ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
            color: showTreePanel ? '#c084fc' : 'var(--text-secondary, #9ca3af)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, cursor: 'pointer'
          }}
        >
          <Layers size={12} /> Tree
        </button>

        <button
          onClick={() => setShowProperties((prev) => !prev)}
          title="Toggle properties"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: showProperties ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
            color: showProperties ? '#c084fc' : 'var(--text-secondary, #9ca3af)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, cursor: 'pointer'
          }}
        >
          <SlidersHorizontal size={12} /> Props
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: statusChip.color, fontWeight: 600 }}>
          {statusChip.icon}
          {statusChip.label}
        </span>
        {status?.state === 'ready' && status.adapter && (
          <span style={{ fontSize: 10.5, color: 'var(--text-muted, #6b7280)' }}>{status.adapter}</span>
        )}
      </div>

      {startError && (
        <div
          style={{
            padding: '8px 12px', fontSize: 11.5, color: '#fca5a5',
            backgroundColor: 'rgba(239, 68, 68, 0.10)', borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          <AlertTriangle size={13} />
          {startError}
        </div>
      )}

      {/* Body: tree rail + webview + properties rail */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {showTreePanel && (
          <div
            style={{
              width: 188, flexShrink: 0, overflow: 'auto',
              backgroundColor: 'var(--bg-secondary, #141519)',
              borderRight: '1px solid var(--border-subtle, #272a34)'
            }}
          >
            <div style={{ padding: '8px 10px 4px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-muted, #6b7280)' }}>LIVE DOM TREE</span>
            </div>
            {treeNodes.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 10.5, color: 'var(--text-muted, #6b7280)' }}>
                Boot the preview to mirror its DOM.
              </div>
            ) : (
              <TreeRows
                nodes={treeNodes}
                selectedSelector={selection?.selector ?? null}
                onSelect={selectFromTree}
              />
            )}
            <StructuralActions selected={selection} onNote={setFooterNote} />
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          {previewUrl ? (
            <webview
              ref={webviewRef}
              src={previewUrl}
              partition="persist:tycode-preview"
              allowpopups={false}
              ondom-ready={handleDomReady}
              style={{
                width: '100%',
                height: '100%',
                display: webviewReady ? 'block' : 'none',
                border: 'none'
              }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Globe size={30} color="rgba(139, 92, 246, 0.5)" />
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #9ca3af)', textAlign: 'center', maxWidth: 320 }}>
                {starting ? 'Booting the workspace previewâ€¦' : 'Boot the project preview to inspect and edit the running UI.'}
              </div>
              <button
                onClick={() => { void startPreview(); }}
                disabled={starting || !sessionRoot}
                style={{
                  background: 'rgba(139, 92, 246, 0.18)', color: '#c084fc',
                  border: '1px solid rgba(139, 92, 246, 0.4)', borderRadius: 8,
                  padding: '7px 16px', fontSize: 12, fontWeight: 600,
                  cursor: sessionRoot ? 'pointer' : 'not-allowed',
                  opacity: sessionRoot ? 1 : 0.55
                }}
              >
                {starting ? 'Bootingâ€¦' : 'Boot preview'}
              </button>
              {!sessionRoot && (
                <span style={{ fontSize: 10.5, color: 'var(--text-muted, #6b7280)' }}>Open a workspace in the Main Editor first.</span>
              )}
            </div>
          )}

          {/* Hover highlight (teal dashed) — transform-only positioning */}
          {hoverOverlay && !dragging && hoverOverlay.selector !== selectionOverlay?.selector && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translate(${hoverOverlay.x}px, ${hoverOverlay.y}px)`,
                width: hoverOverlay.w,
                height: hoverOverlay.h,
                border: '1px dashed #14b8a6',
                borderRadius: 3,
                pointerEvents: 'none',
                zIndex: 4
              }}
            />
          )}

          {/* Selection overlay (violet, transform-only) with resize handles */}
          {selectionOverlay && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translate(${selectionOverlay.x}px, ${selectionOverlay.y}px)`,
                width: selectionOverlay.w,
                height: selectionOverlay.h,
                border: `1.5px solid ${selectionOverlay.accent}`,
                borderRadius: 3,
                pointerEvents: 'none',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.35), inset 0 0 24px rgba(139, 92, 246, 0.08)',
                zIndex: 5
              }}
            >
              {selectionOverlay.label && (
                <span
                  style={{
                    position: 'absolute', top: -17, left: 0,
                    background: selectionOverlay.accent, color: '#0d0e12',
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: '3px 3px 3px 0',
                    maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}
                >
                  {selectionOverlay.label}
                </span>
              )}
              {!dragging && !resizing && (
                <>
                  <div
                    onPointerDown={(event) => beginResize('e', event)}
                    style={{ position: 'absolute', right: -5, top: '20%', bottom: '20%', width: 9, cursor: 'ew-resize', pointerEvents: 'auto' }}
                    title="Drag to resize width"
                  />
                  <div
                    onPointerDown={(event) => beginResize('s', event)}
                    style={{ position: 'absolute', left: '20%', right: '20%', bottom: -5, height: 9, cursor: 'ns-resize', pointerEvents: 'auto' }}
                    title="Drag to resize height"
                  />
                  <div
                    onPointerDown={(event) => beginResize('se', event)}
                    style={{ position: 'absolute', right: -4, bottom: -4, width: 9, height: 9, background: '#8b5cf6', border: '1px solid #c4b5fd', borderRadius: 2, cursor: 'nwse-resize', pointerEvents: 'auto' }}
                    title="Drag to resize"
                  />
                </>
              )}
            </div>
          )}

          {dragging && (
            <div
              style={{
                position: 'absolute', inset: 0,
                backgroundColor: 'rgba(139, 92, 246, 0.05)',
                pointerEvents: 'none', zIndex: 6,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', padding: 6
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, backgroundColor: '#8b5cf6', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>
                movingâ€¦
              </span>
            </div>
          )}
        </div>

        {showProperties && (
          <div
            style={{
              width: 248, flexShrink: 0, overflow: 'auto',
              backgroundColor: 'var(--bg-secondary, #141519)',
              borderLeft: '1px solid var(--border-subtle, #272a34)'
            }}
          >
            <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-muted, #6b7280)' }}>PROPERTIES</span>
              {selection && (
                <button
                  onClick={() => { setSelection(null); setSelectionOverlay(null); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted, #6b7280)', cursor: 'pointer', display: 'flex', padding: 2 }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {!selection ? (
              <div style={{ padding: '10px 12px', fontSize: 10.5, color: 'var(--text-muted, #6b7280)' }}>
                Click any element in the preview to select it.
              </div>
            ) : (
              <div style={{ padding: '6px 10px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: '#a78bfa', overflowWrap: 'anywhere' }}>
                  {selection.selector}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <Chip label={`<${selection.tag}>`} />
                  {selection.componentName && <Chip label={selection.componentName} accent />}
                </div>

                {selection.innerText && (
                  <EditProperty
                    label="Text"
                    value={selection.innerText}
                    commit={applyText}
                    hint="Enter commits a text patch through the Safe Gate."
                  />
                )}

                <PropertyRows record={selection} />

                <EditProperty label="Color" value={selection.styles['color'] ?? ''} type="color" commit={propertySetter('color')} />
                <EditProperty label="Background" value={selection.styles['background-color'] ?? ''} type="color" commit={propertySetter('background-color')} />

                {palette.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted, #6b7280)' }}>DESIGN PROFILE PALETTE</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted, #6b7280)', width: 16 }}>text</span>
                      {palette.map((entry) => (
                        <button
                          key={`fg_${entry.name}_${entry.value}`}
                          type="button"
                          title={`${entry.name}: ${entry.value} — apply as text color`}
                          onClick={() => applyProperty('color', entry.value)}
                          style={{ width: 16, height: 16, padding: 0, background: entry.value, border: '1px solid rgba(255,255,255,0.18)', borderRadius: 3, cursor: 'pointer' }}
                        />
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted, #6b7280)', width: 16 }}>bg</span>
                      {palette.map((entry) => (
                        <button
                          key={`bg_${entry.name}_${entry.value}`}
                          type="button"
                          title={`${entry.name}: ${entry.value} — apply as background`}
                          onClick={() => applyProperty('background-color', entry.value)}
                          style={{ width: 16, height: 16, padding: 0, background: entry.value, border: '1px solid rgba(255,255,255,0.18)', borderRadius: 3, cursor: 'pointer' }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <EditProperty label="Font size" value={selection.styles['font-size'] ?? ''} commit={propertySetter('font-size')} />
                <EditProperty label="Font weight" value={selection.styles['font-weight'] ?? ''} commit={propertySetter('font-weight')} />
                <EditProperty label="Radius" value={selection.styles['border-radius'] ?? ''} commit={propertySetter('border-radius')} />
                <EditProperty label="Padding" value={selection.styles['padding'] ?? ''} commit={propertySetter('padding')} />
                <EditProperty label="Gap" value={selection.styles['gap'] ?? ''} commit={propertySetter('gap')} />
                <EditProperty label="Display" value={selection.styles['display'] ?? ''} commit={propertySetter('display')} />
                <EditProperty label="Flex dir" value={selection.styles['flex-direction'] ?? ''} commit={propertySetter('flex-direction')} />
                <EditProperty label="Align items" value={selection.styles['align-items'] ?? ''} commit={propertySetter('align-items')} />
                <EditProperty label="Justify" value={selection.styles['justify-content'] ?? ''} commit={propertySetter('justify-content')} />
              </div>
            )}
          </div>
        )}
      </div>

      {footerNote && (
        <div style={{ padding: '4px 12px', fontSize: 10.5, color: 'var(--text-muted, #6b7280)', borderTop: '1px solid var(--border-subtle, #272a34)' }}>
          <span>{footerNote}</span>
          <button
            onClick={() => setFooterNote(null)}
            style={{ marginLeft: 6, background: 'transparent', color: '#8b5cf6', border: 'none', cursor: 'pointer', fontSize: 10.5, padding: 0 }}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
};

interface StructuralActionsProps {
  selected: InspectorRecord | null;
  onNote: (note: string | null) => void;
}

const StructuralActions: React.FC<StructuralActionsProps> = ({ selected, onNote }) => {
  const [newName, setNewName] = useState('');
  const dispatch = useCallback(async (payload: {
    operation: 'add' | 'move' | 'delete';
    componentName?: string;
    targetSelector: string;
    value?: string;
  }): Promise<void> => {
    try {
      const response = await window.electronAPI?.dispatchCanvasStructural?.(payload);
      if (response && !response.success) {
        toast.error('Structural edit failed', response.error || 'The canvas agent could not apply the change.');
        return;
      }
      onNote(
        payload.operation === 'delete'
          ? 'Delete request routed to the canvas agent with DesignProfile constraints.'
          : `Add "${payload.componentName ?? 'component'}" routed to the canvas agent.`
      );
    } catch (err) {
      toast.error('Structural edit failed', err instanceof Error ? err.message : String(err));
    }
  }, [onNote]);

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle, #272a34)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-muted, #6b7280)' }}>STRUCTURAL (AGENT-GATED)</span>
      <div style={{ display: 'flex', gap: 5 }}>
        <input
          type="text"
          placeholder="Component name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{
            flex: 1, minWidth: 0,
            fontSize: 10.5, fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--bg-primary, #0d0e12)', color: 'var(--text-primary, #e5e7eb)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 5, padding: '3px 7px',
            outline: 'none'
          }}
        />
        <button
          type="button"
          disabled={!newName.trim() || !selected}
          onClick={() => {
            if (!selected) return;
            void dispatch({ operation: 'add', componentName: newName.trim(), targetSelector: selected.selector });
            setNewName('');
          }}
          style={{
            background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', border: '1px solid rgba(139, 92, 246, 0.35)',
            borderRadius: 5, padding: '3px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            opacity: newName.trim() && selected ? 1 : 0.45
          }}
        >
          add
        </button>
      </div>
      <button
        type="button"
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          void dispatch({ operation: 'delete', targetSelector: selected.selector, componentName: selected.componentName ?? undefined });
        }}
        style={{
          background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: 5, padding: '3px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
          opacity: selected ? 1 : 0.45
        }}
      >
        delete selection
      </button>
      <span style={{ fontSize: 9, color: 'var(--text-muted, #6b7280)' }}>
        Structural requests run through the canvas agent engine with the extracted DesignProfile fence.
      </span>
    </div>
  );
};

const Chip: React.FC<{ label: string; accent?: boolean }> = ({ label, accent }) => (
  <span
    style={{
      fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
      background: accent ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255,255,255,0.06)',
      color: accent ? '#d8b4fe' : 'var(--text-secondary, #9ca3af)',
      border: '1px solid ' + (accent ? 'rgba(168, 85, 247, 0.35)' : 'var(--border-subtle, #272a34)')
    }}
  >
    {label}
  </span>
);

interface EditPropertyProps {
  label: string;
  value: string;
  type?: 'color' | 'text';
  hint?: string;
  commit: (next: string) => void;
}

const EditProperty: React.FC<EditPropertyProps> = ({ label, value, type, hint, commit }) => {
  const cleanType = type ?? 'text';
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted, #6b7280)' }}>{label.toUpperCase()}</span>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {cleanType === 'color' ? (
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(draft) || /^#[0-9a-fA-F]{3}$/.test(draft) ? draft : '#000000'}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 22, height: 20, padding: 0, border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
          />
        ) : null}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft);
          }}
          onBlur={() => {
            if (draft !== value) commit(draft);
          }}
          style={{
            flex: 1, minWidth: 0,
            fontSize: 10.5, fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--bg-primary, #0d0e12)', color: 'var(--text-primary, #e5e7eb)',
            border: '1px solid var(--border-subtle, #272a34)', borderRadius: 5, padding: '3px 7px',
            outline: 'none'
          }}
        />
        {draft !== value ? (
          <button
            type="button"
            onClick={() => commit(draft)}
            style={{
              background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', border: '1px solid rgba(139, 92, 246, 0.35)',
              borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer'
            }}
          >
            set
          </button>
        ) : null}
      </div>
      {hint ? (
        <span style={{ fontSize: 9, color: 'var(--text-muted, #6b7280)' }}>{hint}</span>
      ) : null}
    </div>
  );
};