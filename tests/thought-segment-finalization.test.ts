import { describe, it, expect } from 'vitest';
import { appendThoughtChunk } from '../src/renderer/src/state/chat-store';
import { normalisePunctuation } from '../src/renderer/src/services/punctuation-normaliser';

describe('Thought Segment Structure & Rich Text Finalization', () => {
  describe('Step 1: appendThoughtChunk (Thoughts as a Structured Array)', () => {
    it('pushes the chunk as the first element when array is empty', () => {
      const initial: string[] = [];
      const result = appendThoughtChunk(initial, 'I am analyzing the directory structure');
      expect(result).toEqual(['I am analyzing the directory structure']);
    });

    it('appends chunk with a single space when previous does not end with terminal punctuation', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, 'I am exploring the');
      thoughts = appendThoughtChunk(thoughts, 'codebase.');
      expect(thoughts).toEqual(['I am exploring the codebase.']);
    });

    it('guarantees exactly one space at join point (no double space, never zero spaces)', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, 'Analyzing dependencies  ');
      thoughts = appendThoughtChunk(thoughts, '  and imports.');
      expect(thoughts).toEqual(['Analyzing dependencies and imports.']);
    });

    it('pushes a NEW element when previous element ends with sentence-terminal punctuation (.)', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, 'Checked the structure and code.');
      thoughts = appendThoughtChunk(thoughts, 'Let me explore the next module.');

      // BUG A verification: prevents "code.Let" collision!
      expect(thoughts).toHaveLength(2);
      expect(thoughts[0]).toBe('Checked the structure and code.');
      expect(thoughts[1]).toBe('Let me explore the next module.');
    });

    it('pushes a NEW element when previous element ends with ! or ?', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, 'Found the bug!');
      thoughts = appendThoughtChunk(thoughts, 'Is this reproducible?');
      thoughts = appendThoughtChunk(thoughts, 'Yes, confirmed.');

      expect(thoughts).toHaveLength(3);
      expect(thoughts[0]).toBe('Found the bug!');
      expect(thoughts[1]).toBe('Is this reproducible?');
      expect(thoughts[2]).toBe('Yes, confirmed.');
    });

    it('pushes a NEW element when incoming chunk begins with a newline', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, 'Step 1: inspect files');
      thoughts = appendThoughtChunk(thoughts, '\nStep 2: run tests');

      expect(thoughts).toHaveLength(2);
      expect(thoughts[0]).toBe('Step 1: inspect files');
      expect(thoughts[1]).toBe('Step 2: run tests');
    });

    it('collapses internal runs of spaces to one and trims ends', () => {
      let thoughts: string[] = [];
      thoughts = appendThoughtChunk(thoughts, '   Scanning   through    the   codebase...   ');
      expect(thoughts).toEqual(['Scanning through the codebase...']);
    });
  });

  describe('Step 4: Normalizer Safety for Markdown Syntax (Pipe Tables)', () => {
    it('returns byte-identical table lines when passed a pipe table', () => {
      const table = [
        '| Capability | Harness | Status | Quota |',
        '| :--- | :---: | :---: | ---: |',
        '| Claude Code — Free Tier | claude-code | Active | 1.3B+ tokens |',
        '| Codex Proxy — High Speed | codex | Live | 500M+ tokens |',
        '| VSCode Assistant | vscode | Ready | Multi-harness |'
      ].join('\n');

      const result = normalisePunctuation(table);
      expect(result).toBe(table);
    });

    it('normalises prose before and after table while leaving table rows 100% untouched', () => {
      const markdown = [
        'Here is the performance summary — please check:',
        '| Metric | Value |',
        '| --- | --- |',
        '| Latency — P99 | 120ms |',
        'Next steps — continue monitoring.'
      ].join('\n');

      const expected = [
        'Here is the performance summary, please check:',
        '| Metric | Value |',
        '| --- | --- |',
        '| Latency — P99 | 120ms |',
        'Next steps, continue monitoring.'
      ].join('\n');

      expect(normalisePunctuation(markdown)).toBe(expected);
    });

    it('preserves code blocks and inline code byte-for-byte alongside tables', () => {
      const markdown = [
        'Prose with em dash — before table.',
        '| Feature | Syntax |',
        '| --- | --- |',
        '| Code | `const x = " — ";` |',
        '```typescript',
        'const emDash = " — ";',
        '```',
        'Prose with em dash — after table.'
      ].join('\n');

      const expected = [
        'Prose with em dash, before table.',
        '| Feature | Syntax |',
        '| --- | --- |',
        '| Code | `const x = " — ";` |',
        '```typescript',
        'const emDash = " — ";',
        '```',
        'Prose with em dash, after table.'
      ].join('\n');

      expect(normalisePunctuation(markdown)).toBe(expected);
    });
  });
});
