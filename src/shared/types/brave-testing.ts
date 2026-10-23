/**
 * Brave Browser Testing Types & Zod Schemas
 *
 * Enforces schema validation across the IPC bridge for local web app testing
 * in isolated Brave Guest mode.
 *
 * Brand: Ty-Code
 */

import { z } from 'zod';

export const BraveStartTestingPayloadSchema = z.object({
  url: z.string().min(1, 'Target URL is required'),
  openVisibleWindow: z.boolean().optional()
});

export type BraveStartTestingPayload = z.infer<typeof BraveStartTestingPayloadSchema>;

export const BraveTestingStateSchema = z.object({
  active: z.boolean(),
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  error: z.string().optional()
});

export type BraveTestingState = z.infer<typeof BraveTestingStateSchema>;
