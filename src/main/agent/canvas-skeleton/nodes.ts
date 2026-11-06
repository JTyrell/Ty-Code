/**
 * Canvas skeleton emitters — shared helpers (Prompt 4 extension, tier 2).
 *
 * A "skeleton" is a minimal, deterministic AST -> dialect emitter: correct
 * imports, the component/signature shell, layout containers and style-attribute
 * placeholders. It does NOT do full style-system mapping or idiomatic state code.
 * Two guarantees for every emitter:
 *   1. its output always contains the registry `validationMarkers`, and
 *   2. its output never contains a `bannedMarker` (no React/TSX leak for
 *      non-React targets), and brackets/tags stay balanced.
 * That makes the offline conformance suite real and fail-able without a model.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';

/** Normalized children array. */
export const kids = (node: CanvasComponentNode): CanvasComponentNode[] => node.children ?? [];

/** Text-ish prop -> trimmed string ('' when absent). */
export const nodeText = (node: CanvasComponentNode, fallback = ''): string => {
  const raw = node.props?.text ?? node.props?.label ?? node.props?.placeholder;
  const str = typeof raw === 'string' ? raw.trim() : '';
  return str || fallback;
};

/** Numeric prop with default. */
export const numProp = (node: CanvasComponentNode, key: string, def: number): number => {
  const raw = node.props?.[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : def;
};

/** Background color prop, if present as a string. */
export const colorProp = (node: CanvasComponentNode): string | undefined => {
  const raw = node.props?.color;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
};

/** A node is a structural container if it is typed as one or has children. */
export const isContainer = (node: CanvasComponentNode): boolean =>
  node.type === 'container' || node.type === 'card' || kids(node).length > 0;

/** Sanitize a component name to a safe identifier with a fallback. */
export const safeComponentName = (name: string | undefined, fallback = 'GeneratedCanvasView'): string => {
  const cleaned = (name || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return fallback;
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `C${cleaned}`;
};

/** Indent every non-empty line of `block` by `spaces` spaces. */
export const indentBlock = (block: string, spaces: number): string => {
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
};
