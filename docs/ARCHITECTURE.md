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

## Omni-Debugger performance (Stage 6)

### 6a — non-blocking workspace scan
`runFullAnalysis` no longer `await`s `getOrScanWorkspaceProfile` before
launching the engines. The scan is started as a promise (memoized through the
shared `workspaceCache` singleton) and only the passes that actually consume it
— the dynamic DB-profiling step and the arch worker — `await` it. The static
step therefore launches immediately and findings stream to the UI sooner. The
LITE-mode single-worker gate (one debugger worker alive at a time) is unchanged.

### 6b — shared workspace cache + explicit invalidation
`src/main/services/workspace-cache-service.ts` exports a process-wide
`workspaceCache` singleton (`getOrCompute(key, ttl, fn)` / `invalidate` /
`invalidateByPattern` / `subscribeToInvalidation`) reused by BOTH the Debugger
(workspace profile) and the Canvas (design prompt). Keys are
`${projectRoot}:${scope}` with a 30s TTL (matching the Stage 5b memo). On
`workspace:changed` / `workspace:closed` the Workspace Session Manager calls
`handleWorkspaceChanged(root)`; the file watcher calls `handleFileEvent(root,
path)` for monitored paths (`package.json`, `tailwind.config.*`,
`.tycode/rules/*`, `src/**/*.{ts,tsx,js,jsx}`). Concurrent computes for one key
are deduplicated onto a single in-flight promise.

### 6c — abortable AI post-pass
`FullAnalysisOptions.abortSignal` is threaded into `generateRoleBasedReport`
(previously hardcoded `undefined`). The analyst checks `aborted` before spending
a request and before the free-tier fallback; a mid-stream cancellation is
classified by `isAbortError` and returns partial results flagged
`{ aborted: true }` instead of an "AI analyst unavailable" finding. The
engines-only snapshot broadcast (before the AI pass) is preserved, so the UI
keeps every finding and simply shows the AI section as cancelled.

### 6d — `non_blocking_scan` telemetry
`agentObservability` emits `{ scanStartMs, firstFindingMs, scanCompleteMs }` at
the engines-only broadcast. `scanCompleteMs === 0` means the workspace scan was
still running when findings were delivered — the exact latency 6a removes.

### 6e — cache invalidation tests
`tests/workspace-cache.test.ts` (run by `npm run test:integration`) locks hit
within TTL, miss after expiry, invalidation on `workspace:changed` and on a
file-watcher event, disposable subscriptions, concurrent dedup, and the
Debugger/Canvas shared instance (same key → same value).

## M3E Canvas performance (Stage 7)

### 7a — shared design-prompt cache
`canvas-agent-engine.generate` memoizes the expensive
`extractDesignSystem` + `getOrScanWorkspaceProfile` + `getCorrections` trio per
root through the SAME `workspaceCache` singleton used by the Debugger, so a
restyle on a warm workspace skips re-scanning. Live, in-session corrections are
still applied fresh on top of the cached base prompt.

### 7b — abort + notice hygiene
`opts.abortSignal` is forwarded unchanged to `ProviderGateway.sendChatRequest`,
so a newer prompt aborts the prior stream. The free-tier fallback notice is
emitted once: when a streaming `onToken` relay is present the in-stream notice
is shown and the separate `pushMessage` is skipped (no double-emit).
`getActiveModel()` is synchronous/cached, so no per-run memo is needed.

## Cross-stage integration (Stage 8)

`tests/integration/agent-loop-integration.test.ts` drives the REAL AgentEngine
loop against a scripted provider and asserts the stages hold together: parallel
read-only batching (3a) preserves every result, a mid-task argument-validation
retry recovers (2c), a transient `[PROVIDER_DOWN] (503)` fails over through
Stage 1 routing without a silent stop, exactly one classified `loop_exit` is
recorded (1a/1e), the shared cache serves both surfaces without blocking the
loop (6b/7a), and the `non_blocking_scan` ledger event flows end-to-end (6d).
The gated `npm run test:live` suite covers the full Electron/worker/provider
runtime this headless test intentionally does not spawn.
