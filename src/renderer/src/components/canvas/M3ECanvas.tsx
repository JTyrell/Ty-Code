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
  X
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
  { type: 'container', label: 'Container', color: '#8b5cf6', icon: <Square size={14} /> },
  { type: 'card', label: 'Card', color: '#6366f1', icon: <Layers size={14} /> },
  { type: 'button', label: 'Button', color: '#a855f7', icon: <MousePointer2 size={14} /> },
  { type: 'text', label: 'Text', color: '#22d3ee', icon: <TypeGlyph size={14} /> },
  { type: 'input', label: 'Input', color: '#22d3ee', icon: <Sliders size={14} /> },
  { type: 'image', label: 'Image', color: '#f59e0b', icon: <ImageIcon size={14} /> },
  { type: 'checkbox', label: 'Checkbox', color: '#10b981', icon: <Plus size={14} /> },
  { type: 'switch', label: 'Switch', color: '#10b981', icon: <ToggleRight size={14} /> },
  { type: 'progress', label: 'Progress', color: '#f472b6', icon: <Eye size={14} /> },
  { type: 'divider', label: 'Divider', color: '#94a3b8', icon: <Box size={14} /> }
];

const typeGlyphColor = (type: string): string =>
  LIBRARY.find((entry) => entry.type === type)?.color ?? '#8b8fa3';

const DEFAULT_TEXT_COLOR = '#e7eaf6';
const CANVAS_GRID_BG =
  'radial-gradient(circle, rgba(148, 163, 184, 0.12) 1px, transparent 1px)';

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
            background: 'rgba(17, 19, 24, 0.9)',
            border: `1px solid ${checked ? '#a855f7' : 'rgba(148, 163, 184, 0.35)'}`,
            borderRadius: radius,
            color: '#94a3b8',
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
            border: '1px solid rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fde68a'
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
              border: `1.5px solid ${checked ? '#10b981' : 'rgba(148, 163, 184, 0.55)'}`,
              background: checked ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399',
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
            background: checked ? 'rgba(16, 185, 129, 0.35)' : 'rgba(148, 163, 184, 0.25)',
            border: `1px solid ${checked ? 'rgba(16, 185, 129, 0.6)' : 'rgba(148, 163, 184, 0.4)'}`,
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
              background: checked ? '#34d399' : '#cbd5e1',
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
            background: 'rgba(148, 163, 184, 0.2)',
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
            border: '1.5px solid rgba(255, 255, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#f3e8ff',
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
            border: '1px solid rgba(148, 163, 184, 0.28)',
            overflow: 'hidden'
          }}
        />
      );
  }
};

const typeDefaultBackground = (type: string): string => {
  switch (type) {
    case 'button': return 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
    case 'progress': return 'linear-gradient(90deg, #a855f7 0%, #6366f1 100%)';
    case 'divider': return 'rgba(148, 163, 184, 0.3)';
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
        outline: isSelected ? '1.5px solid #c084fc' : 'none',
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
            background: '#c084fc',
            border: '1.5px solid #f5f3ff',
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
          background: selectedId === node.id ? 'rgba(168, 85, 247, 0.18)' : hovered ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
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
          style={{ width: 14, display: 'flex', justifyContent: 'center', color: '#94a3b8', flexShrink: 0 }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        </span>
        <span style={{ color: typeGlyphColor(node.type), display: 'flex', flexShrink: 0 }}>
          {LIBRARY.find((entry) => entry.type === node.type)?.icon ?? <Square size={10} />}
        </span>
        <span
          style={{
            color: selectedId === node.id ? '#e9d5ff' : '#cbd5e1',
            fontWeight: selectedId === node.id ? 600 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1
          }}
        >
          {node.name || `${node.type[0].toUpperCase()}${node.type.slice(1)}`}
        </span>
        <span style={{ fontSize: 8.5, color: '#6b7280', flexShrink: 0 }}>#{node.id.slice(-4)}</span>
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
              color: '#f87171',
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
      color: '#94a3b8'
    }}
  >
    <span style={{ width: 64, flexShrink: 0 }}>{label}</span>
    {children}
  </label>
);

const propInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: '#1f212a',
  border: '1px solid #2d313d',
  borderRadius: 5,
  color: '#e5e7eb',
  fontSize: 10.5,
  padding: '4px 7px',
  outline: 'none'
};

interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  fallbackHex: string;
}

const ColorField: React.FC<ColorFieldProps> = ({ value, onChange, fallbackHex }) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const isUserTypingRef = useRef(false);

  useEffect(() => {
    if (!isUserTypingRef.current) setInputValue(value);
  }, [value]);

  const swatchColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim() : fallbackHex;

  return (
    <div style={{ position: 'relative', display: 'flex', flex: 1, gap: 5, alignItems: 'center', minWidth: 0 }}>
      <button
        type="button"
        title="Open color picker"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: '1px solid rgba(255, 255, 255, 0.25)',
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
        placeholder="#a855f7 | linear-gradient(...)"
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
  );
};

interface PropsPanelProps {
  node: CanvasNode | null;
  platform: CanvasPlatform;
}

const PropertiesPanel: React.FC<PropsPanelProps> = ({ node, platform }) => {
  const updateNodeProps = useCanvasStore((state) => state.updateNodeProps);

  if (!node) {
    return (
      <div style={{ padding: '18px 12px', fontSize: 10.5, color: '#6b7280', lineHeight: 1.6 }}>
        <Sliders size={16} color="#4b5563" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>Properties</div>
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
      <div style={{ paddingBottom: 8, borderBottom: '1px solid #272a34' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: typeGlyphColor(node.type) }}>
            {LIBRARY.find((entry) => entry.type === node.type)?.icon ?? <Square size={12} />}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>
            {node.name || node.type}
          </span>
        </div>
        <div style={{ fontSize: 9.5, color: '#6b7280', marginTop: 2 }}>
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
          onChange={(next) => updateNodeProps(node.id, { color: next })}
        />
      </PropRow>
      <PropRow label="textColor">
        <ColorField
          value={str(p, 'textColor')}
          fallbackHex={DEFAULT_TEXT_COLOR}
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

      <div style={{ paddingTop: 8, borderTop: '1px solid #272a34', fontSize: 9, letterSpacing: '0.6px', color: '#6b7280' }}>
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
            style={{ accentColor: '#a855f7' }}
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

      <div style={{ paddingTop: 8, borderTop: '1px solid #272a34', fontSize: 9, letterSpacing: '0.6px', color: '#6b7280' }}>
        JSON
      </div>
      <pre
        style={{
          margin: 0,
          padding: 8,
          borderRadius: 6,
          background: '#191b22',
          border: '1px solid #272a34',
          color: '#a5b4af',
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', fontSize: 9.5, color: '#9ca3af' }}>
            <span>9:41</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <span style={{ width: 18, height: 8, borderRadius: 3, background: 'rgba(255,255,255,0.22)' }} />
              <span style={{ width: 18, height: 8, borderRadius: 3, background: 'rgba(255,255,255,0.22)' }} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
            <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af' }}>MainActivity.swift — Preview</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
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
                background: 'rgba(255,255,255,0.08)',
                fontSize: 9.5,
                color: '#9ca3af'
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

const LibraryPanel: React.FC<{ onAdd: (type: string) => void }> = ({ onAdd }) => (
  <div style={{ padding: '10px 10px 12px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
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
          padding: '8px 9px',
          borderRadius: 8,
          background: 'rgba(255, 255, 255, 0.035)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#e5e7eb',
          fontSize: 10.5,
          cursor: 'pointer',
          textAlign: 'left'
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = 'rgba(255, 255, 255, 0.035)';
        }}
      >
        <span style={{ color: entry.color, display: 'flex' }}>{entry.icon}</span>
        {entry.label}
      </button>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export const M3ECanvas: React.FC = () => {
  const nodes = useCanvasStore((state) => state.nodes);
  const activePlatform = useCanvasStore((state) => state.activePlatform);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const { addNode, updateNodeProps, removeNode, setPlatform, clearCanvas, selectNode } = useCanvasStore.getState();

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

  // Wire the store into the main-process CanvasSyncManager exactly once.
  useEffect(() => {
    const stopPush = initCanvasStoreSync();
    const stopRemote = initCanvasRemoteSync();
    return () => {
      stopPush();
      stopRemote();
    };
  }, []);

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
    (type: string) => {
      addNode({ type });
    },
    [addNode]
  );

  const handleExportPng = useCallback(async () => {
    const target = deviceExportRef.current;
    if (!target) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(target, { pixelRatio: 2, backgroundColor: '#0d0e12' });
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
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#121316',
        overflow: 'hidden'
      }}
    >
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
          borderBottom: '1px solid #272a34',
          background: '#16171d'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Braces size={14} color="#c084fc" />
          <select
            value={activePlatform}
            onChange={(event) => setPlatform(event.target.value as CanvasPlatform)}
            title="Target platform"
            style={{
              background: '#1f212a',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              borderRadius: 7,
              color: '#f1f5f9',
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
          <span style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>
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
              background: imageCss ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${imageCss ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.1)'}`,
              color: '#e9d5ff',
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
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: 10.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Download size={12} />
            Export PNG
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
              background: confirmingClear ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${confirmingClear ? 'rgba(239, 68, 68, 0.45)' : 'rgba(255, 255, 255, 0.1)'}`,
              color: confirmingClear ? '#fca5a5' : '#cbd5e1',
              fontSize: 10.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Trash2 size={12} />
            {confirmingClear ? 'Confirm clear?' : 'Clear All'}
          </button>
          {!hydrated && (
            <span style={{ fontSize: 10, color: '#10b981', whiteSpace: 'nowrap' }}>Syncing shared state…</span>
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
            borderRight: '1px solid #272a34',
            background: '#15161c',
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
              borderBottom: '1px solid #22252e',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: '#9ca3af'
            }}
          >
            <Plus size={12} color="#c084fc" />
            COMPONENT LIBRARY
          </div>
          <LibraryPanel onAdd={handleAdd} />

          <div
            style={{
              height: 30,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 10px',
              borderTop: '1px solid #22252e',
              borderBottom: '1px solid #22252e',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: '#9ca3af'
            }}
          >
            <Layers size={12} color="#c084fc" />
            LAYER TREE
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px 10px', minHeight: 0 }}>
            {nodes.length === 0 ? (
              <div style={{ fontSize: 10, color: '#6b7280', padding: '10px 4px', lineHeight: 1.6 }}>
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
            background: '#0e0f13'
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
                background: 'rgba(21, 22, 28, 0.85)',
                border: '1px dashed rgba(168, 85, 247, 0.4)',
                textAlign: 'center'
              }}
            >
              <Box size={26} color="#c084fc" />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
                {platformLabel(activePlatform)} canvas is empty
              </div>
              <div style={{ fontSize: 11, color: '#8b8fa3', lineHeight: 1.6, maxWidth: 280 }}>
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
                  background: '#a855f7',
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
                  background: '#0d0e12',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.55)',
                  overflow: 'hidden'
                }}
              >
                <div style={{ flexShrink: 0, background: 'rgba(24, 25, 30, 0.9)' }}>
                  {frame.titlebar}
                </div>
                <div
                  style={{
                    position: 'relative',
                    flex: 1,
                    minHeight: 0,
                    paddingTop: frame.contentPadTop,
                    backgroundColor: '#101116'
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
                background: 'rgba(21, 22, 28, 0.96)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(8px)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Palette size={13} color="#c084fc" />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f1f5f9', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  CSS from {imageCss.sourceName}
                </span>
                <button
                  type="button"
                  onClick={() => setImageCss(null)}
                  title="Dismiss"
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 2 }}
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
                      border: '1px solid rgba(255, 255, 255, 0.18)',
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
                  background: '#14151b',
                  border: '1px solid #272a34',
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
                    background: 'rgba(255, 255, 255, 0.07)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: copiedCss ? '#34d399' : '#e5e7eb',
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
                    color: selectedNode ? '#e9d5ff' : '#6b7280',
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
            borderLeft: '1px solid #272a34',
            background: '#15161c',
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
              borderBottom: '1px solid #22252e',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: '#9ca3af'
            }}
          >
            <Sliders size={12} color="#c084fc" />
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
                  color: selectedNodeId ? '#f87171' : '#6b7280',
                  cursor: selectedNodeId ? 'pointer' : 'default',
                  display: 'flex',
                  padding: 2
                }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
          <PropertiesPanel node={selectedNode} platform={activePlatform} />
        </aside>
      </div>
    </div>
  );
};

const countNodes = (list: CanvasNode[]): number =>
  list.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);

export default M3ECanvas;
