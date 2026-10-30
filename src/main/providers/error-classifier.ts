/**
 * Central provider-failure classifier (Route Truth, Prompt 1).
 *
 * Single source of truth for turning a provider failure (HTTP status + body
 * text + optional error code) into one of four strictly-separated classes:
 *
 *   invalid_key          — 401/403 WITH an auth-specific body/code (sticky).
 *   protocol_error       — 400 / malformed-message / tool-pairing faults
 *                          (never sticky; repair + ONE retry).
 *   rate_limited         — 429 (Retry-After honored).
 *   upstream_model_error — 5xx / unknown upstream metadata (model rotation).
 *
 * IMPORTANT INVARIANTS (Route-Truth Prompt):
 *   - ONLY `invalid_key` may ever reach providerHealthStore.markInvalidKey
 *     (sticky persistence). Every sticky-marking call site gates on
 *     `failureClass === 'invalid_key'`.
 *   - A 401/403 WITHOUT an auth-specific body is NOT proof of a bad key: it
 *     classifies as `protocol_error` so a transient edge cannot poison the
 *     route with a sticky entry.
 *   - A 400 stays `protocol_error` even when its body mentions an API key —
 *     status-first strictness (never sticky-mark a 400).
 *
 * No sticky persistence for any class except invalid_key.
 */

export type ProviderFailureClass =
  | 'invalid_key'
  | 'protocol_error'
  | 'rate_limited'
  | 'upstream_model_error';

export interface ClassifiedFailure {
  failureClass: ProviderFailureClass;
  /** True only when the failure may be sticky-persisted (invalid_key class). */
  stickyEligible: boolean;
  /** Retry-After seconds when the response supplied one (rate_limited). */
  retryAfterSec?: number;
}

/** Auth-specific body/code markers that qualify a 401/403 as invalid_key. */
const AUTH_BODY_MARKERS: RegExp[] = [
  /user not found/i, // OpenRouter: revoked/deleted account key
  /api key not valid/i, // Google UNAUTHENTICATED payloads
  /invalid api key/i, // OpenRouter/DeepSeek/Groq
  /invalid_api_key/i, // OpenAI error.code
  /unauthenticated/i, // Google APIs token error
  /invalid x-api-key/i, // Anthropic header rejection
  /incorrect api key/i, // OpenAI wording
  /invalid authentication credentials/i, // Google wording
  /authentication_error/i, // OpenAI error.type
  /anthropic.?s? ?api key/i,
  /api key was (invalid|expired|revoked)/i,
  /permission denied for (this|the) key/i,
  /account is (suspended|deleted|deactivated)/i,
  /key expired/i,
  /credentials? (were |is |are )?(invalid|expired|rejected)/i,
  /\bno such (api )?key\b/i
];

/** Error `code` fields (parsed response JSON) that prove an auth rejection. */
const AUTH_ERROR_CODES = new Set([
  'invalid_api_key',
  'api_key_invalid',
  'credentials_not_valid',
  'unauthenticated',
  'authentication_failed',
  'invalid_request_authentication',
  'user_not_found'
]);

/** Malformed-message / tool-pairing markers for protocol_error (any status). */
const PROTOCOL_MARKERS: RegExp[] = [
  /tool_call_id/i,
  /tool call id/i,
  /tool_use_id/i,
  /tool_calls?\b.*(was not found|not found|missing|must be|invalid)/i,
  /tool result.*tool_call/i,
  /each tool use/i, // Anthropic: toolu_* pairing errors
  /toolu_[a-z0-9]* was/i,
  /messages\[\d+\]\.tool_calls/i,
  /messages\[\d+\]\.role/i,
  /"role"[^"]*assistant.*tool_calls/i,
  /malformed/i,
  /invalid request( error|\:| payload)?\b/i,
  /invalid request_error/i,
  /unexpected (tool use|assistant message)/i,
  /must include .*tool/i,
  /last message must/i,
  /assistant message with 'tool_calls'/i,
  /content blocks.*tool_use/i
];

export interface ProviderFailureInput {
  /** Real HTTP status, or null for mid-stream/transport faults. */
  httpStatus: number | null;
  /** Error body/message text (response body or exception message). */
  message: string;
  /** Parsed response error `code`, when available. */
  errorCode?: string | null;
  /** Retry-After seconds when the response supplied one. */
  retryAfterSec?: number | null;
}

/**
 * Strict mapping (status-first):
 *   429                                                  -> rate_limited
 *   401/403 + auth specific body/code                    -> invalid_key
 *   401/403 without auth specific body/code              -> protocol_error
 *   >=500 (or transport-level, null with network text)   -> upstream_model_error
 *   400 / any protocol-malformed marker                  -> protocol_error
 */
export function classifyProviderFailure(input: ProviderFailureInput): ClassifiedFailure {
  const { httpStatus, message, errorCode, retryAfterSec } = input;
  const text = (message || '').trim();
  const lower = text.toLowerCase();

  // 429 — rate_limited; Retry-After seconds pass through verbatim.
  if (httpStatus === 429) {
    const retryAfter = retryAfterSec != null && retryAfterSec > 0 ? retryAfterSec : undefined;
    return { failureClass: 'rate_limited', stickyEligible: false, retryAfterSec: retryAfter };
  }

  // Explicit error code (parsed from the response JSON) can prove auth
  // rejection independently of the body text.
  const codeAuth = Boolean(errorCode && AUTH_ERROR_CODES.has(String(errorCode).toLowerCase()));

  // 401/403 — sticky invalid_key ONLY with an auth-specific body/code.
  if (httpStatus === 401 || httpStatus === 403) {
    if (codeAuth || AUTH_BODY_MARKERS.some((re) => re.test(text))) {
      return { failureClass: 'invalid_key', stickyEligible: true };
    }
    // Auth-service flake / WAF / transient edge: a 401/403 without proof of a
    // bad key must NEVER poison the route. Repairable, one retry.
    return { failureClass: 'protocol_error', stickyEligible: false };
  }

  // Malformed-message / tool-pairing markers on ANY status => protocol_error
  // (status-first exception: a 400 with key text is NEVER sticky).
  if (httpStatus === 400 && PROTOCOL_MARKERS.some((re) => re.test(text))) {
    return { failureClass: 'protocol_error', stickyEligible: false };
  }

  // 400 — always protocol_error (never sticky, repair + ONE retry).
  if (httpStatus === 400) {
    return { failureClass: 'protocol_error', stickyEligible: false };
  }

  // Text-shape protocol faults that can arrive via mid-stream exceptions with
  // a null status (tool-pairing or malformed-message lines).
  if (httpStatus === null && PROTOCOL_MARKERS.some((re) => re.test(text))) {
    return { failureClass: 'protocol_error', stickyEligible: false };
  }

  // 5xx — upstream metadata / model rotation, never sticky.
  if (httpStatus !== null && httpStatus >= 500) {
    return { failureClass: 'upstream_model_error', stickyEligible: false };
  }

  // Auth-marker text on a transport-level fault is still not proof of a bad
  // key (no HTTP context) — keep it non-sticky: model rotation.
  if (httpStatus === null) {
    const networkMarkers = /fetch failed|network|econn|enotfound|etimedout|timeout|socket|terminated|connection/i;
    return { failureClass: networkMarkers.test(text) ? 'upstream_model_error' : 'protocol_error', stickyEligible: false };
  }

  // 404 / 405 / other 4xx on a model route => upstream_model_error
  // (model rotation — the model id may not exist; never sticky).
  return { failureClass: 'upstream_model_error', stickyEligible: false };
}
