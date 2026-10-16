# Zero-Server Scaling Architecture: Infinite Users at $0 Infrastructure Cost

## 1. Executive Summary

Ty-Code is engineered from the ground up on the **Zero-Server Client-Direct Architecture**. Unlike conventional AI coding tools that route all user prompts, completions, and billing through a centralized proxy server (creating massive operational overhead, latency hops, and existential cloud bills), Ty-Code operates with **zero cloud backend**.

Every credential is encrypted locally using the host operating system's credential store (`safeStorage`), and every AI interaction travels **directly from the user's desktop to the chosen AI provider's API**.

```
Traditional Architecture (Centralized Bottleneck):
User Desktop ---> Ty-Code Cloud Proxy ($30k/mo server & bandwidth) ---> Provider API
                      ↳ Key pool shared, single point of failure, data logged

Ty-Code Zero-Server Architecture (Infinite Horizontal Scale):
User Desktop (safeStorage) -----------------------------------------> Provider API
  ↳ PKCE loopback / Device Flow
  ↳ Anonymous free tiers (OpenKilo)
  ↳ Direct BYOK
  ↳ Per-instance usage ledger
  ↳ Zero Ty-Code servers, zero hosting costs, infinite scale
```

---

## 2. The Provider Tier Table

Ty-Code organizes model providers into four distinct tiers based on friction, setup requirements, and privacy posture:

| Tier | Category | Providers | Setup Friction | Quota / Allocation | Storage & Credential Model |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0** | **Anonymous Free Gateways** | OpenKilo Gateway, Ollama (Local) | **0 clicks** (instant) | 40+ free models (DeepSeek R1, Llama 3.3, Qwen 2.5), unlimited local | Zero key required (`apiKeys: { openkilo: 'anonymous' }`); runs offline or anonymous |
| **Tier 1** | **Community & Proxy Buffers** | Free-Claude-Code (FCC Proxy) | **1 click** | Up to 1.35 Billion pooled monthly tokens | Local proxy process loopback on `127.0.0.1:8080`; zero cloud intermediary |
| **Tier 2** | **One-Click PKCE & Device-Flow** | OpenRouter (PKCE), GitHub Copilot (Device Flow), OpenKilo OAuth | **1 click** (browser or code prompt, 0 key pasting) | 200M+ tokens/mo free tier (OpenRouter), Copilot model ecosystem | PKCE code exchange via local loopback (`http://127.0.0.1:45454`); stored in `safeStorage` |
| **Tier 3** | **Client-Side BYOK** | Anthropic, OpenAI, Google AI Studio, Groq, Mistral, Together AI | **User pastes key** | Determined by user's personal account | Encrypted locally with DPAPI/Keychain/SecretService; never leaves machine |

---

## 3. The Cost Math: Centralized Relay vs. Zero-Server Client-Direct

Why do AI startups go bankrupt or institute aggressive subscription paywalls? **Because centralized relay proxies introduce compounding marginal costs on every token transferred.**

### 3.1 Cost Breakdown at Scale

Assume a modest user base of 10,000 active developers generating an average of 1,000,000 tokens per month (active pair programming, agent tool loops, and code generation):

| Metric | Centralized Proxy Server Model | Ty-Code Zero-Server Model |
| :--- | :--- | :--- |
| **Monthly Token Volume** | 10,000 users × 1M = **10 Billion tokens/month** | 10,000 users × 1M = **10 Billion tokens/month** |
| **Egress & Ingress Bandwidth** | ~40 TB egress/month (~$3,600/mo AWS/GCP) | **$0.00** (Direct client-to-provider) |
| **Proxy Compute Fleet** | 8x c6i.2xlarge cluster + Redis cache (~$2,400/mo) | **$0.00** (No cloud fleet) |
| **Pooled API Key Bills** | $30,000/mo to $60,000/mo for shared keys | **$0.00** (Providers grant free allocations directly to users) |
| **Total Monthly Infrastructure Cost** | **$36,000 to $66,000 / month** | **$0.00 / month** |
| **Scale to 100,000 Users** | **$360,000 to $660,000 / month** | **$0.00 / month** |

### 3.2 Rate-Limit Isolation

In a centralized architecture, all 10,000 users share the same outgoing proxy IP address and shared API keys. When one user triggers a rate limit (HTTP 429), **all 10,000 users suffer degraded service**.

In Ty-Code's Zero-Server model:
- Each user requests models from their **own IP address**.
- Each user receives an **isolated rate limit allocation** directly from the provider.
- Providers that offer IP-based or account-based free tiers (OpenRouter free models, Groq free tier, Google AI Studio free tier) grant full throughput to each user independently.
- The app scales to **10 million users** without requiring a single server upgrade or paying a single dollar in infrastructure.

---

## 4. Why API Keys Are Never Shipped in Client Binaries

It is a tempting anti-pattern for desktop apps to embed a shared "master" API key into client builds. Ty-Code strictly prohibits this.

### 4.1 The Security Blast Radius
- Any binary distributed to end-users (Electron `.asar`, macOS `.dmg`, Windows `.exe`) can be decompiled or inspected with standard tools (`strings`, `asar extract`, memory dumping).
- Hardcoded keys are extracted by scrapers within minutes of release.
- If a hardcoded key is leaked:
  1. Malicious actors exhaust the quota instantly.
  2. The key is revoked by the provider.
  3. Every installation of the app instantly breaks for every user globally.

### 4.2 Legal, Compliance, & Privacy
- Relaying user code through a developer's shared key often violates enterprise confidentiality policies and LLM terms of service regarding multi-tenant key sharing.
- With client-side PKCE and local BYOK, the contract is strictly between the **user and the provider**. Ty-Code maintains no data access, zero retention, and zero liability.

### 4.3 CI Guard Enforcement
To ensure no developer accidentally bakes a credential into source or build artifacts, Ty-Code runs `scripts/no-baked-secrets.mjs` on every pull request and local build:
- Scans `src/` and `dist/` for high-entropy key patterns (OpenAI `sk-proj-`, Anthropic `sk-ant-`, OpenRouter `sk-or-v1-`, GitHub `ghu_`, AWS `AKIA`, and private keys).
- Halts the build immediately if any unauthorized credential structure is detected.

---

## 5. Client Authentication Flows: PKCE & Device Flow

Ty-Code implements one-click credentialing so users never have to manually copy, paste, or expose raw API keys.

```
OpenRouter PKCE Flow:
1. Ty-Code starts ephemeral loopback server on 127.0.0.1:45454.
2. Generates cryptographically secure code_verifier and S256 code_challenge.
3. Opens browser: https://openrouter.ai/auth?callback_url=http://127.0.0.1:45454/oauth/callback/openrouter&code_challenge=...
4. User clicks "Authorize" in browser.
5. OpenRouter redirects to loopback; Ty-Code exchanges code for API key.
6. API key is encrypted into Electron safeStorage; loopback shuts down.

GitHub Copilot Device Code Flow:
1. Ty-Code calls GitHub Device Code endpoint (RFC 8628).
2. Presents user_code (e.g. "TYCD-48F2") and verification URI.
3. User confirms in browser; Ty-Code polls in background with exponential backoff.
4. Received access token is stored into safeStorage.
```

---

## 6. The Local Per-Instance Usage Ledger

Because there is no central database collecting telemetry, each Ty-Code installation maintains its own **Per-Instance Usage Ledger** stored locally at `userData/usage-ledger.json`:

1. **High-Fidelity Tracking**:
   - Captures exact `prompt_tokens` and `completion_tokens` from streaming usage events when provided by the LLM gateway.
   - Falls back to character-ratio estimation (~3.8 characters per token) when stream usage headers are omitted.
2. **Provider Rate-Limit Awareness**:
   - Reads standard headers (`x-ratelimit-reset`, `x-ratelimit-remaining`, `retry-after`).
   - Surfaces remaining quota and "resets in Xh Ym" badges in the UI.
3. **Privacy by Design**:
   - Ledger data never leaves the user's computer.
   - Users can inspect transactions, export to JSON or CSV, or wipe the ledger at any time.
4. **Future Sync Stub**:
   - Includes a client-side encryption stub (`EncryptedSyncProviderStub`) for future end-to-end encrypted user-owned backup (e.g., via personal iCloud or encrypted Google Drive), maintaining zero-server principles.
