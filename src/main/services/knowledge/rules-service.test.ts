/**
 * Prompt C Step 2 — Rules engine service tests.
 *
 * Everything runs against a real temp workspace with real files (no Electron, no
 * network). Guarantees asserted:
 *  - frontmatter (mode + globs, both inline-array and sequence forms) parses;
 *  - `always` rules inject regardless of context files;
 *  - `glob` rules inject ONLY when a matching file enters context;
 *  - `model-decision` rules surface as a catalog (description, not body);
 *  - `manual` rules never auto-inject;
 *  - the tester reports exactly which rules fire for a given file;
 *  - `load_rule` resolves a rule's full body;
 *  - save round-trips through the on-disk frontmatter.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rulesService, parseFrontmatter } from './rules-service';

let tempRoot = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-rules-'));
  fs.mkdirSync(path.join(tempRoot, '.tycode', 'rules'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeRule(file: string, content: string): void {
  fs.writeFileSync(path.join(tempRoot, '.tycode', 'rules', file), content, 'utf-8');
}

describe('parseFrontmatter', () => {
  it('parses inline array globs and mode', () => {
    const { fields } = parseFrontmatter(
      ['---', 'mode: glob', 'globs: ["*.ts", "src/**"]', 'description: "TS rules"', '---', '', '# Title', 'Body'].join('\n')
    );
    expect(fields.mode).toBe('glob');
    expect(fields.globs).toEqual(['*.ts', 'src/**']);
    expect(fields.description).toBe('TS rules');
  });

  it('parses sequence-form globs', () => {
    const { fields, body } = parseFrontmatter(
      ['---', 'mode: always', 'globs:', '  - "*.tsx"', '  - "*.jsx"', '---', 'Some body'].join('\n')
    );
    expect(fields.mode).toBe('always');
    expect(fields.globs).toEqual(['*.tsx', '*.jsx']);
    expect(body).toBe('Some body');
  });
});

describe('rulesService.buildInjection', () => {
  it('injects always rules regardless of context, glob rules only on match', async () => {
    writeRule('always.md', ['---', 'mode: always', 'description: global', '---', '# Always', 'NEVER use var.'].join('\n'));
    writeRule('react.md', ['---', 'mode: glob', 'globs: ["*.tsx"]', 'description: react', '---', '# React', 'Prefer function components.'].join('\n'));

    // No tsx file in context → the react glob must NOT appear.
    const noMatch = await rulesService.buildInjection(tempRoot, ['src/main.ts']);
    expect(noMatch).toContain('NEVER use var.');
    expect(noMatch).not.toContain('Prefer function components.');

    // A matching tsx file → glob body appears.
    const match = await rulesService.buildInjection(tempRoot, ['src/App.tsx']);
    expect(match).toContain('Prefer function components.');
  });

  it('lists model-decision rules as a catalog (description only) and never inlines manual rules', async () => {
    writeRule('perf.md', ['---', 'mode: model-decision', 'description: Performance guidance', '---', '# Perf', 'SECRET PERF BODY'].join('\n'));
    writeRule('draft.md', ['---', 'mode: manual', 'description: Draft note', '---', '# Draft', 'SECRET MANUAL BODY'].join('\n'));

    const block = await rulesService.buildInjection(tempRoot, []);
    expect(block).toContain('perf');
    expect(block).toContain('Performance guidance');
    expect(block).toContain('load_rule');
    // Neither model-decision nor manual bodies are inlined automatically.
    expect(block).not.toContain('SECRET PERF BODY');
    expect(block).not.toContain('SECRET MANUAL BODY');
  });
});

describe('rulesService.testFile', () => {
  it('reports which rules fire for a specific file', async () => {
    writeRule('always.md', ['---', 'mode: always', '---', 'x'].join('\n'));
    writeRule('ts.md', ['---', 'mode: glob', 'globs: ["**/*.ts"]', '---', 'x'].join('\n'));
    writeRule('md.md', ['---', 'mode: glob', 'globs: ["**/*.md"]', '---', 'x'].join('\n'));

    const result = await rulesService.testFile(tempRoot, 'src/index.ts');
    const names = result.fired.map((f) => f.rule.name).sort();
    expect(names).toEqual(['always', 'ts']);
    expect(result.fired.find((f) => f.rule.name === 'always')?.reason).toBe('always');
    expect(result.fired.find((f) => f.rule.name === 'ts')?.reason).toBe('glob-match');
  });
});

describe('rulesService resolve + save', () => {
  it('resolves a rule body for the load_rule tool', async () => {
    writeRule('perf.md', ['---', 'mode: model-decision', 'description: Performance guidance', '---', '# Perf', 'Run EXPLAIN before adding indexes.'].join('\n'));
    const text = await rulesService.resolveRuleText(tempRoot, 'perf');
    expect(text).toContain('Run EXPLAIN before adding indexes.');
    expect(await rulesService.resolveRuleText(tempRoot, 'does-not-exist')).toBeNull();
  });

  it('saves a structured rule and reads it back with the same mode/globs', async () => {
    const meta = await rulesService.save(tempRoot, {
      name: 'security',
      title: 'Security',
      description: 'Security posture',
      mode: 'glob',
      globs: ['**/*.ts'],
      body: 'Validate all inputs.'
    });
    expect(meta.mode).toBe('glob');
    expect(meta.globs).toEqual(['**/*.ts']);

    const readBack = await rulesService.read(tempRoot, 'security');
    expect(readBack).not.toBeNull();
    expect(readBack!.mode).toBe('glob');
    expect(readBack!.body).toContain('Validate all inputs.');
    expect(await fs.promises.readFile(path.join(tempRoot, '.tycode', 'rules', 'security.md'), 'utf-8')).toContain('mode: glob');
  });
});
