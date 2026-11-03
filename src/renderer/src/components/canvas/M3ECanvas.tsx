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
import { copyTextOrNotify } from '../../lib/clipboard';
import {
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
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
  Sparkles
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
import { extractImageCss } from '../../utils/image-to-css';
import type { ImageCssResult } from '../../utils/image-to-css';
import { WorkspaceGate } from '../common/WorkspaceGate';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import { registerContextContributor, registerRendererCommands } from '../../lib/command-runtime';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useWorkspaceEditStore } from '../../state/workspace-edit-store';
import { toast } from '../../state/toast-store';
import { handleAutoAppliedTransaction } from '../../services/workspace-edit-commands';
import type { DesignProfile, DesignComponent } from '../../../../preload/types';
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
import { getCanvasSettings, subscribeCanvasSettings, canvasThemeVars } from '../../lib/canvas-settings';
import type { CanvasSettings } from '../../lib/canvas-settings';

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
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string, startX: number, startY: number, pointerX: number, pointerY: number) => void;
  onResizeStart: (id: string, startW: number, startH: number, pointerX: number, pointerY: number) => void;
  /** Current viewport zoom; selection outline + handles divide by it to stay 1px-crisp on screen. */
  scale: number;
  /** Space is held, so a left-drag should pan the stage instead of moving this node. */
  spaceHeld: boolean;
}

const NodeFrame: React.FC<NodeFrameProps> = ({ node, selectedId, onSelect, onDragStart, onResizeStart, scale, spaceHeld }) => {
  const isSelected = selectedId === node.id;
  const x = Math.round(num(node.props, 'x', 0));
  const y = Math.round(num(node.props, 'y', 0));
  const width = num(node.props, 'width', nodeDefaultSize(node.type).width);
  const height = num(node.props, 'height', nodeDefaultSize(node.type).height);
  // Screen-constant compensation: this whole subtree is rendered inside the
  // scaled stage, so a 1px value becomes `scale`px on screen. Dividing by scale
  // keeps the outline and handle the same pixel size at 25% and 400% alike.
  const inv = 1 / (scale || 1);

  return (
    <div
      data-node-id={node.id}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).dataset.resizeHandle) return;
        // Space+drag is a stage pan; let the event bubble to the container
        // instead of capturing it as a node move.
        if (spaceHeld) return;
        event.stopPropagation();
        onSelect(node.id);
        onDragStart(node.id, x, y, event.clientX, event.clientY);
      }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        cursor: spaceHeld ? 'grab' : 'move',
        outline: isSelected ? `${1.5 * inv}px solid var(--accent-primary)` : 'none',
        outlineOffset: inv,
        boxShadow: isSelected ? `0 0 0 ${4 * inv}px rgba(168, 85, 247, 0.18)` : 'none',
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
          selectedId={selectedId}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
          scale={scale}
          spaceHeld={spaceHeld}
        />
      ))}
      {isSelected && (
        <div
          data-resize-handle="1"
          onPointerDown={(event) => {
            if (spaceHeld) return;
            event.stopPropagation();
            onResizeStart(node.id, width, height, event.clientX, event.clientY);
          }}
          style={{
            position: 'absolute',
            right: -5 * inv,
            bottom: -5 * inv,
            width: 10 * inv,
            height: 10 * inv,
            borderRadius: 2 * inv,
            background: 'var(--accent-primary)',
            border: `${1.5 * inv}px solid var(--accent-primary)`,
            cursor: 'nwse-resize',
            touchAction: 'none'
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Layer tree (JSON structure)
// ---------------------------------------------------------------------------

const LayerRow: React.FC<{
  node: CanvasNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}> = ({ node, depth, selectedId, expanded, onToggle }) => {
  const [hovered, setHovered] = useState(false);
  const { selectNode, removeNode } = useCanvasStore.getState();
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => selectNode(node.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 4 + depth * 13,
          paddingRight: 4,
          height: 25,
          borderRadius: 5,
          cursor: 'pointer',
          background: selectedId === node.id ? 'rgba(168, 85, 247, 0.18)' : hovered ? 'var(--surface-2)' : 'transparent',
          border: selectedId === node.id ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
          fontSize: 10.5
        }}
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
        <span
          style={{
            color: selectedId === node.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: selectedId === node.id ? 600 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1
          }}
        >
          {node.name || `${node.type[0].toUpperCase()}${node.type.slice(1)}`}
        </span>
        <span style={{ fontSize: 8.5, color: 'var(--text-secondary)', flexShrink: 0 }}>#{node.id.slice(-4)}</span>
        {hovered && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              removeNode(node.id);
            }}
            title="Remove node"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-red)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              flexShrink: 0
            }}
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
          selectedId={selectedId}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
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
  const updateNodeProps = useCanvasStore((state) => state.updateNodeProps);
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
  const updateNodeProps = useCanvasStore((state) => state.updateNodeProps);
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
  const updateNodeProps = useCanvasStore((state) => state.updateNodeProps);
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
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({ onAdd, designProfile }) => {
  const projectComponents = designProfile?.components || [];
  return (
    <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
      {projectComponents.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: 'var(--accent-primary)',
              marginBottom: 6,
              letterSpacing: '0.4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>PROJECT: {designProfile?.uiLibrary || 'COMPONENTS'}</span>
            <span
              style={{
                fontSize: 8.5,
                padding: '1px 5px',
                borderRadius: 999,
                background: 'rgba(168, 85, 247, 0.18)',
                color: 'var(--accent-primary)'
              }}
            >
              {projectComponents.length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5, maxHeight: 150, overflowY: 'auto' }}>
            {projectComponents.map((comp) => (
              <button
                key={comp.name}
                type="button"
                onClick={() =>
                  onAdd(comp.name.toLowerCase(), comp.name, {
                    importPath: comp.importPath,
                    library: designProfile?.uiLibrary || ''
                  })
                }
                title={`Add ${comp.name} (${comp.importPath})`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 7px',
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  color: 'var(--text-primary)',
                  fontSize: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'var(--surface-2)';
                }}
              >
                <span style={{ color: 'var(--accent-primary)', display: 'flex', flexShrink: 0 }}>
                  <Box size={11} />
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{comp.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.4px' }}>
          BASE PRIMITIVES
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {LIBRARY.map((entry) => (
            <button
              key={entry.type}
              type="button"
              onClick={() => onAdd(entry.type)}
              title={`Add ${entry.label}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 8px',
                borderRadius: 7,
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 10,
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = 'var(--border-subtle)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'var(--surface-2)';
              }}
            >
              <span style={{ color: entry.color, display: 'flex' }}>{entry.icon}</span>
              {entry.label}
            </button>
          ))}
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
  const hydrated = useCanvasStore((state) => state.hydrated);
  const { addNode, updateNodeProps, removeNode, setPlatform, clearCanvas, selectNode } = useCanvasStore.getState();
  const { attachSurface, detachSurface } = useWorkspaceSessionStore();

  useEffect(() => {
    attachSurface('canvas');
    return () => detachSurface('canvas');
  }, [attachSurface, detachSurface]);

  const [dragState, setDragState] = useState<{
    kind: 'drag' | 'resize';
    id: string;
    startA: number;
    startB: number;
    pointerAX: number;
    pointerAY: number;
  } | null>(null);
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
        if (persistedViewport.saved) {
          viewport.restore(persistedViewport);
        } else if (Math.abs(settingsRef.current.defaultZoom - 1) > 0.001) {
          // Fresh document + an explicit default zoom: honor it over auto-fit.
          viewport.setScale(settingsRef.current.defaultZoom);
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

  // Back the `canvas.*` commands with the live viewport. Re-registering when a
  // toggle flips is cheap (dispose + add) and keeps each handler closing over
  // the current grid / rulers / minimap state.
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
      'canvas.focusMode': () => useCanvasLayoutStore.getState().toggleFocusMode()
    });
    return () => commands.dispose();
  }, [viewport, persistViewport, gridVisible, rulersVisible, minimapVisible]);

  // Delete key removes the selected node (unless typing in an input).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const selected = useCanvasStore.getState().selectedNodeId;
      if (!selected) return;
      event.preventDefault();
      removeNode(selected);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removeNode]);

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  const handleDragStart = useCallback((id: string, startX: number, startY: number, pointerX: number, pointerY: number) => {
    setDragState({ kind: 'drag', id, startA: startX, startB: startY, pointerAX: pointerX, pointerAY: pointerY });
  }, []);

  const handleResizeStart = useCallback((id: string, startW: number, startH: number, pointerX: number, pointerY: number) => {
    setDragState({ kind: 'resize', id, startA: startW, startB: startH, pointerAX: pointerX, pointerAY: pointerY });
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const step = snapEnabledRef.current ? settingsRef.current.snapTolerance : DEFAULT_SNAP;
    const onMove = (event: PointerEvent) => {
      // Screen px → canvas units. The whole stage is scaled by `viewport.scale`,
      // so a cursor delta of `d` screen px is `d / scale` canvas units. Without
      // this the node drifted from the pointer at any zoom other than 100 %.
      const s = viewport.scale || 1;
      const dx = (event.clientX - dragState.pointerAX) / s;
      const dy = (event.clientY - dragState.pointerAY) / s;
      if (dragState.kind === 'drag') {
        updateNodeProps(dragState.id, {
          x: Math.max(0, snapToGrid(Math.round(dragState.startA + dx), step)),
          y: Math.max(0, snapToGrid(Math.round(dragState.startB + dy), step))
        });
      } else {
        updateNodeProps(dragState.id, {
          width: Math.max(16, snapToGrid(Math.round(dragState.startA + dx), step)),
          height: Math.max(10, snapToGrid(Math.round(dragState.startB + dy), step))
        });
      }
    };
    const onUp = () => setDragState(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, updateNodeProps, viewport]);

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
      addNode({ type, name, props });
    },
    [addNode]
  );

  const handleApplyToWorkspace = useCallback(async () => {
    setIsApplyingToWorkspace(true);
    try {
      const generatedCode = generateProjectNativeCode(
        nodes,
        activePlatform,
        designProfile,
        targetCompName.trim() || 'GeneratedCanvasView'
      );

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
        title: `Apply Canvas UI · ${targetCompName || 'GeneratedCanvasView'}`,
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
    } catch (err: unknown) {
      toast.error('Could not apply UI to file', err instanceof Error ? err.message : String(err));
    } finally {
      setIsApplyingToWorkspace(false);
    }
  }, [nodes, activePlatform, designProfile, targetCompName, targetFilePath]);

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
    updateNodeProps(selectedNode.id, {
      color: imageCss.gradient,
      textColor: imageCss.textColor
    });
  }, [imageCss, selectedNode, updateNodeProps]);

  const frame = FrameForPlatform(activePlatform);
  const frameIsFill = frame.width === 'fill';
  const deviceWidth = frameIsFill ? (centerRef.current?.clientWidth ?? 800) - 40 : frame.width as number;
  const deviceHeight = frameIsFill ? (centerRef.current?.clientHeight ?? 600) - 40 : frame.height as number;

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
        // Canvas chrome theme (Prompt 2 Step 4): overrides the CSS variables
        // the panels and toolbar already read, so a theme change recolours live.
        ...(canvasThemeVars(canvasSettings.chromeTheme) as React.CSSProperties)
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
          <select
            value={activePlatform}
            onChange={(event) => setPlatform(event.target.value as CanvasPlatform)}
            title="Target platform"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              borderRadius: 7,
              color: 'var(--text-primary)',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 8px',
              outline: 'none',
              cursor: 'pointer',
              maxWidth: 210
            }}
          >
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
                    {section.id === 'library' && <LibraryPanel onAdd={handleAdd} designProfile={designProfile} />}
                    {section.id === 'layers' && (
                      <div style={{ padding: '6px 8px 10px', minHeight: 0 }}>
                        {nodes.length === 0 ? (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '10px 4px', lineHeight: 1.6 }}>
                            No layers yet.
                            <br />
                            Add components from the library above.
                          </div>
                        ) : (
                          nodes.map((node) => (
                            <LayerRow key={node.id} node={node} depth={0} selectedId={selectedNodeId} expanded={expanded} onToggle={toggleExpanded} />
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
            // Middle-drag or space+drag pans the stage; otherwise a click on
            // empty canvas clears the selection.
            if (event.button === 1 || spaceHeldRef.current) {
              event.preventDefault();
              panRef.current = { lastX: event.clientX, lastY: event.clientY };
              setIsPanning(true);
              return;
            }
            selectNode(null);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--bg-primary)',
            cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'default'
          }}
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
                    selectedId={selectedNodeId}
                    onSelect={selectNode}
                    onDragStart={handleDragStart}
                    onResizeStart={handleResizeStart}
                    scale={viewport.scale}
                    spaceHeld={spaceHeld}
                  />
                ))}
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
              {selectedNode && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px 8px', borderBottom: '1px solid var(--bg-secondary)' }}>
                  <button
                    type="button"
                    onClick={() => removeNode(selectedNode.id)}
                    title="Delete selected node"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--bg-tertiary)', background: 'transparent', color: 'var(--accent-red)', fontSize: 10, cursor: 'pointer' }}
                  >
                    <Trash2 size={11} /> Delete node
                  </button>
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <InspectorSections node={selectedNode} platform={activePlatform} designProfile={designProfile} />
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
    </div>
    </WorkspaceGate>
  );
};

const countNodes = (list: CanvasNode[]): number =>
  list.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);

export default M3ECanvas;
