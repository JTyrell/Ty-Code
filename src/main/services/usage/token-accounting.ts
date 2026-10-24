/**
 * Ty-Code Token Accounting — Record Schema & Calibrated Counting Strategy
 *
 * Implements:
 * - LayerToken and TokenAccountingRecord Zod schemas
 * - Tiktoken WASM path with fallback to calibrated character-ratio tokenizer
 * - Content-hash LRU memoization (5k entries)
 * - Canonical record serialization for tamper-evident hash chaining
 *
 * Brand: Ty-Code
 */

import { z } from 'zod';
import crypto from 'node:crypto';

// ─── Schemas ────────────────────────────────────────────────────────────────

export const LayerTokenKindSchema = z.enum(['system', 'history', 'tool', 'user', 'response']);
export type LayerTokenKind = z.infer<typeof LayerTokenKindSchema>;

export const LayerTokenMethodSchema = z.enum(['tiktoken', 'calibrated']);
export type LayerTokenMethod = z.infer<typeof LayerTokenMethodSchema>;

export const LayerToken = z.object({
  name: z.string(), // CORE | PROFILE | MODE | ROLE:security | QUEST | ENV | history | tool_result | user | response
  kind: LayerTokenKindSchema,
  tokens: z.number().int().nonnegative(),
  method: LayerTokenMethodSchema,
  cached: z.boolean().default(false), // eligible for provider prompt-cache
  cacheHit: z.boolean().optional() // provider-reported cache read
});
export type LayerToken = z.infer<typeof LayerToken>;

export const BillingTierSchema = z.enum(['metered', 'free-tier', 'local']);
export type BillingTier = z.infer<typeof BillingTierSchema>;

export const AccountingPhaseSchema = z.enum(['assembly', 'request', 'response', 'tool', 'policy']);
export type AccountingPhase = z.infer<typeof AccountingPhaseSchema>;

export const HopLatencyRecordSchema = z.object({
  hop: z.enum(['H1', 'H2', 'H3', 'H4', 'H5']),
  latencyMs: z.number().nonnegative()
});
export type HopLatencyRecord = z.infer<typeof HopLatencyRecordSchema>;

export const TokenAccountingRecord = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  sessionId: z.string(),
  taskId: z.string(),
  provider: z.string(),
  model: z.string(),
  billing: BillingTierSchema.default('metered'),
  phase: AccountingPhaseSchema,
  layers: z.array(LayerToken),
  totals: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cachedInput: z.number().int().nonnegative().default(0)
  }),
  hops: z.array(HopLatencyRecordSchema).optional(),
  cost: z
    .object({
      currency: z.literal('USD'),
      amount: z.number().nonnegative()
    })
    .optional(),
  prevHash: z.string(), // hash-chain for tamper-evidence
  recordHash: z.string(),
  policyAudit: z
    .object({
      action: z.string(),
      allowed: z.boolean(),
      reason: z.string().optional(),
      org: z.string().optional()
    })
    .optional()
});
export type TokenAccountingRecord = z.infer<typeof TokenAccountingRecord>;

// ─── Token Counting Strategy ───────────────────────────────────────────────

export type ContentFormat = 'code' | 'prose' | 'json' | 'markdown';

const CALIBRATION_FACTORS: Record<ContentFormat, number> = {
  code: 3.2,
  prose: 4.2,
  json: 3.5,
  markdown: 3.8
};

const JSON_HINT = /^\s*[\{\[]/;
const CODE_HINT = /[=;{}()<>]|function|class|const|let|var|import|export|def |=>|\[\]/;
const MARKDOWN_HINT = /^(?:#{1,6}\s|[-*+]\s|```|>\s|\[.*\]\(.*\))/m;

export function detectFormat(text: string): ContentFormat {
  const trimmed = text.trim();
  if (JSON_HINT.test(trimmed)) return 'json';
  if (MARKDOWN_HINT.test(trimmed)) return 'markdown';
  if (CODE_HINT.test(trimmed)) return 'code';
  return 'prose';
}

// LRU Memoization Cache (5,000 entries max)
const LRU_MAX_ENTRIES = 5000;
const tokenCountCache = new Map<string, { tokens: number; method: LayerTokenMethod }>();

function cacheKey(content: string, format: ContentFormat): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `${format}:${hash}`;
}

let tiktokenEncoder: any = null;
let tiktokenAttempted = false;

function getTiktokenEncoder(): any | null {
  if (tiktokenAttempted) return tiktokenEncoder;
  tiktokenAttempted = true;
  try {
    // Attempt dynamic resolution of bundled tiktoken / js-tiktoken if available
    const tiktoken = require('tiktoken');
    if (tiktoken && typeof tiktoken.get_encoding === 'function') {
      tiktokenEncoder = tiktoken.get_encoding('cl100k_base');
    }
  } catch {
    tiktokenEncoder = null;
  }
  return tiktokenEncoder;
}

/**
 * Counts tokens in text using exact tiktoken if bundled, or calibrated character-ratio fallback.
 * Results are cached in an LRU (5,000 entries max).
 */
export function countTokens(
  text: string,
  explicitFormat?: ContentFormat
): { tokens: number; method: LayerTokenMethod } {
  if (!text) return { tokens: 0, method: 'calibrated' };

  const format = explicitFormat || detectFormat(text);
  const key = cacheKey(text, format);

  const cached = tokenCountCache.get(key);
  if (cached) {
    // Move to most recent for LRU behavior
    tokenCountCache.delete(key);
    tokenCountCache.set(key, cached);
    return cached;
  }

  let result: { tokens: number; method: LayerTokenMethod };

  const encoder = getTiktokenEncoder();
  if (encoder) {
    try {
      const encoded = encoder.encode(text);
      result = { tokens: encoded.length, method: 'tiktoken' };
    } catch {
      const factor = CALIBRATION_FACTORS[format];
      result = { tokens: Math.ceil(text.length / factor), method: 'calibrated' };
    }
  } else {
    const factor = CALIBRATION_FACTORS[format];
    result = { tokens: Math.ceil(text.length / factor), method: 'calibrated' };
  }

  // Enforce LRU cap
  if (tokenCountCache.size >= LRU_MAX_ENTRIES) {
    const oldestKey = tokenCountCache.keys().next().value;
    if (oldestKey) tokenCountCache.delete(oldestKey);
  }
  tokenCountCache.set(key, result);

  return result;
}

/**
 * Clears the token counting LRU cache (used in testing or reload).
 */
export function clearTokenCountCache(): void {
  tokenCountCache.clear();
}

/**
 * Computes canonical JSON representation of a record for deterministic hash chaining.
 * Excludes recordHash so the hash can be computed over (prevHash + canonical).
 */
export function canonicalizeRecordForHashing(
  record: Omit<TokenAccountingRecord, 'recordHash'>
): string {
  // Sort keys deterministically
  const sortedKeys = Object.keys(record).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = (record as any)[k];
  }
  return JSON.stringify(sortedObj);
}

/**
 * Computes the tamper-evident hash for a record given its previous hash.
 */
export function computeRecordHash(
  prevHash: string,
  record: Omit<TokenAccountingRecord, 'recordHash' | 'prevHash'> & { prevHash?: string }
): string {
  const recordWithPrev: Omit<TokenAccountingRecord, 'recordHash'> = {
    ...record,
    prevHash
  };
  const canonical = canonicalizeRecordForHashing(recordWithPrev);
  return crypto.createHash('sha256').update(`${prevHash}:${canonical}`).digest('hex');
}

/**
 * Validates a hash chain of records. Returns true if valid, false if tampered.
 */
export function verifyHashChain(records: TokenAccountingRecord[]): boolean {
  if (records.length === 0) return true;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const { recordHash, ...rest } = rec;
    const expected = computeRecordHash(rec.prevHash, rest);
    if (expected !== recordHash) {
      return false;
    }
    if (i > 0 && rec.prevHash !== records[i - 1].recordHash) {
      return false;
    }
  }

  return true;
}
