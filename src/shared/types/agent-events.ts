import { z } from 'zod';

export const AgentStartTaskPayloadSchema = z.object({
  taskId: z.string().optional(),
  traceId: z.string().optional(),
  prompt: z.string(),
  images: z.array(z.string()).optional(),
  workspacePath: z.string().optional(),
  history: z.unknown().optional(),
  agentMode: z.string().optional(),
  mode: z.enum(['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP']).optional(),
  sessionId: z.string().optional(),
  activeFilePath: z.string().optional(),
  activeFileContent: z.string().optional(),
  openFilePaths: z.array(z.string()).optional(),
  providerOverride: z.string().optional(),
  modelOverride: z.string().optional(),
  resumeSessionId: z.string().optional(),
  clientSentAt: z.number().optional()
});
export type AgentStartTaskPayload = z.infer<typeof AgentStartTaskPayloadSchema>;

export const AgentStreamTokenPayloadSchema = z.object({
  taskId: z.string(),
  token: z.string()
});
export type AgentStreamTokenPayload = z.infer<typeof AgentStreamTokenPayloadSchema>;

export const AgentReasoningTokenPayloadSchema = z.object({
  taskId: z.string(),
  token: z.string()
});
export type AgentReasoningTokenPayload = z.infer<typeof AgentReasoningTokenPayloadSchema>;

export const AgentToolStartPayloadSchema = z.object({
  taskId: z.string(),
  toolCall: z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown())
  })
});
export type AgentToolStartPayload = z.infer<typeof AgentToolStartPayloadSchema>;

export const AgentToolResultPayloadSchema = z.object({
  taskId: z.string(),
  toolResult: z.object({
    toolCallId: z.string(),
    name: z.string(),
    output: z.string(),
    isError: z.boolean().optional()
  })
});
export type AgentToolResultPayload = z.infer<typeof AgentToolResultPayloadSchema>;

export const AgentDiffProposedPayloadSchema = z.object({
  taskId: z.string(),
  diff: z.object({
    id: z.string(),
    filePath: z.string(),
    originalContent: z.string(),
    proposedContent: z.string(),
    description: z.string(),
    status: z.enum(['pending', 'applied', 'rejected'])
  })
});
export type AgentDiffProposedPayload = z.infer<typeof AgentDiffProposedPayloadSchema>;

export const AgentDonePayloadSchema = z.object({
  taskId: z.string(),
  cancelled: z.boolean().optional()
});
export type AgentDonePayload = z.infer<typeof AgentDonePayloadSchema>;

export const ChatErrorCardSchema = z.object({
  taxonomyCode: z.string(),
  message: z.string(),
  remedy: z.string(),
  actionUrl: z.string().optional(),
  actionLabel: z.string().optional(),
  suggestedFallback: z.string().optional(),
  hopId: z.string().optional(),
  providerId: z.string().optional(),
  retryAfterSec: z.number().optional()
});
export type ChatErrorCard = z.infer<typeof ChatErrorCardSchema>;

export const ScopeRejectionCardSchema = z.object({
  toolName: z.string(),
  mode: z.string(),
  scope: z.string(),
  reason: z.string(),
  remedy: z.string(),
  actionLabel: z.string().optional(),
  actionCommand: z.string().optional(),
  targetPath: z.string().optional()
});
export type ScopeRejectionCard = z.infer<typeof ScopeRejectionCardSchema>;

export const AgentErrorPayloadSchema = z.object({
  taskId: z.string(),
  error: z.string(),
  errorCard: ChatErrorCardSchema.optional(),
  scopeRejectionCard: ScopeRejectionCardSchema.optional()
});
export type AgentErrorPayload = z.infer<typeof AgentErrorPayloadSchema>;

export const zDocumentSection = z.object({
  id: z.string(),
  heading: z.string(),
  level: z.number().int(),
  markdown: z.string()
});
export type AgentDocumentSectionPayload = z.infer<typeof zDocumentSection>;

export const zDocument = z.object({
  id: z.string(),
  kind: z.enum(['plan', 'report']),
  title: z.string(),
  markdown: z.string(),
  sections: z.array(zDocumentSection),
  createdAt: z.number()
});
export type AgentDocumentPayload = z.infer<typeof zDocument>;

export const zDocumentProposed = z.object({
  taskId: z.string(),
  type: z.literal('document_proposed').optional(),
  document: zDocument
});
export type DocumentProposedPayload = z.infer<typeof zDocumentProposed>;

// ===== Autonomous Free-Tier Reliability (Prompts 1-3) =====
// SILENT-class infrastructure: health snapshots and advisor events ride
// dedicated reliability channels only. No other code path may emit these.

export const ReliabilityLadderStepSchema = z.object({
  step: z.string(),
  outcome: z.string(),
  detail: z.string().optional()
});
export type ReliabilityLadderStep = z.infer<typeof ReliabilityLadderStepSchema>;

export const ReliabilityRouteHealthSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  status: z.enum(['ok', 'degraded', 'cooling', 'unknown']),
  successRate: z.number(),
  cachedTtftMs: z.number().nullable(),
  p95TtftMs: z.number().nullable(),
  cooldownRemainingSec: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  lastProbeTs: z.number().nullable()
});
export type ReliabilityRouteHealth = z.infer<typeof ReliabilityRouteHealthSchema>;

export const ReliabilityHealthSnapshotSchema = z.object({
  version: z.number().int(),
  updatedAt: z.number(),
  routes: z.array(ReliabilityRouteHealthSchema)
});
export type ReliabilityHealthSnapshot = z.infer<typeof ReliabilityHealthSnapshotSchema>;

export const ReliabilityAdvisorPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('card'),
    rootCauseHash: z.string(),
    taskId: z.string().optional(),
    taxonomyCode: z.string(),
    message: z.string(),
    remedy: z.string(),
    actionLabel: z.string().optional(),
    actionUrl: z.string().optional(),
    suggestedFallback: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    stepsTaken: z.array(ReliabilityLadderStepSchema),
    ts: z.number()
  }),
  z.object({
    kind: z.literal('recovered'),
    rootCauseHash: z.string().optional(),
    providerId: z.string(),
    message: z.string(),
    ts: z.number()
  })
]);
export type ReliabilityAdvisorPayload = z.infer<typeof ReliabilityAdvisorPayloadSchema>;

export const DevChaosFaultSchema = z.enum(['timeout', 'refused', 'auth_401', 'rate_429']);
export const DevChaosRequestSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  fault: DevChaosFaultSchema,
  durationMs: z.number().int().positive().max(60_000).optional()
});
export type DevChaosFault = z.infer<typeof DevChaosFaultSchema>;
export type DevChaosRequest = z.infer<typeof DevChaosRequestSchema>;
