/**
 * Prompt C Step 4 — Auto-Memory (Distillation → Confirmation → Correction).
 *
 * After a task completes, a background "distillation" pass asks the locked route to
 * extract reusable correction rules the agent just applied or the user stated. These
 * become **proposed candidates** in a per-workspace queue (`.tycode/memory/pending.json`).
 * The user reviews, edits, and approves (with scope: project | global) or dismisses each
 * candidate. Approved entries feed into the existing Correction Memory (SQLite + JSONL)
 * via `saveCorrection`. The agent's prompt-assembler then uses **top-K embedding
 * relevance** to select only the most applicable rules for a given task prompt,
 * keeping injection bounded.
 *
 * STRICT RULES:
 *  - Pending candidates persist in `.tycode/memory/pending.json` (local only).
 *  - The distillation pass uses the same locked route as wiki/rules (no extra network).
 *  - Scope 'project' → workspace-scoped corrections (existing hash); scope 'global' →
 *    a special '__tycode_global__' hash that reads alongside the workspace hash.
 *  - Top-K injection bounded to K ≤ 12 rules selected by cosine relevance to the task.
 */

import { z } from 'zod';

/** A proposed candidate awaiting user confirmation. */
export const MemoryCandidateSchema = z.object({
  id: z.string().max(128),
  /** Short title describing the learned rule. */
  title: z.string().max(200),
  /** The actionable rule text. */
  rule: z.string().max(2000),
  category: z.enum(['style', 'architecture', 'stack']),
  /** Proposed scope; user may change at approve-time. */
  scope: z.enum(['project', 'global']),
  /** Why the distiller proposed this rule (context snippet or model reasoning). */
  rationale: z.string().max(1000).default(''),
  /** The workspace-relative task slug (informational). */
  taskSlug: z.string().max(300).default(''),
  createdAt: z.number().int()
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

/** Persisted local queue. */
export const PendingMemoryQueueSchema = z.object({
  v: z.literal(1),
  candidates: z.array(MemoryCandidateSchema).max(200),
  /** Rule text hashes of dismissed items to avoid re-proposing the same rule. */
  dismissed: z.array(z.string().max(64)).max(500).default([])
});
export type PendingMemoryQueue = z.infer<typeof PendingMemoryQueueSchema>;

/* --------------------------------------------------------------- IPC ------- */

export const MEMORY_DIR = '.tycode/memory';

export const MEMORY_CHANNELS = {
  pending: 'memory:pending',
  approve: 'memory:approve',
  dismiss: 'memory:dismiss',
  distill: 'memory:distill',
  update: 'memory:update',
  /** Approved memories across BOTH project + global scope, for the manager list. */
  stored: 'memory:stored',
  /** Deletes one approved memory from its scope's correction ledger. */
  remove: 'memory:remove'
} as const;

export const MemoryPendingRequestSchema = z
  .object({ workspaceRoot: z.string().min(1).max(4096) })
  .strict();
export type MemoryPendingRequest = z.infer<typeof MemoryPendingRequestSchema>;

export const MemoryApproveRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    candidateId: z.string().max(128),
    /** User may edit scope before approving. */
    scope: z.enum(['project', 'global']).default('project'),
    /** User may edit the rule text before approving. */
    editedRule: z.string().max(2000).optional()
  })
  .strict();
export type MemoryApproveRequest = z.infer<typeof MemoryApproveRequestSchema>;

export const MemoryDismissRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    candidateId: z.string().max(128)
  })
  .strict();
export type MemoryDismissRequest = z.infer<typeof MemoryDismissRequestSchema>;

export const MemoryDistillRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    /** The user prompt / task text that just completed. */
    prompt: z.string().min(1).max(4000),
    /** Final assistant response text (for context). */
    response: z.string().min(1).max(8000)
  })
  .strict();
export type MemoryDistillRequest = z.infer<typeof MemoryDistillRequestSchema>;

export const MemoryUpdateRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    candidateId: z.string().max(128),
    title: z.string().max(200).optional(),
    rule: z.string().max(2000).optional(),
    scope: z.enum(['project', 'global']).optional(),
    category: z.enum(['style', 'architecture', 'stack']).optional()
  })
  .strict();
export type MemoryUpdateRequest = z.infer<typeof MemoryUpdateRequestSchema>;

/** Result of a distillation pass. */
export const DistillResultSchema = z.object({
  proposed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  reason: z.enum(['ok', 'no-route', 'no-learning', 'error']).optional(),
  message: z.string().max(500).optional(),
  candidates: z.array(MemoryCandidateSchema)
});
export type DistillResult = z.infer<typeof DistillResultSchema>;

export const MemoryStoredRequestSchema = z
  .object({ workspaceRoot: z.string().min(1).max(4096) })
  .strict();
export type MemoryStoredRequest = z.infer<typeof MemoryStoredRequestSchema>;

/** An approved memory as surfaced to the manager, tagged with its scope. */
export const StoredMemorySchema = z.object({
  id: z.string().max(128),
  rule: z.string().max(2000),
  category: z.string().max(40),
  surface: z.string().max(40).optional(),
  scope: z.enum(['project', 'global']),
  createdAt: z.number().int()
});
export type StoredMemory = z.infer<typeof StoredMemorySchema>;

export const RemoveStoredMemoryRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    /** 'project' resolves the workspace ledger; 'global' resolves the shared one. */
    scope: z.enum(['project', 'global']),
    id: z.string().max(128)
  })
  .strict();
export type RemoveStoredMemoryRequest = z.infer<typeof RemoveStoredMemoryRequestSchema>;
