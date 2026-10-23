#!/usr/bin/env node
/**
 * Direct diagnostic test for the Ty-Code Community Key Cloudflare Worker.
 *
 * Verifies the first link of the Community Key chain in isolation:
 *   GET https://ty-code.jevountyrell.workers.dev/community-key
 *
 * Checks (ZeroFriction diagnosis, Prompt 1):
 *   1. The endpoint is reachable and answers HTTP 200 with valid JSON.
 *   2. The JSON body matches the worker contract:
 *      `{ key, provider: 'openrouter', expiresAt }` (key masked in output -
 *      the raw secret is never printed to the terminal or captured in logs).
 *   3. The KV rate limiter (5 requests / 10 minutes / IP) engages:
 *      6 rapid requests are fired and each is logged as 200 / 429 / error.
 *
 * Usage:
 *   node scripts/test-cloudflare-endpoint.mjs           # 6-request limiter test
 *   node scripts/test-cloudflare-endpoint.mjs --single  # exactly one request
 *                                                        (used during
 *                                                        `wrangler tail` runs)
 */

const ENDPOINT_URL =
  process.env.TYCODE_TEST_ENDPOINT ||
  'https://ty-code.jevountyrell.workers.dev/community-key';

const REQUEST_TIMEOUT_MS = 5000;
const RAPID_REQUEST_COUNT = 6;

/**
 * Secrets hygiene: the terminal (and any captured log output) must never
 * contain the raw community key. Only length + last 4 characters are shown,
 * which is enough to detect wrong/empty payloads in diagnosis.
 */
function maskSecret(value) {
  if (typeof value !== 'string' || value.length < 8) {
    return `(len:${String(value).length})`;
  }
  return `...${value.slice(-4)} (len:${value.length})`;
}

/** Recursively copies `obj` with known secret fields masked. */
function redactPayload(obj) {
  if (Array.isArray(obj)) return obj.map(redactPayload);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = k === 'key' || k === 'token' || /secret/i.test(k) ? maskSecret(v) : redactPayload(v);
    }
    return out;
  }
  return obj;
}

async function requestOnce(index) {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`\n=== Request ${index} @ ${timestamp} ===`);
  try {
    const response = await fetch(ENDPOINT_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    console.log(`Status : ${response.status} ${response.statusText}`);
    console.log('Headers:');
    for (const [name, value] of response.headers.entries()) {
      console.log(`  ${name}: ${value}`);
    }

    const rawBody = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      console.log(`Body   : (not JSON) "${rawBody.slice(0, 500)}"`);
      return { status: response.status, ok: false, parseOk: false };
    }

    console.log(`Body   : ${JSON.stringify(redactPayload(parsed))}`);

    if (response.status === 200) {
      const hasKey = typeof (parsed.key || parsed.token) === 'string' && (parsed.key || parsed.token).length >= 8;
      const providerOk = !parsed.provider || parsed.provider === 'openrouter';
      const expiresOk = Number.isFinite(Number(parsed.expiresAt));
      console.log(
        `Contract: key-present=${hasKey ? 'YES' : 'NO'} provider-ok=${providerOk ? 'YES' : parsed.provider} expires-ok=${expiresOk ? 'YES' : 'NO'}`
      );
      return { status: 200, ok: hasKey, parseOk: true };
    }

    if (response.status === 429) {
      console.log('Outcome: RATE LIMITER ENGAGED (429) - expected behavior for requests beyond the 5-per-10-min window');
      return { status: 429, ok: true, parseOk: true };
    }

    console.log(`Outcome: ENDPOINT ERROR - exact message: "${parsed && parsed.error ? parsed.error : rawBody}"`);
    return { status: response.status, ok: false, parseOk: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : typeof error;
    const cause = error instanceof Error && error.cause ? ` (cause: ${String(error.cause)})` : '';
    console.error(`Request ${index} FAILED:`);
    console.error(`  ${name}: ${message}${cause}`);
    console.error(`  after ${Date.now() - startedAt}ms`);
    return { status: 0, ok: false, parseOk: false, error: message };
  }
}

async function main() {
  const single = process.argv.includes('--single');
  const count = single ? 1 : RAPID_REQUEST_COUNT;

  console.log('=== Testing Cloudflare Community Key Endpoint ===');
  console.log(`Endpoint: ${ENDPOINT_URL}`);
  console.log(`Plan    : ${count} GET request(s), Accept: application/json, timeout ${REQUEST_TIMEOUT_MS}ms`);

  const results = [];
  for (let i = 1; i <= count; i++) {
    results.push(await requestOnce(i));
  }

  const okCount = results.filter((r) => r.status === 200).length;
  const rlCount = results.filter((r) => r.status === 429).length;
  const errCount = results.filter((r) => r.status === 0).length;
  const otherCount = results.filter((r) => r.status !== 200 && r.status !== 429 && r.status !== 0).length;

  console.log('\n=== Summary ===');
  console.log(`200 OK : ${okCount}`);
  console.log(`429    : ${rlCount}`);
  console.log(`other  : ${otherCount}`);
  console.log(`errors : ${errCount}`);

  if (okCount > 0) {
    const first = results.find((r) => r.status === 200);
    console.log(
      first && first.ok
        ? 'Endpoint diagnosis: WORKING - key delivery contract satisfied.'
        : 'Endpoint diagnosis: PARTIAL - endpoint reachable but payload malformed.'
    );
  } else if (rlCount > 0) {
    console.log(
      'Endpoint diagnosis: this IP exhausted its 5-requests/10-min window; ' +
        'rate limiter verified 429-side only. Re-run after the window resets to see the 200 path.'
    );
  } else {
    console.log('Endpoint diagnosis: BROKEN - see per-request error output above.');
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
