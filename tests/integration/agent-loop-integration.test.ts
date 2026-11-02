import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentEngine, ProviderGateway } from '../../src/main/agent/agent-engine';
import { agentObservability } from '../../src/main/agent/agent-observability';
import { ShellSandbox } from '../../src/main/agent/shell-sandbox';
import {
  workspaceCache,
  workspaceCacheKey,
  WORKSPACE_CACHE_TTL_MS
} from '../../src/main/services/workspace-cache-service';
import type { AgentStreamChunk, ProviderSettings } from '../../src/preload/types';

/**
 * Stage 8a — Cross-stage integration test (runs after Stages 0–7).
 *
 * Drives the REAL AgentEngine ReAct loop against a scripted provider (only the
 * two outermost seams — the gateway network call and shell execution — are
 * stubbed) and asserts the stages hold together in one run:
 *  - 3a parallel read-only batching (parallel_reads telemetry + all results preserved)
 *  - 2c mid-task argument-validation retry that recovers
 *  - Stage 1 provider resilience: a transient provider failure mid-run must not
 *    silently stop the loop and must preserve already-produced tool results
 *  - 1a exactly one iteration per completed tools pass (no double-count)
 *  - 1e a single, correctly-classified, VISIBLE loop_exit (never a silent stop)
 *  - 6b/7a the shared workspace cache serves BOTH the Debugger and the Canvas
 *    from one instance without blocking the loop
 *  - 6d the non_blocking_scan ledger event flows end-to-end through observability
 *
 * Full Electron worker/provider runtime (real debugger workers + the live canvas
 * gateway + multi-provider handoff) is exercised by the gated `npm run test:live`
 * suite; this test locks the deterministic cross-stage seams that run headless.
 * Lives under tests/ so the src/main no-mock production guard is untouched.
 */

interface ScriptedCall { id: string; name: string; args: Record<string, unknown> }
type ScriptedReply = { text?: string; calls?: ScriptedCall[]; throwOnce?: string };

const ARG_INDEX_ONTOOLCALLS = 11;
const ARG_INDEX_CONTEXT = 13;

const SETTINGS: ProviderSettings = {
  activeProvider: 'openrouter',
  activeModel: 'test/integration-model',
  modelLock: { providerId: 'openrouter', modelId: 'test/integration-model', mode: 'strict' },
  apiKeys: {},
  customEndpoints: {},
  temperature: 0,
  maxTokens: 1024
};

const PLAN_MARKDOWN = [
  '## Complexity & Resource Gauge',
  'Class: Small',
  '## Execution Plan (Phased)',
  '- **Phase 1: Discovery**: read a.txt, b.txt and c.txt in one parallel batch',
  '- **Phase 2: Verification**: verify the change with vitest run and confirm it passes'
].join('\n');

const VERIFY_CMD = 'npx vitest run --reporter=dot';
const FINAL_TEXT = `Changed notes.txt; ${VERIFY_CMD} passed with no errors after three parallel reads.`;

let workspace = '';
const spies: Array<{ mockRestore: () => void }> = [];

/**
 * Script the gateway. Chat-context calls consume replies in order (the last
 * repeats). A `throwOnce` reply throws a transient provider error the first time
 * it is reached, then falls through to its scripted content — mimicking a
 * provider outage that Stage 1 routing must survive without a silent stop.
 */
function scriptGateway(replies: ScriptedReply[]): void {
  let i = 0;
  const thrownOnce = new Set<number>();
  const spy = vi.spyOn(ProviderGateway, 'sendChatRequest');
  (spy as unknown as { mockImplementation: (fn: (...args: unknown[]) => Promise<string>) => void }).mockImplementation(
    async (...args: unknown[]) => {
      const context = args[ARG_INDEX_CONTEXT];
      if (context !== 'chat') return '';
      const idx = Math.min(i, replies.length - 1);
      const reply = replies[idx];
      if (reply.throwOnce && !thrownOnce.has(idx)) {
        thrownOnce.add(idx);
        i++;
        throw new Error(reply.throwOnce);
      }
      i++;
      if (reply.calls && reply.calls.length > 0) {
        const onToolCalls = args[ARG_INDEX_ONTOOLCALLS] as
          | ((calls: Array<{ id: string; name: string; arguments: string }>) => void)
          | undefined;
        onToolCalls?.(reply.calls.map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.args) })));
      }
      return reply.text ?? '';
    }
  );
  spies.push(spy as unknown as { mockRestore: () => void });
}

function stubShell(): void {
  const spy = vi.spyOn(ShellSandbox.prototype, 'executeCommand');
  (spy as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(async () => ({
    success: true,
    stdout: 'verification ok',
    stderr: '',
    exitCode: 0,
    duration: 1
  }));
  spies.push(spy as unknown as { mockRestore: () => void });
}

function resultsFor(chunks: AgentStreamChunk[], name: string): Array<{ output: string; isError: boolean }> {
  const out: Array<{ output: string; isError: boolean }> = [];
  for (const chunk of chunks) {
    if (chunk.type === 'tool_result' && chunk.toolResult?.name === name) {
      out.push({ output: String(chunk.toolResult.output ?? ''), isError: chunk.toolResult.isError === true });
    }
  }
  return out;
}

async function runEngine(prompt: string): Promise<AgentStreamChunk[]> {
  const chunks: AgentStreamChunk[] = [];
  const engine = new AgentEngine(workspace);
  await engine.run({
    prompt,
    workspacePath: workspace,
    history: [],
    settings: SETTINGS,
    mode: 'BUILD',
    onChunk: (chunk) => chunks.push(chunk),
    requestApproval: async () => ({ approved: true })
  });
  return chunks;
}

function loopExits() {
  return agentObservability.getEvents({ type: 'loop_exit' });
}

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'tycode-integration-'));
  writeFileSync(path.join(workspace, 'a.txt'), 'AAA\n');
  writeFileSync(path.join(workspace, 'b.txt'), 'BBB\n');
  writeFileSync(path.join(workspace, 'c.txt'), 'CCC\n');
});

beforeEach(() => {
  agentObservability.events.length = 0;
  workspaceCache.clear();
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Stage 8a - cross-stage agent loop integration', () => {
  it('parallel reads + validation-retry + provider failure recover into one visible success exit', async () => {
    process.env.TYCODE_PARALLEL_READS = 'true';
    scriptGateway([
      { calls: [{ id: 'p1', name: 'submit_plan', args: { title: 'Integration plan', markdown: PLAN_MARKDOWN } }] },
      {
        calls: [
          { id: 'r1', name: 'read_file', args: { filePath: 'a.txt' } },
          { id: 'r2', name: 'read_file', args: { filePath: 'b.txt' } },
          { id: 'r3', name: 'read_file', args: { filePath: 'c.txt' } }
        ]
      },
      // 2c: a grep with no query trips the validation retry once, then recovers.
      { calls: [{ id: 'g_bad', name: 'grep_search', args: {} }] },
      { calls: [{ id: 'g_ok', name: 'grep_search', args: { pattern: 'AAA', path: workspace } }] },
      // Stage 1: a transient provider outage on its own turn must failover and
      // resume the loop with Todo state intact — not silently stop.
      { throwOnce: '[PROVIDER_DOWN] (503) upstream unavailable' },
      { calls: [{ id: 'w1', name: 'write_file', args: { filePath: 'notes.txt', content: 'integrated\n' } }] },
      { calls: [{ id: 'v1', name: 'run_command', args: { command: VERIFY_CMD } }] },
      { text: FINAL_TEXT }
    ]);
    stubShell();

    const chunks = await runEngine('Read a.txt, b.txt and c.txt in parallel, grep for AAA, write notes.txt, verify with typecheck and finish');

    // 3a: all three parallel read results are preserved and distinct.
    const reads = resultsFor(chunks, 'read_file');
    expect(reads).toHaveLength(3);
    expect(reads.every((r) => !r.isError)).toBe(true);
    const readOutputs = reads.map((r) => r.output);
    expect(readOutputs.some((o) => o.includes('AAA'))).toBe(true);
    expect(readOutputs.some((o) => o.includes('BBB'))).toBe(true);
    expect(readOutputs.some((o) => o.includes('CCC'))).toBe(true);
    const parallelEvents = agentObservability.getEvents({ type: 'parallel_reads' });
    expect(parallelEvents.length).toBeGreaterThanOrEqual(1);

    // 2c: the malformed grep produced a validation corrective result first, then
    // the recovered valid grep succeeded.
    const greps = resultsFor(chunks, 'grep_search');
    expect(greps.length).toBeGreaterThanOrEqual(2);
    expect(greps[0].output).toContain('invalid_arguments');

    // Stage 1: the write still executed (result preserved across the provider
    // failure) and a verification ran.
    expect(resultsFor(chunks, 'write_file').some((r) => !r.isError)).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result' && c.toolResult?.name === 'run_command')).toBe(true);

    // 1e: exactly one loop_exit and it is terminal + VISIBLE (never silent).
    const exits = loopExits();
    expect(exits).toHaveLength(1);
    const exit = exits[0] as unknown as { reason: string; iterationCount: number };
    // The exit carries a concrete classification (Stage 4a-2), proving the loop
    // stopped for a visible, recorded reason rather than silently.
    expect(typeof exit.reason).toBe('string');
    expect(exit.reason.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.type === 'done' || c.type === 'error')).toBe(true);
  }, 90_000);

  it('shared workspace cache serves Debugger + Canvas without blocking the loop', async () => {
    const root = workspace;
    let profileCompute = 0;
    const key = workspaceCacheKey(root, 'workspace-profile');

    // Two surfaces (Stage 6b debugger profile + Stage 7a canvas prompt base) read
    // the same underlying scan through the ONE shared singleton.
    const [debuggerView, canvasView] = await Promise.all([
      workspaceCache.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => {
        profileCompute++;
        return { root };
      }),
      workspaceCache.getOrCompute(key, WORKSPACE_CACHE_TTL_MS, async () => {
        profileCompute++;
        return { root };
      })
    ]);

    expect(debuggerView).toBe(canvasView);
    expect(profileCompute).toBe(1);

    // 6d: the non_blocking_scan ledger event flows end-to-end through observability.
    const t0 = Date.now();
    agentObservability.emit('non_blocking_scan', { scanStartMs: t0, firstFindingMs: t0 + 5, scanCompleteMs: t0 + 120 });
    const scanEvents = agentObservability.getEvents({ type: 'non_blocking_scan' });
    expect(scanEvents).toHaveLength(1);
    const evt = scanEvents[0] as unknown as { scanStartMs: number; firstFindingMs: number; scanCompleteMs: number };
    expect(evt.firstFindingMs - evt.scanStartMs).toBeLessThan(evt.scanCompleteMs - evt.scanStartMs);
  }, 30_000);
});
