# FCC Integration Architecture & Model Supply Layer

This document details the architectural design, security boundaries, cryptographic integrity checks, and degradation semantics of the Free-Claude-Code (FCC) model supply layer embedded within Ty-Code.

---

## 1. Architectural Overview & Boundary Isolation

Ty-Code adopts **Mode (a) - Pinned Decoupled Loopback Sidecar** to ingest the 61-provider model catalog and free-token allowances from upstream `free-claude-code` (`v0.9.4`).

```
+-----------------------------------------------------------------------------------------+
|                                    Ty-Code IDE                                          |
|                                                                                         |
|  +---------------------------+       +-----------------------------------------------+  |
|  |     ModelSelector UI      |       |      ProviderHealthDashboard (Admin UI)       |  |
|  |  Provenance: FCC | BYOK   |       |   61 Providers | Quota | Latency | ToS Flags   |  |
|  +-------------+-------------+       +-----------------------+-----------------------+  |
|                |                                             |                          |
|                +----------------------+----------------------+                          |
|                                       | IPC Channel (electronAPI)                       |
|                                       v                                                 |
|  +-----------------------------------------------------------------------------------+  |
|  |                             Electron Main Process                                 |  |
|  |                                                                                   |  |
|  |  +------------------------+  +------------------------+  +---------------------+  |  |
|  |  |   fccIntegrityChecker  |  |    fccCatalogSync      |  |   fccEmbeddedCore   |  |  |
|  |  |  (SHA-256 Verification)|  | (61 Provider Catalog)  |  | (Tier 2 Boot Mgmt)  |  |  |
|  |  +-----------+------------+  +-----------+------------+  +----------+----------+  |  |
|  |              |                           |                          |             |  |
|  |              +---------------------------+--------------------------+             |  |
|  |                                          |                                        |  |
|  |                        Local Loopback HTTP (`127.0.0.1:8082`)                     |  |
|  +------------------------------------------+----------------------------------------+  |
+---------------------------------------------|-------------------------------------------+
                                              | (Mere Aggregation / Separate Process)
                                              v
                      +-----------------------------------------------+
                      |           FCC Sidecar Binary / Daemon         |
                      |  - 61-Provider Proxy Gateway                  |
                      |  - Aggregated 1.35B+ Free Token Allowance/mo  |
                      |  - Standard OpenAI-Compatible Endpoints       |
                      +-----------------------------------------------+
```

### Key Architectural Invariants
1. **Decoupled Process Boundary**: The FCC server is spawned as a child process bound strictly to loopback (`127.0.0.1:8082`). No memory space, shared libraries, or dynamic links exist between Ty-Code and FCC.
2. **Standard REST Protocols**: Communication occurs exclusively via vendor-neutral OpenAI-compatible endpoints (`/v1/models`, `/v1/chat/completions`).
3. **Copyleft Containment**: Operating as mere aggregation over network IPC prevents AGPL-3.0 copyleft contamination of Ty-Code's MIT core.

---

## 2. Boot Orchestration & Tier-2 Lifecycle

FCC initialization is orchestrated via `BootScheduler` in `src/main/services/boot/boot-scheduler.ts`:
- **Tier 0**: Window frame & critical canvas rendering.
- **Tier 1**: Local settings & safeStorage decryption.
- **Tier 2 (Non-Blocking)**: Background services, including `fcc_embedded_core`.
- **Latency Requirement**: The FCC server and catalog initialization execute asynchronously. Model candidates populate `ModelSelector` within **5 seconds** of application boot on clean install without blocking UI interaction.

---

## 3. Cryptographic Binary Integrity Verification

Before spawning or proxying to any sidecar binary, `FCCIntegrityChecker` (`src/main/services/orchestration/fcc-integrity.ts`) evaluates the binary:

```typescript
export const FCC_PINNED_MANIFEST: Record<string, string> = {
  'win32-x64': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'darwin-x64': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'darwin-arm64': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'linux-x64': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
};
```

### Strict Zero-Simulation Invariant
- If the binary hash does not match `FCC_PINNED_MANIFEST`, the FCC layer is **immediately disabled**.
- Ty-Code throws an explicit `INTEGRITY_MISMATCH` error.
- **No Mock Responses**: Under no circumstances does Ty-Code simulate model completion or mock provider responses. Mismatches or missing binaries surface real, actionable errors and trigger graceful, transparent degradation.

---

## 4. 61-Provider Catalog & ToS Curation

The catalog sync service (`src/main/services/fcc/catalog-sync.ts`) maintains metadata, health status, and Terms-of-Service compliance ratings for all 61 supported providers.

### ToS Classification Taxonomy

| Level | Status | Policy | Default State |
| :--- | :--- | :--- | :--- |
| **Tier A** | `compliant` | Explicit developer API terms permitting 3rd-party clients. | **Enabled** |
| **Tier B** | `verified` | Standard free/commercial API with standard rate limits. | **Enabled** |
| **Tier C** | `conditional` | Requires user login token or session cookie. | **Enabled** (if configured) |
| **Tier D** | `risky` | Web-scraping endpoints, unauthorized reverse-engineered APIs, or unauthenticated session spoofing. | **Disabled by Default** |

### Default Disabling of Risky Providers
Providers classified as `risky` (including `huggingchat`, `duckduckgo-ai`, `phind-web`, `you-web`, `blackbox-web`) are systematically **disabled by default**. 
- In the `ProviderHealthDashboard`, these providers display a warning badge and an explanatory tooltip detailing the exact ToS risk.
- Users may manually opt into enabling them, but Ty-Code defaults to strict compliance.

---

## 5. Architectural Degradation Hierarchy

When the primary FCC supply layer is stopped, disabled, or fails an integrity check, the router executes transparent multi-tier fallback in **< 2 seconds**:

```
+---------------------------------------------------------------------------------+
|                   PRIMARY SUPPLY: Free-Claude-Code (FCC) Layer                  |
|                   - 61 Curated Providers                                        |
|                   - Aggregate 1.35B+ Free Monthly Tokens                        |
|                   - Provenance Badge: 'FCC'                                     |
+---------------------------------------+-----------------------------------------+
                                        |
                             (Offline / Degraded / Disabled)
                                        |
                                        v  (< 2.0s Fallback Activation)
+---------------------------------------------------------------------------------+
|                   FALLBACK TIER 1: Native Provider Registry (BYOK)              |
|                   - OpenRouter, Groq, Google AI Studio, Local Ollama           |
|                   - User-managed encrypted safeStorage keys                     |
|                   - Provenance Badge: 'your key'                                |
+---------------------------------------+-----------------------------------------+
                                        |
                             (No User Keys Configured)
                                        |
                                        v
+---------------------------------------------------------------------------------+
|                   FALLBACK TIER 0: OpenKilo Anonymous Gateway                   |
|                   - Zero-Config Out-of-the-Box Fallback                         |
|                   - DeepSeek R1, Qwen 2.5 Coder, Llama 3.3                      |
|                   - Provenance Badge: 'anonymous'                               |
+---------------------------------------------------------------------------------+
```

### Fallback Status Indicator
When falling back from FCC, the application UI presents the official status string:
`FCC offline — native supply active`
ensuring the developer is always informed of the current model supply route.

---

## 6. Machine-Readable Validation Traces
- Architecture & Foundation Trace: [`docs/traces/fcc-foundation-trace.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/fcc-foundation-trace.json)
- Full Supply Layer & Verification Trace: [`docs/traces/fcc-core.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/fcc-core.json)
