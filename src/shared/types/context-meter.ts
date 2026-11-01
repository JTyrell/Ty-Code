/**
 * Phase 4 Step 3 — Context Meter shared types + Zod.
 *
 * The renderer already has `contextTokens` and `contextLimit` on chat-store;
 * this contract only exists for the *compact* action, which crosses IPC so
 * the compactor runs against the same transcript the unified store just
 * decrypted (never a stale in-memory copy). The channel is thin on purpose
 * to avoid drifting from the estimator in `context-compactor.ts`.
 */

import { z } from 'zod';

export const CONTEXT_METER_CHANNELS = {
  compactNow: 'contextMeter:compactNow',
  getState: 'contextMeter:getState',
  compactedEvent: 'contextMeter:compacted',
} as const;

export const CompactNowRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(128),
  /** Optional caller-provided limit; falls back to the session payload. */
  limit: z.number().int().positive().max(4_000_000).optional(),
}).strict();

export const GetMeterStateRequestSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(128),
}).strict();

export const MeterStateSchema = z.object({
  currentTokens: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  /** Ratio (0..1) of current/limit; the UI thresholds off this, not the raw numbers. */
  ratio: z.number().min(0).max(4),
  /** Which band the ratio falls into for the footer bar. */
  band: z.enum(['safe', 'warn', 'danger', 'critical']),
  compacted: z.boolean(),
  compactCount: z.number().int().nonnegative(),
});

export const CompactedEventSchema = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(128),
  summary: z.string().max(8192),
  tokensBefore: z.number().int().nonnegative(),
  tokensAfter: z.number().int().nonnegative(),
});

export type CompactNowRequest = z.infer<typeof CompactNowRequestSchema>;
export type GetMeterStateRequest = z.infer<typeof GetMeterStateRequestSchema>;
export type MeterState = z.infer<typeof MeterStateSchema>;
export type CompactedEvent = z.infer<typeof CompactedEventSchema>;

/**
 * UI thresholds named by the plan (70% amber, 85% red, 95% critical). Kept
 * here so the renderer and any future tests share the same bands.
 */
export const CONTEXT_BAND_THRESHOLDS = {
  warn: 0.70,
  danger: 0.85,
  critical: 0.95,
} as const;

export function bandForRatio(ratio: number): MeterState['band'] {
  if (ratio >= CONTEXT_BAND_THRESHOLDS.critical) return 'critical';
  if (ratio >= CONTEXT_BAND_THRESHOLDS.danger) return 'danger';
  if (ratio >= CONTEXT_BAND_THRESHOLDS.warn) return 'warn';
  return 'safe';
}
