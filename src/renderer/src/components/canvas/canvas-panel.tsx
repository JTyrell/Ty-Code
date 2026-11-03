/**
 * Canvas Panel Chrome (M3E Sketcher — Prompt 2)
 *
 * Presentational pieces shared by the left and right Sketcher panels: a
 * drag-resize handle, a collapsed icon rail, a panel header bar (collapse +
 * per-section visibility menu) and a collapsible / reorderable section shell.
 *
 * The resize handle deliberately does NOT change panel width on every
 * pointermove. It moves a thin accent line with `transform: translateX(...)`
 * and commits the width once, on pointerup. That keeps the center stage's
 * ResizeObserver from recomputing the viewport every frame mid-drag (the layout
 * thrash the spec bans) — the only reflow happens on drop.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  EyeOff,
  GripVertical,
  LayoutGrid
} from 'lucide-react';

export type CanvasPanelSide = 'left' | 'right';

// ---------------------------------------------------------------------------
// Resize handle
// ---------------------------------------------------------------------------

interface ResizeHandleProps {
  side: CanvasPanelSide;
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  onReset: () => void;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  side,
  width,
  min,
  max,
  onResize,
  onResizeStart,
  onResizeEnd,
  onReset
}) => {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const startRef = useRef<{ pointer: number; width: number } | null>(null);

  const commit = useCallback(
    (deltaPx: number) => {
      // A left panel grows when dragged right; a right panel grows when dragged
      // left, so the sign flips with the side.
      const signed = side === 'left' ? deltaPx : -deltaPx;
      const next = Math.max(min, Math.min(max, startRef.current?.width ?? width) + signed);
      return next;
    },
    [side, min, max, width]
  );

  useEffect(() => {
    if (dragOffset === null) return;
    const move = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      setDragOffset(event.clientX - start.pointer);
    };
    const up = (event: PointerEvent) => {
      const start = startRef.current;
      if (start) onResize(commit(event.clientX - start.pointer));
      startRef.current = null;
      setDragOffset(null);
      onResizeEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragOffset, commit, onResize, onResizeStart, onResizeEnd]);

  const begin = (event: React.PointerEvent) => {
    event.preventDefault();
    startRef.current = { pointer: event.clientX, width };
    setDragOffset(0);
    onResizeStart();
  };

  // Feedback line follows the pointer via transform only; the panels themselves
  // stay put until the commit on pointerup.
  const accentStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    background: 'var(--accent-primary)',
    opacity: dragOffset === null ? 0 : 1,
    transform: `translateX(${dragOffset ?? 0}px)`,
    pointerEvents: 'none',
    transition: dragOffset === null ? 'opacity 120ms ease' : 'none'
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={begin}
      onDoubleClick={onReset}
      title="Drag to resize • double-click to reset"
      style={{
        position: 'relative',
        width: 5,
        flexShrink: 0,
        cursor: 'col-resize',
        background: 'transparent',
        zIndex: 4
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: side === 'left' ? 2 : 1,
          width: 1,
          background: 'var(--bg-tertiary)'
        }}
      />
      <div style={{ ...accentStyle, left: side === 'left' ? 2 : 2 }} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Collapsed rail
// ---------------------------------------------------------------------------

export interface RailItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  onActivate: () => void;
}

interface CollapsedRailProps {
  side: CanvasPanelSide;
  items: RailItem[];
  onExpand: () => void;
}

export const CollapsedRail: React.FC<CollapsedRailProps> = ({ side, items, onExpand }) => {
  const Chevron = side === 'left' ? ChevronRight : ChevronLeft;
  return (
    <div
      style={{
        width: 34,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '8px 0',
        background: 'var(--bg-secondary)',
        borderRight: side === 'left' ? '1px solid var(--bg-tertiary)' : 'none',
        borderLeft: side === 'left' ? 'none' : '1px solid var(--bg-tertiary)'
      }}
    >
      <button
        type="button"
        onClick={onExpand}
        title={`Expand ${side} panel`}
        style={railButtonStyle}
      >
        <Chevron size={15} />
      </button>
      <div style={{ width: 18, height: 1, background: 'var(--bg-tertiary)', margin: '2px 0' }} />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onActivate}
          title={item.label}
          style={railButtonStyle}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
};

const railButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer'
};

// ---------------------------------------------------------------------------
// Panel header bar (collapse + sections menu)
// ---------------------------------------------------------------------------

interface PanelHeaderBarProps {
  side: CanvasPanelSide;
  collapsed: boolean;
  onToggleCollapse: () => void;
  sections: { id: string; title: string; visible: boolean }[];
  onToggleSectionVisible: (id: string, visible: boolean) => void;
}

export const PanelHeaderBar: React.FC<PanelHeaderBarProps> = ({
  side,
  collapsed,
  onToggleCollapse,
  sections,
  onToggleSectionVisible
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const CollapseChevron = side === 'left' ? ChevronLeft : ChevronRight;
  const hiddenCount = sections.filter((s) => !s.visible).length;

  return (
    <div
      style={{
        position: 'relative',
        height: 24,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px',
        borderBottom: '1px solid var(--bg-tertiary)',
        background: 'var(--bg-secondary)'
      }}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? `Expand ${side} panel` : `Collapse ${side} panel`}
        style={{ display: 'flex', padding: 3, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
      >
        <CollapseChevron size={14} />
      </button>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.6px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase'
        }}
      >
        {side} panel
      </span>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        title="Customize sections"
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '3px 6px',
          borderRadius: 5,
          border: 'none',
          background: menuOpen ? 'var(--bg-tertiary)' : 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 9.5
        }}
      >
        <LayoutGrid size={12} />
        {hiddenCount > 0 ? `${sections.length - hiddenCount}/${sections.length}` : 'Sections'}
      </button>

      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenuOpen(false)} />
          <div
            style={{
              position: 'absolute',
              top: 24,
              right: 6,
              zIndex: 21,
              minWidth: 168,
              padding: 6,
              borderRadius: 8,
              background: 'var(--bg-primary)',
              border: '1px solid var(--bg-tertiary)',
              boxShadow: '0 12px 28px -12px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-muted)', padding: '2px 4px 6px' }}>
              VISIBILITY
            </div>
            {sections.map((section) => (
              <label
                key={section.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', fontSize: 11, color: 'var(--text-primary)', cursor: 'pointer', borderRadius: 5 }}
              >
                <input
                  type="checkbox"
                  checked={section.visible}
                  onChange={(event) => onToggleSectionVisible(section.id, event.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)' }}
                />
                {section.title}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section shell (collapse / hide / drag-reorder / live count)
// ---------------------------------------------------------------------------

interface SectionShellProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHide: () => void;
  dragProps: {
    onDragStart: () => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: () => void;
  };
  children: React.ReactNode;
}

export const SectionShell: React.FC<SectionShellProps> = ({
  title,
  icon,
  count,
  collapsed,
  onToggleCollapse,
  onHide,
  dragProps,
  children
}) => {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        draggable
        onDragStart={dragProps.onDragStart}
        onDragOver={dragProps.onDragOver}
        onDrop={dragProps.onDrop}
        style={{
          height: 28,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          borderTop: '1px solid var(--bg-secondary)',
          borderBottom: '1px solid var(--bg-secondary)',
          background: 'var(--bg-primary)',
          cursor: 'grab'
        }}
      >
        <GripVertical size={12} color="var(--text-muted)" style={{ opacity: 0.55 }} />
        <button
          type="button"
          onClick={onToggleCollapse}
          style={{ display: 'flex', padding: 2, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
          title={collapsed ? 'Expand section' : 'Collapse section'}
        >
          <Chevron size={13} />
        </button>
        <span style={{ color: 'var(--accent-primary)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {title}
        </span>
        {typeof count === 'number' && (
          <span
            style={{
              marginLeft: 2,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 9,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {count}
          </span>
        )}
        <button
          type="button"
          onClick={onHide}
          title={`Hide ${title}`}
          style={{ marginLeft: 'auto', display: 'flex', padding: 2, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <EyeOff size={12} />
        </button>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>{children}</div>
      )}
    </section>
  );
};

/** Small inline chevron used by section bodies that also need an up affordance. */
export const SectionChevronUp = ChevronUp;
