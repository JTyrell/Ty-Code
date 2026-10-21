/**
 * Ty-Code Community Key Service (api.tycode.dev backend)
 * ======================================================
 *
 * Contract (ZeroFriction-1): GET https://api.tycode.dev/v1/community-key
 *   response: { "key": "sk-or-v1-..." }  (application/json, Cache-Control: no-store)
 *
 * Responsibilities:
 *   - Never stores or bakes any OpenRouter key in source. The pool is supplied
 *     ONLY via the TYCODE_COMMUNITY_KEYS environment variable (comma-separated).
 *   - Round-robin rotation across the pool spreads upstream load and couples
 *     with client revalidation: when a key retires upstream, existing clients
 *     receive 401/403 from OpenRouter, drop their encrypted cache copy, and
 *     re-bootstrap a fresh key from this endpoint.
 *   - Per-IP rolling-window rate limiting (default 20 keys/hour/IP, tunable
 *     via TYCODE_RATE_LIMIT_PER_HOUR) keeps a single abuser from draining the
 *     shared budget. Behind a reverse proxy set TYCODE_TRUST_PROXY=1 so
 *     x-forwarded-for wins over the socket address.
 *
 * Runtime: Node 18+ (global fetch only when checking health), zero dependencies.
 *   TYCODE_PORT (default 8787), TYCODE_RATE_LIMIT_PER_HOUR, TYCODE_TRUST_PROXY
 *   TYCODE_COMMUNITY_KEYS  -> required; e.g. "sk-or-v1-aaa,sk-or-v1-bbb"
 *
 * Deploy the TLS termination (api.tycode.dev) in front of this process with
 * your usual stack. Health probe: GET /health -> {"ok":true}
 */

'use strict';

const http = require('http');

const PORT = Number(process.env.TYCODE_PORT || 8787);
const RATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.TYCODE_RATE_LIMIT_PER_HOUR || 20));
const TRUST_PROXY = process.env.TYCODE_TRUST_PROXY === '1';
const WINDOW_MS = 60 * 60 * 1000;

const keyPool = String(process.env.TYCODE_COMMUNITY_KEYS || '')
  .split(',')
  .map((k) => k.trim())
  .filter((k) => k.length >= 8);

let poolCursor = 0;

/** ip -> [timestamps] (rolling window) */
const ipHits = new Map();

function pruneHits(now) {
  for (const [ip, stamps] of ipHits) {
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length === 0) ipHits.delete(ip);
  }
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '');
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(payload);
}

function nextKey() {
  if (keyPool.length === 0) return undefined;
  const key = keyPool[poolCursor % keyPool.length];
  poolCursor = (poolCursor + 1) % keyPool.length; // round-robin over the pool
  return key;
}

const HANDLE = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept'
    });
    res.end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && urlPath === '/health') {
    sendJson(res, 200, {
      ok: true,
      poolSized: keyPool.length > 0,
      poolDepth: keyPool.length
    });
    return;
  }

  if (req.method === 'GET' && urlPath === '/v1/community-key') {
    if (keyPool.length === 0) {
      console.error('[community-key] TYCODE_COMMUNITY_KEYS is empty; refusing to serve.');
      sendJson(res, 503, { error: 'Key pool not provisioned.' });
      return;
    }

    const ip = clientIp(req);
    const now = Date.now();
    pruneHits(now);
    const stamps = ipHits.get(ip) || [];
    if (stamps.length >= RATE_LIMIT_PER_HOUR) {
      console.warn(`[community-key] rate limit exceeded for ${ip}`);
      res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '3600',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }));
      return;
    }
    stamps.push(now);
    ipHits.set(ip, stamps);

    const key = nextKey();
    sendJson(res, 200, { key });
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

if (require.main === module) {
  HANDLE.listen(PORT, '127.0.0.1', () => {
    console.log(`[community-key] listening on 127.0.0.1:${PORT} (pool depth ${keyPool.length}, ${RATE_LIMIT_PER_HOUR} keys/hour/IP)`);
    if (keyPool.length === 0) {
      console.warn('[community-key] WARNING: provision TYCODE_COMMUNITY_KEYS before going live.');
    }
  });

  const shutdown = () => {
    HANDLE.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { HANDLE, nextKey, clientIp, pruneHits };
