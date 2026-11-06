/**
 * Canvas dialect-export IPC contracts (Prompt 4 extension).
 *
 * Zod schemas for the `canvas:export-dialect` channel, validated at the
 * `ipcMain.handle` boundary per the project IPC rule. `targetId` is derived from
 * the shared platform registry so the enum can never drift from the registry.
 * The preload `CanvasExportDialectData` type is derived from the result schema.
 */

import { z } from 'zod';
import { CANVAS_TARGET_IDS, type CanvasTargetId } from '../canvas-platform-registry';

/** A single canvas node accepted from the renderer (recursive, tolerant shape). */
export interface CanvasExportNode {
  id: string;
  type: string;
  name?: string;
  props?: Record<string, unknown>;
  children?: CanvasExportNode[];
}

export const CanvasExportNodeSchema: z.ZodType<CanvasExportNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1).max(64),
    name: z.string().max(120).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(CanvasExportNodeSchema).optional()
  })
);

const targetIdEnum = CANVAS_TARGET_IDS as unknown as [CanvasTargetId, ...CanvasTargetId[]];

export const CanvasExportDialectRequestSchema = z.object({
  /** Stable id so the renderer can cancel an in-flight export by requestId. */
  requestId: z.string().min(1),
  targetId: z.enum(targetIdEnum),
  nodes: z.array(CanvasExportNodeSchema).max(2_000),
  componentName: z.string().max(120).default('GeneratedCanvasView'),
  workspaceRoot: z.string().min(1)
});
export type CanvasExportDialectRequest = z.infer<typeof CanvasExportDialectRequestSchema>;

export const CanvasExportDialectResultSchema = z.object({
  code: z.string().min(1),
  language: z.string().min(1),
  dialectLabel: z.string().min(1),
  /** Which producer won: the rich agent or the deterministic skeleton fallback. */
  source: z.enum(['agent', 'skeleton']),
  /** Human note surfaced at the gate (e.g. "baseline dialect (offline)"). */
  note: z.string().max(200).optional()
});
export type CanvasExportDialectResult = z.infer<typeof CanvasExportDialectResultSchema>;
