/**
 * Prompt C Step 3 — Semantic code index shared contract.
 *
 * A strictly-LOCAL embeddings index over workspace source chunks. Embeddings come
 * from a local source only, chosen in this order:
 *   1. Ollama   (http://localhost:11434/api/embeddings) when the daemon is reachable
 *   2. WASM     (a bundled transformers model running in-process) when available
 *   3. token    (deterministic hashed bag-of-tokens fallback — always works, offline)
 *
 * The index lives under the project-local `.tycode/index/` directory and updates
 * incrementally (debounced) off content hashes. The `semantic_search` agent tool
 * ranks chunks by cosine similarity and returns paths + snippets. No cloud network
 * hop is ever made here — the only local socket is to the chosen local embedder.
 */

import { z } from 'zod';

export const SEMANTIC_INDEX_VERSION = 1 as const;

/** Project-local directory holding the chunk index + vectors. */
export const INDEX_DIR = '.tycode/index';

/** Max chunks embedded per rebuild pass (bounds main-process work). */
export const INDEX_MAX_CHUNKS = 3000;

export const EmbeddingSourceSchema = z.enum(['ollama', 'wasm', 'token']);
export type EmbeddingSource = z.infer<typeof EmbeddingSourceSchema>;

/** A single indexed source chunk with its vector (float32, stored on disk). */
export const IndexChunkSchema = z.object({
  /** Stable id: `${relPath}#${chunkIndex}`. */
  id: z.string().max(512),
  /** Workspace-relative, forward-slash path. */
  relPath: z.string().max(4096),
  chunkIndex: z.number().int().nonnegative(),
  /** First line (1-based) covered by the chunk. */
  startLine: z.number().int().nonnegative(),
  /** Verbatim text of the chunk (capped). */
  text: z.string().max(8000),
  /** Content hash of the parent file at index time (drift key). */
  fileHash: z.string().max(64)
});
export type IndexChunk = z.infer<typeof IndexChunkSchema>;

/** Persisted index manifest (plaintext, git-ignored by default). */
export const IndexManifestSchema = z.object({
  v: z.literal(SEMANTIC_INDEX_VERSION),
  source: EmbeddingSourceSchema,
  model: z.string().max(200),
  dim: z.number().int().nonnegative(),
  builtAt: z.number().int(),
  /** Aggregate source-snapshot hash the index was built from. */
  sourceSnapshotHash: z.string().max(64),
  chunkCount: z.number().int().nonnegative(),
  /** relPath → content hash at build time (incremental diffing). */
  fileHashes: z.record(z.string(), z.string())
});
export type IndexManifest = z.infer<typeof IndexManifestSchema>;

/** Human-facing index status for the sidecar UI. */
export const IndexStatusSchema = z.object({
  exists: z.boolean(),
  source: EmbeddingSourceSchema.nullable(),
  model: z.string().max(200).nullable(),
  dim: z.number().int().nonnegative().nullable(),
  builtAt: z.number().int().nullable(),
  chunkCount: z.number().int().nonnegative(),
  /** Files changed since the index was built (drift), no rebuild required to know this. */
  pendingFiles: z.number().int().nonnegative(),
  indexing: z.boolean()
});
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

/* --------------------------------------------------------------- IPC ------- */

export const INDEX_CHANNELS = {
  status: 'index:status',
  rebuild: 'index:rebuild',
  search: 'index:search',
  /** main → renderer streaming of build progress. */
  progress: 'index:progress'
} as const;

export const IndexStatusRequestSchema = z
  .object({ workspaceRoot: z.string().min(1).max(4096) })
  .strict();
export type IndexStatusRequest = z.infer<typeof IndexStatusRequestSchema>;

export const RebuildIndexRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    /** Force a full rebuild even when nothing drifted. */
    force: z.boolean().default(false)
  })
  .strict();
export type RebuildIndexRequest = z.infer<typeof RebuildIndexRequestSchema>;

export const SemanticSearchRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    query: z.string().min(1).max(512),
    limit: z.number().int().positive().max(30).default(8)
  })
  .strict();
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;

/** A ranked search hit returned by `semantic_search`. */
export const SemanticHitSchema = z.object({
  relPath: z.string().max(4096),
  chunkIndex: z.number().int().nonnegative(),
  startLine: z.number().int().nonnegative(),
  score: z.number(),
  snippet: z.string().max(1200)
});
export type SemanticHit = z.infer<typeof SemanticHitSchema>;

export const RebuildIndexResultSchema = z.object({
  rebuilt: z.boolean(),
  reason: z.enum(['built', 'incremental', 'fresh', 'no-source', 'unavailable', 'error']).optional(),
  message: z.string().max(1024).optional(),
  status: IndexStatusSchema
});
export type RebuildIndexResult = z.infer<typeof RebuildIndexResultSchema>;
