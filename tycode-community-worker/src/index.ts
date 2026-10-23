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

/** ZeroFriction diagnosis (Prompt 1): every log line carries a timestamp. */
function logWithTime(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/** Secrets hygiene: the raw key is never logged - length + last 4 only. */
function maskKeyForLog(key: string): string {
  return `...${key.slice(-4)} (len:${key.length})`;
}

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
      logWithTime(`rejected: method ${request.method} is not GET (ip=${request.headers.get('CF-Connecting-IP') || 'unknown'})`);
      return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
    }

    // Route gate: never hand the key to crawlers requesting /favicon.ico etc.
    const url = new URL(request.url);
    if (url.pathname !== '/community-key') {
      logWithTime(`rejected: unknown path ${url.pathname} (ip=${request.headers.get('CF-Connecting-IP') || 'unknown'})`);
      return json({ error: 'Not found' }, 404);
    }

    // Observability context used by the limiter and abuse review
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    logWithTime(
      `request received: GET /community-key ip=${ip} ua=${request.headers.get('user-agent') || '-'} colo=${request.cf && typeof request.cf.colo === 'string' ? request.cf.colo : '-'}`
    );

    try {
      // 2-4. KV-backed rate limiter: 5 requests per 10 minutes per IP.
      // KV is eventually consistent (up to ~60s edge staleness), so this is
      // soft limiting - the hard backstop is the 1-write/second-per-key
      // platform limit: when a scraper hammers faster than 1 req/s on the
      // same rlKey, the .put() below throws and the catch block answers 429.
      const rlKey = `${RL_PREFIX}${ip}`;
      const rlStr = await env.TYCODE_KEYS.get(rlKey);
      let rlData: { count: number; resetTime: number };
      if (rlStr === null) {
        logWithTime(`rate limit KV lookup: MISS (fresh window) ip=${ip}`);
        rlData = { count: 0, resetTime: now + WINDOW_MS };
      } else {
        try {
          const parsed: unknown = JSON.parse(rlStr);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as { count?: unknown }).count === 'number' &&
            typeof (parsed as { resetTime?: unknown }).resetTime === 'number'
          ) {
            rlData = parsed as { count: number; resetTime: number };
            const resetInS = Math.max(0, Math.round((rlData.resetTime - now) / 1000));
            logWithTime(`rate limit KV lookup: HIT ip=${ip} windowCount=${rlData.count} resetsIn=${resetInS}s`);
          } else {
            logWithTime(`rate limit KV lookup: MALFORMED STATE ip=${ip} - starting fresh window`);
            rlData = { count: 0, resetTime: now + WINDOW_MS };
          }
        } catch {
          // Corrupt window state: start a fresh window instead of 429-ing the
          // victim of a corrupted record until its TTL clears
          logWithTime(`rate limit KV lookup: CORRUPT STATE ip=${ip} - starting fresh window`);
          rlData = { count: 0, resetTime: now + WINDOW_MS };
        }
      }

      let rateLimited = false;
      if (now > rlData.resetTime) {
        logWithTime(`rate limit window expired ip=${ip} - starting fresh window`);
        rlData = { count: 1, resetTime: now + WINDOW_MS };
      } else {
        rlData.count += 1;
        if (rlData.count > MAX_REQUESTS) rateLimited = true;
      }

      if (rateLimited) {
        const retryAfterS = Math.max(1, Math.ceil((rlData.resetTime - now) / 1000));
        logWithTime(`rate limit check FAILED ip=${ip} windowCount=${rlData.count}/${MAX_REQUESTS} -> 429, retryAfter=${retryAfterS}s`);
        return json({ error: 'Rate limit exceeded. Please try again later.' }, 429, {
          'Retry-After': String(retryAfterS)
        });
      }
      logWithTime(`rate limit check passed ip=${ip} windowCount=${rlData.count}/${MAX_REQUESTS}`);

      // 5. Persist the window (auto-expires, no manual cleanup needed)
      try {
        await env.TYCODE_KEYS.put(rlKey, JSON.stringify(rlData), { expirationTtl: WINDOW_MS / 1000 });
        logWithTime(`rate limit window persisted (TTL ${Math.round(WINDOW_MS / 1000)}s) ip=${ip}`);
      } catch (putError) {
        const putMessage = putError instanceof Error ? putError.message : String(putError);
        logWithTime(`rate limit window PERSIST FAILED ip=${ip} -> ${putMessage}`);
        throw putError;
      }

      // 6. The actual shared key - stored in KV ONLY (never in source)
      const apiKey = await env.TYCODE_KEYS.get(KEY_NAME);
      logWithTime(`community key KV lookup (${KEY_NAME}): ${apiKey && apiKey.trim() ? 'HIT' : 'MISSING'}`);
      if (!apiKey || !apiKey.trim()) {
        // Provisioning gap: operator has not written the key to KV yet
        logWithTime('answering 503 Service temporarily unavailable (provisioning gap: KV key not set)');
        return json({ error: 'Service temporarily unavailable' }, 503);
      }

      // 7. Success. expiresAt tells the client to hide behind its encrypted
      // cache for a week (boots the weekly cadence that keeps this free-tier
      // friendly). Edge caching for 1h collapses duplicate KV reads.
      logWithTime(`success: returning key mask=${maskKeyForLog(apiKey.trim())} provider=openrouter to ip=${ip}`);
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
      const errName = error instanceof Error ? error.name : typeof error;
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : '-';
      logWithTime(`worker error ${errName}: ${errMessage} | stack: ${errStack}`);
      return json({ error: 'Rate limit exceeded or internal error' }, 429, { 'Retry-After': '600' });
    }
  }
};
