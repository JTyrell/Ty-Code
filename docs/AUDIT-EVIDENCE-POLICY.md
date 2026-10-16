# Ty-Code Machine-Readable Audit Evidence Policy

> **Anti-Phantom Rule**: Any claim in documentation, pull requests, release notes, or architecture summaries asserting that a provider, model, agent loop, tool, or storage subsystem is **"connected"**, **"working"**, **"operational"**, or **"100% functional"** MUST reference a valid, fresh machine-readable trace artifact path under [`docs/traces/*.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces).
>
> Unsubstantiated claims without machine-readable evidence are classified as **Phantom Assertions** and will fail CI.

---

## 1. Trace Artifact Catalog & Requirements

Every major subsystem verification is backed by a dedicated JSON trace artifact in `docs/traces/`:

| Subsystem / Claim | Required Trace Artifact | Generating Command | Description & Invariants |
| :--- | :--- | :--- | :--- |
| **Zero Mock Strings** | [`docs/traces/mock-elimination.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/mock-elimination.json) | `node scripts/no-fixture-replies.mjs` | Grep results scanning all 230+ `src/` files proving 0 matches for forbidden mock/fixture replies. |
| **Live Round-Trip Connectivity** | [`docs/traces/live-verification.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/live-verification.json) | `npm run test:live` | Real network round-trip proof: Nonce echo (`7Q4X9`), distinctness across 3 prompts, >=5 progressive stream events, disk file creation, and offline error classification. |
| **End-to-End IPC Pipeline** | [`docs/traces/live-pipeline.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/live-pipeline.json) | `node scripts/run-live-e2e.mjs` | Hop-by-hop latency and payload trace covering all 10 IPC hops from renderer prompt ingestion to final assistant message delivery. |
| **Hardware Key Encryption** | [`docs/traces/credential-security.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/credential-security.json) | `npm test` | Cryptographic audit of `credentials.json` demonstrating hardware `safeStorage` (DPAPI/Keychain) encryption with hex dump proof and zero plaintext secrets. |
| **Usage & Token Ledger** | [`docs/traces/usage-ledger.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/usage-ledger.json) | `node tests/credential-store.test.ts` | Machine-readable ledger sample verifying prompt tokens, completion tokens, and dollar cost accounting into SQLite/JSON. |
| **Multi-Provider Routing** | [`docs/traces/connectivity-trace.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/connectivity-trace.json) | `npm run test:live` | Provider health, failover chain traversal, and sanitized hop diagnostic traces without raw API key leakage. |
| **Open-Path Latency Budgets** | [`docs/traces/open-perf-trace.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/open-perf-trace.json) | `npm run test:live` | 10k folder index timings, second-open cache acceleration (>=3x), and main-thread responsiveness (<50ms event loop lag). |

---

## 2. Mandatory Artifact Schema

Every trace file under `docs/traces/*.json` must strictly conform to the following schema:

```json
{
  "phase": "RealConnect <n>",
  "title": "<Descriptive Audit Title>",
  "timestamp": "2026-10-16T20:16:00.000Z",
  "epoch": 1792181760,
  "gitCommit": "35837e4b8995e19c1315c0c6f43762f2b2a5928c",
  "command": "<exact command used to generate artifact>",
  "status": "VERIFIED_PASS"
}
```

### Schema Rules:
1. **`timestamp`**: Valid ISO 8601 UTC timestamp.
2. **`gitCommit`**: Exact SHA-1 git commit hash of the codebase state at execution time.
3. **`command`**: Non-empty shell command that reproduces the audit artifact.
4. **`status`**: Must equal `"VERIFIED_PASS"`.

---

## 3. Freshness & Invalidation Rules

Evidence artifacts must represent active code reality, not historical snapshots:

- **Monitored Paths**: `src/main/agent/**` and `src/main/providers/**`.
- **Commit Guard**: Whenever a commit touches monitored code, all trace files must have a timestamp or commit epoch greater than or equal to that commit (with a 60-second allowance for clock variance).
- **Automated Invalidation**: If any code change modifies provider streaming, agent tool execution, or network failover without updating the corresponding trace artifact, [`scripts/verify-audit-artifacts.mjs`](file:///c:/Users/JT/Documents/Ty-Code/scripts/verify-audit-artifacts.mjs) will reject the build.

---

## 4. Documentation Citation Syntax

When authoring documentation or audit reports, functional claims must be directly hyperlinked to their trace evidence:

```markdown
<!-- Approved: Specific claim backed by machine-readable artifact -->
The streaming agent pipeline is verified live and operational
(see [live-verification.json](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/live-verification.json)).

<!-- Forbidden: Vague or unevidenced claim (Fails CI) -->
The provider is 100% functional and completely connected.
```

---

## 5. Automated CI Verification

The anti-phantom policy is programmatically enforced in [`scripts/verify-audit-artifacts.mjs`](file:///c:/Users/JT/Documents/Ty-Code/scripts/verify-audit-artifacts.mjs) which runs on every local test run (`npm test`) and in GitHub Actions CI:

```bash
node scripts/verify-audit-artifacts.mjs
```

Builds fail immediately if:
1. Any required trace file is missing or contains invalid JSON.
2. Any required trace file is missing `timestamp`, `gitCommit`, or `command`.
3. Any required trace file is stale relative to the latest commit touching agent/provider code.
4. Any Markdown document in `docs/` makes completion or connectivity claims without citing a `docs/traces/*.json` path.
