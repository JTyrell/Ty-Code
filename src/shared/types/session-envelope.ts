/**
 * Unified session envelope — shared, pure contract.
 *
 * Local-first session persistence writes exactly one shape to disk:
 *   ~/.tycode/sessions/{wsHash}/{sessionId}.json
 *
 *     { v: 1, cipher: 'safeStorage', meta: <plaintext sidecar>, payload: <tagged base64> }
 *
 * The `meta` sidecar is the ONLY plaintext field set. It carries just enough to
 * render the history browser and to detect a decrypt failure WITHOUT touching
 * the encrypted `payload` (so listing never decrypts). Everything the user
 * actually said — messages, todos, route trail, checkpoint refs, inline
 * sub-conversations — lives encrypted inside `payload`.
 *
 * `payload` stores the full output of `encryptSecret` (a tagged base64 string),
 * which decryptSecret reverses. No plaintext session contents ever hit disk.
 *
 * Rules honored here:
 *  - Zero Electron / DOM imports (main + renderer import the same shapes).
 *  - Zod v4 validation at the IPC boundary.
 *  - `lockRouteId` is nullable: a session may have no locked route yet.
 */

import { z } from 'zod';

/** The envelope version tag. Bumping this means a reader must handle migration. */
export const SESSION_ENVELOPE_VERSION = 1 as const;

/** Plaintext sidecar — the ONLY fields readable without decryption. */
export const SessionSidecarSchema = z.object({
  sessionId: z.string().min(1).max(128),
  wsHash: z.string().min(1).max(64),
  title: z.string().max(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  messageCount: z.number().int().nonnegative(),
  lockRouteId: z.string().max(256).nullable(),
  // Non-sensitive run metadata carried in the clear so the history browser AND
  // the live agent's session listing render mode / progress / token budget
  // WITHOUT ever decrypting a transcript. All optional for v1 backward-compat.
  agentMode: z.enum(['plan', 'build', 'execute', 'hybrid']).optional(),
  todoCount: z.number().int().nonnegative().optional(),
  totalTokensUsed: z.number().int().nonnegative().optional(),
  contextLimit: z.number().int().positive().optional()
});
export type SessionSidecar = z.infer<typeof SessionSidecarSchema>;

/**
 * On-disk envelope. `payload` is the tagged base64 produced by encryptSecret.
 * `chunks` records transcript overflow for sessions > 4 MB (see the store).
 */
export const SessionEnvelopeSchema = z.object({
  v: z.literal(SESSION_ENVELOPE_VERSION),
  cipher: z.literal('safeStorage'),
  meta: SessionSidecarSchema,
  payload: z.string().min(1),
  chunks: z
    .object({
      count: z.number().int().nonnegative(),
      dir: z.string().max(1024)
    })
    .nullable()
    .optional()
});
export type SessionEnvelope = z.infer<typeof SessionEnvelopeSchema>;

/**
 * The decrypted payload shape. `messages` and `todos` are intentionally typed
 * loosely as records here so this shared module stays free of preload/Electron
 * imports; the unified store casts them to ChatMessage[] / TodoItem[] at the
 * boundary where those concrete types already live.
 */
export const SessionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  workspacePath: z.string().max(4096),
  title: z.string().max(512),
  agentMode: z.enum(['plan', 'build', 'execute', 'hybrid']),
  messages: z.array(z.record(z.string(), z.unknown())),
  todos: z.array(z.record(z.string(), z.unknown())),
  routeTrail: z.array(z.record(z.string(), z.unknown())).default([]),
  checkpointRefs: z.array(z.string().max(256)).default([]),
  subConversations: z
    .array(
      z.object({
        id: z.string().min(1),
        anchorFilePath: z.string().max(4096),
        anchorRange: z
          .object({
            startLineNumber: z.number().int().nonnegative(),
            startColumn: z.number().int().nonnegative(),
            endLineNumber: z.number().int().nonnegative(),
            endColumn: z.number().int().nonnegative()
          })
          .nullable(),
        objective: z.string().max(8192),
        messages: z.array(z.record(z.string(), z.unknown())).default([]),
        createdAt: z.number().int(),
        updatedAt: z.number().int()
      })
    )
    .default([]),
  lockRouteId: z.string().max(256).nullable().default(null),
  totalTokensUsed: z.number().int().nonnegative().default(0),
  contextLimit: z.number().int().positive().default(128_000),
  compacted: z.boolean().default(false),
  compactCount: z.number().int().nonnegative().default(0),
  modifiedFiles: z.array(z.string().max(4096)).default([]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  completed: z.boolean().optional(),
  // Agent-runtime state that the flat agent store used to persist (iteration
  // count, recent tool calls, the completion contract). Carried inside the
  // encrypted payload so the unified store is the ONE place agent state lands.
  agentIterationCount: z.number().int().nonnegative().optional(),
  agentToolCalls: z
    .array(z.object({ tool: z.string().max(256), timestamp: z.number() }))
    .optional(),
  completionContract: z.record(z.string(), z.unknown()).optional(),
  // Chat-runtime audit trail (which files changed, when, optional diff id). Kept
  // encrypted with the transcript so the unified store remains the one writer.
  changeHistory: z
    .array(
      z.object({
        timestamp: z.number(),
        filePath: z.string().max(4096),
        diffId: z.string().max(256).optional(),
        description: z.string().max(1024).optional()
      })
    )
    .optional()
});
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

/** Result classification surfaced to the UI so a locked session is shown, not crashed. */
export type SessionDecryptFailureReason = 'unavailable' | 'dpapi-mismatch';

/**
 * A sidecar paired with either its decrypted payload or a locked marker. The
 * history browser consumes SidecarListing[] (never decrypted); opening a
 * session yields OpenedSession with `payload` present or `locked` true.
 */
export interface SidecarListing {
  meta: SessionSidecar;
}

export type OpenedSession =
  | { locked: false; meta: SessionSidecar; payload: SessionPayload }
  | { locked: true; meta: SessionSidecar; reason: SessionDecryptFailureReason };
