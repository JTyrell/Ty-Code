/**
 * Prompt E (Step 2) — MCP management contract.
 *
 * Types and Zod schemas for the live MCP client layer: server statuses with
 * real health (the JSON-RPC handshake decides, never a painted-on green dot),
 * per-server tool lists from `tools/list`, stderr log tails, and the mutation
 * requests (add stdio/SSE server, remove, enable/disable).
 *
 * Config stays in the existing `.ty-code/mcp_config.json` scopes so servers
 * configured by mcp-manager or auto-injected by the context router appear
 * here without a second source of truth.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Health + shapes
// ---------------------------------------------------------------------------

export const MCP_HEALTH_STATES = ['disabled', 'idle', 'connecting', 'connected', 'error'] as const;
export const McpHealthStateSchema = z.enum(MCP_HEALTH_STATES);
export type McpHealthState = z.infer<typeof McpHealthStateSchema>;

export const MCP_TRANSPORTS = ['stdio', 'sse'] as const;
export const McpTransportSchema = z.enum(MCP_TRANSPORTS);
export type McpTransport = z.infer<typeof McpTransportSchema>;

/** One tool as reported by the server itself (`tools/list` result). */
export const McpToolInfoSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional()
});
export type McpToolInfo = z.infer<typeof McpToolInfoSchema>;

/** Bound the pushed log tail; the panel shows the last lines, not a file. */
export const MCP_LOG_TAIL_LIMIT = 80;

export const McpServerStatusSchema = z.object({
  id: z.string().min(1),
  /** Which config scope owns this entry: the workspace file or the user global. */
  scope: z.enum(['workspace', 'global']),
  transport: McpTransportSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  /** stdio: command; sse: URL. Kept verbatim from config for honest display. */
  target: z.string(),
  args: z.array(z.string()).default([]),
  disabled: z.boolean(),
  health: McpHealthStateSchema,
  error: z.string().optional(),
  tools: z.array(McpToolInfoSchema).default([]),
  log: z.array(z.string()).default([])
});
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

// ---------------------------------------------------------------------------
// Requests (every IPC body is strict-parsed)
// ---------------------------------------------------------------------------

const WorkspacePathSchema = z.string().min(1);
/** Server ids double as config keys: lowercase, dashy, no path separators. */
export const McpServerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Server ids must be lowercase and may contain dots, dashes, underscores');

export const McpListRequestSchema = z
  .object({ workspacePath: WorkspacePathSchema })
  .strict();

export const McpAddStdioRequestSchema = z
  .object({
    workspacePath: WorkspacePathSchema,
    id: McpServerIdSchema,
    transport: z.literal('stdio'),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(400).optional(),
    command: z.string().min(1).max(400),
    args: z.array(z.string().max(400)).max(32).default([]),
    /** true = write to the workspace config, false/absent = user global. */
    projectScope: z.boolean().default(true),
    startEnabled: z.boolean().default(true)
  })
  .strict();
export type McpAddStdioRequest = z.infer<typeof McpAddStdioRequestSchema>;

export const McpAddSseRequestSchema = z
  .object({
    workspacePath: WorkspacePathSchema,
    id: McpServerIdSchema,
    transport: z.literal('sse'),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(400).optional(),
    url: z.string().min(1).max(600).refine(
      (value) => /^https?:\/\//i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value),
      'SSE MCP URLs must be http(s); remote endpoints must be plain http only on localhost'
    ),
    projectScope: z.boolean().default(true),
    startEnabled: z.boolean().default(true)
  })
  .strict();
export type McpAddSseRequest = z.infer<typeof McpAddSseRequestSchema>;

export const McpRemoveRequestSchema = z
  .object({
    workspacePath: WorkspacePathSchema,
    id: McpServerIdSchema,
    scope: z.enum(['workspace', 'global'])
  })
  .strict();

export const McpSetEnabledRequestSchema = z
  .object({
    workspacePath: WorkspacePathSchema,
    id: McpServerIdSchema,
    enabled: z.boolean()
  })
  .strict();

export const McpReconnectRequestSchema = z
  .object({
    workspacePath: WorkspacePathSchema,
    id: McpServerIdSchema
  })
  .strict();

// ---------------------------------------------------------------------------
// Events (pushed on the events channel after mcp:subscribe)
// ---------------------------------------------------------------------------

export const McpEventSchema = z.object({
  kind: z.literal('status'),
  workspaceRoot: WorkspacePathSchema,
  servers: z.array(McpServerStatusSchema)
});
export type McpEvent = z.infer<typeof McpEventSchema>;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const MCP_CHANNELS = {
  subscribe: 'mcp:manage-subscribe',
  unsubscribe: 'mcp:manage-unsubscribe',
  events: 'mcp:manage-events',
  list: 'mcp:manage-list',
  add: 'mcp:manage-add',
  remove: 'mcp:manage-remove',
  setEnabled: 'mcp:manage-set-enabled',
  reconnect: 'mcp:manage-reconnect',
  liveTools: 'mcp:manage-live-tools'
} as const;
