/**
 * M3E Canvas — Visual Editor (M3E Canvas overhaul)
 *
 * Figma-like 3-pane editor living in the dedicated Canvas window:
 *   Left   — Component Library + Layer Tree (JSON structure of the current UI)
 *   Center — Visual Canvas (custom absolutely-positioned renderer with
 *            drag/resize/selection and per-platform device frames)
 *   Right  — Properties Panel for the selected node
 *
 * Platform changes push `activePlatform` into the shared CanvasSyncManager via
 * the canvas-store auto-sync, so the main IDE window stays in lockstep.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import { copyTextOrNotify, readClipboardText } from '../../lib/clipboard';
import {
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Image as ImageIcon,
  Layers,
  Monitor,
  MousePointer2,
  Palette,
  Plus,
  Sliders,
  Smartphone,
  Square,
  ToggleRight,
  Trash2,
  Type as TypeGlyph,
  X,
  FileCode,
  Sparkles,
  Star,
  Search,
  RotateCw,
  MoreVertical
} from 'lucide-react';
import { ChromePicker } from 'react-color';
import type { ColorResult } from 'react-color';
import {
  findCanvasNode,
  initCanvasRemoteSync,
  initCanvasStoreSync,
  nodeDefaultSize,
  useCanvasStore
} from '../../state/canvas-store';
import type { CanvasNode, CanvasPlatform, CanvasPropValue, CanvasViewportPersist } from '../../state/canvas-store';
import { CanvasViewport, snapToGrid, pickTickStep, ZOOM_PRESETS } from './canvas-viewport';
import type { CanvasBox } from './canvas-viewport';
import {
  CanvasEditController,
  nodeRectOf,
  expandWithDescendants,
  unionRectOfIds
} from './canvas-editing';
import type { AlignKind, GuideLine, ResizeMode, ZOrderMode } from './canvas-editing';
import { canvasEditController } from './canvas-edit-services';
import { findParentPath } from './canvas-history';
import { extractImageCss } from '../../utils/image-to-css';
import type { ImageCssResult } from '../../utils/image-to-css';
import { WorkspaceGate } from '../common/WorkspaceGate';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import { registerContextContributor, registerRendererCommands, refreshCommandContexts } from '../../lib/command-runtime';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useWorkspaceEditStore } from '../../state/workspace-edit-store';
import { toast } from '../../state/toast-store';
import { handleAutoAppliedTransaction } from '../../services/workspace-edit-commands';
import type { DesignProfile, DesignComponent } from '../../../../preload/types';
import type { CanvasExportDialectData } from '../../../../preload/types';
import {
  useCanvasLayoutStore,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  selectLeftWidth,
  selectRightWidth,
  selectLeftCollapsed,
  selectRightCollapsed,
  selectFocusMode,
  selectLeftSections,
  selectRightSections
} from '../../state/canvas-layout-store';
import type { CanvasPanelId, CanvasSectionId } from '../../state/canvas-layout-store';
import { CollapsedRail, PanelHeaderBar, ResizeHandle, SectionShell } from './canvas-panel';
import type { RailItem } from './canvas-panel';
import { getCanvasSettings, setCanvasSettings, subscribeCanvasSettings, canvasThemeVars } from '../../lib/canvas-settings';
import type { CanvasSettings } from '../../lib/canvas-settings';
import {
  getCanvasResponsive,
  setCanvasResponsive,
  subscribeCanvasResponsive,
  resolveResponsiveWidth,
  RESPONSIVE_PRESETS,
  clampCustomWidth
} from '../../lib/canvas-responsive-store';
import type { ResponsiveState } from '../../lib/canvas-responsive-store';
import {
  getLibraryBookmarks,
  toggleFavorite,
  recordRecent,
  subscribeLibraryBookmarks
} from '../../lib/canvas-library-store';
import type { LibraryBookmarks } from '../../lib/canvas-library-store';
import {
  getCanvasTarget,
  setCanvasTarget,
  subscribeCanvasTarget
} from '../../lib/canvas-target-store';
import {
  PLATFORM_REGISTRY,
  CANVAS_TARGET_IDS,
  targetsByGroup,
  dialectLabel,
  defaultTargetPath,
  type CanvasTargetId
} from '../../../../shared/canvas-platform-registry';

// ---------------------------------------------------------------------------
// Platform + library catalogs
// ---------------------------------------------------------------------------

interface PlatformOption {
  value: CanvasPlatform;
  label: string;
  icon: React.ReactNode;
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  { value: 'web', label: 'Web (React/Tailwind)', icon: <Monitor size={13} /> },
  { value: 'react', label: 'Mobile (React Native)', icon: <Smartphone size={13} /> },
  { value: 'flutter', label: 'Mobile (Flutter)', icon: <Smartphone size={13} /> },
  { value: 'swiftui', label: 'Desktop (SwiftUI)', icon: <Monitor size={13} /> }
];

const platformLabel = (value: CanvasPlatform): string =>
  PLATFORM_OPTIONS.find((option) => option.value === value)?.label ?? 'Other';

// The export TARGET (registry) is decoupled from the structural node platform,
// but the coarse chat/AST platform still needs to track a selection so the
// device frame + shared chat stay coherent. New web frameworks (Vue/Svelte/etc.)
// collapse to the 'web' family; Compose shares the mobile phone frame via the
// closest legacy platform. Export itself always uses the precise `CanvasTargetId`.
const platformForTarget = (target: CanvasTargetId): CanvasPlatform => {
  switch (target) {
    case 'react-native':
      return 'react';
    case 'flutter':
    case 'compose':
      return 'flutter';
    case 'swiftui':
      return 'swiftui';
    default:
      return 'web';
  }
};

interface LibraryEntry {
  type: string;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const LIBRARY: LibraryEntry[] = [
  { type: 'container', label: 'Container', color: 'var(--accent-primary)', icon: <Square size={14} /> },
  { type: 'card', label: 'Card', color: 'var(--accent-primary)', icon: <Layers size={14} /> },
  { type: 'button', label: 'Button', color: 'var(--accent-primary)', icon: <MousePointer2 size={14} /> },
  { type: 'text', label: 'Text', color: 'var(--accent-cyan)', icon: <TypeGlyph size={14} /> },
  { type: 'input', label: 'Input', color: 'var(--accent-cyan)', icon: <Sliders size={14} /> },
  { type: 'image', label: 'Image', color: 'var(--accent-amber)', icon: <ImageIcon size={14} /> },
  { type: 'checkbox', label: 'Checkbox', color: 'var(--accent-green)', icon: <Plus size={14} /> },
  { type: 'switch', label: 'Switch', color: 'var(--accent-green)', icon: <ToggleRight size={14} /> },
  { type: 'progress', label: 'Progress', color: 'var(--accent-primary)', icon: <Eye size={14} /> },
  { type: 'divider', label: 'Divider', color: 'var(--text-muted)', icon: <Box size={14} /> }
];

const typeGlyphColor = (type: string): string =>
  LIBRARY.find((entry) => entry.type === type)?.color ?? 'var(--text-muted)';

const DEFAULT_TEXT_COLOR = 'var(--text-primary)';
const CANVAS_GRID_BG =
  'radial-gradient(circle, var(--border-subtle) 1px, transparent 1px)';
// Snap + dot-grid spacing now come from the live Canvas settings (Prompt 2
// Step 4); these fallbacks are used only before the first settings read.
const DEFAULT_SNAP = 8;
const DEFAULT_GRID_SPACING = 24;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const px = (value:unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (props: Record<string, CanvasPropValue>, key: string, fallback = ''): string => {
  const value = props[key];
  return typeof value === 'string' ? value : value !== undefined ? String(value) : fallback;
};

const num = (props: Record<string, CanvasPropValue>, key: string, fallback: number): number => {
  const value = props[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (props: Record<string, CanvasPropValue>, key: string): boolean => Boolean(props[key]);

// ---------------------------------------------------------------------------
// Node preview renderer (per-type approximation)
// ---------------------------------------------------------------------------

const NodeVisual: React.FC<{ node: CanvasNode }> = ({ node }) => {
  const p = node.props;
  const width = num(p, 'width', 120);
  const height = num(p, 'height', 40);
  const bg = str(p, 'color', typeDefaultBackground(node.type));
  const fg = str(p, 'textColor', DEFAULT_TEXT_COLOR);
  const radius = Math.min(num(p, 'borderRadius', typeDefaultRadius(node.type)), Math.min(width, height) / 2);
  const padding = num(p, 'padding', typeDefaultPadding(node.type));
  const fontSize = num(p, 'fontSize', 13);
  const label = str(p, 'text', defaultLabel(node.type));
  const checked = bool(p, 'checked');

  switch (node.type) {
    case 'button':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: bg,
            color: str(p, 'textColor', '#ffffff'),
            borderRadius: radius,
            fontWeight: 600,
            fontSize,
            boxShadow: '0 6px 14px rgba(139, 92, 246, 0.28)',
            whiteSpace: 'nowrap',
            overflow: 'hidden'
          }}
        >
          {label}
        </div>
      );
    case 'input':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${Math.max(8, padding)}px`,
            background: 'var(--surface-2)',
            border: `1px solid ${checked ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
            borderRadius: radius,
            color: 'var(--text-muted)',
            fontSize,
            overflow: 'hidden'
          }}
        >
          {label}
        </div>
      );
    case 'text':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            color: fg,
            fontSize,
            fontWeight: num(p, 'fontWeight', 500),
            lineHeight: 1.25,
            overflow: 'hidden'
          }}
        >
          {label}
        </div>
      );
    case 'image':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: radius,
            overflow: 'hidden',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.55) 0%, rgba(168, 85, 247, 0.45) 100%)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-amber)'
          }}
        >
          <ImageIcon size={Math.min(width, height) / 3} />
        </div>
      );
    case 'checkbox':
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: Math.min(height, 22),
              height: Math.min(height, 22),
              borderRadius: 6,
              border: `1.5px solid ${checked ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
              background: checked ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-green)',
              flexShrink: 0
            }}
          >
            {checked ? '✓' : ''}
          </div>
          {str(p, 'text', '') !== '' && (
            <span style={{ color: fg, fontSize, whiteSpace: 'nowrap' }}>{label}</span>
          )}
        </div>
      );
    case 'switch':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            maxWidth: Math.max(width, 46),
            borderRadius: 999,
            background: checked ? 'rgba(16, 185, 129, 0.35)' : 'var(--border-default)',
            border: `1px solid ${checked ? 'rgba(16, 185, 129, 0.6)' : 'var(--border-subtle)'}`,
            display: 'flex',
            alignItems: 'center',
            padding: 3,
            justifyContent: checked ? 'flex-end' : 'flex-start'
          }}
        >
          <div
            style={{
              width: Math.max(height - 8, 16),
              height: Math.max(height - 8, 16),
              borderRadius: '50%',
              background: checked ? 'var(--accent-green)' : 'var(--text-secondary)',
              boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4)'
            }}
          />
        </div>
      );
    case 'progress':
      const pct = Math.max(0, Math.min(100, num(p, 'value', 60)));
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: 6,
            borderRadius: 999,
            background: 'var(--surface-3)',
            overflow: 'hidden'
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: bg }} />
        </div>
      );
    case 'divider':
      return <div style={{ width: '100%', height: '100%', minHeight: 2, borderRadius: 2, background: bg }} />;
    case 'avatar':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.65) 0%, rgba(99, 102, 241, 0.55) 100%)',
            border: '1.5px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
            fontWeight: 700,
            fontSize: fontSize + 3
          }}
        >
          {label.slice(0, 1).toUpperCase() || 'A'}
        </div>
      );
    default:
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: radius,
            background: bg,
            border: '1px solid var(--border-default)',
            overflow: 'hidden'
          }}
        />
      );
  }
};

const typeDefaultBackground = (type: string): string => {
  switch (type) {
    case 'button': return 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-primary) 100%)';
    case 'progress': return 'linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-primary) 100%)';
    case 'divider': return 'var(--border-default)';
    default: return 'rgba(139, 92, 246, 0.14)';
  }
};

const typeDefaultRadius = (type: string): number => {
  switch (type) {
    case 'container': return 14;
    case 'card': return 16;
    case 'button': return 10;
    case 'input': return 10;
    case 'checkbox': return 6;
    case 'image': return 12;
    default: return 8;
  }
};

const typeDefaultPadding = (type: string): number => (type === 'input' ? 10 : 8);

const defaultLabel = (type: string): string => {
  switch (type) {
    case 'button': return 'Get Started';
    case 'input': return 'Placeholder…';
    case 'text': return 'Sample text';
    case 'checkbox': return 'Remember me';
    case 'avatar': return 'JT';
    default: return '';
  }
};

// ---------------------------------------------------------------------------
// Draggable / resizable node frame (recursive)
// ---------------------------------------------------------------------------

interface NodeFrameProps {
  node: CanvasNode;
  selectionIds: Set<string>;
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
  /** Select this node; `additive` (shift) toggles it in the multi-select set. */
  onSelect: (id: string, additive: boolean) => void;
  /** Begin a group move of the current selection from a pointer-down. */
  onDragStart: (id: string, pointerX: number, pointerY: number) => void;
  /** Double-click: open the inline editor for an editable (text) node. */
  onEdit: (node: CanvasNode) => void;
  /** Current viewport zoom; selection outline divides by it to stay 1px-crisp. */
  scale: number;
  /** Space is held, so a left-drag should pan the stage instead of moving this node. */
  spaceHeld: boolean;
  /** Prompt 4 Step 1: this node is hovered by a library drag → nest-on-drop ring. */
  dropIntoId: string | null;
  /** A library drag entered / moved over this node (dropEffect + highlight). */
  onLibraryDragOverNode: (node: CanvasNode, event: React.DragEvent) => void;
  /** A library drag dropped on this node → nest a new child inside it. */
  onLibraryDropNode: (node: CanvasNode, event: React.DragEvent) => void;
}

const LIBRARY_DRAG_MIME_LOCAL = 'application/x-tycode-library';
const hasLibraryPayload = (event: React.DragEvent): boolean =>
  Array.from(event.dataTransfer.types).includes(LIBRARY_DRAG_MIME_LOCAL);

const NodeFrame: React.FC<NodeFrameProps> = ({ node, selectionIds, lockedIds, hiddenIds, onSelect, onDragStart, onEdit, scale, spaceHeld, dropIntoId, onLibraryDragOverNode, onLibraryDropNode }) => {
  // Hidden nodes render ghosted in the LAYER TREE only — nothing on the stage.
  if (hiddenIds.has(node.id)) return null;
  const isSelected = selectionIds.has(node.id);
  const isLocked = lockedIds.has(node.id);
  const x = Math.round(num(node.props, 'x', 0));
  const y = Math.round(num(node.props, 'y', 0));
  const width = num(node.props, 'width', nodeDefaultSize(node.type).width);
  const height = num(node.props, 'height', nodeDefaultSize(node.type).height);
  // Screen-constant compensation: this whole subtree renders inside the scaled
  // stage, so a 1px value becomes `scale`px on screen. Dividing by scale keeps
  // the outline the same pixel size at 25% and 400% alike.
  const inv = 1 / (scale || 1);

  return (
    <div
      data-node-id={node.id}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).dataset.resizeHandle) return;
        // Space+drag is a stage pan; let the event bubble to the container
        // instead of capturing it as a node move.
        if (spaceHeld) return;
        // A locked node is unselectable — let the click fall through to the
        // stage so it neither selects nor starts a marquee on this node.
        if (isLocked) return;
        event.stopPropagation();
        if (event.shiftKey) {
          // Toggle in the multi-select set; no drag on an additive click.
          onSelect(node.id, true);
          return;
        }
        if (!isSelected) onSelect(node.id, false);
        onDragStart(node.id, event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (isLocked) return;
        onEdit(node);
      }}
      onDragOver={(event) => {
        // Only intercept a library drag; a layer-move drag stays with the tree.
        if (!hasLibraryPayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        onLibraryDragOverNode(node, event);
      }}
      onDrop={(event) => {
        if (!hasLibraryPayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onLibraryDropNode(node, event);
      }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        cursor: spaceHeld ? 'grab' : isLocked ? 'not-allowed' : 'move',
        outline: isSelected ? `${1.5 * inv}px solid var(--accent-primary)` : dropIntoId === node.id ? `${2 * inv}px dashed var(--accent-amber)` : 'none',
        outlineOffset: inv,
        boxShadow: isSelected
          ? `0 0 0 ${4 * inv}px rgba(168, 85, 247, 0.18)`
          : dropIntoId === node.id
            ? `inset 0 0 0 ${2 * inv}px rgba(251, 191, 36, 0.35)`
            : 'none',
        borderRadius: '4px',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      <NodeVisual node={node} />
      {node.children.map((child) => (
        <NodeFrame
          key={child.id}
          node={child}
          selectionIds={selectionIds}
          lockedIds={lockedIds}
          hiddenIds={hiddenIds}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onEdit={onEdit}
          scale={scale}
          spaceHeld={spaceHeld}
          dropIntoId={dropIntoId}
          onLibraryDragOverNode={onLibraryDragOverNode}
          onLibraryDropNode={onLibraryDropNode}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Layer tree (JSON structure)
// ---------------------------------------------------------------------------

type LayerDropMode = 'before' | 'after' | 'inside';

interface LayerRowProps {
  node: CanvasNode;
  depth: number;
  /** Ids of ancestors root→parent ([] = top level); used to compute reparent targets. */
  parentPath: string[];
  selectionIds: Set<string>;
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
  expanded: Set<string>;
  dropTarget: { id: string; mode: LayerDropMode } | null;
  onToggle: (id: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  onToggleLock: (id: string) => void;
  onToggleHide: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onNodeDragStart: (id: string) => void;
  onNodeDragOver: (node: CanvasNode, mode: LayerDropMode) => void;
  onNodeDrop: (node: CanvasNode, parentPath: string[], mode: LayerDropMode) => void;
  onNodeDragEnd: () => void;
  /** Prompt 4 Step 2: layer-tree filter box. A row shows if it or a descendant matches. */
  filter: string;
  /** Prompt 4 Step 2: open the row context menu at (x, y) in client space. */
  onContextMenu: (node: CanvasNode, x: number, y: number) => void;
}

/** True when `node` or any descendant's label matches the (lowercased) query. */
function layerSubtreeMatches(node: CanvasNode, query: string): boolean {
  const label = (node.name || node.type).toLowerCase();
  if (label.includes(query)) return true;
  return node.children.some((child) => layerSubtreeMatches(child, query));
}

const LayerRow: React.FC<LayerRowProps> = ({
  node, depth, parentPath, selectionIds, lockedIds, hiddenIds, expanded, dropTarget,
  onToggle, onSelect, onToggleLock, onToggleHide, onRename,
  onNodeDragStart, onNodeDragOver, onNodeDrop, onNodeDragEnd, filter, onContextMenu
}) => {
  const [hovered, setHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name ?? '');
  const isSelected = selectionIds.has(node.id);
  const isLocked = lockedIds.has(node.id);
  const isHidden = hiddenIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const dropHere = dropTarget?.id === node.id ? dropTarget.mode : null;

  // Filter box: hide rows that neither match nor contain a match, and force a
  // matching branch open so the hit is visible without manual expansion.
  const q = filter.trim().toLowerCase();
  const branchMatch = q ? layerSubtreeMatches(node, q) : true;
  if (q && !branchMatch) return null;
  const isExpanded = expanded.has(node.id) || (q.length > 0 && hasChildren && branchMatch);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== (node.name ?? '')) onRename(node.id, next);
    else setNameDraft(node.name ?? '');
  };

  const resolveMode = (event: React.DragEvent): LayerDropMode => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    if (hasChildren && ratio > 0.3 && ratio < 0.7) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4 + depth * 13,
    paddingRight: 4,
    height: 25,
    borderRadius: 5,
    cursor: isLocked ? 'default' : 'pointer',
    position: 'relative',
    opacity: isHidden ? 0.4 : 1,
    background: isSelected ? 'rgba(168, 85, 247, 0.18)' : hovered ? 'var(--surface-2)' : 'transparent',
    borderTop: dropHere === 'before' ? '2px solid var(--accent-primary)' : '2px solid transparent',
    borderBottom: dropHere === 'after' ? '2px solid var(--accent-primary)' : '2px solid transparent',
    boxShadow: dropHere === 'inside' ? 'inset 0 0 0 1.5px var(--accent-primary)' : 'none',
    fontSize: 10.5
  };

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(event) => onSelect(node.id, event.shiftKey)}
        draggable={!isLocked}
        onDragStart={(event) => {
          if (isLocked) { event.preventDefault(); return; }
          event.dataTransfer.effectAllowed = 'move';
          onNodeDragStart(node.id);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          onNodeDragOver(node, resolveMode(event));
        }}
        onDrop={(event) => {
          event.preventDefault();
          onNodeDrop(node, parentPath, resolveMode(event));
        }}
        onDragEnd={onNodeDragEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event.clientX, event.clientY);
        }}
        style={rowStyle}
      >
        <span
          onClick={(event) => {
            if (hasChildren) {
              event.stopPropagation();
              onToggle(node.id);
            }
          }}
          style={{ width: 14, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        </span>
        <span style={{ color: typeGlyphColor(node.type), display: 'flex', flexShrink: 0 }}>
          {LIBRARY.find((entry) => entry.type === node.type)?.icon ?? <Square size={10} />}
        </span>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              else if (event.key === 'Escape') { setEditingName(false); setNameDraft(node.name ?? ''); }
            }}
            style={{ ...propInputStyle, flex: 1, height: 18, fontSize: 10 }}
          />
        ) : (
          <span
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (isLocked) return;
              setNameDraft(node.name ?? '');
              setEditingName(true);
            }}
            title="Double-click to rename"
            style={{
              color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontWeight: isSelected ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1
            }}
          >
            {node.name || `${node.type[0].toUpperCase()}${node.type.slice(1)}`}
          </span>
        )}
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggleHide(node.id); }}
          title={isHidden ? 'Show on canvas' : 'Hide on canvas'}
          style={layerIconBtn(isHidden ? 'var(--accent-primary)' : 'var(--text-muted)', hovered || isHidden)}
        >
          {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggleLock(node.id); }}
          title={isLocked ? 'Unlock layer' : 'Lock layer'}
          style={layerIconBtn(isLocked ? 'var(--accent-amber)' : 'var(--text-muted)', hovered || isLocked)}
        >
          {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
        </button>
        {hovered && !isLocked && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node.id, false);
              canvasEditController.deleteSelection();
            }}
            title="Remove node"
            style={layerIconBtn('var(--accent-red)', true)}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
      {isExpanded && node.children.map((child) => (
        <LayerRow
          key={child.id}
          node={child}
          depth={depth + 1}
          parentPath={[...parentPath, node.id]}
          selectionIds={selectionIds}
          lockedIds={lockedIds}
          hiddenIds={hiddenIds}
          expanded={expanded}
          dropTarget={dropTarget}
          onToggle={onToggle}
          onSelect={onSelect}
          onToggleLock={onToggleLock}
          onToggleHide={onToggleHide}
          onRename={onRename}
          onNodeDragStart={onNodeDragStart}
          onNodeDragOver={onNodeDragOver}
          onNodeDrop={onNodeDrop}
          onNodeDragEnd={onNodeDragEnd}
          filter={filter}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
};

const layerIconBtn = (color: string, visible: boolean): React.CSSProperties => ({
  background: 'transparent',
  border: 'none',
  color,
  cursor: 'pointer',
  padding: 2,
  display: visible ? 'flex' : 'none',
  flexShrink: 0
});

// Small icon button for the layers toolbar (expand / collapse all).
const layerToolBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 5,
  background: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flexShrink: 0
};

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

const PropRow: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 10.5,
      color: 'var(--text-muted)'
    }}
  >
    <span style={{ width: 64, flexShrink: 0 }}>{label}</span>
    {children}
  </label>
);

const propInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--bg-tertiary)',
  borderRadius: 5,
  color: 'var(--text-primary)',
  fontSize: 10.5,
  padding: '4px 7px',
  outline: 'none'
};

interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  fallbackHex: string;
  projectColors?: Record<string, string>;
}

const ColorField: React.FC<ColorFieldProps> = ({ value, onChange, fallbackHex, projectColors }) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const isUserTypingRef = useRef(false);

  useEffect(() => {
    if (!isUserTypingRef.current) setInputValue(value);
  }, [value]);

  const swatchColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim() : fallbackHex;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 5, minWidth: 0 }}>
      <div style={{ position: 'relative', display: 'flex', gap: 5, alignItems: 'center', width: '100%', minWidth: 0 }}>
        <button
          type="button"
          title="Open color picker"
          onClick={() => setOpen((prev) => !prev)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: swatchColor,
            flexShrink: 0,
            cursor: 'pointer',
            padding: 0
          }}
        />
        {open && (
          <>
            <div
              onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 39 }}
            />
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40 }}>
              <ChromePicker
                color={swatchColor}
                onChangeComplete={(color: ColorResult) => {
                  isUserTypingRef.current = false;
                  onChange(color.hex);
                }}
              />
            </div>
          </>
        )}
        <input
          style={propInputStyle}
          value={inputValue}
          placeholder="var(--accent-primary) | #3b82f6"
          onFocus={() => {
            isUserTypingRef.current = true;
          }}
          onChange={(event) => {
            isUserTypingRef.current = true;
            setInputValue(event.target.value);
            onChange(event.target.value);
          }}
        />
      </div>
      {projectColors && Object.keys(projectColors).length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', width: '100%', marginTop: 2 }}>
          {Object.entries(projectColors).slice(0, 10).map(([name, hex]) => (
            <button
              key={name}
              type="button"
              title={`${name}: ${hex}`}
              onClick={() => {
                isUserTypingRef.current = false;
                setInputValue(hex);
                onChange(hex);
              }}
              style={{
                width: 13,
                height: 13,
                borderRadius: 3,
                background: hex,
                border: inputValue === hex ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Inspector sections (Prompt 2 Step 3) ---------------------------------
// The right panel is no longer one monolith: it is a list of independently
// collapsible / hideable / reorderable sections, ordered by the layout store.
// Counts stay honest — they read the selected node's real props, never a
// placeholder.

const SECTION_TITLE: Record<CanvasSectionId, string> = {
  library: 'Component Library',
  layers: 'Layer Tree',
  properties: 'Properties',
  styles: 'Styles',
  events: 'Events',
  data: 'Data'
};

const SECTION_ICON = (id: CanvasSectionId): React.ReactNode => {
  switch (id) {
    case 'library': return <Plus size={12} />;
    case 'layers': return <Layers size={12} />;
    case 'properties': return <Sliders size={12} />;
    case 'styles': return <Palette size={12} />;
    case 'events': return <MousePointer2 size={12} />;
    case 'data': return <Braces size={12} />;
    default: return <Square size={12} />;
  }
};

const isEventKey = (key: string): boolean => /^on[A-Z]/.test(key);
const eventKeys = (node: CanvasNode): string[] => Object.keys(node.props).filter(isEventKey);
const eventCount = (node: CanvasNode): number =>
  eventKeys(node).filter((k) => String(node.props[k]).length > 0).length;

const STYLE_KEYS = ['color', 'textColor', 'fontSize', 'padding', 'borderRadius'] as const;
const styleCount = (node: CanvasNode): number =>
  STYLE_KEYS.filter((k) => node.props[k] !== undefined).length + 4;

const sectionCount = (id: CanvasSectionId, node: CanvasNode | null): number | undefined => {
  switch (id) {
    case 'events': return node ? eventCount(node) : 0;
    case 'styles': return node ? styleCount(node) : undefined;
    case 'data': return node ? Object.keys(node.props).length : undefined;
    default: return undefined;
  }
};

const inspectorBodyStyle: React.CSSProperties = {
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 9
};

const PropertiesBody: React.FC<{ node: CanvasNode; platform: CanvasPlatform }> = ({ node, platform }) => {
  const updateNodeProps = useCallback(
    (id: string, patch: Record<string, CanvasPropValue>) => canvasEditController.restyle(id, patch, 'Edit property'),
    []
  );
  const p = node.props;
  return (
    <div style={inspectorBodyStyle}>
      <div style={{ paddingBottom: 8, borderBottom: '1px solid var(--bg-tertiary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: typeGlyphColor(node.type) }}>
            {LIBRARY.find((entry) => entry.type === node.type)?.icon ?? <Square size={12} />}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            {node.name || node.type}
          </span>
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--text-secondary)', marginTop: 2 }}>
          id #{node.id.slice(-8)} • {platformLabel(platform)}
        </div>
      </div>
      <PropRow label="text">
        <input
          style={propInputStyle}
          value={str(p, 'text')}
          onChange={(event) => updateNodeProps(node.id, { text: event.target.value })}
        />
      </PropRow>
      {node.type === 'checkbox' || node.type === 'switch' ? (
        <PropRow label="checked">
          <input
            type="checkbox"
            checked={bool(p, 'checked')}
            onChange={(event) => updateNodeProps(node.id, { checked: event.target.checked })}
            style={{ accentColor: 'var(--accent-primary)' }}
          />
        </PropRow>
      ) : null}
      {node.type === 'progress' ? (
        <PropRow label="value">
          <input
            type="number"
            min={0}
            max={100}
            style={propInputStyle}
            value={num(p, 'value', 60)}
            onChange={(event) => updateNodeProps(node.id, { value: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
          />
        </PropRow>
      ) : null}
    </div>
  );
};

const StylesBody: React.FC<{ node: CanvasNode; designProfile: DesignProfile | null }> = ({ node, designProfile }) => {
  const updateNodeProps = useCallback(
    (id: string, patch: Record<string, CanvasPropValue>) => canvasEditController.restyle(id, patch, 'Edit property'),
    []
  );
  const p = node.props;
  const numField = (key: string): number => {
    const value = p[key];
    return typeof value === 'number' ? value : Number(value) || 0;
  };
  return (
    <div style={inspectorBodyStyle}>
      <PropRow label="color">
        <ColorField
          value={str(p, 'color')}
          fallbackHex={typeDefaultBackground(node.type)}
          projectColors={designProfile?.colors}
          onChange={(next) => updateNodeProps(node.id, { color: next })}
        />
      </PropRow>
      <PropRow label="textColor">
        <ColorField
          value={str(p, 'textColor')}
          fallbackHex={DEFAULT_TEXT_COLOR}
          projectColors={designProfile?.colors}
          onChange={(next) => updateNodeProps(node.id, { textColor: next })}
        />
      </PropRow>
      <PropRow label="fontSize">
        <input
          type="number"
          style={propInputStyle}
          value={num(p, 'fontSize', 13)}
          onChange={(event) => updateNodeProps(node.id, { fontSize: Number(event.target.value) || 13 })}
        />
      </PropRow>
      <PropRow label="padding">
        <input
          type="number"
          style={propInputStyle}
          value={numField('padding') || typeDefaultPadding(node.type)}
          onChange={(event) => updateNodeProps(node.id, { padding: Number(event.target.value) || 0 })}
        />
      </PropRow>
      <PropRow label="borderRadius">
        <input
          type="number"
          style={propInputStyle}
          value={num(p, 'borderRadius', typeDefaultRadius(node.type))}
          onChange={(event) => updateNodeProps(node.id, { borderRadius: Number(event.target.value) || 0 })}
        />
      </PropRow>
      {(['x', 'y', 'width', 'height'] as const).map((key) => (
        <PropRow key={key} label={key}>
          <input
            type="number"
            style={propInputStyle}
            value={Math.round(num(p, key, key === 'x' || key === 'y' ? 0 : nodeDefaultSize(node.type)[key]))}
            onChange={(event) => updateNodeProps(node.id, { [key]: Number(event.target.value) || 0 })}
          />
        </PropRow>
      ))}
    </div>
  );
};

const EventsBody: React.FC<{ node: CanvasNode }> = ({ node }) => {
  const updateNodeProps = useCallback(
    (id: string, patch: Record<string, CanvasPropValue>) => canvasEditController.restyle(id, patch, 'Edit property'),
    []
  );
  const [name, setName] = useState('');
  const [handler, setHandler] = useState('');
  const p = node.props;
  const keys = eventKeys(node);
  const pascal = (raw: string): string =>
    raw.trim().replace(/[^a-zA-Z0-9]/g, '').replace(/^(.)/, (_m, c: string) => c.toUpperCase());

  const add = () => {
    const key = `on${pascal(name)}`;
    if (name.trim().length === 0 || key === 'on') return;
    updateNodeProps(node.id, { [key]: handler.trim() || 'onClick' });
    setName('');
    setHandler('');
  };

  return (
    <div style={inspectorBodyStyle}>
      {keys.length === 0 ? (
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          No events bound. Add an interaction (e.g. tap → navigate) to record it on this node.
        </div>
      ) : (
        keys.map((key) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--accent-primary)', minWidth: 62 }}>{key}</span>
            <input
              style={propInputStyle}
              value={str(p, key)}
              onChange={(event) => updateNodeProps(node.id, { [key]: event.target.value })}
            />
            <button
              type="button"
              title={`Clear ${key}`}
              onClick={() => updateNodeProps(node.id, { [key]: '' })}
              style={{ display: 'flex', padding: 3, border: 'none', background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer' }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))
      )}
      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
        <input
          style={{ ...propInputStyle, maxWidth: 78 }}
          placeholder="tap"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          style={propInputStyle}
          placeholder="handler / action"
          value={handler}
          onChange={(event) => setHandler(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
        />
        <button
          type="button"
          onClick={add}
          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--bg-tertiary)', background: 'var(--surface-2)', color: 'var(--accent-primary)', fontSize: 10, cursor: 'pointer' }}
        >
          <Plus size={11} /> Bind
        </button>
      </div>
    </div>
  );
};

const DataBody: React.FC<{ node: CanvasNode }> = ({ node }) => (
  <div style={inspectorBodyStyle}>
    <pre
      style={{
        margin: 0,
        padding: 8,
        borderRadius: 6,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--bg-tertiary)',
        color: 'var(--text-muted)',
        fontSize: 9.5,
        lineHeight: 1.45,
        overflowX: 'auto',
        whiteSpace: 'pre'
      }}
    >
      {JSON.stringify(
        {
          id: node.id,
          type: node.type,
          platform: node.platform,
          props: node.props,
          ...(node.children.length > 0 ? { children: '[…]' } : {})
        },
        null,
        2
      )}
    </pre>
  </div>
);

const InspectorEmpty: React.FC = () => (
  <div style={{ padding: '18px 12px', fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
    <Sliders size={16} color="var(--text-secondary)" style={{ marginBottom: 10 }} />
    <div style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Inspector</div>
    Select a node on the canvas or in the layer tree to edit its properties, styles, events and data.
  </div>
);

interface InspectorSectionsProps {
  node: CanvasNode | null;
  platform: CanvasPlatform;
  designProfile: DesignProfile | null;
}

// Multi-inspector: shows the properties every selected node SHARES (a field is
// blank when the selection disagrees on it). Editing a field applies it to all
// selected nodes, each as its own undoable restyle command.
const MultiInspector: React.FC<{ ids: string[]; nodes: CanvasNode[] }> = ({ ids, nodes }) => {
  const selected = ids
    .map((id) => findCanvasNode(nodes, id))
    .filter((n): n is CanvasNode => Boolean(n));
  const shared = (key: string): CanvasPropValue | undefined => {
    if (selected.length === 0) return undefined;
    const first = selected[0].props[key];
    return selected.every((n) => n.props[key] === first) ? first : undefined;
  };
  const applyAll = (patch: Record<string, CanvasPropValue>) => {
    for (const n of selected) canvasEditController.restyle(n.id, patch, 'Edit shared property');
  };
  return (
    <div style={inspectorBodyStyle}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', paddingBottom: 6, borderBottom: '1px solid var(--bg-tertiary)' }}>
        {selected.length} layers selected
      </div>
      <PropRow label="text">
        <input
          style={propInputStyle}
          placeholder={shared('text') === undefined ? 'mixed' : ''}
          value={typeof shared('text') === 'string' ? (shared('text') as string) : ''}
          onChange={(event) => applyAll({ text: event.target.value })}
        />
      </PropRow>
      <PropRow label="color">
        <input
          style={propInputStyle}
          placeholder={shared('color') === undefined ? 'mixed' : ''}
          value={typeof shared('color') === 'string' ? (shared('color') as string) : ''}
          onChange={(event) => applyAll({ color: event.target.value })}
        />
      </PropRow>
      <PropRow label="fontSize">
        <input
          type="number"
          style={propInputStyle}
          placeholder={shared('fontSize') === undefined ? 'mixed' : ''}
          value={typeof shared('fontSize') === 'number' ? (shared('fontSize') as number) : ''}
          onChange={(event) => applyAll({ fontSize: Number(event.target.value) || 0 })}
        />
      </PropRow>
      <PropRow label="opacity">
        <input
          type="number"
          step={0.1}
          min={0}
          max={1}
          style={propInputStyle}
          placeholder={shared('opacity') === undefined ? 'mixed' : ''}
          value={typeof shared('opacity') === 'number' ? (shared('opacity') as number) : ''}
          onChange={(event) => applyAll({ opacity: Math.max(0, Math.min(1, Number(event.target.value))) })}
        />
      </PropRow>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Use the floating toolbar to align, distribute and reorder these layers.
      </div>
    </div>
  );
};

const InspectorSections: React.FC<InspectorSectionsProps> = ({ node, platform, designProfile }) => {
  const rightSections = useCanvasLayoutStore(selectRightSections);
  const toggleSectionCollapsed = useCanvasLayoutStore((s) => s.toggleSectionCollapsed);
  const setSectionVisible = useCanvasLayoutStore((s) => s.setSectionVisible);
  const moveSection = useCanvasLayoutStore((s) => s.moveSection);
  const dragRef = useRef<{ id: CanvasSectionId } | null>(null);

  if (!node) return <InspectorEmpty />;

  const visible = rightSections.filter((section) => section.visible);
  return (
    <>
      {visible.map((section) => (
        <SectionShell
          key={section.id}
          title={SECTION_TITLE[section.id]}
          icon={SECTION_ICON(section.id)}
          count={sectionCount(section.id, node)}
          collapsed={section.collapsed}
          onToggleCollapse={() => toggleSectionCollapsed('right', section.id)}
          onHide={() => setSectionVisible('right', section.id, false)}
          dragProps={{
            onDragStart: () => { dragRef.current = { id: section.id }; },
            onDragOver: (event) => event.preventDefault(),
            onDrop: () => {
              const dragged = dragRef.current;
              if (dragged) moveSection('right', dragged.id, section.id);
              dragRef.current = null;
            }
          }}
        >
          {section.id === 'properties' && <PropertiesBody node={node} platform={platform} />}
          {section.id === 'styles' && <StylesBody node={node} designProfile={designProfile} />}
          {section.id === 'events' && <EventsBody node={node} />}
          {section.id === 'data' && <DataBody node={node} />}
        </SectionShell>
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// Device frame (platform preview chrome)
// ---------------------------------------------------------------------------

interface FrameSpec {
  width: number | 'fill';
  height: number | 'fill';
  titlebar: React.ReactNode;
  contentPadTop: number;
  scale: boolean;
}

const FrameForPlatform = (platform: CanvasPlatform): FrameSpec => {
  switch (platform) {
    case 'react':
    case 'flutter':
      return {
        width: 390,
        height: 780,
        contentPadTop: 26,
        scale: true,
        titlebar: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', fontSize: 9.5, color: 'var(--text-muted)' }}>
            <span>9:41</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <span style={{ width: 18, height: 8, borderRadius: 3, background: 'var(--surface-3)' }} />
              <span style={{ width: 18, height: 8, borderRadius: 3, background: 'var(--surface-3)' }} />
            </span>
          </div>
        )
      };
    case 'swiftui':
      return {
        width: 920,
        height: 600,
        contentPadTop: 0,
        scale: true,
        titlebar: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)' }}>MainActivity.swift — Preview</span>
          </div>
        )
      };
    default:
      return {
        width: 'fill',
        height: 'fill',
        contentPadTop: 0,
        scale: false,
        titlebar: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#28c840' }} />
            <span
              style={{
                marginLeft: 6,
                flex: 1,
                maxWidth: 320,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'var(--surface-2)',
                fontSize: 9.5,
                color: 'var(--text-muted)'
              }}
            >
              localhost:3000 — preview
            </span>
          </div>
        )
      };
  }
};

/**
 * The device frame's box in canvas units, for the viewport's content bounds.
 * Fixed frames (react / flutter / swiftui) report their point size; fill frames
 * (web / other) fill the container, so their canvas box is the container minus
 * the 40px gutter the stage already lays out. Reads the live platform through
 * the store so it stays correct regardless of when a viewport effect runs.
 */
const deviceBoxFor = (containerWidth: number, containerHeight: number): CanvasBox => {
  const frame = FrameForPlatform(useCanvasStore.getState().activePlatform);
  const fill = frame.width === 'fill';
  return {
    x: 0,
    y: 0,
    width: fill ? Math.max(1, containerWidth - 40) : (frame.width as number),
    height: fill ? Math.max(1, containerHeight - 40) : (frame.height as number)
  };
};

// ---------------------------------------------------------------------------
// Component library panel
// ---------------------------------------------------------------------------

interface LibraryPanelProps {
  onAdd: (type: string, name?: string, props?: Record<string, CanvasPropValue>) => void;
  designProfile?: DesignProfile | null;
  /** Per-workspace storage key for favorites / recents. */
  workspaceId: string;
  bookmarks: LibraryBookmarks;
  onToggleFavorite: (id: string) => void;
}

// The custom drag ghost for a library item: a floating component-shaped chip.
// HTML5 DnD snapshots whatever element we hand `setDragImage`, so we build one
// on the fly, position it off-screen, and remove it after the frame paints.
const LIBRARY_DRAG_MIME = 'application/x-tycode-library';
function beginLibraryDrag(
  event: React.DragEvent,
  payload: { type: string; name?: string; props?: Record<string, CanvasPropValue>; label: string; color: string }
): void {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
  // Fallback payload so the drop still works if a browser hides custom types.
  event.dataTransfer.setData('text/plain', payload.label);
  const ghost = document.createElement('div');
  ghost.textContent = payload.label;
  ghost.style.cssText =
    `position:fixed;top:-1000px;left:-1000px;padding:6px 10px;border-radius:7px;` +
    `font:600 11px system-ui;white-space:nowrap;pointer-events:none;` +
    `color:${payload.color};background:var(--surface-2,#1b1d23);` +
    `border:1px solid ${payload.color};box-shadow:0 8px 22px rgba(0,0,0,.5)`;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  window.setTimeout(() => ghost.remove(), 0);
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({ onAdd, designProfile, bookmarks, onToggleFavorite }) => {
  const [query, setQuery] = useState('');
  const projectComponents = designProfile?.components || [];
  const q = query.trim().toLowerCase();
  const matches = (label: string): boolean => !q || label.toLowerCase().includes(q);

  const byId = new Map<string, { type: string; name?: string; props?: Record<string, CanvasPropValue>; label: string; color: string; sourceFile?: string }>();
  for (const comp of projectComponents) {
    byId.set(comp.name, {
      type: comp.name.toLowerCase(),
      name: comp.name,
      props: { importPath: comp.importPath, library: designProfile?.uiLibrary || '' },
      label: comp.name,
      color: 'var(--accent-primary)',
      sourceFile: comp.sourceFile || comp.importPath
    });
  }
  for (const entry of LIBRARY) {
    byId.set(entry.type, { type: entry.type, label: entry.label, color: entry.color });
  }

  const renderRow = (id: string, compact: boolean) => {
    const item = byId.get(id);
    if (!item || !matches(item.label)) return null;
    const starred = bookmarks.favorites.includes(id);
    return (
      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          draggable
          onDragStart={(event) => beginLibraryDrag(event, item)}
          onClick={() => onAdd(item.type, item.name, item.props)}
          title={item.sourceFile ? `Add ${item.label} · ${item.sourceFile} (drag onto a container to nest)` : `Add ${item.label} (drag onto a container to nest)`}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: compact ? '4px 7px' : '6px 8px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: `1px solid ${item.color === 'var(--accent-primary)' ? 'rgba(168, 85, 247, 0.3)' : 'var(--border-subtle)'}`,
            color: 'var(--text-primary)',
            fontSize: 10,
            cursor: 'grab',
            textAlign: 'left',
            overflow: 'hidden'
          }}
        >
          <span style={{ color: item.color, display: 'flex', flexShrink: 0 }}>
            <Box size={11} />
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(id)}
          title={starred ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flexShrink: 0, borderRadius: 5, cursor: 'pointer',
            border: 'none', background: 'transparent',
            color: starred ? 'var(--accent-amber)' : 'var(--text-muted)'
          }}
        >
          <Star size={11} fill={starred ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  const favoriteIds = bookmarks.favorites.filter((id) => byId.has(id));
  const recentIds = bookmarks.recents.filter((id) => byId.has(id));
  const projectIds = projectComponents.map((c) => c.name);
  const primitiveIds = LIBRARY.map((e) => e.type);

  return (
    <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
      {/* Search spans BOTH library groups (Project components + primitives). */}
      <div style={{ position: 'relative' }}>
        <Search size={11} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search components…"
          style={{ ...propInputStyle, paddingLeft: 22, width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {favoriteIds.length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 5, letterSpacing: '0.4px' }}>FAVORITES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{favoriteIds.map((id) => renderRow(id, true))}</div>
        </div>
      )}
      {recentIds.length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: '0.4px' }}>RECENTLY USED</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{recentIds.map((id) => renderRow(id, true))}</div>
        </div>
      )}

      {projectIds.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 9.5, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 6,
              letterSpacing: '0.4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
          >
            <span>PROJECT: {designProfile?.uiLibrary || 'COMPONENTS'}</span>
            <span style={{ fontSize: 8.5, padding: '1px 5px', borderRadius: 999, background: 'rgba(168, 85, 247, 0.18)', color: 'var(--accent-primary)' }}>
              {projectIds.filter((id) => matches(byId.get(id)!.label)).length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {projectIds.map((id) => renderRow(id, false))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.4px' }}>BASE PRIMITIVES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {primitiveIds.map((id) => renderRow(id, false))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Project-native code generator for Safe Edit Review Gate
// ---------------------------------------------------------------------------

export function generateProjectNativeCode(
  nodes: CanvasNode[],
  platform: CanvasPlatform,
  designProfile: DesignProfile | null,
  componentName = 'GeneratedComponent'
): string {
  const isAppRouter = designProfile?.routerType === 'app-router' || designProfile?.framework === 'Next.js';
  const uiLibrary = designProfile?.uiLibrary;

  let code = '';
  if (isAppRouter && (platform === 'web' || platform === 'other')) {
    code += `'use client';\n\n`;
  }

  code += `import React from 'react';\n`;

  const usedProjectComponents = new Set<string>();

  function collectNodes(nodeList: CanvasNode[]) {
    for (const node of nodeList) {
      const match = designProfile?.components?.find(
        (c) => c.name.toLowerCase() === (node.name || node.type).toLowerCase()
      );
      if (match) {
        usedProjectComponents.add(match.name);
      }
      if (node.children && node.children.length > 0) {
        collectNodes(node.children);
      }
    }
  }

  if (uiLibrary === 'shadcn/ui' && designProfile?.components) {
    collectNodes(nodes);
    for (const compName of usedProjectComponents) {
      code += `import { ${compName} } from '@/components/ui/${compName.toLowerCase()}';\n`;
    }
  } else if (uiLibrary === 'Material UI') {
    const muiImports: string[] = [];
    function collectMui(nodeList: CanvasNode[]) {
      for (const node of nodeList) {
        if (node.type === 'button') muiImports.push('Button');
        if (node.type === 'card') muiImports.push('Card', 'CardContent');
        if (node.type === 'input') muiImports.push('TextField');
        if (node.children && node.children.length > 0) collectMui(node.children);
      }
    }
    collectMui(nodes);
    if (muiImports.length > 0) {
      code += `import { ${Array.from(new Set(muiImports)).join(', ')} } from '@mui/material';\n`;
    }
  }

  code += `\nexport default function ${componentName}() {\n`;
  code += `  return (\n`;
  code += `    <div className="relative w-full min-h-[500px] bg-background text-foreground p-6 rounded-xl border border-border shadow-sm">\n`;

  function renderNodeJsx(node: CanvasNode, indent = '      '): string {
    const p = node.props;
    const text = String(p.text || '');
    const color = p.color ? String(p.color) : '';
    const textColor = p.textColor ? String(p.textColor) : '';
    const styleObj: Record<string, string | number> = {};
    if (p.x !== undefined && p.y !== undefined) {
      styleObj.position = 'absolute';
      styleObj.left = `${p.x}px`;
      styleObj.top = `${p.y}px`;
    }
    if (p.width) styleObj.width = `${p.width}px`;
    if (p.height) styleObj.height = `${p.height}px`;
    if (color && !color.startsWith('var(')) styleObj.background = color;
    if (textColor && !textColor.startsWith('var(')) styleObj.color = textColor;

    const styleAttr = Object.keys(styleObj).length > 0
      ? ` style={${JSON.stringify(styleObj)}}`
      : '';

    const lowerType = node.type.toLowerCase();
    const isStandard = ['button', 'card', 'input', 'text', 'image', 'container'].includes(lowerType);
    const isCustomProjectComp = designProfile?.components?.some((c) => c.name.toLowerCase() === lowerType);

    if (!isStandard && isCustomProjectComp) {
      const compName = designProfile?.components?.find((c) => c.name.toLowerCase() === lowerType)?.name || node.name || 'Component';
      return `${indent}<${compName}${styleAttr}>${text || ''}${node.children.map((c) => renderNodeJsx(c, indent + '  ')).join('')}</${compName}>\n`;
    }

    switch (lowerType) {
      case 'button':
        if (usedProjectComponents.has('Button')) {
          return `${indent}<Button className="bg-primary text-primary-foreground font-semibold"${styleAttr}>${text || 'Button'}</Button>\n`;
        }
        return `${indent}<button className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"${styleAttr}>${text || 'Button'}</button>\n`;
      case 'card':
        if (usedProjectComponents.has('Card')) {
          return `${indent}<Card className="rounded-xl border bg-card text-card-foreground shadow"${styleAttr}>\n${indent}  <div className="p-6">${text ? `<h3 className="font-semibold text-lg mb-2">${text}</h3>\n` : ''}${node.children.map((c) => renderNodeJsx(c, indent + '    ')).join('')}${indent}  </div>\n${indent}</Card>\n`;
        }
        return `${indent}<div className="rounded-xl border border-border bg-card p-6 shadow-sm"${styleAttr}>\n${indent}  <h3 className="font-semibold text-lg mb-2">${text || 'Card Title'}</h3>\n${node.children.map((c) => renderNodeJsx(c, indent + '  ')).join('')}${indent}</div>\n`;
      case 'input':
        if (usedProjectComponents.has('Input')) {
          return `${indent}<Input placeholder="${text || 'Enter value...'}" className="w-full max-w-sm rounded-md border border-input bg-background"${styleAttr} />\n`;
        }
        return `${indent}<input type="text" placeholder="${text || 'Enter text...'}" className="px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"${styleAttr} />\n`;
      case 'text':
        return `${indent}<p className="text-sm text-foreground"${styleAttr}>${text || 'Sample Text'}</p>\n`;
      case 'image':
        return `${indent}<div className="rounded-lg bg-muted flex items-center justify-center overflow-hidden"${styleAttr}>\n${indent}  <span className="text-xs text-muted-foreground">Image Placeholder</span>\n${indent}</div>\n`;
      default:
        return `${indent}<div className="rounded-lg bg-card border border-border"${styleAttr}>\n${node.children.map((c) => renderNodeJsx(c, indent + '  ')).join('')}${indent}</div>\n`;
    }
  }

  for (const rootNode of nodes) {
    code += renderNodeJsx(rootNode);
  }

  code += `    </div>\n`;
  code += `  );\n`;
  code += `}\n`;

  return code;
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zoom / options menu row (viewport cluster)
// ---------------------------------------------------------------------------

const MenuItemRow: React.FC<{
  label: string;
  onClick: () => void;
  active?: boolean;
  toggle?: boolean;
}> = ({ label, onClick, active, toggle }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '5px 8px',
      border: 'none',
      background: active ? 'var(--surface-3)' : 'transparent',
      color: 'var(--text-primary)',
      fontSize: 11,
      cursor: 'pointer',
      borderRadius: 4,
      textAlign: 'left'
    }}
  >
    <span>{label}</span>
    {toggle && (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: active ? 'var(--accent-primary)' : 'var(--border-default)'
        }}
      />
    )}
  </button>
);

export const M3ECanvas: React.FC = () => {
  const isWorkspaceReady = useWorkspaceStore((state) => state.isWorkspaceReady);
  const workspaceRoot = useWorkspaceStore((state) => state.workspaceRoot || state.workspacePath);
  const nodes = useCanvasStore((state) => state.nodes);
  const activePlatform = useCanvasStore((state) => state.activePlatform);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const lockedIds = useCanvasStore((state) => state.lockedIds);
  const hiddenIds = useCanvasStore((state) => state.hiddenIds);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const { setPlatform, clearCanvas, selectNode } = useCanvasStore.getState();
  const { attachSurface, detachSurface } = useWorkspaceSessionStore();

  useEffect(() => {
    attachSurface('canvas');
    return () => detachSurface('canvas');
  }, [attachSurface, detachSurface]);

  // Unified gesture state for group-move and bbox-resize. `movingIds` is the
  // full set dragged (selection + descendants); `startRects` snapshots each
  // moving node's layout box so the live transform is computed from the origin.
  const [dragState, setDragState] = useState<{
    kind: 'move' | 'resize';
    pointerAX: number;
    pointerAY: number;
    movingIds: string[];
    startRects: Record<string, { x: number; y: number; width: number; height: number }>;
    bbox: { x: number; y: number; width: number; height: number };
    handle?: ResizeMode;
  } | null>(null);
  // Smart guides rendered while a move/resize snaps (canvas-unit lines).
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);
  // Marquee rectangle in canvas units, drawn while dragging on empty stage.
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  // Current device/content box in canvas units (assigned during render); the
  // drag effect reads stage center from here so guides stay zoom-correct.
  const stageBoxRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  // Layer-tree drag-reorder bookkeeping.
  const [layerDrag, setLayerDrag] = useState<{ dragId: string; drop: { id: string; mode: LayerDropMode } | null } | null>(null);
  // Inline overlay editor for a text node's content (double-click).
  const [inlineEdit, setInlineEdit] = useState<{ id: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  // --- Viewport controller (Prompt 1) -------------------------------------
  const viewportRef = useRef<CanvasViewport | null>(null);
  if (!viewportRef.current) viewportRef.current = new CanvasViewport();
  const viewport = viewportRef.current;
  // Read initial chrome state once; do NOT subscribe (setViewport fires on every
  // pan/zoom and would re-render the whole editor).
  const persistedViewport = useRef<CanvasViewportPersist>(useCanvasStore.getState().viewport).current;
  const [, bumpViewport] = useReducer((n: number) => n + 1, 0);
  const viewportReadyRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);
  // Viewport chrome toggles + snap (persisted in the canvas store on Step 4).
  const [gridVisible, setGridVisible] = useState(persistedViewport.grid);
  const [rulersVisible, setRulersVisible] = useState(persistedViewport.rulers);
  const [minimapVisible, setMinimapVisible] = useState(persistedViewport.minimap);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  // --- Layout customization (Prompt 2) ------------------------------------
  // Atomic store selectors: a width change re-renders the panes, a focus toggle
  // re-renders the chrome, a section toggle re-renders just its panel.
  const leftWidth = useCanvasLayoutStore(selectLeftWidth);
  const rightWidth = useCanvasLayoutStore(selectRightWidth);
  const leftCollapsed = useCanvasLayoutStore(selectLeftCollapsed);
  const rightCollapsed = useCanvasLayoutStore(selectRightCollapsed);
  const focusMode = useCanvasLayoutStore(selectFocusMode);
  const leftSections = useCanvasLayoutStore(selectLeftSections);
  const rightSections = useCanvasLayoutStore(selectRightSections);
  // Live canvas defaults (grid size, snap tolerance, chrome theme, panel
  // widths). Read from localStorage now; kept fresh through a subscription so an
  // edit in the main-window Settings modal lands here without a restart.
  const [canvasSettings, setCanvasSettingsState] = useState<CanvasSettings>(() => getCanvasSettings());
  const settingsRef = useRef<CanvasSettings>(canvasSettings);
  // Tracks which section header is mid-drag for reorder within its panel.
  const dragSectionRef = useRef<{ panel: CanvasPanelId; id: CanvasSectionId } | null>(null);
  // Persist the live transform (and a patch of chrome toggles) to the canvas
  // store, which debounces the localStorage write and keeps it out of the
  // node-sync push. Marking `saved` so the next open restores instead of fitting.
  const persistViewport = useCallback(
    (patch: Partial<CanvasViewportPersist>) => {
      useCanvasStore.getState().setViewport({
        scale: viewport.scale,
        tx: viewport.tx,
        ty: viewport.ty,
        saved: true,
        ...patch
      });
    },
    [viewport]
  );
  // Drag/resize effect reads the snap flag through a ref so holding a modifier
  // mid-drag picks it up without re-subscribing the pointermove listener.
  const snapEnabledRef = useRef(false);
  const deviceExportRef = useRef<HTMLDivElement>(null);
  const cssFileInputRef = useRef<HTMLInputElement>(null);
  const [imageCss, setImageCss] = useState<ImageCssResult | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [copiedCss, setCopiedCss] = useState(false);
  const [designProfile, setDesignProfile] = useState<DesignProfile | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [targetFilePath, setTargetFilePath] = useState('src/components/GeneratedCanvasView.tsx');
  const [targetCompName, setTargetCompName] = useState('GeneratedCanvasView');
  const [isApplyingToWorkspace, setIsApplyingToWorkspace] = useState(false);

  // --- Prompt 4 state -----------------------------------------------------
  // Per-workspace library bookmarks (favorites + recents) and per-document
  // responsive preview, both read live through the same storage-event pattern
  // the canvas settings use, so cross-window writes update this window too.
  const docId = workspaceRoot || '__no-workspace__';
  const [bookmarks, setBookmarks] = useState<LibraryBookmarks>(() => getLibraryBookmarks(docId));
  const [responsive, setResponsive] = useState<ResponsiveState>(() => getCanvasResponsive(docId));
  const [libraryDropIntoId, setLibraryDropIntoId] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState('');
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number; node: CanvasNode } | null>(null);
  const [showChromeMenu, setShowChromeMenu] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);

  // Prompt 4 extension: per-document dialect-export target (registry id), kept
  // independent of the structural `activePlatform`. A switch cancels any
  // in-flight export (amendment 4) so an orphaned spinner never outlives a target.
  const [activeTarget, setActiveTarget] = useState<CanvasTargetId>(() => getCanvasTarget(docId));
  const currentExportRequestIdRef = useRef<string | null>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);

  useEffect(() => subscribeLibraryBookmarks(docId, setBookmarks), [docId]);
  useEffect(() => subscribeCanvasResponsive(docId, setResponsive), [docId]);
  useEffect(() => subscribeCanvasTarget(docId, setActiveTarget), [docId]);

  // The responsive width drives the stage root (and, in the live host, the
  // <webview>). Recompute content bounds + reframe when it changes.
  useEffect(() => {
    if (!viewportReadyRef.current) return;
    const element = centerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    viewport.setContent(deviceBoxFor(rect.width, rect.height));
    viewport.fitToContent();
    bumpViewport();
  }, [responsive, viewport]);

  // Close any transient overlay (context menu / chrome menu) on outside click.
  useEffect(() => {
    if (!layerMenu && !showChromeMenu && !showBgPicker && !targetMenuOpen) return;
    const dismiss = () => {
      setLayerMenu(null);
      setShowChromeMenu(false);
      setShowBgPicker(false);
      setTargetMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [layerMenu, showChromeMenu, showBgPicker, targetMenuOpen]);

  // Fetch project design profile (Tailwind colors, UI components) on open
  useEffect(() => {
    let active = true;
    if (window.electronAPI?.getDesignProfile) {
      window.electronAPI.getDesignProfile(workspaceRoot).then((res) => {
        if (active && res.success && res.data) {
          setDesignProfile(res.data);
        }
      }).catch((err) => {
        console.warn('[M3ECanvas] Failed to load design profile:', err);
      });
    }
    return () => { active = false; };
  }, [workspaceRoot]);

  // Wire the store into the main-process CanvasSyncManager, only when workspace is ready.
  useEffect(() => {
    if (!isWorkspaceReady || !workspaceRoot) return;
    const stopPush = initCanvasStoreSync();
    const stopRemote = initCanvasRemoteSync();
    return () => {
      stopPush();
      stopRemote();
    };
  }, [isWorkspaceReady, workspaceRoot]);

  // Keep the viewport's client-space origin + size synced to the stage
  // container, publish the device box as the content bounds, and frame it once
  // the container has a real size. The stage does not scroll (pan replaces
  // scroll), so `origin` only moves on layout / resize, which ResizeObserver
  // also catches when the canvas window itself is resized.
  useEffect(() => {
    const element = centerRef.current;
    if (!element) return;
    const sync = () => {
      const rect = element.getBoundingClientRect();
      viewport.setOrigin(rect.left, rect.top);
      viewport.setSize(rect.width, rect.height);
      viewport.setContent(deviceBoxFor(rect.width, rect.height));
      if (!viewportReadyRef.current && rect.width > 0 && rect.height > 0) {
        viewportReadyRef.current = true;
        const isEmpty = useCanvasStore.getState().nodes.length === 0;
        if (persistedViewport.saved && !isEmpty) {
          viewport.restore(persistedViewport);
        } else if (Math.abs(settingsRef.current.defaultZoom - 1) > 0.001) {
          // Fresh / empty document + an explicit default zoom: honor the zoom but
          // center the device so it does not sit pinned to the top-left.
          viewport.setScale(settingsRef.current.defaultZoom);
          viewport.centerContent();
        } else {
          viewport.fitToContent();
        }
      }
      bumpViewport();
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport, persistedViewport]);

  // Reframe when the platform changes the device size.
  useEffect(() => {
    if (!viewportReadyRef.current) return;
    const element = centerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    viewport.setContent(deviceBoxFor(rect.width, rect.height));
    viewport.fitToContent();
  }, [activePlatform, viewport]);

  useEffect(() => {
    viewport.onChange = () => {
      bumpViewport();
      persistViewport({});
    };
    return () => { viewport.onChange = undefined; };
  }, [viewport, persistViewport]);

  // Wheel / trackpad: ctrl (or a trackpad pinch, which Chromium reports as a
  // ctrlKey wheel) zooms at the cursor; plain wheel pans vertically; shift+wheel
  // pans horizontally. Registered non-passive because every branch preventDefaults
  // to stop the window's own zoom / scroll. Removed on unmount.
  useEffect(() => {
    const element = centerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        viewport.zoomAt({ x: event.clientX, y: event.clientY }, Math.exp(-event.deltaY * 0.0015));
      } else if (event.shiftKey) {
        viewport.panBy(-(event.deltaY || event.deltaX), 0);
      } else {
        viewport.panBy(0, -event.deltaY);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [viewport]);

  // Touchscreen pinch-to-zoom + two-finger pan. A trackpad pinch already arrives
  // as a ctrlKey wheel (handled above); a real touch screen reports multi-touch,
  // so we track two pointers: their distance drives zoom (anchored at the
  // midpoint) and their midpoint drift pans. Non-passive so the browser does not
  // hijack the gesture as a page scroll / pinch-zoom of the whole window.
  useEffect(() => {
    const element = centerRef.current;
    if (!element) return;
    let gesture: { dist: number; cx: number; cy: number } | null = null;
    const spread = (touches: TouchList): { dist: number; cx: number; cy: number } => ({
      dist: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY),
      cx: (touches[0].clientX + touches[1].clientX) / 2,
      cy: (touches[0].clientY + touches[1].clientY) / 2
    });
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        gesture = spread(event.touches);
      } else {
        gesture = null;
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !gesture) return;
      event.preventDefault();
      const now = spread(event.touches);
      if (gesture.dist > 0) {
        viewport.zoomAt({ x: gesture.cx, y: gesture.cy }, now.dist / gesture.dist);
      }
      viewport.panBy(now.cx - gesture.cx, now.cy - gesture.cy);
      gesture = now;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) gesture = null;
    };
    element.addEventListener('touchstart', onTouchStart, { passive: false });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [viewport]);

  // Space toggles grab-to-pan. Suppressed while typing so holding space in a
  // property field never arms pan mode.
  useEffect(() => {
    const isSafeTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && isSafeTarget(event.target)) {
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setSpaceHeld(true);
        }
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Active stage pan: window-level move/up so the grab keeps working even when
  // the cursor leaves the canvas rectangle.
  useEffect(() => {
    if (!isPanning) return;
    const move = (event: PointerEvent) => {
      const point = panRef.current;
      if (!point) return;
      viewport.panBy(event.clientX - point.lastX, event.clientY - point.lastY);
      point.lastX = event.clientX;
      point.lastY = event.clientY;
    };
    const up = () => {
      panRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [isPanning, viewport]);

  // Mirror the snap toggle into the ref the drag loop reads.
  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  // Live Canvas settings (Prompt 2 Step 4). A write from the main-window
  // Settings modal fires in this window through the storage event; when the
  // document has no saved viewport we also adopt the chrome-toggle defaults so
  // "grid / rulers / minimap by default" applies to a fresh canvas.
  useEffect(() => {
    return subscribeCanvasSettings((next) => {
      settingsRef.current = next;
      setCanvasSettingsState(next);
      if (!persistedViewport.saved) {
        setGridVisible(next.gridDefault);
        setRulersVisible(next.rulersDefault);
        setMinimapVisible(next.minimapDefault);
      }
    });
  }, [persistedViewport]);

  // Narrow window: collapse both panels ONCE (with a hint toast), then respect
  // the user's manual choices for the rest of the session.
  useEffect(() => {
    const NARROW = 900;
    let lastBelow = window.innerWidth < NARROW;
    const onResize = () => {
      const below = window.innerWidth < NARROW;
      if (below && !lastBelow) {
        const store = useCanvasLayoutStore.getState();
        if (!store.autoCollapsedOnce) {
          store.setPanelCollapsed('left', true);
          store.setPanelCollapsed('right', true);
          store.markAutoCollapsed();
          toast.info(
            'Narrow window',
            'Sketcher panels collapsed for more canvas. Ctrl+Alt+[ and Ctrl+Alt+] bring them back.'
          );
        }
      }
      lastBelow = below;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc leaves focus mode, restoring the exact panels + chrome that were visible
  // before (focus mode never mutates collapsed state).
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        useCanvasLayoutStore.getState().setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusMode]);

  // Contribute `canvasActive` while the design stage is mounted, so the
  // registry-driven View rows appear and their chords fire in THIS window only.
  useEffect(() => {
    const contributor = registerContextContributor(() => ({ canvasActive: true }));
    return () => contributor.dispose();
  }, []);

  // Back the `canvas.*` commands with the live viewport + the editing
  // controller. Re-registering when a toggle flips is cheap (dispose + add) and
  // keeps each handler closing over the current grid / rulers / minimap state.
  // Every editing command routes through `canvasEditController`, whose history
  // is the one stack Ctrl+Z / Ctrl+Shift+Z walk.
  useEffect(() => {
    const commands = registerRendererCommands({
      'canvas.zoomIn': () => viewport.zoomStep(1),
      'canvas.zoomOut': () => viewport.zoomStep(-1),
      'canvas.zoomReset': () => viewport.reset100(),
      'canvas.zoomFit': () => viewport.fitToContent(),
      'canvas.toggleGrid': () => {
        const next = !gridVisible;
        setGridVisible(next);
        persistViewport({ grid: next });
      },
      'canvas.toggleRulers': () => {
        const next = !rulersVisible;
        setRulersVisible(next);
        persistViewport({ rulers: next });
      },
      'canvas.toggleMinimap': () => {
        const next = !minimapVisible;
        setMinimapVisible(next);
        persistViewport({ minimap: next });
      },
      'canvas.toggleLeftPanel': () => useCanvasLayoutStore.getState().togglePanel('left'),
      'canvas.toggleRightPanel': () => useCanvasLayoutStore.getState().togglePanel('right'),
      'canvas.focusMode': () => useCanvasLayoutStore.getState().toggleFocusMode(),
      // Editing core (Prompt 3). Undo / redo walk the session command stack.
      'canvas.undo': () => canvasEditController.undo(),
      'canvas.redo': () => canvasEditController.redo(),
      // Clipboard (internal canvas-node JSON; paste offsets by 16).
      'canvas.copy': () => canvasEditController.copySelection(),
      'canvas.cut': () => canvasEditController.cutSelection(),
      'canvas.duplicate': () => canvasEditController.duplicateSelection(),
      'canvas.paste': async () => {
        // Prefer the OS clipboard payload when it is ours; otherwise the
        // controller's internal clipboard (survives within the session).
        const read = await readClipboardText('canvas-layers');
        canvasEditController.paste(read.ok ? read.text : undefined);
      },
      // Selection model.
      'canvas.selectAll': () => useCanvasStore.getState().selectAllTopLevel(),
      'canvas.deselect': () => useCanvasStore.getState().clearSelection(),
      // Align / distribute (pure math lives in canvas-geometry).
      'canvas.align': (args) => canvasEditController.align(String(args.kind) as AlignKind),
      'canvas.distribute': (args) =>
        canvasEditController.distribute(String(args.axis) === 'v' ? 'v' : 'h'),
      // Grouping.
      'canvas.group': () => canvasEditController.groupSelection(),
      'canvas.ungroup': () => canvasEditController.ungroupSelection(),
      // Z-order.
      'canvas.bringToFront': () => canvasEditController.zorder('front'),
      'canvas.bringForward': () => canvasEditController.zorder('forward'),
      'canvas.sendBackward': () => canvasEditController.zorder('backward'),
      'canvas.sendBack': () => canvasEditController.zorder('back')
    });
    return () => commands.dispose();
  }, [viewport, persistViewport, gridVisible, rulersVisible, minimapVisible]);

  // Delete removes the whole selection (subtrees collapse to their top-most
  // selected root once). Skipped while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (useCanvasStore.getState().selectedNodeIds.length === 0) return;
      event.preventDefault();
      canvasEditController.deleteSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  const handleSelect = useCallback((id: string, additive: boolean) => {
    const store = useCanvasStore.getState();
    if (additive) store.toggleSelect(id);
    else store.selectNode(id);
  }, []);

  // Snapshot every moving node's layout box (selection expanded to include
  // descendants) and open one coalescing gesture. Clicking a node that is not
  // in the current selection collapses the selection to it first.
  const beginGesture = useCallback(
    (kind: 'move' | 'resize', nodeIds: string[], pointerX: number, pointerY: number, handle?: ResizeMode) => {
      const tree = useCanvasStore.getState().nodes;
      const movingIds = expandWithDescendants(tree, nodeIds);
      const startRects: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const id of movingIds) {
        const n = findCanvasNode(tree, id);
        if (n) startRects[id] = nodeRectOf(n);
      }
      const bbox = unionRectOfIds(tree, nodeIds) ?? startRects[movingIds[0]] ?? { x: 0, y: 0, width: 0, height: 0 };
      canvasEditController.beginPositionsGesture(movingIds, kind === 'move' ? 'Move' : 'Resize');
      setDragState({ kind, pointerAX: pointerX, pointerAY: pointerY, movingIds, startRects, bbox, handle });
    },
    []
  );

  const handleDragStart = useCallback((id: string, pointerX: number, pointerY: number) => {
    const store = useCanvasStore.getState();
    const selected = store.selectedNodeIds;
    const nodeIds = selected.includes(id) ? selected : [id];
    if (!selected.includes(id)) store.selectNode(id);
    beginGesture('move', nodeIds, pointerX, pointerY);
  }, [beginGesture]);

  const handleResizeStart = useCallback((handle: ResizeMode, pointerX: number, pointerY: number) => {
    const nodeIds = useCanvasStore.getState().selectedNodeIds;
    if (nodeIds.length === 0) return;
    beginGesture('resize', nodeIds, pointerX, pointerY, handle);
  }, [beginGesture]);

  // Double-click a text node to open the inline content editor overlay.
  const handleNodeDoubleClick = useCallback((node: CanvasNode) => {
    if (node.type !== 'text') return;
    setInlineEdit({ id: node.id, value: str(node.props, 'text', node.name || 'Text') });
  }, []);

  // Commit / cancel the inline text editor (Enter or blur commits, Esc cancels).
  const commitInlineEdit = useCallback(() => {
    setInlineEdit((current) => {
      if (current) canvasEditController.restyle(current.id, { text: current.value }, 'Edit text');
      return null;
    });
  }, []);

  const handleLayerRename = useCallback((id: string, name: string) => {
    canvasEditController.rename(id, name);
  }, []);
  const handleToggleLock = useCallback((id: string) => useCanvasStore.getState().toggleLock(id), []);
  const handleToggleHide = useCallback((id: string) => useCanvasStore.getState().toggleHide(id), []);

  // Layer-tree drag-reorder: the drop resolves to a reparent (into a container)
  // or a sibling insertion; both run through the controller's history so the
  // move undoes exactly (index adjustment for same-parent moves lives there).
  const handleLayerDragStart = useCallback((id: string) => setLayerDrag({ dragId: id, drop: null }), []);
  const handleLayerDragOver = useCallback((node: CanvasNode, mode: LayerDropMode) => {
    setLayerDrag((prev) => (prev ? { ...prev, drop: { id: node.id, mode } } : prev));
  }, []);
  const handleLayerDrop = useCallback((node: CanvasNode, parentPath: string[], mode: LayerDropMode) => {
    const drag = layerDrag;
    setLayerDrag(null);
    if (!drag || drag.dragId === node.id) return;
    const tree = useCanvasStore.getState().nodes;
    if (mode === 'inside') {
      canvasEditController.reparent(drag.dragId, [...parentPath, node.id], 0);
      return;
    }
    const siblings =
      parentPath.length === 0
        ? tree
        : findCanvasNode(tree, parentPath[parentPath.length - 1])?.children ?? [];
    const idx = siblings.findIndex((s) => s.id === node.id);
    if (idx < 0) return;
    canvasEditController.reparent(drag.dragId, parentPath, mode === 'before' ? idx : idx + 1);
  }, [layerDrag]);
  const handleLayerDragEnd = useCallback(() => setLayerDrag(null), []);

  // Marquee selection on empty stage: a left-drag draws a canvas-unit rectangle
  // and live-selects the top-level nodes it fully encloses (locked excluded).
  // The coordinates come from the viewport's zoom/pan helpers, so the marquee
  // picks exactly the visually-enclosed nodes at any zoom (50% smoke test).
  const beginMarquee = useCallback((startClientX: number, startClientY: number) => {
    const start = viewport.screenToCanvas(startClientX, startClientY);
    marqueeStartRef.current = start;
    setMarquee({ x: start.x, y: start.y, width: 0, height: 0 });
    const move = (event: PointerEvent) => {
      const origin = marqueeStartRef.current;
      if (!origin) return;
      const cur = viewport.screenToCanvas(event.clientX, event.clientY);
      const box = {
        x: Math.min(origin.x, cur.x),
        y: Math.min(origin.y, cur.y),
        width: Math.abs(cur.x - origin.x),
        height: Math.abs(cur.y - origin.y)
      };
      setMarquee(box);
      const store = useCanvasStore.getState();
      store.setSelection(CanvasEditController.marqueeHits(store.nodes, box, store.lockedIds));
    };
    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const origin = marqueeStartRef.current;
      marqueeStartRef.current = null;
      setMarquee(null);
      // A press without a real drag reads as a click on empty canvas: clear.
      const moved = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
      if (origin && moved < 3) useCanvasStore.getState().clearSelection();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [viewport]);

  useEffect(() => {
    if (!dragState) return;
    const s = viewport.scale || 1;
    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - dragState.pointerAX) / s;
      const dy = (event.clientY - dragState.pointerAY) / s;
      const patch: Record<string, Record<string, CanvasPropValue>> = {};
      if (dragState.kind === 'move') {
        const tolerance = snapEnabledRef.current ? settingsRef.current.snapTolerance : DEFAULT_SNAP;
        const stage = stageBoxRef.current;
        const movingBox = {
          x: dragState.bbox.x + dx,
          y: dragState.bbox.y + dy,
          width: dragState.bbox.width,
          height: dragState.bbox.height
        };
        // Smart guides: nudge the whole group to the nearest sibling/stage edge
        // or center within tolerance, and surface the guide lines while active.
        const snap = canvasEditController.snapDrag(movingBox, new Set(dragState.movingIds), stage, tolerance);
        let ox = dx + snap.dx;
        let oy = dy + snap.dy;
        if (snapEnabledRef.current && snap.guides.length === 0) {
          ox = snapToGrid(ox, settingsRef.current.gridSpacing);
          oy = snapToGrid(oy, settingsRef.current.gridSpacing);
        }
        ox = Math.max(-dragState.bbox.x, ox);
        oy = Math.max(-dragState.bbox.y, oy);
        setActiveGuides(snap.guides);
        for (const id of dragState.movingIds) {
          const r = dragState.startRects[id];
          if (!r) continue;
          patch[id] = { x: Math.max(0, Math.round(r.x + ox)), y: Math.max(0, Math.round(r.y + oy)) };
        }
        canvasEditController.applyLive(patch);
        return;
      }
      // Resize: drag the bbox edge/corner, then transform every moving node
      // (and its subtree) proportionally from the start box to the new box.
      const b0 = dragState.bbox;
      const handle = dragState.handle ?? 'se';
      let nx = b0.x;
      let ny = b0.y;
      let nw = b0.width;
      let nh = b0.height;
      if (handle.includes('w')) { nx = b0.x + dx; nw = b0.width - dx; }
      if (handle.includes('e')) { nw = b0.width + dx; }
      if (handle.includes('n')) { ny = b0.y + dy; nh = b0.height - dy; }
      if (handle.includes('s')) { nh = b0.height + dy; }
      // Shift locks the aspect ratio of the ORIGINAL box.
      if (event.shiftKey && b0.width > 0 && b0.height > 0) {
        const ratio = b0.width / b0.height;
        if (handle !== 'n' && handle !== 's') nh = Math.max(10, nw / ratio);
        else nw = Math.max(16, nh * ratio);
      }
      nw = Math.max(16, nw);
      nh = Math.max(10, nh);
      // Alt resizes about the box center (opposite corner mirrors).
      if (event.altKey) {
        const cx = b0.x + b0.width / 2;
        const cy = b0.y + b0.height / 2;
        nx = cx - nw / 2;
        ny = cy - nh / 2;
      }
      const sx = b0.width > 0 ? nw / b0.width : 1;
      const sy = b0.height > 0 ? nh / b0.height : 1;
      for (const id of dragState.movingIds) {
        const r = dragState.startRects[id];
        if (!r) continue;
        patch[id] = {
          x: Math.round(nx + (r.x - b0.x) * sx),
          y: Math.round(ny + (r.y - b0.y) * sy),
          width: Math.max(4, Math.round(r.width * sx)),
          height: Math.max(4, Math.round(r.height * sy))
        };
      }
      canvasEditController.applyLive(patch);
    };
    const onUp = () => {
      canvasEditController.commitPositions(dragState.kind, dragState.kind === 'move' ? 'Move' : 'Resize');
      setActiveGuides([]);
      setDragState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, viewport]);

  // Arrow keys nudge the selection by 1 canvas px (Shift → 10), zoom-independent
  // because the controller writes absolute canvas-unit props. Esc clears the
  // selection (and closes any inline editor / marquee).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === 'Escape') {
        if (typing) return;
        useCanvasStore.getState().clearSelection();
        setMarquee(null);
        setInlineEdit(null);
        return;
      }
      if (typing) return;
      if (useCanvasStore.getState().selectedNodeIds.length === 0) return;
      const stepPx = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case 'ArrowLeft': event.preventDefault(); canvasEditController.nudge(-stepPx, 0); break;
        case 'ArrowRight': event.preventDefault(); canvasEditController.nudge(stepPx, 0); break;
        case 'ArrowUp': event.preventDefault(); canvasEditController.nudge(0, -stepPx); break;
        case 'ArrowDown': event.preventDefault(); canvasEditController.nudge(0, stepPx); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedNode = useMemo(
    () => (selectedNodeId ? findCanvasNode(nodes, selectedNodeId) : null),
    [nodes, selectedNodeId]
  );

  const handleAdd = useCallback(
    (type: string, name?: string, props?: Record<string, CanvasPropValue>) => {
      // Route creation through the editing controller so an add is one undoable
      // `add` command, then select the fresh layer and note the recent.
      const id = canvasEditController.addLayer({ type, name, props });
      useCanvasStore.getState().selectNode(id);
      recordRecent(docId, name ?? type);
    },
    [docId]
  );

  // --- Prompt 4 Step 1: library favorites + drag-to-nest --------------------
  const handleToggleFavorite = useCallback((id: string) => {
    setBookmarks(toggleFavorite(docId, id));
  }, [docId]);

  const readLibraryPayload = (event: React.DragEvent): { type: string; name?: string; props?: Record<string, CanvasPropValue> } | null => {
    try {
      const raw = event.dataTransfer.getData(LIBRARY_DRAG_MIME);
      if (!raw) return null;
      return JSON.parse(raw) as { type: string; name?: string; props?: Record<string, CanvasPropValue> };
    } catch {
      return null;
    }
  };

  const handleLibraryDragOverNode = useCallback((node: CanvasNode) => {
    setLibraryDropIntoId(node.id);
  }, []);

  const handleLibraryDropNode = useCallback((node: CanvasNode, event: React.DragEvent) => {
    setLibraryDropIntoId(null);
    const payload = readLibraryPayload(event);
    if (!payload) return;
    // Nesting targets a container: any node with children or an explicit
    // container/frame is a valid parent; otherwise fall back to a top-level add.
    const canHost = node.type === 'container' || node.children.length > 0;
    if (canHost) {
      const id = canvasEditController.addLayerInto(node.id, payload);
      if (id) {
        useCanvasStore.getState().selectNode(id);
        recordRecent(docId, payload.name ?? payload.type);
        return;
      }
    }
    handleAdd(payload.type, payload.name, payload.props);
  }, [docId, handleAdd]);

  // A drop on the empty stage (not over a node) adds at the top level.
  const handleStageDrop = useCallback((event: React.DragEvent) => {
    setLibraryDropIntoId(null);
    if (!hasLibraryPayload(event)) return;
    event.preventDefault();
    const payload = readLibraryPayload(event);
    if (!payload) return;
    handleAdd(payload.type, payload.name, payload.props);
  }, [handleAdd]);

  // --- Prompt 4 Step 2: layer tree context menu + expand/collapse all -------
  const handleLayerContextMenu = useCallback((node: CanvasNode, x: number, y: number) => {
    useCanvasStore.getState().selectNode(node.id);
    setLayerMenu({ x, y, node });
  }, []);

  const runOnLayer = useCallback((id: string, action: () => void) => {
    useCanvasStore.getState().selectNode(id);
    action();
    setLayerMenu(null);
  }, []);

  const expandAllLayers = useCallback(() => {
    const next = new Set<string>();
    const walk = (list: CanvasNode[]): void => {
      for (const n of list) {
        if (n.children.length > 0) next.add(n.id);
        walk(n.children);
      }
    };
    walk(useCanvasStore.getState().nodes);
    setExpanded(next);
  }, []);

  const collapseAllLayers = useCallback(() => setExpanded(new Set<string>()), []);

  // --- Prompt 4 Step 3: responsive preview ----------------------------------
  const applyPreset = useCallback((preset: ResponsiveState['preset']) => {
    setResponsive(setCanvasResponsive(docId, { preset }));
  }, [docId]);
  const setCustomWidth = useCallback((width: number) => {
    setResponsive(setCanvasResponsive(docId, { preset: 'custom', customWidth: clampCustomWidth(width) }));
  }, [docId]);
  const toggleOrientation = useCallback(() => {
    setResponsive(setCanvasResponsive(docId, { orientation: responsive.orientation === 'portrait' ? 'landscape' : 'portrait' }));
  }, [docId, responsive.orientation]);
  const resolvedResponsiveWidth = resolveResponsiveWidth(responsive);

  // --- Prompt 4 extension: dialect-export target ---------------------------
  // Selecting a registry target persists it per document, resolves the device
  // frame (through the coarse chat/AST platform it maps to), aborts any
  // in-flight export, and syncs the default export path. The AST is untouched.
  const handleTargetChange = useCallback((target: CanvasTargetId) => {
    const next = setCanvasTarget(docId, target);
    setActiveTarget(next);
    setPlatform(platformForTarget(next));
    setTargetMenuOpen(false);
    const inflight = currentExportRequestIdRef.current;
    if (inflight) {
      void window.electronAPI?.canvasExportCancel?.(inflight);
      currentExportRequestIdRef.current = null;
    }
    const name = targetCompName.trim() || 'GeneratedCanvasView';
    setTargetFilePath(defaultTargetPath(next, name));
  }, [docId, setPlatform, targetCompName]);

  // Ask main for the target's dialect (agent -> validate -> retry -> skeleton).
  // Returns null when the run was cancelled so callers stay silent (amendment 4).
  const runDialectExport = useCallback(async (): Promise<CanvasExportDialectData | null> => {
    const componentName = targetCompName.trim() || 'GeneratedCanvasView';
    const requestId = `exp_${Date.now()}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const api = window.electronAPI;
    if (!api?.canvasExportDialect) {
      // No preload bridge: fall back to the local React projection so export still
      // produces a reviewable file instead of silently failing.
      return {
        code: generateProjectNativeCode(nodes, activePlatform, designProfile, componentName),
        language: 'tsx',
        dialectLabel: dialectLabel(activeTarget),
        source: 'skeleton',
        note: 'baseline dialect (local)'
      };
    }
    currentExportRequestIdRef.current = requestId;
    try {
      const res = await api.canvasExportDialect({
        requestId,
        targetId: activeTarget,
        nodes,
        componentName,
        workspaceRoot: workspaceRoot || docId
      });
      if (res?.success && res.data) return res.data;
      if (res?.error === 'Export cancelled') return null;
      throw new Error(res?.error || 'Dialect export failed.');
    } finally {
      if (currentExportRequestIdRef.current === requestId) currentExportRequestIdRef.current = null;
    }
  }, [nodes, activeTarget, activePlatform, designProfile, targetCompName, workspaceRoot, docId]);

  const handleApplyToWorkspace = useCallback(async () => {
    setIsApplyingToWorkspace(true);
    try {
      const dialect = await runDialectExport();
      if (!dialect) {
        toast.info('Export cancelled', 'The dialect export was cancelled before it reached review.');
        return;
      }
      const generatedCode = dialect.code;

      let originalText = '';
      try {
        const readRes = await window.electronAPI.readFile(targetFilePath);
        if (readRes.success && typeof readRes.data === 'string') {
          originalText = readRes.data;
        }
      } catch {
        originalText = '';
      }

      const request = {
        filePath: targetFilePath,
        lineNumber: 1,
        originalText,
        replacementText: generatedCode,
        title: `Apply Canvas UI · ${dialect.dialectLabel}`,
        forcePreview: true
      };

      const response = await window.electronAPI.previewSnippetEdit(request);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Could not create workspace edit preview.');
      }

      if (response.data.applied) {
        handleAutoAppliedTransaction(response.data.applied);
        toast.success('Applied to File', `Updated ${targetFilePath}`);
        setShowApplyModal(false);
      } else if (response.data.preview) {
        useWorkspaceEditStore.getState().setRequest({
          preview: response.data.preview,
          isStale: false,
          refresh: async () => {
            const refreshed = await window.electronAPI.previewSnippetEdit({ ...request, forcePreview: true });
            if (!refreshed.success || !refreshed.data?.preview) {
              throw new Error(refreshed.error || 'Could not refresh edit preview.');
            }
            return refreshed.data.preview;
          }
        });
        toast.info('Review Generated UI', 'Review the diff before confirming file changes.');
        setShowApplyModal(false);
      }

      // Honest labeling: an offline/keyless run yields the deterministic baseline.
      if (dialect.source === 'skeleton' && dialect.note) {
        toast.info('Baseline dialect', `${dialect.note} — no model route was available; the deterministic output is in review.`);
      }
    } catch (err: unknown) {
      toast.error('Could not apply UI to file', err instanceof Error ? err.message : String(err));
    } finally {
      setIsApplyingToWorkspace(false);
    }
  }, [runDialectExport, targetFilePath]);

  // Prompt 4 Step 4: "Copy code" runs the SAME dialect service as export but
  // routes the text through the unified clipboard service — no disk write.
  const handleCopyCode = useCallback(async () => {
    const dialect = await runDialectExport();
    if (!dialect) {
      toast.info('Export cancelled', 'The dialect export was cancelled.');
      return;
    }
    const result = await copyTextOrNotify(dialect.code, 'canvas.export-code');
    if (result.ok) {
      const suffix = dialect.source === 'skeleton' ? ' (baseline dialect)' : '';
      toast.success('Code copied', `${dialect.dialectLabel}${suffix} is on your clipboard.`);
    }
  }, [runDialectExport]);

  // Prompt 4 Step 5: chrome theme + canvas background. Persisted in the canvas
  // settings (their own key), so they stay independent of the app theme.
  const setChromeTheme = useCallback((theme: CanvasSettings['chromeTheme']) => {
    setCanvasSettingsState(setCanvasSettings({ chromeTheme: theme }));
  }, []);
  const setAccentColor = useCallback((color: string) => {
    setCanvasSettingsState(setCanvasSettings({ accentColor: color }));
  }, []);
  const setBackgroundColor = useCallback((color: string) => {
    setCanvasSettingsState(setCanvasSettings({ backgroundColor: color }));
  }, []);

  const handleExportPng = useCallback(async () => {
    const target = deviceExportRef.current;
    if (!target) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(target, { pixelRatio: 2, backgroundColor: 'var(--bg-primary)' });
      const link = document.createElement('a');
      link.download = `m3e-canvas-${activePlatform}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err: unknown) {
      console.warn('PNG export failed:', err);
    }
  }, [activePlatform]);

  const handleImagePicked = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setIsProcessingImage(true);
    setImageCss(null);
    try {
      const result = await extractImageCss(file);
      setImageCss(result);
    } catch (err: unknown) {
      console.warn('Image → CSS extraction failed:', err);
    } finally {
      setIsProcessingImage(false);
      if (cssFileInputRef.current) cssFileInputRef.current.value = '';
    }
  }, []);

  const handleCopyCss = useCallback(async () => {
    if (!imageCss) return;
    if ((await copyTextOrNotify(imageCss.cssSource, 'canvas.generated-css')).ok) {
      setCopiedCss(true);
      window.setTimeout(() => setCopiedCss(false), 2200);
    }
  }, [imageCss]);

  const handleApplyPalette = useCallback(() => {
    if (!imageCss || !selectedNode) return;
    canvasEditController.restyle(selectedNode.id, {
      color: imageCss.gradient,
      textColor: imageCss.textColor
    }, 'Apply palette');
  }, [imageCss, selectedNode]);

  const frame = FrameForPlatform(activePlatform);
  const frameIsFill = frame.width === 'fill';
  // Prompt 4 Step 3: a responsive preset overrides the stage root width in BOTH
  // fill and fixed frames, so the design surface matches the live preview.
  const baseDeviceWidth = frameIsFill ? (centerRef.current?.clientWidth ?? 800) - 40 : (frame.width as number);
  const deviceWidth = resolvedResponsiveWidth ?? baseDeviceWidth;
  const deviceHeight = frameIsFill ? (centerRef.current?.clientHeight ?? 600) - 40 : (frame.height as number);

  // Selection breadcrumb (Step 2): root→node ancestor labels for the primary
  // selected layer, each clickable to re-select that ancestor.
  const breadcrumb = useMemo(() => {
    if (!selectedNodeId) return [] as { id: string; label: string }[];
    const path = findParentPath(nodes, selectedNodeId) ?? [];
    const chain = [...path, selectedNodeId];
    return chain
      .map((id) => {
        const n = findCanvasNode(nodes, id);
        return n ? { id, label: n.name || `${n.type[0].toUpperCase()}${n.type.slice(1)}` } : null;
      })
      .filter((x): x is { id: string; label: string } => Boolean(x));
  }, [nodes, selectedNodeId]);

  // Membership sets for the multi-select / lock / hide editing model.
  const selectionIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const lockedIdSet = useMemo(() => new Set(lockedIds), [lockedIds]);
  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  // Combined bounding box of the whole selection (descendants included). It is
  // recomputed from the live tree, so it tracks a drag in progress too.
  const selectionBox = useMemo(
    () => (selectedNodeIds.length > 0 ? unionRectOfIds(nodes, selectedNodeIds) : null),
    [nodes, selectedNodeIds]
  );
  // Publish the device content box in canvas units for the drag loop's stage
  // guides. Assigned during render so a move reads the current center.
  stageBoxRef.current = { x: 0, y: 0, width: deviceWidth, height: deviceHeight };

  // Expanding a collapsed panel from its rail: reveal the panel and make sure
  // the chosen section is visible and open.
  const revealSection = (panel: CanvasPanelId, id: CanvasSectionId): void => {
    const store = useCanvasLayoutStore.getState();
    store.setPanelCollapsed(panel, false);
    store.setSectionVisible(panel, id, true);
    const list = panel === 'left' ? store.leftSections : store.rightSections;
    if (list.find((s) => s.id === id)?.collapsed) store.toggleSectionCollapsed(panel, id);
  };
  const leftRailItems: RailItem[] = leftSections
    .filter((s) => s.visible)
    .map((s) => ({ id: s.id, label: SECTION_TITLE[s.id], icon: SECTION_ICON(s.id), onActivate: () => revealSection('left', s.id) }));
  const rightRailItems: RailItem[] = rightSections
    .filter((s) => s.visible)
    .map((s) => ({ id: s.id, label: SECTION_TITLE[s.id], icon: SECTION_ICON(s.id), onActivate: () => revealSection('right', s.id) }));

  // Prompt 4 extension: the dialect-export / clipboard / responsive / chrome-theme
  // / layer-tree commands declared in the registry. They close over handlers that
  // are defined LATER in this component, so they live in a SECOND effect placed
  // after those consts — a useEffect deps array is evaluated during render and
  // would otherwise read a binding still in its temporal dead zone. The
  // disposable cleanup still runs on unmount, matching the effect above.
  useEffect(() => {
    const presetValues = RESPONSIVE_PRESETS.map((presetOption) => presetOption.value);
    const chromeThemes: CanvasSettings['chromeTheme'][] = ['dark', 'light', 'accent'];
    const commands = registerRendererCommands({
      'canvas.exportToProject': () => setShowApplyModal(true),
      'canvas.copyCode': () => {
        void handleCopyCode();
      },
      'canvas.responsivePresetCycle': () => {
        const index = presetValues.indexOf(responsive.preset);
        applyPreset(presetValues[(index + 1) % presetValues.length]);
      },
      'canvas.chromeThemeToggle': () => {
        const index = chromeThemes.indexOf(canvasSettings.chromeTheme);
        setChromeTheme(chromeThemes[(index + 1) % chromeThemes.length]);
      },
      'canvas.expandAllLayers': () => expandAllLayers(),
      'canvas.collapseAllLayers': () => collapseAllLayers(),
      'canvas.focusLayerFilter': () => document.getElementById('canvas-layer-filter')?.focus()
    });
    return () => commands.dispose();
  }, [responsive.preset, canvasSettings.chromeTheme, applyPreset, setChromeTheme, expandAllLayers, collapseAllLayers, handleCopyCode]);

  return (
    <WorkspaceGate featureName="M3E Canvas" message="Indexing Workspace for Canvas...">
      <div
        style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
        // Canvas chrome theme (Prompt 2 Step 4) + custom accent / background
        // (Prompt 4 Step 5): overrides the CSS variables the panels and toolbar
        // already read, so a change recolours live and stays independent of the
        // app theme (all three live in the canvas-settings key).
        ...(canvasThemeVars(canvasSettings.chromeTheme, {
          accentColor: canvasSettings.accentColor,
          backgroundColor: canvasSettings.backgroundColor
        }) as React.CSSProperties)
      }}
    >
      {/* Chrome (presence strip + toolbar) is hidden in focus mode. */}
      {!focusMode && (
        <>
      {/* Workspace session presence strip (Prompt 1: session bus) */}
      <div style={{ padding: '4px 10px', flexShrink: 0, borderBottom: '1px solid var(--bg-tertiary)' }}>
        <SessionPresenceStrip self="canvas" />
      </div>

      {/* Toolbar: platform selector + counts + actions */}
      <div
        style={{
          height: 42,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 12px',
          borderBottom: '1px solid var(--bg-tertiary)',
          background: 'var(--bg-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Braces size={14} color="var(--accent-primary)" />
          <div style={{ position: 'relative' }} onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setTargetMenuOpen((open) => !open)}
              title="Dialect export target. The live preview always renders the web/React projection; only Export/Copy emit the selected dialect."
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: 7,
                color: 'var(--text-primary)',
                fontSize: 11,
                fontWeight: 600,
                padding: '5px 8px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: 260
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dialectLabel(activeTarget)}</span>
              <ChevronDown size={12} />
            </button>
            {targetMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 34,
                  left: 0,
                  zIndex: 40,
                  width: 280,
                  maxHeight: 360,
                  overflowY: 'auto',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                  padding: '4px 0'
                }}
              >
                {targetsByGroup().map(({ group, entries }) =>
                  entries.length === 0 ? null : (
                    <div key={group} style={{ padding: '4px 0' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-muted)', padding: '4px 12px' }}>
                        {group.toUpperCase()}
                      </div>
                      {entries.map((entry) => {
                        const isActive = entry.id === activeTarget;
                        const kind = entry.deviceFrame.kind;
                        const thumbW = kind === 'phone' ? 9 : 20;
                        const thumbH = kind === 'phone' ? 18 : kind === 'desktop' ? 13 : 14;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => handleTargetChange(entry.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              width: '100%',
                              textAlign: 'left',
                              background: isActive ? 'rgba(168, 85, 247, 0.16)' : 'transparent',
                              border: 'none',
                              color: 'var(--text-primary)',
                              fontSize: 11,
                              padding: '6px 12px',
                              cursor: 'pointer'
                            }}
                          >
                            <span
                              style={{
                                flexShrink: 0,
                                width: thumbW,
                                height: thumbH,
                                borderRadius: kind === 'phone' ? 3 : 2,
                                border: '1px solid rgba(168, 85, 247, 0.5)',
                                background: 'var(--surface-2)'
                              }}
                            />
                            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                              <span style={{ fontWeight: isActive ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {entry.label}
                              </span>
                              <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                                {entry.languageHint} · {entry.codegen}
                              </span>
                            </span>
                            {isActive && <Check size={12} color="var(--accent-primary)" />}
                          </button>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {nodes.length} root{nodes.length === 1 ? '' : 's'} • {countNodes(nodes)} node{countNodes(nodes) === 1 ? '' : 's'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => cssFileInputRef.current?.click()}
            disabled={isProcessingImage}
            title="Extract a color palette → CSS from a picked image"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 6,
              background: imageCss ? 'rgba(168, 85, 247, 0.18)' : 'var(--surface-2)',
              border: `1px solid ${imageCss ? 'rgba(168, 85, 247, 0.45)' : 'var(--border-subtle)'}`,
              color: 'var(--accent-primary)',
              fontSize: 10.5,
              cursor: isProcessingImage ? 'wait' : 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Palette size={12} />
            {isProcessingImage ? 'Extracting…' : 'Img → CSS'}
          </button>
          <button
            type="button"
            onClick={() => void handleExportPng()}
            title="Export the device frame as a PNG"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: 10.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Download size={12} />
            Export PNG
          </button>
          {designProfile && (
            <div
              title={`Framework: ${designProfile.framework || 'Web'} (${designProfile.routerType || 'Standard'}) • UI: ${designProfile.uiLibrary || 'Tailwind'} • ${Object.keys(designProfile.colors).length} theme colors`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 9px',
                borderRadius: 6,
                background: 'rgba(168, 85, 247, 0.12)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                fontSize: 10.5,
                color: 'var(--accent-primary)',
                fontWeight: 600
              }}
            >
              <Sparkles size={11} />
              <span>{designProfile.uiLibrary || 'Project Native'}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowApplyModal(true)}
            disabled={nodes.length === 0}
            title="Apply generated UI code to a project file with Monaco Diff review gate"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(59, 130, 246, 0.18)',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              color: 'var(--accent-primary)',
              fontSize: 10.5,
              fontWeight: 600,
              cursor: nodes.length === 0 ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <FileCode size={12} />
            Apply to File
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmingClear) {
                clearCanvas();
                setConfirmingClear(false);
              } else {
                setConfirmingClear(true);
              }
            }}
            title="Clear the whole canvas"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 6,
              background: confirmingClear ? 'rgba(239, 68, 68, 0.2)' : 'var(--surface-2)',
              border: `1px solid ${confirmingClear ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-subtle)'}`,
              color: confirmingClear ? 'var(--accent-red)' : 'var(--text-secondary)',
              fontSize: 10.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Trash2 size={12} />
            {confirmingClear ? 'Confirm clear?' : 'Clear All'}
          </button>
          {!hydrated && (
            <span style={{ fontSize: 10, color: 'var(--accent-green)', whiteSpace: 'nowrap' }}>Syncing shared state…</span>
          )}
        </div>
      </div>

      {/* Responsive preview bar + canvas chrome theming (Prompt 4, Steps 3 & 5) */}
      <div
        style={{
          height: 34,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          borderBottom: '1px solid var(--bg-tertiary)',
          background: 'var(--bg-secondary)',
          fontSize: 10.5,
          overflowX: 'auto'
        }}
      >
        {/* Step 3: viewport presets + orientation + custom width (per document) */}
        <span style={{ color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.4px', flexShrink: 0 }}>RESPONSIVE</span>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {RESPONSIVE_PRESETS.map((preset) => (
            <button
              key={String(preset.value)}
              type="button"
              onClick={() => applyPreset(preset.value)}
              title={preset.width ? `Preview at ${preset.width}px wide` : preset.label}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                cursor: 'pointer',
                border: `1px solid ${responsive.preset === preset.value ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                background: responsive.preset === preset.value ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
                color: responsive.preset === preset.value ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontSize: 10,
                fontWeight: 600
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {responsive.preset === 'custom' && (
          <input
            type="number"
            min={280}
            max={2560}
            step={10}
            value={responsive.customWidth}
            onChange={(event) => setCustomWidth(Number(event.target.value))}
            title="Custom width (280–2560 px)"
            style={{ ...propInputStyle, width: 74, height: 22 }}
          />
        )}
        {responsive.preset !== 'auto' && (
          <button
            type="button"
            onClick={toggleOrientation}
            title={`Orientation: ${responsive.orientation} (click to toggle)`}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', flexShrink: 0 }}
          >
            <RotateCw size={11} />
            {responsive.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
          </button>
        )}
        {resolvedResponsiveWidth !== null && (
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{resolvedResponsiveWidth}px</span>
        )}

        <div style={{ flex: 1 }} />

        {/* Step 5: chrome theme (dark/light/accent), design-profile accent, background */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setShowChromeMenu((v) => !v); setLayerMenu(null); }}
            title="Canvas chrome theme & background (independent of the app theme)"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: 10.5 }}
          >
            <Palette size={11} />
            {canvasSettings.chromeTheme[0].toUpperCase() + canvasSettings.chromeTheme.slice(1)}
          </button>
          {showChromeMenu && (
            <div
              onClick={(event) => event.stopPropagation()}
              style={{ position: 'absolute', right: 0, top: 30, zIndex: 90, width: 210, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border-default)', borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
            >
              <div style={{ display: 'flex', gap: 4 }}>
                {(['dark', 'light', 'accent'] as const).map((theme) => (
                  <button key={theme} type="button" onClick={() => setChromeTheme(theme)}
                    style={{ flex: 1, padding: '4px 0', borderRadius: 5, cursor: 'pointer', fontSize: 10, textTransform: 'capitalize', border: `1px solid ${canvasSettings.chromeTheme === theme ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: canvasSettings.chromeTheme === theme ? 'rgba(168, 85, 247, 0.18)' : 'transparent', color: canvasSettings.chromeTheme === theme ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                    {theme}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.4px' }}>ACCENT {designProfile ? '(from project)' : ''}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setAccentColor('')} title="Follow theme" style={{ width: 20, height: 20, borderRadius: 5, cursor: 'pointer', border: canvasSettings.accentColor === '' ? '2px solid var(--accent-primary)' : '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>A</button>
                {Object.values(designProfile?.colors || {}).slice(0, 8).map((value, i) => {
                  const hex = String(value);
                  return (
                    <button key={`${hex}-${i}`} type="button" onClick={() => setAccentColor(hex)} title={hex} style={{ width: 20, height: 20, borderRadius: 5, cursor: 'pointer', background: hex, border: canvasSettings.accentColor === hex ? '2px solid var(--text-primary)' : '1px solid var(--border-subtle)' }} />
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.4px' }}>BACKGROUND</span>
                <button type="button" onClick={() => setShowBgPicker((v) => !v)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)' }}>
                  {showBgPicker ? 'Hide' : 'Pick'}
                </button>
              </div>
              <button type="button" onClick={() => setBackgroundColor('')} title="Follow theme background" style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', textAlign: 'left' }}>
                Reset to theme background
              </button>
            </div>
          )}
          {showBgPicker && (
            <div onClick={(event) => event.stopPropagation()} style={{ position: 'absolute', right: 0, top: showChromeMenu ? 210 : 30, zIndex: 95 }}>
              <ChromePicker color={canvasSettings.backgroundColor || '#121316'} onChangeComplete={(result: ColorResult) => setBackgroundColor(result.hex)} />
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* 3-pane body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* LEFT: library + layer tree — collapsible rail, resizable, reorderable sections */}
        {!focusMode && (leftCollapsed ? (
          <CollapsedRail side="left" onExpand={() => useCanvasLayoutStore.getState().togglePanel('left')} items={leftRailItems} />
        ) : (
          <>
            <aside
              style={{
                width: leftWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid var(--bg-tertiary)',
                background: 'var(--bg-primary)',
                minHeight: 0,
                overflow: 'hidden'
              }}
            >
              <PanelHeaderBar
                side="left"
                collapsed={leftCollapsed}
                onToggleCollapse={() => useCanvasLayoutStore.getState().togglePanel('left')}
                sections={leftSections.map((s) => ({ id: s.id, title: SECTION_TITLE[s.id], visible: s.visible }))}
                onToggleSectionVisible={(id, visible) => useCanvasLayoutStore.getState().setSectionVisible('left', id as CanvasSectionId, visible)}
              />
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {leftSections.filter((s) => s.visible).map((section) => (
                  <SectionShell
                    key={section.id}
                    title={SECTION_TITLE[section.id]}
                    icon={SECTION_ICON(section.id)}
                    count={section.id === 'library' ? LIBRARY.length : section.id === 'layers' ? countNodes(nodes) : undefined}
                    collapsed={section.collapsed}
                    onToggleCollapse={() => useCanvasLayoutStore.getState().toggleSectionCollapsed('left', section.id)}
                    onHide={() => useCanvasLayoutStore.getState().setSectionVisible('left', section.id, false)}
                    dragProps={{
                      onDragStart: () => { dragSectionRef.current = { panel: 'left', id: section.id }; },
                      onDragOver: (event) => event.preventDefault(),
                      onDrop: () => { const d = dragSectionRef.current; if (d) useCanvasLayoutStore.getState().moveSection('left', d.id, section.id); dragSectionRef.current = null; }
                    }}
                  >
                    {section.id === 'library' && (
                      <LibraryPanel
                        onAdd={(type, name, props) => {
                          setBookmarks(recordRecent(docId, name || type));
                          handleAdd(type, name, props);
                        }}
                        designProfile={designProfile}
                        workspaceId={docId}
                        bookmarks={bookmarks}
                        onToggleFavorite={(id) => setBookmarks(toggleFavorite(docId, id))}
                      />
                    )}
                    {section.id === 'layers' && (
                      <div style={{ padding: '6px 8px 10px', minHeight: 0 }}>
                        {/* Prompt 4 Step 2: expand/collapse-all + filter box */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                          <button type="button" onClick={expandAllLayers} title="Expand all layers" style={layerToolBtn}>
                            <ChevronDown size={12} />
                          </button>
                          <button type="button" onClick={collapseAllLayers} title="Collapse all layers" style={layerToolBtn}>
                            <ChevronRight size={12} />
                          </button>
                          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                            <Search size={11} style={{ position: 'absolute', left: 6, top: 6, color: 'var(--text-muted)', pointerEvents: 'none' }} />
                            <input
                              id="canvas-layer-filter"
                              value={layerFilter}
                              onChange={(event) => setLayerFilter(event.target.value)}
                              placeholder="Filter layers"
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '5px 8px 5px 22px',
                                borderRadius: 6,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--surface-2)',
                                color: 'var(--text-primary)',
                                fontSize: 10.5,
                                outline: 'none'
                              }}
                            />
                          </div>
                        </div>
                        {breadcrumb.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', marginBottom: 6, fontSize: 9.5 }}>
                            {breadcrumb.map((crumb, index) => (
                              <React.Fragment key={crumb.id}>
                                {index > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
                                <button
                                  type="button"
                                  onClick={() => selectNode(crumb.id)}
                                  title="Select on canvas"
                                  style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 9.5, padding: 0 }}
                                >
                                  {crumb.label}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                        {nodes.length === 0 ? (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '10px 4px', lineHeight: 1.6 }}>
                            No layers yet.
                            <br />
                            Add components from the library above.
                          </div>
                        ) : (
                          nodes.map((node) => (
                            <LayerRow
                              key={node.id}
                              node={node}
                              depth={0}
                              parentPath={[]}
                              selectionIds={selectionIdSet}
                              lockedIds={lockedIdSet}
                              hiddenIds={hiddenIdSet}
                              expanded={expanded}
                              dropTarget={layerDrag?.drop && layerDrag.dragId !== node.id ? layerDrag.drop : null}
                              onToggle={toggleExpanded}
                              onSelect={handleSelect}
                              onToggleLock={handleToggleLock}
                              onToggleHide={handleToggleHide}
                              onRename={handleLayerRename}
                              onNodeDragStart={handleLayerDragStart}
                              onNodeDragOver={handleLayerDragOver}
                              onNodeDrop={handleLayerDrop}
                              onNodeDragEnd={handleLayerDragEnd}
                              filter={layerFilter}
                              onContextMenu={(node, x, y) => setLayerMenu({ x, y, node })}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </SectionShell>
                ))}
              </div>
            </aside>
            <ResizeHandle
              side="left"
              width={leftWidth}
              min={PANEL_MIN_WIDTH}
              max={PANEL_MAX_WIDTH}
              onResize={(w) => useCanvasLayoutStore.getState().setPanelWidth('left', w)}
              onResizeStart={() => useCanvasLayoutStore.getState().setResizing(true)}
              onResizeEnd={() => useCanvasLayoutStore.getState().setResizing(false)}
              onReset={() => useCanvasLayoutStore.getState().setPanelWidth('left', canvasSettings.defaultLeftWidth)}
            />
          </>
        ))}

        {/* CENTER: visual canvas — the viewport-scaled design stage */}
        <div
          ref={centerRef}
          onPointerDown={(event) => {
            // Middle-drag or space+drag pans the stage; a plain left-drag on
            // empty canvas starts a marquee (a click without a drag clears).
            if (event.button === 1 || spaceHeldRef.current) {
              event.preventDefault();
              panRef.current = { lastX: event.clientX, lastY: event.clientY };
              setIsPanning(true);
              return;
            }
            if (event.button === 0) {
              event.preventDefault();
              beginMarquee(event.clientX, event.clientY);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--canvas-bg, var(--bg-primary))',
            touchAction: 'none',
            cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'default'
          }}
          onDragOver={(event) => {
            if (!hasLibraryPayload(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleStageDrop}
        >
          {/* Dot grid: spacing and offset track the viewport so dots sit on
              canvas-unit lines at every zoom. */}
          {gridVisible && (() => {
            // Dot spacing equals the configured grid size (canvas units) so the
            // dots line up with where nodes snap; scales with zoom, floored for
            // legibility at far-out views.
            const spacing = Math.max(6, canvasSettings.gridSpacing * viewport.scale);
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: CANVAS_GRID_BG,
                  backgroundSize: `${spacing}px ${spacing}px`,
                  backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
                  opacity: 0.5,
                  pointerEvents: 'none'
                }}
              />
            );
          })()}

          {/* Design stage: the single transformed wrapper everything is drawn in. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: deviceWidth,
              height: deviceHeight,
              transform: viewport.toTransformStyle(),
              transformOrigin: '0 0',
              zIndex: 2
            }}
          >
            <div
              ref={deviceExportRef}
              style={{
                width: deviceWidth,
                height: deviceHeight,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: activePlatform === 'web' ? 10 : activePlatform === 'swiftui' ? 10 : 34,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-default)',
                boxShadow: '0 18px 50px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden'
              }}
            >
              <div style={{ flexShrink: 0, background: 'var(--surface-2)' }}>
                {frame.titlebar}
              </div>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: 0,
                  paddingTop: frame.contentPadTop,
                  backgroundColor: 'var(--bg-primary)'
                }}
              >
                {nodes.map((node) => (
                  <NodeFrame
                    key={node.id}
                    node={node}
                    selectionIds={selectionIdSet}
                    lockedIds={lockedIdSet}
                    hiddenIds={hiddenIdSet}
                    onSelect={handleSelect}
                    onDragStart={handleDragStart}
                    onEdit={handleNodeDoubleClick}
                    scale={viewport.scale}
                    spaceHeld={spaceHeld}
                    dropIntoId={libraryDropIntoId}
                    onLibraryDragOverNode={handleLibraryDragOverNode}
                    onLibraryDropNode={handleLibraryDropNode}
                  />
                ))}

                {/* Smart-guide lines (canvas units, screen-constant thickness).
                    Rendered above nodes so a snap is visible mid-drag. */}
                {activeGuides.map((guide, i) =>
                  guide.orientation === 'vertical' ? (
                    <div
                      key={`gv${guide.at}-${i}`}
                      style={{
                        position: 'absolute',
                        left: guide.at,
                        top: 0,
                        width: viewport.constantOnScreen(1),
                        height: deviceHeight,
                        background: 'var(--accent-amber)',
                        pointerEvents: 'none',
                        zIndex: 60
                      }}
                    />
                  ) : (
                    <div
                      key={`gh${guide.at}-${i}`}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: guide.at,
                        width: deviceWidth,
                        height: viewport.constantOnScreen(1),
                        background: 'var(--accent-amber)',
                        pointerEvents: 'none',
                        zIndex: 60
                      }}
                    />
                  )
                )}

                {/* Combined selection bbox + 8 resize handles (screen-constant).
                    A single node shows handles too; a multi-selection shows the
                    union box whose drag-resize scales every selected subtree. */}
                {selectionBox && (
                  <div
                    style={{
                      position: 'absolute',
                      left: selectionBox.x,
                      top: selectionBox.y,
                      width: selectionBox.width,
                      height: selectionBox.height,
                      border: `${viewport.constantOnScreen(1)}px solid var(--accent-primary)`,
                      pointerEvents: 'none',
                      zIndex: 55
                    }}
                  >
                    {!(lockedIdSet.has(selectedNodeIds[selectedNodeIds.length - 1] ?? '')) &&
                      (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeMode[]).map((mode) => {
                        const hs = viewport.constantOnScreen(9);
                        const leftPct = mode.includes('w') ? 0 : mode.includes('e') ? 1 : 0.5;
                        const topPct = mode.includes('n') ? 0 : mode.includes('s') ? 1 : 0.5;
                        const cursor =
                          mode === 'nw' || mode === 'se' ? 'nwse-resize'
                            : mode === 'ne' || mode === 'sw' ? 'nesw-resize'
                              : mode === 'n' || mode === 's' ? 'ns-resize'
                                : 'ew-resize';
                        return (
                          <div
                            key={mode}
                            data-resize-handle={mode}
                            onPointerDown={(event) => {
                              if (event.button !== 0) return;
                              event.stopPropagation();
                              handleResizeStart(mode, event.clientX, event.clientY);
                            }}
                            style={{
                              position: 'absolute',
                              left: `${leftPct * 100}%`,
                              top: `${topPct * 100}%`,
                              width: hs,
                              height: hs,
                              transform: 'translate(-50%, -50%)',
                              background: 'var(--bg-primary)',
                              border: `${viewport.constantOnScreen(1.5)}px solid var(--accent-primary)`,
                              borderRadius: viewport.constantOnScreen(2),
                              boxSizing: 'border-box',
                              cursor,
                              pointerEvents: 'auto'
                            }}
                          />
                        );
                      })}
                  </div>
                )}

                {/* Marquee rectangle (canvas units) while a rubber-band drag is
                    live on the empty stage. */}
                {marquee && (
                  <div
                    style={{
                      position: 'absolute',
                      left: marquee.x,
                      top: marquee.y,
                      width: marquee.width,
                      height: marquee.height,
                      background: 'rgba(168, 85, 247, 0.12)',
                      border: `${viewport.constantOnScreen(1)}px solid var(--accent-primary)`,
                      pointerEvents: 'none',
                      zIndex: 58
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Empty-canvas hint floats above the stage, unscaled. */}
          {nodes.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 3
              }}
            >
              <div
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  padding: '26px 34px',
                  borderRadius: 14,
                  background: 'var(--surface-2)',
                  border: '1px dashed rgba(168, 85, 247, 0.4)',
                  textAlign: 'center'
                }}
              >
                <Box size={26} color="var(--accent-primary)" />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {platformLabel(activePlatform)} canvas is empty
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 280 }}>
                  Add containers, buttons or text from the library — every change syncs to the main IDE
                  window, and the shared chat can drive this canvas directly.
                </div>
                <button
                  type="button"
                  onClick={() => handleAdd('container')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 8,
                    background: 'var(--accent-primary)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={12} />
                  Add first container
                </button>
              </div>
            </div>
          )}

          {/* Zoom-aware rulers: tick labels are canvas units, positioned in the
              container's local space so they track pan and zoom. */}
          {rulersVisible && (() => {
            const step = pickTickStep(viewport.scale, 80);
            const view = viewport.visibleCanvasBox();
            const first = Math.floor(view.x / step) * step;
            const last = view.x + view.width;
            const firstY = Math.floor(view.y / step) * step;
            const lastY = view.y + view.height;
            const xTicks: React.ReactNode[] = [];
            for (let c = first; c <= last; c += step) {
              const lx = viewport.canvasToLocal(c, 0).x;
              xTicks.push(
                <div key={`xt${c}`} style={{ position: 'absolute', left: lx, top: 0, height: 20, borderLeft: '1px solid var(--border-subtle)' }}>
                  <span style={{ position: 'absolute', left: 2, top: 3, fontSize: 8, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{Math.round(c)}</span>
                </div>
              );
            }
            const yTicks: React.ReactNode[] = [];
            for (let c = firstY; c <= lastY; c += step) {
              const ly = viewport.canvasToLocal(0, c).y;
              yTicks.push(
                <div key={`yt${c}`} style={{ position: 'absolute', top: ly, left: 0, width: 20, borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ position: 'absolute', left: 1, top: 2, fontSize: 8, color: 'var(--text-muted)', transform: 'rotate(0deg)', whiteSpace: 'nowrap' }}>{Math.round(c)}</span>
                </div>
              );
            }
            return (
              <>
                <div style={{ position: 'absolute', left: 20, top: 0, right: 0, height: 20, background: 'var(--surface-2)', borderBottom: '1px solid var(--border-default)', overflow: 'hidden', pointerEvents: 'none', zIndex: 20 }}>{xTicks}</div>
                <div style={{ position: 'absolute', left: 0, top: 20, bottom: 0, width: 20, background: 'var(--surface-2)', borderRight: '1px solid var(--border-default)', overflow: 'hidden', pointerEvents: 'none', zIndex: 20 }}>{yTicks}</div>
                <div style={{ position: 'absolute', left: 0, top: 0, width: 20, height: 20, background: 'var(--surface-2)', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', zIndex: 21 }} />
              </>
            );
          })()}

          {/* Minimap: thumbnail of top-level nodes + a draggable viewport rect. */}
          {minimapVisible && (() => {
            const MW = 150;
            const MH = 110;
            const map = viewport.minimapMapping(MW, MH);
            if (!map) return null;
            const vb = viewport.visibleCanvasBox();
            const vtl = viewport.canvasToMinimap(vb.x, vb.y, map);
            const thumbs = nodes.map((n) => {
              const p = viewport.canvasToMinimap(num(n.props, 'x', 0), num(n.props, 'y', 0), map);
              return (
                <div
                  key={n.id}
                  style={{
                    position: 'absolute',
                    left: p.x,
                    top: p.y,
                    width: Math.max(2, num(n.props, 'width', 40) * map.scale),
                    height: Math.max(2, num(n.props, 'height', 40) * map.scale),
                    background: selectedNodeId === n.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                    opacity: selectedNodeId === n.id ? 0.9 : 0.4,
                    borderRadius: 1
                  }}
                />
              );
            });
            return (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  width: MW,
                  height: MH,
                  zIndex: 40,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)'
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const el = event.currentTarget as HTMLDivElement;
                  const seek = (clientX: number, clientY: number) => {
                    const r = el.getBoundingClientRect();
                    const m = viewport.minimapMapping(MW, MH);
                    if (!m) return;
                    viewport.centerOn(viewport.minimapToCanvas(clientX - r.left, clientY - r.top, m));
                  };
                  seek(event.clientX, event.clientY);
                  const move = (ev: PointerEvent) => seek(ev.clientX, ev.clientY);
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                {thumbs}
                <div
                  style={{
                    position: 'absolute',
                    left: vtl.x,
                    top: vtl.y,
                    width: Math.max(6, vb.width * map.scale),
                    height: Math.max(6, vb.height * map.scale),
                    border: '1.5px solid var(--accent-primary)',
                    background: 'rgba(168, 85, 247, 0.12)',
                    borderRadius: 2
                  }}
                />
              </div>
            );
          })()}

          {/* Floating align / arrange toolbar — appears over a 2+ selection. */}
          {selectionBox && selectedNodeIds.length >= 2 && (() => {
            const tl = viewport.canvasToLocal(selectionBox.x, selectionBox.y);
            const w = selectionBox.width * viewport.scale;
            const btn: React.CSSProperties = {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 24, borderRadius: 5, border: '1px solid var(--bg-tertiary)',
              background: 'transparent', color: 'var(--text-secondary)', fontSize: 10, cursor: 'pointer', padding: 0
            };
            const alignBtn = (kind: AlignKind, label: string, title: string) => (
              <button type="button" title={title} style={btn} onClick={() => canvasEditController.align(kind)}>{label}</button>
            );
            const zBtn = (mode: ZOrderMode, label: string, title: string) => (
              <button type="button" title={title} style={btn} onClick={() => canvasEditController.zorder(mode)}>{label}</button>
            );
            const sep = <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--bg-tertiary)', margin: '0 2px' }} />;
            return (
              <div
                style={{
                  position: 'absolute',
                  left: Math.max(8, tl.x),
                  top: Math.max(28, tl.y - 34),
                  zIndex: 70,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '4px 6px',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  boxShadow: '0 8px 22px rgba(0, 0, 0, 0.4)'
                }}
              >
                {alignBtn('left', '|◧', 'Align left')}
                {alignBtn('hcenter', '|◫', 'Align centers (horizontal)')}
                {alignBtn('right', '◨|', 'Align right')}
                {sep}
                {alignBtn('top', '▔', 'Align top')}
                {alignBtn('vcenter', '═', 'Align centers (vertical)')}
                {alignBtn('bottom', '▁', 'Align bottom')}
                {sep}
                <button type="button" title="Distribute horizontally" style={btn} onClick={() => canvasEditController.distribute('h')}>↔</button>
                <button type="button" title="Distribute vertically" style={btn} onClick={() => canvasEditController.distribute('v')}>↕</button>
                {sep}
                {zBtn('back', '⤓', 'Send to back')}
                {zBtn('backward', '↓', 'Send backward')}
                {zBtn('forward', '↑', 'Bring forward')}
                {zBtn('front', '⤒', 'Bring to front')}
                {sep}
                <button type="button" title="Group selection (Ctrl+Alt+G)" style={btn} onClick={() => canvasEditController.groupSelection()}>⧉</button>
                {/* Width hint keeps the toolbar from collapsing on narrow boxes. */}
                <span style={{ width: Math.max(0, w - 460) }} />
              </div>
            );
          })()}

          {/* Inline text editor overlay (double-click a text node). Enter / blur
              commits, Esc cancels. Positioned in container-local screen space. */}
          {inlineEdit && (() => {
            const node = findCanvasNode(nodes, inlineEdit.id);
            if (!node) return null;
            const local = viewport.canvasToLocal(num(node.props, 'x', 0), num(node.props, 'y', 0));
            const w = Math.max(60, num(node.props, 'width', 120) * viewport.scale);
            const h = Math.max(22, num(node.props, 'height', 24) * viewport.scale);
            return (
              <textarea
                key={inlineEdit.id}
                autoFocus
                value={inlineEdit.value}
                onChange={(event) => setInlineEdit({ id: inlineEdit.id, value: event.target.value })}
                onBlur={commitInlineEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitInlineEdit(); }
                  else if (event.key === 'Escape') { event.preventDefault(); setInlineEdit(null); }
                }}
                style={{
                  position: 'absolute',
                  left: local.x,
                  top: local.y,
                  width: w,
                  height: h,
                  zIndex: 80,
                  resize: 'none',
                  padding: 4,
                  borderRadius: 6,
                  border: '1.5px solid var(--accent-primary)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: Math.max(10, num(node.props, 'fontSize', 13) * viewport.scale),
                  outline: 'none',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)'
                }}
              />
            );
          })()}

          {/* Floating zoom cluster (bottom-right). */}
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '3px 4px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)'
            }}
          >
            {([
              { k: '−', t: 'Zoom out (Ctrl+-)', onClick: () => viewport.zoomStep(-1) },
              { k: '+', t: 'Zoom in (Ctrl+=)', onClick: () => viewport.zoomStep(1) }
            ]).map((b, i) => (
              <button key={i} type="button" title={b.t} onClick={b.onClick}
                style={{ width: 24, height: 22, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 15, lineHeight: 1, cursor: 'pointer', borderRadius: 4 }}>{b.k}</button>
            ))}
            <button
              type="button"
              title="Reset to 100% (Ctrl+0)"
              onClick={() => viewport.reset100()}
              style={{ minWidth: 44, height: 22, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 4 }}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
            <button type="button" title="Fit to content (Ctrl+Shift+0)" onClick={() => viewport.fitToContent()}
              style={{ width: 24, height: 22, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', borderRadius: 4 }}>⤢</button>
            <button type="button" title="Zoom options" onClick={() => setShowZoomMenu((v) => !v)}
              style={{ width: 18, height: 22, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', borderRadius: 4 }}>▾</button>

            {showZoomMenu && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 28,
                  width: 168,
                  padding: 4,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1
                }}
              >
                {ZOOM_PRESETS.map((preset) => (
                  <MenuItemRow key={preset.label} label={preset.label} active={Math.round(viewport.scale * 100) === Math.round(preset.scale * 100)} onClick={() => { viewport.setScale(preset.scale); setShowZoomMenu(false); }} />
                ))}
                <MenuItemRow label="Fit to content" onClick={() => { viewport.fitToContent(); setShowZoomMenu(false); }} />
                <MenuItemRow label="Fit to selection" onClick={() => { viewport.zoomToSelection(); setShowZoomMenu(false); }} />
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
                <MenuItemRow label="Grid" toggle active={gridVisible} onClick={() => { const next = !gridVisible; setGridVisible(next); persistViewport({ grid: next }); }} />
                <MenuItemRow label="Rulers" toggle active={rulersVisible} onClick={() => { const next = !rulersVisible; setRulersVisible(next); persistViewport({ rulers: next }); }} />
                <MenuItemRow label="Minimap" toggle active={minimapVisible} onClick={() => { const next = !minimapVisible; setMinimapVisible(next); persistViewport({ minimap: next }); }} />
                <MenuItemRow label="Snap to grid" toggle active={snapEnabled} onClick={() => setSnapEnabled((v) => !v)} />
              </div>
            )}
          </div>

          {/* Hidden image input for Img → CSS extraction */}
          <input
            ref={cssFileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void handleImagePicked(event.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />

          {/* Image → CSS result panel */}
          {imageCss && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                bottom: 16,
                zIndex: 30,
                width: 300,
                maxHeight: 300,
                display: 'flex',
                flexDirection: 'column',
                padding: 12,
                borderRadius: 12,
                background: 'var(--surface-2)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(8px)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Palette size={13} color="var(--accent-primary)" />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  CSS from {imageCss.sourceName}
                </span>
                <button
                  type="button"
                  onClick={() => setImageCss(null)}
                  title="Dismiss"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
                >
                  <X size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                {imageCss.palette.map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    style={{
                      flex: 1,
                      height: 20,
                      borderRadius: 5,
                      background: hex,
                      border: '1px solid var(--border-subtle)',
                      cursor: 'default'
                    }}
                  />
                ))}
              </div>
              <pre
                style={{
                  margin: 0,
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  padding: 8,
                  borderRadius: 7,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--bg-tertiary)',
                  color: '#9fd6c4',
                  fontSize: 9.5,
                  lineHeight: 1.5
                }}
              >
                {imageCss.cssSource}
              </pre>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleCopyCss()}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '6px 0',
                    borderRadius: 6,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-subtle)',
                    color: copiedCss ? 'var(--accent-green)' : 'var(--text-primary)',
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {copiedCss ? <Check size={12} /> : <Copy size={12} />}
                  {copiedCss ? 'Copied' : 'Copy CSS'}
                </button>
                <button
                  type="button"
                  onClick={handleApplyPalette}
                  disabled={!selectedNode}
                  title={selectedNode ? 'Apply gradient + text color to the selected node' : 'Select a node first'}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '6px 0',
                    borderRadius: 6,
                    background: 'rgba(168, 85, 247, 0.22)',
                    border: '1px solid rgba(168, 85, 247, 0.45)',
                    color: selectedNode ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: selectedNode ? 'pointer' : 'not-allowed'
                  }}
                >
                  <Box size={12} />
                  Apply to node
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: inspector — collapsible rail, resizable, reorderable sections */}
        {!focusMode && (rightCollapsed ? (
          <CollapsedRail side="right" onExpand={() => useCanvasLayoutStore.getState().togglePanel('right')} items={rightRailItems} />
        ) : (
          <>
            <ResizeHandle
              side="right"
              width={rightWidth}
              min={PANEL_MIN_WIDTH}
              max={PANEL_MAX_WIDTH}
              onResize={(w) => useCanvasLayoutStore.getState().setPanelWidth('right', w)}
              onResizeStart={() => useCanvasLayoutStore.getState().setResizing(true)}
              onResizeEnd={() => useCanvasLayoutStore.getState().setResizing(false)}
              onReset={() => useCanvasLayoutStore.getState().setPanelWidth('right', canvasSettings.defaultRightWidth)}
            />
            <aside
              style={{
                width: rightWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '1px solid var(--bg-tertiary)',
                background: 'var(--bg-primary)',
                minHeight: 0,
                overflow: 'hidden'
              }}
            >
              <PanelHeaderBar
                side="right"
                collapsed={rightCollapsed}
                onToggleCollapse={() => useCanvasLayoutStore.getState().togglePanel('right')}
                sections={rightSections.map((s) => ({ id: s.id, title: SECTION_TITLE[s.id], visible: s.visible }))}
                onToggleSectionVisible={(id, visible) => useCanvasLayoutStore.getState().setSectionVisible('right', id as CanvasSectionId, visible)}
              />
              {selectedNodeIds.length >= 2 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid var(--bg-secondary)' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{selectedNodeIds.length} layers selected</span>
                  <button
                    type="button"
                    onClick={() => canvasEditController.deleteSelection()}
                    title="Delete selection"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--bg-tertiary)', background: 'transparent', color: 'var(--accent-red)', fontSize: 10, cursor: 'pointer' }}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              ) : selectedNode ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px 8px', borderBottom: '1px solid var(--bg-secondary)' }}>
                  <button
                    type="button"
                    onClick={() => canvasEditController.deleteSelection()}
                    title="Delete selected node"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--bg-tertiary)', background: 'transparent', color: 'var(--accent-red)', fontSize: 10, cursor: 'pointer' }}
                  >
                    <Trash2 size={11} /> Delete node
                  </button>
                </div>
              ) : null}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {selectedNodeIds.length >= 2
                  ? <MultiInspector ids={selectedNodeIds} nodes={nodes} />
                  : <InspectorSections node={selectedNode} platform={activePlatform} designProfile={designProfile} />}
              </div>
            </aside>
          </>
        ))}
      </div>

      {/* Safe Edit Review Gate Modal: Apply UI to Project File */}
      {showApplyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            style={{
              width: 440,
              maxWidth: '100%',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 12,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                <FileCode size={16} color="var(--accent-primary)" />
                Apply Canvas UI to Project
              </div>
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Generated UI code will be sent to the <strong>Safe Edit Review Gate</strong> (Monaco Diff Editor), allowing you to review all line-by-line changes before anything is written to disk.
            </div>

            {designProfile && (
              <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', fontSize: 10.5 }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 2 }}>
                  Project Rules Applied:
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  • Framework: {designProfile.framework || 'React'} ({designProfile.routerType || 'Standard'})
                  {designProfile.routerType === 'app-router' ? " ('use client' directive active)" : ''}
                  <br />
                  • UI Components: {designProfile.uiLibrary || 'Tailwind CSS'}
                  <br />
                  • Theme Tokens: {Object.keys(designProfile.colors).length} project colors
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>Target File Path (relative to workspace root)</label>
              <input
                style={propInputStyle}
                value={targetFilePath}
                onChange={(e) => setTargetFilePath(e.target.value)}
                placeholder="src/components/MyComponent.tsx"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>Component Function Name</label>
              <input
                style={propInputStyle}
                value={targetCompName}
                onChange={(e) => setTargetCompName(e.target.value)}
                placeholder="MyComponent"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                disabled={isApplyingToWorkspace}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleApplyToWorkspace()}
                disabled={isApplyingToWorkspace || !targetFilePath.trim()}
                style={{
                  padding: '7px 14px',
                  borderRadius: 6,
                  background: 'var(--accent-primary)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: isApplyingToWorkspace ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {isApplyingToWorkspace ? 'Preparing Diff…' : 'Review Diff in Monaco'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt 4 Step 2: layer context-menu overlay (rename / duplicate / z-order
          / lock / hide / delete / select). Actions run through runOnLayer +
          canvasEditController; a window pointerdown dismisses it (see effect). */}
      {layerMenu && (() => {
        const menuNode = layerMenu.node;
        const itemStyle: React.CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 11,
          padding: '6px 10px',
          cursor: 'pointer',
          borderRadius: 4
        };
        return (
          <div
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              left: layerMenu.x,
              top: layerMenu.y,
              zIndex: 60,
              minWidth: 168,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 1
            }}
          >
            <input
              defaultValue={menuNode.name ?? menuNode.type}
              placeholder="Rename layer"
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next) handleLayerRename(menuNode.id, next);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') setLayerMenu(null);
              }}
              style={{
                margin: '2px 2px 4px',
                padding: '5px 7px',
                borderRadius: 5,
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-2)',
                color: 'var(--text-primary)',
                fontSize: 10.5,
                outline: 'none'
              }}
            />
            <button type="button" style={itemStyle} onClick={() => runOnLayer(menuNode.id, () => {})}>Select on Canvas</button>
            <button type="button" style={itemStyle} onClick={() => runOnLayer(menuNode.id, () => canvasEditController.duplicateSelection())}>Duplicate</button>
            <button type="button" style={itemStyle} onClick={() => runOnLayer(menuNode.id, () => canvasEditController.zorder('front'))}>Bring to Front</button>
            <button type="button" style={itemStyle} onClick={() => runOnLayer(menuNode.id, () => canvasEditController.zorder('back'))}>Send to Back</button>
            <button
              type="button"
              style={itemStyle}
              onClick={() => { handleToggleLock(menuNode.id); setLayerMenu(null); }}
            >
              {lockedIdSet.has(menuNode.id) ? 'Unlock' : 'Lock'}
            </button>
            <button
              type="button"
              style={itemStyle}
              onClick={() => { handleToggleHide(menuNode.id); setLayerMenu(null); }}
            >
              {hiddenIdSet.has(menuNode.id) ? 'Show' : 'Hide'}
            </button>
            <button type="button" style={{ ...itemStyle, color: 'var(--accent-red)' }} onClick={() => runOnLayer(menuNode.id, () => canvasEditController.deleteSelection())}>Delete</button>
          </div>
        );
      })()}
    </div>
    </WorkspaceGate>
  );
};

const countNodes = (list: CanvasNode[]): number =>
  list.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);

export default M3ECanvas;
