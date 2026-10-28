import { z } from 'zod';

/**
 * Sidecar stdout line classifier (Prompt: Stream Hygiene).
 *
 * Sidecar output is scanned line-by-line. A line enters the agent stream
 * pipeline ONLY as a protocol frame (valid JSON validated by a Zod schema,
 * an SSE `data:` prefix carrying such JSON, or the `[DONE]` sentinel).
 * Everything else is a log line: it must be routed to the sidecar ledger
 * (`sidecarLogLedger`) and must NEVER reach the renderer chat stream.
 */

export type SidecarLineClass = 'protocol' | 'log';

/** JSON-RPC reply frames emitted by the FCC sidecar on stdout. */
export const SidecarJsonRpcFrameSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.union([z.string(), z.number()]).nullable().optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.union([z.number(), z.string()]).optional(),
        message: z.string().optional(),
        data: z.unknown().optional()
      })
      .optional(),
    method: z.string().optional(),
    params: z.unknown().optional()
  })
  .passthrough();

/** OpenAI-flavored chat completion chunk / Anthropic-style event frames. */
export const SidecarChatChunkFrameSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            delta: z.object({ content: z.string().optional() }).passthrough().optional()
          })
          .passthrough()
      )
      .optional(),
    content: z
      .array(z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough())
      .optional(),
    message: z.object({ content: z.unknown().optional() }).passthrough().optional(),
    type: z.string().optional(),
    done: z.boolean().optional()
  })
  .passthrough();

const AnyJsonObjectSchema = z.record(z.string(), z.unknown());

const HARNESS_LOG_LINE_PATTERNS: RegExp[] = [
  // Exactly what the FCC harness sidecar announces when its stream/console
  // output is misrouted into the completion content channel.
  /^Processed request via FCC .* harness\.?$/i,
  /^Response routed via FCC harness: .+$/i
];

/**
 * Content-level gate for FCC-flavored completion text: harness announce lines
 * are log output even when they arrive inside a valid protocol frame.
 */
export function isHarnessLogContent(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return HARNESS_LOG_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function validateSidecarFrame(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return (
    SidecarJsonRpcFrameSchema.safeParse(parsed).success ||
    SidecarChatChunkFrameSchema.safeParse(parsed).success ||
    AnyJsonObjectSchema.safeParse(parsed).success
  );
}

/**
 * Classify one stdout/stderr line from a sidecar process.
 * Returns `{ kind: 'protocol', frame }` for validated protocol frames or
 * `{ kind: 'log' }` for everything else (which callers must route to the
 * sidecar ledger, never to the token stream).
 */
export function classifySidecarLine(line: string): { kind: 'protocol'; frame: unknown } | { kind: 'log' } {
  const trimmed = String(line).trim();
  if (!trimmed) return { kind: 'log' };

  if (trimmed === '[DONE]') return { kind: 'protocol', frame: trimmed };

  if (trimmed.startsWith('data:')) {
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return { kind: 'protocol', frame: payload };
    if (!payload) return { kind: 'log' };
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (validateSidecarFrame(parsed)) return { kind: 'protocol', frame: parsed };
    } catch {
      // fall through to log classification
    }
    return { kind: 'log' };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (validateSidecarFrame(parsed)) return { kind: 'protocol', frame: parsed };
    } catch {
      // fall through to log classification
    }
    return { kind: 'log' };
  }

  return { kind: 'log' };
}

/**
 * Exact instruction appended when a failover hop carries already-streamed
 * partial content forward. The fresh provider continues the assistant text
 * instead of restarting the answer from zero.
 */
export const FAILOVER_RESUME_INSTRUCTION =
  '[FAILOVER RESUME] The previous provider was interrupted mid-response. Continue your answer EXACTLY where it stopped; never repeat content that was already produced.';
