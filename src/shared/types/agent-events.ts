import { z } from 'zod';

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

export const AgentErrorPayloadSchema = z.object({
  taskId: z.string(),
  error: z.string(),
  errorCard: ChatErrorCardSchema.optional()
});
export type AgentErrorPayload = z.infer<typeof AgentErrorPayloadSchema>;
