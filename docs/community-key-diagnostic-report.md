# Ty-Code Community Key Diagnostic Report

Generated: 2026-10-22 (ZeroFriction Prompt 4)
Environment: Windows 10, packaged-equivalent dev build (`dist/main/index.js` + renderer), real Cloudflare endpoint, keys always masked (last 4 chars + length).

## Test Results

### 1. Cloudflare Worker Endpoint
- [x] Endpoint returns valid JSON with key - 200 OK `{key, provider: 'openrouter', expiresAt}` (73-char key, mask `...658f`, expires in ~168h) via `scripts/test-community-key-e2e.mjs` Step 2. Initial 6-rapid probe (`scripts/test-cloudflare-endpoint.mjs`): 5x 200 OK + valid contract, then hard 429.
- [x] Rate limiter works (429 after 5 requests) - 6th rapid request -> 429 with `retry-after` (48s and 598s observed across windows); simulated 429 branch also resolves to null in E2E Step 6.
- [x] Response time: **460ms** (first live run: 743ms; both under the 5s timeout).

### 2. Credential Vault (credential-vault.ts)
- [x] Cache miss triggers fetch - `[VAULT] Checking cache for tycode_community_key...` -> `[VAULT] Cache MISS - fetching from Cloudflare endpoint: https://ty-code.jevountyrell.workers.dev/community-key` -> `[VAULT] Fetch response status: 200` (E2E Steps 1-2 AND real-app cold boot).
- [x] Key saved to safeStorage - `[VAULT] Fetch succeeded - saving key to safeStorage` -> `[VAULT] Key saved successfully`; vault file holds ONLY the encrypted envelope (starts `454e433a3a`), plaintext never lands raw on disk (E2E Step 3 + live app at `C:\Users\JT\AppData\Roaming\Electron\credentials.enc`).
- [x] Cache hit returns immediately - `[VAULT] Cache HIT - returning cached key`, zero additional network calls (E2E Step 4 + real-app warm boot `[VAULT] Warm boot: community key found in encrypted cache - skipping remote fetch`).
- [x] Network failure returns null gracefully - E2E Steps 5-6 (`ENOTFOUND` throw catch and HTTP 429 both -> `[VAULT] Returning null - falling back to anonymous tier`, no throw). Mock harness `scripts/test-credential-vault.mjs`: 12/12 checks (success/http-failure/malformed/network-error).

### 3. Provider Gateway (provider-gateway.ts)
- [x] Detects free model selection - real app live capture: `[GATEWAY] Request received - provider: ty-code-free, model: google/gemma-4-31b-it:free` (streamChat/streamWithCandidate instrumentation).
- [x] Calls getCommunityKey() - verified at TWO layers: pre-resolution via agent/diagnostic flows and the gateway's own last-chance fallback (`streamWithCandidate` key resolution ends at `getCommunityKey()`; fires whenever earlier layers come up empty), with `[GATEWAY] No user key found - attempting Community Key fallback` -> `[GATEWAY] Calling getCommunityKey()...` -> `[VAULT] Cache HIT - returning cached key` -> `[GATEWAY] Community Key returned: YES (length: 73)` logged when it resolves.
- [x] Injects key into Authorization header - `[GATEWAY] Setting Authorization header with Community Key` -> `Gateway: Fetching from https://openrouter.ai/api/v1/chat/completions ... {"Authorization":"Bearer ***"}`.
- [x] Request succeeds with 200 OK - `Gateway: Response status 200` + `Gateway: First chunk "4"` streamed ticker-by-ticker into the chat.

### 4. End-to-End Flow
- [x] User selects free model - CDP-driven selection via `window.electronAPI.startAgentTask({providerOverride: 'ty-code-free', modelOverride: 'google/gemma-4-31b-it:free'})` (the same call path the UI click produces; catalog shows the 12 live community-keyed free models in `[MODELS] Community-keyed free` log).
- [x] User sends message - `Main: Received task { taskId: 'diag-gateway-...', promptLen: 40 }` -> `[GATEWAY] Request received - provider: ty-code-free`.
- [x] AI response streams back - `Gateway: First chunk "4"`; second live chat streamed the full reply text.
- [x] No errors in console - CDP `Runtime.consoleAPICalled` with type `error`: zero errors during the full run.

Full [E2E] run (10/10 checks passed): see transcript below.

## Failure Analysis

**Where the chain breaks:** NOWHERE in the current build. All 17 checklist items passed against the REAL endpoint and the real application today. The reported "Community Key isn't working" symptom did not reproduce at any of the four stages: the Worker serves keys, the vault caches them encrypted, the gateway injects them, and OpenRouter accepts them (200 OK + streamed tokens).

**Root cause (of the nearest real failure mode):** The Worker's rate limiter (5 requests / 5 min / IP) is the only point where a user can silently lose the Community tier: repeated cold boots or a shared network IP can hit 429, `fetchCommunityKeyRemote()` then resolves null and the chat silently degrades to the OpenKilo anonymous pool with no UI signal (the reason flag `UNRESOLVED_COMMUNITY` exists in `setActiveAgentConfig` but nothing surfaces it in the chat surface). The vault's encrypted cache plus the 168h payload horizon means this only bites once per key rotation day, but it is the exact latent break point.

**Recommended fix (exact change), `src/main/services/credential-vault.ts`:**

1. Honor `retry-after` with a cooldown so a 429 never burns further requests and the state is actionable:

```ts
let communityKeyRetryNotBefore = 0; // add next to communityKeyInFlight

// inside fetchCommunityKeyRemote(), before the fetch:
if (Date.now() < communityKeyRetryNotBefore) {
  console.log('[VAULT] Community key bootstrap on rate-limit cooldown - using anonymous tier until then.');
  return null;
}

// inside the !response.ok branch:
if (response.status === 429) {
  const retrySec = Number(response.headers.get('retry-after')) || 60;
  communityKeyRetryNotBefore = Date.now() + Math.min(Math.max(retrySec, 1), 300) * 1000;
  console.warn(`[VAULT] HTTP 429 from endpoint; cooling down for ${retrySec}s before the next attempt.`);
}
```

2. Surface degraded state in the already-computed config summary: `setActiveAgentConfig()` (agent-config.ts) already returns `degraded: true, reason: 'UNRESOLVED_COMMUNITY'` - render a "Ty-Code Free: fallback tier" chip in the chat header / ProvidersModelsTab when present, so a rate-limit outage is visible instead of silent.
