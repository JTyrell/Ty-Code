/**
 * Prompt B — Quest Mode service (spec-first autonomous delegation).
 *
 * Lifecycle: draft (agent writes the Spec via the locked model route) →
 * awaiting-approval (hard gate: nothing executes before a human Approves in the
 * Document Review Pane) → queued/running (isolated git worktree at
 * .tycode/worktrees/{questId}, own session/todos/checkpoints, max 3 parallel) →
 * reviewing (per-file Accept + commit, or cherry-pick) → merged / discarded /
 * cancelled / failed. The main workspace is NEVER edited by the quest runtime;
 * it is only touched by explicit merge-review actions (acceptFiles/finish), and
 * cancel/discard leave it untouched.
 *
 * Electron-heavy collaborators (unified session store, native notifications,
 * the agent engine, settings manager) are reached through dynamic imports so
 * this module stays loadable in the pure-Node main-process test harness and
 * card attachment stays best-effort. The spec generator and the run executor
 * are injectable seams: tests drive the full lifecycle with a deterministic
 * stub runner against real git, without any model call.
 *
 * Brand: Ty-Code
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { AgentStreamChunk, ProviderSettings } from '../../../preload/types';
import type { AgentDocument } from '../document-parser';
import { parseMarkdownSections, persistDocument } from '../document-parser';
import { callLockedRoute } from '../knowledge/wiki-service';
import {
  QUEST_LOG_LIMIT,
  QUEST_MAX_PARALLEL,
  QUEST_WORKTREES_DIR,
  type QuestChangedFile,
  type QuestEvent,
  type QuestFileDiff,
  type QuestLogLine,
  type QuestMeta,
  type QuestTodoRef
} from '../../../shared/types/quest';

const DIFF_CONTENT_CAP = 200_000;

export interface QuestRunRequest {
  quest: QuestMeta;
  specMarkdown: string;
  worktreePath: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  signal: AbortSignal;
}

export type QuestRunner = (req: QuestRunRequest) => Promise<void>;
export type SpecGenerator = (objective: string, title: string, feedback: string[]) => Promise<string>;

function gitFor(baseDir: string): SimpleGit {
  return simpleGit({ baseDir, maxConcurrentProcesses: 1 });
}

function previewText(value: string, limit: number): string {
  const first = (value || '').replace(/\s+/g, ' ').trim();
  return first.length > limit ? `${first.slice(0, limit)}…` : first;
}

function capContent(value: string): string {
  return value.length > DIFF_CONTENT_CAP ? `${value.slice(0, DIFF_CONTENT_CAP)}\n… [truncated]` : value;
}

function parseNameStatus(raw: string): QuestChangedFile[] {
  const out: QuestChangedFile[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0].replace(/[0-9]+/g, '');
    // Renames carry old then new path; merge review targets the NEW path.
    out.push({ path: parts[parts.length - 1], status });
  }
  return out;
}

const SPEC_SYSTEM_PROMPT = [
  'You are the Quest spec writer inside Ty-Code. The user delegates a long-horizon task ("quest") to an autonomous agent that will execute it later in an isolated git worktree.',
  'Draft a precise, testable specification the executing agent can follow without further questions.',
  'Reply with ONLY markdown containing exactly these level-2 sections in order:',
  '## Objective',
  '## Implementation Plan',
  '## Test Plan',
  '## Risks & Mitigations',
  'Name concrete files/modules where possible. Keep it under ~600 words. No preamble, no code fence around the whole document.'
].join('\n');

async function defaultSpecGenerator(objective: string, title: string, feedback: string[]): Promise<string> {
  const user = [
    `Quest title: ${title}`,
    `Objective:\n${objective}`,
    feedback.length
      ? `The reviewer requested these changes to the previous draft — address every point:\n${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : ''
  ].filter(Boolean).join('\n\n');
  return await callLockedRoute(SPEC_SYSTEM_PROMPT, user);
}

function buildQuestPrompt(quest: QuestMeta, specMarkdown: string, worktreePath: string): string {
  return [
    `You are Quest "${quest.title}" running autonomously inside an ISOLATED git worktree at ${worktreePath}.`,
    'A human approved the specification below. Execute it end to end.',
    '',
    '## Approved specification',
    specMarkdown,
    '',
    '## Original objective',
    quest.objective,
    '',
    'Hard rules: work only inside this worktree directory; never touch any other path.',
    'Keep every change focused on the specification. Run the project test suite when it exists.',
    'Do not create git commits — the quest harness commits your work when the run ends.',
    'Do not ask questions; make reasonable decisions and note them in your final summary.'
  ].join('\n');
}

async function defaultRunner(req: QuestRunRequest): Promise<void> {
  const { AgentEngine } = await import('../../agent/agent-engine');
  const { settingsManager } = await import('../settings-manager');
  // settings-manager widens `activeHarness` to string; the engine contract is
  // the authority here, exactly as the chat-side agent handlers treat it.
  const settings = (await settingsManager.getEffectiveSettings()) as ProviderSettings;
  const engine = new AgentEngine(req.worktreePath);
  await engine.run({
    prompt: buildQuestPrompt(req.quest, req.specMarkdown, req.worktreePath),
    workspacePath: req.worktreePath,
    history: [],
    settings,
    taskId: req.quest.questSessionId,
    onChunk: req.onChunk,
    abortSignal: req.signal,
    // The human approved the SPEC; the quest runs fully isolated in a worktree,
    // so tool approvals inside the run are auto-granted (and logged honestly).
    requestApproval: async () => ({ approved: true }),
    mode: 'BUILD'
  });
}

export class QuestService {
  private quests = new Map<string, QuestMeta>();
  private specs = new Map<string, string>();
  private logs = new Map<string, QuestLogLine[]>();
  private controllers = new Map<string, AbortController>();
  private sinks = new Set<(event: QuestEvent) => void>();

  private specGenerator: SpecGenerator = defaultSpecGenerator;
  private runner: QuestRunner = defaultRunner;

  /** Test seam: deterministic spec text without a model call. */
  setSpecGeneratorForTests(gen: SpecGenerator | null): void {
    this.specGenerator = gen ?? defaultSpecGenerator;
  }

  /** Test seam: stub execution instead of the real agent engine. */
  setRunnerForTests(runner: QuestRunner | null): void {
    this.runner = runner ?? defaultRunner;
  }

  onEvent(sink: (event: QuestEvent) => void): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  private emit(event: QuestEvent): void {
    for (const sink of this.sinks) {
      try {
        sink(event);
      } catch {
        // A dead renderer listener must never break the lifecycle.
      }
    }
  }

  private logLine(questId: string, level: QuestLogLine['level'], text: string): void {
    if (!text) return;
    const lines = this.logs.get(questId) || [];
    const line: QuestLogLine = { ts: Date.now(), level, text: text.slice(0, 2000) };
    lines.push(line);
    if (lines.length > QUEST_LOG_LIMIT) lines.splice(0, lines.length - QUEST_LOG_LIMIT);
    this.logs.set(questId, lines);
    this.emit({ questId, kind: 'log', line });
  }

  private touch(quest: QuestMeta, kind: QuestEvent['kind'] = 'status'): void {
    quest.updatedAt = Date.now();
    this.emit({ questId: quest.id, kind, quest });
  }

  list(workspaceRoot: string): QuestMeta[] {
    return Array.from(this.quests.values())
      .filter((q) => q.workspaceRoot === workspaceRoot)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  detail(questId: string): { quest: QuestMeta; log: QuestLogLine[] } | null {
    const quest = this.quests.get(questId);
    if (!quest) return null;
    return { quest, log: [...(this.logs.get(questId) || [])] };
  }

  snapshot(workspaceRoot?: string): { quests: QuestMeta[]; logs: Record<string, QuestLogLine[]> } {
    const quests = workspaceRoot ? this.list(workspaceRoot) : Array.from(this.quests.values());
    const ids = new Set(quests.map((q) => q.id));
    const logs: Record<string, QuestLogLine[]> = {};
    for (const [id, lines] of this.logs.entries()) {
      if (ids.has(id)) logs[id] = [...lines];
    }
    return { quests, logs };
  }

  /* ------------------------------------------------------------ Step 1: spec */

  /** Draft the quest spec. The quest cannot run until approve() is called. */
  async draft(workspaceRoot: string, objective: string, originSessionId = ''): Promise<QuestMeta> {
    const git = gitFor(workspaceRoot);
    let head = '';
    try {
      head = (await git.revparse(['HEAD'])).trim();
    } catch {
      throw new Error('Quest requires a git repository so execution can be isolated in a worktree. Initialize git (or open a repo) first.');
    }

    const id = `quest_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const title = previewText(objective, 80) || 'Quest';
    const quest: QuestMeta = {
      id,
      title,
      objective: objective.slice(0, 8000),
      workspaceRoot,
      status: 'drafting',
      branch: `quest/${id}`,
      worktreePath: path.join(workspaceRoot, QUEST_WORKTREES_DIR, id),
      baseCommit: head,
      questSessionId: `session_${id}`,
      originSessionId,
      specDocumentId: '',
      specRevisions: 0,
      todos: [],
      changedFiles: [],
      acceptedFiles: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.quests.set(id, quest);
    this.logs.set(id, []);
    this.logLine(id, 'info', `Quest created. Drafting the specification…`);
    this.touch(quest);

    await this.generateSpec(quest, []);
    return quest;
  }

  private async generateSpec(quest: QuestMeta, feedback: string[]): Promise<void> {
    const markdown = await this.specGenerator(quest.objective, quest.title, feedback);
    if (!markdown || !markdown.trim()) {
      quest.status = 'failed';
      quest.error = 'Spec drafting returned no content';
      this.touch(quest, 'done');
      return;
    }
    this.specs.set(quest.id, markdown);
    const docId = `doc_${quest.id}_r${quest.specRevisions}`;
    const document: AgentDocument = {
      id: docId,
      kind: 'plan',
      title: `Quest Spec — ${quest.title}`,
      markdown,
      sections: parseMarkdownSections(markdown),
      createdAt: Date.now(),
      questId: quest.id
    };
    try {
      await persistDocument(document);
    } catch {
      // The pane can still render the in-event document; persistence is a bonus.
    }
    quest.specDocumentId = docId;
    if (quest.status !== 'failed') {
      quest.status = 'awaiting-approval';
    }
    this.logLine(quest.id, 'info', `Spec draft ready${feedback.length ? ` (revised with ${feedback.length} reviewer notes)` : ''}. Awaiting approval.`);
    this.emit({ questId: quest.id, kind: 'spec', document, quest });
    this.touch(quest);
  }

  /** Reviewer requested changes: re-draft with the queued section comments. */
  async revise(questId: string, feedback: string[]): Promise<QuestMeta> {
    const quest = this.requireQuest(questId);
    if (quest.status !== 'awaiting-approval' && quest.status !== 'drafting') {
      throw new Error(`Quest ${questId} is ${quest.status}; revision is only possible before approval.`);
    }
    quest.specRevisions += 1;
    await this.generateSpec(quest, feedback.filter((f) => f.trim().length > 0));
    return quest;
  }

  /**
   * The approval gate. Only an approved spec may run, and only inside a fresh
   * isolated worktree. Saturates at QUEST_MAX_PARALLEL with a fair queue.
   */
  async approve(questId: string): Promise<QuestMeta> {
    const quest = this.requireQuest(questId);
    if (quest.status !== 'awaiting-approval') {
      throw new Error(`Approval gate: quest ${questId} cannot start from status '${quest.status}' — the spec must be approved first.`);
    }
    const running = Array.from(this.quests.values()).filter((q) => q.status === 'running').length;
    if (running >= QUEST_MAX_PARALLEL) {
      quest.status = 'queued';
      this.logLine(quest.id, 'info', `Approved. Queued — ${running} quests already running (cap ${QUEST_MAX_PARALLEL}).`);
      this.touch(quest);
      return quest;
    }
    await this.startRun(quest);
    return quest;
  }

  private pumpQueue(): void {
    const running = Array.from(this.quests.values()).filter((q) => q.status === 'running').length;
    if (running >= QUEST_MAX_PARALLEL) return;
    const next = Array.from(this.quests.values())
      .filter((q) => q.status === 'queued')
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (next) {
      void this.startRun(next).catch((err: unknown) => {
        next.status = 'failed';
        next.error = err instanceof Error ? err.message : String(err);
        this.touch(next, 'done');
        this.pumpQueue();
      });
    }
  }

  /* --------------------------------------------------------- Step 1: isolated run */

  private async startRun(quest: QuestMeta): Promise<void> {
    const git = gitFor(quest.workspaceRoot);
    await this.ensureWorktreesIgnored(quest.workspaceRoot, git);

    quest.baseCommit = (await git.revparse(['HEAD'])).trim();
    await fs.mkdir(path.join(quest.workspaceRoot, QUEST_WORKTREES_DIR), { recursive: true });
    try {
      await git.raw(['worktree', 'add', quest.worktreePath, '-b', quest.branch, quest.baseCommit]);
    } catch (err: unknown) {
      await git.raw(['worktree', 'prune']).catch(() => undefined);
      throw new Error(`Could not create the isolated worktree: ${err instanceof Error ? err.message : String(err)}`);
    }

    quest.status = 'running';
    this.logLine(quest.id, 'info', `Running in isolated worktree ${quest.worktreePath} (base ${quest.baseCommit.slice(0, 8)}).`);
    this.touch(quest);

    const controller = new AbortController();
    this.controllers.set(quest.id, controller);

    const spec = this.specs.get(quest.id) || quest.objective;
    try {
      await this.runner({
        quest,
        specMarkdown: spec,
        worktreePath: quest.worktreePath,
        onChunk: (chunk) => this.translateChunk(quest.id, chunk),
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        await this.finalizeCancelled(quest);
      } else {
        await this.finalizeCompleted(quest);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        await this.finalizeCancelled(quest);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        quest.status = 'failed';
        quest.error = message;
        this.logLine(quest.id, 'error', `Quest failed: ${message}`);
        this.touch(quest, 'done');
        await this.attachQuestCard(quest);
      }
    } finally {
      this.controllers.delete(quest.id);
      this.pumpQueue();
    }
  }

  private translateChunk(questId: string, chunk: AgentStreamChunk): void {
    switch (chunk.type) {
      case 'thought':
        this.logLine(questId, 'thought', previewText(String(chunk.content || ''), 300));
        break;
      case 'tool_call':
        this.logLine(questId, 'tool', `${chunk.toolCall?.name || 'tool'} ${previewText(JSON.stringify(chunk.toolCall?.arguments || {}), 200)}`);
        break;
      case 'tool_result':
        if (chunk.toolResult?.isError) {
          this.logLine(questId, 'error', previewText(String(chunk.toolResult.output || ''), 300));
        }
        break;
      case 'status':
        this.logLine(questId, 'status', previewText(String(chunk.content || ''), 300));
        break;
      case 'error':
        this.logLine(questId, 'error', previewText(String(chunk.error || ''), 300));
        break;
      case 'agent_state': {
        const todos = (chunk.state?.todos || []) as Array<{ id?: string; task?: string; status?: string }>;
        const mapped: QuestTodoRef[] = todos.slice(0, 200).map((t, i) => ({
          id: String(t.id || `todo_${i}`),
          task: String(t.task || ''),
          status: (['pending', 'in_progress', 'completed', 'failed'].includes(String(t.status)) ? t.status : 'pending') as QuestTodoRef['status']
        }));
        const quest = this.quests.get(questId);
        if (quest) {
          quest.todos = mapped;
          this.emit({ questId, kind: 'todos', quest });
        }
        break;
      }
      default:
        break;
    }
  }

  private async finalizeCompleted(quest: QuestMeta): Promise<void> {
    const wt = gitFor(quest.worktreePath);
    try {
      await wt.raw(['add', '-A']);
      const status = await wt.raw(['status', '--porcelain']);
      if (status.trim().length > 0) {
        await wt.raw(['commit', '-m', `quest(${quest.id}): ${quest.title}`]);
      }
    } catch (err: unknown) {
      this.logLine(quest.id, 'error', `Could not commit quest work in the worktree: ${err instanceof Error ? err.message : String(err)}`);
    }

    const git = gitFor(quest.workspaceRoot);
    try {
      const raw = await git.raw(['diff', '--name-status', quest.baseCommit, quest.branch]);
      quest.changedFiles = parseNameStatus(raw);
    } catch {
      quest.changedFiles = [];
    }
    quest.status = 'reviewing';
    this.logLine(quest.id, 'info', `Done. ${quest.changedFiles.length} file(s) changed — open Merge Review.`);
    this.emit({ questId: quest.id, kind: 'files', quest });
    this.touch(quest, 'done');
    await this.attachQuestCard(quest);
    this.notify('Ty-Code Quest complete', `"${quest.title}" finished — ${quest.changedFiles.length} file(s) await merge review.`);
  }

  private async finalizeCancelled(quest: QuestMeta): Promise<void> {
    // Cancel mid-run must leave the MAIN workspace untouched: the worktree and
    // its branch are the only things that can be removed.
    await this.removeWorktreeAndBranch(quest);
    quest.status = 'cancelled';
    this.logLine(quest.id, 'status', 'Cancelled. Worktree removed; main workspace untouched.');
    this.touch(quest, 'done');
    await this.attachQuestCard(quest);
  }

  /* ------------------------------------------------------------- Step 2: merge */

  async fileDiff(questId: string, filePath: string): Promise<QuestFileDiff> {
    const quest = this.requireQuest(questId);
    const git = gitFor(quest.workspaceRoot);
    const changed = quest.changedFiles.find((f) => f.path === filePath);
    const readAt = async (ref: string): Promise<string> => {
      try {
        return capContent(await git.raw(['show', `${ref}:${filePath}`]));
      } catch {
        return '';
      }
    };
    const [originalContent, modifiedContent] = await Promise.all([
      readAt(quest.baseCommit),
      readAt(quest.branch)
    ]);
    return { path: filePath, status: changed?.status || 'M', originalContent, modifiedContent };
  }

  /** Per-file Accept: bring ONE quest file into the main workspace index+tree. */
  async acceptFiles(questId: string, paths: string[]): Promise<QuestMeta> {
    const quest = this.requireQuest(questId);
    if (quest.status !== 'reviewing') {
      throw new Error(`Quest ${questId} is ${quest.status}; files can only be accepted during merge review.`);
    }
    const git = gitFor(quest.workspaceRoot);
    for (const p of paths) {
      const changed = quest.changedFiles.find((f) => f.path === p);
      if (!changed) throw new Error(`'${p}' is not part of quest ${questId}'s changed files.`);
      if (changed.status === 'D') {
        await git.raw(['rm', '-f', '--', p]);
      } else {
        await git.raw(['checkout', quest.branch, '--', p]);
      }
      if (!quest.acceptedFiles.includes(p)) quest.acceptedFiles.push(p);
      this.logLine(quest.id, 'status', `Accepted ${p}`);
    }
    this.touch(quest);
    return quest;
  }

  /** Finish the review: commit accepted files, or cherry-pick the whole quest. */
  async finish(questId: string, mode: 'accept-commit' | 'cherry-pick'): Promise<QuestMeta> {
    const quest = this.requireQuest(questId);
    if (quest.status !== 'reviewing') {
      throw new Error(`Quest ${questId} is ${quest.status}; only a reviewed quest can be finished.`);
    }
    const git = gitFor(quest.workspaceRoot);
    if (mode === 'cherry-pick') {
      const shas = (await git.raw(['rev-list', `${quest.baseCommit}..${quest.branch}`])).split(/\r?\n/).filter(Boolean).reverse();
      if (shas.length === 0) throw new Error('Quest branch has no commits to cherry-pick.');
      for (const sha of shas) {
        try {
          await git.raw(['cherry-pick', '--no-commit', sha]);
        } catch (err: unknown) {
          await git.raw(['cherry-pick', '--abort']).catch(() => undefined);
          throw new Error(`Cherry-pick conflicted with local changes (${err instanceof Error ? err.message.slice(0, 160) : 'unknown'}). Use per-file Accept instead. Nothing was committed.`);
        }
      }
    } else {
      if (quest.acceptedFiles.length === 0) {
        throw new Error('Nothing accepted yet — accept at least one file or discard the quest.');
      }
    }
    const pathsForCommit = mode === 'cherry-pick' ? [] : quest.acceptedFiles;
    const message = `Quest ${quest.id}: ${quest.title}${mode === 'cherry-pick' ? ' (cherry-pick)' : ` (${quest.acceptedFiles.length} file(s) accepted)`}`;
    if (pathsForCommit.length > 0) {
      await git.raw(['commit', '-m', message, '--', ...pathsForCommit]);
    } else {
      await git.raw(['commit', '-m', message]);
    }
    await this.removeWorktreeAndBranch(quest);
    quest.status = 'merged';
    this.logLine(quest.id, 'info', mode === 'cherry-pick' ? 'Merged via cherry-pick. Worktree removed.' : `Merged ${quest.acceptedFiles.length} file(s). Worktree removed.`);
    this.touch(quest, 'done');
    await this.attachQuestCard(quest);
    return quest;
  }

  /** Discard: revert any accepted-but-uncommitted files, drop worktree + branch. */
  async discard(questId: string): Promise<QuestMeta> {
    const quest = this.requireQuest(questId);
    if (quest.status === 'running') throw new Error('Cancel the running quest first; discard removes its worktree.');
    if (quest.status === 'merged' || quest.status === 'discarded') return quest;
    const git = gitFor(quest.workspaceRoot);
    for (const p of quest.acceptedFiles) {
      // Restore the file to the main workspace's own state (undo the Accept).
      await git.raw(['restore', '--staged', '--worktree', '--', p]).catch(async () => {
        await git.raw(['rm', '-f', '--cached', '--', p]).catch(() => undefined);
        await fs.rm(path.join(quest.workspaceRoot, p), { force: true }).catch(() => undefined);
      });
    }
    if (quest.acceptedFiles.length > 0) {
      this.logLine(quest.id, 'status', `Reverted ${quest.acceptedFiles.length} accepted file(s) before discard.`);
    }
    await this.removeWorktreeAndBranch(quest);
    quest.acceptedFiles = [];
    quest.status = 'discarded';
    this.logLine(quest.id, 'status', 'Quest discarded.');
    this.touch(quest, 'done');
    return quest;
  }

  cancel(questId: string): QuestMeta {
    const quest = this.requireQuest(questId);
    if (['merged', 'discarded', 'cancelled', 'failed'].includes(quest.status)) return quest;
    const controller = this.controllers.get(questId);
    if (controller) {
      this.logLine(questId, 'status', 'Cancellation requested.');
      controller.abort();
      return quest;
    }
    if (quest.status === 'queued') {
      quest.status = 'cancelled';
      this.logLine(quest.id, 'status', 'Cancelled while queued (never started). Main workspace untouched.');
      this.touch(quest, 'done');
      return quest;
    }
    quest.status = 'cancelled';
    this.logLine(quest.id, 'status', 'Cancelled before start. Main workspace untouched.');
    this.touch(quest, 'done');
    return quest;
  }

  /* ------------------------------------------------------------------ helpers */

  private requireQuest(questId: string): QuestMeta {
    const quest = this.quests.get(questId);
    if (!quest) throw new Error(`Unknown quest: ${questId}`);
    return quest;
  }

  private async removeWorktreeAndBranch(quest: QuestMeta): Promise<void> {
    const git = gitFor(quest.workspaceRoot);
    try {
      await git.raw(['worktree', 'remove', quest.worktreePath, '--force']);
    } catch {
      await fs.rm(quest.worktreePath, { recursive: true, force: true }).catch(() => undefined);
      await git.raw(['worktree', 'prune']).catch(() => undefined);
    }
    await git.raw(['branch', '-D', quest.branch]).catch(() => undefined);
  }

  /**
   * Keep `.tycode/` runtime data out of git staging so a quest worktree's
   * `git add -A` can never swallow local agent state. Uses `.git/info/exclude`
   * only — no tracked file is modified, and already-tracked paths are unaffected.
   */
  private async ensureWorktreesIgnored(workspaceRoot: string, git: SimpleGit): Promise<void> {
    try {
      const rawCommon = (await git.raw(['rev-parse', '--git-common-dir'])).trim();
      // `--git-common-dir` is relative to the repo when the repo is the cwd of
      // the git process; resolve against the workspace root so we never write
      // into whatever repository happens to be the current directory.
      const commonDir = path.isAbsolute(rawCommon) ? rawCommon : path.resolve(workspaceRoot, rawCommon);
      const excludePath = path.resolve(commonDir, 'info', 'exclude');
      const marker = `${QUEST_WORKTREES_DIR}/`;
      let current = '';
      try {
        current = await fs.readFile(excludePath, 'utf8');
      } catch {
        current = '';
      }
      if (!current.includes(marker)) {
        await fs.mkdir(path.dirname(excludePath), { recursive: true });
        await fs.appendFile(excludePath, `\n# Ty-Code quest worktrees (Prompt B)\n${marker}\n.tycode/\n`, 'utf8');
      }
    } catch {
      // Non-fatal: worst case a stray worktree dir shows up as untracked noise.
    }
  }

  /** Quest card: spec + log tail + diff summary, appended to the origin session. */
  private async attachQuestCard(quest: QuestMeta): Promise<void> {
    if (!quest.originSessionId) return;
    try {
      const { unifiedSessionStore } = await import('../session/unified-session-store');
      const git = gitFor(quest.workspaceRoot);
      let shortstat = '(no changes)';
      try {
        shortstat = (await git.raw(['diff', '--shortstat', quest.baseCommit, quest.branch])).trim() || '(no changes)';
      } catch { /* branch may be gone post-merge */ }
      const log = (this.logs.get(quest.id) || []).slice(-30);
      const spec = this.specs.get(quest.id) || '';
      const completed = quest.todos.filter((t) => t.status === 'completed').length;
      const card = [
        `### Quest card — ${quest.title}`,
        `Status: **${quest.status}** · ${quest.changedFiles.length} changed file(s) · ${shortstat}`,
        `Todos: ${completed}/${quest.todos.length} completed`,
        '',
        '**Spec**',
        spec.slice(0, 2000),
        '',
        '**Changed files**',
        quest.changedFiles.slice(0, 40).map((f) => `- ${f.status} ${f.path}`).join('\n') || '- none',
        '',
        '**Log (tail)**',
        log.map((l) => `[${l.level}] ${l.text}`).join('\n')
      ].join('\n');
      await unifiedSessionStore.patchSession(quest.workspaceRoot, quest.originSessionId, (payload) => {
        payload.messages.push({
          role: 'assistant',
          content: card,
          questCard: {
            questId: quest.id,
            title: quest.title,
            status: quest.status,
            changedFileCount: quest.changedFiles.length,
            specDocumentId: quest.specDocumentId
          }
        });
      });
    } catch {
      // Best-effort: quest history must never depend on session plumbing.
    }
  }

  private async notify(title: string, body: string): Promise<void> {
    try {
      const { backgroundTaskSupervisor } = await import('../background/background-task-supervisor');
      backgroundTaskSupervisor.sendNativeNotification(title, body);
    } catch {
      // Notifications are cosmetic in headless/test environments.
    }
  }

  /** Test/dispose helper: abort everything and forget state. */
  resetForTests(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.quests.clear();
    this.specs.clear();
    this.logs.clear();
    this.sinks.clear();
  }
}

export const questService = new QuestService();
