import { describe, expect, it } from 'vitest';
import { shouldShowNoResponseNotice } from './no-response-notice';

describe('shouldShowNoResponseNotice (blank-turn guard specificity)', () => {
  it('flags a truly blank assistant finalize with no output and no error', () => {
    expect(
      shouldShowNoResponseNotice({
        role: 'assistant',
        content: '',
        thoughts: [],
        toolExecutions: [],
        proposedDiffs: [],
        hasErrorCard: false,
        cancelled: false
      })
    ).toBe(true);
  });

  it('never flags a valid streamed answer', () => {
    expect(
      shouldShowNoResponseNotice({ role: 'assistant', content: 'Here is your reply.', hasErrorCard: false })
    ).toBe(false);
  });

  it('never flags a whitespace-only-but-reasoning turn (thoughts present)', () => {
    expect(
      shouldShowNoResponseNotice({ role: 'assistant', content: '   ', thoughts: ['reasoning step'] })
    ).toBe(false);
  });

  it('never flags a legitimate tool-only turn', () => {
    expect(
      shouldShowNoResponseNotice({
        role: 'assistant',
        content: '',
        thoughts: [],
        toolExecutions: [{ id: 't1', name: 'read_file', status: 'success' }]
      })
    ).toBe(false);
  });

  it('never flags a plan-push / diff turn', () => {
    expect(
      shouldShowNoResponseNotice({
        role: 'assistant',
        content: '',
        proposedDiffs: [{ id: 'd1', filePath: 'a.ts' }]
      })
    ).toBe(false);
  });

  it('never flags a document-push turn', () => {
    expect(
      shouldShowNoResponseNotice({
        role: 'assistant',
        content: '',
        proposedDocument: { id: 'doc1', title: 'Plan' }
      })
    ).toBe(false);
  });

  it('does not duplicate an error card', () => {
    expect(
      shouldShowNoResponseNotice({ role: 'assistant', content: '', hasErrorCard: true })
    ).toBe(false);
  });

  it('does not flag an intentional stop', () => {
    expect(
      shouldShowNoResponseNotice({ role: 'assistant', content: '', cancelled: true })
    ).toBe(false);
  });

  it('only ever applies to assistant messages', () => {
    expect(shouldShowNoResponseNotice({ role: 'user', content: '' })).toBe(false);
    expect(shouldShowNoResponseNotice({ role: 'system', content: '' })).toBe(false);
    expect(shouldShowNoResponseNotice({ role: 'tool', content: '' })).toBe(false);
  });
});
