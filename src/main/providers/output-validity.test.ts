/**
 * Output validity gate classification unit tests (Step 5.3).
 *
 * Asserts the DEGENERATE taxonomy (empty, zero-event stream, missing
 * finish_reason, error-in-200) and the VALID cases (content, tool-only).
 */

import { describe, it, expect } from 'vitest';
import { classifyStreamOutput, StreamValidityTracker } from './output-validity';

describe('classifyStreamOutput (Validity Gate)', () => {
  it('VALID: any non-empty content is valid', () => {
    expect(
      classifyStreamOutput({ contentLen: 3, hasToolCall: false, dataEventCount: 1, finishReason: 'stop', tokenCount: 2, sawErrorObject: false })
    ).toEqual({ valid: true });
  });

  it('VALID: a tool-call-only response (empty prose) is valid', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: true, dataEventCount: 5, finishReason: 'tool_calls', tokenCount: 12, sawErrorObject: false })
    ).toEqual({ valid: true });
  });

  it('DEGENERATE: zero content + zero tool calls with data events → empty_content', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: false, dataEventCount: 3, finishReason: 'stop', tokenCount: 1, sawErrorObject: false })
    ).toEqual({ valid: false, reason: 'empty_content' });
  });

  it('DEGENERATE: stream closed with no data events → zero_data_events', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: false, dataEventCount: 0, finishReason: null, tokenCount: 0, sawErrorObject: false })
    ).toEqual({ valid: false, reason: 'zero_data_events' });
  });

  it('DEGENERATE: missing finish_reason with zero tokens → missing_finish_reason', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: false, dataEventCount: 1, finishReason: null, tokenCount: 0, sawErrorObject: false })
    ).toEqual({ valid: false, reason: 'missing_finish_reason' });
  });

  it('DEGENERATE: an error-bearing 200 chunk → error_in_200 (wins over empties)', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: false, dataEventCount: 1, finishReason: null, tokenCount: 0, sawErrorObject: true })
    ).toEqual({ valid: false, reason: 'error_in_200' });
  });

  it('error-in-200 does NOT override a real tool call (a tool call is valid output)', () => {
    expect(
      classifyStreamOutput({ contentLen: 0, hasToolCall: true, dataEventCount: 1, finishReason: 'tool_calls', tokenCount: 5, sawErrorObject: true })
    ).toEqual({ valid: true });
  });
});

describe('StreamValidityTracker (incremental, no-latency)', () => {
  it('marks VALID immediately on the first content token', () => {
    const t = new StreamValidityTracker();
    expect(t.immediatelyValid).toBe(false);
    t.noteDataEvent();
    t.markContent();
    expect(t.immediatelyValid).toBe(true);
    expect(t.observe(5)).toEqual({ valid: true });
  });

  it('marks VALID immediately on the first tool-call fragment', () => {
    const t = new StreamValidityTracker();
    t.noteDataEvent();
    t.markToolCall();
    expect(t.immediatelyValid).toBe(true);
  });

  it('resolves the empty-stream reason taxonomy only at stream end', () => {
    const t = new StreamValidityTracker();
    t.noteErrorFrame();
    expect(t.observe(0)).toEqual({ valid: false, reason: 'error_in_200' });

    const t2 = new StreamValidityTracker();
    expect(t2.observe(0)).toEqual({ valid: false, reason: 'zero_data_events' });
  });
});
