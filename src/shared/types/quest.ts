/**
 * Prompt B — Quest Mode shared contract.
 *
 * Quests are long-horizon tasks delegated asynchronously: an agent drafts a
 * Spec (reviewed in the Document Review Pane with section comments), and only
 * AFTER explicit human approval does the quest execute inside an isolated git
 * worktree at `.tycode/worktrees/{questId}` with its own session, todos and
 * checkpoints. Parallel quests are allowed up to QUEST_MAX_PARALLEL. The main
 * workspace is never edited directly — changes reach it only through the merge
 * review (per-file Accept → commit, or cherry-pick) or are discarded with the
 * worktree.
 *
 * Nothing here imports Electron.
 */

import { z } from 'zod';

export const QUEST_WORKTREES_DIR = '.tycode/worktrees';
export const QUEST_MAX_PARALLEL = 3;
export const QUEST_LOG_LIMIT = 500;

/* ------------------------------------------------------------- Lifecycle --- */

export const QuestStatusSchema = z.enum([
  /** Spec is being drafted by the agent. */
  'drafting',
  /** Spec is ready; the approval gate is enforced here — nothing runs before Approve. */
  'awaiting-approval',
  /** Approved but the parallel cap is saturated; starts automatically when a slot frees. */
  'queued',
  /** Executing inside the isolated worktree. */
  'running',
  /** Finished; diff vs the base commit awaits merge review. */
  'reviewing',
  'merged',
  'discarded',
  'cancelled',
  'failed'
]);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

export const QuestChangedFileSchema = z.object({
  /** Workspace-relative POSIX path. */
  path: z.string().max(4096),
  /** `git diff --name-status` letter(s): A/M/D/R… */
  status: z.string().max(4)
});
export type QuestChangedFile = z.infer<typeof QuestChangedFileSchema>;

export const QuestTodoRefSchema = z.object({
  id: z.string().max(128),
  task: z.string().max(2000),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed'])
});
export type QuestTodoRef = z.infer<typeof QuestTodoRefSchema>;

export const QuestLogLineSchema = z.object({
  ts: z.number().int(),
  level: z.enum(['info', 'tool', 'thought', 'status', 'error']),
  text: z.string().max(2000)
});
export type QuestLogLine = z.infer<typeof QuestLogLineSchema>;

/** The full quest record as tracked by the main process. */
export const QuestMetaSchema = z.object({
  id: z.string().max(128),
  title: z.string().max(300),
  objective: z.string().max(8000),
  /** Main workspace root the quest was delegated from. */
  workspaceRoot: z.string().max(4096),
  status: QuestStatusSchema,
  /** quest/{id} branch created for the worktree. */
  branch: z.string().max(300),
  /** Absolute path of the isolated worktree ('' until it exists). */
  worktreePath: z.string().max(4096),
  /** HEAD of the main workspace when the quest was approved (diff base). */
  baseCommit: z.string().max(64),
  /** Session id the quest runtime writes its own transcript under. */
  questSessionId: z.string().max(256),
  /** Session of the chat that delegated the quest (quest card lands here). */
  originSessionId: z.string().max(256).default(''),
  /** AgentDocument id of the current spec revision. */
  specDocumentId: z.string().max(256).default(''),
  specRevisions: z.number().int().nonnegative().default(0),
  todos: z.array(QuestTodoRefSchema).max(200).default([]),
  changedFiles: z.array(QuestChangedFileSchema).max(2000).default([]),
  acceptedFiles: z.array(z.string().max(4096)).max(2000).default([]),
  error: z.string().max(2000).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
});
export type QuestMeta = z.infer<typeof QuestMetaSchema>;

/* ----------------------------------------------------------------- IPC ----- */

export const QUEST_CHANNELS = {
  list: 'quest:list',
  draft: 'quest:draft',
  revise: 'quest:revise',
  approve: 'quest:approve',
  cancel: 'quest:cancel',
  discard: 'quest:discard',
  detail: 'quest:detail',
  fileDiff: 'quest:file-diff',
  acceptFiles: 'quest:accept-files',
  finish: 'quest:finish',
  /** Renderer subscribes once; main captures the sender for pushes. */
  subscribe: 'quest:subscribe',
  /** main → renderer quest event stream. */
  events: 'quest:events'
} as const;

export const QuestListRequestSchema = z
  .object({ workspaceRoot: z.string().min(1).max(4096) })
  .strict();
export type QuestListRequest = z.infer<typeof QuestListRequestSchema>;

export const DraftQuestRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    objective: z.string().min(1).max(8000),
    originSessionId: z.string().max(256).optional()
  })
  .strict();
export type DraftQuestRequest = z.infer<typeof DraftQuestRequestSchema>;

export const QuestIdRequestSchema = z
  .object({ questId: z.string().min(1).max(128) })
  .strict();
export type QuestIdRequest = z.infer<typeof QuestIdRequestSchema>;

export const ReviseQuestRequestSchema = z
  .object({
    questId: z.string().min(1).max(128),
    /** Per-section comments collected from the Document Review Pane. */
    feedback: z.array(z.string().min(1).max(2000)).max(50).default([])
  })
  .strict();
export type ReviseQuestRequest = z.infer<typeof ReviseQuestRequestSchema>;

export const QuestFileDiffRequestSchema = z
  .object({
    questId: z.string().min(1).max(128),
    path: z.string().min(1).max(4096)
  })
  .strict();
export type QuestFileDiffRequest = z.infer<typeof QuestFileDiffRequestSchema>;

export const AcceptQuestFilesRequestSchema = z
  .object({
    questId: z.string().min(1).max(128),
    paths: z.array(z.string().min(1).max(4096)).min(1).max(400)
  })
  .strict();
export type AcceptQuestFilesRequest = z.infer<typeof AcceptQuestFilesRequestSchema>;

export const FinishQuestRequestSchema = z
  .object({
    questId: z.string().min(1).max(128),
    /** accept-commit: commit the per-file accepted set. cherry-pick: take the whole quest branch. */
    mode: z.enum(['accept-commit', 'cherry-pick']).default('accept-commit')
  })
  .strict();
export type FinishQuestRequest = z.infer<typeof FinishQuestRequestSchema>;

/** One file's merge-review diff (contents capped by the service). */
export const QuestFileDiffSchema = z.object({
  path: z.string().max(4096),
  status: z.string().max(4),
  originalContent: z.string().max(400_000),
  modifiedContent: z.string().max(400_000)
});
export type QuestFileDiff = z.infer<typeof QuestFileDiffSchema>;

/** Pushed on QUEST_CHANNELS.events for every lifecycle change. */
export const QuestEventSchema = z.object({
  questId: z.string().max(128),
  kind: z.enum(['status', 'log', 'spec', 'todos', 'files', 'done']),
  quest: QuestMetaSchema.optional(),
  line: QuestLogLineSchema.optional(),
  /** For kind='spec': the AgentDocument payload (validated upstream by zDocument). */
  document: z.unknown().optional()
});
export type QuestEvent = z.infer<typeof QuestEventSchema>;

/** quest:detail / quest:subscribe responses. */
export const QuestStateSnapshotSchema = z.object({
  quests: z.array(QuestMetaSchema).max(200),
  logs: z.record(z.string(), z.array(QuestLogLineSchema))
});
export type QuestStateSnapshot = z.infer<typeof QuestStateSnapshotSchema>;
