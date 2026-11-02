/**
 * Prompt E (Step 3) — custom command loader/renderer tests (pure Node).
 *
 * The Verification sentence for this step is "command args substitute
 * correctly", so every test here writes a real Markdown file to a real temp
 * directory and asserts on the real rendered output — including the
 * home-scope path, via a spied os.homedir (never the user's actual config).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { customCommandService, MissingArgumentsError, splitArgs } from './custom-command-service';

let ws: string;
let fakeHome: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-cmd-ws-'));
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-cmd-home-'));
  fs.mkdirSync(path.join(ws, '.tycode', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.tycode', 'commands'), { recursive: true });
  vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

function writeProjectCommand(file: string, content: string): void {
  fs.writeFileSync(path.join(ws, '.tycode', 'commands', file), content, 'utf8');
}

function writeUserCommand(file: string, content: string): void {
  fs.writeFileSync(path.join(fakeHome, '.tycode', 'commands', file), content, 'utf8');
}

describe('customCommandService — argument substitution', () => {
  it('maps positional args onto {name} tokens in declaration order', async () => {
    writeProjectCommand('pr.md', 'Review {branch} against {base} for the service module.');
    const prompt = await customCommandService.render(ws, 'pr', 'feature-x main');
    expect(prompt).toBe('Review feature-x against main for the service module.');
  });

  it('applies {name:default} when the argument is absent, overrides when present', async () => {
    writeProjectCommand('deploy.md', 'Deploy {env:staging} now.');
    expect(await customCommandService.render(ws, 'deploy', '')).toBe('Deploy staging now.');
    expect(await customCommandService.render(ws, 'deploy', 'prod')).toBe('Deploy prod now.');
  });

  it('substitutes the whole raw string for $ARGUMENTS', async () => {
    writeProjectCommand('fix.md', 'Fix the following issue:\n\n$ARGUMENTS');
    const prompt = await customCommandService.render(ws, 'fix', 'the login crash on Safari');
    expect(prompt).toBe('Fix the following issue:\n\nthe login crash on Safari');
  });

  it('explicit named args win over positional values', async () => {
    writeProjectCommand('pr.md', 'Review {branch} against {base}.');
    const prompt = await customCommandService.render(ws, 'pr', 'typed-first typed-second', { branch: 'real-branch', base: 'main' });
    expect(prompt).toBe('Review real-branch against main.');
  });

  it('a token with no value and no default raises MissingArgumentsError naming it', async () => {
    writeProjectCommand('issue.md', 'Triage issue {number} in {repo}.');
    await expect(customCommandService.render(ws, 'issue', '')).rejects.toThrow(MissingArgumentsError);
    await expect(customCommandService.render(ws, 'issue', '')).rejects.toThrow(/number/);
  });

  it('keeps quoted groups as one argument', async () => {
    writeProjectCommand('commit.md', 'Commit with message: {message}');
    const prompt = await customCommandService.render(ws, 'commit', '"fix: keep spacing, please"');
    expect(prompt).toBe('Commit with message: fix: keep spacing, please');
  });

  it('repeated tokens all substitute; unknown command errors honestly', async () => {
    writeProjectCommand('dup.md', '{x} and {x} again');
    expect(await customCommandService.render(ws, 'dup', 'val')).toBe('val and val again');
    await expect(customCommandService.render(ws, 'ghost', '')).rejects.toThrow(/No custom command/);
  });
});

describe('customCommandService — scopes + listing', () => {
  it('lists project and user commands, project shadows user on name clash', async () => {
    writeUserCommand('shared.md', 'user version {a}');
    writeUserCommand('own.md', 'User-only command.');
    writeProjectCommand('shared.md', 'project version {a}');
    const list = await customCommandService.list(ws);
    const names = list.map((c) => c.name);
    expect(names).toEqual(['own', 'shared']);
    const shared = list.find((c) => c.name === 'shared');
    expect(shared?.scope).toBe('project');
    expect(await customCommandService.render(ws, 'shared', 'X')).toBe('project version X');
  });

  it('reads frontmatter description and argument metadata', async () => {
    writeProjectCommand(
      'meta.md',
      ['---', 'description: Cherry-pick a commit onto the release branch', 'arguments:', '  - "{commit:HEAD}"', '  - branch: target branch', '---', 'Cherry-pick {commit} onto {branch}.'].join('\n')
    );
    const list = await customCommandService.list(ws);
    const meta = list.find((c) => c.name === 'meta');
    expect(meta?.description).toBe('Cherry-pick a commit onto the release branch');
    expect(meta?.args.map((a) => a.name)).toEqual(['commit', 'branch']);
    expect(meta?.args[0]?.defaultValue).toBe('HEAD');
    expect(meta?.args[1]?.description).toBe('target branch');
    // Defaults still flow through rendering; branch has no default -> required.
    expect(await customCommandService.render(ws, 'meta', 'abc123 release/2.9')).toBe('Cherry-pick abc123 onto release/2.9.');
  });

  it('exposes declared arg placeholders and $ARGUMENTS usage on entries', async () => {
    writeProjectCommand('mixed.md', 'Do {thing} with $ARGUMENTS');
    const list = await customCommandService.list(ws);
    const entry = list.find((c) => c.name === 'mixed');
    expect(entry?.takesAllArguments).toBe(true);
    expect(entry?.args.map((a) => a.name)).toEqual(['thing']);
  });

  it('a missing commands directory lists empty, never throws', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-cmd-bare-'));
    try {
      expect(await customCommandService.list(bare)).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('splitArgs', () => {
  it('splits on whitespace but respects quotes', () => {
    expect(splitArgs('a b "c d" e')).toEqual(['a', 'b', 'c d', 'e']);
    expect(splitArgs('')).toEqual([]);
  });
});
