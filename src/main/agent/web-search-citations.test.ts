/**
 * Prompt E (Step 4) — cited web search tests (pure Node).
 *
 * Covers the two testable halves of the contract in the exact production
 * module the agent loop and renderer import: the per-invocation approval
 * gate decision (`webSearchApprovalReason`) and the citation footer parser
 * (`extractCitations`) that proves a cited answer carries real source links.
 */

import { describe, expect, it } from 'vitest';
import {
  extractCitations,
  isWebSearchToolCall,
  webSearchApprovalReason
} from '../../shared/types/web-search-citations';

describe('web search approval gate (single networked tool)', () => {
  it('gates both tool name aliases per invocation', () => {
    expect(isWebSearchToolCall('brave_web_search')).toBe(true);
    expect(isWebSearchToolCall('web_search')).toBe(true);
    expect(webSearchApprovalReason('brave_web_search', 'latest Node LTS'))
      ?.toContain('Search the web for "latest Node LTS"');
    expect(webSearchApprovalReason('web_search', '  spaced query  '))
      ?.toContain('"spaced query"');
  });

  it('labels an empty query honestly instead of rejecting the gate', () => {
    expect(webSearchApprovalReason('web_search', '   ')?.includes('(empty query)')).toBe(true);
    expect(webSearchApprovalReason('web_search', undefined as unknown as string)).toContain('(empty query)');
  });

  it('never gates the local tools — search is the only networked one', () => {
    for (const name of ['read_file', 'grep_search', 'run_command', 'git_commit', 'semantic_search', 'load_rule']) {
      expect(webSearchApprovalReason(name, 'anything')).toBeNull();
    }
    expect(isWebSearchToolCall('semantic_search')).toBe(false);
  });
});

describe('citation footer parsing (cited answers carry real links)', () => {
  it('parses the contract footer: inline markers + titled source lines', () => {
    const answer = [
      'React 19 ships Actions natively [1], and the compiler memoizes by default [2].',
      '',
      'Sources:',
      '[1] React 19 Release Notes - https://react.dev/blog/2024/12/05/react-19',
      '[2] React Compiler Overview - https://react.dev/learn/react-compiler'
    ].join('\n');
    const report = extractCitations(answer);
    expect(report.inlineMarkers).toEqual([1, 2]);
    expect(report.sources).toHaveLength(2);
    expect(report.sources[0]).toEqual({
      index: 1,
      title: 'React 19 Release Notes',
      url: 'https://react.dev/blog/2024/12/05/react-19'
    });
    expect(report.sources[1]?.url).toBe('https://react.dev/learn/react-compiler');
  });

  it('parses markdown-link footers too', () => {
    const answer = [
      'The docs confirm the behavior [1].',
      'Sources:',
      '[1] [Official Docs](https://example.com/docs)'
    ].join('\n');
    const report = extractCitations(answer);
    expect(report.sources[0]).toEqual({ index: 1, title: 'Official Docs', url: 'https://example.com/docs' });
  });

  it('an uncited answer reports no sources — absence is the no-search signal', () => {
    const report = extractCitations('Just knowledge here, no web claims at all.');
    expect(report.sources).toEqual([]);
    expect(report.inlineMarkers).toEqual([]);
  });

  it('skips footer lines without a real http(s) URL instead of fabricating one', () => {
    const answer = [
      'Claim [1] and claim [2].',
      'Sources:',
      '[1] No Link Here',
      '[2] Real - https://example.org/ok'
    ].join('\n');
    const report = extractCitations(answer);
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]?.url).toBe('https://example.org/ok');
  });

  it('inline markers only count from the body, not the footer itself', () => {
    const answer = [
      'Only cited once [1].',
      'Sources:',
      '[1] Title - https://example.com/a'
    ].join('\n');
    expect(extractCitations(answer).inlineMarkers).toEqual([1]);
  });
});
