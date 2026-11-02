# Ty-Code Agent Architecture — Loop, Harness & Provider Gateway

Living reference for the production-stability & performance work
(execution order 0 → 1 → 2 → 5 → 3 → 4a → 6 → 7 → 8). This document
covers the main chat ReAct loop (`agent-engine.ts`), the harness layer,
and `ProviderGateway`. Each subsection maps to a plan stage.
Regression posture is enforced by `scripts/no-agent-performance-regression.mjs`
against the canary in [`AGENT_BASELINE.md](./AGENT_BASELINE.md) — see
`npm run guard:perf` / `npm run guards`.

## Loop correctness (Stage 1)

- **1a — single iteration count per pass.** `stateManager.iterationCount`
  is incremented once, at the end of a while-pass (tools pass). Per-tool
  branches and `continue` paths no longer bump it, so a pass with N tool
  calls consumes exactly 1 iteration. Locked by
  `src/main/orchestration/agent-loop.stage4a.test.ts` (test "1a").
- **1b — identity-keyed dedup.** Repeat-suppression is keyed by call
  identity (id), not by `name+args`, so two same-name reads with distinct
  ids both execute. Locked by test "1b" and the live dual-read gate.
- **1d — bounded unknown-tool retry.** An unknown tool gets 3 strikes
  (corrective guidance → valid-tool list → structured
  `unknown_tool_exhausted` refusal), then halts visibly. The causal exit
  reason `unknown_tool` is sticky and survives the trailing
  `max_iterations`.
- **1e — visible iteration halt.** Burning the full budget emits a
  structured ErrorCard (`taxonomyCode: TASK_EVIDENCE_INCOMPLETE`), never a
  silent stop.
- **2c — argument-validation retry budget.** Invalid tool arguments get a
  3-attempt budget (`invalid_arguments` → `attempt 2/3` →
  `validation_exhausted`) before halting.

## Loop performance (Stage 3)

### 3a — parallel read-only tool batching

Consecutive eligible **read-only** tool calls are dispatched together with
`Promise.all`, bounded by `PARALLEL_CAP = 4`. Eligible tools
(`PARALLEL_READ_TOOLS`): `read_file`, `list_dir`, `grep_search`,
`git_status`, `git_diff`, `git_log`. A batch triggers the moment the
sequential loop reaches an uncached member; each call still walks the loop
and consumes its cached result, so **results append in original order**.

Guards:
- Per-call timeout `PARALLEL_READ_TIMEOUT_MS = 15_000` (a timed-out read
  resolves as an error result, never hangs the batch).
- Combined output > 50 MB is compressed per-tool before caching.
- **Auto-fallback to sequential** when a batch fails > 50% of its reads.
- Disabled entirely under degraded mode / live memory pressure (3f/3g).

**Feature flag — `TYCODE_PARALLEL_READS`** (default ON):
```
# Rollback procedure (kill the parallel path without a redeploy):
set TYCODE_PARALLEL_READS=false      # PowerShell: $env:TYCODE_PARALLEL_READS="false"
npm run test:live                    # confirm flakiness resolved
```
Any value other than `false`/`0` keeps the flag on. After rollback,
investigate the root cause (typically a race or memory pressure), fix,
and re-enable by clearing the variable. If the issue is non-obvious,
document it in `docs/KNOWN_ISSUES.md` with the resolution.

### 3b — token estimation once per pass

Per-pass token estimation runs a single time and reuses the
`getVerifiedModels` memo (Stage 5b) for the model context limit, instead of
re-deriving it per tool call.

### 3c — live-rule injection rebuild

Correction-memory rules are injected as a rebuilt block each pass rather
than accumulated, keeping the system prompt bounded.

### 3d — per-tool output compression budget

Each tool result is compressed against a per-tool character budget
(`outputCharBudget(name)`), so a verbose tool can't crowd out the rest of
the context.

### 3e — deferred file-memory summarization

File-memory summarization is deferred off the hot loop. Under memory
pressure it is skipped entirely (3f) and emits a `deferred_summarization`
ledger event `{ fileCount, deferredMs, skippedDueToPressure }`.

### 3f — memory-pressure guard

`isMemoryPressure()` trips when `process.memoryUsage().heapUsed` exceeds
`MEMORY_PRESSURE_HEAP_BYTES = 2.5 GB`. A trip defers summarization and
disables new parallel-read batches.

### 3g — persistent degraded mode

After **3+ pressure trips** in a session, `degradedMode = true`:
parallel reads are skipped for the session and all summarization is
deferred. Logs `[PERF] Degraded mode engaged due to repeated memory
pressure`. Cleared only on app restart. Exposed to tests via
`isDegradedMode()` / `__perfGuardForTest()`.

### 3h — Stage 3 telemetry

`agentObservability` emits `parallel_reads`
`{ toolCount, parallelBatchSize, wallTimeMs, sequentialEstimateMs }` and
`deferred_summarization` (above) so the Stage 3 features are measured by
the ledger the canary reads.

## ProviderGateway (Stage 5)

Routing decisions and cross-provider handoff logic are unchanged; Stage 5
only removes redundant work, adds TTFT telemetry, and hardens aborts.

### 5a — request cache (flag-gated)
Identical list/model requests are served from an in-memory cache, gated by
a feature flag so it can be disabled without a redeploy.

### 5b — `getVerifiedModels` memo
Verified-model lookups are memoized; Stage 3b reuses this memo for the
model context limit.

### 5c — TTFT telemetry
Time-to-first-token is recorded per streamed response via
`performanceManager.recordTimeToFirstToken(ms)` and surfaced in the
performance snapshot (average + p95 `TimeToFirstTokenMs`). The first
streamed chunk disarms the first-token watchdog and stamps TTFT once.

### 5d — stream watchdog + handoff-on-stall
Both `streamWithCandidate` and the legacy `sendChatRequest` run a watchdog
with **mandatory defaults** overridable by env:

| Env var | Default | Meaning |
| --- | --- | --- |
| `TYCODE_FIRST_TOKEN_TIMEOUT_MS` | 30000 | abort if no first token arrives |
| `TYCODE_IDLE_TIMEOUT_MS` | 10000 | abort if the stream idles mid-response |

A watchdog abort (`first_token_timeout` / `idle_timeout`) flows into the
existing failover path so a stalled provider hands off rather than hanging
until the hard 120s timeout. Timers are `unref`'d so they never keep the
process alive.

### 5e — pre-warm targets
Endpoints are pre-warmed against the live model target; a warm/cold
mismatch is logged so pre-warm can be validated against the actual route.

## Harness layer (Stage 4a)

### 4a-1 — real per-harness response parsing
Harness-specific `parseResponse` is implemented only for formats that are
positively detected: **Claude XML `antml` blocks** and **Codex
markdown-patch**. Others document pass-through in
`HarnessMetadata.supportedFeatures`; there are no speculative parsers.
Locked by
`src/main/services/orchestration/harnesses/tool-protocol.stage4a.test.ts`
(alias matrix, malformed-JSON skip, post-approval validation, antml parse,
markdown-patch parse).

### 4a-2 — structured loop exit classification
`agentObservability` emits exactly one `loop_exit` per run:
`{ reason: 'max_iterations' | 'validation_exhausted' | 'unknown_tool' |
'success' | 'error', iterationCount, toolCallCount }`, derived from the
last non-`none` stop via `classifyLoopExit` (exhaustion reasons are sticky).

## Pending (Stage 6 — document when implemented)

- **6a — non-blocking workspace scan.** `runFullAnalysis` should start the
  static step immediately and pass the `getOrScanWorkspaceProfile` promise
  into the arch/dynamic steps, emitting `non_blocking_scan`. Not yet
  implemented; this section is a placeholder to be filled in during Stage 6.
