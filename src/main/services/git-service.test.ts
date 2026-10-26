import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildCommitMessage, GitService, parseGraphRaw } from './git-service';

const service = new GitService();

describe('parseGraphRaw', () => {
  it('parses hash, parents, author, epoch, subject and refs in order', () => {
    const raw = [
      ['h1', '', 'Alice', '1700000000', 'Initial commit', 'HEAD -> main'].join('\x00'),
      ['h2', 'h1', 'Bob', '1700000100', 'Add api layer', 'origin/main, tag: v1.0'].join('\x00')
    ].join('\n');
    const result = parseGraphRaw(raw);
    expect(result.head).toBe('main');
    expect(result.commits).toHaveLength(2);
    expect(result.commits[0]).toEqual({
      hash: 'h1',
      parents: [],
      message: 'Initial commit',
      authorName: 'Alice',
      timestamp: 1700000000,
      refs: { branches: ['main'], remoteBranches: [], tags: [], isHead: true }
    });
    expect(result.commits[1].parents).toEqual(['h1']);
    expect(result.commits[1].refs).toEqual({
      branches: [],
      remoteBranches: ['origin/main'],
      tags: ['v1.0'],
      isHead: false
    });
  });

  it('marks lone HEAD refs as head without a branch name', () => {
    const [headCommit] = parseGraphRaw(['h9', '', 'Ann', '1700000100', 'Detached state', 'HEAD'].join('\x00')).commits;
    expect(headCommit.refs.isHead).toBe(true);
    expect(parseGraphRaw(['h9', '', 'Ann', '1700000100', 'Detached state', 'HEAD'].join('\x00')).head).toBeUndefined();
  });

  it('skips blank and malformed lines and tolerates CRLF output', () => {
    const result = parseGraphRaw(['\r\n', ['x1', '', 'A', '1700000000', 'ok', 'main'].join('\x00'), 'broken-line-no-null-byte'].join('\r\n'));
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].refs.branches).toEqual(['main']);
  });
});

describe('buildCommitMessage', () => {
  it('classifies documentation-only changes as docs', () => {
    const result = buildCommitMessage([{ path: 'README.md', status: 'M' }], []);
    expect(result.type).toBe('docs');
    expect(result.scope).toBeUndefined();
    expect(result.subject).toMatch(/^docs: update readme$/);
    expect(result.body).toBe('- update README.md');
  });

  it('classifies workflow config changes as chore and skips dotted scopes', () => {
    const result = buildCommitMessage([{ path: '.github/workflows/ci.yml', status: 'A' }], []);
    expect(result.type).toBe('chore');
    expect(result.scope).toBeUndefined();
    expect(result.subject).toMatch(/^chore: add ci$/);
  });

  it('detects fix language in paths or patch text', () => {
    const result = buildCommitMessage([{ path: 'src/runner.ts', status: 'M' }], ['@@ fix crash handling in retry loop @@']);
    expect(result.type).toBe('fix');
    expect(result.scope).toBe('src');
    expect(result.subject).toMatch(/^fix\(src\): update runner$/);
  });

  it('defaults additions to feat and deletions to a chore removal', () => {
    const addition = buildCommitMessage([{ path: 'src/new-feature.ts', status: 'A' }], []);
    expect(addition.type).toBe('feat');
    expect(addition.subject).toMatch(/^feat\(src\): add new-feature$/);
    const deletion = buildCommitMessage([{ path: 'stale-notes.md', status: 'D' }], []);
    expect(deletion.subject).toMatch(/^docs: remove stale-notes$/);
    expect(deletion.body).toBe('- remove stale-notes.md');
  });

  it('caps body bullets at ten and summarises the remainder', () => {
    const changes = Array.from({ length: 25 }, (_unused, index) => ({ path: `src/file-${index}.ts`, status: 'A' as const }));
    const result = buildCommitMessage(changes, []);
    const lines = result.body.split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[9]).toBe('- add src/file-9.ts');
    expect(lines[10]).toBe('- and 15 more files');
  });

  it('keeps the subject under 72 characters', () => {
    const giant = 'x'.repeat(200);
    const result = buildCommitMessage([{ path: `src/${giant}.ts`, status: 'A' }], []);
    expect(result.subject.length).toBeLessThanOrEqual(72);
  });
});

describe('listRepositories (fs-only discovery)', () => {
  let structuredRoot = '';
  let plainRoot = '';

  beforeEach(async () => {
    structuredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-git-discovery-a-'));
    plainRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-git-discovery-b-'));
    await fs.mkdir(path.join(structuredRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', '.git'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', 'node_modules', '.git'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', '.hidden-worktree'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', '.hidden-worktree', '.git'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', 'child-b', '.git'), { recursive: true });
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', 'child-c'), { recursive: true });
    await fs.writeFile(path.join(structuredRoot, 'repo-ws', 'child-c', '.git'), 'gitdir: ../child-b/.git');
    await fs.mkdir(path.join(structuredRoot, 'repo-ws', 'child-b', 'deeper', '.git'), { recursive: true });
    await fs.mkdir(path.join(plainRoot, 'plain-ws', 'node_modules', '.git'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(structuredRoot, { recursive: true, force: true });
    await fs.rm(plainRoot, { recursive: true, force: true });
  });

  it('lists the workspace repo, its parent and direct child repos in priority order', async () => {
    const repos = await service.listRepositories(path.join(structuredRoot, 'repo-ws'));
    const expectedWorkspace = path.join(structuredRoot, 'repo-ws');
    const children = [path.join(expectedWorkspace, 'child-b'), path.join(expectedWorkspace, 'child-c')].sort((a, b) => a.localeCompare(b));
    expect(repos).toEqual([
      { root: expectedWorkspace, name: 'repo-ws', kind: 'workspace' },
      { root: structuredRoot, name: path.basename(structuredRoot), kind: 'parent' },
      { root: children[0], name: path.basename(children[0]), kind: 'child' },
      { root: children[1], name: path.basename(children[1]), kind: 'child' }
    ]);
  });

  it('skips node_modules, dot directories and grandchildren but finds a .git file marker', async () => {
    const repos = await service.listRepositories(path.join(plainRoot, 'plain-ws'));
    expect(repos).toEqual([]);
  });

  it('finds nothing for an empty or invalid path argument', async () => {
    expect(await service.listRepositories('')).toEqual([]);
    expect(await service.listRepositories('   ')).toEqual([]);
  });
});
