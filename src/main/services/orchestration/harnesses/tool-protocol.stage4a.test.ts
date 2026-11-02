import { describe, it, expect } from 'vitest';
import {
  normalizeToolCallAlias,
  parseTextualToolCalls,
  parseClaudeAntmlToolCalls,
  parseCodexMarkdownPatch,
  type ParsedTextualToolCall
} from './tool-protocol';
import { validateToolArguments } from '../../../agent/tool-schemas';

/**
 * Stage 4a-3 (tool protocol): locks the alias-normalisation matrix (1c), the
 * malformed-JSON resilience of the universal parser (2a), and the post-approval
 * Zod validation the engine re-runs before execution (2b/2c). Also locks the new
 * harness-specific parsers added in 4a-1 (Claude antml, Codex markdown-patch).
 */

const TC_OPEN = '<tool_call>';
const TC_CLOSE = '<' + '/tool_call>';

/** Explicit element type so the generic parser param doesn't infer `never`. */
const NO_EXISTING: ParsedTextualToolCall[] = [];

describe('Stage 4a - tool protocol + harness parsing', () => {
  describe('1c alias matrix', () => {
    it('folds common tool-name aliases onto canonical names', () => {
      expect(normalizeToolCallAlias('list_directory', {}).name).toBe('list_dir');
      expect(normalizeToolCallAlias('cat', {}).name).toBe('read_file');
      expect(normalizeToolCallAlias('bash', {}).name).toBe('run_command');
      expect(normalizeToolCallAlias('edit', {}).name).toBe('replace_file_content');
      expect(normalizeToolCallAlias('grep', {}).name).toBe('grep_search');
    });

    it('folds replace_file_content search/replace alias families onto canonical fields', () => {
      const a = normalizeToolCallAlias('edit_file', { filePath: 'x', searchText: 'old', replaceText: 'new' });
      expect(a.name).toBe('replace_file_content');
      expect(a.arguments.targetContent).toBe('old');
      expect(a.arguments.replacementContent).toBe('new');

      const b = normalizeToolCallAlias('patch', { path: 'y', old_str: 'A', new_str: 'B' });
      expect(b.arguments.filePath).toBe('y');
      expect(b.arguments.targetContent).toBe('A');
      expect(b.arguments.replacementContent).toBe('B');
    });
  });

  describe('2a malformed JSON in textual tool calls', () => {
    it('skips a block whose arguments payload is not valid JSON without throwing', () => {
      const good = `${TC_OPEN}<name>read_file</name><arguments>{"filePath":"a.ts"}</arguments>${TC_CLOSE}`;
      const bad = `${TC_OPEN}<name>read_file</name><arguments>{"filePath": "a.ts",,,}</arguments>${TC_CLOSE}`;
      const parsed = parseTextualToolCalls(`${bad}\n${good}`, NO_EXISTING);
      // Only the well-formed block yields a call; the malformed one is dropped.
      expect(parsed.toolCalls).toHaveLength(1);
      expect(parsed.toolCalls[0].name).toBe('read_file');
    });

    it('returns prose untouched when there are no tool calls', () => {
      const result = parseTextualToolCalls('Just a plain prose answer.', NO_EXISTING);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.text).toContain('plain prose answer');
    });
  });

  describe('2b/2c post-approval Zod validation', () => {
    it('accepts an alias-folded patch after approval', () => {
      const result = validateToolArguments('replace_file_content', {
        filePath: 'src/a.ts',
        searchText: 'const x = 1;',
        replaceText: 'const x = 2;'
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing required arguments with a structured hint', () => {
      const result = validateToolArguments('grep_search', {});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.status).toBe('invalid_arguments');
        expect(typeof result.error.hint).toBe('string');
        expect(result.error.hint.length).toBeGreaterThan(0);
      }
    });
  });

  describe('4a-1 Claude antml parsing', () => {
    it('parses namespaced antml invoke/parameter blocks into normalized calls', () => {
      const text = [
        'Let me look.',
        '<antml:function_calls>',
        '<antml:invoke name="read_file">',
        '<antml:parameter name="filePath">src/main.ts</antml:parameter>',
        '<antml:parameter name="startLine">10</antml:parameter>',
        '</antml:invoke>',
        '</antml:function_calls>',
        'Done.'
      ].join('\n');
      const parsed = parseClaudeAntmlToolCalls(text, NO_EXISTING);
      expect(parsed.toolCalls).toHaveLength(1);
      expect(parsed.toolCalls[0].name).toBe('read_file');
      expect(parsed.toolCalls[0].arguments.filePath).toBe('src/main.ts');
      // numeric-looking parameter coerced to a number
      expect(parsed.toolCalls[0].arguments.startLine).toBe(10);
      // antml markup never leaks into the user-facing text
      expect(parsed.text).not.toContain('<antml:');
      expect(parsed.text).toContain('Let me look.');
    });

    it('falls through to the universal parser for a standard tool_call block', () => {
      const text = `${TC_OPEN}<name>grep_search</name><arguments>{"query":"needle"}</arguments>${TC_CLOSE}`;
      const parsed = parseClaudeAntmlToolCalls(text, NO_EXISTING);
      expect(parsed.toolCalls).toHaveLength(1);
      expect(parsed.toolCalls[0].name).toBe('grep_search');
    });
  });

  describe('4a-1 Codex markdown-patch parsing', () => {
    it('converts an Add File patch block into a write_file call', () => {
      const text = [
        '*** Begin Patch',
        '*** Add File: src/new.ts',
        '+export const a = 1;',
        '+export const b = 2;',
        '*** End Patch'
      ].join('\n');
      const parsed = parseCodexMarkdownPatch(text, NO_EXISTING);
      const writeFile = parsed.toolCalls.find((call) => call.name === 'write_file');
      expect(writeFile).toBeDefined();
      expect(writeFile?.arguments.filePath).toBe('src/new.ts');
      expect(writeFile?.arguments.content).toBe('export const a = 1;\nexport const b = 2;');
    });

    it('does not fabricate a call for an Update File hunk (no speculation)', () => {
      const text = [
        '*** Begin Patch',
        '*** Update File: src/existing.ts',
        '@@',
        '-old line',
        '+new line',
        '*** End Patch'
      ].join('\n');
      const parsed = parseCodexMarkdownPatch(text, NO_EXISTING);
      expect(parsed.toolCalls).toHaveLength(0);
      // The un-parseable hunk stays visible rather than being silently dropped.
      expect(parsed.text).toContain('Update File');
    });

    it('falls through to the universal parser when no patch is present', () => {
      const text = `${TC_OPEN}<name>read_file</name><arguments>{"filePath":"z.ts"}</arguments>${TC_CLOSE}`;
      const parsed = parseCodexMarkdownPatch(text, NO_EXISTING);
      expect(parsed.toolCalls).toHaveLength(1);
      expect(parsed.toolCalls[0].name).toBe('read_file');
    });
  });
});
