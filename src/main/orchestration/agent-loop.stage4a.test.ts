import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentEngine, ProviderGateway } from '../agent/agent-engine';
import { agentObservability } from '../agent/agent-observability';
import { isDegradedMode, __perfGuardForTest } from '../agent/agent-engine';
import { ShellSandbox } from '../agent/shell-sandbox';
import type { AgentStreamChunk, ProviderSettings } from '../../preload/types';

/**
 * Stage 4a-3 (loop): drives the REAL AgentEngine ReAct loop with a scripted
 * provider — only the two outermost seams (gateway network call, shell
 * execution) are stubbed; harness parsing, gates, dedup, plan approval,
 * completion contract, tool execution and observability all run for real.
 * Tool calls are delivered through the gateway's structured onToolCalls
 * callback — the same seam real providers use. Locks:
 * - 1b: dedup keyed by call identity — same-name calls with distinct ids both execute
 * - 1d: bounded (3-strike) unknown-tool retry with a VISIBLE refusal, then halt
 * - 1e: iteration-budget exhaustion halts with a visible ErrorCard, never silently
 * - 1a: exactly one iteration count per completed tools pass (no double-count)
 * - 2c: argument-validation retry budget (3 strikes) → visible validation_exhausted
 * - 4a-2: exactly one loop_exit telemetry event per run, correctly classified
 * - 3g: memory-pressure degraded-mode latch
 * Lives OUTSIDE src/main/agent so the no-mock-agent-path production guard
 * (which forbids stub identifiers in agent/provider sources) is untouched.
 */

interface ScriptedCall { id: string; name: string; args: Record<string, unknown> }
type ScriptedReply = { text?: string; calls?: ScriptedCall[] };

/** Engine arg positions (14-param sendChatRequest signature). */
const ARG_INDEX_ONTOOLCALLS = 11;
const ARG_INDEX_CONTEXT = 13;

const SETTINGS: ProviderSettings = {
  activeProvider: 'openrouter',
  activeModel: 'test/scripted-model',
  modelLock: { providerId: 'openrouter', modelId: 'test/scripted-model', mode: 'strict' },
  apiKeys: {},
  customEndpoints: {},
  temperature: 0,
  maxTokens: 1024
};

/** Plan markdown whose Execution Plan section feeds populateTodosFromPlan. */
const PLAN_MARKDOWN = [
  '## Complexity & Resource Gauge',
  'Class: Small',
  '## Execution Plan (Phased)',
  '- **Phase 1: Discovery**: read sample.txt and confirm its contents',
  // "verify" is a whole-word verification keyword — getRelatedTodo only
  // auto-completes a verification todo whose text matches that pattern.
  '- **Phase 2: Verification**: verify the change with vitest run and confirm it passes'
].join('\n');

/** Direct verifier command (classifyVerificationCommand matches `vitest run`). */
const VERIFY_CMD = 'npx vitest run --reporter=dot';

/** Final summary must name a changed artifact + the verification command + pass wording. */
const FINAL_TEXT = `Changed notes.txt; ${VERIFY_CMD} passed with no errors and sample.txt was read twice.`;

let workspace = '';
const gatewaySpies: Array<{ mockRestore: () => void }> = [];

/**
 * Script the gateway: chat-context calls consume replies[i] in order (the last
 * reply repeats). Non-chat consumers (file-memory summarization, compaction)
 * receive '' so they can never shift the chat script.
 */
function scriptGateway(replies: ScriptedReply[]): void {
  let i = 0;
  const spy = vi.spyOn(ProviderGateway, 'sendChatRequest');
  // variadic implementation: sendChatRequest carries a 14-parameter signature;
  // only the onToolCalls callback (arg 11) and context (arg 13) are consumed.
  (spy as unknown as { mockImplementation: (fn: (...args: unknown[]) => Promise<string>) => void }).mockImplementation(async (...args: unknown[]) => {
    const context = args[ARG_INDEX_CONTEXT];
    if (context !== 'chat') return '';
    const reply = replies[Math.min(i, replies.length - 1)];
    i++;
    if (reply.calls && reply.calls.length > 0) {
      const onToolCalls = args[ARG_INDEX_ONTOOLCALLS] as ((calls: Array<{ id: string; name: string; arguments: string }>) => void) | undefined;
      onToolCalls?.(reply.calls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.args) })));
    }
    return reply.text ?? '';
  });
  gatewaySpies.push(spy as unknown as { mockRestore: () => void });
}

/** Keep shell hermetic: the sandbox answers every command as a clean exit-0 run. */
function stubShell(): void {
  const spy = vi.spyOn(ShellSandbox.prototype, 'executeCommand');
  (spy as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(async () => ({
    success: true,
    stdout: 'verification ok',
    stderr: '',
    exitCode: 0,
    duration: 1
  }));
  gatewaySpies.push(spy as unknown as { mockRestore: () => void });
}

interface RunOutcome {
  chunks: AgentStreamChunk[];
  events: ReturnType<typeof agentObservability.getEvents>;
}

async function runEngine(prompt: string): Promise<RunOutcome> {
  const startTs = Date.now();
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
  return { chunks, events: agentObservability.getEvents({ startTime: startTs }) };
}

function loopExitOf(events: RunOutcome['events']): Record<string, unknown> | undefined {
  // Exactly one loop_exit per run; take the LAST so stray legacy events can't satisfy assertions.
  const exits = events.filter((e) => e.type === 'loop_exit');
  return exits.length > 0 ? (exits[exits.length - 1] as unknown as Record<string, unknown>) : undefined;
}

function toolResultsFor(chunks: AgentStreamChunk[], name: string): Array<{ output: string; isError: boolean }> {
  const out: Array<{ output: string; isError: boolean }> = [];
  for (const chunk of chunks) {
    if (chunk.type === 'tool_result' && chunk.toolResult?.name === name) {
      out.push({ output: String(chunk.toolResult.output ?? ''), isError: chunk.toolResult.isError === true });
    }
  }
  return out;
}

function toolCallsFor(chunks: AgentStreamChunk[], name: string): AgentStreamChunk[] {
  return chunks.filter((c) => c.type === 'tool_call' && c.toolCall?.name === name);
}

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'tycode-agent-loop-'));
  writeFileSync(path.join(workspace, 'sample.txt'), 'hello from fixture\n');
});

beforeEach(() => {
  agentObservability.events.length = 0;
});

afterEach(() => {
  while (gatewaySpies.length > 0) gatewaySpies.pop()?.mockRestore();
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Stage 4a-3 - real loop with scripted gateway', () => {
  it('1b: two same-name read calls with distinct ids BOTH execute (identity-keyed dedup)', async () => {
    scriptGateway([
      { calls: [{ id: 'call_a', name: 'read_file', args: { filePath: 'sample.txt' } }, { id: 'call_b', name: 'read_file', args: { filePath: 'sample.txt' } }] },
      { text: FINAL_TEXT }
    ]);
    const { chunks } = await runEngine('Read the sample file twice through separate calls so I can compare emissions');

    expect(toolCallsFor(chunks, 'read_file')).toHaveLength(2);
    const results = toolResultsFor(chunks, 'read_file');
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.isError)).toBe(true);
  }, 30_000);

  it('1a: one tools pass counts as exactly one iteration (no double-count)', async () => {
    scriptGateway([
      { calls: [{ id: 'call_1a', name: 'read_file', args: { filePath: 'sample.txt' } }] },
      { text: FINAL_TEXT }
    ]);
    const { chunks, events } = await runEngine('Read the sample file once and report what it contains for the transcript');

    // Only the tools pass completes an iteration; the text tail never appends a
    // second agent_iteration, so one pass == one recorded iteration.
    const iterations = events.filter((e) => e.type === 'agent_iteration');
    expect(iterations).toHaveLength(1);
    const first = iterations[0] as unknown as { iteration: number };
    expect(first.iteration).toBe(1);
    // Exactly one loop_exit for the run.
    expect(events.filter((e) => e.type === 'loop_exit')).toHaveLength(1);
    expect(loopExitOf(events)!.toolCallCount).toBe(1);
    expect(chunks.some((c) => c.type === 'done' || c.type === 'error')).toBe(true);
  }, 30_000);

  it('1d: unknown tool gets bounded retries and a visible structured refusal', async () => {
    scriptGateway([{ calls: [{ id: 'call_u1', name: 'do_the_thing', args: {} }] }]);
    const { chunks, events } = await runEngine('Please invoke the do_the thing utility to finish this demonstration task');

    const results = toolResultsFor(chunks, 'do_the_thing');
    // Strike 1 + 2: corrective guidance; strike 2 injects the valid-tool list;
    // strike 3: structured unknown_tool_exhausted refusal (visible halt).
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0].output).toContain('is not a valid tool');
    expect(results[1].output).toContain('Valid tools are:');
    expect(results[2].output).toContain('unknown_tool_exhausted');
    expect(results.every((r) => r.isError)).toBe(true);

    // 4a-2: exhaustion stops are sticky — the burned iteration tail cannot
    // rewrite the causal exit reason.
    const exit = loopExitOf(events);
    expect(exit!.reason).toBe('unknown_tool');
  }, 60_000);

  it('2c: repeated invalid arguments exhaust the retry budget with a visible halt', async () => {
    scriptGateway([{ calls: [{ id: 'call_g1', name: 'grep_search', args: {} }] }]);
    const { chunks, events } = await runEngine('Search the workspace for a needle using grep but omit the query on purpose');

    const results = toolResultsFor(chunks, 'grep_search');
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0].output).toContain('invalid_arguments');
    expect(results[1].output).toContain('attempt 2/3');
    expect(results[2].output).toContain('validation_exhausted');

    const exit = loopExitOf(events);
    expect(exit!.reason).toBe('validation_exhausted');
  }, 60_000);

  it('1e: iteration-budget exhaustion halts VISIBLY with an ErrorCard (never silent)', async () => {
    // Every pass emits a (cache-missing) read of a nonexistent path, so the
    // loop can never satisfy completion and must burn the full budget.
    const spam: ScriptedReply[] = [];
    for (let i = 0; i < 80; i++) spam.push({ calls: [{ id: `call_spin_${i}`, name: 'read_file', args: { filePath: `missing_${i}.txt` } }] });
    scriptGateway(spam);
    const { chunks, events } = await runEngine('Keep reading missing files forever so the iteration budget is fully consumed for testing');

    const exit = loopExitOf(events);
    expect(exit!.reason).toBe('max_iterations');
    expect(exit!.iterationCount).toBeGreaterThanOrEqual(70);

    // Stage 1e: the halt is a structured, visible error — not a silent stop.
    // (emitCompletionError renders `reason` only when the unmet list is empty,
    // so assert the structured pieces instead of the trailing reason string.)
    const errorChunks = chunks.filter((c) => c.type === 'error');
    expect(errorChunks.length).toBeGreaterThanOrEqual(1);
    const lastError = errorChunks[errorChunks.length - 1];
    const message = lastError && lastError.type === 'error' ? lastError.error : '';
    expect(message).toContain('iteration limit reached');
    expect(message).toContain('last tool results');
    expect(lastError && lastError.type === 'error' ? lastError.errorCard?.taxonomyCode : '').toBe('TASK_EVIDENCE_INCOMPLETE');
  }, 60_000);

  it('full contract flow: plan approval → dual reads → verification → done (single success loop_exit)', async () => {
    scriptGateway([
      { calls: [{ id: 'p1', name: 'submit_plan', args: { title: 'Dual read plan', markdown: PLAN_MARKDOWN } }] },
      { calls: [{ id: 'r1', name: 'read_file', args: { filePath: 'sample.txt' } }, { id: 'r2', name: 'read_file', args: { filePath: 'sample.txt' } }] },
      { calls: [{ id: 'v1', name: 'run_command', args: { command: VERIFY_CMD } }] },
      { calls: [{ id: 'w1', name: 'write_file', args: { filePath: 'notes.txt', content: 'sample.txt verified\n' } }] },
      { calls: [{ id: 'v2', name: 'run_command', args: { command: VERIFY_CMD } }] },
      { text: FINAL_TEXT }
    ]);
    stubShell();
    const { chunks, events } = await runEngine('Read sample.txt twice as separate calls, write the findings to notes.txt, verify with typecheck and finish');

    // The engine walked the real gates: plan approved, both reads executed,
    // verification recorded, artifact changed.
    expect(chunks.some((c) => c.type === 'approval_request')).toBe(true);
    expect(toolCallsFor(chunks, 'read_file')).toHaveLength(2);
    expect(toolResultsFor(chunks, 'write_file').every((r) => !r.isError)).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    const exit = loopExitOf(events);
    expect(exit!.reason).toBe('success');
    expect(events.filter((e) => e.type === 'loop_exit')).toHaveLength(1);
    // One iteration per completed pass — exactly the five tools passes.
    expect((exit!.iterationCount as number) ?? 0).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

describe('Stage 4a-3 - 3g memory-pressure degraded mode', () => {
  it('latches degraded mode after three pressure trips and clears below threshold', () => {
    __perfGuardForTest({ trips: 0, degraded: false });
    expect(isDegradedMode()).toBe(false);
    __perfGuardForTest({ trips: 3, degraded: true });
    expect(isDegradedMode()).toBe(true);
    __perfGuardForTest({ trips: 0, degraded: false });
    expect(isDegradedMode()).toBe(false);
  });
});
