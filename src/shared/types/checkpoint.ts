/**
 * Phase 3 Step 1 — Checkpoints & Rollback shared contract.
 *
 * A checkpoint is a reversible point captured immediately before the agent's
 * edit batch touches disk. Two backends store it:
 *  - `git-ref`  : a throwaway commit (stash-create / commit-tree) — no branch,
 *                 index, or working tree changes. The manifest carries only the
 *                 ref so `git show <ref>:<path>` reconstructs prior contents.
 *  - `snapshot` : an encrypted inverse bundle at
 *                 ~/.tycode/checkpoints/{wsHash}/{taskId}/{n}.bundle holding the
 *                 pre-edit contents of just the touched files + a manifest of
 *                 created/deleted files. Same envelope discipline as sessions.
 *
 * The manifest is the plaintext sidecar (listable without decrypting); file
 * contents live only inside the encrypted bundle. Nothing here imports Electron.
 */

import { z } from 'zod';

export const CHECKPOINT_ENVELOPE_VERSION = 1 as const;

export const CheckpointBackendSchema = z.enum(['git-ref', 'snapshot']);
export type CheckpointBackend = z.infer<typeof CheckpointBackendSchema>;

/** What the agent intends to do to a single file in this batch. */
export const PlannedEditKindSchema = z.enum(['modify', 'create', 'delete']);
export type PlannedEditKind = z.infer<typeof PlannedEditKindSchema>;

export const PlannedEditSchema = z.object({
  /** Path relative to the workspace root (never absolute, never escapes). */
  path: z.string().min(1).max(4096),
  kind: PlannedEditKindSchema
});
export type PlannedEdit = z.infer<typeof PlannedEditSchema>;

/**
 * Plaintext checkpoint sidecar. Enough to render the chip + Details list and to
 * detect a decrypt failure WITHOUT reading the encrypted bundle.
 */
export const CheckpointManifestSchema = z.object({
  id: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  /** Monotonic index within the task (0-based). */
  n: z.number().int().nonnegative(),
  wsHash: z.string().min(1).max(64),
  backend: CheckpointBackendSchema,
  /** git-ref backend only: the throwaway commit / ref. */
  gitRef: z.string().max(256).nullable().default(null),
  /** Files that existed before the batch and were about to be modified. */
  touched: z.array(z.string().max(4096)).default([]),
  /** Files the agent was about to create (absent at capture time). */
  created: z.array(z.string().max(4096)).default([]),
  /** Files the agent was about to delete (present at capture time). */
  deleted: z.array(z.string().max(4096)).default([]),
  summary: z.string().max(1024).default(''),
  createdAt: z.number().int(),
  /** Bytes the bundle occupies (for the 512 MB retention budget). */
  sizeBytes: z.number().int().nonnegative().default(0)
});
export type CheckpointManifest = z.infer<typeof CheckpointManifestSchema>;

/**
 * The encrypted bundle payload. `before` maps a relative path to its pre-edit
 * contents (string), or null when the file did not exist (a create). `after`
 * records the agent's result contents once finalized, enabling honest three-way
 * conflict detection at restore: a file whose current disk state differs from
 * BOTH `before` and `after` was edited by the user, not just the agent.
 */
export const CheckpointBundleSchema = z.object({
  manifest: CheckpointManifestSchema,
  before: z.record(z.string(), z.string().nullable()),
  after: z.record(z.string(), z.string().nullable()).default({})
});
export type CheckpointBundle = z.infer<typeof CheckpointBundleSchema>;

/** A file the restore step refuses to overwrite silently. */
export const CheckpointConflictSchema = z.object({
  path: z.string().max(4096),
  checkpointContent: z.string().nullable(),
  currentContent: z.string().nullable()
});
export type CheckpointConflict = z.infer<typeof CheckpointConflictSchema>;

export const RestoreModeSchema = z.enum(['force', 'keep-mine', 'review']);
export type RestoreMode = z.infer<typeof RestoreModeSchema>;

export const RestoreResultSchema = z.object({
  restored: z.array(z.string().max(4096)),
  created: z.array(z.string().max(4096)),
  deleted: z.array(z.string().max(4096)),
  conflicts: z.array(CheckpointConflictSchema),
  skipped: z.array(z.string().max(4096)),
  success: z.boolean()
});
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

/* ------------------------------------------------------------------ IPC ---- */

export const CHECKPOINT_CHANNELS = {
  list: 'checkpoint:list',
  capture: 'checkpoint:capture',
  restorePreview: 'checkpoint:restorePreview',
  restore: 'checkpoint:restore',
  purgeOlderThan: 'checkpoint:purge'
} as const;

export const ListCheckpointsRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(128).optional()
}).strict();

export const CaptureCheckpointRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(128),
  edits: z.array(PlannedEditSchema).max(512),
  summary: z.string().max(1024).optional()
}).strict();

export const RestoreCheckpointRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  checkpointId: z.string().min(1).max(128),
  mode: RestoreModeSchema.default('review')
}).strict();

export const PurgeCheckpointsRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  olderThanMs: z.number().int().nonnegative()
}).strict();

export type ListCheckpointsRequest = z.infer<typeof ListCheckpointsRequestSchema>;
export type CaptureCheckpointRequest = z.infer<typeof CaptureCheckpointRequestSchema>;
export type RestoreCheckpointRequest = z.infer<typeof RestoreCheckpointRequestSchema>;
export type PurgeCheckpointsRequest = z.infer<typeof PurgeCheckpointsRequestSchema>;

/** Retention: cap 50 checkpoints or 512 MB per workspace (whichever hits first). */
export const CHECKPOINT_RETENTION = {
  maxCount: 50,
  maxBytes: 512 * 1024 * 1024
} as const;

export function checkpointRefName(taskId: string, n: number): string {
  return `refs/tycode/checkpoints/${taskId}/${n}`;
}
