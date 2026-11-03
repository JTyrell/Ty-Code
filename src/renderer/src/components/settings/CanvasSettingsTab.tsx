/**
 * Canvas Settings Tab (M3E Sketcher — Prompt 2, Step 4)
 *
 * Edits the shared Sketcher defaults held in localStorage: starting zoom, grid
 * size, snap tolerance, whether the grid / rulers / minimap chrome starts on,
 * the canvas chrome theme and the default panel widths. Every change writes
 * through `setCanvasSettings`, which fires in any open Sketcher window over the
 * storage event — so the values apply live, with no restart.
 */

import React, { useState } from 'react';
import {
  getCanvasSettings,
  setCanvasSettings,
  DEFAULT_CANVAS_SETTINGS
} from '../../lib/canvas-settings';
import type { CanvasSettings, CanvasChromeTheme } from '../../lib/canvas-settings';

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
    <label className="settings-field-label" style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
    {children}
    {hint && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{hint}</span>}
  </div>
);

const rangeRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const valueChip: React.CSSProperties = {
  minWidth: 56,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: 'var(--text-primary)'
};

export const CanvasSettingsTab: React.FC = () => {
  const [draft, setDraft] = useState<CanvasSettings>(() => getCanvasSettings());

  // Local edit + immediate live write: the Sketcher picks it up through the
  // storage event without a round trip through main.
  const update = (patch: Partial<CanvasSettings>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setCanvasSettings(next);
  };

  return (
    <section aria-label="Canvas settings" style={{ maxWidth: 620 }}>
      <div className="settings-section-heading" style={{ marginBottom: 12 }}>
        <strong>Canvas</strong>
        <span>Defaults for the M3E UI Sketcher. Changes apply live to any open Sketcher window.</span>
      </div>

      <Field label="Default zoom" hint="Applied when a canvas has no saved view. Auto-fit is used at 100%.">
        <div style={rangeRow}>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={draft.defaultZoom}
            onChange={(event) => update({ defaultZoom: Number(event.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={valueChip}>{Math.round(draft.defaultZoom * 100)}%</span>
        </div>
      </Field>

      <Field label="Grid size" hint="Dot-grid spacing in canvas units.">
        <div style={rangeRow}>
          <input
            type="range"
            min={4}
            max={128}
            step={4}
            value={draft.gridSpacing}
            onChange={(event) => update({ gridSpacing: Number(event.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={valueChip}>{draft.gridSpacing}px</span>
        </div>
      </Field>

      <Field label="Snap tolerance" hint="Nodes align to this step while dragging. 0 disables snapping.">
        <div style={rangeRow}>
          <input
            type="range"
            min={0}
            max={64}
            step={1}
            value={draft.snapTolerance}
            onChange={(event) => update({ snapTolerance: Number(event.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={valueChip}>{draft.snapTolerance}px</span>
        </div>
      </Field>

      <Field label="Canvas chrome theme">
        <select
          value={draft.chromeTheme}
          onChange={(event) => update({ chromeTheme: event.target.value as CanvasChromeTheme })}
          style={{ width: 220 }}
        >
          <option value="dark">Dark (app default)</option>
          <option value="light">Light</option>
          <option value="accent">Accent</option>
        </select>
      </Field>

      <Field label="Panel defaults">
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Left width (px)</span>
            <input
              type="number"
              min={220}
              max={480}
              value={draft.defaultLeftWidth}
              onChange={(event) => update({ defaultLeftWidth: Number(event.target.value) })}
              style={{ width: 96 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Right width (px)</span>
            <input
              type="number"
              min={220}
              max={480}
              value={draft.defaultRightWidth}
              onChange={(event) => update({ defaultRightWidth: Number(event.target.value) })}
              style={{ width: 96 }}
            />
          </div>
        </div>
      </Field>

      <Field label="Chrome visible by default">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {([
            { key: 'gridDefault', label: 'Grid' },
            { key: 'rulersDefault', label: 'Rulers' },
            { key: 'minimapDefault', label: 'Minimap' }
          ] as const).map((toggle) => (
            <label key={toggle.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft[toggle.key]}
                onChange={(event) => update({ [toggle.key]: event.target.checked })}
                style={{ accentColor: 'var(--accent-primary)' }}
              />
              {toggle.label}
            </label>
          ))}
        </div>
      </Field>

      <button
        type="button"
        onClick={() => {
          setDraft(DEFAULT_CANVAS_SETTINGS);
          setCanvasSettings(DEFAULT_CANVAS_SETTINGS);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        Restore canvas defaults
      </button>
    </section>
  );
};

export default CanvasSettingsTab;
