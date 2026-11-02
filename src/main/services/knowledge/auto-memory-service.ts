/**
 * Prompt C Step 4 — Auto-Memory service.
 *
 * Turns finished tasks into durable, reviewable project knowledge WITHOUT ever
 * auto-writing rules the user has not confirmed:
 *
 *   distill()  → asks the locked route to extract candidate rules from the task's
 *                prompt + final response, returning a JSON array it is forced to emit.
 *                New candidates are appended to a per-workspace confirmation queue in
 *                `.tycode/memory/pending.json`. Rules already in correction memory or
 *                previously dismissed are skipped (no duplicate proposals per task).
 *
 *   approve()  → moves a (optionally user-edited) candidate into the real Correction
 *                Memory via saveCorrection, choosing scope: project (this workspace's
 *                hash) or global (a shared sentinel hash readable by every workspace).
 *
 *   dismiss()  → drops the candidate and records its text hash so the distiller stops
 *                re-proposing it.
 *
 *   buildRelevantInjection() → embeds the global-scope rules with the SAME local
 *                provider chain as the semantic index and injects only the top-K most
 *                cosine-relevant to the current prompt, keeping the block bounded.
 *
 * Honesty: with no model route, distill returns reason 'no-route' and writes nothing —
 * it never fabricates memory. Everything persists locally.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MEMORY_DIR,
  type MemoryCandidate,
  type PendingMemoryQueue,
  type DistillResult,
  type StoredMemory
} from '../../../shared/types/memory';
import { callLockedRoute } from './wiki-service';
import { resolveEmbedder, cosine } from './embeddings';
import {
  saveCorrection,
  deleteCorrection,
  getCorrectionEntries,
  type CorrectionCategory
} from '../context-engine/correction-memory';

/** Sentinel path whose stable hash buckets rules shared across every workspace. */
export const GLOBAL_MEMORY_SCOPE = '__tycode_global__';

/** Max correction rules injected by relevance per prompt. */
const RELEVANCE_TOP_K = 12;

interface RuleMeta {
  scope: 'project' | 'global';
  category: CorrectionCategory;
}

class AutoMemoryService {
  private memoryDir(root: string): string {
    return path.join(path.resolve(root), MEMORY_DIR);
  }

  private pendingPath(root: string): string {
    return path.join(this.memoryDir(root), 'pending.json');
  }

  async readQueue(workspaceRoot: string): Promise<PendingMemoryQueue> {
    try {
      const raw = await fsp.readFile(this.pendingPath(workspaceRoot), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PendingMemoryQueue>;
      return {
        v: 1,
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
        dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : []
      };
    } catch {
      return { v: 1, candidates: [], dismissed: [] };
    }
  }

  async pending(workspaceRoot: string): Promise<MemoryCandidate[]> {
    const queue = await this.readQueue(workspaceRoot);
    return queue.candidates;
  }

  private async writeQueue(workspaceRoot: string, queue: PendingMemoryQueue): Promise<void> {
    const dir = this.memoryDir(workspaceRoot);
    await fsp.mkdir(dir, { recursive: true });
    const target = this.pendingPath(workspaceRoot);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(queue, null, 2), 'utf-8');
    await fsp.rename(tmp, target);
  }

  /**
   * Runs a distillation pass over a finished task and queues any NEW, non-dismissed
   * candidates. Never throws; on failure it reports an honest reason and writes nothing.
   */
  async distill(workspaceRoot: string, prompt: string, response: string): Promise<DistillResult> {
    const system =
      'You are a meticulous engineering-memory distiller. From a completed coding task, extract ' +
      'ONLY durable, reusable rules the project should remember — explicit user preferences, ' +
      'corrections the user made, or conventions the task established. Do NOT invent rules that ' +
      "were not implied. Do NOT restate the task. Return STRICTLY a JSON array (no prose, no markdown " +
      'fences) whose elements look like: {"title": string, "rule": string, "category": "style" | ' +
      '"architecture" | "stack", "scope": "project" | "global", "rationale": string}. ' +
      'Prefer imperative "ALWAYS …" / "NEVER …" rule phrasing. Use "global" only for rules that ' +
      'apply to ANY project (broad language/tooling preferences); use "project" otherwise. ' +
      'If nothing is worth remembering, return an empty array: []';
    const user =
      `=== TASK PROMPT ===\n${truncate(prompt, 3000)}\n\n=== FINAL RESPONSE ===\n${truncate(response, 4000)}`;

    let raw: string;
    try {
      raw = await callLockedRoute(system, user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const noRoute = /no active model route/i.test(msg);
      return { proposed: 0, skipped: 0, reason: noRoute ? 'no-route' : 'error', message: msg, candidates: [] };
    }

    const parsed = extractJsonArray(raw);
    if (!parsed) return { proposed: 0, skipped: 0, reason: 'error', message: 'Model did not return a valid array.', candidates: [] };
    if (parsed.length === 0) return { proposed: 0, skipped: 0, reason: 'no-learning', candidates: [] };

    const queue = await this.readQueue(workspaceRoot);
    const existing = new Set<string>();
    for (const e of await this.collectAllRules(workspaceRoot)) existing.add(hashRule(e));
    const pending = new Set(queue.candidates.map((c) => hashRule(c.rule)));
    const dismissed = new Set(queue.dismissed);

    const fresh: MemoryCandidate[] = [];
    let skipped = 0;
    for (const item of parsed) {
      const cand = normalizeCandidate(item);
      if (!cand) {
        skipped++;
        continue;
      }
      const h = hashRule(cand.rule);
      if (existing.has(h) || pending.has(h) || dismissed.has(h)) {
        skipped++;
        continue;
      }
      pending.add(h);
      fresh.push(cand);
    }

    if (fresh.length > 0) {
      queue.candidates = [...queue.candidates, ...fresh].slice(-200);
      await this.writeQueue(workspaceRoot, queue);
    }

    return {
      proposed: fresh.length,
      skipped,
      reason: fresh.length > 0 ? 'ok' : 'no-learning',
      candidates: fresh
    };
  }

  /** Edits a still-pending candidate in place (title/rule/scope/category). */
  async update(
    workspaceRoot: string,
    id: string,
    patch: Partial<Pick<MemoryCandidate, 'title' | 'rule' | 'scope' | 'category'>>
  ): Promise<MemoryCandidate | null> {
    const queue = await this.readQueue(workspaceRoot);
    const idx = queue.candidates.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    queue.candidates[idx] = { ...queue.candidates[idx], ...patch };
    await this.writeQueue(workspaceRoot, queue);
    return queue.candidates[idx];
  }

  /** Approves a candidate into the real Correction Memory with the chosen scope. */
  async approve(
    workspaceRoot: string,
    id: string,
    scope: 'project' | 'global',
    editedRule?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const queue = await this.readQueue(workspaceRoot);
    const cand = queue.candidates.find((c) => c.id === id);
    if (!cand) return { ok: false, error: 'Candidate not found.' };
    const rule = (editedRule ?? cand.rule).trim();
    if (!rule) return { ok: false, error: 'Rule text is empty.' };

    const scopeTarget = scope === 'global' ? GLOBAL_MEMORY_SCOPE : workspaceRoot;
    const surface = scope === 'global' ? 'global' : 'chat';
    try {
      await saveCorrection(scopeTarget, rule, cand.category, surface);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    queue.candidates = queue.candidates.filter((c) => c.id !== id);
    await this.writeQueue(workspaceRoot, queue);
    return { ok: true };
  }

  /** Dismisses a candidate and records its hash so it is not re-proposed. */
  async dismiss(workspaceRoot: string, id: string): Promise<boolean> {
    const queue = await this.readQueue(workspaceRoot);
    const cand = queue.candidates.find((c) => c.id === id);
    if (!cand) return false;
    queue.candidates = queue.candidates.filter((c) => c.id !== id);
    queue.dismissed = [...new Set([...queue.dismissed, hashRule(cand.rule)])].slice(-500);
    await this.writeQueue(workspaceRoot, queue);
    return true;
  }

  /**
   * Selects the top-K global-scope rules most relevant to the query by embedding cosine
   * similarity and formats them for injection. Returns '' when nothing qualifies.
   * Global rules are additive (the per-workspace omni injection already covers project
   * rules), so this never double-counts project memory.
   */
  async buildRelevantInjection(query: string, topK = RELEVANCE_TOP_K): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed) return '';
    let globals;
    try {
      globals = await getCorrectionEntries(GLOBAL_MEMORY_SCOPE);
    } catch {
      return '';
    }
    if (globals.length === 0) return '';

    const embedder = await resolveEmbedder();
    const texts = globals.map((g) => g.rule);
    const [qvec, ...ruleVecs] = await embedder.embed([trimmed, ...texts]);
    const scored = globals
      .map((g, i) => ({ rule: g.rule, category: g.category, score: cosine(qvec, ruleVecs[i] || []) }))
      .filter((s) => s.score > 0.02)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(topK, RELEVANCE_TOP_K)));
    if (scored.length === 0) return '';
    const lines = scored.map((s) => `- [${s.category.toUpperCase()}] ${s.rule}`);
    return `[GLOBAL LEARNED PREFERENCES — most relevant to this task]\nThese cross-project rules were chosen by semantic relevance; honor them where applicable:\n${lines.join('\n')}`;
  }

  /** Removes a stored rule (used by the manager's delete on approved memories). */
  async removeStored(
    scopeTarget: string,
    id: string
  ): Promise<boolean> {
    return deleteCorrection(scopeTarget, id);
  }

  /** Lists project + global stored rules with their scope for the manager UI. */
  async listStored(workspaceRoot: string): Promise<StoredMemory[]> {
    const [project, global] = await Promise.all([
      getCorrectionEntries(workspaceRoot).catch(() => []),
      getCorrectionEntries(GLOBAL_MEMORY_SCOPE).catch(() => [])
    ]);
    return [
      ...project.map((e) => ({ id: e.id, rule: e.rule, category: e.category, surface: e.surface, scope: 'project' as const, createdAt: e.createdAt })),
      ...global.map((e) => ({ id: e.id, rule: e.rule, category: e.category, surface: e.surface, scope: 'global' as const, createdAt: e.createdAt }))
    ].sort((a, b) => b.createdAt - a.createdAt);
  }

  private async collectAllRules(workspaceRoot: string): Promise<string[]> {
    const [project, global] = await Promise.all([
      getCorrectionEntries(workspaceRoot).catch(() => []),
      getCorrectionEntries(GLOBAL_MEMORY_SCOPE).catch(() => [])
    ]);
    return [...project, ...global].map((e) => e.rule);
  }
}

// ---------------------------------------------------------------- helpers ----

function truncate(text: string, max: number): string {
  const t = (text || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function hashRule(rule: string): string {
  const normalized = (rule || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/** Extracts the first JSON array from a model reply that may include fences/prose. */
function extractJsonArray(raw: string): Array<Record<string, unknown>> | null {
  let text = (raw || '').trim();
  // strip ```json fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

/** Validates + normalizes one model-proposed element into a candidate, or null. */
function normalizeCandidate(item: Record<string, unknown>): MemoryCandidate | null {
  if (!item || typeof item !== 'object') return null;
  const rule = typeof item.rule === 'string' ? item.rule.trim() : '';
  if (!rule) return null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 200) : rule.slice(0, 80);
  const category = (['style', 'architecture', 'stack'].includes(String(item.category)) ? item.category : 'style') as CorrectionCategory;
  const scope = (item.scope === 'global' ? 'global' : 'project') as 'project' | 'global';
  const rationale = typeof item.rationale === 'string' ? item.rationale.trim().slice(0, 1000) : '';
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    rule: rule.slice(0, 2000),
    category,
    scope,
    rationale,
    taskSlug: '',
    createdAt: Date.now()
  };
}

export const autoMemoryService = new AutoMemoryService();
export type { RuleMeta };
