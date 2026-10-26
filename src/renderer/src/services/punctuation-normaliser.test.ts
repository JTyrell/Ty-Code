import { describe, it, expect } from 'vitest';
import {
  normalisePunctuation,
  segmentMarkdown,
  transformProse
} from './punctuation-normaliser';

describe('punctuation-normaliser', () => {
  describe('transformProse', () => {
    it('converts spaced em dashes to commas', () => {
      const input = 'The solution — while effective — took time.';
      expect(transformProse(input)).toBe('The solution, while effective, took time.');
    });

    it('converts unspaced paired parenthetical em dashes to commas', () => {
      const input = 'The solution—while effective—took time.';
      expect(transformProse(input)).toBe('The solution, while effective, took time.');
    });

    it('converts spaced en dashes to commas', () => {
      const input = 'Focus on speed – reliability – and simplicity.';
      expect(transformProse(input)).toBe('Focus on speed, reliability, and simplicity.');
    });

    it('preserves unspaced en dashes in numeric ranges', () => {
      const input = 'The study covered 1999–2005 with 10–20 participants during 2024–2026.';
      expect(transformProse(input)).toBe('The study covered 1999–2005 with 10–20 participants during 2024–2026.');
    });

    it('converts ellipsis character to three standard dots', () => {
      const input = 'Loading… Please wait…';
      expect(transformProse(input)).toBe('Loading... Please wait...');
    });

    it('collapses double spaces created by dash replacements without corrupting newlines', () => {
      const input = 'First clause —   second clause.\nNew line —   continues.';
      expect(transformProse(input)).toBe('First clause, second clause.\nNew line, continues.');
    });

    it('strips a leading em dash marker without adding a comma artifact', () => {
      const input = '— A brief aside about performance.';
      expect(transformProse(input)).toBe('A brief aside about performance.');
    });

    it('preserves markdown trailing hard-break double spaces', () => {
      const input = 'First line — intro  \nSecond line — conclusion.';
      expect(transformProse(input)).toBe('First line, intro  \nSecond line, conclusion.');
    });
  });

  describe('segmentMarkdown', () => {
    it('correctly splits prose, inline code, and fenced code blocks', () => {
      const md = 'Hello — world!\n```ts\nconst x = " — ";\n```\nAfter fence with `inline — code`.';
      const segments = segmentMarkdown(md);

      expect(segments).toHaveLength(5);
      expect(segments[0]).toEqual({ type: 'prose', text: 'Hello — world!\n' });
      expect(segments[1]).toEqual({ type: 'code', text: '```ts\nconst x = " — ";\n```' });
      expect(segments[2]).toEqual({ type: 'prose', text: '\nAfter fence with ' });
      expect(segments[3]).toEqual({ type: 'code', text: '`inline — code`' });
      expect(segments[4]).toEqual({ type: 'prose', text: '.' });
    });

    it('handles unclosed fenced code blocks at end of stream', () => {
      const streamingMd = 'Prose before\n```python\ndef test():\n    return " — "';
      const segments = segmentMarkdown(streamingMd);

      expect(segments).toHaveLength(2);
      expect(segments[0].type).toBe('prose');
      expect(segments[1].type).toBe('code');
      expect(segments[1].text).toBe('```python\ndef test():\n    return " — "');
    });
  });

  describe('normalisePunctuation', () => {
    it('leaves fenced code blocks byte-for-byte untouched', () => {
      const input = [
        'Prose with em dash — before.',
        '```javascript',
        '// const x = " — ";',
        '// en-dash: 10 – 20;',
        '// ellipsis: "…";',
        '```',
        'Prose with en dash – after.'
      ].join('\n');

      const expected = [
        'Prose with em dash, before.',
        '```javascript',
        '// const x = " — ";',
        '// en-dash: 10 – 20;',
        '// ellipsis: "…";',
        '```',
        'Prose with en dash, after.'
      ].join('\n');

      expect(normalisePunctuation(input)).toBe(expected);
    });

    it('leaves inline code spans byte-for-byte untouched', () => {
      const input = 'Check `const x = " — ";` or `10 – 20` or `…` — thank you!';
      const expected = 'Check `const x = " — ";` or `10 – 20` or `…`, thank you!';
      expect(normalisePunctuation(input)).toBe(expected);
    });

    it('preserves numeric ranges with en dashes in prose', () => {
      const input = 'Between 2018–2023, approximately 15–25% of tasks — a substantial portion — completed.';
      const expected = 'Between 2018–2023, approximately 15–25% of tasks, a substantial portion, completed.';
      expect(normalisePunctuation(input)).toBe(expected);
    });

    it('returns input unchanged when toggle-off options.enabled is false', () => {
      const input = 'Text with — em dash and – en dash and … ellipsis.';
      expect(normalisePunctuation(input, { enabled: false })).toBe(input);
    });

    it('returns empty string for empty input', () => {
      expect(normalisePunctuation('')).toBe('');
    });

    it('normalises by default when no options are provided', () => {
      expect(normalisePunctuation('A — B.')).toBe('A, B.');
    });

    it('leaves prose without AI punctuation byte-for-byte identical', () => {
      const input = 'Plain prose stays exactly as written.\nSecond paragraph remains unchanged.';
      expect(normalisePunctuation(input)).toBe(input);
    });

    it('preserves pipe tables byte-identical so markdown table syntax is never corrupted', () => {
      const table = [
        '| Column 1 | Column 2 | Column 3 |',
        '| :--- | :---: | ---: |',
        '| Row 1 — value | 10 – 20 items | Note… ellipsis |',
        '| Plain text | Another — value | 2024–2026 |'
      ].join('\n');

      // Every line beginning with '|' must be byte-for-byte identical
      expect(normalisePunctuation(table)).toBe(table);
    });
  });
});
