// Ty-Code Community Key distribution Worker.
//
// Serves the rotating shared OpenRouter key from Cloudflare KV so Electron
// clients can bootstrap the free tier with zero keys baked into the app
// binary. Rate limiting is enforced with a free, built-in KV rate limiter
// (5 requests / 10 minutes / IP) - see the limiter below. Because the Electron
// client persists the key encrypted (safeStorage) and honours the 7-day
// server expiry, a legitimate user visits this endpoint roughly once a week;
// the limit exists purely to blunt scraper scripts.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ OPTIONAL extra hardening (Cloudflare Dashboard, free):                    │
// │   Security -> WAF -> Rate limiting rules -> "community-key-throttle":     │
// │   match URI Path equals /community-key, 5 requests / 10 minutes,          │
// │   characteristic IP, action Block. Redundant with the KV limiter but      │
// │   stops abuse BEFORE worker invocations are billed/counted.               │
// └───────────────────────────────────────────────────────────────────────────┘

export interface Env {
  TYCODE_KEYS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  };
}

const KEY_NAME = 'community_free_tier_key';
const RL_PREFIX = 'rate_limit:';
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 5; // per window per IP
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Strict CORS so the Electron Main Process (fetch from any origin) can read
// the response. No credentials/cookies are involved, and the payload is a
// deliberate public secret by design (rotating, low-privilege, shared).
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept',
  'Access-Control-Max-Age': '86400'
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight (defensive: Chromium/Electron fetch never sends one for a
    // bare GET, but browsers/tools hitting the endpoint get sane answers)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. Security: GET-only endpoint
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
    }

    // Route gate: never hand the key to crawlers requesting /favicon.ico etc.
    const url = new URL(request.url);
    if (url.pathname !== '/community-key') {
      return json({ error: 'Not found' }, 404);
    }

    // Observability context used by the limiter and abuse review
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    console.log(`[tycode-community] GET /community-key from ${ip}`);

    try {
      // 2-4. KV-backed rate limiter: 5 requests per 10 minutes per IP.
      // KV is eventually consistent (up to ~60s edge staleness), so this is
      // soft limiting - the hard backstop is the 1-write/second-per-key
      // platform limit: when a scraper hammers faster than 1 req/s on the
      // same rlKey, the .put() below throws and the catch block answers 429.
      const rlKey = `${RL_PREFIX}${ip}`;
      const rlStr = await env.TYCODE_KEYS.get(rlKey);
      let rlData: { count: number; resetTime: number };
      try {
        const parsed = rlStr ? JSON.parse(rlStr) : null;
        rlData =
          parsed && typeof parsed.count === 'number' && typeof parsed.resetTime === 'number'
            ? parsed
            : { count: 0, resetTime: now + WINDOW_MS };
      } catch {
        // Corrupt window state: start a fresh window instead of 429-ing the
        // victim of a corrupted record until its TTL clears
        rlData = { count: 0, resetTime: now + WINDOW_MS };
      }

      if (now > rlData.resetTime) {
        rlData = { count: 1, resetTime: now + WINDOW_MS };
      } else {
        rlData.count += 1;
      }

      if (rlData.count > MAX_REQUESTS) {
        return json({ error: 'Rate limit exceeded. Please try again later.' }, 429, {
          'Retry-After': String(Math.max(1, Math.ceil((rlData.resetTime - now) / 1000)))
        });
      }

      // 5. Persist the window (auto-expires, no manual cleanup needed)
      await env.TYCODE_KEYS.put(rlKey, JSON.stringify(rlData), { expirationTtl: WINDOW_MS / 1000 });

      // 6. The actual shared key - stored in KV ONLY (never in source)
      const apiKey = await env.TYCODE_KEYS.get(KEY_NAME);
      if (!apiKey || !apiKey.trim()) {
        // Provisioning gap: operator has not written the key to KV yet
        return json({ error: 'Service temporarily unavailable' }, 503);
      }

      // 7. Success. expiresAt tells the client to hide behind its encrypted
      // cache for a week (boots the weekly cadence that keeps this free-tier
      // friendly). Edge caching for 1h collapses duplicate KV reads.
      return json(
        {
          key: apiKey.trim(),
          provider: 'openrouter',
          expiresAt: now + WEEK_MS
        },
        200,
        { 'Cache-Control': 'public, max-age=3600' }
      );
    } catch (error) {
      // Includes the KV write-limit collisions from step 5 (platform-enforced
      // anti-spam) - answered as 429 with a 10-minute Retry-After. Keeping the
      // catch-all per design: any surprise failure must never leak a key.
      console.error('[tycode-community] worker error:', error instanceof Error ? error.message : error);
      return json({ error: 'Rate limit exceeded or internal error' }, 429, { 'Retry-After': '600' });
    }
  }
};
