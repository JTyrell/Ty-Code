/**
 * Prompt B — Quest lifecycle tests (main-process, real git, no Electron).
 *
 * The two injectable seams (spec generator + runner) let us drive the FULL
 * lifecycle against a throwaway git repository without a single model call:
 * the runner writes to the isolated worktree exactly as the real agent would,
 * and the service does real `git worktree`/`diff`/`checkout`/`commit`. We prove
 * the three guarantees the prompt names verbatim:
 *   - the Spec approval gate is enforced (nothing runs or merges early);
 *   - two parallel quests on disjoint files merge cleanly;
 *   - cancel mid-run leaves the MAIN workspace byte-for-byte untouched;
 * plus the parallel cap (max 3) queues the fourth.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { questService, type QuestRunRequest } from './quest-service';
import type { QuestMeta } from '../../../shared/types/quest';

const SPEC_MD = [
  '## Objective',
  'Prove the quest lifecycle.',
  '## Implementation Plan',
  'Write one file in the worktree.',
  '## Test Plan',
  'Assert merge.',
  '## Risks & Mitigations',
  'None.'
].join('\n');

let repoDir = '';
let git: SimpleGit;

async function makeRepo(): Promise<void> {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-quest-'));
  git = simpleGit({
    baseDir: repoDir,
    maxConcurrentProcesses: 1,
    allowEnvironment: ['GIT_OPTIONAL_LOCKS']
  }).env({ GIT_OPTIONAL_LOCKS: '0' });
  await git.init();
  await git.addConfig('user.email', 'quest-test@ty-code.local');
  await git.addConfig('user.name', 'Ty-Code Quest Test');
  // Deterministic line endings: without this, Windows core.autocrlf turns the
  // checked-out quest file into CRLF and the content comparison would differ.
  await git.addConfig('core.autocrlf', 'false');
  await git.addConfig('core.eol', 'lf');
  // A committed baseline with two disjoint feature files + an untouched file.
  fs.writeFileSync(path.join(repoDir, 'featureA.txt'), 'A base\n', 'utf8');
  fs.writeFileSync(path.join(repoDir, 'featureB.txt'), 'B base\n', 'utf8');
  fs.writeFileSync(path.join(repoDir, 'shared.txt'), 'do not touch\n', 'utf8');
  await git.add(['featureA.txt', 'featureB.txt', 'shared.txt']);
  await git.commit('initial');
}

/** A runner that edits ONE disjoint file in the worktree, like a focused agent. */
function writerRunner(relPath: string, content: string) {
  return async (req: QuestRunRequest): Promise<void> => {
    req.onChunk({ type: 'status', content: 'starting quest work' } as never);
    req.onChunk({
      type: 'agent_state',
      state: { todos: [{ id: 't1', task: 'edit file', status: 'completed' }] }
    } as never);
    fs.writeFileSync(path.join(req.worktreePath, relPath), content, 'utf8');
  };
}

async function waitForStatus(questId: string, want: QuestMeta['status'][], timeoutMs = 20_000): Promise<QuestMeta> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const d = questService.detail(questId);
    if (d && want.includes(d.quest.status)) return d.quest;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`quest ${questId} never reached ${want.join('/')} (stuck at ${d?.quest.status ?? 'missing'})`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  questService.resetForTests();
  questService.setSpecGeneratorForTests(async () => SPEC_MD);
  await makeRepo();
}, 60_000);

afterEach(() => {
  questService.resetForTests();
  questService.setSpecGeneratorForTests(null);
  questService.setRunnerForTests(null);
  try {
    fs.rmSync(repoDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe('quest-service — approval gate', { timeout: 60_000 }, () => {
  it('drafts to awaiting-approval and refuses merge actions before approval', async () => {
    const quest = await questService.draft(repoDir, 'Add a nicety');
    expect(quest.status).toBe('awaiting-approval');

    // The gate: you cannot accept or finish a quest that never ran.
    await expect(questService.acceptFiles(quest.id, ['featureA.txt'])).rejects.toThrow(/merge review/i);
    await expect(questService.finish(quest.id, 'accept-commit')).rejects.toThrow(/reviewed/i);

    // Revising is allowed pre-approval, and produces a fresh awaiting-approval spec.
    const revised = await questService.revise(quest.id, ['please name the file']);
    expect(revised.status).toBe('awaiting-approval');
    expect(revised.specRevisions).toBe(1);
  });

  it('requires a git repository so execution can be isolated', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-quest-norepo-'));
    try {
      await expect(questService.draft(plain, 'no repo here')).rejects.toThrow(/git repositor/i);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('refuses approval from a non-awaiting status', async () => {
    const quest = await questService.draft(repoDir, 'Gate check');
    // Approving twice: the second call sees the quest past awaiting-approval.
    questService.setRunnerForTests(writerRunner('featureA.txt', 'A edited by quest\n'));
    await questService.approve(quest.id); // runs to reviewing (writer returns fast)
    await waitForStatus(quest.id, ['reviewing']);
    await expect(questService.approve(quest.id)).rejects.toThrow(/Approval gate/i);
  });
});

describe('quest-service — parallel disjoint merge', { timeout: 90_000 }, () => {
  it('two quests on disjoint files both merge cleanly into the main branch', async () => {
    const headBefore = (await git.raw(['rev-parse', 'HEAD'])).trim();

    const q1 = await questService.draft(repoDir, 'Change feature A');
    const q2 = await questService.draft(repoDir, 'Change feature B');

    // Each quest writes a DIFFERENT file in its own worktree.
    let calls = 0;
    questService.setRunnerForTests(async (req) => {
      // Route by which quest is running; both run concurrently.
      const target = req.quest.id === q1.id ? 'featureA.txt' : 'featureB.txt';
      const content = target === 'featureA.txt' ? 'A from quest1\n' : 'B from quest2\n';
      calls += 1;
      fs.writeFileSync(path.join(req.worktreePath, target), content, 'utf8');
    });

    // Approve both; they run in isolated worktrees without touching main.
    await Promise.all([questService.approve(q1.id), questService.approve(q2.id)]);
    expect(calls).toBe(2);

    const r1 = await waitForStatus(q1.id, ['reviewing', 'failed']);
    const r2 = await waitForStatus(q2.id, ['reviewing', 'failed']);
    expect(r1.status).toBe('reviewing');
    expect(r2.status).toBe('reviewing');
    expect(r1.changedFiles.map((f) => f.path)).toContain('featureA.txt');
    expect(r2.changedFiles.map((f) => f.path)).toContain('featureB.txt');

    // Main workspace is still pristine while both await review.
    expect((await git.raw(['status', '--porcelain'])).trim()).toBe('');
    expect((await git.raw(['rev-parse', 'HEAD'])).trim()).toBe(headBefore);

    // Per-file Accept + merge for each (sequential to avoid index races).
    await questService.acceptFiles(q1.id, ['featureA.txt']);
    await questService.finish(q1.id, 'accept-commit');
    await questService.acceptFiles(q2.id, ['featureB.txt']);
    await questService.finish(q2.id, 'accept-commit');

    // Both changes now live on the main branch, cleanly.
    expect(fs.readFileSync(path.join(repoDir, 'featureA.txt'), 'utf8')).toBe('A from quest1\n');
    expect(fs.readFileSync(path.join(repoDir, 'featureB.txt'), 'utf8')).toBe('B from quest2\n');
    expect(fs.readFileSync(path.join(repoDir, 'shared.txt'), 'utf8')).toBe('do not touch\n');

    const after = await questService.detail(q1.id);
    expect(after!.quest.status).toBe('merged');
    expect((await questService.detail(q2.id))!.quest.status).toBe('merged');
  });
});

describe('quest-service — cancel isolation', { timeout: 60_000 }, () => {
  it('cancel mid-run removes the worktree and leaves the main workspace untouched', async () => {
    const headBefore = (await git.raw(['rev-parse', 'HEAD'])).trim();
    const statusBefore = (await git.raw(['status', '--porcelain'])).trim();

    const quest = await questService.draft(repoDir, 'Long-running quest');
    let worktreeSeen = '';
    questService.setRunnerForTests(async (req) => {
      worktreeSeen = req.worktreePath;
      // Pretend to do work, then block until aborted (a real agent run is long).
      fs.writeFileSync(path.join(req.worktreePath, 'scratch.txt'), 'WIP\n', 'utf8');
      await new Promise<void>((resolve) => {
        if (req.signal.aborted) return resolve();
        req.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const approvePromise = questService.approve(quest.id); // in-flight run
    const running = await waitForStatus(quest.id, ['running']);
    expect(fs.existsSync(running.worktreePath)).toBe(true);

    questService.cancel(quest.id);
    await approvePromise; // resolves once the abort listener fires in the runner

    const done = await waitForStatus(quest.id, ['cancelled']);
    expect(done.status).toBe('cancelled');
    expect(fs.existsSync(worktreeSeen)).toBe(false);

    // THE guarantee: main workspace is byte-identical, and the branch is gone.
    expect((await git.raw(['status', '--porcelain'])).trim()).toBe(statusBefore);
    expect((await git.raw(['rev-parse', 'HEAD'])).trim()).toBe(headBefore);
    const branches = await git.raw(['branch', '--list', 'quest/*']);
    expect(branches.trim()).toBe('');
  });
});

describe('quest-service — parallel cap', { timeout: 60_000 }, () => {
  it('queues the fourth approved quest when three are running', async () => {
    const quests: QuestMeta[] = [];
    for (let i = 0; i < 4; i++) {
      quests.push(await questService.draft(repoDir, `Quest ${i}`));
    }

    const gates: Array<() => void> = [];
    questService.setRunnerForTests(
      (req) =>
        new Promise<void>((resolve) => {
          fs.writeFileSync(path.join(req.worktreePath, `q_${req.quest.id}.txt`), 'x\n', 'utf8');
          gates.push(resolve);
        })
    );

    const inflight: Array<Promise<QuestMeta>> = [];
    // Fire the first three; they saturate the cap. Approving the fourth must
    // see three already running, so it is issued only after they are up.
    for (const q of quests.slice(0, 3)) inflight.push(questService.approve(q.id));
    await waitForStatus(quests[0].id, ['running']);
    await waitForStatus(quests[1].id, ['running']);
    await waitForStatus(quests[2].id, ['running']);

    const fourth = await questService.approve(quests[3].id);
    expect(fourth.status).toBe('queued');

    // Release the three runners; the pump should pick up the queued quest.
    for (const release of gates.splice(0, 3)) release();
    await waitForStatus(quests[3].id, ['running'], 20_000);

    // Release the rest and drain the in-flight approvals.
    for (const release of gates) release();
    await Promise.all(inflight);
  });
});
