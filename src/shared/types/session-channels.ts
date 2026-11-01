/**
 * Session IPC channel names + request schemas.
 *
 * Every session read/write crosses the IPC boundary through one of these
 * channels and is validated by the matching schema BEFORE main touches disk, so
 * a malformed or oversized payload from any window is rejected rather than
 * persisted. `SessionPayloadSchema` / `SessionSidecarSchema` are reused straight
 * from the envelope contract so the IPC boundary and the on-disk shape can never
 * drift apart.
 */

import { z } from 'zod';
import { SessionPayloadSchema } from './session-envelope';

export const SESSION_CHANNELS = {
  list: 'session:list',
  open: 'session:open',
  create: 'session:create',
  switch: 'session:switch',
  rename: 'session:rename',
  delete: 'session:delete',
  fork: 'session:fork',
  search: 'session:search',
  save: 'session:save',
  activeGet: 'session:active:get',
  flush: 'session:flush',
  // main -> renderers broadcast (excludes the originating window)
  changedEvent: 'chat-session:changed',
  // main -> renderers when a decrypt failure locks a session on open
  lockedEvent: 'chat-session:locked'
} as const;

export type SessionChannelName = (typeof SESSION_CHANNELS)[keyof typeof SESSION_CHANNELS];

const WorkspaceRoot = z.string().trim().min(1).max(4096);
const SessionId = z.string().min(1).max(128);

export const SessionListRequestSchema = z.object({ workspaceRoot: WorkspaceRoot }).strict();

export const SessionOpenRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, sessionId: SessionId })
  .strict();

export const SessionCreateRequestSchema = z
  .object({
    workspaceRoot: WorkspaceRoot,
    title: z.string().max(512).optional(),
    agentMode: z.enum(['plan', 'build', 'execute', 'hybrid']).optional(),
    contextLimit: z.number().int().positive().max(10_000_000).optional(),
    lockRouteId: z.string().max(256).nullable().optional()
  })
  .strict();

export const SessionSwitchRequestSchema = z
  .object({
    workspaceRoot: WorkspaceRoot,
    sessionId: SessionId.nullable(),
    // Originating window nonce; the broadcast skips the sender regardless.
    origin: z.string().max(64).optional()
  })
  .strict();

export const SessionRenameRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, sessionId: SessionId, title: z.string().max(512) })
  .strict();

export const SessionDeleteRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, sessionId: SessionId })
  .strict();

export const SessionForkRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, sessionId: SessionId, uptoMessageId: z.string().max(128) })
  .strict();

export const SessionSearchRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, query: z.string().max(512) })
  .strict();

export const SessionSaveRequestSchema = z
  .object({ workspaceRoot: WorkspaceRoot, payload: SessionPayloadSchema })
  .strict();

export const SessionActiveGetRequestSchema = z.object({ workspaceRoot: WorkspaceRoot }).strict();

export type SessionListRequest = z.infer<typeof SessionListRequestSchema>;
export type SessionOpenRequest = z.infer<typeof SessionOpenRequestSchema>;
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;
export type SessionSwitchRequest = z.infer<typeof SessionSwitchRequestSchema>;
export type SessionRenameRequest = z.infer<typeof SessionRenameRequestSchema>;
export type SessionDeleteRequest = z.infer<typeof SessionDeleteRequestSchema>;
export type SessionForkRequest = z.infer<typeof SessionForkRequestSchema>;
export type SessionSearchRequest = z.infer<typeof SessionSearchRequestSchema>;
export type SessionSaveRequest = z.infer<typeof SessionSaveRequestSchema>;
