/**
 * Phase 2 — Inline Assist shared channels + Zod contracts.
 *
 * Only the *persistence* half of inline assist crosses IPC; generation reuses
 * the existing agent chunk channel (`chunkEvent`) so we do not add a second
 * streaming path. This module exists because the strict rule is:
 * "Zod-guarded channels: every new channel has a schema and every handler
 * returns `IpcResponse<T>`".
 */

import { z } from 'zod';

export const INLINE_ASSIST_CHANNELS = {
  saveThread: 'inlineAssist:saveThread',
  loadThread: 'inlineAssist:loadThread',
  listThreads: 'inlineAssist:listThreads',
  deleteThread: 'inlineAssist:deleteThread',
} as const;

/**
 * One turn inside an inline thread. Tightly bounded — the widget is not a chat
 * transcript, and oversized payloads must fail fast rather than bloat the
 * session JSON.
 */
export const InlineTurnSchema = z.object({
  id: z.string().min(1).max(64),
  objective: z.string().min(1).max(2000),
  proposal: z.string().max(200_000).optional(),
  accepted: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
}).strict();

/**
 * Anchor the widget was opened on. Range is line/col in the file so a
 * mid-file edit does not invalidate the thread; the widget re-anchors by
 * file path even if the specific range moves.
 */
export const InlineAnchorSchema = z.object({
  filePath: z.string().min(1).max(4096),
  startLine: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
}).strict();

export const InlineThreadSchema = z.object({
  threadId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  anchor: InlineAnchorSchema,
  lockedRouteId: z.string().max(128).nullable(),
  agentMode: z.enum(['plan', 'act', 'execute']).nullable().optional(),
  turns: z.array(InlineTurnSchema).max(64),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const SaveThreadRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  thread: InlineThreadSchema,
}).strict();

export const LoadThreadRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  threadId: z.string().min(1).max(64),
}).strict();

export const ListThreadsRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(128),
}).strict();

export const DeleteThreadRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  threadId: z.string().min(1).max(64),
}).strict();

export type InlineTurn = z.infer<typeof InlineTurnSchema>;
export type InlineAnchor = z.infer<typeof InlineAnchorSchema>;
export type InlineThread = z.infer<typeof InlineThreadSchema>;
export type SaveThreadRequest = z.infer<typeof SaveThreadRequestSchema>;
export type LoadThreadRequest = z.infer<typeof LoadThreadRequestSchema>;
export type ListThreadsRequest = z.infer<typeof ListThreadsRequestSchema>;
export type DeleteThreadRequest = z.infer<typeof DeleteThreadRequestSchema>;
