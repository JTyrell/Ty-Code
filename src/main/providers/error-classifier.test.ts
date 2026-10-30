/**
 * Unit tests for classifyProviderFailure (Route Truth, Prompt 1 Step 1).
 *
 * The regression that motivated the central classifier: transient
 * protocol faults (400 malformed-message / tool-pairing) and non-auth 401
 * bodies were misclassified as auth.invalid_key, sticky-persisted, and
 * poisoned healthy routes. These tests pin the strict status-first mapping:
 *   - 401/403 counts as invalid_key ONLY with an auth-specific body/code
 *   - 400/malformed-message/tool-pairing is ALWAYS protocol_error (never sticky)
 *   - 429 is rate_limited (Retry-After honored)
 *   - 5xx / network are upstream_model_error (model rotation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyProviderFailure } from './error-classifier';
import { providerHealthStore } from './provider-health-store';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  providerHealthStore.__forTest(null);
});

afterEach(() => {
  vi.useRealTimers();
  providerHealthStore.__forTest(null);
});

describe('auth verdict requires an auth-specific body/code', () => {
  it('401 with "User not found" body is invalid_key', () => {
    const cls = classifyProviderFailure({ httpStatus: 401, message: 'User not found (OpenRouter v1 chat)' });
    expect(cls.failureClass).toBe('invalid_key');
    expect(cls.stickyEligible).toBe(true);
    expect(providerHealthStore.getState('openrouter')).toBeNull(); // caller persists, not the classifier
  });

  it('403 with "API key not valid" body is invalid_key', () => {
    const cls = classifyProviderFailure({ httpStatus: 403, message: 'API key not valid. Please pass a valid API key.' });
    expect(cls.failureClass).toBe('invalid_key');
    expect(cls.stickyEligible).toBe(true);
  });

  it('401 with UNAUTHENTICATED gRPC-ish code is invalid_key even without marker text', () => {
    const cls = classifyProviderFailure({ httpStatus: 401, message: 'Request failed', errorCode: 'UNAUTHENTICATED' });
    expect(cls.failureClass).toBe('invalid_key');
    expect(cls.stickyEligible).toBe(true);
  });

  it('401 with a NON-auth body ("User not found" absent, generic gateway text) is protocol_error, NOT invalid_key', () => {
    const cls = classifyProviderFailure({ httpStatus: 401, message: 'Service temporarily unavailable. Please try again later.' });
    expect(cls.failureClass).toBe('protocol_error');
    expect(cls.stickyEligible).toBe(false);
  });

  it('protocol_error from a non-auth 401 does not sticky-mark the key', () => {
    // Even a mis-duck-typed sticky write for a protocol_error is downgraded
    // to the transient degraded TTL — it can never poison the route.
    providerHealthStore.markInvalidKey('openrouter', 401, 'protocol_error');
    expect(providerHealthStore.getState('openrouter')).toBe('degraded_transient');
    expect(providerHealthStore.isDead('openrouter')).toBe(false);
    providerHealthStore.clear('openrouter');
    expect(providerHealthStore.getState('openrouter')).toBeNull();
  });
});

describe('protocol errors are never sticky', () => {
  it('400 with tool-pairing text is protocol_error', () => {
    const cls = classifyProviderFailure({
      httpStatus: 400,
      message: 'Invalid parameter: messages with role tool must be a response to a preceding message with tool_calls.'
    });
    expect(cls.failureClass).toBe('protocol_error');
    expect(cls.stickyEligible).toBe(false);
  });

  it('400 with "invalid api key provided" text is STILL protocol_error (status-first mapping)', () => {
    // A 400 never flips a key's health state — that is the anti-regression rule.
    const cls = classifyProviderFailure({ httpStatus: 400, message: 'Invalid API key provided for the selected model.' });
    expect(cls.failureClass).toBe('protocol_error');
    expect(cls.stickyEligible).toBe(false);
  });

  it('bodyless malformed-message fault (null status) is protocol_error', () => {
    const cls = classifyProviderFailure({
      httpStatus: null,
      message: 'messages with role tool must be a response to a preceding message with tool_calls'
    });
    expect(cls.failureClass).toBe('protocol_error');
    expect(cls.stickyEligible).toBe(false);
  });
});

describe('rate limits honor Retry-After', () => {
  it('429 is rate_limited and carries the Retry-After seconds', () => {
    const cls = classifyProviderFailure({ httpStatus: 429, message: 'rate limit exceeded', retryAfterSec: 7 });
    expect(cls.failureClass).toBe('rate_limited');
    expect(cls.retryAfterSec).toBe(7);
    expect(cls.stickyEligible).toBe(false);
  });

  it('429 without Retry-After reports no TTL override', () => {
    const cls = classifyProviderFailure({ httpStatus: 429, message: 'Too many requests' });
    expect(cls.failureClass).toBe('rate_limited');
    expect(cls.retryAfterSec).toBeUndefined();
  });
});

describe('upstream/network faults are model-rotation territory', () => {
  it('5xx responses are upstream_model_error', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyProviderFailure({ httpStatus: status, message: 'upstream blowup' }).failureClass).toBe('upstream_model_error');
    }
  });

  it('network-level failures (null status, fetch text) are upstream_model_error', () => {
    const cls = classifyProviderFailure({ httpStatus: null, message: 'fetch failed: ENOTFOUND gateway.example' });
    expect(cls.failureClass).toBe('upstream_model_error');
    expect(cls.stickyEligible).toBe(false);
  });

  it('other 4xx statuses stay upstream_model_error (never sticky)', () => {
    const cls = classifyProviderFailure({ httpStatus: 409, message: 'conflict' });
    expect(cls.failureClass).toBe('upstream_model_error');
    expect(cls.stickyEligible).toBe(false);
  });
});
