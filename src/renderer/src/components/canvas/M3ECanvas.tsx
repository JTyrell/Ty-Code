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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
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
import type { CanvasNode, CanvasPlatform, CanvasPropValue } from '../../state/canvas-store';
import { extractImageCss } from '../../utils/image-to-css';
import type { ImageCssResult } from '../../utils/image-to-css';
import { WorkspaceGate } from '../common/WorkspaceGate';
import { SessionPresenceStrip } from '../common/SessionPresenceStrip';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useWorkspaceEditStore } from '../../state/workspace-edit-store';
import { toast } from '../../state/toast-store';
import { handleAutoAppliedTransaction } from '../../services/workspace-edit-commands';
import type { DesignProfile, DesignComponent } from '../../../../preload/types';

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
}

const NodeFrame: React.FC<NodeFrameProps> = ({ node, selectedId, onSelect, onDragStart, onResizeStart }) => {
  const isSelected = selectedId === node.id;
  const x = Math.round(num(node.props, 'x', 0));
  const y = Math.round(num(node.props, 'y', 0));
  const width = num(node.props, 'width', nodeDefaultSize(node.type).width);
  const height = num(node.props, 'height', nodeDefaultSize(node.type).height);

  return (
    <div
      data-node-id={node.id}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).dataset.resizeHandle) return;
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
        cursor: 'move',
        outline: isSelected ? '1.5px solid var(--accent-primary)' : 'none',
        outlineOffset: 1,
        boxShadow: isSelected ? '0 0 0 4px rgba(168, 85, 247, 0.18)' : 'none',
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
        />
      ))}
      {isSelected && (
        <div
          data-resize-handle="1"
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart(node.id, width, height, event.clientX, event.clientY);
          }}
          style={{
            position: 'absolute',
            right: -4,
            bottom: -4,
            width: 10,
            height: 10,
            borderRadius: 2,
            background: 'var(--accent-primary)',
            border: '1.5px solid var(--accent-primary)',
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

interface PropsPanelProps {
  node: CanvasNode | null;
  platform: CanvasPlatform;
  designProfile?: DesignProfile | null;
}

const PropertiesPanel: React.FC<PropsPanelProps> = ({ node, platform, designProfile }) => {
  const updateNodeProps = useCanvasStore((state) => state.updateNodeProps);

  if (!node) {
    return (
      <div style={{ padding: '18px 12px', fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <Sliders size={16} color="var(--text-secondary)" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Properties</div>
        Select a node on the canvas or in the layer tree to edit its color, text, padding and layout.
      </div>
    );
  }

  const p = node.props;
  const numField = (key: string): number => {
    const value = p[key];
    return typeof value === 'number' ? value : Number(value) || 0;
  };

  return (
    <div
      style={{
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        overflowY: 'auto',
        flex: 1,
        minHeight: 0
      }}
    >
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

      <div style={{ paddingTop: 8, borderTop: '1px solid var(--bg-tertiary)', fontSize: 9, letterSpacing: '0.6px', color: 'var(--text-secondary)' }}>
        LAYOUT
      </div>
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

      <div style={{ paddingTop: 8, borderTop: '1px solid var(--bg-tertiary)', fontSize: 9, letterSpacing: '0.6px', color: 'var(--text-secondary)' }}>
        JSON
      </div>
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
  const [frameScale, setFrameScale] = useState(1);
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

  // Scale-to-fit the device frame inside the center panel.
  useEffect(() => {
    const element = centerRef.current;
    if (!element) return;
    const recalc = () => {
      const frame = FrameForPlatform(useCanvasStore.getState().activePlatform);
      if (!frame.scale || typeof frame.width !== 'number' || typeof frame.height !== 'number') {
        setFrameScale(1);
        return;
      }
      const scaleW = (element.clientWidth - 56) / frame.width;
      const scaleH = (element.clientHeight - 56) / frame.height;
      setFrameScale(Math.max(0.35, Math.min(1, scaleW, scaleH)));
    };
    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activePlatform]);

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
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - dragState.pointerAX;
      const dy = event.clientY - dragState.pointerAY;
      if (dragState.kind === 'drag') {
        updateNodeProps(dragState.id, {
          x: Math.max(0, Math.round(dragState.startA + dx)),
          y: Math.max(0, Math.round(dragState.startB + dy))
        });
      } else {
        updateNodeProps(dragState.id, {
          width: Math.max(16, Math.round(dragState.startA + dx)),
          height: Math.max(10, Math.round(dragState.startB + dy))
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
  }, [dragState, updateNodeProps]);

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
    try {
      await navigator.clipboard.writeText(imageCss.cssSource);
      setCopiedCss(true);
      window.setTimeout(() => setCopiedCss(false), 2200);
    } catch (err: unknown) {
      console.warn('Clipboard write failed:', err);
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

  return (
    <WorkspaceGate featureName="M3E Canvas" message="Indexing Workspace for Canvas...">
      <div
        style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden'
      }}
    >
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

      {/* 3-pane body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* LEFT: library + layer tree */}
        <aside
          style={{
            width: 232,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--bg-tertiary)',
            background: 'var(--bg-primary)',
            minHeight: 0
          }}
        >
          <div
            style={{
              height: 30,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 10px',
              borderBottom: '1px solid var(--bg-secondary)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: 'var(--text-muted)'
            }}
          >
            <Plus size={12} color="var(--accent-primary)" />
            COMPONENT LIBRARY
          </div>
          <LibraryPanel onAdd={handleAdd} designProfile={designProfile} />

          <div
            style={{
              height: 30,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 10px',
              borderTop: '1px solid var(--bg-secondary)',
              borderBottom: '1px solid var(--bg-secondary)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: 'var(--text-muted)'
            }}
          >
            <Layers size={12} color="var(--accent-primary)" />
            LAYER TREE
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px 10px', minHeight: 0 }}>
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
                  selectedId={selectedNodeId}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                />
              ))
            )}
          </div>
        </aside>

        {/* CENTER: visual canvas */}
        <div
          ref={centerRef}
          onPointerDown={() => selectNode(null)}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-primary)'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: CANVAS_GRID_BG,
              backgroundSize: '22px 22px',
              opacity: 0.55,
              pointerEvents: 'none'
            }}
          />

          {nodes.length === 0 ? (
            <div
              style={{
                position: 'relative',
                zIndex: 2,
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
          ) : (
            <div
              style={{
                position: 'relative',
                zIndex: 2,
                width: frameIsFill ? 'calc(100% - 40px)' : deviceWidth * frameScale,
                height: frameIsFill ? 'calc(100% - 40px)' : deviceHeight * frameScale,
                flexShrink: 0
              }}
            >
              <div
                ref={deviceExportRef}
                style={{
                  width: frameIsFill ? '100%' : deviceWidth,
                  height: frameIsFill ? '100%' : deviceHeight,
                  transform: frameIsFill ? undefined : `scale(${frameScale})`,
                  transformOrigin: 'top left',
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
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

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

        {/* RIGHT: properties */}
        <aside
          style={{
            width: 250,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--bg-tertiary)',
            background: 'var(--bg-primary)',
            minHeight: 0
          }}
        >
          <div
            style={{
              height: 30,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 10px',
              borderBottom: '1px solid var(--bg-secondary)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: 'var(--text-muted)'
            }}
          >
            <Sliders size={12} color="var(--accent-primary)" />
            PROPERTIES
            {selectedNode && (
              <button
                type="button"
                onClick={() => removeNode(selectedNode.id)}
                title="Delete selected node"
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: selectedNodeId ? 'var(--accent-red)' : 'var(--text-secondary)',
                  cursor: selectedNodeId ? 'pointer' : 'default',
                  display: 'flex',
                  padding: 2
                }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
          <PropertiesPanel node={selectedNode} platform={activePlatform} designProfile={designProfile} />
        </aside>
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
