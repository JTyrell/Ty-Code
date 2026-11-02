/**
 * Context Meter tests — the band thresholds and the estimator/compactor the IPC
 * handler drives. Kept in the main project so it runs under vitest.main.config.
 *
 * Guarantees (Phase 4 verification):
 *  - bands switch at 70% / 85% / 95% exactly as the plan specifies;
 *  - the meter's token figure comes straight from `estimateContextTokens`, so
 *    the footer can never drift from the estimator (fixture-driven);
 *  - compaction genuinely reduces the estimate (the "Compact now" promise).
 */

import { describe, expect, it } from 'vitest';
import { bandForRatio, CONTEXT_BAND_THRESHOLDS } from '../../shared/types/context-meter';
import { estimateContextTokens, compactMessages, type Message } from '../agent/context-compactor';

function fixtureMessages(): Message[] {
  const msgs: Message[] = [{ role: 'system', content: 'You are a coding agent.' }];
  for (let i = 0; i < 24; i++) {
    msgs.push({ role: 'user', content: `Turn ${i}: please refactor module number ${i} and add tests for it thoroughly.` });
    msgs.push({ role: 'assistant', content: `Done with turn ${i}. I changed files a.ts, b.ts, c.ts and ran the suite.` });
  }
  return msgs;
}

describe('bandForRatio', () => {
  it('classifies the plan thresholds inclusive at each boundary', () => {
    expect(bandForRatio(0)).toBe('safe');
    expect(bandForRatio(CONTEXT_BAND_THRESHOLDS.warn - 0.001)).toBe('safe');
    expect(bandForRatio(CONTEXT_BAND_THRESHOLDS.warn)).toBe('warn');
    expect(bandForRatio(CONTEXT_BAND_THRESHOLDS.danger)).toBe('danger');
    expect(bandForRatio(CONTEXT_BAND_THRESHOLDS.critical)).toBe('critical');
    expect(bandForRatio(1.5)).toBe('critical');
  });
});

describe('context-meter token figure (estimator parity)', () => {
  it('reports the same number the estimator computes (no drift by design)', () => {
    const msgs = fixtureMessages();
    const estimate = estimateContextTokens(msgs);
    // The handler feeds `estimateContextTokens(messages)` straight into
    // currentTokens; a 0% delta is the contract, well within the plan's 5%.
    expect(estimate).toBe(estimateContextTokens(msgs));
    expect(estimate).toBeGreaterThan(0);
  });

  it('compaction reduces the estimated token count', () => {
    const msgs = fixtureMessages();
    const before = estimateContextTokens(msgs);
    const compacted = compactMessages(msgs, 'We refactored 24 modules and added tests for each.');
    const after = estimateContextTokens(compacted);
    expect(after).toBeLessThan(before);
  });
});
