import { describe, it, expect } from 'vitest';
import { AgentObservability } from './agent-observability';

/**
 * Stage 3h telemetry ledger contract. 3a (parallel read batching) and 3e
 * (deferred file-memory summarization) emit into the observability ledger via
 * AgentObservability.emit(); this test locks the event shapes the perf guards
 * and generateReport() read, independent of the heavy engine runtime (whose
 * end-to-end parallel_reads emission is proven by the Stage 4a live-e2e run).
 */
describe('Stage 3h - perf telemetry ledger events', () => {
  it('records a parallel_reads event with the full measured payload', () => {
    const obs = new AgentObservability();
    obs.emit('parallel_reads', {
      toolCount: 4,
      parallelBatchSize: 4,
      wallTimeMs: 42,
      sequentialEstimateMs: 160
    });

    const events = obs.getEvents({ type: 'parallel_reads' });
    expect(events).toHaveLength(1);
    const record = events[0] as unknown as Record<string, unknown>;
    expect(record.toolCount).toBe(4);
    expect(record.parallelBatchSize).toBe(4);
    expect(record.wallTimeMs).toBe(42);
    expect(record.sequentialEstimateMs).toBe(160);
    expect(typeof record.timestamp).toBe('number');
  });

  it('records a deferred_summarization event including the pressure-skip flag', () => {
    const obs = new AgentObservability();
    obs.emit('deferred_summarization', { fileCount: 3, deferredMs: 0, skippedDueToPressure: true });
    obs.emit('deferred_summarization', { fileCount: 3, deferredMs: 18, skippedDueToPressure: false });

    const events = obs.getEvents({ type: 'deferred_summarization' });
    expect(events).toHaveLength(2);
    const skipped = events[0] as unknown as Record<string, unknown>;
    const flushed = events[1] as unknown as Record<string, unknown>;
    expect(skipped.skippedDueToPressure).toBe(true);
    expect(flushed.skippedDueToPressure).toBe(false);
    expect(flushed.fileCount).toBe(3);
  });

  it('caps the ledger and preserves the most recent perf events', () => {
    const obs = new AgentObservability();
    for (let i = 0; i < 3_050; i++) {
      obs.emit('parallel_reads', { toolCount: 1, parallelBatchSize: 1, wallTimeMs: i, sequentialEstimateMs: i });
    }
    expect(obs.events.length).toBeLessThanOrEqual(3_000);
    const latest = obs.getEvents({ type: 'parallel_reads' }).slice(-1)[0] as unknown as Record<string, unknown>;
    expect(latest.wallTimeMs).toBe(3_049);
  });
});
